#include "lenslabs/look_match.hpp"
#include <algorithm>
#include <cmath>
#include <stdexcept>

// Every control constant below mirrors native/src/develop.cpp, and each one is
// only used to *initialize* the solve. The refinement renders through
// develop() itself, so a drifted constant costs iterations, never correctness.
namespace lenslabs {
namespace {
constexpr double pi = 3.14159265358979323846;
// develop.cpp's Color Mixer band centers (degrees) and triangular 60° reach.
constexpr std::array<double, look_band_count> band_centers{0, 30, 60, 120, 180, 240, 275, 315};
constexpr std::array<double, look_zone_count> zone_centers{.15, .5, .85};
constexpr double zone_sigma = .2;
// Chroma scale (CIELAB) under which a pixel testifies about split toning.
constexpr double neutral_chroma = 20;
constexpr std::size_t residual_count = look_quantile_count + look_zone_count * 7 +
                                       look_band_count * 3 + 6 + 3 + 1;

double srgb_decode(double v) { return v <= .04045 ? v / 12.92 : std::pow((v + .055) / 1.055, 2.4); }
double srgb_encode(double v) { return v <= .0031308 ? v * 12.92 : 1.055 * std::pow(v, 1 / 2.4) - .055; }
const std::array<double, 256>& decode_table() {
  static const auto table = [] {
    std::array<double, 256> values{};
    for (std::size_t i = 0; i < values.size(); ++i) values[i] = srgb_decode(i / 255.0);
    return values;
  }();
  return table;
}

struct Lab { double l, a, b; };
double lab_f_exact(double t) { return t > 216.0 / 24389 ? std::cbrt(t) : (24389.0 / 27 * t + 16) / 116; }
// The inner loop converts every pixel of every candidate; three cube roots per
// pixel dominated it. X/Xn, Y and Z/Zn of sRGB colors stay within [0, 1], where
// a linearly interpolated table is within 1e-4 L* of the exact function.
double lab_f(double t) {
  constexpr std::size_t size = 8192;
  static const auto table = [] {
    std::array<double, size + 1> values{};
    for (std::size_t i = 0; i <= size; ++i) values[i] = lab_f_exact(double(i) / size);
    return values;
  }();
  if (!(t > 0) || t >= 1) return lab_f_exact(t > 0 ? t : 0);
  const double at = t * size;
  const auto i = std::size_t(at);
  return table[i] + (table[i + 1] - table[i]) * (at - double(i));
}
// Linear sRGB (D65) to CIELAB.
Lab lab_linear(double r, double g, double b) {
  const double x = (.4124564 * r + .3575761 * g + .1804375 * b) / .95047;
  const double y = .2126729 * r + .7151522 * g + .0721750 * b;
  const double z = (.0193339 * r + .1191920 * g + .9503041 * b) / 1.08883;
  const double fx = lab_f(x), fy = lab_f(y), fz = lab_f(z);
  return {116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)};
}
Lab lab_code(std::uint8_t r, std::uint8_t g, std::uint8_t b) {
  const auto& t = decode_table();
  return lab_linear(t[r], t[g], t[b]);
}
Lab lab_encoded(double r, double g, double b) {
  return lab_linear(srgb_decode(std::clamp(r, 0.0, 1.0)), srgb_decode(std::clamp(g, 0.0, 1.0)),
                    srgb_decode(std::clamp(b, 0.0, 1.0)));
}
// A gray of lightness L* expressed as an sRGB code value in [0,1], and back.
double lightness_to_encoded(double l) {
  const double f = (l + 16) / 116;
  const double y = l > 8 ? f * f * f : l * 27 / 24389;
  return srgb_encode(std::clamp(y, 0.0, 1.0));
}

void validate_image(const Image& image) {
  if (image.width < 16 || image.height < 16 ||
      image.rgba.size() != std::size_t(image.width) * image.height * 4)
    throw std::invalid_argument("Look matching needs a photo at least 16 pixels per side.");
}

// Nearest-neighbor stride sample at each block's center. Per-pixel develop
// stages commute with it exactly; vignette reads normalized coordinates, so it
// lands on the same radius to within half a source pixel.
Image stride_sample(const Image& in, std::uint32_t edge) {
  const auto longest = std::max(in.width, in.height);
  if (longest <= edge) return in;
  const double scale = double(edge) / longest;
  const auto w = std::max(1u, unsigned(std::lround(in.width * scale)));
  const auto h = std::max(1u, unsigned(std::lround(in.height * scale)));
  Image out{w, h, in.source_width, in.source_height, {}};
  out.rgba.resize(std::size_t(w) * h * 4);
  for (unsigned y = 0; y < h; ++y) {
    const auto sy = std::min(in.height - 1, unsigned((y + .5) * in.height / h));
    for (unsigned x = 0; x < w; ++x) {
      const auto sx = std::min(in.width - 1, unsigned((x + .5) * in.width / w));
      const auto from = (std::size_t(sy) * in.width + sx) * 4, to = (std::size_t(y) * w + x) * 4;
      for (int c = 0; c < 4; ++c) out.rgba[to + c] = in.rgba[from + c];
    }
  }
  return out;
}

// Everything except noise and cast, which need contiguous full-resolution
// pixels. `spatial` adds local contrast, which the solver's loop never reads.
LookDescriptor measure(const Image& image, bool spatial = true) {
  LookDescriptor d;
  const unsigned w = image.width, h = image.height;
  const std::size_t n = std::size_t(w) * h;
  constexpr std::size_t bins = 2048;
  std::vector<double> histogram(bins, 0);
  std::vector<double> lightness(n);
  std::array<double, look_zone_count> zw{}, zl{}, za{}, zb{}, zn{}, zna{}, znb{}, zaa{}, zab{}, zbb{};
  std::array<double, look_band_count> bw{}, bs{}, bl{}, bh{}, bc{};
  std::array<double, 4> ring_sum{}, ring_count{};
  double sum_l = 0, sum_ll = 0, sum_a = 0, sum_b = 0, sum_n = 0, sum_na = 0, sum_nb = 0, sum_c = 0;
  // Soft tonal zones (overlapping Gaussians in L*, normalized per pixel) and
  // the neutral weight exp(-(C/20)^2), tabulated: the loop runs them per pixel
  // per candidate.
  constexpr std::size_t zone_steps = 4096, neutral_steps = 4096;
  constexpr double neutral_span = 3600;  // C^2 beyond 60^2 weighs < 1e-3
  static const auto zone_table = [] {
    std::vector<std::array<double, look_zone_count>> table(zone_steps + 1);
    for (std::size_t i = 0; i <= zone_steps; ++i) {
      double total = 0;
      for (std::size_t z = 0; z < look_zone_count; ++z) {
        const double distance = double(i) / zone_steps - zone_centers[z];
        table[i][z] = std::exp(-distance * distance / (2 * zone_sigma * zone_sigma));
        total += table[i][z];
      }
      for (auto& v : table[i]) v /= total;
    }
    return table;
  }();
  static const auto neutral_table = [] {
    std::vector<double> table(neutral_steps + 2);
    for (std::size_t i = 0; i < table.size(); ++i)
      table[i] = std::exp(-double(i) * neutral_span / neutral_steps / (neutral_chroma * neutral_chroma));
    return table;
  }();
  for (unsigned y = 0; y < h; ++y)
    for (unsigned x = 0; x < w; ++x) {
      const std::size_t i = std::size_t(y) * w + x;
      const auto* p = &image.rgba[i * 4];
      const Lab c = lab_code(p[0], p[1], p[2]);
      lightness[i] = c.l;
      histogram[std::min(bins - 1, std::size_t(std::max(0.0, c.l) / 100 * bins))] += 1;
      const double chroma_squared = c.a * c.a + c.b * c.b, chroma = std::sqrt(chroma_squared);
      const double neutral_at = std::min(chroma_squared / neutral_span, 1.0) * neutral_steps;
      const auto neutral_index = std::size_t(neutral_at);
      const double neutral = chroma_squared >= neutral_span ? 0
          : neutral_table[neutral_index] + (neutral_table[neutral_index + 1] - neutral_table[neutral_index]) * (neutral_at - double(neutral_index));
      sum_l += c.l; sum_ll += c.l * c.l; sum_a += c.a; sum_b += c.b; sum_c += chroma;
      sum_n += neutral; sum_na += neutral * c.a; sum_nb += neutral * c.b;

      const auto& weight = zone_table[std::size_t(std::clamp(c.l / 100, 0.0, 1.0) * zone_steps + .5)];
      for (std::size_t z = 0; z < look_zone_count; ++z) {
        const double v = weight[z], vn = v * neutral;
        zw[z] += v; zl[z] += v * c.l; za[z] += v * c.a; zb[z] += v * c.b;
        zaa[z] += v * c.a * c.a; zab[z] += v * c.a * c.b; zbb[z] += v * c.b * c.b;
        zn[z] += vn; zna[z] += vn * c.a; znb[z] += vn * c.b;
      }

      // The Color Mixer's own HSL model (develop.cpp rgb_hsl) on code values.
      const double r = p[0] / 255.0, g = p[1] / 255.0, b = p[2] / 255.0;
      const double high = std::max({r, g, b}), low = std::min({r, g, b}), delta = high - low;
      if (delta > 1e-6) {
        const double light = (high + low) / 2;
        double hue = high == r ? (g - b) / delta : high == g ? 2 + (b - r) / delta : 4 + (r - g) / delta;
        if (hue < 0) hue += 6;
        hue *= 60;
        const double saturation = std::min(1.0, delta / std::max(1e-9, 1 - std::abs(2 * light - 1)));
        for (std::size_t band = 0; band < look_band_count; ++band) {
          double offset = hue - band_centers[band];
          if (offset > 180) offset -= 360;
          if (offset < -180) offset += 360;
          const double reach = 1 - std::abs(offset) / 60;
          if (reach <= 0) continue;
          // Gray-ish pixels carry an unstable hue; weigh by their chroma.
          const double v = reach * delta;
          bw[band] += v; bs[band] += v * saturation; bl[band] += v * light;
          bh[band] += v * offset; bc[band] += v * chroma;
        }
      }

      // develop.cpp's vignette distance: min(1, 2 r^2) on normalized coordinates.
      const double dx = (x + .5) / w - .5, dy = (y + .5) / h - .5;
      const double rho = std::min(1.0, (dx * dx + dy * dy) * 2);
      const auto ring = std::min<std::size_t>(3, std::size_t(rho * 4));
      ring_sum[ring] += c.l; ring_count[ring] += 1;
    }

  double seen = 0;
  std::size_t bin = 0;
  for (std::size_t q = 0; q < look_quantile_count; ++q) {
    const double target = look_quantile_levels[q] * double(n);
    while (bin < bins && seen + histogram[bin] < target) seen += histogram[bin++];
    const double inside = bin < bins && histogram[bin] > 0 ? (target - seen) / histogram[bin] : 1;
    d.quantiles[q] = std::clamp((double(std::min(bin, bins - 1)) + inside) / bins * 100, 0.0, 100.0);
  }
  for (std::size_t z = 0; z < look_zone_count; ++z) {
    auto& zone = d.zones[z];
    zone.fraction = zw[z] / double(n);
    if (zw[z] <= 1e-9) continue;
    zone.lightness = zl[z] / zw[z];
    zone.a = za[z] / zw[z]; zone.b = zb[z] / zw[z];
    zone.aa = zaa[z] / zw[z] - zone.a * zone.a;
    zone.ab = zab[z] / zw[z] - zone.a * zone.b;
    zone.bb = zbb[z] / zw[z] - zone.b * zone.b;
    if (zn[z] > 1e-9) { zone.neutral_a = zna[z] / zn[z]; zone.neutral_b = znb[z] / zn[z]; }
  }
  for (std::size_t band = 0; band < look_band_count; ++band) {
    auto& stats = d.bands[band];
    stats.mass = bw[band] / double(n);
    if (bw[band] <= 1e-9) continue;
    stats.saturation = bs[band] / bw[band];
    stats.lightness = bl[band] / bw[band];
    stats.hue = bh[band] / bw[band];
    stats.chroma = bc[band] / bw[band];
  }
  d.a = sum_a / double(n); d.b = sum_b / double(n); d.chroma = sum_c / double(n);
  if (sum_n > 1e-9) { d.neutral_a = sum_na / sum_n; d.neutral_b = sum_nb / sum_n; }
  const double mean_l = sum_l / double(n);
  d.contrast = std::sqrt(std::max(0.0, sum_ll / double(n) - mean_l * mean_l));
  for (std::size_t ring = 1; ring < 4; ++ring)
    d.radial[ring - 1] = ring_count[ring] > 0 && ring_count[0] > 0
                             ? ring_sum[ring] / ring_count[ring] - ring_sum[0] / ring_count[0]
                             : 0;

  if (!spatial) return d;
  // Local contrast at Clarity's own blur radius, via a summed-area table.
  const int radius = std::clamp(int(std::max(w, h) / 100), 2, 40);
  std::vector<double> integral((std::size_t(w) + 1) * (h + 1), 0);
  for (unsigned y = 0; y < h; ++y) {
    double row = 0;
    for (unsigned x = 0; x < w; ++x) {
      row += lightness[std::size_t(y) * w + x];
      integral[(std::size_t(y) + 1) * (w + 1) + x + 1] = integral[std::size_t(y) * (w + 1) + x + 1] + row;
    }
  }
  double local = 0;
  for (unsigned y = 0; y < h; ++y) {
    const unsigned y0 = unsigned(std::max(0, int(y) - radius)), y1 = std::min(h, y + unsigned(radius) + 1);
    for (unsigned x = 0; x < w; ++x) {
      const unsigned x0 = unsigned(std::max(0, int(x) - radius)), x1 = std::min(w, x + unsigned(radius) + 1);
      const double box = integral[std::size_t(y1) * (w + 1) + x1] - integral[std::size_t(y0) * (w + 1) + x1] -
                         integral[std::size_t(y1) * (w + 1) + x0] + integral[std::size_t(y0) * (w + 1) + x0];
      local += std::abs(lightness[std::size_t(y) * w + x] - box / (double(x1 - x0) * (y1 - y0)));
    }
  }
  d.local_contrast = local / double(n);
  return d;
}

// Grain and sensor noise are stationary, so a 3x3 mosaic of contiguous
// full-resolution tiles spread over the frame reads them at bounded cost. The
// mosaic is itself a small image, so the target's noise *after* a candidate
// recipe (contrast amplifies noise) is one cheap develop() away.
constexpr unsigned noise_grid = 3;
Image noise_tiles(const Image& image, unsigned& tile) {
  tile = std::min({48u, image.width / noise_grid, image.height / noise_grid});
  Image out{tile * noise_grid, tile * noise_grid, tile * noise_grid, tile * noise_grid, {}};
  out.rgba.resize(std::size_t(out.width) * out.height * 4);
  for (unsigned ty = 0; ty < noise_grid; ++ty)
    for (unsigned tx = 0; tx < noise_grid; ++tx) {
      const unsigned left = std::min(image.width - tile, unsigned(std::max(0.0, (tx + .5) * image.width / noise_grid - tile / 2.0)));
      const unsigned top = std::min(image.height - tile, unsigned(std::max(0.0, (ty + .5) * image.height / noise_grid - tile / 2.0)));
      for (unsigned y = 0; y < tile; ++y) {
        const auto from = (std::size_t(top + y) * image.width + left) * 4;
        const auto to = (std::size_t(ty * tile + y) * out.width + tx * tile) * 4;
        std::copy_n(image.rgba.begin() + std::ptrdiff_t(from), std::size_t(tile) * 4, out.rgba.begin() + std::ptrdiff_t(to));
      }
    }
  return out;
}

// Luma noise sigma (Immerkaer 1996: a Laplacian-difference kernel is blind to
// planes and ramps), read only where the pre-smoothed gradient is in its
// flattest half, away from clipping where noise is truncated, and never across
// a tile seam.
double measure_noise(const Image& image, unsigned tile) {
  const unsigned w = image.width, h = image.height;
  if (tile < 16) return 0;
  std::vector<float> luma(std::size_t(w) * h);
  for (std::size_t i = 0; i < luma.size(); ++i) {
    const auto* p = &image.rgba[i * 4];
    luma[i] = float((.2126 * p[0] + .7152 * p[1] + .0722 * p[2]) / 255);
  }
  const auto interior = [&](unsigned x, unsigned y) {
    return x % tile >= 3 && x % tile + 3 < tile && y % tile >= 3 && y % tile + 3 < tile;
  };
  const auto at = [&](unsigned x, unsigned y) { return double(luma[std::size_t(y) * w + x]); };
  // Gradient of a 3x3 box average two pixels apart: noise barely moves it.
  const auto smooth = [&](unsigned x, unsigned y) {
    double sum = 0;
    for (int dy = -1; dy <= 1; ++dy)
      for (int dx = -1; dx <= 1; ++dx) sum += at(x + dx, y + dy);
    return sum / 9;
  };
  constexpr std::size_t bins = 1024;
  constexpr double gradient_span = .5;
  std::vector<double> histogram(bins, 0);
  std::vector<float> gradient(luma.size(), -1);
  double count = 0;
  for (unsigned y = 3; y + 3 < h; ++y)
    for (unsigned x = 3; x + 3 < w; ++x) {
      const double center = at(x, y);
      if (!interior(x, y) || center < .03 || center > .97) continue;
      const double g = std::abs(smooth(x + 2, y) - smooth(x - 2, y)) + std::abs(smooth(x, y + 2) - smooth(x, y - 2));
      gradient[std::size_t(y) * w + x] = float(g);
      histogram[std::min(bins - 1, std::size_t(g / gradient_span * bins))] += 1;
      count += 1;
    }
  if (count < 256) return 0;
  double seen = 0, threshold = gradient_span;
  for (std::size_t i = 0; i < bins; ++i) {
    seen += histogram[i];
    if (seen >= count * .5) { threshold = (i + 1) * gradient_span / bins; break; }
  }
  double sum = 0, used = 0;
  for (unsigned y = 3; y + 3 < h; ++y)
    for (unsigned x = 3; x + 3 < w; ++x) {
      const float g = gradient[std::size_t(y) * w + x];
      if (g < 0 || g > threshold) continue;
      const double laplacian = at(x - 1, y - 1) - 2 * at(x, y - 1) + at(x + 1, y - 1) - 2 * at(x - 1, y) +
                               4 * at(x, y) - 2 * at(x + 1, y) + at(x - 1, y + 1) - 2 * at(x, y + 1) +
                               at(x + 1, y + 1);
      sum += std::abs(laplacian);
      used += 1;
    }
  return used > 0 ? std::sqrt(pi / 2) / 6 * sum / used : 0;
}

// The neutral cast exactly as develop_auto.cpp reads it: low-chroma mid-tones.
void measure_cast(const Image& image, LookDescriptor& d) {
  const std::size_t n = std::size_t(image.width) * image.height;
  const auto stride = std::max<std::size_t>(1, std::size_t(std::sqrt(double(n) / 250000.0)));
  std::array<double, 3> sum{};
  double neutral = 0, total = 0;
  for (std::uint32_t y = 0; y < image.height; y += std::uint32_t(stride))
    for (std::uint32_t x = 0; x < image.width; x += std::uint32_t(stride)) {
      const auto* p = &image.rgba[(std::size_t(y) * image.width + x) * 4];
      const double r = p[0] / 255.0, g = p[1] / 255.0, b = p[2] / 255.0;
      const double light = .2126 * r + .7152 * g + .0722 * b;
      const double spread = std::max({r, g, b}) - std::min({r, g, b});
      total += 1;
      if (spread < .18 && light > .2 && light < .85) {
        sum[0] += r; sum[1] += g; sum[2] += b;
        neutral += 1;
      }
    }
  d.cast_measured = neutral >= total * .04 && sum[0] > 0 && sum[1] > 0 && sum[2] > 0;
  d.cast_red = d.cast_measured ? std::log2(sum[1] / sum[0]) : 0;
  d.cast_blue = d.cast_measured ? std::log2(sum[1] / sum[2]) : 0;
  // As in Auto: a huge "cast" across low-chroma pixels is a colored scene
  // (a wood floor, a brown field), not a white balance error.
  if (std::abs((d.cast_red - d.cast_blue) / .007) > 50 || std::abs((d.cast_red + d.cast_blue) / .006) > 50) {
    d.cast_measured = false;
    d.cast_red = d.cast_blue = 0;
  }
}

// Weighted residuals, candidate minus look, in roughly CIELAB units. Zone and
// band terms fade out when either image barely contains that zone or color, so
// an absent color never drags the recipe.
void residuals(const LookDescriptor& d, const LookDescriptor& look, bool spatial, double* out) {
  std::size_t k = 0;
  for (std::size_t q = 0; q < look_quantile_count; ++q)
    out[k++] = (q == 0 || q + 1 == look_quantile_count ? .7 : 1) * (d.quantiles[q] - look.quantiles[q]);
  const auto signed_root = [](double v) { return std::copysign(std::sqrt(std::abs(v)), v); };
  for (std::size_t z = 0; z < look_zone_count; ++z) {
    const auto& c = d.zones[z];
    const auto& l = look.zones[z];
    const double reliable = std::min(1.0, std::sqrt(std::min(c.fraction, l.fraction) / .12));
    out[k++] = 1.2 * reliable * (c.neutral_a - l.neutral_a);
    out[k++] = 1.2 * reliable * (c.neutral_b - l.neutral_b);
    out[k++] = .4 * reliable * (c.a - l.a);
    out[k++] = .4 * reliable * (c.b - l.b);
    out[k++] = .3 * reliable * (signed_root(c.aa) - signed_root(l.aa));
    out[k++] = .3 * reliable * (signed_root(c.ab) - signed_root(l.ab));
    out[k++] = .3 * reliable * (signed_root(c.bb) - signed_root(l.bb));
  }
  for (std::size_t band = 0; band < look_band_count; ++band) {
    const auto& c = d.bands[band];
    const auto& l = look.bands[band];
    const double reliable = std::min(1.0, std::sqrt(std::min(c.mass, l.mass) / .008));
    out[k++] = 80 * reliable * (c.saturation - l.saturation);
    out[k++] = 80 * reliable * (c.lightness - l.lightness);
    // A hue error is visible in proportion to chroma: dE ~ C * dh (radians).
    out[k++] = std::min(1.0, l.chroma / 57) * reliable * (c.hue - l.hue);
  }
  out[k++] = 1.2 * (d.neutral_a - look.neutral_a);
  out[k++] = 1.2 * (d.neutral_b - look.neutral_b);
  out[k++] = .4 * (d.a - look.a);
  out[k++] = .4 * (d.b - look.b);
  out[k++] = .5 * (d.chroma - look.chroma);
  out[k++] = d.contrast - look.contrast;
  for (std::size_t ring = 0; ring < 3; ++ring) out[k++] = .4 * (d.radial[ring] - look.radial[ring]);
  out[k++] = spatial ? 2 * (d.local_contrast - look.local_contrast) : 0;
}

// ---------------------------------------------------------------- solve model
enum class Knob : std::uint8_t { temperature, tint, curve, saturation, hue, sat, lum, wheel_u, wheel_v, fade, vignette };
struct Param {
  Knob knob;
  int index;
  double low, high, step, prior;
};
constexpr std::size_t knot_count = 9;

// develop.cpp hsl_rgb(h, 1, .5): the pure hue each grading wheel adds.
std::array<double, 3> wheel_tint(double hue_degrees) {
  const double h = hue_degrees / 360 - std::floor(hue_degrees / 360);
  const double x = 1 - std::abs(std::fmod(h * 6, 2) - 1);
  switch (std::min(5, int(h * 6))) {
    case 0: return {1, x, 0};
    case 1: return {x, 1, 0};
    case 2: return {0, 1, x};
    case 3: return {0, x, 1};
    case 4: return {x, 0, 1};
    default: return {1, 0, x};
  }
}

struct Model {
  DevelopSettings base;
  std::vector<Param> params;
};

DevelopSettings compose(const Model& model, const std::vector<double>& theta) {
  DevelopSettings s = model.base;
  std::array<std::array<double, 2>, 2> wheel{};
  std::array<bool, 2> wheel_used{};
  for (std::size_t j = 0; j < model.params.size(); ++j) {
    const auto& p = model.params[j];
    const double v = theta[j];
    switch (p.knob) {
      case Knob::temperature: s.temperature = v; break;
      case Knob::tint: s.tint = v; break;
      case Knob::curve: s.curve[std::size_t(p.index)].y = v; break;
      case Knob::saturation: s.saturation = v; break;
      case Knob::hue: s.hsl[std::size_t(p.index)].hue = v; break;
      case Knob::sat: s.hsl[std::size_t(p.index)].saturation = v; break;
      case Knob::lum: s.hsl[std::size_t(p.index)].luminance = v; break;
      case Knob::wheel_u: wheel[std::size_t(p.index)][0] = v; wheel_used[std::size_t(p.index)] = true; break;
      case Knob::wheel_v: wheel[std::size_t(p.index)][1] = v; wheel_used[std::size_t(p.index)] = true; break;
      case Knob::fade: s.fade = v; break;
      case Knob::vignette: s.vignette = v; break;
    }
  }
  // Cartesian wheel coordinates keep the solve smooth through zero saturation.
  for (std::size_t i = 0; i < 2; ++i) {
    if (!wheel_used[i]) continue;
    auto& grade = i == 0 ? s.shadow_grade : s.highlight_grade;
    const double saturation = std::min(100.0, std::hypot(wheel[i][0], wheel[i][1]));
    double hue = std::atan2(wheel[i][1], wheel[i][0]) * 180 / pi;
    if (hue < 0) hue += 360;
    grade.hue = saturation > 1e-9 ? std::clamp(hue, 0.0, 360.0) : 0;
    grade.saturation = saturation;
    grade.luminance = 0;
  }
  return s;
}

// Every curve segment (an eighth of the input range) keeps at least this rise:
// a flat stretch would erase the tonal separation inside it. And at most this
// rise, a slope of 2.8: steeper segments posterize, which no look intends even
// when the numbers of an extreme inspiration would ask for it.
constexpr double knot_min_rise = .04, knot_max_rise = .35;
// How strongly the solve prefers a smooth curve (second differences of knots).
constexpr double curve_smoothness = 12;

// Bounds, a strictly rising curve and wheels inside their disc.
void project(const Model& model, std::vector<double>& theta) {
  std::vector<std::size_t> knots;
  std::array<std::array<std::size_t, 2>, 2> wheel{{{SIZE_MAX, SIZE_MAX}, {SIZE_MAX, SIZE_MAX}}};
  for (std::size_t j = 0; j < model.params.size(); ++j) {
    const auto& p = model.params[j];
    theta[j] = std::clamp(theta[j], p.low, p.high);
    if (p.knob == Knob::curve) knots.push_back(j);  // consecutive, x ascending
    if (p.knob == Knob::wheel_u) wheel[std::size_t(p.index)][0] = j;
    if (p.knob == Knob::wheel_v) wheel[std::size_t(p.index)][1] = j;
  }
  // Rise forward, then settle back under the top. The first knot is at most .5,
  // so a curve meeting both rise limits inside [0, 1] always exists.
  for (std::size_t k = 1; k < knots.size(); ++k)
    theta[knots[k]] = std::min(1.0, std::clamp(theta[knots[k]], theta[knots[k - 1]] + knot_min_rise,
                                               theta[knots[k - 1]] + knot_max_rise));
  for (std::size_t k = knots.empty() ? 0 : knots.size() - 1; k-- > 0;)
    theta[knots[k]] = std::max(0.0, std::clamp(theta[knots[k]], theta[knots[k + 1]] - knot_max_rise,
                                               theta[knots[k + 1]] - knot_min_rise));
  for (const auto& pair : wheel) {
    if (pair[0] == SIZE_MAX || pair[1] == SIZE_MAX) continue;
    const double length = std::hypot(theta[pair[0]], theta[pair[1]]);
    if (length > 100) { theta[pair[0]] *= 100 / length; theta[pair[1]] *= 100 / length; }
  }
}

double sum_squares(const std::vector<double>& r) {
  double sum = 0;
  for (double v : r) sum += v * v;
  return sum;
}

// Symmetric positive definite solve (Cholesky). False when not positive definite.
bool solve_spd(std::vector<double> a, std::vector<double>& b, std::size_t n) {
  for (std::size_t j = 0; j < n; ++j) {
    double diagonal = a[j * n + j];
    for (std::size_t k = 0; k < j; ++k) diagonal -= a[j * n + k] * a[j * n + k];
    if (!(diagonal > 1e-14)) return false;
    const double root = std::sqrt(diagonal);
    a[j * n + j] = root;
    for (std::size_t i = j + 1; i < n; ++i) {
      double value = a[i * n + j];
      for (std::size_t k = 0; k < j; ++k) value -= a[i * n + k] * a[j * n + k];
      a[i * n + j] = value / root;
    }
  }
  for (std::size_t i = 0; i < n; ++i) {
    double value = b[i];
    for (std::size_t k = 0; k < i; ++k) value -= a[i * n + k] * b[k];
    b[i] = value / a[i * n + i];
  }
  for (std::size_t i = n; i-- > 0;) {
    double value = b[i];
    for (std::size_t k = i + 1; k < n; ++k) value -= a[k * n + i] * b[k];
    b[i] = value / a[i * n + i];
  }
  return true;
}

class Solver {
 public:
  Solver(const Image& loop, const LookDescriptor& look, const Model& model, std::vector<double> anchor,
         std::vector<bool> active)
      : loop_(loop), look_(look), model_(model), anchor_(std::move(anchor)), active_(std::move(active)),
        bias_(residual_count, 0) {
    for (std::size_t j = 0; j < model_.params.size(); ++j)
      if (model_.params[j].knob == Knob::curve) knots_.push_back(j);
  }

