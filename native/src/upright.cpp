#include "lenslabs/upright.hpp"
#include "lenslabs/exif.hpp"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <stdexcept>

// Upright, from first principles:
//   1. Line segments: gradient-orientation region growing at two scales (an
//      original detector, not a port of LSD or OpenCV).
//   2. Vanishing points: length-weighted RANSAC over segment pairs, refined by
//      least squares on the Gaussian sphere. Gravity prior: verticals are the
//      family that meets above or below the frame.
//   3. Camera rotation (roll, pitch, yaw) from the vertical and dominant
//      horizontal vanishing points, with the focal length from EXIF.
//   4. Per mode, the part of that rotation the photographer asked to remove,
//      capped, with Level as the fallback when the evidence is thin.
namespace lenslabs {
namespace {
constexpr double pi = 3.14159265358979323846;
constexpr double degree = pi / 180;
constexpr double film_diagonal_mm = 43.266615305567875; // hypot(36, 24)

double saturate(double value) { return std::clamp(value, 0.0, 1.0); }

struct V3 { double x = 0, y = 0, z = 0; };
V3 cross(V3 a, V3 b) { return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x}; }
double dot(V3 a, V3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
double norm(V3 a) { return std::sqrt(dot(a, a)); }
V3 scaled(V3 a, double s) { return {a.x * s, a.y * s, a.z * s}; }
V3 normalized(V3 a) { const double n = norm(a); return n > 0 ? scaled(a, 1 / n) : V3{}; }

using M3 = std::array<double, 9>;
M3 multiply(const M3& a, const M3& b) {
  M3 r{};
  for (int i = 0; i < 3; ++i)
    for (int j = 0; j < 3; ++j)
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}
V3 transform_vector(const M3& m, V3 v) {
  return {m[0] * v.x + m[1] * v.y + m[2] * v.z, m[3] * v.x + m[4] * v.y + m[5] * v.z,
          m[6] * v.x + m[7] * v.y + m[8] * v.z};
}
M3 transpose(const M3& m) { return {m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]}; }
M3 inverse(const M3& m) {
  const double a = m[4] * m[8] - m[5] * m[7], b = m[5] * m[6] - m[3] * m[8], c = m[3] * m[7] - m[4] * m[6];
  const double det = m[0] * a + m[1] * b + m[2] * c;
  if (!std::isfinite(det) || std::abs(det) < 1e-300) throw std::invalid_argument("Upright transform is singular.");
  const double k = 1 / det;
  return {a * k, (m[2] * m[7] - m[1] * m[8]) * k, (m[1] * m[5] - m[2] * m[4]) * k,
          b * k, (m[0] * m[8] - m[2] * m[6]) * k, (m[2] * m[3] - m[0] * m[5]) * k,
          c * k, (m[1] * m[6] - m[0] * m[7]) * k, (m[0] * m[4] - m[1] * m[3]) * k};
}
M3 rotation_x(double a) { const double c = std::cos(a), s = std::sin(a); return {1, 0, 0, 0, c, -s, 0, s, c}; }
M3 rotation_y(double a) { const double c = std::cos(a), s = std::sin(a); return {c, 0, s, 0, 1, 0, -s, 0, c}; }
M3 rotation_z(double a) { const double c = std::cos(a), s = std::sin(a); return {c, -s, 0, s, c, 0, 0, 0, 1}; }
M3 translation(double x, double y) { return {1, 0, x, 0, 1, y, 0, 0, 1}; }
M3 scaling(double x, double y) { return {x, 0, 0, 0, y, 0, 0, 0, 1}; }
// World -> camera. Radians.
M3 camera_rotation(double roll, double pitch, double yaw) {
  return multiply(rotation_z(roll), multiply(rotation_x(pitch), rotation_y(yaw)));
}
bool project(const M3& m, double x, double y, double& ox, double& oy) {
  const V3 p = transform_vector(m, {x, y, 1});
  if (!(p.z > 1e-12) || !std::isfinite(p.x) || !std::isfinite(p.y)) return false;
  ox = p.x / p.z;
  oy = p.y / p.z;
  return true;
}

// Axial (undirected) difference of two line angles, in [0, pi/2].
double axial_difference(double a, double b) {
  double d = std::fmod(std::abs(a - b), pi);
  return std::min(d, pi - d);
}

// Smallest eigenvector of a symmetric 3x3 matrix (cyclic Jacobi).
V3 smallest_eigenvector(M3 a) {
  M3 v{1, 0, 0, 0, 1, 0, 0, 0, 1};
  for (int sweep = 0; sweep < 32; ++sweep) {
    const double off = a[1] * a[1] + a[2] * a[2] + a[5] * a[5];
    if (off < 1e-30) break;
    for (const auto& [p, q] : {std::pair{0, 1}, std::pair{0, 2}, std::pair{1, 2}}) {
      const double apq = a[p * 3 + q];
      if (std::abs(apq) < 1e-300) continue;
      const double theta = (a[q * 3 + q] - a[p * 3 + p]) / (2 * apq);
      const double t = (theta >= 0 ? 1 : -1) / (std::abs(theta) + std::sqrt(theta * theta + 1));
      const double c = 1 / std::sqrt(t * t + 1), s = t * c;
      for (int k = 0; k < 3; ++k) { // A <- A J
        const double akp = a[k * 3 + p], akq = a[k * 3 + q];
        a[k * 3 + p] = c * akp - s * akq;
        a[k * 3 + q] = s * akp + c * akq;
      }
      for (int k = 0; k < 3; ++k) { // A <- J^T A
        const double apk = a[p * 3 + k], aqk = a[q * 3 + k];
        a[p * 3 + k] = c * apk - s * aqk;
        a[q * 3 + k] = s * apk + c * aqk;
      }
      for (int k = 0; k < 3; ++k) {
        const double vkp = v[k * 3 + p], vkq = v[k * 3 + q];
        v[k * 3 + p] = c * vkp - s * vkq;
        v[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  int best = 0;
  for (int i = 1; i < 3; ++i) if (a[i * 4] < a[best * 4]) best = i;
  return normalized({v[best], v[3 + best], v[6 + best]});
}

// ---------------------------------------------------------------------------
// Line segment detection
// ---------------------------------------------------------------------------
constexpr double kAngleTolerance = 22.5 * degree;
constexpr float kMinimumGradient = 0.02f; // derivative in luma units per pixel

std::vector<UprightSegment> grow_segments(const std::vector<float>& luma, std::uint32_t w, std::uint32_t h,
                                          double min_length) {
  std::vector<UprightSegment> segments;
  if (w < 8 || h < 8 || luma.size() != std::size_t(w) * h) return segments;
  const std::size_t n = std::size_t(w) * h;
  // Binomial 3x3 blur keeps single-pixel noise from seeding regions.
  std::vector<float> blurred(n), row(n);
  for (std::uint32_t y = 0; y < h; ++y)
    for (std::uint32_t x = 0; x < w; ++x) {
      const auto l = luma[y * std::size_t(w) + (x ? x - 1 : 0)], c = luma[y * std::size_t(w) + x],
                 r = luma[y * std::size_t(w) + std::min(x + 1, w - 1)];
      row[y * std::size_t(w) + x] = (l + 2 * c + r) * .25f;
    }
  for (std::uint32_t y = 0; y < h; ++y)
    for (std::uint32_t x = 0; x < w; ++x) {
      const auto u = row[(y ? y - 1 : 0) * std::size_t(w) + x], c = row[y * std::size_t(w) + x],
                 d = row[std::min(y + 1, h - 1) * std::size_t(w) + x];
      blurred[y * std::size_t(w) + x] = (u + 2 * c + d) * .25f;
    }
  // Sobel / 8 is the per-pixel derivative. Level-line angle is kept axially in [0, pi).
  std::vector<float> magnitude(n, 0), angle(n, 0);
  float strongest = 0;
  for (std::uint32_t y = 1; y + 1 < h; ++y)
    for (std::uint32_t x = 1; x + 1 < w; ++x) {
      const auto at = [&](std::uint32_t xx, std::uint32_t yy) { return blurred[yy * std::size_t(w) + xx]; };
      const float gx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) -
                        2 * at(x - 1, y) - at(x - 1, y + 1)) * .125f;
      const float gy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) -
                        2 * at(x, y - 1) - at(x + 1, y - 1)) * .125f;
      const float m = std::sqrt(gx * gx + gy * gy);
      const auto i = y * std::size_t(w) + x;
      if (m < kMinimumGradient) continue;
      magnitude[i] = m;
      strongest = std::max(strongest, m);
      // The edge runs perpendicular to the gradient.
      double a = std::atan2(double(gy), double(gx)) + pi / 2;
      a = std::fmod(a + 2 * pi, pi);
      angle[i] = float(a);
    }
  if (strongest <= 0) return segments;
  // Strongest gradients seed first: a counting sort into 1,024 buckets.
  constexpr int buckets = 1024;
  std::vector<std::uint32_t> counts(buckets + 1, 0);
  const auto bucket_of = [&](float m) { return std::min(buckets - 1, int(m / strongest * (buckets - 1))); };
  for (std::size_t i = 0; i < n; ++i) if (magnitude[i] > 0) ++counts[bucket_of(magnitude[i]) + 1];
  for (int b = 0; b < buckets; ++b) counts[b + 1] += counts[b];
  std::vector<std::uint32_t> order(counts[buckets]);
  {
    auto cursor = counts;
    for (std::size_t i = 0; i < n; ++i)
      if (magnitude[i] > 0) order[cursor[bucket_of(magnitude[i])]++] = std::uint32_t(i);
  }
  std::vector<std::uint8_t> used(n, 0);
  std::vector<std::uint32_t> region, stack;
  const std::size_t region_cap = std::size_t(8) * (w + h);
  const double min_pixels = std::max(6.0, min_length * .6);
  for (std::size_t k = order.size(); k-- > 0;) {
    const auto seed = order[k];
    if (used[seed]) continue;
    region.clear();
    stack.assign(1, seed);
    used[seed] = 1;
    double sum_c = std::cos(2.0 * angle[seed]), sum_s = std::sin(2.0 * angle[seed]);
    double region_angle = angle[seed];
    while (!stack.empty() && region.size() < region_cap) {
      const auto i = stack.back();
      stack.pop_back();
      region.push_back(i);
      const std::uint32_t x = i % w, y = std::uint32_t(i / w);
      for (int dy = -1; dy <= 1; ++dy)
        for (int dx = -1; dx <= 1; ++dx) {
          if (!dx && !dy) continue;
          const std::int64_t xx = std::int64_t(x) + dx, yy = std::int64_t(y) + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const auto j = std::size_t(yy) * w + std::size_t(xx);
          if (used[j] || magnitude[j] <= 0) continue;
          if (axial_difference(angle[j], region_angle) > kAngleTolerance) continue;
          used[j] = 1;
          stack.push_back(std::uint32_t(j));
          // Doubled angles average orientations without a 0/pi seam.
          sum_c += std::cos(2.0 * angle[j]);
          sum_s += std::sin(2.0 * angle[j]);
          region_angle = std::fmod(0.5 * std::atan2(sum_s, sum_c) + pi, pi);
        }
    }
    // Pixels left on the stack when the cap hit stay claimed but unfitted.
    if (double(region.size()) < min_pixels) continue;
    // Magnitude-weighted principal axis of the region's pixel centers.
    double sw = 0, mx = 0, my = 0;
    for (auto i : region) {
      const double wt = magnitude[i];
      sw += wt; mx += wt * (i % w + .5); my += wt * (i / w + .5);
    }
    mx /= sw; my /= sw;
    double cxx = 0, cyy = 0, cxy = 0;
    for (auto i : region) {
      const double wt = magnitude[i], dx = i % w + .5 - mx, dy = i / w + .5 - my;
      cxx += wt * dx * dx; cyy += wt * dy * dy; cxy += wt * dx * dy;
    }
    cxx /= sw; cyy /= sw; cxy /= sw;
    const double phi = 0.5 * std::atan2(2 * cxy, cxx - cyy);
    const double spread = std::sqrt((cxx - cyy) * (cxx - cyy) * .25 + cxy * cxy);
    const double minor = std::max(0.0, (cxx + cyy) * .5 - spread);
    if (axial_difference(std::fmod(phi + pi, pi), region_angle) > kAngleTolerance) continue;
    const double ux = std::cos(phi), uy = std::sin(phi);
    double t0 = std::numeric_limits<double>::max(), t1 = -t0;
    for (auto i : region) {
      const double t = (i % w + .5 - mx) * ux + (i / w + .5 - my) * uy;
      t0 = std::min(t0, t); t1 = std::max(t1, t);
    }
    const double length = t1 - t0 + 1;
    const double width = std::max(1.0, std::sqrt(12 * minor));
    // Straight, thin and filled: curves and textures fail at least one of these.
    if (length < min_length || length < 5 * width || double(region.size()) < .6 * length) continue;
    segments.push_back({mx + ux * t0, my + uy * t0, mx + ux * t1, my + uy * t1, sw / double(region.size())});
  }
  return segments;
}

double segment_length(const UprightSegment& s) { return std::hypot(s.x2 - s.x1, s.y2 - s.y1); }

// Area-average an RGBA image into a luma plane (sRGB code values / 255).
std::vector<float> analysis_luma(const Image& image, std::uint32_t w, std::uint32_t h) {
  std::vector<float> out(std::size_t(w) * h, 0);
  const double sx = double(image.width) / w, sy = double(image.height) / h;
  for (std::uint32_t y = 0; y < h; ++y) {
    const auto y0 = std::uint32_t(y * sy), y1 = std::max(y0 + 1, std::min(image.height, std::uint32_t(std::ceil((y + 1) * sy))));
    for (std::uint32_t x = 0; x < w; ++x) {
      const auto x0 = std::uint32_t(x * sx), x1 = std::max(x0 + 1, std::min(image.width, std::uint32_t(std::ceil((x + 1) * sx))));
      double sum = 0;
      for (auto yy = y0; yy < y1; ++yy)
        for (auto xx = x0; xx < x1; ++xx) {
          const auto i = (std::size_t(yy) * image.width + xx) * 4;
          sum += .2126 * image.rgba[i] + .7152 * image.rgba[i + 1] + .0722 * image.rgba[i + 2];
        }
      out[y * std::size_t(w) + x] = float(sum / (double(x1 - x0) * (y1 - y0) * 255));
    }
  }
  return out;
}

// True when `b` lies on `a`'s line and mostly within its extent.
bool covered_by(const UprightSegment& a, const UprightSegment& b) {
  const double la = segment_length(a);
  if (la <= 0) return false;
  const double ux = (a.x2 - a.x1) / la, uy = (a.y2 - a.y1) / la;
  const double angle_a = std::atan2(uy, ux), angle_b = std::atan2(b.y2 - b.y1, b.x2 - b.x1);
  if (axial_difference(angle_a, angle_b) > 2.5 * degree) return false;
  const double mx = (b.x1 + b.x2) * .5 - a.x1, my = (b.y1 + b.y2) * .5 - a.y1;
  if (std::abs(mx * -uy + my * ux) > 3) return false;
  const double t1 = (b.x1 - a.x1) * ux + (b.y1 - a.y1) * uy, t2 = (b.x2 - a.x1) * ux + (b.y2 - a.y1) * uy;
  const double overlap = std::min(la, std::max(t1, t2)) - std::max(0.0, std::min(t1, t2));
  return overlap > .5 * std::abs(t2 - t1);
}

// Join collinear pieces a window frame or a lamp post broke apart.
void merge_collinear(std::vector<UprightSegment>& segments, double max_gap) {
  std::sort(segments.begin(), segments.end(),
            [](const auto& a, const auto& b) { return segment_length(a) > segment_length(b); });
  if (segments.size() > 1500) segments.resize(1500);
  std::vector<bool> gone(segments.size(), false);
  for (std::size_t i = 0; i < segments.size(); ++i) {
    if (gone[i]) continue;
    for (std::size_t j = i + 1; j < segments.size(); ++j) {
      if (gone[j]) continue;
      auto& a = segments[i];
      const auto& b = segments[j];
      const double la = segment_length(a), lb = segment_length(b);
      if (la <= 0 || lb <= 0) continue;
      const double ux = (a.x2 - a.x1) / la, uy = (a.y2 - a.y1) / la;
      if (axial_difference(std::atan2(uy, ux), std::atan2(b.y2 - b.y1, b.x2 - b.x1)) > 1.5 * degree) continue;
      const double d1 = std::abs((b.x1 - a.x1) * -uy + (b.y1 - a.y1) * ux);
      const double d2 = std::abs((b.x2 - a.x1) * -uy + (b.y2 - a.y1) * ux);
      if (std::max(d1, d2) > 2) continue;
      const double t1 = (b.x1 - a.x1) * ux + (b.y1 - a.y1) * uy, t2 = (b.x2 - a.x1) * ux + (b.y2 - a.y1) * uy;
      const double lo = std::min(t1, t2), hi = std::max(t1, t2);
      const double gap = std::max(lo - la, -hi);
      if (gap > max_gap) continue;
      const double start = std::min(0.0, lo), end = std::max(la, hi);
      const double strength = (a.strength * la + b.strength * lb) / (la + lb);
      a = {a.x1 + ux * start, a.y1 + uy * start, a.x1 + ux * end, a.y1 + uy * end, strength};
      gone[j] = true;
    }
  }
  std::size_t kept = 0;
  for (std::size_t i = 0; i < segments.size(); ++i) if (!gone[i]) segments[kept++] = segments[i];
  segments.resize(kept);
}

// ---------------------------------------------------------------------------
// Vanishing points
// ---------------------------------------------------------------------------
struct Line {
  double ax, ay, bx, by; // centered analysis pixels
  double mx, my, ux, uy; // midpoint and unit direction
  double length, angle;  // axial image angle in [0, pi)
  V3 normal;             // interpretation-plane normal in calibrated coordinates
};

std::vector<Line> make_lines(const std::vector<UprightSegment>& segments, double cx, double cy, double f) {
  std::vector<Line> lines;
  lines.reserve(segments.size());
  for (const auto& s : segments) {
    Line l{};
    l.ax = s.x1 - cx; l.ay = s.y1 - cy; l.bx = s.x2 - cx; l.by = s.y2 - cy;
    l.length = std::hypot(l.bx - l.ax, l.by - l.ay);
    if (l.length <= 0) continue;
    l.mx = (l.ax + l.bx) * .5; l.my = (l.ay + l.by) * .5;
    l.ux = (l.bx - l.ax) / l.length; l.uy = (l.by - l.ay) / l.length;
    l.angle = std::fmod(std::atan2(l.uy, l.ux) + pi, pi);
    l.normal = normalized(cross({l.ax / f, l.ay / f, 1}, {l.bx / f, l.by / f, 1}));
    lines.push_back(l);
  }
  return lines;
}

// Image-space angle between a segment and the direction to the vanishing point.
double vp_error(const Line& l, V3 d, double f) {
  const double px = f * d.x, py = f * d.y, pz = d.z;
  const double vx = px - l.mx * pz, vy = py - l.my * pz;
  const double v = std::hypot(vx, vy);
  if (v < 1e-12) return pi / 2;
  return std::acos(std::min(1.0, std::abs(vx * l.ux + vy * l.uy) / v));
}
// Endpoint noise of about 1.5px turns into an angle that shrinks with length.
double vp_threshold(const Line& l) { return std::clamp(std::atan(3 / l.length), .6 * degree, 3 * degree); }

struct Rng {
  std::uint64_t state = 0x9e3779b97f4a7c15ull;
  std::uint64_t next() { state ^= state << 13; state ^= state >> 7; state ^= state << 17; return state; }
  double uniform() { return double(next() >> 11) * 0x1.0p-53; }
};

struct Family {
  bool found = false;
  V3 direction;
  std::vector<std::size_t> inliers;
  double evidence = 0; // inlier length / analysis diagonal
  double spread = 0;   // std of inlier midpoints across the family, / frame size
  double score = 0;
};

// Vertical family: world down in camera coordinates has +y. Angles in radians.
void vertical_angles(V3 d, double& roll, double& pitch) {
  roll = std::atan2(-d.x, d.y);
  pitch = std::asin(std::clamp(d.z, -1.0, 1.0));
}
double yaw_of(V3 d, double roll, double pitch, V3* canonical = nullptr) {
  V3 u = transform_vector(transpose(rotation_x(pitch)), transform_vector(transpose(rotation_z(roll)), d));
  if (u.x < 0) { u = scaled(u, -1); if (canonical) *canonical = scaled(d, -1); }
  else if (canonical) *canonical = d;
  double yaw = std::atan2(-u.z, u.x);
  // A facade's horizontals and the perpendicular facade's describe the same
  // camera; report the smaller turn.
  if (yaw > pi / 4) yaw -= pi / 2;
  else if (yaw < -pi / 4) yaw += pi / 2;
  return yaw;
}

template <class Accept>
Family ransac_family(const std::vector<Line>& lines, const std::vector<std::size_t>& candidates, double f,
                     Accept accept, double diagonal, bool spread_in_x, double frame_span) {
  Family family;
  if (candidates.size() < 2) return family;
  std::vector<double> cumulative(candidates.size());
  double total = 0;
  for (std::size_t i = 0; i < candidates.size(); ++i) cumulative[i] = total += lines[candidates[i]].length;
  const auto pick = [&](Rng& rng) {
    const double r = rng.uniform() * total;
    return std::size_t(std::lower_bound(cumulative.begin(), cumulative.end(), r) - cumulative.begin());
  };
  const auto score_of = [&](V3 d, std::vector<std::size_t>* inliers) {
    double score = 0;
    for (auto i : candidates) {
      const auto& l = lines[i];
      const double e = vp_error(l, d, f), t = vp_threshold(l);
      if (e >= t) continue;
      score += l.length * (1 - (e / t) * (e / t));
      if (inliers) inliers->push_back(i);
    }
    return score;
  };
  Rng rng;
  const int iterations = candidates.size() < 40 ? int(candidates.size() * candidates.size()) : 500;
  double best = 0;
  V3 best_d;
  for (int it = 0; it < iterations; ++it) {
    std::size_t a, b;
    if (candidates.size() < 40) { a = std::size_t(it) / candidates.size(); b = std::size_t(it) % candidates.size(); }
    else { a = pick(rng); b = pick(rng); }
    if (a >= b) continue;
    V3 d = cross(lines[candidates[a]].normal, lines[candidates[b]].normal);
    if (norm(d) < 1e-9) continue;
    d = normalized(d);
    if (!accept(d)) continue;
    const double s = score_of(d, nullptr);
    if (s > best) { best = s; best_d = d; }
  }
  if (best <= 0) return family;
  // Least squares on the sphere: the direction most perpendicular to every
  // inlier's interpretation-plane normal, weighted by length.
  V3 d = best_d;
  for (int round = 0; round < 4; ++round) {
    std::vector<std::size_t> inliers;
    score_of(d, &inliers);
    if (inliers.size() < 2) break;
    M3 m{};
    for (auto i : inliers) {
      const auto& l = lines[i];
      const V3 n = l.normal;
      const double wt = l.length;
      m[0] += wt * n.x * n.x; m[1] += wt * n.x * n.y; m[2] += wt * n.x * n.z;
      m[4] += wt * n.y * n.y; m[5] += wt * n.y * n.z; m[8] += wt * n.z * n.z;
    }
    m[3] = m[1]; m[6] = m[2]; m[7] = m[5];
    V3 refined = smallest_eigenvector(m);
    if (dot(refined, d) < 0) refined = scaled(refined, -1);
    if (!accept(refined)) break;
    d = refined;
  }
  family.direction = d;
  family.score = score_of(d, &family.inliers);
  if (family.inliers.size() < 2) return Family{};
  double length = 0, mean = 0, square = 0;
  for (auto i : family.inliers) {
    const auto& l = lines[i];
    const double c = spread_in_x ? l.mx : l.my;
    length += l.length; mean += l.length * c; square += l.length * c * c;
  }
  mean /= length;
  family.evidence = length / diagonal;
  family.spread = std::sqrt(std::max(0.0, square / length - mean * mean)) / frame_span;
  family.found = true;
  return family;
}

// Parallel near-horizontal lines (a horizon, a shoreline, a tabletop edge):
// their shared image angle is the camera roll.
struct Horizon { bool found = false; double roll = 0, confidence = 0; std::size_t count = 0; };
Horizon horizon_family(const std::vector<Line>& lines, double width) {
  Horizon h;
  constexpr int bins = 360; // quarter-degree bins over (-45, 45)
  std::array<double, bins> histogram{};
  for (const auto& l : lines) {
    double a = l.angle > pi / 2 ? l.angle - pi : l.angle; // (-pi/2, pi/2]
    if (std::abs(a) >= pi / 4) continue;
    const int bin = std::clamp(int((a / degree + 45) * 4), 0, bins - 1);
    histogram[bin] += l.length;
  }
  int peak = -1;
  double best = 0;
  for (int i = 0; i < bins; ++i) {
    double sum = 0;
    for (int k = -4; k <= 4; ++k) {
      const int j = i + k;
      if (j >= 0 && j < bins) sum += histogram[j] * (5 - std::abs(k));
    }
    if (sum > best) { best = sum; peak = i; }
  }
  if (peak < 0) return h;
  const double center = ((peak + .5) / 4 - 45) * degree;
  double sum = 0, weight = 0, longest = 0;
  for (const auto& l : lines) {
    double a = l.angle > pi / 2 ? l.angle - pi : l.angle;
    if (std::abs(a - center) > 1.5 * degree) continue;
    sum += a * l.length; weight += l.length; longest = std::max(longest, l.length);
    ++h.count;
  }
  if (weight <= 0) return h;
  h.roll = sum / weight;
  const double evidence = weight / width;
  const double shape = h.count >= 3 || longest >= .3 * width ? 1.0 : .5;
  h.confidence = saturate(evidence / .45) * shape;
  h.found = h.confidence > 0;
  return h;
}

double focal_default() { return upright_focal_from_35mm(upright_default_focal_35mm); }

struct Evidence {
  Family vertical, horizontal;
  Horizon horizon;
  double roll_v = 0, pitch_v = 0, yaw = 0;
  double confidence_v = 0, confidence_roll_v = 0, confidence_h = 0;
};

// Rendered area kept (0..1) by the largest frame-shaped crop of a correction.
double kept_area(const UprightTransform& t, std::uint32_t w, std::uint32_t h) {
  try {
    UprightTransform bare = t;
    bare.constrain_crop = false;
    const auto inverse_map = upright_homography(bare, w, h);
    M3 forward = inverse(inverse_map);
    std::array<double, 8> quad{};
    const double corners[4][2] = {{0, 0}, {double(w), 0}, {double(w), double(h)}, {0, double(h)}};
    for (int i = 0; i < 4; ++i)
      if (!project(forward, corners[i][0], corners[i][1], quad[i * 2], quad[i * 2 + 1])) return 0;
    const auto rect = inscribed_rect(quad, double(w) / h, w, h);
    return rect.width * rect.height;
  } catch (...) {
    return 0;
  }
}
} // namespace

