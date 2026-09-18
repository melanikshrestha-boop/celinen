// Sensor samples out of a RAW's bytes.
//
// Four packings, three of them written from published format descriptions
// rather than from another decoder's source:
//
//  * uncompressed 16-bit words — Sony's "Uncompressed" ARW and most DNGs. This
//    is the only one validated against real files (every ARW in the reference
//    set is this one).
//  * packed bits — 12- and 14-bit samples end to end, MSB first, rows starting
//    on a byte boundary, which is the TIFF convention.
//  * Sony's lossy ARW2 — 16 bytes per 16 same-colour pixels: an 11-bit maximum,
//    an 11-bit minimum, the 4-bit index of each, then fourteen 7-bit deltas
//    scaled by a shift the block's own range chooses; the result is an 11-bit
//    value that the file's own four-point curve (tag 0x7010, five segments whose
//    slopes double) expands back to the sensor's range.
//  * ITU-T T.81 lossless JPEG (SOF3) — Huffman-coded differences against one of
//    seven predictors, as DNG and Sony's lossless ARW use it.
//
// The two compressed paths are exercised by round-trip fixtures in
// native/tests/raw_decode_tests.cpp, which encode a known mosaic and read it
// back. No file in the reference set uses either, so neither is claimed to be
// verified against a camera's own output.
#include "lenslabs/raw_decode.hpp"
#include <algorithm>
#include <cstring>
#include <stdexcept>

namespace lenslabs::raw {
namespace {

[[noreturn]] void truncated(const char* what) {
  throw std::runtime_error(std::string("This RAW's ") + what + " ends before the sensor image does.");
}

// A bit reader that takes the most significant bit first, which is what TIFF's
// packed samples and JPEG's entropy coding both use.
class MsbBits {
 public:
  MsbBits(const std::uint8_t* data, std::size_t size) noexcept : data_(data), size_(size) {}
  std::uint32_t take(int count) {
    std::uint32_t value = 0;
    while (count-- > 0) {
      if (at_ >= size_) throw std::runtime_error("This RAW's packed sensor data ran out.");
      value = (value << 1) | ((data_[at_] >> (7 - bit_)) & 1);
      if (++bit_ == 8) {
        bit_ = 0;
        ++at_;
      }
    }
    return value;
  }
  void align() noexcept {
    if (bit_) {
      bit_ = 0;
      ++at_;
    }
  }
  void seek_byte(std::size_t at) noexcept {
    at_ = at;
    bit_ = 0;
  }
  std::size_t byte_position() const noexcept { return at_; }

