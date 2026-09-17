// AF-area parsing from hand-built maker notes, one per brand, plus the hostile
// inputs a card from a stranger can hold: truncation at every byte, flipped
// bytes, forged counts, offsets past the end and IFDs that point at themselves.
#include "lenslabs/exif.hpp"
#include <cmath>
#include <cstring>
#include <initializer_list>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
int checks = 0;
void check(bool passed, const std::string& label) {
  ++checks;
  if (!passed) throw std::runtime_error(label);
}
bool near(double a, double b, double tolerance = 1e-6) { return std::abs(a - b) <= tolerance; }

using Blob = std::vector<std::uint8_t>;

// A byte buffer that grows as values are placed at absolute offsets, so a test
// can lay out IFDs, maker notes and their data at fixed, readable positions.
struct Buffer {
  bool big_endian = false;
  Blob bytes;
  void reserve_to(std::size_t end) {
    if (bytes.size() < end) bytes.resize(end, 0);
  }
  void u8(std::size_t at, std::uint8_t v) { reserve_to(at + 1); bytes[at] = v; }
  void u16(std::size_t at, std::uint16_t v) {
    reserve_to(at + 2);
    bytes[at + (big_endian ? 0 : 1)] = std::uint8_t(v >> 8);
    bytes[at + (big_endian ? 1 : 0)] = std::uint8_t(v);
  }
  void u32(std::size_t at, std::uint32_t v) {
    reserve_to(at + 4);
    for (int i = 0; i < 4; ++i)
      bytes[at + std::size_t(big_endian ? 3 - i : i)] = std::uint8_t(v >> (8 * i));
  }
  void raw(std::size_t at, const Blob& data) {
    reserve_to(at + data.size());
    std::copy(data.begin(), data.end(), bytes.begin() + std::ptrdiff_t(at));
  }
  void text(std::size_t at, const char* value, std::size_t count) {
    reserve_to(at + count);
    std::memcpy(bytes.data() + at, value, count);
  }
};

struct Field {
  std::uint16_t tag, type;
  std::uint32_t count;
  Blob data; // already in the IFD's byte order
};

Blob shorts(std::initializer_list<int> values, bool big_endian) {
  Buffer b{big_endian, {}};
  std::size_t at = 0;
  for (int v : values) { b.u16(at, std::uint16_t(v)); at += 2; }
  return b.bytes;
}
Blob longs(std::initializer_list<std::uint32_t> values, bool big_endian) {
  Buffer b{big_endian, {}};
  std::size_t at = 0;
  for (auto v : values) { b.u32(at, v); at += 4; }
  return b.bytes;
}
Field ascii(std::uint16_t tag, const std::string& value) {
  Blob data(value.begin(), value.end());
  data.push_back(0);
  return {tag, 2, std::uint32_t(data.size()), data};
}
Field short_field(std::uint16_t tag, std::initializer_list<int> values, bool be) {
  return {tag, 3, std::uint32_t(values.size()), shorts(values, be)};
}
Field long_field(std::uint16_t tag, std::uint32_t value, bool be) {
  return {tag, 4, 1, longs({value}, be)};
}
Field undefined(std::uint16_t tag, const Blob& data) {
  return {tag, 7, std::uint32_t(data.size()), data};
}

// Writes an IFD at `at`, its out-of-line values right after it, with stored
// offsets relative to `base`. Returns the first byte after everything written.
std::size_t write_ifd(Buffer& b, std::size_t at, std::size_t base, const std::vector<Field>& fields) {
  b.u16(at, std::uint16_t(fields.size()));
  std::size_t data_at = at + 2 + fields.size() * 12 + 4;
  for (std::size_t i = 0; i < fields.size(); ++i) {
    const auto& f = fields[i];
    const auto entry = at + 2 + i * 12;
    b.u16(entry, f.tag);
    b.u16(entry + 2, f.type);
    b.u32(entry + 4, f.count);
    if (f.data.size() <= 4) {
      b.raw(entry + 8, f.data);
    } else {
      b.u32(entry + 8, std::uint32_t(data_at - base));
      b.raw(data_at, f.data);
      data_at += f.data.size() + (f.data.size() & 1);
    }
  }
  b.u32(at + 2 + fields.size() * 12, 0);
  b.reserve_to(data_at);
  return data_at;
}

void tiff_header(Buffer& b, std::size_t at = 0, std::uint32_t ifd0 = 8) {
  b.text(at, b.big_endian ? "MM" : "II", 2);
  b.u16(at + 2, 42);
  b.u32(at + 4, ifd0);
}

