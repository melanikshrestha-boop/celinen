// Focus-hit judgment on synthetic frames with known answers: a sharp patch at
// the AF area, a sharp patch somewhere else, nothing sharp anywhere, and inputs
// that must be refused without a crash.
#include "lenslabs/cull.hpp"
#include "lenslabs/focus_hit.hpp"
#include <algorithm>
#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>

namespace {
int checks = 0;
void check(bool passed, const std::string& label) {
  ++checks;
  if (!passed) throw std::runtime_error(label);
}

lenslabs::Image blank(unsigned w, unsigned h, std::uint8_t value = 128) {
  lenslabs::Image image{w, h, w, h, {}};
  image.rgba.assign(std::size_t(w) * h * 4, value);
  for (std::size_t i = 3; i < image.rgba.size(); i += 4) image.rgba[i] = 255;
  return image;
}
void put(lenslabs::Image& image, unsigned x, unsigned y, double value) {
  const auto i = (std::size_t(y) * image.width + x) * 4;
  const auto code = std::uint8_t(std::clamp(value, 0.0, 255.0));
  image.rgba[i] = image.rgba[i + 1] = image.rgba[i + 2] = code;
}
double get(const lenslabs::Image& image, unsigned x, unsigned y) {
  return image.rgba[(std::size_t(y) * image.width + x) * 4];
}

// The cull tests' photo-like detail: smooth value noise at three octaves.
lenslabs::Image detailed(unsigned w, unsigned h, std::uint32_t seed = 12345) {
  auto image = blank(w, h);
  const auto corner = [&](int x, int y, std::uint32_t salt) {
    std::uint32_t v = std::uint32_t(x) * 374761393u + std::uint32_t(y) * 668265263u + seed + salt;
    v = (v ^ (v >> 13)) * 1274126177u;
    return double((v ^ (v >> 16)) & 0xffff) / 65535.0 - .5;
  };
  const auto octave = [&](double x, double y, double cell, std::uint32_t salt) {
    const double fx = x / cell, fy = y / cell;
    const int x0 = int(std::floor(fx)), y0 = int(std::floor(fy));
    const double tx = fx - x0, ty = fy - y0;
    const double sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const double top = corner(x0, y0, salt) * (1 - sx) + corner(x0 + 1, y0, salt) * sx;
    const double bottom = corner(x0, y0 + 1, salt) * (1 - sx) + corner(x0 + 1, y0 + 1, salt) * sx;
    return top * (1 - sy) + bottom * sy;
  };
  for (unsigned y = 0; y < h; ++y)
    for (unsigned x = 0; x < w; ++x)
      put(image, x, y, 128 + 60 * (octave(x, y, 2.2, 0) * .5 + octave(x, y, 7, 1) * .3 + octave(x, y, 23, 2) * .2));
  return image;
}

// Separable box blur, repeated: optical defocus.
lenslabs::Image blurred(const lenslabs::Image& source, int radius, int passes = 3) {
  auto image = source;
  for (int pass = 0; pass < passes; ++pass) {
    auto copy = image;
    for (unsigned y = 0; y < image.height; ++y)
      for (unsigned x = 0; x < image.width; ++x) {
        double sum = 0;
        int count = 0;
        for (int d = -radius; d <= radius; ++d) {
          sum += get(copy, unsigned(std::clamp(int(x) + d, 0, int(image.width) - 1)), y);
          ++count;
        }
        put(image, x, y, sum / count);
      }
    copy = image;
    for (unsigned y = 0; y < image.height; ++y)
      for (unsigned x = 0; x < image.width; ++x) {
        double sum = 0;
        int count = 0;
        for (int d = -radius; d <= radius; ++d) {
          sum += get(copy, x, unsigned(std::clamp(int(y) + d, 0, int(image.height) - 1)));
          ++count;
        }
        put(image, x, y, sum / count);
      }
  }
  return image;
}

// A sharp rectangle of `sharp` pasted over `soft`, in normalized coordinates.
lenslabs::Image with_patch(const lenslabs::Image& soft, const lenslabs::Image& sharp, double x0,
                           double y0, double x1, double y1) {
  auto image = soft;
  for (auto y = unsigned(y0 * soft.height); y < unsigned(y1 * soft.height); ++y)
    for (auto x = unsigned(x0 * soft.width); x < unsigned(x1 * soft.width); ++x)
      put(image, x, y, get(sharp, x, y));
  return image;
}

bool inside(const lenslabs::FocusRegion& region, double x, double y) {
  return x >= region.x && x <= region.x + region.width && y >= region.y && y <= region.y + region.height;
}
} // namespace

