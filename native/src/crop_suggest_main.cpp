#include "lenslabs/crop_suggest.hpp"
#include <bit>
#include <iomanip>
#include <iostream>
#include <stdexcept>

int main() {
  try {
    unsigned char bytes[16];std::cin.read(reinterpret_cast<char*>(bytes),16);
    auto number=[&](int i){return (std::uint32_t(bytes[i])<<24)|(std::uint32_t(bytes[i+1])<<16)|(std::uint32_t(bytes[i+2])<<8)|bytes[i+3];};
    if(!std::cin||number(0)!=0x46433031)throw std::invalid_argument("Invalid crop request.");
    const auto w=number(4),h=number(8);const double aspect=std::bit_cast<float>(number(12));
    if(w<16||h<16||w>384||h>384)throw std::invalid_argument("Invalid crop preview.");
    lenslabs::Image image{w,h,w,h,{}};image.rgba.resize(std::size_t(w)*h*4);
    std::cin.read(reinterpret_cast<char*>(image.rgba.data()),std::streamsize(image.rgba.size()));
    if(!std::cin||std::cin.peek()!=std::char_traits<char>::eof())throw std::invalid_argument("Invalid crop bytes.");
    const auto result=lenslabs::suggest_crop(image,aspect);const auto& c=result.crop;
    std::cout<<std::setprecision(12)<<"{\"crop\":{\"x\":"<<c.x<<",\"y\":"<<c.y<<",\"width\":"<<c.width<<",\"height\":"<<c.height<<",\"angle\":"<<c.angle<<",\"rotate\":0,\"flipX\":false,\"flipY\":false},\"confidence\":\""<<result.confidence<<"\",\"reasons\":[";
    for(std::size_t i=0;i<result.reasons.size();++i){if(i)std::cout<<',';std::cout<<'"'<<result.reasons[i]<<'"';}
    std::cout<<"],\"analysis\":{\"width\":"<<result.width<<",\"height\":"<<result.height<<",\"horizonAngle\":"<<result.horizon_angle<<",\"horizonCoverage\":"<<result.horizon_coverage<<",\"saliencyRetained\":"<<result.saliency_retained<<",\"retainedArea\":"<<result.retained_area<<"}}\n";
    return std::cout?0:1;
  } catch(...) {std::cerr<<"Crop suggestion failed. Source unchanged.\n";return 1;}
}
