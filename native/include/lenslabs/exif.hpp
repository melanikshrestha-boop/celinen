#pragma once
#include <cstddef>
#include <cstdint>
#include <string>

namespace lenslabs {

// What a frame's own metadata says about how and when it was taken. Everything
// here is read from the file; nothing is inferred from the filesystem. A shoot
// groups bursts by these, so a guessed time would invent a burst.
struct ExifFacts {
  // 1..8, the TIFF orientation. 1 when the file did not say.
  int orientation = 1;
  // Milliseconds since the epoch, or -1 when the file carried no capture time.
  double capture_time_ms = -1;
  // True when the file also carried the camera's UTC offset, so the time above
  // is a real instant rather than a reading of the camera's own clock.
  bool capture_time_utc = false;
  // "make|model|serial", lowercased, with the parts the file omitted left out.
  // Empty when the file named no camera. Two cameras' clocks are never compared.
  std::string camera_key;
};

// Reads the EXIF block of a JPEG. Bounded and non-throwing: a truncated or
// hostile file yields defaults rather than a crash.
ExifFacts read_exif(const std::uint8_t* bytes, std::size_t size) noexcept;

// Days from the civil date, for turning a camera's clock reading into an
// instant. Exposed for testing.
std::int64_t days_from_civil(int year, int month, int day) noexcept;

} // namespace lenslabs
