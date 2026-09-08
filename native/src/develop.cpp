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
void saturate(Pixel& p, double amount) {
  const double y = luma(p);
  for (auto& v : p) v = float(clamp(y + (v - y) * amount));
}
void temperature(Pixel& p, double t, double tint) {
  p[0] = float(clamp(p[0] * std::exp2(t * .0035 + tint * .001)));
  p[1] = float(clamp(p[1] * std::exp2(-tint * .002)));
  p[2] = float(clamp(p[2] * std::exp2(-t * .0035 + tint * .001)));
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
double grain(unsigned x, unsigned y, double size) {
  const unsigned gx = unsigned(std::floor(x / size)), gy = unsigned(std::floor(y / size));
  std::uint32_t v = (gx * 374761393u + gy * 668265263u + 0x9e3779b9u);
  v = (v ^ (v >> 13)) * 1274126177u; v ^= v >> 16;
  return (double(v) / std::numeric_limits<std::uint32_t>::max()) * 2 - 1;
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
  bounded(s.exposure, -5, 5);
  for (double v : {s.contrast,s.highlights,s.shadows,s.whites,s.blacks,s.temperature,s.tint,s.saturation,s.vibrance,s.texture,s.clarity,s.dehaze,s.balance,s.vignette}) bounded(v, -100, 100);
  for (double v : {s.blending,s.grain,s.grain_luminance,s.fade,s.film_falloff,s.bloom,s.halation,s.sharpening,s.noise_reduction,s.color_noise_reduction}) bounded(v, 0, 100);
  bounded(s.grain_size, .5, 4);
  validate_curve(s.curve);for(const auto& curve:s.channel_curves) validate_curve(curve);
  for (const auto& h : s.hsl) { bounded(h.hue,-100,100); bounded(h.saturation,-100,100); bounded(h.luminance,-100,100); }
  for (const auto& g : {s.shadow_grade,s.midtone_grade,s.highlight_grade,s.global_grade}) { bounded(g.hue,0,360); bounded(g.saturation,0,100); bounded(g.luminance,-100,100); }
  const auto& c = s.crop; bounded(c.x,0,1); bounded(c.y,0,1); bounded(c.width,.01,1); bounded(c.height,.01,1); bounded(c.angle,-45,45);
  if (c.x + c.width > 1.000001 || c.y + c.height > 1.000001 || (c.rotate != 0 && c.rotate != 90 && c.rotate != 180 && c.rotate != 270)) throw std::invalid_argument("Invalid crop.");
  if (s.masks.size() > 12) throw std::invalid_argument("Too many masks.");
  for (const auto& m : s.masks) { bounded(m.x,0,1); bounded(m.y,0,1); bounded(m.radius,.01,2); bounded(m.aspect,.1,10); bounded(m.angle,-180,180); bounded(m.feather,0,1); bounded(m.exposure,-5,5); bounded(m.temperature,-100,100); bounded(m.saturation,-100,100); }
}

DevelopSettings read_develop_protocol(std::istream& in) {
  std::string marker; in >> marker; if (marker != "FOTO_DEVELOP_1" && marker != "FOTO_DEVELOP_2" && marker != "FOTO_DEVELOP_3") throw std::invalid_argument("Invalid Develop protocol.");
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
  if(marker=="FOTO_DEVELOP_3") {
    in >> s.tonal_grading >> s.global_grade.hue >> s.global_grade.saturation >> s.global_grade.luminance >> s.grain_luminance;
  }
  if (!in) throw std::invalid_argument("Truncated Develop settings.");
  in >> std::ws; if (!in.eof()) throw std::invalid_argument("Extra Develop settings.");
  validate_develop(s); return s;
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

Image develop(const Image& source, const DevelopSettings& s) {
  validate_develop(s);
  if (!source.width || !source.height || source.width > 4096 || source.height > 4096 || source.rgba.size() != std::size_t(source.width) * source.height * 4) throw std::invalid_argument("Invalid Develop image.");
  const auto w = source.width, h = source.height;
  const auto n = std::size_t(w) * h;
  std::vector<Pixel> pixels(n);
  const double exposure = std::exp2(s.exposure);
  const bool use_curve = !identity_curve(s.curve);
  const std::array<bool,3> use_channel_curve{!identity_curve(s.channel_curves[0]),!identity_curve(s.channel_curves[1]),!identity_curve(s.channel_curves[2])};
  bool use_hsl = false; for (const auto& a : s.hsl) use_hsl |= a.hue != 0 || a.saturation != 0 || a.luminance != 0;
  const std::array<Grade,3> grades{s.shadow_grade,s.midtone_grade,s.highlight_grade};
  const bool use_grading=std::any_of(grades.begin(),grades.end(),[](const Grade& g){return g.saturation!=0||g.luminance!=0;});
  const double grade_sigma=.16+.34*s.blending*.01, grade_precision=1/(2*grade_sigma*grade_sigma);
  const std::array<double,8> centers{0,30,60,120,180,240,275,315};
  for (unsigned y = 0; y < h; ++y) for (unsigned x = 0; x < w; ++x) {
    const auto i = std::size_t(y) * w + x;
    Pixel p; for (int c = 0; c < 3; ++c) p[c] = float(source.rgba[i*4+c] / 255.0);
    if (s.exposure != 0) for (auto& v : p) v = float(clamp(srgb(linear(v) * exposure)));
    if (s.temperature != 0 || s.tint != 0) temperature(p,s.temperature,s.tint);
    const double lum = luma(p), lo = std::pow(1-lum,2), hi = std::pow(lum,2);
    const double shift = s.shadows*.0025*lo + s.highlights*.0025*hi + s.blacks*.0015*std::pow(1-lum,5) + s.whites*.0015*std::pow(lum,5);
    for (std::size_t channel=0;channel<p.size();++channel) {
      auto& v=p[channel];
      double value = (v + shift - .5) * (1 + s.contrast*.008) + .5;
      value = (value - s.dehaze*.0015) / (1 - s.dehaze*.0025);
      v = float(clamp(value)); if (use_curve) v = float(curve_value(v,s.curve));
      if(use_channel_curve[channel]) v=float(curve_value(v,s.channel_curves[channel]));
    }
    if (s.saturation != 0 || s.vibrance != 0) {
      const double spread = std::max({p[0],p[1],p[2]})-std::min({p[0],p[1],p[2]});
      saturate(p,std::max(0.0,1+s.saturation*.01+s.vibrance*.01*(1-spread)));
    }
    if (use_hsl) {
      auto color = rgb_hsl(p); double dh=0, ds=0, dl=0, total=0;
      for (std::size_t c=0;c<centers.size();++c) { double distance=std::abs(color[0]*360-centers[c]); distance=std::min(distance,360-distance); const double weight=std::max(0.0,1-distance/60); dh+=weight*s.hsl[c].hue; ds+=weight*s.hsl[c].saturation; dl+=weight*s.hsl[c].luminance; total+=weight; }
      if (total>0) p=hsl_rgb(color[0]+dh/total/600,color[1]*(1+ds/total/100),color[2]+dl/total/200*color[1]);
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
        const auto tint=hsl_rgb(grades[g].hue/360,1,.5);const double tint_luma=luma(tint);
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
        const auto tint=hsl_rgb(grades[g].hue/360,1,.5); const double tint_luma=luma(tint);
        for (int c=0;c<3;++c) p[c]=float(clamp(p[c]+weights[g]*((tint[c]-tint_luma)*grades[g].saturation*.003+grades[g].luminance*.002)));
      }
    }
    if(s.global_grade.saturation!=0 || s.global_grade.luminance!=0) {
      const auto tint=hsl_rgb(s.global_grade.hue/360,1,.5);const double tint_luma=luma(tint);
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
  if (s.sharpening || s.texture || s.color_noise_reduction) {
    const auto soft=blur(pixels,w,h,1);
    for(std::size_t i=0;i<n;++i) {
      const double lum=luma(pixels[i]), smooth_lum=luma(soft[i]);
      for(int c=0;c<3;++c) {
        const double detail=pixels[i][c]-soft[i][c];
        // Soft-threshold the remaining high-frequency residual while denoise
        // is enabled; otherwise unsharp masking can re-amplify the same grain.
        const double cleaned_detail=s.noise_reduction
          ? std::copysign(std::max(0.0,std::abs(detail)-s.noise_reduction*.001),detail) : detail;
        double value=pixels[i][c]+cleaned_detail*(s.sharpening*.02+s.texture*.007);
        value+=(soft[i][c]-smooth_lum-(pixels[i][c]-lum))*s.color_noise_reduction*.01;
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
    const double vig=s.vignette*.006*smooth(distance), noise=grain(x,y,s.grain_size)*s.grain*.0012;
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
        value+=noise*(.35+.65*(1-std::abs(value-.5)*2));
        out.rgba[i*4+c]=std::uint8_t(std::round(clamp(value)*255));
      }
    }
    if(s.grain_luminance!=0 && s.grain!=0) {
      // A bounded, signal-dependent amplitude, not calibrated film-stock simulation.
      // A shared luma envelope keeps grain neutral rather than modulating each RGB channel.
      // sqrt(4L(1-L)) tapers the standard deviation at black/white, peaks at middle gray.
      // Intensity-dependent scaling: ITU-T H Supplement 21 (2025), film grain synthesis.
      const double light=clamp(.2126*finished[0]+.7152*finished[1]+.0722*finished[2]);
      const double adaptive=std::sqrt(4*light*(1-light)), mix=s.grain_luminance*.01;
      for(int c=0;c<3;++c) {
        const double value=finished[c],legacy=.35+.65*(1-std::abs(value-.5)*2);
        out.rgba[i*4+c]=std::uint8_t(std::round(clamp(value+noise*(legacy+(adaptive-legacy)*mix))*255));
      }
    }
  }
  return geometry(out,s.crop);
}
} // namespace lenslabs
