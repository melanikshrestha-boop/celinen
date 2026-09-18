#pragma once
// Procedural fixtures for the cull intelligence tests. Every image is generated
// from a seed, so the suite needs no files, no licences and no network, and a
// failure reproduces bit for bit.
#include "lenslabs/engine.hpp"
#include <algorithm>
#include <cmath>
#include <complex>
#include <cstdint>
#include <random>
#include <vector>

namespace fixtures {

using lenslabs::Image;
inline constexpr double pi = 3.14159265358979323846;

inline Image canvas(unsigned w, unsigned h, std::uint8_t r = 0, std::uint8_t g = 0, std::uint8_t b = 0) {
  Image image{w, h, w, h, {}};
  image.rgba.resize(std::size_t(w) * h * 4);
  for (std::size_t i = 0; i < std::size_t(w) * h; ++i) {
    image.rgba[i * 4] = r;
    image.rgba[i * 4 + 1] = g;
    image.rgba[i * 4 + 2] = b;
    image.rgba[i * 4 + 3] = 255;
  }
  return image;
}

inline void set(Image& image, int x, int y, double r, double g, double b) {
  if (x < 0 || y < 0 || x >= int(image.width) || y >= int(image.height)) return;
  const auto i = (std::size_t(y) * image.width + std::size_t(x)) * 4;
  image.rgba[i] = std::uint8_t(std::clamp(std::lround(r), 0l, 255l));
  image.rgba[i + 1] = std::uint8_t(std::clamp(std::lround(g), 0l, 255l));
  image.rgba[i + 2] = std::uint8_t(std::clamp(std::lround(b), 0l, 255l));
}
inline void blend(Image& image, int x, int y, double r, double g, double b, double alpha) {
  if (x < 0 || y < 0 || x >= int(image.width) || y >= int(image.height)) return;
  const auto i = (std::size_t(y) * image.width + std::size_t(x)) * 4;
  set(image, x, y, image.rgba[i] * (1 - alpha) + r * alpha, image.rgba[i + 1] * (1 - alpha) + g * alpha,
      image.rgba[i + 2] * (1 - alpha) + b * alpha);
}
inline double gray(const Image& image, unsigned x, unsigned y) {
  const auto i = (std::size_t(y) * image.width + x) * 4;
  return .299 * image.rgba[i] + .587 * image.rgba[i + 1] + .114 * image.rgba[i + 2];
}

inline void fft1(std::vector<std::complex<double>>& a, bool inverse) {
  const std::size_t n = a.size();
  for (std::size_t i = 1, j = 0; i < n; ++i) {
    std::size_t bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) std::swap(a[i], a[j]);
  }
  for (std::size_t len = 2; len <= n; len <<= 1) {
    const double ang = 2 * pi / double(len) * (inverse ? -1 : 1);
    const std::complex<double> wl(std::cos(ang), std::sin(ang));
    for (std::size_t i = 0; i < n; i += len) {
      std::complex<double> w(1);
      for (std::size_t k = 0; k < len / 2; ++k) {
        const auto u = a[i + k], v = a[i + k + len / 2] * w;
        a[i + k] = u + v;
        a[i + k + len / 2] = u - v;
        w *= wl;
      }
    }
  }
  if (inverse)
    for (auto& v : a) v /= double(n);
}

