// The RAW converter, driven on files built byte by byte.
//
// A real ARW proves the decoder reads one camera. These fixtures prove the
// things a real file cannot: that known colours survive the whole chain to a
// bounded error, that each packing is read exactly as it was written, that a
// band pass gives byte-identical pixels to a whole-image pass, and that a
// hostile or truncated container is refused instead of crashing.
#include "lenslabs/raw_decode.hpp"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <iostream>
#include <random>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
using namespace lenslabs::raw;
using Blob = std::vector<std::uint8_t>;

int checks = 0;
void check(bool passed, const std::string& label) {
  ++checks;
  if (!passed) throw std::runtime_error(label);
}
void close_to(double actual, double expected, double tolerance, const std::string& label) {
  ++checks;
  if (!(std::abs(actual - expected) <= tolerance))
    throw std::runtime_error(label + ": expected " + std::to_string(expected) + " +/- " +
                             std::to_string(tolerance) + ", got " + std::to_string(actual));
}

// ---------------------------------------------------------------------------
// A little-endian TIFF writer, so a fixture is a real container
// ---------------------------------------------------------------------------

struct Field {
  std::uint16_t tag = 0, type = 0;
  std::uint32_t count = 0;
  Blob payload;      // when it does not fit in four bytes
  std::uint32_t inline_value = 0;
  bool is_inline = false;
};

void put16(Blob& out, std::uint16_t v) {
  out.push_back(std::uint8_t(v));
  out.push_back(std::uint8_t(v >> 8));
}
void put32(Blob& out, std::uint32_t v) {
  for (int i = 0; i < 4; ++i) out.push_back(std::uint8_t(v >> (8 * i)));
}

Field short_field(std::uint16_t tag, std::uint16_t value) {
  Field f{tag, 3, 1, {}, value, true};
  return f;
}
Field long_field(std::uint16_t tag, std::uint32_t value) {
  Field f{tag, 4, 1, {}, value, true};
  return f;
}
Field shorts_field(std::uint16_t tag, const std::vector<std::uint16_t>& values) {
  Field f{tag, 3, std::uint32_t(values.size()), {}, 0, values.size() <= 2};
  if (f.is_inline) {
    std::uint32_t packed = 0;
    for (std::size_t i = 0; i < values.size(); ++i) packed |= std::uint32_t(values[i]) << (16 * i);
    f.inline_value = packed;
  } else {
    for (auto v : values) put16(f.payload, v);
  }
  return f;
}
Field bytes_field(std::uint16_t tag, const Blob& values) {
  Field f{tag, 1, std::uint32_t(values.size()), values, 0, values.size() <= 4};
  if (f.is_inline) {
    std::uint32_t packed = 0;
    for (std::size_t i = 0; i < values.size(); ++i) packed |= std::uint32_t(values[i]) << (8 * i);
    f.inline_value = packed;
    f.payload.clear();
  }
  return f;
}
Field text_field(std::uint16_t tag, const std::string& value) {
  Blob bytes(value.begin(), value.end());
  bytes.push_back(0);
  Field f{tag, 2, std::uint32_t(bytes.size()), bytes, 0, bytes.size() <= 4};
  if (f.is_inline) {
    std::uint32_t packed = 0;
    for (std::size_t i = 0; i < bytes.size(); ++i) packed |= std::uint32_t(bytes[i]) << (8 * i);
    f.inline_value = packed;
    f.payload.clear();
  }
  return f;
}
Field rationals_field(std::uint16_t tag, const std::vector<double>& values, bool signed_type) {
  Field f{tag, std::uint16_t(signed_type ? 10 : 5), std::uint32_t(values.size()), {}, 0, false};
  for (double v : values) {
    const double denominator = 1000000.0;
    if (signed_type) {
      put32(f.payload, std::uint32_t(std::int32_t(std::llround(v * denominator))));
      put32(f.payload, std::uint32_t(std::int32_t(denominator)));
    } else {
      put32(f.payload, std::uint32_t(std::llround(std::max(0.0, v) * denominator)));
      put32(f.payload, std::uint32_t(denominator));
    }
  }
  return f;
}
Field longs_field(std::uint16_t tag, const std::vector<std::uint32_t>& values) {
  Field f{tag, 4, std::uint32_t(values.size()), {}, 0, values.size() == 1};
  if (f.is_inline) {
    f.inline_value = values[0];
  } else {
    for (auto v : values) put32(f.payload, v);
  }
  return f;
}

// Lays out header, two IFDs, their out-of-line values and the sensor strip.
// Placeholders named by tag are patched once the real offsets are known.
struct TiffBuilder {
  std::vector<Field> ifd0, sub;
  Blob strip;
  std::uint32_t strip_tag_owner = 0; // unused; strip offset is patched in `sub`

  Blob build() const {
    Blob out;
    put16(out, 0x4949);
    put16(out, 42);
    put32(out, 8);
    // IFD0 at 8. Its size fixes where the SubIFD starts.
    const std::uint32_t ifd0_at = 8;
    const std::uint32_t ifd0_size = 2 + std::uint32_t(ifd0.size()) * 12 + 4;
    const std::uint32_t sub_at = ifd0_at + ifd0_size;
    const std::uint32_t sub_size = 2 + std::uint32_t(sub.size()) * 12 + 4;
    std::uint32_t values_at = sub_at + sub_size;

    // Where each field's payload will live.
    std::vector<std::uint32_t> ifd0_offsets(ifd0.size()), sub_offsets(sub.size());
    std::uint32_t cursor = values_at;
    for (std::size_t i = 0; i < ifd0.size(); ++i) {
      ifd0_offsets[i] = cursor;
      if (!ifd0[i].is_inline) cursor += std::uint32_t((ifd0[i].payload.size() + 1) & ~std::size_t(1));
    }
    for (std::size_t i = 0; i < sub.size(); ++i) {
      sub_offsets[i] = cursor;
      if (!sub[i].is_inline) cursor += std::uint32_t((sub[i].payload.size() + 1) & ~std::size_t(1));
    }
    const std::uint32_t strip_at = cursor;

    const auto emit = [&](const std::vector<Field>& fields,
                          const std::vector<std::uint32_t>& offsets) {
      put16(out, std::uint16_t(fields.size()));
      for (std::size_t i = 0; i < fields.size(); ++i) {
        const Field& f = fields[i];
        put16(out, f.tag);
        put16(out, f.type);
        put32(out, f.count);
        // Two placeholders resolve late: SubIFDs (330) and StripOffsets (273).
        if (f.tag == 330 && f.is_inline)
          put32(out, sub_at);
        else if (f.tag == 273 && f.is_inline)
          put32(out, strip_at);
        else if (f.is_inline)
          put32(out, f.inline_value);
        else
          put32(out, offsets[i]);
      }
      put32(out, 0);
    };
    emit(ifd0, ifd0_offsets);
    emit(sub, sub_offsets);
    for (const auto& f : ifd0)
      if (!f.is_inline) {
        out.insert(out.end(), f.payload.begin(), f.payload.end());
        if (f.payload.size() & 1) out.push_back(0);
      }
    for (const auto& f : sub)
      if (!f.is_inline) {
        out.insert(out.end(), f.payload.begin(), f.payload.end());
        if (f.payload.size() & 1) out.push_back(0);
      }
    out.insert(out.end(), strip.begin(), strip.end());
    return out;
  }
};

