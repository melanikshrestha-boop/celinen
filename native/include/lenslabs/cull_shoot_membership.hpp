#pragma once
#include <array>
#include <cstdint>
#include <string>
#include <vector>

// Shoot membership: "is this frame part of this shoot?"
//
// A shoot has a fingerprint, and it is set by the majority of its own frames:
// which bodies and lenses were used, when, at what image sizes, under what file
// naming, and roughly what the scenes look like. A frame that disagrees with
// that fingerprint on several independent counts — no camera data, a size no
// camera writes, a date years away, a name like "images (3).jpg" — was almost
// certainly dropped in from somewhere else.
//
// Multi-camera shoots are the normal case, not the exception: two bodies, a
// second shooter, phone B-roll. So a single disagreement never flags a frame.
// Every family of evidence contributes log-odds; a camera that shot a real share
// of the shoot, or shot inside its time span, is part of the fingerprint; and
// the thresholds are set so that only combined, strong evidence produces an
// "outsider".
namespace lenslabs {

struct CullMembershipInput {
  bool has_exif = false;
  std::string make, model, serial, lens, software; // lowercased; empty when absent
  double capture_time_ms = -1;                     // <0 when absent
  std::uint32_t width = 0, height = 0;             // the original's pixel size
  std::string file_name;                           // base name as imported
  bool has_look = false;                           // colour/hash were measured
  std::array<std::uint8_t, 48> color{};            // 4x4 mean RGB from the reading
  std::uint64_t hash = 0;                          // perceptual hash from the reading
  bool invalid = false; // failed the validity gate: never part of the fingerprint
};

enum class CullMembershipState : std::uint8_t { member, suspect, outsider };

// Evidence families, as bits so a frame can carry several.
enum CullMembershipEvidence : std::uint32_t {
  membership_no_camera_data = 1u << 0,
  membership_different_camera = 1u << 1,
  membership_time_outlier = 1u << 2,
  membership_download_size = 1u << 3,
  membership_name_pattern = 1u << 4,
  membership_look = 1u << 5,
  membership_editing_software = 1u << 6,
};

struct CullMembership {
  CullMembershipState state = CullMembershipState::member;
  double confidence = 0;       // that the frame does NOT belong, 0..1
  std::uint32_t evidence = 0;  // CullMembershipEvidence bits
  // Plain English, strongest evidence first ("No camera data · Downloaded image
  // size"). Empty for a member.
  std::string reason;
  // Signed distance from the shoot's own time span, ms; 0 inside it or unknown.
  double time_offset_ms = 0;
};

struct CullMembershipOptions {
  double suspect_at = .5;
  double outsider_at = .85;
};

std::vector<CullMembership> assess_shoot_membership(const std::vector<CullMembershipInput>& frames,
                                                    const CullMembershipOptions& options = {});

const char* cull_membership_state_name(CullMembershipState state) noexcept;

// "_DSC1234.JPG" -> "_dsc#4"; "IMG_20240501_101112.jpg" -> "img_#8_#6". Exposed
// for tests.
std::string cull_name_pattern(const std::string& file_name);

// "3 years", "5 months", "2 days", "6 hours". Exposed for tests.
std::string cull_describe_duration(double ms);

} // namespace lenslabs
