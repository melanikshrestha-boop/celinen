#pragma once
#include "lenslabs/engine.hpp"
#include <istream>

namespace lenslabs {
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
  double exposure = 0, contrast = 0, highlights = 0, shadows = 0, whites = 0, blacks = 0;
  double temperature = 0, tint = 0, saturation = 0, vibrance = 0;
  double texture = 0, clarity = 0, dehaze = 0;
  std::vector<CurvePoint> curve{{0, 0}, {1, 1}};
  std::array<std::vector<CurvePoint>, 3> channel_curves{{{{0,0},{1,1}},{{0,0},{1,1}},{{0,0},{1,1}}}};
  std::array<HslAdjustment, 8> hsl{};
  Grade shadow_grade, midtone_grade, highlight_grade, global_grade;
  // Legacy stays the native default for old protocol callers and saved recipes.
  bool tonal_grading = false;
  double balance = 0, blending = 50;
  double grain = 0, grain_size = 1, grain_luminance = 0, fade = 0, vignette = 0, bloom = 0, halation = 0;
  double film_falloff = 0;
  double sharpening = 0, noise_reduction = 0, color_noise_reduction = 0;
  DevelopCrop crop;
  std::vector<DevelopMask> masks;
};
// Independent, deterministic sRGB working-image pipeline. It never edits a RAW file.
void validate_develop(const DevelopSettings& settings);
DevelopSettings read_develop_protocol(std::istream& input);
Image develop(const Image& source, const DevelopSettings& settings);
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
} // namespace lenslabs
