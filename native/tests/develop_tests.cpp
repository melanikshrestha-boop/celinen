#include "lenslabs/develop.hpp"
#include <algorithm>
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
double chroma_noise_energy(const lenslabs::Image& image) {
  double energy=0;
  for(std::size_t i=0;i<image.rgba.size();i+=4) {
    // Fixture base RGB is (96,128,160); channel differences ignore luminance.
    energy+=std::pow(double(image.rgba[i])-image.rgba[i+1]+32,2);
    energy+=std::pow(double(image.rgba[i+2])-image.rgba[i+1]-32,2);
  }
  return energy/(image.width*image.height);
}
std::uint64_t pixel_fingerprint(const lenslabs::Image& image) {
  std::uint64_t value=14695981039346656037ull;
  for(auto byte:image.rgba) {value^=byte;value*=1099511628211ull;}
  return value;
}
}
int main() {
  try {
    const auto source=fixture(); const auto original=source.rgba;
    lenslabs::DevelopSettings neutral;
    {
      check(lenslabs::develop_max_edge==8192&&lenslabs::develop_standard_edge==4096&&lenslabs::develop_max_output_pixels==36000000,"Export capacity is explicit and standard previews stay 4096.");
      const auto full=lenslabs::develop_output_dimensions(6024,4024,8192);
      check(full.width==6024&&full.height==4024,"A 24MP source remains full sized in the opt-in export.");
      const auto square=lenslabs::develop_output_dimensions(6000,6000,8192);
      check(square.width==6000&&square.height==6000,"Exactly 36MP is accepted without downscaling.");
      const auto capped=lenslabs::develop_output_dimensions(6001,6000,8192);
      check(capped.width==6000&&capped.height==5999,"Output above 36MP is fitted by deterministic floor, not oversized allocation.");
      for(unsigned i=1;i<=1000;++i) {
        const unsigned w=1+(i*757)%15000,h=1+(i*277)%9000;
        for(unsigned edge:{32u,1600u,4096u,4097u,8192u}) {
          const auto size=lenslabs::develop_output_dimensions(w,h,edge);
          check(size.width<=w&&size.height<=h&&size.width<=edge&&size.height<=edge,"Bounded output never upscales or exceeds requested edge.");
          check(lenslabs::valid_develop_dimensions(size.width,size.height,edge>4096),"Every fitted output obeys its exact allocation budget.");
          if(edge<=4096) {
            const auto ratio=std::min(1.0,double(edge)/std::max(w,h));
            check(size.width==std::max(1u,unsigned(std::round(w*ratio)))&&size.height==std::max(1u,unsigned(std::round(h*ratio))),"Default output dimensions retain exact legacy rounding.");
          } else {
            const auto thumbnailEdge=lenslabs::develop_thumbnail_edge(w,h,edge);
            const double ratio=double(thumbnailEdge)/std::max(w,h);
            check(std::ceil(w*ratio)*std::ceil(h*ratio)<=36000000,"ImageIO materialization is bounded even if its aspect ratio rounds up.");
          }
        }
      }
      for(unsigned edge:{0u,7u,8193u,0xffffffffu})
        rejects([&]{lenslabs::develop_output_dimensions(32,24,edge);},"Invalid export edge is rejected.");
      rejects([&]{lenslabs::develop_output_dimensions(0,24,8192);},"Zero source dimensions are rejected.");
      auto strip=fixture(8192,1);const auto bytes=strip.rgba;
      rejects([&]{lenslabs::develop(strip,neutral);},"Existing core callers cannot silently opt into larger outputs.");
      const auto larger=lenslabs::develop(strip,neutral,true);
      check(larger.rgba==bytes&&larger.width==8192&&larger.source_width==8192,"Explicit high resolution preserves exact source pixels and metadata.");
      auto turned=neutral;turned.crop.rotate=90;
      const auto portrait=lenslabs::develop(strip,turned,true);
      check(portrait.width==1&&portrait.height==8192,"High resolution quarter turns preserve bounded dimensions.");
      check(strip.rgba==bytes,"High resolution development never mutates its input.");
      for(const auto size:{lenslabs::DevelopDimensions{8193,1},{6001,6000},{8192,8192}}) {
        check(!lenslabs::valid_develop_dimensions(size.width,size.height,true),"Excessive high resolution dimensions are rejected before allocation.");
        rejects([&]{lenslabs::develop({size.width,size.height,size.width,size.height,{}},neutral,true);},"Oversized core input fails closed.");
      }
    }
    check(lenslabs::develop(source,neutral).rgba==original,"Neutral settings are byte-identical.");
    check(lenslabs::is_neutral_develop(neutral),"Untouched recipes use the exact native no-op path.");
    {
      auto codes=fixture(16,16);
      for(unsigned code=0;code<256;++code){codes.rgba[code*4]=std::uint8_t(code);codes.rgba[code*4+1]=std::uint8_t((code*17)%256);codes.rgba[code*4+2]=std::uint8_t(255-code);}
      const auto bytes=codes.rgba;const auto unit=[](double v){return std::clamp(v,0.,1.);};
      const auto decode=[](double v){return v<=.04045?v/12.92:std::pow((v+.055)/1.055,2.4);};
      const auto encode=[](double v){return v<=.0031308?v*12.92:1.055*std::pow(v,1/2.4)-.055;};
      const double tiny=std::numeric_limits<double>::denorm_min();
      for(double exposure:{-5.,-1.,-tiny,0.,tiny,.75,5.})for(double temperature:{-100.,-.001,0.,.001,100.})for(double tint:{-100.,-.001,0.,.001,100.}) {
        auto settings=neutral;settings.exposure=exposure;settings.temperature=temperature;settings.tint=tint;
        const auto result=lenslabs::develop(codes,settings);const double factor=std::exp2(exposure);
        for(unsigned code=0;code<256;++code) {
          std::array<float,3> expected{};
          for(int c=0;c<3;++c)expected[c]=float(bytes[code*4+c]/255.0);
          if(exposure!=0)for(auto& v:expected)v=float(unit(encode(decode(v)*factor)));
          if(temperature!=0||tint!=0) {
            expected[0]=float(unit(expected[0]*std::exp2(temperature*.0035+tint*.001)));
            expected[1]=float(unit(expected[1]*std::exp2(-tint*.002)));
            expected[2]=float(unit(expected[2]*std::exp2(-temperature*.0035+tint*.001)));
          }
          for(int c=0;c<3;++c)check(result.rgba[code*4+c]==std::uint8_t(std::round(unit(expected[c])*255)),"Exhaustive source-code mapping preserves legacy float rounding over exposure and white-balance extremes.");
          check(result.rgba[code*4+3]==bytes[code*4+3],"Source-stage lookup preserves every alpha byte.");
        }
        check(codes.rgba==bytes,"Source-stage lookup never mutates original pixels.");
      }
    }
    {
      for(int iteration=0;iteration<100;++iteration) {
        auto inactive=neutral;
        inactive.tonal_grading=iteration%2;inactive.balance=iteration*2-100;
        inactive.blending=iteration;inactive.grain_size=.5+(iteration%8)*.5;
        inactive.grain_luminance=iteration;
        for(auto* g:{&inactive.shadow_grade,&inactive.midtone_grade,&inactive.highlight_grade,&inactive.global_grade})
          g->hue=(iteration*37)%361;
        lenslabs::DevelopMask mask;mask.radial=iteration%2;mask.invert=iteration%3;
        mask.feather=iteration*.01;mask.angle=iteration-50;
        inactive.masks.push_back(mask);
        mask.enabled=false;mask.exposure=5;mask.temperature=-100;mask.saturation=100;
        inactive.masks.push_back(mask);
        check(lenslabs::is_neutral_develop(inactive),"Inactive shapes, disabled masks and grading hue remain neutral.");
        check(lenslabs::develop(source,inactive).rgba==original,"Every bypassed inactive recipe preserves exact RGBA bytes.");
        check(source.rgba==original,"No-op eligibility never mutates source pixels.");
      }
      auto tiny_edit=neutral;tiny_edit.exposure=std::numeric_limits<double>::denorm_min();
      check(!lenslabs::is_neutral_develop(tiny_edit),"No epsilon approximation skips a nonzero adjustment.");
      auto straight_curve=neutral;straight_curve.curve={{0,0},{.5,.5},{1,1}};
      check(!lenslabs::is_neutral_develop(straight_curve),"Only the exact identity-curve representation is bypassed.");
      rejects([&]{auto bad=neutral;bad.grain_size=std::numeric_limits<double>::quiet_NaN();lenslabs::is_neutral_develop(bad);},"No-op path validates even inactive grain shape.");
      rejects([&]{auto bad=neutral;bad.shadow_grade.hue=361;lenslabs::is_neutral_develop(bad);},"No-op path validates even inactive grade hue.");
      rejects([&]{auto bad=neutral;bad.masks.resize(13);lenslabs::is_neutral_develop(bad);},"No-op path retains mask bounds.");
    }
    {
      for (int amplitude : {12,60}) {
        auto noisy=solid(128);
        for(unsigned y=0;y<noisy.height;++y)for(unsigned x=0;x<noisy.width;++x) {
          const auto i=(std::size_t(y)*noisy.width+x)*4;
          for(int c=0;c<3;++c)noisy.rgba[i+c]=std::uint8_t(128+((x+y)%2?amplitude:-amplitude));
        }
        const auto bytes=noisy.rgba;
        auto denoise=neutral;denoise.noise_reduction=100;
        const auto reduced=lenslabs::develop(noisy,denoise);
        check(noise_energy(reduced,128)<amplitude*amplitude*.6,"Maximum luminance denoise reduces even strong high-frequency noise.");
        denoise.sharpening=50;
        check(noise_energy(lenslabs::develop(noisy,denoise),128)<amplitude*amplitude,"Sharpening does not cancel the luminance denoise stage.");
        check(noisy.rgba==bytes,"Denoise never writes source pixels.");
      }
      auto colored=solid(128);
      for(unsigned y=0;y<colored.height;++y)for(unsigned x=0;x<colored.width;++x) {
        const auto i=(std::size_t(y)*colored.width+x)*4;const int noise=(x+y)%2?20:-20;
        colored.rgba[i]=100+noise;colored.rgba[i+1]=140+noise;colored.rgba[i+2]=170+noise;
        colored.rgba[i+3]=std::uint8_t((x+y)%256);
      }
      auto denoise=neutral;denoise.noise_reduction=100;const auto filtered=lenslabs::develop(colored,denoise);
      for(std::size_t i=0;i<colored.rgba.size();i+=4) {
        check(int(filtered.rgba[i+1])-filtered.rgba[i]==40&&int(filtered.rgba[i+2])-filtered.rgba[i+1]==30,"Luminance denoise preserves in-gamut color differences.");
        check(filtered.rgba[i+3]==colored.rgba[i+3],"Luminance denoise preserves alpha.");
      }
      auto edge=solid(40);
      for(unsigned y=0;y<edge.height;++y)for(unsigned x=edge.width/2;x<edge.width;++x)
        for(int c=0;c<3;++c)edge.rgba[(std::size_t(y)*edge.width+x)*4+c]=215;
      const auto preserved=lenslabs::develop(edge,denoise);
      for(std::size_t i=0;i<edge.rgba.size();i+=4) {
        check(preserved.rgba[i]>=40&&preserved.rgba[i]<=215,"Denoise creates no edge overshoot or halos.");
        check(std::abs(int(preserved.rgba[i])-edge.rgba[i])<=9,"Luminance denoise preserves strong structural edges.");
      }
      for(auto dimensions:{std::pair{1u,1u},std::pair{1u,32u},std::pair{32u,1u}}) {
        auto tiny=solid(90,dimensions.first,dimensions.second);
        check(lenslabs::develop(tiny,denoise).rgba==tiny.rgba,"Denoise handles one-pixel dimensions and uniform fields exactly.");
      }
    }
    {
      // Pre-repair fingerprints of the generated fixture protect color-only
      // recipes; only the previously conflicting combined detail path changes.
      for(const auto& [amount,expected]:{std::pair{25.,12143018198893618805ull},
          std::pair{70.,3422137227641693134ull},std::pair{100.,13052741767665088765ull}}) {
        auto reduced=neutral;reduced.color_noise_reduction=amount;
        check(pixel_fingerprint(lenslabs::develop(source,reduced))==expected,"Color-noise-only recipes preserve their previous pixels exactly.");
      }
      auto noisy=solid(128);
      for(unsigned y=0;y<noisy.height;++y)for(unsigned x=0;x<noisy.width;++x) {
        const auto i=(std::size_t(y)*noisy.width+x)*4;const int sign=(x+y)%2?1:-1;
        // Near-equal luminance (difference < .013 of one byte) isolates chroma.
        noisy.rgba[i]=96+40*sign;noisy.rgba[i+1]=128-12*sign;noisy.rgba[i+2]=160+sign;
        noisy.rgba[i+3]=std::uint8_t((x+y)%256);
      }
      const auto before=noisy.rgba;const double initial=chroma_noise_energy(noisy);
      for(double sharpening:{0.,50.,100.})for(double texture:{0.,100.}) {
        auto reduced=neutral;reduced.color_noise_reduction=100;reduced.sharpening=sharpening;reduced.texture=texture;
        const auto result=lenslabs::develop(noisy,reduced);
        check(chroma_noise_energy(result)<initial*.3,"Color denoise remains effective with sharpening and texture enabled.");
        check(lenslabs::develop(noisy,reduced).rgba==result.rgba,"Combined color denoise and detail are deterministic.");
        check(noisy.rgba==before,"Color denoise plus detail never changes original pixels.");
        for(std::size_t i=3;i<before.size();i+=4)check(result.rgba[i]==before[i],"Color denoise plus detail preserves alpha.");
      }
      for(double radius:{.5,1.75,3.})for(double detail:{0.,100.})for(double masking:{0.,100.}) {
        auto reduced=neutral;reduced.color_noise_reduction=100;reduced.sharpening=100;reduced.texture=100;
        reduced.sharpening_radius=radius;reduced.sharpening_detail=detail;reduced.sharpening_masking=masking;
        check(chroma_noise_energy(lenslabs::develop(noisy,reduced))<initial*.3,"Extended sharpening and Texture do not cancel prior color-noise reduction.");
      }
      auto gray=source;
      for(std::size_t i=0;i<gray.rgba.size();i+=4)gray.rgba[i+1]=gray.rgba[i+2]=gray.rgba[i];
      for(double sharpening:{0.,50.,100.})for(double texture:{-100.,0.,100.}) {
        auto detail=neutral;detail.sharpening=sharpening;detail.texture=texture;
        auto reduced=detail;reduced.color_noise_reduction=100;
        check(lenslabs::develop(gray,reduced).rgba==lenslabs::develop(gray,detail).rgba,"Color denoise does not soften achromatic detail or luminance edges.");
      }
      for(auto dimensions:{std::pair{1u,1u},std::pair{1u,32u},std::pair{32u,1u}}) {
        auto uniform=solid(128,dimensions.first,dimensions.second);
        for(std::size_t i=0;i<uniform.rgba.size();i+=4){uniform.rgba[i]=96;uniform.rgba[i+2]=160;}
        auto reduced=neutral;reduced.color_noise_reduction=100;reduced.sharpening=100;reduced.texture=100;
        check(lenslabs::develop(uniform,reduced).rgba==uniform.rgba,"Color denoise and detail preserve uniform colors in one-pixel dimensions.");
      }
    }
    {
      auto middle=neutral;middle.tonal_grading=true;middle.blending=0;middle.midtone_grade={120,80,0};
      check(lenslabs::develop(source,middle).rgba!=original,"Tonal midtones still work when blending is zero.");
    }
    {
      // New sharpening metadata is neutral until Amount is enabled. Texture
      // continues through the exact legacy path, including its denoise threshold.
      for(double texture:{-100.,0.,100.})for(double denoise:{0.,60.}) {
        auto old=neutral;old.texture=texture;old.noise_reduction=denoise;
        const auto baseline=lenslabs::develop(source,old);
        for(double radius:{.5,.75,1.,1.5,2.,2.75,3.})for(double detail:{0.,50.,100.})for(double masking:{0.,50.,100.}) {
          auto current=old;current.sharpening_radius=radius;current.sharpening_detail=detail;current.sharpening_masking=masking;
          check(lenslabs::develop(source,current).rgba==baseline.rgba,"Amount zero makes Radius, Detail and Masking exact no-ops even with Texture and denoise.");
          if(!texture&&!denoise)check(lenslabs::is_neutral_develop(current),"Inactive sharpening shape retains neutral fastpath eligibility.");
        }
      }
      for(auto dimensions:{std::pair{1u,1u},std::pair{1u,37u},std::pair{37u,1u},std::pair{31u,47u}}) {
        auto uniform=solid(128,dimensions.first,dimensions.second);
        for(std::size_t i=0;i<uniform.rgba.size();i+=4){uniform.rgba[i]=96;uniform.rgba[i+2]=160;uniform.rgba[i+3]=std::uint8_t(i%256);}
        for(double radius:{.5,.999999,1.,1.000001,2.,3.}) {
          auto sharp=neutral;sharp.sharpening=100;sharp.sharpening_radius=radius;sharp.sharpening_detail=25;sharp.sharpening_masking=70;sharp.texture=50;
          check(lenslabs::develop(uniform,sharp).rgba==uniform.rgba,"Fractional sharpening keeps uniform colors and alpha unchanged at all boundary shapes.");
          const auto varying=fixture(dimensions.first,dimensions.second);
          const auto before=varying.rgba;
          for(int turn:{0,90,180,270}) {
            sharp.crop.rotate=turn;const auto rendered=lenslabs::develop(varying,sharp);
            check(rendered.width==(turn==90||turn==270?varying.height:varying.width)&&rendered.height==(turn==90||turn==270?varying.width:varying.height),"Fractional detail supports non-square and one-pixel image orientations.");
            auto geometryOnly=neutral;geometryOnly.crop.rotate=turn;const auto alpha=lenslabs::develop(varying,geometryOnly);
            for(std::size_t i=3;i<before.size();i+=4)check(rendered.rgba[i]==alpha.rgba[i],"Extended sharpening never changes source alpha, including rotated output.");
          }
          check(varying.rgba==before,"Extended sharpening never mutates original bytes.");
        }
      }
      const auto change=[](const lenslabs::Image& edited,const lenslabs::Image& base,unsigned from,unsigned to) {
        double sum=0;for(unsigned y=0;y<base.height;++y)for(unsigned x=from;x<to;++x)for(int c=0;c<3;++c)
          sum+=std::abs(int(edited.rgba[(std::size_t(y)*base.width+x)*4+c])-base.rgba[(std::size_t(y)*base.width+x)*4+c]);
        return sum;
      };
      auto edge=solid(64,96,48),noisy=solid(128,96,48);
      for(unsigned y=0;y<edge.height;++y)for(unsigned x=0;x<edge.width;++x) {
        const auto i=(std::size_t(y)*edge.width+x)*4;const int noise=int((x*17+y*31)%11)-5;
        for(int c=0;c<3;++c){edge.rgba[i+c]=std::uint8_t((x<48?64:192)+noise);noisy.rgba[i+c]=std::uint8_t(128+noise);}
      }
      auto sharp=neutral;sharp.sharpening=50;
      const auto unmasked=lenslabs::develop(edge,sharp),fine=lenslabs::develop(noisy,sharp);
      sharp.sharpening_detail=0;const auto fewerFine=lenslabs::develop(noisy,sharp),edgesOnly=lenslabs::develop(edge,sharp);
      check(change(fewerFine,noisy,0,96)<change(fine,noisy,0,96)*.25,"Lower Detail suppresses low-contrast fine residuals.");
      check(change(edgesOnly,edge,47,49)>change(unmasked,edge,47,49)*.8,"Lower Detail retains strong structural edge sharpening.");
      sharp.sharpening_detail=100;sharp.sharpening_masking=100;const auto masked=lenslabs::develop(edge,sharp);
      check(change(masked,edge,4,40)<change(unmasked,edge,4,40)*.1,"Maximum Masking protects noisy flat fields.");
      check(change(masked,edge,47,49)>change(unmasked,edge,47,49)*.7,"Maximum Masking retains the strongest edges.");
      sharp.sharpening_masking=0;sharp.sharpening_radius=.5;const auto small=lenslabs::develop(edge,sharp);
      sharp.sharpening_radius=1.5;const auto fractional=lenslabs::develop(edge,sharp);
      sharp.sharpening_radius=3;const auto large=lenslabs::develop(edge,sharp);
      check(small.rgba!=fractional.rgba&&fractional.rgba!=large.rgba,"Radius continuously controls sharpening width, including fractional settings.");
      check(change(large,edge,45,47)>change(small,edge,45,47),"Larger Radius extends sharpening across a wider edge neighborhood.");
      for(double radius:{1.,2.}) {
        sharp.sharpening_radius=radius-0.000001;const auto below=lenslabs::develop(source,sharp);
        sharp.sharpening_radius=radius+0.000001;const auto above=lenslabs::develop(source,sharp);
        for(std::size_t i=0;i<original.size();++i)check(std::abs(int(below.rgba[i])-above.rgba[i])<=1,"Fractional radius is continuous across integer support changes within RGB8 rounding.");
      }
      for(double radius:{.5,1.5,3.}) {
        sharp.sharpening_radius=radius;sharp.sharpening_detail=60;sharp.sharpening_masking=30;
        const auto sharpened=lenslabs::develop(noisy,sharp);sharp.noise_reduction=100;
        check(noise_energy(lenslabs::develop(noisy,sharp),128)<noise_energy(sharpened,128),"Luminance denoise remains effective under extended sharpening.");
        sharp.noise_reduction=0;
      }
      for(const auto& field:{&lenslabs::DevelopSettings::sharpening_radius,&lenslabs::DevelopSettings::sharpening_detail,&lenslabs::DevelopSettings::sharpening_masking}) {
        for(double invalid:{-1.,101.,std::numeric_limits<double>::infinity(),std::numeric_limits<double>::quiet_NaN()})
          rejects([&]{auto s=neutral;s.*field=invalid;lenslabs::is_neutral_develop(s);},"Invalid sharpening metadata is rejected even with Amount zero.");
      }
      rejects([&]{auto s=neutral;s.sharpening_radius=.49;lenslabs::validate_develop(s);},"Radius lower bound is enforced.");
      rejects([&]{auto s=neutral;s.sharpening_radius=3.01;lenslabs::validate_develop(s);},"Radius upper bound is enforced.");
    }
    {
      using Points=std::vector<lenslabs::CurvePoint>;
      const Points quadratic{{0,0},{.5,.25},{1,1}};
      const auto sample=[](const Points& p,double x,int mode=1){return lenslabs::develop_curve_value(p,x,mode);};
      check(sample(quadratic,.25)==.078125&&sample(quadratic,.75)==.546875,"PCHIP uses weighted harmonic interior and one-sided endpoint derivatives.");
      check(sample(quadratic,.25,0)==.125&&sample(quadratic,.75,0)==.625,"Legacy linear interpolation retains its exact arithmetic.");
      for(const Points& points:{Points{{0,.2},{1,.85}},Points{{0,1},{1,0}},Points{{0,.4},{1,.4}}})
        for(int i=0;i<=1024;++i)check(sample(points,i/1024.)==sample(points,i/1024.,0),"Two-point smooth curves remain exactly linear, including reversed and constant curves.");
      for(const Points& points:{quadratic,Points{{0,.1},{.2,.1},{.7,.8},{1,.9}},Points{{0,1},{.2,.7},{.7,.7},{1,.1}}}) {
        for(const auto& p:points)check(sample(points,p.x)==p.y,"Smooth interpolation preserves every knot and endpoint exactly.");
        double previous=sample(points,0);const bool increasing=points.back().y>=points.front().y;
        for(int i=1;i<=4096;++i) {
          const double value=sample(points,i/4096.);
          check(std::isfinite(value)&&value>=0&&value<=1,"Dense smooth samples remain finite and normalized.");
          check(increasing?value>=previous-1e-14:value<=previous+1e-14,"Monotone point data stays monotone, including flat segments.");previous=value;
        }
      }
      const Points artistic{{0,.1},{.2,.8},{.5,.2},{.7,.9},{1,.4}};
      for(std::size_t segment=1;segment<artistic.size();++segment) {
        const auto a=artistic[segment-1],b=artistic[segment];
        for(int i=0;i<=1024;++i) {
          const auto value=sample(artistic,a.x+(b.x-a.x)*i/1024.);
          check(value>=std::min(a.y,b.y)&&value<=std::max(a.y,b.y),"Artistic non-monotone curves never overshoot a segment's two endpoints.");
        }
      }
      for(std::size_t i=1;i+1<artistic.size();++i) {
        const auto p=artistic[i];const double epsilon=1e-7;
        check(std::abs((sample(artistic,p.x+epsilon)-p.y)/epsilon)<1e-4&&std::abs((p.y-sample(artistic,p.x-epsilon))/epsilon)<1e-4,"Turning points have matching zero first derivatives without overshoot.");
      }
      // Deterministic varied monotone tables exercise all sixteen allowed points.
      for(int iteration=1;iteration<=100;++iteration) {
        Points points{{0,0}};double total=0;std::array<double,15> weights{};
        for(int i=0;i<15;++i){weights[i]=double((iteration*37+i*17)%101);total+=weights[i];}
        double cumulative=0;for(int i=0;i<15;++i){cumulative+=weights[i];points.push_back({(i+1)/15.,cumulative/total});}
        points.back()={1,1};double previous=0;
        for(int i=0;i<=512;++i) {
          const double value=sample(points,i/512.);
          check(std::isfinite(value)&&value>=previous-1e-14&&value<=1,"One hundred sixteen-point monotone tables preserve dense shape bounds.");previous=value;
        }
      }
      const double tiny=std::numeric_limits<double>::denorm_min();
      for(const Points& points:{Points{{0,0},{tiny,.5},{1,1}},Points{{0,0},{.5,tiny},{1,1}}}) {
        for(double x:{0.,tiny,1e-308,.25,.5,.75,1.}) {
          const double value=sample(points,x);
          check(std::isfinite(value)&&value==sample(points,x,0),"Unrepresentable slopes use deterministic whole-curve legacy linear fallback.");
        }
      }
      const Points narrow{{0,0},{1e-308,.8},{1,1}};
      for(double x:{0.,tiny,1e-308,.25,.5,.75,1.}) {
        const double value=sample(narrow,x);check(std::isfinite(value)&&value>=0&&value<=1,"Tiny representable gaps are not rejected by an arbitrary epsilon threshold.");
      }
      const Points close{{0,.2},{.5,.8},{std::nextafter(.5,1.),.1},{1,.9}};
      for(double x:{0.,.25,.5,std::nextafter(.5,1.),.75,1.}) {
        const double value=sample(close,x);check(std::isfinite(value)&&value>=0&&value<=1,"Representable adjacent floating-point knots never produce NaN or out-of-range pixels.");
      }
      auto smooth=neutral;smooth.curve_interpolation=1;
      check(lenslabs::is_neutral_develop(smooth)&&lenslabs::develop(source,smooth).rgba==original,"Smooth identity curves retain the exact neutral fastpath.");
      smooth.curve=quadratic;const auto curved=lenslabs::develop(source,smooth);auto line=smooth;line.curve_interpolation=0;
      check(curved.rgba!=lenslabs::develop(source,line).rgba,"Smooth master curves visibly differ from linear interpolation for curved point data.");
      auto gray=solid(0,256,1);for(unsigned x=0;x<256;++x)for(int c=0;c<3;++c)gray.rgba[x*4+c]=std::uint8_t(x);
      const auto ramp=lenslabs::develop(gray,smooth);
      for(unsigned x=0;x<256;++x) {
        check(ramp.rgba[x*4]==ramp.rgba[x*4+1]&&ramp.rgba[x*4]==ramp.rgba[x*4+2],"A smooth master curve keeps gray ramps achromatic.");
        if(x)check(ramp.rgba[x*4]>=ramp.rgba[(x-1)*4],"Monotone smooth curves preserve monotone rendered RGB8 ramps.");
      }
      for(std::size_t channel=0;channel<3;++channel) {
        auto settings=neutral;settings.curve_interpolation=1;settings.channel_curves[channel]=artistic;
        const auto edited=lenslabs::develop(source,settings);bool changed=false;
        for(std::size_t i=0;i<original.size();++i) {
          if(i%4!=channel)check(edited.rgba[i]==original[i],"Smooth independent RGB curves preserve other channels and source alpha.");
          else changed|=edited.rgba[i]!=original[i];
        }
        check(changed&&!lenslabs::is_neutral_develop(settings),"Each non-neutral smooth RGB curve renders and disables the no-op bypass.");
      }
      check(source.rgba==original,"Smooth curves never mutate their source.");
      for(int mode:{-1,2}) {
        rejects([&]{auto settings=neutral;settings.curve_interpolation=mode;lenslabs::is_neutral_develop(settings);},"Invalid interpolation mode fails even with neutral curves.");
        rejects([&]{sample(quadratic,.5,mode);},"Curve sampler rejects unsupported interpolation modes.");
      }
      rejects([&]{sample(quadratic,std::numeric_limits<double>::quiet_NaN());},"Curve sampler rejects non-finite sample positions.");
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
    // Pre-optimization fingerprints cover every control below and the existing
    // 1000 combined recipes. Performance changes must not alter even one byte.
    std::uint64_t controls_compatibility=14695981039346656037ull;
    for(const auto& edit:edits) {
      auto s=neutral;edit(s);const auto first=lenslabs::develop(source,s),second=lenslabs::develop(source,s);
      for(auto byte:first.rgba){controls_compatibility^=byte;controls_compatibility*=1099511628211ull;}
      check(!lenslabs::is_neutral_develop(s),"Every effective image control blocks the native no-op path.");
      check(first.rgba!=original,"Every exposed non-neutral image adjustment changes pixels.");
      check(first.rgba==second.rgba,"Every adjustment is deterministic.");
      check(source.rgba==original,"Source memory remains unchanged.");
      for(std::size_t i=3;i<original.size();i+=4) check(first.rgba[i]==original[i],"Image adjustments preserve alpha.");
    }
    check(controls_compatibility==5908271974342230509ull,"All individual controls preserve pre-optimization pixels exactly.");
    std::uint64_t combinations_compatibility=14695981039346656037ull;
    for(int iteration=0;iteration<1000;++iteration) {
      auto s=neutral; s.exposure=(iteration%101-50)/10.0; s.contrast=iteration%201-100; s.temperature=(iteration*7)%201-100;
      s.vignette=(iteration*3)%201-100; s.grain=iteration%101; s.grain_size=.5+(iteration%8)*.5;
      s.tonal_grading=iteration%2;s.balance=iteration%201-100;s.blending=iteration%101;
      s.global_grade={double(iteration%361),double(iteration%101),double(iteration%201-100)};
      s.grain_luminance=iteration%101;
      const auto output=lenslabs::develop(source,s);
      for(auto byte:output.rgba){combinations_compatibility^=byte;combinations_compatibility*=1099511628211ull;}
      check(output.rgba.size()==original.size()&&source.rgba==original,"1000 deterministic bounded renders preserve original and dimensions.");
    }
    check(combinations_compatibility==4297235942242909954ull,"1000 combined recipes preserve pre-optimization pixels exactly.");
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
    check(lenslabs::is_neutral_develop(old),"Validated legacy neutral recipes use the exact no-op path.");
    auto protocol2=legacy_protocol;protocol2.replace(0,14,"FOTO_DEVELOP_2");protocol2+="2 0 0 1 .5\n2 0 0 1 1\n2 0 0 1 1\n73\n";
    std::istringstream new_input(protocol2);const auto upgraded=lenslabs::read_develop_protocol(new_input);
    check(upgraded.channel_curves[0][1].y==.5&&upgraded.channel_curves[1][1].y==1&&upgraded.film_falloff==73,"Protocol2 round trips independent channels and film falloff.");
    check(!old.tonal_grading&&!upgraded.tonal_grading&&old.grain_luminance==0&&upgraded.global_grade.saturation==0,"Old protocols default to the exact legacy grade and grain model.");
    auto protocol3=protocol2;protocol3.replace(0,14,"FOTO_DEVELOP_3");protocol3+="1 215 72 -24 83\n";
    std::istringstream newest(protocol3);const auto extended=lenslabs::read_develop_protocol(newest);
    check(extended.tonal_grading&&extended.global_grade.hue==215&&extended.global_grade.saturation==72&&extended.global_grade.luminance==-24&&extended.grain_luminance==83,"Protocol3 round trips grading mode, global wheel and adaptive grain.");
    for(const auto& loaded:{old,upgraded,extended})
      check(loaded.sharpening_radius==1&&loaded.sharpening_detail==100&&loaded.sharpening_masking==0,"Protocols1–3 preserve exact legacy sharpening defaults.");
    auto protocol4=protocol3;protocol4.replace(0,14,"FOTO_DEVELOP_4");protocol4+="1.75 35 80\n";
    std::istringstream latest(protocol4);const auto detailed=lenslabs::read_develop_protocol(latest);
    check(detailed.sharpening_radius==1.75&&detailed.sharpening_detail==35&&detailed.sharpening_masking==80,"Protocol4 round trips all extended sharpening controls.");
    for(const auto& loaded:{old,upgraded,extended,detailed})check(loaded.curve_interpolation==0,"Protocols1–4 preserve exact linear curve defaults.");
    for(int mode:{0,1}) {
      auto protocol5=protocol4;protocol5.replace(0,14,"FOTO_DEVELOP_5");protocol5+=std::to_string(mode)+"\n";
      std::istringstream input(protocol5);const auto smoothed=lenslabs::read_develop_protocol(input);
      check(smoothed.curve_interpolation==mode&&smoothed.sharpening_radius==1.75&&smoothed.global_grade.saturation==72,"Protocol5 adds a strict interpolation flag without losing previous controls.");
    }
    for(const auto& tail:{"", "-1", "2", "0.5", "nan", "1 extra"}) {
      auto invalid=protocol4;invalid.replace(0,14,"FOTO_DEVELOP_5");invalid+=tail;
      rejects([&]{std::istringstream input(invalid);lenslabs::read_develop_protocol(input);},"Protocol5 rejects missing, unsupported, fractional and trailing interpolation flags.");
    }
    for(const auto& tail:{"", "1 100", ".49 100 0", "3.01 100 0", "1 -1 0", "1 101 0", "1 100 -1", "1 100 101", "nan 100 0", "1 100 0 extra"}) {
      auto invalid=protocol3;invalid.replace(0,14,"FOTO_DEVELOP_4");invalid+=tail;
      rejects([&]{std::istringstream input(invalid);lenslabs::read_develop_protocol(input);},"Protocol4 rejects truncated, invalid, non-finite and trailing fields.");
    }
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
    check(!lenslabs::is_neutral_develop(s),"Cropping cannot take the no-op path.");
    check(cropped.width==16&&cropped.height==12,"Normalized crop dimensions.");
    s=neutral;s.crop.rotate=90;auto rotated=lenslabs::develop(source,s);
    check(!lenslabs::is_neutral_develop(s),"Rotation cannot take the no-op path.");
    check(rotated.width==24&&rotated.height==32,"Quarter turn swaps dimensions.");
    check(rotated.rgba[0]==original[(source.height-1)*source.width*4],"Quarter turn maps pixels correctly.");
    s=neutral;s.crop.flip_x=true;auto flipped=lenslabs::develop(source,s);
    check(!lenslabs::is_neutral_develop(s),"Horizontal flip cannot take the no-op path.");
    check(flipped.rgba[0]==original[(source.width-1)*4],"Horizontal flip maps pixels correctly.");
    s=neutral;s.crop.flip_y=true;auto flip_y=lenslabs::develop(source,s);
    check(!lenslabs::is_neutral_develop(s),"Vertical flip cannot take the no-op path.");
    check(flip_y.rgba[0]==original[(source.height-1)*source.width*4],"Vertical flip maps pixels correctly.");
    s=neutral;s.crop.angle=45;check(lenslabs::develop(source,s).rgba.size()==original.size(),"Straighten has bounded dimensions.");
    check(!lenslabs::is_neutral_develop(s),"Straighten cannot take the no-op path.");
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