  unsigned evaluations() const { return evaluations_; }
  void forget_jacobian() { jacobian_.clear(); }
  // Removes the loop image's systematic difference from the working image.
  void set_bias(const std::vector<double>& real, const std::vector<double>& loop) {
    for (std::size_t i = 0; i < residual_count; ++i) bias_[i] = real[i] - loop[i];
  }
  std::vector<double> descriptor_residuals(const Image& image, const DevelopSettings& settings, bool spatial) {
    std::vector<double> r(residual_count);
    residuals(measure(develop(image, settings), spatial), look_, spatial, r.data());
    return r;
  }
  std::vector<double> residual(const std::vector<double>& theta) {
    ++evaluations_;
    auto r = descriptor_residuals(loop_, compose(model_, theta), false);
    for (std::size_t i = 0; i < residual_count; ++i) r[i] += bias_[i];
    r.resize(residual_count + theta.size() + (knots_.size() > 2 ? knots_.size() - 2 : 0));
    for (std::size_t j = 0; j < theta.size(); ++j)
      r[residual_count + j] = model_.params[j].prior * (theta[j] - anchor_[j]);
    for (std::size_t k = 1; k + 1 < knots_.size(); ++k)
      r[residual_count + theta.size() + k - 1] =
          curve_smoothness * (theta[knots_[k - 1]] - 2 * theta[knots_[k]] + theta[knots_[k + 1]]);
    return r;
  }

