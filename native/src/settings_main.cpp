#include "lenslabs/settings.hpp"
#include <array>
#include <iostream>
int main() {
  try {
    std::vector<std::uint8_t> bytes;
    std::array<char, 4096> chunk{};
    while (std::cin) {
      std::cin.read(chunk.data(), chunk.size());
      const auto count = static_cast<std::size_t>(std::cin.gcount());
      if (bytes.size() + count > lenslabs::settings::max_input)
        throw std::runtime_error("Settings input exceeds limit.");
      bytes.insert(bytes.end(), chunk.data(), chunk.data() + count);
    }
    if (std::cin.bad()) throw std::runtime_error("Settings input failed.");
    const auto out = lenslabs::settings::encode(lenslabs::settings::tally(lenslabs::settings::parse(bytes)));
    std::cout.write(reinterpret_cast<const char*>(out.data()), std::streamsize(out.size()));
    return std::cout ? 0 : 1;
  } catch (...) {
    std::cerr << "Settings tally rejected.\n";
    return 1;
  }
}
