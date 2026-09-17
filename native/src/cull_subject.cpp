#include "lenslabs/cull_subject.hpp"
#include "cull_dsp.hpp"
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <vector>

namespace lenslabs {
namespace {
using dsp::clamp01;
using dsp::Plane;

constexpr unsigned saliency_side = 64;

// Pixel rectangle for a normalized box, grown to at least `minimum` pixels on
// each side so a small eye still has enough detail to measure.
struct Rect {
  unsigned x0, y0, x1, y1;
};
Rect to_pixels(const CullBox& box, unsigned w, unsigned h, unsigned minimum) {
  double cx = (box.x + box.width / 2) * w, cy = (box.y + box.height / 2) * h;
  double bw = std::max(box.width * w, double(minimum)), bh = std::max(box.height * h, double(minimum));
  bw = std::min(bw, double(w));
  bh = std::min(bh, double(h));
  cx = std::clamp(cx, bw / 2, w - bw / 2);
  cy = std::clamp(cy, bh / 2, h - bh / 2);
  return {unsigned(std::max(0.0, cx - bw / 2)), unsigned(std::max(0.0, cy - bh / 2)),
          unsigned(std::min(double(w), cx + bw / 2)), unsigned(std::min(double(h), cy + bh / 2))};
}

bool usable(const CullBox& box) {
  return std::isfinite(box.x) && std::isfinite(box.y) && std::isfinite(box.width) &&
         std::isfinite(box.height) && box.width > 0 && box.height > 0 && box.x < 1 && box.y < 1 &&
         box.x + box.width > 0 && box.y + box.height > 0 && box.confidence >= .3;
}

CullBox clip(CullBox box) {
  const double x1 = std::min(1.0, box.x + box.width), y1 = std::min(1.0, box.y + box.height);
  box.x = std::max(0.0, box.x);
  box.y = std::max(0.0, box.y);
  box.width = std::max(0.0, x1 - box.x);
  box.height = std::max(0.0, y1 - box.y);
  return box;
}

CullBox saliency_box(const Plane& plane, double& strength) {
  strength = 0;
  const std::size_t n = saliency_side;
  const auto small = dsp::resample_box(plane, 0, 0, plane.width, plane.height, unsigned(n), unsigned(n));
  double mean = 0, sq = 0;
  for (auto v : small.values) {
    mean += v;
    sq += double(v) * v;
  }
  mean /= double(n * n);
  if (sq / double(n * n) - mean * mean < 4) return {.25, .25, .5, .5, 0};

  std::vector<std::complex<double>> field(n * n);
  for (std::size_t i = 0; i < n * n; ++i) field[i] = small.values[i] - mean;
  dsp::fft2(field, n, false);
  std::vector<double> amplitude(n * n), phase(n * n);
  for (std::size_t i = 0; i < n * n; ++i) {
    amplitude[i] = std::log(std::abs(field[i]) + 1e-9);
    phase[i] = std::arg(field[i]);
  }
  // Spectral residual: log amplitude minus its local average. What a frame's
  // spectrum holds beyond the expected 1/f shape is what stands out in it.
  std::vector<std::complex<double>> residual(n * n);
  for (std::size_t v = 0; v < n; ++v)
    for (std::size_t u = 0; u < n; ++u) {
      double local = 0;
      for (int dv = -1; dv <= 1; ++dv)
        for (int du = -1; du <= 1; ++du)
          local += amplitude[((v + n + std::size_t(dv)) % n) * n + (u + n + std::size_t(du)) % n];
      const double r = amplitude[v * n + u] - local / 9;
      residual[v * n + u] = std::polar(std::exp(r), phase[v * n + u]);
    }
  dsp::fft2(residual, n, true);
  std::vector<double> map(n * n);
  for (std::size_t i = 0; i < n * n; ++i) map[i] = std::norm(residual[i]);
  // Smooth (two box passes ~ gaussian) and fade the border, where the
  // transform's wrap-around invents contrast.
  for (int pass = 0; pass < 3; ++pass) {
    auto copy = map;
    for (std::size_t y = 0; y < n; ++y)
      for (std::size_t x = 0; x < n; ++x) {
        double sum = 0;
        int count = 0;
        for (int dy = -2; dy <= 2; ++dy)
          for (int dx = -2; dx <= 2; ++dx) {
            const int sx = int(x) + dx, sy = int(y) + dy;
            if (sx < 0 || sy < 0 || sx >= int(n) || sy >= int(n)) continue;
            sum += copy[std::size_t(sy) * n + std::size_t(sx)];
            ++count;
          }
        map[y * n + x] = sum / count;
      }
  }
  double total = 0;
  for (std::size_t y = 0; y < n; ++y)
    for (std::size_t x = 0; x < n; ++x) {
      const double edge = double(std::min({x, y, n - 1 - x, n - 1 - y}));
      map[y * n + x] *= clamp01((edge + .5) / 5);
      total += map[y * n + x];
    }
  if (total <= 0) return {.25, .25, .5, .5, 0};
  const double average = total / double(n * n);

  // The connected region above three times the mean holding the most saliency.
  std::vector<int> label(n * n, -1);
  double best_mass = 0;
  std::size_t best_x0 = 0, best_y0 = 0, best_x1 = n, best_y1 = n;
  std::vector<std::size_t> stack;
  for (std::size_t start = 0; start < n * n; ++start) {
    if (label[start] >= 0 || map[start] < 3 * average) continue;
    label[start] = int(start);
    stack.assign(1, start);
    double mass = 0;
    std::size_t x0 = n, y0 = n, x1 = 0, y1 = 0;
    while (!stack.empty()) {
      const auto at = stack.back();
      stack.pop_back();
      const auto x = at % n, y = at / n;
      mass += map[at];
      x0 = std::min(x0, x);
      y0 = std::min(y0, y);
      x1 = std::max(x1, x + 1);
      y1 = std::max(y1, y + 1);
      const auto push = [&](std::size_t next) {
        if (label[next] < 0 && map[next] >= 3 * average) {
          label[next] = int(start);
          stack.push_back(next);
        }
      };
      if (x > 0) push(at - 1);
      if (x + 1 < n) push(at + 1);
      if (y > 0) push(at - n);
      if (y + 1 < n) push(at + n);
    }
    if (mass > best_mass) {
      best_mass = mass;
      best_x0 = x0;
      best_y0 = y0;
      best_x1 = x1;
      best_y1 = y1;
    }
  }
  if (best_mass <= 0) return {.25, .25, .5, .5, 0};
  const double area = double((best_x1 - best_x0) * (best_y1 - best_y0));
  const double inside = best_mass / std::max(1.0, area);
  // How much denser the region is than the frame: a real subject concentrates
  // saliency; texture everywhere spreads it thin.
  strength = clamp01((inside / average - 2) / 6) * clamp01(best_mass / total * 4);
  const double pad = 1;
  CullBox box{(double(best_x0) - pad) / n, (double(best_y0) - pad) / n,
              (double(best_x1 - best_x0) + 2 * pad) / n, (double(best_y1 - best_y0) + 2 * pad) / n,
              strength};
  return clip(box);
}

const char* evidence_for(CullSubjectLevel level) {
  switch (level) {
    case CullSubjectLevel::eyes: return "Focus judged on the eyes";
    case CullSubjectLevel::face: return "Focus judged on the face";
    case CullSubjectLevel::body: return "Focus judged on the person";
    case CullSubjectLevel::object: return "Focus judged on the subject";
    case CullSubjectLevel::salient: return "Focus judged on the most distinct region";
    case CullSubjectLevel::frame: return "Focus judged on the sharpest detail";
    case CullSubjectLevel::none: return "No detail to judge focus on";
  }
  return "";
}

double area(const CullBox& box) { return std::max(0.0, box.width) * std::max(0.0, box.height); }
} // namespace

const char* cull_subject_level_name(CullSubjectLevel level) noexcept {
  switch (level) {
    case CullSubjectLevel::eyes: return "eyes";
    case CullSubjectLevel::face: return "face";
    case CullSubjectLevel::body: return "body";
    case CullSubjectLevel::object: return "object";
    case CullSubjectLevel::salient: return "salient";
    case CullSubjectLevel::frame: return "frame";
    case CullSubjectLevel::none: return "none";
  }
  return "none";
}

CullBox salient_region(const Image& image, double* strength) {
  if (image.width < 32 || image.height < 32 || image.width > 4096 || image.height > 4096 ||
      image.rgba.size() != std::size_t(image.width) * image.height * 4)
    throw std::invalid_argument("Saliency needs a decoded working image between 32 and 4096 pixels.");
  const auto plane = dsp::luma_plane(image);
  double s = 0;
  const auto box = saliency_box(plane, s);
  if (strength) *strength = s;
  return box;
}

CullSubjectFocus measure_subject_focus(const Image& image, const CullDetections& detections) {
  if (image.width < 32 || image.height < 32 || image.width > 4096 || image.height > 4096 ||
      image.rgba.size() != std::size_t(image.width) * image.height * 4)
    throw std::invalid_argument("Subject focus needs a decoded working image between 32 and 4096 pixels.");
  const auto plane = dsp::luma_plane(image);
  const unsigned w = plane.width, h = plane.height;
  const double noise = dsp::immerkaer_noise(plane, 0, 0, w, h);
  const unsigned minimum = std::max(24u, std::min(w, h) / 12);

  CullSubjectFocus out;
  const auto judge = [&](const CullBox& box, double share) {
    const auto rect = to_pixels(clip(box), w, h, minimum);
    return dsp::region_focus(plane, rect.x0, rect.y0, rect.x1, rect.y1, noise, share);
  };
  const auto settle = [&](CullSubjectLevel level, const CullBox& box, const dsp::RegionFocus& focus,
                          double trust) {
    out.level = level;
    out.region = clip(box);
    out.focus = focus.acuity;
    out.focus_confidence = clamp01(focus.textured / .5) * clamp01(trust);
    out.subject_size = area(out.region);
  };

  // Rung 1 and 2: faces, and their eyes. The largest confident face leads.
  const CullFaceDetection* face = nullptr;
  for (const auto& candidate : detections.faces)
    if (usable(candidate.face) &&
        (!face || area(candidate.face) * candidate.face.confidence > area(face->face) * face->face.confidence))
      face = &candidate;
  if (face) {
    out.eyes_open = face->eyes_open;
    CullBox eyes{};
    bool have_eyes = false;
    for (const auto& eye : face->eyes) {
      if (!usable(eye)) continue;
      if (!have_eyes) {
        eyes = eye;
        have_eyes = true;
        continue;
      }
      const double x0 = std::min(eyes.x, eye.x), y0 = std::min(eyes.y, eye.y);
      const double x1 = std::max(eyes.x + eyes.width, eye.x + eye.width);
      const double y1 = std::max(eyes.y + eyes.height, eye.y + eye.height);
      eyes = {x0, y0, x1 - x0, y1 - y0, std::min(eyes.confidence, eye.confidence)};
    }
    if (have_eyes) {
      const auto focus = judge(eyes, .5);
      if (focus.textured > 0) {
        out.eye_focus = focus.acuity;
        settle(CullSubjectLevel::eyes, eyes, focus, face->face.confidence);
        out.evidence = evidence_for(out.level);
        return out;
      }
    }
    const auto focus = judge(face->face, .35);
    if (focus.textured > 0) {
      settle(CullSubjectLevel::face, face->face, focus, face->face.confidence * .95);
      out.evidence = evidence_for(out.level);
      return out;
    }
  }

  // Rung 3: a person without a usable face. The upper body carries the detail
  // a photographer checks (head, hands, jersey number).
  const CullBox* body = nullptr;
  for (const auto& candidate : detections.bodies)
    if (usable(candidate) && (!body || area(candidate) * candidate.confidence > area(*body) * body->confidence))
      body = &candidate;
  if (body) {
    CullBox upper = *body;
    upper.height *= .6;
    const auto focus = judge(upper, .35);
    if (focus.textured > 0) {
      settle(CullSubjectLevel::body, *body, focus, body->confidence * .85);
      out.evidence = evidence_for(out.level);
      return out;
    }
  }

  // Rung 4: a detected object subject.
  const CullBox* object = nullptr;
  for (const auto& candidate : detections.objects)
    if (usable(candidate) &&
        (!object || area(candidate) * candidate.confidence > area(*object) * object->confidence))
      object = &candidate;
  if (object) {
    const auto focus = judge(*object, .35);
    if (focus.textured > 0) {
      settle(CullSubjectLevel::object, *object, focus, object->confidence * .85);
      out.evidence = evidence_for(out.level);
      return out;
    }
  }

  // Rung 5: model-free saliency.
  double strength = 0;
  const auto salient = saliency_box(plane, strength);
  out.saliency = strength;
  if (strength >= .15) {
    const auto focus = judge(salient, .35);
    if (focus.textured > 0) {
      settle(CullSubjectLevel::salient, salient, focus, .5 + .3 * strength);
      out.saliency = strength;
      out.evidence = evidence_for(out.level);
      return out;
    }
  }

  // Rung 6: nothing stands out; the frame's sharpest detail.
  const auto whole = dsp::region_focus(plane, 0, 0, w, h, noise, .1);
  if (whole.textured > 0) {
    settle(CullSubjectLevel::frame, {0, 0, 1, 1, 1}, whole, .45);
    out.saliency = strength;
    out.evidence = evidence_for(out.level);
    return out;
  }
  out.level = CullSubjectLevel::none;
  out.region = {0, 0, 1, 1, 0};
  out.evidence = evidence_for(out.level);
  return out;
}

} // namespace lenslabs
