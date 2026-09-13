#pragma once

#include "lenslabs/engine.hpp"

#include <cstddef>
#include <cstdint>
#include <istream>
#include <string>
#include <utility>
#include <vector>

namespace lenslabs {

struct BurstFrame {
  std::string id;
  std::uint64_t hash = 0;
  double score = 0;
  double sharpness = 0;
  double brightness = 0;
  std::int64_t capture_time_ms = 0; // EXIF camera clock only; 0 means unknown.
  std::string camera_key; // A device identifier, not merely its shared model name.
  std::string folder;
  Verdict verdict = Verdict::undecided;
  std::string hash_domain = "legacy";
  std::string time_basis = "legacy";
  bool scene_only = false;
};

struct BurstGroup {
  std::string id;
  std::string kind;
  std::vector<std::string> frame_ids;
  std::string recommended_id;
  std::string reason;
  std::string confidence;
  std::int64_t span_ms = 0;
  std::int64_t max_gap_ms = 0;
  unsigned max_hash_distance = 0;
  std::string camera_key;
  std::string folder;
};

struct BurstReview {
  std::vector<BurstGroup> groups;
  std::size_t input_frames = 0;
  std::size_t eligible_frames = 0;
  std::size_t grouped_frames = 0;
  std::size_t comparisons = 0;
};

// Navigation suggestions only: no subject/location recognition or verdicts.
struct SceneCandidate {
  std::vector<std::string> frame_ids;
  std::vector<std::string> possible_visual_outlier_ids;
  std::string reason;
  unsigned hash_distance = 0;
  double brightness_delta = 0;
  std::int64_t gap_ms = 0;
};
std::vector<SceneCandidate> group_scene_candidates(const std::vector<BurstFrame>& frames);
std::string scene_review_json(const std::vector<SceneCandidate>& groups);

// No pixels are decoded here. These conservative review groups use existing native
// analysis receipts; grouping itself never changes a verdict.
BurstReview group_bursts(const std::vector<BurstFrame>& frames);
// Keep one unreviewed frame; reject the other unreviewed members. Existing picks stay.
std::vector<std::pair<std::string, Verdict>> apply_burst_cull(
    const BurstGroup& group, const std::vector<BurstFrame>& frames, const std::string& keep_id);
std::vector<BurstFrame> read_burst_protocol(std::istream& input);
std::string burst_review_json(const BurstReview& review);

} // namespace lenslabs
