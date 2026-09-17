#pragma once
#include "lenslabs/develop.hpp"
#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

// Match a look: measure what an inspiration photograph looks like, then solve a
// full Develop recipe that makes a different photograph look that way.
//
// The descriptor is a statistical portrait of the finished image (tone
// distribution, split tone per tonal zone, color per HSL band, contrast,
// vignette, grain). It is deliberately content-light: it never compares pixels
// at positions, so any photo can be matched to any inspiration.
//
// Exposure and white balance independence is a property of the solve, not of
// the numbers: match_look() first normalizes the target's own exposure and
// neutral cast, then solves the look on top, so a dark and a bright frame of
// the same scene land on the same result.
//
// Every recipe is verified by rendering through the real develop(): an
// analytic initialization is refined in closed loop (Levenberg-Marquardt on a
// finite-difference Jacobian with Broyden updates), with the small loop image's
// systematic difference from the working image measured and removed.
namespace lenslabs {

inline constexpr std::size_t look_quantile_count = 13;
inline constexpr std::array<double, look_quantile_count> look_quantile_levels{
    .01, .05, .1, .2, .3, .4, .5, .6, .7, .8, .9, .95, .99};
inline constexpr std::size_t look_zone_count = 3;  // shadows, midtones, highlights
inline constexpr std::size_t look_band_count = 8;  // the recipe's HSL bands
// Statistics are read from a stride sample of the photo at this long edge. A
// stride (not an average) keeps per-pixel color and grain intact, and makes
// "develop then sample" identical to "sample then develop" for every
// per-pixel stage of the pipeline.
inline constexpr std::uint32_t look_working_edge = 256;
// The solver's inner loop renders this much smaller stride sample.
inline constexpr std::uint32_t look_loop_edge = 64;

struct LookZone {
  double fraction = 0;             // soft share of pixels in this zone
  double lightness = 0;            // mean CIELAB L*
  double a = 0, b = 0;             // mean a*, b*
  double neutral_a = 0, neutral_b = 0;  // mean over low-chroma pixels: the split tone
  double aa = 0, ab = 0, bb = 0;   // a*/b* covariance
};
struct LookBand {
  double mass = 0;        // chroma-weighted share of pixels in the band
  double saturation = 0;  // mean HSL saturation (the Color Mixer's own model)
  double lightness = 0;   // mean HSL lightness
  double hue = 0;         // mean hue offset from the band center, degrees
  double chroma = 0;      // mean CIELAB chroma, to weigh hue error perceptually
};
struct LookDescriptor {
  std::array<double, look_quantile_count> quantiles{};  // CIELAB L* at each level
  std::array<LookZone, look_zone_count> zones{};
  std::array<LookBand, look_band_count> bands{};
  double a = 0, b = 0, neutral_a = 0, neutral_b = 0;  // whole-frame warmth and tint
  double chroma = 0;          // mean CIELAB chroma
  double contrast = 0;        // standard deviation of L*
  double local_contrast = 0;  // mean |L* - local mean| at Clarity's own radius
  std::array<double, 3> radial{};  // outer rings' mean L* minus the center's
  double noise = 0;           // luma noise sigma (0..1) of the full decode
  // The capture's neutral cast in log2 gains (green over red, green over blue),
  // measured the way Auto measures it. Only meaningful when cast_measured.
  double cast_red = 0, cast_blue = 0;
  bool cast_measured = false;
};

// Flat form for the WebAssembly boundary: [version, size, fields...].
inline constexpr double look_descriptor_version = 1;
inline constexpr std::size_t look_descriptor_size =
    2 + look_quantile_count + look_zone_count * 9 + look_band_count * 5 + 7 + 3 + 1 + 3;
std::vector<double> serialize_look(const LookDescriptor& look);
// Throws std::invalid_argument on a wrong version, size or non-finite value.
LookDescriptor deserialize_look(const double* values, std::size_t size);

// Reads an upright opaque sRGB RGBA8 image (at least 16 px per side).
LookDescriptor describe_look(const Image& image);
// A set of inspirations defines one look: a robust per-statistic average
// (median for three or more, mean otherwise; band statistics only over the
// inspirations where that color actually occurs).
LookDescriptor combine_looks(const std::vector<LookDescriptor>& looks);
// Root-mean-square of the weighted residuals, in roughly CIELAB units.
double look_distance(const LookDescriptor& candidate, const LookDescriptor& look);

struct LookMatch {
  DevelopSettings settings;
  bool applicable = false;  // false: the target has no tonal information
  double distance = 0;          // look_distance of the returned recipe's working render
  unsigned evaluations = 0;     // loop renders
  unsigned renders = 0;         // working-image renders
};
// `target` is the upright photo (any size; about 1024 px long edge is the
// intended decode). `current` supplies what the look never touches: crop,
// masks, texture, sharpening and noise reduction. Every other global control
// is solved or reset. `output_edge` is the long edge the photo will be rendered
// at, so grain lands at the inspiration's apparent size. Deterministic.
LookMatch match_look(const Image& target, const LookDescriptor& look,
                     const DevelopSettings& current,
                     std::uint32_t output_edge = develop_standard_edge);

}  // namespace lenslabs