  // Levenberg-Marquardt in step-normalized coordinates. The Jacobian is formed
  // by forward differences once, then kept current with Broyden rank-one
  // updates from every trial, accepted or not: one render per iteration.
  void refine(std::vector<double>& theta, unsigned iterations) {
    const std::size_t p = theta.size();
    auto r = residual(theta);
    const std::size_t m = r.size();
    if (jacobian_.empty()) {
      jacobian_.assign(m * p, 0);
      for (std::size_t j = 0; j < p; ++j) {
        const auto& param = model_.params[j];
        if (!active_[j]) {
          jacobian_[(residual_count + j) * p + j] = param.prior * param.step;
          continue;
        }
        auto probe = theta;
        const double h = probe[j] + param.step <= param.high ? param.step : -param.step;
        probe[j] += h;
        const auto shifted = residual(probe);
        for (std::size_t i = 0; i < m; ++i) jacobian_[i * p + j] = (shifted[i] - r[i]) / (h / param.step);
      }
    }
    double cost = sum_squares(r), damping = 1e-3;
    unsigned stalls = 0;
    for (unsigned iteration = 0; iteration < iterations; ++iteration) {
      std::vector<double> normal(p * p, 0), gradient(p, 0);
      for (std::size_t i = 0; i < m; ++i) {
        const double* row = &jacobian_[i * p];
        for (std::size_t a = 0; a < p; ++a) {
          if (row[a] == 0) continue;
          gradient[a] -= row[a] * r[i];
          for (std::size_t b = a; b < p; ++b) normal[a * p + b] += row[a] * row[b];
        }
      }
      for (std::size_t a = 0; a < p; ++a)
        for (std::size_t b = 0; b < a; ++b) normal[a * p + b] = normal[b * p + a];
      for (std::size_t a = 0; a < p; ++a) normal[a * p + a] += damping * std::max(normal[a * p + a], 1e-6) + 1e-9;
      auto step = gradient;
      if (!solve_spd(normal, step, p)) {
        damping *= 10;
        continue;
      }
      auto trial = theta;
      for (std::size_t j = 0; j < p; ++j) trial[j] += step[j] * model_.params[j].step;
      project(model_, trial);
      std::vector<double> moved(p);
      double moved_norm = 0, largest = 0;
      for (std::size_t j = 0; j < p; ++j) {
        moved[j] = (trial[j] - theta[j]) / model_.params[j].step;
        moved_norm += moved[j] * moved[j];
        largest = std::max(largest, std::abs(moved[j]));
      }
      if (largest < 1e-3) break;
      const auto next = residual(trial);
      // Broyden: J += (dr - J dz) dz^T / (dz^T dz)
      for (std::size_t i = 0; i < m; ++i) {
        double predicted = 0;
        for (std::size_t j = 0; j < p; ++j) predicted += jacobian_[i * p + j] * moved[j];
        const double miss = (next[i] - r[i] - predicted) / moved_norm;
        if (miss == 0) continue;
        for (std::size_t j = 0; j < p; ++j)
          if (active_[j] || i >= residual_count) jacobian_[i * p + j] += miss * moved[j];
      }
      const double next_cost = sum_squares(next);
      if (next_cost < cost) {
        stalls = (cost - next_cost) < cost * 2e-3 ? stalls + 1 : 0;
        theta = trial;
        r = next;
        cost = next_cost;
        damping = std::max(1e-6, damping / 3);
        if (stalls >= 2) break;
      } else {
        damping *= 4;
        if (damping > 1e4) break;
      }
    }
  }

