#pragma once

#include "lenslabs/engine.hpp"

#include <cstddef>
#include <cstdint>
#include <istream>
#include <string>
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

// No pixels are decoded here. These conservative review groups use existing native
// analysis receipts; no verdict is changed, and the recommendation is not sports AI.
BurstReview group_bursts(const std::vector<BurstFrame>& frames);
std::vector<BurstFrame> read_burst_protocol(std::istream& input);
std::string burst_review_json(const BurstReview& review);

} // namespace lenslabs
