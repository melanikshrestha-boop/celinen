#include "lenslabs/pipeline.hpp"
#include <algorithm>
#include <cerrno>
#include <cctype>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <list>
#include <map>
#include <mutex>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <thread>
#include <unordered_map>
#include <sys/stat.h>
#include <unistd.h>

namespace lenslabs {
namespace {
bool cancelled_now(const std::atomic<bool>* flag) {
  return flag && flag->load(std::memory_order_relaxed);
}
SourceFile describe(const std::filesystem::path& path, const std::filesystem::path& root) {
  struct stat info{};
  if (::lstat(path.c_str(), &info) != 0 || !S_ISREG(info.st_mode) || info.st_size < 0)
    throw std::runtime_error("Not a regular source file");
  SourceFile file{path, path.lexically_relative(root).generic_string(),
                 static_cast<std::uintmax_t>(info.st_size), std::filesystem::last_write_time(path)};
  file.device = info.st_dev; file.inode = info.st_ino;
#ifdef __APPLE__
  file.changed_seconds = info.st_ctimespec.tv_sec; file.changed_nanoseconds = info.st_ctimespec.tv_nsec;
#else
  file.changed_seconds = info.st_ctim.tv_sec; file.changed_nanoseconds = info.st_ctim.tv_nsec;
#endif
  return file;
}
void unchanged(const SourceFile& file) {
  const auto current = describe(file.path, file.path.parent_path());
  if (current.bytes != file.bytes || current.modified != file.modified ||
      current.device != file.device || current.inode != file.inode ||
      current.changed_seconds != file.changed_seconds || current.changed_nanoseconds != file.changed_nanoseconds)
    throw std::runtime_error("Source changed after discovery; rescan before processing");
}
struct Cache {
  struct Entry { FrameResult result; std::list<std::string>::iterator position; };
  explicit Cache(std::size_t maximum) : maximum(maximum) {}
  std::size_t maximum;
  std::mutex mutex;
  std::list<std::string> recency;
  std::unordered_map<std::string, Entry> entries;
  bool get(const std::string& key, FrameResult& result) {
    std::lock_guard lock(mutex);
    const auto it = entries.find(key);
    if (it == entries.end()) return false;
    result = it->second.result;
    result.cached = true;
    recency.splice(recency.begin(), recency, it->second.position);
    return true;
  }
  void put(const std::string& key, const FrameResult& result) {
    if (!maximum) return;
    std::lock_guard lock(mutex);
    if (entries.find(key) != entries.end()) return;
    recency.push_front(key);
    try { entries.emplace(key, Entry{result, recency.begin()}); }
    catch (...) { recency.pop_front(); throw; }
    while (entries.size() > maximum) {
      entries.erase(recency.back());
      recency.pop_back();
    }
  }
};
} // namespace

bool supported_extension(const std::filesystem::path& path) {
  auto ext = path.extension().string();
  std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char c) { return std::tolower(c); });
  static const std::vector<std::string> extensions = {
    ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".heic", ".heif", ".webp",
    ".dng", ".nef", ".nrw", ".cr2", ".cr3", ".arw", ".raf", ".orf", ".rw2", ".pef", ".srw"
  };
  return std::find(extensions.begin(), extensions.end(), ext) != extensions.end();
}
Discovery discover(const std::filesystem::path& input, std::size_t limit,
                   const std::atomic<bool>* cancelled) {
  if (!limit || limit > 100000) throw std::invalid_argument("File limit must be 1..100000");
  const auto root = std::filesystem::absolute(input).lexically_normal();
  const auto status = std::filesystem::symlink_status(root);
  if (std::filesystem::is_symlink(status)) throw std::invalid_argument("Choose the actual source, not a symlink");
  Discovery output;
  if (std::filesystem::is_regular_file(status)) {
    if (!supported_extension(root)) throw std::invalid_argument("Unsupported photo extension");
    if (!cancelled_now(cancelled)) output.files.push_back(describe(root, root.parent_path()));
    return output;
  }
  if (!std::filesystem::is_directory(status)) throw std::invalid_argument("Photo or directory does not exist");
  std::vector<std::pair<std::filesystem::path, unsigned>> pending{{root, 0}};
  std::size_t entries_seen = 0;
  while (!pending.empty() && !cancelled_now(cancelled)) {
    auto [directory, depth] = std::move(pending.back());
    pending.pop_back();
    std::error_code ec;
    std::filesystem::directory_iterator iterator(directory, ec), end;
    if (ec) { output.warnings.push_back(directory.string() + ": " + ec.message()); continue; }
    while (iterator != end && !cancelled_now(cancelled)) {
      const auto entry = *iterator;
      if (++entries_seen > 500000) {
        output.truncated = true;
        output.warnings.emplace_back("Entry limit reached; the scan is incomplete");
        pending.clear();
        break;
      }
      const auto state = entry.symlink_status(ec);
      if (ec) output.warnings.push_back(entry.path().string() + ": " + ec.message());
      else if (std::filesystem::is_symlink(state)) ++output.ignored;
      else if (std::filesystem::is_directory(state)) {
        if (depth < 64) pending.emplace_back(entry.path(), depth + 1);
        else { output.truncated = true; output.warnings.push_back(entry.path().string() + ": directory depth limit reached"); }
      } else if (std::filesystem::is_regular_file(state) && supported_extension(entry.path())) {
        if (output.files.size() == limit) {
          output.truncated = true;
          output.warnings.emplace_back("Photo limit reached; the scan is incomplete");
          pending.clear();
          break;
        }
        try { output.files.push_back(describe(entry.path(), root)); }
        catch (const std::exception& error) { output.warnings.push_back(entry.path().string() + ": " + error.what()); }
      } else ++output.ignored;
      iterator.increment(ec);
      if (ec) { output.warnings.push_back(directory.string() + ": " + ec.message()); break; }
    }
  }
  std::sort(output.files.begin(), output.files.end(), [](const auto& a, const auto& b) {
    return a.relative_path < b.relative_path;
  });
  return output;
}

