#include "lenslabs/develop.hpp"
#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace lenslabs {
namespace {
constexpr double pi = 3.14159265358979323846;
using Pixel = std::array<float, 3>;
double clamp(double v) { return std::clamp(v, 0.0, 1.0); }
double smooth(double v) { v = clamp(v); return v * v * (3 - 2 * v); }
double luma(const Pixel& p) { return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]; }
double linear(double v) { return v <= .04045 ? v / 12.92 : std::pow((v + .055) / 1.055, 2.4); }
double srgb(double v) { return v <= .0031308 ? v * 12.92 : 1.055 * std::pow(v, 1 / 2.4) - .055; }
void bounded(double value, double low, double high) {
  if (!std::isfinite(value) || value < low || value > high) throw std::invalid_argument("Develop value outside limits.");
}
std::array<double, 3> rgb_hsl(const Pixel& p) {
  const double high = std::max({p[0], p[1], p[2]}), low = std::min({p[0], p[1], p[2]});
  const double d = high - low, light = (high + low) / 2;
  if (d < 1e-9) return {0, 0, light};
  double h = high == p[0] ? (p[1] - p[2]) / d : high == p[1] ? 2 + (p[2] - p[0]) / d : 4 + (p[0] - p[1]) / d;
  if (h < 0) h += 6;
  return {h / 6, d / std::max(1e-9, 1 - std::abs(2 * light - 1)), light};
}
Pixel hsl_rgb(double h, double s, double l) {
  h -= std::floor(h); s = clamp(s); l = clamp(l);
  const double c = (1 - std::abs(2 * l - 1)) * s, x = c * (1 - std::abs(std::fmod(h * 6, 2) - 1)), m = l - c / 2;
  const int sector = std::min(5, static_cast<int>(h * 6));
  const std::array<Pixel, 6> colors{{{float(c), float(x), 0}, {float(x), float(c), 0}, {0, float(c), float(x)}, {0, float(x), float(c)}, {float(x), 0, float(c)}, {float(c), 0, float(x)}}};
  Pixel out = colors[sector]; for (auto& v : out) v += float(m); return out;
}
double curve_value(double v, const std::vector<CurvePoint>& points) {
  for (std::size_t i = 1; i < points.size(); ++i) if (v <= points[i].x) {
    const auto a = points[i - 1], b = points[i];
    return a.y + (b.y - a.y) * (v - a.x) / (b.x - a.x);
  }
  return points.back().y;
}
bool identity_curve(const std::vector<CurvePoint>& points) {
  return points.size()==2 && points[0].x==0 && points[0].y==0 && points[1].x==1 && points[1].y==1;
}
void validate_curve(const std::vector<CurvePoint>& points) {
  if(points.size()<2||points.size()>16||points.front().x!=0||points.back().x!=1) throw std::invalid_argument("Invalid curve.");
  for(std::size_t i=0;i<points.size();++i) {
    bounded(points[i].x,0,1);bounded(points[i].y,0,1);
    if(i && points[i].x<=points[i-1].x) throw std::invalid_argument("Curve order.");
  }
}
// Shape-preserving cubic Hermite interpolation. Slopes follow the PCHIP weighted
// harmonic mean and clipped one-sided endpoint scheme. Two points, linear mode,
// or numerically unrepresentable slopes retain the literal legacy curve path.
// Four bounded coefficient tables replace per-pixel derivative calculations.
class CompiledCurve {
 public:
  CompiledCurve(const std::vector<CurvePoint>& input,int interpolation):points(input) {
#if defined(__clang__)
#pragma clang fp contract(off)
#endif
    if(!interpolation || points.size()==2)return;
    const auto n=points.size();std::array<double,15> h{},d{};std::array<double,16> slopes{};
    for(std::size_t i=0;i+1<n;++i) {
      h[i]=points[i+1].x-points[i].x;const double dy=points[i+1].y-points[i].y;
      d[i]=dy/h[i];
      if(!std::isfinite(h[i])||h[i]<=0||!std::isfinite(d[i])||(dy!=0&&d[i]==0))return;
    }
    const auto sign=[](double v){return int(v>0)-int(v<0);};
    for(std::size_t i=1;i+1<n;++i) {
      if(d[i-1]==0||d[i]==0||sign(d[i-1])!=sign(d[i]))continue;
      const double w1=2*h[i]+h[i-1],w2=h[i]+2*h[i-1];
      const double denominator=w1/d[i-1]+w2/d[i];
      if(!std::isfinite(denominator)||denominator==0)return;
      slopes[i]=(w1+w2)/denominator;
      if(!std::isfinite(slopes[i])||slopes[i]==0)return;
    }
    const auto endpoint=[&](double h0,double h1,double d0,double d1,double& out) {
      const double numerator=(2*h0+h1)*d0-h0*d1;
      out=numerator/(h0+h1);
      if(!std::isfinite(numerator)||!std::isfinite(out))return false;
      if(sign(out)!=sign(d0))out=0;
      else if(sign(d0)!=sign(d1)&&std::abs(out)>3*std::abs(d0))out=3*d0;
      return std::isfinite(out);
    };
    if(!endpoint(h[0],h[1],d[0],d[1],slopes[0]) ||
       !endpoint(h[n-2],h[n-3],d[n-2],d[n-3],slopes[n-1]))return;
    for(std::size_t i=0;i+1<n;++i) {
      const double left=h[i]*slopes[i],right=h[i]*slopes[i+1];
      coefficients[i]={2*points[i].y-2*points[i+1].y+left+right,
        -3*points[i].y+3*points[i+1].y-2*left-right,left};
      for(auto value:coefficients[i])if(!std::isfinite(value))return;
    }
    cubic=true;
  }
  double value(double v)const {
#if defined(__clang__)
#pragma clang fp contract(off)
#endif
    if(!cubic)return curve_value(v,points);
    for(std::size_t i=1;i<points.size();++i)if(v<=points[i].x) {
      const auto a=points[i-1],b=points[i];
      if(v==a.x)return a.y;if(v==b.x)return b.y;
      const double t=(v-a.x)/(b.x-a.x);const auto& c=coefficients[i-1];
      const double result=((c[0]*t+c[1])*t+c[2])*t+a.y;
      // PCHIP already preserves segment shape; this only contains rounding at
      // an endpoint. Coefficients and normalized t have been bounded above.
      return std::clamp(result,std::min(a.y,b.y),std::max(a.y,b.y));
    }
    return points.back().y;
  }
 private:
  const std::vector<CurvePoint>& points;
  std::array<std::array<double,3>,15> coefficients{};
  bool cubic=false;
};
void saturate(Pixel& p, double amount) {
  const double y = luma(p);
  for (auto& v : p) v = float(clamp(y + (v - y) * amount));
}
void temperature(Pixel& p, double t, double tint) {
  p[0] = float(clamp(p[0] * std::exp2(t * .0035 + tint * .001)));
  p[1] = float(clamp(p[1] * std::exp2(-tint * .002)));
  p[2] = float(clamp(p[2] * std::exp2(-t * .0035 + tint * .001)));
}
// Relative looks vs Adobe Color (identity in this already-rendered working space).
void apply_profile(Pixel& p, int profile) {
  if (profile <= 0 || profile == 5) return;
  auto color = rgb_hsl(p);
  double h = color[0], s = color[1], l = color[2], hue = h * 360;
  if (profile == 1) {
    if (hue >= 60 && hue <= 180) s = clamp(s * 1.14);
    else if (hue > 180 && hue < 270) s = clamp(s * 1.12);
    l = .5 + (l - .5) * 1.10;
  } else if (profile == 2) {
    l = .5 + (l - .5) * .92;
    if (hue < 50 || hue > 330) s = clamp(s * .92);
    else if (hue >= 20 && hue <= 55) s = clamp(s * .88);
  } else if (profile == 3) {
    s = clamp(s * .90);
    l = .5 + (l - .5) * .86;
  } else if (profile == 4) {
    s = clamp(s * 1.18);
    l = .5 + (l - .5) * 1.14;
  }
  p = hsl_rgb(h, s, clamp(l));
}
void apply_black_and_white(Pixel& p, const DevelopSettings& s) {
  const std::array<double, 8> centers{0, 30, 60, 120, 180, 240, 275, 315};
  auto color = rgb_hsl(p);
  const double hue = color[0] * 360;
  double gain = 1;
  for (std::size_t c = 0; c < centers.size(); ++c) {
    double distance = std::abs(hue - centers[c]);
    distance = std::min(distance, 360 - distance);
    gain += std::max(0.0, 1 - distance / 60) * s.hsl[c].luminance / 100;
  }
  double y = clamp((0.22 * p[0] + 0.72 * p[1] + 0.06 * p[2]) * gain);
  if (s.profile == 5) y = clamp(.5 + (y - .5) * 1.12);
  p = {float(y), float(y), float(y)};
}
// The source stage receives exactly 256 possible codes per channel. This is an
// exhaustive mapping, not an interpolated or approximate color LUT. Retain both
// float rounding boundaries and the existing independent channel expressions.
std::array<Pixel,256> source_values(const DevelopSettings& s,double exposure) {
  std::array<Pixel,256> values{};
  for(std::size_t code=0;code<values.size();++code) {
    Pixel p;for(auto& v:p)v=float(code/255.0);
    if(s.exposure!=0)for(auto& v:p)v=float(clamp(srgb(linear(v)*exposure)));
    if(s.temperature!=0||s.tint!=0)temperature(p,s.temperature,s.tint);
    values[code]=p;
  }
  return values;
}
// Sliding box blur is O(pixels), bounded even at a large effect radius.
std::vector<Pixel> blur(const std::vector<Pixel>& in, unsigned w, unsigned h, int radius) {
  std::vector<Pixel> horizontal(in.size()), output(in.size());
  auto pass = [&](const std::vector<Pixel>& src, std::vector<Pixel>& dst, bool vertical) {
    const int length = int(vertical ? h : w), lines = int(vertical ? w : h);
    auto idx = [&](int line, int pos) { return vertical ? std::size_t(pos) * w + line : std::size_t(line) * w + pos; };
    for (int line = 0; line < lines; ++line) {
      std::array<double, 3> sum{};
      for (int j = -radius; j <= radius; ++j) for (int c = 0; c < 3; ++c) sum[c] += src[idx(line, std::clamp(j, 0, length - 1))][c];
      for (int pos = 0; pos < length; ++pos) {
        for (int c = 0; c < 3; ++c) dst[idx(line, pos)][c] = float(sum[c] / (radius * 2 + 1));
        for (int c = 0; c < 3; ++c) sum[c] += src[idx(line, std::clamp(pos + radius + 1, 0, length - 1))][c] - src[idx(line, std::clamp(pos - radius, 0, length - 1))][c];
      }
    }
  };
  pass(in, horizontal, false); pass(horizontal, output, true); return output;
}
// Fractional box kernel with bounded support: radius 1 is a three-tap box;
// fractional radii add continuous weights to the two outer taps. A horizontal
// row ring and at most seven vertical taps avoid a second full RGB allocation.
template<class Visitor> void fractional_blur(const std::vector<Pixel>& in,
    unsigned w, unsigned h, double radius, Visitor visit) {
  const int inner=int(std::floor(radius)), support=int(std::ceil(radius));
  const double fraction=radius-inner, divisor=2*inner+1+2*fraction;
  const unsigned rows=unsigned(2*support+1);
  std::vector<Pixel> horizontal(std::size_t(w)*rows);
  std::vector<int> row_ids(rows,-1);
  auto prepare=[&](int requested) {
    const int row=std::clamp(requested,0,int(h)-1);
    const auto slot=unsigned(row)%rows;
    if(row_ids[slot]==row)return;
    const auto source=std::size_t(row)*w, target=std::size_t(slot)*w;
    std::array<double,3> sum{};
    for(int x=-inner;x<=inner;++x)for(int c=0;c<3;++c)
      sum[c]+=in[source+unsigned(std::clamp(x,0,int(w)-1))][c];
    for(unsigned x=0;x<w;++x) {
      const auto left=unsigned(std::max(0,int(x)-inner-1)),right=std::min(w-1,x+unsigned(inner)+1);
      for(int c=0;c<3;++c) {
        horizontal[target+x][c]=float((sum[c]+fraction*(in[source+left][c]+in[source+right][c]))/divisor);
        sum[c]+=in[source+std::min(w-1,x+unsigned(inner)+1)][c]-in[source+unsigned(std::max(0,int(x)-inner))][c];
      }
    }
    row_ids[slot]=row;
  };
  for(unsigned y=0;y<h;++y) {
    for(int dy=-support;dy<=support;++dy)prepare(int(y)+dy);
    for(unsigned x=0;x<w;++x) {
      std::array<double,3> sum{};
      for(int dy=-support;dy<=support;++dy) {
        const auto row=unsigned(std::clamp(int(y)+dy,0,int(h)-1));
        const double weight=std::abs(dy)<=inner?1:fraction;
        const auto& sample=horizontal[std::size_t(row%rows)*w+x];
        for(int c=0;c<3;++c)sum[c]+=sample[c]*weight;
      }
      Pixel soft;for(int c=0;c<3;++c)soft[c]=float(sum[c]/divisor);
      visit(std::size_t(y)*w+x,x,y,soft);
    }
  }
}
double cleaned_residual(double residual, double noise_reduction) {
  return noise_reduction ? std::copysign(std::max(0.0,std::abs(residual)-noise_reduction*.001),residual) : residual;
}
// Three horizontal luminance rows and three smoothed rows are sufficient for
// the mask gradient. Avoid retaining another 144MB guide at the 36MP limit.
class SharpenGuide {
 public:
  SharpenGuide(const std::vector<Pixel>& source,unsigned width,unsigned height,bool enabled)
      : pixels(source),w(width),h(height),horizontal(enabled?std::size_t(width)*3:0),
        smoothed(enabled?std::size_t(width)*3:0) {}
  void prepare(unsigned y) { for(int offset=-1;offset<=1;++offset)output_row(int(y)+offset); }
  float at(unsigned x,unsigned y)const {return smoothed[std::size_t(y%3)*w+x];}
 private:
  const float* horizontal_row(int requested) {
    const auto y=unsigned(std::clamp(requested,0,int(h)-1)),slot=y%3;
    auto* output=horizontal.data()+std::size_t(slot)*w;
    if(horizontal_ids[slot]==int(y))return output;
    const auto row=std::size_t(y)*w;double sum=0;
    for(int x=-1;x<=1;++x)sum+=luma(pixels[row+unsigned(std::clamp(x,0,int(w)-1))]);
    for(unsigned x=0;x<w;++x) {
      output[x]=float(sum/3);
      sum+=luma(pixels[row+std::min(w-1,x+2)])-luma(pixels[row+(x?x-1:0)]);
    }
    horizontal_ids[slot]=int(y);return output;
  }
  void output_row(int requested) {
    const auto y=unsigned(std::clamp(requested,0,int(h)-1)),slot=y%3;
    if(output_ids[slot]==int(y))return;
    const auto* top=horizontal_row(int(y)-1);
    const auto* center=horizontal_row(int(y));
    const auto* bottom=horizontal_row(int(y)+1);
    for(unsigned x=0;x<w;++x)smoothed[std::size_t(slot)*w+x]=float((double(top[x])+center[x]+bottom[x])/3);
    output_ids[slot]=int(y);
  }
  const std::vector<Pixel>& pixels;
  unsigned w,h;
  std::vector<float> horizontal,smoothed;
  std::array<int,3> horizontal_ids{-1,-1,-1},output_ids{-1,-1,-1};
};
void sharpen_extended(std::vector<Pixel>& pixels, unsigned w, unsigned h, const DevelopSettings& s) {
  // Texture retains its established one-pixel residual and denoise threshold.
  // Keep its RGB buffer as the combined correction, never blur a sharpened input.
  auto corrections=s.texture ? blur(pixels,w,h,1) : std::vector<Pixel>(pixels.size());
  if(s.texture)for(std::size_t i=0;i<pixels.size();++i)for(int c=0;c<3;++c)
    corrections[i][c]=float(cleaned_residual(pixels[i][c]-corrections[i][c],s.noise_reduction)*s.texture*.007);
  // Smoothed-luminance gradients avoid treating small flat-field noise as edges.
  SharpenGuide guide(pixels,w,h,s.sharpening_masking!=0);
  // Subtract before scaling so Detail100 is exactly zero even with fused
  // multiply-add contraction; a tiny negative threshold would disable sharpening.
  const double threshold=(100-s.sharpening_detail)*.0005;
  const double masking=s.sharpening_masking*.01, low=.005+.075*masking, span=.025+.075*masking;
  fractional_blur(pixels,w,h,s.sharpening_radius,[&](std::size_t i,unsigned x,unsigned y,const Pixel& soft){
    double edge_weight=1;
    if(masking) {
      if(x==0)guide.prepare(y);
      const double dx=(guide.at(std::min(w-1,x+1),y)-guide.at(x?x-1:0,y))*.5;
      const double dy=(guide.at(x,std::min(h-1,y+1))-guide.at(x,y?y-1:0))*.5;
      edge_weight=1-masking+masking*smooth((std::sqrt(dx*dx+dy*dy)-low)/span);
    }
    for(int c=0;c<3;++c) {
      const double residual=cleaned_residual(pixels[i][c]-soft[c],s.noise_reduction);
      const double fine_weight=threshold ? smooth((std::abs(residual)-threshold*.25)/threshold) : 1;
      corrections[i][c]=float(corrections[i][c]+residual*s.sharpening*.02*fine_weight*edge_weight);
    }
  });
  for(std::size_t i=0;i<pixels.size();++i)for(int c=0;c<3;++c)
    pixels[i][c]=float(clamp(pixels[i][c]+corrections[i][c]));
}
// A bounded bilateral filter in working-space luminance. Spatial and range
// weights retain structural edges; unlike a detail cutoff, the range widens
// with strength so visible high-amplitude grain is not left wholly untouched.
// The common, gamut-bounded RGB offset leaves chroma differences unchanged.
// This is classical local denoising, not a trained RAW reconstruction model.
void denoise_luminance(std::vector<Pixel>& pixels, unsigned w, unsigned h, double amount) {
  const double strength=amount*.01, sigma=.015+.28*strength;
  std::array<float,4097> range{};
  for(std::size_t i=0;i<range.size();++i) {
    const double delta=double(i)/4096;
    range[i]=float(std::exp(-delta*delta/(2*sigma*sigma)));
  }
  std::array<float,25> spatial{};
  for(int dy=-2;dy<=2;++dy)for(int dx=-2;dx<=2;++dx)
    spatial[(dy+2)*5+dx+2]=float(std::exp(-(dx*dx+dy*dy)/4.5));
  std::vector<float> luminance(pixels.size());
  for(std::size_t i=0;i<pixels.size();++i)luminance[i]=float(luma(pixels[i]));
  for(unsigned y=0;y<h;++y)for(unsigned x=0;x<w;++x) {
    const auto i=std::size_t(y)*w+x;const float center=luminance[i];
    double sum=0,weight_sum=0;
    for(int dy=-2;dy<=2;++dy)for(int dx=-2;dx<=2;++dx) {
      const auto yy=unsigned(std::clamp(int(y)+dy,0,int(h)-1)),xx=unsigned(std::clamp(int(x)+dx,0,int(w)-1));
      const float neighbor=luminance[std::size_t(yy)*w+xx];
      const auto distance=std::min(4096u,unsigned(std::abs(neighbor-center)*4096+.5));
      const double weight=spatial[(dy+2)*5+dx+2]*range[distance];
      sum+=weight*neighbor;weight_sum+=weight;
    }
    auto& p=pixels[i];
    const double delta=std::clamp((sum/weight_sum-center)*strength,
      -double(std::min({p[0],p[1],p[2]})),1-double(std::max({p[0],p[1],p[2]})));
    for(auto& value:p)value=float(value+delta);
  }
}
double grain(unsigned x, unsigned y, double size, std::uint32_t salt = 0x9e3779b9u) {
  const unsigned gx = unsigned(std::floor(x / size)), gy = unsigned(std::floor(y / size));
  std::uint32_t v = (gx * 374761393u + gy * 668265263u + salt);
  v = (v ^ (v >> 13)) * 1274126177u; v ^= v >> 16;
  return (double(v) / std::numeric_limits<std::uint32_t>::max()) * 2 - 1;
}
// Dye-cloud chroma: keep a shared structure so it reads as grain, not RGB confetti.
// Zero color is the exact historical one-sample path.
std::array<double,3> grain_rgb(unsigned x, unsigned y, double size, double color) {
  const double shared = grain(x, y, size);
  if (color == 0) return {shared, shared, shared};
  const double mix = color * .01 * .55;
  const double nr = grain(x, y, size, 0xA24BAED5u);
  const double ng = grain(x, y, size, 0xC2B2AE35u);
  const double nb = grain(x, y, size, 0x27D4EB2Fu);
  return {shared * (1 - mix) + nr * mix + mix * .12 * ng,
          shared * (1 - mix) + ng * mix - mix * .10 * nr,
          shared * (1 - mix) + nb * mix + mix * .08 * nr};
}
bool identity_crop(const DevelopCrop& c) { return c.x == 0 && c.y == 0 && c.width == 1 && c.height == 1 && c.angle == 0 && c.rotate == 0 && !c.flip_x && !c.flip_y; }
Image geometry(const Image& in, const DevelopCrop& c) {
  if (identity_crop(c)) return in;
  const unsigned cw = std::max(1u, unsigned(std::round(in.width * c.width))), ch = std::max(1u, unsigned(std::round(in.height * c.height)));
  const bool swap = c.rotate == 90 || c.rotate == 270;
  Image out{swap ? ch : cw, swap ? cw : ch, in.source_width, in.source_height, {}};
  out.rgba.resize(std::size_t(out.width) * out.height * 4);
  const double a = c.angle * pi / 180, co = std::cos(a), si = std::sin(a);
  // Fit the rotated crop inside its uncropped rectangle, avoiding invented edge pixels.
  const double scale = std::max(std::abs(co) + std::abs(si) * ch / cw, std::abs(co) + std::abs(si) * cw / ch);
  for (unsigned y = 0; y < out.height; ++y) for (unsigned x = 0; x < out.width; ++x) {
    double u = (x + .5) / out.width, v = (y + .5) / out.height;
    if (c.rotate == 90) { const double t = u; u = v; v = 1 - t; }
    else if (c.rotate == 180) { u = 1 - u; v = 1 - v; }
    else if (c.rotate == 270) { const double t = u; u = 1 - v; v = t; }
    if (c.flip_x) u = 1 - u; if (c.flip_y) v = 1 - v;
    const double dx = (u - .5) * cw / scale, dy = (v - .5) * ch / scale;
    const double sx = std::clamp((c.x + c.width * .5) * in.width + co * dx - si * dy - .5, 0.0, double(in.width - 1));
    const double sy = std::clamp((c.y + c.height * .5) * in.height + si * dx + co * dy - .5, 0.0, double(in.height - 1));
    const unsigned x0 = unsigned(sx), y0 = unsigned(sy), x1 = std::min(x0 + 1, in.width - 1), y1 = std::min(y0 + 1, in.height - 1);
    const double fx = sx - x0, fy = sy - y0;
    for (unsigned channel = 0; channel < 4; ++channel) {
      auto val = [&](unsigned xx, unsigned yy) { return in.rgba[(std::size_t(yy) * in.width + xx) * 4 + channel]; };
      const double top = val(x0, y0) * (1 - fx) + val(x1, y0) * fx, bottom = val(x0, y1) * (1 - fx) + val(x1, y1) * fx;
      out.rgba[(std::size_t(y) * out.width + x) * 4 + channel] = std::uint8_t(std::round(top * (1 - fy) + bottom * fy));
    }
  }
  return out;
}
} // namespace

