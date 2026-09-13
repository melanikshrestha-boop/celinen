#pragma once
#include "lenslabs/engine.hpp"
#include <atomic>
#include <functional>
#include <memory>
#include <limits>

namespace lenslabs {
struct SourceFile {
  std::filesystem::path path;
  std::string relative_path;
  std::uintmax_t bytes = 0;
  std::filesystem::file_time_type modified;
  std::uint64_t device = 0, inode = 0;
  std::int64_t changed_seconds = 0, changed_nanoseconds = 0;
};
struct Discovery {
  std::vector<SourceFile> files;
  std::vector<std::string> warnings;
  std::size_t ignored = 0;
  bool truncated = false;
};
bool supported_extension(const std::filesystem::path& path);
Discovery discover(const std::filesystem::path& root, std::size_t limit = 100000,
                   const std::atomic<bool>* cancelled = nullptr);
struct FrameResult {
  SourceFile source;
  Analysis analysis;
  std::uint32_t width = 0, height = 0, source_width = 0, source_height = 0;
  bool cached = false;
  std::string error;
  DecodeTimings decode_timings;
  double decode_ms = 0, analysis_ms = 0, queue_wait_ms = 0;
};
struct RunOptions {
  unsigned threads = 4;
  std::uint32_t max_edge = 256;
  std::size_t cache_entries = 1024;
  std::size_t repeat = 1;
  // Decode workers feed one analysis consumer through preallocated bounded slots.
  // False keeps fused per-worker execution for paired benchmarks.
  bool staged = true;
};
struct RunStats {
  std::size_t unique_inputs = 0, requested = 0, completed = 0, failed = 0;
  std::size_t decoded = 0, cache_hits = 0;
  bool cancelled = false;
  unsigned workers_used = 0;
  double elapsed_ms = 0, first_result_ms = 0;
  unsigned analysis_workers = 0;
  std::size_t queue_capacity = 0, peak_queued = 0, max_live_images = 0;
  std::uint64_t kernel_budget_bytes = 0;
  // Summed wall time across operations, not additive to elapsed time across lanes.
  double decode_ms = 0, analysis_ms = 0, queue_wait_ms = 0, receipt_ms = 0;
};
// Receipts may arrive concurrently. No result is a committed keep/reject.
using Receipt = std::function<void(std::size_t, const FrameResult&)>;
RunStats process(const std::vector<SourceFile>& files, const RunOptions& options,
                 const std::atomic<bool>& cancelled, const Receipt& receipt = {});

// Exact Hamming-radius search. Similarity is a review hint, never identity.
class SimilarityIndex {
public:
  SimilarityIndex();
  ~SimilarityIndex();
  SimilarityIndex(SimilarityIndex&&) noexcept;
  SimilarityIndex& operator=(SimilarityIndex&&) noexcept;
  void insert(std::uint64_t hash, std::size_t id);
  std::vector<std::size_t> nearby(std::uint64_t hash, unsigned radius = 5,
      std::size_t max_hits = std::numeric_limits<std::size_t>::max()) const;
private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};
std::string json_string(const std::string& value);
void write_new_file(const std::filesystem::path& destination,
                    const std::vector<std::uint8_t>& bytes);

struct CullSuggestion {
  std::string relative_path;
  int score = 0;
  Verdict suggestion = Verdict::undecided;
  std::string reason;
};
std::string format_cull_csv(const std::vector<CullSuggestion>& rows);
std::string format_job_json(const std::string& job, const std::string& source,
                            const std::vector<CullSuggestion>& rows, const char* engine,
                            const std::string& created_at);
std::string portable_stem(const std::filesystem::path& path);
} // namespace lenslabs
