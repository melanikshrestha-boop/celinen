#include "lenslabs/engine.hpp"

#include <algorithm>
#include <bit>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace lenslabs {
namespace {

constexpr std::size_t maximum_pixels = 16u * 1024u * 1024u;

std::size_t validate_image(const Image& image) {
  if (image.width < 3 || image.width > 8192 || image.height < 3 || image.height > 8192) {
    throw std::invalid_argument("RGBA image dimensions must be between 3 and 8192.");
  }
  const auto pixels = static_cast<std::size_t>(image.width) * image.height;
  if (pixels > maximum_pixels || image.rgba.size() != pixels * 4) {
    throw std::invalid_argument("RGBA image must contain exactly four bytes per pixel, at most 16 Mi pixels.");
  }
  return pixels;
}

// Integer coefficients avoid rounding at gray clipping thresholds and hash ties.
std::uint32_t luma_scaled(const std::uint8_t* pixel) noexcept {
  return 299u * pixel[0] + 587u * pixel[1] + 114u * pixel[2];
}

double luma(double red, double green, double blue) noexcept {
  return (299.0 * red + 587.0 * green + 114.0 * blue) / 1000.0;
}

std::uint64_t average_hash(const Image& image) {
  std::array<std::uint64_t, 64> sums{};
  std::uint64_t total = 0;
  for (std::uint32_t row = 0; row < 8; ++row) {
    for (std::uint32_t column = 0; column < 8; ++column) {
      // Coordinates use eighth-pixel units. Every hash cell has identical area
      // (width * height in these units), including images smaller than 8×8.
      const auto left = column * image.width;
      const auto right = (column + 1) * image.width;
      const auto top = row * image.height;
      const auto bottom = (row + 1) * image.height;
      std::uint64_t sum = 0;
      for (auto y = top / 8; y < (bottom + 7) / 8; ++y) {
        const auto overlap_y = std::min(bottom, (y + 1) * 8) - std::max(top, y * 8);
        for (auto x = left / 8; x < (right + 7) / 8; ++x) {
          const auto overlap_x = std::min(right, (x + 1) * 8) - std::max(left, x * 8);
          const auto index = (static_cast<std::size_t>(y) * image.width + x) * 4;
          sum += static_cast<std::uint64_t>(luma_scaled(image.rgba.data() + index)) *
                 overlap_x * overlap_y;
        }
      }
      sums[row * 8 + column] = sum;
      total += sum;
    }
  }
  std::uint64_t hash = 0;
  for (const auto sum : sums) {
    // Row-major, top-left in the most significant bit. Exact ties are 1.
    hash = (hash << 1) | static_cast<std::uint64_t>(sum * 64 >= total);
  }
  return hash;
}

void validate_edit(double value, double bound, const char* name) {
  if (!std::isfinite(value) || value < -bound || value > bound) {
    throw std::invalid_argument(std::string(name) + " is nonfinite or outside its supported range.");
  }
}

std::uint8_t byte(double value) noexcept {
  return static_cast<std::uint8_t>(std::lround(std::clamp(value, 0.0, 255.0)));
}

}  // namespace

Analysis analyze(const Image& image) {
  const auto pixels = validate_image(image);
  Analysis analysis;
  const auto width = static_cast<std::size_t>(image.width);
  std::vector<double> gray(3 * width);
  double sum = 0;
  std::size_t high = 0;
  std::size_t low = 0;
  std::size_t count = 0;
  double mean = 0;
  double squared_deviation = 0;
  for (std::uint32_t y = 0; y < image.height; ++y) {
    auto* row = gray.data() + (y % 3) * width;
    for (std::size_t x = 0; x < width; ++x) {
      const auto index = static_cast<std::size_t>(y) * width + x;
      const auto value = static_cast<double>(luma_scaled(image.rgba.data() + index * 4)) / 1000.0;
      row[x] = value;
      ++analysis.histogram[static_cast<std::size_t>(std::lround(value))];
      sum += value;
      high += value > 250.0;
      low += value < 5.0;
    }
    if (y < 2) continue;
    // Once the next row is available, consume the center row in the same
    // row-major order as the full-plane implementation. Welford's recurrence
    // and histogram arithmetic remain unchanged; scratch is independent of height.
    const auto* center = gray.data() + ((y - 1) % 3) * width;
    const auto* above = gray.data() + ((y - 2) % 3) * width;
    for (std::size_t x = 1; x + 1 < width; ++x) {
      const double laplacian = 4 * center[x] - center[x - 1] - center[x + 1] -
                               above[x] - row[x];
      const double delta = laplacian - mean;
      mean += delta / static_cast<double>(++count);
      squared_deviation += delta * (laplacian - mean);
    }
  }
  analysis.brightness = sum / static_cast<double>(pixels);
  analysis.clipped_highlights = 100.0 * static_cast<double>(high) / static_cast<double>(pixels);
  analysis.clipped_shadows = 100.0 * static_cast<double>(low) / static_cast<double>(pixels);
  analysis.sharpness = std::max(0.0, squared_deviation / static_cast<double>(count));
  analysis.hash = average_hash(image);
  analysis.blur = analysis.sharpness < 40;
  analysis.soft = !analysis.blur && analysis.sharpness < 130;
  const double focus = std::clamp(std::log10(1 + analysis.sharpness) / 2.9, 0.0, 1.0);
  double exposure = 1;
  if (analysis.brightness < 55) {
    analysis.underexposed = true;
    exposure = std::max(0.2, analysis.brightness / 55);
  } else if (analysis.brightness > 200 || analysis.clipped_highlights > 12) {
    analysis.overexposed = true;
    exposure = 0.55;
  }
  if (analysis.clipped_shadows > 25) exposure *= 0.8;
  analysis.score = static_cast<int>(std::lround(std::clamp((focus * 0.72 + exposure * 0.28) * 100, 1.0, 99.0)));
  return analysis;
}

