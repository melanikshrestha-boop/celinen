#include "lenslabs/social.hpp"
#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>
int main() {
  unsigned checks = 0;
  const auto check = [&](bool ok) { ++checks; if (!ok) throw std::runtime_error("Social frame assertion failed at " + std::to_string(checks)); };
  lenslabs::Image source{8,4,8,4,std::vector<std::uint8_t>(8*4*4,255)};
  for (unsigned y=0;y<4;y++) for (unsigned x=0;x<8;x++) { const auto i=(y*8+x)*4; source.rgba[i]=x<4?255:0; source.rgba[i+1]=0; source.rgba[i+2]=x<4?0:255; }
  const auto original = source.rgba;
  lenslabs::SocialFrame frame;
  for (const auto format : {lenslabs::SocialFormat::portrait,lenslabs::SocialFormat::square,lenslabs::SocialFormat::story}) {
    frame.format=format;
    for (const bool fit : {false,true}) {
      frame.fit=fit;
      for (const double position : {0.0,0.5,1.0}) {
        frame.x=position; frame.y=position;
        const auto result=lenslabs::frame_social(source,frame);
        check(result.width==1080);
        check(result.height==(format==lenslabs::SocialFormat::story?1920u:format==lenslabs::SocialFormat::portrait?1350u:1080u));
        check(result.rgba.size()==std::size_t(result.width)*result.height*4);
        check(source.rgba==original);
        for (std::size_t i=3;i<result.rgba.size();i+=4096) check(result.rgba[i]==255);
      }
    }
  }
  frame={}; frame.format=lenslabs::SocialFormat::square; frame.x=0;
  auto left=lenslabs::frame_social(source,frame); frame.x=1;
  auto right=lenslabs::frame_social(source,frame);
  check(left.rgba[0]==255 && right.rgba[(540*1080+540)*4+2]==255);
  frame.fit=true; frame.x=frame.y=.5; frame.background=255;
  auto fitted=lenslabs::frame_social(source,frame);
  check(fitted.rgba[0]==255 && fitted.rgba[1]==255 && fitted.rgba[2]==255);
  frame.background=0;
  fitted=lenslabs::frame_social(source,frame); check(fitted.rgba[0]==0 && fitted.rgba[1]==0);
  for (double bad : {-1.0,2.0,std::numeric_limits<double>::infinity(),std::numeric_limits<double>::quiet_NaN()}) {
    frame={}; frame.x=bad;
    bool threw=false; try { lenslabs::frame_social(source,frame); } catch (...) { threw=true; } check(threw);
  }
  frame={}; frame.fit=true; frame.zoom=2;
  bool threw=false; try { lenslabs::frame_social(source,frame); } catch (...) { threw=true; } check(threw);
  source.rgba.pop_back(); frame={};
  threw=false; try { lenslabs::frame_social(source,frame); } catch (...) { threw=true; } check(threw);
  std::cout<<checks<<" social framing checks passed\n";
}
