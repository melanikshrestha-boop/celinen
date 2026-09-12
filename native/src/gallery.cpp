#include "lenslabs/gallery.hpp"
#include <stdexcept>
#include <unordered_map>
#include <unordered_set>
namespace lenslabs::gallery {
namespace {
void put32(std::vector<std::uint8_t>& out, std::uint32_t value) {
  out.push_back(static_cast<std::uint8_t>(value >> 24));
  out.push_back(static_cast<std::uint8_t>(value >> 16));
  out.push_back(static_cast<std::uint8_t>(value >> 8));
  out.push_back(static_cast<std::uint8_t>(value));
}
std::uint32_t read32(const std::vector<std::uint8_t>& bytes, std::size_t& offset) {
  if (offset + 4 > bytes.size()) throw std::invalid_argument("Gallery packet is truncated.");
  const std::uint32_t value = (std::uint32_t(bytes[offset]) << 24) | (std::uint32_t(bytes[offset + 1]) << 16) |
                              (std::uint32_t(bytes[offset + 2]) << 8) | bytes[offset + 3];
  offset += 4;
  return value;
}
std::uint16_t read16(const std::vector<std::uint8_t>& bytes, std::size_t& offset) {
  if (offset + 2 > bytes.size()) throw std::invalid_argument("Gallery packet is truncated.");
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
  if (length == 0 || length > max || offset + length > bytes.size())
    throw std::invalid_argument("Gallery field is empty or too long.");
  std::string text(reinterpret_cast<const char*>(&bytes[offset]), length);
  offset += length;
  for (unsigned char ch : text)
    if (ch < 32) throw std::invalid_argument("Gallery field contains a control character.");
  return text;
}
void put_text(std::vector<std::uint8_t>& out, const std::string& text, std::size_t max) {
  if (text.empty() || text.size() > max) throw std::invalid_argument("Gallery field is empty or too long.");
  put16(out, static_cast<std::uint16_t>(text.size()));
  out.insert(out.end(), text.begin(), text.end());
}
}  // namespace
std::string stem(const std::string& name) {
  if (name.empty() || name.size() > max_name) throw std::invalid_argument("Gallery filename is invalid.");
  std::string out;
  out.reserve(name.size());
  for (unsigned char ch : name) {
    if (ch < 32) throw std::invalid_argument("Gallery filename contains a control character.");
    out.push_back(ch >= 'A' && ch <= 'Z' ? static_cast<char>(ch + 32) : static_cast<char>(ch));
  }
  const auto dot = out.find_last_of('.');
  return dot == std::string::npos || dot == 0 ? out : out.substr(0, dot);
}
Request parse(const std::vector<std::uint8_t>& bytes) {
  if (bytes.size() > max_input) throw std::invalid_argument("Gallery packet exceeds the input limit.");
  std::size_t offset = 0;
  if (read32(bytes, offset) != request_magic || read32(bytes, offset) != version)
    throw std::invalid_argument("Gallery packet magic is invalid.");
  Request request;
  const auto photos = read32(bytes, offset);
  if (photos > max_items) throw std::invalid_argument("Gallery has too many photos.");
  request.photos.reserve(photos);
  std::unordered_set<std::string> ids;
  ids.reserve(photos);
  for (std::uint32_t i = 0; i < photos; ++i) {
    Photo photo{read_text(bytes, offset, max_id), read_text(bytes, offset, max_name)};
    if (!ids.insert(photo.id).second) throw std::invalid_argument("Gallery photo ids must be unique.");
    request.photos.push_back(std::move(photo));
  }
  const auto hearts = read32(bytes, offset);
  if (hearts > max_items) throw std::invalid_argument("Gallery has too many hearts.");
  request.hearts.reserve(hearts);
  for (std::uint32_t i = 0; i < hearts; ++i) request.hearts.push_back(read_text(bytes, offset, max_id));
  const auto edited = read32(bytes, offset);
  if (edited > max_items) throw std::invalid_argument("Gallery has too many edited files.");
  request.edited.reserve(edited);
  for (std::uint32_t i = 0; i < edited; ++i) request.edited.push_back(read_text(bytes, offset, max_name));
  if (offset != bytes.size()) throw std::invalid_argument("Gallery packet has trailing bytes.");
  return request;
}
std::vector<std::uint8_t> encode(const Result& result) {
  if (result.favorites.size() > max_items || result.matches.size() > max_items ||
      result.missing.size() > max_items)
    throw std::invalid_argument("Gallery result exceeds limits.");
  std::vector<std::uint8_t> out;
  out.reserve(16 + (result.favorites.size() + result.missing.size() + result.matches.size()) * 24);
  put32(out, result_magic);
  put32(out, version);
  put32(out, static_cast<std::uint32_t>(result.favorites.size()));
  for (const auto& id : result.favorites) put_text(out, id, max_id);
  put32(out, static_cast<std::uint32_t>(result.matches.size()));
  for (const auto& match : result.matches) {
    put_text(out, match.photo_id, max_id);
    put_text(out, match.edited_name, max_name);
  }
  put32(out, static_cast<std::uint32_t>(result.missing.size()));
  for (const auto& id : result.missing) put_text(out, id, max_id);
  if (out.size() > max_output) throw std::invalid_argument("Gallery result exceeds the output limit.");
  return out;
}
Result index(const Request& request) {
  if (request.photos.size() > max_items || request.hearts.size() > max_items ||
      request.edited.size() > max_items)
    throw std::invalid_argument("Gallery index exceeds limits.");
  std::unordered_set<std::string> heart_ids;
  heart_ids.reserve(request.hearts.size());
  for (const auto& id : request.hearts) {
    if (id.empty() || id.size() > max_id) throw std::invalid_argument("Gallery heart id is invalid.");
    heart_ids.insert(id);
  }
  std::unordered_map<std::string, std::string> edited_by_stem;
  edited_by_stem.reserve(request.edited.size());
  for (const auto& name : request.edited) {
    const auto key = stem(name);
    if (!edited_by_stem.count(key)) edited_by_stem.emplace(key, name);
  }
  Result result;
  std::unordered_set<std::string> seen;
  seen.reserve(heart_ids.size());
  for (const auto& photo : request.photos) {
    if (photo.id.empty() || photo.id.size() > max_id) throw std::invalid_argument("Gallery photo id is invalid.");
    if (!heart_ids.count(photo.id) || !seen.insert(photo.id).second) continue;
    result.favorites.push_back(photo.id);
    const auto found = edited_by_stem.find(stem(photo.name));
    if (found == edited_by_stem.end()) result.missing.push_back(photo.id);
    else result.matches.push_back({photo.id, found->second});
  }
  return result;
}
}  // namespace lenslabs::gallery
