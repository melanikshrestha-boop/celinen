#include "lenslabs/gallery.hpp"
#include <iostream>
#include <stdexcept>
using namespace lenslabs::gallery;
namespace {
int checks = 0;
void check(bool value) {
  ++checks;
  if (!value) throw std::runtime_error("Gallery test failed at check " + std::to_string(checks));
}
void put32(std::vector<std::uint8_t>& out, std::uint32_t value) {
  out.push_back(static_cast<std::uint8_t>(value >> 24));
  out.push_back(static_cast<std::uint8_t>(value >> 16));
  out.push_back(static_cast<std::uint8_t>(value >> 8));
  out.push_back(static_cast<std::uint8_t>(value));
}
void put16(std::vector<std::uint8_t>& out, std::uint16_t value) {
  out.push_back(static_cast<std::uint8_t>(value >> 8));
  out.push_back(static_cast<std::uint8_t>(value));
}
void put_text(std::vector<std::uint8_t>& out, const std::string& text) {
  put16(out, static_cast<std::uint16_t>(text.size()));
  out.insert(out.end(), text.begin(), text.end());
}
std::vector<std::uint8_t> packet(const Request& request) {
  std::vector<std::uint8_t> out;
  put32(out, request_magic);
  put32(out, version);
  put32(out, static_cast<std::uint32_t>(request.photos.size()));
  for (const auto& photo : request.photos) {
    put_text(out, photo.id);
    put_text(out, photo.name);
  }
  put32(out, static_cast<std::uint32_t>(request.hearts.size()));
  for (const auto& id : request.hearts) put_text(out, id);
  put32(out, static_cast<std::uint32_t>(request.edited.size()));
  for (const auto& name : request.edited) put_text(out, name);
  return out;
}
}  // namespace
int main() {
  try {
    check(stem("DSC_001.ARW") == "dsc_001");
    check(stem("Keepers.JPG") == "keepers");
    check(stem("noext") == "noext");
    Request request;
    request.photos = {{"a", "DSC_001.ARW"}, {"b", "DSC_002.ARW"}, {"c", "DSC_003.CR3"}};
    request.hearts = {"c", "a", "a", "missing"};
    request.edited = {"dsc_001.jpg", "extra.tif"};
    auto result = index(parse(packet(request)));
    check(result.favorites.size() == 2 && result.favorites[0] == "a" && result.favorites[1] == "c");
    check(result.matches.size() == 1 && result.matches[0].photo_id == "a" &&
          result.matches[0].edited_name == "dsc_001.jpg");
    check(result.missing.size() == 1 && result.missing[0] == "c");
    const auto roundtrip = parse(packet(request));
    check(index(roundtrip).favorites == result.favorites);
    auto encoded = encode(result);
    check(encoded.size() >= 16);
    Request empty;
    auto none = index(parse(packet(empty)));
    check(none.favorites.empty() && none.matches.empty() && none.missing.empty());
    bool threw = false;
    try {
      stem("bad\nname.jpg");
    } catch (...) {
      threw = true;
    }
    check(threw);
    threw = false;
    try {
      auto bad = packet(request);
      bad[0] = 0;
      parse(bad);
    } catch (...) {
      threw = true;
    }
    check(threw);
    Request many;
    many.photos.reserve(4000);
    many.hearts.reserve(2000);
    for (int i = 0; i < 4000; ++i) {
      many.photos.push_back({std::to_string(i), "IMG_" + std::to_string(i) + ".ARW"});
      if (i % 2 == 0) many.hearts.push_back(std::to_string(i));
    }
    many.edited.push_back("img_0.jpg");
    auto fast = index(many);
    check(fast.favorites.size() == 2000 && fast.favorites.front() == "0" && fast.matches.size() == 1);
    std::cerr << checks << " gallery checks passed\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << "\n";
    return 1;
  }
}
