// Private HTTP supervisor; canonical decoder sources and contract remain frozen.
#define CPPHTTPLIB_HEADER_MAX_COUNT 32
#define CPPHTTPLIB_HEADER_MAX_LENGTH 4096
#define CPPHTTPLIB_REQUEST_URI_MAX_LENGTH 256
#include "httplib.h"
#include "lenslabs/canonical_v2.hpp"
#include <atomic>
#include <charconv>
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <fcntl.h>
#include <poll.h>
#include <spawn.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>
#ifdef __linux__
#include <sys/prctl.h>
#endif
namespace v2 = lenslabs::canonical_v2;
namespace fs = std::filesystem;
using Clock = std::chrono::steady_clock;
constexpr size_t upload_limit = 64U * 1024 * 1024;
constexpr size_t response_limit = 1024U * 1024;
constexpr auto temporary_root = "/tmp/lenslab-v2";
constexpr auto fixed_profile = "/opt/lenslab/sRGB2014.icc";
static std::atomic<bool> busy{false};
static std::string executable, credential;
static bool enabled = false;
static constexpr const char* architecture() {
#if defined(__linux__) && defined(__x86_64__)
  return "linux-amd64";
#elif defined(__linux__) && defined(__aarch64__)
  return "linux-arm64";
#else
  return "unqualified-host";
#endif
}