RunStats process(const std::vector<SourceFile>& files, const RunOptions& options,
                 const std::atomic<bool>& cancelled, const Receipt& receipt) {
  if (!options.threads || options.threads > 16 || options.max_edge < 8 || options.max_edge > 4096 ||
      !options.repeat || options.repeat > 1000 || options.cache_entries > 4096 ||
      files.size() > 100000 / options.repeat)
    throw std::invalid_argument("Invalid run limits (threads 1..16, edge 8..4096, repeat 1..1000, at most 100000 operations)");
  RunStats stats;
  stats.unique_inputs = files.size();
  stats.requested = files.size() * options.repeat;
  // Keep the previous conservative admission estimate. Each permit follows its
  // image through decode, the bounded queue, analysis and receipt delivery.
  // Queueing never adds unaccounted images. ImageIO internal memory is additional.
  const std::uint64_t kernel_bytes_per_worker = std::uint64_t{options.max_edge} * options.max_edge * 12;
  const auto affordable_workers = std::max<std::uint64_t>(1, (256ULL * 1024 * 1024) / kernel_bytes_per_worker);
  stats.workers_used = static_cast<unsigned>(std::min<std::uint64_t>({options.threads, affordable_workers, stats.requested}));
  stats.kernel_budget_bytes = stats.workers_used * kernel_bytes_per_worker;
  const bool staged = options.staged && stats.workers_used > 1;
  stats.analysis_workers = staged ? 1 : 0;
  stats.queue_capacity = staged ? stats.workers_used : 0;
  const auto started = std::chrono::steady_clock::now();
  if (files.empty()) { stats.cancelled = cancelled.load(); return stats; }
  std::atomic<std::size_t> cursor{0}, completed{0}, failed{0}, decoded{0}, hits{0};
  std::atomic<bool> stop{false};
  std::mutex first_mutex, failure_mutex;
  std::exception_ptr callback_failure;
  bool saw_first = false;
  Cache cache(options.cache_entries);
  using Clock = std::chrono::steady_clock;
  auto milliseconds = [](auto start) {
    return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
  };
  std::atomic<double> decode_time{0}, analysis_time{0}, queue_time{0}, receipt_time{0};
  auto add_time = [](std::atomic<double>& target, double value) {
    auto previous = target.load(std::memory_order_relaxed);
    while (!target.compare_exchange_weak(previous, previous + value, std::memory_order_relaxed)) {}
  };
  struct Job {
    std::size_t index = 0;
    FrameResult result;
    Image image;
    std::string key;
    Clock::time_point queued;
  };
  // Fixed-capacity ring; permits bound decoding + queued + analyzing images,
  // rather than bounding only the queue and forgetting decoder-owned buffers.
  std::vector<std::optional<Job>> queue(stats.queue_capacity);
  std::mutex queue_mutex;
  std::condition_variable changed;
  std::size_t head = 0, tail = 0, queued = 0, live = 0;
  unsigned producers = stats.workers_used;
  auto stopping = [&] {
    return cancelled.load(std::memory_order_relaxed) || stop.load(std::memory_order_relaxed);
  };
  auto finish = [&](Job& job) {
    auto& result = job.result;
    if (result.error.empty() && result.cached) {
      try { unchanged(result.source); }
      catch (const std::exception& error) { result.error = error.what(); ++failed; }
    }
    if (result.error.empty() && !result.cached) {
      try {
        if (stopping()) return;
        const auto analysis_started = Clock::now();
        try { result.analysis = analyze(job.image); }
        catch (...) {
          add_time(analysis_time, milliseconds(analysis_started));
          throw;
        }
        result.analysis_ms = milliseconds(analysis_started);
        add_time(analysis_time, result.analysis_ms);
        unchanged(result.source);
        ++decoded;
        cache.put(job.key, result);
      } catch (const std::exception& error) {
        result.error = error.what();
        ++failed;
      }
    }
    if (stopping()) return;
    {
      std::lock_guard lock(first_mutex);
      if (!saw_first) {
        stats.first_result_ms = milliseconds(started);
        saw_first = true;
      }
    }
    const auto receipt_started = Clock::now();
    if (receipt) receipt(job.index, result);
    add_time(receipt_time, milliseconds(receipt_started));
    ++completed;
  };
  auto fatal = [&] {
    {
      std::lock_guard lock(failure_mutex);
      if (!callback_failure) callback_failure = std::current_exception();
    }
    stop.store(true, std::memory_order_relaxed);
    changed.notify_all();
  };
  std::vector<std::thread> workers;
  auto work = [&] {
    try {
      while (!stopping()) {
        if (staged) {
          std::unique_lock lock(queue_mutex);
          while (live == stats.workers_used && !stopping())
            changed.wait_for(lock, std::chrono::milliseconds(10));
          if (stopping()) break;
          ++live;
          stats.max_live_images = std::max(stats.max_live_images, live);
        }
        const auto index = cursor.fetch_add(1, std::memory_order_relaxed);
        if (index >= stats.requested) {
          if (staged) { std::lock_guard lock(queue_mutex); --live; changed.notify_all(); }
          break;
        }
        const auto& file = files[index % files.size()];
        Job job;
        job.index = index;
        auto& result = job.result;
        result.source = file;
        try {
          unchanged(file);
          auto& key = job.key;
          key = file.path.string();
          key.push_back('\0');
          key += std::to_string(file.bytes);
          key.push_back('\0');
          const auto ticks = file.modified.time_since_epoch().count();
          // libc++ file_clock may use a 128-bit representation. Keep every bit
          // rather than narrowing timestamps or truncating to whole seconds.
          key.append(reinterpret_cast<const char*>(&ticks), sizeof(ticks));
          key += ":" + std::to_string(file.device) + ":" + std::to_string(file.inode) +
                 ":" + std::to_string(file.changed_seconds) + ":" + std::to_string(file.changed_nanoseconds);
          if (cache.get(key, result)) {
            ++hits;
            // A cache hit does no new decode/analysis. Never replay old timings.
            const auto embedded = result.decode_timings.embedded_raw_jpeg;
            result.decode_timings = {};
            result.decode_timings.embedded_raw_jpeg = embedded;
            result.decode_ms = result.analysis_ms = result.queue_wait_ms = 0;
          }
          else {
            const auto decode_started = Clock::now();
            try { job.image = decode_preview(file.path, options.max_edge, &result.decode_timings); }
            catch (...) {
              add_time(decode_time, milliseconds(decode_started));
              throw;
            }
            result.decode_ms = milliseconds(decode_started);
            add_time(decode_time, result.decode_ms);
            const auto& image = job.image;
            result.width = image.width; result.height = image.height;
            result.source_width = image.source_width; result.source_height = image.source_height;
            unchanged(file);
          }
        } catch (const std::exception& error) {
          result.error = error.what();
          ++failed;
        }
        if (staged) {
          std::lock_guard lock(queue_mutex);
          if (stopping()) { --live; break; }
          job.queued = Clock::now();
          queue[tail].emplace(std::move(job));
          tail = (tail + 1) % queue.size();
          ++queued;
          stats.peak_queued = std::max(stats.peak_queued, queued);
          changed.notify_all();
        } else {
          finish(job);
        }
      }
    } catch (...) { fatal(); }
    if (staged) {
      std::lock_guard lock(queue_mutex);
      --producers;
      changed.notify_all();
    }
  };
  auto consume = [&] {
    try {
      while (!stopping()) {
        std::optional<Job> job;
        {
          std::unique_lock lock(queue_mutex);
          while (!queued && producers && !stopping())
            changed.wait_for(lock, std::chrono::milliseconds(10));
          if (stopping() || !queued) break;
          job = std::move(queue[head]);
          queue[head].reset();
          head = (head + 1) % queue.size();
          --queued;
        }
        job->result.queue_wait_ms = milliseconds(job->queued);
        add_time(queue_time, job->result.queue_wait_ms);
        finish(*job);
        job.reset(); // release RGBA before admitting its replacement
        {
          std::lock_guard lock(queue_mutex);
          --live;
          changed.notify_all();
        }
      }
    } catch (...) { fatal(); }
  };
  try {
    if (staged) workers.emplace_back(consume);
    for (unsigned lane = 0; lane < stats.workers_used; ++lane)
      workers.emplace_back(work);
  } catch (...) {
    stop.store(true);
    changed.notify_all();
    for (auto& thread : workers) thread.join();
    throw;
  }
  for (auto& thread : workers) thread.join();
  if (callback_failure) std::rethrow_exception(callback_failure);
  stats.completed = completed; stats.failed = failed; stats.decoded = decoded; stats.cache_hits = hits;
  stats.cancelled = cancelled.load();
  stats.decode_ms = decode_time.load(); stats.analysis_ms = analysis_time.load();
  stats.queue_wait_ms = queue_time.load(); stats.receipt_ms = receipt_time.load();
  stats.elapsed_ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
  return stats;
}

