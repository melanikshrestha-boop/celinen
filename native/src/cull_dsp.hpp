#pragma once
// Small signal-processing kernels shared by the cull intelligence passes
// (validity, subject focus, sequence). Private to native/src: not part of the
// public engine API, and deliberately independent of cull.cpp so those passes
// never collide with changes to the per-frame scorer.
#include "lenslabs/engine.hpp"
#include <algorithm>
#include <cmath>
#include <complex>
#include <functional>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace lenslabs::dsp {

inline constexpr double pi = 3.14159265358979323846;

inline double clamp01(double v) { return std::clamp(v, 0.0, 1.0); }
inline double luma(double r, double g, double b) { return .299 * r + .587 * g + .114 * b; }
inline double sigmoid(double x) { return 1.0 / (1.0 + std::exp(-x)); }

// Grayscale plane in luma codes 0..255.
struct Plane {
  unsigned width = 0, height = 0;
  std::vector<float> values;
  float at(unsigned x, unsigned y) const { return values[std::size_t(y) * width + x]; }
};

inline Plane luma_plane(const Image& image) {
  Plane plane{image.width, image.height, {}};
  plane.values.resize(std::size_t(image.width) * image.height);
  for (std::size_t i = 0; i < plane.values.size(); ++i) {
    const auto* p = image.rgba.data() + i * 4;
    plane.values[i] = float(luma(p[0], p[1], p[2]));
  }
  return plane;
}

// Box-average a rectangle of the plane (x0,y0 inclusive; x1,y1 exclusive) to
// out_w x out_h. Box averaging keeps the resample independent of how the
// working image itself was produced.
inline Plane resample_box(const Plane& in, unsigned x0, unsigned y0, unsigned x1, unsigned y1,
                          unsigned out_w, unsigned out_h) {
  Plane out{out_w, out_h, std::vector<float>(std::size_t(out_w) * out_h, 0)};
  const unsigned span_w = std::max(1u, x1 - x0), span_h = std::max(1u, y1 - y0);
  for (unsigned oy = 0; oy < out_h; ++oy) {
    const unsigned sy0 = y0 + unsigned(std::size_t(oy) * span_h / out_h);
    const unsigned sy1 = std::max(sy0 + 1, y0 + unsigned(std::size_t(oy + 1) * span_h / out_h));
    for (unsigned ox = 0; ox < out_w; ++ox) {
      const unsigned sx0 = x0 + unsigned(std::size_t(ox) * span_w / out_w);
      const unsigned sx1 = std::max(sx0 + 1, x0 + unsigned(std::size_t(ox + 1) * span_w / out_w));
      double sum = 0;
      std::size_t count = 0;
      for (unsigned y = sy0; y < std::min(sy1, in.height); ++y)
        for (unsigned x = sx0; x < std::min(sx1, in.width); ++x) {
          sum += in.values[std::size_t(y) * in.width + x];
          ++count;
        }
      out.values[std::size_t(oy) * out_w + ox] = float(count ? sum / double(count) : 0);
    }
  }
  return out;
}

// In-place iterative radix-2 FFT. n must be a power of two.
inline void fft(std::vector<std::complex<double>>& data, bool inverse) {
  const std::size_t n = data.size();
  for (std::size_t i = 1, j = 0; i < n; ++i) {
    std::size_t bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) std::swap(data[i], data[j]);
  }
  for (std::size_t length = 2; length <= n; length <<= 1) {
    const double angle = 2 * pi / double(length) * (inverse ? -1 : 1);
    const std::complex<double> step(std::cos(angle), std::sin(angle));
    for (std::size_t start = 0; start < n; start += length) {
      std::complex<double> w(1);
      for (std::size_t k = 0; k < length / 2; ++k) {
        const auto u = data[start + k], v = data[start + k + length / 2] * w;
        data[start + k] = u + v;
        data[start + k + length / 2] = u - v;
        w *= step;
      }
    }
  }
  if (inverse)
    for (auto& value : data) value /= double(n);
}

// 2D FFT of an n x n field, rows then columns.
inline void fft2(std::vector<std::complex<double>>& field, std::size_t n, bool inverse) {
  std::vector<std::complex<double>> line(n);
  for (std::size_t r = 0; r < n; ++r) {
    std::copy_n(field.begin() + std::ptrdiff_t(r * n), n, line.begin());
    fft(line, inverse);
    std::copy_n(line.begin(), n, field.begin() + std::ptrdiff_t(r * n));
  }
  for (std::size_t c = 0; c < n; ++c) {
    for (std::size_t r = 0; r < n; ++r) line[r] = field[r * n + c];
    fft(line, inverse);
    for (std::size_t r = 0; r < n; ++r) field[r * n + c] = line[r];
  }
}

