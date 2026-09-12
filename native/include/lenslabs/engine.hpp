#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace lenslabs {

inline constexpr const char* engine_version = "lenslabs-cpp-0.1";

// Owned, tightly packed, upright sRGB RGBA8. Never aliases the source file.
struct Image {
  std::uint32_t width = 0;
  std::uint32_t height = 0;
  std::uint32_t source_width = 0;
  std::uint32_t source_height = 0;
  std::vector<std::uint8_t> rgba;
};

enum class Verdict { undecided, keep, reject };

struct Analysis {
  double sharpness = 0;
  double brightness = 0;
  double clipped_highlights = 0;
  double clipped_shadows = 0;
  std::array<std::uint32_t, 256> histogram{};
  std::uint64_t hash = 0;
  int score = 0;
  bool blur = false;
  bool soft = false;
  bool underexposed = false;
  bool overexposed = false;
};

struct Edits {
  double exposure_ev = 0;
  double contrast = 0;
  double highlights = 0;
  double shadows = 0;
  double saturation = 0;
};

// Bright natural light (Central Park noon): pull highlights first, then lift
// faces. Not an artistic look. Zero when the frame is already a normal key.
struct LightRecipe {
  double exposure_ev = 0;
  double highlights = 0;
  double shadows = 0;
  double whites = 0;
  double blacks = 0;
};
LightRecipe suggest_light(const Analysis& analysis);

// Pure C++ kernels. These are mechanical signals, not trained AI judgments.
Analysis analyze(const Image& image);
Image render(const Image& image, const Edits& edits);
Verdict first_pass(const Analysis& analysis, Verdict existing = Verdict::undecided);
const char* verdict_name(Verdict verdict) noexcept;
unsigned hamming_distance(std::uint64_t a, std::uint64_t b) noexcept;

// macOS decoder adapter uses system ImageIO via C APIs from a .cpp file.
// max_edge bounds the decoded working image; no source file is modified.
Image decode_preview(const std::filesystem::path& path, std::uint32_t max_edge = 256);
std::vector<std::uint8_t> encode_jpeg(const Image& image, double quality = 0.9);
const char* decoder_name() noexcept;

} // namespace lenslabs
