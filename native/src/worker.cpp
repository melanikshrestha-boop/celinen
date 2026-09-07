#include "lenslabs/worker.hpp"
#include "lenslabs/pipeline.hpp"

#include <CoreFoundation/CoreFoundation.h>
#include <CoreGraphics/CoreGraphics.h>
#include <ImageIO/ImageIO.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cerrno>
#include <charconv>
#include <chrono>
#include <cmath>
#include <fcntl.h>
#include <iomanip>
#include <istream>
#include <locale>
#include <optional>
#include <ostream>
#include <sstream>
#include <stdexcept>
#include <sys/stat.h>
#include <unistd.h>

namespace lenslabs {
namespace {
constexpr std::size_t max_request_bytes = 8192;

template<class T> class OwnedCF {
 public:
  explicit OwnedCF(T value) : value_(value) {}
  ~OwnedCF() { if (value_) CFRelease(value_); }
  OwnedCF(const OwnedCF&) = delete;
  OwnedCF& operator=(const OwnedCF&) = delete;
  T get() const { return value_; }
 private:
  T value_;
};

class Descriptor {
 public:
  explicit Descriptor(int value) : value_(value) {}
  ~Descriptor() { if (value_ >= 0) close(value_); }
  Descriptor(const Descriptor&) = delete;
  Descriptor& operator=(const Descriptor&) = delete;
  int get() const { return value_; }
 private:
  int value_;
};

struct Metadata {
  std::optional<std::int64_t> captured_at_ms;
  std::string basis;
  std::string camera_key;
  std::string camera_key_basis;
  std::string camera_model;
};

bool same_snapshot(const struct stat& a, const struct stat& b) {
  return a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_size == b.st_size &&
    a.st_mtimespec.tv_sec == b.st_mtimespec.tv_sec && a.st_mtimespec.tv_nsec == b.st_mtimespec.tv_nsec &&
    a.st_ctimespec.tv_sec == b.st_ctimespec.tv_sec && a.st_ctimespec.tv_nsec == b.st_ctimespec.tv_nsec;
}

struct stat snapshot(const std::filesystem::path& path) {
  struct stat value{};
  if (lstat(path.c_str(), &value) != 0 || !S_ISREG(value.st_mode))
    throw std::runtime_error("Input must be an existing regular file, not a symlink");
  return value;
}

std::string text_property(CFDictionaryRef dictionary, CFStringRef key) {
  if (!dictionary) return {};
  const auto value = CFDictionaryGetValue(dictionary, key);
  if (!value || CFGetTypeID(value) != CFStringGetTypeID()) return {};
  const auto text = static_cast<CFStringRef>(value);
  if (CFStringGetLength(text) > 256) return {};
  std::array<char, 1025> bytes{};
  if (!CFStringGetCString(text, bytes.data(), bytes.size(), kCFStringEncodingUTF8)) return {};
  std::string result(bytes.data());
  while (!result.empty() && result.back() == ' ') result.pop_back();
  const auto first = result.find_first_not_of(' ');
  return first == std::string::npos ? std::string{} : result.substr(first);
}

CFDictionaryRef dictionary_property(CFDictionaryRef dictionary, CFStringRef key) {
  if (!dictionary) return nullptr;
  const auto value = CFDictionaryGetValue(dictionary, key);
  return value && CFGetTypeID(value) == CFDictionaryGetTypeID()
    ? static_cast<CFDictionaryRef>(value) : nullptr;
}

int digits(const std::string& text, std::size_t offset, std::size_t count) {
  if (offset + count > text.size()) return -1;
  int result = 0;
  for (std::size_t i = offset; i < offset + count; ++i) {
    if (text[i] < '0' || text[i] > '9') return -1;
    result = result * 10 + text[i] - '0';
  }
  return result;
}

void parse_capture_time(Metadata& metadata, const std::string& date,
                        const std::string& subsecond, const std::string& offset) {
  if (date.size() != 19 || date[4] != ':' || date[7] != ':' || date[10] != ' ' ||
      date[13] != ':' || date[16] != ':') return;
  const auto year = digits(date, 0, 4), month = digits(date, 5, 2), day = digits(date, 8, 2);
  const auto hour = digits(date, 11, 2), minute = digits(date, 14, 2), second = digits(date, 17, 2);
  const std::chrono::year_month_day calendar{
    std::chrono::year(year), std::chrono::month(static_cast<unsigned>(month)), std::chrono::day(static_cast<unsigned>(day))};
  if (year < 1900 || year > 9999 || !calendar.ok() || hour < 0 || hour > 23 ||
      minute < 0 || minute > 59 || second < 0 || second > 59) return;
  int milliseconds = 0;
  if (!subsecond.empty()) {
    if (subsecond.size() > 9 || digits(subsecond, 0, subsecond.size()) < 0) return;
    for (std::size_t n = 0; n < 3; ++n)
      milliseconds = milliseconds * 10 + (n < subsecond.size() ? subsecond[n] - '0' : 0);
  }
  auto time = std::chrono::sys_days(calendar) + std::chrono::hours(hour) +
    std::chrono::minutes(minute) + std::chrono::seconds(second) + std::chrono::milliseconds(milliseconds);
  metadata.basis = "camera_clock";
  if (!offset.empty()) {
    const auto hours = digits(offset, 1, 2), minutes = digits(offset, 4, 2);
    if (offset.size() != 6 || (offset[0] != '+' && offset[0] != '-') || offset[3] != ':' ||
        hours < 0 || hours > 14 || minutes < 0 || minutes > 59 || (hours == 14 && minutes != 0)) return;
    const auto sign = offset[0] == '-' ? -1 : 1;
    time -= std::chrono::minutes(sign * (hours * 60 + minutes));
    metadata.basis = "utc";
  }
  const auto captured_at_ms = std::chrono::duration_cast<std::chrono::milliseconds>(time.time_since_epoch()).count();
  // The burst contract reserves nonpositive values for "unknown". An old or
  // misconfigured camera clock must not make an otherwise valid photo fail.
  if (captured_at_ms <= 0) { metadata.basis.clear(); return; }
  metadata.captured_at_ms = captured_at_ms;
}

struct BoundedInput {
  int descriptor;
  off_t size;
  std::atomic<bool> failed{false};
};

std::size_t metadata_read(void* opaque, void* buffer, off_t position, std::size_t count) noexcept {
  auto& input = *static_cast<BoundedInput*>(opaque);
  if (position < 0 || position >= input.size) return 0;
  count = std::min(count, static_cast<std::size_t>(input.size - position));
  std::size_t read = 0;
  while (read < count) {
    const auto n = pread(input.descriptor, static_cast<char*>(buffer) + read, count - read, position + read);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) { input.failed.store(true); break; }
    read += static_cast<std::size_t>(n);
  }
  return read;
}

Metadata read_metadata(const std::filesystem::path& path, const struct stat& expected) {
  Metadata result;
  Descriptor file(open(path.c_str(), O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC));
  struct stat before{};
  if (file.get() < 0 || fstat(file.get(), &before) != 0 || !same_snapshot(expected, before))
    throw std::runtime_error("Input changed before metadata was read");
  if (before.st_size <= 0 || before.st_size > 512LL * 1024 * 1024)
    throw std::runtime_error("Input exceeds the 512 MiB source bound");
  BoundedInput input{file.get(), before.st_size};
  const CGDataProviderDirectCallbacks callbacks{0, nullptr, nullptr, metadata_read, nullptr};
  OwnedCF<CGDataProviderRef> provider(CGDataProviderCreateDirect(&input, input.size, &callbacks));
  if (!provider.get()) return result;
  const void* keys[]{kCGImageSourceShouldCache};
  const void* values[]{kCFBooleanFalse};
  OwnedCF<CFDictionaryRef> options(CFDictionaryCreate(kCFAllocatorDefault, keys, values, 1,
      &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks));
  OwnedCF<CGImageSourceRef> source(CGImageSourceCreateWithDataProvider(provider.get(), options.get()));
  if (!source.get() || CGImageSourceGetCount(source.get()) == 0) return result;
  OwnedCF<CFDictionaryRef> properties(CGImageSourceCopyPropertiesAtIndex(
    source.get(), CGImageSourceGetPrimaryImageIndex(source.get()), options.get()));
  if (!properties.get()) return result;
  const auto exif = dictionary_property(properties.get(), kCGImagePropertyExifDictionary);
  const auto tiff = dictionary_property(properties.get(), kCGImagePropertyTIFFDictionary);
  parse_capture_time(result, text_property(exif, kCGImagePropertyExifDateTimeOriginal),
    text_property(exif, kCGImagePropertyExifSubsecTimeOriginal), text_property(exif, CFSTR("OffsetTimeOriginal")));
  const auto make = text_property(tiff, kCGImagePropertyTIFFMake);
  const auto model = text_property(tiff, kCGImagePropertyTIFFModel);
  const auto serial = text_property(exif, kCGImagePropertyExifBodySerialNumber);
  // Length-prefixed components prevent ambiguous camera-key concatenations.
  result.camera_model = make + (make.empty() || model.empty() ? "" : " ") + model;
  if (!serial.empty()) {
    result.camera_key = std::to_string(make.size()) + ":" + make + std::to_string(model.size()) + ":" + model +
      std::to_string(serial.size()) + ":" + serial;
    // Match the transport's UTF-8 byte bound. Do not truncate an identity:
    // truncation could merge two different cameras into the same burst group.
    if (result.camera_key.size() > 512) result.camera_key.clear();
    else result.camera_key_basis = "make_model_serial";
  }
  struct stat after{};
  if (input.failed.load() || fstat(file.get(), &after) != 0 || !same_snapshot(before, after))
    throw std::runtime_error("Input changed while metadata was being read");
  return result;
}

struct Request { unsigned edge; std::filesystem::path path; };
int hex_digit(char value) {
  if (value >= '0' && value <= '9') return value - '0';
  if (value >= 'a' && value <= 'f') return value - 'a' + 10;
  if (value >= 'A' && value <= 'F') return value - 'A' + 10;
  return -1;
}

Request parse_request(const std::string& line) {
  if (!line.starts_with("LENS1 ")) throw std::invalid_argument("Unsupported worker protocol");
  const auto separator = line.find(' ', 6);
  if (separator == std::string::npos) throw std::invalid_argument("Malformed worker request");
  unsigned edge = 0;
  const auto number = std::from_chars(line.data() + 6, line.data() + separator, edge);
  if (number.ec != std::errc{} || number.ptr != line.data() + separator || edge < 8 || edge > 2048)
    throw std::invalid_argument("Preview edge must be 8..2048");
  const auto hex = line.substr(separator + 1);
  if (hex.empty() || hex.size() % 2 != 0) throw std::invalid_argument("Path must be nonempty hexadecimal bytes");
  std::string path;
  path.reserve(hex.size() / 2);
  for (std::size_t i = 0; i < hex.size(); i += 2) {
    const auto hi = hex_digit(hex[i]), lo = hex_digit(hex[i + 1]);
    if (hi < 0 || lo < 0 || (hi == 0 && lo == 0)) throw std::invalid_argument("Invalid hexadecimal path");
    path.push_back(static_cast<char>(hi * 16 + lo));
  }
  if (path[0] != '/') throw std::invalid_argument("Worker requires an absolute input path");
  return {edge, path};
}

void emit_error(std::ostream& output, const char* message) {
  output << "{\"ok\":false,\"error\":" << json_string(message) << ",\"preview_bytes\":0}\n" << std::flush;
}

void process_request(const Request& request, std::ostream& output) {
  const auto started = std::chrono::steady_clock::now();
  const auto before = snapshot(request.path);
  const auto preview = decode_preview(request.path, request.edge);
  const auto bounded = analysis_preview(preview);
  const auto a = analyze(bounded);
  const auto metadata = read_metadata(request.path, before);
  const auto jpeg = encode_jpeg(preview, 0.8);
  if (!same_snapshot(before, snapshot(request.path))) throw std::runtime_error("Input changed during processing");
  std::ostringstream header;
  header.imbue(std::locale::classic());
  header << std::setprecision(10);
  std::ostringstream hash;
  hash << std::hex << std::setw(16) << std::setfill('0') << a.hash;
  header << "{\"ok\":true,\"engine\":" << json_string(engine_version)
    << ",\"decoder\":" << json_string(decoder_name())
    << ",\"width\":" << preview.width << ",\"height\":" << preview.height
    << ",\"source_width\":" << preview.source_width << ",\"source_height\":" << preview.source_height
    << ",\"analysis_edge\":256,\"analysis_width\":" << bounded.width << ",\"analysis_height\":" << bounded.height
    << ",\"sharpness\":" << a.sharpness << ",\"brightness\":" << a.brightness
    << ",\"clipped_highlights\":" << a.clipped_highlights << ",\"clipped_shadows\":" << a.clipped_shadows
    << ",\"score\":" << a.score << ",\"hash\":" << json_string(hash.str())
    << ",\"blur\":" << (a.blur ? "true" : "false") << ",\"soft\":" << (a.soft ? "true" : "false")
    << ",\"underexposed\":" << (a.underexposed ? "true" : "false")
    << ",\"overexposed\":" << (a.overexposed ? "true" : "false")
    << ",\"review_required\":true,\"histogram\":[";
  for (std::size_t i = 0; i < a.histogram.size(); ++i) {
    if (i) header << ',';
    header << a.histogram[i];
  }
  const auto pixel_count = static_cast<std::size_t>(bounded.width) * bounded.height;
  auto percentile = [&](double quantile) {
    const auto target = std::max<std::size_t>(1, static_cast<std::size_t>(std::ceil(quantile * pixel_count)));
    std::size_t count = 0;
    for (unsigned value = 0; value < 256; ++value) {
      count += a.histogram[value];
      if (count >= target) return value;
    }
    return 255u;
  };
  std::array<double, 3> means{};
  double saturation = 0;
  for (std::size_t offset = 0; offset < bounded.rgba.size(); offset += 4) {
    const auto r = bounded.rgba[offset], g = bounded.rgba[offset + 1], b = bounded.rgba[offset + 2];
    const auto high = std::max({r, g, b}), low = std::min({r, g, b});
    means[0] += r; means[1] += g; means[2] += b;
    saturation += high ? static_cast<double>(high - low) / high : 0;
  }
  header << "],\"tone\":{\"black\":" << percentile(0.02) << ",\"white\":" << percentile(0.98)
    << ",\"median\":" << std::max(1u, percentile(0.5))
    << ",\"rMean\":" << means[0] / pixel_count << ",\"gMean\":" << means[1] / pixel_count
    << ",\"bMean\":" << means[2] / pixel_count << ",\"satMean\":" << saturation / pixel_count
    << "},\"captured_at_ms\":";
  if (metadata.captured_at_ms) header << *metadata.captured_at_ms; else header << "null";
  header << ",\"capture_time_basis\":" << (metadata.captured_at_ms ? json_string(metadata.basis) : "null")
    << ",\"capture_time_source\":" << (metadata.captured_at_ms ? "\"exif\"" : "null")
    << ",\"camera_key\":" << (metadata.camera_key.empty() ? "null" : json_string(metadata.camera_key))
    << ",\"camera_key_basis\":" << (metadata.camera_key.empty() ? "null" : json_string(metadata.camera_key_basis))
    << ",\"camera_model\":" << (metadata.camera_model.empty() ? "null" : json_string(metadata.camera_model))
    << ",\"preview_bytes\":" << jpeg.size() << ",\"elapsed_ms\":"
    << std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count() << "}\n";
  output << header.str();
  output.write(reinterpret_cast<const char*>(jpeg.data()), static_cast<std::streamsize>(jpeg.size()));
  output.flush();
}
} // namespace

