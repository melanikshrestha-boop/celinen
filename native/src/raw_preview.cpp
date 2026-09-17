#include "lenslabs/raw_preview.hpp"
#include "lenslabs/exif.hpp"
#include <algorithm>
#include <array>
#include <cstring>

// RAW container structure, read defensively: every offset comes from a file a
// stranger's camera (or a hostile page) wrote, and a RAW is usually handed in
// as just its first megabytes, so anything pointing outside is simply absent.
// Layouts follow the TIFF 6.0 / TIFF-EP specs, ExifTool's tag docs and the
// public CR3 notes (github.com/lclevy/canon_cr3): byte formats only.
namespace lenslabs {
namespace {

constexpr std::uint16_t tag_subfile = 0x00fe, tag_width = 0x0100, tag_height = 0x0101,
                        tag_compression = 0x0103, tag_strip_offsets = 0x0111,
                        tag_orientation = 0x0112, tag_strip_bytes = 0x0117, tag_sub_ifds = 0x014a,
                        tag_jpeg_offset = 0x0201, tag_jpeg_bytes = 0x0202, tag_exif_ifd = 0x8769,
                        tag_pixel_x = 0xa002, tag_pixel_y = 0xa003, tag_rw2_jpeg = 0x002e;

// A TIFF structure inside the bytes given. `base` is where its header sits;
// offsets inside it are relative to that header.
struct Tiff {
  const std::uint8_t* bytes = nullptr;
  std::size_t size = 0; // bytes available from `bytes`
  std::uint64_t base = 0;
  bool big_endian = false;

