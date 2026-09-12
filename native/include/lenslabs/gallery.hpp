#pragma once
#include <cstdint>
#include <string>
#include <vector>
namespace lenslabs::gallery {
constexpr std::uint32_t request_magic = 0x47494458, result_magic = 0x474F5554, version = 1;
constexpr std::size_t max_items = 200000, max_id = 80, max_name = 255;
constexpr std::size_t max_input = 32 * 1024 * 1024, max_output = 16 * 1024 * 1024;
struct Photo {
  std::string id, name;
};
struct Request {
  std::vector<Photo> photos;
  std::vector<std::string> hearts;
  std::vector<std::string> edited;
};
struct Match {
  std::string photo_id, edited_name;
};
struct Result {
  std::vector<std::string> favorites;
  std::vector<Match> matches;
  std::vector<std::string> missing;
};
std::string stem(const std::string& name);
Request parse(const std::vector<std::uint8_t>& bytes);
std::vector<std::uint8_t> encode(const Result& result);
Result index(const Request& request);
}
