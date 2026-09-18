// The whole conversion, run in bands so a 24-million-pixel frame fits in a
// browser tab and can be abandoned halfway.
//
// Memory is the reason this is not one pass over four whole-image buffers. At
// full size a 24 MP frame would need a float mosaic (97 MB), a float RGB image
// (290 MB) and an RGBA result (97 MB) resident together. Band by band it needs
// the RGBA result and two strips a few dozen rows tall, and for the packings
// whose rows can be addressed directly it never materialises the mosaic at all.
//
// Cancellation is simply not calling step() again: nothing is registered
// anywhere, no thread is running, and the destructor frees everything.
#include "lenslabs/raw_decode.hpp"
#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace lenslabs::raw {
namespace {

// How many mosaic rows above and below a band a demosaic reads. Green needs two,
// the colour differences two more, the median one: six is the exact reach, so a
// band's interior pixels come out identical to a whole-image pass.
std::uint32_t halo_for(Demosaic quality) noexcept {
  switch (quality) {
    case Demosaic::half: return 0;
    case Demosaic::bilinear: return 2;
    default: return 6;
  }
}

// Packings whose rows sit at a computable offset, so a band can be read without
// decoding the rest of the frame.
bool row_addressable(const RawMetadata& meta) noexcept {
  return meta.strip_offsets.size() == 1 &&
         (meta.packing == Packing::uncompressed_16 || meta.packing == Packing::packed_bits);
}

} // namespace

// The range overload is the real one; the whole-image version below calls it.
LinearImage normalise_levels(const Mosaic& mosaic, const RawMetadata& meta) {
  return normalise_levels(mosaic, meta, 0, meta.crop.height);
}

Decoder::Decoder(const std::uint8_t* bytes, std::size_t size, const RawMetadata& meta,
                 const DecodeRequest& request)
    : bytes_(bytes), size_(size), meta_(meta), request_(request) {
  if (!bytes || !size) throw std::invalid_argument("This RAW has no bytes to read.");
  if (size > max_file_bytes) throw std::invalid_argument("This RAW is larger than the decoder will read.");
  if (!meta_.valid)
    throw std::invalid_argument(meta_.reason.empty() ? "This RAW cannot be read." : meta_.reason);
  if (meta_.active_pixels() > max_sensor_pixels)
    throw std::invalid_argument("This sensor is larger than this decoder will process.");
  if (!meta_.profile.known)
    throw std::invalid_argument(meta_.model.empty()
                                    ? "This camera has no colour profile here, so its sensor data cannot be converted."
                                    : meta_.model + " has no colour profile here, so its sensor data cannot be converted.");
  if (request_.band < 8 || request_.band > 512) request_.band = 64;
  prepare();
}

Decoder::~Decoder() = default;

void Decoder::prepare() {
  scale_ = request_.quality == Demosaic::half ? 2u : 1u;
  // A half-size pass consumes whole 2x2 quads, so an odd crop loses its last
  // row or column rather than reading a quad that is not there.
  width_ = meta_.crop.width / scale_;
  height_ = meta_.crop.height / scale_;
  if (!width_ || !height_) throw std::invalid_argument("This RAW's picture area is empty.");

  // White balance: the camera's own neutral, or the one a Kelvin/tint pair means.
  std::array<double, 3> neutral = meta_.as_shot_neutral;
  if (request_.temperature > 0) {
    neutral = neutral_for_white_point(meta_.profile,
                                      chromaticity_from_reading(request_.temperature, request_.tint));
  } else if (!meta_.as_shot_neutral_known) {
    // No as-shot balance in the file: the profile's own daylight neutral is the
    // honest default, and the reading below says so rather than claiming a
    // temperature the camera never recorded.
    neutral = neutral_for_white_point(meta_.profile, d65);
  }
  gains_ = white_balance_gains(neutral);
  reading_ = reading_from_chromaticity(white_point_from_neutral(meta_.profile, gains_.neutral));
  reading_.neutral = gains_.neutral;
  reading_.known = reading_.known && (meta_.as_shot_neutral_known || request_.temperature > 0);

  // Camera RGB to the working space, folded together with the inverse of the
  // gains the mosaic already carries, so the band pass is a single 3x3.
  const Matrix3 raw_to_working = camera_to_working(meta_.profile, gains_.neutral);
  camera_to_working_ = multiply(raw_to_working, diagonal({gains_.neutral[0] * 1.0, 1.0,
                                                          gains_.neutral[2] * 1.0}));
  // A channel saturates where its own gain took the sensor's white level.
  clip_ = {gains_.gain[0], gains_.gain[1], gains_.gain[2]};

  output_.assign(std::size_t(width_) * height_ * 4, 0);
  if (!row_addressable(meta_)) {
    mosaic_ = unpack_mosaic(bytes_, size_, meta_);
    unpacked_ = true;
  }
}

double Decoder::progress() const noexcept {
  if (done_) return 1.0;
  const double rows = height_ ? double(next_row_) / height_ : 1.0;
  return unpacked_ ? 0.15 + 0.85 * rows : rows;
}

