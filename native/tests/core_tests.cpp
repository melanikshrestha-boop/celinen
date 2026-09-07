#include "lenslabs/engine.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <exception>
#include <iostream>
#include <limits>
#include <numeric>
#include <stdexcept>
#include <string>

namespace {

using lenslabs::Analysis;
using lenslabs::Edits;
using lenslabs::Image;
using lenslabs::Verdict;

unsigned checks = 0;
unsigned failures = 0;

void check(bool condition, const char* expression, int line) {
  ++checks;
  if (!condition) {
    ++failures;
    std::cerr << "FAIL line " << line << ": " << expression << '\n';
  }
}
#define CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)

bool near(double actual, double expected, double tolerance = 1e-8) {
  return std::isfinite(actual) && std::abs(actual - expected) <= tolerance;
}

template <typename Function>
void invalid(Function function, const char* name) {
  ++checks;
  try {
    function();
    ++failures;
    std::cerr << "FAIL expected invalid_argument: " << name << '\n';
  } catch (const std::invalid_argument&) {
    // Expected validation failure; no abort means later cases still run.
  } catch (const std::exception& error) {
    ++failures;
    std::cerr << "FAIL wrong exception for " << name << ": " << error.what() << '\n';
  } catch (...) {
    ++failures;
    std::cerr << "FAIL nonstandard exception for " << name << '\n';
  }
}

template <typename Function>
void test(const char* name, Function function) {
  const auto before = failures;
  try {
    function();
  } catch (const std::exception& error) {
    ++failures;
    std::cerr << "FAIL uncaught in " << name << ": " << error.what() << '\n';
  } catch (...) {
    ++failures;
    std::cerr << "FAIL unknown exception in " << name << '\n';
  }
  std::cout << (before == failures ? "PASS " : "FAIL ") << name << '\n';
}

Image uniform(std::uint32_t width, std::uint32_t height,
              std::array<std::uint8_t, 4> pixel = {128, 128, 128, 255}) {
  Image image;
  image.width = width;
  image.height = height;
  image.source_width = width * 2;
  image.source_height = height * 2;
  image.rgba.resize(static_cast<std::size_t>(width) * height * 4);
  for (std::size_t offset = 0; offset < image.rgba.size(); offset += 4) {
    std::copy(pixel.begin(), pixel.end(), image.rgba.begin() + static_cast<std::ptrdiff_t>(offset));
  }
  return image;
}

Image checker(std::uint32_t width, std::uint32_t height, std::uint8_t dark,
              std::uint8_t light) {
  auto image = uniform(width, height);
  for (std::uint32_t y = 0; y < height; ++y) {
    for (std::uint32_t x = 0; x < width; ++x) {
      const auto offset = (static_cast<std::size_t>(y) * width + x) * 4;
      const auto value = ((x + y) % 2) ? light : dark;
      image.rgba[offset] = image.rgba[offset + 1] = image.rgba[offset + 2] = value;
    }
  }
  return image;
}

bool same_image(const Image& a, const Image& b) {
  return a.width == b.width && a.height == b.height && a.source_width == b.source_width &&
         a.source_height == b.source_height && a.rgba == b.rgba;
}

void check_alpha_and_dimensions(const Image& source, const Image& output) {
  CHECK(source.width == output.width);
  CHECK(source.height == output.height);
  CHECK(source.source_width == output.source_width);
  CHECK(source.source_height == output.source_height);
  CHECK(source.rgba.size() == output.rgba.size());
  for (std::size_t offset = 3; offset < source.rgba.size(); offset += 4) {
    CHECK(source.rgba[offset] == output.rgba[offset]);
  }
}

}  // namespace

