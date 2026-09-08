#include "lenslabs/reference.hpp"
#include <iostream>
#include <iomanip>
#include <stdexcept>

int main() {
  try {
    unsigned char header[8];std::cin.read(reinterpret_cast<char*>(header),8);
    if(!std::cin) throw std::invalid_argument("Incomplete pair.");
    const auto number=[&](int offset){return (std::uint32_t(header[offset])<<24)|(std::uint32_t(header[offset+1])<<16)|(std::uint32_t(header[offset+2])<<8)|header[offset+3];};
    const auto width=number(0),height=number(4);
    if(width<16||height<16||width>128||height>128) throw std::invalid_argument("Preview bounds.");
    lenslabs::Image source{width,height,width,height,{}},target=source;
    for(auto* image:{&source,&target}) {image->rgba.resize(width*height*4);std::cin.read(reinterpret_cast<char*>(image->rgba.data()),std::streamsize(image->rgba.size()));}
    if(!std::cin||std::cin.peek()!=std::char_traits<char>::eof()) throw std::invalid_argument("Invalid pair bytes.");
    const auto fit=lenslabs::fit_reference(source,target);const auto& s=fit.settings;
    auto curve=[](const auto& values){std::cout<<'[';for(std::size_t i=0;i<values.size();++i){if(i)std::cout<<',';std::cout<<"{\"x\":"<<values[i].x<<",\"y\":"<<values[i].y<<'}';}std::cout<<']';};
    auto grade=[](const auto& g){std::cout<<"{\"hue\":"<<g.hue<<",\"saturation\":"<<g.saturation<<",\"luminance\":"<<g.luminance<<'}';};
    std::cout<<std::setprecision(12)<<"{\"patch\":{\"contrast\":"<<s.contrast<<",\"highlights\":"<<s.highlights<<",\"shadows\":"<<s.shadows<<",\"whites\":"<<s.whites<<",\"blacks\":"<<s.blacks<<",\"saturation\":"<<s.saturation<<",\"curve\":";curve(s.curve);
    std::cout<<",\"channelCurves\":{\"red\":";curve(s.channel_curves[0]);std::cout<<",\"green\":";curve(s.channel_curves[1]);std::cout<<",\"blue\":";curve(s.channel_curves[2]);
    std::cout<<"},\"grading\":{\"model\":\"tonal\",\"shadows\":";grade(s.shadow_grade);std::cout<<",\"midtones\":";grade(s.midtone_grade);std::cout<<",\"highlights\":";grade(s.highlight_grade);std::cout<<",\"global\":";grade(s.global_grade);
    std::cout<<",\"balance\":0,\"blending\":50}},\"diagnostics\":{\"beforeRmse\":"<<fit.before_rmse<<",\"afterRmse\":"<<fit.after_rmse<<",\"improvement\":"<<fit.improvement<<",\"alignment\":"<<fit.alignment<<",\"gradientAlignment\":"<<fit.gradient_alignment<<",\"clippedFraction\":"<<fit.clipped_fraction<<",\"evaluations\":"<<fit.evaluations<<",\"fitPixels\":"<<fit.fit_pixels<<",\"validationPixels\":"<<fit.validation_pixels<<",\"weakAlignment\":"<<(fit.weak_alignment?"true":"false")<<",\"poorFit\":"<<(fit.poor_fit?"true":"false")<<"}}\n";
    return std::cout ? 0 : 1;
  } catch(const std::invalid_argument&) {std::cerr<<"Pair not aligned or invalid.\n";return 2;}
  catch(...) {std::cerr<<"Reference fit failed. Originals unchanged.\n";return 1;}
}
