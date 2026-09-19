// What a RAW file says about its own sensor, and the chain that turns those
// samples into a picture. See lenslabs/raw_decode.hpp for the shape of it.
//
// The container reader is a plain TIFF walker: IFD0, its SubIFDs and the Exif
// IFD, with DNG's colour tags read wherever they appear and Sony's private tags
// read out of the SubIFD that holds the mosaic. Nothing here trusts a length or
// an offset in the file without checking it against the bytes actually present,
// because a RAW is an untrusted upload.
#include "lenslabs/raw_decode.hpp"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <stdexcept>
#include <vector>

namespace lenslabs::raw {
namespace {

// ---------------------------------------------------------------------------
// A bounded TIFF reader
// ---------------------------------------------------------------------------

struct Reader {
  const std::uint8_t* bytes = nullptr;
  std::size_t size = 0;
  bool big_endian = false;

  bool has(std::uint64_t at, std::uint64_t count) const noexcept {
    return at <= size && count <= size - at;
  }
  std::uint16_t u16(std::uint64_t at) const noexcept {
    if (!has(at, 2)) return 0;
    const auto a = bytes[at], b = bytes[at + 1];
    return std::uint16_t(big_endian ? (a << 8 | b) : (b << 8 | a));
  }
  std::uint32_t u32(std::uint64_t at) const noexcept {
    if (!has(at, 4)) return 0;
    std::uint32_t v = 0;
    for (int i = 0; i < 4; ++i)
      v |= std::uint32_t(bytes[at + std::uint64_t(big_endian ? i : 3 - i)]) << (8 * (3 - i));
    return v;
  }
};

constexpr int type_size(std::uint16_t type) noexcept {
  switch (type) {
    case 1: case 2: case 6: case 7: return 1;
    case 3: case 8: return 2;
    case 4: case 9: case 11: return 4;
    case 5: case 10: case 12: return 8;
    default: return 0;
  }
}

struct Entry {
  std::uint16_t tag = 0, type = 0;
  std::uint32_t count = 0;
  std::uint64_t value_offset = 0; // always an absolute file offset
};

// One IFD's entries plus the offset of the next IFD in the chain.
struct Ifd {
  std::vector<Entry> entries;
  std::uint64_t next = 0;
  const Entry* find(std::uint16_t tag) const noexcept {
    for (const auto& e : entries)
      if (e.tag == tag) return &e;
    return nullptr;
  }
};

Ifd read_ifd(const Reader& r, std::uint64_t at) noexcept {
  Ifd ifd;
  if (!at || !r.has(at, 2)) return ifd;
  const std::uint32_t count = r.u16(at);
  // A real IFD has a few dozen entries. Anything wilder is a corrupt offset.
  if (!count || count > 1024 || !r.has(at + 2, std::uint64_t(count) * 12 + 4)) return ifd;
  ifd.entries.reserve(count);
  for (std::uint32_t i = 0; i < count; ++i) {
    const std::uint64_t e = at + 2 + std::uint64_t(i) * 12;
    Entry entry;
    entry.tag = r.u16(e);
    entry.type = r.u16(e + 2);
    entry.count = r.u32(e + 4);
    const int unit = type_size(entry.type);
    if (!unit) continue;
    const std::uint64_t total = std::uint64_t(unit) * entry.count;
    entry.value_offset = total <= 4 ? e + 8 : r.u32(e + 8);
    if (!r.has(entry.value_offset, total)) continue; // silently absent, never trusted
    ifd.entries.push_back(entry);
  }
  ifd.next = r.u32(at + 2 + std::uint64_t(count) * 12);
  return ifd;
}

double entry_value(const Reader& r, const Entry& e, std::uint32_t index) noexcept {
  const int unit = type_size(e.type);
  if (!unit || index >= e.count) return 0;
  const std::uint64_t at = e.value_offset + std::uint64_t(unit) * index;
  switch (e.type) {
    case 1: case 2: case 7: return r.has(at, 1) ? r.bytes[at] : 0;
    case 6: return r.has(at, 1) ? double(std::int8_t(r.bytes[at])) : 0;
    case 3: return r.u16(at);
    case 8: return double(std::int16_t(r.u16(at)));
    case 4: return r.u32(at);
    case 9: return double(std::int32_t(r.u32(at)));
    case 5: {
      const double n = r.u32(at), d = r.u32(at + 4);
      return d != 0 ? n / d : 0;
    }
    case 10: {
      const double n = double(std::int32_t(r.u32(at)));
      const double d = double(std::int32_t(r.u32(at + 4)));
      return d != 0 ? n / d : 0;
    }
    case 11: {
      const std::uint32_t raw = r.u32(at);
      float f;
      std::memcpy(&f, &raw, 4);
      return std::isfinite(f) ? f : 0;
    }
    default: return 0;
  }
}

std::string entry_text(const Reader& r, const Entry& e) {
  std::string out;
  for (std::uint32_t i = 0; i < e.count && i < 64; ++i) {
    if (!r.has(e.value_offset + i, 1)) break;
    const char c = char(r.bytes[e.value_offset + i]);
    if (!c) break;
    out.push_back(c);
  }
  while (!out.empty() && (out.back() == ' ' || out.back() == '\t')) out.pop_back();
  return out;
}

bool read_matrix(const Reader& r, const Ifd& ifd, std::uint16_t tag, Matrix3& out) noexcept {
  const Entry* e = ifd.find(tag);
  if (!e || e->count != 9) return false;
  for (int i = 0; i < 9; ++i) out[std::size_t(i)] = entry_value(r, *e, std::uint32_t(i));
  return true;
}

// ---------------------------------------------------------------------------
// Colour tags, wherever they live
// ---------------------------------------------------------------------------

void read_colour_tags(const Reader& r, const Ifd& ifd, RawMetadata& meta) {
  auto& p = meta.profile;
  Matrix3 m{};
  if (read_matrix(r, ifd, 50721, m)) {
    p.color_matrix_1 = m;
    p.known = true;
    p.source = ProfileSource::dng_tags;
    p.description = "the file's own ColorMatrix tags";
  }
  if (read_matrix(r, ifd, 50722, m)) {
    p.color_matrix_2 = m;
    p.dual = true;
  }
  if (read_matrix(r, ifd, 50723, m)) p.camera_calibration_1 = m;
  if (read_matrix(r, ifd, 50724, m)) p.camera_calibration_2 = m;
  if (read_matrix(r, ifd, 50964, m)) {
    p.forward_matrix_1 = m;
    p.has_forward = true;
  }
  if (read_matrix(r, ifd, 50965, m)) p.forward_matrix_2 = m;
  if (const Entry* e = ifd.find(50778)) p.illuminant_1 = int(entry_value(r, *e, 0));
  if (const Entry* e = ifd.find(50779)) p.illuminant_2 = int(entry_value(r, *e, 0));
  if (const Entry* e = ifd.find(50727))
    for (std::uint32_t i = 0; i < 3 && i < e->count; ++i)
      p.analog_balance[i] = entry_value(r, *e, i);
  if (const Entry* e = ifd.find(50728); e && e->count >= 3) {
    for (std::uint32_t i = 0; i < 3; ++i) meta.as_shot_neutral[i] = entry_value(r, *e, i);
    const double g = meta.as_shot_neutral[1];
    if (g > 0 && meta.as_shot_neutral[0] > 0 && meta.as_shot_neutral[2] > 0) {
      for (auto& v : meta.as_shot_neutral) v /= g;
      meta.as_shot_neutral_known = true;
    }
  }
}

// Sony stores the as-shot balance as RGGB multipliers scaled by 1024, which is
// the reciprocal of what AsShotNeutral means. Both arrive as AsShotNeutral so
// nothing downstream has to know which camera wrote the file.
void read_sony_white_balance(const Reader& r, const Ifd& ifd, RawMetadata& meta) {
  const Entry* e = ifd.find(0x7313);
  if (!e || e->count < 4) return;
  const double red = entry_value(r, *e, 0), green = entry_value(r, *e, 1);
  const double green2 = entry_value(r, *e, 2), blue = entry_value(r, *e, 3);
  const double g = (green + green2) * 0.5;
  if (!(red > 0) || !(g > 0) || !(blue > 0)) return;
  meta.as_shot_neutral = {g / red, 1.0, g / blue};
  meta.as_shot_neutral_known = true;
}

// Which packing the SubIFD's compression code and byte count imply.
Packing packing_for(const RawMetadata& meta, std::uint16_t compression, std::uint64_t data_bytes) {
  const std::uint64_t pixels = std::uint64_t(meta.raw_width) * meta.raw_height;
  if (!pixels) return Packing::unknown;
  if (compression == 1) {
    if (data_bytes >= pixels * 2) return Packing::uncompressed_16;
    if (meta.bits_per_sample && data_bytes * 8 >= pixels * meta.bits_per_sample)
      return Packing::packed_bits;
    return Packing::unknown;
  }
  if (compression == 32767) return Packing::sony_arw2;
  if (compression == 7 || compression == 34892) return Packing::lossless_jpeg;
  return Packing::unknown;
}

// The SubIFD (or IFD) that holds the mosaic: a CFA photometric interpretation
// and the most pixels, so a file with several raw-ish images picks the sensor.
bool looks_like_mosaic(const Reader& r, const Ifd& ifd) noexcept {
  const Entry* photometric = ifd.find(262);
  if (!photometric) return false;
  const int value = int(entry_value(r, *photometric, 0));
  if (value != 32803) return false; // 32803 = CFA; LinearRaw (34892) is not a mosaic
  return ifd.find(256) && ifd.find(257);
}

void read_mosaic_ifd(const Reader& r, const Ifd& ifd, RawMetadata& meta) {
  meta.raw_width = std::uint32_t(entry_value(r, *ifd.find(256), 0));
  meta.raw_height = std::uint32_t(entry_value(r, *ifd.find(257), 0));
  meta.bits_per_sample = ifd.find(258) ? std::uint32_t(entry_value(r, *ifd.find(258), 0)) : 16;

  // CFA pattern. CFARepeatPatternDim says its shape; without it, assume 2x2.
  std::uint32_t pattern_w = 2, pattern_h = 2;
  if (const Entry* dim = ifd.find(33421); dim && dim->count >= 2) {
    pattern_w = std::uint32_t(entry_value(r, *dim, 0));
    pattern_h = std::uint32_t(entry_value(r, *dim, 1));
  }
  if (pattern_w * pattern_h > 36 || !pattern_w || !pattern_h) {
    pattern_w = pattern_h = 2;
  }
  meta.cfa.width = pattern_w;
  meta.cfa.height = pattern_h;
  meta.cfa.color = {};
  if (const Entry* pattern = ifd.find(33422); pattern && pattern->count >= pattern_w * pattern_h) {
    for (std::uint32_t i = 0; i < pattern_w * pattern_h; ++i) {
      const int code = int(entry_value(r, *pattern, i));
      meta.cfa.color[i] = code == 0 ? Cfa::red : code == 2 ? Cfa::blue : Cfa::green;
    }
  } else {
    meta.cfa.color = {Cfa::red, Cfa::green, Cfa::green, Cfa::blue};
  }

  // Levels. DNG's BlackLevel may be per-CFA-position; Sony's 0x7310 always is.
  double black = 0;
  if (const Entry* e = ifd.find(50714)) black = entry_value(r, *e, 0);
  for (auto& v : meta.black) v = black;
  if (const Entry* e = ifd.find(50714); e && e->count >= pattern_w * pattern_h)
    for (std::uint32_t i = 0; i < pattern_w * pattern_h; ++i) meta.black[i] = entry_value(r, *e, i);
  if (const Entry* e = ifd.find(0x7310); e && e->count >= 4) {
    // Sony's order is the CFA's own order for a 2x2 mosaic.
    for (std::uint32_t i = 0; i < 4 && i < 36; ++i) meta.black[i] = entry_value(r, *e, i);
  }
  if (const Entry* e = ifd.find(50717)) meta.white = entry_value(r, *e, 0);
  if (!(meta.white > 0) && meta.bits_per_sample && meta.bits_per_sample <= 16)
    meta.white = double((1u << meta.bits_per_sample) - 1);

  if (const Entry* e = ifd.find(0x7010); e && e->count >= 4) {
    for (std::uint32_t i = 0; i < 4; ++i)
      meta.tone_curve[i] = std::uint16_t(entry_value(r, *e, i));
    meta.has_tone_curve = true;
  }

  // Where the samples are. Strips and tiles are read the same way downstream.
  const Entry* offsets = ifd.find(324) ? ifd.find(324) : ifd.find(273);
  const Entry* counts = ifd.find(325) ? ifd.find(325) : ifd.find(279);
  if (offsets && counts && offsets->count == counts->count && offsets->count) {
    for (std::uint32_t i = 0; i < offsets->count; ++i) {
      meta.strip_offsets.push_back(std::uint64_t(entry_value(r, *offsets, i)));
      meta.strip_counts.push_back(std::uint64_t(entry_value(r, *counts, i)));
    }
  }
  if (const Entry* e = ifd.find(322)) meta.tile_width = std::uint32_t(entry_value(r, *e, 0));
  if (const Entry* e = ifd.find(323)) meta.tile_height = std::uint32_t(entry_value(r, *e, 0));
  if (const Entry* e = ifd.find(278)) meta.rows_per_strip = std::uint32_t(entry_value(r, *e, 0));

  // Active area and the camera's own crop, both in stored-raster coordinates.
  meta.active = {0, 0, meta.raw_width, meta.raw_height};
  if (const Entry* e = ifd.find(50829); e && e->count >= 4) {
    const auto top = std::uint32_t(entry_value(r, *e, 0)), left = std::uint32_t(entry_value(r, *e, 1));
    const auto bottom = std::uint32_t(entry_value(r, *e, 2)),
               right = std::uint32_t(entry_value(r, *e, 3));
    if (right > left && bottom > top && right <= meta.raw_width && bottom <= meta.raw_height)
      meta.active = {left, top, right - left, bottom - top};
  }
  meta.crop = meta.active;
  const Entry* origin = ifd.find(0xc61f);
  const Entry* extent = ifd.find(0xc620);
  if (origin && extent && origin->count >= 2 && extent->count >= 2) {
    const auto x = std::uint32_t(entry_value(r, *origin, 0)) + meta.active.x;
    const auto y = std::uint32_t(entry_value(r, *origin, 1)) + meta.active.y;
    const auto w = std::uint32_t(entry_value(r, *extent, 0));
    const auto h = std::uint32_t(entry_value(r, *extent, 1));
    if (w && h && x + w <= meta.raw_width && y + h <= meta.raw_height) meta.crop = {x, y, w, h};
  }

  read_colour_tags(r, ifd, meta);
  read_sony_white_balance(r, ifd, meta);

  std::uint16_t compression = 1;
  if (const Entry* e = ifd.find(259)) compression = std::uint16_t(entry_value(r, *e, 0));
  std::uint64_t data_bytes = 0;
  for (auto c : meta.strip_counts) data_bytes += c;
  meta.packing = packing_for(meta, compression, data_bytes);
  meta.little_endian = !r.big_endian;
}

} // namespace

const char* packing_name(Packing packing) noexcept {
  switch (packing) {
    case Packing::uncompressed_16: return "uncompressed 16-bit words";
    case Packing::packed_bits: return "packed bits";
    case Packing::sony_arw2: return "Sony lossy 11+7";
    case Packing::lossless_jpeg: return "lossless JPEG";
    default: return "an unrecognised packing";
  }
}

RawMetadata read_raw_metadata(const std::uint8_t* bytes, std::size_t size) noexcept {
  RawMetadata meta;
  if (!bytes || size < 16) {
    meta.reason = "This file is too short to be a RAW.";
    return meta;
  }
  Reader r{bytes, size, bytes[0] == 'M' && bytes[1] == 'M'};
  if (!((bytes[0] == 'I' && bytes[1] == 'I') || (bytes[0] == 'M' && bytes[1] == 'M')) ||
      r.u16(2) != 42) {
    meta.reason = "This is not a TIFF-based RAW. Canon CR3 and Fujifilm RAF are not read here.";
    return meta;
  }

  const Ifd ifd0 = read_ifd(r, r.u32(4));
  if (ifd0.entries.empty()) {
    meta.reason = "This RAW's directory could not be read.";
    return meta;
  }
  if (const Entry* e = ifd0.find(271)) meta.make = entry_text(r, *e);
  if (const Entry* e = ifd0.find(272)) meta.model = entry_text(r, *e);
  if (const Entry* e = ifd0.find(274)) {
    const int value = int(entry_value(r, *e, 0));
    if (value >= 1 && value <= 8) meta.orientation = value;
  }
  // A DNG keeps its colour tags in IFD0; read them before the SubIFD so a
  // SubIFD that repeats them still wins.
  read_colour_tags(r, ifd0, meta);

  // The largest embedded JPEG, so a caller can show the camera's own rendering.
  const auto note_preview = [&](const Ifd& ifd) {
    const Entry* off = ifd.find(513);
    const Entry* len = ifd.find(514);
    if (!off || !len) return;
    const auto o = std::uint64_t(entry_value(r, *off, 0));
    const auto l = std::uint64_t(entry_value(r, *len, 0));
    if (l > meta.preview_length && r.has(o, l)) {
      meta.preview_offset = o;
      meta.preview_length = l;
    }
  };
  note_preview(ifd0);

  // Candidate mosaic directories: IFD0 itself, its SubIFDs and the IFD chain.
  std::vector<Ifd> candidates;
  candidates.push_back(ifd0);
  if (const Entry* subs = ifd0.find(330))
    for (std::uint32_t i = 0; i < subs->count && i < 16; ++i)
      candidates.push_back(read_ifd(r, std::uint64_t(entry_value(r, *subs, i))));
  for (std::uint64_t next = ifd0.next, guard = 0; next && guard < 8; ++guard) {
    Ifd chained = read_ifd(r, next);
    next = chained.next;
    note_preview(chained);
    candidates.push_back(std::move(chained));
  }

  const Ifd* best = nullptr;
  std::uint64_t best_pixels = 0;
  for (const auto& ifd : candidates) {
    if (!looks_like_mosaic(r, ifd)) continue;
    note_preview(ifd);
    const std::uint64_t pixels = std::uint64_t(entry_value(r, *ifd.find(256), 0)) *
                                 std::uint64_t(entry_value(r, *ifd.find(257), 0));
    if (pixels > best_pixels) {
      best_pixels = pixels;
      best = &ifd;
    }
  }
  if (!best) {
    meta.reason = meta.model.empty()
                      ? "This RAW carries no colour-filter-array image this decoder can read."
                      : meta.model + " stores its sensor data in a layout this decoder does not read yet.";
    return meta;
  }

  read_mosaic_ifd(r, *best, meta);

  if (!meta.raw_width || !meta.raw_height) {
    meta.reason = "This RAW does not say how large its sensor image is.";
    return meta;
  }
  if (std::uint64_t(meta.raw_width) * meta.raw_height > max_sensor_pixels) {
    meta.reason = "This sensor is larger than this decoder will process.";
    return meta;
  }
  if (!meta.cfa.bayer()) {
    meta.reason = meta.cfa.width == 6
                      ? "This is an X-Trans sensor, which needs its own demosaic."
                      : "This sensor's colour filter array is not a 2x2 Bayer pattern.";
    return meta;
  }
  if (meta.packing == Packing::unknown) {
    meta.reason = meta.model.empty() ? "This RAW's sensor data is in an unknown packing."
                                     : meta.model + "'s sensor data is in a packing this decoder does not read.";
    return meta;
  }
  if (meta.strip_offsets.empty()) {
    meta.reason = "This RAW does not say where its sensor data begins.";
    return meta;
  }
  for (std::size_t i = 0; i < meta.strip_offsets.size(); ++i)
    if (!r.has(meta.strip_offsets[i], meta.strip_counts[i])) {
      meta.reason = "This RAW's sensor data runs past the end of the file.";
      return meta;
    }
  if (!(meta.white > 0)) {
    meta.reason = "This RAW does not say what its sensor's white level is.";
    return meta;
  }
  if (!meta.profile.known) {
    meta.profile = profile_for_model(meta.make, meta.model);
  }
  meta.valid = true;
  return meta;
}

// ---------------------------------------------------------------------------
// Levels and white balance
// ---------------------------------------------------------------------------

LinearImage normalise_levels(const Mosaic& mosaic, const RawMetadata& meta, std::uint32_t y0,
                             std::uint32_t y1) {
  const Rect& crop = meta.crop;
  if (!crop.width || y1 <= y0 || y1 > crop.height || crop.x + crop.width > mosaic.width ||
      std::uint64_t(crop.y) + y1 > mosaic.height)
    throw std::runtime_error("This RAW's crop does not fit its sensor image.");
  LinearImage out;
  out.width = crop.width;
  out.height = y1 - y0;
  out.channels = 1;
  out.data.assign(std::size_t(out.width) * out.height, 0.f);
  const auto& cfa = meta.cfa;
  // One scale per CFA position: a sensor's four wells do not share a black level.
  std::array<float, 36> offset{}, scale{};
  for (std::uint32_t i = 0; i < cfa.width * cfa.height; ++i) {
    const double black = meta.black[i];
    const double span = meta.white - black;
    offset[i] = float(black);
    scale[i] = float(span > 1 ? 1.0 / span : 1.0);
  }
  for (std::uint32_t y = 0; y < out.height; ++y) {
    const std::uint32_t source_row = y + y0 + crop.y;
    const std::uint16_t* src = mosaic.samples.data() + std::size_t(source_row) * mosaic.width + crop.x;
    float* dst = out.row(y);
    const std::uint32_t row = source_row % cfa.height;
    for (std::uint32_t x = 0; x < crop.width; ++x) {
      const std::uint32_t i = row * cfa.width + (x + crop.x) % cfa.width;
      // Deliberately not clamped at zero: a sample below black is noise around
      // black, and flattening it there is what makes deep shadows blotch.
      dst[x] = (float(src[x]) - offset[i]) * scale[i];
    }
  }
  return out;
}

WhiteBalanceGains white_balance_gains(const std::array<double, 3>& neutral) {
  for (double v : neutral)
    if (!std::isfinite(v) || v <= 0)
      throw std::runtime_error("This white balance is not usable.");
  WhiteBalanceGains out;
  out.neutral = {neutral[0] / neutral[1], 1.0, neutral[2] / neutral[1]};
  // Green stays at 1: raising red and blue keeps the green channel's own noise
  // untouched, and green is where most of the luminance detail is.
  for (int i = 0; i < 3; ++i) out.gain[std::size_t(i)] = 1.0 / out.neutral[std::size_t(i)];
  return out;
}

void apply_white_balance(LinearImage& mosaic, const CfaPattern& cfa, std::uint32_t origin_x,
                         std::uint32_t origin_y, const WhiteBalanceGains& gains) {
  if (mosaic.channels != 1) throw std::runtime_error("White balance expects a mosaic.");
  std::array<float, 36> per_position{};
  for (std::uint32_t i = 0; i < cfa.width * cfa.height; ++i)
    per_position[i] = float(gains.gain[std::size_t(cfa.color[i])]);
  for (std::uint32_t y = 0; y < mosaic.height; ++y) {
    float* row = mosaic.row(y);
    const std::uint32_t band = (y + origin_y) % cfa.height;
    for (std::uint32_t x = 0; x < mosaic.width; ++x)
      row[x] *= per_position[band * cfa.width + (x + origin_x) % cfa.width];
  }
}

// ---------------------------------------------------------------------------
// Highlight reconstruction and the final encode
// ---------------------------------------------------------------------------

void recover_highlights(LinearImage& rgb, const std::array<double, 3>& clip) {
  if (rgb.channels != 3) throw std::runtime_error("Highlight recovery expects linear RGB.");
  const float limit[3] = {float(clip[0]), float(clip[1]), float(clip[2])};
  // Below this fraction of a channel's own clip the sample is still real; above
  // it the well is filling and the reading is already compressed.
  constexpr float threshold = 0.985f;
  for (std::uint32_t y = 0; y < rgb.height; ++y) {
    float* row = rgb.row(y);
    for (std::uint32_t x = 0; x < rgb.width; ++x) {
      float* p = row + std::size_t(x) * 3;
      int clipped = 0;
      float valid_sum = 0, valid_weight = 0, brightest = 0;
      for (int c = 0; c < 3; ++c) {
        brightest = std::max(brightest, p[c]);
        if (p[c] >= limit[c] * threshold) {
          ++clipped;
        } else {
          valid_sum += p[c] / limit[c];
          valid_weight += 1;
        }
      }
      if (!clipped || clipped == 3) {
        // All three clipped: nothing to rebuild from, so let the pixel go to
        // white smoothly rather than take on the cast of whichever clipped last.
        if (clipped == 3)
          for (int c = 0; c < 3; ++c) p[c] = brightest;
        continue;
      }
      // One or two channels still carry a reading. The unclipped channels give
      // the pixel's hue; the clipped ones are rebuilt at the level the pixel's
      // own ratio in the valid channels implies, never below where they clipped.
      const float mean_valid = valid_sum / valid_weight;
      for (int c = 0; c < 3; ++c) {
        if (p[c] < limit[c] * threshold) continue;
        // A clipped channel was at least as bright as the valid ones, scaled by
        // how much headroom the white balance already gave it.
        const float rebuilt = std::max(p[c], mean_valid * limit[c] * (1.0f + (1.0f - mean_valid)));
        p[c] = std::max(rebuilt, brightest);
      }
    }
  }
}

void convert_colour(LinearImage& rgb, const std::array<double, 9>& matrix) {
  if (rgb.channels != 3) throw std::runtime_error("Colour conversion expects linear RGB.");
  const float m[9] = {float(matrix[0]), float(matrix[1]), float(matrix[2]),
                      float(matrix[3]), float(matrix[4]), float(matrix[5]),
                      float(matrix[6]), float(matrix[7]), float(matrix[8])};
  for (std::uint32_t y = 0; y < rgb.height; ++y) {
    float* row = rgb.row(y);
    for (std::uint32_t x = 0; x < rgb.width; ++x) {
      float* p = row + std::size_t(x) * 3;
      const float r = p[0], g = p[1], b = p[2];
      p[0] = m[0] * r + m[1] * g + m[2] * b;
      p[1] = m[3] * r + m[4] * g + m[5] * b;
      p[2] = m[6] * r + m[7] * g + m[8] * b;
    }
  }
}

namespace {
// A soft shoulder so a reconstructed highlight above 1 rolls off instead of
// stepping flat. Identity below the knee, asymptotic to 1 above it.
inline float shoulder(float v, float strength) noexcept {
  if (strength <= 0 || v <= 0.f) return v;
  constexpr float knee = 0.72f;
  if (v <= knee) return v;
  const float head = 1.f - knee;
  const float over = (v - knee) / head;
  return knee + head * (over / (1.f + over * strength));
}
} // namespace

void encode_srgb(const LinearImage& rgb, const Rendering& rendering, std::uint8_t* out) {
  if (rgb.channels != 3) throw std::runtime_error("The encoder expects linear RGB.");
  const float gain = float(std::exp2(rendering.exposure));
  // The curve already rolls its own highlights off, so the plain shoulder is
  // only the fallback for a scene-referred render.
  const bool baseline = rendering.baseline.present;
  const float strength = baseline ? 0.f : float(rendering.shoulder);
  // The curve is a binary search per sample, which a 24-million-pixel frame
  // would pay seventy million times. Resolve it into the same kind of table
  // the transfer function uses, over the range the encoder can still see.
  static constexpr int curve_size = 2048;
  static constexpr float curve_top = 4.0f; // four stops above white, then flat
  std::vector<float> curve;
  if (baseline) {
    curve.resize(curve_size);
    for (int i = 0; i < curve_size; ++i)
      curve[std::size_t(i)] =
          float(rendering.baseline.apply(double(i) * curve_top / (curve_size - 1)));
  }
  // One table for the transfer function: a 24-million-pixel frame would
  // otherwise call pow() seventy million times.
  static constexpr int table_size = 4096;
  static float table[table_size];
  static bool built = false;
  if (!built) {
    for (int i = 0; i < table_size; ++i)
      table[i] = float(srgb_encode(double(i) / (table_size - 1)));
    built = true;
  }
  for (std::uint32_t y = 0; y < rgb.height; ++y) {
    const float* row = rgb.row(y);
    std::uint8_t* dst = out + std::size_t(y) * rgb.width * 4;
    for (std::uint32_t x = 0; x < rgb.width; ++x) {
      const float* p = row + std::size_t(x) * 3;
      for (int c = 0; c < 3; ++c) {
        float v = p[c] * gain;
        if (baseline) {
          const float at = v * (curve_size - 1) / curve_top;
          v = at <= 0 ? curve[0]
              : at >= curve_size - 1
                  ? curve[curve_size - 1]
                  // Interpolate between table entries: the curve is steep in
                  // the shadows, where a table step would be visible banding.
                  : curve[std::size_t(at)] +
                        (curve[std::size_t(at) + 1] - curve[std::size_t(at)]) *
                            (at - float(std::size_t(at)));
        } else {
          v = shoulder(v, strength);
        }
        v = v <= 0 ? 0 : v >= 1 ? 1 : v;
        const float encoded = table[int(v * (table_size - 1) + 0.5f)];
        dst[std::size_t(x) * 4 + std::size_t(c)] = std::uint8_t(encoded * 255.f + 0.5f);
      }
      dst[std::size_t(x) * 4 + 3] = 255;
    }
  }
}

} // namespace lenslabs::raw
