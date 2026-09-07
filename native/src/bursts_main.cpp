#include "lenslabs/bursts.hpp"

#include <exception>
#include <iostream>

int main() {
  try {
    const auto frames = lenslabs::read_burst_protocol(std::cin);
    std::cout << lenslabs::burst_review_json(lenslabs::group_bursts(frames)) << '\n';
    return 0;
  } catch (const std::exception& error) {
    // Protocol errors go to stderr, never mixed into a successful JSON receipt.
    std::cerr << "Burst review failed: " << error.what() << '\n';
    return 1;
  }
}
