#include "lenslabs/cull_heads.hpp"
#include <algorithm>
#include <cmath>

namespace lenslabs {
namespace {
double clamp01(double v) { return std::isfinite(v) ? std::clamp(v, 0.0, 1.0) : 0.0; }

// A head's value turned so that higher is better, pulled toward neutral by its
// own uncertainty: a 0.2-confidence "eyes closed" should barely move a frame.
double effective(const CullHeadValue& head, CullHead which) {
  const double oriented = cull_head_higher_is_better(which) ? head.value : 1 - head.value;
  return .5 + head.confidence * (oriented - .5);
}
} // namespace

void CullHeadSet::set(CullHead head, double value, double confidence) {
  auto& slot = heads[std::size_t(head)];
  slot.value = clamp01(value);
  slot.confidence = clamp01(confidence);
  slot.present = true;
}

void CullHeadSet::merge(const CullHeadSet& other) {
  for (std::size_t i = 0; i < cull_head_count; ++i) {
    const auto& theirs = other.heads[i];
    if (!theirs.present) continue;
    if (!heads[i].present || theirs.confidence > heads[i].confidence) heads[i] = theirs;
  }
}

const char* cull_head_name(CullHead head) noexcept {
  switch (head) {
    case CullHead::validity: return "validity";
    case CullHead::subject_confidence: return "subject_confidence";
    case CullHead::subject_focus: return "subject_focus";
    case CullHead::eye_focus: return "eye_focus";
    case CullHead::eyes_open: return "eyes_open";
    case CullHead::exposure: return "exposure";
    case CullHead::noise: return "noise";
    case CullHead::camera_shake: return "camera_shake";
    case CullHead::subject_motion: return "subject_motion";
    case CullHead::composition: return "composition";
    case CullHead::aesthetic: return "aesthetic";
    case CullHead::expression: return "expression";
    case CullHead::peak_action: return "peak_action";
    case CullHead::occlusion: return "occlusion";
    case CullHead::duplicate_similarity: return "duplicate_similarity";
    case CullHead::burst_position: return "burst_position";
    case CullHead::ball_visibility: return "ball_visibility";
    case CullHead::pose: return "pose";
    case CullHead::count: break;
  }
  return "";
}

bool cull_head_higher_is_better(CullHead head) noexcept {
  switch (head) {
    case CullHead::noise:
    case CullHead::camera_shake:
    case CullHead::subject_motion:
    case CullHead::occlusion:
    case CullHead::duplicate_similarity:
    case CullHead::burst_position:
      return false;
    default:
      return true;
  }
}

const char* cull_genre_name(CullGenre genre) noexcept {
  switch (genre) {
    case CullGenre::sports: return "sports";
    case CullGenre::wedding: return "wedding";
    case CullGenre::portrait: return "portrait";
    case CullGenre::event: return "event";
  }
  return "sports";
}

const CullProfile& cull_profile(CullGenre genre) {
  using H = CullHead;
  // Sports: the moment first, then whether the athlete is sharp in it; then the
  // things that make the moment read (ball, face, pose, nothing in the way);
  // then craft.
  static const CullProfile sports{
      CullGenre::sports,
      {{H::validity, .5, .6}, {H::subject_focus, .22, .5}, {H::camera_shake, .35, .5}},
      {{{{H::peak_action, .55}, {H::subject_focus, .45}}, .12},
       {{{H::ball_visibility, .3}, {H::expression, .25}, {H::pose, .2}, {H::occlusion, .25}}, .15},
       {{{H::composition, .4}, {H::exposure, .3}, {H::subject_motion, .15}, {H::noise, .15}}, .1}}};
  // Wedding: closed eyes and a soft face end a frame; expression and the eyes
  // lead; then craft; the moment matters least.
  static const CullProfile wedding{
      CullGenre::wedding,
      {{H::validity, .5, .6}, {H::eyes_open, .5, .7}, {H::subject_focus, .25, .5}},
      {{{{H::expression, .5}, {H::eye_focus, .5}}, .12},
       {{{H::subject_focus, .35}, {H::composition, .35}, {H::exposure, .3}}, .12},
       {{{H::aesthetic, .4}, {H::occlusion, .3}, {H::peak_action, .15}, {H::noise, .15}}, .1}}};
  static const CullProfile portrait{
      CullGenre::portrait,
      {{H::validity, .5, .6}, {H::eyes_open, .5, .7}, {H::subject_focus, .25, .5}},
      {{{{H::eye_focus, .6}, {H::subject_focus, .4}}, .1},
       {{{H::expression, .6}, {H::composition, .4}}, .12},
       {{{H::exposure, .4}, {H::aesthetic, .4}, {H::noise, .2}}, .1}}};
  static const CullProfile event{
      CullGenre::event,
      {{H::validity, .5, .6}, {H::subject_focus, .22, .5}},
      {{{{H::subject_focus, .5}, {H::expression, .3}, {H::eyes_open, .2}}, .12},
       {{{H::composition, .35}, {H::exposure, .35}, {H::occlusion, .3}}, .12},
       {{{H::aesthetic, .4}, {H::peak_action, .3}, {H::noise, .3}}, .1}}};
  switch (genre) {
    case CullGenre::sports: return sports;
    case CullGenre::wedding: return wedding;
    case CullGenre::portrait: return portrait;
    case CullGenre::event: return event;
  }
  return sports;
}

CullRankKey cull_rank_key(const CullHeadSet& heads, const CullProfile& profile) {
  CullRankKey key;
  for (std::size_t g = 0; g < profile.gates.size(); ++g) {
    const auto& gate = profile.gates[g];
    const auto& head = heads.get(gate.head);
    if (!head.present || head.confidence < gate.min_confidence) continue;
    const double oriented = cull_head_higher_is_better(gate.head) ? head.value : 1 - head.value;
    if (oriented < gate.minimum) {
      key.passed = false;
      key.failed_gate = int(g);
      break;
    }
  }
  double tier_weight = 1, weight_sum = 0;
  for (const auto& tier : profile.tiers) {
    double sum = 0, weights = 0;
    for (const auto& term : tier.terms) {
      const auto& head = heads.get(term.head);
      if (!head.present) continue;
      sum += term.weight * effective(head, term.head);
      weights += term.weight;
    }
    const double score = weights > 0 ? sum / weights : .5; // no evidence: neutral
    key.scores.push_back(score);
    key.buckets.push_back(int(std::floor(score / tier.resolution)));
    key.total += tier_weight * score;
    weight_sum += tier_weight;
    tier_weight *= .5;
  }
  if (weight_sum > 0) key.total /= weight_sum;
  return key;
}

bool cull_rank_before(const CullRankKey& a, const CullRankKey& b) noexcept {
  if (a.passed != b.passed) return a.passed;
  const auto tiers = std::min(a.buckets.size(), b.buckets.size());
  for (std::size_t i = 0; i < tiers; ++i)
    if (a.buckets[i] != b.buckets[i]) return a.buckets[i] > b.buckets[i];
  return a.total > b.total;
}

CullHeadSet cull_heads_from_reading(const CullReading& r) {
  CullHeadSet heads;
  heads.set(CullHead::subject_focus, r.acuity_subject, .6);
  double penalty = 0;
  if (r.subject_luma < 42) penalty += (42 - r.subject_luma) / 42;
  if (r.subject_luma > 225) penalty += (r.subject_luma - 225) / 30;
  if (r.subject_clipped > 12) penalty += (r.subject_clipped - 12) / 60;
  heads.set(CullHead::exposure, 1 - penalty, .7);
  heads.set(CullHead::noise, (r.noise - 2) / 10, .6);
  heads.set(CullHead::camera_shake, r.global_smear ? r.motion : r.motion * .3, .5);
  heads.set(CullHead::subject_motion, r.global_smear ? 0 : r.motion, .4);
  if (r.has_face) heads.set(CullHead::eyes_open, r.eyes_closed ? 0 : 1, r.eyes_closed ? .8 : .4);
  // Composition prior: near a thirds intersection or dead centre. Weak on
  // purpose; a learned head replaces it.
  double nearest = 1;
  for (double x : {1.0 / 3, .5, 2.0 / 3})
    for (double y : {1.0 / 3, .5, 2.0 / 3})
      nearest = std::min(nearest, std::hypot(r.subject_x - x, r.subject_y - y));
  heads.set(CullHead::composition, 1 - nearest / .35, .25);
  return heads;
}

} // namespace lenslabs