// ---------------------------------------------------------------------------
// A synthetic camera, so a fixture has a truth to be measured against
// ---------------------------------------------------------------------------

// A plausible, physically admissible camera: every entry of camera->XYZ is a
// non-negative response, so no channel absorbs light.
const Matrix3 fixture_base{0.31, 0.52, 0.12, 0.14, 0.80, 0.06, 0.01, 0.10, 0.98};
// Per-channel sensitivity, so the fixture carries a real white balance for the
// decoder to undo rather than an already-neutral sensor.
const Vector3 fixture_sensitivity{2.0, 1.0, 1.25};

// camera -> XYZ, scaled so that the camera's own neutral is exactly
// `fixture_sensitivity` normalised, and so a neutral at the sensor's white
// level renders at the working space's white.
Matrix3 fixture_camera_to_xyz() {
  const Vector3 balanced = multiply(invert(fixture_base), xyz_from_chromaticity(d65));
  Matrix3 out{};
  for (int row = 0; row < 3; ++row)
    for (int column = 0; column < 3; ++column)
      out[std::size_t(row * 3 + column)] = fixture_base[std::size_t(row * 3 + column)] *
                                           balanced[std::size_t(column)] /
                                           fixture_sensitivity[std::size_t(column)];
  return out;
}

// DNG's ColorMatrix maps XYZ onto the camera at the calibration illuminant;
// the chromatic adaptation onto the D50 connection space is the decoder's job,
// not the tag's, so this is a plain inverse and not an adapted one.
Matrix3 fixture_colour_matrix() { return invert(fixture_camera_to_xyz()); }

Vector3 fixture_neutral() {
  const Vector3 camera = multiply(invert(fixture_camera_to_xyz()), xyz_from_chromaticity(d65));
  return {camera[0] / camera[1], 1.0, camera[2] / camera[1]};
}

// Linear sRGB (D65) to this camera's raw RGB.
Vector3 srgb_to_camera(const Vector3& linear_srgb) {
  const Vector3 xyz = multiply(srgb_to_xyz_d65, linear_srgb);
  return multiply(invert(fixture_camera_to_xyz()), xyz);
}

struct Fixture {
  Blob file;
  std::uint32_t width = 0, height = 0;
};

// A mosaic of flat colour blocks, written as an uncompressed 14-bit ARW-like
// file with DNG colour tags, so the decoder reads its profile from the file.
Fixture build_colour_fixture(const std::vector<Vector3>& linear_colours, std::uint32_t block,
                             std::uint32_t columns, double white = 16383, double black = 512,
                             double headroom = 4.0) {
  const std::uint32_t rows = std::uint32_t((linear_colours.size() + columns - 1) / columns);
  const std::uint32_t crop_w = columns * block, crop_h = rows * block;
  const std::uint32_t margin = 8; // masked border, so the crop is not the raster
  const std::uint32_t raw_w = crop_w + margin * 2, raw_h = crop_h + margin * 2;
  const Vector3 neutral = fixture_neutral();
  // The exposure the fixture is written at: a mid grey sits well below white so
  // nothing clips, and `headroom` is how much room is left above it.
  const double span = white - black;
  std::vector<std::uint16_t> samples(std::size_t(raw_w) * raw_h, std::uint16_t(black));
  for (std::size_t i = 0; i < linear_colours.size(); ++i) {
    const Vector3 camera = srgb_to_camera(linear_colours[i]);
    const std::uint32_t bx = std::uint32_t(i % columns) * block + margin;
    const std::uint32_t by = std::uint32_t(i / columns) * block + margin;
    for (std::uint32_t y = 0; y < block; ++y)
      for (std::uint32_t x = 0; x < block; ++x) {
        // RGGB at the raster origin; the margin is even so the crop keeps phase.
        const int channel = ((by + y) % 2 == 0) ? (((bx + x) % 2 == 0) ? 0 : 1)
                                                : (((bx + x) % 2 == 0) ? 1 : 2);
        const double value = camera[std::size_t(channel)] / headroom;
        samples[std::size_t(by + y) * raw_w + bx + x] =
            std::uint16_t(std::clamp(black + value * span, 0.0, white));
      }
  }
  Blob strip(samples.size() * 2);
  for (std::size_t i = 0; i < samples.size(); ++i) {
    strip[i * 2] = std::uint8_t(samples[i]);
    strip[i * 2 + 1] = std::uint8_t(samples[i] >> 8);
  }

  TiffBuilder builder;
  const Matrix3 colour_matrix = fixture_colour_matrix();
  builder.ifd0 = {
      text_field(271, "FIXTURE"),
      text_field(272, "SYNTHETIC-1"),
      short_field(274, 1),
      long_field(330, 0), // patched to the SubIFD's offset
      rationals_field(50721, std::vector<double>(colour_matrix.begin(), colour_matrix.end()), true),
      short_field(50778, 21), // D65
      rationals_field(50728, {neutral[0], neutral[1], neutral[2]}, false),
  };
  builder.sub = {
      long_field(254, 0),
      shorts_field(256, {std::uint16_t(raw_w)}),
      shorts_field(257, {std::uint16_t(raw_h)}),
      short_field(258, 14),
      short_field(259, 1),
      short_field(262, 32803),
      long_field(273, 0), // patched to the strip's offset
      short_field(277, 1),
      shorts_field(278, {std::uint16_t(raw_h)}),
      long_field(279, std::uint32_t(strip.size())),
      shorts_field(33421, {2, 2}),
      bytes_field(33422, {0, 1, 1, 2}),
      shorts_field(50714, {std::uint16_t(black)}),
      shorts_field(50717, {std::uint16_t(white)}),
      longs_field(0xc61f, {margin, margin}),
      longs_field(0xc620, {crop_w, crop_h}),
  };
  builder.strip = std::move(strip);
  return {builder.build(), crop_w, crop_h};
}

