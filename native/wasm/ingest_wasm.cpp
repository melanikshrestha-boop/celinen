// One call per photo: file bytes in, everything the cull needs out.
//
// A sports session is ten thousand frames, and the browser's own decoder is the
// bottleneck — it decodes every one at full size before anything can look at it.
// libjpeg can decode straight from the DCT coefficients at 1/8 or 1/4 size,
// which is roughly ten times faster and is all the resolution focus measurement
// needs. So the whole per-frame pipeline lives here: EXIF, scaled decode,
// orientation, the cull measurement, and the filmstrip thumbnail. Nothing
// touches a canvas, so the page stays responsive while a card imports.
//
// Formats libjpeg cannot read (WebP, PNG, AVIF, HEIC in Safari) are decoded by
// the browser in the worker and handed in as upright RGBA through
// celinen_ingest_run_pixels, so they are measured by exactly the same code.
#include "lenslabs/cull.hpp"
#include "lenslabs/exif.hpp"
#include "lenslabs/focus_hit.hpp"
#include "lenslabs/raw_preview.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <csetjmp>
#include <cstring>
#include <new>
#include <string>
#include <vector>
extern "C" {
#include <jpeglib.h>
#include <jerror.h> // the JWRN_* warning codes
}

namespace {
std::vector<std::uint8_t> input, thumbnail;
// The head of a RAW container whose embedded JPEG is in `input` (or, for a
// browser-decoded photo, the file's own first bytes). The preview JPEG a camera
// embeds rarely carries the maker note or the orientation, so both have to be
// read from the RAW's own TIFF/CR3 structure. Consumed by one run.
std::vector<std::uint8_t> metadata;
std::vector<double> reading;
// AF area and focus-hit judgment for the last run; empty when the file had no
// AF area. Layout documented at celinen_ingest_focus().
std::vector<double> focus;
std::string camera_key, error;
// Why the last photo decoded but is not whole (a truncated file, corrupt
// entropy data), in plain words. Empty when it decoded cleanly.
std::string damaged;
lenslabs::Image frame;
double capture_time_ms = -1;
bool capture_time_utc = false;
std::uint32_t source_width = 0, source_height = 0;

constexpr std::size_t reading_fields = 23;
constexpr std::size_t color_bytes = 48;
constexpr std::size_t focus_fields = 13;

struct JpegFailure {
  jpeg_error_mgr manager;
  std::jmp_buf escape;
  // Data-corruption warnings seen while decoding. libjpeg keeps going after
  // them and paints what it could not read as flat gray.
  int corrupt = 0;
  bool ended_early = false;
};

void on_jpeg_error(j_common_ptr info) {
  char message[JMSG_LENGTH_MAX] = {};
  (*info->err->format_message)(info, message);
  error = message[0] ? message : "This photo could not be decoded.";
  std::longjmp(reinterpret_cast<JpegFailure*>(info->err)->escape, 1);
}
void ignore_jpeg_message(j_common_ptr) {}

// Warnings arrive with msg_level -1; trace messages (>= 0) are ignored.
// Extraneous bytes before a marker, an unknown JFIF revision or an Adobe
// transform code are harmless and common in camera files, so they do not count.
void on_jpeg_warning(j_common_ptr info, int level) {
  if (level >= 0) return;
  info->err->num_warnings++;
  auto* failure = reinterpret_cast<JpegFailure*>(info->err);
  switch (info->err->msg_code) {
    case JWRN_JPEG_EOF:
    case JWRN_HIT_MARKER:
      failure->ended_early = true;
      failure->corrupt++;
      break;
    case JWRN_ARITH_BAD_CODE:
    case JWRN_HUFF_BAD_CODE:
    case JWRN_BOGUS_PROGRESSION:
    case JWRN_MUST_RESYNC:
    case JWRN_NOT_SEQUENTIAL:
      failure->corrupt++;
      break;
    default: break;
  }
}

// The smallest 1/8-step libjpeg can produce that is still at least the edge we
// want. Anything smaller would throw away detail the focus measurement reads.
unsigned scale_for(unsigned width, unsigned height, unsigned target_edge) {
  const unsigned longest = std::max(width, height);
  for (unsigned numerator = 1; numerator < 8; ++numerator)
    if (longest * numerator >= target_edge * 8u) return numerator;
  return 8;
}

// TIFF orientation, applied so every later stage sees an upright frame.
lenslabs::Image upright(const lenslabs::Image& in, int orientation) {
  if (orientation <= 1 || orientation > 8) return in;
  const bool swap = orientation >= 5;
  lenslabs::Image out{swap ? in.height : in.width, swap ? in.width : in.height, in.source_width,
                      in.source_height, {}};
  out.rgba.resize(std::size_t(out.width) * out.height * 4);
  for (std::uint32_t y = 0; y < in.height; ++y)
    for (std::uint32_t x = 0; x < in.width; ++x) {
      std::uint32_t nx = x, ny = y;
      switch (orientation) {
        case 2: nx = in.width - 1 - x; break;
        case 3: nx = in.width - 1 - x; ny = in.height - 1 - y; break;
        case 4: ny = in.height - 1 - y; break;
        case 5: nx = y; ny = x; break;
        case 6: nx = in.height - 1 - y; ny = x; break;
        case 7: nx = in.height - 1 - y; ny = in.width - 1 - x; break;
        case 8: nx = y; ny = in.width - 1 - x; break;
        default: break;
      }
      const auto* source = in.rgba.data() + (std::size_t(y) * in.width + x) * 4;
      auto* target = out.rgba.data() + (std::size_t(ny) * out.width + nx) * 4;
      std::memcpy(target, source, 4);
    }
  return out;
}

// Box average to the thumbnail size: the filmstrip's picture, made here so the
// page never has to decode the original a second time.
lenslabs::Image resample(const lenslabs::Image& in, unsigned edge) {
  const double scale = std::min(1.0, double(edge) / std::max(in.width, in.height));
  const auto width = std::max(1u, unsigned(in.width * scale));
  const auto height = std::max(1u, unsigned(in.height * scale));
  if (width == in.width && height == in.height) return in;
  lenslabs::Image out{width, height, in.source_width, in.source_height, {}};
  out.rgba.resize(std::size_t(width) * height * 4);
  for (unsigned y = 0; y < height; ++y)
    for (unsigned x = 0; x < width; ++x) {
      const auto x0 = std::size_t(x) * in.width / width, x1 = std::max(x0 + 1, std::size_t(x + 1) * in.width / width);
      const auto y0 = std::size_t(y) * in.height / height, y1 = std::max(y0 + 1, std::size_t(y + 1) * in.height / height);
      std::array<double, 3> sum{};
      std::size_t count = 0;
      for (auto sy = y0; sy < std::min<std::size_t>(y1, in.height); ++sy)
        for (auto sx = x0; sx < std::min<std::size_t>(x1, in.width); ++sx) {
          const auto* p = in.rgba.data() + (sy * in.width + sx) * 4;
          for (int c = 0; c < 3; ++c) sum[std::size_t(c)] += p[c];
          ++count;
        }
      auto* out_pixel = out.rgba.data() + (std::size_t(y) * width + x) * 4;
      for (int c = 0; c < 3; ++c)
        out_pixel[c] = std::uint8_t(count ? std::lround(sum[std::size_t(c)] / double(count)) : 0);
      out_pixel[3] = 255;
    }
  return out;
}

bool decode_jpeg(const std::uint8_t* bytes, std::size_t size, unsigned target_edge,
                 lenslabs::Image& out) {
  jpeg_decompress_struct info{};
  JpegFailure failure{};
  info.err = jpeg_std_error(&failure.manager);
  failure.manager.error_exit = on_jpeg_error;
  failure.manager.output_message = ignore_jpeg_message;
  failure.manager.emit_message = on_jpeg_warning;
  if (setjmp(failure.escape)) {
    jpeg_destroy_decompress(&info);
    return false;
  }
  jpeg_create_decompress(&info);
  jpeg_mem_src(&info, bytes, static_cast<unsigned long>(size));
  if (jpeg_read_header(&info, TRUE) != JPEG_HEADER_OK) {
    jpeg_destroy_decompress(&info);
    error = "This photo could not be decoded.";
    return false;
  }
  source_width = info.image_width;
  source_height = info.image_height;
  info.scale_num = scale_for(info.image_width, info.image_height, target_edge);
  info.scale_denom = 8;
  // This libjpeg build has no packed-RGBA output, so rows arrive as RGB and are
  // widened in place. Grayscale files are widened the same way.
  info.out_color_space = JCS_RGB;
  info.dct_method = JDCT_ISLOW;
  info.do_fancy_upsampling = FALSE; // the detail this would add is below the scale
  jpeg_start_decompress(&info);
  if (info.output_width < 8 || info.output_height < 8 || info.output_components != 3) {
    jpeg_abort_decompress(&info);
    jpeg_destroy_decompress(&info);
    error = "This photo is too small to judge.";
    return false;
  }
  out = lenslabs::Image{info.output_width, info.output_height, info.image_width, info.image_height, {}};
  out.rgba.resize(std::size_t(out.width) * out.height * 4);
  std::vector<std::uint8_t> row(std::size_t(out.width) * 3);
  while (info.output_scanline < info.output_height) {
    auto* line = row.data();
    const auto y = info.output_scanline;
    jpeg_read_scanlines(&info, &line, 1);
    auto* target = out.rgba.data() + std::size_t(y) * out.width * 4;
    for (std::uint32_t x = 0; x < out.width; ++x) {
      target[x * 4] = row[std::size_t(x) * 3];
      target[x * 4 + 1] = row[std::size_t(x) * 3 + 1];
      target[x * 4 + 2] = row[std::size_t(x) * 3 + 2];
      target[x * 4 + 3] = 255;
    }
  }
  jpeg_finish_decompress(&info);
  jpeg_destroy_decompress(&info);
  // libjpeg fills what it could not read with gray and carries on. Scoring that
  // gray as a soft photo would be a silent lie, so it is named instead.
  if (failure.ended_early)
    damaged = "This file is cut short: the end of the photo is missing and shows as gray, "
              "so its focus and exposure readings cannot be trusted.";
  else if (failure.corrupt)
    damaged = "Part of this photo's data is corrupt: some of the picture shows as gray or "
              "smeared, so its focus and exposure readings cannot be trusted.";
  return true;
}

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
    const auto* source = image.rgba.data() + std::size_t(info.next_scanline) * image.width * 4;
    for (std::uint32_t x = 0; x < image.width; ++x)
      for (int c = 0; c < 3; ++c) row[std::size_t(x) * 3 + std::size_t(c)] = source[x * 4 + c];
    auto* line = row.data();
    jpeg_write_scanlines(&info, &line, 1);
  }
  jpeg_finish_compress(&info);
  jpeg_destroy_compress(&info);
  out.assign(buffer, buffer + produced);
  std::free(buffer);
  return true;
}

