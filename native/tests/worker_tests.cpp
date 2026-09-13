#include "lenslabs/worker.hpp"
#include "lenslabs/pipeline.hpp"

#include <CoreFoundation/CoreFoundation.h>
#include <CoreGraphics/CoreGraphics.h>
#include <ImageIO/ImageIO.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <numeric>
#include <sstream>
#include <stdexcept>
#include <string>
#include <unistd.h>

namespace {
int checks = 0;
void require(bool value, const std::string& message) {
  ++checks;
  if (!value) throw std::runtime_error(message);
}

std::string request(const std::filesystem::path& path, unsigned edge = 1280) {
  static constexpr char alphabet[] = "0123456789abcdef";
  std::string result = "LENS1 " + std::to_string(edge) + " ";
  for (const unsigned char c : std::filesystem::absolute(path).string()) {
    result += alphabet[c >> 4]; result += alphabet[c & 15];
  }
  return result + '\n';
}

double number(const std::string& header, const std::string& key) {
  const auto marker = '"' + key + "\":";
  const auto offset = header.find(marker);
  require(offset != std::string::npos, "Missing JSON number: " + key);
  return std::stod(header.substr(offset + marker.size()));
}

struct Response {
  std::string header;
  std::vector<std::uint8_t> jpeg;
};

Response response(std::istream& output) {
  Response value;
  require(static_cast<bool>(std::getline(output, value.header)), "Response must have a JSON header line");
  const auto length = static_cast<std::size_t>(number(value.header, "preview_bytes"));
  require(length <= 16 * 1024 * 1024, "Response must have a bounded preview length");
  value.jpeg.resize(length);
  require(length == 0 || static_cast<bool>(output.read(reinterpret_cast<char*>(value.jpeg.data()), length)),
          "JPEG payload must contain exactly its declared bytes");
  return value;
}

std::vector<std::uint32_t> histogram(const std::string& header) {
  const auto begin = header.find("\"histogram\":[");
  require(begin != std::string::npos, "Histogram must exist");
  const auto end = header.find(']', begin);
  require(end != std::string::npos, "Histogram must terminate");
  auto values = header.substr(begin + 13, end - begin - 13);
  std::replace(values.begin(), values.end(), ',', ' ');
  std::istringstream stream(values);
  std::uint32_t value = 0;
  std::vector<std::uint32_t> parsed;
  while (stream >> value) parsed.push_back(value);
  require(parsed.size() == 256, "Histogram must contain exactly 256 bins");
  return parsed;
}

template<class T> struct OwnedCF {
  T value;
  explicit OwnedCF(T value) : value(value) {}
  ~OwnedCF() { if (value) CFRelease(value); }
  OwnedCF(const OwnedCF&) = delete;
  OwnedCF& operator=(const OwnedCF&) = delete;
};

class Temp {
 public:
  Temp() {
    std::array<char, 64> pattern{};
    std::strcpy(pattern.data(), "/private/tmp/lenslabs-worker-tests-XXXXXX");
    const auto result = mkdtemp(pattern.data());
    if (!result) throw std::runtime_error("Could not make test directory");
    dir = result;
  }
  ~Temp() {
    for (const auto& path : files) unlink(path.c_str());
    rmdir(dir.c_str());
  }
  std::filesystem::path write(const std::string& name, const std::vector<std::uint8_t>& bytes) {
    auto path = dir / name;
    lenslabs::write_new_file(path, bytes);
    files.push_back(path);
    return path;
  }
  std::filesystem::path symlink(const std::filesystem::path& input) {
    auto path = dir / "symlink.jpg";
    if (::symlink(input.c_str(), path.c_str()) != 0) throw std::runtime_error("Could not make test symlink");
    files.push_back(path);
    return path;
  }
  std::filesystem::path dir;
  std::vector<std::filesystem::path> files;
};

std::vector<std::uint8_t> with_metadata(const char* date, const char* offset, const char* serial,
                                       const char* subsecond = "125", const char* make = "Test Camera",
                                       const char* model = "Body A") {
  lenslabs::Image pixels{16, 12, 16, 12, std::vector<std::uint8_t>(16 * 12 * 4, 255)};
  for (std::size_t i = 0; i < pixels.rgba.size(); i += 4) {
    pixels.rgba[i] = 200; pixels.rgba[i + 1] = 100; pixels.rgba[i + 2] = 50;
  }
  const auto initial = lenslabs::encode_jpeg(pixels, 1);
  OwnedCF<CFDataRef> source_bytes(CFDataCreate(kCFAllocatorDefault, initial.data(), initial.size()));
  OwnedCF<CGImageSourceRef> source(CGImageSourceCreateWithData(source_bytes.value, nullptr));
  OwnedCF<CFMutableDataRef> encoded(CFDataCreateMutable(kCFAllocatorDefault, 0));
  OwnedCF<CGImageDestinationRef> destination(CGImageDestinationCreateWithData(encoded.value, CFSTR("public.jpeg"), 1, nullptr));
  OwnedCF<CFMutableDictionaryRef> properties(CFDictionaryCreateMutable(kCFAllocatorDefault, 0,
    &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks));
  OwnedCF<CFMutableDictionaryRef> exif(CFDictionaryCreateMutable(kCFAllocatorDefault, 0,
    &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks));
  OwnedCF<CFMutableDictionaryRef> tiff(CFDictionaryCreateMutable(kCFAllocatorDefault, 0,
    &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks));
  auto set = [](CFMutableDictionaryRef dictionary, CFStringRef key, const char* value) {
    if (!value) return;
    OwnedCF<CFStringRef> text(CFStringCreateWithCString(kCFAllocatorDefault, value, kCFStringEncodingUTF8));
    CFDictionarySetValue(dictionary, key, text.value);
  };
  set(exif.value, kCGImagePropertyExifDateTimeOriginal, date);
  set(exif.value, kCGImagePropertyExifSubsecTimeOriginal, subsecond);
  set(exif.value, CFSTR("OffsetTimeOriginal"), offset);
  set(exif.value, kCGImagePropertyExifBodySerialNumber, serial);
  set(tiff.value, kCGImagePropertyTIFFMake, make);
  set(tiff.value, kCGImagePropertyTIFFModel, model);
  CFDictionarySetValue(properties.value, kCGImagePropertyExifDictionary, exif.value);
  CFDictionarySetValue(properties.value, kCGImagePropertyTIFFDictionary, tiff.value);
  CGImageDestinationAddImageFromSource(destination.value, source.value, 0, properties.value);
  require(CGImageDestinationFinalize(destination.value), "Metadata fixture must encode");
  const auto bytes = CFDataGetBytePtr(encoded.value);
  return {bytes, bytes + CFDataGetLength(encoded.value)};
}

void real_fixtures(const std::filesystem::path& fixtures, Temp& temp) {
  const std::array<const char*, 3> names{{"volleyball-portrait-cc0.jpg", "basketball-action-usaf-pd.jpg", "basketball-hangar-usnavy-pd.jpg"}};
  std::string requests;
  for (const auto name : names) requests += request(fixtures / name);
  requests += request(fixtures / names[0]);
  std::istringstream input(requests);
  std::ostringstream output;
  require(lenslabs::run_worker(input, output) == 0, "Multiple requests must finish on clean EOF");
  std::istringstream frames(output.str());
  std::vector<Response> answers;
  for (std::size_t i = 0; i < 4; ++i) {
    auto value = response(frames);
    require(value.header.find("\"ok\":true") != std::string::npos, "Real fixture must succeed: " + value.header);
    require(value.header.find("\"preview_origin\":\"raster_decode\"") != std::string::npos,
            "JPEG origin is reported from the actual decoder path");
    double stages = 0;
    for (const auto key : {"decode_total", "analysis_resize", "analysis", "jpeg_encode"}) {
      const auto timing = number(value.header, key);
      require(std::isfinite(timing) && timing >= 0, "Stage timing must be finite and nonnegative");
      stages += timing;
    }
    require(stages <= number(value.header, "elapsed_ms") + 0.001,
            "Disjoint worker stage times must fit inside elapsed processing time");
    require(number(value.header, "raw_extract") == 0, "Ordinary JPEG does not claim RAW extraction work");
    const auto decode_parts = number(value.header, "source_open") + number(value.header, "raw_extract") +
      number(value.header, "imageio_decode_resize") + number(value.header, "rgba") + number(value.header, "metadata");
    require(decode_parts >= 0 && decode_parts <= number(value.header, "decode_total") + 0.001,
            "Metadata is a measured substage of the shared decoder lifecycle");
    require(value.jpeg.size() > 1000 && value.jpeg.front() == 0xff && value.jpeg[1] == 0xd8 &&
            value.jpeg[value.jpeg.size() - 2] == 0xff && value.jpeg.back() == 0xd9, "Payload must be a complete JPEG");
    const auto pixels = histogram(value.header);
    const auto sum = std::accumulate(pixels.begin(), pixels.end(), std::uint64_t{});
    require(sum == number(value.header, "analysis_width") * number(value.header, "analysis_height"),
            "Histogram totals must match the bounded analysis image");
    require(number(value.header, "analysis_width") <= 256 && number(value.header, "analysis_height") <= 256,
            "Analysis must be bounded to 256 pixels");
    require(number(value.header, "width") <= 1280 && number(value.header, "height") <= 1280,
            "Preview must honor requested bound");
    const auto preview = lenslabs::decode_preview(temp.write(std::to_string(i) + ".jpg", value.jpeg), 1280);
    require(preview.source_width == number(value.header, "width") && preview.source_height == number(value.header, "height"),
            "Payload dimensions must agree with metadata and remain upright");
    require(number(value.header, "black") <= number(value.header, "median") &&
            number(value.header, "median") <= number(value.header, "white"), "Tone percentiles must be ordered");
    for (const auto key : {"rMean", "gMean", "bMean"})
      require(number(value.header, key) >= 0 && number(value.header, key) <= 255, "Mean color must be bounded");
    require(number(value.header, "satMean") >= 0 && number(value.header, "satMean") <= 1, "Mean saturation must be bounded");
    answers.push_back(std::move(value));
  }
  require(number(answers[0].header, "source_width") == 3000 && number(answers[0].header, "source_height") == 4000,
          "EXIF rotation must preserve upright source dimensions");
  require(answers[0].jpeg == answers[3].jpeg, "Repeated requests must return the same encoded preview");
  require(histogram(answers[0].header) == histogram(answers[3].header), "Repeated analysis must be deterministic");
  require(frames.peek() == std::char_traits<char>::eof(), "No payload delimiter or extra bytes may follow a response");
}

void protocol_failures(const std::filesystem::path& good, Temp& temp) {
  const auto corrupt = temp.write("corrupt.jpg", {1, 2, 3, 4});
  const auto linked = temp.symlink(good);
  std::vector<std::string> cases{"BAD 1280 2f\n", "LENS1 7 2f\n", "LENS1 2049 2f\n", "LENS1 1280 0\n",
    "LENS1 1280 gg\n", "LENS1 1280 00\n", "LENS1 1280 61\n", "LENS1  2f\n", "\n",
    request(temp.dir / "missing.jpg"), request(corrupt), request(linked)};
  std::string requests;
  for (const auto& item : cases) requests += item;
  requests += request(good, 256);
  std::istringstream input(requests);
  std::ostringstream output;
  require(lenslabs::run_worker(input, output) == 0, "Per-request errors should not kill the worker");
  std::istringstream frames(output.str());
  for (std::size_t i = 0; i < cases.size(); ++i) {
    auto value = response(frames);
    require(value.header.find("\"ok\":false") != std::string::npos && value.jpeg.empty(),
            "Malformed/file request must fail without JPEG data");
  }
  require(response(frames).header.find("\"ok\":true") != std::string::npos, "A valid request must work after errors");
  for (const auto& invalid : {std::string(8193, 'a') + '\n' + request(good), std::string("LENS1 1280 2f")}) {
    std::istringstream broken(invalid);
    std::ostringstream rejected;
    require(lenslabs::run_worker(broken, rejected) == 2, "Oversized or truncated framing must terminate safely");
    std::istringstream replies(rejected.str());
    require(response(replies).header.find("\"ok\":false") != std::string::npos, "Fatal protocol error must be explicit");
    require(replies.peek() == std::char_traits<char>::eof(), "No further messages may run after desynchronization");
  }
  std::istringstream empty;
  std::ostringstream no_response;
  require(lenslabs::run_worker(empty, no_response) == 0 && no_response.str().empty(), "Clean empty EOF must produce no frame");
}

void metadata_and_tone(Temp& temp) {
  auto run = [&](const char* name, const char* date, const char* offset, const char* serial,
                 const char* fraction = "125", const char* make = "Test Camera", const char* model = "Body A") {
    const auto path = temp.write(name, with_metadata(date, offset, serial, fraction, make, model));
    std::istringstream input(request(path)); std::ostringstream output;
    require(lenslabs::run_worker(input, output) == 0, "Metadata request must succeed");
    std::istringstream frames(output.str());
    auto result = response(frames);
    require(result.header.find("\"ok\":true") != std::string::npos, "Metadata fixture must be decodable");
    return result;
  };
  const auto dated = run("dated.jpg", "2026:09:04 13:45:12", "+05:45", "serial-001");
  const auto disguised = run("raster-disguised.ARW", "2026:09:04 13:45:12", "+05:45", "serial-001");
  require(disguised.header.find("\"preview_origin\":\"raster_decode\"") != std::string::npos,
          "A RAW extension must not mislabel raster bytes as an embedded RAW preview");
  require(disguised.jpeg == dated.jpeg && histogram(disguised.header) == histogram(dated.header),
          "Preview and analysis depend on source bytes rather than the extension");
  const auto expected = std::chrono::sys_days(std::chrono::year(2026) / 9 / 4) +
    std::chrono::hours(8) + std::chrono::seconds(12) + std::chrono::milliseconds(125);
  require(number(dated.header, "captured_at_ms") == std::chrono::duration_cast<std::chrono::milliseconds>(expected.time_since_epoch()).count(),
          "EXIF capture time and minute offset must map to the exact timestamp: " + dated.header);
  require(dated.header.find("\"capture_time_basis\":\"utc\"") != std::string::npos, "Explicit offset must be marked UTC");
  require(dated.header.find("serial-001") != std::string::npos && dated.header.find("\"camera_key_basis\":\"make_model_serial\"") != std::string::npos,
          "Camera grouping must include real body serial");
  const auto clock = run("camera-clock.jpg", "2026:09:04 13:45:12", nullptr, nullptr);
  require(clock.header.find("\"capture_time_basis\":\"camera_clock\"") != std::string::npos,
          "A camera date without timezone must not masquerade as UTC");
  require(clock.header.find("\"camera_key\":null") != std::string::npos, "Make/model alone cannot identify a camera body");
  require(clock.header.find("\"camera_model\":\"Test Camera Body A\"") != std::string::npos, "Descriptive model can remain available");
  const auto missing = run("missing-time.jpg", nullptr, nullptr, nullptr, nullptr);
  require(missing.header.find("\"captured_at_ms\":null") != std::string::npos && missing.header.find("\"capture_time_basis\":null") != std::string::npos,
          "No EXIF date must stay absent, never fall back to filesystem mtime");
  const auto invalid = run("invalid-date.jpg", "2026:02:30 13:45:12", nullptr, nullptr);
  require(invalid.header.find("\"captured_at_ms\":null") != std::string::npos, "Invalid calendar day must not normalize into another date");
  const auto old = run("pre-epoch.jpg", "1960:09:04 13:45:12", "+00:00", "valid-body");
  require(old.header.find("\"captured_at_ms\":null") != std::string::npos &&
          old.header.find("\"capture_time_basis\":null") != std::string::npos &&
          old.header.find("\"capture_time_source\":null") != std::string::npos,
          "Pre-1970 camera date must become unknown, without rejecting its photo");
  require(!old.jpeg.empty() && old.header.find("valid-body") != std::string::npos,
          "Invalid clock must not discard a valid preview or camera identity");
  const auto epoch = run("epoch-zero.jpg", "1970:01:01 00:00:00", "+00:00", "valid-body", "0");
  require(epoch.header.find("\"captured_at_ms\":null") != std::string::npos,
          "The exact epoch timestamp is reserved for unknown capture time");
  const auto first_millisecond = run("epoch-one.jpg", "1970:01:01 00:00:00", "+00:00", "valid-body", "001");
  require(number(first_millisecond.header, "captured_at_ms") == 1,
          "The first positive timestamp must remain valid");
  const std::string make_long(200, 'M'), model_long(200, 'D'), serial_long(200, 'S');
  const auto oversized = run("large-camera-key.jpg", "2026:09:04 13:45:12", "+00:00", serial_long.c_str(),
                             "125", make_long.c_str(), model_long.c_str());
  require(oversized.header.find("\"camera_key\":null") != std::string::npos &&
          oversized.header.find("\"camera_key_basis\":null") != std::string::npos,
          "A camera identity over 512 UTF-8 bytes must become unknown, not truncated or rejected");
  require(!oversized.jpeg.empty() && oversized.header.find("\"captured_at_ms\":null") == std::string::npos,
          "Oversized identity must preserve the photo and usable timestamp");
  const std::string exact_make(255, 'M'), exact_model(246, 'D');
  const auto exact_key = run("exact-camera-key.jpg", "2026:09:04 13:45:12", nullptr, "S", "125",
                             exact_make.c_str(), exact_model.c_str());
  require(exact_key.header.find("\"camera_key\":null") == std::string::npos &&
          exact_key.header.find("\"camera_key_basis\":\"make_model_serial\"") != std::string::npos,
          "An identity of exactly 512 UTF-8 bytes remains usable");
  require(std::abs(number(dated.header, "rMean") - 200) <= 3 && std::abs(number(dated.header, "gMean") - 100) <= 3 &&
          std::abs(number(dated.header, "bMean") - 50) <= 3, "Measured native tone means must preserve fixture colors");
  require(std::abs(number(dated.header, "satMean") - 0.75) < 0.025, "Tone saturation must use channel range / maximum");
}

void downsample() {
  lenslabs::Image image{512, 384, 4000, 3000, std::vector<std::uint8_t>(512 * 384 * 4, 255)};
  for (std::size_t i = 0; i < image.rgba.size(); i += 4) image.rgba[i] = 42;
  const auto bounded = lenslabs::analysis_preview(image);
  require(bounded.width == 256 && bounded.height == 192, "Downsample must preserve aspect ratio and bound");
  require(bounded.source_width == 4000 && bounded.source_height == 3000, "Downsample preserves source dimensions");
  require(bounded.rgba[0] == 42 && bounded.rgba.back() == 255, "Area averaging preserves constant pixels and alpha");
  require(lenslabs::analysis_preview(bounded).rgba == bounded.rgba, "Already bounded input is pixel-identical");
  image.rgba.pop_back();
  bool rejected = false;
  try { lenslabs::analysis_preview(image); } catch (const std::invalid_argument&) { rejected = true; }
  require(rejected, "Malformed RGBA buffer must be rejected before indexing");
}
} // namespace

int main(int argc, char** argv) {
  try {
    if (argc != 2) throw std::invalid_argument("worker-tests requires fixture folder");
    const auto fixtures = std::filesystem::absolute(argv[1]);
    Temp temp;
    real_fixtures(fixtures, temp);
    protocol_failures(fixtures / "volleyball-portrait-cc0.jpg", temp);
    metadata_and_tone(temp);
    downsample();
    std::cout << "Worker tests passed: " << checks << " checks\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "Worker test failed: " << error.what() << '\n';
    return 1;
  }
}
