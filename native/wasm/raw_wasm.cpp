// RAW container inspection for the browser: which embedded JPEGs a RAW holds,
// which is best, and which way up it belongs. Linked into both
// celinen-ingest.wasm (the ingest lanes) and the small celinen-raw.wasm (the
// loupe and the preview worker), so every surface asks the same C++.
//
// The caller hands over the head of the file, not the file: a 60 MB RAW keeps
// its previews near the front, and a preview whose header lies past the head
// is described from a separate probe of its first bytes.
#include "lenslabs/raw_preview.hpp"
#include <algorithm>
#include <cstdint>
#include <vector>

namespace {
std::vector<std::uint8_t> head, probe, output;
lenslabs::RawContainer container;
std::vector<std::size_t> order;
std::vector<double> candidate_fields;
std::vector<std::int32_t> order_fields;
constexpr std::size_t fields_per_candidate = 8;

std::uint8_t* reserve(std::vector<std::uint8_t>& buffer, std::uint32_t size, std::uint32_t limit) {
  buffer.clear();
  if (!size || size > limit) return nullptr;
  try {
    buffer.assign(size, 0);
  } catch (...) {
    buffer.clear();
    return nullptr;
  }
  return buffer.data();
}
} // namespace

extern "C" {
/** Room for the first `size` bytes of a RAW file. Null beyond 64 MiB. */
std::uint8_t* celinen_raw_input(std::uint32_t size) { return reserve(head, size, 64u << 20); }

/** Inspects the loaded head of a file `file_size` bytes long. Returns the
 * number of preview candidates (0 when none), -1 on an invalid call. */
std::int32_t celinen_raw_inspect(std::uint32_t size, double file_size) {
  container = {};
  order.clear();
  if (size > head.size() || !(file_size >= size)) return -1;
  container = lenslabs::inspect_raw(head.data(), size, std::uint64_t(file_size));
  return std::int32_t(container.previews.size());
}

/** 0 unknown, 1 TIFF-based, 2 CR3, 3 RAF. */
std::int32_t celinen_raw_kind() { return std::int32_t(container.kind); }
/** The container's own orientation 1..8, 0 when it has none. */
std::int32_t celinen_raw_container_orientation() { return container.orientation; }
/** 1 when a structure pointed past the head: a longer head may find more. */
std::int32_t celinen_raw_truncated() { return container.truncated ? 1 : 0; }

/** 8 doubles for candidate `index`: offset, length, source, described (0/1),
 * width, height, process (-1 unknown), own orientation (0 none). Null when out of range. */
const double* celinen_raw_candidate(std::int32_t index) {
  if (index < 0 || std::size_t(index) >= container.previews.size()) return nullptr;
  const auto& p = container.previews[std::size_t(index)];
  candidate_fields = {double(p.offset),     double(p.length),       double(int(p.source)),
                      p.described ? 1.0 : 0, double(p.jpeg.width),  double(p.jpeg.height),
                      double(p.jpeg.process), double(p.jpeg.orientation)};
  return candidate_fields.data();
}

/** Room for the first bytes of one candidate (or of a JPEG to retag). Null beyond 64 MiB. */
std::uint8_t* celinen_raw_probe(std::uint32_t size) { return reserve(probe, size, 64u << 20); }

/** Reads candidate `index`'s header from the probe's first `size` bytes.
 * Returns 1 when it is now described, 0 when those bytes were not enough. */
std::int32_t celinen_raw_describe(std::int32_t index, std::uint32_t size) {
  if (index < 0 || std::size_t(index) >= container.previews.size() || size > probe.size()) return 0;
  auto& p = container.previews[std::size_t(index)];
  const auto available = std::min<std::uint64_t>(size, p.length);
  p.jpeg = lenslabs::describe_jpeg(probe.data(), std::size_t(available));
  p.described = !p.jpeg.incomplete || available == p.length;
  return p.described ? 1 : 0;
}

/** Ranks the described candidates, best first. Returns how many are worth decoding. */
std::int32_t celinen_raw_rank() {
  order = lenslabs::rank_previews(container.previews);
  order_fields.assign(order.begin(), order.end());
  return std::int32_t(order.size());
}
/** The ranked candidate indices, as int32. */
const std::int32_t* celinen_raw_order() { return order_fields.data(); }

/** Which way up candidate `index` belongs (1..8), by preview_orientation's precedence. */
std::int32_t celinen_raw_orientation(std::int32_t index) {
  if (index < 0 || std::size_t(index) >= container.previews.size()) return 1;
  return lenslabs::preview_orientation(container, container.previews[std::size_t(index)].jpeg);
}

/** Retags the JPEG head in the probe's first `size` bytes to `orientation`.
 * Returns how many leading bytes of the JPEG the output replaces (0 = keep the
 * JPEG as it is), or -1 when the probe is not a JPEG. */
std::int32_t celinen_raw_retag(std::uint32_t size, std::int32_t orientation) {
  output.clear();
  if (size > probe.size()) return -1;
  std::size_t consumed = 0;
  if (!lenslabs::retag_orientation(probe.data(), size, orientation, output, consumed)) return -1;
  return std::int32_t(consumed);
}
const std::uint8_t* celinen_raw_output() { return output.data(); }
std::uint32_t celinen_raw_output_size() { return std::uint32_t(output.size()); }

/** Hands the buffers back. */
void celinen_raw_release() {
  head.clear(); head.shrink_to_fit();
  probe.clear(); probe.shrink_to_fit();
  output.clear(); output.shrink_to_fit();
  container = {};
  order.clear();
}
}