LightRecipe suggest_light(const Analysis& analysis) {
  if (!std::isfinite(analysis.brightness) || !std::isfinite(analysis.clipped_highlights) ||
      !std::isfinite(analysis.clipped_shadows) || analysis.brightness < 0 ||
      analysis.brightness > 255 || analysis.clipped_highlights < 0 ||
      analysis.clipped_highlights > 100 || analysis.clipped_shadows < 0 ||
      analysis.clipped_shadows > 100) {
    throw std::invalid_argument("Light suggestion requires a finite analysis.");
  }
  LightRecipe recipe;
  if (analysis.clipped_highlights > 1 || analysis.brightness > 170) {
    recipe.highlights = -std::clamp(
        analysis.clipped_highlights * 3.5 + std::max(0.0, analysis.brightness - 165) * 0.55, 8.0,
        80.0);
    recipe.whites = -std::clamp(
        analysis.clipped_highlights * 2.0 + std::max(0.0, analysis.brightness - 180) * 0.35, 0.0,
        55.0);
    if (analysis.brightness > 210)
      recipe.exposure_ev = -std::clamp((analysis.brightness - 210) / 50.0, 0.0, 0.8);
  }
  if (analysis.clipped_shadows > 4 || analysis.brightness < 90) {
    recipe.shadows = std::clamp(
        analysis.clipped_shadows * 1.8 + std::max(0.0, 90.0 - analysis.brightness) * 0.4, 6.0, 70.0);
    if (analysis.brightness < 55)
      recipe.exposure_ev = std::clamp((55.0 - analysis.brightness) / 55.0, 0.15, 1.2);
  }
  recipe.highlights = std::round(recipe.highlights);
  recipe.shadows = std::round(recipe.shadows);
  recipe.whites = std::round(recipe.whites);
  recipe.blacks = std::round(recipe.blacks);
  recipe.exposure_ev = std::round(recipe.exposure_ev * 100.0) / 100.0;
  return recipe;
}

Image render(const Image& image, const Edits& edits) {
  const auto pixels = validate_image(image);
  validate_edit(edits.exposure_ev, 5, "Exposure EV");
  validate_edit(edits.contrast, 100, "Contrast");
  validate_edit(edits.highlights, 100, "Highlights");
  validate_edit(edits.shadows, 100, "Shadows");
  validate_edit(edits.saturation, 100, "Saturation");

  Image output = image;
  if (edits.exposure_ev == 0 && edits.contrast == 0 && edits.highlights == 0 &&
      edits.shadows == 0 && edits.saturation == 0) return output;

  const double gain = std::exp2(edits.exposure_ev);
  const double contrast = 1 + edits.contrast / 100;
  const double saturation = 1 + edits.saturation / 100;
  for (std::size_t index = 0; index < pixels; ++index) {
    const auto offset = index * 4;
    double red = (image.rgba[offset] * gain - 128) * contrast + 128;
    double green = (image.rgba[offset + 1] * gain - 128) * contrast + 128;
    double blue = (image.rgba[offset + 2] * gain - 128) * contrast + 128;
    const double light = std::clamp(luma(red, green, blue), 0.0, 255.0);
    const double high_mask = std::clamp((light - 128) / 127, 0.0, 1.0);
    const double low_mask = std::clamp((128 - light) / 128, 0.0, 1.0);
    const double tone = (edits.highlights * high_mask + edits.shadows * low_mask) * 0.7;
    red += tone;
    green += tone;
    blue += tone;
    const double gray = luma(red, green, blue);
    output.rgba[offset] = byte(gray + (red - gray) * saturation);
    output.rgba[offset + 1] = byte(gray + (green - gray) * saturation);
    output.rgba[offset + 2] = byte(gray + (blue - gray) * saturation);
    // Alpha is copied verbatim; RGB edits do not premultiply/unpremultiply it.
  }
  return output;
}

Verdict first_pass(const Analysis& analysis, Verdict existing) {
  if (existing != Verdict::undecided) return existing;
  if (analysis.score < 0 || analysis.score > 100 || !std::isfinite(analysis.sharpness) ||
      !std::isfinite(analysis.brightness) || !std::isfinite(analysis.clipped_highlights) ||
      !std::isfinite(analysis.clipped_shadows)) return Verdict::undecided;
  if (analysis.blur || analysis.score < 45) return Verdict::reject;
  return analysis.score >= 70 ? Verdict::keep : Verdict::undecided;
}

const char* verdict_name(Verdict verdict) noexcept {
  switch (verdict) {
    case Verdict::keep: return "keep";
    case Verdict::reject: return "reject";
    case Verdict::undecided: return "undecided";
  }
  return "unknown";
}

unsigned hamming_distance(std::uint64_t a, std::uint64_t b) noexcept {
  return static_cast<unsigned>(std::popcount(a ^ b));
}

}  // namespace lenslabs