// A 1/f^beta random field on an n x n torus, zero mean, unit deviation. This is
// the statistical signature of natural scenes: the reason photographs share a
// spectrum whatever they depict.
inline std::vector<double> pink_field(std::size_t n, double beta, std::uint32_t seed) {
  std::mt19937 rng(seed);
  std::normal_distribution<double> normal(0, 1);
  std::vector<std::complex<double>> f(n * n);
  for (std::size_t v = 0; v < n; ++v)
    for (std::size_t u = 0; u < n; ++u) {
      const double ku = u < n / 2 ? double(u) : double(u) - double(n);
      const double kv = v < n / 2 ? double(v) : double(v) - double(n);
      const double r = std::hypot(ku, kv);
      const double amplitude = r == 0 ? 0 : std::pow(r, -beta / 2);
      f[v * n + u] = {normal(rng) * amplitude, normal(rng) * amplitude};
    }
  std::vector<std::complex<double>> line(n);
  for (std::size_t r = 0; r < n; ++r) {
    std::copy_n(f.begin() + std::ptrdiff_t(r * n), n, line.begin());
    fft1(line, true);
    std::copy_n(line.begin(), n, f.begin() + std::ptrdiff_t(r * n));
  }
  for (std::size_t c = 0; c < n; ++c) {
    for (std::size_t r = 0; r < n; ++r) line[r] = f[r * n + c];
    fft1(line, true);
    for (std::size_t r = 0; r < n; ++r) f[r * n + c] = line[r];
  }
  std::vector<double> out(n * n);
  double mean = 0, sq = 0;
  for (std::size_t i = 0; i < out.size(); ++i) {
    out[i] = f[i].real();
    mean += out[i];
  }
  mean /= double(out.size());
  for (auto& v : out) {
    v -= mean;
    sq += v * v;
  }
  const double sd = std::sqrt(sq / double(out.size()));
  for (auto& v : out) v /= sd > 0 ? sd : 1;
  return out;
}

// Natural-image-like frame: a 1/f^2 luma field with loosely correlated chroma
// and Gaussian sensor grain, as a camera JPEG looks at the working size.
inline Image natural(unsigned w = 640, unsigned h = 427, std::uint32_t seed = 7, double grain = 1.2,
                     double base = 118, double contrast = 42, double beta = 2.0) {
  const std::size_t n = 1024;
  const auto l = pink_field(n, beta, seed);
  const auto cr = pink_field(n, 2.4, seed * 31 + 1);
  const auto cb = pink_field(n, 2.4, seed * 57 + 3);
  std::mt19937 rng(seed ^ 0x9e3779b9u);
  std::normal_distribution<double> noise(0, grain);
  auto image = canvas(w, h);
  for (unsigned y = 0; y < h; ++y)
    for (unsigned x = 0; x < w; ++x) {
      const auto i = std::size_t(y) * n + x;
      const double luma = base + contrast * l[i];
      const double r = luma + 14 * cr[i], b = luma + 14 * cb[i];
      const double g = (luma - .299 * r - .114 * b) / .587;
      set(image, int(x), int(y), r + noise(rng), g + noise(rng), b + noise(rng));
    }
  return image;
}

// A studio portrait: a smooth lit backdrop, a textured subject in the middle,
// grain everywhere. The case that must never be mistaken for a flat render.
inline Image portrait(unsigned w = 427, unsigned h = 640, std::uint32_t seed = 11, double grain = .9) {
  const std::size_t n = 1024;
  const auto texture = pink_field(n, 2.2, seed);
  std::mt19937 rng(seed + 5);
  std::normal_distribution<double> noise(0, grain);
  auto image = canvas(w, h);
  for (unsigned y = 0; y < h; ++y)
    for (unsigned x = 0; x < w; ++x) {
      const double dx = (x - w * .5) / (w * .22), dy = (y - h * .52) / (h * .3);
      const double inside = std::clamp(1.4 - std::sqrt(dx * dx + dy * dy), 0.0, 1.0); // soft subject edge
      const double backdrop = 150 + 40 * (double(y) / h) - 25 * std::abs(double(x) / w - .5);
      const double subject = 105 + 38 * texture[std::size_t(y) * n + x];
      const double luma = backdrop * (1 - inside) + subject * inside;
      set(image, int(x), int(y), luma * 1.08 + noise(rng), luma * .98 + noise(rng), luma * .9 + noise(rng));
    }
  return image;
}