// ---------------------------------------------------------------------------
double upright_focal_from_35mm(double focal_35mm) { return focal_35mm / film_diagonal_mm; }

std::vector<UprightSegment> detect_upright_segments(const std::vector<float>& luma, std::uint32_t width,
                                                    std::uint32_t height, double min_length) {
  return grow_segments(luma, width, height, min_length);
}

std::vector<UprightSegment> detect_upright_segments(const Image& image, std::uint32_t analysis_edge,
                                                    double& scale, double k1) {
  scale = 0;
  if (!image.width || !image.height || image.rgba.size() != std::size_t(image.width) * image.height * 4) return {};
  analysis_edge = std::clamp<std::uint32_t>(analysis_edge, 256, 2048);
  scale = std::min(1.0, double(analysis_edge) / std::max(image.width, image.height));
  const auto w = std::max<std::uint32_t>(8, std::uint32_t(std::lround(image.width * scale)));
  const auto h = std::max<std::uint32_t>(8, std::uint32_t(std::lround(image.height * scale)));
  scale = double(w) / image.width;
  const auto fine = analysis_luma(image, w, h);
  const double min_length = std::max(12.0, .022 * std::max(w, h));
  auto segments = grow_segments(fine, w, h, min_length);
  // Half scale finds long, soft edges that fine-scale texture breaks apart.
  const std::uint32_t hw = w / 2, hh = h / 2;
  if (hw >= 64 && hh >= 64) {
    std::vector<float> coarse(std::size_t(hw) * hh);
    for (std::uint32_t y = 0; y < hh; ++y)
      for (std::uint32_t x = 0; x < hw; ++x)
        coarse[y * std::size_t(hw) + x] = (fine[2 * y * std::size_t(w) + 2 * x] + fine[2 * y * std::size_t(w) + 2 * x + 1] +
                                           fine[(2 * y + 1) * std::size_t(w) + 2 * x] + fine[(2 * y + 1) * std::size_t(w) + 2 * x + 1]) * .25f;
    std::sort(segments.begin(), segments.end(),
              [](const auto& a, const auto& b) { return segment_length(a) > segment_length(b); });
    const std::size_t fine_count = std::min<std::size_t>(segments.size(), 1200);
    for (auto s : grow_segments(coarse, hw, hh, min_length * .5)) {
      s.x1 *= 2; s.y1 *= 2; s.x2 *= 2; s.y2 *= 2;
      bool duplicate = false;
      for (std::size_t i = 0; i < fine_count && !duplicate; ++i) duplicate = covered_by(segments[i], s);
      if (!duplicate) segments.push_back(s);
    }
  }
  merge_collinear(segments, .02 * std::hypot(w, h));
  if (k1 != 0) {
    // Straighten endpoints through the radial model before any geometry.
    const double cx = w * .5, cy = h * .5, r2 = cx * cx + cy * cy;
    const auto undistort = [&](double& x, double& y) {
      const double dx = x - cx, dy = y - cy, g = 1 + k1 * (dx * dx + dy * dy) / r2;
      x = cx + dx * g; y = cy + dy * g;
    };
    for (auto& s : segments) { undistort(s.x1, s.y1); undistort(s.x2, s.y2); }
  }
  return segments;
}

