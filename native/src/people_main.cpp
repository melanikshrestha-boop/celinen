#include "lenslabs/people.hpp"

#include <exception>
#include <iostream>

int main() {
  try {
    const auto faces = lenslabs::read_people_protocol(std::cin);
    std::cout << lenslabs::people_review_json(lenslabs::cluster_people(faces)) << '\n';
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "People matching failed: " << error.what() << '\n';
    return 1;
  }
}
