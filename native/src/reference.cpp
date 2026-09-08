#include "lenslabs/reference.hpp"
#include <algorithm>
#include <cmath>
#include <numeric>
#include <stdexcept>

namespace lenslabs {
namespace {
double luminance(const Image& image, std::size_t p) {
  return (.2126 * image.rgba[p*4] + .7152 * image.rgba[p*4+1] + .0722 * image.rgba[p*4+2]) / 255.;
}
void validate(const Image& image) {
  if(image.width<16 || image.height<16 || image.width>128 || image.height>128 ||
     image.rgba.size()!=std::size_t(image.width)*image.height*4)
    throw std::invalid_argument("Choose aligned previews between 16 and 128 pixels per side.");
  for(std::size_t i=3;i<image.rgba.size();i+=4)
    if(image.rgba[i]!=255) throw std::invalid_argument("Reference previews must be opaque.");
}
double correlation(const Image& a, const Image& b) {
  double x=0,y=0,xx=0,yy=0,xy=0;
  const auto n=std::size_t(a.width)*a.height;
  for(std::size_t p=0;p<n;++p) { const auto av=luminance(a,p),bv=luminance(b,p);x+=av;y+=bv;xx+=av*av;yy+=bv*bv;xy+=av*bv; }
  const auto vx=xx-x*x/n,vy=yy-y*y/n;
  if(vx<1e-5*n || vy<1e-5*n) return 0; // No evidence of shared spatial structure.
  return std::clamp((xy-x*y/n)/std::sqrt(vx*vy),-1.,1.);
}
double gradient_correlation(const Image& a, const Image& b) {
  double cross=0,aa=0,bb=0;
  for(unsigned y=1;y+1<a.height;++y) for(unsigned x=1;x+1<a.width;++x) {
    const auto p=std::size_t(y)*a.width+x;
    const double ax=luminance(a,p+1)-luminance(a,p-1),ay=luminance(a,p+a.width)-luminance(a,p-a.width);
    const double bx=luminance(b,p+1)-luminance(b,p-1),by=luminance(b,p+b.width)-luminance(b,p-b.width);
    cross+=ax*bx+ay*by;aa+=ax*ax+ay*ay;bb+=bx*bx+by*by;
  }
  return aa<1e-6||bb<1e-6 ? 0 : std::clamp(cross/std::sqrt(aa*bb),-1.,1.);
}
Image sample(const Image& image, bool held_out) {
  std::vector<std::size_t> candidates;
  for(unsigned y=0;y<image.height;++y) for(unsigned x=0;x<image.width;++x)
    if(bool((x+y)%2)==held_out) candidates.push_back(std::size_t(y)*image.width+x);
  const auto count=std::min(std::size_t(1024),candidates.size());
  Image output{unsigned(count),1,unsigned(count),1,{}};output.rgba.reserve(count*4);
  // Disjoint checkerboard sets, deterministically subsampled; no spatial controls are fit.
  for(std::size_t i=0;i<count;++i) {
    const auto offset=candidates[i*candidates.size()/count]*4;
    output.rgba.insert(output.rgba.end(),image.rgba.begin()+offset,image.rgba.begin()+offset+4);
  }
  return output;
}
double mse(const Image& a,const Image& b,bool robust=false) {
  double sum=0;
  for(std::size_t p=0;p<a.rgba.size();p+=4) for(unsigned c=0;c<3;++c) {
    const double d=(double(a.rgba[p+c])-b.rgba[p+c])/255.,v=std::abs(d);
    // Huber loss limits influence of local retouching/clipped outliers; no external optimizer.
    sum+=robust&&v>.08 ? .16*v-.0064 : d*d;
  }
  return sum/(a.rgba.size()/4*3);
}
bool monotone(const std::vector<CurvePoint>& c) {
  for(std::size_t i=1;i<c.size();++i) if(c[i].y<c[i-1].y) return false;
  return true;
}
bool monotone(const DevelopSettings& s) {
  return monotone(s.curve)&&std::all_of(s.channel_curves.begin(),s.channel_curves.end(),[](const auto& c){return monotone(c);});
}
struct Parameter { std::function<double&(DevelopSettings&)> get;double step,low,high; };
} // namespace

ReferenceFit fit_reference(const Image& neutral,const Image& edited,const std::function<bool()>& cancelled) {
  const auto check=[&]{if(cancelled&&cancelled()) throw std::runtime_error("Reference fit cancelled.");};
  check();validate(neutral);validate(edited);
  if(neutral.width!=edited.width||neutral.height!=edited.height)
    throw std::invalid_argument("Reference frames must have the same crop and orientation.");
  ReferenceFit result;result.settings.tonal_grading=true;
  result.alignment=correlation(neutral,edited);result.gradient_alignment=gradient_correlation(neutral,edited);
  if(result.alignment<.3 || result.gradient_alignment<.15)
    throw std::invalid_argument("The pair has insufficient matching detail. Use the same frame and crop without borders or watermarks.");
  result.weak_alignment=result.alignment<.8 || result.gradient_alignment<.65;
  const auto original=sample(neutral,false),target=sample(edited,false);
  const auto validation=sample(neutral,true),validation_target=sample(edited,true);
  result.fit_pixels=original.width*original.height;result.validation_pixels=validation.width*validation.height;
  const double baseline=mse(validation,validation_target);
  result.before_rmse=std::sqrt(baseline);
  unsigned clipped=0;
  for(std::size_t p=0;p<edited.rgba.size();p+=4)
    if(edited.rgba[p]<=2||edited.rgba[p+1]<=2||edited.rgba[p+2]<=2||edited.rgba[p]>=253||edited.rgba[p+1]>=253||edited.rgba[p+2]>=253) ++clipped;
  result.clipped_fraction=double(clipped)/(edited.width*edited.height);
  DevelopSettings best=result.settings;
  for(auto* curve:{&best.curve,&best.channel_curves[0],&best.channel_curves[1],&best.channel_curves[2]})
    *curve={{0,0},{.25,.25},{.5,.5},{.75,.75},{1,1}};
  auto score=[&](const DevelopSettings& s) { check();++result.evaluations;return mse(develop(original,s),target,true); };
  double best_score=score(best);
  // Keep exposure/temperature/tint neutral: RAW applies those before RGB conversion.
  // Tone and white-balance appearance are approximated by post-neutral curves instead.
  std::vector<Parameter> parameters;
  for(auto member:{&DevelopSettings::contrast,&DevelopSettings::shadows,&DevelopSettings::highlights,&DevelopSettings::blacks,&DevelopSettings::whites,&DevelopSettings::saturation})
    parameters.push_back({[member](DevelopSettings& s)->double&{return s.*member;},16,-80,80});
  for(int channel=-1;channel<3;++channel) for(unsigned point=0;point<5;++point)
    parameters.push_back({[channel,point](DevelopSettings& s)->double&{return (channel<0?s.curve:s.channel_curves[channel])[point].y;},.08,point==4?.75:0,point==0?.25:1});
  // Coarse hue search bootstraps optional global/shadow/highlight color grades.
  for(auto member:{&DevelopSettings::global_grade,&DevelopSettings::shadow_grade,&DevelopSettings::highlight_grade}) {
    for(int hue=0;hue<360;hue+=45) {
      auto trial=best;(trial.*member)={double(hue),12,0};const auto loss=score(trial);
      if(loss<best_score) {best=trial;best_score=loss;}
    }
    parameters.push_back({[member](DevelopSettings& s)->double&{return (s.*member).saturation;},8,0,60});
    parameters.push_back({[member](DevelopSettings& s)->double&{return (s.*member).hue;},24,0,360});
  }
  for(double scale:{1.,.5,.25,.125,.0625}) for(unsigned pass=0;pass<2;++pass) {
    for(const auto& parameter:parameters) for(double sign:{-1.,1.}) {
      auto trial=best;auto& v=parameter.get(trial);v=std::clamp(v+sign*parameter.step*scale,parameter.low,parameter.high);
      if(v==parameter.get(best)||!monotone(trial)) continue;
      const auto loss=score(trial);
      if(loss+1e-10<best_score) {best=trial;best_score=loss;}
    }
  }
  check();const auto fitted=develop(validation,best);const auto after=mse(fitted,validation_target);
  // A robust training fit is never returned if it worsens held-out squared pixel error.
  if(after<baseline) {result.settings=best;result.after_rmse=std::sqrt(after);}
  else result.after_rmse=result.before_rmse;
  result.improvement=result.before_rmse>1e-9 ? 1-result.after_rmse/result.before_rmse : 0;
  result.poor_fit=result.after_rmse>.08 || (result.before_rmse>.02 && result.improvement<.15);
  validate_develop(result.settings);return result;
}
} // namespace lenslabs
