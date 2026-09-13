#include "lenslabs/pipeline.hpp"
#include "lenslabs/worker.hpp"
#include <algorithm>
#include <charconv>
#include <chrono>
#include <cmath>
#include <csignal>
#include <ctime>
#include <iomanip>
#include <iostream>
#include <locale>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <sys/resource.h>
#include <thread>

namespace {
std::atomic<bool> cancelled{false};
static_assert(std::atomic<bool>::is_always_lock_free, "Signal cancellation must be lock-free");
using namespace lenslabs;
std::size_t integer(const std::string& text) {
  std::size_t value = 0;
  const auto result = std::from_chars(text.data(), text.data() + text.size(), value);
  if (result.ec != std::errc{} || result.ptr != text.data() + text.size())
    throw std::invalid_argument("Invalid whole-number option: " + text);
  return value;
}
double decimal(const std::string& text) {
  std::istringstream stream(text);
  stream.imbue(std::locale::classic());
  double value = 0;
  stream >> std::noskipws >> value;
  if (!stream || !stream.eof() || !std::isfinite(value))
    throw std::invalid_argument("Invalid finite adjustment: " + text);
  return value;
}
double peak_rss_mb() {
  rusage usage{};
  if (getrusage(RUSAGE_SELF, &usage) != 0) return 0;
#ifdef __APPLE__
  return static_cast<double>(usage.ru_maxrss) / (1024 * 1024);
#else
  return static_cast<double>(usage.ru_maxrss) / 1024;
#endif
}
void help() {
  std::cout <<
    "LensLabs C++ preview engine (macOS; no Python runtime)\n"
    "  lenslabs-native scan PATH [--threads 1..16] [--edge 8..4096]\n"
    "      [--cache-entries 0..4096] [--repeat 1..1000] [--max-files 1..100000] [--quiet] [--fused]\n"
    "  lenslabs-native render INPUT OUTPUT.jpg [--edge 1600] [--quality 0.9]\n"
    "      [--exposure -5..5] [--contrast -100..100] [--highlights -100..100]\n"
    "      [--shadows -100..100] [--saturation -100..100]\n"
    "  lenslabs-native ingest PATH --job NAME --out DIR [--cull auto] [--export proof]\n"
    "      [--threads 1..16] [--edge 8..4096] [--max-files 1..100000]\n"
    "  lenslabs-native --version\n\n"
    "  lenslabs-native worker  (private local transport IPC; LENS1 framing)\n\n"
    "Scan emits NDJSON suggestions, never changes picks or files. Ctrl-C stops scheduling.\n"
    "Ingest writes NEW cull.csv + job.json suggestions into --out. Originals are not copied.\n"
    "--export proof writes NEW 2048px JPEGs of suggested keepers under out/proof/ (max 200).\n"
    "Workers are also capped by a 256 MiB kernel-buffer estimate (OS decoding uses extra memory).\n"
    "Staged scans add one analysis consumer with shared image permits; --fused compares the old per-worker path.\n"
    "stage_sum_ms adds per-operation times across lanes, not disjoint wall-clock phases.\n"
    "Render writes a NEW bounded-resolution JPEG, never overwrites an existing path.\n"
    "RAW support depends on this macOS ImageIO version; this is not a full RAW editor.\n"
    "--repeat measures repeated work on the SAME inputs, not more unique photos.\n";
}
int scan(int argc, char** argv) {
  if (argc < 3) throw std::invalid_argument("scan requires a photo or folder");
  RunOptions options;
  options.threads = std::clamp(std::thread::hardware_concurrency(), 1u, 4u);
  bool quiet = false;
  std::size_t max_files = 100000;
  for (int i = 3; i < argc; ++i) {
    const std::string option = argv[i];
    if (option == "--quiet") { quiet = true; continue; }
    if (option == "--fused") { options.staged = false; continue; }
    if (i + 1 == argc) throw std::invalid_argument("Missing value for " + option);
    const auto value = integer(argv[++i]);
    if (option == "--threads") {
      if (!value || value > 16) throw std::invalid_argument("threads must be 1..16");
      options.threads = static_cast<unsigned>(value);
    } else if (option == "--edge") {
      if (value < 8 || value > 4096) throw std::invalid_argument("edge must be 8..4096");
      options.max_edge = static_cast<std::uint32_t>(value);
    } else if (option == "--cache-entries") options.cache_entries = value;
    else if (option == "--repeat") options.repeat = value;
    else if (option == "--max-files") max_files = value;
    else throw std::invalid_argument("Unknown scan option: " + option);
  }
  if (!options.repeat || options.repeat > 1000 || options.cache_entries > 4096 ||
      !max_files || max_files > 100000)
    throw std::invalid_argument("repeat must be 1..1000, cache-entries 0..4096, max-files 1..100000");
  const auto started = std::chrono::steady_clock::now();
  auto found = discover(argv[2], max_files, &cancelled);
  const double discovery_ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
  for (const auto& warning : found.warnings)
    std::cout << "{\"event\":\"warning\",\"message\":" << json_string(warning) << "}\n";
  if (!quiet)
    std::cout << "{\"event\":\"start\",\"engine\":" << json_string(engine_version)
              << ",\"decoder\":" << json_string(decoder_name()) << ",\"files\":" << found.files.size()
              << ",\"threads\":" << options.threads << ",\"analysis_edge\":" << options.max_edge << "}\n";
  std::mutex output_mutex;
  SimilarityIndex similarities;
  std::size_t similar_hints = 0;
  auto stats = process(found.files, options, cancelled, [&](std::size_t index, const FrameResult& result) {
    std::lock_guard lock(output_mutex);
    std::vector<std::size_t> similar;
    // Repeated benchmark operations must not masquerade as new similar photos.
    // Very dark/flat images have ambiguous hashes; do not group those by hash.
    if (!quiet && result.error.empty() && index < found.files.size() &&
        result.analysis.sharpness >= 40 && result.analysis.brightness >= 10 &&
        result.analysis.brightness <= 245) {
      similar = similarities.nearby(result.analysis.hash, 5, 33);
      similarities.insert(result.analysis.hash, index);
      if (!similar.empty()) ++similar_hints;
    }
    if (quiet) return;
    std::cout << "{\"event\":\"frame\",\"index\":" << index
              << ",\"path\":" << json_string(result.source.relative_path)
              << ",\"cached\":" << (result.cached ? "true" : "false");
    if (!result.error.empty()) {
      std::cout << ",\"error\":" << json_string(result.error) << ",\"suggestion\":\"undecided\"}\n";
      return;
    }
    const auto& a = result.analysis;
    std::ostringstream hash;
    hash << std::hex << std::setw(16) << std::setfill('0') << a.hash;
    std::cout << ",\"width\":" << result.width << ",\"height\":" << result.height
              << ",\"source_width\":" << result.source_width << ",\"source_height\":" << result.source_height
              << ",\"sharpness\":" << a.sharpness << ",\"brightness\":" << a.brightness
              << ",\"clipped_highlights\":" << a.clipped_highlights << ",\"clipped_shadows\":" << a.clipped_shadows
              << ",\"score\":" << a.score << ",\"hash\":" << json_string(hash.str())
              << ",\"suggestion\":" << json_string(verdict_name(first_pass(a)))
              << ",\"review_required\":true,\"similarity_truncated\":" << (similar.size() > 32 ? "true" : "false")
              << ",\"similar_to\":[";
    for (std::size_t n = 0; n < std::min<std::size_t>(32, similar.size()); ++n) {
      if (n) std::cout << ',';
      std::cout << similar[n];
    }
    std::cout << "]}\n" << std::flush;
  });
  const double total_ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
  std::cout << "{\"event\":\"summary\",\"engine\":" << json_string(engine_version)
            << ",\"unique_inputs\":" << stats.unique_inputs << ",\"requested_operations\":" << stats.requested
            << ",\"completed\":" << stats.completed << ",\"failed\":" << stats.failed
            << ",\"decoded\":" << stats.decoded << ",\"cache_hits\":" << stats.cache_hits
            << ",\"similarity_hints\":" << similar_hints
            << ",\"similarity_evaluated\":" << (quiet ? "false" : "true")
            << ",\"cancelled\":" << (stats.cancelled ? "true" : "false")
            << ",\"truncated\":" << (found.truncated ? "true" : "false")
            << ",\"threads\":" << options.threads << ",\"edge\":" << options.max_edge
            << ",\"workers_used\":" << stats.workers_used
            << ",\"analysis_workers\":" << stats.analysis_workers
            << ",\"queue_capacity\":" << stats.queue_capacity << ",\"peak_queued\":" << stats.peak_queued
            << ",\"max_live_images\":" << stats.max_live_images
            << ",\"kernel_budget_bytes\":" << stats.kernel_budget_bytes
            << ",\"stage_sum_ms\":{\"decode\":" << stats.decode_ms
            << ",\"analysis\":" << stats.analysis_ms << ",\"queue_wait\":" << stats.queue_wait_ms
            << ",\"receipt\":" << stats.receipt_ms << "}"
            << ",\"discovery_ms\":" << discovery_ms << ",\"processing_ms\":" << stats.elapsed_ms
            << ",\"first_result_ms\":" << (stats.completed ? discovery_ms + stats.first_result_ms : 0)
            << ",\"total_ms\":" << total_ms
            << ",\"operations_per_second\":" << (total_ms > 0 ? stats.completed * 1000 / total_ms : 0)
            << ",\"peak_rss_mb\":" << peak_rss_mb()
            << ",\"repeat_is_not_unique_shoot\":" << (options.repeat > 1 ? "true" : "false") << "}\n";
  return stats.cancelled ? 130 : (stats.failed || found.truncated || !found.warnings.empty() || found.files.empty() ? 2 : 0);
}
std::string utc_stamp() {
  const auto now = std::chrono::system_clock::to_time_t(std::chrono::system_clock::now());
  std::tm utc{};
  gmtime_r(&now, &utc);
  std::ostringstream stamp;
  stamp << std::put_time(&utc, "%Y-%m-%dT%H:%M:%SZ");
  return stamp.str();
}
std::string suggestion_reason(const FrameResult& result) {
  if (!result.error.empty()) return "unreadable";
  const auto verdict = first_pass(result.analysis);
  if (verdict == Verdict::keep) return "keep";
  if (result.analysis.blur) return "blur";
  if (result.analysis.score < 45) return "low-score";
  return "review";
}
std::vector<std::uint8_t> utf8_bytes(const std::string& text) {
  return {text.begin(), text.end()};
}
int ingest(int argc, char** argv) {
  if (argc < 3) throw std::invalid_argument("ingest requires a photo or folder");
  std::string job;
  std::filesystem::path out;
  bool export_proof = false;
  RunOptions options;
  options.threads = std::clamp(std::thread::hardware_concurrency(), 1u, 4u);
  std::size_t max_files = 100000;
  for (int i = 3; i < argc; ++i) {
    const std::string option = argv[i];
    if (i + 1 == argc) throw std::invalid_argument("Missing value for " + option);
    const std::string value = argv[++i];
    if (option == "--job") job = value;
    else if (option == "--out") out = value;
    else if (option == "--export") {
      if (value != "proof") throw std::invalid_argument("export must be proof");
      export_proof = true;
    } else if (option == "--cull") {
      if (value != "auto") throw std::invalid_argument("cull must be auto");
    } else if (option == "--threads") {
      const auto threads = integer(value);
      if (!threads || threads > 16) throw std::invalid_argument("threads must be 1..16");
      options.threads = static_cast<unsigned>(threads);
    } else if (option == "--edge") {
      const auto edge = integer(value);
      if (edge < 8 || edge > 4096) throw std::invalid_argument("edge must be 8..4096");
      options.max_edge = static_cast<std::uint32_t>(edge);
    } else if (option == "--max-files") max_files = integer(value);
    else throw std::invalid_argument("Unknown ingest option: " + option);
  }
  if (job.empty() || out.empty()) throw std::invalid_argument("ingest requires --job and --out");
  if (!max_files || max_files > 100000)
    throw std::invalid_argument("max-files must be 1..100000");
  auto found = discover(argv[2], max_files, &cancelled);
  std::vector<CullSuggestion> rows(found.files.size());
  std::mutex output_mutex;
  auto stats = process(found.files, options, cancelled, [&](std::size_t index, const FrameResult& result) {
    CullSuggestion row;
    row.relative_path = result.source.relative_path;
    row.score = result.error.empty() ? result.analysis.score : 0;
    row.suggestion = result.error.empty() ? first_pass(result.analysis) : Verdict::undecided;
    row.reason = suggestion_reason(result);
    std::lock_guard lock(output_mutex);
    if (index < rows.size()) rows[index] = std::move(row);
  });
  if (cancelled.load()) return 130;
  std::filesystem::create_directories(out);
  const auto csv = format_cull_csv(rows);
  const auto json = format_job_json(job, std::filesystem::absolute(argv[2]).generic_string(), rows,
                                    engine_version, utc_stamp());
  write_new_file(out / "cull.csv", utf8_bytes(csv));
  write_new_file(out / "job.json", utf8_bytes(json));
  std::size_t proofs = 0, proof_failures = 0;
  if (export_proof) {
    std::filesystem::create_directories(out / "proof");
    for (std::size_t i = 0; i < rows.size() && proofs < 200; ++i) {
      if (cancelled.load()) return 130;
      if (i >= found.files.size() || rows[i].suggestion != Verdict::keep) continue;
      try {
        const auto image = decode_preview(found.files[i].path, 2048);
        if (cancelled.load()) return 130;
        const auto jpeg = encode_jpeg(image, 0.92);
        std::ostringstream name;
        name << std::setfill('0') << std::setw(3) << (proofs + 1) << '_'
             << portable_stem(found.files[i].path) << ".jpg";
        write_new_file(out / "proof" / name.str(), jpeg);
        ++proofs;
      } catch (const std::exception&) {
        if (cancelled.load()) return 130;
        ++proof_failures;
      }
    }
  }
  std::cout << "{\"event\":\"ingest\",\"job\":" << json_string(job)
            << ",\"out\":" << json_string(out.generic_string())
            << ",\"files\":" << rows.size()
            << ",\"completed\":" << stats.completed
            << ",\"failed\":" << stats.failed
            << ",\"proofs\":" << proofs
            << ",\"proof_failures\":" << proof_failures
            << ",\"note\":\"Suggestions only. Originals were not copied.\"}\n";
  return stats.failed || found.truncated || found.files.empty() || proof_failures ? 2 : 0;
}
int render_file(int argc, char** argv) {
  if (argc < 4) throw std::invalid_argument("render requires an input and a NEW output.jpg");
  const std::filesystem::path output = argv[3];
  auto extension = output.extension().string();
  std::transform(extension.begin(), extension.end(), extension.begin(), [](unsigned char c) { return std::tolower(c); });
  if (extension != ".jpg" && extension != ".jpeg") throw std::invalid_argument("Preview output must be JPEG (.jpg or .jpeg)");
  if (std::filesystem::exists(std::filesystem::symlink_status(output)))
    throw std::invalid_argument("Output already exists; originals and prior exports are never replaced");
  std::uint32_t edge = 1600;
  double quality = 0.9;
  Edits edits;
  for (int i = 4; i < argc; ++i) {
    const std::string option = argv[i];
    if (i + 1 == argc) throw std::invalid_argument("Missing value for " + option);
    const std::string value = argv[++i];
    if (option == "--edge") {
      const auto size = integer(value);
      if (size < 8 || size > 4096) throw std::invalid_argument("edge must be 8..4096");
      edge = static_cast<std::uint32_t>(size);
    } else if (option == "--exposure") edits.exposure_ev = decimal(value);
    else if (option == "--contrast") edits.contrast = decimal(value);
    else if (option == "--highlights") edits.highlights = decimal(value);
    else if (option == "--shadows") edits.shadows = decimal(value);
    else if (option == "--saturation") edits.saturation = decimal(value);
    else if (option == "--quality") quality = decimal(value);
    else throw std::invalid_argument("Unknown render option: " + option);
  }
  if (std::abs(edits.exposure_ev) > 5 || std::abs(edits.contrast) > 100 ||
      std::abs(edits.highlights) > 100 || std::abs(edits.shadows) > 100 ||
      std::abs(edits.saturation) > 100 || quality < 0 || quality > 1)
    throw std::invalid_argument("Exposure must be -5..5 EV, tone controls -100..100, JPEG quality 0..1");
  const auto started = std::chrono::steady_clock::now();
  const auto decoded = decode_preview(argv[2], edge);
  const auto edited = render(decoded, edits);
  if (cancelled.load()) return 130;
  const auto jpeg = encode_jpeg(edited, quality);
  if (cancelled.load()) return 130;
  write_new_file(output, jpeg);
  std::cout << "{\"event\":\"rendered\",\"output\":" << json_string(output.string())
            << ",\"width\":" << edited.width << ",\"height\":" << edited.height
            << ",\"bytes\":" << jpeg.size() << ",\"preview_only\":true,\"original_untouched\":true"
            << ",\"elapsed_ms\":" << std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now()-started).count() << "}\n";
  return 0;
}
} // namespace
int main(int argc, char** argv) {
  // The transport cancels workers with SIGTERM. Do not install scan's
  // cooperative cancellation handlers on a process blocked on IPC input.
  if (argc > 1 && std::string(argv[1]) == "worker") {
    if (argc != 2) { std::cerr << "worker does not accept command-line options\n"; return 1; }
    return lenslabs::run_worker(std::cin, std::cout);
  }
  std::signal(SIGINT, [](int) { cancelled.store(true, std::memory_order_relaxed); });
  std::signal(SIGTERM, [](int) { cancelled.store(true, std::memory_order_relaxed); });
  std::cout.imbue(std::locale::classic());
  std::cout << std::fixed << std::setprecision(3);
  try {
    if (argc == 1 || std::string(argv[1]) == "--help") { help(); return 0; }
    const std::string command = argv[1];
    if (command == "--version") { std::cout << lenslabs::engine_version << '\n'; return 0; }
    if (command == "scan" || command == "inspect") return scan(argc, argv);
    if (command == "ingest") return ingest(argc, argv);
    if (command == "render") return render_file(argc, argv);
    throw std::invalid_argument("Unknown command; use --help");
  } catch (const std::exception& error) {
    std::cerr << "{\"event\":\"error\",\"message\":" << lenslabs::json_string(error.what()) << "}\n";
    return 1;
  }
}