inline Image box_blur(const Image& source, int radius) {
  auto image = source;
  for (int pass = 0; pass < 2; ++pass)
    for (bool vertical : {false, true}) {
      const auto copy = image;
      for (unsigned y = 0; y < image.height; ++y)
        for (unsigned x = 0; x < image.width; ++x) {
          double sums[3] = {0, 0, 0};
          int count = 0;
          for (int d = -radius; d <= radius; ++d) {
            const int sx = vertical ? int(x) : std::clamp(int(x) + d, 0, int(image.width) - 1);
            const int sy = vertical ? std::clamp(int(y) + d, 0, int(image.height) - 1) : int(y);
            const auto i = (std::size_t(sy) * image.width + std::size_t(sx)) * 4;
            for (int c = 0; c < 3; ++c) sums[c] += copy.rgba[i + std::size_t(c)];
            ++count;
          }
          set(image, int(x), int(y), sums[0] / count, sums[1] / count, sums[2] / count);
        }
    }
  return image;
}

inline Image static_noise(unsigned w = 640, unsigned h = 427, std::uint32_t seed = 3, bool color = true) {
  std::mt19937 rng(seed);
  std::uniform_int_distribution<int> byte(0, 255);
  auto image = canvas(w, h);
  for (unsigned y = 0; y < h; ++y)
    for (unsigned x = 0; x < w; ++x) {
      const int v = byte(rng);
      if (color) set(image, int(x), int(y), v, byte(rng), byte(rng));
      else set(image, int(x), int(y), v, v, v);
    }
  return image;
}

inline Image gaussian_static(unsigned w = 640, unsigned h = 427, std::uint32_t seed = 4) {
  std::mt19937 rng(seed);
  std::normal_distribution<double> normal(128, 40);
  auto image = canvas(w, h);
  for (unsigned y = 0; y < h; ++y)
    for (unsigned x = 0; x < w; ++x) {
      const double v = normal(rng);
      set(image, int(x), int(y), v, v, v);
    }
  return image;
}

inline Image lens_cap(unsigned w = 640, unsigned h = 427, std::uint32_t seed = 9) {
  std::mt19937 rng(seed);
  std::normal_distribution<double> noise(0, 1.6);
  auto image = canvas(w, h);
  for (unsigned y = 0; y < h; ++y)
    for (unsigned x = 0; x < w; ++x) {
      const double leak = 6 + 5 * std::exp(-std::pow((x - w * .8) / (w * .3), 2)); // faint light leak
      set(image, int(x), int(y), leak + noise(rng), leak * .9 + noise(rng), leak * .8 + noise(rng));
    }
  return image;
}

inline Image stripes(unsigned w = 640, unsigned h = 427, unsigned period = 16) {
  auto image = canvas(w, h);
  for (unsigned y = 0; y < h; ++y)
    for (unsigned x = 0; x < w; ++x) {
      const double v = (y / (period / 2)) % 2 ? 200 : 60;
      set(image, int(x), int(y), v, v, v);
    }
  return image;
}

inline Image color_bars(unsigned w = 640, unsigned h = 427) {
  static constexpr int bars[7][3] = {{191, 191, 191}, {191, 191, 0}, {0, 191, 191}, {0, 191, 0},
                                     {191, 0, 191},   {191, 0, 0},   {0, 0, 191}};
  auto image = canvas(w, h);
  for (unsigned y = 0; y < h; ++y)
    for (unsigned x = 0; x < w; ++x) {
      const auto& c = bars[std::min<unsigned>(6, x * 7 / w)];
      if (y > h * 3 / 4) set(image, int(x), int(y), 16, 16, 16);
      else set(image, int(x), int(y), c[0], c[1], c[2]);
    }
  return image;
}

inline Image checkerboard(unsigned w = 640, unsigned h = 427, unsigned cell = 20) {
  auto image = canvas(w, h);
  for (unsigned y = 0; y < h; ++y)
    for (unsigned x = 0; x < w; ++x) {
      const double v = ((x / cell) + (y / cell)) % 2 ? 230 : 25;
      set(image, int(x), int(y), v, v, v);
    }
  return image;
}