// Immerkaer's noise estimate: the kernel is blind to smooth ramps, so what is
// left is grain. Optionally restricted to a rectangle.
inline double immerkaer_noise(const Plane& plane, unsigned x0, unsigned y0, unsigned x1,
                              unsigned y1) {
  x0 = std::max(x0, 1u);
  y0 = std::max(y0, 1u);
  x1 = std::min(x1, plane.width - 1);
  y1 = std::min(y1, plane.height - 1);
  if (x1 <= x0 || y1 <= y0) return 0;
  const auto w = plane.width;
  const auto& g = plane.values;
  double sum = 0;
  std::size_t count = 0;
  for (unsigned y = y0; y < y1; ++y)
    for (unsigned x = x0; x < x1; ++x) {
      const auto i = std::size_t(y) * w + x;
      const double value = g[i - w - 1] - 2 * g[i - w] + g[i - w + 1] - 2 * g[i - 1] + 4 * g[i] -
                           2 * g[i + 1] + g[i + w - 1] - 2 * g[i + w] + g[i + w + 1];
      sum += std::abs(value);
      ++count;
    }
  return count ? std::sqrt(pi / 2) * sum / (6.0 * double(count)) : 0;
}

// Contrast-invariant focus of a rectangle, 0 (mush) .. 1 (crisp): the ratio of
// gradient energy at a one-pixel and an eight-pixel stride, grain removed,
// taken in the weakest resolvable direction and summarised over the sharpest
// part of the textured tiles. The same principle as the frame scorer in
// cull.cpp, reimplemented here so a region can be judged on its own.
struct RegionFocus {
  double acuity = 0;   // 0..1
  double textured = 0; // share of tiles with enough detail to judge
};

inline RegionFocus region_focus(const Plane& plane, unsigned x0, unsigned y0, unsigned x1,
                                unsigned y1, double noise, double upper_share = .35) {
  RegionFocus out;
  x1 = std::min(x1, plane.width);
  y1 = std::min(y1, plane.height);
  if (x1 <= x0 + 8 || y1 <= y0 + 8) return out;
  const unsigned span_w = x1 - x0, span_h = y1 - y0;
  const unsigned columns = std::clamp(span_w / 24u, 1u, 16u), rows = std::clamp(span_h / 24u, 1u, 16u);
  const double noise_energy = 2 * noise * noise;
  static constexpr int dirs[4][2] = {{1, 0}, {0, 1}, {1, 1}, {-1, 1}};
  std::vector<double> acuities;
  std::size_t tiles = 0;
  for (unsigned tr = 0; tr < rows; ++tr)
    for (unsigned tc = 0; tc < columns; ++tc) {
      ++tiles;
      const unsigned tx0 = x0 + tc * span_w / columns, tx1 = x0 + (tc + 1) * span_w / columns;
      const unsigned ty0 = y0 + tr * span_h / rows, ty1 = y0 + (tr + 1) * span_h / rows;
      double near[4] = {0, 0, 0, 0}, far[4] = {0, 0, 0, 0};
      std::size_t near_n[4] = {0, 0, 0, 0}, far_n[4] = {0, 0, 0, 0};
      double total = 0, squares = 0;
      std::size_t count = 0;
      for (unsigned y = ty0; y < ty1; ++y)
        for (unsigned x = tx0; x < tx1; ++x) {
          const double v = plane.at(x, y);
          total += v;
          squares += v * v;
          ++count;
          for (int d = 0; d < 4; ++d)
            for (int stride : {1, 8}) {
              const int sx = int(x) + dirs[d][0] * stride, sy = int(y) + dirs[d][1] * stride;
              if (sx < 0 || sy < 0 || sx >= int(plane.width) || sy >= int(plane.height)) continue;
              const double delta = plane.at(unsigned(sx), unsigned(sy)) - v;
              (stride == 1 ? near[d] : far[d]) += delta * delta;
              ++(stride == 1 ? near_n[d] : far_n[d]);
            }
        }
      if (!count) continue;
      const double mean = total / double(count);
      const double contrast = std::sqrt(std::max(0.0, squares / double(count) - mean * mean));
      if (contrast <= 2.5) continue;
      double weakest = 2;
      bool judged = false;
      for (int d = 0; d < 4; ++d) {
        if (!near_n[d] || !far_n[d]) continue;
        const double n = std::max(0.0, near[d] / double(near_n[d]) - noise_energy);
        const double f = std::max(0.0, far[d] / double(far_n[d]) - noise_energy);
        if (f <= std::max(6.0, 3 * noise_energy)) continue;
        weakest = std::min(weakest, std::sqrt(n / f));
        judged = true;
      }
      if (judged) acuities.push_back(clamp01(weakest / .66));
    }
  if (!tiles || acuities.empty()) return out;
  out.textured = double(acuities.size()) / double(tiles);
  // The sharpest share of the region: a subject is judged on its crispest
  // detail (the eyes, the ball seam), not on its soft edges.
  std::sort(acuities.begin(), acuities.end(), std::greater<>());
  const std::size_t take = std::max<std::size_t>(1, std::size_t(double(acuities.size()) * upper_share + .5));
  double sum = 0;
  for (std::size_t i = 0; i < take; ++i) sum += acuities[i];
  out.acuity = sum / double(take);
  return out;
}

} // namespace lenslabs::dsp
