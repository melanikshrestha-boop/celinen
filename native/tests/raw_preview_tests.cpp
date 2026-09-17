// RAW containers built byte by byte: which way up a frame belongs (all eight
// TIFF orientations, in little- and big-endian TIFF RAWs and in CR3), which
// embedded JPEG is the best picture, how precedence between a container's and
// a preview's own orientation is settled, and survival of every truncation and
// thousands of corruptions.
#include "lenslabs/raw_preview.hpp"
#include <cstdint>
#include <cstring>
#include <iostream>
#include <random>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
using lenslabs::ContainerKind;
using lenslabs::describe_jpeg;
using lenslabs::inspect_raw;
using lenslabs::JpegInfo;
using lenslabs::preview_orientation;
using lenslabs::PreviewSource;
using lenslabs::rank_previews;
using lenslabs::RawContainer;
using lenslabs::retag_orientation;
using Blob = std::vector<std::uint8_t>;

int checks = 0;
void check(bool passed, const std::string& label) {
  ++checks;
  if (!passed) throw std::runtime_error(label);
}

struct Buffer {
  bool big_endian = false;
  Blob bytes;
  void reserve_to(std::size_t end) {
    if (bytes.size() < end) bytes.resize(end, 0);
  }
  void u8(std::size_t at, std::uint8_t v) {
    reserve_to(at + 1);
    bytes[at] = v;
  }
  void u16(std::size_t at, std::uint16_t v) {
    reserve_to(at + 2);
    bytes[at + (big_endian ? 0 : 1)] = std::uint8_t(v >> 8);
    bytes[at + (big_endian ? 1 : 0)] = std::uint8_t(v);
  }
  void u32(std::size_t at, std::uint32_t v) {
    reserve_to(at + 4);
    for (int i = 0; i < 4; ++i) bytes[at + std::size_t(big_endian ? 3 - i : i)] = std::uint8_t(v >> (8 * i));
  }
  void be32(std::size_t at, std::uint32_t v) {
    reserve_to(at + 4);
    for (int i = 0; i < 4; ++i) bytes[at + std::size_t(i)] = std::uint8_t(v >> (8 * (3 - i)));
  }
  void raw(std::size_t at, const Blob& data) {
    reserve_to(at + data.size());
    std::copy(data.begin(), data.end(), bytes.begin() + std::ptrdiff_t(at));
  }
  void text(std::size_t at, const char* value) {
    const auto n = std::strlen(value);
    reserve_to(at + n);
    std::memcpy(bytes.data() + at, value, n);
  }
};