int main() {
  test("reject malformed RGBA dimensions and buffers in both kernels", [] {
    for (const auto dimensions : std::array<std::array<std::uint32_t, 2>, 9>{{
           {0, 0}, {2, 8}, {8, 2}, {8193, 3}, {3, 8193}, {8192, 2049},
           {4097, 4096}, {8192, 8192}, {std::numeric_limits<std::uint32_t>::max(), 3}}}) {
      Image image;
      image.width = dimensions[0];
      image.height = dimensions[1];
      invalid([&] { (void)lenslabs::analyze(image); }, "invalid analysis dimensions");
      invalid([&] { (void)lenslabs::render(image, {}); }, "invalid rendering dimensions");
    }
    for (const auto size : {std::size_t{0}, std::size_t{35}, std::size_t{37}, std::size_t{40}}) {
      auto image = uniform(3, 3);
      image.rgba.resize(size);
      invalid([&] { (void)lenslabs::analyze(image); }, "incorrect analysis buffer size");
      invalid([&] { (void)lenslabs::render(image, {}); }, "incorrect rendering buffer size");
    }
  });

  test("dimension and exact 16 Mi-pixel boundaries are inclusive", [] {
    CHECK(lenslabs::analyze(uniform(3, 3)).histogram[128] == 9);
    CHECK(lenslabs::analyze(uniform(8192, 3)).histogram[128] == 8192 * 3);
    CHECK(lenslabs::analyze(uniform(3, 8192)).histogram[128] == 8192 * 3);
    const auto source = uniform(8192, 2048, {13, 41, 92, 7});
    const auto output = lenslabs::render(source, {});
    CHECK(same_image(source, output));
  });

  test("uniform gray has exact histogram, brightness, hash and mechanical blur", [] {
    for (const auto dimension : {3u, 8u, 17u}) {
      const auto source = uniform(dimension, dimension);
      const auto before = source;
      const auto result = lenslabs::analyze(source);
      CHECK(same_image(source, before));
      CHECK(near(result.brightness, 128));
      CHECK(near(result.sharpness, 0));
      CHECK(result.histogram[128] == dimension * dimension);
      CHECK(std::accumulate(result.histogram.begin(), result.histogram.end(), std::uint64_t{0}) == dimension * dimension);
      CHECK(result.clipped_highlights == 0);
      CHECK(result.clipped_shadows == 0);
      CHECK(result.hash == std::numeric_limits<std::uint64_t>::max());
      CHECK(result.blur);
      CHECK(!result.soft && !result.underexposed && !result.overexposed);
      CHECK(result.score == 28);
    }
  });

  test("black and white report clipping percentages rather than fractions", [] {
    const auto black = lenslabs::analyze(uniform(8, 8, {0, 0, 0, 0}));
    const auto white = lenslabs::analyze(uniform(8, 8, {255, 255, 255, 255}));
    CHECK(black.brightness == 0 && white.brightness == 255);
    CHECK(black.clipped_shadows == 100 && black.clipped_highlights == 0);
    CHECK(white.clipped_highlights == 100 && white.clipped_shadows == 0);
    CHECK(black.underexposed && !black.overexposed);
    CHECK(white.overexposed && !white.underexposed);
    CHECK(black.score == 4 && white.score == 15);
    CHECK(black.hash == white.hash);  // Same hash does not establish duplicate content.
  });

  test("strict clipping boundaries and rounded weighted color histogram", [] {
    auto image = uniform(4, 4);
    const std::array<std::uint8_t, 4> levels{0, 5, 250, 251};
    for (std::size_t pixel = 0; pixel < 16; ++pixel) {
      const auto value = levels[pixel / 4];
      image.rgba[pixel * 4] = image.rgba[pixel * 4 + 1] = image.rgba[pixel * 4 + 2] = value;
    }
    const auto result = lenslabs::analyze(image);
    CHECK(result.clipped_highlights == 25);
    CHECK(result.clipped_shadows == 25);
    CHECK(result.brightness == 126.5);
    for (const auto level : levels) CHECK(result.histogram[level] == 4);
    CHECK(lenslabs::analyze(uniform(3, 3, {255, 0, 0, 255})).histogram[76] == 9);
    CHECK(lenslabs::analyze(uniform(3, 3, {0, 255, 0, 255})).histogram[150] == 9);
    CHECK(lenslabs::analyze(uniform(3, 3, {0, 0, 255, 255})).histogram[29] == 9);
    CHECK(near(lenslabs::analyze(uniform(3, 3, {255, 0, 0, 255})).brightness, 76.245));
  });

  test("checkerboard focus variance and blur/soft categories", [] {
    const auto sharp = lenslabs::analyze(checker(8, 8, 0, 255));
    CHECK(near(sharp.sharpness, 1040400, 1e-6));
    CHECK(near(sharp.brightness, 127.5));
    CHECK(!sharp.blur && !sharp.soft);
    CHECK(sharp.overexposed);
    CHECK(sharp.score == 84);
    CHECK(sharp.hash == UINT64_C(0x55aa55aa55aa55aa));
    const auto blur = lenslabs::analyze(checker(8, 8, 100, 101));
    const auto soft = lenslabs::analyze(checker(8, 8, 100, 102));
    const auto crisp = lenslabs::analyze(checker(8, 8, 100, 103));
    CHECK(near(blur.sharpness, 16));
    CHECK(blur.blur && !blur.soft);
    CHECK(near(soft.sharpness, 64));
    CHECK(!soft.blur && soft.soft);
    CHECK(near(crisp.sharpness, 144));
    CHECK(!crisp.blur && !crisp.soft);
    CHECK(lenslabs::analyze(checker(8, 8, 64, 192)).score == 99);
  });

  test("area-average hash survives contrast changes and handles non-divisible dimensions", [] {
    const auto low = lenslabs::analyze(checker(8, 8, 90, 110));
    const auto high = lenslabs::analyze(checker(8, 8, 20, 240));
    const auto inverse = lenslabs::analyze(checker(8, 8, 240, 20));
    CHECK(low.hash == high.hash);
    CHECK(lenslabs::hamming_distance(high.hash, inverse.hash) == 64);
    auto gradient = uniform(17, 13);
    for (std::uint32_t y = 0; y < gradient.height; ++y) {
      for (std::uint32_t x = 0; x < gradient.width; ++x) {
        const auto offset = (static_cast<std::size_t>(y) * gradient.width + x) * 4;
        gradient.rgba[offset] = gradient.rgba[offset + 1] = gradient.rgba[offset + 2] = static_cast<std::uint8_t>(x * 15);
      }
    }
    CHECK(lenslabs::analyze(gradient).hash == UINT64_C(0x0f0f0f0f0f0f0f0f));
    auto small = uniform(3, 3);
    for (std::size_t offset = 0; offset < small.rgba.size(); offset += 4) {
      const auto x = (offset / 4) % 3;
      small.rgba[offset] = small.rgba[offset + 1] = small.rgba[offset + 2] = static_cast<std::uint8_t>(x * 100);
    }
    CHECK(lenslabs::analyze(small).hash == UINT64_C(0x1f1f1f1f1f1f1f1f));
  });

  test("zero edits are exact identity, preserve alpha/source facts, and own their buffer", [] {
    auto source = uniform(8, 9);
    for (std::size_t offset = 0; offset < source.rgba.size(); ++offset) {
      source.rgba[offset] = static_cast<std::uint8_t>((offset * 73 + 11) % 256);
    }
    const auto before = source;
    auto output = lenslabs::render(source, {});
    CHECK(same_image(source, output));
    CHECK(output.rgba.data() != source.rgba.data());
    output.rgba[0] ^= 255;
    CHECK(same_image(source, before));
    CHECK(output.rgba[0] != source.rgba[0]);
  });

  test("exposure is powers of two and clamps bytes without changing alpha", [] {
    const auto source = uniform(3, 3, {32, 64, 128, 19});
    const auto before = source;
    const auto brighter = lenslabs::render(source, Edits{.exposure_ev = 1});
    const auto darker = lenslabs::render(source, Edits{.exposure_ev = -1});
    CHECK(brighter.rgba[0] == 64 && brighter.rgba[1] == 128 && brighter.rgba[2] == 255);
    CHECK(darker.rgba[0] == 16 && darker.rgba[1] == 32 && darker.rgba[2] == 64);
    check_alpha_and_dimensions(source, brighter);
    check_alpha_and_dimensions(source, darker);
    CHECK(same_image(source, before));
    CHECK(lenslabs::render(source, Edits{.exposure_ev = 5}).rgba[0] == 255);
    CHECK(lenslabs::render(source, Edits{.exposure_ev = -5}).rgba[0] == 1);
  });

  test("contrast and saturation have explicit bounded effects", [] {
    const auto source = uniform(3, 3, {200, 80, 20, 0});
    const auto gray = lenslabs::render(source, Edits{.saturation = -100});
    CHECK(gray.rgba[0] == 109 && gray.rgba[1] == 109 && gray.rgba[2] == 109);
    const auto flat = lenslabs::render(source, Edits{.contrast = -100});
    CHECK(flat.rgba[0] == 128 && flat.rgba[1] == 128 && flat.rgba[2] == 128);
    const auto punchy = lenslabs::render(source, Edits{.contrast = 100, .saturation = 100});
    CHECK(punchy.rgba[0] == 255 && punchy.rgba[1] < source.rgba[1] && punchy.rgba[2] == 0);
    check_alpha_and_dimensions(source, gray);
    check_alpha_and_dimensions(source, flat);
    check_alpha_and_dimensions(source, punchy);
  });

  test("highlight and shadow masks act on their luminance regions without changing midgray", [] {
    const auto dark = uniform(3, 3, {32, 32, 32, 61});
    const auto light = uniform(3, 3, {224, 224, 224, 62});
    const auto mid = uniform(3, 3, {128, 128, 128, 63});
    const auto lifted = lenslabs::render(dark, Edits{.shadows = 100});
    const auto recovered = lenslabs::render(light, Edits{.highlights = -100});
    CHECK(lifted.rgba[0] == 85);
    CHECK(recovered.rgba[0] == 171);
    CHECK(same_image(light, lenslabs::render(light, Edits{.shadows = 100})));
    CHECK(same_image(dark, lenslabs::render(dark, Edits{.highlights = -100})));
    CHECK(same_image(mid, lenslabs::render(mid, Edits{.highlights = -100, .shadows = 100})));
    CHECK(lenslabs::render(dark, Edits{.shadows = -100}).rgba[0] == 0);
    CHECK(lenslabs::render(light, Edits{.highlights = 100}).rgba[0] == 255);
    check_alpha_and_dimensions(dark, lifted);
    check_alpha_and_dimensions(light, recovered);
  });

  test("every edit validates finite values and ranges before touching input", [] {
    const auto source = uniform(3, 3);
    const auto before = source;
    const std::array<double Edits::*, 5> members{
      &Edits::exposure_ev, &Edits::contrast, &Edits::highlights, &Edits::shadows, &Edits::saturation};
    for (const auto member : members) {
      for (const auto value : {std::numeric_limits<double>::quiet_NaN(),
                              std::numeric_limits<double>::infinity(),
                              -std::numeric_limits<double>::infinity()}) {
        Edits edits;
        edits.*member = value;
        invalid([&] { (void)lenslabs::render(source, edits); }, "nonfinite adjustment");
      }
      const double bound = member == &Edits::exposure_ev ? 5 : 100;
      for (const auto value : {-bound - 0.001, bound + 0.001}) {
        Edits edits;
        edits.*member = value;
        invalid([&] { (void)lenslabs::render(source, edits); }, "out-of-range adjustment");
      }
      for (const auto value : {-bound, bound}) {
        Edits edits;
        edits.*member = value;
        CHECK(lenslabs::render(source, edits).rgba.size() == source.rgba.size());
      }
    }
    CHECK(same_image(source, before));
  });

  test("combined extreme edits remain byte-bounded and preserve mixed alpha", [] {
    auto source = checker(8, 8, 4, 251);
    for (std::size_t offset = 3; offset < source.rgba.size(); offset += 4) {
      source.rgba[offset] = static_cast<std::uint8_t>(offset % 256);
    }
    const auto before = source;
    for (const double ev : {-5.0, 5.0}) {
      const auto output = lenslabs::render(source, Edits{.exposure_ev = ev, .contrast = 100,
        .highlights = -100, .shadows = 100, .saturation = 100});
      check_alpha_and_dimensions(source, output);
    }
    CHECK(same_image(source, before));
  });

  test("first pass protects existing verdicts, follows thresholds, and never uses hash alone", [] {
    Analysis analysis;
    for (const auto score : {0, 44, 45, 69, 70, 99, 100}) {
      analysis.score = score;
      analysis.hash = std::numeric_limits<std::uint64_t>::max();
      analysis.blur = false;
      CHECK(lenslabs::first_pass(analysis, Verdict::keep) == Verdict::keep);
      CHECK(lenslabs::first_pass(analysis, Verdict::reject) == Verdict::reject);
      const auto expected = score < 45 ? Verdict::reject : score >= 70 ? Verdict::keep : Verdict::undecided;
      CHECK(lenslabs::first_pass(analysis) == expected);
      analysis.blur = true;
      CHECK(lenslabs::first_pass(analysis) == Verdict::reject);
      CHECK(lenslabs::first_pass(analysis, Verdict::keep) == Verdict::keep);
    }
    analysis.blur = false;
    analysis.score = 90;
    analysis.soft = analysis.underexposed = analysis.overexposed = true;
    CHECK(lenslabs::first_pass(analysis) == Verdict::keep);
    analysis.score = 60;
    CHECK(lenslabs::first_pass(analysis) == Verdict::undecided);
  });

  test("invalid analysis does not produce a new first-pass decision", [] {
    Analysis analysis;
    for (const auto score : {-1, 101}) {
      analysis.score = score;
      CHECK(lenslabs::first_pass(analysis) == Verdict::undecided);
    }
    analysis.score = 90;
    for (const auto member : std::array<double Analysis::*, 4>{&Analysis::sharpness,
           &Analysis::brightness, &Analysis::clipped_highlights, &Analysis::clipped_shadows}) {
      for (const auto value : {std::numeric_limits<double>::quiet_NaN(), std::numeric_limits<double>::infinity()}) {
        auto broken = analysis;
        broken.*member = value;
        CHECK(lenslabs::first_pass(broken) == Verdict::undecided);
        CHECK(lenslabs::first_pass(broken, Verdict::reject) == Verdict::reject);
        CHECK(lenslabs::first_pass(broken, Verdict::keep) == Verdict::keep);
      }
    }
  });

  test("hamming distance and verdict names are total deterministic utilities", [] {
    CHECK(lenslabs::hamming_distance(0, 0) == 0);
    CHECK(lenslabs::hamming_distance(0, UINT64_MAX) == 64);
    CHECK(lenslabs::hamming_distance(UINT64_MAX, UINT64_MAX) == 0);
    CHECK(lenslabs::hamming_distance(UINT64_C(0x8000000000000000), 0) == 1);
    CHECK(lenslabs::hamming_distance(UINT64_C(0xf0), UINT64_C(0x0f)) == 8);
    CHECK(std::string(lenslabs::verdict_name(Verdict::undecided)) == "undecided");
    CHECK(std::string(lenslabs::verdict_name(Verdict::keep)) == "keep");
    CHECK(std::string(lenslabs::verdict_name(Verdict::reject)) == "reject");
    CHECK(std::string(lenslabs::verdict_name(static_cast<Verdict>(99))) == "unknown");
  });

  std::cout << checks << " checks, " << failures << " failures\n";
  return failures == 0 ? 0 : 1;
}