 private:
  const std::uint8_t* data_;
  std::size_t size_;
  std::size_t at_ = 0;
  int bit_ = 0;
};

std::uint32_t le32(const std::uint8_t* p) noexcept {
  return std::uint32_t(p[0]) | std::uint32_t(p[1]) << 8 | std::uint32_t(p[2]) << 16 |
         std::uint32_t(p[3]) << 24;
}
std::uint32_t le16(const std::uint8_t* p) noexcept {
  return std::uint32_t(p[0]) | std::uint32_t(p[1]) << 8;
}

} // namespace

void unpack_uncompressed_16(const std::uint8_t* data, std::size_t size, std::uint32_t width,
                            std::uint32_t height, std::uint32_t bits, bool little_endian,
                            std::uint16_t* out) {
  const std::size_t count = std::size_t(width) * height;
  if (size < count * 2) truncated("sensor data");
  const std::uint16_t mask = bits >= 16 ? std::uint16_t(0xffff)
                                        : std::uint16_t((1u << std::max(1u, bits)) - 1);
  if (little_endian) {
    for (std::size_t i = 0; i < count; ++i)
      out[i] = std::uint16_t((std::uint16_t(data[i * 2]) | std::uint16_t(data[i * 2 + 1]) << 8) & mask);
  } else {
    for (std::size_t i = 0; i < count; ++i)
      out[i] = std::uint16_t((std::uint16_t(data[i * 2]) << 8 | std::uint16_t(data[i * 2 + 1])) & mask);
  }
}

void unpack_packed_bits(const std::uint8_t* data, std::size_t size, std::uint32_t width,
                        std::uint32_t height, std::uint32_t bits, bool little_endian,
                        std::uint16_t* out) {
  if (bits < 8 || bits > 16) throw std::runtime_error("This RAW's sample size is not supported.");
  const std::size_t row_bytes = (std::size_t(width) * bits + 7) / 8;
  if (size < row_bytes * height) truncated("packed sensor data");
  for (std::uint32_t y = 0; y < height; ++y) {
    MsbBits reader(data + row_bytes * y, row_bytes);
    std::uint16_t* row = out + std::size_t(y) * width;
    for (std::uint32_t x = 0; x < width; ++x) {
      std::uint32_t v = reader.take(int(bits));
      if (little_endian && bits == 12) {
        // Some 12-bit writers store the two samples of each three-byte group in
        // the opposite order. Nothing in the reference set does, so this stays
        // the plain most-significant-first reading.
      }
      row[x] = std::uint16_t(v);
    }
  }
}

void unpack_sony_arw2(const std::uint8_t* data, std::size_t size, std::uint32_t width,
                      std::uint32_t height, const std::array<std::uint16_t, 4>& curve,
                      std::uint16_t* out) {
  if (width < 32) throw std::runtime_error("This Sony frame is too narrow to be ARW2 compressed.");
  if (size < std::size_t(width) * height) truncated("compressed sensor data");

  // The file's four break points define five segments whose slopes double: the
  // curve that takes a decoded 11-bit value back to the sensor's own range.
  std::array<std::uint32_t, 6> knots{0, curve[0], curve[1], curve[2], curve[3], 4095};
  for (std::size_t i = 1; i < knots.size(); ++i) {
    // A curve whose points are not increasing would make the expansion
    // ambiguous; fall back to a straight line rather than invent values.
    if (knots[i] <= knots[i - 1] || knots[i] > 4095) {
      knots = {0, 819, 1638, 2457, 3276, 4095};
      break;
    }
  }
  std::vector<std::uint16_t> expand(4096, 0);
  {
    std::uint32_t value = 0;
    for (std::size_t segment = 0; segment < 5; ++segment) {
      const std::uint32_t step = 1u << segment;
      for (std::uint32_t j = knots[segment] + 1; j <= knots[segment + 1] && j < 4096; ++j) {
        value += step;
        expand[j] = std::uint16_t(std::min<std::uint32_t>(value, 16383));
      }
    }
  }

  for (std::uint32_t y = 0; y < height; ++y) {
    const std::uint8_t* row_bytes = data + std::size_t(y) * width;
    std::uint16_t* row = out + std::size_t(y) * width;
    std::fill(row, row + width, std::uint16_t(0));
    std::uint32_t column = 0;
    // Each 16-byte block holds sixteen pixels of one colour, two columns apart;
    // consecutive blocks alternate between the row's two colours, so a pair of
    // blocks fills thirty-two columns.
    for (std::size_t at = 0; at + 16 <= std::size_t(width) && column + 30 < width; at += 16) {
      const std::uint8_t* block = row_bytes + at;
      const std::uint32_t header = le32(block);
      const std::uint32_t maximum = header & 0x7ff;
      const std::uint32_t minimum = (header >> 11) & 0x7ff;
      const std::uint32_t index_max = (header >> 22) & 0x0f;
      const std::uint32_t index_min = (header >> 26) & 0x0f;
      int shift = 0;
      while (shift < 4 && (0x80u << shift) <= maximum - minimum) ++shift;
      std::uint32_t bit = 30;
      std::uint16_t pixels[16];
      for (int i = 0; i < 16; ++i) {
        if (std::uint32_t(i) == index_max) {
          pixels[i] = std::uint16_t(maximum);
        } else if (std::uint32_t(i) == index_min) {
          pixels[i] = std::uint16_t(minimum);
        } else {
          const std::uint32_t delta = (le16(block + (bit >> 3)) >> (bit & 7)) & 0x7f;
          pixels[i] = std::uint16_t(std::min<std::uint32_t>((delta << shift) + minimum, 0x7ff));
          bit += 7;
        }
      }
      for (int i = 0; i < 16; ++i, column += 2)
        row[column] = expand[std::size_t(pixels[i]) << 1];
      // Back to the row's other colour, or on to the next pair of blocks.
      column -= (column & 1) ? 1 : 31;
    }
  }
}

// --- ITU-T T.81 lossless (SOF3) -------------------------------------------

namespace {

struct HuffmanTable {
  // Canonical code lengths: `counts[n]` codes of length n+1, then the values.
  std::array<int, 17> first_code{};
  std::array<int, 17> first_index{};
  std::array<int, 17> max_code{};
  std::vector<std::uint8_t> values;
  bool present = false;

