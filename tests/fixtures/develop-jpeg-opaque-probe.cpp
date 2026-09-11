#include <CoreGraphics/CoreGraphics.h>
#include <ImageIO/ImageIO.h>
#include <atomic>
#include <exception>
#include <iostream>
#include <limits>
#include <string>
#include <thread>

namespace {
struct ProviderObservation {
  const void* data=nullptr;
  std::size_t size=0,calls=0;
  void* info=nullptr;
  CGDataProviderReleaseDataCallback release=nullptr;
};
thread_local ProviderObservation observed;
CGDataProviderRef observe_provider(void* info,const void* data,std::size_t size,CGDataProviderReleaseDataCallback release) {
  observed={data,size,observed.calls+1,info,release};
  return CGDataProviderCreateWithData(info,data,size,release);
}
}

// Include the real implementation, with only its provider call observed. This
// keeps production internals private and proves actual ImageIO input ownership.
// The override also permits a scratch pre-edit TU to run the same regression.
#define CGDataProviderCreateWithData observe_provider
#ifndef FOTO_JPEG_IMPLEMENTATION
#define FOTO_JPEG_IMPLEMENTATION "../../native/src/decode_mac.cpp"
#endif
#include FOTO_JPEG_IMPLEMENTATION
#undef CGDataProviderCreateWithData
#ifndef FOTO_JPEG_HAS_HIGH_RESOLUTION
#define FOTO_JPEG_HAS_HIGH_RESOLUTION 0
#endif

namespace lenslabs {
// Independent literal encoder from before the opaque fast path. The provider
// observation does not alter its pointer, callback, bytes, flags or lifetime.
static std::vector<std::uint8_t> legacy_encode_image(const Image& image, double quality, bool high_resolution) {
  if (!std::isfinite(quality) || quality < 0 || quality > 1)
    throw std::invalid_argument("JPEG quality must be finite and between 0 and 1.");
#if FOTO_JPEG_HAS_HIGH_RESOLUTION
  const auto required = rgba_size(image.width, image.height, high_resolution);
#else
  (void)high_resolution;
  const auto required = rgba_size(image.width, image.height);
#endif
  if (image.rgba.size() != required)
    throw std::invalid_argument("JPEG input must contain exactly width * height * 4 RGBA bytes.");
  auto opaque = image.rgba;
  for (std::size_t i = 0; i < opaque.size(); i += 4) {
    const auto alpha = static_cast<unsigned>(opaque[i + 3]);
    for (std::size_t channel = 0; channel < 3; ++channel)
      opaque[i + channel] = static_cast<std::uint8_t>(
          (static_cast<unsigned>(opaque[i + channel]) * alpha + 255U * (255U - alpha) + 127U) / 255U);
    opaque[i + 3] = 255;
  }
  CFHandle<CGColorSpaceRef> color_space(CGColorSpaceCreateWithName(kCGColorSpaceSRGB));
  CFHandle<CGDataProviderRef> provider(observe_provider(nullptr, opaque.data(), opaque.size(), nullptr));
  if (!color_space || !provider) throw std::runtime_error("Could not allocate JPEG color data.");
  CFHandle<CGImageRef> source(CGImageCreate(image.width, image.height, 8, 32,
      static_cast<std::size_t>(image.width) * 4, color_space.get(),
      kCGBitmapByteOrder32Big | static_cast<CGBitmapInfo>(kCGImageAlphaLast), provider.get(), nullptr, false, kCGRenderingIntentDefault));
  if (!source) throw std::runtime_error("Could not create the bounded JPEG source image.");
  CFHandle<CFMutableDataRef> data(CFDataCreateMutable(kCFAllocatorDefault, 0));
  if (!data) throw std::runtime_error("Could not allocate JPEG output memory.");
  CFHandle<CGImageDestinationRef> destination(CGImageDestinationCreateWithData(data.get(), CFSTR("public.jpeg"), 1, nullptr));
  if (!destination) throw std::runtime_error("The system JPEG encoder is unavailable.");
  const std::int32_t upright = 1;
  CFHandle<CFNumberRef> quality_value(CFNumberCreate(kCFAllocatorDefault, kCFNumberDoubleType, &quality));
  CFHandle<CFNumberRef> orientation_value(CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &upright));
  if (!quality_value || !orientation_value) throw std::runtime_error("Could not allocate JPEG encoding options.");
  auto properties = dictionary();
  CFDictionarySetValue(properties.get(), kCGImageDestinationLossyCompressionQuality, quality_value.get());
  CFDictionarySetValue(properties.get(), kCGImagePropertyOrientation, orientation_value.get());
  CGImageDestinationAddImage(destination.get(), source.get(), properties.get());
  if (!CGImageDestinationFinalize(destination.get())) throw std::runtime_error("JPEG encoding failed; no file was written.");
  const auto length = CFDataGetLength(data.get());
  if (length <= 0 || static_cast<std::uint64_t>(length) > 128ULL * 1024 * 1024)
    throw std::runtime_error("JPEG output is empty or exceeds the bounded output limit.");
  const auto* bytes = CFDataGetBytePtr(data.get());
  return {bytes, bytes + static_cast<std::size_t>(length)};
}
}

