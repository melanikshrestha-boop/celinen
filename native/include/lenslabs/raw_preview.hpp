#pragma once
#include <cstddef>
#include <cstdint>
#include <vector>

// The pictures a RAW file carries besides its sensor data, and which way up
// they belong.
//
// A cull never develops sensor data: it judges and shows the JPEG previews the
// camera embedded (Sony ARW's 1616 px PreviewImage, Nikon's full-size
// JpgFromRaw, Canon CR3's PRVW and full-size track, ...). Those previews are
// stored the way the sensor was held and almost never carry an orientation of
// their own; the container's IFD0 (CMT1 on CR3) says how to turn them. Reading
// one without the other is how a portrait frame ends up sideways.
namespace lenslabs {

// Where in the container a preview was found.
enum class PreviewSource : std::uint8_t {
  scan = 0,       // a JPEG found by walking bytes, when no structure named one
  ifd = 1,        // IFD0/IFD1 chain: JPEGInterchangeFormat or a JPEG strip
  sub_ifd = 2,    // a SubIFD (NEF/DNG JpgFromRaw, DNG previews)
  cr3_thumbnail = 3,
  cr3_preview = 4, // PRVW, about 1620 px
  cr3_track = 5,   // a moov track sample; track 1 is the full-size JPEG
  raf = 6,         // Fujifilm RAF header's JPEG
  rw2 = 7,         // Panasonic RW2 JpgFromRaw (tag 0x002e)
};

// What a JPEG's own header says, read without decoding it.
struct JpegInfo {
  // SOI and a frame header were found.
  bool valid = false;
  // The header did not fit the bytes given: read more and ask again.
  bool incomplete = false;
  std::uint32_t width = 0, height = 0; // stored size, before any orientation
  // The frame header marker less 0xc0: 0 baseline, 1 extended, 2 progressive,
  // 3 lossless (the sensor data of CR2 and many DNGs, not a picture).
  int process = -1;
  // The JPEG's own EXIF orientation 1..8, or 0 when it carries none.
  int orientation = 0;
};

JpegInfo describe_jpeg(const std::uint8_t* bytes, std::size_t size) noexcept;

// Every browser and libjpeg decode these: 8-bit Huffman baseline, extended and progressive.
bool decodable_process(int process) noexcept;

struct PreviewCandidate {
  std::uint64_t offset = 0, length = 0; // in the file
  PreviewSource source = PreviewSource::scan;
  // False until the JPEG's header has been read, which needs its first bytes;
  // candidates past the buffer given to inspect_raw() start undescribed.
  bool described = false;
  JpegInfo jpeg;
};

enum class ContainerKind : std::uint8_t { unknown = 0, tiff = 1, cr3 = 2, raf = 3 };

struct RawContainer {
  ContainerKind kind = ContainerKind::unknown;
  // The container's own orientation 1..8 (TIFF IFD0, CR3 CMT1), 0 when absent.
  int orientation = 0;
  // Stored (sensor-up) size of the sensor image, 0 when the container does not say.
  std::uint32_t sensor_width = 0, sensor_height = 0;
  // Some structure pointed past the bytes given; a longer head may find more.
  bool truncated = false;
  std::vector<PreviewCandidate> previews;
};

// Reads a RAW container's structure from its first `size` bytes. `file_size` is
// the whole file's size, so previews beyond the head can still be listed (and
// ones pointing past the end rejected). Bounded and non-throwing on hostile
// input; anything that does not parse is simply absent.
RawContainer inspect_raw(const std::uint8_t* bytes, std::size_t size,
                         std::uint64_t file_size) noexcept;

// Candidates worth decoding, best first: described, a decodable process, long
// edge of at least 320 px (smaller is a navigation thumbnail, not a frame to
// judge), then most pixels, then most bytes.
std::vector<std::size_t> rank_previews(const std::vector<PreviewCandidate>& previews) noexcept;

// Which way up a preview belongs, as a TIFF orientation 1..8.
//
// Precedence: the container's orientation wins when it has one, and the
// preview's own tag is used only when the container is silent (Fujifilm RAF
// keeps orientation in the preview's EXIF). The two are never combined. One
// exception guards against turning a frame twice: when the container says to
// turn a quarter but the preview is already the other shape than the sensor
// (portrait preview of a landscape sensor), the camera turned it already and
// only the preview's own tag applies.
int preview_orientation(const RawContainer& container, const JpegInfo& preview) noexcept;

// Rewrites the start of a JPEG so its EXIF says `orientation`, letting a
// browser decoder turn it. `head` is the JPEG's first bytes. On return,
// `prefix` replaces the first `consumed` bytes of the JPEG; everything after
// them is kept byte for byte. An existing IFD0 orientation is patched in
// place; otherwise a minimal EXIF segment is inserted first (after JFIF), which
// is the segment Chromium, Firefox and WebKit read. Returns false when `head`
// is not a JPEG. `consumed` is 0 and `prefix` empty when nothing needs to change.
bool retag_orientation(const std::uint8_t* head, std::size_t size, int orientation,
                       std::vector<std::uint8_t>& prefix, std::size_t& consumed) noexcept;

} // namespace lenslabs