struct SimilarityIndex::Impl {
  struct Node { std::uint64_t hash; std::vector<std::size_t> ids; std::map<unsigned, std::size_t> children; };
  std::vector<Node> nodes;
};
SimilarityIndex::SimilarityIndex() : impl_(std::make_unique<Impl>()) {}
SimilarityIndex::~SimilarityIndex() = default;
SimilarityIndex::SimilarityIndex(SimilarityIndex&&) noexcept = default;
SimilarityIndex& SimilarityIndex::operator=(SimilarityIndex&&) noexcept = default;
void SimilarityIndex::insert(std::uint64_t hash, std::size_t id) {
  if (!impl_) impl_ = std::make_unique<Impl>();
  if (impl_->nodes.empty()) { impl_->nodes.push_back({hash, {id}, {}}); return; }
  std::size_t at = 0;
  while (true) {
    const auto distance = hamming_distance(hash, impl_->nodes[at].hash);
    if (!distance) { impl_->nodes[at].ids.push_back(id); return; }
    const auto child = impl_->nodes[at].children.find(distance);
    if (child != impl_->nodes[at].children.end()) { at = child->second; continue; }
    const auto next = impl_->nodes.size();
    impl_->nodes.push_back({hash, {id}, {}});
    impl_->nodes[at].children.emplace(distance, next);
    return;
  }
}
std::vector<std::size_t> SimilarityIndex::nearby(std::uint64_t hash, unsigned radius, std::size_t max_hits) const {
  if (radius > 64) throw std::invalid_argument("Hamming radius must be 0..64");
  std::vector<std::size_t> result;
  if (!impl_ || impl_->nodes.empty() || !max_hits) return result;
  std::vector<std::size_t> pending{0};
  while (!pending.empty()) {
    const auto at = pending.back(); pending.pop_back();
    const auto& node = impl_->nodes[at];
    const auto distance = hamming_distance(hash, node.hash);
    if (distance <= radius) {
      const auto count = std::min(node.ids.size(), max_hits - result.size());
      result.insert(result.end(), node.ids.begin(), node.ids.begin() + count);
      if (result.size() == max_hits) break;
    }
    const auto low = distance > radius ? distance - radius : 0;
    const auto high = std::min(64u, distance + radius);
    for (auto child = node.children.lower_bound(low); child != node.children.end() && child->first <= high; ++child)
      pending.push_back(child->second);
  }
  std::sort(result.begin(), result.end());
  return result;
}

