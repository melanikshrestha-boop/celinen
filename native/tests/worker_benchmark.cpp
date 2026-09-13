#include "lenslabs/pipeline.hpp"
#include "lenslabs/worker.hpp"

#include <algorithm>
#include <array>
#include <charconv>
#include <chrono>
#include <cmath>
#include <iostream>
#include <locale>
#include <sstream>
#include <stdexcept>
#include <sys/resource.h>

namespace {
unsigned integer(const char* text, unsigned low, unsigned high) {
  const std::string value(text);
  unsigned result = 0;
  const auto parsed = std::from_chars(value.data(), value.data() + value.size(), result);
  if (parsed.ec != std::errc{} || parsed.ptr != value.data() + value.size() || result < low || result > high)
    throw std::invalid_argument("Benchmark argument outside supported limits");
  return result;
}
double number(const std::string& header, const std::string& key) {
  const auto marker = '"' + key + "\":";
  const auto at = header.find(marker);
  if (at == std::string::npos) return 0; // older worker baseline has no stage fields
  const auto result = std::stod(header.substr(at + marker.size()));
  if (!std::isfinite(result) || result < 0) throw std::runtime_error("Invalid benchmark receipt");
  return result;
}
}

int main(int argc, char** argv) {
  try {
    if (argc < 2 || argc > 4)
      throw std::invalid_argument("Usage: worker-benchmark PATH [repeat 1..1000] [edge 8..2048]");
    const auto repeat = argc >= 3 ? integer(argv[2], 1, 1000) : 1;
    const auto edge = argc >= 4 ? integer(argv[3], 8, 2048) : 1280;
    const auto found = lenslabs::discover(argv[1]);
    if (found.truncated || !found.warnings.empty() || found.files.empty() || found.files.size() > 100000 / repeat)
      throw std::invalid_argument("Benchmark requires a complete, nonempty discovery and at most 100000 operations");
    constexpr std::array<const char*, 9> stages{
      "decode_total", "source_open", "raw_extract", "imageio_decode_resize", "rgba",
      "analysis_resize", "analysis", "metadata", "jpeg_encode"};
    std::array<double, stages.size()> summed{};
    std::vector<double> elapsed;
    elapsed.reserve(found.files.size() * repeat);
    std::uint64_t checksum = 1469598103934665603ULL;
    const auto started = std::chrono::steady_clock::now();
    for (unsigned pass = 0; pass < repeat; ++pass) for (const auto& file : found.files) {
      std::string wire = "LENS1 " + std::to_string(edge) + ' ';
      constexpr char hex[] = "0123456789abcdef";
      for (const unsigned char c : file.path.string()) { wire += hex[c >> 4]; wire += hex[c & 15]; }
      wire += '\n';
      std::istringstream input(wire);
      std::ostringstream output;
      if (lenslabs::run_worker(input, output) != 0) throw std::runtime_error("Worker failed benchmark request");
      const auto bytes = output.str();
      const auto newline = bytes.find('\n');
      const auto header = bytes.substr(0, newline);
      if (newline == std::string::npos || header.find("\"ok\":true") == std::string::npos ||
          bytes.size() - newline - 1 != number(header, "preview_bytes"))
        throw std::runtime_error("Worker returned an error or invalid frame: " + header);
      elapsed.push_back(number(header, "elapsed_ms"));
      for (std::size_t i = 0; i < stages.size(); ++i) summed[i] += number(header, stages[i]);
      // Exact JPEG bytes, all analysis statistics, tone and capture metadata;
      // exclude timing/provenance prefixes and elapsed suffix for old/new parity.
      const auto payload = bytes.substr(newline + 1);
      const auto content_begin = header.find("\"width\":");
      const auto content_end = header.find(",\"elapsed_ms\":");
      if (content_begin == std::string::npos || content_end == std::string::npos)
        throw std::runtime_error("Missing benchmark content fields");
      for (const unsigned char c : header.substr(content_begin, content_end - content_begin)) {
        checksum ^= c; checksum *= 1099511628211ULL;
      }
      for (const unsigned char c : payload) { checksum ^= c; checksum *= 1099511628211ULL; }
    }
    const auto total = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
    const auto first = elapsed.front();
    std::sort(elapsed.begin(), elapsed.end());
    rusage usage{};
    getrusage(RUSAGE_SELF, &usage);
    std::cout.imbue(std::locale::classic());
    std::cout << "{\"unique_inputs\":" << found.files.size() << ",\"operations\":" << elapsed.size()
      << ",\"repeat\":" << repeat << ",\"edge\":" << edge << ",\"first_worker_ms\":" << first
      << ",\"median_worker_ms\":" << elapsed[elapsed.size() / 2]
      << ",\"total_ms\":" << total << ",\"operations_per_second\":" << elapsed.size() * 1000 / total
      << ",\"peak_rss_mb\":" << usage.ru_maxrss / (1024.0 * 1024.0)
      << ",\"content_checksum\":" << checksum << ",\"stage_sum_ms\":{";
    for (std::size_t i = 0; i < stages.size(); ++i) {
      if (i) std::cout << ',';
      std::cout << '"' << stages[i] << "\":" << summed[i];
    }
    std::cout << "},\"stages_available\":" << (summed[0] > 0 ? "true" : "false")
      << ",\"boundary\":\"single-worker in-memory IPC, source OS cache uncontrolled; repeated inputs are not a unique shoot; decoder substages include metadata and must not be added to decode_total\"}\n";
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
