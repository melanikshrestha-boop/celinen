#include "lenslabs/cull.hpp"
#include <algorithm>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
int checks = 0;
void check(bool passed, const char* label) { ++checks; if (!passed) throw std::runtime_error(label); }

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

// Deterministic, photo-like detail: smooth value noise at three octaves, so
// tiles carry structure in every direction instead of pixel grain (grain is
// what the engine's noise floor removes, and a fixture made of it would be
// measuring the wrong thing).
lenslabs::Image detailed(unsigned w = 320, unsigned h = 240, double amplitude = 60,
                         double base = 128, std::uint32_t seed = 12345) {
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
    // Smoothstep between corners: a continuous field, like real subject detail.
    const double sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const double top = corner(x0, y0, salt) * (1 - sx) + corner(x0 + 1, y0, salt) * sx;
    const double bottom = corner(x0, y0 + 1, salt) * (1 - sx) + corner(x0 + 1, y0 + 1, salt) * sx;
    return top * (1 - sy) + bottom * sy;
  };
  for (unsigned y = 0; y < h; ++y)
    for (unsigned x = 0; x < w; ++x)
      put(image, x, y,
          base + amplitude * (octave(x, y, 2.2, 0) * .5 + octave(x, y, 7, 1) * .3 +
                              octave(x, y, 23, 2) * .2));
  return image;
}

// Separable box blur repeated: a real optical defocus, not a decimation.
lenslabs::Image blurred(const lenslabs::Image& source, int radius, int passes = 2) {
  auto image = source;
  for (int pass = 0; pass < passes; ++pass) {
    auto copy = image;
    for (unsigned y = 0; y < image.height; ++y)
      for (unsigned x = 0; x < image.width; ++x) {
        double sum = 0; int count = 0;
        for (int d = -radius; d <= radius; ++d) {
          const int xx = std::clamp(int(x) + d, 0, int(image.width) - 1);
          sum += get(copy, unsigned(xx), y); ++count;
        }
        put(image, x, y, sum / count);
      }
    copy = image;
    for (unsigned y = 0; y < image.height; ++y)
      for (unsigned x = 0; x < image.width; ++x) {
        double sum = 0; int count = 0;
        for (int d = -radius; d <= radius; ++d) {
          const int yy = std::clamp(int(y) + d, 0, int(image.height) - 1);
          sum += get(copy, x, unsigned(yy)); ++count;
        }
        put(image, x, y, sum / count);
      }
  }
  return image;
}

// Smear along one axis only: camera shake.
lenslabs::Image smeared(const lenslabs::Image& source, int length) {
  auto image = source;
  for (unsigned y = 0; y < image.height; ++y)
    for (unsigned x = 0; x < image.width; ++x) {
      double sum = 0; int count = 0;
      for (int d = -length; d <= length; ++d) {
        const int xx = std::clamp(int(x) + d, 0, int(image.width) - 1);
        sum += get(source, unsigned(xx), y); ++count;
      }
      put(image, x, y, sum / count);
    }
  return image;
}

lenslabs::Image composite(const lenslabs::Image& background, const lenslabs::Image& subject,
                          double x0, double y0, double x1, double y1) {
  auto image = background;
  for (unsigned y = unsigned(y0 * background.height); y < unsigned(y1 * background.height); ++y)
    for (unsigned x = unsigned(x0 * background.width); x < unsigned(x1 * background.width); ++x)
      put(image, x, y, get(subject, x, y));
  return image;
}

lenslabs::CullFrameInput frame(const std::string& id, const lenslabs::CullReading& reading,
                               double time_ms = -1, const char* camera = "camera-a") {
  lenslabs::CullFrameInput input;
  input.id = id;
  input.reading = reading;
  input.capture_time_ms = time_ms;
  input.camera_key = camera;
  return input;
}

const lenslabs::CullRow& row(const std::vector<lenslabs::CullRow>& rows, const std::string& id) {
  for (const auto& entry : rows) if (entry.id == id) return entry;
  throw std::runtime_error("missing row");
}
}