// A TIFF with IFD0 at 8, the EXIF IFD at 512 and the maker note at 1024.
Blob tiff_with_maker_note(bool big_endian, const std::string& make, const std::string& model,
                          const Blob& maker_note, std::vector<Field> exif_extra = {},
                          int orientation = 0) {
  Buffer b{big_endian, {}};
  tiff_header(b);
  std::vector<Field> ifd0{ascii(0x010f, make), ascii(0x0110, model), long_field(0x8769, 512, big_endian)};
  if (orientation) ifd0.push_back(short_field(0x0112, {orientation}, big_endian));
  write_ifd(b, 8, 0, ifd0);
  auto exif = exif_extra;
  exif.push_back({0x927c, 7, std::uint32_t(maker_note.size()), longs({1024}, big_endian)});
  write_ifd(b, 512, 0, exif);
  b.raw(1024, maker_note);
  return b.bytes;
}

Blob jpeg_around(const Blob& tiff) {
  Blob out{0xff, 0xd8, 0xff, 0xe1};
  const auto length = tiff.size() + 8;
  out.push_back(std::uint8_t(length >> 8));
  out.push_back(std::uint8_t(length));
  for (char c : std::string("Exif\0\0", 6)) out.push_back(std::uint8_t(c));
  out.insert(out.end(), tiff.begin(), tiff.end());
  out.push_back(0xff);
  out.push_back(0xd9);
  return out;
}

lenslabs::ExifFacts read(const Blob& blob) { return lenslabs::read_exif(blob.data(), blob.size()); }

// ---- Sony ------------------------------------------------------------------
// Maker note at TIFF offset 1024: "SONY DSC \0\0\0", IFD at 1036, values after it,
// offsets relative to the TIFF header.
Blob sony_note(bool be, std::initializer_list<int> location, std::initializer_list<int> location2 = {},
               std::initializer_list<int> frame = {}) {
  Buffer b{be, {}};
  b.text(1024, "SONY DSC \0\0\0", 12);
  std::vector<Field> fields;
  if (location.size()) fields.push_back(short_field(0x2027, location, be));
  if (frame.size()) fields.push_back(short_field(0x2037, frame, be));
  if (location2.size()) fields.push_back(short_field(0x204a, location2, be));
  const auto end = write_ifd(b, 1036, 0, fields);
  return Blob(b.bytes.begin() + 1024, b.bytes.begin() + std::ptrdiff_t(end));
}

// ---- Nikon -----------------------------------------------------------------
// "Nikon\0\x02\x10\0\0", then a TIFF header that is the base for every offset.
Blob nikon_note(bool be, const Blob& af_info2) {
  Buffer b{be, {}};
  b.text(0, "Nikon\0\x02\x10\0\0", 10);
  Buffer inner{be, {}};
  tiff_header(inner);
  write_ifd(inner, 8, 0, {undefined(0x00b7, af_info2)});
  b.raw(10, inner.bytes);
  return b.bytes;
}
Blob nikon_af_info2(const char* version, std::size_t fields_at, int image_w, int image_h, int cx,
                    int cy, int area_w, int area_h, bool be, int coordinates = 1, int method = 1,
                    int focus_byte_at = -1, int focus = 1) {
  Buffer b{be, {}};
  b.reserve_to(0x60);
  b.text(0, version, 4);
  b.u8(4, std::uint8_t(method));
  b.u8(7, std::uint8_t(coordinates));
  b.u16(fields_at, std::uint16_t(image_w));
  b.u16(fields_at + 2, std::uint16_t(image_h));
  b.u16(fields_at + 4, std::uint16_t(cx));
  b.u16(fields_at + 6, std::uint16_t(cy));
  b.u16(fields_at + 8, std::uint16_t(area_w));
  b.u16(fields_at + 10, std::uint16_t(area_h));
  if (focus_byte_at >= 0) b.u8(std::size_t(focus_byte_at), std::uint8_t(focus));
  return b.bytes;
}