UprightSolution solve_upright_guides(const std::vector<UprightGuide>& guides, std::uint32_t width,
                                     std::uint32_t height, double focal) {
  UprightSolution solution;
  solution.requested = UprightMode::guided;
  solution.focal = focal > 0 ? focal : focal_default();
  solution.focal_source = UprightFocalSource::guided;
  if (!width || !height || guides.empty() || guides.size() > 4) return solution;
  const double cx = width * .5, cy = height * .5, diagonal = std::hypot(width, height);
  struct G { double ax, ay, bx, by; bool vertical; };
  std::vector<G> lines;
  int verticals = 0, horizontals = 0;
  for (const auto& g : guides) {
    for (double v : {g.x1, g.y1, g.x2, g.y2})
      if (!std::isfinite(v) || v < -.001 || v > 1.001) throw std::invalid_argument("Guides must lie on the photo.");
    const double ax = g.x1 * width - cx, ay = g.y1 * height - cy, bx = g.x2 * width - cx, by = g.y2 * height - cy;
    if (std::hypot(bx - ax, by - ay) < .02 * diagonal) continue; // a click, not a guide
    const bool vertical = std::abs(by - ay) > std::abs(bx - ax);
    (vertical ? verticals : horizontals)++;
    lines.push_back({ax, ay, bx, by, vertical});
  }
  if (lines.empty()) return solution;
  // Which parameters the guides can pin down; the rest stay at zero.
  const std::array<bool, 4> free{
      true,
      verticals >= 2 || (verticals >= 1 && horizontals >= 2),
      horizontals >= 2 || (horizontals >= 1 && verticals >= 2),
      verticals >= 2 && horizontals >= 2};
  const double log_f0 = std::log(solution.focal);
  std::array<double, 4> p{0, 0, 0, log_f0};
  const auto residuals = [&](const std::array<double, 4>& q) {
    std::vector<double> r;
    const double f = std::exp(q[3]) * diagonal;
    const M3 k{f, 0, 0, 0, f, 0, 0, 0, 1}, kinv{1 / f, 0, 0, 0, 1 / f, 0, 0, 0, 1};
    const M3 map = multiply(k, multiply(transpose(camera_rotation(q[0], q[1], q[2])), kinv));
    for (const auto& l : lines) {
      double ax, ay, bx, by;
      if (!project(map, l.ax, l.ay, ax, ay) || !project(map, l.bx, l.by, bx, by)) { r.push_back(1); continue; }
      const double len = std::hypot(bx - ax, by - ay);
      r.push_back(len > 0 ? (l.vertical ? (bx - ax) : (by - ay)) / len : 1);
    }
    // Weak priors hold under-constrained parameters at the camera's own pose.
    for (int i = 0; i < 3; ++i) r.push_back(.01 * q[i]);
    r.push_back(.05 * (q[3] - log_f0));
    return r;
  };
  double mu = 1e-3;
  auto current = residuals(p);
  const auto cost = [](const std::vector<double>& r) { double s = 0; for (double v : r) s += v * v; return s; };
  for (int iteration = 0; iteration < 60; ++iteration) {
    const std::size_t m = current.size();
    std::vector<std::array<double, 4>> jacobian(m);
    for (int j = 0; j < 4; ++j) {
      if (!free[j]) { for (auto& row : jacobian) row[j] = 0; continue; }
      auto plus = p, minus = p;
      plus[j] += 1e-6; minus[j] -= 1e-6;
      const auto rp = residuals(plus), rm = residuals(minus);
      for (std::size_t i = 0; i < m; ++i) jacobian[i][j] = (rp[i] - rm[i]) / 2e-6;
    }
    std::array<std::array<double, 5>, 4> system{};
    for (int a = 0; a < 4; ++a) {
      for (int b = 0; b < 4; ++b) {
        double s = 0;
        for (std::size_t i = 0; i < m; ++i) s += jacobian[i][a] * jacobian[i][b];
        system[a][b] = s;
      }
      double g = 0;
      for (std::size_t i = 0; i < m; ++i) g += jacobian[i][a] * current[i];
      system[a][4] = -g;
      system[a][a] = free[a] ? system[a][a] * (1 + mu) + 1e-12 : 1;
      if (!free[a]) { for (int b = 0; b < 4; ++b) if (b != a) system[a][b] = 0; system[a][4] = 0; }
    }
    for (int a = 0; a < 4; ++a) if (!free[a]) for (int b = 0; b < 4; ++b) if (b != a) system[b][a] = 0;
    // Gaussian elimination with partial pivoting on the 4x4 normal equations.
    for (int c = 0; c < 4; ++c) {
      int pivot = c;
      for (int r = c + 1; r < 4; ++r) if (std::abs(system[r][c]) > std::abs(system[pivot][c])) pivot = r;
      std::swap(system[c], system[pivot]);
      if (std::abs(system[c][c]) < 1e-18) continue;
      for (int r = 0; r < 4; ++r) {
        if (r == c) continue;
        const double k = system[r][c] / system[c][c];
        for (int k2 = c; k2 < 5; ++k2) system[r][k2] -= k * system[c][k2];
      }
    }
    std::array<double, 4> next = p;
    bool moved = false;
    for (int a = 0; a < 4; ++a) {
      if (!free[a] || std::abs(system[a][a]) < 1e-18) continue;
      const double step = system[a][4] / system[a][a];
      next[a] += step;
      moved = moved || std::abs(step) > 1e-10;
    }
    const auto trial = residuals(next);
    if (cost(trial) < cost(current)) {
      p = next; current = trial; mu = std::max(1e-9, mu * .3);
      if (!moved) break;
    } else {
      mu *= 10;
      if (mu > 1e6) break;
    }
  }
  double worst = 0;
  for (std::size_t i = 0; i < lines.size(); ++i) worst = std::max(worst, std::asin(std::min(1.0, std::abs(current[i]))));
  const double limit = 45 * degree;
  if (std::abs(p[0]) > limit || std::abs(p[1]) > limit || std::abs(p[2]) > limit || !std::isfinite(p[3])) return solution;
  solution.applied = UprightMode::guided;
  solution.roll = p[0] / degree; solution.pitch = p[1] / degree; solution.yaw = p[2] / degree;
  solution.focal = std::clamp(std::exp(p[3]), .2, 10.0);
  // Four guides that cannot all be satisfied (a curved line, a mistaken guide)
  // leave a residual; confidence says so instead of hiding it.
  solution.confidence = saturate(1 - worst / (2 * degree));
  solution.vertical_segments = std::uint32_t(verticals);
  solution.horizontal_segments = std::uint32_t(horizontals);
  solution.segments = std::uint32_t(lines.size());
  return solution;
}