namespace {
std::atomic<std::uint64_t> cases=0,opaque_cases=0,composited_cases=0,invalid_cases=0;
std::atomic<std::uint64_t> standard_cases=0,develop_cases=0;
void require(bool condition,const char* message) {if(!condition)throw std::runtime_error(message);}
std::vector<std::uint8_t> actual_encode(const lenslabs::Image& image,double quality,bool high_resolution) {
#if FOTO_JPEG_HAS_HIGH_RESOLUTION
  if(high_resolution)return lenslabs::encode_develop_jpeg(image,quality);
#else
  (void)high_resolution;
#endif
  return lenslabs::encode_jpeg(image,quality);
}
lenslabs::Image fixture(unsigned width,unsigned height) {
  lenslabs::Image image{width,height,width+10,height+20,{}};
  image.rgba.resize(std::size_t(width)*height*4);
  for(unsigned y=0;y<height;++y)for(unsigned x=0;x<width;++x) {
    const auto at=(std::size_t(y)*width+x)*4;
    image.rgba[at]=std::uint8_t(x);image.rgba[at+1]=std::uint8_t(255-x);
    image.rgba[at+2]=std::uint8_t(x^128);image.rgba[at+3]=255;
  }
  return image;
}
void check(const lenslabs::Image& image,double quality,bool high_resolution,bool legacy_control=false) {
  const auto original=image.rgba;
  const auto expected=lenslabs::legacy_encode_image(image,quality,high_resolution);
  bool opaque=true;
  for(std::size_t i=3;i<original.size();i+=4)opaque=opaque&&original[i]==255;
  observed={};
  const auto actual=legacy_control ? lenslabs::legacy_encode_image(image,quality,high_resolution) :
    actual_encode(image,quality,high_resolution);
  require(actual==expected,"JPEG_BYTES_CHANGED");
  require(image.rgba==original,"SOURCE_RGBA_CHANGED");
  require(observed.calls==1&&observed.size==original.size(),"INVALID_PROVIDER_BUFFER");
  require(observed.info==nullptr&&observed.release==nullptr,"PROVIDER_OWNERSHIP_CHANGED");
  if(opaque) {
    // This structural assertion FAILS the old encoder even when every JPEG
    // byte matches: the original allocated a separate full-frame pixel copy.
    require(observed.data==image.rgba.data(),"OPAQUE_INPUT_WAS_COPIED");
    ++opaque_cases;
  } else {
    require(observed.data!=image.rgba.data(),"TRANSPARENCY_WAS_NOT_COMPOSITED");
    ++composited_cases;
  }
#if FOTO_JPEG_HAS_HIGH_RESOLUTION
  if(high_resolution)++develop_cases;else ++standard_cases;
#else
  ++standard_cases;
#endif
  ++cases;
}
void invalid(const lenslabs::Image& image,double quality,bool high_resolution) {
  const auto original=image.rgba;
  std::string expected,actual;
  try{lenslabs::legacy_encode_image(image,quality,high_resolution);}catch(const std::invalid_argument& error){expected=error.what();}
  observed={};
  try{actual_encode(image,quality,high_resolution);}catch(const std::invalid_argument& error){actual=error.what();}
  require(!expected.empty()&&actual==expected,"INVALID_ADMISSION_CHANGED");
  require(observed.calls==0,"INVALID_INPUT_REACHED_PROVIDER");
  require(image.rgba==original,"INVALID_SOURCE_CHANGED");
  ++invalid_cases;
}
}