std::size_t Decoder::resident_bytes() const noexcept {
  return output_.size() + mosaic_.samples.size() * sizeof(std::uint16_t) +
         band_.data.size() * sizeof(float) + rgb_.data.size() * sizeof(float);
}

bool Decoder::step() {
  if (done_) return false;
  const std::uint32_t y0 = next_row_;
  const std::uint32_t y1 = std::min(height_, y0 + request_.band);
  render_band(y0, y1);
  next_row_ = y1;
  if (next_row_ >= height_) {
    done_ = true;
    // The scratch strips are the biggest thing left; hand them back before the
    // caller copies the result out.
    band_ = {};
    rgb_ = {};
    mosaic_ = {};
    unpacked_ = false;
  }
  return !done_;
}

void Decoder::render_band(std::uint32_t y0, std::uint32_t y1) {
  const std::uint32_t halo = halo_for(request_.quality);
  // Mosaic rows, in crop coordinates, this band of output rows needs.
  const std::uint32_t first_needed = y0 * scale_;
  const std::uint32_t last_needed = y1 * scale_; // exclusive
  const std::uint32_t window_start = first_needed > halo ? first_needed - halo : 0;
  const std::uint32_t window_end = std::min(meta_.crop.height, last_needed + halo);

  // 1. Black and white levels, for this window only.
  if (unpacked_) {
    band_ = normalise_levels(mosaic_, meta_, window_start, window_end);
  } else {
    // Row-addressable packing: read the window's rows straight out of the file.
    Mosaic window;
    window.width = meta_.raw_width;
    window.height = window_end - window_start + meta_.crop.y;
    // Only the rows the window covers are filled; normalise_levels reads rows
    // [crop.y + window_start, crop.y + window_end) of this raster.
    const std::uint32_t raster_first = meta_.crop.y + window_start;
    const std::uint32_t raster_rows = window_end - window_start;
    window.height = raster_first + raster_rows;
    window.samples.assign(std::size_t(window.height) * window.width, 0);
    const std::uint64_t at = meta_.strip_offsets[0];
    const std::uint64_t length = meta_.strip_counts[0];
    std::uint16_t* out = window.samples.data() + std::size_t(raster_first) * window.width;
    if (meta_.packing == Packing::uncompressed_16) {
      const std::uint64_t offset = std::uint64_t(raster_first) * meta_.raw_width * 2;
      if (offset > length) throw std::runtime_error("This RAW's sensor data ends early.");
      unpack_uncompressed_16(bytes_ + at + offset, std::size_t(length - offset), meta_.raw_width,
                             raster_rows, meta_.bits_per_sample, meta_.little_endian, out);
    } else {
      const std::uint64_t row_bytes = (std::uint64_t(meta_.raw_width) * meta_.bits_per_sample + 7) / 8;
      const std::uint64_t offset = std::uint64_t(raster_first) * row_bytes;
      if (offset > length) throw std::runtime_error("This RAW's sensor data ends early.");
      unpack_packed_bits(bytes_ + at + offset, std::size_t(length - offset), meta_.raw_width,
                         raster_rows, meta_.bits_per_sample, meta_.little_endian, out);
    }
    band_ = normalise_levels(window, meta_, window_start, window_end);
  }

  // 2. White balance, in the mosaic, before anything interpolates across
  //    channels that are still scaled apart from each other.
  apply_white_balance(band_, meta_.cfa, meta_.crop.x, meta_.crop.y + window_start, gains_);

  // 3. Demosaic the window.
  rgb_ = demosaic_mosaic(band_, meta_.cfa, meta_.crop.x, meta_.crop.y + window_start,
                         request_.quality);

  // 4. Rebuild the channels that reached the sensor's ceiling.
  if (request_.highlight_recovery) recover_highlights(rgb_, clip_);

  // 5. Camera colour to the working space, then out as sRGB bytes. Only the
  //    rows this band actually owns are written; the halo was context.
  convert_colour(rgb_, camera_to_working_);
  const std::uint32_t skip = (first_needed - window_start) / scale_;
  LinearImage owned;
  owned.width = width_;
  owned.height = y1 - y0;
  owned.channels = 3;
  owned.data.resize(std::size_t(owned.width) * owned.height * 3);
  for (std::uint32_t y = 0; y < owned.height; ++y) {
    const float* src = rgb_.row(skip + y);
    std::copy(src, src + std::size_t(width_) * 3, owned.row(y));
  }
  encode_srgb(owned, request_.rendering, output_.data() + std::size_t(y0) * width_ * 4);
}

DecodedRaw decode_raw(const std::uint8_t* bytes, std::size_t size, const DecodeRequest& request) {
  DecodedRaw out;
  out.metadata = read_raw_metadata(bytes, size);
  if (!out.metadata.valid)
    throw std::runtime_error(out.metadata.reason.empty() ? "This RAW cannot be read."
                                                         : out.metadata.reason);
  Decoder decoder(bytes, size, out.metadata, request);
  while (decoder.step()) {
  }
  out.width = decoder.width();
  out.height = decoder.height();
  out.white_balance = decoder.white_balance();
  out.rgba.assign(decoder.pixels(), decoder.pixels() + decoder.pixel_bytes());
  return out;
}

} // namespace lenslabs::raw
