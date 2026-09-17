#include "lenslabs/exif.hpp"
#include <algorithm>
#include <cctype>
#include <cstring>

// EXIF, read defensively. Camera files arrive from strangers' cards and from
// software that writes the format loosely, so every offset is checked against
// the buffer and anything that does not parse is simply absent.
namespace lenslabs {
namespace {

struct Reader {
  const std::uint8_t* bytes;
  std::size_t size;
  bool big_endian = false;

  bool has(std::size_t at, std::size_t count) const noexcept {
    return at <= size && count <= size - at;
  }
  std::uint16_t u16(std::size_t at) const noexcept {
    if (!has(at, 2)) return 0;
    return big_endian ? std::uint16_t(bytes[at] << 8 | bytes[at + 1])
                      : std::uint16_t(bytes[at + 1] << 8 | bytes[at]);
  }
  std::uint32_t u32(std::size_t at) const noexcept {
    if (!has(at, 4)) return 0;
    return big_endian ? std::uint32_t(bytes[at]) << 24 | std::uint32_t(bytes[at + 1]) << 16 |
                            std::uint32_t(bytes[at + 2]) << 8 | bytes[at + 3]
                      : std::uint32_t(bytes[at + 3]) << 24 | std::uint32_t(bytes[at + 2]) << 16 |
                            std::uint32_t(bytes[at + 1]) << 8 | bytes[at];
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

// One IFD entry's value: inline when it fits in four bytes, otherwise at an
// offset from the start of the TIFF header.
std::size_t value_at(const Reader& tiff, std::size_t entry, std::size_t bytes_needed) noexcept {
  return bytes_needed <= 4 ? entry + 8 : tiff.u32(entry + 8);
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

void read_ifd(const Reader& tiff, std::size_t offset, ExifFacts& facts, std::string& stamp,
              std::string& subsecond, std::string& time_offset, std::string& make,
              std::string& model, std::string& serial, std::size_t& exif_ifd, int depth) noexcept {
  if (depth > 2 || !tiff.has(offset, 2)) return;
  const auto count = tiff.u16(offset);
  for (std::size_t i = 0; i < count; ++i) {
    const auto entry = offset + 2 + i * 12;
    if (!tiff.has(entry, 12)) return;
    const auto tag = tiff.u16(entry);
    const auto type = tiff.u16(entry + 2);
    const auto components = tiff.u32(entry + 4);
    if (components > (1u << 20)) continue; // a field longer than the file itself
    const bool is_text = type == 2;
    const auto at = value_at(tiff, entry, is_text ? components : std::size_t(components) * 2);
    switch (tag) {
      case 0x0112:
        if (type == 3) {
          const auto value = tiff.u16(value_at(tiff, entry, 2));
          if (value >= 1 && value <= 8) facts.orientation = value;
        }
        break;
      case 0x010f: if (is_text) make = tiff.text(at, components); break;
      case 0x0110: if (is_text) model = tiff.text(at, components); break;
      case 0xa431: if (is_text) serial = tiff.text(at, components); break;
      case 0x9003: if (is_text) stamp = tiff.text(at, components); break;
      case 0x9291: if (is_text) subsecond = tiff.text(at, components); break;
      case 0x9011: if (is_text) time_offset = tiff.text(at, components); break;
      case 0x8769: if (type == 4) exif_ifd = tiff.u32(value_at(tiff, entry, 4)); break;
      default: break;
    }
  }
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

ExifFacts read_exif(const std::uint8_t* bytes, std::size_t size) noexcept {
  ExifFacts facts;
  if (!bytes || size < 12 || bytes[0] != 0xff || bytes[1] != 0xd8) return facts;

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
    if (length < 2 || at + 2 + length > size) break;
    if (marker == 0xe1 && length > 8 && std::memcmp(bytes + at + 4, "Exif\0\0", 6) == 0) {
      exif_start = at + 10;
      exif_size = length - 8;
      break;
    }
    at += 2 + length;
  }
  if (!exif_start || exif_size < 8) return facts;

  Reader tiff{bytes + exif_start, std::min(exif_size, size - exif_start)};
  if (tiff.size < 8) return facts;
  if (tiff.bytes[0] == 'M' && tiff.bytes[1] == 'M') tiff.big_endian = true;
  else if (!(tiff.bytes[0] == 'I' && tiff.bytes[1] == 'I')) return facts;
  if (tiff.u16(2) != 42) return facts;

  std::string stamp, subsecond, time_offset, make, model, serial;
  std::size_t exif_ifd = 0;
  read_ifd(tiff, tiff.u32(4), facts, stamp, subsecond, time_offset, make, model, serial, exif_ifd, 0);
  if (exif_ifd)
    read_ifd(tiff, exif_ifd, facts, stamp, subsecond, time_offset, make, model, serial, exif_ifd, 1);

  facts.capture_time_ms = parse_capture_time(stamp, subsecond, time_offset, facts.capture_time_utc);
  // Model alone identifies a body poorly at a game with two of the same camera;
  // the serial separates them when the file carries one.
  for (const auto* part : {&make, &model, &serial}) {
    if (part->empty()) continue;
    if (!facts.camera_key.empty()) facts.camera_key += '|';
    facts.camera_key += *part;
  }
  return facts;
}
} // namespace lenslabs
