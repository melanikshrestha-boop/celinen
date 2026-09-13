#pragma once
#include "lenslabs/bursts.hpp"
namespace lenslabs {
struct ShortlistFrame {
  BurstFrame frame;
  bool analysis_available = false, source_available = false, error = false,
       manual_review = false, review_required = false, underexposed = false;
};
struct Shortlist {
  std::vector<std::string> selected_ids, candidate_ids, review_ids;
  std::size_t target_count = 0, shortfall = 0, manual_keeps_over_target = 0;
  std::size_t groups_covered = 0, group_count = 0;
};
Shortlist requested_shortlist(const std::vector<ShortlistFrame>& frames, std::size_t target);
std::pair<std::vector<ShortlistFrame>, std::size_t> read_shortlist_protocol(std::istream& input);
std::string shortlist_json(const Shortlist& result);
}
