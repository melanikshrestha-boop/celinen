#pragma once
#include <cstdint>
#include <vector>
namespace lenslabs::settings {
constexpr std::uint32_t request_magic = 0x53455454, result_magic = 0x53524553, version = 1;
constexpr std::size_t max_items = 200000, max_input = 2 * 1024 * 1024, max_output = 64;
struct Photo {
  std::uint64_t bytes{};
  bool kept{};
};
struct Request {
  std::vector<Photo> photos;
};
struct Result {
  std::uint32_t photos{};
  std::uint32_t kept{};
  std::uint64_t total_bytes{};
  std::uint64_t average_bytes{};
};
Request parse(const std::vector<std::uint8_t>& bytes);
std::vector<std::uint8_t> encode(const Result& result);
Result tally(const Request& request);
}
