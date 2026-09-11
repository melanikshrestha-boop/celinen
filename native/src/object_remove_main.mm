#import <Foundation/NSObject.h>
#import <Foundation/NSArray.h>
#import <Foundation/NSDictionary.h>
#import <Foundation/NSIndexSet.h>
#import <Foundation/NSError.h>
#import <ImageIO/ImageIO.h>
#import <CoreGraphics/CoreGraphics.h>
#include "lenslabs/object_remove.hpp"
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

using CVPixelBufferRef = struct __CVBuffer*;
extern "C" {
std::uint32_t CVPixelBufferGetPixelFormatType(CVPixelBufferRef);
std::int32_t CVPixelBufferLockBaseAddress(CVPixelBufferRef,std::uint64_t);
std::int32_t CVPixelBufferUnlockBaseAddress(CVPixelBufferRef,std::uint64_t);
std::size_t CVPixelBufferGetWidth(CVPixelBufferRef);
std::size_t CVPixelBufferGetHeight(CVPixelBufferRef);
std::size_t CVPixelBufferGetBytesPerRow(CVPixelBufferRef);
void* CVPixelBufferGetBaseAddress(CVPixelBufferRef);
}
constexpr std::uint32_t kCVPixelFormatType_OneComponent8=0x4c303038;
constexpr std::uint64_t kCVPixelBufferLock_ReadOnly=1;
constexpr std::int32_t kCVReturnSuccess=0;

// Public Vision selectors, declared narrowly because the installed CLT SDK's
// Foundation umbrella imports a missing legacy Security header. No private API.
@interface VNInstanceMaskObservation : NSObject
@property (readonly) CVPixelBufferRef instanceMask;
@property (readonly,copy) NSIndexSet* allInstances;
@end
@interface VNGenerateForegroundInstanceMaskRequest : NSObject
@property (readonly,copy) NSArray<VNInstanceMaskObservation*>* results;
@end
@interface VNImageRequestHandler : NSObject
- (instancetype)initWithCGImage:(CGImageRef)image options:(NSDictionary*)options;
- (BOOL)performRequests:(NSArray*)requests error:(NSError**)error;
@end

static std::uint32_t integer(const unsigned char* p) {
  return (std::uint32_t(p[0])<<24)|(std::uint32_t(p[1])<<16)|(std::uint32_t(p[2])<<8)|p[3];
}
static void header(std::uint32_t magic,unsigned w,unsigned h) {
  for(auto value:{magic,w,h})for(int shift:{24,16,8,0})std::cout.put(char((value>>shift)&255));
}
static CGImageRef image(const std::vector<std::uint8_t>& rgba,unsigned w,unsigned h) {
  CGDataProviderRef provider=CGDataProviderCreateWithData(nullptr,rgba.data(),rgba.size(),nullptr);
  CGColorSpaceRef space=CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGImageRef result=CGImageCreate(w,h,8,32,w*4,space,static_cast<CGBitmapInfo>(kCGImageAlphaLast)|kCGBitmapByteOrder32Big,provider,nullptr,false,kCGRenderingIntentDefault);
  CGColorSpaceRelease(space);CGDataProviderRelease(provider);
  if(!result)throw std::runtime_error("Image creation failed.");
  return result;
}
static void segment(const std::vector<std::uint8_t>& rgba,unsigned w,unsigned h) {
  if(@available(macOS 14.0,*)) {
    CGImageRef input=image(rgba,w,h);
    VNImageRequestHandler* handler=[[VNImageRequestHandler alloc] initWithCGImage:input options:@{}];
    CGImageRelease(input);
    VNGenerateForegroundInstanceMaskRequest* request=[VNGenerateForegroundInstanceMaskRequest new];
    NSError* error=nil;
    if(![handler performRequests:@[request] error:&error])throw std::runtime_error("Local object selection is unavailable on this device.");
    VNInstanceMaskObservation* observation=request.results.firstObject;
    if(!observation || observation.allInstances.count==0)throw std::runtime_error("No distinct foreground objects were found. Nothing changed.");
    CVPixelBufferRef mask=observation.instanceMask;
    if(CVPixelBufferGetPixelFormatType(mask)!=kCVPixelFormatType_OneComponent8)throw std::runtime_error("Unsupported object mask format.");
    if(CVPixelBufferLockBaseAddress(mask,kCVPixelBufferLock_ReadOnly)!=kCVReturnSuccess)throw std::runtime_error("Object mask is unavailable.");
    const auto mw=CVPixelBufferGetWidth(mask),mh=CVPixelBufferGetHeight(mask),stride=CVPixelBufferGetBytesPerRow(mask);
    if(mw<1||mh<1||mw>2048||mh>2048){CVPixelBufferUnlockBaseAddress(mask,kCVPixelBufferLock_ReadOnly);throw std::runtime_error("Invalid object mask.");}
    const auto* base=static_cast<const char*>(CVPixelBufferGetBaseAddress(mask));
    header(0x464f4d31,unsigned(mw),unsigned(mh));
    for(std::size_t y=0;y<mh;y++)std::cout.write(base+y*stride,std::streamsize(mw));
    CVPixelBufferUnlockBaseAddress(mask,kCVPixelBufferLock_ReadOnly);
  } else throw std::runtime_error("Local object selection requires macOS 14 or newer.");
}
int main() {
  @autoreleasepool {
    try {
      unsigned char bytes[16];std::cin.read(reinterpret_cast<char*>(bytes),16);
      if(!std::cin||integer(bytes)!=0x464f5231)throw std::runtime_error("Invalid removal packet.");
      const auto op=integer(bytes+4),w=integer(bytes+8),h=integer(bytes+12);
      if(op>1||w<16||h<16||w>4096||h>4096||(op==0&&(w>1600||h>1600)))throw std::runtime_error("Invalid removal bounds.");
      std::vector<std::uint8_t> rgba(std::size_t(w)*h*4);
      std::cin.read(reinterpret_cast<char*>(rgba.data()),std::streamsize(rgba.size()));
      if(!std::cin)throw std::runtime_error("Incomplete removal image.");
      std::vector<std::uint8_t> mask;
      if(op==1){mask.resize(std::size_t(w)*h);std::cin.read(reinterpret_cast<char*>(mask.data()),std::streamsize(mask.size()));if(!std::cin)throw std::runtime_error("Incomplete removal selection.");}
      char extra;if(std::cin.get(extra))throw std::runtime_error("Unexpected removal data.");
      if(op==0)segment(rgba,w,h);
      else {
        const auto output=lenslabs::remove_object_texture(rgba,mask,w,h);
        CGImageRef result=image(output,w,h);
        CFMutableDataRef data=CFDataCreateMutable(nullptr,0);
        CGImageDestinationRef destination=CGImageDestinationCreateWithData(data,CFSTR("public.png"),1,nullptr);
        if(!destination){CGImageRelease(result);CFRelease(data);throw std::runtime_error("Could not encode removal preview.");}
        CGImageDestinationAddImage(destination,result,nullptr);
        const bool ok=CGImageDestinationFinalize(destination);
        CGImageRelease(result);CFRelease(destination);
        if(!ok||CFDataGetLength(data)>96*1024*1024){CFRelease(data);throw std::runtime_error("Could not encode removal preview.");}
        std::cout.write(reinterpret_cast<const char*>(CFDataGetBytePtr(data)),CFDataGetLength(data));CFRelease(data);
      }
      return std::cout?0:1;
    }catch(const std::exception& e){std::cerr<<e.what()<<"\n";return 1;}
  }
}