 private:
  const Image& loop_;
  const LookDescriptor& look_;
  const Model& model_;
  std::vector<double> anchor_;
  std::vector<bool> active_;
  std::vector<double> bias_;
  std::vector<double> jacobian_;
  std::vector<std::size_t> knots_;
  unsigned evaluations_ = 0;
};

// Piecewise-linear map from one luma distribution onto another.
struct Transfer {
  std::vector<double> x, y;
  double at(double v) const {
    if (v <= x.front()) return y.front();
    for (std::size_t i = 1; i < x.size(); ++i)
      if (v <= x[i]) return y[i - 1] + (y[i] - y[i - 1]) * (v - x[i - 1]) / (x[i] - x[i - 1]);
    return y.back();
  }
};
Transfer quantile_transfer(const LookDescriptor& from, const LookDescriptor& to) {
  std::vector<double> x, y;
  for (std::size_t q = 0; q < look_quantile_count; ++q) {
    const double source = lightness_to_encoded(from.quantiles[q]);
    const double target = lightness_to_encoded(to.quantiles[q]);
    if (!x.empty() && source <= x.back() + 1e-4) continue;  // flat stretch of the histogram
    x.push_back(source);
    y.push_back(y.empty() ? target : std::max(target, y.back()));
  }
  if (x.size() < 2) return {{0, 1}, {0, 1}};
  const auto extend = [](double x0, double y0, double x1, double y1, double at) {
    const double slope = std::clamp((y1 - y0) / (x1 - x0), .25, 4.0);
    return std::clamp(y0 + (at - x0) * slope, 0.0, 1.0);
  };
  Transfer t;
  const double low = extend(x[0], y[0], x[1], y[1], 0);
  const double high = extend(x[x.size() - 1], y[y.size() - 1], x[x.size() - 2], y[y.size() - 2], 1);
  if (x.front() > 0) { t.x.push_back(0); t.y.push_back(std::min(low, y.front())); }
  for (std::size_t i = 0; i < x.size(); ++i) { t.x.push_back(x[i]); t.y.push_back(y[i]); }
  if (x.back() < 1) { t.x.push_back(1); t.y.push_back(std::max(high, y.back())); }
  return t;
}

// develop.cpp tone stage on a gray of code value v.
double tone(const DevelopSettings& s, double v) {
  const double shift = s.shadows * .0025 * (1 - v) * (1 - v) + s.highlights * .0025 * v * v +
                       s.blacks * .0015 * std::pow(1 - v, 5) + s.whites * .0015 * std::pow(v, 5);
  return std::clamp((v + shift - .5) * (1 + s.contrast * .008) + .5, 0.0, 1.0);
}

// Quantile mapping expressed as the photographer's tone controls first, the
// point curve for what they cannot say, and Fade for lifted blacks.
void initialize_tone(const Transfer& transfer, DevelopSettings& s, std::array<double, knot_count>& knots) {
  const double low = transfer.at(0), high = transfer.at(1);
  // Fade lifts black by .0015/unit and compresses white by .0015/unit.
  s.fade = std::round(std::clamp(std::min(low, 1 - high) / .0015, 0.0, 60.0));
  const double lift = s.fade * .0015, scale = 1 - s.fade * .003;
  const auto wanted = [&](double v) { return std::clamp((transfer.at(v) - lift) / scale, 0.0, 1.0); };

  // Contrast from the inter-decile slope; the rest as a ridge least-squares fit
  // of the tone equation's four shift terms to the remaining residual.
  const double slope = std::clamp((wanted(.9) - wanted(.1)) / .8, .7, 1.4);
  s.contrast = std::round(std::clamp((slope - 1) / .008, -30.0, 30.0));
  const double gain = 1 + s.contrast * .008;
  std::array<double, 16> normal{};
  std::array<double, 4> rhs{};
  for (int k = 1; k < 16; ++k) {
    const double v = k / 16.0;
    const double residual = (wanted(v) - .5) / gain + .5 - v;
    const std::array<double, 4> basis{.0025 * (1 - v) * (1 - v), .0025 * v * v, .0015 * std::pow(1 - v, 5),
                                      .0015 * std::pow(v, 5)};
    for (int a = 0; a < 4; ++a) {
      rhs[a] += basis[a] * residual;
      for (int b = 0; b < 4; ++b) normal[a * 4 + b] += basis[a] * basis[b];
    }
  }
  double trace = 0;
  for (int a = 0; a < 4; ++a) trace += normal[a * 4 + a];
  // The four shapes are nearly collinear; a firm ridge keeps the sliders to
  // the broad strokes and leaves the detail to the point curve.
  for (int a = 0; a < 4; ++a) normal[a * 4 + a] += trace * .1 + 1e-12;
  std::vector<double> solution(rhs.begin(), rhs.end());
  if (solve_spd(std::vector<double>(normal.begin(), normal.end()), solution, 4)) {
    s.shadows = std::round(std::clamp(solution[0], -30.0, 30.0));
    s.highlights = std::round(std::clamp(solution[1], -30.0, 30.0));
    s.blacks = std::round(std::clamp(solution[2], -30.0, 30.0));
    s.whites = std::round(std::clamp(solution[3], -30.0, 30.0));
  }
  // Knot k sits at tone-output u = k/8; invert the (monotone) tone stage there.
  const double bottom = tone(s, 0), top = tone(s, 1);
  for (std::size_t k = 0; k < knot_count; ++k) {
    const double u = double(k) / (knot_count - 1);
    double lo = 0, hi = 1;
    if (u <= bottom) hi = 0;
    else if (u >= top) lo = 1;
    else
      for (int i = 0; i < 40; ++i) {
        const double mid = (lo + hi) / 2;
        (tone(s, mid) < u ? lo : hi) = mid;
      }
    knots[k] = wanted((lo + hi) / 2);
    if (k) knots[k] = std::max(knots[k], knots[k - 1]);
  }
}

// Temperature and tint that remove a measured cast (develop_auto.cpp's solve).
std::array<double, 2> neutralizing_balance(const LookDescriptor& d) {
  if (!d.cast_measured) return {0, 0};
  return {(d.cast_red - d.cast_blue) / .007, (d.cast_red + d.cast_blue) / .006};
}

// Best grading wheel for a wanted a*/b* shift of a gray at `level` (code value).
std::array<double, 2> initialize_wheel(double level, int zone, double want_a, double want_b) {
  if (std::hypot(want_a, want_b) < .5) return {0, 0};
  // develop.cpp tonal model at Blending 50.
  const double sigma = .16 + .34 * .5, precision = 1 / (2 * sigma * sigma);
  double total = 0;
  std::array<double, 3> weights{};
  for (int g = 0; g < 3; ++g) { weights[g] = std::exp(-std::pow(level - g * .5, 2) * precision); total += weights[g]; }
  const double weight = weights[std::size_t(zone)] / total;
  const Lab gray = lab_encoded(level, level, level);
  double best_score = 0, best_hue = 0, best_saturation = 0;
  for (int hue = 0; hue < 360; hue += 5) {
    const auto tint = wheel_tint(hue);
    const double tint_luma = .2126 * tint[0] + .7152 * tint[1] + .0722 * tint[2];
    std::array<double, 3> rgb{};
    for (int c = 0; c < 3; ++c) rgb[std::size_t(c)] = level + weight * (tint[std::size_t(c)] - tint_luma) * 10 * .003;
    const Lab shifted = lab_encoded(rgb[0], rgb[1], rgb[2]);
    const double ea = shifted.a - gray.a, eb = shifted.b - gray.b, length = std::hypot(ea, eb);
    if (length < 1e-6) continue;
    const double along = (ea * want_a + eb * want_b) / length;
    if (along > best_score) { best_score = along; best_hue = hue; best_saturation = 10 * along / length; }
  }
  const double saturation = std::clamp(best_saturation, 0.0, 60.0);
  return {saturation * std::cos(best_hue * pi / 180), saturation * std::sin(best_hue * pi / 180)};
}

// What a look never touches, and every owned control at neutral.
DevelopSettings look_base(const DevelopSettings& current) {
  DevelopSettings s;
  s.texture = current.texture;
  s.sharpening = current.sharpening;
  s.sharpening_radius = current.sharpening_radius;
  s.sharpening_detail = current.sharpening_detail;
  s.sharpening_masking = current.sharpening_masking;
  s.noise_reduction = current.noise_reduction;
  s.color_noise_reduction = current.color_noise_reduction;
  s.crop = current.crop;
  s.masks = current.masks;
  s.tonal_grading = true;
  s.balance = 0;
  s.blending = 50;
  s.curve_interpolation = 1;  // smooth: nine knots without visible corners
  s.curve.clear();
  for (std::size_t k = 0; k < knot_count; ++k) {
    const double x = double(k) / (knot_count - 1);
    s.curve.push_back({x, x});
  }
  return s;
}

double robust_average(std::vector<double> values) {
  std::sort(values.begin(), values.end());
  const auto n = values.size();
  if (n == 0) return 0;
  if (n <= 2) return (values.front() + values.back()) / 2;
  if (n == 3) return values[1];
  double sum = 0;  // n >= 4: drop the single lowest and highest
  for (std::size_t i = 1; i + 1 < n; ++i) sum += values[i];
  return sum / double(n - 2);
}
}  // namespace

