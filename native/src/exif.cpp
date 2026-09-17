#include "lenslabs/exif.hpp"
#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstring>
#include <utility>

// EXIF, read defensively. Camera files arrive from strangers' cards and from
// software that writes the format loosely, so every offset is checked against
// the buffer and anything that does not parse is simply absent.
//
// Maker-note layouts follow ExifTool's tag documentation
// (https://exiftool.org/TagNames/): the byte formats only, no ExifTool code.
namespace lenslabs {
namespace {

struct Reader {
  const std::uint8_t* bytes = nullptr;
  std::size_t size = 0;
  bool big_endian = false;

  // Overflow-safe on wasm32, where size_t is 32 bits and offsets come from the file.
  bool has(std::uint64_t at, std::uint64_t count) const noexcept {
    return at <= size && count <= size - at;
  }
  std::uint8_t u8(std::size_t at) const noexcept { return has(at, 1) ? bytes[at] : 0; }
  std::uint16_t u16(std::size_t at) const noexcept {
    if (!has(at, 2)) return 0;
    return big_endian ? std::uint16_t(bytes[at] << 8 | bytes[at + 1])
                      : std::uint16_t(bytes[at + 1] << 8 | bytes[at]);
  }
  std::int16_t i16(std::size_t at) const noexcept { return std::int16_t(u16(at)); }
  std::uint32_t u32(std::size_t at) const noexcept {
    if (!has(at, 4)) return 0;
    return big_endian ? std::uint32_t(bytes[at]) << 24 | std::uint32_t(bytes[at + 1]) << 16 |
                            std::uint32_t(bytes[at + 2]) << 8 | bytes[at + 3]
                      : std::uint32_t(bytes[at + 3]) << 24 | std::uint32_t(bytes[at + 2]) << 16 |
                            std::uint32_t(bytes[at + 1]) << 8 | bytes[at];
  }
  // A RATIONAL value: two unsigned longs, numerator over denominator.
  double rational(std::size_t at) const noexcept {
    const auto denominator = u32(at + 4);
    return denominator ? double(u32(at)) / denominator : 0;
  }
  bool matches(std::size_t at, const char* signature, std::size_t count) const noexcept {
    return has(at, count) && std::memcmp(bytes + at, signature, count) == 0;
  }
  // A view starting `at`, keeping the byte order. Empty when `at` is outside.
  Reader from(std::size_t at) const noexcept {
    if (!has(at, 0)) return Reader{};
    return Reader{bytes + at, size - at, big_endian};
  }
  std::string text(std::size_t at, std::size_t count) const noexcept {
    if (!has(at, count)) return {};
    std::string value(reinterpret_cast<const char*>(bytes + at), count);
    const auto end = value.find('\0');
    if (end != std::string::npos) value.resize(end);
    while (!value.empty() && std::isspace(static_cast<unsigned char>(value.back()))) value.pop_back();
    std::size_t start = 0;
    while (start < value.size() && std::isspace(static_cast<unsigned char>(value[start]))) ++start;
    value.erase(0, start);
    for (auto& c : value) c = char(std::tolower(static_cast<unsigned char>(c)));
    return value;
  }
};

std::size_t type_size(std::uint16_t type) noexcept {
  switch (type) {
    case 1: case 2: case 6: case 7: return 1;          // byte, ascii, sbyte, undefined
    case 3: case 8: return 2;                          // short, sshort
    case 4: case 9: case 11: case 13: return 4;        // long, slong, float, ifd
    case 5: case 10: case 12: return 8;                // rational, srational, double
    default: return 0;
  }
}

// One IFD entry, with its value already located and bounds-checked.
struct Entry {
  std::uint16_t tag = 0, type = 0;
  std::uint32_t count = 0;
  std::size_t at = 0;    // where the value's bytes start, in the reader
  std::size_t bytes = 0; // how many bytes the value spans
};

// Visits every well-formed entry of the IFD at `offset`. A value that does not
// fit in four bytes lives at `base` + its stored offset. Entries whose value
// points outside the reader are skipped, never read.
template <class Visit>
void walk_ifd(const Reader& r, std::size_t offset, std::size_t base, Visit&& visit) noexcept {
  if (!r.has(offset, 2)) return;
  // A real IFD has tens of entries; the cap bounds CPU on a forged count.
  const std::size_t count = std::min<std::size_t>(r.u16(offset), 1024);
  for (std::size_t i = 0; i < count; ++i) {
    const std::uint64_t entry = std::uint64_t(offset) + 2 + i * 12;
    if (!r.has(entry, 12)) return;
    Entry e;
    e.tag = r.u16(std::size_t(entry));
    e.type = r.u16(std::size_t(entry + 2));
    e.count = r.u32(std::size_t(entry + 4));
    const auto unit = type_size(e.type);
    if (!unit || e.count > (1u << 20)) continue; // unknown type, or longer than any file
    const std::uint64_t bytes = std::uint64_t(unit) * e.count;
    const std::uint64_t at = bytes <= 4 ? entry + 8 : std::uint64_t(base) + r.u32(std::size_t(entry + 8));
    if (!r.has(at, bytes)) continue;
    e.at = std::size_t(at);
    e.bytes = std::size_t(bytes);
    visit(e);
  }
}

// Sets the reader's byte order from a TIFF header at its start. False when the
// bytes are not a TIFF header.
bool open_tiff(Reader& r) noexcept {
  if (r.size < 8) return false;
  if (r.bytes[0] == 'M' && r.bytes[1] == 'M') r.big_endian = true;
  else if (r.bytes[0] == 'I' && r.bytes[1] == 'I') r.big_endian = false;
  else return false;
  return r.u16(2) == 42;
}

// Several maker notes do not declare a byte order. Keep the parent's when the
// IFD looks sane in it, otherwise try the other one.
void settle_order(Reader& r, std::size_t ifd) noexcept {
  const auto plausible = [&](const Reader& candidate) {
    const auto count = candidate.u16(ifd);
    const auto type = candidate.u16(ifd + 4);
    return count >= 1 && count <= 512 && type >= 1 && type <= 13;
  };
  if (plausible(r)) return;
  Reader swapped = r;
  swapped.big_endian = !r.big_endian;
  if (plausible(swapped)) r.big_endian = swapped.big_endian;
}

int digits(const std::string& text, std::size_t at, std::size_t count) noexcept {
  int value = 0;
  for (std::size_t i = 0; i < count; ++i) {
    if (at + i >= text.size() || !std::isdigit(static_cast<unsigned char>(text[at + i]))) return -1;
    value = value * 10 + (text[at + i] - '0');
  }
  return value;
}

// "YYYY:MM:DD HH:MM:SS" as the camera wrote it, plus optional sub-seconds.
double parse_capture_time(const std::string& stamp, const std::string& subsecond,
                          const std::string& offset, bool& utc) noexcept {
  if (stamp.size() < 19) return -1;
  const int year = digits(stamp, 0, 4), month = digits(stamp, 5, 2), day = digits(stamp, 8, 2);
  const int hour = digits(stamp, 11, 2), minute = digits(stamp, 14, 2), second = digits(stamp, 17, 2);
  if (year < 1900 || year > 2400 || month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 ||
      hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 60)
    return -1;
  double ms = double(days_from_civil(year, month, day)) * 86400000.0 + hour * 3600000.0 +
              minute * 60000.0 + second * 1000.0;
  // Sub-seconds are written as a fraction's digits: "25" means .25 of a second.
  if (!subsecond.empty()) {
    double fraction = 0, scale = 0.1;
    for (char c : subsecond) {
      if (!std::isdigit(static_cast<unsigned char>(c))) break;
      fraction += (c - '0') * scale;
      scale /= 10;
    }
    ms += fraction * 1000.0;
  }
  // An offset makes the reading an instant; without one it is the camera's own
  // clock, which is still perfectly good for ordering a burst.
  utc = false;
  if (offset.size() >= 6 && (offset[0] == '+' || offset[0] == '-')) {
    const int offset_hour = digits(offset, 1, 2), offset_minute = digits(offset, 4, 2);
    if (offset_hour >= 0 && offset_minute >= 0) {
      const double shift = (offset_hour * 60.0 + offset_minute) * 60000.0;
      ms += offset[0] == '+' ? -shift : shift;
      utc = true;
    }
  }
  return ms;
}

// Everything gathered from the standard IFDs before the maker note is read:
// the maker note's meaning depends on Make, and Fujifilm's on the image size.
struct Collected {
  std::string stamp, subsecond, time_offset, make, model, serial;
  std::size_t exif_ifd = 0;
  bool has_maker_note = false;
  std::size_t maker_at = 0, maker_bytes = 0;
  std::uint32_t exif_width = 0, exif_height = 0;
  // Focal-plane resolution: pixels per unit on the sensor, which with the
  // pixel dimensions above gives the sensor's size in millimetres.
  double focal_plane_x = 0, focal_plane_y = 0;
  int focal_plane_unit = 2; // 2 inch, 3 centimetre, 4 millimetre, 5 micrometre
};

std::uint32_t unsigned_value(const Reader& r, const Entry& e) noexcept {
  if (e.type == 3) return r.u16(e.at);
  if (e.type == 4) return r.u32(e.at);
  return 0;
}

void read_ifd(const Reader& tiff, std::size_t offset, ExifFacts& facts, Collected& c) noexcept {
  walk_ifd(tiff, offset, 0, [&](const Entry& e) {
    const bool is_text = e.type == 2;
    switch (e.tag) {
      case 0x0112:
        if (e.type == 3) {
          const auto value = tiff.u16(e.at);
          if (value >= 1 && value <= 8) {
            facts.orientation = value;
            facts.orientation_tagged = true;
          }
        }
        break;
      case 0x010f: if (is_text) c.make = tiff.text(e.at, e.count); break;
      case 0x0110: if (is_text) c.model = tiff.text(e.at, e.count); break;
      case 0xa431: if (is_text) c.serial = tiff.text(e.at, e.count); break;
      case 0x9003: if (is_text) c.stamp = tiff.text(e.at, e.count); break;
      case 0x9291: if (is_text) c.subsecond = tiff.text(e.at, e.count); break;
      case 0x9011: if (is_text) c.time_offset = tiff.text(e.at, e.count); break;
      case 0x8769: if (e.type == 4 || e.type == 13) c.exif_ifd = tiff.u32(e.at); break;
      case 0x927c:
        if (e.type == 7 || e.type == 1) {
          c.has_maker_note = true;
          c.maker_at = e.at;
          c.maker_bytes = e.bytes;
        }
        break;
      case 0xa002: c.exif_width = unsigned_value(tiff, e); break;
      case 0xa003: c.exif_height = unsigned_value(tiff, e); break;
      case 0x920a: if (e.type == 5) facts.focal_length_mm = tiff.rational(e.at); break;
      case 0xa405: if (e.type == 3) facts.focal_length_35mm = tiff.u16(e.at); break;
      case 0xa20e: if (e.type == 5) c.focal_plane_x = tiff.rational(e.at); break;
      case 0xa20f: if (e.type == 5) c.focal_plane_y = tiff.rational(e.at); break;
      case 0xa210: if (e.type == 3) c.focal_plane_unit = tiff.u16(e.at); break;
      default: break;
    }
  });
}

// ---- AF areas ---------------------------------------------------------------

// A pixel rectangle in an image of the given size, normalized and clipped.
AfArea normalized(double left, double top, double width, double height, double image_width,
                  double image_height, AfSource source) noexcept {
  AfArea area;
  if (!(image_width > 0) || !(image_height > 0) || !std::isfinite(left) || !std::isfinite(top) ||
      !std::isfinite(width) || !std::isfinite(height) || width <= 0 || height <= 0)
    return area;
  const double x0 = std::clamp(left / image_width, 0.0, 1.0);
  const double y0 = std::clamp(top / image_height, 0.0, 1.0);
  const double x1 = std::clamp((left + width) / image_width, 0.0, 1.0);
  const double y1 = std::clamp((top + height) / image_height, 0.0, 1.0);
  if (x1 <= x0 || y1 <= y0) return area; // entirely outside the image
  area.present = true;
  area.x = x0;
  area.y = y0;
  area.width = x1 - x0;
  area.height = y1 - y0;
  area.source = source;
  return area;
}

// A camera that reports only a point gets a nominal square around it: about
// the size of a single AF point on a modern body, 6% of the long edge.
AfArea around_point(double cx, double cy, double image_width, double image_height,
                    AfSource source) noexcept {
  const double side = std::max(image_width, image_height) * .06;
  auto area = normalized(cx - side / 2, cy - side / 2, side, side, image_width, image_height, source);
  area.point_only = area.present;
  return area;
}

// Sony: "SONY DSC \0\0\0" (or CAM / MOBILE), an IFD at +12, offsets relative to
// the enclosing TIFF header. 0x2027 FocusLocation and 0x204a FocusLocation2 are
// int16u[4] = image width, image height, x, y with a top-left origin; all zeros
// on panoramas. 0x2037 FocusFrameSize is int16u[3] = width, height, valid flag.
AfArea sony_af(const Reader& tiff, std::size_t at, std::size_t bytes) noexcept {
  if (bytes < 14 || !(tiff.matches(at, "SONY DSC ", 9) || tiff.matches(at, "SONY CAM ", 9) ||
                      tiff.matches(at, "SONY MOBILE", 11)))
    return {};
  Reader r = tiff;
  const std::size_t ifd = at + 12;
  settle_order(r, ifd);
  std::array<std::uint16_t, 4> location{}, location2{};
  std::array<std::uint16_t, 3> frame{};
  bool has_location = false, has_location2 = false, has_frame = false;
  walk_ifd(r, ifd, 0, [&](const Entry& e) {
    // The declared type varies by body; the layout is always int16u.
    if ((e.tag == 0x2027 || e.tag == 0x204a) && e.bytes >= 8) {
      auto& target = e.tag == 0x2027 ? location : location2;
      for (std::size_t i = 0; i < 4; ++i) target[i] = r.u16(e.at + i * 2);
      (e.tag == 0x2027 ? has_location : has_location2) = true;
    } else if (e.tag == 0x2037 && e.bytes >= 6) {
      for (std::size_t i = 0; i < 3; ++i) frame[i] = r.u16(e.at + i * 2);
      has_frame = true;
    }
  });
  const auto usable = [](const std::array<std::uint16_t, 4>& v) {
    return v[0] > 0 && v[1] > 0 && v[2] <= v[0] && v[3] <= v[1];
  };
  const auto* chosen = has_location && usable(location)     ? &location
                       : has_location2 && usable(location2) ? &location2
                                                            : nullptr;
  if (!chosen) return {};
  const double w = (*chosen)[0], h = (*chosen)[1], x = (*chosen)[2], y = (*chosen)[3];
  if (has_frame && frame[2] != 0 && frame[0] > 0 && frame[1] > 0)
    return normalized(x - frame[0] / 2.0, y - frame[1] / 2.0, frame[0], frame[1], w, h, AfSource::sony);
  return around_point(x, y, w, h, AfSource::sony);
}

// Nikon: "Nikon\0\x02", a complete TIFF header at +10 that sets the byte order
// and is the base for every offset. 0x00b7 AFInfo2 is a versioned binary record:
//   0100 (DSLRs 2007-2015), 0101 (D5/D500/D850...): coordinates only for
//     contrast-detect AF (byte 4 == 1). Image w/h, area centre x/y, area w/h at
//     0x10.. (0100) or 0x46.. (0101); "in focus" at 0x1c / 0x52.
//   0300 (Z6/Z7/D780/D6...): when byte 7 (AFCoordinatesAvailable) is 1, the same
//     six int16u fields at 0x2a.
//   0400-0402 (Z8/Z9/Zf/Z6III...): same at 0x3e, FocusResult at 0x4a.
// Phase-detect viewfinder points are a per-model grid of named points, not
// coordinates, and are not mapped here.
AfArea nikon_af(const Reader& tiff, std::size_t at, std::size_t bytes) noexcept {
  if (bytes < 18 || !tiff.matches(at, "Nikon\0\x02", 7)) return {};
  Reader inner = tiff.from(at + 10);
  if (!open_tiff(inner)) return {};
  std::size_t info_at = 0, info_bytes = 0;
  walk_ifd(inner, inner.u32(4), 0, [&](const Entry& e) {
    if (e.tag == 0x00b7 && !info_bytes) {
      info_at = e.at;
      info_bytes = e.bytes;
    }
  });
  if (info_bytes < 8) return {};
  const auto byte_at = [&](std::size_t k) -> int { return k < info_bytes ? inner.u8(info_at + k) : -1; };
  const auto u16_at = [&](std::size_t k) -> int {
    return k + 2 <= info_bytes ? inner.u16(info_at + k) : -1;
  };
  std::size_t fields = 0;
  std::size_t focus_byte = 0;
  if (inner.matches(info_at, "0100", 4) || inner.matches(info_at, "0101", 4)) {
    if (byte_at(4) != 1) return {}; // phase detect: no coordinates
    const bool v0100 = inner.matches(info_at, "0100", 4);
    fields = v0100 ? 0x10 : 0x46;
    focus_byte = v0100 ? 0x1c : 0x52;
  } else if (inner.matches(info_at, "030", 3)) {
    if (byte_at(7) != 1) return {};
    fields = 0x2a;
  } else if (inner.matches(info_at, "040", 3)) {
    if (byte_at(7) != 1) return {};
    fields = 0x3e;
    focus_byte = 0x4a;
  } else {
    return {};
  }
  const int image_w = u16_at(fields), image_h = u16_at(fields + 2);
  const int cx = u16_at(fields + 4), cy = u16_at(fields + 6);
  const int area_w = u16_at(fields + 8), area_h = u16_at(fields + 10);
  if (image_w <= 0 || image_h <= 0 || cx < 0 || cy < 0 || area_w < 0 || area_h < 0) return {};
  if (cx > image_w || cy > image_h) return {};
  // Every version writes a zero centre when there is nothing to report (Z8/Z9
  // auto-area before a target is found, for one).
  if (cx == 0 && cy == 0) return {};
  AfArea area = area_w > 0 && area_h > 0
                    ? normalized(cx - area_w / 2.0, cy - area_h / 2.0, area_w, area_h, image_w,
                                 image_h, AfSource::nikon)
                    : around_point(cx, cy, image_w, image_h, AfSource::nikon);
  if (area.present && focus_byte) {
    const int focus = byte_at(focus_byte);
    if (focus == 0 || focus == 1) area.in_focus = focus;
  }
  return area;
}

// Canon: the maker note is a bare IFD (no header), offsets relative to the
// enclosing TIFF. 0x0026 AFInfo2 is int16u[]: size, AFAreaMode, NumAFPoints,
// ValidAFPoints, CanonImageWidth/Height, AFImageWidth/Height, then per point
// AFAreaWidths, AFAreaHeights, AFAreaXPositions, AFAreaYPositions (int16s,
// origin at the image centre; +Y is up on EOS bodies, down on PowerShots), then
// AFPointsInFocus and (EOS) AFPointsSelected bitmasks of ceil(N/16) words.
AfArea canon_af(const Reader& tiff, std::size_t ifd, bool y_up) noexcept {
  Reader r = tiff;
  settle_order(r, ifd);
  std::size_t info_at = 0, info_bytes = 0;
  walk_ifd(r, ifd, 0, [&](const Entry& e) {
    if (e.tag == 0x0026 && !info_bytes) {
      info_at = e.at;
      info_bytes = e.bytes;
    }
  });
  const std::size_t words = info_bytes / 2;
  if (words < 8) return {};
  const auto v = [&](std::size_t i) { return r.u16(info_at + i * 2); };
  const auto s = [&](std::size_t i) { return r.i16(info_at + i * 2); };
  const std::size_t mode = v(1), points = v(2), valid = v(3);
  if (mode == 0 || points == 0 || points > 1024) return {}; // manual focus, or forged
  const std::size_t mask_words = (points + 15) / 16;
  if (words < 8 + 4 * points + mask_words) return {};
  double image_w = v(6), image_h = v(7);
  if (!(image_w > 0 && image_h > 0)) {
    image_w = v(4);
    image_h = v(5);
  }
  if (!(image_w > 0 && image_h > 0)) return {};
  const std::size_t usable = valid > 0 && valid <= points ? valid : points;
  const bool has_selected = words >= 8 + 4 * points + 2 * mask_words;

  const auto union_of = [&](std::size_t mask_start) {
    double x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18;
    bool any = false;
    for (std::size_t i = 0; i < usable; ++i) {
      if (!((v(mask_start + i / 16) >> (i % 16)) & 1)) continue;
      double w = std::abs(double(s(8 + i))), h = std::abs(double(s(8 + points + i)));
      const double cx = image_w / 2 + s(8 + 2 * points + i);
      const double cy = image_h / 2 + (y_up ? -1.0 : 1.0) * s(8 + 3 * points + i);
      if (w <= 0 || h <= 0) w = h = std::max(image_w, image_h) * .06;
      x0 = std::min(x0, cx - w / 2);
      y0 = std::min(y0, cy - h / 2);
      x1 = std::max(x1, cx + w / 2);
      y1 = std::max(y1, cy + h / 2);
      any = true;
    }
    return any ? normalized(x0, y0, x1 - x0, y1 - y0, image_w, image_h, AfSource::canon) : AfArea{};
  };
  auto area = union_of(8 + 4 * points);
  if (area.present) {
    area.in_focus = 1;
    return area;
  }
  if (!has_selected) return {};
  area = union_of(8 + 4 * points + mask_words);
  if (area.present) area.in_focus = 0; // where the photographer aimed; nothing locked
  return area;
}

// Fujifilm: "FUJIFILM" then a little-endian offset to the IFD, and every offset
// relative to the maker note itself. 0x1023 FocusPixel is int16u[2] = x, y in
// full-size image pixels; the image size comes from the EXIF pixel dimensions.
AfArea fujifilm_af(const Reader& tiff, std::size_t at, std::size_t bytes,
                   const Collected& c) noexcept {
  if (bytes < 12 || !tiff.matches(at, "FUJIFILM", 8)) return {};
  Reader note = tiff.from(at);
  note.big_endian = false;
  int x = -1, y = -1;
  walk_ifd(note, note.u32(8), 0, [&](const Entry& e) {
    if (e.tag == 0x1023 && e.bytes >= 4 && x < 0) {
      x = note.u16(e.at);
      y = note.u16(e.at + 2);
    }
  });
  if (x <= 0 && y <= 0) return {};
  const double w = c.exif_width, h = c.exif_height;
  if (!(w > 0 && h > 0) || x > w || y > h) return {};
  return around_point(x, y, w, h, AfSource::fujifilm);
}

bool starts_with(const std::string& text, const char* prefix) noexcept {
  return text.rfind(prefix, 0) == 0;
}

AfArea maker_note_af(const Reader& tiff, const Collected& c) noexcept {
  if (!c.has_maker_note) return {};
  if (tiff.matches(c.maker_at, "SONY", 4)) return sony_af(tiff, c.maker_at, c.maker_bytes);
  if (tiff.matches(c.maker_at, "Nikon", 5)) return nikon_af(tiff, c.maker_at, c.maker_bytes);
  if (tiff.matches(c.maker_at, "FUJIFILM", 8)) return fujifilm_af(tiff, c.maker_at, c.maker_bytes, c);
  if (starts_with(c.make, "canon")) {
    const bool y_up = c.model.find("eos") != std::string::npos;
    return canon_af(tiff, c.maker_at, y_up);
  }
  return {};
}

void finish(ExifFacts& facts, const Collected& c) noexcept {
  // A focal length longer than any lens, or a nonsense equivalent, is no reading.
  if (!std::isfinite(facts.focal_length_mm) || facts.focal_length_mm <= 0 ||
      facts.focal_length_mm > 5000)
    facts.focal_length_mm = 0;
  if (facts.focal_length_35mm > 5000) facts.focal_length_35mm = 0;
  // Sensor size = pixels / pixels-per-unit. Trusted only when every part is there.
  const double unit_mm = c.focal_plane_unit == 2 ? 25.4 : c.focal_plane_unit == 3 ? 10
                       : c.focal_plane_unit == 4 ? 1 : c.focal_plane_unit == 5 ? 0.001 : 0;
  if (unit_mm > 0 && c.focal_plane_x > 0 && c.focal_plane_y > 0 && c.exif_width && c.exif_height) {
    const double long_mm = std::max(c.exif_width / c.focal_plane_x, c.exif_height / c.focal_plane_y) * unit_mm;
    if (std::isfinite(long_mm) && long_mm > 1 && long_mm < 200) facts.sensor_long_edge_mm = long_mm;
  }
  facts.capture_time_ms = parse_capture_time(c.stamp, c.subsecond, c.time_offset, facts.capture_time_utc);
  // Model alone identifies a body poorly at a game with two of the same camera;
  // the serial separates them when the file carries one.
  for (const auto* part : {&c.make, &c.model, &c.serial}) {
    if (part->empty()) continue;
    if (!facts.camera_key.empty()) facts.camera_key += '|';
    facts.camera_key += *part;
  }
}

// A whole TIFF structure: IFD0, the EXIF IFD, then the maker note.
void read_tiff(Reader tiff, ExifFacts& facts) noexcept {
  if (!open_tiff(tiff)) return;
  Collected c;
  const auto ifd0 = tiff.u32(4);
  read_ifd(tiff, ifd0, facts, c);
  if (c.exif_ifd && c.exif_ifd != ifd0) {
    const auto exif_ifd = c.exif_ifd;
    read_ifd(tiff, exif_ifd, facts, c);
  }
  facts.af = maker_note_af(tiff, c);
  finish(facts, c);
}

std::uint32_t big32(const std::uint8_t* bytes, std::size_t at) noexcept {
  return std::uint32_t(bytes[at]) << 24 | std::uint32_t(bytes[at + 1]) << 16 |
         std::uint32_t(bytes[at + 2]) << 8 | bytes[at + 3];
}

struct Cr3Boxes {
  std::size_t cmt[3][2] = {{0, 0}, {0, 0}, {0, 0}}; // CMT1..CMT3: start, size
};

// ISO-BMFF boxes, looking for Canon's metadata uuid inside moov. Budgeted and
// depth-limited so a box tree built to loop cannot.
void walk_boxes(const std::uint8_t* bytes, std::size_t begin, std::size_t end, int depth,
                Cr3Boxes& found, int& budget) noexcept {
  static const std::uint8_t canon_uuid[16] = {0x85, 0xc0, 0xb6, 0x87, 0x82, 0x0f, 0x11, 0xe0,
                                              0x81, 0x11, 0xf4, 0xce, 0x46, 0x2b, 0x6a, 0x48};
  std::size_t at = begin;
  while (end - at >= 8 && budget-- > 0) {
    std::uint64_t box = big32(bytes, at);
    std::size_t header = 8;
    if (box == 1) {
      if (end - at < 16) return;
      box = std::uint64_t(big32(bytes, at + 8)) << 32 | big32(bytes, at + 12);
      header = 16;
    } else if (box == 0) {
      box = end - at; // to the end of the enclosing box
    }
    if (box < header || box > end - at) return;
    const std::size_t content = at + header, box_end = at + std::size_t(box);
    const char* type = reinterpret_cast<const char*>(bytes + at + 4);
    if (depth < 3 && std::memcmp(type, "moov", 4) == 0) {
      walk_boxes(bytes, content, box_end, depth + 1, found, budget);
    } else if (depth < 3 && std::memcmp(type, "uuid", 4) == 0 && box_end - content >= 16 &&
               std::memcmp(bytes + content, canon_uuid, 16) == 0) {
      walk_boxes(bytes, content + 16, box_end, depth + 1, found, budget);
    } else if (std::memcmp(type, "CMT", 3) == 0 && type[3] >= '1' && type[3] <= '3') {
      auto& slot = found.cmt[type[3] - '1'];
      if (!slot[1]) {
        slot[0] = content;
        slot[1] = box_end - content;
      }
    }
    at = box_end;
  }
}

// Canon CR3: CMT1 is a TIFF holding IFD0, CMT2 the EXIF IFD, CMT3 the maker
// note, each with offsets relative to its own TIFF header.
void read_cr3(const std::uint8_t* bytes, std::size_t size, ExifFacts& facts) noexcept {
  Cr3Boxes found;
  int budget = 512;
  walk_boxes(bytes, 0, size, 0, found, budget);
  Collected c;
  for (int i = 0; i < 2; ++i) {
    if (!found.cmt[i][1]) continue;
    Reader tiff{bytes + found.cmt[i][0], found.cmt[i][1]};
    if (open_tiff(tiff)) read_ifd(tiff, tiff.u32(4), facts, c);
  }
  if (found.cmt[2][1]) {
    Reader note{bytes + found.cmt[2][0], found.cmt[2][1]};
    if (open_tiff(note)) {
      // CR3 bodies are EOS, save a few PowerShot G models that name themselves.
      const bool y_up = c.model.empty() || c.model.find("powershot") == std::string::npos;
      facts.af = canon_af(note, note.u32(4), y_up);
    }
  }
  finish(facts, c);
}
} // namespace

std::int64_t days_from_civil(int year, int month, int day) noexcept {
  // Howard Hinnant's civil calendar algorithm: exact, and free of any locale.
  year -= month <= 2;
  const std::int64_t era = (year >= 0 ? year : year - 399) / 400;
  const auto year_of_era = std::int64_t(year - era * 400);
  const auto day_of_year = std::int64_t((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1);
  const auto day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
  return era * 146097 + day_of_era - 719468;
}

AfArea upright_af_area(const AfArea& area, int orientation) noexcept {
  if (!area.present || orientation <= 1 || orientation > 8) return area;
  // The same pixel mapping as the ingest engine's upright(), in normalized
  // units: where a stored point (u, v) lands once the frame is upright.
  const auto map = [orientation](double u, double v) -> std::pair<double, double> {
    switch (orientation) {
      case 2: return {1 - u, v};
      case 3: return {1 - u, 1 - v};
      case 4: return {u, 1 - v};
      case 5: return {v, u};
      case 6: return {1 - v, u};
      case 7: return {1 - v, 1 - u};
      case 8: return {v, 1 - u};
      default: return {u, v};
    }
  };
  const auto a = map(area.x, area.y);
  const auto b = map(area.x + area.width, area.y + area.height);
  AfArea out = area;
  out.x = std::min(a.first, b.first);
  out.y = std::min(a.second, b.second);
  out.width = std::abs(a.first - b.first);
  out.height = std::abs(a.second - b.second);
  return out;
}

ExifFacts read_exif(const std::uint8_t* bytes, std::size_t size) noexcept {
  ExifFacts facts;
  if (!bytes || size < 12) return facts;

  if (bytes[0] == 0xff && bytes[1] == 0xd8) {
    // Walk the JPEG markers to the APP1 segment that starts with "Exif\0\0".
    std::size_t at = 2, exif_start = 0, exif_size = 0;
    while (at + 4 <= size) {
      if (bytes[at] != 0xff) break;
      const auto marker = bytes[at + 1];
      if (marker == 0xd8 || marker == 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        at += 2;
        continue;
      }
      if (marker == 0xda || marker == 0xd9) break; // image data begins
      const std::size_t length = std::size_t(bytes[at + 2]) << 8 | bytes[at + 3];
      if (length < 2 || length > size - at - 2) break;
      if (marker == 0xe1 && length > 8 && std::memcmp(bytes + at + 4, "Exif\0\0", 6) == 0) {
        exif_start = at + 10;
        exif_size = length - 8;
        break;
      }
      at += 2 + length;
    }
    if (!exif_start || exif_size < 8) return facts;
    read_tiff(Reader{bytes + exif_start, std::min(exif_size, size - exif_start)}, facts);
    return facts;
  }
  // ARW, NEF, CR2, DNG and friends are TIFF files from their first byte.
  if ((bytes[0] == 'I' && bytes[1] == 'I') || (bytes[0] == 'M' && bytes[1] == 'M')) {
    read_tiff(Reader{bytes, size}, facts);
    return facts;
  }
  if (std::memcmp(bytes + 4, "ftypcrx ", 8) == 0) read_cr3(bytes, size, facts);
  return facts;
}
} // namespace lenslabs