  void build(const std::array<int, 17>& counts) {
    int code = 0, index = 0;
    for (int length = 1; length <= 16; ++length) {
      first_code[length] = code;
      first_index[length] = index;
      code += counts[length];
      index += counts[length];
      max_code[length] = counts[length] ? code - 1 : -1;
      code <<= 1;
    }
    present = true;
  }
};

int decode_symbol(MsbBits& bits, const HuffmanTable& table) {
  int code = 0;
  for (int length = 1; length <= 16; ++length) {
    code = (code << 1) | int(bits.take(1));
    if (table.max_code[length] >= 0 && code <= table.max_code[length]) {
      const std::size_t index =
          std::size_t(table.first_index[length] + code - table.first_code[length]);
      if (index >= table.values.size())
        throw std::runtime_error("This RAW's lossless JPEG table is inconsistent.");
      return table.values[index];
    }
  }
  throw std::runtime_error("This RAW's lossless JPEG stream is not decodable.");
}

// T.81's sign extension: `length` raw bits become a signed difference.
int extend(std::uint32_t value, int length) noexcept {
  if (!length) return 0;
  return int(value) < (1 << (length - 1)) ? int(value) - (1 << length) + 1 : int(value);
}

} // namespace

void unpack_lossless_jpeg(const std::uint8_t* data, std::size_t size, std::uint32_t width,
                          std::uint32_t height, std::uint16_t* out) {
  if (size < 4 || data[0] != 0xff || data[1] != 0xd8)
    throw std::runtime_error("This RAW's sensor data is not a lossless JPEG.");
  std::array<HuffmanTable, 4> tables;
  int precision = 0, frame_width = 0, frame_height = 0, components = 0;
  std::array<int, 4> component_table{};
  int predictor = 1, point_transform = 0;
  std::size_t scan_start = 0;
  std::uint32_t restart_interval = 0;

  std::size_t at = 2;
  while (at + 4 <= size) {
    if (data[at] != 0xff) {
      ++at;
      continue;
    }
    const std::uint8_t marker = data[at + 1];
    if (marker == 0xff) {
      ++at;
      continue;
    }
    if (marker == 0xd8 || marker == 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (at + 4 > size) break;
    const std::size_t length = std::size_t(data[at + 2]) << 8 | data[at + 3];
    if (length < 2 || at + 2 + length > size)
      throw std::runtime_error("This RAW's lossless JPEG headers are truncated.");
    const std::uint8_t* segment = data + at + 4;
    const std::size_t segment_size = length - 2;
    if (marker == 0xc3) { // SOF3
      if (segment_size < 6) throw std::runtime_error("This RAW's lossless JPEG frame is short.");
      precision = segment[0];
      frame_height = segment[1] << 8 | segment[2];
      frame_width = segment[3] << 8 | segment[4];
      components = segment[5];
      if (components < 1 || components > 4 || segment_size < 6 + std::size_t(components) * 3)
        throw std::runtime_error("This RAW's lossless JPEG has an unsupported component count.");
      for (int i = 0; i < components; ++i)
        if (segment[6 + std::size_t(i) * 3 + 1] != 0x11)
          throw std::runtime_error("This RAW's lossless JPEG subsamples, which is not valid here.");
    } else if (marker == 0xc4) { // DHT
      std::size_t p = 0;
      while (p + 17 <= segment_size) {
        const int id = segment[p] & 0x0f;
        if ((segment[p] >> 4) != 0 || id > 3)
          throw std::runtime_error("This RAW's lossless JPEG uses an unexpected Huffman table.");
        std::array<int, 17> counts{};
        int total = 0;
        for (int i = 1; i <= 16; ++i) {
          counts[std::size_t(i)] = segment[p + std::size_t(i)];
          total += counts[std::size_t(i)];
        }
        if (p + 17 + std::size_t(total) > segment_size)
          throw std::runtime_error("This RAW's lossless JPEG Huffman table is truncated.");
        auto& table = tables[std::size_t(id)];
        table.values.assign(segment + p + 17, segment + p + 17 + std::size_t(total));
        table.build(counts);
        p += 17 + std::size_t(total);
      }
    } else if (marker == 0xdd) { // DRI
      if (segment_size >= 2) restart_interval = std::uint32_t(segment[0]) << 8 | segment[1];
    } else if (marker == 0xda) { // SOS
      if (segment_size < 4) throw std::runtime_error("This RAW's lossless JPEG scan is short.");
      const int scan_components = segment[0];
      if (scan_components != components || segment_size < 1 + std::size_t(scan_components) * 2 + 3)
        throw std::runtime_error("This RAW's lossless JPEG scan does not match its frame.");
      for (int i = 0; i < scan_components; ++i)
        component_table[std::size_t(i)] = segment[1 + std::size_t(i) * 2 + 1] >> 4;
      predictor = segment[1 + std::size_t(scan_components) * 2];
      point_transform = segment[1 + std::size_t(scan_components) * 2 + 2] & 0x0f;
      scan_start = at + 2 + length;
      break;
    }
    at += 2 + length;
  }

  if (!scan_start || !components || precision < 2 || precision > 16)
    throw std::runtime_error("This RAW's lossless JPEG has no usable scan.");
  if (predictor != 1)
    throw std::runtime_error("This RAW's lossless JPEG uses a predictor this decoder does not read.");
  if (std::uint64_t(frame_width) * components != width || std::uint32_t(frame_height) != height)
    throw std::runtime_error("This RAW's lossless JPEG is not the size the directory claims.");

  // The entropy stream, with JPEG's 0xff00 byte stuffing removed so the bit
  // reader never sees a marker. Restart markers end a run and reset prediction.
  std::vector<std::uint8_t> stream;
  std::vector<std::size_t> restarts;
  stream.reserve(size - scan_start);
  for (std::size_t i = scan_start; i < size;) {
    if (data[i] != 0xff) {
      stream.push_back(data[i++]);
      continue;
    }
    if (i + 1 >= size) break;
    const std::uint8_t next = data[i + 1];
    if (next == 0x00) {
      stream.push_back(0xff);
      i += 2;
      continue;
    }
    if (next >= 0xd0 && next <= 0xd7) {
      restarts.push_back(stream.size());
      i += 2;
      continue;
    }
    break; // EOI or any other marker ends the scan
  }

  MsbBits bits(stream.data(), stream.size());
  const int default_prediction = 1 << (precision - 1 - point_transform);
  std::vector<int> previous(std::size_t(frame_width) * std::size_t(components), 0);
  std::vector<int> current(previous.size(), 0);
  std::size_t next_restart = 0;
  std::uint32_t since_restart = 0;

  for (std::uint32_t y = 0; y < height; ++y) {
    for (int x = 0; x < frame_width; ++x) {
      for (int c = 0; c < components; ++c) {
        const std::size_t index = std::size_t(x) * std::size_t(components) + std::size_t(c);
        const auto& table = tables[std::size_t(component_table[std::size_t(c)])];
        if (!table.present)
          throw std::runtime_error("This RAW's lossless JPEG names a Huffman table it never sent.");
        const int length = decode_symbol(bits, table);
        if (length < 0 || length > 16)
          throw std::runtime_error("This RAW's lossless JPEG difference is out of range.");
        const int difference = extend(length ? bits.take(length) : 0, length);
        int prediction;
        if (x == 0)
          prediction = y == 0 ? default_prediction : previous[index];
        else
          prediction = current[index - std::size_t(components)];
        current[index] = prediction + difference;
        out[std::size_t(y) * width + index] =
            std::uint16_t(std::clamp(current[index] << point_transform, 0, 0xffff));
      }
    }
    previous.swap(current);
    if (restart_interval && ++since_restart == restart_interval && next_restart < restarts.size()) {
      bits.seek_byte(restarts[next_restart++]);
      since_restart = 0;
      std::fill(previous.begin(), previous.end(), 0);
      if (y + 1 < height) {
        // A restart begins a fresh run: the first sample of the next row
        // predicts from the default again, exactly as a first row does.
        for (auto& v : previous) v = default_prediction;
      }
    }
  }
}

// --- The packing the metadata named ---------------------------------------

Mosaic unpack_mosaic(const std::uint8_t* bytes, std::size_t size, const RawMetadata& meta) {
  if (!meta.valid) throw std::runtime_error(meta.reason.empty() ? "This RAW cannot be read." : meta.reason);
  const std::uint64_t pixels = std::uint64_t(meta.raw_width) * meta.raw_height;
  if (!pixels || pixels > max_sensor_pixels)
    throw std::runtime_error("This sensor is larger than this decoder will process.");

  Mosaic mosaic;
  mosaic.width = meta.raw_width;
  mosaic.height = meta.raw_height;
  mosaic.samples.assign(std::size_t(pixels), 0);

  if (meta.tile_width || meta.tile_height)
    throw std::runtime_error("This RAW stores its sensor image in tiles, which this decoder does not read yet.");

  // Strips, in order, each covering `rows_per_strip` rows of the raster.
  const std::uint32_t rows_per_strip =
      meta.strip_offsets.size() == 1
          ? meta.raw_height
          : (meta.rows_per_strip ? meta.rows_per_strip : meta.raw_height);
  std::uint32_t row = 0;
  for (std::size_t i = 0; i < meta.strip_offsets.size() && row < meta.raw_height; ++i) {
    const std::uint64_t at = meta.strip_offsets[i], length = meta.strip_counts[i];
    if (at > size || length > size - at) truncated("sensor data");
    const std::uint32_t rows = std::min(rows_per_strip, meta.raw_height - row);
    std::uint16_t* out = mosaic.samples.data() + std::size_t(row) * meta.raw_width;
    const std::uint8_t* data = bytes + at;
    switch (meta.packing) {
      case Packing::uncompressed_16:
        unpack_uncompressed_16(data, std::size_t(length), meta.raw_width, rows,
                               meta.bits_per_sample, meta.little_endian, out);
        break;
      case Packing::packed_bits:
        unpack_packed_bits(data, std::size_t(length), meta.raw_width, rows, meta.bits_per_sample,
                           meta.little_endian, out);
        break;
      case Packing::sony_arw2:
        unpack_sony_arw2(data, std::size_t(length), meta.raw_width, rows,
                         meta.has_tone_curve ? meta.tone_curve
                                             : std::array<std::uint16_t, 4>{819, 1638, 2457, 3276},
                         out);
        break;
      case Packing::lossless_jpeg:
        unpack_lossless_jpeg(data, std::size_t(length), meta.raw_width, rows, out);
        break;
      default:
        throw std::runtime_error("This RAW's sensor data is in a packing this decoder does not read.");
    }
    row += rows;
  }
  if (row < meta.raw_height) truncated("sensor data");
  return mosaic;
}

} // namespace lenslabs::raw