void validate_develop(const DevelopSettings& s) {
  if (s.treatment != 0 && s.treatment != 1) throw std::invalid_argument("Invalid treatment.");
  if (s.profile < 0 || s.profile > 5) throw std::invalid_argument("Invalid profile.");
  if (s.white_balance < 0 || s.white_balance > 8) throw std::invalid_argument("Invalid white balance.");
  bounded(s.exposure, -5, 5);
  for (double v : {s.contrast,s.highlights,s.shadows,s.whites,s.blacks,s.temperature,s.tint,s.saturation,s.vibrance,s.texture,s.clarity,s.dehaze,s.balance,s.vignette}) bounded(v, -100, 100);
  for (double v : {s.blending,s.grain,s.grain_luminance,s.grain_color,s.fade,s.film_falloff,s.bloom,s.halation,s.sharpening,s.noise_reduction,s.color_noise_reduction}) bounded(v, 0, 100);
  bounded(s.grain_size, .5, 4);
  bounded(s.sharpening_radius,.5,3);bounded(s.sharpening_detail,0,100);bounded(s.sharpening_masking,0,100);
  if(s.curve_interpolation!=0&&s.curve_interpolation!=1)throw std::invalid_argument("Invalid curve interpolation.");
  validate_curve(s.curve);for(const auto& curve:s.channel_curves) validate_curve(curve);
  for (const auto& h : s.hsl) { bounded(h.hue,-100,100); bounded(h.saturation,-100,100); bounded(h.luminance,-100,100); }
  for (const auto& g : {s.shadow_grade,s.midtone_grade,s.highlight_grade,s.global_grade}) { bounded(g.hue,0,360); bounded(g.saturation,0,100); bounded(g.luminance,-100,100); }
  const auto& c = s.crop; bounded(c.x,0,1); bounded(c.y,0,1); bounded(c.width,.01,1); bounded(c.height,.01,1); bounded(c.angle,-45,45);
  if (c.x + c.width > 1.000001 || c.y + c.height > 1.000001 || (c.rotate != 0 && c.rotate != 90 && c.rotate != 180 && c.rotate != 270)) throw std::invalid_argument("Invalid crop.");
  if (s.masks.size() > 12) throw std::invalid_argument("Too many masks.");
  for (const auto& m : s.masks) { bounded(m.x,0,1); bounded(m.y,0,1); bounded(m.radius,.01,2); bounded(m.aspect,.1,10); bounded(m.angle,-180,180); bounded(m.feather,0,1); bounded(m.exposure,-5,5); bounded(m.temperature,-100,100); bounded(m.saturation,-100,100); }
}

