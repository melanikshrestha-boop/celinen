#pragma once
#include "lenslabs/engine.hpp"
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>

namespace lenslabs {

// A JPEG entropy-decoded once and kept as quantized DCT coefficients.
//
// Why: entropy decoding is nearly all of a scaled decode's cost. Measured in
// WebAssembly on a 24MP, 6.8 MB JPEG: 66 ms to read the coefficients, 67 ms for
// a whole 1/8-scale decode, 130 ms at full size. The ingest pass needs
// the photo twice: a scaled working frame for every measurement, and, when a
// face is found, the face at the original's full resolution. Decoding twice
// would nearly double ingest time; rendering both from one set of coefficients
// costs a few milliseconds more than the working frame alone.
//
// render() is bit-identical to libjpeg's own scaled decode with fancy
// upsampling off: it drives libjpeg's inverse DCTs on the stored coefficients
// and repeats its upsampling and colour conversion. tests/cull-ingest.test.ts
// proves the equality against libjpeg's decoder on real photographs.
//
// Needs Emscripten's libjpeg port (IJG 9f); built only into celinen-ingest.wasm.
class JpegCoefficients {
 public:
  JpegCoefficients();
  ~JpegCoefficients();
  JpegCoefficients(const JpegCoefficients&) = delete;
  JpegCoefficients& operator=(const JpegCoefficients&) = delete;

  // Entropy-decodes the whole file. Returns false, with error() set, for a file
  // this renderer does not handle (CMYK, SmartScale, unusual sampling, more
  // than `max_blocks` 8x8 blocks) or cannot decode; the caller then uses
  // libjpeg's streaming decoder, which needs far less memory.
  bool read(const std::uint8_t* bytes, std::size_t size, std::size_t max_blocks);

  std::uint32_t width() const noexcept;  // as stored, before EXIF orientation
  std::uint32_t height() const noexcept;
  // Output size at scale numerator/8, as libjpeg computes it.
  std::uint32_t scaled_width(unsigned numerator) const noexcept;
  std::uint32_t scaled_height(unsigned numerator) const noexcept;

  // The whole image at numerator/8 (1..8), as RGBA.
  bool render(unsigned numerator, Image& out);
  // The rectangle [x0, x1) x [y0, y1) of the image at numerator/8, in that
  // scale's output pixels and stored orientation. Only the blocks under the
  // rectangle are transformed.
  bool render_region(unsigned numerator, std::uint32_t x0, std::uint32_t y0, std::uint32_t x1,
                     std::uint32_t y1, Image& out);

  const std::string& error() const noexcept;
  // Set when the file decoded but is not whole: the end is missing, or some of
  // its entropy data is corrupt. libjpeg paints what it could not read as flat
  // gray, so the caller must say so instead of scoring the gray.
  bool ended_early() const noexcept;
  bool corrupt() const noexcept;

 private:
  struct State;
  std::unique_ptr<State> state_;
  std::string error_;
};

} // namespace lenslabs