namespace {
std::string csv_cell(const std::string& value) {
  if (value.find_first_of("\",\n\r") == std::string::npos) return value;
  std::string out = "\"";
  for (const char c : value) {
    if (c == '"') out += '"';
    out += c;
  }
  return out + '"';
}
const char* verdict_csv(Verdict verdict) {
  switch (verdict) {
    case Verdict::keep: return "keep";
    case Verdict::reject: return "reject";
    case Verdict::undecided: return "undecided";
  }
  return "undecided";
}
}

std::string portable_stem(const std::filesystem::path& path) {
  std::string out;
  for (const unsigned char c : path.filename().stem().generic_string()) {
    if (std::isalnum(c) || c == '-' || c == '_') out += static_cast<char>(c);
    else if (c == ' ' || c == '.') out += '-';
  }
  while (!out.empty() && out.front() == '-') out.erase(out.begin());
  while (!out.empty() && out.back() == '-') out.pop_back();
  if (out.empty()) out = "frame";
  if (out.size() > 64) out.resize(64);
  return out;
}

std::string format_cull_csv(const std::vector<CullSuggestion>& rows) {
  std::string out = "file,score,reason,decision\n";
  for (const auto& row : rows) {
    out += csv_cell(row.relative_path);
    out += ',';
    out += std::to_string(row.score);
    out += ',';
    out += csv_cell(row.reason);
    out += ',';
    out += verdict_csv(row.suggestion);
    out += '\n';
  }
  return out;
}

