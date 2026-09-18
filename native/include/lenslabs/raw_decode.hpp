#pragma once
#include "lenslabs/raw_color.hpp"
#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

// Sensor data out of a RAW file, at the resolution the sensor actually holds.
//
// `raw_preview.cpp` answers "which finished JPEG is inside this file". This
// answers the other question: what the photosites recorded. A Sony ARW carries
// a 1616x1080 embedded JPEG next to a 10- or 24-million-pixel mosaic; editing
// the JPEG is editing a thumbnail of the photograph.
//
// The chain is Sony-first but the container reader is generic TIFF/DNG, so a
// file that carries the DNG colour tags is decoded from its own numbers rather
// than from a table. Everything between unpack and the final encode is linear
// float: no step in this file raises a value to a gamma before the very last
// one, because white balance, demosaic, colour and highlight reconstruction are
// all wrong in a gamma-encoded space.
//
// Every stage below is a free function over an explicit buffer so a test can
// drive one of them with a known input. `Decoder` is the same chain run in row
// bands, which is how the browser runs it: bounded memory, a progress number
// and a cancellation point between every slice.
namespace lenslabs::raw {

// ---------------------------------------------------------------------------
// What the container says
// ---------------------------------------------------------------------------

// How the sensor samples are laid out in the file's bytes.
enum class Packing : std::uint8_t {
  unknown = 0,
  // One 16-bit word per sample, `bits_per_sample` of it used. Sony's
  // "Uncompressed" ARW, and the only variant present in the files this was
  // validated against.
  uncompressed_16 = 1,
  // Samples packed end to end with no padding: 12-bit (2 samples / 3 bytes) and
  // 14-bit (4 samples / 7 bytes). Nikon and some Sony crop modes.
  packed_bits = 2,
  // Sony's lossy ARW2: 32 pixels of one colour per 16 bytes as two independent
  // 16-pixel groups, each holding a min, a max, their two positions and eleven
  // 7-bit deltas, then a per-file tone curve back to the sensor's own range.
  sony_arw2 = 3,
  // ITU T.81 lossless (SOF3) Huffman, as DNG and Sony's lossless ARW use it.
  lossless_jpeg = 4,
};

const char* packing_name(Packing packing) noexcept;

// Colour of a photosite. Matches the DNG CFAPattern codes for RGB sensors.
enum class Cfa : std::uint8_t { red = 0, green = 1, blue = 2 };

// A repeating colour filter array. Only 2x2 (Bayer) is decoded; a 6x6 X-Trans
// is recognised and refused by name rather than decoded as if it were Bayer.
struct CfaPattern {
  std::uint32_t width = 2, height = 2;
  // Row-major, `width * height` entries, at most 36.
  std::array<Cfa, 36> color{};
  Cfa at(std::uint32_t x, std::uint32_t y) const noexcept {
    return color[(y % height) * width + (x % width)];
  }
  bool bayer() const noexcept { return width == 2 && height == 2; }
};

struct Rect {
  std::uint32_t x = 0, y = 0, width = 0, height = 0;
};

// Everything the file says about its own sensor data. `valid` is false and
// `reason` is a sentence when a file is not one this decoder can read; nothing
// here throws and nothing trusts an offset without checking it against the
// file's real length.
struct RawMetadata {
  bool valid = false;
  std::string reason;

  std::string make, model;
  int orientation = 1; // TIFF 1..8

  // The stored mosaic, which is larger than the picture: it carries masked
  // (optically black) columns and rows the camera uses for its own calibration.
  std::uint32_t raw_width = 0, raw_height = 0;
  // The part of that raster that saw light, and the part the camera calls the
  // photograph. `crop` is inside `active`; both are in stored-raster coordinates.
  Rect active, crop;

  std::uint32_t bits_per_sample = 0;
  Packing packing = Packing::unknown;
  bool little_endian = true;
  // Where the mosaic lives. `strip_offsets`/`strip_counts` hold every strip or
  // tile; `tile_width`/`tile_height` are 0 for stripped files.
  std::vector<std::uint64_t> strip_offsets, strip_counts;
  std::uint32_t tile_width = 0, tile_height = 0, rows_per_strip = 0;

  CfaPattern cfa;
  // Per CFA position in `cfa`'s own order, in sample units.
  std::array<double, 36> black{};
  double white = 0;
  // Sony's per-file curve from the compressed 11-bit range back to the
  // sensor's; empty unless `packing` is sony_arw2.
  std::array<std::uint16_t, 4> tone_curve{};
  bool has_tone_curve = false;

  // The camera's own white balance, as the DNG AsShotNeutral does it: the
  // camera-space value of a neutral subject, green normalised to 1. A Sony ARW
  // stores the reciprocal (multipliers) in tag 0x7313; both arrive here as
  // AsShotNeutral.
  std::array<double, 3> as_shot_neutral{1, 1, 1};
  bool as_shot_neutral_known = false;

