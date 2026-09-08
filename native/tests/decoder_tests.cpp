#include "lenslabs/engine.hpp"

#include <CoreFoundation/CoreFoundation.h>
#include <ImageIO/ImageIO.h>

#include <array>
#include <cerrno>
#include <cstring>
#include <cstdlib>
#include <fcntl.h>
#include <fstream>
#include <functional>
#include <future>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <sys/stat.h>
#include <unistd.h>

namespace {
int assertions = 0;

void require(bool condition, const std::string& message) {
  ++assertions;
  if (!condition) throw std::runtime_error(message);
}

void rejects(const std::function<void()>& operation, const std::string& message) {
  bool rejected = false;
  try { operation(); }
  catch (const std::exception& error) {
    rejected = true;
    require(std::string(error.what()).find(message) != std::string::npos,
            "Unexpected rejection: " + std::string(error.what()));
  }
  require(rejected, "Expected rejection containing: " + message);
}

std::vector<std::uint8_t> read_bytes(const std::filesystem::path& path) {
  std::ifstream stream(path, std::ios::binary | std::ios::ate);
  if (!stream) throw std::runtime_error("Fixture could not be opened: " + path.string());
  const auto size = stream.tellg();
  if (size < 0 || size > 128 * 1024 * 1024) throw std::runtime_error("Unexpected fixture size.");
  std::vector<std::uint8_t> bytes(static_cast<std::size_t>(size));
  stream.seekg(0);
  if (!stream.read(reinterpret_cast<char*>(bytes.data()), size))
    throw std::runtime_error("Fixture could not be read fully.");
  return bytes;
}

class TemporaryFiles {
 public:
  TemporaryFiles() {
    std::array<char, 64> pattern{};
    std::strcpy(pattern.data(), "/private/tmp/lenslabs-decoder-tests-XXXXXX");
    const auto created = mkdtemp(pattern.data());
    if (!created) throw std::runtime_error("Could not create exclusive test directory.");
    directory_ = created;
  }
  ~TemporaryFiles() {
    for (const auto& path : paths_) unlink(path.c_str());
    rmdir(directory_.c_str());
  }
  TemporaryFiles(const TemporaryFiles&) = delete;
  TemporaryFiles& operator=(const TemporaryFiles&) = delete;
  const std::filesystem::path& directory() const { return directory_; }
  std::filesystem::path write(const char* name, const std::vector<std::uint8_t>& bytes) {
    const auto path = directory_ / name;
    const int fd = open(path.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (fd < 0) throw std::runtime_error("Could not create exclusive test file.");
    paths_.push_back(path);
    std::size_t offset = 0;
    while (offset < bytes.size()) {
      const auto count = ::write(fd, bytes.data() + offset, bytes.size() - offset);
      if (count < 0 && errno == EINTR) continue;
      if (count <= 0) { close(fd); throw std::runtime_error("Could not write test bytes."); }
      offset += static_cast<std::size_t>(count);
    }
    if (close(fd) != 0) throw std::runtime_error("Could not close test file.");
    return path;
  }
  std::filesystem::path oversized() {
    const auto path = write("oversized.jpg", {});
    const int fd = open(path.c_str(), O_WRONLY | O_NOFOLLOW | O_CLOEXEC);
    if (fd < 0) throw std::runtime_error("Could not open sparse test file.");
    const int result = ftruncate(fd, static_cast<off_t>(512ULL * 1024 * 1024 + 1));
    close(fd);
    if (result != 0) throw std::runtime_error("Could not size sparse test file.");
    return path;
  }
  std::filesystem::path link_to(const std::filesystem::path& original) {
    const auto path = directory_ / "symlink.jpg";
    if (symlink(std::filesystem::absolute(original).c_str(), path.c_str()) != 0)
      throw std::runtime_error("Could not create test symlink.");
    paths_.push_back(path);
    return path;
  }
 private:
  std::filesystem::path directory_;
  std::vector<std::filesystem::path> paths_;
};

template <class T> class OwnedCF {
 public:
  explicit OwnedCF(T value) : value_(value) {}
  ~OwnedCF() { if (value_) CFRelease(value_); }
  OwnedCF(const OwnedCF&) = delete;
  OwnedCF& operator=(const OwnedCF&) = delete;
  T get() const { return value_; }
 private:
  T value_;
};

void verify_encoded_metadata(const std::vector<std::uint8_t>& bytes) {
  OwnedCF<CFDataRef> data(CFDataCreate(kCFAllocatorDefault, bytes.data(), bytes.size()));
  OwnedCF<CGImageSourceRef> source(CGImageSourceCreateWithData(data.get(), nullptr));
  require(source.get() != nullptr, "Encoded bytes must be readable JPEG.");
  require(CFEqual(CGImageSourceGetType(source.get()), CFSTR("public.jpeg")), "Output format must be JPEG.");
  OwnedCF<CFDictionaryRef> properties(CGImageSourceCopyPropertiesAtIndex(source.get(), 0, nullptr));
  require(properties.get() != nullptr, "Encoded JPEG must expose metadata.");
  const auto orientation = static_cast<CFNumberRef>(CFDictionaryGetValue(properties.get(), kCGImagePropertyOrientation));
  int value = 0;
  require(orientation && CFGetTypeID(orientation) == CFNumberGetTypeID() &&
          CFNumberGetValue(orientation, kCFNumberIntType, &value) && value == 1,
          "Encoded JPEG orientation must be explicitly upright.");
  const auto profile = static_cast<CFStringRef>(CFDictionaryGetValue(properties.get(), kCGImagePropertyProfileName));
  require(profile && CFGetTypeID(profile) == CFStringGetTypeID() &&
          CFStringFind(profile, CFSTR("sRGB"), kCFCompareCaseInsensitive).location != kCFNotFound,
          "Encoded JPEG must carry an sRGB profile.");
}

void real_photographs(const std::filesystem::path& fixtures, TemporaryFiles& temporary) {
  struct Fixture { const char* name; std::uint32_t width; std::uint32_t height; };
  const std::array<Fixture, 3> cases{{
    {"volleyball-portrait-cc0.jpg", 3000, 4000},
    {"basketball-action-usaf-pd.jpg", 2256, 1420},
    {"basketball-hangar-usnavy-pd.jpg", 4256, 2832},
  }};
  for (const auto& test : cases) {
    const auto path = fixtures / test.name;
    const auto original = read_bytes(path);
    const auto image = lenslabs::decode_preview(path);
    require(image.source_width == test.width && image.source_height == test.height,
            std::string("Wrong upright source dimensions: ") + test.name);
    require(image.width > 0 && image.height > 0 && image.width <= 256 && image.height <= 256,
            "Preview exceeds its requested 256-pixel edge.");
    require(image.rgba.size() == static_cast<std::size_t>(image.width) * image.height * 4,
            "Preview must own tightly packed RGBA bytes.");
    for (std::size_t i = 3; i < image.rgba.size(); i += 4)
      if (image.rgba[i] != 255) throw std::runtime_error("Native preview is not opaque.");
    const auto jpeg = lenslabs::encode_jpeg(image);
    verify_encoded_metadata(jpeg);
    const auto encoded_path = temporary.write(test.name, jpeg);
    const auto reopened = lenslabs::decode_preview(encoded_path);
    require(reopened.source_width == image.width && reopened.source_height == image.height,
            "Encoded preview changed orientation/dimensions on reopen.");
    require(read_bytes(path) == original, "Decoding/encoding changed original file bytes.");
    std::cout << test.name << ": source " << image.source_width << 'x' << image.source_height
              << ", preview " << image.width << 'x' << image.height
              << ", original bytes unchanged (" << original.size() << ")\n";
  }
}

void encoding_pixels(TemporaryFiles& temporary) {
  lenslabs::Image pattern{64, 48, 64, 48, std::vector<std::uint8_t>(64 * 48 * 4, 255)};
  for (std::uint32_t y = 0; y < pattern.height; ++y)
    for (std::uint32_t x = 0; x < pattern.width; ++x) {
      const auto i = (static_cast<std::size_t>(y) * pattern.width + x) * 4;
      pattern.rgba[i] = y < pattern.height / 2 ? 255 : 0;
      pattern.rgba[i + 1] = 0;
      pattern.rgba[i + 2] = y < pattern.height / 2 ? 0 : 255;
    }
  const auto unchanged = pattern.rgba;
  const auto jpeg = lenslabs::encode_jpeg(pattern, 1);
  const auto reopened = lenslabs::decode_preview(temporary.write("upright-colors.jpg", jpeg), 64);
  const auto top = (static_cast<std::size_t>(4) * reopened.width + 4) * 4;
  const auto bottom = (static_cast<std::size_t>(reopened.height - 5) * reopened.width + 4) * 4;
  require(reopened.rgba[top] > 220 && reopened.rgba[top + 2] < 35, "Top red pixels were flipped or channel-swapped.");
  require(reopened.rgba[bottom + 2] > 220 && reopened.rgba[bottom] < 35, "Bottom blue pixels were flipped or channel-swapped.");
  require(pattern.rgba == unchanged, "JPEG encoding must not mutate input Image pixels.");
  require(!lenslabs::encode_jpeg(pattern, 0).empty(), "Quality zero is a valid JPEG setting.");

  lenslabs::Image transparent{8, 8, 8, 8, std::vector<std::uint8_t>(8 * 8 * 4, 0)};
  const auto white = lenslabs::decode_preview(temporary.write("composited-white.jpg", lenslabs::encode_jpeg(transparent)), 8);
  require(white.rgba[0] >= 250 && white.rgba[1] >= 250 && white.rgba[2] >= 250 && white.rgba[3] == 255,
          "Transparent input must composite onto opaque white before JPEG encoding.");
}

void invalid_inputs(const std::filesystem::path& fixtures, TemporaryFiles& temporary) {
  const auto good = fixtures / "volleyball-portrait-cc0.jpg";
  const auto minimum = lenslabs::decode_preview(good, 8);
  require(minimum.width <= 8 && minimum.height <= 8 && minimum.source_width == 3000 &&
          minimum.source_height == 4000, "The minimum preview bound must preserve upright source dimensions.");
  rejects([&] { lenslabs::decode_preview(good, 7); }, "max_edge");
  rejects([&] { lenslabs::decode_preview(good, 4097); }, "max_edge");
  rejects([&] { lenslabs::decode_preview(temporary.directory() / "missing.jpg"); }, "Could not open");
  rejects([&] { lenslabs::decode_preview(temporary.directory()); }, "regular file");
  rejects([&] { lenslabs::decode_preview(temporary.link_to(good)); }, "symlinks");
  rejects([&] { lenslabs::decode_preview(temporary.write("empty.jpg", {})); }, "nonempty");
  rejects([&] { lenslabs::decode_preview(temporary.oversized()); }, "512 MiB");
  rejects([&] { lenslabs::decode_preview(std::filesystem::path(std::string("bad\0path", 8))); }, "NUL");
  rejects([&] { lenslabs::decode_preview(temporary.write("unsupported.nef", {1, 2, 3, 4, 5})); }, "Unsupported");
  auto truncated = read_bytes(good);
  truncated.resize(40);
  rejects([&] { lenslabs::decode_preview(temporary.write("truncated.jpg", truncated)); }, "dimensions");

  auto huge = read_bytes(good);
  bool changed = false;
  for (std::size_t offset = 2; offset + 9 < huge.size();) {
    if (huge[offset] != 0xff || huge[offset + 1] == 0xda) break;
    const auto marker = huge[offset + 1];
    const auto length = static_cast<std::size_t>((huge[offset + 2] << 8) | huge[offset + 3]);
    if (marker == 0xc0 || marker == 0xc2) {
      huge[offset + 5] = huge[offset + 6] = huge[offset + 7] = huge[offset + 8] = 0xff;
      changed = true;
      break;
    }
    if (length < 2) break;
    offset += length + 2;
  }
  require(changed, "Fixture must expose a JPEG size marker for the pixel-limit regression.");
  rejects([&] { lenslabs::decode_preview(temporary.write("pixel-limit.jpg", huge)); }, "250-million-pixel");

  lenslabs::Image image{8, 8, 8, 8, std::vector<std::uint8_t>(8 * 8 * 4, 255)};
  for (const double quality : {-0.1, 1.1, std::numeric_limits<double>::infinity(), std::numeric_limits<double>::quiet_NaN()})
    rejects([&] { lenslabs::encode_jpeg(image, quality); }, "quality");
  image.rgba.pop_back();
  rejects([&] { lenslabs::encode_jpeg(image); }, "exactly");
  rejects([&] { lenslabs::encode_jpeg({}); }, "dimensions");
}

void raw_previews(TemporaryFiles& temporary) {
  const auto root = std::getenv("LENSLABS_RAW_FIXTURES");
  if (!root) {
    std::cout << "SKIP: optional CC0 Sony RAW fixtures (set LENSLABS_RAW_FIXTURES; see native/README.md)\n";
    return;
  }
  for (const auto name : {"sony-a6000.ARW", "sony-a7iv-small.ARW"}) {
    const auto path = std::filesystem::path(root) / name;
    const auto before = read_bytes(path);
    // Match the native pipeline's macOS worker stack, not only the larger main stack.
    const auto preview = std::async(std::launch::async, [&] { return lenslabs::decode_preview(path, 1280); }).get();
    require(preview.width > 100 && preview.height > 100 && preview.width <= 1280 && preview.height <= 1280,
            "A real Sony RAW must provide a bounded, useful preview.");
    require(preview.source_width > preview.width && preview.source_height > preview.height,
            "RAW dimensions must come from the capture, not the JPEG thumbnail.");
    // The loopback worker spools uploads without filename extensions.
    const auto extensionless = temporary.write(name == std::string("sony-a6000.ARW") ? "sony-source-1" : "sony-source-2", before);
    const auto spooled = lenslabs::decode_preview(extensionless, 1280);
    require(spooled.rgba == preview.rgba, "Extensionless transport must decode identical RAW preview pixels.");
    const auto jpeg = lenslabs::encode_jpeg(preview);
    verify_encoded_metadata(jpeg);
    const auto output = temporary.write(name == std::string("sony-a6000.ARW") ? "raw-export-1.jpg" : "raw-export-2.jpg", jpeg);
    const auto reopened = lenslabs::decode_preview(output, 1280);
    require(reopened.width == preview.width && reopened.height == preview.height,
            "RAW preview export must reopen with the same upright geometry.");
    require(read_bytes(path) == before, "RAW source bytes must stay unchanged.");
    std::cout << name << ": source " << preview.source_width << 'x' << preview.source_height
              << ", preview " << preview.width << 'x' << preview.height << ", original bytes unchanged\n";
    // Rotate a disposable copy's TIFF orientation, not the fixture's source bytes.
    // Both fixture containers are little-endian TIFF; keep the camera JPEG intact.
    require(before[0] == 'I' && before[1] == 'I', "Expected the documented little-endian Sony fixtures.");
    const auto u16 = [&](std::size_t i) { return static_cast<unsigned>(before.at(i)) | (before.at(i + 1) << 8); };
    const auto u32 = [&](std::size_t i) { return u16(i) | (static_cast<std::uint32_t>(u16(i + 2)) << 16); };
    const auto ifd = u32(4);
    std::size_t orientation_value = 0;
    for (unsigned entry = 0; entry < u16(ifd); ++entry) {
      const auto offset = ifd + 2 + entry * 12;
      if (u16(offset) == 274 && u16(offset + 2) == 3 && u32(offset + 4) == 1)
        orientation_value = offset + 8;
    }
    require(orientation_value != 0 && u16(orientation_value) == 1, "Fixture must carry normal TIFF orientation.");
    for (const unsigned rotation : {3, 6, 8}) {
      auto rotated = before;
      rotated[orientation_value] = static_cast<std::uint8_t>(rotation);
      const auto filename = std::string(name) + "-rotation-" + std::to_string(rotation);
      const auto frame = lenslabs::decode_preview(temporary.write(filename.c_str(), rotated), 1280);
      const bool quarter_turn = rotation != 3;
      require(frame.width == (quarter_turn ? preview.height : preview.width) &&
              frame.height == (quarter_turn ? preview.width : preview.height),
              "RAW preview must apply the container's orientation exactly once.");
      require(frame.source_width == (quarter_turn ? preview.source_height : preview.source_width),
              "RAW source dimensions must track its orientation.");
      // The rotated upper-left pixel comes from the matching original corner.
      const auto expected_pixel = rotation == 3 ? (preview.width * preview.height - 1) * 4 :
          rotation == 6 ? ((preview.height - 1) * preview.width) * 4 : (preview.width - 1) * 4;
      for (unsigned channel = 0; channel < 3; ++channel)
        require(std::abs(static_cast<int>(frame.rgba[channel]) - preview.rgba[expected_pixel + channel]) <= 3,
                "RAW orientation must rotate actual pixels, not only swap dimensions.");
    }
    auto truncated = before;
    truncated.resize(256);
    bool refused = false;
    try { lenslabs::decode_preview(temporary.write(name == std::string("sony-a6000.ARW") ? "truncated-1.ARW" : "truncated-2.ARW", truncated)); }
    catch (const std::exception&) { refused = true; }
    require(refused, "Truncated RAW must fail, never fabricate a preview or score.");
  }
}

}  // namespace

int main(int argc, char** argv) {
  try {
    const std::filesystem::path fixtures = argc > 1 ? argv[1] : "tests/fixtures/photos";
    TemporaryFiles temporary;
    require(std::string(lenslabs::decoder_name()).find("ImageIO") != std::string::npos, "Decoder must identify its system adapter.");
    real_photographs(fixtures, temporary);
    encoding_pixels(temporary);
    raw_previews(temporary);
    invalid_inputs(fixtures, temporary);
    std::cout << "PASS: " << assertions << " native decoder assertions\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "FAIL: " << error.what() << '\n';
    return 1;
  }
}
