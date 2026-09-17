#include "lenslabs/focus_hit.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <utility>
#include <vector>

// Did the camera's focus land on what it was pointed at?
//
// The camera's maker note says where its AF area was. This measures resolving
// power inside that area and compares it with the sharpest detail anywhere in
// the frame. Three outcomes matter at a sports cull: the AF area is as sharp as
// the frame gets (a hit), something else is clearly sharper (the lens focused in
// front of or behind the subject), or nothing is sharp at all (a miss).
//
// The per-tile measurement is cull.cpp's, kept numerically identical so the two
// engines speak the same acuity units; focus_hit_tests.cpp checks that this
// file's best acuity agrees with measure_cull()'s acuity_best on the same frame.
// It is re-implemented rather than shared because cull.cpp computes it inline
// inside measure_cull(), and restructuring that is out of this file's remit.
namespace lenslabs {
namespace {
constexpr double pi = 3.14159265358979323846;

// Same grid, strides and floors as cull.cpp's measure_cull().
constexpr std::array<std::pair<int, int>, 4> directions{{{1, 0}, {0, 1}, {1, 1}, {-1, 1}}};
constexpr int near_stride = 1, far_stride = 8;

// Acuity thresholds, in the cull's units. cull_shoot() never calls a frame
// sharp below .42 or keeps one below .26, whatever the shoot looks like.
constexpr double soft_acuity = .32;  // at or below: nothing resolvable at the AF area
constexpr double sharp_acuity = .52; // at or above: clearly resolved
// How far below the frame's best the AF area may sit and still be the subject.
// Sports frames carry crisp signage and court lines; a subject a little softer
// than a printed board is still a hit.
constexpr double best_slack = .10, best_falloff = .30;

double clamp01(double v) { return std::clamp(v, 0.0, 1.0); }

struct TileAcuity {
  double acuity = 0;
  bool textured = false;
};

// Immerkaer's estimator, as in cull.cpp: a kernel blind to smooth content, so
// what remains is sensor grain.
double estimate_noise(const std::vector<float>& gray, unsigned w, unsigned h) {
  if (w < 3 || h < 3) return 0;
  double sum = 0;
  std::size_t count = 0;
  for (unsigned y = 1; y + 1 < h; ++y)
    for (unsigned x = 1; x + 1 < w; ++x) {
      const auto i = std::size_t(y) * w + x;
      const double value = gray[i - w - 1] - 2 * gray[i - w] + gray[i - w + 1] -
                           2 * gray[i - 1] + 4 * gray[i] - 2 * gray[i + 1] +
                           gray[i + w - 1] - 2 * gray[i + w] + gray[i + w + 1];
      sum += std::abs(value);
      ++count;
    }
  return count ? std::sqrt(pi / 2) * sum / (6.0 * double(count)) : 0;
}

std::vector<TileAcuity> measure_tiles(const std::vector<float>& gray, unsigned w, unsigned h,
                                      unsigned columns, unsigned rows) {
  std::vector<TileAcuity> tiles(std::size_t(columns) * rows);
  const double noise = estimate_noise(gray, w, h);
  const double noise_energy = 2 * noise * noise; // grain, one direction, any stride
  for (unsigned tr = 0; tr < rows; ++tr)
    for (unsigned tc = 0; tc < columns; ++tc) {
      auto& tile = tiles[std::size_t(tr) * columns + tc];
      const unsigned x0 = tc * w / columns, x1 = (tc + 1) * w / columns;
      const unsigned y0 = tr * h / rows, y1 = (tr + 1) * h / rows;
      double total = 0, squares = 0;
      std::size_t count = 0;
      std::array<double, 4> near_sum{}, far_sum{};
      std::array<std::size_t, 4> near_count{}, far_count{};
      for (unsigned y = y0; y < y1; ++y)
        for (unsigned x = x0; x < x1; ++x) {
          const double value = gray[std::size_t(y) * w + x];
          total += value;
          squares += value * value;
          ++count;
          for (std::size_t d = 0; d < directions.size(); ++d) {
            // The long stride may reach into neighbouring tiles, as in cull.cpp.
            const auto sample = [&](int stride, double& energy, std::size_t& taken) {
              const int sx = int(x) + directions[d].first * stride;
              const int sy = int(y) + directions[d].second * stride;
              if (sx < 0 || sy < 0 || sx >= int(w) || sy >= int(h)) return;
              const double delta = gray[std::size_t(sy) * w + std::size_t(sx)] - value;
              energy += delta * delta;
              ++taken;
            };
            sample(near_stride, near_sum[d], near_count[d]);
            sample(far_stride, far_sum[d], far_count[d]);
          }
        }
      if (!count) continue;
      const double mean = total / double(count);
      const double contrast = std::sqrt(std::max(0.0, squares / double(count) - mean * mean));
      bool judged = false;
      double weakest = 2;
      for (std::size_t d = 0; d < directions.size(); ++d) {
        if (!near_count[d] || !far_count[d]) continue;
        // Uncorrelated grain adds equal energy at any stride; remove it first.
        const double near = std::max(0.0, near_sum[d] / double(near_count[d]) - noise_energy);
        const double far = std::max(0.0, far_sum[d] / double(far_count[d]) - noise_energy);
        if (far <= std::max(6.0, 3 * noise_energy)) continue;
        weakest = std::min(weakest, std::sqrt(near / far));
        judged = true;
      }
      tile.textured = judged && contrast > 2.5;
      // A well-focused JPEG resolves an edge in about one and a half pixels.
      if (tile.textured) tile.acuity = clamp01(weakest / .66);
    }
  return tiles;
}

// cull.cpp's percentile: nearest rank on a copy.
double percentile_of(std::vector<double> values, double fraction) {
  if (values.empty()) return 0;
  const auto at = std::size_t(std::clamp(fraction, 0.0, 1.0) * double(values.size() - 1) + .5);
  std::nth_element(values.begin(), values.begin() + std::ptrdiff_t(at), values.end());
  return values[at];
}

// The resolving power of the sharpest half of the AF area's textured detail,
// weighted by how much of each tile the area covers. The sharpest half, not the
// mean: an AF box on a player also holds the soft stadium behind their shoulder.
// Returns <0 when no textured tile has enough of its area inside.
double area_acuity(const std::vector<TileAcuity>& tiles, unsigned columns, unsigned rows,
                   double x0, double y0, double x1, double y1) {
  std::vector<std::pair<double, double>> inside; // acuity, overlap
  for (unsigned tr = 0; tr < rows; ++tr)
    for (unsigned tc = 0; tc < columns; ++tc) {
      const auto& tile = tiles[std::size_t(tr) * columns + tc];
      if (!tile.textured) continue;
      const double tx0 = double(tc) / columns, tx1 = double(tc + 1) / columns;
      const double ty0 = double(tr) / rows, ty1 = double(tr + 1) / rows;
      const double ox = std::min(x1, tx1) - std::max(x0, tx0);
      const double oy = std::min(y1, ty1) - std::max(y0, ty0);
      if (ox <= 0 || oy <= 0) continue;
      const double overlap = (ox * oy) / ((tx1 - tx0) * (ty1 - ty0));
      if (overlap >= .25) inside.emplace_back(tile.acuity, overlap);
    }
  if (inside.empty()) return -1;
  std::sort(inside.begin(), inside.end(), [](const auto& a, const auto& b) { return a.first > b.first; });
  double total = 0;
  for (const auto& entry : inside) total += entry.second;
  const double target = total * .5;
  double sum = 0, used = 0;
  for (const auto& [acuity, overlap] : inside) {
    const double take = std::min(overlap, target - used);
    if (take <= 0) break;
    sum += acuity * take;
    used += take;
  }
  return used > 0 ? sum / used : inside.front().first;
}
} // namespace

const char* focus_hit_verdict_name(FocusHitVerdict verdict) noexcept {
  switch (verdict) {
    case FocusHitVerdict::on_subject: return "on-subject";
    case FocusHitVerdict::sharp_elsewhere: return "front-or-back-focus";
    case FocusHitVerdict::missed: return "missed";
    case FocusHitVerdict::unjudged: return "unjudged";
  }
  return "unjudged";
}

FocusHit judge_focus_hit(const Image& image, const FocusRegion& af) {
  FocusHit out;
  const auto w = image.width, h = image.height;
  if (w < 32 || h < 32 || w > 4096 || h > 4096 || image.rgba.size() != std::size_t(w) * h * 4)
    return out;
  if (!std::isfinite(af.x) || !std::isfinite(af.y) || !std::isfinite(af.width) ||
      !std::isfinite(af.height) || af.width < 0 || af.height < 0)
    return out;
  // An AF area whose centre is outside the frame describes some other image.
  const double cx = af.x + af.width / 2, cy = af.y + af.height / 2;
  if (cx < 0 || cx > 1 || cy < 0 || cy > 1) return out;

  const auto pixels = std::size_t(w) * h;
  std::vector<float> gray(pixels);
  for (std::size_t i = 0; i < pixels; ++i) {
    const auto* p = image.rgba.data() + i * 4;
    gray[i] = float(.299 * p[0] + .587 * p[1] + .114 * p[2]);
  }
  const unsigned columns = std::clamp(w / 28u, 6u, 32u), rows = std::clamp(h / 28u, 6u, 32u);
  const auto tiles = measure_tiles(gray, w, h, columns, rows);

  // The sharpest detail anywhere, and where it is.
  std::vector<double> textured;
  for (const auto& tile : tiles)
    if (tile.textured) textured.push_back(tile.acuity);
  if (textured.empty()) return out; // a flat frame: nothing can be judged
  out.best_acuity = percentile_of(textured, .9);
  {
    double best_sum = -1;
    unsigned best_column = 0, best_row = 0;
    for (unsigned tr = 0; tr + 1 < rows; ++tr)
      for (unsigned tc = 0; tc + 1 < columns; ++tc) {
        double sum = 0;
        for (unsigned dy = 0; dy < 2; ++dy)
          for (unsigned dx = 0; dx < 2; ++dx) {
            const auto& tile = tiles[std::size_t(tr + dy) * columns + tc + dx];
            if (tile.textured) sum += tile.acuity;
          }
        if (sum > best_sum) {
          best_sum = sum;
          best_column = tc;
          best_row = tr;
        }
      }
    out.best_region = {double(best_column) / columns, double(best_row) / rows, 2.0 / columns,
                       2.0 / rows};
  }

  // The AF area, at least two tiles each way: a single AF point on a 640px
  // working frame is smaller than one tile, and one tile is too little detail
  // to judge. Grown around its centre and kept inside the frame.
  const auto grow = [](double centre, double length, double minimum) {
    length = std::min(1.0, std::max(length, minimum));
    double start = centre - length / 2;
    start = std::clamp(start, 0.0, 1.0 - length);
    return std::pair<double, double>{start, start + length};
  };
  const double min_w = 2.0 / columns, min_h = 2.0 / rows;
  double acuity = -1;
  // No detail inside the area (a plain jersey, a patch of sky): look one tile
  // ring further out, twice, before calling it unjudgeable.
  for (int ring = 0; ring < 3 && acuity < 0; ++ring) {
    const auto [x0, x1] = grow(cx, af.width + 2.0 * ring / columns, min_w);
    const auto [y0, y1] = grow(cy, af.height + 2.0 * ring / rows, min_h);
    acuity = area_acuity(tiles, columns, rows, x0, y0, x1, y1);
  }
  if (acuity < 0) return out;
  out.af_acuity = acuity;

  // Confidence: sharp at the AF area, and not clearly beaten by detail elsewhere.
  const double resolved = clamp01((acuity - soft_acuity) / (sharp_acuity - soft_acuity));
  const double agreement = clamp01(1 - (out.best_acuity - acuity - best_slack) / best_falloff);
  out.hit = resolved * agreement;
  if (out.hit >= .5) out.verdict = FocusHitVerdict::on_subject;
  // Front or back focus needs real detail somewhere else that clearly beats the
  // AF area; a frame soft everywhere, or only marginally better elsewhere, is a miss.
  else if (out.best_acuity >= .42 && out.best_acuity - acuity > best_slack)
    out.verdict = FocusHitVerdict::sharp_elsewhere;
  else out.verdict = FocusHitVerdict::missed;
  return out;
}
} // namespace lenslabs