// The bottom of the frame never arrived: libjpeg fills it with one colour.
inline Image truncated_gray(double arrived = .45, std::uint32_t seed = 21) {
  auto image = natural(640, 427, seed);
  for (unsigned y = unsigned(427 * arrived); y < 427; ++y)
    for (unsigned x = 0; x < 640; ++x) set(image, int(x), int(y), 128, 128, 128);
  return image;
}

// The last good scanline smeared down the rest of the frame.
inline Image truncated_smear(double arrived = .6, std::uint32_t seed = 22) {
  auto image = natural(640, 427, seed);
  const unsigned last = unsigned(427 * arrived) - 1;
  for (unsigned y = last + 1; y < 427; ++y)
    for (unsigned x = 0; x < 640; ++x) {
      const auto i = (std::size_t(last) * 640 + x) * 4;
      set(image, int(x), int(y), image.rgba[i], image.rgba[i + 1], image.rgba[i + 2]);
    }
  return image;
}

// Damaged entropy data: bands of scanlines shifted sideways with a colour cast.
inline Image blocky_bands(std::uint32_t seed = 23) {
  const auto source = natural(640, 427, seed);
  auto image = source;
  std::mt19937 rng(seed);
  std::uniform_int_distribution<int> shift(-180, 180), cast(-70, 70);
  for (unsigned band = 0; band * 16 < 427; ++band) {
    if (band < 6) continue; // the top of the file decoded
    const int dx = shift(rng), dr = cast(rng), dg = cast(rng), db = cast(rng);
    for (unsigned y = band * 16; y < std::min(427u, band * 16 + 16); ++y)
      for (unsigned x = 0; x < 640; ++x) {
        // Whole 8x8 blocks, as a broken decoder produces them.
        const unsigned sx = (unsigned((int(x) + dx + 6400) % 640) / 8) * 8;
        const auto i = (std::size_t(y) * 640 + sx) * 4;
        set(image, int(x), int(y), source.rgba[i] + dr, source.rgba[i + 1] + dg, source.rgba[i + 2] + db);
      }
  }
  return image;
}

inline void disc(Image& image, double cx, double cy, double radius, double r, double g, double b) {
  for (int y = int(cy - radius - 2); y <= int(cy + radius + 2); ++y)
    for (int x = int(cx - radius - 2); x <= int(cx + radius + 2); ++x) {
      const double d = std::hypot(x + .5 - cx, y + .5 - cy);
      const double alpha = std::clamp(radius - d + .5, 0.0, 1.0); // anti-aliased rim
      if (alpha > 0) blend(image, x, y, r, g, b, alpha);
    }
}

inline void thick_line(Image& image, double x0, double y0, double x1, double y1, double width, double v) {
  const double length = std::hypot(x1 - x0, y1 - y0);
  const int steps = std::max(1, int(length * 2));
  for (int s = 0; s <= steps; ++s) {
    const double t = double(s) / steps;
    disc(image, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, width / 2, v, v, v);
  }
}

inline void ring(Image& image, double cx, double cy, double radius, double width, double v) {
  const int steps = int(radius * 8) + 16;
  for (int s = 0; s < steps; ++s) {
    const double a = 2 * pi * s / steps;
    disc(image, cx + radius * std::cos(a), cy + radius * std::sin(a), width / 2, v, v, v);
  }
}