UprightSolution solve_upright(const Image& image, const UprightRequest& request, const std::uint8_t* exif,
                              std::size_t exif_size) {
  if (!image.width || !image.height || image.rgba.size() != std::size_t(image.width) * image.height * 4)
    throw std::invalid_argument("No Upright image is loaded.");
  if (request.guides.size() > 4) throw std::invalid_argument("Upright accepts at most four guides.");
  if (!std::isfinite(request.k1) || std::abs(request.k1) > .5 || !std::isfinite(request.focal) ||
      (request.focal != 0 && (request.focal < .2 || request.focal > 10)))
    throw std::invalid_argument("Upright camera values are outside their limits.");
  // Focal length: the caller's, then EXIF, then a 35mm-equivalent default.
  double focal = focal_default();
  UprightFocalSource focal_source = UprightFocalSource::fallback;
  const double aspect_long = std::max(image.width, image.height) / std::hypot(image.width, image.height);
  if (request.focal > 0) { focal = request.focal; focal_source = UprightFocalSource::exif_35mm; }
  else if (exif && exif_size) {
    const auto facts = read_exif(exif, exif_size);
    if (facts.focal_length_35mm >= 4 && facts.focal_length_35mm <= 2000) {
      focal = upright_focal_from_35mm(facts.focal_length_35mm);
      focal_source = UprightFocalSource::exif_35mm;
    } else if (facts.focal_length_mm > 0 && facts.sensor_long_edge_mm > 0) {
      const double candidate = facts.focal_length_mm / facts.sensor_long_edge_mm * aspect_long;
      if (candidate >= .2 && candidate <= 10) { focal = candidate; focal_source = UprightFocalSource::exif_sensor; }
    }
  }
  if (request.mode == UprightMode::guided) {
    auto solution = solve_upright_guides(request.guides, image.width, image.height, focal);
    solution.focal_source = focal_source == UprightFocalSource::fallback ? UprightFocalSource::guided : focal_source;
    return solution;
  }
  UprightSolution solution;
  solution.requested = request.mode;
  solution.focal = focal;
  solution.focal_source = focal_source;
  if (request.mode == UprightMode::off) return solution;

  double scale = 0;
  const auto segments = detect_upright_segments(image, request.analysis_edge, scale, request.k1);
  const double w = image.width * scale, h = image.height * scale, diagonal = std::hypot(w, h);
  solution.segments = std::uint32_t(segments.size());
  double f = focal * diagonal;
  auto lines = make_lines(segments, w * .5, h * .5, f);

  Evidence e;
  const auto find_vertical = [&]() {
    std::vector<std::size_t> candidates;
    for (std::size_t i = 0; i < lines.size(); ++i)
      if (axial_difference(lines[i].angle, pi / 2) < 40 * degree) candidates.push_back(i);
    const auto accept = [](V3& d) {
      if (d.y < 0) d = scaled(d, -1);
      double roll, pitch;
      vertical_angles(d, roll, pitch);
      return std::abs(roll) <= 35 * degree && std::abs(pitch) <= 60 * degree;
    };
    return ransac_family(lines, candidates, f, accept, diagonal, true, w);
  };
  const auto find_horizontal = [&](const Family& vertical) {
    Family best;
    if (!vertical.found) return best;
    std::vector<bool> taken(lines.size(), false);
    for (auto i : vertical.inliers) taken[i] = true;
    double roll, pitch;
    vertical_angles(vertical.direction, roll, pitch);
    // Up to two horizontal families (two walls of a corner); keep the one whose
    // yaw is smaller, which is the wall the camera faces.
    for (int pass = 0; pass < 2; ++pass) {
      std::vector<std::size_t> candidates;
      for (std::size_t i = 0; i < lines.size(); ++i) {
        if (taken[i]) continue;
        const double a = lines[i].angle;
        if (std::min(a, pi - a) < 50 * degree) candidates.push_back(i);
      }
      const V3 up = vertical.direction;
      const auto accept = [&](V3& d) {
        if (std::abs(dot(d, up)) > std::sin(25 * degree)) return false;
        V3 canonical;
        const double yaw = yaw_of(d, roll, pitch, &canonical);
        d = canonical;
        return std::abs(yaw) <= 45 * degree;
      };
      auto family = ransac_family(lines, candidates, f, accept, diagonal, false, h);
      if (!family.found || family.inliers.size() < 3) break;
      for (auto i : family.inliers) taken[i] = true;
      if (!best.found) best = family;
      else {
        const double a = std::abs(yaw_of(best.direction, roll, pitch)), b = std::abs(yaw_of(family.direction, roll, pitch));
        // Prefer the facing wall unless the other has far more support.
        if (b + 3 * degree < a && family.score > .5 * best.score) best = family;
      }
    }
    return best;
  };
  const auto confidences = [&]() {
    if (e.vertical.found) {
      vertical_angles(e.vertical.direction, e.roll_v, e.pitch_v);
      const double n = double(e.vertical.inliers.size());
      e.confidence_v = saturate(e.vertical.evidence / .8) * saturate((n - 1) / 5) * saturate(e.vertical.spread / .12);
      e.confidence_roll_v = saturate(e.vertical.evidence / .3) * saturate((n - 1) / 2);
    }
    if (e.horizontal.found) {
      e.yaw = yaw_of(e.horizontal.direction, e.roll_v, e.pitch_v);
      const double n = double(e.horizontal.inliers.size());
      e.confidence_h = saturate(e.horizontal.evidence / .8) * saturate((n - 2) / 5) * saturate(e.horizontal.spread / .1);
    }
  };
  e.vertical = find_vertical();
  e.horizontal = find_horizontal(e.vertical);
  confidences();
  // Two finite, orthogonal vanishing points measure the focal length directly
  // (f^2 = -v1.v2 in centered pixels). Used only when EXIF said nothing.
  if (focal_source == UprightFocalSource::fallback && e.confidence_v >= .35 && e.confidence_h >= .35) {
    const V3 dv = e.vertical.direction, dh = e.horizontal.direction;
    if (std::abs(dv.z) > std::sin(5 * degree) && std::abs(dh.z) > std::sin(5 * degree)) {
      const double vx = f * dv.x / dv.z, vy = f * dv.y / dv.z, hx = f * dh.x / dh.z, hy = f * dh.y / dh.z;
      const double f2 = -(vx * hx + vy * hy);
      if (f2 > 0) {
        const double measured = std::sqrt(f2) / diagonal;
        if (measured > .4 * focal && measured < 2.5 * focal) {
          focal = measured;
          f = focal * diagonal;
          solution.focal = focal;
          solution.focal_source = UprightFocalSource::measured;
          lines = make_lines(segments, w * .5, h * .5, f);
          e = Evidence{};
          e.vertical = find_vertical();
          e.horizontal = find_horizontal(e.vertical);
          confidences();
        }
      }
    }
  }
  e.horizon = horizon_family(lines, w);
  solution.vertical_segments = e.vertical.found ? std::uint32_t(e.vertical.inliers.size()) : 0;
  solution.horizontal_segments = e.horizontal.found ? std::uint32_t(e.horizontal.inliers.size()) : 0;

  // Level: parallel horizontals when they agree with the verticals or the
  // verticals are thin; otherwise the vertical vanishing point's direction.
  double level_roll = 0, level_confidence = 0;
  {
    const bool horizon_ok = e.horizon.found && e.horizon.confidence >= .3;
    const bool vertical_ok = e.vertical.found && e.confidence_roll_v >= .3;
    if (horizon_ok && vertical_ok) {
      if (std::abs(e.horizon.roll - e.roll_v) <= 2 * degree)
        level_roll = e.horizon.confidence >= e.confidence_roll_v ? e.horizon.roll : e.roll_v;
      else
        level_roll = e.confidence_v >= .35 ? e.roll_v : e.horizon.roll;
      level_confidence = std::max(e.horizon.confidence, e.confidence_roll_v);
    } else if (horizon_ok) { level_roll = e.horizon.roll; level_confidence = e.horizon.confidence; }
    else if (vertical_ok) { level_roll = e.roll_v; level_confidence = e.confidence_roll_v; }
    if (std::abs(level_roll) > 30 * degree) level_confidence = 0;
  }
  const bool vertical_ok = e.confidence_v >= .35 && std::abs(e.pitch_v) <= 40 * degree && std::abs(e.roll_v) <= 30 * degree;
  const bool horizontal_ok = vertical_ok && e.confidence_h >= .35 && std::abs(e.yaw) <= 40 * degree;
  const auto level = [&]() {
    solution.fallback = request.mode != UprightMode::level;
    if (level_confidence <= 0) { solution.applied = UprightMode::off; solution.confidence = 0; return; }
    solution.applied = UprightMode::level;
    solution.roll = level_roll / degree;
    solution.confidence = level_confidence;
  };
  switch (request.mode) {
    case UprightMode::level: level(); break;
    case UprightMode::vertical:
    case UprightMode::full:
      if (!vertical_ok) { level(); break; }
      solution.applied = UprightMode::vertical;
      solution.roll = e.roll_v / degree;
      solution.pitch = e.pitch_v / degree;
      solution.confidence = e.confidence_v;
      if (request.mode == UprightMode::full) {
        if (horizontal_ok) {
          solution.applied = UprightMode::full;
          solution.yaw = e.yaw / degree;
          solution.confidence = std::min(e.confidence_v, e.confidence_h);
        } else solution.fallback = true;
      }
      break;
    case UprightMode::auto_: {
      if (!vertical_ok) { level(); break; }
      // Balanced: remove tilt fully, then choose how much keystone and turn to
      // undo by trading leftover perspective against frame lost to the crop.
      const bool use_yaw = horizontal_ok && e.confidence_h >= .5 && std::abs(e.yaw) <= 30 * degree;
      double best_cost = std::numeric_limits<double>::max();
      double best_p = 1, best_y = 0;
      for (double sp : {1.0, .85, .7, .55, .4})
        for (double sy : use_yaw ? std::initializer_list<double>{0, .5, .75, 1} : std::initializer_list<double>{0}) {
          UprightTransform t;
          t.roll = e.roll_v / degree; t.pitch = sp * e.pitch_v / degree; t.yaw = sy * e.yaw / degree;
          t.focal = focal;
          const double kept = kept_area(t, image.width, image.height);
          const double rp = (1 - sp) * std::abs(e.pitch_v / degree) / 8, ry = (1 - sy) * std::abs(e.yaw / degree) / 12;
          const double c = rp * rp + ry * ry + 4 * (1 - kept) * (1 - kept);
          if (c < best_cost) { best_cost = c; best_p = sp; best_y = sy; }
        }
      solution.applied = UprightMode::auto_;
      solution.roll = e.roll_v / degree;
      solution.pitch = best_p * e.pitch_v / degree;
      solution.yaw = best_y * e.yaw / degree;
      solution.confidence = best_y > 0 ? std::min(e.confidence_v, e.confidence_h) : e.confidence_v;
      break;
    }
    default: break;
  }
  // -0 folds into 0 so an unchanged solve compares equal.
  solution.roll += 0; solution.pitch += 0; solution.yaw += 0;
  return solution;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
bool upright_identity(const UprightTransform& t) {
  return t.roll == 0 && t.pitch == 0 && t.yaw == 0 && t.k1 == 0 && t.vertical == 0 && t.horizontal == 0 &&
         t.rotate == 0 && t.aspect == 0 && t.scale == 100 && t.x_offset == 0 && t.y_offset == 0;
}

void validate_upright(const UprightTransform& t) {
  const auto bounded = [](double v, double lo, double hi) {
    if (!std::isfinite(v) || v < lo || v > hi) throw std::invalid_argument("Upright value outside limits.");
  };
  bounded(t.roll, -45, 45); bounded(t.pitch, -45, 45); bounded(t.yaw, -45, 45);
  if (t.focal != 0) bounded(t.focal, .2, 10);
  bounded(t.k1, -.5, .5);
  bounded(t.vertical, -100, 100); bounded(t.horizontal, -100, 100);
  bounded(t.rotate, -10, 10); bounded(t.aspect, -100, 100); bounded(t.scale, 50, 150);
  bounded(t.x_offset, -100, 100); bounded(t.y_offset, -100, 100);
}

UprightRect inscribed_rect(const std::array<double, 8>& quad, double aspect, std::uint32_t width,
                           std::uint32_t height) {
  if (!width || !height || !(aspect > 0)) throw std::invalid_argument("Invalid crop frame.");
  // Half-planes n.p >= c with inward normals, whatever the winding.
  double area2 = 0;
  for (int i = 0; i < 4; ++i) {
    const int j = (i + 1) % 4;
    area2 += quad[i * 2] * quad[j * 2 + 1] - quad[j * 2] * quad[i * 2 + 1];
  }
  const double orientation = area2 >= 0 ? 1 : -1;
  struct Plane { double nx, ny, c; };
  std::array<Plane, 4> planes{};
  for (int i = 0; i < 4; ++i) {
    const int j = (i + 1) % 4;
    const double ex = quad[j * 2] - quad[i * 2], ey = quad[j * 2 + 1] - quad[i * 2 + 1];
    const double len = std::hypot(ex, ey);
    if (len <= 0) return {0, 0, 0, 0};
    // For counter-clockwise winding (in y-down pixels, positive area2) the inside is left.
    const double nx = -ey / len * orientation, ny = ex / len * orientation;
    planes[i] = {nx, ny, nx * quad[i * 2] + ny * quad[i * 2 + 1]};
  }
  // Feasible centers for half extents (hx, hy): clip a large box by each
  // shrunken half-plane. Non-empty means a rectangle that size fits.
  const auto centers = [&](double hx, double hy) {
    const double big = 4.0 * (width + height);
    std::vector<std::pair<double, double>> poly{{-big, -big}, {big, -big}, {big, big}, {-big, big}};
    for (const auto& p : planes) {
      const double c = p.c + std::abs(p.nx) * hx + std::abs(p.ny) * hy;
      std::vector<std::pair<double, double>> next;
      for (std::size_t i = 0; i < poly.size(); ++i) {
        const auto a = poly[i], b = poly[(i + 1) % poly.size()];
        const double da = p.nx * a.first + p.ny * a.second - c, db = p.nx * b.first + p.ny * b.second - c;
        if (da >= 0) next.push_back(a);
        if ((da >= 0) != (db >= 0)) {
          const double t = da / (da - db);
          next.push_back({a.first + t * (b.first - a.first), a.second + t * (b.second - a.second)});
        }
      }
      poly.swap(next);
      if (poly.empty()) break;
    }
    return poly;
  };
  // Extents in frame units: the full frame is (width, height) at s = 1.
  const double base_w = std::min(double(width), double(height) * aspect);
  const double base_h = base_w / aspect;
  double lo = 0, hi = 1;
  if (!centers(base_w * .5, base_h * .5).empty()) lo = 1;
  else
    for (int i = 0; i < 48; ++i) {
      const double mid = (lo + hi) * .5;
      (centers(base_w * .5 * mid, base_h * .5 * mid).empty() ? hi : lo) = mid;
    }
  if (lo <= 0) return {0, 0, 0, 0};
  const auto poly = centers(base_w * .5 * lo, base_h * .5 * lo);
  double cx = width * .5, cy = height * .5;
  if (!poly.empty()) {
    // At the largest size the feasible set is a point or a thin sliver; take
    // the middle of what remains, preferring the frame center when it fits.
    double sx = 0, sy = 0;
    for (const auto& p : poly) { sx += p.first; sy += p.second; }
    cx = sx / double(poly.size()); cy = sy / double(poly.size());
    bool center_fits = true;
    for (const auto& p : planes)
      if (p.nx * width * .5 + p.ny * height * .5 < p.c + std::abs(p.nx) * base_w * .5 * lo + std::abs(p.ny) * base_h * .5 * lo - 1e-9)
        center_fits = false;
    if (center_fits) { cx = width * .5; cy = height * .5; }
  }
  const double rw = base_w * lo, rh = base_h * lo;
  return {(cx - rw * .5) / width, (cy - rh * .5) / height, rw / width, rh / height};
}

Homography upright_homography(const UprightTransform& t, std::uint32_t width, std::uint32_t height) {
  validate_upright(t);
  if (!width || !height) throw std::invalid_argument("Invalid Upright frame.");
  const double w = width, h = height, diagonal = std::hypot(w, h);
  const double f = (t.focal > 0 ? t.focal : focal_default()) * diagonal;
  const M3 k{f, 0, 0, 0, f, 0, 0, 0, 1}, kinv{1 / f, 0, 0, 0, 1 / f, 0, 0, 0, 1};
  const M3 camera = camera_rotation(t.roll * degree, t.pitch * degree, t.yaw * degree);
  // Manual keystones are further camera turns; Vertical -100 opens the top as
  // a camera tilted 30 degrees further up would need.
  const M3 manual = multiply(rotation_z(t.rotate * degree),
                             multiply(rotation_x(t.vertical / 100 * 30 * degree), rotation_y(-t.horizontal / 100 * 30 * degree)));
  M3 forward = multiply(k, multiply(manual, multiply(transpose(camera), kinv)));
  // Keep the corrected frame where it was and the size it was: recenter the
  // warped corners and match their area to the original.
  if (!(t.roll == 0 && t.pitch == 0 && t.yaw == 0 && t.vertical == 0 && t.horizontal == 0 && t.rotate == 0)) {
    std::array<double, 8> q{};
    const double corners[4][2] = {{-w / 2, -h / 2}, {w / 2, -h / 2}, {w / 2, h / 2}, {-w / 2, h / 2}};
    for (int i = 0; i < 4; ++i)
      if (!project(forward, corners[i][0], corners[i][1], q[i * 2], q[i * 2 + 1]))
        throw std::invalid_argument("This correction turns the photo past its horizon.");
    double area2 = 0, mx = 0, my = 0;
    for (int i = 0; i < 4; ++i) {
      const int j = (i + 1) % 4;
      area2 += q[i * 2] * q[j * 2 + 1] - q[j * 2] * q[i * 2 + 1];
      mx += q[i * 2] * .25; my += q[i * 2 + 1] * .25;
    }
    const double ratio = std::abs(area2) * .5 / (w * h);
    if (!(ratio > 1e-3) || !std::isfinite(ratio)) throw std::invalid_argument("This correction collapses the photo.");
    const double s = 1 / std::sqrt(ratio);
    forward = multiply(multiply(scaling(s, s), translation(-mx, -my)), forward);
  }
  const double stretch = std::pow(1.5, t.aspect / 100);
  forward = multiply(scaling(std::sqrt(stretch) * t.scale / 100, t.scale / 100 / std::sqrt(stretch)), forward);
  forward = multiply(translation(t.x_offset / 100 * w * .5, t.y_offset / 100 * h * .5), forward);
  if (t.constrain_crop) {
    std::array<double, 8> q{};
    const double corners[4][2] = {{-w / 2, -h / 2}, {w / 2, -h / 2}, {w / 2, h / 2}, {-w / 2, h / 2}};
    bool ok = true;
    for (int i = 0; i < 4; ++i) {
      ok = ok && project(forward, corners[i][0], corners[i][1], q[i * 2], q[i * 2 + 1]);
      q[i * 2] += w / 2; q[i * 2 + 1] += h / 2;
    }
    if (ok) {
      const auto r = inscribed_rect(q, w / h, width, height);
      if (r.width > 1e-3 && r.width < 1 - 1e-9) {
        // Zoom so the inscribed rectangle fills the frame.
        const double cx = (r.x + r.width * .5 - .5) * w, cy = (r.y + r.height * .5 - .5) * h;
        const double s = 1 / r.width;
        forward = multiply(multiply(scaling(s, s), translation(-cx, -cy)), forward);
      }
    }
  }
  // Output pixel -> centered output -> centered source -> source pixel.
  M3 result = multiply(translation(w / 2, h / 2), multiply(inverse(forward), translation(-w / 2, -h / 2)));
  const double n = result[8];
  if (std::abs(n) > 1e-300) for (auto& v : result) v /= n;
  return result;
}

Image apply_upright(const Image& source, const UprightTransform& t) {
  if (!source.width || !source.height || source.rgba.size() != std::size_t(source.width) * source.height * 4)
    throw std::invalid_argument("Invalid Upright image.");
  const auto H = upright_homography(t, source.width, source.height);
  Image out{source.width, source.height, source.source_width, source.source_height, {}};
  out.rgba.resize(source.rgba.size());
  const int w = int(source.width), h = int(source.height);
  const double cx = w * .5, cy = h * .5, r2 = cx * cx + cy * cy;
  // Catmull-Rom (Keys, a = -0.5): interpolating, so integer positions copy exactly.
  const auto weights = [](double t, std::array<double, 4>& k) {
    const double t2 = t * t, t3 = t2 * t;
    k[0] = -.5 * t3 + t2 - .5 * t;
    k[1] = 1.5 * t3 - 2.5 * t2 + 1;
    k[2] = -1.5 * t3 + 2 * t2 + .5 * t;
    k[3] = .5 * t3 - .5 * t2;
  };
  const auto* src = source.rgba.data();
  for (int y = 0; y < h; ++y) {
    const double py = y + .5;
    for (int x = 0; x < w; ++x) {
      const double px = x + .5;
      const double zw = H[6] * px + H[7] * py + H[8];
      auto* o = &out.rgba[(std::size_t(y) * w + x) * 4];
      o[3] = 255;
      if (!(zw > 1e-12)) { o[0] = o[1] = o[2] = 255; continue; }
      double u = (H[0] * px + H[1] * py + H[2]) / zw, v = (H[3] * px + H[4] * py + H[5]) / zw;
      if (t.k1 != 0) {
        // The homography lands in undistorted coordinates; the source pixels
        // are distorted. Invert u_d * (1 + k1 r_d^2) = u by fixed point.
        const double ux = u - cx, uy = v - cy;
        double dx = ux, dy = uy;
        for (int i = 0; i < 6; ++i) {
          const double g = 1 + t.k1 * (dx * dx + dy * dy) / r2;
          dx = ux / g; dy = uy / g;
        }
        u = cx + dx; v = cy + dy;
      }
      // Coverage: one pixel of anti-aliased edge where the source ends.
      const double inside = std::min({u, w - u, v, h - v});
      if (!(inside > -.5)) { o[0] = o[1] = o[2] = 255; continue; }
      const double coverage = std::clamp(inside + .5, 0.0, 1.0);
      const double sx = u - .5, sy = v - .5;
      const double fx = std::floor(sx), fy = std::floor(sy);
      std::array<double, 4> kx{}, ky{};
      weights(sx - fx, kx);
      weights(sy - fy, ky);
      const int ix = int(fx), iy = int(fy);
      double sum[3] = {0, 0, 0};
      for (int j = 0; j < 4; ++j) {
        const int yy = std::clamp(iy - 1 + j, 0, h - 1);
        const auto* row = src + std::size_t(yy) * w * 4;
        double line[3] = {0, 0, 0};
        for (int i = 0; i < 4; ++i) {
          const auto* p = row + std::size_t(std::clamp(ix - 1 + i, 0, w - 1)) * 4;
          line[0] += kx[i] * p[0]; line[1] += kx[i] * p[1]; line[2] += kx[i] * p[2];
        }
        for (int c = 0; c < 3; ++c) sum[c] += ky[j] * line[c];
      }
      for (int c = 0; c < 3; ++c) {
        const double value = sum[c] * coverage + 255 * (1 - coverage);
        o[c] = std::uint8_t(std::lround(std::clamp(value, 0.0, 255.0)));
      }
    }
  }
  return out;
}

UprightTransform read_upright_values(const double* values, std::size_t count) {
  if (!values || count != 13) throw std::invalid_argument("Invalid Upright values.");
  UprightTransform t;
  t.roll = values[0]; t.pitch = values[1]; t.yaw = values[2]; t.focal = values[3]; t.k1 = values[4];
  t.vertical = values[5]; t.horizontal = values[6]; t.rotate = values[7]; t.aspect = values[8];
  t.scale = values[9]; t.x_offset = values[10]; t.y_offset = values[11];
  if (values[12] != 0 && values[12] != 1) throw std::invalid_argument("Invalid Upright values.");
  t.constrain_crop = values[12] == 1;
  validate_upright(t);
  return t;
}
} // namespace lenslabs