int main() {
  try {
    using lenslabs::FocusHitVerdict;
    // The working frame the ingest engine measures: 640 on the long edge.
    const auto sharp = detailed(640, 427);
    const auto soft = blurred(sharp, 3);
    // A player-sized sharp subject in the upper left, soft everywhere else.
    const auto frame = with_patch(soft, sharp, .15, .15, .40, .50);

    {
      const auto hit = lenslabs::judge_focus_hit(frame, {.22, .25, .06, .09});
      check(hit.verdict == FocusHitVerdict::on_subject, "An AF point on the sharp subject is a hit.");
      check(hit.hit >= .8, "A clean hit carries high confidence.");
      check(hit.af_acuity > .6 && hit.best_acuity > .6, "Both acuities read the subject as sharp.");
      check(inside({.13, .13, .29, .39}, hit.best_region.x + hit.best_region.width / 2,
                   hit.best_region.y + hit.best_region.height / 2),
            "The sharpest region is found on the subject.");
    }
    {
      const auto miss = lenslabs::judge_focus_hit(frame, {.70, .60, .06, .09});
      check(miss.verdict == FocusHitVerdict::sharp_elsewhere,
            "An AF point on soft background while the subject is sharp is front/back focus.");
      check(miss.hit < .2, "Front/back focus has low hit confidence.");
      check(miss.best_acuity - miss.af_acuity > .3, "The frame's best clearly beats the AF area.");
    }
    {
      const auto nothing = lenslabs::judge_focus_hit(soft, {.22, .25, .06, .09});
      check(nothing.verdict == FocusHitVerdict::missed, "A frame soft everywhere is a missed focus.");
      check(nothing.hit < .2 && nothing.best_acuity < .42, "Nothing in a missed frame reads sharp.");
    }
    {
      // An AF box larger than the subject still counts the subject: the
      // sharpest half of the box is what is judged.
      const auto wide = lenslabs::judge_focus_hit(frame, {.10, .10, .40, .45});
      check(wide.verdict == FocusHitVerdict::on_subject, "A wide AF box around the subject is a hit.");
      // A zero-size box is a point; the judge grows it to something measurable.
      const auto point = lenslabs::judge_focus_hit(frame, {.27, .32, 0, 0});
      check(point.verdict == FocusHitVerdict::on_subject, "A zero-size AF point is grown and judged.");
      // At the frame's edge the grown box stays inside.
      const auto corner = lenslabs::judge_focus_hit(frame, {.99, .99, .01, .01});
      check(corner.verdict == FocusHitVerdict::sharp_elsewhere, "An AF point in a soft corner is judged.");
    }
    {
      // The same units as measure_cull(): the best acuity agrees with the cull's
      // acuity_best on the same frame, so the two engines cannot drift apart.
      for (const auto* image : {&frame, &sharp, &soft}) {
        const auto reading = lenslabs::measure_cull(*image);
        const auto hit = lenslabs::judge_focus_hit(*image, {.4, .4, .2, .2});
        check(std::abs(reading.acuity_best - hit.best_acuity) < 1e-9,
              "focus_hit's best acuity equals measure_cull's acuity_best.");
      }
    }
    {
      // Nothing to resolve: a flat frame, and an AF area on flat ground in a
      // frame whose only detail is far away.
      check(lenslabs::judge_focus_hit(blank(640, 427), {.4, .4, .1, .1}).verdict == FocusHitVerdict::unjudged,
            "A flat frame is unjudged.");
      auto flat_with_detail = blank(640, 427);
      flat_with_detail = with_patch(flat_with_detail, sharp, .8, .8, 1, 1);
      const auto sky = lenslabs::judge_focus_hit(flat_with_detail, {.1, .1, .05, .05});
      check(sky.verdict == FocusHitVerdict::unjudged && sky.hit == 0,
            "An AF area on featureless sky is unjudged, not a miss.");
    }
    {
      const double nan = std::numeric_limits<double>::quiet_NaN();
      const double inf = std::numeric_limits<double>::infinity();
      for (const lenslabs::FocusRegion& bad : {lenslabs::FocusRegion{nan, .5, .1, .1},
                                               lenslabs::FocusRegion{.5, .5, inf, .1},
                                               lenslabs::FocusRegion{.5, .5, -.1, .1},
                                               lenslabs::FocusRegion{3, 3, .1, .1},
                                               lenslabs::FocusRegion{-1, .5, .1, .1}})
        check(lenslabs::judge_focus_hit(frame, bad).verdict == FocusHitVerdict::unjudged,
              "A non-finite, negative or off-frame AF area is unjudged.");
      check(lenslabs::judge_focus_hit(blank(8, 8), {.4, .4, .1, .1}).verdict == FocusHitVerdict::unjudged,
            "A frame too small to measure is unjudged.");
      lenslabs::Image torn{640, 427, 640, 427, std::vector<std::uint8_t>(16)};
      check(lenslabs::judge_focus_hit(torn, {.4, .4, .1, .1}).verdict == FocusHitVerdict::unjudged,
            "A short pixel buffer is unjudged, never read past.");
      check(std::string(lenslabs::focus_hit_verdict_name(FocusHitVerdict::sharp_elsewhere)) ==
                "front-or-back-focus",
            "Verdicts have stable names.");
    }
    std::cout << "PASS focus-hit: " << checks << " checks\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "FAIL focus-hit: " << error.what() << "\n";
    return 1;
  }
}
