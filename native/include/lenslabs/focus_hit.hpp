#pragma once
#include "lenslabs/engine.hpp"

namespace lenslabs {

// A rectangle normalized to 0..1 of the upright working image.
struct FocusRegion {
  double x = 0, y = 0, width = 0, height = 0;
};

// What the camera's AF area says about where focus landed.
enum class FocusHitVerdict {
  unjudged = 0,        // no usable AF area, or nothing with detail to resolve near it
  on_subject = 1,      // the AF area is about as sharp as anything in the frame
  sharp_elsewhere = 2, // something else is clearly sharper: front or back focus
  missed = 3,          // nothing in the frame is sharp
};

struct FocusHit {
  // Confidence 0..1 that focus landed inside the AF area. >= .5 is on subject.
  double hit = 0;
  // Resolving power 0..1 (the same scale as CullReading::acuity_*) inside the
  // AF area, and of the sharpest detail anywhere in the frame.
  double af_acuity = 0;
  double best_acuity = 0;
  // Where the sharpest detail is: the 2x2-tile window with the most resolved
  // detail. Empty when nothing in the frame has texture.
  FocusRegion best_region;
  FocusHitVerdict verdict = FocusHitVerdict::unjudged;
};

// Judges one working image (sRGB RGBA8, 32..4096 px per edge — the same frame
// measure_cull() reads) against the camera's AF area in upright coordinates.
// Uses cull.cpp's resolving-power measure: per tile, gradient energy at a
// one-pixel stride over an eight-pixel stride with the sensor noise floor
// removed, taken in the weakest direction. An invalid image or AF area yields
// `unjudged`; it never throws for bad input.
FocusHit judge_focus_hit(const Image& image, const FocusRegion& af);

// "on-subject", "front-or-back-focus", "missed", "unjudged".
const char* focus_hit_verdict_name(FocusHitVerdict verdict) noexcept;

} // namespace lenslabs
