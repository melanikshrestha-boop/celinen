#include "lenslabs/develop.hpp"
#include "lenslabs/develop_auto.hpp"
#include <cmath>
#include <iostream>
#include <stdexcept>

namespace {
int checks = 0;
void check(bool passed, const char* label) { ++checks; if (!passed) throw std::runtime_error(label); }

// Horizontal luminance ramp between two codes with an optional per-channel cast.
lenslabs::Image ramp(unsigned low, unsigned high, double red = 1, double blue = 1, unsigned w = 256, unsigned h = 64) {
  lenslabs::Image image{w, h, w, h, {}};
  image.rgba.resize(std::size_t(w) * h * 4);
  for (unsigned y = 0; y < h; ++y) for (unsigned x = 0; x < w; ++x) {
    const auto i = (std::size_t(y) * w + x) * 4;
    const double v = low + (high - low) * (x / double(w - 1));
    image.rgba[i] = std::uint8_t(std::clamp(v * red, 0.0, 255.0));
    image.rgba[i + 1] = std::uint8_t(v);
    image.rgba[i + 2] = std::uint8_t(std::clamp(v * blue, 0.0, 255.0));
    image.rgba[i + 3] = 255;
  }
  return image;
}
lenslabs::DevelopSettings recipe(const lenslabs::DevelopAuto& a) {
  lenslabs::DevelopSettings s;
  s.exposure = a.exposure; s.contrast = a.contrast; s.highlights = a.highlights; s.shadows = a.shadows;
  s.whites = a.whites; s.blacks = a.blacks; s.temperature = a.temperature; s.tint = a.tint; s.vibrance = a.vibrance;
  return s;
}
double mean_luma(const lenslabs::Image& image) {
  double sum = 0;
  for (std::size_t i = 0; i < image.rgba.size(); i += 4)
    sum += .2126 * image.rgba[i] + .7152 * image.rgba[i + 1] + .0722 * image.rgba[i + 2];
  return sum / (image.rgba.size() / 4) / 255;
}
double mean_channel(const lenslabs::Image& image, int channel) {
  double sum = 0;
  for (std::size_t i = 0; i < image.rgba.size(); i += 4) sum += image.rgba[i + channel];
  return sum / (image.rgba.size() / 4);
}
}

int main() {
  try {
    {
      lenslabs::Image blank{64, 64, 64, 64, std::vector<std::uint8_t>(64 * 64 * 4, 128)};
      check(!lenslabs::suggest_develop(blank).applicable, "A flat frame has nothing to measure.");
      check(!lenslabs::suggest_develop(lenslabs::Image{}).applicable, "An empty image is rejected without reading memory.");
      lenslabs::Image torn{8, 8, 8, 8, std::vector<std::uint8_t>(12)};
      check(!lenslabs::suggest_develop(torn).applicable, "A short pixel buffer is rejected.");
    }
    {
      const auto source = ramp(8, 120);
      const auto before = source.rgba;
      const auto suggestion = lenslabs::suggest_develop(source);
      check(source.rgba == before, "Measuring never edits the source.");
      check(suggestion.applicable && suggestion.exposure > 0, "An underexposed frame is lifted.");
      lenslabs::validate_develop(recipe(suggestion));
      const auto developed = lenslabs::develop(source, recipe(suggestion));
      check(mean_luma(developed) > mean_luma(source) + .08, "The lift is visible in the developed pixels.");
      const auto again = lenslabs::suggest_develop(source);
      check(again.exposure == suggestion.exposure && again.whites == suggestion.whites && again.blacks == suggestion.blacks,
            "The same pixels always produce the same suggestion.");
    }
    {
      const auto suggestion = lenslabs::suggest_develop(ramp(140, 255));
      check(suggestion.exposure < 0, "An overexposed frame is brought down.");
      lenslabs::validate_develop(recipe(suggestion));
    }
    {
      // Normal key with a bright window: exposure should hold, highlights recover.
      auto source = ramp(30, 200);
      for (unsigned y = 0; y < source.height; ++y) for (unsigned x = source.width * 9 / 10; x < source.width; ++x)
        for (int c = 0; c < 3; ++c) source.rgba[(std::size_t(y) * source.width + x) * 4 + c] = 250;
      const auto suggestion = lenslabs::suggest_develop(source);
      check(std::abs(suggestion.exposure) <= .25, "A normal key keeps its exposure.");
      check(suggestion.highlights < 0, "A bright region recovers highlights instead of darkening the frame.");
    }
    {
      // A flat mid-gray ramp: the solved whites/blacks must open it toward the
      // clipping targets through the engine's own tone equation.
      const auto source = ramp(90, 170);
      const auto suggestion = lenslabs::suggest_develop(source);
      check(suggestion.contrast > 0 && suggestion.whites > 0 && suggestion.blacks < 0, "A flat frame is opened up.");
      const auto developed = lenslabs::develop(source, recipe(suggestion));
      const auto last = (std::size_t(developed.width) - 1) * 4;
      check(developed.rgba[last + 1] - developed.rgba[1] > source.rgba[last + 1] - source.rgba[1] + 15,
            "The developed tonal range is measurably wider.");
      check(suggestion.vibrance == 0, "A monochrome frame is not given vibrance.");
      check(developed.rgba[last + 1] < 255 && developed.rgba[1] > 0, "Opening the range does not clip it.");
    }
    {
      // Warm cast: red high, blue low. The correction must cool the frame and
      // bring the channel means together.
      const auto source = ramp(60, 200, 1.12, .88);
      const auto suggestion = lenslabs::suggest_develop(source);
      check(suggestion.white_balance_measured && suggestion.temperature < 0, "A warm cast is measured and cooled.");
      const auto developed = lenslabs::develop(source, recipe(suggestion));
      const double cast_before = mean_channel(source, 0) - mean_channel(source, 2);
      const double cast_after = mean_channel(developed, 0) - mean_channel(developed, 2);
      check(std::abs(cast_after) < std::abs(cast_before) * .6, "The developed frame is measurably more neutral.");
    }
    {
      // A saturated single-color scene offers no neutral evidence.
      lenslabs::Image red = ramp(40, 220);
      for (std::size_t i = 0; i < red.rgba.size(); i += 4) { red.rgba[i + 1] /= 4; red.rgba[i + 2] /= 4; }
      const auto suggestion = lenslabs::suggest_develop(red);
      check(!suggestion.white_balance_measured && suggestion.temperature == 0 && suggestion.tint == 0,
            "A colored scene is not mistaken for a color cast.");
    }
    {
      const auto large = ramp(10, 245, 1, 1, 4096, 2048);
      lenslabs::validate_develop(recipe(lenslabs::suggest_develop(large)));
      check(true, "A large working image stays within recipe limits.");
    }
    std::cout << "PASS develop-auto: " << checks << " checks\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "FAIL develop-auto: " << error.what() << "\n";
    return 1;
  }
}
