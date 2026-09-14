#pragma once
// Experimental building blocks only. No V1, export, UI or production dependency.
#include <atomic>
#include <cstdint>
#include <span>
#include <stdexcept>
#include <string>
#include <vector>

namespace lenslabs::canonical_v2 {
inline constexpr auto domain = "sports-canonical-rgba256-v2";
inline constexpr auto resize_version = "integer-area-rgba8-v1";
inline constexpr auto orientation_version = "exif-permute-v1";
inline constexpr std::uint64_t max_pixels = 67108864;
inline constexpr std::uint64_t max_source_bytes = 512ULL * 1024 * 1024;
inline constexpr std::uint32_t max_dimension = 65535;

enum class ErrorCode {
  disabled, cancelled, invalid_source, source_changed, limit_exceeded,
  resource_exhausted, invalid_geometry, invalid_orientation,
  dependency_gate_blocked, unsupported_domain, unsupported_source,
  invalid_jpeg, invalid_icc, unsupported_icc, profile_required, invalid_raw_preview
};
class Error final : public std::runtime_error {
 public:
  Error(ErrorCode code, std::string stage, std::string detail);
  ErrorCode code;
  std::string stage;
};
const char* code_name(ErrorCode) noexcept;

// Off by default. The controller may revoke permission while a stage runs.
// A token cannot grant production qualification; it only controls this experiment.
class Control {
 public:
  explicit Control(bool enabled = false) : enabled_(enabled) {}
  void disable() noexcept { enabled_.store(false); }
  void cancel() noexcept { cancelled_.store(true); }
  void check(const char* stage) const;
 private:
  std::atomic<bool> enabled_;
  std::atomic<bool> cancelled_{false};
};

std::string sha256(std::span<const std::uint8_t>);
struct Geometry { std::uint32_t width, height; };
struct Rgba {
  std::uint32_t width{}, height{};
  std::vector<std::uint8_t> bytes;
};
Geometry target_geometry(std::uint32_t width, std::uint32_t height);
void validate_rgba(const Rgba&);
Rgba resize(const Rgba&, const Control&);
Rgba orient(const Rgba&, unsigned exif, const Control&);
std::string tensor_hash(const Rgba&);

// Only verify_source can construct this immutable full-content snapshot.
class VerifiedSource {
 public:
  std::span<const std::uint8_t> bytes() const noexcept { return bytes_; }
  const std::string& hash() const noexcept { return hash_; }
 private:
  std::vector<std::uint8_t> bytes_;
  std::string hash_;
  friend VerifiedSource verify_source(const std::string&, const Control&);
};
VerifiedSource verify_source(const std::string& path, const Control&);

struct StageReceipt {
  std::string stage, version, sha256;
  std::uint32_t width{}, height{};
};
struct Provenance {
  std::string feature_domain = domain;
  std::string contract_sha256, decoder_version, jpeg_version, color_version;
  std::string source_sha256, jpeg_input_sha256, prepared_preview_sha256;
  std::string input_profile_sha256, output_profile_sha256;
  std::string canonical_output_sha256, canonical_tensor_sha256;
  std::vector<StageReceipt> stages;
  // Neither primitives nor client-supplied receipts can qualify a decoder.
  bool qualified = false;
};
struct Result {
  Rgba canonical;
  Provenance provenance;
  unsigned source_orientation = 1;
  std::string profile_policy;
};
Result canonicalize(const VerifiedSource&, std::span<const std::uint8_t> fixed_profile,
                    const Control&);
} // namespace lenslabs::canonical_v2
