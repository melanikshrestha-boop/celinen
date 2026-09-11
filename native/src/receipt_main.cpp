#include "lenslabs/receipt.hpp"
#include <array>
#include <iostream>
int main() {
  try {
    std::vector<std::uint8_t> bytes;
    std::array<char,1024> chunk{};
    while (std::cin) {
      std::cin.read(chunk.data(),chunk.size());
      const auto count = static_cast<std::size_t>(std::cin.gcount());
      if (bytes.size() + count > lenslabs::receipt::max_input) throw std::runtime_error("Receipt input exceeds limit.");
      bytes.insert(bytes.end(),chunk.data(),chunk.data() + count);
    }
    if (std::cin.bad()) throw std::runtime_error("Receipt input failed.");
    std::cout << lenslabs::receipt::json(lenslabs::receipt::render(lenslabs::receipt::parse(bytes)));
    return std::cout ? 0 : 1;
  } catch (...) { std::cerr << "Receipt request rejected.\n"; return 1; }
}