// ---- Canon -----------------------------------------------------------------
// A bare IFD at TIFF offset 1024 holding 0x0026 AFInfo2.
Blob canon_note(bool be, const std::vector<int>& af_info2) {
  Buffer b{be, {}};
  Buffer values{be, {}};
  for (std::size_t i = 0; i < af_info2.size(); ++i) values.u16(i * 2, std::uint16_t(af_info2[i]));
  const auto end = write_ifd(b, 1024, 0, {{0x0026, 3, std::uint32_t(af_info2.size()), values.bytes}});
  return Blob(b.bytes.begin() + 1024, b.bytes.begin() + std::ptrdiff_t(end));
}
// Three 200x200 points on a 6000x4000 image: centre, up-right, down-left.
std::vector<int> canon_af_info2(int in_focus_mask, int selected_mask, int mode = 2, int points = 3) {
  std::vector<int> v{0, mode, points, points, 6000, 4000, 6000, 4000};
  for (int i = 0; i < 3; ++i) v.push_back(200);          // widths
  for (int i = 0; i < 3; ++i) v.push_back(200);          // heights
  for (int x : {0, 1500, -1500}) v.push_back(x & 0xffff); // x, from centre
  for (int y : {0, 1000, -1000}) v.push_back(y & 0xffff); // y, from centre
  v.push_back(in_focus_mask);
  v.push_back(selected_mask);
  v[0] = int(v.size() * 2);
  return v;
}

// ---- Fujifilm --------------------------------------------------------------
Blob fujifilm_note(int x, int y) {
  Buffer b{false, {}}; // always little-endian, offsets from the note's start
  b.text(0, "FUJIFILM", 8);
  b.u32(8, 12);
  write_ifd(b, 12, 0, {short_field(0x1023, {x, y}, false)});
  return b.bytes;
}

// ---- Canon CR3 -------------------------------------------------------------
void box(Blob& out, const char* type, const Blob& content) {
  const auto size = std::uint32_t(content.size() + 8);
  for (int i = 3; i >= 0; --i) out.push_back(std::uint8_t(size >> (8 * i)));
  out.insert(out.end(), type, type + 4);
  out.insert(out.end(), content.begin(), content.end());
}
Blob cr3(const std::vector<int>& af_info2, const std::string& model) {
  Buffer cmt1{false, {}};
  tiff_header(cmt1);
  write_ifd(cmt1, 8, 0, {ascii(0x010f, "Canon"), ascii(0x0110, model)});
  Buffer cmt3{false, {}};
  tiff_header(cmt3);
  Buffer values{false, {}};
  for (std::size_t i = 0; i < af_info2.size(); ++i) values.u16(i * 2, std::uint16_t(af_info2[i]));
  write_ifd(cmt3, 8, 0, {{0x0026, 3, std::uint32_t(af_info2.size()), values.bytes}});

  Blob uuid_content{0x85, 0xc0, 0xb6, 0x87, 0x82, 0x0f, 0x11, 0xe0,
                    0x81, 0x11, 0xf4, 0xce, 0x46, 0x2b, 0x6a, 0x48};
  box(uuid_content, "CNCV", Blob(30, 0));
  box(uuid_content, "CMT1", cmt1.bytes);
  box(uuid_content, "CMT3", cmt3.bytes);
  Blob moov;
  box(moov, "uuid", uuid_content);
  Blob file;
  box(file, "ftyp", Blob{'c', 'r', 'x', ' ', 0, 0, 0, 1});
  box(file, "moov", moov);
  box(file, "mdat", Blob(64, 0));
  return file;
}

// Every prefix and a few thousand single-byte corruptions: none may crash, hang
// or report an area outside 0..1.
void survive_hostile(const Blob& good, const std::string& label) {
  const auto sane = [&](const lenslabs::ExifFacts& facts) {
    const auto& a = facts.af;
    if (!a.present) return true;
    return std::isfinite(a.x) && std::isfinite(a.y) && a.x >= 0 && a.y >= 0 && a.width > 0 &&
           a.height > 0 && a.x + a.width <= 1 + 1e-9 && a.y + a.height <= 1 + 1e-9;
  };
  for (std::size_t length = 0; length <= good.size(); ++length) {
    const auto facts = lenslabs::read_exif(good.data(), length);
    check(sane(facts), label + ": truncated read stays in range");
  }
  std::uint32_t state = 2463534242u;
  const auto next = [&] {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return state;
  };
  for (int round = 0; round < 3000; ++round) {
    auto blob = good;
    const int flips = 1 + int(next() % 4);
    for (int i = 0; i < flips; ++i) blob[next() % blob.size()] = std::uint8_t(next());
    check(sane(read(blob)), label + ": corrupted read stays in range");
  }
  ++checks;
}
} // namespace