std::string format_job_json(const std::string& job, const std::string& source,
                            const std::vector<CullSuggestion>& rows, const char* engine,
                            const std::string& created_at) {
  if (job.empty() || job.size() > 160)
    throw std::invalid_argument("Name the job before writing job.json.");
  std::size_t keepers = 0, rejected = 0, review = 0;
  for (const auto& row : rows) {
    if (row.suggestion == Verdict::keep) ++keepers;
    else if (row.suggestion == Verdict::reject) ++rejected;
    else ++review;
  }
  std::string out = "{";
  out += "\"format\":1,\"engine\":";
  out += json_string(engine ? engine : "");
  out += ",\"job\":";
  out += json_string(job);
  out += ",\"source\":";
  out += json_string(source);
  out += ",\"createdAt\":";
  out += json_string(created_at);
  out += ",\"files\":";
  out += std::to_string(rows.size());
  out += ",\"suggestedKeep\":";
  out += std::to_string(keepers);
  out += ",\"suggestedReject\":";
  out += std::to_string(rejected);
  out += ",\"review\":";
  out += std::to_string(review);
  out += ",\"note\":";
  out += json_string("Suggestions only. Originals were not copied, moved, or modified.");
  out += "}\n";
  return out;
}

std::string json_string(const std::string& value) {
  constexpr const char* hex = "0123456789abcdef";
  std::string out = "\"";
  for (const unsigned char c : value) {
    if (c == '"' || c == '\\') { out += '\\'; out += static_cast<char>(c); }
    else if (c < 32) { out += "\\u00"; out += hex[c >> 4]; out += hex[c & 15]; }
    else out += static_cast<char>(c);
  }
  return out + '"';
}
void write_new_file(const std::filesystem::path& destination, const std::vector<std::uint8_t>& bytes) {
  if (bytes.empty()) throw std::invalid_argument("Refusing to write empty image");
  auto parent = destination.parent_path();
  if (parent.empty()) parent = ".";
  auto pattern = (parent / ".lenslabs-export.XXXXXX").string();
  std::vector<char> name(pattern.begin(), pattern.end()); name.push_back('\0');
  int fd = ::mkstemp(name.data());
  if (fd < 0) throw std::runtime_error(std::string("Cannot create export: ") + std::strerror(errno));
  bool closed = false;
  try {
    std::size_t offset = 0;
    while (offset < bytes.size()) {
      const auto written = ::write(fd, bytes.data() + offset, bytes.size() - offset);
      if (written < 0 && errno == EINTR) continue;
      if (written <= 0) throw std::runtime_error("Could not finish writing export");
      offset += static_cast<std::size_t>(written);
    }
    if (::fsync(fd) != 0) throw std::runtime_error("Could not flush export");
    const auto close_result = ::close(fd); closed = true;
    if (close_result != 0) throw std::runtime_error("Could not close export");
    // Atomic no-clobber publish. Existing files and symlinks are never replaced.
    if (::link(name.data(), destination.c_str()) != 0)
      throw std::runtime_error(std::string("Export not published (destination must be new): ") + std::strerror(errno));
    ::unlink(name.data());
  } catch (...) {
    if (!closed) ::close(fd);
    ::unlink(name.data()); // only our newly created private temporary file
    throw;
  }
}
} // namespace lenslabs
