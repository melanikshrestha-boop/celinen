#include "lenslabs/develop.hpp"
#include <libraw/libraw.h>
#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cmath>
#include <fcntl.h>
#include <limits>
#include <memory>
#include <stdexcept>
#include <sys/stat.h>
#include <unistd.h>

namespace lenslabs {
namespace {
constexpr std::uint64_t max_raw_bytes = 128ULL * 1024 * 1024;
constexpr std::uint64_t max_sensor_pixels = 60000000;
class Descriptor {
 public:
  explicit Descriptor(int fd): fd_(fd) {}
  ~Descriptor() { if(fd_>=0) close(fd_); }
  Descriptor(const Descriptor&)=delete;
  int get()const {return fd_;}
 private:int fd_;
};
bool same(const struct stat& a,const struct stat& b) {
  return a.st_dev==b.st_dev && a.st_ino==b.st_ino && a.st_size==b.st_size &&
    a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec && a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec &&
    a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec && a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec;
}
// Own one bounded snapshot: LibRaw never reopens a client-supplied path and never mmaps a changing file.
std::vector<unsigned char> read_snapshot(const std::filesystem::path& path) {
  const auto text=path.native();
  if(text.empty()||text.find('\0')!=std::string::npos) throw std::invalid_argument("Invalid RAW path.");
  Descriptor fd(open(text.c_str(),O_RDONLY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK));
  struct stat before{};
  if(fd.get()<0||fstat(fd.get(),&before)!=0||!S_ISREG(before.st_mode)||before.st_size<=0||std::uint64_t(before.st_size)>max_raw_bytes)
    throw std::invalid_argument("RAW source must be a regular file under 128 MiB; symlinks are not accepted.");
  std::vector<unsigned char> bytes(std::size_t(before.st_size));
  std::size_t pos=0;
  while(pos<bytes.size()) {
    const auto got=pread(fd.get(),bytes.data()+pos,bytes.size()-pos,static_cast<off_t>(pos));
    if(got<0 && errno==EINTR) continue;
    if(got<=0) throw std::runtime_error("RAW source became unreadable.");
    pos+=std::size_t(got);
  }
  struct stat after{};
  if(fstat(fd.get(),&after)!=0||!same(before,after)) throw std::runtime_error("RAW source changed while reading; retry the original.");
  return bytes;
}
void success(int code,bool corrupted) {
  if(code!=LIBRAW_SUCCESS||corrupted) throw std::runtime_error("Sensor RAW processing failed. No preview fallback was used.");
}
// LibRaw 0.22.2 resolves camera/automatic/white-patch/sRAW WB inside
// scale_colors(), before this protected virtual hotspot scales/clips sensor
// samples. Reuse that resolved baseline instead of estimating it again or
// switching to daylight when a relative adjustment becomes nonzero.
class ResolvedWhiteBalance final : public LibRaw {
 public:
  ResolvedWhiteBalance(double temperature,double tint):temperature_(temperature),tint_(tint) {}
  bool adjustment_applied()const {return applications_==1;}
 protected:
  void scale_colors_loop(float scale_mul[4]) override {
    if(temperature_==0&&tint_==0) {
      LibRaw::scale_colors_loop(scale_mul);
      return;
    }
    const auto& id=imgdata.idata;
    const bool rgb=(id.colors==3||id.colors==4)&&id.cdesc[0]=='R'&&
      id.cdesc[1]=='G'&&id.cdesc[2]=='B'&&
      (id.cdesc[3]=='G'||(id.colors==3&&id.cdesc[3]=='\0'));
    if(!rgb||applications_!=0)
      throw std::runtime_error("Resolved relative RAW white balance requires an RGB/RGBG sensor pipeline.");
    auto& color=imgdata.color;
    // scale_colors() falls back to unit scales if its baseline anchor is too
    // small or invalid. In the normalized path the anchor is exactly 1: LibRaw
    // divides that float by itself. Never reinterpret fallback coefficients as
    // a successfully resolved baseline when an adjustment is requested.
    const float baseline_anchor=imgdata.params.highlight ?
      *std::max_element(color.pre_mul,color.pre_mul+4) :
      *std::min_element(color.pre_mul,color.pre_mul+4);
    if(baseline_anchor!=1.f)
      throw std::runtime_error("RAW white-balance baseline could not be normalized. No fallback adjustment was used.");
    std::array<double,4> adjusted{};
    for(int c=0;c<4;++c) {
      const double baseline=color.pre_mul[c];
      if(!std::isfinite(baseline)||baseline<=0)
        throw std::runtime_error("RAW white-balance baseline is unavailable. No daylight fallback was used.");
      adjusted[c]=baseline*std::exp2(c==0 ? temperature_*.0035+tint_*.001 : c==2 ? -temperature_*.0035+tint_*.001 : -tint_*.002);
      if(!std::isfinite(adjusted[c])||adjusted[c]<=0)
        throw std::runtime_error("RAW white-balance adjustment exceeds the supported range.");
    }
    // Keep LibRaw's normalization policy. Its current Develop highlight mode
    // uses the minimum multiplier; other modes use the maximum. The baseline
    // and maximum have already received LibRaw's black-level corrections.
    const double normalizer=imgdata.params.highlight ?
      *std::max_element(adjusted.begin(),adjusted.end()) :
      *std::min_element(adjusted.begin(),adjusted.end());
    if(!std::isfinite(normalizer)||normalizer<=0||color.maximum==0)
      throw std::runtime_error("RAW white-balance normalization is unavailable.");
    std::array<float,4> normalized{},scales{};
    // LibRaw's hotspot converts float(sample * scale) to int before clipping.
    // Finite does not mean representable. Include the worst remaining per-CFA
    // and tiled black subtraction, without scanning/copying the sensor image.
    std::uint64_t tiled_black=0;
    if(color.cblack[4]&&color.cblack[5]) {
      const auto count=std::uint64_t(color.cblack[4])*color.cblack[5];
      if(count>LIBRAW_CBLACK_SIZE-6)
        throw std::runtime_error("RAW black-level pattern exceeds its supported bounds.");
      for(std::uint64_t i=0;i<count;++i) tiled_black=std::max(tiled_black,std::uint64_t(color.cblack[6+i]));
    }
    const float safe_int_limit=std::nextafter(float(std::numeric_limits<int>::max()),0.f);
    for(int c=0;c<4;++c) {
      normalized[c]=float(adjusted[c]/normalizer);
      scales[c]=normalized[c]*65535.f/color.maximum;
      if(!std::isfinite(normalized[c])||normalized[c]<=0||!std::isfinite(scales[c])||scales[c]<=0)
        throw std::runtime_error("RAW white-balance normalization exceeds the supported range.");
      const auto black_bound=tiled_black+std::uint64_t(color.cblack[c]);
      const auto sample_bound=std::max(std::uint64_t(65535),black_bound);
      const float scaled_bound=float(sample_bound)*scales[c];
      if(black_bound>std::uint64_t(std::numeric_limits<int>::max())||
          !std::isfinite(scaled_bound)||scaled_bound>safe_int_limit)
        throw std::runtime_error("RAW white-balance scale exceeds the safe sensor arithmetic range.");
    }
    for(int c=0;c<4;++c) {color.pre_mul[c]=normalized[c];scale_mul[c]=scales[c];}
    ++applications_;
    LibRaw::scale_colors_loop(scale_mul);
  }
 private:
  double temperature_,tint_;
  unsigned applications_=0;
};
} // namespace
Image decode_raw_develop(const std::filesystem::path& path,std::uint32_t max_edge,double exposure,double temperature,double tint) {
  return decode_raw_develop(path,max_edge,exposure,temperature,tint,RawWhiteBalanceModel::legacy);
}
Image decode_raw_develop(const std::filesystem::path& path,std::uint32_t max_edge,double exposure,double temperature,double tint,RawWhiteBalanceModel white_balance_model) {
  if(white_balance_model!=RawWhiteBalanceModel::legacy&&white_balance_model!=RawWhiteBalanceModel::resolved)
    throw std::invalid_argument("Invalid RAW white-balance model.");
  if(max_edge<32||max_edge>4096||!std::isfinite(exposure)||exposure < -5||exposure>5||!std::isfinite(temperature)||std::abs(temperature)>100||!std::isfinite(tint)||std::abs(tint)>100)
    throw std::invalid_argument("Invalid RAW develop controls.");
  auto bytes=read_snapshot(path);
  std::unique_ptr<LibRaw> processor;
  ResolvedWhiteBalance* resolved=nullptr;
  if(white_balance_model==RawWhiteBalanceModel::resolved) {
    auto selected=std::make_unique<ResolvedWhiteBalance>(temperature,tint);
    resolved=selected.get();processor=std::move(selected);
  } else processor=std::make_unique<LibRaw>();
  auto& raw=*processor;
  bool corrupted=false;
  raw.set_dataerror_handler([](void* value,const char*,INT64){*static_cast<bool*>(value)=true;},&corrupted);
  const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(55);
  raw.set_progress_handler([](void* value,LibRaw_progress,int,int){return std::chrono::steady_clock::now()>*static_cast<const std::chrono::steady_clock::time_point*>(value)?1:0;},const_cast<std::chrono::steady_clock::time_point*>(&deadline));
  raw.imgdata.rawparams.max_raw_memory_mb=512;
  success(raw.open_buffer(bytes.data(),bytes.size()),corrupted);
  const auto sizes=raw.imgdata.sizes;
  const auto sensor_pixels=std::uint64_t(sizes.raw_width)*sizes.raw_height;
  const auto active_pixels=std::uint64_t(sizes.width)*sizes.height;
  if(!sensor_pixels||!active_pixels||sensor_pixels>max_sensor_pixels||active_pixels>max_sensor_pixels||sizes.flip<0||sizes.flip>7||raw.imgdata.idata.raw_count<1)
    throw std::invalid_argument("RAW sensor exceeds the 60-million-pixel processing bound.");
  auto& p=raw.imgdata.params;
  p.output_color=1; p.output_bps=8; p.use_camera_wb=1; p.use_auto_wb=0; p.use_camera_matrix=1;
  p.no_auto_bright=1; p.half_size=0; p.user_qual=3; p.user_flip=-1;
  p.gamm[0]=1/2.4; p.gamm[1]=12.92;
  p.bright=float(std::exp2(exposure));
  // Relative warm/cool and green/magenta multipliers, applied to camera (or daylight) WB before demosaic.
  if(white_balance_model==RawWhiteBalanceModel::legacy&&(temperature!=0||tint!=0)) {
    const auto& color=raw.imgdata.color;
    bool camera_wb=true;
    for(int c=0;c<3;++c) camera_wb &= std::isfinite(color.cam_mul[c])&&color.cam_mul[c]>0;
    for(int c=0;c<4;++c) {
      double multiplier=camera_wb ? color.cam_mul[c] : color.pre_mul[c];
      if(!std::isfinite(multiplier)||multiplier<=0) multiplier=c==3?(camera_wb?color.cam_mul[1]:color.pre_mul[1]):1;
      if(!std::isfinite(multiplier)||multiplier<=0) multiplier=1;
      multiplier*=std::exp2(c==0 ? temperature*.0035+tint*.001 : c==2 ? -temperature*.0035+tint*.001 : -tint*.002);
      p.user_mul[c]=float(multiplier);
    }
    p.use_camera_wb=0;
  }
  success(raw.unpack(),corrupted);
  success(raw.dcraw_process(),corrupted);
  if(resolved&&(temperature!=0||tint!=0)&&!resolved->adjustment_applied())
    throw std::runtime_error("This RAW decoder cannot apply resolved relative white balance. No preview fallback was used.");
  int width=0,height=0,colors=0,bits=0;
  raw.get_mem_image_format(&width,&height,&colors,&bits);
  if(width<=0||height<=0||std::uint64_t(width)*height>max_sensor_pixels||colors!=3||bits!=8)
    throw std::runtime_error("LibRaw returned an unsupported or oversized RGB image.");
  int error=0;
  std::unique_ptr<libraw_processed_image_t,decltype(&LibRaw::dcraw_clear_mem)> rendered(raw.dcraw_make_mem_image(&error),LibRaw::dcraw_clear_mem);
  success(error,corrupted);
  if(!rendered||rendered->type!=LIBRAW_IMAGE_BITMAP||rendered->width!=width||rendered->height!=height||rendered->colors!=3||rendered->bits!=8||rendered->data_size!=std::size_t(width)*height*3)
    throw std::runtime_error("LibRaw returned an incomplete RGB image.");
  raw.recycle(); bytes.clear(); bytes.shrink_to_fit();
  const double ratio=std::min(1.0,double(max_edge)/std::max(width,height));
  Image result{std::max(1u,unsigned(std::round(width*ratio))),std::max(1u,unsigned(std::round(height*ratio))),unsigned(width),unsigned(height),{}};
  result.rgba.resize(std::size_t(result.width)*result.height*4);
  // Box resampling integrates sensor-derived RGB pixels rather than aliasing to nearest neighbours.
  for(unsigned y=0;y<result.height;++y) for(unsigned x=0;x<result.width;++x) {
    const double left=double(x)*width/result.width,right=double(x+1)*width/result.width;
    const double top=double(y)*height/result.height,bottom=double(y+1)*height/result.height;
    std::array<double,3> sum{};double total=0;
    for(int sy=int(top);sy<std::min(height,int(std::ceil(bottom)));++sy) for(int sx=int(left);sx<std::min(width,int(std::ceil(right)));++sx) {
      const double weight=(std::min(right,double(sx+1))-std::max(left,double(sx)))*(std::min(bottom,double(sy+1))-std::max(top,double(sy)));
      for(int c=0;c<3;++c) sum[c]+=rendered->data[(std::size_t(sy)*width+sx)*3+c]*weight;
      total+=weight;
    }
    const auto i=(std::size_t(y)*result.width+x)*4;
    for(int c=0;c<3;++c) result.rgba[i+c]=std::uint8_t(std::clamp(std::round(sum[c]/total),0.0,255.0));
    result.rgba[i+3]=255;
  }
  return result;
}
} // namespace lenslabs