  bool has(std::uint64_t at, std::uint64_t count) const noexcept {
    return base <= size && at <= size - base && count <= size - base - at;
  }
  std::uint16_t u16(std::uint64_t at) const noexcept {
    if (!has(at, 2)) return 0;
    const auto* p = bytes + base + at;
    return big_endian ? std::uint16_t(p[0] << 8 | p[1]) : std::uint16_t(p[1] << 8 | p[0]);
  }
  std::uint32_t u32(std::uint64_t at) const noexcept {
    if (!has(at, 4)) return 0;
    const auto* p = bytes + base + at;
    return big_endian
               ? std::uint32_t(p[0]) << 24 | std::uint32_t(p[1]) << 16 | std::uint32_t(p[2]) << 8 | p[3]
               : std::uint32_t(p[3]) << 24 | std::uint32_t(p[2]) << 16 | std::uint32_t(p[1]) << 8 | p[0];
  }
};

// The handful of tags a preview search needs from one IFD.
struct Ifd {
  std::uint32_t width = 0, height = 0, compression = 0;
  int subfile = -1; // NewSubfileType; -1 when absent
  int orientation = 0;
  std::uint64_t strip_offset = 0, strip_bytes = 0;
  std::uint32_t strips = 0;
  std::uint64_t jpeg_offset = 0, jpeg_bytes = 0;
  std::uint64_t rw2_offset = 0, rw2_bytes = 0;
  std::uint32_t pixel_x = 0, pixel_y = 0;
  std::uint64_t exif_ifd = 0, next = 0;
  std::vector<std::uint64_t> sub_ifds;
};

// A SHORT or LONG scalar, which several tags may be written as.
std::uint32_t scalar(const Tiff& t, std::uint64_t entry, std::uint16_t type) noexcept {
  if (type == 3) return t.u16(entry + 8);
  if (type == 4 || type == 13) return t.u32(entry + 8);
  return 0;
}

// Reads the IFD at `offset`. False when its entry table is not inside the bytes.
bool read_ifd(const Tiff& t, std::uint64_t offset, Ifd& out) noexcept {
  if (!t.has(offset, 2)) return false;
  const std::uint32_t count = std::min<std::uint32_t>(t.u16(offset), 1024);
  if (!t.has(offset + 2, std::uint64_t(count) * 12 + 4)) return false;
  for (std::uint32_t i = 0; i < count; ++i) {
    const std::uint64_t entry = offset + 2 + std::uint64_t(i) * 12;
    const auto tag = t.u16(entry), type = t.u16(entry + 2);
    const auto n = t.u32(entry + 4);
    switch (tag) {
      case tag_subfile: out.subfile = int(scalar(t, entry, type)); break;
      case tag_width: out.width = scalar(t, entry, type); break;
      case tag_height: out.height = scalar(t, entry, type); break;
      case tag_compression: out.compression = scalar(t, entry, type); break;
      case tag_orientation:
        if (type == 3) {
          const auto v = t.u16(entry + 8);
          if (v >= 1 && v <= 8) out.orientation = v;
        }
        break;
      case tag_strip_offsets:
        out.strips = n;
        if (n == 1) out.strip_offset = scalar(t, entry, type);
        break;
      case tag_strip_bytes:
        if (n == 1) out.strip_bytes = scalar(t, entry, type);
        break;
      case tag_jpeg_offset: out.jpeg_offset = scalar(t, entry, type); break;
      case tag_jpeg_bytes: out.jpeg_bytes = scalar(t, entry, type); break;
      case tag_exif_ifd: out.exif_ifd = scalar(t, entry, type); break;
      case tag_pixel_x: out.pixel_x = scalar(t, entry, type); break;
      case tag_pixel_y: out.pixel_y = scalar(t, entry, type); break;
      case tag_rw2_jpeg:
        // Panasonic writes the JPEG itself as the tag's UNDEFINED value.
        if (type == 7 && n > 4) {
          out.rw2_offset = t.u32(entry + 8);
          out.rw2_bytes = n;
        }
        break;
      case tag_sub_ifds:
        if ((type == 4 || type == 13) && n >= 1) {
          const std::uint32_t kept = std::min<std::uint32_t>(n, 16);
          if (n == 1) out.sub_ifds.push_back(t.u32(entry + 8));
          else
            for (std::uint32_t k = 0; k < kept; ++k) {
              const std::uint64_t at = std::uint64_t(t.u32(entry + 8)) + std::uint64_t(k) * 4;
              if (t.has(at, 4)) out.sub_ifds.push_back(t.u32(at));
            }
        }
        break;
      default: break;
    }
  }
  out.next = t.u32(offset + 2 + std::uint64_t(count) * 12);
  return true;
}

bool jpeg_frame_header(std::uint8_t marker) noexcept {
  // SOF0-SOF15, less DHT (C4), JPG (C8) and DAC (CC), which share the range.
  return marker >= 0xc0 && marker <= 0xcf && marker != 0xc4 && marker != 0xc8 && marker != 0xcc;
}

// Where the JPEG starting at `start` really ends, or 0 when it is not one.
// Walks segments rather than searching for FFD9: a preview carries its own EXIF
// thumbnail, whose end marker would otherwise cut it short.
std::size_t jpeg_end(const std::uint8_t* b, std::size_t size, std::size_t start) noexcept {
  std::size_t at = start + 2;
  while (at + 2 <= size) {
    if (b[at] != 0xff) return 0;
    const auto marker = b[at + 1];
    if (marker == 0xff) {
      at += 1;
      continue;
    }
    if (marker == 0xd9) return at + 2;
    if (marker >= 0xd0 && marker <= 0xd7) {
      at += 2;
      continue;
    }
    if (at + 4 > size) return 0;
    const std::size_t length = std::size_t(b[at + 2]) << 8 | b[at + 3];
    if (length < 2) return 0;
    at += 2 + length;
    if (marker != 0xda) continue;
    // Entropy-coded data runs to the next marker that is not a stuffed zero,
    // a restart marker or fill.
    while (at + 1 < size) {
      if (b[at] == 0xff) {
        const auto next = b[at + 1];
        if (next != 0x00 && !(next >= 0xd0 && next <= 0xd7) && next != 0xff) break;
      }
      at += 1;
    }
  }
  return 0;
}

struct Builder {
  const std::uint8_t* bytes;
  std::size_t size;
  std::uint64_t file_size;
  RawContainer& out;

