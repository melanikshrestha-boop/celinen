#pragma once
#include "lenslabs/develop.hpp"
#include <string>

namespace lenslabs {
struct CropSuggestion {
  DevelopCrop crop;
  std::string confidence="low";
  std::vector<std::string> reasons;
  double horizon_angle=0, horizon_coverage=0, saliency_retained=1, retained_area=1;
  unsigned width=0,height=0;
};
// Neutral, oriented preview only. Aspect 0 means preserve the original frame.
// Heuristic edge analysis, never semantic/face detection or trained AI.
CropSuggestion suggest_crop(const Image& preview,double aspect=0);
}