std::vector<double> serialize_look(const LookDescriptor& d) {
  std::vector<double> v{look_descriptor_version, double(look_descriptor_size)};
  v.reserve(look_descriptor_size);
  for (double q : d.quantiles) v.push_back(q);
  for (const auto& z : d.zones)
    for (double f : {z.fraction, z.lightness, z.a, z.b, z.neutral_a, z.neutral_b, z.aa, z.ab, z.bb}) v.push_back(f);
  for (const auto& b : d.bands)
    for (double f : {b.mass, b.saturation, b.lightness, b.hue, b.chroma}) v.push_back(f);
  for (double f : {d.a, d.b, d.neutral_a, d.neutral_b, d.chroma, d.contrast, d.local_contrast}) v.push_back(f);
  for (double r : d.radial) v.push_back(r);
  v.push_back(d.noise);
  v.push_back(d.cast_red);
  v.push_back(d.cast_blue);
  v.push_back(d.cast_measured ? 1 : 0);
  return v;
}

LookDescriptor deserialize_look(const double* values, std::size_t size) {
  if (!values || size != look_descriptor_size || values[0] != look_descriptor_version ||
      values[1] != double(look_descriptor_size))
    throw std::invalid_argument("This look was measured by a different engine version. Drop the photo again.");
  for (std::size_t i = 0; i < size; ++i)
    if (!std::isfinite(values[i])) throw std::invalid_argument("Invalid look measurement.");
  LookDescriptor d;
  std::size_t k = 2;
  for (double& q : d.quantiles) q = values[k++];
  for (auto& z : d.zones)
    for (double* f : {&z.fraction, &z.lightness, &z.a, &z.b, &z.neutral_a, &z.neutral_b, &z.aa, &z.ab, &z.bb}) *f = values[k++];
  for (auto& b : d.bands)
    for (double* f : {&b.mass, &b.saturation, &b.lightness, &b.hue, &b.chroma}) *f = values[k++];
  for (double* f : {&d.a, &d.b, &d.neutral_a, &d.neutral_b, &d.chroma, &d.contrast, &d.local_contrast}) *f = values[k++];
  for (double& r : d.radial) r = values[k++];
  d.noise = values[k++];
  d.cast_red = values[k++];
  d.cast_blue = values[k++];
  d.cast_measured = values[k++] != 0;
  return d;
}