  void add(std::uint64_t offset, std::uint64_t length, PreviewSource source) {
    if (!offset || length < 4 || offset > file_size || length > file_size - offset) return;
    if (out.previews.size() >= 64) return;
    for (const auto& existing : out.previews)
      if (existing.offset == offset) return;
    PreviewCandidate candidate;
    candidate.offset = offset;
    candidate.length = length;
    candidate.source = source;
    if (offset < size) {
      const std::size_t available = std::size_t(std::min<std::uint64_t>(length, size - offset));
      candidate.jpeg = describe_jpeg(bytes + offset, available);
      // A header cut off by the end of the head is not an answer yet; the
      // whole JPEG being here and still incomplete is.
      candidate.described = !candidate.jpeg.incomplete || available == length;
    }
    out.previews.push_back(candidate);
  }
};

void consider_sensor(RawContainer& out, std::uint32_t width, std::uint32_t height) noexcept {
  if (!width || !height) return;
  if (std::uint64_t(width) * height > std::uint64_t(out.sensor_width) * out.sensor_height) {
    out.sensor_width = width;
    out.sensor_height = height;
  }
}

// TIFF-based RAWs: ARW, NEF, CR2, DNG, PEF, ORF, RW2 and friends. The IFD0
// chain, each IFD's SubIFDs (two levels), and the EXIF IFD for pixel size.
void inspect_tiff(Builder& b) noexcept {
  Tiff t{b.bytes, b.size, 0, b.bytes[0] == 'M'};
  RawContainer& out = b.out;
  std::array<std::uint64_t, 64> seen{};
  std::size_t seen_count = 0;
  std::uint32_t exif_x = 0, exif_y = 0;
  bool first = true;

  struct Pending {
    std::uint64_t offset;
    int depth;
  };
  std::array<Pending, 96> stack{};
  std::size_t top = 0;
  // IFD0 chain is walked in order; SubIFDs are pushed as they are found.
  std::uint64_t chain = t.u32(4);
  int chain_links = 0;
  while ((chain || top) && seen_count < seen.size()) {
    Pending current{};
    bool from_chain = false;
    if (top) {
      current = stack[--top];
    } else {
      if (chain_links++ >= 8) break;
      current = {chain, 0};
      from_chain = true;
      chain = 0;
    }
    if (!current.offset) continue;
    if (std::find(seen.begin(), seen.begin() + std::ptrdiff_t(seen_count), current.offset) !=
        seen.begin() + std::ptrdiff_t(seen_count))
      continue; // a loop
    seen[seen_count++] = current.offset;
    Ifd ifd;
    if (!read_ifd(t, current.offset, ifd)) {
      if (current.offset < b.file_size) out.truncated = true;
      continue;
    }
    if (first) {
      out.orientation = ifd.orientation;
      first = false;
    }
    if (from_chain) chain = ifd.next;
    const auto source = current.depth ? PreviewSource::sub_ifd : PreviewSource::ifd;
    if (ifd.jpeg_offset && ifd.jpeg_bytes) b.add(ifd.jpeg_offset, ifd.jpeg_bytes, source);
    // A single-strip JPEG (compression 6 old-style, 7 new-style). Lossless
    // sensor data uses 7 too; describe_jpeg tells the two apart.
    if ((ifd.compression == 6 || ifd.compression == 7) && ifd.strips == 1 && ifd.strip_bytes)
      b.add(ifd.strip_offset, ifd.strip_bytes, source);
    if (ifd.rw2_offset && ifd.rw2_bytes) b.add(ifd.rw2_offset, ifd.rw2_bytes, PreviewSource::rw2);
    if (ifd.subfile == 0) consider_sensor(out, ifd.width, ifd.height);
    if (ifd.exif_ifd && current.depth == 0) {
      Ifd exif;
      if (read_ifd(t, ifd.exif_ifd, exif)) {
        if (!exif_x) {
          exif_x = exif.pixel_x;
          exif_y = exif.pixel_y;
        }
      } else if (ifd.exif_ifd < b.file_size) {
        out.truncated = true;
      }
    }
    if (current.depth < 2)
      for (auto sub : ifd.sub_ifds)
        if (top < stack.size()) stack[top++] = {sub, current.depth + 1};
  }
  if (!out.sensor_width) consider_sensor(out, exif_x, exif_y);
}

std::uint32_t big32(const std::uint8_t* p) noexcept {
  return std::uint32_t(p[0]) << 24 | std::uint32_t(p[1]) << 16 | std::uint32_t(p[2]) << 8 | p[3];
}

struct Box {
  std::uint64_t start = 0, content = 0, end = 0;
  char type[4] = {};
};

// Iterates the ISO-BMFF boxes in [begin, end). A box running past the bytes
// given still reports its bounds (end may exceed `size`); the caller reads only
// what is present.
template <class Visit>
void boxes(const Builder& b, std::uint64_t begin, std::uint64_t end, int& budget, Visit&& visit) {
  std::uint64_t at = begin;
  while (at + 8 <= end && budget-- > 0) {
    if (at + 8 > b.size) {
      b.out.truncated = true;
      return;
    }
    std::uint64_t length = big32(b.bytes + at);
    std::uint64_t header = 8;
    if (length == 1) {
      if (at + 16 > b.size) {
        b.out.truncated = true;
        return;
      }
      length = std::uint64_t(big32(b.bytes + at + 8)) << 32 | big32(b.bytes + at + 12);
      header = 16;
    } else if (length == 0) {
      length = end - at;
    }
    if (length < header || length > end - at) return;
    Box box;
    box.start = at;
    box.content = at + header;
    box.end = at + length;
    std::memcpy(box.type, b.bytes + at + 4, 4);
    visit(box);
    at = box.end;
  }
}

bool is(const Box& box, const char* type) noexcept { return std::memcmp(box.type, type, 4) == 0; }

// The first JPEG start within `window` bytes of `from`, or 0.
std::uint64_t soi_near(const Builder& b, std::uint64_t from, std::uint64_t limit, std::uint64_t window) {
  const std::uint64_t stop = std::min({from + window, limit, std::uint64_t(b.size)});
  for (std::uint64_t at = from; at + 3 <= stop; ++at)
    if (b.bytes[at] == 0xff && b.bytes[at + 1] == 0xd8 && b.bytes[at + 2] == 0xff) return at;
  return 0;
}

// A JPEG embedded in a box after a small header: from its SOI to the box's end.
void add_boxed_jpeg(Builder& b, const Box& box, PreviewSource source) {
  if (const auto soi = soi_near(b, box.content, box.end, 64)) b.add(soi, box.end - soi, source);
  else if (box.content + 64 > b.size) b.out.truncated = true;
}

// A CMT1/CMT2 TIFF: orientation and sizes, with offsets relative to the box.
void read_cmt(Builder& b, const Box& box, bool exif) {
  if (box.content + 8 > b.size) {
    b.out.truncated = true;
    return;
  }
  const auto* p = b.bytes + box.content;
  if (!((p[0] == 'I' && p[1] == 'I') || (p[0] == 'M' && p[1] == 'M'))) return;
  const std::size_t available = std::size_t(std::min<std::uint64_t>(box.end, b.size));
  Tiff t{b.bytes, available, box.content, p[0] == 'M'};
  Ifd ifd;
  if (!read_ifd(t, t.u32(4), ifd)) return;
  if (exif) {
    if (!b.out.sensor_width) consider_sensor(b.out, ifd.pixel_x, ifd.pixel_y);
  } else {
    b.out.orientation = ifd.orientation;
    consider_sensor(b.out, ifd.width, ifd.height);
  }
}

// Canon CR3 (ISO-BMFF). moov holds Canon's uuid (CMT1..CMT4, THMB) and one
// trak per stream: track 1's sample is the full-size JPEG, the others are
// sensor data, which describe_jpeg rejects. A top-level uuid holds PRVW.
void inspect_cr3(Builder& b) {
  static const std::uint8_t canon_uuid[16] = {0x85, 0xc0, 0xb6, 0x87, 0x82, 0x0f, 0x11, 0xe0,
                                              0x81, 0x11, 0xf4, 0xce, 0x46, 0x2b, 0x6a, 0x48};
  static const std::uint8_t preview_uuid[16] = {0xea, 0xf4, 0x2b, 0x5e, 0x1c, 0x98, 0x4b, 0x88,
                                                0xb9, 0xfb, 0xb7, 0xdc, 0x40, 0x6e, 0x4d, 0x16};
  int budget = 1024;
  const auto uuid_is = [&](const Box& box, const std::uint8_t* id) {
    return is(box, "uuid") && box.content + 16 <= b.size && box.content + 16 <= box.end &&
           std::memcmp(b.bytes + box.content, id, 16) == 0;
  };
  const std::uint64_t file_end = std::max<std::uint64_t>(b.file_size, b.size);
  boxes(b, 0, file_end, budget, [&](const Box& top) {
    if (is(top, "moov")) {
      int tracks = 0;
      boxes(b, top.content, top.end, budget, [&](const Box& child) {
        if (uuid_is(child, canon_uuid)) {
          boxes(b, child.content + 16, child.end, budget, [&](const Box& meta) {
            if (is(meta, "CMT1")) read_cmt(b, meta, false);
            else if (is(meta, "CMT2")) read_cmt(b, meta, true);
            else if (is(meta, "THMB")) add_boxed_jpeg(b, meta, PreviewSource::cr3_thumbnail);
          });
        } else if (is(child, "trak") && tracks++ < 4) {
          std::uint64_t sample_offset = 0, sample_size = 0;
          boxes(b, child.content, child.end, budget, [&](const Box& mdia) {
            if (!is(mdia, "mdia")) return;
            boxes(b, mdia.content, mdia.end, budget, [&](const Box& minf) {
              if (!is(minf, "minf")) return;
              boxes(b, minf.content, minf.end, budget, [&](const Box& stbl) {
                if (!is(stbl, "stbl")) return;
                boxes(b, stbl.content, stbl.end, budget, [&](const Box& table) {
                  const auto* p = b.bytes + table.content;
                  if (is(table, "stsz") && table.content + 12 <= b.size && table.content + 12 <= table.end) {
                    sample_size = big32(p + 4);
                    if (!sample_size && big32(p + 8) >= 1 && table.content + 16 <= b.size &&
                        table.content + 16 <= table.end)
                      sample_size = big32(p + 12);
                  } else if (is(table, "co64") && table.content + 16 <= b.size &&
                             table.content + 16 <= table.end && big32(p + 4) >= 1) {
                    sample_offset = std::uint64_t(big32(p + 8)) << 32 | big32(p + 12);
                  } else if (is(table, "stco") && table.content + 12 <= b.size &&
                             table.content + 12 <= table.end && big32(p + 4) >= 1) {
                    sample_offset = big32(p + 8);
                  }
                });
              });
            });
          });
          if (sample_offset && sample_size) b.add(sample_offset, sample_size, PreviewSource::cr3_track);
        }
      });
    } else if (uuid_is(top, preview_uuid)) {
      // A few header bytes precede the PRVW box; find it by its type rather
      // than trusting a fixed count.
      for (std::uint64_t at = top.content + 16; at + 8 <= std::min<std::uint64_t>(top.content + 64, top.end); ++at) {
        if (at + 8 > b.size) {
          b.out.truncated = true;
          break;
        }
        if (std::memcmp(b.bytes + at + 4, "PRVW", 4) != 0) continue;
        boxes(b, at, top.end, budget, [&](const Box& inner) {
          if (is(inner, "PRVW")) add_boxed_jpeg(b, inner, PreviewSource::cr3_preview);
        });
        break;
      }
    }
  });
}

// Fujifilm RAF: a big-endian header naming the JPEG's offset and length.
void inspect_raf(Builder& b) {
  if (b.size < 92) {
    b.out.truncated = true;
    return;
  }
  b.add(big32(b.bytes + 84), big32(b.bytes + 88), PreviewSource::raf);
}

// When no structure named a preview: complete JPEGs found by walking the bytes.
void scan(Builder& b) {
  for (std::size_t i = 0; i + 3 < b.size && b.out.previews.size() < 64; ++i) {
    if (b.bytes[i] != 0xff || b.bytes[i + 1] != 0xd8 || b.bytes[i + 2] != 0xff) continue;
    const auto end = jpeg_end(b.bytes, b.size, i);
    if (!end) continue;
    b.add(i, end - i, PreviewSource::scan);
    i = end - 1; // everything inside it, its own EXIF thumbnail included, is covered
  }
}

bool portrait(std::uint32_t w, std::uint32_t h) noexcept { return std::uint64_t(h) * 100 > std::uint64_t(w) * 102; }
bool landscape(std::uint32_t w, std::uint32_t h) noexcept { return std::uint64_t(w) * 100 > std::uint64_t(h) * 102; }

} // namespace

JpegInfo describe_jpeg(const std::uint8_t* bytes, std::size_t size) noexcept {
  JpegInfo info;
  if (!bytes || size < 2) {
    info.incomplete = true;
    return info;
  }
  if (bytes[0] != 0xff || bytes[1] != 0xd8) return info;
  std::size_t at = 2;
  while (true) {
    if (at + 4 > size) {
      info.incomplete = true;
      return info;
    }
    if (bytes[at] != 0xff) return info;
    const auto marker = bytes[at + 1];
    if (marker == 0xff) {
      at += 1;
      continue;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker == 0x01) {
      at += 2;
      continue;
    }
    if (marker == 0xd8 || marker == 0xd9 || marker == 0xda) return info; // no frame header
    const std::size_t length = std::size_t(bytes[at + 2]) << 8 | bytes[at + 3];
    if (length < 2) return info;
    if (jpeg_frame_header(marker)) {
      if (at + 9 > size) {
        info.incomplete = true;
        return info;
      }
      info.height = std::uint32_t(bytes[at + 5]) << 8 | bytes[at + 6];
      info.width = std::uint32_t(bytes[at + 7]) << 8 | bytes[at + 8];
      info.process = marker - 0xc0;
      info.valid = info.width > 0 && info.height > 0;
      // Every segment before the frame header is inside the bytes, EXIF included.
      const auto facts = read_exif(bytes, at);
      info.orientation = facts.orientation_tagged ? facts.orientation : 0;
      return info;
    }
    at += 2 + length;
  }
}

bool decodable_process(int process) noexcept { return process >= 0 && process <= 2; }

RawContainer inspect_raw(const std::uint8_t* bytes, std::size_t size, std::uint64_t file_size) noexcept {
  RawContainer out;
  if (!bytes || size < 16) return out;
  file_size = std::max<std::uint64_t>(file_size, size);
  Builder b{bytes, size, file_size, out};
  try {
    const bool ii = bytes[0] == 'I' && bytes[1] == 'I', mm = bytes[0] == 'M' && bytes[1] == 'M';
    const std::uint16_t magic = ii ? std::uint16_t(bytes[2] | bytes[3] << 8) : std::uint16_t(bytes[2] << 8 | bytes[3]);
    // 42 TIFF; 0x4f52 / 0x5352 Olympus ORF ("IIRO", "IIRS"); 0x55 Panasonic RW2.
    if ((ii || mm) && (magic == 42 || magic == 0x4f52 || magic == 0x5352 || magic == 0x55)) {
      out.kind = ContainerKind::tiff;
      inspect_tiff(b);
    } else if (std::memcmp(bytes + 4, "ftypcrx ", 8) == 0) {
      out.kind = ContainerKind::cr3;
      inspect_cr3(b);
    } else if (std::memcmp(bytes, "FUJIFILMCCD-RAW ", 16) == 0) {
      out.kind = ContainerKind::raf;
      inspect_raf(b);
    }
    if (out.previews.empty()) scan(b);
  } catch (...) {
    // Only an allocation can throw here; what was found so far stands.
  }
  return out;
}

std::vector<std::size_t> rank_previews(const std::vector<PreviewCandidate>& previews) noexcept {
  std::vector<std::size_t> order;
  try {
    for (std::size_t i = 0; i < previews.size(); ++i) {
      const auto& p = previews[i];
      if (!p.described || !p.jpeg.valid || !decodable_process(p.jpeg.process)) continue;
      if (std::max(p.jpeg.width, p.jpeg.height) < 320) continue;
      order.push_back(i);
    }
    std::stable_sort(order.begin(), order.end(), [&](std::size_t a, std::size_t b) {
      const auto& x = previews[a];
      const auto& y = previews[b];
      const auto px = std::uint64_t(x.jpeg.width) * x.jpeg.height;
      const auto py = std::uint64_t(y.jpeg.width) * y.jpeg.height;
      if (px != py) return px > py;
      if (x.length != y.length) return x.length > y.length;
      return x.offset < y.offset;
    });
  } catch (...) {
    order.clear();
  }
  return order;
}

int preview_orientation(const RawContainer& container, const JpegInfo& preview) noexcept {
  const int own = preview.orientation >= 1 && preview.orientation <= 8 ? preview.orientation : 1;
  const int said = container.orientation;
  if (said < 1 || said > 8) return own;
  if (said >= 5 && container.sensor_width && container.sensor_height && preview.width && preview.height) {
    const bool turned =
        (landscape(container.sensor_width, container.sensor_height) && portrait(preview.width, preview.height)) ||
        (portrait(container.sensor_width, container.sensor_height) && landscape(preview.width, preview.height));
    if (turned) return own;
  }
  return said;
}

bool retag_orientation(const std::uint8_t* head, std::size_t size, int orientation,
                       std::vector<std::uint8_t>& prefix, std::size_t& consumed) noexcept {
  prefix.clear();
  consumed = 0;
  if (!head || size < 4 || head[0] != 0xff || head[1] != 0xd8) return false;
  if (orientation < 1 || orientation > 8) orientation = 1;
  try {
    std::size_t at = 2, insert_at = 2;
    while (at + 4 <= size) {
      if (head[at] != 0xff) break;
      const auto marker = head[at + 1];
      if (marker == 0xff) {
        at += 1;
        continue;
      }
      if ((marker >= 0xd0 && marker <= 0xd7) || marker == 0x01) {
        at += 2;
        continue;
      }
      if (marker == 0xda || marker == 0xd9 || jpeg_frame_header(marker)) break;
      const std::size_t length = std::size_t(head[at + 2]) << 8 | head[at + 3];
      if (length < 2) break;
      const std::size_t end = at + 2 + length;
      if (end > size) break;
      if (marker == 0xe0 && at == 2) insert_at = end; // JFIF stays first
      if (marker == 0xe1 && length >= 16 && std::memcmp(head + at + 4, "Exif\0\0", 6) == 0) {
        // The first EXIF segment is the one decoders read: patch it or go before it.
        const std::size_t tiff = at + 10;
        const bool big = head[tiff] == 'M' && head[tiff + 1] == 'M';
        const bool little = head[tiff] == 'I' && head[tiff + 1] == 'I';
        if (big || little) {
          Tiff t{head, end, tiff, big};
          const std::uint64_t ifd = t.u32(4);
          if (t.has(ifd, 2)) {
            const std::uint32_t count = std::min<std::uint32_t>(t.u16(ifd), 1024);
            for (std::uint32_t i = 0; i < count; ++i) {
              const std::uint64_t entry = ifd + 2 + std::uint64_t(i) * 12;
              if (!t.has(entry, 12)) break;
              if (t.u16(entry) != tag_orientation || t.u16(entry + 2) != 3) continue;
              if (t.u16(entry + 8) == orientation) return true; // already says so
              prefix.assign(head, head + end);
              const std::size_t value = std::size_t(tiff + entry + 8);
              prefix[value + (big ? 0 : 1)] = std::uint8_t(orientation >> 8);
              prefix[value + (big ? 1 : 0)] = std::uint8_t(orientation);
              consumed = end;
              return true;
            }
          }
        }
        break; // an EXIF segment without an orientation: insert ahead of it
      }
      at = end;
    }
    if (orientation == 1) return true; // untagged already means upright
    // FF E1, length 34, "Exif\0\0", then a big-endian TIFF with one IFD entry.
    const std::uint8_t app1[36] = {0xff, 0xe1, 0x00, 0x22, 'E', 'x', 'i', 'f', 0, 0, 'M', 'M', 0, 42,
                                   0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1,
                                   0, std::uint8_t(orientation), 0, 0, 0, 0, 0, 0};
    prefix.assign(head, head + insert_at);
    prefix.insert(prefix.end(), app1, app1 + sizeof app1);
    consumed = insert_at;
    return true;
  } catch (...) {
    prefix.clear();
    consumed = 0;
    return false;
  }
}

} // namespace lenslabs
