// Native-only regression probe. No JPEG encoder, source writes or recipe changes.
// FOTO_WB_BASELINE_ONLY builds against the previous five-argument implementation
// to capture independent legacy goldens with the pinned LibRaw/toolchain.
#include "lenslabs/develop.hpp"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iomanip>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>

namespace {
using lenslabs::Image;
#ifndef FOTO_WB_BASELINE_ONLY
bool same(const Image& a,const Image& b) {
  return a.width==b.width&&a.height==b.height&&a.source_width==b.source_width&&
    a.source_height==b.source_height&&a.rgba==b.rgba;
}
#endif
std::uint64_t hash(const Image& image) {
  // Non-security pixel checksum; source preservation uses SHA-256 in the test.
  std::uint64_t value=14695981039346656037ULL;
  for(auto channel:image.rgba) {value^=channel;value*=1099511628211ULL;}
  return value;
}
void measure(const Image& base,const Image& image) {
  if(image.width!=base.width||image.height!=base.height||image.rgba.size()!=base.rgba.size())
    throw std::runtime_error("Unexpected decode dimensions.");
  double sum=0;unsigned maximum=0;bool alpha=true;
  for(std::size_t i=0;i<image.rgba.size();i+=4) {
    for(int c=0;c<3;++c) {
      const unsigned delta=unsigned(std::abs(int(image.rgba[i+c])-int(base.rgba[i+c])));
      sum+=delta;maximum=std::max(maximum,delta);
    }
    alpha&=image.rgba[i+3]==255&&base.rgba[i+3]==255;
  }
  std::cout<<",\"mae\":"<<sum/(image.width*image.height*3)<<",\"maximum\":"<<maximum
    <<",\"alphaPreserved\":"<<(alpha?"true":"false");
}
#ifndef FOTO_WB_BASELINE_ONLY
void invalid_arguments() {
  using Model=lenslabs::RawWhiteBalanceModel;
  unsigned count=0;
  const auto reject=[&](double exposure,double temperature,double tint,Model model,const char* message) {
    try {lenslabs::decode_raw_develop("/not-a-foto-source",128,exposure,temperature,tint,model);}
    catch(const std::invalid_argument& error) {
      if(error.what()!=std::string(message)) throw;
      ++count;return;
    }
    throw std::runtime_error("Invalid controls reached source access or decoded.");
  };
  for(int invalid:{-1,2,100})reject(0,0,0,static_cast<Model>(invalid),"Invalid RAW white-balance model.");
  for(auto model:{Model::legacy,Model::resolved}) {
    for(double invalid:{std::numeric_limits<double>::quiet_NaN(),
        std::numeric_limits<double>::infinity(),-std::numeric_limits<double>::infinity(),101.,-101.}) {
      reject(invalid,0,0,model,"Invalid RAW develop controls.");
      reject(0,invalid,0,model,"Invalid RAW develop controls.");
      reject(0,0,invalid,model,"Invalid RAW develop controls.");
    }
    reject(5.01,0,0,model,"Invalid RAW develop controls.");
    reject(-5.01,0,0,model,"Invalid RAW develop controls.");
  }
  std::cout<<"{\"rejectedBeforeSourceAccess\":"<<count<<"}\n";
}
void reject_fixture(const char* path,const char* expected) {
  // Repeated exceptions must unwind LibRaw's allocations; sanitizer runs use
  // this same path, not a mocked arithmetic helper.
  for(int attempt=0;attempt<3;++attempt) {
    try {lenslabs::decode_raw_develop(path,128,0,.1,0,lenslabs::RawWhiteBalanceModel::resolved);}
    catch(const std::runtime_error& error) {
      if(error.what()!=std::string(expected)) throw;
      continue;
    }
    throw std::runtime_error("Unsupported baseline produced a rendered image.");
  }
  std::cout<<"{\"rejectedWithoutImage\":3}\n";
}
#endif
} // namespace

int main(int argc,char** argv) {
  try {
#ifndef FOTO_WB_BASELINE_ONLY
    if(argc==4&&std::string(argv[1])=="--reject") {reject_fixture(argv[2],argv[3]);return 0;}
    if(argc==3&&std::string(argv[1])=="--neutral") {
      const auto legacy=lenslabs::decode_raw_develop(argv[2],128,0,0,0);
      const auto resolved=lenslabs::decode_raw_develop(argv[2],128,0,0,0,lenslabs::RawWhiteBalanceModel::resolved);
      if(!same(legacy,resolved))throw std::runtime_error("Neutral appearance changed.");
      std::cout<<"{\"neutralExact\":true}\n";return 0;
    }
#endif
    if(argc!=2)return 2;
#ifndef FOTO_WB_BASELINE_ONLY
    if(std::string(argv[1])=="--invalid") {invalid_arguments();return 0;}
#endif
    std::cout<<std::setprecision(12);
    constexpr double controls[][2]={{0,0},{-0.,-0.},{-1e-6,0},{1e-6,0},{0,-1e-6},{0,1e-6},
      {-.1,0},{.1,0},{0,-.1},{0,.1},{-100,0},{100,0},{0,-100},{0,100},{-50,50},{50,-50}};
    for(double exposure:{-5.,0.,5.}) {
      const auto neutral=lenslabs::decode_raw_develop(argv[1],128,exposure,0,0);
      for(const auto& control:controls) {
        const auto legacy=lenslabs::decode_raw_develop(argv[1],128,exposure,control[0],control[1]);
        std::cout<<"{\"exposure\":"<<exposure<<",\"temperature\":"<<control[0]<<",\"tint\":"<<control[1]
          <<",\"width\":"<<legacy.width<<",\"height\":"<<legacy.height<<",\"legacyHash\":\""
          <<std::hex<<hash(legacy)<<std::dec<<"\"";
#ifndef FOTO_WB_BASELINE_ONLY
        const auto explicit_legacy=lenslabs::decode_raw_develop(argv[1],128,exposure,control[0],control[1],lenslabs::RawWhiteBalanceModel::legacy);
        const auto resolved=lenslabs::decode_raw_develop(argv[1],128,exposure,control[0],control[1],lenslabs::RawWhiteBalanceModel::resolved);
        std::cout<<",\"legacyExact\":"<<(same(legacy,explicit_legacy)?"true":"false");
        measure(neutral,resolved);
#else
        measure(neutral,legacy);
#endif
        std::cout<<"}\n";
      }
    }
    return 0;
  } catch(const std::exception& error) {std::cerr<<error.what()<<'\n';return 1;}
}
