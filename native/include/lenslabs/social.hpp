#pragma once
#include "lenslabs/engine.hpp"

namespace lenslabs {
enum class SocialFormat { portrait, square, story };
struct SocialFrame {
  SocialFormat format = SocialFormat::portrait;
  bool fit = false;
  double x = 0.5;
  double y = 0.5;
  double zoom = 1.0;
  std::uint8_t background = 0;
};
// Pure C++ framing. Input is an already edited, upright sRGB image; never modified.
Image frame_social(const Image& source, const SocialFrame& frame);
} // namespace lenslabs
