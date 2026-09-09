// Test-only direct-RGBA diagnostic: no JPEG compression, source writes or caches.
#include "lenslabs/develop.hpp"
#include <algorithm>
#include <cmath>
#include <iostream>
#include <stdexcept>

int main(int argc,char** argv) {
  try {
    if(argc!=2)return 2;
    const auto base=lenslabs::decode_raw_develop(argv[1],256,0,0,0);
    for(double amount:{-.1,-.000001,.000001,.1})for(int control=0;control<2;++control) {
      const auto image=lenslabs::decode_raw_develop(argv[1],256,0,control?0:amount,control?amount:0);
      if(image.width!=base.width||image.height!=base.height||image.rgba.size()!=base.rgba.size())throw std::runtime_error("Unexpected decode dimensions.");
      double sum=0;unsigned maximum=0,changed=0;bool alpha_preserved=true;
      for(std::size_t i=0;i<image.rgba.size();i+=4) {
        for(int c=0;c<3;++c) {
          const unsigned delta=unsigned(std::abs(int(image.rgba[i+c])-int(base.rgba[i+c])));
          sum+=delta;maximum=std::max(maximum,delta);changed+=delta!=0;
        }
        alpha_preserved&=image.rgba[i+3]==base.rgba[i+3];
      }
      std::cout<<"{\"control\":\""<<(control?"tint":"temperature")<<"\",\"amount\":"<<amount
        <<",\"width\":"<<image.width<<",\"height\":"<<image.height
        <<",\"mae\":"<<sum/(image.width*image.height*3)<<",\"maximum\":"<<maximum
        <<",\"changedChannels\":"<<changed<<",\"alphaPreserved\":"<<(alpha_preserved?"true":"false")<<"}\n";
    }
    return 0;
  } catch(const std::exception& error) {std::cerr<<error.what()<<'\n';return 1;}
}
