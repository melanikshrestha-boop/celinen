#include "lenslabs/cull_shoot_membership.hpp"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <map>
#include <set>
#include <stdexcept>

namespace lenslabs {
namespace {
double clamp01(double v) { return std::clamp(v, 0.0, 1.0); }
double sigmoid(double x) { return 1.0 / (1.0 + std::exp(-x)); }

constexpr double hour_ms = 3600.0 * 1000, day_ms = 24 * hour_ms;

std::string lower(std::string text) {
  for (auto& c : text) c = char(std::tolower(static_cast<unsigned char>(c)));
  return text;
}

bool contains_any(const std::string& text, std::initializer_list<const char*> needles) {
  for (const auto* needle : needles)
    if (text.find(needle) != std::string::npos) return true;
  return false;
}

std::string body_key(const CullMembershipInput& f) {
  if (f.make.empty() && f.model.empty()) return {};
  return f.make + "|" + f.model + "|" + f.serial;
}

std::pair<std::uint32_t, std::uint32_t> size_key(const CullMembershipInput& f) {
  return {std::min(f.width, f.height), std::max(f.width, f.height)};
}

// The aspect ratios cameras and phones write, portrait or landscape.
bool camera_aspect(std::uint32_t w, std::uint32_t h) {
  if (!w || !h) return true;
  const double ratio = double(std::max(w, h)) / double(std::min(w, h));
  for (double known : {1.0, 1.25, 4.0 / 3, 1.4, 1.5, 16.0 / 9, 2.0})
    if (std::abs(ratio - known) / known < .012) return true;
  return false;
}

// Names that downloads, messengers and screenshots produce.
bool downloaded_name(const std::string& name) {
  const auto n = lower(name);
  if (contains_any(n, {"screenshot", "screen shot", "screen_shot", "download", "unnamed", "pinterest",
                       "whatsapp", "received_", "fb_img", "wallpaper", "manga", "anime", "images", "image (",
                       "telegram", "snapchat", "tumblr", "reddit", "twitter", "insta"}))
    return true;
  if (n.find(" (") != std::string::npos && n.find(')') != std::string::npos) return true; // "photo (3).jpg"
  // Long hex or UUID stems ("8f3a9c0e1b2d4f5a.jpg").
  std::size_t hex_run = 0, best = 0;
  for (char c : n) {
    if (std::isxdigit(static_cast<unsigned char>(c)) || c == '-') best = std::max(best, ++hex_run);
    else hex_run = 0;
  }
  return best >= 20;
}

unsigned bits(std::uint32_t v) {
  unsigned count = 0;
  for (; v; v &= v - 1) ++count;
  return count;
}

unsigned hamming(std::uint64_t a, std::uint64_t b) {
  unsigned count = 0;
  for (auto v = a ^ b; v; v &= v - 1) ++count;
  return count;
}

double color_distance(const CullMembershipInput& a, const CullMembershipInput& b) {
  double sum = 0;
  for (std::size_t i = 0; i < a.color.size(); ++i) sum += std::abs(int(a.color[i]) - int(b.color[i]));
  return sum / double(a.color.size());
}

struct Weighed {
  double weight;
  std::uint32_t bit;
  std::string text;
};
} // namespace

const char* cull_membership_state_name(CullMembershipState state) noexcept {
  switch (state) {
    case CullMembershipState::member: return "member";
    case CullMembershipState::suspect: return "suspect";
    case CullMembershipState::outsider: return "outsider";
  }
  return "member";
}

std::string cull_name_pattern(const std::string& file_name) {
  std::string stem = file_name;
  const auto slash = stem.find_last_of("/\\");
  if (slash != std::string::npos) stem = stem.substr(slash + 1);
  const auto dot = stem.find_last_of('.');
  if (dot != std::string::npos && dot > 0) stem = stem.substr(0, dot);
  std::string pattern;
  for (std::size_t i = 0; i < stem.size();) {
    const auto c = static_cast<unsigned char>(stem[i]);
    if (std::isdigit(c)) {
      std::size_t run = 0;
      while (i < stem.size() && std::isdigit(static_cast<unsigned char>(stem[i]))) {
        ++run;
        ++i;
      }
      pattern += '#' + std::to_string(run);
    } else {
      pattern += char(std::tolower(c));
      ++i;
    }
  }
  return pattern;
}

std::string cull_describe_duration(double ms) {
  ms = std::abs(ms);
  const auto plural = [](long value, const char* unit) {
    return std::to_string(value) + " " + unit + (value == 1 ? "" : "s");
  };
  if (ms >= 365.25 * day_ms) return plural(std::max(1l, std::lround(ms / (365.25 * day_ms))), "year");
  if (ms >= 30.44 * day_ms) return plural(std::max(1l, std::lround(ms / (30.44 * day_ms))), "month");
  if (ms >= day_ms) return plural(std::max(1l, std::lround(ms / day_ms)), "day");
  return plural(std::max(1l, std::lround(ms / hour_ms)), "hour");
}

std::vector<CullMembership> assess_shoot_membership(const std::vector<CullMembershipInput>& frames,
                                                    const CullMembershipOptions& options) {
  if (!(options.suspect_at > 0 && options.suspect_at <= options.outsider_at && options.outsider_at <= 1))
    throw std::invalid_argument("Invalid membership thresholds.");
  std::vector<CullMembership> out(frames.size());

  std::vector<std::size_t> population;
  for (std::size_t i = 0; i < frames.size(); ++i)
    if (!frames[i].invalid) population.push_back(i);
  const double N = double(population.size());
  // Too few frames to say what the shoot looks like.
  if (population.size() < 5) return out;

  // Camera data.
  double with_camera = 0;
  std::map<std::string, std::vector<std::size_t>> bodies;
  for (auto i : population) {
    const auto key = body_key(frames[i]);
    if (key.empty()) continue;
    ++with_camera;
    bodies[key].push_back(i);
  }
  const double camera_share = with_camera / N;

  // Time: clusters split at gaps over twelve hours. Every cluster holding a real
  // share of the shoot is part of it (a two-day tournament is two clusters).
  std::vector<std::pair<double, std::size_t>> timed;
  for (auto i : population)
    if (frames[i].capture_time_ms >= 0 && std::isfinite(frames[i].capture_time_ms))
      timed.emplace_back(frames[i].capture_time_ms, i);
  std::sort(timed.begin(), timed.end());
  struct Cluster {
    double start, end;
    std::vector<std::size_t> members;
    bool core = false;
  };
  std::vector<Cluster> clusters;
  for (const auto& [time, index] : timed) {
    if (clusters.empty() || time - clusters.back().end > 12 * hour_ms) clusters.push_back({time, time, {}, false});
    clusters.back().end = time;
    clusters.back().members.push_back(index);
  }
  std::vector<int> cluster_of(frames.size(), -1);
  if (!clusters.empty()) {
    std::size_t largest = 0;
    for (std::size_t c = 0; c < clusters.size(); ++c) {
      if (clusters[c].members.size() > clusters[largest].members.size()) largest = c;
      for (auto i : clusters[c].members) cluster_of[i] = int(c);
    }
    for (auto& cluster : clusters)
      cluster.core = cluster.members.size() * 10 >= timed.size() || cluster.members.size() >= 20;
    clusters[largest].core = true;
  }
  const auto inside_core = [&](double time) {
    for (const auto& c : clusters)
      if (c.core && time >= c.start - hour_ms && time <= c.end + hour_ms) return true;
    return false;
  };
  const auto offset_from_core = [&](double time) {
    double best = 0;
    bool found = false;
    for (const auto& c : clusters) {
      if (!c.core) continue;
      const double d = time < c.start ? time - c.start : time > c.end ? time - c.end : 0;
      if (!found || std::abs(d) < std::abs(best)) {
        best = d;
        found = true;
      }
    }
    return best;
  };

  // Bodies that belong: a real share of the frames, or a few frames shot inside
  // the shoot's own time (a second shooter, phone B-roll).
  std::set<std::string> established_bodies;
  for (const auto& [key, members] : bodies) {
    if (double(members.size()) >= std::max(3.0, .03 * N)) {
      established_bodies.insert(key);
      continue;
    }
    std::size_t in_span = 0;
    for (auto i : members) in_span += frames[i].capture_time_ms >= 0 && inside_core(frames[i].capture_time_ms);
    if (members.size() >= 2 && in_span == members.size()) established_bodies.insert(key);
  }
  // A body whose own frames all sit in one cluster away from the shoot has a
  // clock set wrong, not frames from another year.
  std::set<std::string> offset_clock_bodies;
  for (const auto& [key, members] : bodies) {
    if (members.size() < 3) continue;
    std::map<int, std::size_t> by_cluster;
    std::size_t timed_members = 0;
    for (auto i : members)
      if (cluster_of[i] >= 0) {
        ++by_cluster[cluster_of[i]];
        ++timed_members;
      }
    for (const auto& [c, count] : by_cluster)
      if (!clusters[std::size_t(c)].core && count * 10 >= timed_members * 8 && count >= 3)
        offset_clock_bodies.insert(key);
  }

  // Sizes and names that belong.
  std::map<std::pair<std::uint32_t, std::uint32_t>, std::size_t> sizes;
  std::map<std::string, std::size_t> patterns;
  std::size_t named = 0;
  for (auto i : population) {
    if (frames[i].width && frames[i].height) ++sizes[size_key(frames[i])];
    if (!frames[i].file_name.empty()) {
      ++patterns[cull_name_pattern(frames[i].file_name)];
      ++named;
    }
  }
  const auto size_established = [&](const CullMembershipInput& f) {
    const auto found = sizes.find(size_key(f));
    return found != sizes.end() && double(found->second) >= std::max(2.0, .03 * N);
  };
  std::set<std::string> established_patterns;
  for (const auto& [pattern, count] : patterns)
    if (double(count) >= std::max(3.0, .05 * double(named))) established_patterns.insert(pattern);
  double edited_share = 0;
  for (auto i : population)
    edited_share += contains_any(frames[i].software, {"photoshop", "lightroom", "snapseed", "instagram", "picsart",
                                                      "canva", "gimp", "vsco", "facetune", "meitu"});
  edited_share /= N;

  // Look: nearest neighbour in colour and structure, against time neighbours and
  // a fixed stride sample, so ten thousand frames stay linear.
  std::vector<double> nearest_color(frames.size(), -1);
  std::vector<unsigned> nearest_hash(frames.size(), 64);
  {
    std::vector<std::size_t> looked;
    for (auto i : population)
      if (frames[i].has_look) looked.push_back(i);
    if (looked.size() >= 5) {
      const std::size_t stride = std::max<std::size_t>(1, looked.size() / 400);
      for (std::size_t a = 0; a < looked.size(); ++a) {
        const auto& fa = frames[looked[a]];
        double best_color = 1e9;
        unsigned best_hash = 64;
        const auto consider = [&](std::size_t b) {
          if (b == a) return;
          const auto& fb = frames[looked[b]];
          best_color = std::min(best_color, color_distance(fa, fb));
          best_hash = std::min(best_hash, hamming(fa.hash, fb.hash));
        };
        for (std::size_t b = a >= 10 ? a - 10 : 0; b < std::min(looked.size(), a + 11); ++b) consider(b);
        for (std::size_t b = a % stride; b < looked.size(); b += stride) consider(b);
        nearest_color[looked[a]] = best_color;
        nearest_hash[looked[a]] = best_hash;
      }
    }
  }
  double typical_color = 0;
  {
    std::vector<double> values;
    for (auto i : population)
      if (nearest_color[i] >= 0) values.push_back(nearest_color[i]);
    if (!values.empty()) {
      std::sort(values.begin(), values.end());
      typical_color = values[std::min(values.size() - 1, std::size_t(double(values.size()) * .9))];
    }
  }

  for (std::size_t i = 0; i < frames.size(); ++i) {
    const auto& f = frames[i];
    auto& result = out[i];
    if (f.invalid) continue; // the validity gate already speaks for it
    std::vector<Weighed> evidence;
    const auto body = body_key(f);

    if (body.empty()) {
      const double w = 2.2 * clamp01((camera_share - .6) / .3);
      if (w > 0) evidence.push_back({w, membership_no_camera_data, "No camera data"});
    } else if (!established_bodies.count(body)) {
      const bool in_span = f.capture_time_ms >= 0 && inside_core(f.capture_time_ms);
      evidence.push_back({in_span ? .7 : 1.6, membership_different_camera, "Different camera"});
    }

    if (f.capture_time_ms >= 0 && !clusters.empty() && cluster_of[i] >= 0 &&
        !clusters[std::size_t(cluster_of[i])].core) {
      const double offset = offset_from_core(f.capture_time_ms);
      const double distance = std::abs(offset);
      double w = distance > 365 * day_ms ? 3.8
                 : distance > 30 * day_ms ? 3.4
                 : distance > 3 * day_ms ? 2.2
                 : distance > 1.5 * day_ms ? 1.4
                                           : .6; // a time zone or clock basis away
      if (!body.empty() && offset_clock_bodies.count(body)) w *= .25;
      if (distance >= hour_ms) {
        result.time_offset_ms = offset;
        evidence.push_back({w, membership_time_outlier,
                            "Taken " + cull_describe_duration(distance) + (offset < 0 ? " before" : " after") +
                                " this shoot"});
      }
    }

    if (f.width && f.height && !size_established(f)) {
      const auto longest = std::max(f.width, f.height);
      // Web and phone-screen sizes are what a download looks like; a camera
      // writes its sensor's own size, and its own aspect ratio.
      double w = longest < 1200 ? 1.9 : longest <= 2048 ? 1.5 : longest <= 3000 ? .9 : .5;
      if (!camera_aspect(f.width, f.height)) w += .6;
      evidence.push_back({w, membership_download_size, w >= 1.2 ? "Downloaded image size" : "Unusual image size"});
    }

    if (!f.file_name.empty()) {
      double w = 0;
      if (!established_patterns.empty() && !established_patterns.count(cull_name_pattern(f.file_name))) w += .6;
      if (downloaded_name(f.file_name)) w += 1.0;
      if (w > 0) evidence.push_back({w, membership_name_pattern, "Different file naming"});
    }

    if (contains_any(f.software, {"screenshot", "snipping", "screen capture"}))
      evidence.push_back({1.5, membership_editing_software, "Screenshot"});
    else if (edited_share < .1 && contains_any(f.software, {"photoshop", "snapseed", "instagram", "picsart", "canva",
                                                             "gimp", "vsco", "facetune", "meitu"}))
      evidence.push_back({.4, membership_editing_software, "Edited in another app"});

    if (nearest_color[i] >= 0 && typical_color > 0 && nearest_color[i] > std::max(2.5 * typical_color, 40.0) &&
        nearest_hash[i] > 20)
      evidence.push_back({.9, membership_look, "Doesn't match this shoot"});

    double logit = -3.2;
    for (const auto& e : evidence) {
      logit += e.weight;
      result.evidence |= e.bit;
    }
    result.confidence = sigmoid(logit);
    if (result.confidence >= options.outsider_at && bits(result.evidence) >= 2)
      result.state = CullMembershipState::outsider;
    else if (result.confidence >= options.suspect_at)
      result.state = CullMembershipState::suspect;
    if (result.state != CullMembershipState::member) {
      std::stable_sort(evidence.begin(), evidence.end(),
                       [](const Weighed& a, const Weighed& b) { return a.weight > b.weight; });
      for (std::size_t k = 0; k < evidence.size() && k < 2; ++k)
        result.reason += (k ? " · " : "") + evidence[k].text;
    }
  }
  return out;
}

} // namespace lenslabs