int main() {
  try {
    const auto sharp = detailed();
    const auto sharp_reading = lenslabs::measure_cull(sharp);
    const auto soft_reading = lenslabs::measure_cull(blurred(sharp, 2));
    const auto very_soft_reading = lenslabs::measure_cull(blurred(sharp, 4, 3));
    {
      check(sharp_reading.acuity_subject > .65, "A resolved frame measures as sharp.");
      check(soft_reading.acuity_subject < sharp_reading.acuity_subject - .25,
            "Defocus lowers acuity well below a sharp frame.");
      check(very_soft_reading.acuity_subject < .3 && soft_reading.acuity_subject < .45,
            "Both defocused frames measure as unusable; acuity does not saturate.");
      check(lenslabs::measure_cull(blurred(sharp, 1, 1)).acuity_subject >
                soft_reading.acuity_subject + .1,
            "A slightly soft frame still ranks above a clearly defocused one.");
      check(sharp_reading.quality > soft_reading.quality + 15, "Quality follows focus.");
    }
    {
      // The failure that made every frame score 99: a low-contrast but sharp
      // frame must beat a high-contrast blurred one. Laplacian variance says
      // the opposite, because it measures contrast as much as focus.
      // A foggy, low-contrast scene, still in focus.
      const auto faint_sharp = lenslabs::measure_cull(detailed(320, 240, 30, 128));
      const auto bold_blurred = lenslabs::measure_cull(blurred(detailed(320, 240, 110, 128), 3));
      check(faint_sharp.acuity_subject > bold_blurred.acuity_subject + .3,
            "Focus is judged independently of how much contrast a scene happens to have.");
      check(faint_sharp.quality > bold_blurred.quality + 20,
            "The quality that reaches the photographer follows focus, not contrast.");
    }
    {
      // A sharp background behind a soft subject is a missed frame.
      const auto background = detailed();
      const auto subject = blurred(background, 3, 3);
      const auto missed = lenslabs::measure_cull(composite(background, subject, .3, .25, .7, .75));
      check(missed.acuity_best > missed.acuity_subject + .15,
            "The sharpest region is recognized as not being the subject.");
      const auto hit = lenslabs::measure_cull(
          composite(blurred(background, 3, 3), background, .3, .25, .7, .75));
      check(hit.acuity_subject > missed.acuity_subject + .1,
            "A sharp subject on a soft background scores as the keeper.");
    }
    {
      const auto shake = lenslabs::measure_cull(smeared(sharp, 4));
      check(shake.motion > .3 && shake.global_smear, "One-direction smear reads as motion blur.");
      check(sharp_reading.motion < .15 && !sharp_reading.global_smear,
            "A sharp frame is not accused of motion blur.");
      check(!soft_reading.global_smear && soft_reading.motion < shake.motion,
            "Plain defocus is not reported as motion blur.");
    }
    {
      auto dark = detailed(320, 240, 22, 26);
      auto bright = detailed(320, 240, 10, 250);
      const auto dark_reading = lenslabs::measure_cull(dark);
      const auto bright_reading = lenslabs::measure_cull(bright);
      check(dark_reading.subject_luma < 45 && dark_reading.quality < sharp_reading.quality,
            "A frame too dark to use is scored down.");
      check(bright_reading.clipped_highlights > 5 && bright_reading.quality < sharp_reading.quality,
            "A blown frame is scored down.");
      check(sharp_reading.black_point < sharp_reading.median &&
                sharp_reading.median < sharp_reading.white_point,
            "Tone percentiles are ordered.");
    }
    {
      // Perceptual hash: the same photograph at another size or brightness is
      // still the same photograph; a different scene is not.
      auto brighter = sharp;
      for (std::size_t i = 0; i < brighter.rgba.size(); ++i)
        if (i % 4 != 3) brighter.rgba[i] = std::uint8_t(std::min(255, brighter.rgba[i] + 18));
      const auto brighter_reading = lenslabs::measure_cull(brighter);
      check(lenslabs::cull_hash_distance(sharp_reading.hash, brighter_reading.hash) <= 4,
            "Exposure alone does not change the perceptual hash.");
      const auto other = lenslabs::measure_cull(detailed(320, 240, 60, 128, 999));
      check(lenslabs::cull_hash_distance(sharp_reading.hash, other.hash) > 8,
            "A different scene is far away in hash space.");
    }
    {
      lenslabs::CullFace face;
      face.x = .35; face.y = .2; face.width = .3; face.height = .35;
      face.closed_probability = .95; face.confidence = .9;
      const auto blink = lenslabs::measure_cull(sharp, {face});
      check(blink.has_face && blink.eyes_closed && blink.quality < sharp_reading.quality * .6,
            "A confident blink on the subject takes the frame down.");
      check(blink.face_count == 1 && blink.eyes_closed_probability > .9 && blink.eyes_confidence > .8,
            "The primary face's evidence is kept on the reading.");
      face.confidence = .5;
      const auto doubtful = lenslabs::measure_cull(sharp, {face});
      auto open_face = face;
      open_face.closed_probability = .05;
      const auto open = lenslabs::measure_cull(sharp, {open_face});
      check(!doubtful.eyes_closed && doubtful.eyes_uncertain && std::abs(doubtful.quality - open.quality) < 1e-9,
            "A blink the engine cannot vouch for is uncertain and costs the frame nothing.");
      check(blink.quality < open.quality * .6, "Only the confident blink is scored down.");
      lenslabs::CullFace legacy;
      legacy.x = .35; legacy.y = .2; legacy.width = .3; legacy.height = .35; legacy.eyes_open = 0;
      const auto guessed = lenslabs::measure_cull(sharp, {legacy});
      check(guessed.eyes_uncertain && !guessed.eyes_closed,
            "A browser detector's closed-eye guess can flag a frame but never reject it.");
      const auto no_faces = lenslabs::measure_cull(sharp, {});
      check(!no_faces.has_face && no_faces.eyes_closed_probability < 0 && !no_faces.eyes_uncertain,
            "Without faces there is no claim about eyes either way.");
    }
    {
      using lenslabs::CullFace;
      using lenslabs::EyesState;
      const auto make = [](double x, double y, double size, double p, double c, double sharpness = .8) {
        CullFace face;
        face.x = x; face.y = y; face.width = size; face.height = size * 1.3;
        face.score = .9; face.sharpness = sharpness;
        face.closed_probability = p; face.confidence = c;
        return face;
      };
      // The player, large and central with open eyes; a spectator small and
      // off to the side, blinking with full confidence.
      const auto player = make(.42, .2, .16, .05, .9);
      const auto fan = make(.05, .05, .04, .98, .95);
      auto verdict = lenslabs::judge_eyes({fan, player}, 1.5);
      check(verdict.primary == 1 && verdict.state == EyesState::open,
            "A blinking background face never decides the frame.");
      verdict = lenslabs::judge_eyes({fan, make(.42, .2, .16, .92, .9)}, 1.5);
      check(verdict.state == EyesState::closed && verdict.primary == 1,
            "The primary subject confidently blinking is closed.");
      verdict = lenslabs::judge_eyes({make(.42, .2, .16, .92, .4)}, 1.5);
      check(verdict.state == EyesState::uncertain, "High probability with low confidence is uncertain.");
      verdict = lenslabs::judge_eyes({make(.42, .2, .16, .6, .95)}, 1.5);
      check(verdict.state == EyesState::uncertain, "A borderline probability is uncertain, not closed.");
      verdict = lenslabs::judge_eyes({make(.42, .2, .16, -1, 0)}, 1.5);
      check(verdict.state == EyesState::unknown && verdict.primary == 0,
            "A face whose eyes could not be read is unknown, never closed.");
      // Two players of equal standing, one blinking: worth a look, not a reject.
      verdict = lenslabs::judge_eyes({make(.25, .2, .15, .05, .9), make(.6, .2, .15, .95, .9)}, 1.5);
      check(verdict.state == EyesState::uncertain, "A co-subject's blink makes the frame uncertain.");
      // Sharpness picks the subject when two faces are otherwise alike: the
      // photographer focused on one of them.
      verdict = lenslabs::judge_eyes({make(.3, .2, .14, .95, .9, .15), make(.56, .2, .14, .05, .9, .9)}, 1.5);
      check(verdict.primary == 1, "The in-focus face is the primary subject.");
      check(lenslabs::judge_eyes({}, 1.5).state == EyesState::unknown, "No faces, no verdict.");
      // Thresholds are parameters: a stricter bar turns a closed call uncertain.
      lenslabs::EyeThresholds strict;
      strict.min_confidence = .95;
      check(lenslabs::judge_eyes({make(.42, .2, .16, .92, .9)}, 1.5, strict).state == EyesState::uncertain,
            "The confidence bar is honoured.");
    }
    {
      const auto region = lenslabs::region_acuity(sharp, 40, 40, 200, 160);
      const auto soft_region = lenslabs::region_acuity(blurred(sharp, 3, 3), 40, 40, 200, 160);
      check(region > .6 && soft_region < region - .25, "Region acuity follows focus like the frame's own.");
      check(lenslabs::region_acuity(blank(64, 64), 0, 0, 64, 64) < 0,
            "A flat region has nothing to judge rather than a low score.");
      check(lenslabs::region_acuity(sharp, 330, 250, 400, 300) < 0, "A region outside the image is not judged.");
    }
    {
      // Shoot pass: three near-identical burst frames plus one unrelated frame.
      auto best = sharp_reading, middle = soft_reading, worst = very_soft_reading;
      middle.hash = best.hash; middle.color = best.color;
      worst.hash = best.hash; worst.color = best.color;
      const auto other = lenslabs::measure_cull(detailed(320, 240, 60, 128, 4242));
      const auto rows = lenslabs::cull_shoot({
          frame("a", best, 1000), frame("b", middle, 1300), frame("c", worst, 1600),
          frame("d", other, 60000),
      });
      check(row(rows, "a").group >= 0 && row(rows, "a").group == row(rows, "b").group &&
                row(rows, "b").group == row(rows, "c").group,
            "Near-identical frames shot seconds apart become one group.");
      check(row(rows, "d").group < 0, "An unrelated frame is not swept into the burst.");
      check(row(rows, "a").best_of_group && !row(rows, "b").best_of_group,
            "The sharpest frame of the burst is the keeper.");
      check(row(rows, "a").verdict == lenslabs::CullVerdict::keep, "The keeper is suggested as a keep.");
      check(row(rows, "c").verdict == lenslabs::CullVerdict::reject, "The soft frames are rejected.");
      check(row(rows, "a").score > row(rows, "b").score && row(rows, "b").score > row(rows, "c").score,
            "Scores separate the frames instead of saturating.");
      check(row(rows, "a").score <= 99 && row(rows, "c").score >= 1, "Scores stay inside 1..99.");
    }
    {
      // A sports card revisits the same composition all game. Identical-looking
      // frames minutes apart are separate moments, not one burst with one keeper.
      std::vector<lenslabs::CullFrameInput> game;
      for (int play = 0; play < 4; ++play)
        for (int shot = 0; shot < 3; ++shot)
          game.push_back(frame("p" + std::to_string(play) + "s" + std::to_string(shot), sharp_reading,
                               play * 45000.0 + shot * 150.0));
      const auto rows = lenslabs::cull_shoot(game);
      check(row(rows, "p0s0").group == row(rows, "p0s2").group,
            "Frames fractions of a second apart are one burst.");
      check(row(rows, "p0s0").group != row(rows, "p1s0").group,
            "The same composition on the next play is a new burst.");
      // Without capture times, only neighbours may be grouped.
      std::vector<lenslabs::CullFrameInput> untimed;
      for (int i = 0; i < 8; ++i) untimed.push_back(frame("u" + std::to_string(i), sharp_reading, -1));
      const auto untimed_rows = lenslabs::cull_shoot(untimed);
      check(row(untimed_rows, "u0").group == row(untimed_rows, "u1").group,
            "Adjacent untimed look-alikes still group.");
    }
    {
      // The photographer's own decisions are never overruled, and an unreadable
      // file is never judged.
      auto decided = frame("kept", very_soft_reading, 1000);
      decided.verdict = 1; // the photographer kept it
      auto broken = frame("broken", lenslabs::CullReading{}, 1200);
      broken.unreadable = true;
      const auto rows = lenslabs::cull_shoot({decided, broken, frame("open", sharp_reading, 90000)});
      check(row(rows, "kept").verdict == lenslabs::CullVerdict::undecided,
            "A decided frame receives no suggestion to overwrite it.");
      check(row(rows, "broken").verdict == lenslabs::CullVerdict::undecided &&
                row(rows, "broken").score == 0,
            "An unreadable frame is not scored or judged.");
    }
    {
      // An entirely soft shoot must not promote its least-bad frame.
      std::vector<lenslabs::CullFrameInput> soft;
      for (int i = 0; i < 6; ++i) {
        auto reading = lenslabs::measure_cull(blurred(detailed(320, 240, 60, 120 + i * 4.0), 3, 3));
        soft.push_back(frame("s" + std::to_string(i), reading, 1000.0 + i * 30000));
      }
      const auto rows = lenslabs::cull_shoot(soft);
      const bool any_keep = std::any_of(rows.begin(), rows.end(), [](const auto& entry) {
        return entry.verdict == lenslabs::CullVerdict::keep;
      });
      check(!any_keep, "A shoot with nothing sharp in it keeps nothing.");
    }
    {
      bool rejected = false;
      try { lenslabs::measure_cull(blank(8, 8)); } catch (const std::invalid_argument&) { rejected = true; }
      check(rejected, "An image too small to measure is rejected.");
      lenslabs::Image torn{64, 64, 64, 64, std::vector<std::uint8_t>(16)};
      rejected = false;
      try { lenslabs::measure_cull(torn); } catch (const std::invalid_argument&) { rejected = true; }
      check(rejected, "A short pixel buffer is rejected.");
      const auto flat = lenslabs::measure_cull(blank(64, 64));
      check(flat.texture < .05 && flat.quality < 25, "A frame with no detail cannot claim quality.");
      check(lenslabs::cull_shoot({}).empty(), "An empty shoot is an empty result.");
    }
    std::cout << "PASS cull: " << checks << " checks\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "FAIL cull: " << error.what() << "\n";
    return 1;
  }
}
