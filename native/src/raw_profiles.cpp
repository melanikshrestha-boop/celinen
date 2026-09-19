// Camera colour profiles for RAW files that carry none of their own.
//
// A DNG says what its sensor's colour means: ColorMatrix1/2, the calibration
// illuminants, optionally a forward matrix. A Sony ARW says nothing at all — it
// carries the as-shot white balance and the black and white levels, and leaves
// the sensor's spectral response to be known from elsewhere. Every raw
// converter therefore ships a table of matrices, and every one of those tables
// traces back to a source this repository cannot take: LibRaw is LGPL, dcraw
// carries its own redistribution terms, and Adobe's matrices are Adobe's.
//
// So the profiles below were measured here, from the camera's own work. A Sony
// body writes a finished JPEG inside every ARW; that JPEG is Sony's own colour
// rendering of the very same photons. A camera renders in two steps — a 3x3
// onto its output primaries, then one tone curve per channel — and
// `scripts/fit-raw-profile.py` recovers both by alternating between them. Each
// entry therefore carries a matrix and the baseline curve that goes with it;
// the comment on each records what it was fitted on.
//
// The consequence, said plainly: a profile here is a match to the camera
// manufacturer's own rendering, not to Adobe's colorimetric measurement of that
// sensor, and the two are not the same picture. A camera absent from this table
// and absent DNG tags is refused by name rather than rendered with somebody
// else's numbers.
#include "lenslabs/raw_color.hpp"
#include <algorithm>
#include <array>
#include <cctype>

namespace lenslabs::raw {
namespace {

struct Entry {
  const char* make;
  const char* model;
  // XYZ (D50) -> camera, the DNG ColorMatrix1 convention, at the illuminant below.
  Matrix3 color_matrix;
  int illuminant;
  // The camera's baseline rendering: linear working-space values in, linear
  // out, the DNG ProfileToneCurve slot. Without it a render is scene-referred,
  // which is correct and looks flat and dark beside the camera's own JPEG.
  std::array<double, ToneCurve::knots> curve_x;
  std::array<double, ToneCurve::knots> curve_y;
  const char* provenance;
};

// Case- and space-insensitive, because a maker note's spelling is not stable.
std::string squash(const std::string& text) {
  std::string out;
  for (char c : text)
    if (!std::isspace(static_cast<unsigned char>(c)))
      out.push_back(char(std::tolower(static_cast<unsigned char>(c))));
  return out;
}

constexpr Entry table[] = {
    // Measured by scripts/fit-raw-profile.py on 20 daylight frames from
    // ~/Documents/01-Photography/Raw-Photos, checked on 20 more held out of the
    // fit: the render's angular colour error against the camera's own JPEG is
    // a median of 4.0 degrees and a 95th percentile of 11.8 on the held-out
    // frames, against 4.3 and 11.3 on the frames it was fitted to.
    //
    // The implied camera->XYZ is non-negative by construction, and its
    // primaries land at xy (0.701, 0.299), (0.375, 0.552) and (0.090, 0.049) —
    // a real set of filters, not a least-squares artefact. The training shoot
    // was rock, a yellow dress and dark water, which barely exercises the
    // red-green axis; the red primary consequently sits on the constraint
    // boundary, and this profile's behaviour far from daylight is unverified.
    {"SONY", "ILCE-7M3",
     {1.7353, -1.1232, -0.1289, -0.8340, 1.8522, -0.0546, 0.0414, -0.0919, 0.7224},
     21,
     // The scene values the fit saw run from 0.001 to 0.454 of the sensor's
     // white level. Above that the curve is carried on the slope the
     // measurement ended with, because extending the shoulder the camera
     // showed beats inventing one it did not.
     {
      0.000000, 0.000977, 0.003906, 0.008789, 0.015625, 0.024414, 0.035156, 0.047852, 0.062500,
      0.079102, 0.097656, 0.118164, 0.140625, 0.165039, 0.191406, 0.219727, 0.250000, 0.282227,
      0.316406, 0.352539, 0.390625, 0.430664, 0.472656, 0.516602, 0.562500, 0.610352, 0.660156,
      0.711914, 0.765625, 0.821289, 0.878906, 0.938477, 1.000000
     },
     {
      0.000000, 0.000815, 0.002928, 0.007942, 0.017919, 0.034997, 0.061185, 0.097516, 0.143624,
      0.197782, 0.258694, 0.325384, 0.395873, 0.464565, 0.524847, 0.578144, 0.627450, 0.673801,
      0.718533, 0.757072, 0.787291, 0.815214, 0.845223, 0.876041, 0.903442, 0.925243, 0.941924,
      0.954254, 0.963323, 0.970580, 0.977863, 0.987436, 1.000000
     },
     "measured from this camera's own embedded JPEG renderings"},
};

} // namespace

ColorProfile profile_for_model(const std::string& make, const std::string& model) {
  ColorProfile profile;
  const std::string wanted_make = squash(make), wanted_model = squash(model);
  for (const auto& entry : table) {
    if (squash(entry.make) != wanted_make || squash(entry.model) != wanted_model) continue;
    profile.known = true;
    profile.source = ProfileSource::model_table;
    profile.color_matrix_1 = entry.color_matrix;
    profile.illuminant_1 = entry.illuminant;
    profile.dual = false;
    profile.tone_curve.present = true;
    profile.tone_curve.x = entry.curve_x;
    profile.tone_curve.y = entry.curve_y;
    profile.description = entry.provenance;
    return profile;
  }
  return profile;
}

} // namespace lenslabs::raw
