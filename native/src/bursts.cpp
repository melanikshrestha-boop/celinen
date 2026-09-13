#include "lenslabs/bursts.hpp"

#include <algorithm>
#include <bit>
#include <charconv>
#include <cmath>
#include <deque>
#include <iomanip>
#include <limits>
#include <locale>
#include <sstream>
#include <stdexcept>
#include <string_view>
#include <tuple>
#include <unordered_map>
#include <unordered_set>
#include <utility>

namespace lenslabs {
namespace {

constexpr std::size_t max_frames = 100000;
constexpr std::size_t max_group = 24;
constexpr std::size_t max_anchors = 32;
constexpr std::int64_t max_gap = 1500;
constexpr std::int64_t max_span = 6000;
constexpr unsigned hash_radius = 8;

bool valid_utf8(std::string_view text) {
  for (std::size_t i = 0; i < text.size();) {
    const auto lead = static_cast<unsigned char>(text[i++]);
    if (lead < 0x80) {
      if (lead < 0x20 || lead == 0x7f) return false;
      continue;
    }
    unsigned count = 0;
    std::uint32_t value = 0;
    std::uint32_t minimum = 0;
    if (lead >= 0xc2 && lead <= 0xdf) { count = 1; value = lead & 0x1f; minimum = 0x80; }
    else if (lead >= 0xe0 && lead <= 0xef) { count = 2; value = lead & 0x0f; minimum = 0x800; }
    else if (lead >= 0xf0 && lead <= 0xf4) { count = 3; value = lead & 0x07; minimum = 0x10000; }
    else return false;
    if (i + count > text.size()) return false;
    while (count--) {
      const auto next = static_cast<unsigned char>(text[i++]);
      if ((next & 0xc0) != 0x80) return false;
      value = (value << 6) | (next & 0x3f);
    }
    if (value < minimum || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return false;
  }
  return true;
}

void validate(const BurstFrame& frame) {
  if ((frame.hash_domain != "legacy" && frame.hash_domain != "native-cpp" && frame.hash_domain != "browser" && frame.hash_domain != "unknown") ||
      (frame.time_basis != "legacy" && frame.time_basis != "utc" && frame.time_basis != "camera_clock" && frame.time_basis != "unknown"))
    throw std::invalid_argument("Invalid scene evidence domain");
  if (frame.id.empty() || frame.id.size() > 512 || !valid_utf8(frame.id) ||
      frame.camera_key.size() > 4096 || !valid_utf8(frame.camera_key) ||
      frame.folder.size() > 4096 || !valid_utf8(frame.folder)) {
    throw std::invalid_argument("Invalid burst frame identity");
  }
  if (!std::isfinite(frame.score) || frame.score < 0 || frame.score > 100 ||
      !std::isfinite(frame.sharpness) || frame.sharpness < 0 || frame.sharpness > 1e12 ||
      !std::isfinite(frame.brightness) || frame.brightness < 0 || frame.brightness > 255 ||
      frame.capture_time_ms < 0 || frame.capture_time_ms > 8640000000000000LL ||
      (frame.verdict != Verdict::undecided && frame.verdict != Verdict::keep &&
       frame.verdict != Verdict::reject)) {
    throw std::invalid_argument("Invalid burst analysis receipt");
  }
}

bool usable(const BurstFrame& frame) {
  const auto bits = std::popcount(frame.hash);
  return bits >= 4 && bits <= 60 && frame.brightness > 5 && frame.brightness < 250;
}

std::string quote(std::string_view text) {
  std::string out = "\"";
  for (const auto value : text) {
    if (value == '\\' || value == '"') out += '\\';
    out += value;
  }
  return out + '"';
}

unsigned distance(std::uint64_t a, std::uint64_t b, BurstReview& result) {
  ++result.comparisons;
  return static_cast<unsigned>(std::popcount(a ^ b));
}

struct WorkingGroup {
  std::vector<const BurstFrame*> frames;
  unsigned max_distance = 0;
  std::int64_t max_gap_ms = 0;
};

void append_group(const WorkingGroup& source, bool timed, BurstReview& result) {
  if (source.frames.size() < 2) return;
  BurstGroup group;
  group.kind = timed ? "burst" : "similar";
  group.id = group.kind + ":" + source.frames.front()->id;
  group.folder = source.frames.front()->folder;
  group.camera_key = timed ? source.frames.front()->camera_key : "";
  group.confidence = timed ? "camera-time-and-appearance" : "appearance-only";
  group.reason = timed
      ? "Same camera and folder, close capture times, and similar native preview hashes. Review action and expression yourself."
      : "Similar native preview hashes in the same folder. Missing camera identity or capture time; this is not a confirmed burst.";
  group.span_ms = timed ? source.frames.back()->capture_time_ms - source.frames.front()->capture_time_ms : 0;
  group.max_gap_ms = source.max_gap_ms;
  group.max_hash_distance = source.max_distance;
  const BurstFrame* best = nullptr;
  for (const auto* frame : source.frames) {
    group.frame_ids.push_back(frame->id);
    // Never recommend overriding an explicit rejection. Existing keepers stay
    // visible; the quality suggestion does not privilege or modify any verdict.
    if (frame->verdict == Verdict::reject) continue;
    if (!best || frame->score > best->score ||
        (frame->score == best->score && frame->sharpness > best->sharpness) ||
        (frame->score == best->score && frame->sharpness == best->sharpness && frame->id < best->id)) best = frame;
  }
  if (best) group.recommended_id = best->id;
  result.grouped_frames += group.frame_ids.size();
  result.groups.push_back(std::move(group));
}

std::string read_line(std::istream& input) {
  std::string line;
  line.reserve(512);
  char c;
  while (input.get(c)) {
    if (c == '\n') return line;
    if (line.size() >= 18000) throw std::invalid_argument("Burst protocol line too large");
    line += c;
  }
  if (!line.empty()) return line;
  throw std::invalid_argument("Incomplete burst protocol");
}

std::string unhex(const std::string& text, std::size_t limit, bool optional) {
  if (optional && text == "-") return {};
  if (text.empty() || text.size() % 2 || text.size() / 2 > limit) throw std::invalid_argument("Invalid burst identity encoding");
  auto nibble = [](char c) -> unsigned {
    if (c >= '0' && c <= '9') return static_cast<unsigned>(c - '0');
    if (c >= 'a' && c <= 'f') return static_cast<unsigned>(c - 'a' + 10);
    if (c >= 'A' && c <= 'F') return static_cast<unsigned>(c - 'A' + 10);
    throw std::invalid_argument("Invalid hexadecimal input");
  };
  std::string out;
  out.reserve(text.size() / 2);
  for (std::size_t i = 0; i < text.size(); i += 2) out += static_cast<char>((nibble(text[i]) << 4) | nibble(text[i + 1]));
  return out;
}

template <typename T> T integer(const std::string& value, int base = 10) {
  T result{};
  auto parsed = std::from_chars(value.data(), value.data() + value.size(), result, base);
  if (parsed.ec != std::errc{} || parsed.ptr != value.data() + value.size()) throw std::invalid_argument("Invalid protocol integer");
  return result;
}

double decimal(const std::string& value) {
  std::istringstream stream(value);
  stream.imbue(std::locale::classic());
  double result = 0;
  if (!(stream >> result) || !stream.eof() || !std::isfinite(result)) throw std::invalid_argument("Invalid protocol number");
  return result;
}

} // namespace

std::vector<SceneCandidate> group_scene_candidates(const std::vector<BurstFrame>& frames) {
  if (frames.size() > max_frames) throw std::invalid_argument("At most 100000 scene frames are supported");
  std::unordered_set<std::string> ids;
  std::vector<SceneCandidate> groups;
  const auto resembles = [](const BurstFrame& a, const BurstFrame& b) {
    return a.hash_domain != "unknown" && a.hash_domain == b.hash_domain &&
        usable(a) && usable(b) && a.folder == b.folder && a.camera_key == b.camera_key &&
        std::popcount(a.hash ^ b.hash) <= 8 && std::abs(a.brightness - b.brightness) < 15;
  };
  for (std::size_t i = 0; i < frames.size(); ++i) {
    const auto& current = frames[i];
    validate(current);
    if (!ids.insert(current.id).second) throw std::invalid_argument("Duplicate scene frame identity");
    SceneCandidate boundary;
    if (!i) boundary.reason = "sequence-start";
    else {
      const auto& previous = frames[i - 1];
      const bool comparable = previous.hash_domain != "unknown" && previous.hash_domain == current.hash_domain;
      if (comparable) {
        boundary.hash_distance = static_cast<unsigned>(std::popcount(previous.hash ^ current.hash));
        boundary.brightness_delta = std::abs(previous.brightness - current.brightness);
      }
      const bool same_camera = !current.camera_key.empty() && current.camera_key == previous.camera_key;
      if (same_camera && current.time_basis != "unknown" && current.time_basis == previous.time_basis &&
          previous.capture_time_ms > 0 && current.capture_time_ms >= previous.capture_time_ms)
        boundary.gap_ms = current.capture_time_ms - previous.capture_time_ms;
      // Deliberately conservative, uncalibrated navigation heuristics. Exposure,
      // camera movement and clock gaps can all occur within the same real scene.
      if (current.folder != previous.folder) boundary.reason = "folder-change";
      else if (!current.camera_key.empty() && !previous.camera_key.empty() && !same_camera)
        boundary.reason = "camera-change";
      else if (boundary.gap_ms >= 60000) boundary.reason = "capture-gap";
      else if (usable(previous) && usable(current) && boundary.hash_distance >= 24 && boundary.brightness_delta >= 30 &&
               !(i + 1 < frames.size() && resembles(previous, frames[i + 1])) &&
               !(i >= 2 && resembles(frames[i - 2], current)))
        boundary.reason = "appearance-change";
    }
    if (!boundary.reason.empty()) groups.push_back(std::move(boundary));
    groups.back().frame_ids.push_back(current.id);
    if (i > 0 && i + 1 < frames.size() && resembles(frames[i - 1], frames[i + 1]) &&
        current.hash_domain == frames[i - 1].hash_domain && usable(current) &&
        current.folder == frames[i - 1].folder && current.camera_key == frames[i - 1].camera_key &&
        std::popcount(current.hash ^ frames[i - 1].hash) >= 24 &&
        std::abs(current.brightness - frames[i - 1].brightness) >= 30)
      groups.back().possible_visual_outlier_ids.push_back(current.id);
  }
  return groups;
}

std::string scene_review_json(const std::vector<SceneCandidate>& groups) {
  std::ostringstream out;
  out.imbue(std::locale::classic());
  out << "{\"status\":\"suggestions-only\",\"uncertain\":true,\"method\":\"adjacent-preview-time-v1\","
         "\"limitations\":\"Not subject or location recognition. Same-scene exposure and camera changes can split groups; unrelated frames can remain together.\",\"groups\":[";
  for (std::size_t i = 0; i < groups.size(); ++i) {
    if (i) out << ',';
    const auto& group = groups[i];
    out << "{\"frameIds\":[";
    for (std::size_t j = 0; j < group.frame_ids.size(); ++j) {
      if (j) out << ',';
      out << quote(group.frame_ids[j]);
    }
    out << "],\"possibleVisualOutlierIds\":[";
    for (std::size_t j = 0; j < group.possible_visual_outlier_ids.size(); ++j) {
      if (j) out << ',';
      out << quote(group.possible_visual_outlier_ids[j]);
    }
    out << "],\"reason\":" << quote(group.reason) << ",\"evidence\":{\"hashDistance\":" << group.hash_distance
        << ",\"brightnessDelta\":" << group.brightness_delta << ",\"captureGapMs\":" << group.gap_ms << "}}";
  }
  out << "]}";
  return out.str();
}

BurstReview group_bursts(const std::vector<BurstFrame>& frames) {
  if (frames.size() > max_frames) throw std::invalid_argument("At most 100000 burst frames are supported");
  BurstReview result;
  result.input_frames = frames.size();
  std::vector<const BurstFrame*> timed;
  std::vector<const BurstFrame*> untimed;
  std::unordered_set<std::string> ids;
  for (const auto& frame : frames) {
    validate(frame);
    if (!ids.insert(frame.id).second) throw std::invalid_argument("Duplicate burst frame identity");
    if (!usable(frame)) continue;
    ++result.eligible_frames;
    if (frame.capture_time_ms > 0 && !frame.camera_key.empty()) timed.push_back(&frame);
    else untimed.push_back(&frame);
  }
  std::sort(timed.begin(), timed.end(), [](const auto* a, const auto* b) {
    return std::tie(a->folder, a->camera_key, a->capture_time_ms, a->id) <
           std::tie(b->folder, b->camera_key, b->capture_time_ms, b->id);
  });
  WorkingGroup current;
  for (const auto* frame : timed) {
    bool joins = false;
    unsigned farthest = 0;
    std::int64_t gap = 0;
    if (!current.frames.empty()) {
      const auto* first = current.frames.front();
      const auto* last = current.frames.back();
      gap = frame->capture_time_ms - last->capture_time_ms;
      if (current.frames.size() < max_group && frame->folder == first->folder &&
          frame->camera_key == first->camera_key && gap <= max_gap &&
          frame->capture_time_ms - first->capture_time_ms <= max_span) {
        const auto anchor_distance = distance(frame->hash, first->hash, result);
        const auto previous_distance = distance(frame->hash, last->hash, result);
        farthest = std::max(anchor_distance, previous_distance);
        joins = farthest <= hash_radius;
      }
    }
    if (!joins) { append_group(current, true, result); current = {}; }
    current.frames.push_back(frame);
    if (joins) {
      current.max_distance = std::max(current.max_distance, farthest);
      current.max_gap_ms = std::max(current.max_gap_ms, gap);
    }
  }
  append_group(current, true, result);

  // Appearance-only fallback is deliberately bounded and may miss distant matches.
  // It never infers time from upload/modified dates or chains a whole event.
  std::sort(untimed.begin(), untimed.end(), [](const auto* a, const auto* b) {
    return std::tie(a->folder, a->id) < std::tie(b->folder, b->id);
  });
  std::deque<WorkingGroup> recent;
  std::string folder;
  for (const auto* frame : untimed) {
    if (!recent.empty() && frame->folder != folder) {
      for (const auto& group : recent) append_group(group, false, result);
      recent.clear();
    }
    folder = frame->folder;
    WorkingGroup* match = nullptr;
    unsigned best_distance = hash_radius + 1;
    for (auto& group : recent) {
      if (group.frames.size() >= max_group) continue;
      // Do not merge different known cameras just because the time is missing.
      const auto& first_camera = group.frames.front()->camera_key;
      if (first_camera != frame->camera_key) continue;
      const auto candidate_distance = distance(frame->hash, group.frames.front()->hash, result);
      if (candidate_distance < best_distance) { match = &group; best_distance = candidate_distance; }
    }
    if (match) {
      match->frames.push_back(frame);
      match->max_distance = std::max(match->max_distance, best_distance);
    } else {
      if (recent.size() == max_anchors) { append_group(recent.front(), false, result); recent.pop_front(); }
      recent.push_back(WorkingGroup{{frame}, 0, 0});
    }
  }
  for (const auto& group : recent) append_group(group, false, result);
  return result;
}

std::vector<BurstFrame> read_burst_protocol(std::istream& input) {
  std::istringstream header(read_line(input));
  std::string magic, count_text, extra;
  if (!(header >> magic >> count_text) || (header >> extra) || (magic != "LENSBURST1" && magic != "LENSBURST2")) throw std::invalid_argument("Invalid burst protocol header");
  const auto count = integer<std::size_t>(count_text);
  if (count > max_frames) throw std::invalid_argument("At most 100000 burst frames are supported");
  std::vector<BurstFrame> frames;
  frames.reserve(count);
  std::size_t total_bytes = 0;
  for (std::size_t i = 0; i < count; ++i) {
    auto text = read_line(input);
    total_bytes += text.size();
    if (total_bytes > 64 * 1024 * 1024) throw std::invalid_argument("Burst request exceeds 64 MiB");
    std::istringstream line(text);
    std::string id, hash, score, sharpness, brightness, time, camera, folder, verdict;
    if (!(line >> id >> hash >> score >> sharpness >> brightness >> time >> camera >> folder >> verdict) || hash.size() != 16) throw std::invalid_argument("Invalid burst protocol row");
    BurstFrame frame;
    if (magic == "LENSBURST2") {
      frame.scene_only = true;
      if (!(line >> frame.hash_domain >> frame.time_basis) || frame.hash_domain == "legacy" || frame.time_basis == "legacy")
        throw std::invalid_argument("Missing scene evidence domains");
    }
    if (line >> extra) throw std::invalid_argument("Invalid burst protocol row");
    frame.id = unhex(id, 512, false);
    frame.hash = integer<std::uint64_t>(hash, 16);
    frame.score = decimal(score);
    frame.sharpness = decimal(sharpness);
    frame.brightness = decimal(brightness);
    frame.capture_time_ms = integer<std::int64_t>(time);
    frame.camera_key = unhex(camera, 4096, true);
    frame.folder = unhex(folder, 4096, true);
    if (verdict == "keep") frame.verdict = Verdict::keep;
    else if (verdict == "reject") frame.verdict = Verdict::reject;
    else if (verdict != "undecided") throw std::invalid_argument("Invalid burst verdict");
    validate(frame);
    frames.push_back(std::move(frame));
  }
  char remaining;
  while (input.get(remaining)) {
    if (remaining != '\r' && remaining != '\n' && remaining != ' ' && remaining != '\t') throw std::invalid_argument("Unexpected trailing burst input");
    if (++total_bytes > 64 * 1024 * 1024) throw std::invalid_argument("Burst request exceeds 64 MiB");
  }
  return frames;
}

std::vector<std::pair<std::string, Verdict>> apply_burst_cull(
    const BurstGroup& group, const std::vector<BurstFrame>& frames, const std::string& keep_id) {
  if (std::find(group.frame_ids.begin(), group.frame_ids.end(), keep_id) == group.frame_ids.end())
    throw std::invalid_argument("That photo is not in this burst. No picks were changed.");
  std::unordered_map<std::string, const BurstFrame*> by_id;
  by_id.reserve(frames.size());
  for (const auto& frame : frames) by_id.emplace(frame.id, &frame);
  const auto keeper = by_id.find(keep_id);
  if (keeper == by_id.end())
    throw std::invalid_argument("Reconnect the original before culling this burst. No picks were changed.");
  if (keeper->second->verdict != Verdict::undecided) return {};
  std::vector<std::pair<std::string, Verdict>> changes{{keep_id, Verdict::keep}};
  for (const auto& id : group.frame_ids) {
    if (id == keep_id) continue;
    const auto frame = by_id.find(id);
    if (frame == by_id.end() || frame->second->verdict != Verdict::undecided) continue;
    changes.emplace_back(id, Verdict::reject);
  }
  return changes;
}

std::string burst_review_json(const BurstReview& review) {
  std::ostringstream out;
  out.imbue(std::locale::classic());
  out << "{\"groups\":[";
  bool comma = false;
  for (const auto& group : review.groups) {
    if (comma) out << ',';
    comma = true;
    out << "{\"id\":" << quote(group.id) << ",\"kind\":" << quote(group.kind) << ",\"frameIds\":[";
    for (std::size_t i = 0; i < group.frame_ids.size(); ++i) {
      if (i) out << ',';
      out << quote(group.frame_ids[i]);
    }
    out << "],\"recommendedId\":" << quote(group.recommended_id) << ",\"reason\":" << quote(group.reason)
        << ",\"confidence\":" << quote(group.confidence) << ",\"evidence\":{\"spanMs\":" << group.span_ms
        << ",\"maxGapMs\":" << group.max_gap_ms << ",\"maxHashDistance\":" << group.max_hash_distance
        << ",\"cameraKey\":" << quote(group.camera_key) << ",\"folder\":" << quote(group.folder) << "}}";
  }
  out << "],\"stats\":{\"inputFrames\":" << review.input_frames << ",\"eligibleFrames\":" << review.eligible_frames
      << ",\"groupedFrames\":" << review.grouped_frames << ",\"comparisons\":" << review.comparisons << "}}";
  return out.str();
}

} // namespace lenslabs