void write_reading(const lenslabs::CullReading& r) {
  reading.assign(reading_fields + color_bytes, 0);
  double* out = reading.data();
  out[0] = r.acuity_subject;
  out[1] = r.acuity_best;
  out[2] = r.texture;
  out[3] = r.motion;
  out[4] = r.global_smear ? 1 : 0;
  out[5] = r.noise;
  out[6] = r.brightness;
  out[7] = r.subject_luma;
  out[8] = r.clipped_highlights;
  out[9] = r.clipped_shadows;
  out[10] = r.subject_clipped;
  out[11] = r.black_point;
  out[12] = r.median;
  out[13] = r.white_point;
  out[14] = r.subject_x;
  out[15] = r.subject_y;
  out[16] = double(std::uint32_t(r.hash >> 32));
  out[17] = double(std::uint32_t(r.hash & 0xffffffffu));
  out[18] = r.sharpness;
  out[19] = r.quality;
  out[20] = r.has_face ? 1 : 0;
  out[21] = r.eyes_closed ? 1 : 0;
  out[22] = r.face_soft ? 1 : 0;
  for (std::size_t i = 0; i < color_bytes; ++i) out[reading_fields + i] = r.color[i];
}

// Everything after the pixels exist: the working frame, the measurement, the
// AF judgment and the thumbnail. `upright_image` is already turned the right way.
bool complete(lenslabs::Image upright_image, const lenslabs::AfArea& af, int af_orientation,
              std::uint32_t measure_edge, std::uint32_t thumb_edge, int thumb_quality) {
  // libjpeg can only scale in eighths, so a 24MP body and a 12MP body land on
  // different sizes. Normalize to one working edge: blur is then measured in
  // the same units on every camera in the shoot, which is what lets frames be
  // compared with each other at all.
  frame = resample(upright_image, measure_edge);
  upright_image = {};
  // Faces are the browser's to find; the engine is told about them separately
  // when a detector exists, and never guesses at them here.
  write_reading(lenslabs::measure_cull(frame, {}));
  if (af.present) {
    // AF coordinates are sensor-up. Rotate them by the orientation the pixels
    // were actually given, so the area lands on the frame that was measured.
    const auto upright_af = lenslabs::upright_af_area(af, af_orientation);
    const auto hit = lenslabs::judge_focus_hit(
        frame, {upright_af.x, upright_af.y, upright_af.width, upright_af.height});
    focus = {upright_af.x,
             upright_af.y,
             upright_af.width,
             upright_af.height,
             double(upright_af.in_focus),
             hit.hit,
             hit.af_acuity,
             hit.best_acuity,
             hit.best_region.x,
             hit.best_region.y,
             hit.best_region.width,
             hit.best_region.height,
             double(int(hit.verdict))};
  }
  const auto small = resample(frame, thumb_edge);
  if (!encode_jpeg(small, thumb_quality, thumbnail)) {
    if (error.empty()) error = "This preview could not be written.";
    return false;
  }
  return true;
}