  ColorProfile profile;

  // The largest embedded JPEG, so a caller can compare the two renderings
  // without parsing the container twice. 0 when the file names none.
  std::uint64_t preview_offset = 0, preview_length = 0;

  std::uint64_t active_pixels() const noexcept {
    return std::uint64_t(crop.width) * crop.height;
  }
};

// Reads the container from the whole file's bytes. Bounded and non-throwing:
// a hostile or truncated file comes back with `valid == false` and a reason.
RawMetadata read_raw_metadata(const std::uint8_t* bytes, std::size_t size) noexcept;

// ---------------------------------------------------------------------------
// Buffers
// ---------------------------------------------------------------------------

// The mosaic as the sensor wrote it: one sample per pixel, still in sensor
// units, still including the masked border.
struct Mosaic {
  std::uint32_t width = 0, height = 0;
  std::vector<std::uint16_t> samples;
  std::uint16_t at(std::uint32_t x, std::uint32_t y) const noexcept {
    return samples[std::size_t(y) * width + x];
  }
};

// A planar linear float image. `channels` is 1 (a normalised mosaic) or 3
// (linear RGB, interleaved). Values are scene-referred: 1.0 is the sensor's
// white level, and highlight reconstruction deliberately produces more than 1.
struct LinearImage {
  std::uint32_t width = 0, height = 0, channels = 0;
  std::vector<float> data;
  float* row(std::uint32_t y) noexcept {
    return data.data() + std::size_t(y) * width * channels;
  }
  const float* row(std::uint32_t y) const noexcept {
    return data.data() + std::size_t(y) * width * channels;
  }
};

// ---------------------------------------------------------------------------
// The chain, one testable function per step
// ---------------------------------------------------------------------------

// 1. Sensor samples out of the file's bytes, in stored-raster order. Throws
//    std::runtime_error naming the packing when the bytes do not hold one.
Mosaic unpack_mosaic(const std::uint8_t* bytes, std::size_t size, const RawMetadata& meta);

// The individual packings, exposed so a fixture can exercise one directly.
// Each writes `width * height` samples into `out` and throws on short input.
void unpack_uncompressed_16(const std::uint8_t* data, std::size_t size, std::uint32_t width,
                            std::uint32_t height, std::uint32_t bits, bool little_endian,
                            std::uint16_t* out);
void unpack_packed_bits(const std::uint8_t* data, std::size_t size, std::uint32_t width,
                        std::uint32_t height, std::uint32_t bits, bool little_endian,
                        std::uint16_t* out);
// One Sony ARW2 strip: `width` must be a multiple of 32 and every 16 bytes hold
// 16 pixels of one colour. `curve` is the file's tag 0x7010.
void unpack_sony_arw2(const std::uint8_t* data, std::size_t size, std::uint32_t width,
                      std::uint32_t height, const std::array<std::uint16_t, 4>& curve,
                      std::uint16_t* out);
// One SOF3 lossless-JPEG stream holding `components` interleaved predictors.
void unpack_lossless_jpeg(const std::uint8_t* data, std::size_t size, std::uint32_t width,
                          std::uint32_t height, std::uint16_t* out);

// 2. Black and white levels to a scene-referred float, per CFA position, with
//    the masked border dropped: the result is `meta.crop` sized. Values below
//    black become small negatives rather than zero, because clamping there is
//    what turns shadow noise into blotches.
LinearImage normalise_levels(const Mosaic& mosaic, const RawMetadata& meta);
// Rows [y0, y1) of the crop only, which is how the band pass reads a window.
LinearImage normalise_levels(const Mosaic& mosaic, const RawMetadata& meta, std::uint32_t y0,
                             std::uint32_t y1);

// 3. Per-channel gains from the camera's neutral (or a requested one), applied
//    to the mosaic in place. Returns the gains actually used, green at 1.
struct WhiteBalanceGains {
  std::array<double, 3> gain{1, 1, 1};
  // The neutral these came from, in camera space.
  std::array<double, 3> neutral{1, 1, 1};
};
WhiteBalanceGains white_balance_gains(const std::array<double, 3>& neutral);
void apply_white_balance(LinearImage& mosaic, const CfaPattern& cfa, std::uint32_t origin_x,
                         std::uint32_t origin_y, const WhiteBalanceGains& gains);

// 4. Demosaic. `gradient` is the shipping quality: a gradient-corrected
//    directional green followed by colour-difference chroma and a median pass
//    that removes the zipper colours the directional step leaves on edges.
//    `half` bins each 2x2 quad into one pixel, which is exact rather than
//    interpolated and is what the editing preview uses.
enum class Demosaic : std::uint8_t { half = 0, bilinear = 1, gradient = 2 };
LinearImage demosaic_mosaic(const LinearImage& mosaic, const CfaPattern& cfa,
                            std::uint32_t origin_x, std::uint32_t origin_y, Demosaic quality);

// 5. Highlight reconstruction. A channel that reached the sensor's white level
//    holds no information, so clamping it turns a bright sky cyan and a skin
//    highlight grey-pink. This rebuilds a clipped channel from the ones that
//    are still valid, keeping the pixel's hue from the unclipped channels and
//    its luminance from how far past white the brightest channel went.
//    `clip` is the per-channel level, in this buffer's units, at which a
//    channel is saturated (white balance has already scaled them apart).
void recover_highlights(LinearImage& rgb, const std::array<double, 3>& clip);

// 6. Camera RGB to the linear working space, and the working space to bytes.
//    `matrix` is row-major 3x3, built by camera_to_working() in raw_color.hpp.
void convert_colour(LinearImage& rgb, const std::array<double, 9>& matrix);

// A baseline rendering: exposure in stops, then a smooth highlight shoulder so
// reconstructed values above 1 roll off instead of clipping flat, then the sRGB
// transfer function. This is the only place in the file that leaves linear.
struct Rendering {
  double exposure = 0;   // stops
  double shoulder = 1.0; // 0 disables the roll-off entirely
};
// Writes `width * height * 4` sRGB RGBA8 bytes. Alpha is 255.
void encode_srgb(const LinearImage& rgb, const Rendering& rendering, std::uint8_t* out);

// ---------------------------------------------------------------------------
// The whole chain, in bounded bands
// ---------------------------------------------------------------------------

struct DecodeRequest {
  Demosaic quality = Demosaic::gradient;
  // 0 K keeps the camera's own white balance. Otherwise an absolute Kelvin and
  // a tint, the way Lightroom's two sliders read.
  double temperature = 0;
  double tint = 0;
  bool highlight_recovery = true;
  Rendering rendering;
  // Rows of output per step(). Smaller is a finer progress bar and a faster
  // cancellation; larger amortises the halo rows the demosaic re-reads.
  std::uint32_t band = 64;
};

// Refuses anything past these before allocating. wasm32 cannot address more
// than 2 GiB and every buffer below is sized from the sensor, not from a
// number in the file.
inline constexpr std::uint64_t max_sensor_pixels = 80'000'000;
inline constexpr std::uint64_t max_file_bytes = 512ull << 20;

// The chain as a resumable state machine. Construct, then call step() until it
// returns false; progress() is 0..1. Cancelling is simply not calling step()
// again — the destructor frees everything.
class Decoder {
 public:
  // `bytes` must outlive the Decoder. Throws std::invalid_argument when the
  // metadata is unusable or the sensor is past the bounds above.
  Decoder(const std::uint8_t* bytes, std::size_t size, const RawMetadata& meta,
          const DecodeRequest& request);
  ~Decoder();
  Decoder(const Decoder&) = delete;
  Decoder& operator=(const Decoder&) = delete;

