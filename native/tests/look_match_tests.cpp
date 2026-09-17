#include "lenslabs/develop.hpp"
#include "lenslabs/look_match.hpp"
#include <cmath>
#include <cstdio>
#include <iostream>
#include <stdexcept>
#include <string>

// Look matching proven against the real develop(): an inspiration is rendered
// from a known random recipe, then the neutral original and exposure/white
// balance shifted copies of it are matched. The fixture photographs run the
// same C++ through the committed WebAssembly in tests/develop-look-match.test.ts.
namespace {
using lenslabs::DevelopSettings;
using lenslabs::Image;
using lenslabs::LookDescriptor;
int checks = 0;
void check(bool passed, const std::string& label) {
  ++checks;
  if (!passed) throw std::runtime_error(label);
}
std::uint32_t hash(std::uint32_t x, std::uint32_t y, std::uint32_t seed) {
  std::uint32_t v = x * 374761393u + y * 668265263u + seed * 2246822519u;
  v = (v ^ (v >> 13)) * 1274126177u;
  return v ^ (v >> 16);
}
// A deterministic scene with what a sports photo has: sky and floor
// gradients, skin, saturated jerseys in several hues, deep shadow, specular
// white, and fine texture.
Image scene(unsigned w, unsigned h, unsigned variant) {
  Image image{w, h, w, h, std::vector<std::uint8_t>(std::size_t(w) * h * 4, 255)};
  struct Patch { double x, y, r; std::array<double, 3> color; };
  const std::vector<Patch> first{{.22, .55, .12, {222, 172, 140}}, {.45, .6, .1, {200, 40, 45}},
      {.65, .5, .09, {235, 200, 60}}, {.82, .62, .08, {120, 70, 165}}, {.3, .82, .07, {60, 170, 175}},
      {.58, .85, .06, {190, 60, 150}}, {.9, .2, .05, {245, 245, 238}}, {.1, .9, .07, {18, 18, 22}}};
  const std::vector<Patch> second{{.7, .4, .15, {205, 150, 115}}, {.3, .35, .1, {40, 70, 190}},
      {.5, .75, .12, {60, 150, 70}}, {.15, .6, .08, {230, 120, 40}}, {.85, .8, .07, {235, 235, 240}},
      {.4, .92, .09, {25, 22, 20}}};
  const auto& patches = variant == 0 ? first : second;
  for (unsigned y = 0; y < h; ++y)
    for (unsigned x = 0; x < w; ++x) {
      const double u = (x + .5) / w, v = (y + .5) / h;
      std::array<double, 3> c = variant == 0
          ? (v < .45 ? std::array<double, 3>{80 + 90 * v / .45, 125 + 75 * v / .45, 195 + 40 * v / .45}
                     : std::array<double, 3>{150 - 90 * (v - .45), 110 - 60 * (v - .45), 70 - 40 * (v - .45)})
          : std::array<double, 3>{40 + 120 * u, 45 + 100 * u * (1 - v), 55 + 60 * (1 - v)};
      for (const auto& p : patches) {
        const double d = std::hypot((u - p.x) * w / h, v - p.y) / p.r;
        const double inside = std::clamp((1.1 - d) * 8, 0.0, 1.0);
        const double shade = .55 + .45 * (1 - d);  // rounded, lit forms, not flat discs
        for (int k = 0; k < 3; ++k) c[k] += (p.color[k] * shade - c[k]) * inside;
      }
      // Soft light falloff across the frame keeps the histogram continuous, as
      // in a photograph, plus fine sensor-like texture.
      const double light = .8 + .2 * std::sin(u * 5.1 + variant) * std::cos(v * 3.7 - variant);
      const double texture = (hash(x, y, variant) % 13) - 6.0;
      for (int k = 0; k < 3; ++k)
        image.rgba[(std::size_t(y) * w + x) * 4 + k] = std::uint8_t(std::clamp(std::round(c[k] * light + texture), 0.0, 255.0));
    }
  return image;
}

struct Rng {
  std::uint64_t state;
  double next() {
    state = state * 6364136223846793005ULL + 1442695040888963407ULL;
    return double(state >> 11) / double(1ULL << 53);
  }
  double range(double low, double high) { return std::round(low + (high - low) * next()); }
};
// Random looks across the tone, HSL, grading, fade and vignette controls, in
// the ranges real looks use (the extremes of every slider are not looks).
DevelopSettings random_look(Rng& r) {
  DevelopSettings s;
  s.tonal_grading = true;
  s.contrast = r.range(-30, 40);
  s.highlights = r.range(-50, 30);
  s.shadows = r.range(-30, 50);
  s.whites = r.range(-30, 30);
  s.blacks = r.range(-30, 30);
  s.temperature = r.range(-20, 20);
  s.tint = r.range(-10, 10);
  s.saturation = r.range(-30, 25);
  s.vibrance = r.range(-20, 30);
  s.curve = {{0, r.range(0, 8) / 100}, {.5, r.range(42, 58) / 100}, {1, r.range(92, 100) / 100}};
  for (auto& band : s.hsl) band = {r.range(-25, 25), r.range(-40, 40), r.range(-25, 25)};
  s.shadow_grade = {r.range(0, 359), r.range(0, 35), 0};
  s.midtone_grade = {r.range(0, 359), r.range(0, 12), 0};
  s.highlight_grade = {r.range(0, 359), r.range(0, 30), 0};
  s.fade = r.range(0, 30);
  s.vignette = r.range(-40, 15);
  return s;
}

// CIEDE2000 (Sharma, Wu, Dalal 2005).
double delta_e2000(double l1, double a1, double b1, double l2, double a2, double b2) {
  const double pi = 3.14159265358979323846, rad = pi / 180;
  const double c7 = std::pow((std::hypot(a1, b1) + std::hypot(a2, b2)) / 2, 7);
  const double g = .5 * (1 - std::sqrt(c7 / (c7 + std::pow(25.0, 7))));
  const double a1p = (1 + g) * a1, a2p = (1 + g) * a2;
  const double c1p = std::hypot(a1p, b1), c2p = std::hypot(a2p, b2);
  const auto angle = [&](double b, double a) {
    if (a == 0 && b == 0) return 0.0;
    const double h = std::atan2(b, a) / rad;
    return h < 0 ? h + 360 : h;
  };
  const double h1p = angle(b1, a1p), h2p = angle(b2, a2p);
  double dh = 0;
  if (c1p * c2p != 0) {
    dh = h2p - h1p;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const double dL = l2 - l1, dC = c2p - c1p, dH = 2 * std::sqrt(c1p * c2p) * std::sin(dh / 2 * rad);
  const double lm = (l1 + l2) / 2, cm = (c1p + c2p) / 2;
  double hm = h1p + h2p;
  if (c1p * c2p != 0) {
    if (std::abs(h1p - h2p) > 180) hm += hm < 360 ? 360 : -360;
    hm /= 2;
  }
  const double t = 1 - .17 * std::cos((hm - 30) * rad) + .24 * std::cos(2 * hm * rad) +
                   .32 * std::cos((3 * hm + 6) * rad) - .2 * std::cos((4 * hm - 63) * rad);
  const double theta = 30 * std::exp(-std::pow((hm - 275) / 25, 2));
  const double cm7 = std::pow(cm, 7), rc = 2 * std::sqrt(cm7 / (cm7 + std::pow(25.0, 7)));
  const double sl = 1 + .015 * (lm - 50) * (lm - 50) / std::sqrt(20 + (lm - 50) * (lm - 50));
  const double sc = 1 + .045 * cm, sh = 1 + .015 * cm * t, rt = -std::sin(2 * theta * rad) * rc;
  return std::sqrt(std::pow(dL / sl, 2) + std::pow(dC / sc, 2) + std::pow(dH / sh, 2) + rt * (dC / sc) * (dH / sh));
}

struct Accuracy {
  double distance = 0, zone_mean = 0, zone_max = 0, quantile_max = 0, band_saturation = 0, band_lightness = 0;
};
// Zone color error is the CIEDE2000 between zone mean colors, averaged by the
// look's pixel share (a zone holding 3% of pixels matters 3%); zone_max is the
// worst zone holding at least 10% of the frame.
Accuracy accuracy(const LookDescriptor& got, const LookDescriptor& want) {
  Accuracy a;
  a.distance = lenslabs::look_distance(got, want);
  double share = 0;
  for (std::size_t z = 0; z < lenslabs::look_zone_count; ++z) {
    const auto& g = got.zones[z];
    const auto& w = want.zones[z];
    const double e = delta_e2000(g.lightness, g.a, g.b, w.lightness, w.a, w.b);
    a.zone_mean += e * w.fraction;
    share += w.fraction;
    if (w.fraction >= .1) a.zone_max = std::max(a.zone_max, e);
  }
  a.zone_mean /= share;
  for (std::size_t q = 0; q < lenslabs::look_quantile_count; ++q)
    a.quantile_max = std::max(a.quantile_max, std::abs(got.quantiles[q] - want.quantiles[q]));
  for (std::size_t b = 0; b < lenslabs::look_band_count; ++b)
    if (std::min(got.bands[b].mass, want.bands[b].mass) > .01) {
      a.band_saturation = std::max(a.band_saturation, std::abs(got.bands[b].saturation - want.bands[b].saturation));
      a.band_lightness = std::max(a.band_lightness, std::abs(got.bands[b].lightness - want.bands[b].lightness));
    }
  return a;
}
void print(const std::string& label, const Accuracy& a) {
  std::printf("  %-26s distance %.2f  zone dE00 mean %.2f max %.2f  L* quantile %.2f  band S %.3f L %.3f\n", label.c_str(),
              a.distance, a.zone_mean, a.zone_max, a.quantile_max, a.band_saturation, a.band_lightness);
}
}  // namespace

int main() {
  try {
    const auto photo = scene(512, 340, 0);
    const auto other = scene(512, 340, 1);
    {
      const auto before = photo.rgba;
      const auto look = lenslabs::describe_look(photo);
      check(photo.rgba == before, "Describing never edits the photo.");
      const auto flat = lenslabs::serialize_look(look);
      check(flat.size() == lenslabs::look_descriptor_size, "The flat descriptor has its declared size.");
      const auto back = lenslabs::serialize_look(lenslabs::deserialize_look(flat.data(), flat.size()));
      check(back == flat, "A descriptor survives the WebAssembly boundary exactly.");
      auto wrong = flat;
      wrong[0] = 99;
      bool refused = false;
      try { lenslabs::deserialize_look(wrong.data(), wrong.size()); } catch (const std::invalid_argument&) { refused = true; }
      check(refused, "A descriptor from another engine version is refused.");
      wrong = flat;
      wrong[20] = std::nan("");
      refused = false;
      try { lenslabs::deserialize_look(wrong.data(), wrong.size()); } catch (const std::invalid_argument&) { refused = true; }
      check(refused, "A non-finite descriptor is refused.");
      refused = false;
      try { lenslabs::describe_look(Image{8, 8, 8, 8, std::vector<std::uint8_t>(8 * 8 * 4, 128)}); } catch (const std::invalid_argument&) { refused = true; }
      check(refused, "A tiny image is refused, not read out of bounds.");
      check(lenslabs::look_distance(look, look) == 0, "A look is at distance zero from itself.");
    }
    {
      Image flat{128, 96, 128, 96, std::vector<std::uint8_t>(128 * 96 * 4, 128)};
      DevelopSettings current;
      current.contrast = 12;
      const auto match = lenslabs::match_look(flat, lenslabs::describe_look(photo), current);
      check(!match.applicable && match.settings.contrast == 12, "A frame with no tonal range keeps its edits.");
    }

    // Same frame: neutral, +-1.5 EV and +-30 temperature copies of the
    // original must all land on the inspiration's look.
    std::cout << "Same frame\n";
    Rng rng{20260917};
    Accuracy worst, worst_clipped;
    for (int trial = 0; trial < 4; ++trial) {
      const auto recipe = random_look(rng);
      const auto look = lenslabs::describe_look(lenslabs::develop(photo, recipe));
      const std::array<std::pair<const char*, std::array<double, 2>>, 5> variants{
          {{"neutral", {0, 0}}, {"+1.5 EV", {1.5, 0}}, {"-1.5 EV", {-1.5, 0}}, {"+30 temperature", {0, 30}}, {"-30 temperature", {0, -30}}}};
      for (const auto& [name, shift] : variants) {
        DevelopSettings shifted;
        shifted.exposure = shift[0];
        shifted.temperature = shift[1];
        const auto target = lenslabs::develop(photo, shifted);
        const auto match = lenslabs::match_look(target, look, DevelopSettings{});
        lenslabs::validate_develop(match.settings);
        check(match.applicable, "Every shifted copy is matchable.");
        const auto a = accuracy(lenslabs::describe_look(lenslabs::develop(target, match.settings)), look);
        print(std::string("look ") + std::to_string(trial) + " " + name, a);
        auto& bucket = shift[0] > 0 ? worst_clipped : worst;
        bucket.distance = std::max(bucket.distance, a.distance);
        bucket.zone_mean = std::max(bucket.zone_mean, a.zone_mean);
        bucket.zone_max = std::max(bucket.zone_max, a.zone_max);
        bucket.quantile_max = std::max(bucket.quantile_max, a.quantile_max);
        bucket.band_saturation = std::max(bucket.band_saturation, a.band_saturation);
        bucket.band_lightness = std::max(bucket.band_lightness, a.band_lightness);
      }
    }
    print("worst unclipped", worst);
    print("worst +1.5 EV (clipped)", worst_clipped);
    // Measured worst cases (Apple clang, 16 matches): distance .41, zone dE00
    // mean .54 / max .65, L* quantile 1.07, band saturation .008, lightness
    // .010. Bounds sit ~1.4-2x above for libm and compiler differences, and
    // keep the mean zone error near CIEDE2000's just-noticeable difference.
    check(worst.distance <= .75, "Same-frame matches land on the look.");
    check(worst.zone_mean <= 1.2 && worst.zone_max <= 1.6, "Tonal zone colors match within about one JND.");
    check(worst.quantile_max <= 1.5, "The luminance distribution matches within 1.5 L*.");
    check(worst.band_saturation <= .03 && worst.band_lightness <= .02, "Color Mixer bands match.");
    // +1.5 EV clips highlights the look still has; that detail is gone, so the
    // bound is looser (measured .78 / 1.66 / 2.31 / 1.51).
    check(worst_clipped.distance <= 1.2 && worst_clipped.zone_mean <= 2.5 && worst_clipped.zone_max <= 3.2 &&
              worst_clipped.quantile_max <= 2,
          "An overexposed copy still lands close to the look.");

    std::cout << "Cross frame\n";
    for (int trial = 0; trial < 2; ++trial) {
      const auto look = lenslabs::describe_look(lenslabs::develop(photo, random_look(rng)));
      const double before = lenslabs::look_distance(lenslabs::describe_look(other), look);
      const auto match = lenslabs::match_look(other, look, DevelopSettings{});
      const auto a = accuracy(lenslabs::describe_look(lenslabs::develop(other, match.settings)), look);
      std::printf("  unedited distance %.2f\n", before);
      print("cross " + std::to_string(trial), a);
      // A different scene cannot become the inspiration's pixels, but its
      // descriptor must move most of the way there (measured 34% and 25% of
      // the unedited distance remain).
      check(a.distance <= before * .45, "A different scene takes on most of the look.");
    }

    {
      // Everything a look never touches is carried over exactly.
      DevelopSettings current;
      current.crop = {.1, .08, .8, .84, 3, 0, false, false};
      current.masks.push_back({});
      current.masks.back().exposure = .4;
      current.sharpening = 40;
      current.sharpening_radius = 1.4;
      current.noise_reduction = 20;
      current.color_noise_reduction = 15;
      current.texture = 12;
      current.contrast = 70;
      current.hsl[3].saturation = 90;
      const auto look = lenslabs::describe_look(lenslabs::develop(photo, random_look(rng)));
      const auto match = lenslabs::match_look(photo, look, current);
      const auto& s = match.settings;
      check(s.crop.x == .1 && s.crop.y == .08 && s.crop.width == .8 && s.crop.height == .84 && s.crop.angle == 3,
            "The crop is never altered.");
      check(s.masks.size() == 1 && s.masks[0].exposure == .4, "Masks are never altered.");
      check(s.sharpening == 40 && s.sharpening_radius == 1.4 && s.noise_reduction == 20 &&
                s.color_noise_reduction == 15 && s.texture == 12,
            "Detail work is never altered.");
      check(s.contrast != 70 && s.hsl[3].saturation != 90, "The previous look is replaced, not stacked.");
      const auto again = lenslabs::match_look(photo, look, current);
      lenslabs::validate_develop(again.settings);
      check(again.distance == match.distance && again.settings.curve.size() == s.curve.size() &&
                std::equal(s.curve.begin(), s.curve.end(), again.settings.curve.begin(),
                           [](auto a, auto b) { return a.x == b.x && a.y == b.y; }) &&
                again.settings.temperature == s.temperature && again.settings.grain == s.grain,
            "The same photo and look always give the same recipe.");
    }

    {
      // Several inspirations define one look.
      const auto look = lenslabs::describe_look(lenslabs::develop(photo, random_look(rng)));
      const auto outlier = lenslabs::describe_look(lenslabs::develop(photo, random_look(rng)));
      check(lenslabs::serialize_look(lenslabs::combine_looks({look})) == lenslabs::serialize_look(look),
            "One inspiration is its own look.");
      const auto voted = lenslabs::serialize_look(lenslabs::combine_looks({look, outlier, look}));
      const auto wanted = lenslabs::serialize_look(look);
      bool outvoted = true;
      const std::size_t band_start = 2 + lenslabs::look_quantile_count + lenslabs::look_zone_count * 9;
      for (std::size_t i = 0; i < wanted.size(); ++i) {
        const bool band_stat = i >= band_start && i < band_start + lenslabs::look_band_count * 5 && (i - band_start) % 5;
        // A color only the odd frame contains keeps that frame's statistics,
        // and a neutral cast only the odd frame could measure is its own.
        if (band_stat && look.bands[(i - band_start) / 5].mass < .004) continue;
        if (i + 3 >= wanted.size() && !look.cast_measured) continue;
        outvoted = outvoted && voted[i] == wanted[i];
      }
      check(outvoted, "One odd frame out of three is outvoted.");
      const auto blended = lenslabs::combine_looks({look, outlier});
      check(std::abs(blended.quantiles[6] - (look.quantiles[6] + outlier.quantiles[6]) / 2) < 1e-9,
            "Two inspirations average.");
      bool refused = false;
      try { lenslabs::combine_looks({}); } catch (const std::invalid_argument&) { refused = true; }
      check(refused, "An empty set of inspirations is refused.");
    }

    {
      // Grain: noise power the photo lacks is added; a clean look adds none.
      DevelopSettings grainy;
      grainy.grain = 40;
      const auto look = lenslabs::describe_look(lenslabs::develop(photo, grainy));
      const auto match = lenslabs::match_look(photo, look, DevelopSettings{}, photo.width);
      std::printf("  grain 40 look matched with grain %.0f size %.1f\n", match.settings.grain, match.settings.grain_size);
      check(match.settings.grain >= 25 && match.settings.grain <= 55 && match.settings.grain_size == 1,
            "Missing grain is measured and added at the photo's scale.");
      const auto clean = lenslabs::match_look(photo, lenslabs::describe_look(photo), DevelopSettings{}, photo.width);
      check(clean.settings.grain == 0, "A clean look adds no grain.");
    }

    std::cout << "PASS look-match: " << checks << " checks\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "FAIL look-match: " << error.what() << "\n";
    return 1;
  }
}
