#include "lenslabs/worker.hpp"
#include "lenslabs/pipeline.hpp"

#include <algorithm>
#include <array>
#include <charconv>
#include <chrono>
#include <cmath>
#include <iomanip>
#include <istream>
#include <locale>
#include <ostream>
#include <sstream>
#include <stdexcept>
#include <sys/stat.h>

namespace lenslabs {
namespace {
constexpr std::size_t max_request_bytes = 8192;


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
  DecodeTimings decode_timings;
  CaptureMetadata metadata;
  const auto decode_started = std::chrono::steady_clock::now();
  const auto preview = decode_preview(request.path, request.edge, &decode_timings, &metadata);
  const auto decoded = std::chrono::steady_clock::now();
  Image reduced;
  const auto& bounded = preview.width <= 256 && preview.height <= 256
    ? preview : (reduced = analysis_preview(preview));
  const auto resized = std::chrono::steady_clock::now();
  const auto a = analyze(bounded);
  const auto analyzed = std::chrono::steady_clock::now();
  const auto jpeg = encode_jpeg(preview, 0.8);
  const auto encoded = std::chrono::steady_clock::now();
  auto ms = [](auto begin, auto end) {
    return std::chrono::duration<double, std::milli>(end - begin).count();
  };
  if (!same_snapshot(before, snapshot(request.path))) throw std::runtime_error("Input changed during processing");
  std::ostringstream header;
  header.imbue(std::locale::classic());
  header << std::setprecision(10);
  std::ostringstream hash;
  hash << std::hex << std::setw(16) << std::setfill('0') << a.hash;
  header << "{\"ok\":true,\"engine\":" << json_string(engine_version)
    << ",\"decoder\":" << json_string(decoder_name())
    << ",\"preview_origin\":" << json_string(decode_timings.embedded_raw_jpeg ? "embedded_raw_jpeg" : "raster_decode")
    << ",\"timings_ms\":{\"decode_total\":" << ms(decode_started, decoded)
    << ",\"source_open\":" << decode_timings.source_open_ms
    << ",\"raw_extract\":" << decode_timings.raw_extract_ms
    << ",\"imageio_decode_resize\":" << decode_timings.imageio_decode_resize_ms
    << ",\"rgba\":" << decode_timings.rgba_ms
    << ",\"analysis_resize\":" << ms(decoded, resized)
    << ",\"analysis\":" << ms(resized, analyzed)
    << ",\"metadata\":" << decode_timings.metadata_ms
    << ",\"jpeg_encode\":" << ms(analyzed, encoded) << "}"
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
