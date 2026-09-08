#include "lenslabs/develop.hpp"
#include <cmath>
#include <functional>
#include <iostream>
#include <limits>
#include <sstream>
#include <stdexcept>

namespace {
int checks = 0;
void check(bool passed, const char* label) { ++checks; if (!passed) throw std::runtime_error(label); }
template<class F> void rejects(F fn, const char* label) { bool thrown = false; try { fn(); } catch (const std::invalid_argument&) { thrown = true; } check(thrown,label); }
lenslabs::Image fixture(unsigned w = 32, unsigned h = 24) {
  lenslabs::Image image{w,h,w,h,{}}; image.rgba.resize(std::size_t(w)*h*4);
  for (unsigned y=0;y<h;++y) for (unsigned x=0;x<w;++x) {
    const auto i=(std::size_t(y)*w+x)*4;
    image.rgba[i]=std::uint8_t((x*17+y*3)%256); image.rgba[i+1]=std::uint8_t((x*5+y*11)%256); image.rgba[i+2]=std::uint8_t((x*7+y*23)%256); image.rgba[i+3]=std::uint8_t((x+y)%256);
  } return image;
}
}
int main() {
  try {
    const auto source=fixture(); const auto original=source.rgba;
    lenslabs::DevelopSettings neutral;
    check(lenslabs::develop(source,neutral).rgba==original,"Neutral settings are byte-identical.");
    std::vector<std::function<void(lenslabs::DevelopSettings&)>> edits{
      [](auto&s){s.exposure=1;},[](auto&s){s.contrast=50;},[](auto&s){s.highlights=-70;},[](auto&s){s.shadows=60;},[](auto&s){s.whites=50;},[](auto&s){s.blacks=-40;},
      [](auto&s){s.temperature=60;},[](auto&s){s.tint=50;},[](auto&s){s.saturation=-70;},[](auto&s){s.vibrance=65;},[](auto&s){s.texture=65;},[](auto&s){s.clarity=60;},[](auto&s){s.dehaze=60;},
      [](auto&s){s.curve={{0,.1},{.5,.7},{1,.95}};},[](auto&s){s.hsl[0].hue=75;},[](auto&s){s.hsl[0].saturation=-85;},[](auto&s){s.hsl[0].luminance=60;},
      [](auto&s){s.shadow_grade={220,65,20};},[](auto&s){s.midtone_grade={40,65,20};},[](auto&s){s.highlight_grade={90,65,20};},
      [](auto&s){s.grain=60;},[](auto&s){s.fade=60;},[](auto&s){s.vignette=-80;},[](auto&s){s.bloom=80;},[](auto&s){s.halation=80;},[](auto&s){s.sharpening=50;},[](auto&s){s.noise_reduction=100;},[](auto&s){s.color_noise_reduction=100;},
      [](auto&s){lenslabs::DevelopMask m;m.exposure=2;s.masks={m};},[](auto&s){lenslabs::DevelopMask m;m.radial=false;m.exposure=2;s.masks={m};},
    };
    for(const auto& edit:edits) {
      auto s=neutral;edit(s);const auto first=lenslabs::develop(source,s),second=lenslabs::develop(source,s);
      check(first.rgba!=original,"Every exposed non-neutral image adjustment changes pixels.");
      check(first.rgba==second.rgba,"Every adjustment is deterministic.");
      check(source.rgba==original,"Source memory remains unchanged.");
      for(std::size_t i=3;i<original.size();i+=4) check(first.rgba[i]==original[i],"Image adjustments preserve alpha.");
    }
    for(int iteration=0;iteration<1000;++iteration) {
      auto s=neutral; s.exposure=(iteration%101-50)/10.0; s.contrast=iteration%201-100; s.temperature=(iteration*7)%201-100;
      s.vignette=(iteration*3)%201-100; s.grain=iteration%101; s.grain_size=.5+(iteration%8)*.5;
      const auto output=lenslabs::develop(source,s);
      check(output.rgba.size()==original.size()&&source.rgba==original,"1000 deterministic bounded renders preserve original and dimensions.");
    }
    auto s=neutral; s.crop={.25,.25,.5,.5,0,0,false,false}; auto cropped=lenslabs::develop(source,s);
    check(cropped.width==16&&cropped.height==12,"Normalized crop dimensions.");
    s=neutral;s.crop.rotate=90;auto rotated=lenslabs::develop(source,s);
    check(rotated.width==24&&rotated.height==32,"Quarter turn swaps dimensions.");
    check(rotated.rgba[0]==original[(source.height-1)*source.width*4],"Quarter turn maps pixels correctly.");
    s=neutral;s.crop.flip_x=true;auto flipped=lenslabs::develop(source,s);
    check(flipped.rgba[0]==original[(source.width-1)*4],"Horizontal flip maps pixels correctly.");
    s=neutral;s.crop.angle=45;check(lenslabs::develop(source,s).rgba.size()==original.size(),"Straighten has bounded dimensions.");
    lenslabs::DevelopMask mask;mask.feather=.5;check(lenslabs::develop_mask_weight(mask,.5,.5)==1,"Radial center selected.");check(lenslabs::develop_mask_weight(mask,0,0)==0,"Radial outside excluded.");
    mask.invert=true;check(lenslabs::develop_mask_weight(mask,.5,.5)==0,"Invert complements mask.");mask.enabled=false;check(lenslabs::develop_mask_weight(mask,0,0)==0,"Disabled inverted masks remain disabled.");
    rejects([&]{auto bad=neutral;bad.exposure=std::numeric_limits<double>::quiet_NaN();lenslabs::develop(source,bad);},"Reject NaN.");
    rejects([&]{auto bad=neutral;bad.curve={{0,0},{0,.5},{1,1}};lenslabs::develop(source,bad);},"Reject duplicate curve x.");
    rejects([&]{auto bad=neutral;bad.crop.x=.7;bad.crop.width=.8;lenslabs::develop(source,bad);},"Reject out-of-bounds crop.");
    rejects([&]{auto bad=neutral;bad.masks.resize(13);lenslabs::develop(source,bad);},"Reject excessive masks.");
    rejects([&]{auto bad=source;bad.rgba.pop_back();lenslabs::develop(bad,neutral);},"Reject partial image.");
    rejects([&]{std::istringstream input("FOTO_DEVELOP_1 0 0");lenslabs::read_develop_protocol(input);},"Reject truncated protocol.");
    rejects([&]{std::istringstream input("HELLO");lenslabs::read_develop_protocol(input);},"Reject unsupported protocol.");
    std::cout<<"Develop: "<<checks<<" assertions passed, including 1000 bounded render combinations.\n";return 0;
  } catch(const std::exception& e) {std::cerr<<"Develop failed: "<<e.what()<<'\n';return 1;}
}
