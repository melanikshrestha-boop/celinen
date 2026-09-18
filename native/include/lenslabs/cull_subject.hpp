#pragma once
#include "lenslabs/engine.hpp"
#include <cstdint>
#include <vector>

// Subject-aware focus: where should sharpness be judged, and how sharp is it
// there?
//
// A photographer judges focus on the subject, and on the most specific part of
// it the frame can show: the eyes of a face; the face; the body of a person
// whose face is turned away; the ball, the car, the bird; failing all of those,
// whatever stands out. The hierarchy below walks that ladder with whatever
// evidence exists and reports which rung it stood on. It never says "no face
// found" as a verdict about the photograph — a missing detector is missing
// evidence, not a flaw.
//
// Today only the last rung (saliency) is computed here, model-free. Faces,
// eyes, bodies and objects arrive from detectors outside this engine (MediaPipe
// Face Landmarker / Pose / Object Detector, all Apache-2.0) through
// CullDetections, and take precedence automatically.
namespace lenslabs {

enum class CullSubjectLevel : std::uint8_t {
  eyes,    // focus judged on detected eyes
  face,    // on a detected face (no usable eye evidence)
  body,    // on a detected person whose face is not visible
  object,  // on a detected non-person subject (ball, vehicle, animal)
  salient, // on the most distinct region, found without a model
  frame,   // nothing stood out; judged on the frame's sharpest detail
  none,    // no subject evidence at all (featureless or invalid frame)
};

// Normalized to the frame: 0..1 on both axes.
struct CullBox {
  double x = 0, y = 0, width = 0, height = 0;
  double confidence = 0; // detector score 0..1
};

struct CullFaceDetection {
  CullBox face;
  std::vector<CullBox> eyes; // zero, one or two
  double eyes_open = -1;     // probability both eyes are open, <0 unknown
};

// Everything detectors outside the engine found. All optional.
struct CullDetections {
  std::vector<CullFaceDetection> faces;
  std::vector<CullBox> bodies;
  std::vector<CullBox> objects;
};

struct CullSubjectFocus {
  CullSubjectLevel level = CullSubjectLevel::none;
  CullBox region;              // where focus was judged
  double focus = 0;            // 0 (mush) .. 1 (crisp), contrast-invariant
  double focus_confidence = 0; // how much resolvable detail the region had
  double eye_focus = -1;       // <0 when no eyes were given
  double eyes_open = -1;       // passed through from the detector, <0 unknown
  double subject_size = 0;     // region area as a share of the frame
  double saliency = 0;         // how strongly the salient region stood out, 0..1
  // Plain English for the evidence level ("Focus judged on the eyes").
  const char* evidence = "";
};

// Judges one decoded working image (sRGB RGBA8, 32..4096 px).
CullSubjectFocus measure_subject_focus(const Image& image, const CullDetections& detections = {});

// Model-free saliency (spectral residual, Hou & Zhang 2007) as a box: the
// region that stands out from the frame's own statistics. `strength` 0..1.
CullBox salient_region(const Image& image, double* strength = nullptr);

const char* cull_subject_level_name(CullSubjectLevel level) noexcept;

} // namespace lenslabs
