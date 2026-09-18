// Turning one colour per photosite into three.
//
// Three qualities, all written here rather than ported from anywhere:
//
//  * `half` bins each 2x2 Bayer quad into one pixel. Nothing is interpolated,
//    so nothing is invented: at half the sensor's linear resolution this is the
//    most honest picture there is, and it is what the editing preview uses.
//  * `bilinear` is the textbook separable fill, kept as a reference the tests
//    can measure the good one against.
//  * `gradient` is the shipping quality. Green is interpolated along whichever
//    axis the image is smooth on, with the red or blue channel's own second
//    difference correcting the estimate — the gradient-corrected estimator
//    Hamilton and Adams published (US 5,629,734, filed 1995, long expired).
//    Red and blue are then carried on the colour differences R-G and B-G, which
//    is the constant-hue assumption every good demosaic rests on, and a short
//    median pass over those differences removes the coloured fringes the
//    directional step leaves along hard edges (Freeman's median filtering of
//    colour differences, 1988). No GPL source was consulted: AMaZE, LibRaw and
//    dcraw are all licensed in ways this repository cannot accept, so the two
//    published methods above were implemented from their descriptions.
#include "lenslabs/raw_decode.hpp"
#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace lenslabs::raw {
namespace {

// The 2x2 colour lookup for a window whose top-left pixel sits at CFA phase
// (origin_x, origin_y).
struct Phase {
  Cfa color[4];
  Cfa at(std::uint32_t x, std::uint32_t y) const noexcept { return color[(y & 1) * 2 + (x & 1)]; }
};

Phase phase_of(const CfaPattern& cfa, std::uint32_t origin_x, std::uint32_t origin_y) {
  if (!cfa.bayer()) throw std::runtime_error("This demosaic only reads a 2x2 Bayer mosaic.");
  Phase phase{};
  for (std::uint32_t y = 0; y < 2; ++y)
    for (std::uint32_t x = 0; x < 2; ++x) phase.color[y * 2 + x] = cfa.at(origin_x + x, origin_y + y);
  return phase;
}

// Mirrored access, so a kernel never has a special case at the border.
inline std::uint32_t mirror(int v, std::uint32_t extent) noexcept {
  const int last = int(extent) - 1;
  if (v < 0) v = -v;
  if (v > last) v = last - (v - last);
  return std::uint32_t(std::clamp(v, 0, last));
}

struct Plane {
  const float* data;
  std::uint32_t width, height;
  float at(int x, int y) const noexcept {
    return data[std::size_t(mirror(y, height)) * width + mirror(x, width)];
  }
};

LinearImage make_rgb(std::uint32_t width, std::uint32_t height) {
  LinearImage out;
  out.width = width;
  out.height = height;
  out.channels = 3;
  out.data.assign(std::size_t(width) * height * 3, 0.f);
  return out;
}

LinearImage demosaic_half(const LinearImage& mosaic, const Phase& phase) {
  const std::uint32_t width = mosaic.width / 2, height = mosaic.height / 2;
  if (!width || !height) throw std::runtime_error("This frame is too small to demosaic.");
  LinearImage out = make_rgb(width, height);
  for (std::uint32_t y = 0; y < height; ++y) {
    const float* top = mosaic.row(y * 2);
    const float* bottom = mosaic.row(y * 2 + 1);
    float* dst = out.row(y);
    for (std::uint32_t x = 0; x < width; ++x) {
      const float quad[4] = {top[x * 2], top[x * 2 + 1], bottom[x * 2], bottom[x * 2 + 1]};
      float rgb[3] = {0, 0, 0};
      float green = 0;
      int greens = 0;
      for (int i = 0; i < 4; ++i) {
        const Cfa colour = phase.at(std::uint32_t(i & 1), std::uint32_t(i >> 1));
        if (colour == Cfa::green) {
          green += quad[i];
          ++greens;
        } else {
          rgb[std::size_t(colour)] = quad[i];
        }
      }
      rgb[1] = greens ? green / float(greens) : 0;
      dst[std::size_t(x) * 3 + 0] = rgb[0];
      dst[std::size_t(x) * 3 + 1] = rgb[1];
      dst[std::size_t(x) * 3 + 2] = rgb[2];
    }
  }
  return out;
}

LinearImage demosaic_bilinear(const LinearImage& mosaic, const Phase& phase) {
  const Plane plane{mosaic.data.data(), mosaic.width, mosaic.height};
  LinearImage out = make_rgb(mosaic.width, mosaic.height);
  for (std::uint32_t y = 0; y < mosaic.height; ++y) {
    float* dst = out.row(y);
    for (std::uint32_t x = 0; x < mosaic.width; ++x) {
      const int ix = int(x), iy = int(y);
      const Cfa here = phase.at(x, y);
      float rgb[3];
      const float centre = plane.at(ix, iy);
      if (here == Cfa::green) {
        rgb[1] = centre;
        // In a green pixel's row one of red or blue lies left and right, the
        // other above and below; which is which is the row's own colour.
        const Cfa row_colour = phase.at(x + 1, y);
        const float horizontal = (plane.at(ix - 1, iy) + plane.at(ix + 1, iy)) * 0.5f;
        const float vertical = (plane.at(ix, iy - 1) + plane.at(ix, iy + 1)) * 0.5f;
        rgb[std::size_t(row_colour)] = horizontal;
        rgb[std::size_t(row_colour == Cfa::red ? Cfa::blue : Cfa::red)] = vertical;
      } else {
        rgb[std::size_t(here)] = centre;
        rgb[1] = (plane.at(ix - 1, iy) + plane.at(ix + 1, iy) + plane.at(ix, iy - 1) +
                  plane.at(ix, iy + 1)) *
                 0.25f;
        rgb[std::size_t(here == Cfa::red ? Cfa::blue : Cfa::red)] =
            (plane.at(ix - 1, iy - 1) + plane.at(ix + 1, iy - 1) + plane.at(ix - 1, iy + 1) +
             plane.at(ix + 1, iy + 1)) *
            0.25f;
      }
      dst[std::size_t(x) * 3 + 0] = rgb[0];
      dst[std::size_t(x) * 3 + 1] = rgb[1];
      dst[std::size_t(x) * 3 + 2] = rgb[2];
    }
  }
  return out;
}

inline float median_of_nine(float* v) noexcept {
  // A partial sort is all a median needs; std::nth_element on nine floats
  // carries more overhead than the comparisons it saves.
  std::nth_element(v, v + 4, v + 9);
  return v[4];
}

LinearImage demosaic_gradient(const LinearImage& mosaic, const Phase& phase) {
  const std::uint32_t width = mosaic.width, height = mosaic.height;
  if (width < 8 || height < 8) return demosaic_bilinear(mosaic, phase);
  const Plane plane{mosaic.data.data(), width, height};

  // Pass 1: green everywhere. At a red or blue site, estimate along both axes
  // with the site's own second difference as the correction, then keep the axis
  // the image is smoother along.
  std::vector<float> green(std::size_t(width) * height, 0.f);
  for (std::uint32_t y = 0; y < height; ++y) {
    float* row = green.data() + std::size_t(y) * width;
    const int iy = int(y);
    for (std::uint32_t x = 0; x < width; ++x) {
      const int ix = int(x);
      if (phase.at(x, y) == Cfa::green) {
        row[x] = plane.at(ix, iy);
        continue;
      }
      const float c = plane.at(ix, iy);
      const float left = plane.at(ix - 1, iy), right = plane.at(ix + 1, iy);
      const float up = plane.at(ix, iy - 1), down = plane.at(ix, iy + 1);
      const float c_left = plane.at(ix - 2, iy), c_right = plane.at(ix + 2, iy);
      const float c_up = plane.at(ix, iy - 2), c_down = plane.at(ix, iy + 2);
      const float second_h = 2 * c - c_left - c_right;
      const float second_v = 2 * c - c_up - c_down;
      const float gradient_h = std::abs(left - right) + std::abs(second_h);
      const float gradient_v = std::abs(up - down) + std::abs(second_v);
      const float estimate_h = (left + right) * 0.5f + second_h * 0.25f;
      const float estimate_v = (up + down) * 0.5f + second_v * 0.25f;
      float value;
      // A clear winner takes it; a tie averages, which is what keeps smooth
      // gradients from developing a texture that follows the CFA.
      constexpr float decisive = 1.5f;
      if (gradient_h * decisive < gradient_v)
        value = estimate_h;
      else if (gradient_v * decisive < gradient_h)
        value = estimate_v;
      else
        value = (estimate_h + estimate_v) * 0.5f;
      // The correction term can overshoot on a hard edge; hold the estimate
      // inside the range of the four greens it was built from.
      const float low = std::min(std::min(left, right), std::min(up, down));
      const float high = std::max(std::max(left, right), std::max(up, down));
      row[x] = std::clamp(value, low, high);
    }
  }

  // Pass 2: red and blue, carried on the colour differences R-G and B-G. A
  // difference plane is nearly flat wherever the scene's hue is, which is why
  // interpolating it beats interpolating the channel itself.
  LinearImage out = make_rgb(width, height);
  const Plane green_plane{green.data(), width, height};
  std::vector<float> difference(std::size_t(width) * height * 2, 0.f);
  for (std::uint32_t y = 0; y < height; ++y) {
    float* row = difference.data() + std::size_t(y) * width * 2;
    for (std::uint32_t x = 0; x < width; ++x) {
      const Cfa here = phase.at(x, y);
      if (here == Cfa::green) continue;
      const std::size_t channel = here == Cfa::red ? 0 : 1;
      row[std::size_t(x) * 2 + channel] =
          plane.at(int(x), int(y)) - green[std::size_t(y) * width + x];
    }
  }
  const auto difference_at = [&](int x, int y, int channel) {
    return difference[(std::size_t(mirror(y, height)) * width + mirror(x, width)) * 2 +
                      std::size_t(channel)];
  };
  for (std::uint32_t y = 0; y < height; ++y) {
    float* dst = out.row(y);
    const int iy = int(y);
    for (std::uint32_t x = 0; x < width; ++x) {
      const int ix = int(x);
      const Cfa here = phase.at(x, y);
      const float g = green[std::size_t(y) * width + x];
      float diff[2];
      if (here == Cfa::green) {
        // One of the two lies left and right of a green site, the other above
        // and below. Both are one step away, so both are a plain average.
        const Cfa row_colour = phase.at(x + 1, y);
        const int row_channel = row_colour == Cfa::red ? 0 : 1;
        diff[std::size_t(row_channel)] =
            (difference_at(ix - 1, iy, row_channel) + difference_at(ix + 1, iy, row_channel)) * 0.5f;
        diff[std::size_t(1 - row_channel)] = (difference_at(ix, iy - 1, 1 - row_channel) +
                                              difference_at(ix, iy + 1, 1 - row_channel)) *
                                             0.5f;
      } else {
        const int own = here == Cfa::red ? 0 : 1;
        diff[std::size_t(own)] = difference_at(ix, iy, own);
        // The other colour sits on the four diagonals. Choosing the diagonal
        // pair with the smaller difference keeps a fine diagonal edge from
        // smearing across it.
        const int other = 1 - own;
        const float a = difference_at(ix - 1, iy - 1, other), b = difference_at(ix + 1, iy + 1, other);
        const float c = difference_at(ix + 1, iy - 1, other), d = difference_at(ix - 1, iy + 1, other);
        const float spread_main = std::abs(a - b), spread_anti = std::abs(c - d);
        constexpr float decisive = 1.5f;
        if (spread_main * decisive < spread_anti)
          diff[std::size_t(other)] = (a + b) * 0.5f;
        else if (spread_anti * decisive < spread_main)
          diff[std::size_t(other)] = (c + d) * 0.5f;
        else
          diff[std::size_t(other)] = (a + b + c + d) * 0.25f;
      }
      dst[std::size_t(x) * 3 + 0] = g + diff[0];
      dst[std::size_t(x) * 3 + 1] = g;
      dst[std::size_t(x) * 3 + 2] = g + diff[1];
    }
  }

  // Pass 3: a 3x3 median over each colour difference. The directional steps
  // above are right almost everywhere and wrong in a few pixels along a hard
  // edge, and a wrong one shows as a coloured speck; a median removes exactly
  // that kind of isolated error without touching a real edge's colour.
  std::vector<float> smoothed(std::size_t(width) * height * 2, 0.f);
  for (std::uint32_t y = 0; y < height; ++y) {
    const float* centre = out.row(y);
    float* dst = smoothed.data() + std::size_t(y) * width * 2;
    for (std::uint32_t x = 0; x < width; ++x) {
      for (int channel = 0; channel < 2; ++channel) {
        float window[9];
        int n = 0;
        for (int dy = -1; dy <= 1; ++dy)
          for (int dx = -1; dx <= 1; ++dx) {
            const std::size_t at =
                (std::size_t(mirror(int(y) + dy, height)) * width + mirror(int(x) + dx, width)) * 3;
            window[n++] = out.data[at + (channel == 0 ? 0 : 2)] - out.data[at + 1];
          }
        dst[std::size_t(x) * 2 + std::size_t(channel)] = median_of_nine(window);
      }
      (void)centre;
    }
  }
  for (std::uint32_t y = 0; y < height; ++y) {
    float* dst = out.row(y);
    const float* diff = smoothed.data() + std::size_t(y) * width * 2;
    for (std::uint32_t x = 0; x < width; ++x) {
      const float g = dst[std::size_t(x) * 3 + 1];
      dst[std::size_t(x) * 3 + 0] = g + diff[std::size_t(x) * 2];
      dst[std::size_t(x) * 3 + 2] = g + diff[std::size_t(x) * 2 + 1];
    }
  }
  (void)green_plane;
  return out;
}

} // namespace

LinearImage demosaic_mosaic(const LinearImage& mosaic, const CfaPattern& cfa,
                            std::uint32_t origin_x, std::uint32_t origin_y, Demosaic quality) {
  if (mosaic.channels != 1) throw std::runtime_error("A demosaic expects a one-channel mosaic.");
  if (!mosaic.width || !mosaic.height) throw std::runtime_error("This frame has no pixels.");
  const Phase phase = phase_of(cfa, origin_x, origin_y);
  switch (quality) {
    case Demosaic::half: return demosaic_half(mosaic, phase);
    case Demosaic::bilinear: return demosaic_bilinear(mosaic, phase);
    default: return demosaic_gradient(mosaic, phase);
  }
}

} // namespace lenslabs::raw
