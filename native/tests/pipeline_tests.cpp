#include "lenslabs/pipeline.hpp"
#include <algorithm>
#include <atomic>
#include <fstream>
#include <iostream>
#include <iterator>
#include <random>
#include <stdexcept>
#include <thread>
#include <unistd.h>

namespace {
unsigned checks = 0, failures = 0;
std::atomic<unsigned> decode_calls{0};
void check(bool condition, const char* label) {
  ++checks;
  if (!condition) { ++failures; std::cerr << "FAIL: " << label << '\n'; }
}
template<class F> void throws(F&& fn, const char* label) {
  bool caught = false;
  try { fn(); } catch (const std::exception&) { caught = true; }
  check(caught, label);
}
struct Temp {
  std::filesystem::path path;
  Temp() {
    char pattern[] = "/tmp/lenslabs-cpp-test.XXXXXX";
    const auto created = ::mkdtemp(pattern);
    if (!created) throw std::runtime_error("mkdtemp failed");
    path = created;
  }
  ~Temp() { std::error_code ec; std::filesystem::remove_all(path, ec); }
};
void seed(const std::filesystem::path& path, const std::string& value = "source") {
  std::ofstream stream(path, std::ios::binary);
  stream << value;
  if (!stream) throw std::runtime_error("Cannot seed isolated test fixture");
}
std::string read(const std::filesystem::path& path) {
  std::ifstream stream(path, std::ios::binary);
  return {std::istreambuf_iterator<char>(stream), {}};
}
} // namespace

// Deterministic test decoder. Pipeline tests do not need OS image decoding.
namespace lenslabs {
Image decode_preview(const std::filesystem::path& path, std::uint32_t) {
  ++decode_calls;
  if (path.filename() == "bad.jpg") throw std::runtime_error("Injected decode failure");
  Image image{8, 8, 80, 80, std::vector<std::uint8_t>(8 * 8 * 4, 255)};
  for (unsigned y = 0; y < 8; ++y) for (unsigned x = 0; x < 8; ++x)
    for (unsigned c = 0; c < 3; ++c) image.rgba[(y * 8 + x) * 4 + c] = (x+y)%2 ? 20 : 180;
  return image;
}
} // namespace lenslabs