// A structurally complete JPEG: SOI, optional EXIF orientation, a frame header
// of the given process and size, a scan with entropy bytes, EOI. `pad` grows
// the entropy data so byte length can be steered independently of pixels.
Blob jpeg(std::uint16_t width, std::uint16_t height, int own_orientation = 0, std::uint8_t sof = 0xc0,
          std::size_t pad = 64) {
  Blob out{0xff, 0xd8};
  if (own_orientation) {
    const Blob app1{0xff, 0xe1, 0x00, 0x22, 'E', 'x', 'i', 'f', 0, 0, 'I', 'I', 42, 0, 8, 0, 0, 0,
                    1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, std::uint8_t(own_orientation), 0, 0, 0, 0, 0, 0, 0};
    out.insert(out.end(), app1.begin(), app1.end());
  }
  const Blob frame{0xff, sof, 0x00, 0x11, 8, std::uint8_t(height >> 8), std::uint8_t(height),
                   std::uint8_t(width >> 8), std::uint8_t(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1};
  out.insert(out.end(), frame.begin(), frame.end());
  const Blob scan{0xff, 0xda, 0x00, 0x0c, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0};
  out.insert(out.end(), scan.begin(), scan.end());
  for (std::size_t i = 0; i < pad; ++i) out.push_back(std::uint8_t(i % 251)); // never 0xff
  out.push_back(0xff);
  out.push_back(0xd9);
  return out;
}

struct Field {
  std::uint16_t tag, type;
  std::uint32_t count, value;
};

// Writes an IFD at `at` with `fields` (inline SHORT/LONG values) and `next`.
void ifd(Buffer& b, std::size_t at, const std::vector<Field>& fields, std::uint32_t next = 0) {
  b.u16(at, std::uint16_t(fields.size()));
  for (std::size_t i = 0; i < fields.size(); ++i) {
    const auto e = at + 2 + i * 12;
    b.u16(e, fields[i].tag);
    b.u16(e + 2, fields[i].type);
    b.u32(e + 4, fields[i].count);
    if (fields[i].type == 3 && fields[i].count == 1) b.u16(e + 8, std::uint16_t(fields[i].value));
    else b.u32(e + 8, fields[i].value);
  }
  b.u32(at + 2 + fields.size() * 12, next);
}

// A Sony-ARW-shaped file: IFD0 = 1616x1080 PreviewImage (JPEGInterchangeFormat)
// with Orientation and a SubIFD for the sensor data; IFD1 = 160x120 thumbnail.
// Offsets: IFD0 8, sub IFD 400, IFD1 600, thumbnail 1024, preview 4096,
// sensor data 16384. `sub_jpeg` optionally adds a full-size JpgFromRaw in the
// SubIFD chain, as NEFs carry.
Blob arw(bool big_endian, int orientation, std::uint16_t preview_w = 1616, std::uint16_t preview_h = 1080,
         int preview_own = 0, bool sub_jpeg = false) {
  Buffer b{big_endian, {}};
  b.text(0, big_endian ? "MM" : "II");
  b.u16(2, 42);
  b.u32(4, 8);
  const auto preview = jpeg(preview_w, preview_h, preview_own, 0xc0, 3000);
  const auto thumbnail = jpeg(160, 120);
  std::vector<Field> ifd0 = {{0x00fe, 4, 1, 1}, {0x0103, 3, 1, 6}};
  if (orientation) ifd0.push_back({0x0112, 3, 1, std::uint32_t(orientation)});
  ifd0.push_back({0x014a, 4, 1, 400});
  ifd0.push_back({0x0201, 4, 1, 4096});
  ifd0.push_back({0x0202, 4, 1, std::uint32_t(preview.size())});
  ifd(b, 8, ifd0, 600);
  std::vector<Field> sub = {{0x00fe, 4, 1, 0}, {0x0100, 4, 1, 6048}, {0x0101, 4, 1, 4024}, {0x0103, 3, 1, 32767},
                            {0x0111, 4, 1, 16384}, {0x0117, 4, 1, 1024}};
  if (sub_jpeg) sub.push_back({0x014a, 4, 1, 800});
  ifd(b, 400, sub);
  ifd(b, 600, {{0x00fe, 4, 1, 1}, {0x0201, 4, 1, 1024}, {0x0202, 4, 1, std::uint32_t(thumbnail.size())}});
  b.raw(1024, thumbnail);
  b.raw(4096, preview);
  b.reserve_to(16384 + 1024);
  if (sub_jpeg) {
    const auto full = jpeg(6048, 4024, 0, 0xc0, 9000);
    ifd(b, 800, {{0x00fe, 4, 1, 1}, {0x0201, 4, 1, 17408}, {0x0202, 4, 1, std::uint32_t(full.size())}});
    b.raw(17408, full);
  }
  return b.bytes;
}

// ISO-BMFF box with a 4-char type around `content`.
Blob box(const char* type, const Blob& content) {
  Buffer b{true, {}};
  b.be32(0, std::uint32_t(8 + content.size()));
  b.text(4, type);
  b.raw(8, content);
  return b.bytes;
}
Blob join(std::initializer_list<Blob> parts) {
  Blob out;
  for (const auto& p : parts) out.insert(out.end(), p.begin(), p.end());
  return out;
}

// A CR3-shaped file: ftyp, moov {Canon uuid {CMT1 (orientation, size), THMB},
// trak {mdia {minf {stbl {stsz, co64}}}}}, preview uuid {PRVW}, then mdat with
// the full-size JPEG track sample.
Blob cr3(int orientation) {
  Buffer cmt{false, {}};
  cmt.text(0, "II");
  cmt.u16(2, 42);
  cmt.u32(4, 8);
  std::vector<Field> fields = {{0x0100, 3, 1, 6000}, {0x0101, 3, 1, 4000}};
  if (orientation) fields.push_back({0x0112, 3, 1, std::uint32_t(orientation)});
  ifd(cmt, 8, fields);
  const auto thumb_jpeg = jpeg(160, 120);
  Blob thmb(16, 0);
  thmb.insert(thmb.end(), thumb_jpeg.begin(), thumb_jpeg.end());
  const Blob canon_uuid{0x85, 0xc0, 0xb6, 0x87, 0x82, 0x0f, 0x11, 0xe0, 0x81, 0x11, 0xf4, 0xce, 0x46, 0x2b, 0x6a, 0x48};
  const Blob preview_uuid{0xea, 0xf4, 0x2b, 0x5e, 0x1c, 0x98, 0x4b, 0x88, 0xb9, 0xfb, 0xb7, 0xdc, 0x40, 0x6e, 0x4d, 0x16};
  const auto prvw_jpeg = jpeg(1620, 1080, 0, 0xc0, 2000);
  Blob prvw(16, 0);
  prvw.insert(prvw.end(), prvw_jpeg.begin(), prvw_jpeg.end());
  const auto full = jpeg(6000, 4000, 0, 0xc0, 6000);

  const auto build = [&](std::uint64_t full_offset) {
    Buffer stsz{true, {}};
    stsz.be32(0, 0);
    stsz.be32(4, std::uint32_t(full.size()));
    stsz.be32(8, 1);
    Buffer co64{true, {}};
    co64.be32(0, 0);
    co64.be32(4, 1);
    co64.be32(8, std::uint32_t(full_offset >> 32));
    co64.be32(12, std::uint32_t(full_offset));
    const auto trak = box("trak", box("mdia", box("minf", box("stbl", join({box("stsz", stsz.bytes), box("co64", co64.bytes)})))));
    const auto moov = box("moov", join({box("uuid", join({canon_uuid, box("CMT1", cmt.bytes), box("THMB", thmb)})), trak}));
    Blob ftyp_content{'c', 'r', 'x', ' ', 0, 0, 0, 1};
    Blob preview_content = preview_uuid;
    preview_content.insert(preview_content.end(), 8, 0);
    const auto preview_box = box("PRVW", prvw);
    preview_content.insert(preview_content.end(), preview_box.begin(), preview_box.end());
    return join({box("ftyp", ftyp_content), moov, box("uuid", preview_content)});
  };
  const auto head = build(0);
  auto file = build(head.size() + 8);
  const auto mdat = box("mdat", full);
  file.insert(file.end(), mdat.begin(), mdat.end());
  return file;
}

RawContainer inspect(const Blob& bytes, std::size_t head = SIZE_MAX) {
  const auto size = std::min(head, bytes.size());
  return inspect_raw(bytes.data(), size, bytes.size());
}

void survive_hostile(const Blob& file, const std::string& name) {
  for (std::size_t cut = 0; cut <= file.size(); cut += (file.size() > 4096 && cut > 2048 ? 97 : 1)) {
    auto r = inspect_raw(file.data(), cut, file.size());
    (void)rank_previews(r.previews);
    for (const auto& p : r.previews) (void)preview_orientation(r, p.jpeg);
  }
  std::mt19937 random(0xC011u);
  for (int round = 0; round < 2000; ++round) {
    auto copy = file;
    const int flips = 1 + int(random() % 8);
    for (int i = 0; i < flips; ++i) copy[random() % copy.size()] = std::uint8_t(random());
    auto r = inspect_raw(copy.data(), copy.size(), copy.size() + (random() % 3 == 0 ? random() : 0));
    for (auto index : rank_previews(r.previews)) {
      const auto& p = r.previews[index];
      check(p.offset + p.length <= copy.size() + (1ull << 32), name + ": ranked previews stay in the file.");
    }
  }
  check(true, name + " survives truncation and corruption.");
}

std::size_t best(const RawContainer& r) {
  const auto order = rank_previews(r.previews);
  if (order.empty()) throw std::runtime_error("no preview ranked");
  return order.front();
}

} // namespace

