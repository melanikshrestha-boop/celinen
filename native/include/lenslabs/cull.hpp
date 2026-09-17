#pragma once
#include "lenslabs/engine.hpp"
#include <cstdint>
#include <string>
#include <vector>

namespace lenslabs {

// Optional subject evidence measured outside this engine (the browser's face
// detector). Boxes are normalized to the working image. Absent boxes mean
// "unknown", never "no subject": the engine then falls back to saliency.
struct CullFace {
  double x = 0, y = 0, width = 0, height = 0; // normalized 0..1
  double sharpness = -1;                      // <0 when not measured
  int eyes_open = -1;                         // -1 unknown, 0 closed, 1 open
};

// One frame's measured evidence. Everything here is a measurement, not a
// judgment; verdicts come from cull_shoot(), which compares frames to each other.
struct CullReading {
  // Contrast-invariant focus, 0 (mush) .. 1 (crisp). Derived from the ratio of
  // one-pixel to two-pixel gradient energy, with the frame's own noise floor
  // removed, so a low-contrast scene is not mistaken for a soft one.
  double acuity_subject = 0; // over the subject region
  double acuity_best = 0;    // the sharpest textured region anywhere
  double texture = 0;        // share of the frame with enough detail to judge
  // 0..1. High with low acuity means smeared in one direction: camera shake or
  // subject motion. Low with low acuity means simple missed focus.
  double motion = 0;
  // 1 when the smear direction agrees across the whole frame (camera shake,
  // every subject lost) rather than in one region (a moving subject).
  bool global_smear = false;
  double noise = 0;          // estimated sensor noise, luma codes
  double brightness = 0;     // mean luma 0..255
  double subject_luma = 0;   // subject-weighted mean luma 0..255
  double clipped_highlights = 0; // % of frame
  double clipped_shadows = 0;
  double subject_clipped = 0;    // % of the subject region blown out
  double black_point = 0, median = 0, white_point = 0; // luma percentiles
  double subject_x = 0.5, subject_y = 0.5;             // saliency centroid
  // Perceptual hash (32x32 DCT, 64 bits) plus a coarse color signature. The
  // hash finds near-identical framing; the signature rejects false pairs that
  // share a layout but not a scene.
  std::uint64_t hash = 0;
  std::array<std::uint8_t, 48> color{}; // 4x4 grid of mean RGB
  double sharpness = 0;   // legacy Laplacian variance, kept for saved sessions
  double quality = 0;     // 0..100 before the shoot is taken into account
  bool has_face = false;
  bool eyes_closed = false;
  bool face_soft = false;
};

// One frame going into the shoot-level pass.
struct CullFrameInput {
  std::string id;
  CullReading reading;
  double capture_time_ms = -1; // <0 when the file carried no capture time
  std::string camera_key;      // empty when unknown; frames of different
                               // cameras are never called one burst
  // What the photographer already chose for this frame, if anything. Their
  // decision is never overruled, and a frame they rejected never becomes the
  // keeper its neighbours are judged against.
  int verdict = 0; // 0 undecided, 1 keep, 2 reject
  bool unreadable = false;
};

enum class CullVerdict { undecided, keep, reject };

// Why a frame was suggested. The UI shows these words; they are the engine's
// evidence, not a rating.
enum class CullReason {
  none,
  out_of_focus,
  motion_blur,
  missed_focus,   // something is sharp, but not the subject
  eyes_closed,
  exposure,
  duplicate,      // a near-identical frame scored better
  best_of_burst,
  strong_frame,
};

struct CullRow {
  std::string id;
  CullVerdict verdict = CullVerdict::undecided;
  CullReason reason = CullReason::none;
  int score = 0;       // 0..100 after the shoot's own range is taken in
  int group = -1;      // burst/duplicate group, -1 when the frame stands alone
  bool best_of_group = false;
  bool duplicate = false;
};

struct CullOptions {
  // How eagerly to reject. 0.5 is neutral; higher keeps more.
  double keep_bias = 0.5;
  // Frames closer together than this, from one camera, are one burst.
  double burst_gap_ms = 2000;
  // Hamming distance at which two frames count as the same framing.
  unsigned hash_tolerance = 6;
};

// Measures one decoded working image (sRGB RGBA8, at most 4096 on the long
// edge). Never modifies the source.
CullReading measure_cull(const Image& image, const std::vector<CullFace>& faces = {});

// Compares frames to each other: calibrates against this shoot's own range,
// groups bursts and near-duplicates, and picks the best of each group.
// Frames the photographer already decided keep their verdict and can still be
// the best of their group. Unreadable frames are never judged.
std::vector<CullRow> cull_shoot(const std::vector<CullFrameInput>& frames,
                                const CullOptions& options = {});

const char* cull_reason_name(CullReason reason) noexcept;
unsigned cull_hash_distance(std::uint64_t a, std::uint64_t b) noexcept;

} // namespace lenslabs