static std::string env(const char* name) {
  const char* value = std::getenv(name); return value ? value : "";
}
static std::string quote(const std::string& s) {
  std::string out = "\"";
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') { out += '\\'; out += c; }
    else if (c >= 32 && c < 127) out += c;
    else out += '?';
  }
  return out + '"';
}
static bool hex(const std::string& s, size_t length) {
  return s.size() == length && s.find_first_not_of("0123456789abcdef") == std::string::npos;
}
static bool authorized(const httplib::Request& request) {
  const auto value = request.get_header_value("X-Native-Authorization");
  if (value.size() != credential.size() || credential.size() != 64) return false;
  unsigned difference = 0;
  for (size_t i = 0; i < value.size(); ++i) difference |= value[i] ^ credential[i];
  return difference == 0;
}
static std::string failure(const char* code, const char* stage = "service") {
  return "{\"status\":\"error\",\"code\":" + quote(code) + ",\"stage\":" + quote(stage) +
    ",\"decoder_domain\":" + quote(v2::domain) + ",\"qualified\":false,\"customer_authority\":false}";
}
static void fail(httplib::Response& response, int status, const char* code) {
  response.status = status; response.set_content(failure(code), "application/json");
}
static std::string base64(std::span<const uint8_t> bytes) {
  constexpr auto table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string output; output.reserve((bytes.size() + 2) / 3 * 4);
  for (size_t i = 0; i < bytes.size(); i += 3) {
    unsigned n = static_cast<unsigned>(bytes[i]) << 16;
    if (i + 1 < bytes.size()) n |= static_cast<unsigned>(bytes[i + 1]) << 8;
    if (i + 2 < bytes.size()) n |= bytes[i + 2];
    output += table[(n >> 18) & 63]; output += table[(n >> 12) & 63];
    output += i + 1 < bytes.size() ? table[(n >> 6) & 63] : '=';
    output += i + 2 < bytes.size() ? table[n & 63] : '=';
  }
  return output;
}
static void limit(int resource, rlim_t value) {
  const rlimit bound{value, value};
  if (setrlimit(resource, &bound) != 0) throw std::runtime_error("resource_limits");
}
// One invocation per image: no shared decoded state, no exports or sidecars.
static int decode(const char* source_path, const char* profile_path, const std::string& expected, bool test_probe) {
  try {
    if (!test_probe) {
      limit(RLIMIT_CPU, 30); limit(RLIMIT_AS, 3ULL * 1024 * 1024 * 1024);
      limit(RLIMIT_FSIZE, response_limit); limit(RLIMIT_NOFILE, 32); limit(RLIMIT_CORE, 0);
#ifdef __linux__
      if (prctl(PR_SET_PDEATHSIG, SIGKILL) != 0 || getppid() == 1) return 1;
#endif
    }
    v2::Control control(true);
    const auto source = v2::verify_source(source_path, control);
    if (!expected.empty() && source.hash() != expected) {
      std::cout << failure("source_hash_mismatch", "source") << '\n'; return 1;
    }
    const auto profile = v2::verify_source(profile_path, control);
    const auto result = v2::canonicalize(source, profile.bytes(), control);
    const auto& p = result.provenance;
    std::cout << "{\"status\":\"ok\",\"qualified\":false,\"customer_authority\":false,\"domain\":" << quote(p.feature_domain)
      << ",\"decoder_domain\":" << quote(p.feature_domain) << ",\"decoder_version\":" << quote(p.decoder_version)
      << ",\"architecture\":" << quote(architecture()) << ",\"contract\":" << quote(p.contract_sha256) << ",\"source\":" << quote(p.source_sha256)
      << ",\"preview\":" << quote(p.prepared_preview_sha256) << ",\"jpeg\":" << quote(p.jpeg_input_sha256)
      << ",\"input_profile\":" << quote(p.input_profile_sha256) << ",\"output_profile\":" << quote(p.output_profile_sha256)
      << ",\"profile_policy\":" << quote(result.profile_policy) << ",\"orientation\":" << result.source_orientation
      << ",\"canonical\":" << quote(p.canonical_output_sha256) << ",\"tensor\":" << quote(p.canonical_tensor_sha256) << ",\"stages\":[";
    bool first = true;
    for (const auto& stage : p.stages) {
      if (!first) std::cout << ','; first = false;
      std::cout << "{\"stage\":" << quote(stage.stage) << ",\"version\":" << quote(stage.version)
        << ",\"width\":" << stage.width << ",\"height\":" << stage.height << ",\"sha256\":" << quote(stage.sha256) << '}';
    }
    std::cout << ']';
    if (!test_probe) std::cout << ",\"image\":{\"width\":" << result.canonical.width << ",\"height\":" << result.canonical.height
      << ",\"format\":\"RGBA8\",\"encoding\":\"base64\",\"data\":" << quote(base64(result.canonical.bytes)) << '}';
    std::cout << "}\n"; return 0;
  } catch (const v2::Error& error) {
    std::cout << failure(v2::code_name(error.code), error.stage.c_str()) << '\n'; return 1;
  } catch (const std::bad_alloc&) { std::cout << failure("resource_exhausted") << '\n'; return 1; }
  catch (...) { std::cout << failure("internal_error") << '\n'; return 1; }
}
struct Temporary {
  fs::path directory;
  int fd = -1;
  Temporary() {
    std::string pattern = std::string(temporary_root) + "/job-XXXXXX";
    char* path = mkdtemp(pattern.data());
    if (!path) throw std::runtime_error("temporary_storage");
    directory = path;
    fd = open((directory / "source").c_str(), O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (fd < 0) { fs::remove(directory); throw std::runtime_error("temporary_storage"); }
  }
  void seal() {
    if (fchmod(fd, 0400) != 0) throw std::runtime_error("temporary_storage");
    close(fd); fd = -1;
  }
  ~Temporary() {
    if (fd >= 0) close(fd);
    std::error_code ec; fs::remove(directory / "source", ec); fs::remove(directory, ec);
  }
};
struct ChildResult { std::string body; int status = 200; long peak_kib = 0; };
static ChildResult process(const httplib::Request& request, const fs::path& input, const std::string& hash) {
  int pipes[2];
  if (pipe(pipes) != 0) return {failure("resource_exhausted"), 503};
  fcntl(pipes[0], F_SETFD, FD_CLOEXEC); fcntl(pipes[1], F_SETFD, FD_CLOEXEC);
  posix_spawn_file_actions_t actions; posix_spawn_file_actions_init(&actions);
  posix_spawn_file_actions_adddup2(&actions, pipes[1], STDOUT_FILENO);
  posix_spawn_file_actions_addopen(&actions, STDERR_FILENO, "/dev/null", O_WRONLY, 0);
  posix_spawn_file_actions_addclose(&actions, pipes[0]);
  posix_spawn_file_actions_addclose(&actions, pipes[1]);
  const std::string path = input.string();
  char* args[] = {executable.data(), const_cast<char*>("--decode"), const_cast<char*>(path.c_str()),
    const_cast<char*>(fixed_profile), const_cast<char*>(hash.c_str()), nullptr};
  pid_t child = -1;
  char* child_env[] = {const_cast<char*>("LC_ALL=C"), const_cast<char*>("LANG=C"), nullptr};
  const int spawn_error = posix_spawn(&child, executable.c_str(), &actions, nullptr, args, child_env);
  posix_spawn_file_actions_destroy(&actions); close(pipes[1]);
  if (spawn_error) { close(pipes[0]); return {failure("resource_exhausted"), 503}; }
  fcntl(pipes[0], F_SETFL, O_NONBLOCK);
  const auto start = Clock::now();
  ChildResult result; int status = 0; rusage usage{}; bool done = false;
  auto abort = [&](const char* code, int http) {
    kill(child, SIGKILL); while (wait4(child, &status, 0, &usage) < 0 && errno == EINTR) {}
    result.body = failure(code); result.status = http; done = true;
  };
  for (;;) {
    if (Clock::now() - start > std::chrono::seconds(45)) { abort("processing_timeout", 504); break; }
    if (request.is_connection_closed()) { abort("cancelled", 499); break; }
    char buffer[8192]; ssize_t n;
    while ((n = read(pipes[0], buffer, sizeof(buffer))) > 0) {
      result.body.append(buffer, static_cast<size_t>(n));
      if (result.body.size() > response_limit) { abort("invalid_worker_output", 502); break; }
    }
    if (done) break;
    const auto waited = wait4(child, &status, WNOHANG, &usage);
    if (waited == child) {
      while ((n = read(pipes[0], buffer, sizeof(buffer))) > 0) result.body.append(buffer, static_cast<size_t>(n));
      if (result.body.size() > response_limit || result.body.empty()) { result.body = failure("worker_failed"); result.status = 502; }
      else if (!WIFEXITED(status)) { result.body = failure("resource_exhausted"); result.status = 503; }
      else if (WEXITSTATUS(status) != 0) result.status = 422;
      break;
    }
    if (waited < 0 && errno != EINTR) { abort("worker_failed", 502); break; }
    pollfd descriptor{pipes[0], POLLIN, 0}; poll(&descriptor, 1, 25);
  }
  close(pipes[0]); result.peak_kib = usage.ru_maxrss; return result;
}
static void prepare_temporary_root() {
  if (mkdir(temporary_root, 0700) != 0 && errno != EEXIST) throw std::runtime_error("temporary_storage");
  struct stat info{};
  if (lstat(temporary_root, &info) != 0 || !S_ISDIR(info.st_mode) || info.st_uid != getuid() || (info.st_mode & 077) != 0)
    throw std::runtime_error("temporary_storage");
  // The container never mounts originals. Only this service owns this fixed root.
  // Restart cleanup is bounded to generated job directories and their one source.
  for (const auto& entry : fs::directory_iterator(temporary_root)) {
    const auto name = entry.path().filename().string();
    if (name.size() != 10 || name.rfind("job-", 0) != 0 || !fs::is_directory(entry.symlink_status()))
      throw std::runtime_error("unexpected_temporary_entry");
    std::error_code ec; fs::remove(entry.path() / "source", ec); fs::remove(entry.path(), ec);
    if (ec) throw std::runtime_error("temporary_cleanup_failed");
  }
}
int main(int argc, char** argv) {
  if (argc == 5 && std::string(argv[1]) == "--decode") return decode(argv[2], argv[3], argv[4], false);
  // Packaging parity uses the same service-linked decoder, without HTTP or pixels.
  if (argc == 4 && std::string(argv[1]) == "--experimental-v2") return decode(argv[2], argv[3], "", true);
  if (argc == 2 && std::string(argv[1]) == "--healthcheck") {
    httplib::Client client("127.0.0.1", 8080); client.set_read_timeout(2);
    const auto response = client.Get("/health"); return response && response->status == 200 ? 0 : 1;
  }
  if (argc != 1) return 2;
  signal(SIGPIPE, SIG_IGN); umask(0077);
  credential = env("LENSLABS_NATIVE_TOKEN");
  enabled = env("LENSLABS_CANONICAL_V2_ENABLED") == "true";
  if (!hex(credential, 64)) { std::cerr << failure("auth_not_configured") << '\n'; return 2; }
  executable = fs::canonical(argv[0]).string();
  try {
    prepare_temporary_root();
    v2::Control check(true); const auto profile = v2::verify_source(fixed_profile, check);
    if (profile.hash() != "384b832de3412066743b52a75ee906b6fb9fb8d9e09e936fc2c43223815c6e0a") return 2;
  } catch (...) { std::cerr << failure("startup_failed") << '\n'; return 2; }
  httplib::Server server;
  server.new_task_queue = [] { return new httplib::ThreadPool(2, 2, 4); };
  server.set_payload_max_length(upload_limit).set_read_timeout(5).set_write_timeout(5).set_keep_alive_max_count(1);
  server.set_default_headers({{"Cache-Control", "no-store"}, {"X-Content-Type-Options", "nosniff"}});
  server.set_expect_100_continue_handler([](const auto&, auto&) { return 417; });
  server.set_error_handler([](const auto&, auto& response) {
    if (response.body.empty()) fail(response, response.status, response.status == 413 ? "file_too_large" : "invalid_request");
  });
  server.set_exception_handler([](const auto&, auto& response, std::exception_ptr) { fail(response, 500, "internal_error"); });
  server.Get("/health", [](const auto&, auto& response) {
    response.set_content(std::string("{\"status\":\"ok\",\"decoder_domain\":\"sports-canonical-rgba256-v2\",\"architecture\":") + quote(architecture()) + "}", "application/json");
  });
  server.Get("/ready", [](const auto&, auto& response) {
    response.set_content(std::string("{\"ready\":true,\"enabled\":") + (enabled ? "true" : "false") +
      ",\"capacity\":" + (busy ? "0" : "1") + ",\"customer_authority\":false}", "application/json");
  });
  server.Post("/v2/decode", [](const httplib::Request& request, httplib::Response& response, const httplib::ContentReader& reader) {
    if (!authorized(request)) { fail(response, 401, "unauthorized"); return; }
    if (!enabled) { fail(response, 503, "disabled"); return; }
    const auto job = request.get_header_value("X-Job-Id"), hash = request.get_header_value("X-Source-Sha256");
    const auto length = request.get_header_value("Content-Length"); size_t expected = 0;
    const auto parsed = std::from_chars(length.data(), length.data() + length.size(), expected);
    if (!hex(job, 32) || !hex(hash, 64) || parsed.ec != std::errc{} || parsed.ptr != length.data() + length.size() || !expected ||
      request.has_header("Transfer-Encoding") || request.has_header("Content-Encoding") ||
      request.get_header_value("Content-Type") != "application/octet-stream") { fail(response, 400, "invalid_request"); return; }
    if (expected > upload_limit) { fail(response, 413, "file_too_large"); return; }
    bool available = false;
    if (!busy.compare_exchange_strong(available, true)) { fail(response, 429, "busy"); return; }
    struct Lease { ~Lease() { busy = false; } } lease;
    const auto start = Clock::now();
    Temporary temporary; size_t received = 0; bool expired = false, disk_error = false;
    const bool read_ok = reader([&](const char* data, size_t size) {
      expired = Clock::now() - start > std::chrono::seconds(20);
      if (expired || size > expected - received) return false;
      while (size) {
        const auto n = write(temporary.fd, data, size);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) { disk_error = true; return false; }
        data += n; size -= n; received += n;
      }
      return true;
    });
    if (!read_ok || received != expected) {
      fail(response, expired ? 408 : disk_error ? 507 : 400, expired ? "upload_timeout" : disk_error ? "temporary_storage_full" : "incomplete_upload"); return;
    }
    temporary.seal();
    const auto result = process(request, temporary.directory / "source", hash);
    response.status = result.status; response.set_content(result.body, "application/json");
    response.set_header("X-Job-Id", job); response.set_header("X-Peak-Memory-KiB", std::to_string(result.peak_kib));
    const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - start).count();
    response.set_header("X-Processing-Ms", std::to_string(elapsed));
    std::cout << "{\"event\":\"v2_job_completed\",\"job_id\":" << quote(job) << ",\"status\":" << result.status
      << ",\"processing_ms\":" << elapsed << ",\"peak_memory_kib\":" << result.peak_kib
      << ",\"decoder_domain\":\"sports-canonical-rgba256-v2\"}" << std::endl;
  });
  std::cout << "{\"event\":\"v2_worker_started\",\"enabled\":" << (enabled ? "true" : "false") << "}" << std::endl;
  return server.listen("0.0.0.0", 8080) ? 0 : 1;
}
