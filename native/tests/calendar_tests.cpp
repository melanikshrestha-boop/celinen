#include "lenslabs/calendar.hpp"
#include <iostream>
#include <stdexcept>
using namespace lenslabs::calendar;
namespace {
int checks = 0;
void check(bool value) {
  ++checks;
  if (!value) throw std::runtime_error("Calendar test failed at check " + std::to_string(checks));
}
}  // namespace
int main() {
  try {
    Request request;
    request.events = {
        {"b", "Later", "Park", "", "walk", 200, 300, false, 0xff3b30},
        {"a", "Earlier", "Studio", "notes", "", 100, 150, false, 0x007aff},
    };
    auto packed = encode(request);
    packed[0] = static_cast<std::uint8_t>(request_magic >> 24);
    packed[1] = static_cast<std::uint8_t>(request_magic >> 16);
    packed[2] = static_cast<std::uint8_t>(request_magic >> 8);
    packed[3] = static_cast<std::uint8_t>(request_magic);
    auto sorted = sort(parse(packed));
    check(sorted.events.size() == 2);
    check(sorted.events[0].id == "a" && sorted.events[0].title == "Earlier");
    check(sorted.events[0].location == "Studio");
    check(sorted.events[1].id == "b" && sorted.events[1].pose == "walk");
    Request empty;
    check(sort(empty).events.empty());
    bool threw = false;
    try {
      auto bad = packed;
      bad[0] = 0;
      parse(bad);
    } catch (...) {
      threw = true;
    }
    check(threw);
    std::cout << "calendar tests passed (" << checks << " checks)\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << "\n";
    return 1;
  }
}
