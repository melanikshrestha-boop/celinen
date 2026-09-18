// WebAssembly face of the C++ social framing operator (native/src/social.cpp).
//
// The hosted site cannot spawn lenslabs-social, and a Cloudflare Worker cannot
// run a native binary, so the exact frame_social() used by the local tool is
// compiled here and driven from the page. The page hands over upright sRGB
// pixels (already developed), C++ frames them to Instagram's feed geometry and
// encodes the JPEG Instagram fetches. There is no second framing implementation.
//
// Memory contract (single-threaded, one instance per page):
//   1. celinen_social_source(w,h) sizes the retained source and returns its RGBA
//      pointer; the page writes pixels straight into it.
//   2. celinen_social_frame(...) frames and encodes. The source is released as
//      soon as the JPEG exists, so ten carousel photos never sit in memory at once.
//   3. celinen_social_jpeg()/_size() expose the JPEG until the next call.
// Every entry point returns 0/null on failure; celinen_social_error() says why.
#include "lenslabs/social.hpp"
#include <csetjmp>
#include <cstdlib>
#include <new>
#include <string>
#include <vector>
extern "C" {
#include <jpeglib.h>
}

namespace {
lenslabs::Image source;
std::vector<std::uint8_t> jpeg;
std::string error;

struct JpegFailure {
  jpeg_error_mgr manager;
  std::jmp_buf escape;
};

void on_jpeg_error(j_common_ptr info) {
  char message[JMSG_LENGTH_MAX] = {};
  (*info->err->format_message)(info, message);
  error = message[0] ? message : "The social JPEG could not be written.";
  std::longjmp(reinterpret_cast<JpegFailure*>(info->err)->escape, 1);
}
void ignore_jpeg_message(j_common_ptr) {}

// Baseline, 4:2:0, JFIF: the most conservative JPEG a platform decoder accepts.
bool encode_jpeg(const lenslabs::Image& image, int quality, std::vector<std::uint8_t>& out) {
  jpeg_compress_struct info{};
  JpegFailure failure{};
  info.err = jpeg_std_error(&failure.manager);
  failure.manager.error_exit = on_jpeg_error;
  failure.manager.output_message = ignore_jpeg_message;
  unsigned char* buffer = nullptr;
  unsigned long produced = 0;
  if (setjmp(failure.escape)) {
    jpeg_destroy_compress(&info);
    if (buffer) std::free(buffer);
    return false;
  }
  jpeg_create_compress(&info);
  jpeg_mem_dest(&info, &buffer, &produced);
  info.image_width = image.width;
  info.image_height = image.height;
  info.input_components = 3;
  info.in_color_space = JCS_RGB;
  jpeg_set_defaults(&info);
  jpeg_set_quality(&info, quality, TRUE);
  jpeg_start_compress(&info, TRUE);
  std::vector<std::uint8_t> row(std::size_t(image.width) * 3);
  while (info.next_scanline < info.image_height) {
    const auto* pixels = image.rgba.data() + std::size_t(info.next_scanline) * image.width * 4;
    for (std::uint32_t x = 0; x < image.width; ++x)
      for (int c = 0; c < 3; ++c) row[std::size_t(x) * 3 + std::size_t(c)] = pixels[x * 4 + c];
    auto* line = row.data();
    jpeg_write_scanlines(&info, &line, 1);
  }
  jpeg_finish_compress(&info);
  jpeg_destroy_compress(&info);
  out.assign(buffer, buffer + produced);
  std::free(buffer);
  return true;
}
} // namespace

extern "C" {
const char* celinen_social_error() { return error.c_str(); }

std::uint8_t* celinen_social_source(std::uint32_t width, std::uint32_t height) {
  error.clear();
  jpeg.clear();
  jpeg.shrink_to_fit();
  // Same bound frame_social enforces; checked first so nothing is allocated for it.
  if (!width || !height || width > 8192 || height > 8192 ||
      std::uint64_t(width) * height > 16u * 1024 * 1024) {
    error = "This photo is too large to frame. Export it at a smaller size.";
    source = {};
    return nullptr;
  }
  try {
    source.rgba.assign(std::size_t(width) * height * 4, 0);
  } catch (const std::bad_alloc&) {
    error = "This photo is too large for the browser's memory.";
    source = {};
    return nullptr;
  }
  source.width = source.source_width = width;
  source.height = source.source_height = height;
  return source.rgba.data();
}

// format: 0 portrait (1080x1350, 4:5), 1 square (1080x1080), 2 story
// (1080x1920, 9:16). fit: 0 fill (crop), 1 fit (pad).
int celinen_social_frame(int format, int fit, double x, double y, double zoom, int white,
                         int quality) {
  error.clear();
  jpeg.clear();
  try {
    if (!source.width) throw std::invalid_argument("No photo is loaded.");
    if (format < 0 || format > 2) throw std::invalid_argument("Invalid social format.");
    if (quality < 60 || quality > 95) throw std::invalid_argument("Invalid JPEG quality.");
    lenslabs::SocialFrame frame;
    frame.format = format == 0   ? lenslabs::SocialFormat::portrait
                   : format == 1 ? lenslabs::SocialFormat::square
                                 : lenslabs::SocialFormat::story;
    frame.fit = fit != 0;
    frame.x = x;
    frame.y = y;
    frame.zoom = zoom;
    frame.background = white ? 255 : 0;
    const auto framed = lenslabs::frame_social(source, frame);
    source = {}; // the framed copy is all that is needed from here
    if (!encode_jpeg(framed, quality, jpeg)) {
      if (error.empty()) error = "The social JPEG could not be written.";
      return 0;
    }
    // Instagram's image limit. At 1080px and q<=95 this is unreachable, but the
    // limit belongs next to the encoder rather than in a comment elsewhere.
    if (jpeg.size() > 8u * 1024 * 1024) {
      jpeg.clear();
      error = "The social JPEG exceeds 8 MB.";
      return 0;
    }
    return 1;
  } catch (const std::bad_alloc&) {
    error = "This photo is too large for the browser's memory.";
  } catch (const std::exception& failure) {
    error = failure.what();
  } catch (...) {
    error = "Social framing failed.";
  }
  source = {};
  return 0;
}

const std::uint8_t* celinen_social_jpeg() { return jpeg.empty() ? nullptr : jpeg.data(); }
std::uint32_t celinen_social_jpeg_size() { return std::uint32_t(jpeg.size()); }

void celinen_social_release() {
  source = {};
  jpeg.clear();
  jpeg.shrink_to_fit();
}
}