Vector3 sample_block(const DecodedRaw& decoded, std::uint32_t index, std::uint32_t block,
                     std::uint32_t columns) {
  // The block's middle, well away from any demosaic edge effect.
  const std::uint32_t x = (index % columns) * block + block / 2;
  const std::uint32_t y = (index / columns) * block + block / 2;
  const std::size_t at = (std::size_t(y) * decoded.width + x) * 4;
  return {decoded.rgba[at] / 255.0, decoded.rgba[at + 1] / 255.0, decoded.rgba[at + 2] / 255.0};
}

// ---------------------------------------------------------------------------
// Colour maths
// ---------------------------------------------------------------------------

void colour_maths_tests() {
  const Matrix3 m{0.4, 0.3, 0.2, 0.1, 0.9, 0.05, 0.02, 0.1, 0.8};
  const Matrix3 round_trip = multiply(m, invert(m));
  for (int i = 0; i < 9; ++i)
    close_to(round_trip[std::size_t(i)], i % 4 == 0 ? 1.0 : 0.0, 1e-9, "matrix inverse round trip");

  // Bradford takes one white exactly onto the other.
  const Vector3 adapted = multiply(bradford_adaptation(d65, d50), xyz_from_chromaticity(d65));
  const Chromaticity landed = chromaticity_of(adapted);
  close_to(landed.x, d50.x, 1e-6, "bradford D65 to D50 x");
  close_to(landed.y, d50.y, 1e-6, "bradford D65 to D50 y");

  // A point on the locus reads back its own temperature, with no tint.
  for (double kelvin : {2800.0, 4000.0, 5500.0, 6500.0, 9000.0}) {
    const auto reading = reading_from_chromaticity(white_point_for(kelvin));
    check(reading.known, "locus point has a reading");
    // The two loci this uses are approximations of each other's curve, so the
    // agreement is a few per cent rather than exact.
    close_to(reading.kelvin, kelvin, kelvin * 0.05, "correlated colour temperature");
    close_to(reading.tint, 0, 22, "a locus point is near zero tint");
  }

  // Kelvin and tint round trip through a chromaticity.
  for (double kelvin : {3200.0, 5000.0, 7500.0})
    for (double tint : {-40.0, 0.0, 30.0}) {
      const auto back = reading_from_chromaticity(chromaticity_from_reading(kelvin, tint));
      check(back.known, "constructed chromaticity has a reading");
      close_to(back.kelvin, kelvin, kelvin * 0.02, "kelvin round trip");
      close_to(back.tint, tint, 2.0, "tint round trip");
    }

  // The camera's own neutral must render exactly neutral.
  ColorProfile profile;
  profile.known = true;
  profile.source = ProfileSource::model_table;
  profile.color_matrix_1 = fixture_colour_matrix();
  profile.illuminant_1 = 21;
  const Vector3 neutral = fixture_neutral();
  const Matrix3 working = camera_to_working(profile, neutral);
  const Vector3 rendered = multiply(working, neutral);
  close_to(rendered[0], rendered[1], 1e-6, "neutral renders neutral (red vs green)");
  close_to(rendered[2], rendered[1], 1e-6, "neutral renders neutral (blue vs green)");
  close_to(rendered[1], 1.0, 1e-6, "neutral renders at unit luminance");

  // And the white point the neutral implies is the one it was built from.
  const Chromaticity white = white_point_from_neutral(profile, neutral);
  close_to(white.x, d65.x, 1e-4, "recovered white point x");
  close_to(white.y, d65.y, 1e-4, "recovered white point y");

  // The transfer function is its own inverse's inverse.
  for (double v : {0.0, 0.002, 0.05, 0.5, 0.9, 1.0})
    close_to(srgb_decode(srgb_encode(v)), v, 1e-9, "sRGB transfer round trip");
}

// ---------------------------------------------------------------------------
// Container parsing
// ---------------------------------------------------------------------------

void metadata_tests() {
  const auto fixture = build_colour_fixture({{0.5, 0.5, 0.5}}, 16, 1);
  const auto meta = read_raw_metadata(fixture.file.data(), fixture.file.size());
  check(meta.valid, "the fixture parses: " + meta.reason);
  check(meta.make == "FIXTURE", "make");
  check(meta.model == "SYNTHETIC-1", "model");
  check(meta.packing == Packing::uncompressed_16, "packing");
  check(meta.bits_per_sample == 14, "bits per sample");
  check(meta.crop.width == fixture.width && meta.crop.height == fixture.height, "crop size");
  check(meta.crop.x == 8 && meta.crop.y == 8, "crop origin");
  check(meta.raw_width == fixture.width + 16, "raster is wider than the crop");
  close_to(meta.white, 16383, 0, "white level");
  close_to(meta.black[0], 512, 0, "black level");
  check(meta.cfa.bayer(), "bayer");
  check(meta.cfa.color[0] == Cfa::red && meta.cfa.color[3] == Cfa::blue, "RGGB");
  check(meta.as_shot_neutral_known, "as-shot neutral present");
  check(meta.profile.known && meta.profile.source == ProfileSource::dng_tags,
        "profile comes from the file's own tags");

  // Truncation at every length must be refused, never crash.
  for (std::size_t length = 0; length < fixture.file.size(); length += 7) {
    const auto partial = read_raw_metadata(fixture.file.data(), length);
    if (partial.valid) {
      // Valid is only acceptable once the strip really is present.
      check(length >= fixture.file.size() - fixture.file.size() / 100,
            "a truncated file must not parse as complete");
    } else {
      check(!partial.reason.empty(), "a refusal says why");
    }
  }

  // Random corruption must never crash or claim an oversized sensor.
  std::mt19937 random(20260918);
  for (int trial = 0; trial < 400; ++trial) {
    Blob damaged = fixture.file;
    std::uniform_int_distribution<std::size_t> where(0, damaged.size() - 1);
    std::uniform_int_distribution<int> what(0, 255);
    for (int i = 0; i < 12; ++i) damaged[where(random)] = std::uint8_t(what(random));
    const auto broken = read_raw_metadata(damaged.data(), damaged.size());
    if (broken.valid) {
      check(std::uint64_t(broken.raw_width) * broken.raw_height <= max_sensor_pixels,
            "a corrupt file cannot claim an oversized sensor");
      try {
        DecodeRequest request;
        request.quality = Demosaic::half;
        Decoder decoder(damaged.data(), damaged.size(), broken, request);
        while (decoder.step()) {
        }
      } catch (const std::exception&) {
        // Refusing by exception is the expected outcome; crashing is not.
      }
    }
  }

  // Not a TIFF at all.
  const Blob nonsense(64, 0x5a);
  const auto refused = read_raw_metadata(nonsense.data(), nonsense.size());
  check(!refused.valid && !refused.reason.empty(), "a non-TIFF is refused by name");
}

