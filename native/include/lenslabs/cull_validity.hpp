#pragma once
#include "lenslabs/cull.hpp"
#include "lenslabs/engine.hpp"
#include <cstdint>
#include <vector>

// The validity gate: is this frame a photograph at all?
//
// It runs before any quality score. A frame that fails it never reaches the
// sharpness scorer, because a sharpness number on a manga page, a screenshot or
// a sheet of static is not a judgment about a photograph — it is noise that
// looks like a verdict ("Sharp and well exposed 79").
//
// No single statistic decides. Entropy calls static "detailed"; sharpness calls
// line art "crisp". The gate combines independent evidence families, each of
// which a real camera frame satisfies for physical reasons:
//   * spectrum      natural scenes fall off as 1/f^b with b ~ 1.6..2.4;
//                   static is flat, patterns and screentone are spiky
//   * coherence     neighbouring pixels of a scene are correlated; noise is not
//   * grain         a sensor leaves a noise floor in smooth areas; renders and
//                   screenshots have exactly none
//   * fills         cartoons, UI and documents are made of exactly flat colour
//   * edges         ink lines have flat colour on both sides; axis-aligned
//                   edges dominate UI and documents
//   * structure     truncated decodes freeze the bottom rows; corrupt files
//                   band across the full width
// and weighs them as log-odds. Borderline evidence yields "suspect", never an
// automatic reject.
namespace lenslabs {

enum class CullValidityState : std::uint8_t { valid, suspect, invalid };

enum class CullValidityKind : std::uint8_t {
  photo,            // looks like a photograph
  noise,            // random or static noise
  flat,             // one flat tone, no content
  black,            // all black
  white,            // all white
  test_pattern,     // bars, checkerboards, stripes, gradients
  corrupted,        // truncated or damaged decode
  misfire,          // lens cap, pocket, ground shot with no content
  extreme_exposure, // blown or crushed with nothing recoverable
  illustration,     // line art, manga, anime, cartoon
  screenshot,       // UI, app or web capture
  document,         // text page, scan of a document
};

// Every measurement the gate took. Exposed so thresholds can be audited on real
// shoots and so a learned validity head can consume the same features later.
struct CullValidityEvidence {
  double luma_mean = 0, luma_std = 0;
  double luma_low = 0, luma_high = 0;       // 2nd and 98th percentile
  double clipped_low = 0, clipped_high = 0; // share of pixels <= 4 / >= 251
  double spectral_slope = 0;     // b in P(f) ~ 1/f^b
  double spectral_fit_error = 0; // RMS of the log-log fit
  double spectral_peak = 0;      // log10 of the strongest periodic spike over its ring
  double autocorrelation = 0;    // lag-1, averaged over x and y
  double grain = 0;              // median noise floor in smooth mid-tone blocks
  double smooth_share = 0;       // share of blocks that are smooth mid-tone
  double exact_flat = 0;         // share of all blocks that are one exact mid-tone colour
  double exact_flat_smooth = 0;  // share of smooth blocks that are exactly flat
  double exact_flat_extreme = 0; // share of all blocks exactly flat at paper white / ink black
  double palette_top = 0;        // share of mid-tone pixels in the 12 commonest colours
  double palette_count = 0;      // colours (6 bits a channel) needed to cover 90% of the frame
  double saturation = 0;         // mean HSV saturation 0..1
  double grayscale = 0;          // share of pixels with no chroma
  double edge_density = 0;       // share of pixels on a strong edge
  double edge_axis = 0;          // share of edge energy within 6 degrees of 0/90
  double edge_flank_flat = 0;    // share of strong edges with flat colour on both sides
  double frozen_rows = 0;        // share of the height frozen at the bottom (truncation)
  double band_rows = 0;          // rows or columns that break from their neighbours, per 100
  int decoder_warnings = 0;
  bool truncated = false;
};

struct CullValidity {
  CullValidityState state = CullValidityState::valid;
  CullValidityKind kind = CullValidityKind::photo;
  // How sure the gate is that the frame is NOT a usable photograph, 0..1, for
  // the kind reported. For a valid frame this is the strongest doubt it had.
  double confidence = 0;
  // Plain English for the photographer ("Illustration, not a photograph").
  // Empty for a valid frame. Static storage; never freed.
  const char* reason = "";
  CullValidityEvidence evidence;
};

// Facts the decoder knows and the pixels may not show.
struct CullDecodeHints {
  // libjpeg warnings of any kind. Some cameras write files that warn harmlessly
  // ("extraneous bytes before marker"), so a warning alone is weak evidence.
  int decoder_warnings = 0;
  // The decoder ran out of data before the last scanline: a truncated file.
  bool truncated = false;
};

// Thresholds on the non-photograph confidence. Below suspect_at the frame is
// valid; at or above invalid_at it is rejected outright; between, it is shown to
// the photographer as a maybe.
struct CullValidityOptions {
  double suspect_at = .5;
  double invalid_at = .88;
};

// Judges one decoded working image (sRGB RGBA8, 32..4096 px on each edge).
CullValidity assess_cull_validity(const Image& image, const CullDecodeHints& hints = {},
                                  const CullValidityOptions& options = {});

const char* cull_validity_kind_name(CullValidityKind kind) noexcept;
const char* cull_validity_state_name(CullValidityState state) noexcept;

// The gate in front of the scorer. An invalid frame gets validity only: its
// reading stays default (quality 0) and `measured` is false, so no sharpness
// score is ever invented for it. Valid and suspect frames are measured normally.
struct CullGatedReading {
  CullValidity validity;
  CullReading reading;
  bool measured = false;
};
CullGatedReading measure_cull_gated(const Image& image, const std::vector<CullFace>& faces = {},
                                    const CullDecodeHints& hints = {},
                                    const CullValidityOptions& options = {});

// The shoot-level pass with the gate applied: invalid frames are withheld from
// calibration, grouping and keeper selection (they would otherwise drag the
// shoot's own sharpness range), then reported as rejects. Suspect frames are
// ranked like any other but never suggested as keepers.
struct CullGatedRow {
  CullRow row;
  CullValidityState validity = CullValidityState::valid;
  const char* validity_reason = "";
};
std::vector<CullGatedRow> cull_shoot_gated(const std::vector<CullFrameInput>& frames,
                                           const std::vector<CullValidity>& validity,
                                           const CullOptions& options = {});

} // namespace lenslabs