int main() {
  try {
    using lenslabs::AfSource;
    {
      // Sony camera JPEG: FocusLocation = width, height, x, y.
      const auto note = sony_note(false, {6000, 4000, 4500, 1000});
      const auto facts = read(jpeg_around(tiff_with_maker_note(false, "SONY", "ILCE-1", note)));
      const auto& af = facts.af;
      check(af.present && af.source == AfSource::sony, "Sony FocusLocation is read from a JPEG.");
      check(af.point_only && af.in_focus == -1, "A bare Sony point is a nominal box of unknown lock.");
      check(near(af.x + af.width / 2, .75) && near(af.y + af.height / 2, .25),
            "Sony's point lands at x/width, y/height.");
      check(near(af.width, 360.0 / 6000) && near(af.height, 360.0 / 4000),
            "The nominal box is 6% of the long edge.");
      check(facts.camera_key == "sony|ilce-1", "Camera identity is still read alongside the AF area.");
    }
    {
      // FocusFrameSize gives the real box; a big-endian note inside a
      // little-endian file still parses.
      const auto note = sony_note(true, {6000, 4000, 3000, 2000}, {}, {600, 400, 257});
      const auto af = read(jpeg_around(tiff_with_maker_note(false, "SONY", "ILCE-9M3", note))).af;
      check(af.present && !af.point_only, "Sony FocusFrameSize sizes the AF box.");
      check(near(af.x, .45) && near(af.width, .1) && near(af.y, .45) && near(af.height, .1),
            "The frame is centred on the location.");
    }
    {
      // A panorama writes zeros; FocusLocation2 is the fallback, and with no
      // fallback there is no AF area at all.
      const auto zeros = sony_note(false, {0, 0, 0, 0}, {6000, 4000, 1500, 3000});
      const auto af = read(jpeg_around(tiff_with_maker_note(false, "SONY", "ILCE-7M4", zeros))).af;
      check(af.present && near(af.x + af.width / 2, .25) && near(af.y + af.height / 2, .75),
            "FocusLocation2 stands in when FocusLocation is empty.");
      const auto only_zeros = sony_note(false, {0, 0, 0, 0});
      check(!read(jpeg_around(tiff_with_maker_note(false, "SONY", "ILCE-7M4", only_zeros))).af.present,
            "A panorama's zero location is no AF area.");
      const auto outside = sony_note(false, {6000, 4000, 7000, 100});
      check(!read(jpeg_around(tiff_with_maker_note(false, "SONY", "ILCE-7M4", outside))).af.present,
            "A location outside the image it names is rejected.");
    }
    {
      // ARW: the same structure, as a TIFF file from byte zero.
      const auto note = sony_note(false, {6000, 4000, 4500, 1000});
      const auto arw = tiff_with_maker_note(false, "SONY", "ILCE-1", note, {}, 6);
      const auto facts = read(arw);
      check(facts.af.present && near(facts.af.x + facts.af.width / 2, .75),
            "An ARW's AF area is read straight from the RAW container.");
      check(facts.orientation == 6, "The container's orientation is read.");
      survive_hostile(arw, "sony arw");
      survive_hostile(jpeg_around(tiff_with_maker_note(true, "SONY", "ILCE-1", sony_note(true, {6000, 4000, 1, 1}, {}, {600, 400, 257}))),
                      "sony jpeg");
    }
    {
      // Nikon Z9 (AFInfo2 0400) in a big-endian NEF.
      const auto info = nikon_af_info2("0400", 0x3e, 8256, 5504, 2064, 1376, 826, 550, true, 1, 0, 0x4a, 1);
      const auto nef = tiff_with_maker_note(true, "NIKON CORPORATION", "NIKON Z 9", nikon_note(true, info));
      const auto af = read(nef).af;
      check(af.present && af.source == AfSource::nikon, "Nikon AFInfo2 0400 is read from a NEF.");
      check(near(af.x + af.width / 2, .25) && near(af.y + af.height / 2, .25, 1e-9) &&
                near(af.width, 826.0 / 8256) && near(af.height, 550.0 / 5504),
            "Nikon's centre and area size are in AF-image pixels.");
      check(af.in_focus == 1, "Nikon FocusResult is carried.");
      survive_hostile(nef, "nikon nef");

      const auto unavailable = nikon_af_info2("0400", 0x3e, 8256, 5504, 2064, 1376, 826, 550, true, 0);
      check(!read(tiff_with_maker_note(true, "NIKON CORPORATION", "NIKON Z 9", nikon_note(true, unavailable))).af.present,
            "Without AFCoordinatesAvailable the fields are ignored.");
      const auto zero_centre = nikon_af_info2("0300", 0x2a, 6048, 4024, 0, 0, 300, 300, false);
      check(!read(jpeg_around(tiff_with_maker_note(false, "NIKON CORPORATION", "NIKON Z 7", nikon_note(false, zero_centre)))).af.present,
            "A zero centre means no target, not the top-left corner.");
      const auto z7 = nikon_af_info2("0300", 0x2a, 6048, 4024, 3024, 2012, 0, 0, false);
      const auto z7_af = read(jpeg_around(tiff_with_maker_note(false, "NIKON CORPORATION", "NIKON Z 7", nikon_note(false, z7)))).af;
      check(z7_af.present && z7_af.point_only && near(z7_af.x + z7_af.width / 2, .5),
            "Nikon 0300 in a little-endian JPEG, with no area size, is a point.");
      const auto phase = nikon_af_info2("0100", 0x10, 4256, 2832, 2128, 1416, 300, 300, true, 0, 0);
      check(!read(tiff_with_maker_note(true, "NIKON CORPORATION", "NIKON D700", nikon_note(true, phase))).af.present,
            "Phase-detect viewfinder AF has no coordinates to read.");
      const auto live_view = nikon_af_info2("0100", 0x10, 4256, 2832, 2128, 1416, 300, 300, true, 0, 1, 0x1c, 0);
      const auto lv = read(tiff_with_maker_note(true, "NIKON CORPORATION", "NIKON D700", nikon_note(true, live_view))).af;
      check(lv.present && lv.in_focus == 0, "Contrast-detect AF carries its own in-focus flag.");
      const auto d850 = nikon_af_info2("0101", 0x46, 8256, 5504, 4128, 2752, 400, 400, true, 0, 1, 0x52, 1);
      check(read(tiff_with_maker_note(true, "NIKON CORPORATION", "NIKON D850", nikon_note(true, d850))).af.in_focus == 1,
            "AFInfo2 0101 reads its fields at 0x46.");
      auto short_info = info;
      short_info.resize(0x40);
      check(!read(tiff_with_maker_note(true, "NIKON CORPORATION", "NIKON Z 9", nikon_note(true, short_info))).af.present,
            "An AFInfo2 record too short for its version is ignored.");
    }
    {
      // Canon EOS: +Y is up. Point 1 (1500, 1000) is up and right of centre.
      const auto jpeg = jpeg_around(tiff_with_maker_note(false, "Canon", "Canon EOS R3", canon_note(false, canon_af_info2(0b010, 0b111))));
      const auto af = read(jpeg).af;
      check(af.present && af.source == AfSource::canon && af.in_focus == 1,
            "Canon AFInfo2 in-focus points are read.");
      check(near(af.x, 4400.0 / 6000) && near(af.y, 900.0 / 4000) && near(af.width, 200.0 / 6000) &&
                near(af.height, 200.0 / 4000),
            "Canon EOS coordinates are centre-origin with +Y up.");
      survive_hostile(jpeg, "canon jpeg");

      const auto union_af = read(jpeg_around(tiff_with_maker_note(false, "Canon", "Canon EOS R3", canon_note(false, canon_af_info2(0b111, 0))))).af;
      check(near(union_af.x, 1400.0 / 6000) && near(union_af.x + union_af.width, 4600.0 / 6000),
            "Several in-focus points become the box that holds them all.");
      const auto powershot = read(tiff_with_maker_note(true, "Canon", "Canon PowerShot G1 X Mark III", canon_note(true, canon_af_info2(0b010, 0)))).af;
      check(powershot.present && near(powershot.y, 2900.0 / 4000), "PowerShot +Y points down.");
      const auto unlocked = read(jpeg_around(tiff_with_maker_note(false, "Canon", "Canon EOS R5", canon_note(false, canon_af_info2(0, 0b001))))).af;
      check(unlocked.present && unlocked.in_focus == 0 && near(unlocked.x + unlocked.width / 2, .5),
            "Selected points with no lock are reported as not in focus.");
      check(!read(jpeg_around(tiff_with_maker_note(false, "Canon", "Canon EOS R5", canon_note(false, canon_af_info2(0b001, 0, 0))))).af.present,
            "Manual focus has no AF area.");
      auto forged = canon_af_info2(0b001, 0);
      forged[2] = 60000;
      check(!read(jpeg_around(tiff_with_maker_note(false, "Canon", "Canon EOS R5", canon_note(false, forged)))).af.present,
            "A point count larger than the record is rejected.");
      check(!read(jpeg_around(tiff_with_maker_note(false, "Nikon", "Canon EOS R5", canon_note(false, canon_af_info2(1, 0))))).af.present,
            "A headerless maker note is only Canon's when Make says Canon.");
    }
    {
      // Fujifilm: FocusPixel in full-size pixels, sized by the EXIF dimensions.
      // RAF previews are big-endian TIFFs holding a little-endian maker note.
      const auto dims = std::vector<Field>{short_field(0xa002, {6240}, true), short_field(0xa003, {4160}, true)};
      const auto jpeg = jpeg_around(tiff_with_maker_note(true, "FUJIFILM", "X-H2S", fujifilm_note(4680, 1040), dims));
      const auto af = read(jpeg).af;
      check(af.present && af.source == AfSource::fujifilm && af.point_only,
            "Fujifilm FocusPixel is read from a big-endian file.");
      check(near(af.x + af.width / 2, .75) && near(af.y + af.height / 2, .25),
            "FocusPixel is normalized by the EXIF pixel dimensions.");
      survive_hostile(jpeg, "fujifilm jpeg");
      check(!read(jpeg_around(tiff_with_maker_note(true, "FUJIFILM", "X-H2S", fujifilm_note(4680, 1040)))).af.present,
            "Without the image size a Fujifilm pixel cannot be placed.");
    }
    {
      // CR3: Canon's metadata boxes inside moov.
      const auto file = cr3(canon_af_info2(0b100, 0), "Canon EOS R6m2");
      const auto facts = read(file);
      check(facts.af.present && facts.af.source == AfSource::canon && facts.af.in_focus == 1,
            "A CR3's AF area is read from CMT3.");
      check(near(facts.af.x + facts.af.width / 2, .25) && near(facts.af.y + facts.af.height / 2, .75),
            "CR3 point 2 (-1500, -1000) is down and left on an EOS body.");
      check(facts.camera_key == "canon|canon eos r6m2", "CR3 camera identity comes from CMT1.");
      survive_hostile(file, "canon cr3");
    }
    {
      // Orientation: the same mapping the ingest engine applies to pixels.
      lenslabs::AfArea area;
      area.present = true;
      area.x = .1; area.y = .2; area.width = .3; area.height = .1;
      const auto r6 = lenslabs::upright_af_area(area, 6);
      check(near(r6.x, .7) && near(r6.y, .1) && near(r6.width, .1) && near(r6.height, .3),
            "Orientation 6 rotates the area clockwise.");
      const auto r8 = lenslabs::upright_af_area(area, 8);
      check(near(r8.x, .2) && near(r8.y, .6) && near(r8.width, .1) && near(r8.height, .3),
            "Orientation 8 rotates the area counter-clockwise.");
      const auto r3 = lenslabs::upright_af_area(area, 3);
      check(near(r3.x, .6) && near(r3.y, .7) && near(r3.width, .3), "Orientation 3 turns it half way.");
      const auto r1 = lenslabs::upright_af_area(area, 42);
      check(near(r1.x, .1) && near(r1.y, .2), "An invalid orientation leaves the area alone.");
      lenslabs::AfArea absent;
      check(!lenslabs::upright_af_area(absent, 6).present, "An absent area stays absent.");
    }
    {
      // Structures built to loop or to point past the end.
      Buffer loop{false, {}};
      tiff_header(loop);
      write_ifd(loop, 8, 0, {long_field(0x8769, 8, false), {0x927c, 7, 4000000000u, longs({1024}, false)}});
      check(!read(jpeg_around(loop.bytes)).af.present, "A self-referencing EXIF IFD terminates.");
      Buffer past{false, {}};
      tiff_header(past, 0, 0xfffffff0u);
      check(!read(past.bytes).af.present, "An IFD offset past the end is absent.");
      Blob cr3_loop;
      box(cr3_loop, "ftyp", Blob{'c', 'r', 'x', ' ', 0, 0, 0, 1});
      Blob zero_size{0, 0, 0, 0, 'm', 'o', 'o', 'v', 0, 0, 0, 1, 'u', 'u', 'i', 'd'};
      cr3_loop.insert(cr3_loop.end(), zero_size.begin(), zero_size.end());
      check(!read(cr3_loop).af.present, "A CR3 box claiming a 64-bit size it does not have ends the walk.");
      check(!lenslabs::read_exif(nullptr, 100).af.present, "A null buffer is no metadata.");
    }
    std::cout << "PASS exif: " << checks << " checks\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "FAIL exif: " << error.what() << "\n";
    return 1;
  }
}