Image analysis_preview(const Image& image) {
  if (!image.width || !image.height || image.width > 2048 || image.height > 2048 ||
      image.rgba.size() != static_cast<std::size_t>(image.width) * image.height * 4)
    throw std::invalid_argument("Invalid bounded worker preview");
  if (image.width <= 256 && image.height <= 256) return image;
  const auto ratio = 256.0 / std::max(image.width, image.height);
  Image result;
  result.width = std::max(1u, static_cast<unsigned>(std::lround(image.width * ratio)));
  result.height = std::max(1u, static_cast<unsigned>(std::lround(image.height * ratio)));
  result.source_width = image.source_width;
  result.source_height = image.source_height;
  result.rgba.resize(static_cast<std::size_t>(result.width) * result.height * 4);
  for (unsigned y = 0; y < result.height; ++y) {
    const auto top = static_cast<double>(y) * image.height / result.height;
    const auto bottom = static_cast<double>(y + 1) * image.height / result.height;
    for (unsigned x = 0; x < result.width; ++x) {
      const auto left = static_cast<double>(x) * image.width / result.width;
      const auto right = static_cast<double>(x + 1) * image.width / result.width;
      std::array<double, 4> sum{};
      for (unsigned sy = static_cast<unsigned>(top); sy < std::min(image.height, static_cast<unsigned>(std::ceil(bottom))); ++sy) {
        const double weight_y = std::min(bottom, sy + 1.0) - std::max(top, static_cast<double>(sy));
        for (unsigned sx = static_cast<unsigned>(left); sx < std::min(image.width, static_cast<unsigned>(std::ceil(right))); ++sx) {
          const double weight = weight_y * (std::min(right, sx + 1.0) - std::max(left, static_cast<double>(sx)));
          const auto source = (static_cast<std::size_t>(sy) * image.width + sx) * 4;
          for (unsigned c = 0; c < 4; ++c) sum[c] += image.rgba[source + c] * weight;
        }
      }
      const auto target = (static_cast<std::size_t>(y) * result.width + x) * 4;
      for (unsigned c = 0; c < 4; ++c)
        result.rgba[target + c] = static_cast<std::uint8_t>(std::clamp(std::lround(sum[c] / ((right - left) * (bottom - top))), 0L, 255L));
    }
  }
  return result;
}

int run_worker(std::istream& input, std::ostream& output) {
  while (input && output) {
    std::string line;
    line.reserve(1024);
    bool complete = false;
    char c = 0;
    while (input.get(c)) {
      if (c == '\n') { complete = true; break; }
      if (line.size() == max_request_bytes) {
        emit_error(output, "Worker request exceeds 8192 bytes");
        return 2;
      }
      line.push_back(c);
    }
    if (!complete) {
      if (line.empty() && input.eof()) return 0;
      emit_error(output, "Truncated worker request");
      return 2;
    }
    try { process_request(parse_request(line), output); }
    catch (const std::exception& error) { emit_error(output, error.what()); }
    if (!output) return 1;
  }
  return input.eof() ? 0 : 1;
}
} // namespace lenslabs
