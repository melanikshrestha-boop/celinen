#include "lenslabs/object_remove.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <deque>
#include <limits>
#include <stdexcept>

namespace lenslabs {
std::vector<std::uint8_t> remove_object_texture(const std::vector<std::uint8_t>& rgba,
    const std::vector<std::uint8_t>& mask, unsigned width, unsigned height) {
  const std::size_t count = std::size_t(width)*height;
  if(width<16 || height<16 || width>4096 || height>4096 || rgba.size()!=count*4 || mask.size()!=count)
    throw std::invalid_argument("Invalid removal image.");
  const auto selected=std::count_if(mask.begin(),mask.end(),[](auto v){return v!=0;});
  if(selected<1 || std::size_t(selected)*2>count)
    throw std::invalid_argument("Select an object covering no more than half the image.");
  const double scale=std::min(1.0,640.0/std::max(width,height));
  const int w=std::max(16,int(std::round(width*scale))),h=std::max(16,int(std::round(height*scale)));
  const int n=w*h,r=3;
  std::vector<std::array<float,3>> source(n),out(n);
  std::vector<unsigned char> hole(n),unknown(n),queued(n);
  std::vector<int> donor(n,-1);
  for(int y=0;y<h;y++) for(int x=0;x<w;x++) {
    const int p=y*w+x, sx=std::min(int(width)-1,int((x+.5)*width/w)),sy=std::min(int(height)-1,int((y+.5)*height/h));
    for(int c=0;c<3;c++) source[p][c]=rgba[(std::size_t(sy)*width+sx)*4+c];
    out[p]=source[p];
    // Conservative reduction: a thin selected strand cannot disappear between samples.
    for(int yy=int(y*height/h);yy<std::min(int(height),int((y+1)*height/h)+1);yy++)
      for(int xx=int(x*width/w);xx<std::min(int(width),int((x+1)*width/w)+1);xx++)
        if(mask[std::size_t(yy)*width+xx]) hole[p]=1;
    unknown[p]=hole[p];
  }
  std::vector<int> integral((w+1)*(h+1));
  for(int y=0;y<h;y++) for(int x=0;x<w;x++)
    integral[(y+1)*(w+1)+x+1]=hole[y*w+x]+integral[y*(w+1)+x+1]+integral[(y+1)*(w+1)+x]-integral[y*(w+1)+x];
  auto rect=[&](int x,int y){return integral[(y+r+1)*(w+1)+x+r+1]-integral[(y-r)*(w+1)+x+r+1]-integral[(y+r+1)*(w+1)+x-r]+integral[(y-r)*(w+1)+x-r];};
  std::vector<int> candidates;
  for(int y=r;y<h-r;y++) for(int x=r;x<w-r;x++) if(rect(x,y)==0)candidates.push_back(y*w+x);
  if(candidates.empty()) throw std::runtime_error("Not enough unselected background for a texture fill.");
  std::deque<int> front;
  auto enqueue=[&](int x,int y){if(x>=0&&x<w&&y>=0&&y<h){int p=y*w+x;if(unknown[p]&&!queued[p]){queued[p]=1;front.push_back(p);}}};
  for(int y=0;y<h;y++)for(int x=0;x<w;x++)if(!unknown[y*w+x]){enqueue(x-1,y);enqueue(x+1,y);enqueue(x,y-1);enqueue(x,y+1);}
  std::uint32_t random=0x91af73u;
  auto next=[&](){random^=random<<13;random^=random>>17;random^=random<<5;return random;};
  while(!front.empty()) {
    const int p=front.front();front.pop_front();if(!unknown[p])continue;
    const int x=p%w,y=p/w;
    int best=-1;double bestCost=std::numeric_limits<double>::infinity();
    auto consider=[&](int q) {
      if(q<0||q>=n)return;
      const int qx=q%w,qy=q/w;
      if(qx<r||qy<r||qx>=w-r||qy>=h-r||rect(qx,qy))return;
      double cost=0,weight=0;
      for(int dy=-r;dy<=r;dy++)for(int dx=-r;dx<=r;dx++) {
        if(x+dx<0||x+dx>=w||y+dy<0||y+dy>=h)continue;
        const int t=(y+dy)*w+x+dx;if(unknown[t])continue;
        const double wt=hole[t]?.35:1.0;
        for(int c=0;c<3;c++){const double d=out[t][c]-source[q+dy*w+dx][c];cost+=wt*d*d;}
        weight+=wt;
      }
      if(weight<1)return;
      cost=cost/weight+.0005*((qx-x)*(qx-x)+(qy-y)*(qy-y));
      if(cost<bestCost){bestCost=cost;best=q;}
    };
    // Coherent offsets keep lines/textures together. Random exploration avoids a single stretched edge.
    for(auto [dx,dy]:std::array<std::array<int,2>,4>{{{{-1,0}},{{1,0}},{{0,-1}},{{0,1}}}}) {
      const int xx=x+dx,yy=y+dy;
      if(xx>=0&&xx<w&&yy>=0&&yy<h&&donor[yy*w+xx]>=0)consider(donor[yy*w+xx]-dy*w-dx);
    }
    for(int k=0;k<96;k++)consider(candidates[next()%candidates.size()]);
    if(best<0)throw std::runtime_error("Could not reconstruct this selection.");
    for(int dy=-2;dy<=2;dy++)for(int dx=-2;dx<=2;dx++) {
      const int xx=x+dx,yy=y+dy;
      if(xx<0||xx>=w||yy<0||yy>=h)continue;
      const int t=yy*w+xx;if(!unknown[t])continue;
      donor[t]=best+dy*w+dx;out[t]=source[donor[t]];unknown[t]=0;
      enqueue(xx-1,yy);enqueue(xx+1,yy);enqueue(xx,yy-1);enqueue(xx,yy+1);
    }
  }
  auto result=rgba;
  for(unsigned y=0;y<height;y++)for(unsigned x=0;x<width;x++) {
    const auto p=std::size_t(y)*width+x;if(!mask[p])continue;
    const int xx=std::min(w-1,int(std::uint64_t(x)*w/width)), yy=std::min(h-1,int(std::uint64_t(y)*h/height)), t=yy*w+xx;
    if(donor[t]<0)throw std::runtime_error("Incomplete texture fill.");
    int sx=std::clamp(int(x)+int(std::round((donor[t]%w-xx)*double(width)/w)),0,int(width)-1);
    int sy=std::clamp(int(y)+int(std::round((donor[t]/w-yy)*double(height)/h)),0,int(height)-1);
    auto q=std::size_t(sy)*width+sx;
    // Never sample any selected original pixels at the high-resolution donor edge.
    if(mask[q]) {
      sx=std::clamp(int((donor[t]%w+.5)*width/w),0,int(width)-1);
      sy=std::clamp(int((donor[t]/w+.5)*height/h),0,int(height)-1);q=std::size_t(sy)*width+sx;
      if(mask[q])throw std::runtime_error("Selected object overlaps the reconstruction source.");
    }
    for(int c=0;c<3;c++)result[p*4+c]=rgba[q*4+c];
  }
  return result;
}
}
