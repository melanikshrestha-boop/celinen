#include "lenslabs/crop_suggest.hpp"
#include <algorithm>
#include <cmath>
#include <numeric>
#include <stdexcept>

namespace lenslabs {
CropSuggestion suggest_crop(const Image& image,double aspect) {
  const auto w=image.width,h=image.height;
  if(w<16||h<16||w>384||h>384||image.rgba.size()!=std::size_t(w)*h*4)
    throw std::invalid_argument("Crop analysis requires a 16–384 pixel preview.");
  if(!std::isfinite(aspect)||(aspect!=0&&(aspect<.25||aspect>4)))
    throw std::invalid_argument("Invalid crop aspect.");
  CropSuggestion result;result.width=w;result.height=h;
  const std::size_t n=std::size_t(w)*h;
  std::vector<double> gray(n),vertical(n),saliency(n);
  double transparent=0;
  for(std::size_t i=0;i<n;++i) {
    gray[i]=(.2126*image.rgba[i*4]+.7152*image.rgba[i*4+1]+.0722*image.rgba[i*4+2])/255;
    transparent+=image.rgba[i*4+3]<250;
  }
  if(transparent/n>.01) {
    result.reasons.push_back("Transparent previews need a manual crop.");return result;
  }
  const double mean=std::accumulate(gray.begin(),gray.end(),0.0)/n;
  double energy=0;
  for(unsigned y=1;y+1<h;++y)for(unsigned x=1;x+1<w;++x) {
    const auto i=std::size_t(y)*w+x;
    const double gx=(gray[i+1-w]+2*gray[i+1]+gray[i+1+w]-gray[i-1-w]-2*gray[i-1]-gray[i-1+w])/8;
    const double gy=(gray[i+w-1]+2*gray[i+w]+gray[i+w+1]-gray[i-w-1]-2*gray[i-w]-gray[i-w+1])/8;
    vertical[i]=gy;
    saliency[i]=std::hypot(gx,gy)+.08*std::abs(gray[i]-mean);
    energy+=saliency[i];
  }
  if(energy/n<.001) {
    result.reasons.push_back("Not enough visible structure for a reliable suggestion.");return result;
  }
  // A small bounded Hough-style scan: support must span the frame, not merely
  // be the strongest edge on one object. This cannot identify a real horizon.
  constexpr unsigned samples=48;
  double best_score=0,best_angle=0,best_coverage=0;
  for(int step=-32;step<=32;++step) {
    const double angle=step*.25,slope=std::tan(angle*3.14159265358979323846/180);
    for(unsigned row=unsigned(h*.18);row<unsigned(h*.82);++row) {
      double sum=0;unsigned positive=0,negative=0;
      for(unsigned sample=0;sample<samples;++sample) {
        const unsigned x=unsigned((.08+.84*sample/(samples-1))*w);
        const double position=row+slope*(x-double(w)/2);
        const int y=int(std::floor(position));
        double edge=0;
        if(y>=2&&y+2<int(h)) {
          const double fraction=position-y;
          edge=vertical[std::size_t(y)*w+x]*(1-fraction)+vertical[std::size_t(y+1)*w+x]*fraction;
        }
        sum+=std::clamp(edge,-.3,.3);positive+=edge>.035;negative+=edge<-.035;
      }
      const double coverage=double(std::max(positive,negative))/samples;
      const double score=std::abs(sum)/samples*coverage;
      if(score>best_score+1e-6||(std::abs(score-best_score)<=1e-6&&std::abs(angle)<std::abs(best_angle))) {
        best_score=score;best_angle=angle;best_coverage=coverage;
      }
    }
  }
  result.horizon_angle=best_angle;result.horizon_coverage=best_coverage;
  bool changed=false;
  if(best_coverage>=.85&&best_score>.055&&std::abs(best_angle)>=.5&&std::abs(best_angle)<7.75) {
    result.crop.angle=best_angle;changed=true;
    result.reasons.push_back("A strong near-horizontal edge spans the preview; check that it should be level.");
  } else result.reasons.push_back("No confident tilt correction; the angle is unchanged.");

  if(aspect) {
    const double relative=aspect/(double(w)/h);
    const double cw=std::min(1.0,relative),ch=std::min(1.0,1/relative),area=cw*ch;
    if(area<.7) {
      result.reasons.push_back("That aspect would remove over 30% of the frame; choose the crop manually.");
    } else if(area<.995) {
      // One dimension remains full-size. Prefix sums let each candidate retain
      // actual edge/contrast energy without interpreting people or objects.
      const bool horizontal=cw<1;
      const unsigned length=horizontal?w:h,window=std::max(1u,unsigned(std::round(length*(horizontal?cw:ch))));
      std::vector<double> prefix(length+1,0);
      for(unsigned y=0;y<h;++y)for(unsigned x=0;x<w;++x)prefix[(horizontal?x:y)+1]+=saliency[std::size_t(y)*w+x];
      for(unsigned i=1;i<=length;++i)prefix[i]+=prefix[i-1];
      unsigned best_start=(length-window)/2;double best_energy=-1;
      const double center=(length-window)/2.0;
      for(unsigned start=0;start+window<=length;++start) {
        const double retained=prefix[start+window]-prefix[start];
        const double score=retained-energy*.015*std::abs(start-center)/length;
        if(score>best_energy){best_energy=score;best_start=start;}
      }
      const double retained=(prefix[best_start+window]-prefix[best_start])/energy;
      if(retained>=.9) {
        result.crop.width=cw;result.crop.height=ch;
        if(horizontal)result.crop.x=std::min(1-cw,double(best_start)/length);
        else result.crop.y=std::min(1-ch,double(best_start)/length);
        result.saliency_retained=std::clamp(retained,0.0,1.0);result.retained_area=area;changed=true;
        result.reasons.push_back("The requested aspect keeps the strongest measured detail in frame.");
      } else result.reasons.push_back("The requested frame would cut visible detail; the full frame is retained.");
    }
  }
  // Develop fits a rotated rectangle inside the crop. Account for that actual
  // retained source polygon, not just the unrotated bounding-box area.
  const auto retention=[&]() {
    const auto& c=result.crop;
    const double radians=c.angle*3.14159265358979323846/180,co=std::cos(radians),si=std::sin(radians);
    const double width=c.width*w,height=c.height*h;
    const double scale=std::max(std::abs(co)+std::abs(si)*height/width,std::abs(co)+std::abs(si)*width/height);
    double kept=0;
    for(unsigned y=0;y<h;++y)for(unsigned x=0;x<w;++x) {
      const double dx=x+.5-(c.x+c.width*.5)*w,dy=y+.5-(c.y+c.height*.5)*h;
      if(std::abs(co*dx+si*dy)*scale<=width*.5&&std::abs(-si*dx+co*dy)*scale<=height*.5)
        kept+=saliency[std::size_t(y)*w+x];
    }
    result.retained_area=c.width*c.height/(scale*scale);
    result.saliency_retained=std::clamp(kept/energy,0.0,1.0);
  };
  retention();
  if(result.crop.angle&&(result.retained_area<.7||result.saliency_retained<.75)) {
    result.crop.angle=0;
    result.reasons.push_back("Leveling would trim too much of this frame; review the angle manually.");
    retention();changed=result.crop.width<1||result.crop.height<1;
  }
  if(changed)result.confidence=result.crop.angle&&best_coverage>=.95?"high":"medium";
  else result.reasons.push_back("Keep the original framing or make a manual adjustment.");
  return result;
}
}
