#pragma once
#include "lenslabs/develop.hpp"
#include <functional>

namespace lenslabs {
struct ReferenceFit {
  DevelopSettings settings;
  double before_rmse = 0, after_rmse = 0, improvement = 0;
  double alignment = 0, gradient_alignment = 0, clipped_fraction = 0;
  unsigned evaluations = 0, fit_pixels = 0, validation_pixels = 0;
  bool weak_alignment = false, poor_fit = false;
};
// Inputs must be corresponding upright, opaque sRGB previews of the same frame.
// This is a bounded numeric approximation, not recovery of original editing settings.
ReferenceFit fit_reference(const Image& neutral, const Image& edited,
                           const std::function<bool()>& cancelled = {});
} // namespace lenslabs