  // One slice of work. False when the image is finished. Throws on a failure
  // that leaves the result unusable.
  bool step();
  double progress() const noexcept;

  std::uint32_t width() const noexcept { return width_; }
  std::uint32_t height() const noexcept { return height_; }
  // sRGB RGBA8, `width * height * 4` bytes. Complete only once step() is done.
  const std::uint8_t* pixels() const noexcept { return output_.data(); }
  std::uint8_t* take_pixels() noexcept { return output_.data(); }
  std::size_t pixel_bytes() const noexcept { return output_.size(); }

  // What the white balance resolved to, for the editor's Kelvin field.
  const WhiteBalanceReading& white_balance() const noexcept { return reading_; }
  const std::array<double, 9>& colour_matrix() const noexcept { return camera_to_working_; }

  // Bytes this instance is holding right now, for a memory report.
  std::size_t resident_bytes() const noexcept;

 private:
  void prepare();
  void render_band(std::uint32_t y0, std::uint32_t y1);

  const std::uint8_t* bytes_;
  std::size_t size_;
  RawMetadata meta_;
  DecodeRequest request_;
  Mosaic mosaic_;
  std::uint32_t width_ = 0, height_ = 0;
  std::uint32_t scale_ = 1; // 2 when half-size
  std::uint32_t next_row_ = 0;
  bool unpacked_ = false, done_ = false;
  std::vector<std::uint8_t> output_;
  LinearImage band_, rgb_;
  WhiteBalanceGains gains_;
  WhiteBalanceReading reading_;
  std::array<double, 9> camera_to_working_{};
  std::array<double, 3> clip_{1, 1, 1};
};

// Convenience for the tests and the command line: the whole thing at once.
struct DecodedRaw {
  std::uint32_t width = 0, height = 0;
  std::vector<std::uint8_t> rgba;
  WhiteBalanceReading white_balance;
  RawMetadata metadata;
};
DecodedRaw decode_raw(const std::uint8_t* bytes, std::size_t size, const DecodeRequest& request);

} // namespace lenslabs::raw