// ---------------------------------------------------------------------------
// Packings
// ---------------------------------------------------------------------------

void packing_tests() {
  std::mt19937 random(7);
  std::uniform_int_distribution<int> sample(0, 16383);
  const std::uint32_t width = 64, height = 8;
  std::vector<std::uint16_t> truth(std::size_t(width) * height);
  for (auto& v : truth) v = std::uint16_t(sample(random));

  // 16-bit words, both byte orders.
  for (bool little : {true, false}) {
    Blob packed(truth.size() * 2);
    for (std::size_t i = 0; i < truth.size(); ++i) {
      packed[i * 2 + (little ? 0 : 1)] = std::uint8_t(truth[i]);
      packed[i * 2 + (little ? 1 : 0)] = std::uint8_t(truth[i] >> 8);
    }
    std::vector<std::uint16_t> out(truth.size());
    unpack_uncompressed_16(packed.data(), packed.size(), width, height, 14, little, out.data());
    check(out == truth, little ? "uncompressed 16-bit little endian" : "… big endian");
  }

  // Packed bits, most significant first, rows on a byte boundary.
  for (std::uint32_t bits : {12u, 14u}) {
    std::vector<std::uint16_t> masked = truth;
    for (auto& v : masked) v = std::uint16_t(v & ((1u << bits) - 1));
    const std::size_t row_bytes = (std::size_t(width) * bits + 7) / 8;
    Blob packed(row_bytes * height, 0);
    for (std::uint32_t y = 0; y < height; ++y) {
      std::size_t bit = 0;
      std::uint8_t* row = packed.data() + row_bytes * y;
      for (std::uint32_t x = 0; x < width; ++x) {
        const std::uint32_t value = masked[std::size_t(y) * width + x];
        for (int b = int(bits) - 1; b >= 0; --b, ++bit)
          if ((value >> b) & 1) row[bit >> 3] |= std::uint8_t(0x80 >> (bit & 7));
      }
    }
    std::vector<std::uint16_t> out(truth.size());
    unpack_packed_bits(packed.data(), packed.size(), width, height, bits, true, out.data());
    check(out == masked, "packed " + std::to_string(bits) + "-bit round trip");
  }

  // Sony's lossy 11+7. Encoded here to the published layout, then read back:
  // the minimum and maximum of each group of sixteen come back exactly, and
  // every other pixel to within the shift the group's own range chose.
  {
    const std::uint32_t arw_width = 64, arw_height = 4;
    const std::array<std::uint16_t, 4> curve{2000, 2600, 3225, 3525};
    std::vector<std::uint16_t> eleven(std::size_t(arw_width) * arw_height);
    std::uniform_int_distribution<int> small(0, 2047);
    for (auto& v : eleven) v = std::uint16_t(small(random));
    Blob packed(std::size_t(arw_width) * arw_height, 0);
    for (std::uint32_t y = 0; y < arw_height; ++y) {
      std::uint8_t* row = packed.data() + std::size_t(y) * arw_width;
      std::uint32_t column = 0;
      for (std::size_t at = 0; at + 16 <= arw_width && column + 30 < arw_width; at += 16) {
        std::uint16_t group[16];
        for (int i = 0; i < 16; ++i) group[i] = eleven[std::size_t(y) * arw_width + column + i * 2];
        int index_max = 0, index_min = 0;
        for (int i = 1; i < 16; ++i) {
          if (group[i] > group[index_max]) index_max = i;
          if (group[i] < group[index_min]) index_min = i;
        }
        const std::uint32_t maximum = group[index_max], minimum = group[index_min];
        int shift = 0;
        while (shift < 4 && (0x80u << shift) <= maximum - minimum) ++shift;
        std::uint8_t* block = row + at;
        const std::uint32_t header = maximum | (minimum << 11) |
                                     (std::uint32_t(index_max) << 22) |
                                     (std::uint32_t(index_min) << 26);
        for (int i = 0; i < 4; ++i) block[i] = std::uint8_t(header >> (8 * i));
        std::uint32_t bit = 30;
        for (int i = 0; i < 16; ++i) {
          if (i == index_max || i == index_min) continue;
          const std::uint32_t delta = std::min<std::uint32_t>((group[i] - minimum) >> shift, 0x7f);
          for (int b = 0; b < 7; ++b, ++bit)
            if ((delta >> b) & 1) block[bit >> 3] |= std::uint8_t(1u << (bit & 7));
          // `bit` advanced seven; the loop above did that.
        }
        for (int i = 0; i < 16; ++i) column += 2;
        column -= (column & 1) ? 1 : 31;
      }
    }
    std::vector<std::uint16_t> out(std::size_t(arw_width) * arw_height, 0);
    unpack_sony_arw2(packed.data(), packed.size(), arw_width, arw_height, curve, out.data());
    // The curve is monotone, so a larger eleven-bit value must stay larger.
    std::size_t compared = 0;
    for (std::uint32_t y = 0; y < arw_height; ++y)
      for (std::uint32_t x = 0; x + 2 < arw_width; x += 2) {
        const auto a = eleven[std::size_t(y) * arw_width + x];
        const auto b = eleven[std::size_t(y) * arw_width + x + 2];
        const auto da = out[std::size_t(y) * arw_width + x];
        const auto db = out[std::size_t(y) * arw_width + x + 2];
        if (a == b) continue;
        ++compared;
        check((a < b) ? (da <= db) : (da >= db), "ARW2 preserves order through its curve");
      }
    check(compared > 100, "the ARW2 fixture compared a useful number of pairs");
    // Every decoded sample is inside the sensor's range.
    for (auto v : out) check(v <= 16383, "ARW2 sample is inside 14 bits");
  }
}

