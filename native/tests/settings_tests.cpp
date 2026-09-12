#include "lenslabs/settings.hpp"
#include <iostream>
#include <stdexcept>
using namespace lenslabs::settings;
namespace {
int checks = 0;
void check(bool value) {
  ++checks;
  if (!value) throw std::runtime_error("Settings test failed at check " + std::to_string(checks));
}
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
std::vector<std::uint8_t> packet(const Request& request) {
  std::vector<std::uint8_t> out;
  put32(out, request_magic);
  put32(out, version);
  put32(out, static_cast<std::uint32_t>(request.photos.size()));
  for (const auto& photo : request.photos) {
    put64(out, photo.bytes);
    out.push_back(photo.kept ? 1 : 0);
  }
  return out;
}
}  // namespace
int main() {
  try {
    Request empty;
    auto none = tally(parse(packet(empty)));
    check(none.photos == 0 && none.kept == 0 && none.total_bytes == 0 && none.average_bytes == 0);
    Request request;
    request.photos = {{1'048'576, true}, {2'097'152, false}, {3'145'728, true}};
    auto result = tally(parse(packet(request)));
    check(result.photos == 3 && result.kept == 2);
    check(result.total_bytes == 6'291'456 && result.average_bytes == 2'097'152);
    const auto encoded = encode(result);
    check(encoded.size() == 32);
    bool threw = false;
    try {
      auto bad = packet(request);
      bad[0] = 0;
      parse(bad);
    } catch (...) {
      threw = true;
    }
    check(threw);
    threw = false;
    try {
      Request huge;
      huge.photos.push_back(Photo{(std::uint64_t(1) << 40) + 1, false});
      tally(huge);
    } catch (...) {
      threw = true;
    }
    check(threw);
    std::cout << "settings tests passed (" << checks << " checks)\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << "\n";
    return 1;
  }
}