LookDescriptor describe_look(const Image& image) {
  validate_image(image);
  auto d = measure(stride_sample(image, look_working_edge));
  unsigned tile = 0;
  d.noise = measure_noise(noise_tiles(image, tile), tile);
  measure_cast(image, d);
  return d;
}

LookDescriptor combine_looks(const std::vector<LookDescriptor>& looks) {
  if (looks.empty()) throw std::invalid_argument("Drop at least one inspiration photo.");
  if (looks.size() == 1) return looks.front();
  std::vector<std::vector<double>> flat;
  for (const auto& look : looks) flat.push_back(serialize_look(look));
  constexpr std::size_t band_start = 2 + look_quantile_count + look_zone_count * 9;
  std::vector<double> combined(look_descriptor_size);
  combined[0] = look_descriptor_version;
  combined[1] = double(look_descriptor_size);
  for (std::size_t i = 2; i < look_descriptor_size; ++i) {
    std::vector<double> values;
    const bool band = i >= band_start && i < band_start + look_band_count * 5;
    const std::size_t mass_index = band ? band_start + (i - band_start) / 5 * 5 : 0;
    for (const auto& one : flat) {
      // A band's color statistics only count where that color is present.
      if (band && i != mass_index && one[mass_index] < .004) continue;
      values.push_back(one[i]);
    }
    if (values.empty())
      for (const auto& one : flat) values.push_back(one[i]);
    combined[i] = robust_average(std::move(values));
  }
  auto result = deserialize_look(combined.data(), combined.size());
  // The cast is only an average over inspirations where it was measured.
  std::vector<double> red, blue;
  for (const auto& look : looks)
    if (look.cast_measured) { red.push_back(look.cast_red); blue.push_back(look.cast_blue); }
  result.cast_measured = !red.empty();
  result.cast_red = robust_average(red);
  result.cast_blue = robust_average(blue);
  return result;
}

