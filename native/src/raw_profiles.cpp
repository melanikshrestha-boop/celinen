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
// rendering of the very same photons. Fitting a 3x3 that takes white-balanced
// camera RGB onto the chromaticities of that JPEG recovers the sensor's colour
// response up to the tone curve and saturation Sony applies on top, which the
// fit removes first. `scripts/fit-raw-profile.py` is the fitter; the comment on
// each entry records the frames it was fitted on and the error it reached on
// frames held out of the fit.
//
// The consequence, said plainly: a profile here is a match to the camera
// manufacturer's own rendering, not to Adobe's colorimetric measurement of that
// sensor, and the two are not the same picture. A camera absent from this table
// and absent DNG tags is refused by name rather than rendered with somebody
// else's numbers.
#include "lenslabs/raw_color.hpp"
#include <algorithm>
#include <cctype>

namespace lenslabs::raw {
namespace {

struct Entry {
  const char* make;
  const char* model;
  // XYZ (D50) -> camera, the DNG ColorMatrix1 convention, at the illuminant below.
  Matrix3 color_matrix;
  int illuminant;
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
     {1.8272, -1.2233, -0.1206, -0.7352, 1.7217, -0.0211, 0.0599, -0.1402, 0.7544},
     21,
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
    profile.description = entry.provenance;
    return profile;
  }
  return profile;
}

} // namespace lenslabs::raw
