#include "lenslabs/calendar.hpp"
#include <algorithm>
#include <stdexcept>
namespace lenslabs::calendar {
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
  if (offset + 4 > bytes.size()) throw std::invalid_argument("Calendar packet is truncated.");
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
std::uint16_t read16(const std::vector<std::uint8_t>& bytes, std::size_t& offset) {
  if (offset + 2 > bytes.size()) throw std::invalid_argument("Calendar packet is truncated.");
  const std::uint16_t value = static_cast<std::uint16_t>((bytes[offset] << 8) | bytes[offset + 1]);
  offset += 2;
  return value;
}
void put16(std::vector<std::uint8_t>& out, std::uint16_t value) {
  out.push_back(static_cast<std::uint8_t>(value >> 8));
  out.push_back(static_cast<std::uint8_t>(value));
}
std::string read_text(const std::vector<std::uint8_t>& bytes, std::size_t& offset, std::size_t max) {
  const auto length = read16(bytes, offset);
  if (length > max || offset + length > bytes.size())
    throw std::invalid_argument("Calendar field is too long.");
  std::string text(reinterpret_cast<const char*>(&bytes[offset]), length);
  offset += length;
  for (unsigned char ch : text)
    if (ch < 32 && ch != '\n') throw std::invalid_argument("Calendar field contains a control character.");
  return text;
}
void put_text(std::vector<std::uint8_t>& out, const std::string& text, std::size_t max) {
  if (text.size() > max) throw std::invalid_argument("Calendar field is too long.");
  put16(out, static_cast<std::uint16_t>(text.size()));
  out.insert(out.end(), text.begin(), text.end());
}
}  // namespace
Request parse(const std::vector<std::uint8_t>& bytes) {
  if (bytes.size() > max_input) throw std::invalid_argument("Calendar packet exceeds the input limit.");
  std::size_t offset = 0;
  if (read32(bytes, offset) != request_magic || read32(bytes, offset) != version)
    throw std::invalid_argument("Calendar packet magic is invalid.");
  const auto count = read32(bytes, offset);
  if (count > max_items) throw std::invalid_argument("Calendar has too many events.");
  Request request;
  request.events.reserve(count);
  for (std::uint32_t i = 0; i < count; ++i) {
    Event event;
    event.id = read_text(bytes, offset, max_id);
    event.title = read_text(bytes, offset, max_title);
    event.location = read_text(bytes, offset, max_location);
    event.notes = read_text(bytes, offset, max_notes);
    event.pose = read_text(bytes, offset, max_pose);
    event.start = read64(bytes, offset);
    event.end = read64(bytes, offset);
    if (offset >= bytes.size()) throw std::invalid_argument("Calendar packet is truncated.");
    const auto flag = bytes[offset++];
    if (flag > 1) throw std::invalid_argument("Calendar all-day flag is invalid.");
    event.all_day = flag == 1;
    event.color = read32(bytes, offset);
    if (event.id.empty() || event.title.empty() || event.end < event.start)
      throw std::invalid_argument("Calendar event is invalid.");
    request.events.push_back(std::move(event));
  }
  if (offset != bytes.size()) throw std::invalid_argument("Calendar packet has trailing bytes.");
  return request;
}
std::vector<std::uint8_t> encode(const Result& result) {
  if (result.events.size() > max_items) throw std::invalid_argument("Calendar result exceeds limits.");
  std::vector<std::uint8_t> out;
  put32(out, result_magic);
  put32(out, version);
  put32(out, static_cast<std::uint32_t>(result.events.size()));
  for (const auto& event : result.events) {
    put_text(out, event.id, max_id);
    put_text(out, event.title, max_title);
    put_text(out, event.location, max_location);
    put_text(out, event.notes, max_notes);
    put_text(out, event.pose, max_pose);
    put64(out, event.start);
    put64(out, event.end);
    out.push_back(event.all_day ? 1 : 0);
    put32(out, event.color);
  }
  if (out.size() > max_output) throw std::invalid_argument("Calendar result exceeds the output limit.");
  return out;
}
Result sort(const Request& request) {
  Result result = request;
  std::sort(result.events.begin(), result.events.end(), [](const Event& a, const Event& b) {
    if (a.start != b.start) return a.start < b.start;
    return a.title < b.title;
  });
  return result;
}
}