// A manga page: white paper, ink outlines, panel borders, screentone and flat
// gray fills. Grayscale, anti-aliased, no grain.
inline Image manga(unsigned w = 452, unsigned h = 640, std::uint32_t seed = 31) {
  std::mt19937 rng(seed);
  std::uniform_real_distribution<double> u(0, 1);
  auto image = canvas(w, h, 255, 255, 255);
  // Panels.
  const double split_y = h * (.38 + .1 * u(rng)), split_x = w * (.45 + .1 * u(rng));
  const auto panel = [&](double x0, double y0, double x1, double y1) {
    thick_line(image, x0, y0, x1, y0, 3, 0);
    thick_line(image, x1, y0, x1, y1, 3, 0);
    thick_line(image, x1, y1, x0, y1, 3, 0);
    thick_line(image, x0, y1, x0, y0, 3, 0);
  };
  panel(12, 12, w - 12, split_y - 6);
  panel(12, split_y + 6, split_x - 6, h - 12);
  panel(split_x + 6, split_y + 6, w - 12, h - 12);
  // Screentone: a dot grid over part of the first panel.
  for (unsigned y = 20; y < unsigned(split_y * .6); y += 5)
    for (unsigned x = 20; x < w - 20; x += 5) disc(image, x + (y / 5) % 2 * 2.5, y, 1.2, 40, 40, 40);
  // Flat gray fills (hair, clothing).
  for (int k = 0; k < 5; ++k) disc(image, w * (.2 + .6 * u(rng)), h * (.5 + .4 * u(rng)), 18 + 30 * u(rng), 140, 140, 140);
  // Characters: heads, eyes, hair strokes, a speech bubble.
  for (int k = 0; k < 4; ++k) {
    const double cx = w * (.15 + .7 * u(rng)), cy = h * (.15 + .75 * u(rng)), r = 30 + 30 * u(rng);
    disc(image, cx, cy, r, 255, 255, 255);
    ring(image, cx, cy, r, 2.5, 0);
    disc(image, cx - r * .35, cy - r * .1, r * .14, 0, 0, 0);
    disc(image, cx + r * .35, cy - r * .1, r * .14, 0, 0, 0);
    for (int s = 0; s < 7; ++s) {
      const double a = pi * (1.1 + .8 * u(rng));
      thick_line(image, cx + r * std::cos(a), cy + r * std::sin(a), cx + 1.6 * r * std::cos(a + .2),
                 cy + 1.6 * r * std::sin(a + .2), 2, 0);
    }
  }
  disc(image, w * .7, h * .12, 40, 255, 255, 255);
  ring(image, w * .7, h * .12, 40, 2, 0);
  for (int line = 0; line < 3; ++line)
    for (int g = 0; g < 6; ++g) disc(image, w * .7 - 25 + g * 10, h * .12 - 12 + line * 12, 3, 0, 0, 0);
  return image;
}

// An anime still: cel-shaded flat colour regions with dark outlines, a two-tone
// shadow and a banded sky gradient. Colour, no grain.
inline Image anime(unsigned w = 640, unsigned h = 360, std::uint32_t seed = 41) {
  std::mt19937 rng(seed);
  std::uniform_real_distribution<double> u(0, 1);
  auto image = canvas(w, h);
  for (unsigned y = 0; y < h; ++y) {
    // Posterized sky: bands of exact colour, as cel backgrounds are painted.
    const double t = std::floor(double(y) / h * 6) / 6;
    for (unsigned x = 0; x < w; ++x) set(image, int(x), int(y), 120 + 60 * t, 170 + 40 * t, 235);
  }
  for (unsigned y = unsigned(h * .7); y < h; ++y)
    for (unsigned x = 0; x < w; ++x) set(image, int(x), int(y), 90, 150, 80); // grass
  for (int k = 0; k < 6; ++k) {
    const double cx = w * u(rng), cy = h * (.35 + .5 * u(rng)), r = 25 + 60 * u(rng);
    const double cr = 60 + 190 * u(rng), cg = 60 + 190 * u(rng), cbl = 60 + 190 * u(rng);
    disc(image, cx, cy, r, cr, cg, cbl);
    disc(image, cx + r * .3, cy + r * .3, r * .6, cr * .7, cg * .7, cbl * .75); // cel shadow
    ring(image, cx, cy, r, 2.5, 30);
  }
  // A face with big eyes.
  disc(image, w * .5, h * .45, 60, 250, 220, 200);
  ring(image, w * .5, h * .45, 60, 2.5, 40);
  disc(image, w * .47, h * .45, 12, 60, 90, 170);
  disc(image, w * .56, h * .45, 12, 60, 90, 170);
  disc(image, w * .47, h * .44, 4, 255, 255, 255);
  disc(image, w * .56, h * .44, 4, 255, 255, 255);
  return image;
}

