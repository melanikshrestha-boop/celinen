#pragma once
#include "lenslabs/engine.hpp"
#include <cstdint>
#include <string>
#include <vector>

namespace lenslabs {

// Face evidence for one frame. Boxes are normalized to the working image.
// Absent faces mean "unknown", never "no subject": the engine then falls back
// to saliency. Two sources exist: the ingest pass's own detector and eye
// reader (native/src/faces.cpp), and older Studio paths that pass the browser
// face detector's open/closed guess.
struct CullFace {
  double x = 0, y = 0, width = 0, height = 0; // normalized 0..1
  double sharpness = -1;                      // acuity at the eyes 0..1, <0 when not measured
  double score = -1;                          // detector confidence 0..1, <0 when unknown
  // Probability that the eyes are closed, and how far that probability can be
  // trusted, both 0..1. A negative probability means the eyes were not judged
  // (too small, turned away, nothing eye-like visible): unknown, never closed.
  double closed_probability = -1;
  double confidence = 0;
  // Legacy browser evidence: -1 unknown, 0 closed, 1 open. Used only when no
  // probability is given, at legacy_eyes_confidence.
  int eyes_open = -1;
};

enum class EyesState { unknown, open, uncertain, closed };

// When a closed call is trusted. Rejecting a keeper is the costly mistake, so
// "closed" needs a high probability *and* a high confidence on the primary
// subject; anything in between is "uncertain" and is never rejected.
// The defaults were chosen with scripts/eval-eyes.ts over labelled
// photographs: on that set every closed call was right (no false rejects) and
// a third of the blinks were caught. They are the operating point to revisit
// first when a labelled sports card exists; the script prints the whole grid.
struct EyeThresholds {
  double closed_probability = .55;    // at or above, when confident: closed
  double min_confidence = .6;         // below: at most uncertain
  double uncertain_probability = .4;  // at or above, when not closed: uncertain
  // A face at least this prominent relative to the primary one is a subject
  // too: if its eyes are confidently closed the frame becomes uncertain.
  double companion_prominence = .6;
};

// A browser detector's guess can mark a frame uncertain but never reject it.
inline constexpr double legacy_eyes_confidence = .5;

// Subject acuity below which cull_shoot rejects a frame for focus whatever the
// rest of the shoot looks like. The ingest pass uses the same floor to decide a
// frame cannot be rescued by its subject's eyes, and spends nothing looking.
inline constexpr double absolute_soft_floor = .26;

struct EyesVerdict {
  EyesState state = EyesState::unknown;
  int primary = -1;                // index into the faces, -1 when there are none
  double closed_probability = -1;  // the primary face's; negative when not judged
  double confidence = 0;
};

// How much a face reads as the photograph's subject: its size relative to the
// frame, how central it sits (on the centre measure_cull weights), how sharp its
// eyes are (the photographer focused on the subject, not the crowd) and how
// surely it is a face. Comparable between faces of one frame only.
double face_prominence(const CullFace& face, double frame_aspect) noexcept;

// Picks the primary subject (largest, sharpest, most central, most certainly a
// face) and decides the frame's eyes from it. A background face never rejects
// a frame. Pure: no pixels, no models. `frame_aspect` is width / height.
EyesVerdict judge_eyes(const std::vector<CullFace>& faces, double frame_aspect,
                       const EyeThresholds& thresholds = {});

// Resolving power over a region, 0 (mush) .. 1 (crisp), from the same per-tile
// measurement measure_cull uses. Negative when nothing in the region has enough
// texture to judge (a dark visor, a blown highlight).
double region_acuity(const Image& image, std::uint32_t x0, std::uint32_t y0, std::uint32_t x1,
                     std::uint32_t y1);

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
  bool eyes_closed = false;    // the primary subject's eyes are confidently closed
  bool face_soft = false;
  int face_count = 0;
  bool eyes_uncertain = false; // possibly closed, not confidently: never rejected
  // The primary face's evidence, kept so frames can be re-judged and evaluated.
  double eyes_closed_probability = -1; // negative when not judged
  double eyes_confidence = 0;
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
  eyes_uncertain, // possibly closed: left undecided for the photographer
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
