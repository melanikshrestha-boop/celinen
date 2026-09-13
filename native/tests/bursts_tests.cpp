#include "lenslabs/bursts.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <iostream>
#include <limits>
#include <set>
#include <sstream>
#include <stdexcept>
#include <utility>

namespace {
unsigned checks = 0, failures = 0;
void check(bool value, const char* expression, int line) {
  ++checks;
  if (!value) { ++failures; std::cerr << "FAIL line " << line << ": " << expression << '\n'; }
}
#define CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)
template <typename Function> void invalid(Function fn) {
  ++checks;
  try { fn(); ++failures; std::cerr << "Expected invalid_argument\n"; }
  catch (const std::invalid_argument&) {}
  catch (...) { ++failures; std::cerr << "Wrong exception type\n"; }
}
lenslabs::BurstFrame frame(std::string id, std::int64_t time = 10000) {
  return {std::move(id), 0xaaaaaaaaaaaaaaaaULL, 80, 100, 125, time, "body-serial-1", "match", lenslabs::Verdict::undecided};
}
std::vector<lenslabs::BurstFrame> parse(const std::string& input) {
  std::istringstream stream(input);
  return lenslabs::read_burst_protocol(stream);
}
}

int main() {
  using namespace lenslabs;
  CHECK(group_scene_candidates({}).empty());
  auto scene_a = frame("scene-a", 10000);
  auto scene_b = frame("scene-b", 69999);
  CHECK(group_scene_candidates({scene_a, scene_b}).size() == 1);
  scene_b.capture_time_ms = 70000;
  auto scenes = group_scene_candidates({scene_a, scene_b});
  CHECK(scenes.size() == 2 && scenes[1].reason == "capture-gap");
  CHECK(scenes[1].gap_ms == 60000);
  scene_b.camera_key.clear();
  CHECK(group_scene_candidates({scene_a, scene_b}).size() == 1);
  scene_b.camera_key = scene_a.camera_key;
  scene_b.capture_time_ms = 0;
  scene_b.brightness += 30;
  CHECK(group_scene_candidates({scene_a, scene_b}).size() == 1); // exposure alone
  scene_b.hash ^= 0xffffffULL;
  scenes = group_scene_candidates({scene_a, scene_b});
  CHECK(scenes.size() == 2 && scenes[1].reason == "appearance-change");
  CHECK(scenes[1].hash_distance == 24 && scenes[1].brightness_delta == 30);
  scene_b.brightness -= 1;
  CHECK(group_scene_candidates({scene_a, scene_b}).size() == 1);
  scene_b.brightness += 1;
  auto scene_c = scene_a; scene_c.id = "scene-c";
  CHECK(group_scene_candidates({scene_a, scene_b, scene_c}).size() == 1); // isolated excursion
  CHECK(group_scene_candidates({scene_a, scene_b, scene_c})[0].possible_visual_outlier_ids == std::vector<std::string>({"scene-b"}));
  scene_a.hash_domain = "native-cpp"; scene_b.hash_domain = "browser";
  CHECK(group_scene_candidates({scene_a, scene_b}).size() == 1);
  scene_b.hash_domain = "unknown";
  CHECK(group_scene_candidates({scene_a, scene_b}).size() == 1);
  scene_b.hash_domain = scene_a.hash_domain = "legacy";
  scene_b.capture_time_ms = 100000; scene_a.time_basis = "utc"; scene_b.time_basis = "camera_clock";
  scene_b.hash = scene_a.hash;
  CHECK(group_scene_candidates({scene_a, scene_b}).size() == 1);
  scene_a.time_basis = scene_b.time_basis = "legacy"; scene_b.capture_time_ms = 0;
  scene_b.hash = 0;
  CHECK(group_scene_candidates({scene_a, scene_b}).size() == 1); // degenerate hash
  scene_b.folder = "other";
  CHECK(group_scene_candidates({scene_a, scene_b})[1].reason == "folder-change");
  scene_b.folder = scene_a.folder; scene_b.camera_key = "other-camera";
  CHECK(group_scene_candidates({scene_a, scene_b})[1].reason == "camera-change");
  scene_b.verdict = Verdict::reject; scene_a.verdict = Verdict::keep;
  scenes = group_scene_candidates({scene_b, scene_a, scene_c});
  std::vector<std::string> ordered;
  for (const auto& group : scenes) for (const auto& id : group.frame_ids) ordered.push_back(id);
  CHECK(ordered == std::vector<std::string>({"scene-b", "scene-a", "scene-c"}));
  CHECK(scene_b.verdict == Verdict::reject && scene_a.verdict == Verdict::keep);
  CHECK(scene_review_json(scenes).find("\"uncertain\":true") != std::string::npos);
  invalid([&] { group_scene_candidates({scene_a, scene_a}); });
  auto invalid_scene = scene_a; invalid_scene.brightness = std::nan("");
  invalid([&] { group_scene_candidates({invalid_scene}); });
  invalid([&] { group_scene_candidates(std::vector<BurstFrame>(100001, scene_a)); });
  const auto version2 = parse("LENSBURST2 1\n61 aaaaaaaaaaaaaaaa 80 100 125 0 - - keep native-cpp unknown\n");
  CHECK(version2[0].scene_only && version2[0].hash_domain == "native-cpp" && version2[0].time_basis == "unknown");
  invalid([&] { parse("LENSBURST2 1\n61 aaaaaaaaaaaaaaaa 80 100 125 0 - - keep legacy unknown\n"); });
  invalid([&] { parse("LENSBURST2 1\n61 aaaaaaaaaaaaaaaa 80 100 125 0 - - keep native-cpp\n"); });
  for (const std::size_t count : {300u, 10000u, 100000u}) {
    std::vector<BurstFrame> navigation;
    navigation.reserve(count);
    for (std::size_t i = 0; i < count; ++i) navigation.push_back(frame("nav-" + std::to_string(i), 10000 + i * 100));
    const auto start = std::chrono::steady_clock::now();
    const auto candidates = group_scene_candidates(navigation);
    const auto ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
    CHECK(candidates.size() == 1 && candidates[0].frame_ids.size() == count);
    CHECK(candidates[0].frame_ids.front() == "nav-0");
    CHECK(candidates[0].frame_ids.back() == "nav-" + std::to_string(count - 1));
    std::cout << "Synthetic " << count << " receipt scene navigation: " << ms << " ms (no decoding or semantic accuracy).\n";
  }
  CHECK(group_bursts({}).groups.empty());
  CHECK(group_bursts({frame("a")}).groups.empty());
  const auto a = frame("a", 10000), b = frame("b", 11500);
  auto review = group_bursts({b, a});
  CHECK(review.groups.size() == 1);
  CHECK(review.groups[0].frame_ids == std::vector<std::string>({"a", "b"}));
  CHECK(review.groups[0].kind == "burst");
  CHECK(review.groups[0].span_ms == 1500);
  CHECK(review.groups[0].confidence == "camera-time-and-appearance");
  CHECK(a.verdict == Verdict::undecided && b.verdict == Verdict::undecided);
  CHECK(group_bursts({a, frame("b", 11501)}).groups.empty());

  auto other = b;
  other.camera_key = "body-serial-2";
  CHECK(group_bursts({a, other}).groups.empty());
  other = b; other.folder = "second-match";
  CHECK(group_bursts({a, other}).groups.empty());
  other = b; other.hash = ~a.hash;
  CHECK(group_bursts({a, other}).groups.empty());
  other = b; other.hash ^= 0xff;
  CHECK(group_bursts({a, other}).groups.size() == 1);
  other.hash ^= 0x100;
  CHECK(group_bursts({a, other}).groups.empty());

  // Anchor checks prevent transitive visual drift, even within the clock window.
  auto c = frame("c", 10400);
  auto drift = frame("b", 10200); drift.hash ^= 0xff;
  c.hash ^= 0xffff;
  review = group_bursts({a, drift, c});
  CHECK(review.groups.size() == 1);
  CHECK(review.groups[0].frame_ids.size() == 2);

  std::vector<BurstFrame> continuous;
  for (int i = 0; i < 50; ++i) continuous.push_back(frame(std::to_string(i), 10000 + i * 300));
  review = group_bursts(continuous);
  CHECK(review.groups.size() == 3);
  for (const auto& group : review.groups) {
    CHECK(group.span_ms <= 6000);
    CHECK(group.frame_ids.size() <= 24);
  }
  for (auto& f : continuous) f.capture_time_ms = 10000;
  review = group_bursts(continuous);
  CHECK(review.groups.size() == 3);
  CHECK(review.groups[0].frame_ids.size() == 24);

  auto unknown_a = frame("a", 0), unknown_b = frame("b", 0);
  review = group_bursts({unknown_b, unknown_a});
  CHECK(review.groups.size() == 1 && review.groups[0].kind == "similar");
  CHECK(review.groups[0].confidence == "appearance-only");
  CHECK(review.groups[0].span_ms == 0);
  CHECK(review.groups[0].camera_key.empty());
  CHECK(review.groups[0].reason.find("not a confirmed burst") != std::string::npos);
  unknown_b.camera_key = "another-camera";
  CHECK(group_bursts({unknown_b, unknown_a}).groups.empty());
  unknown_b = unknown_a; unknown_b.id = "b"; unknown_a.camera_key.clear();
  CHECK(group_bursts({unknown_b, unknown_a}).groups.empty());
  unknown_b.camera_key.clear();
  CHECK(group_bursts({unknown_b, unknown_a}).groups[0].kind == "similar");
  unknown_b.folder = "another-folder";
  CHECK(group_bursts({unknown_b, unknown_a}).groups.empty());
  unknown_b = unknown_a; unknown_b.id = "b"; unknown_b.hash = 0;
  review = group_bursts({unknown_a, unknown_b});
  CHECK(review.eligible_frames == 1 && review.groups.empty());
  unknown_b.hash = unknown_a.hash; unknown_b.brightness = 0;
  CHECK(group_bursts({unknown_a, unknown_b}).groups.empty());

  auto keep = a; keep.verdict = Verdict::keep; keep.score = 10;
  auto reject = b; reject.verdict = Verdict::reject; reject.score = 100;
  auto undecided = frame("c", 12000); undecided.score = 81;
  review = group_bursts({keep, reject, undecided});
  CHECK(review.groups[0].recommended_id == "c");
  CHECK(keep.verdict == Verdict::keep && reject.verdict == Verdict::reject);
  keep.verdict = Verdict::reject;
  CHECK(group_bursts({keep, reject}).groups[0].recommended_id.empty());
  undecided = b; undecided.sharpness = 101;
  CHECK(group_bursts({a, undecided}).groups[0].recommended_id == "b");

  review = group_bursts({a, b});
  auto culled = apply_burst_cull(review.groups[0], {a, b}, "a");
  CHECK(culled.size() == 2);
  CHECK(culled[0] == std::make_pair(std::string("a"), Verdict::keep));
  CHECK(culled[1] == std::make_pair(std::string("b"), Verdict::reject));
  CHECK(a.verdict == Verdict::undecided && b.verdict == Verdict::undecided);
  auto already = a; already.verdict = Verdict::keep;
  CHECK(apply_burst_cull(review.groups[0], {already, b}, "a").empty());
  invalid([&] { apply_burst_cull(review.groups[0], {a, b}, "missing"); });

  invalid([&] { group_bursts({a, a}); });
  other = b; other.id.clear(); invalid([&] { group_bursts({other}); });
  other = b; other.score = std::numeric_limits<double>::quiet_NaN(); invalid([&] { group_bursts({other}); });
  other = b; other.sharpness = -1; invalid([&] { group_bursts({other}); });
  other = b; other.capture_time_ms = -1; invalid([&] { group_bursts({other}); });
  other = b; other.id = "bad\nname"; invalid([&] { group_bursts({other}); });
  other = b; other.id = std::string("\xed\xa0\x80", 3); invalid([&] { group_bursts({other}); });
  other = b; other.id = "写真\"\\";
  const auto json = burst_review_json(group_bursts({a, other}));
  CHECK(json.find("写真\\\"\\\\") != std::string::npos);
  CHECK(json.find("\"reviewRequired\"") == std::string::npos); // No fabricated approval.

  auto parsed = parse("LENSBURST1 2\n61 aaaaaaaaaaaaaaaa 80 100 125 10000 626f6479 666f6c646572 keep\n62 aaaaaaaaaaaaaaaa 90 200 126 11000 626f6479 666f6c646572 undecided\n");
  CHECK(parsed.size() == 2 && parsed[0].id == "a" && parsed[1].folder == "folder");
  CHECK(group_bursts(parsed).groups[0].recommended_id == "b");
  CHECK(parse("LENSBURST1 0\n").empty());
  invalid([] { parse("LENSBURST1 100001\n"); });
  invalid([] { parse("LENSBURST1 1\n"); });
  CHECK(parse("LENSBURST2 0\n").empty());
  invalid([] { parse("LENSBURST3 0\n"); });
  invalid([] { parse("LENSBURST1 0\nextra"); });
  invalid([] { parse("LENSBURST1 1\n61 aaaaaaaaaaaaaaaa NaN 1 100 0 - - keep\n"); });
  invalid([] { parse("LENSBURST1 1\n61 aaaaaaaaaaaaaaaa 80 1 100 0 - - invalid\n"); });
  invalid([] { parse("LENSBURST1 1\nzz aaaaaaaaaaaaaaaa 80 1 100 0 - - keep\n"); });
  invalid([] { parse("LENSBURST1 1\n00 aaaaaaaaaaaaaaaa 80 1 100 0 - - keep\n"); });
  invalid([] { parse("LENSBURST1 1\n61 aaaaaaaaaaaaaaaa 80 1 100 0 - - keep EXTRA\n"); });
  invalid([] { parse("LENSBURST1 1\n" + std::string(18001, 'x') + "\n"); });

  // Synthetic repeatability/scaling fixture, not a real-shoot accuracy benchmark.
  std::vector<BurstFrame> synthetic;
  synthetic.reserve(3000);
  for (int i = 0; i < 3000; ++i) {
    auto next = frame("frame-" + std::to_string(i), 10000 + (i / 10) * 10000 + (i % 10) * 100);
    next.verdict = i % 7 == 0 ? Verdict::keep : i % 11 == 0 ? Verdict::reject : Verdict::undecided;
    synthetic.push_back(next);
  }
  const auto start = std::chrono::steady_clock::now();
  const auto large = group_bursts(synthetic);
  const auto milliseconds = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
  CHECK(large.groups.size() == 300);
  CHECK(large.grouped_frames == 3000);
  CHECK(large.comparisons <= 2 * synthetic.size());
  std::set<std::string> grouped;
  for (const auto& group : large.groups) {
    CHECK(group.frame_ids.size() == 10);
    for (const auto& id : group.frame_ids) CHECK(grouped.insert(id).second);
  }
  const auto expected_json = burst_review_json(large);
  std::reverse(synthetic.begin(), synthetic.end());
  CHECK(burst_review_json(group_bursts(synthetic)) == expected_json);
  for (auto& f : synthetic) { f.camera_key.clear(); f.capture_time_ms = 0; }
  const auto similar = group_bursts(synthetic);
  CHECK(similar.comparisons <= 32 * synthetic.size());
  CHECK(similar.grouped_frames == 3000);
  for (const auto& group : similar.groups) CHECK(group.frame_ids.size() <= 24 && group.kind == "similar");
  std::cout << "Synthetic 3000 receipt grouping: " << milliseconds << " ms; " << large.comparisons << " hash comparisons (not photo decoding or accuracy).\n";
  std::cout << checks << " burst checks, " << failures << " failures\n";
  return failures ? 1 : 0;
}