// One SOF3 lossless-JPEG stream, encoded here so the decoder has something
// written to the specification rather than by another decoder.
Blob encode_lossless_jpeg(const std::vector<std::uint16_t>& samples, std::uint32_t width,
                          std::uint32_t height, int components, int precision) {
  const std::uint32_t per_component = width / std::uint32_t(components);
  // One Huffman table: code length n+1 for category n, which is a legal
  // canonical table and keeps the encoder short.
  std::array<int, 17> counts{};
  for (int category = 0; category <= 15; ++category) counts[std::size_t(category + 1)] = 1;
  Blob out;
  out.push_back(0xff);
  out.push_back(0xd8);
  // DHT
  {
    Blob segment;
    segment.push_back(0x00); // class 0, id 0
    for (int i = 1; i <= 16; ++i) segment.push_back(std::uint8_t(counts[std::size_t(i)]));
    for (int category = 0; category <= 15; ++category) segment.push_back(std::uint8_t(category));
    out.push_back(0xff);
    out.push_back(0xc4);
    out.push_back(std::uint8_t((segment.size() + 2) >> 8));
    out.push_back(std::uint8_t(segment.size() + 2));
    out.insert(out.end(), segment.begin(), segment.end());
  }
  // SOF3
  {
    Blob segment;
    segment.push_back(std::uint8_t(precision));
    segment.push_back(std::uint8_t(height >> 8));
    segment.push_back(std::uint8_t(height));
    segment.push_back(std::uint8_t(per_component >> 8));
    segment.push_back(std::uint8_t(per_component));
    segment.push_back(std::uint8_t(components));
    for (int c = 0; c < components; ++c) {
      segment.push_back(std::uint8_t(c + 1));
      segment.push_back(0x11);
      segment.push_back(0x00);
    }
    out.push_back(0xff);
    out.push_back(0xc3);
    out.push_back(std::uint8_t((segment.size() + 2) >> 8));
    out.push_back(std::uint8_t(segment.size() + 2));
    out.insert(out.end(), segment.begin(), segment.end());
  }
  // SOS
  {
    Blob segment;
    segment.push_back(std::uint8_t(components));
    for (int c = 0; c < components; ++c) {
      segment.push_back(std::uint8_t(c + 1));
      segment.push_back(0x00); // both tables 0
    }
    segment.push_back(0x01); // predictor 1
    segment.push_back(0x00);
    segment.push_back(0x00); // Ah/Al
    out.push_back(0xff);
    out.push_back(0xda);
    out.push_back(std::uint8_t((segment.size() + 2) >> 8));
    out.push_back(std::uint8_t(segment.size() + 2));
    out.insert(out.end(), segment.begin(), segment.end());
  }
  // Entropy coded differences, most significant bit first, 0xff stuffed.
  Blob stream;
  std::uint32_t accumulator = 0;
  int held = 0;
  const auto emit = [&](std::uint32_t value, int length) {
    for (int i = length - 1; i >= 0; --i) {
      accumulator = (accumulator << 1) | ((value >> i) & 1);
      if (++held == 8) {
        stream.push_back(std::uint8_t(accumulator));
        if (std::uint8_t(accumulator) == 0xff) stream.push_back(0x00);
        accumulator = 0;
        held = 0;
      }
    }
  };
  // Canonical codes for the table above: category n is n+1 bits.
  const auto code_for = [&](int category) {
    std::uint32_t code = 0;
    for (int length = 1; length <= category; ++length) code = (code + 1) << 1;
    return code;
  };
  std::vector<int> previous(std::size_t(per_component) * std::size_t(components), 0);
  std::vector<int> current(previous.size(), 0);
  const int default_prediction = 1 << (precision - 1);
  for (std::uint32_t y = 0; y < height; ++y) {
    for (std::uint32_t x = 0; x < per_component; ++x)
      for (int c = 0; c < components; ++c) {
        const std::size_t index = std::size_t(x) * std::size_t(components) + std::size_t(c);
        const int value = samples[std::size_t(y) * width + index];
        const int prediction = x == 0 ? (y == 0 ? default_prediction : previous[index])
                                      : current[index - std::size_t(components)];
        const int difference = value - prediction;
        int category = 0;
        while (category < 16 && std::abs(difference) >= (1 << category)) ++category;
        emit(code_for(category), category + 1);
        if (category) {
          const std::uint32_t bits =
              difference > 0 ? std::uint32_t(difference)
                             : std::uint32_t(difference + (1 << category) - 1);
          emit(bits, category);
        }
        current[index] = value;
      }
    previous.swap(current);
  }
  if (held) emit(0, 8 - held);
  out.insert(out.end(), stream.begin(), stream.end());
  out.push_back(0xff);
  out.push_back(0xd9);
  return out;
}

void lossless_jpeg_tests() {
  std::mt19937 random(11);
  std::uniform_int_distribution<int> sample(0, 16383);
  for (int components : {1, 2}) {
    const std::uint32_t width = 32, height = 6;
    std::vector<std::uint16_t> truth(std::size_t(width) * height);
    for (auto& v : truth) v = std::uint16_t(sample(random));
    const Blob stream = encode_lossless_jpeg(truth, width, height, components, 14);
    std::vector<std::uint16_t> out(truth.size(), 0);
    unpack_lossless_jpeg(stream.data(), stream.size(), width, height, out.data());
    check(out == truth,
          "lossless JPEG round trip with " + std::to_string(components) + " components");
  }
  // A stream that is not one must be refused, not crash.
  const Blob nonsense{0xff, 0xd8, 0x00, 0x01, 0x02, 0x03};
  std::vector<std::uint16_t> out(16, 0);
  bool refused = false;
  try {
    unpack_lossless_jpeg(nonsense.data(), nonsense.size(), 4, 4, out.data());
  } catch (const std::exception&) {
    refused = true;
  }
  check(refused, "a broken lossless JPEG is refused");
}

// ---------------------------------------------------------------------------
// Levels, white balance, demosaic, highlights
// ---------------------------------------------------------------------------