int main() {
  try {
    // ---- Orientation in the container, all eight, both byte orders ----------
    for (bool big : {false, true}) {
      for (int o = 1; o <= 8; ++o) {
        const auto file = arw(big, o);
        const auto r = inspect(file);
        const std::string label = std::string(big ? "MM" : "II") + " orientation " + std::to_string(o);
        check(r.kind == ContainerKind::tiff, label + ": a TIFF RAW.");
        check(r.orientation == o, label + ": IFD0 Orientation is read.");
        check(r.sensor_width == 6048 && r.sensor_height == 4024, label + ": the sensor size comes from the raw SubIFD.");
        const auto& preview = r.previews[best(r)];
        check(preview.jpeg.width == 1616 && preview.jpeg.height == 1080 && preview.offset == 4096,
              label + ": the 1616px PreviewImage is chosen over the 160px thumbnail.");
        check(preview.jpeg.orientation == 0, label + ": the preview carries no orientation of its own.");
        check(preview_orientation(r, preview.jpeg) == o, label + ": the container's orientation applies to the preview.");
      }
      const auto untagged = inspect(arw(big, 0));
      check(untagged.orientation == 0, "No Orientation tag reads as absent, not as 1.");
      check(preview_orientation(untagged, untagged.previews[best(untagged)].jpeg) == 1, "Nothing said means upright.");
    }
    for (int o = 1; o <= 8; ++o) {
      const auto file = cr3(o);
      const auto r = inspect(file);
      check(r.kind == ContainerKind::cr3 && r.orientation == o, "CR3 CMT1 orientation " + std::to_string(o) + " is read.");
      check(r.sensor_width == 6000 && r.sensor_height == 4000, "CR3 sensor size comes from CMT1.");
      const auto& preview = r.previews[best(r)];
      check(preview.source == PreviewSource::cr3_track && preview.jpeg.width == 6000,
            "CR3: the full-size track JPEG beats PRVW and THMB.");
      check(preview_orientation(r, preview.jpeg) == o, "CR3 previews take CMT1's orientation.");
    }
    {
      const auto r = inspect(cr3(6));
      int prvw = 0, thmb = 0;
      for (const auto& p : r.previews) {
        if (p.source == PreviewSource::cr3_preview && p.jpeg.width == 1620) ++prvw;
        if (p.source == PreviewSource::cr3_thumbnail && p.jpeg.width == 160) ++thmb;
      }
      check(prvw == 1 && thmb == 1, "CR3 PRVW and THMB are both found.");
      check(rank_previews(r.previews).size() == 2, "The CR3 thumbnail is too small to judge a frame by.");
      check(inspect(cr3(0)).orientation == 0, "A CR3 without an orientation says nothing.");
      survive_hostile(cr3(6), "cr3");
    }

    // ---- Precedence ----------------------------------------------------------
    {
      // A preview with its own tag inside a container that has one: the
      // container wins, and the two are never applied together.
      const auto r = inspect(arw(false, 6, 1616, 1080, 8));
      const auto& preview = r.previews[best(r)];
      check(preview.jpeg.orientation == 8, "The preview's own EXIF orientation is read.");
      check(preview_orientation(r, preview.jpeg) == 6, "The container's orientation wins over the preview's.");
      // No container orientation: the preview's own tag.
      const auto silent = inspect(arw(false, 0, 1616, 1080, 3));
      check(preview_orientation(silent, silent.previews[best(silent)].jpeg) == 3,
            "A silent container defers to the preview's own tag.");
      // A preview the camera already turned (portrait pixels from a landscape
      // sensor) is not turned again.
      const auto turned = inspect(arw(false, 6, 1080, 1616, 0));
      check(preview_orientation(turned, turned.previews[best(turned)].jpeg) == 1,
            "An already-turned preview is never rotated a second time.");
      const auto turned_tagged = inspect(arw(false, 8, 1080, 1616, 1));
      check(preview_orientation(turned_tagged, turned_tagged.previews[best(turned_tagged)].jpeg) == 1,
            "An already-turned preview keeps its own tag.");
      // A half turn changes no shape, so there is nothing to guard.
      const auto half = inspect(arw(false, 3, 1080, 1616, 0));
      check(preview_orientation(half, half.previews[best(half)].jpeg) == 3, "Orientation 3 applies whatever the shape.");
      // Unknown sensor size: no guard, the container wins.
      RawContainer bare;
      bare.orientation = 6;
      JpegInfo portrait;
      portrait.width = 1080;
      portrait.height = 1616;
      check(preview_orientation(bare, portrait) == 6, "Without a sensor size the container's orientation stands.");
      JpegInfo tagged;
      tagged.orientation = 5;
      check(preview_orientation(RawContainer{}, tagged) == 5, "No container at all: the JPEG's own tag.");
      check(preview_orientation(RawContainer{}, JpegInfo{}) == 1, "Nothing anywhere: upright.");
    }

    // ---- Preview selection ---------------------------------------------------
    {
      const auto r = inspect(arw(true, 6, 1616, 1080, 0, true));
      const auto& chosen = r.previews[best(r)];
      check(chosen.source == PreviewSource::sub_ifd && chosen.jpeg.width == 6048,
            "A full-size JpgFromRaw in a SubIFD beats the IFD0 preview.");
      check(preview_orientation(r, chosen.jpeg) == 6, "It is turned by the container too.");
      survive_hostile(arw(true, 6, 1616, 1080, 0, true), "nef-like");
      survive_hostile(arw(false, 8), "arw");

      // Only the head of the file: the full-size JPEG's header lies past it.
      const auto head = inspect(arw(true, 6, 1616, 1080, 0, true), 17408 + 4);
      bool undescribed = false;
      for (const auto& p : head.previews)
        if (p.offset == 17408) undescribed = !p.described;
      check(undescribed, "A preview whose header is past the head is listed, undescribed.");
      check(head.previews[best(head)].jpeg.width == 1616, "Undescribed previews are not ranked until described.");
      // The IFD pointing past the head marks the inspection truncated.
      const auto cut = inspect(arw(false, 6, 1616, 1080, 0, true), 300);
      check(cut.truncated, "An IFD past the head marks the container truncated.");
    }
    {
      // A CR2/DNG-style lossless strip (SOF3) is sensor data, never a preview,
      // however large it is.
      Buffer b{false, {}};
      b.text(0, "II");
      b.u16(2, 42);
      b.u32(4, 8);
      const auto lossless = jpeg(6000, 4000, 0, 0xc3, 20000);
      const auto preview = jpeg(1920, 1280, 0, 0xc0, 500);
      const auto progressive = jpeg(1920, 1280, 0, 0xc2, 900);
      ifd(b, 8, {{0x0103, 3, 1, 6}, {0x0111, 4, 1, 1024}, {0x0117, 4, 1, std::uint32_t(preview.size())}}, 200);
      ifd(b, 200, {{0x0201, 4, 1, 4096}, {0x0202, 4, 1, std::uint32_t(progressive.size())}}, 300);
      ifd(b, 300, {{0x00fe, 4, 1, 0}, {0x0100, 4, 1, 6000}, {0x0101, 4, 1, 4000}, {0x0103, 3, 1, 7},
                   {0x0111, 4, 1, 8192}, {0x0117, 4, 1, std::uint32_t(lossless.size())}});
      b.raw(1024, preview);
      b.raw(4096, progressive);
      b.raw(8192, lossless);
      const auto r = inspect(b.bytes);
      check(r.previews.size() == 3, "All three JPEG-shaped streams are listed.");
      const auto order = rank_previews(r.previews);
      check(order.size() == 2, "The lossless sensor stream is not a candidate.");
      check(r.previews[order[0]].jpeg.process == 2 && r.previews[order[1]].jpeg.process == 0,
            "Equal pixels: the one with more bytes ranks first.");
      survive_hostile(b.bytes, "lossless");
    }
    {
      // Fujifilm RAF: the container says nothing; the preview's EXIF does.
      Buffer b{true, {}};
      b.text(0, "FUJIFILMCCD-RAW 0201FF383501");
      const auto preview = jpeg(1920, 1280, 6, 0xc0, 700);
      b.be32(84, 160);
      b.be32(88, std::uint32_t(preview.size()));
      b.raw(160, preview);
      const auto r = inspect(b.bytes);
      check(r.kind == ContainerKind::raf && r.orientation == 0, "A RAF container has no orientation of its own.");
      check(preview_orientation(r, r.previews[best(r)].jpeg) == 6, "RAF previews use their own EXIF orientation.");
      survive_hostile(b.bytes, "raf");
    }
    {
      // A TIFF whose IFDs name nothing: complete JPEGs are found by walking the
      // bytes, and a JPEG nested in another's APP1 does not cut it short.
      Buffer b{false, {}};
      b.text(0, "II");
      b.u16(2, 42);
      b.u32(4, 8);
      ifd(b, 8, {{0x0100, 4, 1, 10}});
      const auto inner = jpeg(160, 120, 0, 0xc0, 8);
      auto outer = jpeg(2000, 1333, 0, 0xc0, 4000);
      Blob segment{0xff, 0xe1, std::uint8_t((inner.size() + 2) >> 8), std::uint8_t(inner.size() + 2)};
      segment.insert(segment.end(), inner.begin(), inner.end());
      outer.insert(outer.begin() + 2, segment.begin(), segment.end());
      b.raw(512, jpeg(160, 120));
      b.raw(2048, outer);
      b.reserve_to(2048 + outer.size() + 512);
      const auto r = inspect(b.bytes);
      const auto& found = r.previews[best(r)];
      check(found.source == PreviewSource::scan && found.offset == 2048 && found.length == outer.size(),
            "The scan measures a preview to its true end past a nested thumbnail.");
    }
    {
      // Truncated and unrecognized inputs.
      check(inspect(Blob(8, 0)).previews.empty(), "Too short is nothing.");
      check(inspect(Blob(4096, 0)).kind == ContainerKind::unknown, "Zeros are not a container.");
      check(!describe_jpeg(nullptr, 0).valid && describe_jpeg(nullptr, 0).incomplete, "No bytes is an incomplete answer.");
      const auto full = jpeg(640, 480, 6);
      for (std::size_t cut = 0; cut < 40; ++cut) {
        const auto info = describe_jpeg(full.data(), cut);
        check(!info.valid && (info.incomplete || cut >= 2), "A cut header never invents a size.");
      }
      const auto whole = describe_jpeg(full.data(), full.size());
      check(whole.valid && whole.width == 640 && whole.height == 480 && whole.orientation == 6 && whole.process == 0,
            "A complete header reads size, process and orientation.");
    }

    // ---- Retagging a preview so a browser turns it --------------------------
    {
      const auto apply = [](const Blob& original, int orientation, Blob& out) {
        Blob prefix;
        std::size_t consumed = 0;
        if (!retag_orientation(original.data(), original.size(), orientation, prefix, consumed)) return false;
        out = prefix;
        out.insert(out.end(), original.begin() + std::ptrdiff_t(consumed), original.end());
        return true;
      };
      const auto bare = jpeg(1616, 1080);
      for (int o = 1; o <= 8; ++o) {
        Blob out;
        check(apply(bare, o, out), "A bare preview can be retagged.");
        const auto info = describe_jpeg(out.data(), out.size());
        check(info.valid && info.width == 1616 && info.height == 1080, "Retagging keeps the frame header.");
        check(info.orientation == (o == 1 ? 0 : o), "Retagged orientation " + std::to_string(o) + " reads back.");
        check(std::equal(bare.end() - 64, bare.end(), out.end() - 64), "The picture data is untouched.");
      }
      {
        Blob prefix;
        std::size_t consumed = 99;
        check(retag_orientation(bare.data(), bare.size(), 1, prefix, consumed) && prefix.empty() && consumed == 0,
              "Upright needs no change to an untagged JPEG.");
      }
      {
        const auto tagged = jpeg(800, 600, 8);
        Blob out;
        check(apply(tagged, 6, out) && out.size() == tagged.size(), "An existing tag is patched in place.");
        check(describe_jpeg(out.data(), out.size()).orientation == 6, "The patched tag reads back.");
        Blob same;
        Blob prefix;
        std::size_t consumed = 1;
        check(retag_orientation(tagged.data(), tagged.size(), 8, prefix, consumed) && consumed == 0,
              "A tag that already says so is left alone.");
        check(apply(tagged, 1, same) && describe_jpeg(same.data(), same.size()).orientation == 1,
              "A preview's own quarter turn can be overridden to upright.");
      }
      {
        // JFIF stays first; the orientation segment follows it.
        auto jfif = jpeg(640, 480);
        const Blob app0{0xff, 0xe0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0, 1, 1, 0, 0, 1, 0, 1, 0, 0};
        jfif.insert(jfif.begin() + 2, app0.begin(), app0.end());
        Blob out;
        check(apply(jfif, 6, out), "A JFIF preview can be retagged.");
        check(out[2] == 0xff && out[3] == 0xe0 && out[20] == 0xff && out[21] == 0xe1, "APP0 stays first, EXIF follows.");
        check(describe_jpeg(out.data(), out.size()).orientation == 6, "The JFIF preview reads back turned.");
        // An EXIF segment without orientation: ours goes ahead of it.
        auto exif = jpeg(640, 480);
        const Blob no_orientation{0xff, 0xe1, 0x00, 0x22, 'E', 'x', 'i', 'f', 0, 0, 'I', 'I', 42, 0, 8, 0, 0, 0,
                                  1, 0, 0x0f, 0x01, 2, 0, 1, 0, 0, 0, 'x', 0, 0, 0, 0, 0, 0, 0};
        exif.insert(exif.begin() + 2, no_orientation.begin(), no_orientation.end());
        Blob ahead;
        check(apply(exif, 3, ahead) && describe_jpeg(ahead.data(), ahead.size()).orientation == 3,
              "A new segment ahead of an orientation-less EXIF is the one read.");
      }
      Blob prefix;
      std::size_t consumed = 0;
      check(!retag_orientation(nullptr, 0, 6, prefix, consumed), "No bytes is not a JPEG.");
      const Blob not_jpeg{1, 2, 3, 4, 5, 6};
      check(!retag_orientation(not_jpeg.data(), not_jpeg.size(), 6, prefix, consumed), "Random bytes are not a JPEG.");
      const auto full = jpeg(640, 480, 6);
      for (std::size_t cut = 0; cut <= full.size(); ++cut) (void)retag_orientation(full.data(), cut, 3, prefix, consumed);
      check(true, "Retagging survives every truncation.");
    }
  } catch (const std::exception& failure) {
    std::cerr << "FAIL raw-preview: " << failure.what() << " (after " << checks << " checks)\n";
    return 1;
  }
  std::cout << "PASS raw-preview: " << checks << " checks\n";
  return 0;
}
