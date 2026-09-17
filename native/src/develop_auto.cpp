#include "lenslabs/develop_auto.hpp"
#include <algorithm>
#include <array>
#include <cmath>

// Every constant below is tied to develop.cpp's tone stage:
//   shift = shadows*.0025*(1-L)^2 + highlights*.0025*L^2
//         + blacks*.0015*(1-L)^5 + whites*.0015*L^5
//   out   = (v + shift - .5) * (1 + contrast*.008) + .5
// and its white balance gains (r *= 2^(t*.0035 + tint*.001), g *= 2^(-tint*.002),
// b *= 2^(-t*.0035 + tint*.001)). Solving against those exact expressions is what
// lets a suggestion land on its target instead of merely pointing toward it.
namespace lenslabs {
namespace {
constexpr std::size_t bins = 256;
using Histogram = std::array<double, bins>;

double linear(double v) { return v <= .04045 ? v / 12.92 : std::pow((v + .055) / 1.055, 2.4); }
double srgb(double v) { return v <= .0031308 ? v * 12.92 : 1.055 * std::pow(v, 1 / 2.4) - .055; }
double round_to(double value, double step) { return std::round(value / step) * step; }

// Luminance at a cumulative fraction, interpolated inside the winning bin so a
// smooth gradient does not quantize every percentile to 1/255 steps.
double percentile(const Histogram& h, double total, double fraction) {
  const double target = total * fraction;
  double seen = 0;
  for (std::size_t i = 0; i < bins; ++i) {
    if (seen + h[i] >= target && h[i] > 0)
      return std::clamp((double(i) + (target - seen) / h[i]) / double(bins), 0.0, 1.0);
    seen += h[i];
  }
  return 1;
}
double fraction_between(const Histogram& h, double total, std::size_t first, std::size_t last) {
  double sum = 0;
  for (std::size_t i = first; i <= last; ++i) sum += h[i];
  return sum / total;
}
} // namespace

DevelopAuto suggest_develop(const Image& image) {
  DevelopAuto out;
  const std::size_t n = std::size_t(image.width) * image.height;
  if (!n || image.rgba.size() != n * 4) return out;

  // A bounded sample keeps the measurement near-constant time on a 36MP export
  // source; a regular stride is deterministic and unbiased for natural images.
  const auto stride = std::max<std::size_t>(1, std::size_t(std::sqrt(double(n) / 250000.0)));
  Histogram histogram{};
  double total = 0, chroma_sum = 0;
  std::array<double, 3> neutral_sum{};
  double neutral_count = 0;
  for (std::uint32_t y = 0; y < image.height; y += std::uint32_t(stride))
    for (std::uint32_t x = 0; x < image.width; x += std::uint32_t(stride)) {
      const auto i = (std::size_t(y) * image.width + x) * 4;
      const double r = image.rgba[i] / 255.0, g = image.rgba[i + 1] / 255.0, b = image.rgba[i + 2] / 255.0;
      const double light = .2126 * r + .7152 * g + .0722 * b;
      const double spread = std::max({r, g, b}) - std::min({r, g, b});
      histogram[std::min(bins - 1, std::size_t(light * double(bins)))] += 1;
      chroma_sum += spread;
      total += 1;
      // Low-chroma mid-tones are the only pixels that can testify about a color
      // cast: shadows are noisy, highlights clip per channel, vivid pixels are subject.
      if (spread < .18 && light > .2 && light < .85) {
        neutral_sum[0] += r; neutral_sum[1] += g; neutral_sum[2] += b;
        neutral_count += 1;
      }
    }
  if (total < 64) return out;
  if (percentile(histogram, total, .995) - percentile(histogram, total, .005) < .02) return out;
  out.applicable = true;

  // Exposure: move the median most of the way to a normal key. Damping keeps
  // intentionally low/high-key frames recognizably themselves.
  const double median = std::max(.02, percentile(histogram, total, .5));
  double ev = .65 * std::log2(linear(.46) / linear(median));
  if (ev > 0) {
    // Never buy mid-tones with blown highlights; leave the remainder to Shadows.
    const double top = std::max(.05, percentile(histogram, total, .99));
    const double headroom = std::log2(linear(.985) / linear(std::min(top, .985)));
    ev = std::min(ev, std::max(headroom, .35 * ev));
  }
  ev = std::clamp(round_to(ev, .05), -2.0, 2.0);
  if (std::abs(ev) < .1) ev = 0;
  out.exposure = ev;

  // Re-bin through the exact exposure transfer so later steps measure the image
  // they will actually act on.
  Histogram exposed{};
  const double gain = std::exp2(ev);
  for (std::size_t i = 0; i < bins; ++i) {
    if (!histogram[i]) continue;
    const double moved = std::clamp(srgb(linear((double(i) + .5) / double(bins)) * gain), 0.0, 1.0);
    exposed[std::min(bins - 1, std::size_t(moved * double(bins)))] += histogram[i];
  }

  const double bright = fraction_between(exposed, total, 230, bins - 1);
  const double dark = fraction_between(exposed, total, 0, 25);
  if (bright > .03) out.highlights = -std::round(std::min(80.0, 20 + bright * 400));
  if (dark > .12) out.shadows = std::round(std::min(70.0, 15 + dark * 150));
  const auto recovered = [&](double light) {
    return light + out.shadows * .0025 * std::pow(1 - light, 2) + out.highlights * .0025 * std::pow(light, 2);
  };

  // Contrast from the inter-decile spread, half-strength: a flat frame opens up,
  // a harsh one relaxes, a normal one is left alone.
  const double spread = recovered(percentile(exposed, total, .9)) - recovered(percentile(exposed, total, .1));
  if (spread > .01 && (spread < .45 || spread > .72))
    out.contrast = std::round(std::clamp((.52 / spread - 1) / .008 * .5, -20.0, 35.0));
  const double slope = 1 + out.contrast * .008;

  // Whites/blacks: solve the tone equation so the 99.5th percentile lands just
  // under clipping and the 0.5th just above it, with contrast already counted.
  const double high = recovered(percentile(exposed, total, .995));
  const double low = recovered(percentile(exposed, total, .005));
  const double high_weight = .0015 * std::pow(std::clamp(high, 0.0, 1.0), 5);
  const double low_weight = .0015 * std::pow(1 - std::clamp(low, 0.0, 1.0), 5);
  if (high_weight > 1e-6)
    out.whites = std::round(std::clamp(((.975 - .5) / slope + .5 - high) / high_weight, -50.0, 60.0));
  if (low_weight > 1e-6)
    out.blacks = std::round(std::clamp(((.02 - .5) / slope + .5 - low) / low_weight, -60.0, 40.0));

  // White balance: neutralize the mean of the near-neutral mid-tones.
  if (neutral_count >= total * .04 && neutral_sum[0] > 0 && neutral_sum[1] > 0 && neutral_sum[2] > 0) {
    const double red = std::log2(neutral_sum[1] / neutral_sum[0]);
    const double blue = std::log2(neutral_sum[1] / neutral_sum[2]);
    const double temperature = (red - blue) / .007, tint = (red + blue) / .006;
    // A huge "cast" across low-chroma pixels is a colored scene, not an error.
    if (std::abs(temperature) <= 50 && std::abs(tint) <= 50) {
      out.white_balance_measured = true;
      out.temperature = std::round(std::clamp(temperature * .7, -35.0, 35.0));
      out.tint = std::round(std::clamp(tint * .7, -35.0, 35.0));
      if (std::abs(out.temperature) < 3) out.temperature = 0;
      if (std::abs(out.tint) < 3) out.tint = 0;
    }
  }

  // Vibrance only ever lifts a muted frame; saturated work is left as shot and
  // a monochrome frame has no color to lift.
  const double chroma = chroma_sum / total;
  if (chroma > .02 && chroma < .2) out.vibrance = std::round(std::min(30.0, (.2 - chroma) * 200));
  return out;
}
} // namespace lenslabs