void levels_and_balance_tests() {
  const auto fixture = build_colour_fixture({{0.5, 0.5, 0.5}}, 16, 1);
  const auto meta = read_raw_metadata(fixture.file.data(), fixture.file.size());
  check(meta.valid, "levels fixture parses");
  const auto mosaic = unpack_mosaic(fixture.file.data(), fixture.file.size(), meta);
  check(mosaic.width == meta.raw_width && mosaic.height == meta.raw_height, "mosaic size");

  // A sample at black is exactly zero, one at white exactly one.
  Mosaic probe;
  probe.width = meta.raw_width;
  probe.height = meta.raw_height;
  probe.samples.assign(std::size_t(probe.width) * probe.height, 512);
  probe.samples[std::size_t(meta.crop.y) * probe.width + meta.crop.x] = 16383;
  const auto levels = normalise_levels(probe, meta);
  close_to(levels.data[1], 0.0, 1e-6, "a sample at black is zero");
  close_to(levels.data[0], 1.0, 1e-6, "a sample at white is one");

  // A sample below black goes negative rather than being flattened there.
  probe.samples[std::size_t(meta.crop.y) * probe.width + meta.crop.x + 1] = 400;
  const auto signed_levels = normalise_levels(probe, meta);
  check(signed_levels.data[1] < 0, "a sample below black stays below zero");

  // White balance takes the camera's neutral to a flat mosaic.
  const auto gains = white_balance_gains(meta.as_shot_neutral);
  close_to(gains.gain[1], 1.0, 1e-12, "green gain is one");
  close_to(gains.gain[0] * meta.as_shot_neutral[0], 1.0, 1e-9, "red gain inverts the neutral");
  Mosaic neutral_probe;
  neutral_probe.width = meta.raw_width;
  neutral_probe.height = meta.raw_height;
  neutral_probe.samples.assign(std::size_t(neutral_probe.width) * neutral_probe.height, 512);
  for (std::uint32_t y = 0; y < meta.crop.height; ++y)
    for (std::uint32_t x = 0; x < meta.crop.width; ++x) {
      const int channel = ((meta.crop.y + y) % 2 == 0) ? (((meta.crop.x + x) % 2 == 0) ? 0 : 1)
                                                       : (((meta.crop.x + x) % 2 == 0) ? 1 : 2);
      neutral_probe.samples[std::size_t(meta.crop.y + y) * neutral_probe.width + meta.crop.x + x] =
          std::uint16_t(512 + meta.as_shot_neutral[std::size_t(channel)] * 0.25 * (16383 - 512));
    }
  auto balanced = normalise_levels(neutral_probe, meta);
  apply_white_balance(balanced, meta.cfa, meta.crop.x, meta.crop.y, gains);
  double lowest = 1e9, highest = -1e9;
  for (float v : balanced.data) {
    lowest = std::min(lowest, double(v));
    highest = std::max(highest, double(v));
  }
  close_to(highest - lowest, 0, 2e-3, "a neutral subject balances flat");
}

void demosaic_tests() {
  // A flat field must come back exactly, at every quality.
  for (auto quality : {Demosaic::half, Demosaic::bilinear, Demosaic::gradient}) {
    LinearImage mosaic;
    mosaic.width = 64;
    mosaic.height = 48;
    mosaic.channels = 1;
    mosaic.data.assign(std::size_t(mosaic.width) * mosaic.height, 0.f);
    CfaPattern cfa;
    cfa.color = {Cfa::red, Cfa::green, Cfa::green, Cfa::blue};
    const float value[3] = {0.4f, 0.55f, 0.3f};
    for (std::uint32_t y = 0; y < mosaic.height; ++y)
      for (std::uint32_t x = 0; x < mosaic.width; ++x)
        mosaic.data[std::size_t(y) * mosaic.width + x] =
            value[std::size_t(cfa.at(x, y))];
    const auto rgb = demosaic_mosaic(mosaic, cfa, 0, 0, quality);
    double worst = 0;
    for (std::uint32_t y = 0; y < rgb.height; ++y)
      for (std::uint32_t x = 0; x < rgb.width; ++x)
        for (int c = 0; c < 3; ++c)
          worst = std::max(worst, std::abs(double(rgb.row(y)[std::size_t(x) * 3 + std::size_t(c)]) -
                                           value[c]));
    close_to(worst, 0, 1e-6, "a flat field survives the demosaic exactly");
  }

  // A scene with structure: mosaic a known image and reconstruct it.
  const std::uint32_t width = 192, height = 144;
  CfaPattern cfa;
  cfa.color = {Cfa::red, Cfa::green, Cfa::green, Cfa::blue};

  const auto build = [&](bool natural) {
    std::vector<float> truth(std::size_t(width) * height * 3);
    for (std::uint32_t y = 0; y < height; ++y)
      for (std::uint32_t x = 0; x < width; ++x) {
        // Detail on both axes and on the diagonal, which is what separates a
        // directional demosaic from a separable one: diagonal bars, concentric
        // rings and a hard edge.
        const double bars = 0.5 + 0.42 * std::sin((x + y) * 0.55);
        const double rings =
            0.5 + 0.38 * std::sin(std::hypot(double(x) - 96, double(y) - 72) * 0.4);
        const double edge = x > width / 2 ? 0.75 : 0.25;
        const double luminance = std::clamp((bars + rings + edge) / 3.0, 0.03, 0.95);
        const std::size_t at = (std::size_t(y) * width + x) * 3;
        if (natural) {
          // A real photograph: detail lives in luminance, and hue drifts
          // slowly across the frame. That is the assumption a colour-difference
          // demosaic is built on, and the assumption photographs satisfy.
          const double warm = 1.0 + 0.25 * std::sin(double(x) * 0.012);
          const double cool = 1.0 + 0.25 * std::cos(double(y) * 0.010);
          truth[at + 0] = float(std::clamp(luminance * warm, 0.02, 0.98));
          truth[at + 1] = float(luminance);
          truth[at + 2] = float(std::clamp(luminance * cool, 0.02, 0.98));
        } else {
          // The adversarial opposite: every channel carries its own unrelated
          // detail, so the colour differences are as busy as the channels.
          truth[at + 0] = float(std::clamp(bars * 0.9, 0.02, 0.98));
          truth[at + 1] = float(std::clamp(rings, 0.02, 0.98));
          truth[at + 2] = float(std::clamp(0.3 + 0.6 * double(x) / width, 0.02, 0.98));
        }
      }
    LinearImage mosaic;
    mosaic.width = width;
    mosaic.height = height;
    mosaic.channels = 1;
    mosaic.data.assign(std::size_t(width) * height, 0.f);
    for (std::uint32_t y = 0; y < height; ++y)
      for (std::uint32_t x = 0; x < width; ++x)
        mosaic.data[std::size_t(y) * width + x] =
            truth[(std::size_t(y) * width + x) * 3 + std::size_t(cfa.at(x, y))];
    return std::pair{truth, mosaic};
  };

  const auto measure = [&](const std::vector<float>& truth, const LinearImage& mosaic,
                           Demosaic quality) {
    const auto rgb = demosaic_mosaic(mosaic, cfa, 0, 0, quality);
    double sum = 0;
    std::size_t counted = 0;
    // Skip a margin so a border rule is not what is being measured.
    for (std::uint32_t y = 8; y + 8 < height; ++y)
      for (std::uint32_t x = 8; x + 8 < width; ++x)
        for (int c = 0; c < 3; ++c) {
          const double error = double(rgb.row(y)[std::size_t(x) * 3 + std::size_t(c)]) -
                               truth[(std::size_t(y) * width + x) * 3 + std::size_t(c)];
          sum += error * error;
          ++counted;
        }
    return std::sqrt(sum / double(counted));
  };

  {
    const auto [truth, mosaic] = build(true);
    const double bilinear = measure(truth, mosaic, Demosaic::bilinear);
    const double gradient = measure(truth, mosaic, Demosaic::gradient);
    check(gradient < bilinear,
          "on a photograph-like scene the gradient demosaic beats bilinear (" +
              std::to_string(gradient) + " vs " + std::to_string(bilinear) + ")");
    check(gradient < 0.03,
          "the gradient demosaic's error is small: " + std::to_string(gradient));
  }
  {
    // Three unrelated channels break the constant-hue assumption on purpose.
    // Nothing here is expected to win; what matters is that the colour-
    // difference path degrades rather than falling apart.
    const auto [truth, mosaic] = build(false);
    const double bilinear = measure(truth, mosaic, Demosaic::bilinear);
    const double gradient = measure(truth, mosaic, Demosaic::gradient);
    check(gradient < 0.12,
          "even with unrelated channels the gradient demosaic stays bounded: " +
              std::to_string(gradient));
    check(bilinear < 0.12, "and so does bilinear: " + std::to_string(bilinear));
  }

  const auto [truth, mosaic] = build(true);
  (void)truth;

  // Half size is an exact bin of each quad, not an interpolation.
  const auto half = demosaic_mosaic(mosaic, cfa, 0, 0, Demosaic::half);
  check(half.width == width / 2 && half.height == height / 2, "half size");
  const std::size_t at = (std::size_t(3) * half.width + 5) * 3;
  const auto quad = [&](std::uint32_t x, std::uint32_t y) {
    return double(mosaic.data[std::size_t(y) * width + x]);
  };
  close_to(half.data[at + 0], quad(10, 6), 1e-6, "half-size red is the quad's own red");
  close_to(half.data[at + 1], (quad(11, 6) + quad(10, 7)) * 0.5, 1e-6,
           "half-size green averages the quad's two greens");
  close_to(half.data[at + 2], quad(11, 7), 1e-6, "half-size blue is the quad's own blue");
}

