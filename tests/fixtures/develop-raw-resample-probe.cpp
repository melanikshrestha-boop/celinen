// Include the implementation in this test TU so the resampler stays private.
#include "../../native/src/develop_raw.cpp"
#include <iostream>
#include <stdexcept>
#include <string>

namespace {
std::uint64_t cases=0,compared_bytes=0;
std::uint32_t seed=0x8371a2b9;
std::uint32_t random_u32() {seed^=seed<<13;seed^=seed>>17;seed^=seed<<5;return seed;}
void require(bool condition,const char* message) {if(!condition) throw std::runtime_error(message);}

// Literal pre-optimization integration order and rounding. Deliberately avoid
// the production table and 1:1 bypass: this is an independent output oracle.
void legacy(const unsigned char* rgb,int width,int height,lenslabs::Image& result) {
  for(unsigned y=0;y<result.height;++y) for(unsigned x=0;x<result.width;++x) {
    const double left=double(x)*width/result.width,right=double(x+1)*width/result.width;
    const double top=double(y)*height/result.height,bottom=double(y+1)*height/result.height;
    std::array<double,3> sum{};double total=0;
    for(int sy=int(top);sy<std::min(height,int(std::ceil(bottom)));++sy) for(int sx=int(left);sx<std::min(width,int(std::ceil(right)));++sx) {
      const double weight=(std::min(right,double(sx+1))-std::max(left,double(sx)))*(std::min(bottom,double(sy+1))-std::max(top,double(sy)));
      for(int c=0;c<3;++c) sum[c]+=rgb[(std::size_t(sy)*width+sx)*3+c]*weight;
      total+=weight;
    }
    const auto i=(std::size_t(y)*result.width+x)*4;
    for(int c=0;c<3;++c) result.rgba[i+c]=std::uint8_t(std::clamp(std::round(sum[c]/total),0.0,255.0));
    result.rgba[i+3]=255;
  }
}

void check(unsigned width,unsigned height,unsigned out_width,unsigned out_height,unsigned pattern) {
  const auto source_size=std::size_t(width)*height*3,output_size=std::size_t(out_width)*out_height*4;
  std::vector<unsigned char> source(source_size+32,0xA9);
  auto* rgb=source.data()+16;
  for(unsigned y=0;y<height;++y) for(unsigned x=0;x<width;++x) for(unsigned c=0;c<3;++c) {
    unsigned value=0;
    switch(pattern%7) {
      case 0:value=0;break;
      case 1:value=255;break;
      case 2:value=((x+y+c)%2)*255;break;
      case 3:value=(x+3*y+53*c)%256;break;
      case 4:value=random_u32()%256;break;
      // Exact .5 averages and neighbours expose changed summation/rounding.
      case 5:value=126+(x+y+c)%4;break;
      case 6:value=(x==width/2||y==height/2)?255:17*c;break;
    }
    rgb[(std::size_t(y)*width+x)*3+c]=static_cast<unsigned char>(value);
  }
  const auto original=source;
  lenslabs::Image actual{out_width,out_height,width,height,{}};
  actual.rgba.resize(output_size+32,0xCA);
  auto expected=actual;
  legacy(rgb,int(width),int(height),expected);
  lenslabs::resample_raw_rgb(rgb,int(width),int(height),actual);
  if(actual.rgba!=expected.rgba)
    throw std::runtime_error("Output mismatch "+std::to_string(width)+"x"+std::to_string(height)+" -> "+std::to_string(out_width)+"x"+std::to_string(out_height)+" pattern "+std::to_string(pattern));
  require(source==original,"Resampler changed its input bytes");
  require(actual.width==out_width&&actual.height==out_height,"Resampler changed dimensions");
  for(std::size_t i=3;i<output_size;i+=4) require(actual.rgba[i]==255,"Output is not opaque");
  for(std::size_t i=output_size;i<actual.rgba.size();++i) require(actual.rgba[i]==0xCA,"Output tail overwritten");
  ++cases;compared_bytes+=output_size;
}
}

int main() {try {
  // Every downscale pair through 12px, including 1px axes and 1:1 copies.
  for(unsigned width=1;width<=12;++width) for(unsigned height=1;height<=12;++height)
    for(unsigned out_width=1;out_width<=width;++out_width) for(unsigned out_height=1;out_height<=height;++out_height)
      for(unsigned pattern:{2u,3u,4u,5u}) check(width,height,out_width,out_height,pattern);
  // Prime/even extents, unequal axes, near identity, thirds and very small output.
  for(unsigned width:{31u,32u,63u,64u,127u,128u,129u,255u,256u,257u,511u,512u,513u}) {
    const unsigned height=width/2+1;
    for(const auto target:std::array<std::array<unsigned,2>,5>{{{1,1},{width-1,height-1},{width/3,height/3},{width,height},{width/2,height}}})
      for(unsigned pattern=0;pattern<7;++pattern) check(width,height,target[0],target[1],pattern);
  }
  for(unsigned n=0;n<600;++n) {
    const unsigned width=1+random_u32()%257,height=1+random_u32()%257;
    const unsigned out_width=1+random_u32()%width,out_height=1+random_u32()%height;
    check(width,height,out_width,out_height,n%7);
  }
  // Large one-dimensional extents test table endpoints without a large image.
  for(unsigned extent:{4095u,4096u,4097u,6024u,8191u,8192u,8193u,16383u,65535u})
    for(unsigned count:{1u,31u,32u,257u,1600u,4096u,8192u}) if(count<=extent)
      for(unsigned pattern:{2u,4u,5u}) {check(extent,1,count,1,pattern);check(1,extent,1,count,pattern);}
  std::cout<<"{\"cases\":"<<cases<<",\"comparedBytes\":"<<compared_bytes<<",\"exact\":true,\"sourcePreserved\":true,\"alphaOpaque\":true}\n";
  return 0;
} catch(const std::exception& error) {std::cerr<<error.what()<<'\n';return 1;}}