int main(int argc,char**argv) {try {
  if(argc==2&&std::string(argv[1])=="--legacy-control") {
    check(fixture(17,19),.95,false,true);
    throw std::runtime_error("LEGACY_CONTROL_UNEXPECTEDLY_BORROWED_INPUT");
  }
  for(const auto size:std::array<std::array<unsigned,2>,7>{{{1,1},{1,17},{17,1},{17,19},{127,65},{256,256},{4096,1}}})
    for(double quality:{0.,.5,.95,1.})for(bool high_resolution:{false,true}) {
      auto image=fixture(size[0],size[1]);
      check(image,quality,high_resolution);
      const auto count=std::size_t(image.width)*image.height;
      for(const auto pixel:{std::size_t(0),count/2,count-1})for(unsigned alpha:{0u,1u,127u,128u,254u}) {
        image.rgba[pixel*4+3]=std::uint8_t(alpha);check(image,quality,high_resolution);image.rgba[pixel*4+3]=255;
      }
      for(std::size_t at=3;at<image.rgba.size();at+=4)image.rgba[at]=0;
      check(image,quality,high_resolution);
      // At 256x256 this covers every channel code paired with every alpha.
      for(unsigned y=0;y<image.height;++y)for(unsigned x=0;x<image.width;++x)
        image.rgba[(std::size_t(y)*image.width+x)*4+3]=std::uint8_t(y);
      check(image,quality,high_resolution);
    }
  const auto repeated=fixture(65,31);
  for(unsigned n=0;n<8;++n)check(repeated,.93,n%2);
  const auto shared=fixture(63,35);
  std::array<std::exception_ptr,4> errors{};
  std::array<std::thread,4> threads;
  for(unsigned thread=0;thread<threads.size();++thread)threads[thread]=std::thread([&,thread] {
    try {
      auto own=fixture(33+thread,33);own.rgba.back()=254;
      for(unsigned repeat=0;repeat<3;++repeat){check(shared,.95,repeat%2);check(own,.95,repeat%2);}
    }catch(...){errors[thread]=std::current_exception();}
  });
  for(auto& thread:threads)thread.join();
  for(const auto& error:errors)if(error)std::rethrow_exception(error);
  for(bool high_resolution:{false,true}) {
    for(double quality:{-.1,1.1,std::numeric_limits<double>::quiet_NaN(),std::numeric_limits<double>::infinity(),-std::numeric_limits<double>::infinity()})
      invalid(fixture(2,3),quality,high_resolution);
    for(const auto size:std::array<std::array<unsigned,2>,6>{{{0,1},{1,0},{0,0},{UINT32_MAX,1},{1,UINT32_MAX},{UINT32_MAX,UINT32_MAX}}})
      invalid(lenslabs::Image{size[0],size[1],0,0,{}},.95,high_resolution);
    for(unsigned length:{0u,23u,25u}) {
      auto malformed=fixture(2,3);malformed.rgba.resize(length);invalid(malformed,.95,high_resolution);
    }
  }
  std::cout<<"{\"cases\":"<<cases<<",\"opaqueCases\":"<<opaque_cases<<",\"compositedCases\":"<<composited_cases<<",\"invalidCases\":"<<invalid_cases<<",\"concurrentCases\":24,\"wrapperCoverage\":{\"encode_jpeg\":"<<standard_cases;
#if FOTO_JPEG_HAS_HIGH_RESOLUTION
  std::cout<<",\"encode_develop_jpeg\":"<<develop_cases;
#endif
  std::cout<<"},\"exact\":true,\"sourcePreserved\":true,\"borrowedOpaqueInput\":true}\n";
  return 0;
}catch(const std::exception&error){std::cerr<<error.what()<<'\n';return 1;}}