// Clears the previous photo's results and takes the loaded metadata head. One
// run consumes it whatever its outcome, so a failed photo's container can never
// describe the next one.
std::vector<std::uint8_t> begin_run() {
  error.clear();
  damaged.clear();
  thumbnail.clear();
  reading.clear();
  focus.clear();
  frame = {};
  std::vector<std::uint8_t> head;
  head.swap(metadata);
  camera_key.clear();
  capture_time_ms = -1;
  capture_time_utc = false;
  source_width = source_height = 0;
  return head;
}

bool valid_edges(std::uint32_t measure_edge, std::uint32_t thumb_edge, int thumb_quality) {
  return measure_edge >= 64 && measure_edge <= 4096 && thumb_edge >= 32 && thumb_edge <= 2048 &&
         thumb_quality >= 30 && thumb_quality <= 95;
}
} // namespace

extern "C" {
const char* celinen_ingest_error() { return error.c_str(); }

/** Room for the head of the RAW container the next photo's JPEG came from, so
 * its orientation and AF area can be read. Optional; call before
 * celinen_ingest_run, which consumes it. Returns null when the size is beyond the bound.
 */
std::uint8_t* celinen_ingest_metadata(std::uint32_t size) {
  metadata.clear();
  if (!size || size > 64u * 1024 * 1024) return nullptr;
  try {
    metadata.assign(size, 0);
  } catch (...) {
    metadata.clear();
    return nullptr;
  }
  return metadata.data();
}

// Room for one photo's bytes. Returns null when the file is beyond the bound.
std::uint8_t* celinen_ingest_input(std::uint32_t size) {
  if (!size || size > 200u * 1024 * 1024) return nullptr;
  try {
    input.assign(size, 0);
  } catch (...) {
    error = "This photo is too large for the browser's memory.";
    return nullptr;
  }
  return input.data();
}

/** Reads the loaded photo: EXIF, a scaled decode, the cull measurement and a
 * thumbnail. Returns 1 on success; on failure celinen_ingest_error() says why.
 *
 * When a RAW container head was loaded (celinen_ingest_metadata), the photo is
 * that RAW's embedded preview and is turned by preview_orientation(): the
 * container's orientation wins, the preview's own tag counts only when the
 * container is silent, and a preview the camera already turned is not turned
 * again. The container's AF area, capture time and camera win over the preview's.
 */
int celinen_ingest_run(std::uint32_t size, std::uint32_t measure_edge, std::uint32_t thumb_edge,
                       int thumb_quality) {
  const auto container_head = begin_run();
  try {
    if (size > input.size() || !valid_edges(measure_edge, thumb_edge, thumb_quality)) {
      error = "Invalid ingest request.";
      return 0;
    }
    const auto facts = lenslabs::read_exif(input.data(), size);
    capture_time_ms = facts.capture_time_ms;
    capture_time_utc = facts.capture_time_utc;
    camera_key = facts.camera_key;

    lenslabs::Image decoded;
    if (!decode_jpeg(input.data(), size, measure_edge, decoded)) {
      if (error.empty()) error = "This photo could not be decoded.";
      return 0;
    }
    int orientation = facts.orientation_tagged ? facts.orientation : 1;
    lenslabs::AfArea af = facts.af;
    int af_orientation = orientation;
    if (!container_head.empty()) {
      const auto container = lenslabs::read_exif(container_head.data(), container_head.size());
      const auto raw = lenslabs::inspect_raw(container_head.data(), container_head.size(),
                                             container_head.size());
      lenslabs::JpegInfo preview;
      preview.valid = true;
      preview.width = source_width;
      preview.height = source_height;
      preview.orientation = facts.orientation_tagged ? facts.orientation : 0;
      orientation = lenslabs::preview_orientation(raw, preview);
      af_orientation = orientation;
      // Prefer the RAW container's AF area; the JPEG's own maker note stays the
      // fallback (Fujifilm RAF previews carry it there). The container's area is
      // in the container's sensor-up frame, so it turns by the container's tag.
      if (container.af.present) {
        af = container.af;
        if (raw.orientation) af_orientation = raw.orientation;
      }
      // A preview often has no EXIF of its own; the container knows the capture.
      if (container.capture_time_ms >= 0) {
        capture_time_ms = container.capture_time_ms;
        capture_time_utc = container.capture_time_utc;
      }
      if (!container.camera_key.empty()) camera_key = container.camera_key;
    }
    return complete(upright(decoded, orientation), af, af_orientation, measure_edge, thumb_edge,
                    thumb_quality)
               ? 1
               : 0;
  } catch (const std::bad_alloc&) {
    error = "This photo is too large for the browser's memory.";
  } catch (const std::exception& failure) {
    error = failure.what();
  } catch (...) {
    error = "This photo could not be read.";
  }
  return 0;
}

/** Measures a photo the browser decoded. The input buffer holds `width` x
 * `height` upright RGBA; `source_w` x `source_h` is the original's size before
 * any scaling. A loaded metadata head (the file's first bytes) supplies capture
 * time, camera and AF area, and is consumed like a container.
 */
int celinen_ingest_run_pixels(std::uint32_t width, std::uint32_t height, std::uint32_t source_w,
                              std::uint32_t source_h, std::uint32_t measure_edge,
                              std::uint32_t thumb_edge, int thumb_quality) {
  const auto head = begin_run();
  try {
    if (!valid_edges(measure_edge, thumb_edge, thumb_quality) || width > 16384 || height > 16384 ||
        std::uint64_t(width) * height * 4 > input.size()) {
      error = "Invalid ingest request.";
      return 0;
    }
    if (width < 8 || height < 8) {
      error = "This photo is too small to judge.";
      return 0;
    }
    lenslabs::AfArea af;
    int af_orientation = 1;
    if (!head.empty()) {
      const auto facts = lenslabs::read_exif(head.data(), head.size());
      capture_time_ms = facts.capture_time_ms;
      capture_time_utc = facts.capture_time_utc;
      camera_key = facts.camera_key;
      af = facts.af;
      // The browser turned the pixels by the file's own orientation.
      af_orientation = facts.orientation;
    }
    source_width = source_w ? source_w : width;
    source_height = source_h ? source_h : height;
    lenslabs::Image pixels{width, height, source_width, source_height, {}};
    pixels.rgba.assign(input.begin(), input.begin() + std::ptrdiff_t(std::size_t(width) * height * 4));
    // A transparent PNG is judged as it would print: every pixel opaque.
    for (std::size_t i = 3; i < pixels.rgba.size(); i += 4) pixels.rgba[i] = 255;
    return complete(std::move(pixels), af, af_orientation, measure_edge, thumb_edge, thumb_quality) ? 1 : 0;
  } catch (const std::bad_alloc&) {
    error = "This photo is too large for the browser's memory.";
  } catch (const std::exception& failure) {
    error = failure.what();
  } catch (...) {
    error = "This photo could not be read.";
  }
  return 0;
}

/** Empty when the last photo decoded whole; otherwise, in plain words, why not. */
const char* celinen_ingest_damaged() { return damaged.c_str(); }

const double* celinen_ingest_reading() { return reading.empty() ? nullptr : reading.data(); }

/** Null when the last photo carried no camera AF area. Otherwise 13 doubles:
 * [0..3] AF area x, y, width, height normalized to the upright frame;
 * [4] camera focus confirmation (-1 unknown, 0 no lock, 1 locked);
 * [5] hit confidence 0..1; [6] AF-area acuity; [7] best acuity in frame;
 * [8..11] sharpest region x, y, width, height;
 * [12] verdict (0 unjudged, 1 on subject, 2 front/back focus, 3 missed).
 */
const double* celinen_ingest_focus() {
  return focus.size() == focus_fields ? focus.data() : nullptr;
}
double celinen_ingest_capture_time() { return capture_time_ms; }
int celinen_ingest_capture_utc() { return capture_time_utc ? 1 : 0; }
const char* celinen_ingest_camera() { return camera_key.c_str(); }
std::uint32_t celinen_ingest_source_width() { return source_width; }
std::uint32_t celinen_ingest_source_height() { return source_height; }
std::uint32_t celinen_ingest_frame_width() { return frame.width; }
std::uint32_t celinen_ingest_frame_height() { return frame.height; }
const std::uint8_t* celinen_ingest_thumbnail() { return thumbnail.data(); }
std::uint32_t celinen_ingest_thumbnail_size() { return std::uint32_t(thumbnail.size()); }

// The measured frame's own pixels, for a caller that wants to look closer
// (a face detector, a loupe) without decoding the original again.
const std::uint8_t* celinen_ingest_pixels() { return frame.rgba.data(); }

// Hands every buffer back. The worker calls this between cards.
void celinen_ingest_release() {
  input.clear(); input.shrink_to_fit();
  thumbnail.clear(); thumbnail.shrink_to_fit();
  reading.clear(); reading.shrink_to_fit();
  metadata.clear(); metadata.shrink_to_fit();
  focus.clear();
  frame = {};
  camera_key.clear();
  damaged.clear();
}
}
