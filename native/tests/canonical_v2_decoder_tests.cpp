#include "lenslabs/canonical_v2.hpp"
#include <cstdio>
#include <cstdlib>
#include <fcntl.h>
#include <iostream>
#include <jpeglib.h>
#include <unistd.h>

using namespace lenslabs::canonical_v2;
namespace {
struct Fixture {
  char path[64]="/tmp/celinen-v2-decoder-test-XXXXXX";
  int fd=mkstemp(path);
  ~Fixture(){if(fd>=0)close(fd);unlink(path);}
  VerifiedSource source(const std::vector<std::uint8_t>& b,const Control& c) {
    if(fd<0||ftruncate(fd,0))throw std::runtime_error("fixture init");
    std::size_t n=0;while(n<b.size()) {
      const auto w=pwrite(fd,b.data()+n,b.size()-n,n);if(w<=0)throw std::runtime_error("fixture write");n+=w;
    }
    return verify_source(path,c);
  }
};
std::vector<std::uint8_t> jpeg(bool gray,bool progressive,int sampling) {
  jpeg_compress_struct c{};jpeg_error_mgr error{};c.err=jpeg_std_error(&error);
  jpeg_create_compress(&c);unsigned char* out=nullptr;unsigned long size=0;
  jpeg_mem_dest(&c,&out,&size);c.image_width=31;c.image_height=19;
  c.input_components=gray?1:3;c.in_color_space=gray?JCS_GRAYSCALE:JCS_RGB;
  jpeg_set_defaults(&c);jpeg_set_quality(&c,90,TRUE);
  if(!gray){c.comp_info[0].h_samp_factor=sampling?2:1;c.comp_info[0].v_samp_factor=sampling==2?2:1;}
  if(progressive)jpeg_simple_progression(&c);
  jpeg_start_compress(&c,TRUE);
  std::vector<std::uint8_t> row(31*(gray?1:3));
  while(c.next_scanline<c.image_height) {
    for(std::size_t i=0;i<row.size();++i)row[i]=static_cast<std::uint8_t>(i*3+c.next_scanline);
    JSAMPROW p=row.data();jpeg_write_scanlines(&c,&p,1);
  }
  jpeg_finish_compress(&c);std::vector<std::uint8_t> result(out,out+size);free(out);jpeg_destroy_compress(&c);return result;
}
}
int main(int argc,char** argv) {
 if(argc!=2)return 2;
 try {
  Control control(true);const auto fixed=verify_source(argv[1],control);Fixture fixture;unsigned passed=0;
  for(bool gray:{false,true})for(bool progressive:{false,true})for(int sampling=0;sampling<3;++sampling) {
    const auto bytes=jpeg(gray,progressive,sampling);const auto source=fixture.source(bytes,control);
    const auto out=canonicalize(source,fixed.bytes(),control);
    if(out.canonical.width!=31||out.canonical.height!=19||out.provenance.qualified||out.provenance.source_sha256!=sha256(bytes))
      throw std::runtime_error("JPEG contract");
    validate_rgba(out.canonical);++passed;
  }
  auto bytes=jpeg(false,false,2);auto source=fixture.source(bytes,control);
  auto badProfile=std::vector<std::uint8_t>(fixed.bytes().begin(),fixed.bytes().end());badProfile.back()^=1;
  try{canonicalize(source,badProfile,control);throw std::runtime_error("bad profile accepted");}
  catch(const Error& e){if(e.code!=ErrorCode::dependency_gate_blocked)throw;++passed;}
  // Empty ICC must not enter the missing-profile fallback.
  const std::vector<std::uint8_t> emptyIcc={255,226,0,16,'I','C','C','_','P','R','O','F','I','L','E',0,1,1};
  bytes.insert(bytes.begin()+2,emptyIcc.begin(),emptyIcc.end());
  source=fixture.source(bytes,control);
  try{canonicalize(source,fixed.bytes(),control);throw std::runtime_error("empty ICC accepted");}
  catch(const Error& e){if(e.code!=ErrorCode::invalid_icc)throw;++passed;}
  std::uint32_t random=0x91abc234;
  unsigned errors=0,successful=0;
  // Bounded malformed-marker corpus, not a performance or camera-coverage corpus.
  // Mutations never allocate an unbounded source; sanitizer findings abort the run.
  const auto seed=jpeg(false,true,2);
  for(unsigned trial=0;trial<10000;++trial) {
    random=random*1664525+1013904223;
    std::vector<std::uint8_t> mutated(seed.begin(),seed.begin()+std::min<std::size_t>(seed.size(),2+random%200));
    random=random*1664525+1013904223;
    if(mutated.size()>2)mutated[2+random%(mutated.size()-2)]^=static_cast<std::uint8_t>(1+(random>>24));
    const auto input=fixture.source(mutated,control);
    try{const auto result=canonicalize(input,fixed.bytes(),control);validate_rgba(result.canonical);++successful;}
    catch(const Error&){++errors;}
  }
  std::cout<<"PASS "<<passed<<" decoder contract cases; 10000 bounded mutations: "<<errors<<" typed errors, "<<successful<<" complete outputs\n";
  return 0;
 }catch(const std::exception& e){std::cerr<<"FAIL "<<e.what()<<'\n';return 1;}
}
