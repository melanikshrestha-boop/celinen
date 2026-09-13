#include "lenslabs/engine.hpp"

#include <algorithm>
#include <bit>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <new>
#include <random>
#include <stdexcept>

// Observe only allocations inside analyze(), excluding caller-owned RGBA.
namespace {
thread_local bool probing = false;
thread_local std::size_t allocated = 0;
}
void* operator new(std::size_t size) {
  if (auto* value = std::malloc(size ? size : 1)) {
    if (probing) allocated += size;
    return value;
  }
  throw std::bad_alloc();
}
void* operator new[](std::size_t size) { return ::operator new(size); }
void operator delete(void* value) noexcept { std::free(value); }
void operator delete[](void* value) noexcept { std::free(value); }
void operator delete(void* value, std::size_t) noexcept { std::free(value); }
void operator delete[](void* value, std::size_t) noexcept { std::free(value); }

namespace {
unsigned checks = 0, failures = 0;
void check(bool okay, const char* message) {
  ++checks;
  if (!okay) { ++failures; std::cerr << "FAIL: " << message << '\n'; }
}
lenslabs::Image fixture(unsigned width, unsigned height, unsigned seed) {
  lenslabs::Image image{width, height, width, height,
    std::vector<std::uint8_t>(std::size_t{width} * height * 4)};
  std::mt19937 random(seed);
  for (auto& value : image.rgba) value = static_cast<std::uint8_t>(random());
  return image;
}

// Frozen full-plane statistics oracle from 1ceac9c, not a rolling-row traversal.
// Exact equality protects threshold-sensitive picks.
lenslabs::Analysis reference(const lenslabs::Image& image) {
  lenslabs::Analysis result;
  const auto pixels = image.rgba.size() / 4;
  std::vector<double> gray(pixels);
  double sum = 0;
  std::size_t high = 0, low = 0;
  for (std::size_t i = 0; i < pixels; ++i) {
    const auto* p = image.rgba.data() + i * 4;
    const double value = (299u * p[0] + 587u * p[1] + 114u * p[2]) / 1000.0;
    gray[i] = value;
    ++result.histogram[static_cast<std::size_t>(std::lround(value))];
    sum += value;
    high += value > 250;
    low += value < 5;
  }
  result.brightness = sum / static_cast<double>(pixels);
  result.clipped_highlights = 100.0 * static_cast<double>(high) / static_cast<double>(pixels);
  result.clipped_shadows = 100.0 * static_cast<double>(low) / static_cast<double>(pixels);
  std::size_t count = 0;
  double mean = 0, deviation = 0;
  for (unsigned y = 1; y + 1 < image.height; ++y) {
    for (unsigned x = 1; x + 1 < image.width; ++x) {
      const auto i = std::size_t{y} * image.width + x;
      const double lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] -
                         gray[i - image.width] - gray[i + image.width];
      const double delta = lap - mean;
      mean += delta / static_cast<double>(++count);
      deviation += delta * (lap - mean);
    }
  }
  result.sharpness = std::max(0.0, deviation / static_cast<double>(count));
  return result;
}

void parity(const lenslabs::Image& image) {
  const auto before = image.rgba;
  const auto expected = reference(image);
  const auto result = lenslabs::analyze(image);
  check(result.histogram == expected.histogram, "exact histogram parity");
  check(result.brightness == expected.brightness, "exact brightness parity");
  check(result.sharpness == expected.sharpness, "exact Welford variance parity");
  check(result.clipped_highlights == expected.clipped_highlights, "exact high clipping parity");
  check(result.clipped_shadows == expected.clipped_shadows, "exact low clipping parity");
  check(image.rgba == before, "source bytes and alpha unchanged");
}

int benchmark(unsigned edge, unsigned iterations) {
  if (edge < 3 || edge > 4096 || iterations < 2 || iterations > 20000)
    throw std::invalid_argument("benchmark expects edge 3..4096 and iterations 2..20000");
  const auto image = fixture(edge, edge, 73019);
  std::vector<double> times;
  times.reserve(iterations);
  std::uint64_t checksum = 0;
  for (unsigned i = 0; i < iterations; ++i) {
    const auto start = std::chrono::steady_clock::now();
    const auto result = lenslabs::analyze(image);
    times.push_back(std::chrono::duration<double, std::milli>(
      std::chrono::steady_clock::now() - start).count());
    checksum ^= result.hash + std::bit_cast<std::uint64_t>(result.sharpness) + i;
  }
  const auto first = times.front();
  std::sort(times.begin() + 1, times.end());
  allocated = 0;
  probing = true;
  (void)lenslabs::analyze(image);
  probing = false;
  std::cout << "edge=" << edge << " iterations=" << iterations << " first_ms=" << first
            << " warm_median_ms=" << times[1 + (iterations - 1) / 2]
            << " scratch_allocation_bytes=" << allocated << " checksum=" << checksum << '\n';
  return 0;
}
}

int main(int argc, char** argv) {
  try {
    if (argc == 4 && std::string(argv[1]) == "--benchmark")
      return benchmark(static_cast<unsigned>(std::stoul(argv[2])),
                       static_cast<unsigned>(std::stoul(argv[3])));
    if (argc != 1) throw std::invalid_argument("unexpected test arguments");
    for (unsigned seed = 0; seed < 160; ++seed)
      parity(fixture(3 + seed % 37, 3 + seed % 41, seed));
    for (const auto& shape : {std::pair{3u, 8192u}, std::pair{8192u, 3u},
                             std::pair{257u, 256u}, std::pair{256u, 257u}})
      parity(fixture(shape.first, shape.second, 71));
    for (unsigned value : {0u, 4u, 5u, 54u, 55u, 128u, 200u, 250u, 251u, 255u}) {
      auto image = fixture(13, 19, value);
      std::fill(image.rgba.begin(), image.rgba.end(), value);
      parity(image);
    }
    // Same width and different heights must have the same bounded scratch use.
    for (unsigned height : {3u, 31u, 4096u}) {
      const auto image = fixture(4096, height, 177);
      allocated = 0;
      probing = true;
      (void)lenslabs::analyze(image);
      probing = false;
      check(allocated <= 3 * 4096 * sizeof(double), "analysis scratch is at most three rows");
    }
  } catch (const std::exception& error) {
    probing = false;
    ++failures;
    std::cerr << error.what() << '\n';
  }
  std::cout << checks << " streaming analysis checks, " << failures << " failures\n";
  return failures ? 1 : 0;
}