DevelopSettings read_develop_protocol(std::istream& in) {
  std::string marker; in >> marker; if (marker != "FOTO_DEVELOP_1" && marker != "FOTO_DEVELOP_2" && marker != "FOTO_DEVELOP_3" && marker != "FOTO_DEVELOP_4" && marker != "FOTO_DEVELOP_5" && marker != "FOTO_DEVELOP_6" && marker != "FOTO_DEVELOP_7") throw std::invalid_argument("Invalid Develop protocol.");
  DevelopSettings s;
  in >> s.exposure >> s.contrast >> s.highlights >> s.shadows >> s.whites >> s.blacks >> s.temperature >> s.tint >> s.saturation >> s.vibrance >> s.texture >> s.clarity >> s.dehaze;
  int count = 0; in >> count; if (count < 2 || count > 16) throw std::invalid_argument("Invalid curve count.");
  s.curve.resize(count); for (auto& p : s.curve) in >> p.x >> p.y;
  for (auto& h : s.hsl) in >> h.hue >> h.saturation >> h.luminance;
  for (auto* g : {&s.shadow_grade,&s.midtone_grade,&s.highlight_grade}) in >> g->hue >> g->saturation >> g->luminance;
  in >> s.balance >> s.blending >> s.grain >> s.grain_size >> s.fade >> s.vignette >> s.bloom >> s.halation >> s.sharpening >> s.noise_reduction >> s.color_noise_reduction;
  auto& c = s.crop; in >> c.x >> c.y >> c.width >> c.height >> c.angle >> c.rotate >> c.flip_x >> c.flip_y;
  in >> count; if (count < 0 || count > 12) throw std::invalid_argument("Invalid mask count.");
  s.masks.resize(count); for (auto& m : s.masks) in >> m.radial >> m.enabled >> m.x >> m.y >> m.radius >> m.aspect >> m.angle >> m.feather >> m.invert >> m.exposure >> m.temperature >> m.saturation;
  if(marker!="FOTO_DEVELOP_1") {
    for(auto& curve:s.channel_curves) {
      in >> count;if(count<2||count>16) throw std::invalid_argument("Invalid channel curve count.");
      curve.resize(count);for(auto& point:curve) in >> point.x >> point.y;
    }
    in >> s.film_falloff;
  }
  if(marker=="FOTO_DEVELOP_3"||marker=="FOTO_DEVELOP_4"||marker=="FOTO_DEVELOP_5"||marker=="FOTO_DEVELOP_6"||marker=="FOTO_DEVELOP_7") {
    in >> s.tonal_grading >> s.global_grade.hue >> s.global_grade.saturation >> s.global_grade.luminance >> s.grain_luminance;
  }
  if(marker=="FOTO_DEVELOP_4"||marker=="FOTO_DEVELOP_5"||marker=="FOTO_DEVELOP_6"||marker=="FOTO_DEVELOP_7")in >> s.sharpening_radius >> s.sharpening_detail >> s.sharpening_masking;
  if(marker=="FOTO_DEVELOP_5"||marker=="FOTO_DEVELOP_6"||marker=="FOTO_DEVELOP_7")in >> s.curve_interpolation;
  if(marker=="FOTO_DEVELOP_6"||marker=="FOTO_DEVELOP_7") in >> s.treatment >> s.profile >> s.white_balance;
  if(marker=="FOTO_DEVELOP_7") in >> s.grain_color;
  if (!in) throw std::invalid_argument("Truncated Develop settings.");
  in >> std::ws; if (!in.eof()) throw std::invalid_argument("Extra Develop settings.");
  validate_develop(s); return s;
}

