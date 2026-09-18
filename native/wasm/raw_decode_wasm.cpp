// WebAssembly face of the RAW converter (native/src/raw_decode.cpp and
// friends). The same C++ runs here and in lenslabs-raw-decode; there is no
// second converter.
//
// The chain is driven a slice at a time from JavaScript rather than run to
// completion, which is how a 24-million-pixel decode stays honest in a browser:
//
//   1. celinen_rawdec_input(size)     room for the file; the worker writes into it
//   2. celinen_rawdec_open(size)      parse the container, return a status
//   3. celinen_rawdec_begin(...)      size the output and set the white balance
//   4. celinen_rawdec_step()          one band; returns progress in thousandths
//   5. celinen_rawdec_pixels()        sRGB RGBA8, complete once step() reaches 1000
//
// Cancellation is the worker simply not calling step() again and calling
// celinen_rawdec_release(); nothing is registered anywhere and no thread runs.
// Progress needs no callback into JavaScript, so this stays a standalone
// reactor module with no imports of its own.
#include "lenslabs/raw_decode.hpp"
#include <cstdint>
#include <memory>
#include <new>
#include <string>
#include <vector>

namespace {
using namespace lenslabs::raw;

std::vector<std::uint8_t> file_bytes;
RawMetadata metadata;
std::unique_ptr<Decoder> decoder;
std::string error;
std::vector<double> fields;

template <class Work> int guarded(Work work) {
  try {
    error.clear();
    work();
    return 1;
  } catch (const std::bad_alloc&) {
    error = "This RAW is too large for the browser's memory at this size.";
  } catch (const std::exception& failure) {
    error = failure.what();
  } catch (...) {
    error = "This RAW could not be decoded.";
  }
  return 0;
}
} // namespace

extern "C" {

/** Why the last call failed. Empty when it did not. */
const char* celinen_rawdec_error() { return error.c_str(); }

/** Room for the whole file. Null when the size is refused. */
std::uint8_t* celinen_rawdec_input(std::uint32_t size) {
  decoder.reset();
  metadata = {};
  file_bytes.clear();
  file_bytes.shrink_to_fit();
  if (!size || size > max_file_bytes) {
    error = "This RAW is larger than the decoder will read.";
    return nullptr;
  }
  const bool sized = guarded([&] { file_bytes.assign(size, 0); });
  return sized ? file_bytes.data() : nullptr;
}

/** Reads the container. 1 when the sensor data can be decoded, 0 when not —
 * celinen_rawdec_error() then says why, and the caller keeps the embedded
 * JPEG it is already showing. */
std::int32_t celinen_rawdec_open(std::uint32_t size) {
  decoder.reset();
  if (size > file_bytes.size()) {
    error = "The RAW was not fully transferred.";
    return 0;
  }
  metadata = read_raw_metadata(file_bytes.data(), size);
  if (!metadata.valid) {
    error = metadata.reason.empty() ? "This RAW could not be read." : metadata.reason;
    return 0;
  }
  if (!metadata.profile.known) {
    error = (metadata.model.empty() ? std::string("This camera")
                                    : metadata.make + " " + metadata.model) +
            " has no colour profile here, so its sensor data cannot be converted.";
    return 0;
  }
  error.clear();
  return 1;
}

/** What the container says, for the page's label and its Kelvin field:
 *  0  picture width at full size          1  picture height
 *  2  sensor raster width                 3  sensor raster height
 *  4  TIFF orientation 1..8               5  packing (Packing enum)
 *  6  bits per sample                     7  1 when the file names its own white balance
 *  8  as-shot Kelvin                      9  as-shot tint
 * 10  profile source (ProfileSource)     11  embedded JPEG offset
 * 12  embedded JPEG length               13  1 when the file is decodable
 */
const double* celinen_rawdec_describe() {
  WhiteBalanceReading reading;
  if (metadata.valid && metadata.profile.known && metadata.as_shot_neutral_known)
    reading = reading_from_chromaticity(
        white_point_from_neutral(metadata.profile, metadata.as_shot_neutral));
  fields = {double(metadata.crop.width),
            double(metadata.crop.height),
            double(metadata.raw_width),
            double(metadata.raw_height),
            double(metadata.orientation),
            double(int(metadata.packing)),
            double(metadata.bits_per_sample),
            metadata.as_shot_neutral_known ? 1.0 : 0.0,
            reading.known ? reading.kelvin : 0.0,
            reading.known ? reading.tint : 0.0,
            double(int(metadata.profile.source)),
            double(metadata.preview_offset),
            double(metadata.preview_length),
            metadata.valid && metadata.profile.known ? 1.0 : 0.0};
  return fields.data();
}

/** Sizes the output and fixes the white balance. `quality` is the Demosaic
 * enum (0 half, 1 bilinear, 2 gradient); `kelvin` 0 keeps the camera's own.
 * Returns 1 on success. */
std::int32_t celinen_rawdec_begin(std::int32_t quality, double kelvin, double tint,
                                  std::int32_t highlight_recovery, double exposure,
                                  double shoulder, std::uint32_t band) {
  decoder.reset();
  return guarded([&] {
    if (!metadata.valid) throw std::runtime_error("No RAW is open.");
    DecodeRequest request;
    request.quality = quality == 0   ? Demosaic::half
                      : quality == 1 ? Demosaic::bilinear
                                     : Demosaic::gradient;
    request.temperature = kelvin;
    request.tint = tint;
    request.highlight_recovery = highlight_recovery != 0;
    request.rendering.exposure = exposure;
    request.rendering.shoulder = shoulder;
    request.band = band;
    decoder = std::make_unique<Decoder>(file_bytes.data(), file_bytes.size(), metadata, request);
  });
}

/** One band. Returns progress in thousandths (1000 = finished), or -1 on a
 * failure that leaves the render unusable. */
std::int32_t celinen_rawdec_step() {
  if (!decoder) {
    error = "No decode is in progress.";
    return -1;
  }
  std::int32_t progress = -1;
  const bool stepped = guarded([&] {
    decoder->step();
    progress = std::int32_t(decoder->progress() * 1000.0 + 0.5);
  });
  if (!stepped) {
    decoder.reset();
    return -1;
  }
  return progress;
}

std::uint32_t celinen_rawdec_width() { return decoder ? decoder->width() : 0; }
std::uint32_t celinen_rawdec_height() { return decoder ? decoder->height() : 0; }
const std::uint8_t* celinen_rawdec_pixels() { return decoder ? decoder->pixels() : nullptr; }
/** Bytes this instance is holding, so a page can report its own memory. */
std::uint32_t celinen_rawdec_resident() {
  const std::size_t held = file_bytes.capacity() + (decoder ? decoder->resident_bytes() : 0);
  return std::uint32_t(held > 0xffffffffu ? 0xffffffffu : held);
}

/** The white balance the render actually used: Kelvin, tint, and 1 when it
 * came from the file rather than being assumed. */
const double* celinen_rawdec_white_balance() {
  static double values[3] = {0, 0, 0};
  if (decoder) {
    const auto& reading = decoder->white_balance();
    values[0] = reading.kelvin;
    values[1] = reading.tint;
    values[2] = reading.known ? 1 : 0;
  }
  return values;
}

/** Hands every buffer back. Safe at any point, including mid-decode. */
void celinen_rawdec_release() {
  decoder.reset();
  metadata = {};
  file_bytes.clear();
  file_bytes.shrink_to_fit();
  fields.clear();
  fields.shrink_to_fit();
  error.clear();
}
}