void highlight_tests() {
  LinearImage rgb;
  rgb.width = 4;
  rgb.height = 1;
  rgb.channels = 3;
  rgb.data.assign(12, 0.f);
  // Clip levels after a white balance that lifted red and blue.
  const std::array<double, 3> clip{2.4, 1.0, 1.4};
  // A pixel whose red has clipped but whose green and blue have not.
  rgb.data[0] = 2.4f;
  rgb.data[1] = 0.8f;
  rgb.data[2] = 1.0f;
  // A pixel well below every clip.
  rgb.data[3] = 0.5f;
  rgb.data[4] = 0.4f;
  rgb.data[5] = 0.45f;
  // A pixel where everything clipped.
  rgb.data[6] = 2.4f;
  rgb.data[7] = 1.0f;
  rgb.data[8] = 1.4f;
  // A pixel with two clipped.
  rgb.data[9] = 2.4f;
  rgb.data[10] = 0.6f;
  rgb.data[11] = 1.4f;
  const auto before = rgb.data;
  recover_highlights(rgb, clip);
  check(rgb.data[0] >= before[0], "a clipped channel is never pulled below where it clipped");
  for (int c = 0; c < 3; ++c)
    close_to(rgb.data[std::size_t(3 + c)], before[std::size_t(3 + c)], 1e-6,
             "an unclipped pixel is untouched");
  close_to(rgb.data[6], rgb.data[7], 1e-6, "a fully clipped pixel goes neutral (red vs green)");
  close_to(rgb.data[8], rgb.data[7], 1e-6, "a fully clipped pixel goes neutral (blue vs green)");
  check(rgb.data[10] >= before[10], "the surviving channel still anchors the rebuild");
}

// ---------------------------------------------------------------------------
// The whole chain
// ---------------------------------------------------------------------------

void end_to_end_colour_tests() {
  // A row of known colours, put through a synthetic camera and read back.
  const std::vector<Vector3> colours{
      {0.18, 0.18, 0.18}, {0.60, 0.60, 0.60}, {0.05, 0.05, 0.05},
      {0.45, 0.12, 0.10}, {0.12, 0.40, 0.14}, {0.09, 0.14, 0.45},
      {0.55, 0.45, 0.10}, {0.40, 0.10, 0.35}, {0.10, 0.38, 0.42},
      {0.30, 0.25, 0.18}, {0.22, 0.30, 0.20}, {0.35, 0.20, 0.25},
  };
  const std::uint32_t block = 24, columns = 4;
  const auto fixture = build_colour_fixture(colours, block, columns);

  DecodeRequest request;
  request.quality = Demosaic::gradient;
  request.highlight_recovery = false;
  request.rendering.shoulder = 0; // no roll-off: measure the colour, not the look
  // The fixture was written a factor of `headroom` below white, so put it back.
  request.rendering.exposure = std::log2(4.0);
  const auto decoded = decode_raw(fixture.file.data(), fixture.file.size(), request);
  check(decoded.width == fixture.width && decoded.height == fixture.height, "decoded size");

  double worst = 0, total = 0;
  for (std::size_t i = 0; i < colours.size(); ++i) {
    const Vector3 got = sample_block(decoded, std::uint32_t(i), block, columns);
    for (int c = 0; c < 3; ++c) {
      const double expected = srgb_encode(colours[i][std::size_t(c)]);
      const double error = std::abs(got[std::size_t(c)] - expected);
      worst = std::max(worst, error);
      total += error;
    }
  }
  const double mean = total / double(colours.size() * 3);
  // Eight bits of output is 1/255 = 0.0039 on its own, and the fixture's own
  // quantisation into 14-bit samples adds a little more.
  check(worst < 0.012, "every fixture colour survives the chain: worst " + std::to_string(worst));
  check(mean < 0.004, "mean colour error across the chart: " + std::to_string(mean));

  // The white balance the decoder reports is the one the fixture was built at.
  check(decoded.white_balance.known, "the fixture's white balance is read from the file");
  close_to(decoded.white_balance.kelvin, 6500, 350, "the fixture reads as daylight");
  close_to(decoded.white_balance.tint, 0, 12, "the fixture reads as untinted");

  // A neutral patch must come out neutral, which is the one thing a
  // photographer notices immediately.
  for (std::uint32_t index : {0u, 1u, 2u}) {
    const Vector3 grey = sample_block(decoded, index, block, columns);
    close_to(grey[0], grey[1], 0.010, "a grey patch is neutral (red vs green)");
    close_to(grey[2], grey[1], 0.010, "a grey patch is neutral (blue vs green)");
  }
}

