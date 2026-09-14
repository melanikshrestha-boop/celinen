#include "lenslabs/canonical_v2.hpp"
#include <algorithm>
#include <array>
#include <cfenv>
#include <csetjmp>
#include <cstdio>
#include <cstring>
#include <map>
#include <memory>
#include <set>
#include <jpeglib.h>
#include <lcms2.h>
#include <libraw/libraw.h>

#ifndef V2_CONTRACT_SHA
#error V2 build requires the exact dependency/contract lock hash
#endif
namespace lenslabs::canonical_v2 {
namespace {
using Bytes=std::span<const std::uint8_t>;
constexpr auto profile_hash="384b832de3412066743b52a75ee906b6fb9fb8d9e09e936fc2c43223815c6e0a";
[[noreturn]] void fail(ErrorCode c,const char* stage,const char* why) {throw Error(c,stage,why);}
std::uint32_t be32(Bytes b,std::size_t p) {
  if(p>b.size() || b.size()-p<4)fail(ErrorCode::invalid_icc,"color","Truncated ICC integer");
  return std::uint32_t(b[p])<<24|std::uint32_t(b[p+1])<<16|std::uint32_t(b[p+2])<<8|b[p+3];
}
bool starts(Bytes b,const char* s,std::size_t n) {return b.size()>=n && std::memcmp(b.data(),s,n)==0;}
struct Metadata {unsigned orientation=0;bool other_space=false;std::vector<std::uint8_t> icc;};
void exif(Bytes b,Metadata& out) {
  if(b.size()<8 || !(starts(b,"II",2)||starts(b,"MM",2)))
    fail(ErrorCode::invalid_orientation,"metadata","Malformed EXIF header");
  const bool little=b[0]=='I';
  auto u16=[&](std::size_t p)->std::uint32_t {
    if(p>b.size()||b.size()-p<2)fail(ErrorCode::invalid_orientation,"metadata","EXIF bounds");
    return little?b[p]|std::uint32_t(b[p+1])<<8:std::uint32_t(b[p])<<8|b[p+1];
  };
  auto u32=[&](std::size_t p)->std::uint32_t {
    if(p>b.size()||b.size()-p<4)fail(ErrorCode::invalid_orientation,"metadata","EXIF bounds");
    return little?u16(p)|(u16(p+2)<<16):(u16(p)<<16)|u16(p+2);
  };
  if(u16(2)!=42)fail(ErrorCode::invalid_orientation,"metadata","EXIF TIFF magic");
  std::vector<std::pair<std::uint32_t,unsigned>> pending{{u32(4),0}};
  std::set<std::uint32_t> visited;
  while(!pending.empty()) {
    const auto [p,depth]=pending.back();pending.pop_back();
    if(!p || depth>3 || !visited.insert(p).second)
      fail(ErrorCode::invalid_orientation,"metadata","EXIF cyclic or invalid IFD");
    const auto count=u16(p);
    if(count>1024 || std::uint64_t(p)+2ULL+12ULL*count+4>b.size())
      fail(ErrorCode::invalid_orientation,"metadata","EXIF directory bounds");
    for(unsigned i=0;i<count;++i) {
      const std::size_t at=p+2+12*i;
      const auto tag=u16(at),type=u16(at+2),n=u32(at+4);
      if(tag==0x112 && depth==0) {
        const auto value=u16(at+8);
        if(type!=3||n!=1||value<1||value>8||(out.orientation&&out.orientation!=value))
          fail(ErrorCode::invalid_orientation,"metadata","Conflicting or invalid orientation");
        out.orientation=value;
      }
      if(tag==0x8769||tag==0xa005) {
        if(type!=4||n!=1)fail(ErrorCode::invalid_orientation,"metadata","Invalid subdirectory pointer");
        pending.emplace_back(u32(at+8),depth+1);
      }
      if(tag==0xa001 && type==3 && n==1 && u16(at+8)==2)out.other_space=true;
      if(tag==1 && depth==2 && type==2 && n==4 && starts(b.subspan(at+8),"R03",3))out.other_space=true;
    }
  }
}
Metadata parse_jpeg(Bytes b) {
  if(!starts(b,"\xff\xd8",2))fail(ErrorCode::invalid_jpeg,"metadata","Missing SOI");
  Metadata out;
  std::map<unsigned,std::vector<std::uint8_t>> chunks;
  unsigned chunk_count=0;std::size_t total=0,p=2;bool eoi=false,sof=false;
  while(p<b.size()) {
    if(b[p++]!=0xff)fail(ErrorCode::invalid_jpeg,"metadata","Expected JPEG marker");
    while(p<b.size()&&b[p]==0xff)++p;
    if(p==b.size())break;
    const auto marker=b[p++];
    if(marker==0xd9){eoi=true;break;}
    if(marker==0xd8||marker==0||marker==1||(marker>=0xd0&&marker<=0xd7))
      fail(ErrorCode::invalid_jpeg,"metadata","Unexpected standalone marker");
    if(b.size()-p<2)break;
    const auto n=(unsigned(b[p])<<8)|b[p+1];
    if(n<2||n>b.size()-p)fail(ErrorCode::invalid_jpeg,"metadata","JPEG segment bounds");
    const auto data=b.subspan(p+2,n-2);p+=n;
    if(marker>=0xc0&&marker<=0xcf&&marker!=0xc4&&marker!=0xc8&&marker!=0xcc) {
      if((marker!=0xc0&&marker!=0xc1&&marker!=0xc2)||data.size()<6||data[0]!=8||sof)
        fail(ErrorCode::unsupported_source,"metadata","Unsupported JPEG encoding");
      sof=true;
    }
    if(marker==0xcc)fail(ErrorCode::unsupported_source,"metadata","Arithmetic JPEG unsupported");
    if(marker==0xe1&&starts(data,"Exif\0\0",6))exif(data.subspan(6),out);
    if((marker==0xe2&&starts(data,"MPF\0",4)) ||
       (marker==0xe1&&std::search(data.begin(),data.end(),"hdrgm:",&"hdrgm:"[6])!=data.end()))
      fail(ErrorCode::unsupported_source,"metadata","Multiple image/HDR container unsupported");
    if(marker==0xe2&&starts(data,"ICC_PROFILE\0",12)) {
      if(data.size()<14)fail(ErrorCode::invalid_icc,"metadata","Truncated ICC chunk");
      const unsigned index=data[12],count=data[13];
      if(!index||!count||index>count||(chunk_count&&chunk_count!=count)||chunks.count(index))
        fail(ErrorCode::invalid_icc,"metadata","Conflicting ICC chunks");
      total+=data.size()-14;
      if(total>4*1024*1024)fail(ErrorCode::limit_exceeded,"metadata","ICC size limit");
      chunk_count=count;chunks[index]={data.begin()+14,data.end()};
    }
    if(marker==0xda) {
      while(p<b.size()) {
        if(b[p]!=0xff){++p;continue;}
        std::size_t q=p+1;while(q<b.size()&&b[q]==0xff)++q;
        if(q==b.size()){p=q;break;}
        if(b[q]==0||(b[q]>=0xd0&&b[q]<=0xd7)){p=q+1;continue;}
        break;
      }
    }
  }
  if(!eoi||!sof)fail(ErrorCode::invalid_jpeg,"metadata","Incomplete JPEG");
  if(chunks.size()!=chunk_count)fail(ErrorCode::invalid_icc,"metadata","Missing ICC chunk");
  for(auto& [index,chunk]:chunks){(void)index;out.icc.insert(out.icc.end(),chunk.begin(),chunk.end());}
  if(chunk_count&&out.icc.empty())fail(ErrorCode::invalid_icc,"metadata","Empty embedded ICC");
  return out;
}
struct JpegState {
  jpeg_decompress_struct decoder{};jpeg_error_mgr error{};std::jmp_buf jump;
  bool created=false;char message[JMSG_LENGTH_MAX]{};
  ~JpegState(){if(created)jpeg_destroy_decompress(&decoder);}
};
void jpeg_error(j_common_ptr c) {
  auto* s=static_cast<JpegState*>(c->client_data);
  (*c->err->format_message)(c,s->message);std::longjmp(s->jump,1);
}
void jpeg_message(j_common_ptr c,int level) {if(level<0)jpeg_error(c);}
struct Rgb {unsigned width{},height{};std::vector<std::uint8_t> bytes;};
Rgb decode_jpeg(Bytes b,const Control& control) {
  auto state=std::make_unique<JpegState>();
  Rgb out;auto& d=state->decoder;
  d.err=jpeg_std_error(&state->error);d.client_data=state.get();
  state->error.error_exit=jpeg_error;state->error.emit_message=jpeg_message;
  if(setjmp(state->jump))throw Error(ErrorCode::invalid_jpeg,"decode",state->message);
  state->created=true;jpeg_create_decompress(&d);
  jpeg_mem_src(&d,b.data(),static_cast<unsigned long>(b.size()));
  jpeg_read_header(&d,TRUE);
  if(d.data_precision!=8 || d.arith_code ||
    (d.jpeg_color_space!=JCS_RGB&&d.jpeg_color_space!=JCS_YCbCr&&d.jpeg_color_space!=JCS_GRAYSCALE))
    fail(ErrorCode::unsupported_source,"decode","Unsupported JPEG channels/precision");
  target_geometry(d.image_width,d.image_height);
  d.dct_method=JDCT_ISLOW;d.do_fancy_upsampling=TRUE;d.do_block_smoothing=FALSE;
  d.scale_num=1;d.scale_denom=1;d.out_color_space=JCS_RGB;d.quantize_colors=FALSE;
  jpeg_start_decompress(&d);
  out.width=d.output_width;out.height=d.output_height;
  if(d.output_components!=3)fail(ErrorCode::invalid_jpeg,"decode","Expected RGB8");
  out.bytes.resize(std::size_t(out.width)*out.height*3);
  while(d.output_scanline<d.output_height) {
    control.check("decode");
    JSAMPROW row=out.bytes.data()+std::size_t(d.output_scanline)*out.width*3;
    if(jpeg_read_scanlines(&d,&row,1)!=1)fail(ErrorCode::invalid_jpeg,"decode","Incomplete scanline");
  }
  jpeg_finish_decompress(&d);return out;
}
void validate_profile(Bytes b) {
  if(b.size()<132||b.size()>4*1024*1024||be32(b,0)!=b.size()||!starts(b.subspan(36),"acsp",4))
    fail(ErrorCode::invalid_icc,"color","ICC header/size invalid");
  if((b[8]!=2&&b[8]!=4)||!starts(b.subspan(16),"RGB ",4)||
    (!starts(b.subspan(12),"mntr",4)&&!starts(b.subspan(12),"scnr",4)))
    fail(ErrorCode::unsupported_icc,"color","Only RGB matrix/TRC display/input profiles supported");
  const auto n=be32(b,128);
  if(n>256 || 132ULL+12ULL*n>b.size())fail(ErrorCode::invalid_icc,"color","ICC tag table bounds");
  std::set<std::string> tags;
  for(unsigned i=0;i<n;++i) {
    const auto p=132+12*i,offset=be32(b,p+4),size=be32(b,p+8);
    std::string tag(reinterpret_cast<const char*>(b.data()+p),4);
    if(!tags.insert(tag).second||offset<132+12*n||offset>b.size()||size<8||size>b.size()-offset)
      fail(ErrorCode::invalid_icc,"color","ICC tag range/duplicate");
    if(tag.starts_with("A2B")||tag.starts_with("B2A")||tag.starts_with("D2B")||tag.starts_with("B2D"))
      fail(ErrorCode::unsupported_icc,"color","LUT ICC not admitted");
    if(tag=="rTRC"||tag=="gTRC"||tag=="bTRC") {
      if(size<12)fail(ErrorCode::invalid_icc,"color","Truncated TRC");
      if(starts(b.subspan(offset),"curv",4)) {
        if(12ULL+2ULL*be32(b,offset+8)>size)fail(ErrorCode::invalid_icc,"color","Curve bounds");
      } else if(starts(b.subspan(offset),"para",4)) {
        const unsigned function=(unsigned(b[offset+8])<<8)|b[offset+9];
        constexpr unsigned count[]={1,3,4,5,7};
        if(function>4||12+4*count[function]>size)fail(ErrorCode::invalid_icc,"color","Parametric curve bounds");
      } else fail(ErrorCode::unsupported_icc,"color","Unsupported TRC type");
    }
  }
  for(const auto* tag:{"rXYZ","gXYZ","bXYZ","rTRC","gTRC","bTRC","wtpt"})
    if(!tags.count(tag))fail(ErrorCode::unsupported_icc,"color","Incomplete RGB matrix/TRC profile");
}
struct Cms {
  cmsContext context=nullptr;cmsHPROFILE input=nullptr,output=nullptr;cmsHTRANSFORM transform=nullptr;
  bool error=false;
  ~Cms(){if(transform)cmsDeleteTransform(transform);if(input)cmsCloseProfile(input);if(output)cmsCloseProfile(output);if(context)cmsDeleteContext(context);}
};
Rgba color(const Rgb& rgb,Bytes input,Bytes output,bool identity,const Control& control) {
  Rgba a{rgb.width,rgb.height,std::vector<std::uint8_t>(std::size_t(rgb.width)*rgb.height*4)};
  for(std::size_t i=0;i<rgb.bytes.size()/3;++i) {
    std::copy_n(rgb.bytes.data()+3*i,3,a.bytes.data()+4*i);a.bytes[4*i+3]=255;
  }
  if(identity)return a;
  validate_profile(input);validate_profile(output);
  Cms cms;cms.context=cmsCreateContext(nullptr,&cms);
  if(!cms.context)fail(ErrorCode::resource_exhausted,"color","Cannot allocate color context");
  cmsSetLogErrorHandlerTHR(cms.context,[](cmsContext c,cmsUInt32Number,const char*){
    static_cast<Cms*>(cmsGetContextUserData(c))->error=true;
  });
  cmsSetAdaptationStateTHR(cms.context,1.0);
  cms.input=cmsOpenProfileFromMemTHR(cms.context,input.data(),static_cast<cmsUInt32Number>(input.size()));
  cms.output=cmsOpenProfileFromMemTHR(cms.context,output.data(),static_cast<cmsUInt32Number>(output.size()));
  if(!cms.input||!cms.output||cms.error)fail(ErrorCode::invalid_icc,"color","Cannot open ICC");
  cms.transform=cmsCreateTransformTHR(cms.context,cms.input,TYPE_RGBA_8,cms.output,TYPE_RGBA_8,
    INTENT_RELATIVE_COLORIMETRIC,cmsFLAGS_NOCACHE|cmsFLAGS_NOOPTIMIZE|cmsFLAGS_COPY_ALPHA);
  if(!cms.transform||cms.error)fail(ErrorCode::invalid_icc,"color","Cannot create transform");
  for(unsigned y=0;y<a.height;++y) {
    control.check("color");auto* row=a.bytes.data()+std::size_t(y)*a.width*4;
    cmsDoTransform(cms.transform,row,row,a.width);
    if(cms.error)fail(ErrorCode::invalid_icc,"color","Color transform failed");
  }
  return a;
}
struct Preview {std::vector<std::uint8_t> jpeg;unsigned orientation=0;};
Preview extract(Bytes bytes,const Control& control) {
  if(!(starts(bytes,"II\x2a\0",4)||starts(bytes,"MM\0\x2a",4)))
    fail(ErrorCode::unsupported_source,"extract","Only JPEG and qualified Sony TIFF/ARW supported");
  auto raw=std::make_unique<LibRaw>();
  raw->imgdata.rawparams.max_raw_memory_mb=128;
  bool data_error=false;
  raw->set_dataerror_handler([](void* p,const char*,INT64){*static_cast<bool*>(p)=true;},&data_error);
  raw->set_progress_handler([](void* p,enum LibRaw_progress,int,int)->int {
    try{static_cast<const Control*>(p)->check("extract");return 0;}catch(...){return 1;}
  },const_cast<Control*>(&control));
  const int opened=raw->open_buffer(const_cast<std::uint8_t*>(bytes.data()),bytes.size());
  control.check("extract");
  if(opened==LIBRAW_UNSUFFICIENT_MEMORY)fail(ErrorCode::resource_exhausted,"extract","RAW metadata allocation failed");
  if(opened!=LIBRAW_SUCCESS||data_error)fail(ErrorCode::invalid_raw_preview,"extract","Unreadable RAW metadata");
  const std::string make=raw->imgdata.idata.make,model=raw->imgdata.idata.model;
  if((make!="Sony"&&make!="SONY")||(model!="ILCE-6000"&&model!="ILCE-7M4")||raw->imgdata.idata.dng_version)
    fail(ErrorCode::unsupported_source,"extract","Camera not on initial ARW fixture allowlist");
  const int flip=raw->imgdata.sizes.flip;
  if(flip<0||flip>7)fail(ErrorCode::invalid_orientation,"extract","Unresolved RAW orientation");
  // Inverse of pinned LibRaw's EXIF -> dcraw flip mapping in metadata/tiff.cpp.
  constexpr unsigned orientation[]={1,2,4,3,5,8,6,7};
  const int unpacked=raw->unpack_thumb();
  control.check("extract");
  if(unpacked==LIBRAW_UNSUFFICIENT_MEMORY)fail(ErrorCode::resource_exhausted,"extract","RAW preview allocation failed");
  if(unpacked!=LIBRAW_SUCCESS||data_error||raw->imgdata.thumbnail.tformat!=LIBRAW_THUMBNAIL_JPEG||
     raw->imgdata.thumbnail.tlength>32U*1024*1024)
    fail(ErrorCode::invalid_raw_preview,"extract","No bounded embedded JPEG preview");
  int error=0;
  std::unique_ptr<libraw_processed_image_t,decltype(&LibRaw::dcraw_clear_mem)> image(raw->dcraw_make_mem_thumb(&error),LibRaw::dcraw_clear_mem);
  control.check("extract");
  if(!image||error||image->type!=LIBRAW_IMAGE_JPEG||!image->data_size||image->data_size>32U*1024*1024+65536)
    fail(ErrorCode::invalid_raw_preview,"extract","Preview preparation failed");
  return {{image->data,image->data+image->data_size},orientation[flip]};
}
} // namespace
Result canonicalize(const VerifiedSource& source,Bytes profile,const Control& control) {
 try {
  control.check("admission");
  // Upstream 2.19.1 keeps LCMS_VERSION=2190. Exact patch identity is archive-locked.
  if(cmsGetEncodedCMMversion()!=2190||LIBJPEG_TURBO_VERSION_NUMBER!=3001004 ||
     LibRaw::versionNumber()!=LIBRAW_MAKE_VERSION(0,22,2))
    fail(ErrorCode::dependency_gate_blocked,"dependency","Dependency version mismatch");
  if(sha256(profile)!=profile_hash)fail(ErrorCode::dependency_gate_blocked,"dependency","Fixed ICC hash mismatch");
  validate_profile(profile);
  const int rounding=std::fegetround();
  if(rounding!=FE_TONEAREST)fail(ErrorCode::dependency_gate_blocked,"dependency","Non-reference floating environment");
  Result result;auto& receipt=result.provenance;
  receipt.contract_sha256=V2_CONTRACT_SHA;receipt.source_sha256=source.hash();
  receipt.decoder_version="canonical-decoder-v2.0.0-experimental";
  receipt.jpeg_version="3.1.4.1-reference-no-simd";receipt.color_version="2.19.1";
  receipt.output_profile_sha256=profile_hash;
  auto bytes=source.bytes();Preview preview;
  if(!starts(bytes,"\xff\xd8",2)) {
    preview=extract(bytes,control);bytes=preview.jpeg;receipt.prepared_preview_sha256=sha256(bytes);
  } else if(bytes.size()>128ULL*1024*1024)fail(ErrorCode::limit_exceeded,"decode","JPEG exceeds 128 MiB");
  receipt.jpeg_input_sha256=sha256(bytes);
  receipt.stages.push_back({"prepared-jpeg",preview.jpeg.empty()?"direct-v1":"libraw-0.22.2-preview-v1",receipt.jpeg_input_sha256,0,0});
  auto metadata=parse_jpeg(bytes);
  if(preview.orientation&&metadata.orientation&&metadata.orientation!=preview.orientation)
    fail(ErrorCode::invalid_orientation,"metadata","Preview/container orientation conflict");
  result.source_orientation=metadata.orientation?metadata.orientation:preview.orientation?preview.orientation:1;
  auto rgb=decode_jpeg(bytes,control);
  receipt.stages.push_back({"decoded-rgb","jpeg-3.1.4.1-islow-fancy",sha256(rgb.bytes),rgb.width,rgb.height});
  if(metadata.icc.empty()&&metadata.other_space)fail(ErrorCode::profile_required,"color","Non-sRGB source lacks profile");
  const Bytes input=metadata.icc.empty()?profile:Bytes(metadata.icc);
  receipt.input_profile_sha256=sha256(input);
  const bool identity=receipt.input_profile_sha256==profile_hash;
  result.profile_policy=metadata.icc.empty()?"assumed_srgb_missing_icc":identity?"embedded_identity":"embedded_transform";
  auto normalized=color(rgb,input,profile,identity,control);
  receipt.stages.push_back({"color-rgba","lcms-2.19.1-relative-0x04000140",sha256(normalized.bytes),normalized.width,normalized.height});
  auto resized=resize(normalized,control);
  receipt.stages.push_back({"resized-rgba",resize_version,sha256(resized.bytes),resized.width,resized.height});
  auto upright=orient(resized,result.source_orientation,control);
  receipt.canonical_output_sha256=sha256(upright.bytes);receipt.canonical_tensor_sha256=tensor_hash(upright);
  receipt.stages.push_back({"oriented-rgba",orientation_version,receipt.canonical_output_sha256,upright.width,upright.height});
  if(sha256(source.bytes())!=source.hash())fail(ErrorCode::source_changed,"seal","Snapshot changed during decoding");
  control.check("seal");result.canonical=std::move(upright);return result;
 }catch(const std::bad_alloc&){fail(ErrorCode::resource_exhausted,"canonicalize","Allocation failed");}
}
} // namespace lenslabs::canonical_v2
