#include "lenslabs/reference.hpp"
#include <algorithm>
#include <cmath>
#include <iostream>
#include <stdexcept>

namespace {
unsigned checks=0;
void check(bool ok,const char* why){++checks;if(!ok)throw std::runtime_error(why);}
lenslabs::Image fixture() {
  lenslabs::Image image{64,48,64,48,{}};image.rgba.resize(64*48*4);
  for(unsigned y=0;y<48;++y)for(unsigned x=0;x<64;++x){
    const double v=.1+.7*(.45*x/63.+.3*y/47.+.25*(std::sin(x*.36)*std::cos(y*.27)+1)/2);
    const auto p=(y*64+x)*4;image.rgba[p]=std::uint8_t(std::clamp(v+.1*std::sin(y*.18),0.,1.)*255);
    image.rgba[p+1]=std::uint8_t(v*255);image.rgba[p+2]=std::uint8_t(std::clamp(v+.1*std::cos(x*.21),0.,1.)*255);image.rgba[p+3]=255;
  }return image;
}
template<class F>void rejects(F fn){bool bad=false;try{fn();}catch(...){bad=true;}check(bad,"Expected rejection");}
}
int main(){try{
  const auto source=fixture();const auto bytes=source.rgba;
  auto neutral=lenslabs::fit_reference(source,source);
  check(neutral.before_rmse==0&&neutral.after_rmse==0,"Neutral must not invent error");
  check(lenslabs::develop(source,neutral.settings).rgba==bytes,"Neutral must not invent edits");
  for(unsigned variant=0;variant<3;++variant){
    lenslabs::DevelopSettings edit;edit.tonal_grading=true;
    if(variant==0){edit.contrast=20;edit.shadows=22;edit.highlights=-18;edit.saturation=-20;}
    if(variant==1){edit.temperature=27;edit.tint=-15;edit.curve={{0,.025},{.25,.19},{.75,.83},{1,1}};}
    if(variant==2){edit.shadow_grade={220,23,0};edit.highlight_grade={40,18,0};edit.global_grade={20,8,0};}
    const auto target=lenslabs::develop(source,edit);const auto fit=lenslabs::fit_reference(source,target);
    std::cout<<"variant "<<variant<<" before="<<fit.before_rmse<<" after="<<fit.after_rmse<<" improvement="<<fit.improvement<<" evaluations="<<fit.evaluations<<'\n';
    check(fit.improvement>.5,"Fit must reduce held-out RGB RMSE by more than 50%");
    check(fit.after_rmse<.04,"Fit residual must be bounded");
    check(fit.evaluations<1000,"Evaluation budget must be bounded");
    check(fit.settings.exposure==0&&fit.settings.temperature==0&&fit.settings.tint==0,"Portable RAW fit must not infer pre-RGB settings");
    check(fit.settings.masks.empty()&&fit.settings.crop.width==1&&fit.settings.noise_reduction==0,"Look must not infer local or crop edits");
    check(source.rgba==bytes,"Original bytes unchanged");
  }
  auto changed=source;for(unsigned y=0;y<source.height;++y)for(unsigned x=0;x<source.width;++x)for(unsigned c=0;c<4;++c)changed.rgba[(y*source.width+x)*4+c]=source.rgba[(y*source.width+(x+27)%source.width)*4+c];
  rejects([&]{lenslabs::fit_reference(source,changed);});
  auto overfit=source;
  for(unsigned y=0;y<source.height;++y)for(unsigned x=0;x<source.width;++x)for(unsigned c=0;c<3;++c) {
    const auto p=(y*source.width+x)*4+c;overfit.rgba[p]=std::uint8_t(std::clamp(int(source.rgba[p])+((x+y)%2?-20:20),0,255));
  }
  const auto withheld=lenslabs::fit_reference(source,overfit);
  check(withheld.after_rmse==withheld.before_rmse,"A fit that worsens held-out pixels must be withheld");
  check(withheld.improvement==0&&withheld.poor_fit,"Unsupported alternating edits must remain poor-fit, not confidence");
  check(lenslabs::develop(source,withheld.settings).rgba==source.rgba,"Worse validation fit returns neutral recipe");
  auto small=source;small.width=0;rejects([&]{lenslabs::fit_reference(small,source);});
  auto transparent=source;transparent.rgba[3]=0;rejects([&]{lenslabs::fit_reference(transparent,source);});
  auto flat=source;std::fill(flat.rgba.begin(),flat.rgba.end(),255);rejects([&]{lenslabs::fit_reference(flat,flat);});
  unsigned polls=0;rejects([&]{lenslabs::fit_reference(source,source,[&]{return ++polls>4;});});check(polls==5,"Cancellation during optimization is checked");
  std::cout<<checks<<" reference fit assertions passed\n";return 0;
}catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}
