#pragma once
#include "lenslabs/cull.hpp"
#include "lenslabs/engine.hpp"
#include "lenslabs/nn.hpp"
#include <array>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <vector>

// Faces and eyes for the cull, in two stages.
//
// Stage 1 finds faces with YuNet on the working frame the ingest pass already
// decoded. Stage 2 judges the eyes of the faces that matter (the likely
// subject, at most a companion) with MediaPipe Face Mesh V2 and Blendshape V2,
// on a crop taken from the original photograph at up to full resolution: the
// working frame holds a sideline player's face in a few dozen pixels, which is
// not enough to tell a blink from a squint.
//
// Everything uses continuous pixel coordinates: pixel (x, y) covers
// [x, x+1) x [y, y+1), so its centre is at (x + .5, y + .5).
namespace lenslabs {

// One face as the detector reports it, in the pixels of the image it ran on.
struct DetectedFace {
  double x = 0, y = 0, width = 0, height = 0;
  // Right eye, left eye (the subject's own sides), nose tip, right and left
  // mouth corner, as x, y pairs.
  std::array<double, 10> landmarks{};
  double score = 0;
};

// What stage 2 learned about one face. `read` is false when the eyes were not
// judged, and then only `presence` may carry information.
struct EyeReading {
  bool read = false;
  double presence = 0;                     // landmark model: a face is in the crop, 0..1
  double blink_left = 0, blink_right = 0;  // eyeBlinkLeft / eyeBlinkRight, the subject's sides
  double yaw = 0, pitch = 0;               // head pose in degrees; positive pitch looks down
  bool left_nearer = false;                // the subject's left eye is the one facing the camera
  double sharpness = -1;                   // region_acuity across the eyes, <0 when untextured
  double eye_contrast = 0;                 // luma standard deviation inside the eye boxes
  double detail = 0;                       // face width in pixels of real image detail
  bool refined = false;                    // a second landmark pass ran
  double disagreement = 0;                 // |closed score of pass 1 - pass 2| when refined
  double closed_probability = -1;
  double confidence = 0;
};

// A region of the upright original photograph and where it sits.
struct Patch {
  Image image;
  double origin_x = 0, origin_y = 0; // original pixel coordinates of the patch's corner
  double scale = 1;                  // patch pixels per original pixel
};

// Supplies the upright original's region [x0, x1) x [y0, y1) at no less than
// `scale` patch pixels per original pixel where the source has that detail.
using PatchSource = std::function<bool(double x0, double y0, double x1, double y1, double scale, Patch& out)>;

struct FaceReadOptions {
  double detect_score = .6;    // a detection below this is not a face
  double judge_score = .7;     // eyes are only read on faces at least this certain
  double judge_min_pixels = 40; // eyes are not read on faces narrower than this in the original
  int max_judged = 2;          // the subject and at most one companion
  // Relative to the most prominent face: the same bar judge_eyes uses to call
  // another face a subject too, so no time is spent on a face whose blink
  // could not change the frame anyway.
  double judge_prominence = .6;
  double refine_above = .35;   // a second landmark pass when the first says possibly closed
  std::size_t max_faces = 64;
};

struct FaceResult {
  CullFace face;         // normalized to the working frame, ready for measure_cull
  DetectedFace original; // the detection in upright original pixels
  EyeReading eyes;
};

class FaceReader {
 public:
  enum class Model { detector, landmarks, blendshapes };

  FaceReader();
  ~FaceReader();
  FaceReader(FaceReader&&) noexcept;
  FaceReader& operator=(FaceReader&&) noexcept;

  // Parses one model file; throws std::invalid_argument if it is not the model expected.
  void load(Model kind, const std::uint8_t* bytes, std::size_t size);
  bool can_detect() const noexcept;
  bool can_read_eyes() const noexcept;

  // Stage 1: faces on an upright RGBA image, most certain first.
  std::vector<DetectedFace> detect(const Image& image, double min_score) const;

  // Stage 2 for one face given in upright original pixels.
  EyeReading read_eyes(const DetectedFace& face, const PatchSource& source) const;

  // Both stages for one frame. `frame` is the upright working frame and the
  // original is `original_width` x `original_height` upright pixels. Faces come
  // back most prominent first; eyes are read only where options allow.
  std::vector<FaceResult> read(const Image& frame, double original_width, double original_height,
                               const PatchSource& source, const FaceReadOptions& options = {}) const;

 private:
  struct Models;
  std::unique_ptr<Models> models_;
};

// The eye decision for one read face, exposed for tests: blendshape scores and
// the evidence around them become a closed probability and a confidence.
void score_eyes(EyeReading& reading, double detector_score);

} // namespace lenslabs
