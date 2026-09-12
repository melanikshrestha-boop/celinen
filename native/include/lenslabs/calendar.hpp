#pragma once
#include <cstdint>
#include <string>
#include <vector>
namespace lenslabs::calendar {
constexpr std::uint32_t request_magic = 0x43414C51, result_magic = 0x43414C53, version = 1;
constexpr std::size_t max_items = 2000, max_id = 80, max_title = 200, max_location = 200;
constexpr std::size_t max_notes = 2000, max_pose = 80;
constexpr std::size_t max_input = 2 * 1024 * 1024, max_output = 2 * 1024 * 1024;
struct Event {
  std::string id, title, location, notes, pose;
  std::uint64_t start{};
  std::uint64_t end{};
  bool all_day{};
  std::uint32_t color{};
};
struct Request {
  std::vector<Event> events;
};
using Result = Request;
Request parse(const std::vector<std::uint8_t>& bytes);
std::vector<std::uint8_t> encode(const Result& result);
Result sort(const Request& request);
}