int main() {
  using namespace lenslabs;
  try {
    Temp temp;
    std::filesystem::create_directory(temp.path / "nested");
    seed(temp.path / "a.jpg");
    seed(temp.path / "b.PNG");
    seed(temp.path / "nested" / "a.jpg");
    seed(temp.path / "ignored.xmp");
    std::filesystem::create_directory_symlink(temp.path, temp.path / "nested" / "cycle");
    std::filesystem::create_symlink(temp.path / "a.jpg", temp.path / "alias.jpg");
    auto found = discover(temp.path);
    check(found.files.size() == 3, "recursive scan includes nested photos only");
    check(found.ignored == 3, "symlinks and nonphoto sidecars are skipped");
    check(found.warnings.empty() && !found.truncated, "ordinary scan complete");
    check(found.files[2].relative_path == "nested/a.jpg", "relative paths preserved");
    check(discover(temp.path, 2).truncated, "limits explicitly report incomplete scan");
    throws([&] { discover(temp.path, 0); }, "zero file limit refused");
    throws([&] { discover(temp.path / "missing"); }, "missing root refused");
    throws([&] { discover(temp.path / "alias.jpg"); }, "symlink root refused");
    throws([&] { discover(temp.path / "ignored.xmp"); }, "unsupported single file refused");
    check(discover(temp.path / "a.jpg").files.size() == 1, "single file scan");
    check(supported_extension("FRAME.NEF"), "RAW extension recognized without claiming decode support");
    check(!supported_extension("script.svg"), "active/vector content not scanned as photo");
    std::atomic<bool> cancelled{false};
    cancelled = true;
    check(discover(temp.path, 100, &cancelled).files.empty(), "scan cancellation before first entry");
    cancelled = false;

    RunOptions options;
    options.threads = 1;
    options.repeat = 4;
    options.cache_entries = 8;
    std::vector<FrameResult> receipts;
    decode_calls = 0;
    auto stats = process(found.files, options, cancelled, [&](std::size_t, const auto& result) { receipts.push_back(result); });
    check(stats.completed == 12 && stats.failed == 0, "all operations complete");
    check(stats.decoded == 3 && stats.cache_hits == 9 && decode_calls == 3, "bounded cache reuses analysis");
    check(stats.unique_inputs == 3 && stats.requested == 12, "repeat distinguished from unique photos");
    check(receipts[0].width == 8 && receipts[0].source_width == 80, "source and preview sizes distinct");
    check(!receipts[0].cached && receipts[3].cached, "per-frame cache receipt accurate");
    check(stats.elapsed_ms >= stats.first_result_ms, "first result timing within run");
    options.cache_entries = 0;
    stats = process(found.files, options, cancelled);
    check(stats.decoded == 12 && stats.cache_hits == 0, "cache can be disabled for honest decode benchmark");
    options.cache_entries = 2;
    stats = process(found.files, options, cancelled);
    check(stats.decoded == 12 && stats.cache_hits == 0, "LRU entry cap enforced");
    options.threads = 4;
    options.cache_entries = 8;
    stats = process(found.files, options, cancelled);
    check(stats.completed == 12 && stats.decoded + stats.cache_hits == 12, "parallel work accounted once");
    cancelled = true;
    stats = process(found.files, options, cancelled);
    check(stats.cancelled && stats.completed == 0, "cancelled run does no decode");
    cancelled = false;
    options.threads = 1;
    stats = process(found.files, options, cancelled, [&](std::size_t, const auto&) { cancelled = true; });
    check(stats.cancelled && stats.completed == 1, "cancel stops scheduling after current receipt");
    cancelled = false;
    throws([&] { process(found.files, options, cancelled, [](std::size_t, const auto&) { throw std::runtime_error("receipt failure"); }); }, "callback exception joins workers and propagates");
    options.threads = 0;
    throws([&] { process(found.files, options, cancelled); }, "zero workers refused");
    options.threads = 17;
    throws([&] { process(found.files, options, cancelled); }, "unbounded workers refused");
    options.threads = 1;
    options.repeat = 0;
    throws([&] { process(found.files, options, cancelled); }, "zero repeat refused");
    options.repeat = 1;
    options.max_edge = 0;
    throws([&] { process(found.files, options, cancelled); }, "invalid edge refused");
    options.max_edge = 256;
    check(process({}, options, cancelled).completed == 0, "empty batch safe");
    options.max_edge = 4096;
    options.threads = 16;
    stats = process(found.files, options, cancelled);
    check(stats.workers_used == 1, "large working images reduce concurrency under joint buffer budget");
    options.max_edge = 256;
    options.threads = 1;

    seed(temp.path / "bad.jpg");
    auto with_error = discover(temp.path);
    stats = process(with_error.files, options, cancelled);
    check(stats.failed == 1 && stats.completed == 4, "one damaged photo does not abort shoot");
    auto changing = discover(temp.path / "a.jpg");
    seed(temp.path / "a.jpg", "source changed");
    stats = process(changing.files, options, cancelled);
    check(stats.failed == 1 && stats.decoded == 0, "changed source is refused before decode");
    check(read(temp.path / "a.jpg") == "source changed", "processing does not modify source");
    auto same_size = discover(temp.path / "a.jpg");
    const auto mtime = std::filesystem::last_write_time(temp.path / "a.jpg");
    seed(temp.path / "a.jpg", "SOURCE CHANGED");
    std::filesystem::last_write_time(temp.path / "a.jpg", mtime);
    stats = process(same_size.files, options, cancelled);
    check(stats.failed == 1 && stats.decoded == 0, "ctime detects equal-length replacement with restored mtime");
    auto replaced = discover(temp.path / "a.jpg");
    std::filesystem::rename(temp.path / "a.jpg", temp.path / "retired.jpg");
    seed(temp.path / "a.jpg", "SOURCE CHANGED");
    std::filesystem::last_write_time(temp.path / "a.jpg", mtime);
    stats = process(replaced.files, options, cancelled);
    check(stats.failed == 1 && stats.decoded == 0, "inode identity prevents replaced-path cache confusion");

    SimilarityIndex index;
    std::vector<std::uint64_t> hashes;
    std::mt19937_64 random(12345);
    for (std::size_t i = 0; i < 500; ++i) {
      hashes.push_back(i < 20 ? 0 : random());
      index.insert(hashes.back(), i);
    }
    for (unsigned radius : {0u, 1u, 5u, 16u, 32u, 64u}) {
      for (unsigned trial = 0; trial < 20; ++trial) {
        const auto query = trial % 2 ? random() : hashes[trial];
        std::vector<std::size_t> expected;
        for (std::size_t i = 0; i < hashes.size(); ++i)
          if (hamming_distance(query, hashes[i]) <= radius) expected.push_back(i);
        check(index.nearby(query, radius) == expected, "Hamming tree equals brute force");
      }
    }
    check(index.nearby(0, 0).size() == 20, "identical hashes retain all candidate IDs");
    check(index.nearby(0, 0, 3).size() == 3, "similarity receipts can bound identical-hash bursts");
    check(index.nearby(0, 64, 0).empty(), "zero candidate limit performs no traversal");
    check(index.nearby(0, 64, 33).size() == 33, "bounded broad-radius queries cap candidates");
    throws([&] { index.nearby(0, 65); }, "invalid similarity radius refused");
    SimilarityIndex moved(std::move(index));
    check(moved.nearby(0, 0).size() == 20 && index.nearby(0).empty(), "move-safe similarity index");
    index.insert(123, 999);
    check(index.nearby(123, 0) == std::vector<std::size_t>{999}, "moved-from index reusable");

    check(json_string("a\"b\\c\n\t") == "\"a\\\"b\\\\c\\u000a\\u0009\"", "NDJSON controls escaped");
    check(json_string("é") == "\"é\"", "UTF-8 paths preserved");
    const std::vector<std::uint8_t> bytes = {'J', 'P', 'E', 'G'};
    const auto output = temp.path / "new.jpg";
    write_new_file(output, bytes);
    check(read(output) == "JPEG", "new output published completely");
    throws([&] { write_new_file(output, {'n', 'o'}); }, "existing output not overwritten");
    check(read(output) == "JPEG", "existing output bytes preserved");
    throws([&] { write_new_file(temp.path / "alias.jpg", bytes); }, "symlink output refused");
    throws([&] { write_new_file(temp.path / "empty.jpg", {}); }, "empty export refused");
    throws([&] { write_new_file(temp.path / "missing" / "x.jpg", bytes); }, "missing output directory reported");
    bool leftover = false;
    for (const auto& entry : std::filesystem::directory_iterator(temp.path))
      if (entry.path().filename().string().starts_with(".lenslabs-export.")) leftover = true;
    check(!leftover, "private export temporary files cleaned up on success/failure");
  } catch (const std::exception& error) {
    ++failures; std::cerr << "Unexpected test exception: " << error.what() << '\n';
  }
  std::cout << checks << " pipeline checks, " << failures << " failures\n";
  return failures ? 1 : 0;
}