double develop_curve_value(const std::vector<CurvePoint>& points,double value,int interpolation) {
  validate_curve(points);bounded(value,0,1);
  if(interpolation!=0&&interpolation!=1)throw std::invalid_argument("Invalid curve interpolation.");
  return CompiledCurve(points,interpolation).value(value);
}

double develop_mask_weight(const DevelopMask& m, double x, double y) {
  if (!m.enabled) return 0;
  const double a = m.angle * pi / 180, dx = x - m.x, dy = y - m.y;
  const double rx = std::cos(a) * dx + std::sin(a) * dy, ry = -std::sin(a) * dx + std::cos(a) * dy;
  double weight;
  if (m.radial) {
    const double distance = std::sqrt(std::pow(rx / m.radius, 2) + std::pow(ry * m.aspect / m.radius, 2));
    weight = m.feather == 0 ? (distance <= 1 ? 1 : 0) : 1 - smooth((distance - (1 - m.feather)) / m.feather);
  } else weight = smooth(.5 + rx / std::max(.0001, m.radius * (m.feather + .01)));
  return m.invert ? 1 - weight : weight;
}

Image develop(const Image& source, const DevelopSettings& s, bool high_resolution) {
  validate_develop(s);
  if (!valid_develop_dimensions(source.width, source.height, high_resolution) || source.rgba.size() != std::size_t(source.width) * source.height * 4) throw std::invalid_argument("Invalid Develop image.");
  const auto w = source.width, h = source.height;
  const auto n = std::size_t(w) * h;
  std::vector<Pixel> pixels(n);
  const double exposure = std::exp2(s.exposure);
  const auto source_table=source_values(s,exposure);
  const bool use_tone=s.contrast!=0||s.highlights!=0||s.shadows!=0||s.whites!=0||s.blacks!=0||s.dehaze!=0;
  const bool use_curve = !identity_curve(s.curve);
  const std::array<bool,3> use_channel_curve{!identity_curve(s.channel_curves[0]),!identity_curve(s.channel_curves[1]),!identity_curve(s.channel_curves[2])};
  const CompiledCurve master_curve(s.curve,s.curve_interpolation);
  const std::array<CompiledCurve,3> channel_curves{{
    {s.channel_curves[0],s.curve_interpolation},{s.channel_curves[1],s.curve_interpolation},{s.channel_curves[2],s.curve_interpolation}}};
  bool use_hsl = false; for (const auto& a : s.hsl) use_hsl |= a.hue != 0 || a.saturation != 0 || a.luminance != 0;
  const std::array<Grade,3> grades{s.shadow_grade,s.midtone_grade,s.highlight_grade};
  const bool use_grading=std::any_of(grades.begin(),grades.end(),[](const Grade& g){return g.saturation!=0||g.luminance!=0;});
  // Wheel colors depend only on the recipe, not on any source pixel. Preserve
  // the exact float tint and double luminance rather than introducing a LUT.
  std::array<Pixel,3> grade_tints{};
  std::array<double,3> grade_luminance{};
  for(int g=0;g<3;++g) {
    grade_tints[g]=hsl_rgb(grades[g].hue/360,1,.5);
    grade_luminance[g]=luma(grade_tints[g]);
  }
  const auto global_tint=hsl_rgb(s.global_grade.hue/360,1,.5);
  const double global_tint_luma=luma(global_tint);
  const double grade_sigma=.16+.34*s.blending*.01, grade_precision=1/(2*grade_sigma*grade_sigma);
  const std::array<double,8> centers{0,30,60,120,180,240,275,315};
  for (unsigned y = 0; y < h; ++y) for (unsigned x = 0; x < w; ++x) {
    const auto i = std::size_t(y) * w + x;
    Pixel p{source_table[source.rgba[i*4]][0],source_table[source.rgba[i*4+1]][1],source_table[source.rgba[i*4+2]][2]};
    if (s.profile) apply_profile(p, s.profile);
    // The identity tone group cannot change these bounded working pixels.
    // Keep the active arithmetic/order intact; curves remain independent.
    if(use_tone) {
      const double lum = luma(p), lo = std::pow(1-lum,2), hi = std::pow(lum,2);
      const double shift = s.shadows*.0025*lo + s.highlights*.0025*hi + s.blacks*.0015*std::pow(1-lum,5) + s.whites*.0015*std::pow(lum,5);
      for(auto& v:p) {
        double value = (v + shift - .5) * (1 + s.contrast*.008) + .5;
        value = (value - s.dehaze*.0015) / (1 - s.dehaze*.0025);
        v = float(clamp(value));
      }
    }
    for(std::size_t channel=0;channel<p.size();++channel) {
      auto& v=p[channel];
      if(use_curve) v=float(s.curve_interpolation?master_curve.value(v):curve_value(v,s.curve));
      if(use_channel_curve[channel]) v=float(s.curve_interpolation?channel_curves[channel].value(v):curve_value(v,s.channel_curves[channel]));
    }
    const bool black_white = s.treatment == 1 || s.profile == 5;
    if (black_white) apply_black_and_white(p, s);
    else {
      if (s.saturation != 0 || s.vibrance != 0) {
        const double spread = std::max({p[0],p[1],p[2]})-std::min({p[0],p[1],p[2]});
        saturate(p,std::max(0.0,1+s.saturation*.01+s.vibrance*.01*(1-spread)));
      }
      if (use_hsl) {
        auto color = rgb_hsl(p); double dh=0, ds=0, dl=0, total=0;
        for (std::size_t c=0;c<centers.size();++c) { double distance=std::abs(color[0]*360-centers[c]); distance=std::min(distance,360-distance); const double weight=std::max(0.0,1-distance/60); dh+=weight*s.hsl[c].hue; ds+=weight*s.hsl[c].saturation; dl+=weight*s.hsl[c].luminance; total+=weight; }
        if (total>0) p=hsl_rgb(color[0]+dh/total/600,color[1]*(1+ds/total/100),color[2]+dl/total/200*color[1]);
      }
    }
    if(use_grading&&s.tonal_grading) {
      // Independent FOTO model, not Adobe's proprietary algorithm. Normalized Gaussian
      // tonal windows overlap more as Blending increases. Positive Balance expands highlights.
      // Control semantics: https://blog.adobe.com/en/publish/2020/10/20/introducing-color-grading
      const double level=clamp(luma(p)+s.balance*.004);
      std::array<double,3> weights{};double total=0;
      for(int g=0;g<3;++g) { weights[g]=std::exp(-std::pow(level-g*.5,2)*grade_precision);total+=weights[g]; }
      std::array<double,3> offset{};
      for(int g=0;g<3;++g) if(grades[g].saturation!=0 || grades[g].luminance!=0) {
        const auto& tint=grade_tints[g];const double tint_luma=grade_luminance[g];
        for(int c=0;c<3;++c) offset[c]+=weights[g]/total*((tint[c]-tint_luma)*grades[g].saturation*.003+grades[g].luminance*.002);
      }
      // Clamp only after accumulating all ranges: wheel order does not bias clipped colors.
      for(int c=0;c<3;++c) p[c]=float(clamp(p[c]+offset[c]));
    } else if(use_grading) {
      // Keep existing recipes and protocols 1/2 pixel-identical, including legacy balance/blending.
      const double level=clamp(luma(p)-s.balance*.003);
      const double shadow=std::pow(1-level,1+s.blending*.03), highlight=std::pow(level,1+s.blending*.03), middle=std::max(0.0,1-shadow-highlight);
      const std::array<double,3> weights{shadow,middle,highlight};
      for (int g=0;g<3;++g) if (grades[g].saturation != 0 || grades[g].luminance != 0) {
        const auto& tint=grade_tints[g]; const double tint_luma=grade_luminance[g];
        for (int c=0;c<3;++c) p[c]=float(clamp(p[c]+weights[g]*((tint[c]-tint_luma)*grades[g].saturation*.003+grades[g].luminance*.002)));
      }
    }
    if(s.global_grade.saturation!=0 || s.global_grade.luminance!=0) {
      const auto& tint=global_tint;const double tint_luma=global_tint_luma;
      for(int c=0;c<3;++c) p[c]=float(clamp(p[c]+(tint[c]-tint_luma)*s.global_grade.saturation*.003+s.global_grade.luminance*.002));
    }
    for (const auto& mask:s.masks) {
      const double weight=develop_mask_weight(mask,(x+.5)/w,(y+.5)/h); if(weight == 0) continue;
      if(mask.exposure != 0) for(auto& v:p) v=float(clamp(srgb(linear(v)*std::exp2(mask.exposure*weight))));
      if(mask.temperature != 0) temperature(p,mask.temperature*weight,0);
      if(mask.saturation != 0) saturate(p,1+mask.saturation*weight*.01);
    }
    pixels[i]=p;
  }
  // Denoise first, then compute detail from the cleaned signal. Sharing the
  // original detail term made sharpening >= 50 cancel even maximum denoise.
  if(s.noise_reduction)denoise_luminance(pixels,source.width,source.height,s.noise_reduction);
  // Clean chroma before extracting detail, too. Subtracting color noise in the
  // same step as unsharp detail let Sharpening 50 fully cancel Color noise 100.
  // Keep the existing color-only math; combined controls now sharpen its result.
  if (s.color_noise_reduction) {
    const auto soft=blur(pixels,w,h,1);
    for(std::size_t i=0;i<n;++i) {
      const double lum=luma(pixels[i]), smooth_lum=luma(soft[i]);
      for(int c=0;c<3;++c) {
        const double value=pixels[i][c]+(soft[i][c]-smooth_lum-(pixels[i][c]-lum))*s.color_noise_reduction*.01;
        pixels[i][c]=float(clamp(value));
      }
    }
  }
  if(s.sharpening && (s.sharpening_radius!=1 || s.sharpening_detail!=100 || s.sharpening_masking!=0)) {
    // Independent FOTO controls following familiar sharpening semantics, not
    // Adobe's proprietary sharpening algorithm. Defaults use the exact old path.
    sharpen_extended(pixels,w,h,s);
  } else if (s.sharpening || s.texture) {
    const auto soft=blur(pixels,w,h,1);
    for(std::size_t i=0;i<n;++i) {
      for(int c=0;c<3;++c) {
        const double detail=pixels[i][c]-soft[i][c];
        // Soft-threshold the remaining high-frequency residual while denoise
        // is enabled; otherwise unsharp masking can re-amplify the same grain.
        const double cleaned_detail=s.noise_reduction
          ? std::copysign(std::max(0.0,std::abs(detail)-s.noise_reduction*.001),detail) : detail;
        const double value=pixels[i][c]+cleaned_detail*(s.sharpening*.02+s.texture*.007);
        pixels[i][c]=float(clamp(value));
      }
    }
  }
  if(s.clarity || s.bloom || s.halation) {
    const auto soft=blur(pixels,w,h,std::clamp(int(std::max(w,h)/100),2,40));
    for(std::size_t i=0;i<n;++i) {
      const double light=smooth((luma(soft[i])-.5)*2);
      for(int c=0;c<3;++c) {
        double value=pixels[i][c]+(pixels[i][c]-soft[i][c])*s.clarity*.012;
        value+=light*s.bloom*.003*(1-value);
        value+=light*s.halation*.003*(c==0?1:c==1?.22:0)*(1-value);
        pixels[i][c]=float(clamp(value));
      }
    }
  }
  Image out=source;
  for(unsigned y=0;y<h;++y) for(unsigned x=0;x<w;++x) {
    const auto i=std::size_t(y)*w+x;
    const double distance=std::min(1.0,(std::pow((x+.5)/w-.5,2)+std::pow((y+.5)/h-.5,2))*2);
    const double vig=s.vignette*.006*smooth(distance);
    const auto noise = grain_rgb(x, y, s.grain_size, s.grain == 0 ? 0 : s.grain_color);
    const double amount = s.grain * .0012;
    // Smooth shoulder above 55% with slope 1 at the join; use a shared RGB scale to preserve hue.
    const double peak=std::max({pixels[i][0],pixels[i][1],pixels[i][2]});
    double falloff_scale=1;
    if(s.film_falloff && peak>.55) {
      const double shoulder=.55+.45*(1-std::exp(-(peak-.55)/.45));
      falloff_scale=1+(shoulder/peak-1)*s.film_falloff*.01;
    }
    std::array<double,3> finished{};
    for(int c=0;c<3;++c) {
      double value=pixels[i][c]*falloff_scale*(1-s.fade*.003)+s.fade*.0015;
      value=vig<0?value*(1+vig):value+(1-value)*vig;
      finished[c]=value;
      if(s.grain_luminance==0 || s.grain==0) {
        // Preserve original arithmetic/rounding, including its per-channel envelope.
        value+=noise[c]*amount*(.35+.65*(1-std::abs(value-.5)*2));
        out.rgba[i*4+c]=std::uint8_t(std::round(clamp(value)*255));
      }
    }
    if(s.grain_luminance!=0 && s.grain!=0) {
      // A bounded, signal-dependent amplitude, not calibrated film-stock simulation.
      // Color=0 keeps a shared luma envelope (gray grain). Raised color uses dye-layer chroma.
      // sqrt(4L(1-L)) tapers the standard deviation at black/white, peaks at middle gray.
      // Intensity-dependent scaling: ITU-T H Supplement 21 (2025), film grain synthesis.
      const double light=clamp(.2126*finished[0]+.7152*finished[1]+.0722*finished[2]);
      const double adaptive=std::sqrt(4*light*(1-light)), mix=s.grain_luminance*.01;
      for(int c=0;c<3;++c) {
        const double value=finished[c],legacy=.35+.65*(1-std::abs(value-.5)*2);
        out.rgba[i*4+c]=std::uint8_t(std::round(clamp(value+noise[c]*amount*(legacy+(adaptive-legacy)*mix))*255));
      }
    }
  }
  // Return the owned output directly when geometry is unchanged; geometry's
  // const-reference identity branch otherwise copies another full RGBA buffer.
  if(identity_crop(s.crop)) return out;
  return geometry(out,s.crop);
}

WhiteBalanceSample develop_white_balance_from_sample(double red, double green, double blue) {
  red = std::max(red, 1.0 / 255); green = std::max(green, 1.0 / 255); blue = std::max(blue, 1.0 / 255);
  const double lr = std::log2(red), lg = std::log2(green), lb = std::log2(blue);
  return {std::clamp(std::round((lb - lr) / .007), -100.0, 100.0),
          std::clamp(std::round((2 * lg - lr - lb) / .006), -100.0, 100.0)};
}
} // namespace lenslabs
