#pragma once
#include "lenslabs/engine.hpp"

namespace lenslabs {
// Measured starting point for one frame, expressed in the Develop recipe's own
// slider units so it can be applied, undone and hand-tuned like any other edit.
// Deterministic statistics, not a trained model: the same pixels always give
// the same suggestion.
struct DevelopAuto {
  double exposure = 0;     // EV, rounded to 0.05
  double contrast = 0, highlights = 0, shadows = 0, whites = 0, blacks = 0;
  double temperature = 0, tint = 0, vibrance = 0;
  // False when too few near-neutral mid-tones exist to trust a white balance
  // (sunsets, stage light, a wall of one color). Temperature/tint stay zero.
  bool white_balance_measured = false;
  // False for frames with no usable tonal information (blank, fully clipped).
  bool applicable = false;
};
// Reads an upright sRGB RGBA8 working image; never modifies it.
DevelopAuto suggest_develop(const Image& image);
} // namespace lenslabs
