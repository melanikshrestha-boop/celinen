#pragma once
#include <cstddef>
#include <cstdint>
#include <string>

namespace lenslabs {

// Which maker note an AF area came from. Each brand writes it differently, so
// the source is kept for diagnostics and for brand-specific trust later.
enum class AfSource : std::uint8_t { none = 0, sony, nikon, canon, fujifilm };

// Where the camera says its autofocus was, as a rectangle normalized to 0..1 of
// the image *as stored* (sensor-up, before the Orientation tag is applied).
// upright_af_area() maps it into the same frame the viewer sees.
struct AfArea {
  bool present = false;
  double x = 0, y = 0, width = 0, height = 0;
  // -1 the camera did not say; 0 it reported no focus lock (Canon: points
  // selected but none in focus; Nikon: contrast-detect "not in focus");
  // 1 it confirmed focus inside this area.
  int in_focus = -1;
  // True when the camera gave a single point and the rectangle is a nominal box
  // around it rather than a size the camera wrote.
  bool point_only = false;
  AfSource source = AfSource::none;
};

// What a frame's own metadata says about how and when it was taken. Everything
// here is read from the file; nothing is inferred from the filesystem. A shoot
// groups bursts by these, so a guessed time would invent a burst.
struct ExifFacts {
  // 1..8, the TIFF orientation. 1 when the file did not say.
  int orientation = 1;
  // True when the file carried a valid Orientation tag, so "said 1" can be told
  // apart from "said nothing" (a RAW's embedded preview usually says nothing).
  bool orientation_tagged = false;
  // Milliseconds since the epoch, or -1 when the file carried no capture time.
  double capture_time_ms = -1;
  // True when the file also carried the camera's UTC offset, so the time above
  // is a real instant rather than a reading of the camera's own clock.
  bool capture_time_utc = false;
  // "make|model|serial", lowercased, with the parts the file omitted left out.
  // Empty when the file named no camera. Two cameras' clocks are never compared.
  std::string camera_key;
  // The camera's AF area from its maker note (Sony FocusLocation, Nikon
  // AFInfo2, Canon AFInfo2, Fujifilm FocusPixel). Absent when the file has none.
  AfArea af;
  // Lens focal length in millimetres, and its 35mm-film equivalent. 0 when absent.
  // Upright uses them to know how wide the lens was; without them it assumes 35mm.
  double focal_length_mm = 0;
  double focal_length_35mm = 0;
  // Sensor extent in millimetres along its long edge, from the focal-plane
  // resolution tags. 0 when the file did not carry them.
  double sensor_long_edge_mm = 0;
};

// Reads the metadata of a JPEG (APP1 EXIF), a TIFF-based RAW (ARW, NEF, CR2,
// DNG — anything starting with a TIFF header) or a Canon CR3 (ISO-BMFF CMT
// boxes). Bounded and non-throwing: a truncated or hostile file yields defaults
// rather than a crash. A RAW may be passed truncated to its first megabytes;
// anything pointing past the end is simply absent.
ExifFacts read_exif(const std::uint8_t* bytes, std::size_t size) noexcept;

// Maps a stored-orientation AF area into upright image coordinates using the
// TIFF orientation (1..8), matching how the ingest engine rotates pixels.
// Returns the area unchanged for orientation 1 or an invalid value.
AfArea upright_af_area(const AfArea& area, int orientation) noexcept;

// Days from the civil date, for turning a camera's clock reading into an
// instant. Exposed for testing.
std::int64_t days_from_civil(int year, int month, int day) noexcept;

} // namespace lenslabs