// An app screenshot: light background, cards, buttons and lines of small text.
inline Image screenshot(unsigned w = 640, unsigned h = 400, std::uint32_t seed = 51) {
  std::mt19937 rng(seed);
  std::uniform_real_distribution<double> u(0, 1);
  auto image = canvas(w, h, 246, 247, 249);
  const auto rect = [&](unsigned x0, unsigned y0, unsigned x1, unsigned y1, int r, int g, int b) {
    for (unsigned y = y0; y < std::min(y1, h); ++y)
      for (unsigned x = x0; x < std::min(x1, w); ++x) set(image, int(x), int(y), r, g, b);
  };
  rect(0, 0, w, 44, 32, 36, 48); // top bar
  rect(0, 44, 150, h, 236, 238, 242); // sidebar
  for (int card = 0; card < 4; ++card) {
    const unsigned x0 = 170 + unsigned(card % 2) * 235, y0 = 64 + unsigned(card / 2) * 165;
    rect(x0, y0, x0 + 220, y0 + 150, 255, 255, 255);
    rect(x0, y0, x0 + 220, y0 + 1, 220, 222, 228);
    rect(x0 + 12, y0 + 110, x0 + 90, y0 + 136, 60, 110, 240); // button
    for (unsigned line = 0; line < 5; ++line)
      for (unsigned x = x0 + 12; x < x0 + 200;) {
        const unsigned word = 8 + unsigned(u(rng) * 30);
        for (unsigned gx = x; gx < std::min(x + word, x0 + 205); gx += 5) {
          const unsigned glyph_h = 7 + unsigned(u(rng) * 3);
          rect(gx, y0 + 14 + line * 18 + (10 - glyph_h), gx + 1 + unsigned(u(rng) * 2), y0 + 14 + line * 18 + 10, 40, 42, 50);
          if (u(rng) < .5) rect(gx, y0 + 14 + line * 18 + 4, gx + 4, y0 + 14 + line * 18 + 5, 40, 42, 50);
        }
        x += word + 6;
      }
  }
  for (unsigned item = 0; item < 10; ++item) rect(16, 64 + item * 28, 16 + 60 + unsigned(u(rng) * 50), 72 + item * 28, 90, 95, 110);
  return image;
}

inline Image document(unsigned w = 452, unsigned h = 640, std::uint32_t seed = 61) {
  std::mt19937 rng(seed);
  std::uniform_real_distribution<double> u(0, 1);
  auto image = canvas(w, h, 252, 252, 250);
  for (unsigned line = 0; line < 38; ++line) {
    const unsigned y0 = 40 + line * 15;
    if (y0 + 10 >= h - 30) break;
    for (unsigned x = 40; x < w - 40;) {
      const unsigned word = 10 + unsigned(u(rng) * 40);
      for (unsigned gx = x; gx < std::min(x + word, w - 40); gx += 5) {
        for (unsigned y = y0 + 2; y < y0 + 10; ++y) set(image, int(gx), int(y), 30, 30, 30);
        if (u(rng) < .6)
          for (unsigned xx = gx; xx < gx + 4; ++xx) set(image, int(xx), int(y0 + 2 + unsigned(u(rng) * 8)), 30, 30, 30);
      }
      x += word + 5;
    }
  }
  return image;
}

} // namespace fixtures