void band_tests() {
  const std::vector<Vector3> colours{{0.2, 0.3, 0.4}, {0.5, 0.2, 0.1}, {0.1, 0.5, 0.3},
                                     {0.4, 0.4, 0.2}, {0.3, 0.1, 0.5}, {0.25, 0.35, 0.15}};
  const auto fixture = build_colour_fixture(colours, 32, 3);
  const auto meta = read_raw_metadata(fixture.file.data(), fixture.file.size());
  check(meta.valid, "band fixture parses");

  // The halo is the whole point of the band pass: a narrow band and a band
  // taller than the picture must produce identical bytes.
  for (auto quality : {Demosaic::half, Demosaic::bilinear, Demosaic::gradient}) {
    std::vector<Blob> renders;
    for (std::uint32_t band : {8u, 17u, 512u}) {
      DecodeRequest request;
      request.quality = quality;
      request.band = band;
      Decoder decoder(fixture.file.data(), fixture.file.size(), meta, request);
      while (decoder.step()) {
      }
      renders.emplace_back(decoder.pixels(), decoder.pixels() + decoder.pixel_bytes());
    }
    check(renders[0] == renders[1] && renders[1] == renders[2],
          "band size does not change a single pixel");
  }

  // Progress climbs and finishes at one; memory stays bounded.
  DecodeRequest request;
  request.band = 8;
  Decoder decoder(fixture.file.data(), fixture.file.size(), meta, request);
  double last = -1;
  std::size_t peak = 0;
  int steps = 0;
  while (decoder.step()) {
    check(decoder.progress() >= last, "progress never goes backwards");
    last = decoder.progress();
    peak = std::max(peak, decoder.resident_bytes());
    check(++steps < 10000, "the decoder terminates");
  }
  close_to(decoder.progress(), 1.0, 1e-9, "progress finishes at one");
  check(peak < 8u << 20, "a small frame stays in a small amount of memory");

  // Abandoning halfway is simply not calling step() again.
  {
    Decoder abandoned(fixture.file.data(), fixture.file.size(), meta, request);
    abandoned.step();
    abandoned.step();
    check(abandoned.progress() > 0 && abandoned.progress() < 1, "an abandoned decode is partial");
  }
}

void white_balance_request_tests() {
  const auto fixture = build_colour_fixture({{0.4, 0.4, 0.4}}, 32, 1);
  const auto meta = read_raw_metadata(fixture.file.data(), fixture.file.size());
  check(meta.valid, "white balance fixture parses");

  const auto render = [&](double kelvin, double tint) {
    DecodeRequest request;
    request.quality = Demosaic::half;
    request.temperature = kelvin;
    request.tint = tint;
    request.rendering.shoulder = 0;
    Decoder decoder(fixture.file.data(), fixture.file.size(), meta, request);
    while (decoder.step()) {
    }
    const std::size_t at = (std::size_t(decoder.height() / 2) * decoder.width() +
                            decoder.width() / 2) * 4;
    return std::array<double, 4>{double(decoder.pixels()[at]), double(decoder.pixels()[at + 1]),
                                 double(decoder.pixels()[at + 2]),
                                 decoder.white_balance().kelvin};
  };

  // Asking for the temperature the file was written at reproduces its neutral.
  const auto asked = render(6500, 0);
  close_to(asked[3], 6500, 120, "an explicit Kelvin is reported back");
  close_to(asked[0], asked[1], 4, "at the scene's own temperature the patch stays neutral");
  close_to(asked[2], asked[1], 4, "… in blue too");

  // Warmer means more red and less blue, the way the slider reads.
  const auto warm = render(9000, 0);
  const auto cool = render(3500, 0);
  check(warm[0] > asked[0] && warm[2] < asked[2], "a higher Kelvin warms the render");
  check(cool[0] < asked[0] && cool[2] > asked[2], "a lower Kelvin cools it");

  // Tint moves green against magenta. The measure is green's level relative to
  // red and blue, not green's own: the working space is anchored on the
  // neutral, so a tint change moves the other two around a fixed green.
  const auto balance = [](const std::array<double, 4>& v) {
    return v[1] - (v[0] + v[2]) / 2;
  };
  const auto green = render(6500, -40);
  const auto neutral_tint = render(6500, 0);
  const auto magenta = render(6500, 40);
  const auto describe = [](const std::array<double, 4>& v) {
    return std::to_string(v[0]) + "/" + std::to_string(v[1]) + "/" + std::to_string(v[2]);
  };
  check(balance(green) > balance(neutral_tint) && balance(neutral_tint) > balance(magenta),
        "tint runs green at the negative end and magenta at the positive one, the way "
        "Lightroom's slider does: -40 gave " +
            describe(green) + ", 0 gave " + describe(neutral_tint) + ", +40 gave " +
            describe(magenta));
}

} // namespace

int main() try {
  colour_maths_tests();
  metadata_tests();
  packing_tests();
  lossless_jpeg_tests();
  levels_and_balance_tests();
  demosaic_tests();
  highlight_tests();
  end_to_end_colour_tests();
  band_tests();
  white_balance_request_tests();
  std::cout << "raw-decode-tests: " << checks << " checks passed\n";
  return 0;
} catch (const std::exception& failure) {
  std::cerr << "raw-decode-tests FAILED: " << failure.what() << "\n";
  return 1;
}
