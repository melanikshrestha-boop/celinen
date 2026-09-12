#include "lenslabs/settings.hpp"
#include <stdexcept>
namespace lenslabs::settings {
namespace {
void put32(std::vector<std::uint8_t>& out, std::uint32_t value) {
  out.push_back(static_cast<std::uint8_t>(value >> 24));
  out.push_back(static_cast<std::uint8_t>(value >> 16));
  out.push_back(static_cast<std::uint8_t>(value >> 8));
  out.push_back(static_cast<std::uint8_t>(value));
}
void put64(std::vector<std::uint8_t>& out, std::uint64_t value) {
  put32(out, static_cast<std::uint32_t>(value >> 32));
  put32(out, static_cast<std::uint32_t>(value));
}
std::uint32_t read32(const std::vector<std::uint8_t>& bytes, std::size_t& offset) {
  if (offset + 4 > bytes.size()) throw std::invalid_argument("Settings packet is truncated.");
  const std::uint32_t value = (std::uint32_t(bytes[offset]) << 24) | (std::uint32_t(bytes[offset + 1]) << 16) |
                              (std::uint32_t(bytes[offset + 2]) << 8) | bytes[offset + 3];
  offset += 4;
  return value;
}
std::uint64_t read64(const std::vector<std::uint8_t>& bytes, std::size_t& offset) {
  const auto high = read32(bytes, offset);
  const auto low = read32(bytes, offset);
  return (std::uint64_t(high) << 32) | low;
}
}  // namespace
Request parse(const std::vector<std::uint8_t>& bytes) {
  if (bytes.size() > max_input) throw std::invalid_argument("Settings packet exceeds the input limit.");
  std::size_t offset = 0;
  if (read32(bytes, offset) != request_magic || read32(bytes, offset) != version)
    throw std::invalid_argument("Settings packet magic is invalid.");
  const auto count = read32(bytes, offset);
  if (count > max_items) throw std::invalid_argument("Settings has too many photos.");
  Request request;
  request.photos.reserve(count);
  for (std::uint32_t i = 0; i < count; ++i) {
    const auto size = read64(bytes, offset);
    if (offset >= bytes.size()) throw std::invalid_argument("Settings packet is truncated.");
    const auto flag = bytes[offset++];
    if (flag > 1) throw std::invalid_argument("Settings kept flag is invalid.");
    request.photos.push_back(Photo{size, flag == 1});
  }
  if (offset != bytes.size()) throw std::invalid_argument("Settings packet has trailing bytes.");
  return request;
}
std::vector<std::uint8_t> encode(const Result& result) {
  std::vector<std::uint8_t> out;
  out.reserve(max_output);
  put32(out, result_magic);
  put32(out, version);
  put32(out, result.photos);
  put32(out, result.kept);
  put64(out, result.total_bytes);
  put64(out, result.average_bytes);
  if (out.size() > max_output) throw std::invalid_argument("Settings result exceeds the output limit.");
  return out;
}
Result tally(const Request& request) {
  if (request.photos.size() > max_items) throw std::invalid_argument("Settings tally exceeds limits.");
  Result result;
  result.photos = static_cast<std::uint32_t>(request.photos.size());
  std::uint64_t total = 0;
  std::uint32_t kept = 0;
  for (const auto& photo : request.photos) {
    if (photo.bytes > (std::uint64_t(1) << 40)) throw std::invalid_argument("Settings photo is too large.");
    total += photo.bytes;
    if (photo.kept) ++kept;
  }
  result.kept = kept;
  result.total_bytes = total;
  result.average_bytes = result.photos ? total / result.photos : 0;
  return result;
}
}
