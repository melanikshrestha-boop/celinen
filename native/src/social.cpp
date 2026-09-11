#include "lenslabs/social.hpp"
#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace lenslabs {
Image frame_social(const Image& source, const SocialFrame& frame) {
  if (!source.width || !source.height || source.width > 8192 || source.height > 8192 ||
      std::uint64_t(source.width) * source.height > 16 * 1024 * 1024 ||
      source.rgba.size() != std::size_t(source.width) * source.height * 4)
    throw std::invalid_argument("Invalid source image");
  if (!std::isfinite(frame.x) || !std::isfinite(frame.y) || !std::isfinite(frame.zoom) ||
      frame.x < 0 || frame.x > 1 || frame.y < 0 || frame.y > 1 ||
      frame.zoom < 1 || frame.zoom > 3 || (frame.fit && frame.zoom != 1))
    throw std::invalid_argument("Invalid framing controls");
  Image out;
  out.width = 1080;
  switch (frame.format) {
    case SocialFormat::portrait: out.height = 1350; break;
    case SocialFormat::square: out.height = 1080; break;
    case SocialFormat::story: out.height = 1920; break;
    default: throw std::invalid_argument("Invalid social format");
  }
  out.source_width = source.source_width;
  out.source_height = source.source_height;
  out.rgba.resize(std::size_t(out.width) * out.height * 4);
  const double sx = double(out.width) / source.width;
  const double sy = double(out.height) / source.height;
  const double scale = (frame.fit ? std::min(sx, sy) : std::max(sx, sy)) * frame.zoom;
  const double left = (out.width - source.width * scale) * frame.x;
  const double top = (out.height - source.height * scale) * frame.y;
  for (std::uint32_t y = 0; y < out.height; ++y) {
    for (std::uint32_t x = 0; x < out.width; ++x) {
      auto* pixel = &out.rgba[(std::size_t(y) * out.width + x) * 4];
      const double raw_x = (x + 0.5 - left) / scale;
      const double raw_y = (y + 0.5 - top) / scale;
      if (raw_x < 0 || raw_y < 0 || raw_x >= source.width || raw_y >= source.height) {
        pixel[0] = pixel[1] = pixel[2] = frame.background;
      } else {
        const double px = std::clamp(raw_x - 0.5, 0.0, double(source.width - 1));
        const double py = std::clamp(raw_y - 0.5, 0.0, double(source.height - 1));
        const auto x0 = std::uint32_t(px), y0 = std::uint32_t(py);
        const auto x1 = std::min(x0 + 1, source.width - 1), y1 = std::min(y0 + 1, source.height - 1);
        const double dx = px - x0, dy = py - y0;
        for (unsigned c = 0; c < 3; ++c) {
          const auto sample = [&](std::uint32_t u, std::uint32_t v) {
            const auto i = (std::size_t(v) * source.width + u) * 4;
            const double alpha = source.rgba[i + 3] / 255.0;
            return source.rgba[i + c] * alpha + frame.background * (1 - alpha);
          };
          const double upper = sample(x0, y0) * (1 - dx) + sample(x1, y0) * dx;
          const double lower = sample(x0, y1) * (1 - dx) + sample(x1, y1) * dx;
          pixel[c] = std::uint8_t(std::clamp(std::lround(upper * (1 - dy) + lower * dy), 0L, 255L));
        }
      }
      pixel[3] = 255;
    }
  }
  return out;
}
} // namespace lenslabs
