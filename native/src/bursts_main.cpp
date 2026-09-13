#include "lenslabs/bursts.hpp"

#include <exception>
#include <iostream>

int main() {
  try {
    const auto frames = lenslabs::read_burst_protocol(std::cin);
    auto result = lenslabs::burst_review_json(!frames.empty() && frames.front().scene_only
        ? lenslabs::BurstReview{} : lenslabs::group_bursts(frames));
    result.pop_back();
    std::cout << result << ",\"sceneNavigation\":"
              << lenslabs::scene_review_json(lenslabs::group_scene_candidates(frames)) << "}\n";
    return 0;
  } catch (const std::exception& error) {
    // Protocol errors go to stderr, never mixed into a successful JSON receipt.
    std::cerr << "Burst review failed: " << error.what() << '\n';
    return 1;
  }
}
