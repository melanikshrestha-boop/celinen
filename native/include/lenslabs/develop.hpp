#pragma once
#include "lenslabs/engine.hpp"
#include <algorithm>
#include <cmath>
#include <istream>
#include <stdexcept>

namespace lenslabs {
inline constexpr std::uint32_t develop_standard_edge = 4096;
inline constexpr std::uint32_t develop_max_edge = 8192;
inline constexpr std::uint64_t develop_max_output_pixels = 36000000;
struct DevelopDimensions { std::uint32_t width, height; };
inline bool valid_develop_dimensions(std::uint32_t width, std::uint32_t height,
                                     bool high_resolution = false) {
  const auto edge = high_resolution ? develop_max_edge : develop_standard_edge;
  return width && height && width <= edge && height <= edge &&
    (!high_resolution || std::uint64_t(width) * height <= develop_max_output_pixels);
}
// Requests above the established preview bound explicitly opt into the larger
// output budget. Preserve the old round-to-nearest path exactly at <=4096.
inline DevelopDimensions develop_output_dimensions(std::uint32_t width,
    std::uint32_t height, std::uint32_t max_edge) {
  if (!width || !height || max_edge < 8 || max_edge > develop_max_edge)
    throw std::invalid_argument("Invalid Develop output dimensions.");
  double ratio = std::min(1.0, double(max_edge) / std::max(width, height));
  if (max_edge <= develop_standard_edge)
    return {std::max(1u, unsigned(std::round(width * ratio))),
            std::max(1u, unsigned(std::round(height * ratio)))};
  ratio = std::min(ratio, std::sqrt(double(develop_max_output_pixels) /
                                    (double(width) * height)));
  DevelopDimensions result{std::max(1u, unsigned(std::floor(width * ratio))),
                           std::max(1u, unsigned(std::floor(height * ratio)))};
  if (!valid_develop_dimensions(result.width, result.height, true))
    throw std::invalid_argument("Develop output exceeds the 36-million-pixel bound.");
  return result;
}
// ImageIO may round an aspect-ratio dimension up. Bound its requested edge
// before asking it to materialize a thumbnail, then validate the actual result.
inline std::uint32_t develop_thumbnail_edge(std::uint32_t width,
    std::uint32_t height, std::uint32_t max_edge) {
  const auto size = develop_output_dimensions(width, height, max_edge);
  if (max_edge <= develop_standard_edge) return max_edge;
  auto edge = std::max(size.width, size.height);
  const double longest = std::max(width, height);
  while (edge > 1 && std::ceil(width * (edge / longest)) *
         std::ceil(height * (edge / longest)) > develop_max_output_pixels) --edge;
  return edge;
}
struct CurvePoint { double x = 0, y = 0; };
struct HslAdjustment { double hue = 0, saturation = 0, luminance = 0; };
struct Grade { double hue = 0, saturation = 0, luminance = 0; };
struct DevelopCrop {
  double x = 0, y = 0, width = 1, height = 1, angle = 0;
  int rotate = 0;
  bool flip_x = false, flip_y = false;
};
struct DevelopMask {
  bool radial = true, enabled = true;
  double x = 0.5, y = 0.5, radius = 0.3, aspect = 1, angle = 0, feather = 0.5;
  bool invert = false;
  double exposure = 0, temperature = 0, saturation = 0;
};
struct DevelopSettings {
  // Lightroom Classic Basic: 0 color / 1 black-and-white.
  int treatment = 0;
  // 0 Adobe Color (identity in this working space) … 5 Adobe Monochrome.
  int profile = 0;
  // 0 as-shot … 8 custom. Named presets only change temperature/tint.
  int white_balance = 0;
  double exposure = 0, contrast = 0, highlights = 0, shadows = 0, whites = 0, blacks = 0;
  double temperature = 0, tint = 0, saturation = 0, vibrance = 0;
  double texture = 0, clarity = 0, dehaze = 0;
  std::vector<CurvePoint> curve{{0, 0}, {1, 1}};
  std::array<std::vector<CurvePoint>, 3> channel_curves{{{{0,0},{1,1}},{{0,0},{1,1}},{{0,0},{1,1}}}};
  int curve_interpolation = 0; // 0 keeps legacy linear arithmetic; 1 opts into PCHIP.
  std::array<HslAdjustment, 8> hsl{};
  Grade shadow_grade, midtone_grade, highlight_grade, global_grade;
  // Legacy stays the native default for old protocol callers and saved recipes.
  bool tonal_grading = false;
  double balance = 0, blending = 50;
  double grain = 0, grain_size = 1, grain_luminance = 0, grain_color = 0, fade = 0, vignette = 0, bloom = 0, halation = 0;
  double film_falloff = 0;
  double sharpening = 0, noise_reduction = 0, color_noise_reduction = 0;
  double sharpening_radius = 1, sharpening_detail = 100, sharpening_masking = 0;
  DevelopCrop crop;
  std::vector<DevelopMask> masks;
};
// Independent, deterministic sRGB working-image pipeline. It never edits a RAW file.
void validate_develop(const DevelopSettings& settings);
// Exact, conservative no-op test for an already decoded working image. Keep
// every effective control in this list when extending the recipe. Validation
// still runs, including fields that have no effect at zero strength.
inline bool is_neutral_develop(const DevelopSettings& s) {
  validate_develop(s);
  if (s.treatment != 0 || s.profile != 0) return false;
  for (double value : {s.exposure,s.contrast,s.highlights,s.shadows,s.whites,s.blacks,
      s.temperature,s.tint,s.saturation,s.vibrance,s.texture,s.clarity,s.dehaze,
      s.grain,s.fade,s.vignette,s.bloom,s.halation,s.film_falloff,
      s.sharpening,s.noise_reduction,s.color_noise_reduction})
    if (value != 0) return false;
  const auto identity_curve = [](const auto& curve) {
    return curve.size()==2 && curve[0].x==0 && curve[0].y==0 &&
      curve[1].x==1 && curve[1].y==1;
  };
  if (!identity_curve(s.curve)) return false;
  for (const auto& curve : s.channel_curves) if (!identity_curve(curve)) return false;
  for (const auto& h : s.hsl)
    if (h.hue!=0 || h.saturation!=0 || h.luminance!=0) return false;
  for (const auto& g : {s.shadow_grade,s.midtone_grade,s.highlight_grade,s.global_grade})
    if (g.saturation!=0 || g.luminance!=0) return false;
  // Hue/model/balance/blending, grain shape and sharpening shape alone cannot alter pixels.
  for (const auto& m : s.masks)
    if (m.enabled && (m.exposure!=0 || m.temperature!=0 || m.saturation!=0)) return false;
  const auto& c=s.crop;
  return c.x==0 && c.y==0 && c.width==1 && c.height==1 && c.angle==0 &&
    c.rotate==0 && !c.flip_x && !c.flip_y;
}
DevelopSettings read_develop_protocol(std::istream& input);
// Bounded curve sampler for diagnostics; develop() precomputes its four curves once.
double develop_curve_value(const std::vector<CurvePoint>& points, double value, int interpolation = 0);
Image develop(const Image& source, const DevelopSettings& settings, bool high_resolution = false);
// These dedicated wrappers do not widen the culling decoder or encoder limits.
Image decode_develop_preview(const std::filesystem::path& path, std::uint32_t max_edge);
std::vector<std::uint8_t> encode_develop_jpeg(const Image& image, double quality);
// Explicit sensor-data path. No thumbnail fallback. Exposure/WB are applied before RGB8 conversion.
enum class RawWhiteBalanceModel { legacy = 0, resolved = 1 };
// Existing callers and saved recipes retain the original white-balance behavior.
Image decode_raw_develop(const std::filesystem::path& path, std::uint32_t max_edge,
                         double exposure = 0, double temperature = 0, double tint = 0);
// Native opt-in only: use one LibRaw-resolved baseline at zero and nonzero WB.
// No protocol or persisted-recipe default is changed by this overload.
Image decode_raw_develop(const std::filesystem::path& path, std::uint32_t max_edge,
                         double exposure, double temperature, double tint,
                         RawWhiteBalanceModel white_balance_model);
double develop_mask_weight(const DevelopMask& mask, double x, double y);
// Inverse of the RGB white-balance gains. Sample is 0–1 sRGB.
struct WhiteBalanceSample { double temperature = 0, tint = 0; };
WhiteBalanceSample develop_white_balance_from_sample(double red, double green, double blue);
} // namespace lenslabs