double look_distance(const LookDescriptor& candidate, const LookDescriptor& look) {
  std::array<double, residual_count> r{};
  residuals(candidate, look, true, r.data());
  double sum = 0;
  for (double v : r) sum += v * v;
  return std::sqrt(sum / residual_count);
}

LookMatch match_look(const Image& target, const LookDescriptor& look, const DevelopSettings& current,
                     std::uint32_t output_edge) {
  validate_image(target);
  validate_develop(current);
  LookMatch result;
  result.settings = current;
  const Image working = stride_sample(target, look_working_edge);
  const Image loop = stride_sample(working, look_loop_edge);
  const auto render = [&](const Image& image, const DevelopSettings& settings) {
    ++result.renders;
    return measure(develop(image, settings));
  };

  // Nothing to match on a frame without tonal information.
  const auto source = measure(working);
  if (source.quantiles.back() - source.quantiles.front() < 1) return result;
  result.applicable = true;

  Model model{look_base(current), {}};
  auto& base = model.base;

  // 1. Normalize the target: its own exposure (median to the look's median, in
  //    linear light) and its own neutral cast, replaced by the look's cast.
  const auto luminance = [](double l) {
    const double f = (l + 16) / 116;
    return std::max(1e-4, l > 8 ? f * f * f : l * 27 / 24389);
  };
  auto target_cast = source;
  measure_cast(target, target_cast);
  const auto neutral = render(loop, base);
  {
    double ev = std::log2(luminance(look.quantiles[6]) / luminance(neutral.quantiles[6]));
    // Never buy midtones with blown highlights: exposure clips in linear
    // light, and what it clips no curve can bring back. The curve lifts the
    // rest. A frame already bright at its 99th percentile gets no push.
    if (ev > 0) ev = std::min(ev, std::max(0.0, std::log2(luminance(97) / luminance(neutral.quantiles.back()))));
    base.exposure = std::round(std::clamp(ev, -2.5, 2.5) * 100) / 100;
  }
  if (target_cast.cast_measured && look.cast_measured) {
    // Both frames show real neutrals: remove the capture's cast, add the look's.
    const auto remove = neutralizing_balance(target_cast);
    const auto add = neutralizing_balance(look);
    base.temperature = std::round(std::clamp(remove[0] - add[0], -100.0, 100.0));
    base.tint = std::round(std::clamp(remove[1] - add[1], -40.0, 40.0));
  } else {
    // Too few neutrals to trust a cast (stage light, a wall of jerseys): move
    // the soft-neutral a*/b* mean the objective reads, through the white
    // balance gains' own response at middle gray.
    const auto shifted = [](double temperature, double tint) {
      const double g = lightness_to_encoded(50);
      return lab_encoded(g * std::exp2(temperature * .0035 + tint * .001), g * std::exp2(-tint * .002),
                         g * std::exp2(-temperature * .0035 + tint * .001));
    };
    const Lab gray = shifted(0, 0), warm = shifted(10, 0), magenta = shifted(0, 10);
    const double at = (warm.a - gray.a) / 10, bt = (warm.b - gray.b) / 10;
    const double ai = (magenta.a - gray.a) / 10, bi = (magenta.b - gray.b) / 10;
    const double determinant = at * bi - ai * bt;
    const double want_a = look.neutral_a - neutral.neutral_a, want_b = look.neutral_b - neutral.neutral_b;
    if (std::abs(determinant) > 1e-9) {
      base.temperature = std::round(std::clamp((want_a * bi - ai * want_b) / determinant, -60.0, 60.0));
      base.tint = std::round(std::clamp((at * want_b - want_a * bt) / determinant, -40.0, 40.0));
    }
  }

  // 2. Tone: map this frame's luma quantiles onto the look's.
  std::array<double, knot_count> knots{};
  initialize_tone(quantile_transfer(render(loop, base), look), base, knots);
  for (std::size_t k = 0; k < knot_count; ++k) base.curve[k].y = knots[k];
  const auto toned = render(loop, base);

  // 3. Color: global saturation, per-band saturation and hue, split-tone wheels.
  if (toned.chroma > .5) base.saturation = std::round(std::clamp(100 * (look.chroma / toned.chroma - 1), -100.0, 35.0));
  const double chroma_gain = 1 + base.saturation / 100;
  std::array<double, look_band_count> band_hue{}, band_saturation{};
  for (std::size_t band = 0; band < look_band_count; ++band) {
    const auto& have = toned.bands[band];
    const auto& want = look.bands[band];
    if (std::min(have.mass, want.mass) < .004) continue;
    band_saturation[band] = std::clamp(60 * (want.saturation / std::max(.02, have.saturation * chroma_gain) - 1), -60.0, 60.0);
    band_hue[band] = std::clamp((want.hue - have.hue) * 600 / 360 * .6, -60.0, 60.0);
  }
  std::array<std::array<double, 2>, 2> wheels{};
  for (int i = 0; i < 2; ++i) {
    const std::size_t zone = i == 0 ? 0 : 2;
    const auto& have = toned.zones[zone];
    const auto& want = look.zones[zone];
    if (std::min(have.fraction, want.fraction) < .03) continue;
    wheels[std::size_t(i)] = initialize_wheel(lightness_to_encoded(have.lightness), i == 0 ? 0 : 2,
        (want.neutral_a - have.neutral_a) - (look.neutral_a - toned.neutral_a),
        (want.neutral_b - have.neutral_b) - (look.neutral_b - toned.neutral_b));
  }
  // Vignette from the outer ring's lightness step, darkening or brightening.
  {
    const double want = look.radial[2] - toned.radial[2], level = std::clamp(toned.quantiles[6], 5.0, 95.0);
    const double reach = .006 * .89;
    base.vignette = std::round(std::clamp(.8 * (want < 0 ? want / (level * reach) : want / ((100 - level) * reach)), -100.0, 100.0));
  }

  // 4. Clarity seed: local contrast scales with global contrast, and Clarity
  //    multiplies it by about (1 + .012 * clarity). Refined on the working image.
  if (source.local_contrast > .05 && source.contrast > 1) {
    const double expected = source.local_contrast * look.contrast / source.contrast;
    base.clarity = std::round(std::clamp((look.local_contrast / expected - 1) / .012, -60.0, 60.0));
  }

  // 5. Closed-loop refinement through develop().
  std::vector<double> theta, anchor;
  std::vector<bool> active;
  const auto add_param = [&](Param p, double value, double anchor_value, bool is_active) {
    model.params.push_back(p);
    theta.push_back(std::clamp(value, p.low, p.high));
    anchor.push_back(anchor_value);
    active.push_back(is_active);
  };
  add_param({Knob::temperature, 0, -100, 100, 2, .02}, base.temperature, base.temperature, true);
  add_param({Knob::tint, 0, -40, 40, 2, .02}, base.tint, base.tint, true);
  for (std::size_t k = 0; k < knot_count; ++k)
    add_param({Knob::curve, int(k), 0, k == 0 ? .5 : 1, .02, 2}, knots[k], knots[k], true);
  add_param({Knob::saturation, 0, -100, 35, 3, .01}, base.saturation, base.saturation, toned.chroma > .5);
  for (std::size_t band = 0; band < look_band_count; ++band) {
    const bool present = std::max(toned.bands[band].mass, look.bands[band].mass) > .002 &&
                         std::min(toned.bands[band].mass, look.bands[band].mass) > .0005;
    add_param({Knob::hue, int(band), -60, 60, 4, .05}, band_hue[band], 0, present);
    add_param({Knob::sat, int(band), -80, 80, 4, .04}, band_saturation[band], 0, present);
    add_param({Knob::lum, int(band), -60, 60, 4, .05}, 0, 0, present);
  }
  for (int i = 0; i < 2; ++i) {
    add_param({Knob::wheel_u, i, -100, 100, 4, .01}, wheels[std::size_t(i)][0], 0, true);
    add_param({Knob::wheel_v, i, -100, 100, 4, .01}, wheels[std::size_t(i)][1], 0, true);
  }
  add_param({Knob::fade, 0, 0, 60, 3, .03}, base.fade, 0, true);
  add_param({Knob::vignette, 0, -80, 20, 4, .015}, base.vignette, 0, true);
  project(model, theta);

  // 6. Grain is analytic: stride samples keep it, but its amount must be read
  //    on contiguous pixels. Compare against the target's noise *after* the
  //    initial tone and color (contrast amplifies sensor noise too), then add
  //    only the missing noise power, at the output's own scale.
  {
    unsigned tile = 0;
    const auto tiles = noise_tiles(target, tile);
    auto toned_settings = compose(model, theta);
    toned_settings.vignette = toned_settings.clarity = toned_settings.grain = 0;
    toned_settings.crop = {};
    toned_settings.masks.clear();
    ++result.renders;
    const double have = measure_noise(develop(tiles, toned_settings), tile);
    const double missing = std::sqrt(std::max(0.0, look.noise * look.noise - have * have));
    // Below ~1/255, plus a share of the photo's own noise (the estimator's
    // error grows with it), the difference is JPEG and estimation, not grain.
    if (missing > .004 + .35 * have) {
      const double scale = double(std::max(output_edge, 1u)) / std::max(target.width, target.height);
      base.grain_size = std::round(std::clamp(scale, .5, 4.0) * 10) / 10;
      const double sigma = missing * std::max(1.0, scale / base.grain_size);
      // Uniform [-1,1] grain has sigma 1/sqrt(3); its tonal envelope averages ~.75.
      base.grain = std::round(std::clamp(sigma * std::sqrt(3.0) / (.0012 * .75), 0.0, 100.0));
    }
  }

  Solver solver(loop, look, model, anchor, active);
  auto best = compose(model, theta);
  auto real = render(working, best);
  double best_distance = look_distance(real, look);
  // A second pass polishes. When the first ends visibly short of the look, the
  // Jacobian formed at a poor start is stale: form it again where we are.
  constexpr double polished = .8;
  for (unsigned pass = 0; pass < 2; ++pass) {
    unsigned budget = pass == 0 ? 14 : 8;
    if (pass == 1 && best_distance > polished) {
      solver.forget_jacobian();
      budget = 14;
    }
    // Clarity is spatial, so it is solved on the working image, not in the
    // loop. Re-render only when the correction is visible; the bias below
    // absorbs a few units.
    const double previous_clarity = base.clarity;
    const double without = real.local_contrast / std::max(.05, 1 + .012 * previous_clarity);
    if (without > .05)
      base.clarity = std::round(std::clamp((look.local_contrast / without - 1) / .012, -100.0, 100.0));
    auto settings = compose(model, theta);
    if (std::abs(base.clarity - previous_clarity) >= 6) real = render(working, settings);
    std::vector<double> real_r(residual_count), loop_r(residual_count);
    residuals(real, look, false, real_r.data());
    residuals(measure(develop(loop, settings), false), look, false, loop_r.data());
    solver.set_bias(real_r, loop_r);
    solver.refine(theta, budget);
    const auto candidate = compose(model, theta);
    real = render(working, candidate);
    const double distance = look_distance(real, look);
    if (distance < best_distance) { best = candidate; best_distance = distance; }
  }
  result.evaluations = solver.evaluations();
  validate_develop(best);
  result.settings = best;
  result.distance = best_distance;
  return result;
}

}  // namespace lenslabs
