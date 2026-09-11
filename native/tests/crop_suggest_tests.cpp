#include "lenslabs/crop_suggest.hpp"
#include <algorithm>
#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>

namespace {
int checks=0;
void check(bool pass,const char* message){++checks;if(!pass)throw std::runtime_error(message);}
template<class F>void rejects(F f){bool threw=false;try{f();}catch(const std::invalid_argument&){threw=true;}check(threw,"Malformed analysis input rejected.");}
lenslabs::Image image(unsigned w=240,unsigned h=160){lenslabs::Image p{w,h,w,h,{}};p.rgba.resize(w*h*4,128);for(std::size_t i=3;i<p.rgba.size();i+=4)p.rgba[i]=255;return p;}
}
int main(){try{
  auto flat=image();auto first=lenslabs::suggest_crop(flat);
  check(first.confidence=="low"&&first.crop.angle==0&&first.crop.width==1,"Blank input receives no invented crop.");
  for(double angle:{-6.0,-3.0,0.0,3.0,6.0}) {
    auto p=image();const double slope=std::tan(angle*3.14159265358979323846/180);
    for(unsigned y=0;y<p.height;++y)for(unsigned x=0;x<p.width;++x) {
      const double edge=p.height*.45+slope*(x-double(p.width)/2);
      const auto value=std::uint8_t(std::clamp((y-edge)*.35+.5,0.0,1.0)*190+25);
      for(int c=0;c<3;++c)p.rgba[(y*p.width+x)*4+c]=value;
    }
    const auto before=p.rgba;const auto result=lenslabs::suggest_crop(p);
    check(std::abs(result.crop.angle-angle)<=.75,"Detect signed horizon tilt conservatively.");
    check(p.rgba==before,"Crop analysis never mutates input.");
    check(result.crop.width==1&&result.crop.height==1,"Original aspect retains full frame.");
  }
  auto subject=image();
  for(unsigned y=50;y<110;++y)for(unsigned x=120;x<175;++x)for(int c=0;c<3;++c)subject.rgba[(y*subject.width+x)*4+c]=240;
  const auto crop=lenslabs::suggest_crop(subject,1.2);
  check(crop.crop.width<1&&crop.crop.width>.7&&crop.crop.x+crop.crop.width<=1,"Requested moderate aspect is bounded.");
  check(crop.saliency_retained>=.9&&crop.retained_area>=.7,"Conservative crop retains measured detail and area.");
  const auto rejected=lenslabs::suggest_crop(subject,.5);
  check(rejected.crop.width==1&&rejected.crop.height==1,"Aggressive aspect crop is not silently applied.");
  subject.rgba[3]=0;for(std::size_t i=3;i<subject.rgba.size();i+=4)subject.rgba[i]=0;
  check(lenslabs::suggest_crop(subject,1.2).confidence=="low","Transparent preview cannot generate confident crop.");
  auto noise=image();unsigned seed=17;
  for(int example=0;example<20;++example) {
    for(std::size_t i=0;i<noise.rgba.size();i+=4) {
      seed=1664525u*seed+1013904223u;
      for(int c=0;c<3;++c)noise.rgba[i+c]=std::uint8_t(seed>>24);
    }
    const auto uncertain=lenslabs::suggest_crop(noise);
    check(uncertain.confidence=="low"&&uncertain.crop.angle==0,"Random edges do not invent a confident horizon.");
  }
  rejects([&]{lenslabs::suggest_crop(image(15,32));});rejects([&]{lenslabs::suggest_crop(image(385,32));});
  rejects([&]{lenslabs::suggest_crop(flat,std::numeric_limits<double>::quiet_NaN());});rejects([&]{lenslabs::suggest_crop(flat,10);});
  auto short_image=flat;short_image.rgba.pop_back();rejects([&]{lenslabs::suggest_crop(short_image);});
  std::cout<<"Crop suggestion: "<<checks<<" assertions passed.\n";
}catch(const std::exception& e){std::cerr<<"Crop suggestion failed: "<<e.what()<<'\n';return 1;}}
