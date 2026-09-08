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
lenslabs::Image solid(unsigned value, unsigned width=64, unsigned height=64) {
  lenslabs::Image image{width,height,width,height,{}};image.rgba.resize(std::size_t(width)*height*4);
  for(std::size_t i=0;i<image.rgba.size();i+=4) {
    for(int c=0;c<3;++c)image.rgba[i+c]=std::uint8_t(value);
    image.rgba[i+3]=255;
  }
  return image;
}
double noise_energy(const lenslabs::Image& image, double original) {
  double energy=0;for(std::size_t i=0;i<image.rgba.size();i+=4)energy+=std::pow(image.rgba[i]-original,2);
  return energy/(image.width*image.height);
}
}
int main() {
  try {
    const auto source=fixture(); const auto original=source.rgba;
    lenslabs::DevelopSettings neutral;
    check(lenslabs::develop(source,neutral).rgba==original,"Neutral settings are byte-identical.");
    {
      auto middle=neutral;middle.tonal_grading=true;middle.blending=0;middle.midtone_grade={120,80,0};
      check(lenslabs::develop(source,middle).rgba!=original,"Tonal midtones still work when blending is zero.");
    }
    std::vector<std::function<void(lenslabs::DevelopSettings&)>> edits{
      [](auto&s){s.exposure=1;},[](auto&s){s.contrast=50;},[](auto&s){s.highlights=-70;},[](auto&s){s.shadows=60;},[](auto&s){s.whites=50;},[](auto&s){s.blacks=-40;},
      [](auto&s){s.temperature=60;},[](auto&s){s.tint=50;},[](auto&s){s.saturation=-70;},[](auto&s){s.vibrance=65;},[](auto&s){s.texture=65;},[](auto&s){s.clarity=60;},[](auto&s){s.dehaze=60;},
      [](auto&s){s.curve={{0,.1},{.5,.7},{1,.95}};},[](auto&s){s.hsl[0].hue=75;},[](auto&s){s.hsl[0].saturation=-85;},[](auto&s){s.hsl[0].luminance=60;},
      [](auto&s){s.channel_curves[0]={{0,0},{.5,.7},{1,1}};},[](auto&s){s.channel_curves[1]={{0,0},{.5,.3},{1,1}};},[](auto&s){s.channel_curves[2]={{0,.15},{1,.9}};},[](auto&s){s.film_falloff=75;},
      [](auto&s){s.shadow_grade={220,65,20};},[](auto&s){s.midtone_grade={40,65,20};},[](auto&s){s.highlight_grade={90,65,20};},
      [](auto&s){s.global_grade={305,65,0};},[](auto&s){s.global_grade.luminance=40;},
      [](auto&s){s.tonal_grading=true;s.blending=0;s.midtone_grade={120,80,0};},
      [](auto&s){s.grain=60;s.grain_luminance=100;},
      [](auto&s){s.grain=60;},[](auto&s){s.fade=60;},[](auto&s){s.vignette=-80;},[](auto&s){s.bloom=80;},[](auto&s){s.halation=80;},[](auto&s){s.sharpening=50;},[](auto&s){s.noise_reduction=100;},[](auto&s){s.color_noise_reduction=100;},
      [](auto&s){lenslabs::DevelopMask m;m.exposure=2;s.masks={m};},[](auto&s){lenslabs::DevelopMask m;m.radial=false;m.exposure=2;s.masks={m};},
      [](auto&s){lenslabs::DevelopMask m;m.temperature=70;s.masks={m};},
      [](auto&s){lenslabs::DevelopMask m;m.saturation=-75;s.masks={m};},
    };
    for(std::size_t channel=0;channel<8;++channel) for(int control=0;control<3;++control) {
      edits.emplace_back([channel,control](auto& s) {
        auto& h=s.hsl[channel];if(control==0)h.hue=70;else if(control==1)h.saturation=-70;else h.luminance=70;
      });
    }
    for(auto member:{&lenslabs::DevelopSettings::shadow_grade,&lenslabs::DevelopSettings::midtone_grade,&lenslabs::DevelopSettings::highlight_grade,&lenslabs::DevelopSettings::global_grade}) {
      edits.emplace_back([member](auto& s){s.tonal_grading=true;(s.*member).hue=210;(s.*member).saturation=65;});
      edits.emplace_back([member](auto& s){s.tonal_grading=true;(s.*member).luminance=40;});
    }
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
      s.tonal_grading=iteration%2;s.balance=iteration%201-100;s.blending=iteration%101;
      s.global_grade={double(iteration%361),double(iteration%101),double(iteration%201-100)};
      s.grain_luminance=iteration%101;
      const auto output=lenslabs::develop(source,s);
      check(output.rgba.size()==original.size()&&source.rgba==original,"1000 deterministic bounded renders preserve original and dimensions.");
    }
    for(std::size_t channel=0;channel<3;++channel) {
      auto adjusted=neutral;adjusted.channel_curves[channel]={{0,.1},{.5,.8},{1,1}};
      const auto output=lenslabs::develop(source,adjusted);
      bool changed=false;
      for(std::size_t i=0;i<original.size();++i) {
        if(i%4!=channel) check(output.rgba[i]==original[i],"Independent RGB curves preserve the other channels and alpha.");
        else changed |= output.rgba[i]!=original[i];
      }
      check(changed,"Each RGB curve affects its selected channel.");
    }
    for(auto member:{&lenslabs::DevelopSettings::shadow_grade,&lenslabs::DevelopSettings::midtone_grade,&lenslabs::DevelopSettings::highlight_grade,&lenslabs::DevelopSettings::global_grade}) {
      auto a=neutral;a.tonal_grading=true;(a.*member)={0,70,0};auto b=a;(b.*member).hue=240;
      check(lenslabs::develop(source,a).rgba!=lenslabs::develop(source,b).rgba,"Each grading wheel hue alters the chosen tint when saturation is nonzero.");
    }
    {auto a=neutral;a.grain=70;auto b=a;b.grain_size=3;check(lenslabs::develop(source,a).rgba!=lenslabs::develop(source,b).rgba,"Grain size changes texture independently of amount.");}
    const auto legacy_protocol=[] {
      std::ostringstream out;out<<"FOTO_DEVELOP_1\n";
      for(int i=0;i<13;++i)out<<"0 ";out<<"\n2 0 0 1 1\n";
      for(int i=0;i<24+9;++i)out<<"0 ";out<<"\n0 50 0 1 0 0 0 0 0 0 0\n0 0 1 1 0 0 0 0\n0\n";
      return out.str();
    }();
    std::istringstream old_input(legacy_protocol);const auto old=lenslabs::read_develop_protocol(old_input);
    check(lenslabs::develop(source,old).rgba==original,"Protocol1 loads with neutral channel curves and film falloff.");
    auto protocol2=legacy_protocol;protocol2.replace(0,14,"FOTO_DEVELOP_2");protocol2+="2 0 0 1 .5\n2 0 0 1 1\n2 0 0 1 1\n73\n";
    std::istringstream new_input(protocol2);const auto upgraded=lenslabs::read_develop_protocol(new_input);
    check(upgraded.channel_curves[0][1].y==.5&&upgraded.channel_curves[1][1].y==1&&upgraded.film_falloff==73,"Protocol2 round trips independent channels and film falloff.");
    check(!old.tonal_grading&&!upgraded.tonal_grading&&old.grain_luminance==0&&upgraded.global_grade.saturation==0,"Old protocols default to the exact legacy grade and grain model.");
    auto protocol3=protocol2;protocol3.replace(0,14,"FOTO_DEVELOP_3");protocol3+="1 215 72 -24 83\n";
    std::istringstream newest(protocol3);const auto extended=lenslabs::read_develop_protocol(newest);
    check(extended.tonal_grading&&extended.global_grade.hue==215&&extended.global_grade.saturation==72&&extended.global_grade.luminance==-24&&extended.grain_luminance==83,"Protocol3 round trips grading mode, global wheel and adaptive grain.");
    for(const auto& tail:{"1 0 0 0", "2 0 0 0 0", "1 361 0 0 0", "1 0 101 0 0", "1 0 0 -101 0", "1 0 0 0 101", "1 0 0 0 nan", "1 0 0 0 0 extra"}) {
      auto invalid=protocol2;invalid.replace(0,14,"FOTO_DEVELOP_3");invalid+=tail;
      rejects([&]{std::istringstream input(invalid);lenslabs::read_develop_protocol(input);},"Reject malformed or out-of-range protocol3 fields.");
    }
    {
      const auto gray=solid(128);
      auto modern=neutral;modern.tonal_grading=true;
      check(lenslabs::develop(source,modern).rgba==original,"Neutral tonal model preserves source bytes.");
      modern.global_grade={120,70,0};const auto tinted=lenslabs::develop(gray,modern);
      check(tinted.rgba[1]>128&&tinted.rgba[0]<128&&tinted.rgba[2]<128,"Global green hue tints the full image.");
      modern.global_grade={0,0,50};const auto raised=lenslabs::develop(gray,modern);
      modern.global_grade.luminance=-50;const auto lowered=lenslabs::develop(gray,modern);
      check(raised.rgba[0]>128&&lowered.rgba[0]<128,"Global luminance moves brightness independently of saturation.");
      modern=neutral;modern.tonal_grading=true;modern.shadow_grade={240,100,0};modern.highlight_grade={0,100,0};
      modern.balance=-60;const auto cool=lenslabs::develop(gray,modern);
      modern.balance=60;const auto warm=lenslabs::develop(gray,modern);
      check(warm.rgba[0]>cool.rgba[0]&&warm.rgba[2]<cool.rgba[2],"Positive balance extends highlights; negative balance extends shadows.");
      modern.balance=0;modern.blending=0;const auto separated=lenslabs::develop(gray,modern);
      modern.blending=100;const auto mixed=lenslabs::develop(gray,modern);
      check(mixed.rgba[0]>separated.rgba[0]&&mixed.rgba[2]>separated.rgba[2],"Increasing blending extends both outer grades into middle tones.");
      modern=neutral;modern.tonal_grading=true;modern.blending=0;modern.midtone_grade.luminance=70;
      const auto dark=solid(32),light=solid(224);
      const auto middleChange=int(lenslabs::develop(gray,modern).rgba[0])-128;
      check(middleChange>int(lenslabs::develop(dark,modern).rgba[0])-32&&middleChange>int(lenslabs::develop(light,modern).rgba[0])-224,"Midtone luminance uses the tonal window, not a global brightness change.");
      modern=neutral;modern.grain=70;modern.grain_luminance=100;
      check(lenslabs::develop(solid(0),modern).rgba==solid(0).rgba&&lenslabs::develop(solid(255),modern).rgba==solid(255).rgba,"Fully adaptive grain preserves pure black and white.");
      const auto centerNoise=noise_energy(lenslabs::develop(gray,modern),128);
      check(centerNoise>2*noise_energy(lenslabs::develop(solid(16),modern),16)&&centerNoise>2*noise_energy(lenslabs::develop(solid(239),modern),239),"Grain measured energy is signal-dependent and strongest in middle tones.");
      auto colored=solid(80);for(std::size_t i=0;i<colored.rgba.size();i+=4){colored.rgba[i+1]=120;colored.rgba[i+2]=170;}
      const auto grained=lenslabs::develop(colored,modern);
      for(std::size_t i=0;i<colored.rgba.size();i+=4) {
        const int dr=int(grained.rgba[i])-80,dg=int(grained.rgba[i+1])-120,db=int(grained.rgba[i+2])-170;
        check(dr==dg&&dg==db,"Shared luminance grain adds neutral noise on colored areas away from clipping.");
        check(grained.rgba[i+3]==255,"Adaptive grain preserves alpha.");
      }
      auto brightened=modern;brightened.exposure=2;
      auto baseExposure=neutral;baseExposure.exposure=2;const auto brightBase=lenslabs::develop(solid(48),baseExposure);
      check(noise_energy(lenslabs::develop(solid(48),brightened),brightBase.rgba[0])>noise_energy(lenslabs::develop(solid(48),modern),48),"Grain responds to edited brightness, not only source brightness.");
      modern.grain=0;modern.fade=45;modern.film_falloff=70;modern.vignette=-70;
      auto noAdaptive=modern;noAdaptive.grain_luminance=0;
      check(lenslabs::develop(source,modern).rgba==lenslabs::develop(source,noAdaptive).rgba,"Luminance response does nothing when grain amount is zero.");
    }
    lenslabs::Image ramp{256,1,256,1,{}};ramp.rgba.resize(256*4);
    for(unsigned v=0;v<256;++v){for(int c=0;c<3;++c)ramp.rgba[v*4+c]=std::uint8_t(v);ramp.rgba[v*4+3]=255;}
    auto film=neutral;film.film_falloff=100;const auto shoulder=lenslabs::develop(ramp,film);
    for(unsigned v=0;v<256;++v) {
      if(v<=140)check(shoulder.rgba[v*4]==v,"Film falloff leaves shadows and middle tones unchanged.");
      if(v)check(shoulder.rgba[v*4]>=shoulder.rgba[(v-1)*4],"Film highlight shoulder stays monotonic.");
      check(shoulder.rgba[v*4]==shoulder.rgba[v*4+1]&&shoulder.rgba[v*4+1]==shoulder.rgba[v*4+2],"Film falloff keeps neutral colors neutral.");
    }
    check(shoulder.rgba[255*4]<255&&shoulder.rgba[255*4]>200,"Film falloff visibly softens highlights without crushing them.");
    auto s=neutral; s.crop={.25,.25,.5,.5,0,0,false,false}; auto cropped=lenslabs::develop(source,s);
    check(cropped.width==16&&cropped.height==12,"Normalized crop dimensions.");
    s=neutral;s.crop.rotate=90;auto rotated=lenslabs::develop(source,s);
    check(rotated.width==24&&rotated.height==32,"Quarter turn swaps dimensions.");
    check(rotated.rgba[0]==original[(source.height-1)*source.width*4],"Quarter turn maps pixels correctly.");
    s=neutral;s.crop.flip_x=true;auto flipped=lenslabs::develop(source,s);
    check(flipped.rgba[0]==original[(source.width-1)*4],"Horizontal flip maps pixels correctly.");
    s=neutral;s.crop.flip_y=true;auto flip_y=lenslabs::develop(source,s);
    check(flip_y.rgba[0]==original[(source.height-1)*source.width*4],"Vertical flip maps pixels correctly.");
    s=neutral;s.crop.angle=45;check(lenslabs::develop(source,s).rgba.size()==original.size(),"Straighten has bounded dimensions.");
    lenslabs::DevelopMask mask;mask.feather=.5;check(lenslabs::develop_mask_weight(mask,.5,.5)==1,"Radial center selected.");check(lenslabs::develop_mask_weight(mask,0,0)==0,"Radial outside excluded.");
    mask.invert=true;check(lenslabs::develop_mask_weight(mask,.5,.5)==0,"Invert complements mask.");mask.enabled=false;check(lenslabs::develop_mask_weight(mask,0,0)==0,"Disabled inverted masks remain disabled.");
    rejects([&]{auto bad=neutral;bad.exposure=std::numeric_limits<double>::quiet_NaN();lenslabs::develop(source,bad);},"Reject NaN.");
    rejects([&]{auto bad=neutral;bad.curve={{0,0},{0,.5},{1,1}};lenslabs::develop(source,bad);},"Reject duplicate curve x.");
    rejects([&]{auto bad=neutral;bad.channel_curves[2]={{0,0},{0,.5},{1,1}};lenslabs::develop(source,bad);},"Reject malformed independent channel curve.");
    rejects([&]{auto bad=neutral;bad.film_falloff=101;lenslabs::develop(source,bad);},"Reject unbounded film falloff.");
    rejects([&]{auto bad=neutral;bad.crop.x=.7;bad.crop.width=.8;lenslabs::develop(source,bad);},"Reject out-of-bounds crop.");
    rejects([&]{auto bad=neutral;bad.masks.resize(13);lenslabs::develop(source,bad);},"Reject excessive masks.");
    rejects([&]{auto bad=source;bad.rgba.pop_back();lenslabs::develop(bad,neutral);},"Reject partial image.");
    rejects([&]{std::istringstream input("FOTO_DEVELOP_1 0 0");lenslabs::read_develop_protocol(input);},"Reject truncated protocol.");
    rejects([&]{std::istringstream input("HELLO");lenslabs::read_develop_protocol(input);},"Reject unsupported protocol.");
    std::cout<<"Develop: "<<checks<<" assertions passed, including 1000 bounded render combinations.\n";return 0;
  } catch(const std::exception& e) {std::cerr<<"Develop failed: "<<e.what()<<'\n';return 1;}
}
