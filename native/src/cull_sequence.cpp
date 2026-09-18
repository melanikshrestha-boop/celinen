#include "lenslabs/cull_sequence.hpp"
#include "cull_dsp.hpp"
#include <algorithm>
#include <cmath>
#include <map>
#include <numeric>
#include <stdexcept>

namespace lenslabs {
namespace {
using dsp::clamp01;
constexpr int W = int(cull_signature_width), H = int(cull_signature_height);

std::array<double, cull_signature_width * cull_signature_height> normalized(const CullSequenceSignature& s) {
  std::array<double, cull_signature_width * cull_signature_height> z{};
  double mean = 0, sq = 0;
  for (auto v : s.luma) {
    mean += v;
    sq += double(v) * v;
  }
  mean /= double(z.size());
  // A floor on the deviation: two near-flat frames must not amplify their
  // rounding into "motion".
  const double deviation = std::max(4.0, std::sqrt(std::max(0.0, sq / double(z.size()) - mean * mean)));
  for (std::size_t i = 0; i < z.size(); ++i) z[i] = (s.luma[i] - mean) / deviation;
  return z;
}

bool confident_subject(const CullSequenceFrame& f) {
  if (!f.has_subject) return false;
  switch (f.subject.level) {
    case CullSubjectLevel::eyes:
    case CullSubjectLevel::face:
    case CullSubjectLevel::body:
    case CullSubjectLevel::object:
      return true;
    case CullSubjectLevel::salient:
      return f.subject.saliency >= .3;
    default:
      return false;
  }
}

// Heads the sequence itself knows: subject evidence from the focus hierarchy
// and validity. Detector-backed subject focus outranks the reading's own
// centre-weighted estimate; saliency only fills in where it is more confident.
CullHeadSet frame_heads(const CullSequenceFrame& f) {
  CullHeadSet heads = f.heads;
  if (f.has_subject && f.subject.level != CullSubjectLevel::none) {
    CullHeadSet subject;
    const bool detected = f.subject.level == CullSubjectLevel::eyes || f.subject.level == CullSubjectLevel::face ||
                          f.subject.level == CullSubjectLevel::body || f.subject.level == CullSubjectLevel::object;
    const double trust = detected ? std::max(.7, f.subject.focus_confidence) : f.subject.focus_confidence * .8;
    subject.set(CullHead::subject_focus, f.subject.focus, trust);
    if (f.subject.eye_focus >= 0) subject.set(CullHead::eye_focus, f.subject.eye_focus, .8);
    if (f.subject.eyes_open >= 0) subject.set(CullHead::eyes_open, f.subject.eyes_open, .75);
    double found = 0;
    switch (f.subject.level) {
      case CullSubjectLevel::eyes:
      case CullSubjectLevel::face: found = .95; break;
      case CullSubjectLevel::body: found = .85; break;
      case CullSubjectLevel::object: found = .8; break;
      case CullSubjectLevel::salient: found = f.subject.saliency; break;
      default: found = .15; break;
    }
    subject.set(CullHead::subject_confidence, found, .6);
    if (detected) {
      for (std::size_t i = 0; i < cull_head_count; ++i)
        if (subject.heads[i].present) heads.heads[i] = subject.heads[i];
    } else {
      heads.merge(subject);
    }
  }
  switch (f.validity) {
    case CullValidityState::valid: heads.set(CullHead::validity, 1, .7); break;
    case CullValidityState::suspect: heads.set(CullHead::validity, .4, .6); break;
    case CullValidityState::invalid: heads.set(CullHead::validity, 0, .95); break;
  }
  return heads;
}

double head_or(const CullHeadSet& heads, CullHead head, double fallback) {
  const auto& h = heads.get(head);
  return h.present ? h.value : fallback;
}

std::string capitalized(std::string text) {
  if (!text.empty() && text[0] >= 'a' && text[0] <= 'z') text[0] = char(text[0] - 'a' + 'A');
  return text;
}

// "slightly softer", "as sharp", "sharper" — the subject focus relative to the pick.
std::string sharpness_phrase(double mine, double pick) {
  const double delta = mine - pick;
  if (delta <= -.12) return "softer";
  if (delta <= -.03) return "slightly softer";
  if (delta < .03) return "as sharp";
  return "sharper";
}
} // namespace

const char* cull_burst_role_name(CullBurstRole role) noexcept {
  switch (role) {
    case CullBurstRole::none: return "none";
    case CullBurstRole::pick: return "pick";
    case CullBurstRole::alternate: return "alternate";
    case CullBurstRole::review: return "review";
    case CullBurstRole::build_up: return "build-up";
    case CullBurstRole::follow_through: return "follow-through";
    case CullBurstRole::duplicate: return "duplicate";
  }
  return "none";
}

CullSequenceSignature cull_sequence_signature(const Image& image) {
  if (image.width < 32 || image.height < 24 || image.rgba.size() != std::size_t(image.width) * image.height * 4)
    throw std::invalid_argument("A sequence signature needs a decoded frame of at least 32x24 pixels.");
  const auto plane = dsp::luma_plane(image);
  const auto small = dsp::resample_box(plane, 0, 0, plane.width, plane.height, W, H);
  CullSequenceSignature signature;
  for (std::size_t i = 0; i < signature.luma.size(); ++i)
    signature.luma[i] = std::uint8_t(std::clamp(std::lround(small.values[i]), 0l, 255l));
  return signature;
}

CullMotion cull_signature_motion(const CullSequenceSignature& a, const CullSequenceSignature& b) {
  const auto za = normalized(a), zb = normalized(b);
  CullMotion best;
  best.energy = 1e9;
  for (int sy = -2; sy <= 2; ++sy)
    for (int sx = -2; sx <= 2; ++sx) {
      double sum = 0;
      int count = 0;
      for (int y = std::max(0, -sy); y < std::min(H, H - sy); ++y)
        for (int x = std::max(0, -sx); x < std::min(W, W - sx); ++x) {
          sum += std::abs(za[std::size_t(y * W + x)] - zb[std::size_t((y + sy) * W + x + sx)]);
          ++count;
        }
      // Prefer no pan when a pan explains nothing extra.
      const double energy = sum / std::max(1, count) + .01 * (std::abs(sx) + std::abs(sy));
      if (energy < best.energy) {
        best.energy = energy;
        best.pan_x = sx;
        best.pan_y = sy;
      }
    }
  // Where the change that the pan could not explain sits.
  std::vector<double> residual;
  std::vector<std::pair<int, int>> cells;
  for (int y = std::max(0, -best.pan_y); y < std::min(H, H - best.pan_y); ++y)
    for (int x = std::max(0, -best.pan_x); x < std::min(W, W - best.pan_x); ++x) {
      residual.push_back(std::abs(za[std::size_t(y * W + x)] - zb[std::size_t((y + best.pan_y) * W + x + best.pan_x)]));
      cells.emplace_back(x, y);
    }
  if (!residual.empty()) {
    auto sorted = residual;
    std::nth_element(sorted.begin(), sorted.begin() + std::ptrdiff_t(sorted.size() / 2), sorted.end());
    const double median = sorted[sorted.size() / 2];
    double mass = 0, cx = 0, cy = 0;
    for (std::size_t i = 0; i < residual.size(); ++i) {
      const double w = std::max(0.0, residual[i] - median);
      mass += w;
      cx += w * (cells[i].first + .5);
      cy += w * (cells[i].second + .5);
    }
    if (mass > 0) {
      best.centre_x = cx / mass / W;
      best.centre_y = cy / mass / H;
    }
  }
  best.energy = clamp01((best.energy - .01 * (std::abs(best.pan_x) + std::abs(best.pan_y))) / 1.128);
  return best;
}

std::vector<CullSequenceRow> assign_burst_roles(const std::vector<CullSequenceFrame>& frames,
                                                const CullSequenceOptions& options) {
  if (!(options.duplicate_energy >= 0 && options.duplicate_energy < 1) || options.max_alternates < 0)
    throw std::invalid_argument("Invalid sequence options.");
  std::vector<CullSequenceRow> rows(frames.size());
  const auto& profile = cull_profile(options.genre);

  std::map<int, std::vector<std::size_t>> bursts;
  for (std::size_t i = 0; i < frames.size(); ++i) {
    rows[i].heads = frame_heads(frames[i]);
    if (frames[i].group >= 0 && frames[i].validity != CullValidityState::invalid)
      bursts[frames[i].group].push_back(i);
  }

  for (auto& [group, members] : bursts) {
    (void)group;
    // Capture order; input order where the file carried no time.
    std::stable_sort(members.begin(), members.end(), [&](std::size_t a, std::size_t b) {
      const double ta = frames[a].capture_time_ms, tb = frames[b].capture_time_ms;
      if (ta >= 0 && tb >= 0 && ta != tb) return ta < tb;
      return a < b;
    });
    const std::size_t n = members.size();
    for (auto i : members) rows[i].burst_size = int(n);
    if (n < 2) {
      // A group of one is not a sequence; it is its own pick.
      rows[members[0]].role = CullBurstRole::pick;
      rows[members[0]].rank = 0;
      rows[members[0]].reason = "Only frame of this moment";
      continue;
    }

    // Motion between consecutive frames.
    std::vector<CullMotion> motion(n); // motion[k]: from k-1 to k; motion[0] unused
    bool signatures = true;
    for (auto i : members) signatures = signatures && frames[i].has_signature;
    if (signatures)
      for (std::size_t k = 1; k < n; ++k) {
        motion[k] = cull_signature_motion(frames[members[k - 1]].signature, frames[members[k]].signature);
        rows[members[k]].motion = motion[k].energy;
      }

    // Where is the peak of the action?
    int peak = -1;
    double peak_confidence = 0;
    const char* peak_kind = "";
    if (signatures && n >= 3) {
      bool subjects = true;
      for (auto i : members) subjects = subjects && confident_subject(frames[i]);
      std::vector<double> track(n, .5);
      for (std::size_t k = 0; k < n; ++k) {
        if (subjects) {
          const auto& r = frames[members[k]].subject.region;
          track[k] = r.y + r.height / 2;
        } else {
          double sum = 0;
          int count = 0;
          if (k >= 1 && motion[k].energy > .02) { sum += motion[k].centre_y; ++count; }
          if (k + 1 < n && motion[k + 1].energy > .02) { sum += motion[k + 1].centre_y; ++count; }
          track[k] = count ? sum / count : (k ? track[k - 1] : .5);
        }
      }
      // The top of a jump: rising, then falling (image y grows downward).
      double best = 0;
      for (std::size_t k = 1; k + 1 < n; ++k) {
        const double rise = track[k - 1] - track[k], fall = track[k + 1] - track[k];
        if (rise > .015 && fall > .015 && std::min(rise, fall) > best) {
          best = std::min(rise, fall);
          peak = int(k);
        }
      }
      if (peak >= 0) {
        peak_confidence = .3 + .25 * clamp01(best / .08);
        peak_kind = "apex";
      } else {
        std::vector<double> energies;
        for (std::size_t k = 1; k < n; ++k) energies.push_back(motion[k].energy);
        auto sorted = energies;
        std::sort(sorted.begin(), sorted.end());
        const double median = sorted[sorted.size() / 2];
        const auto top = std::size_t(std::max_element(energies.begin(), energies.end()) - energies.begin());
        if (energies[top] > .05 && energies[top] > 1.6 * median + .01) {
          peak = int(top + 1); // the frame the biggest change arrives at
          peak_confidence = .25 + .15 * clamp01((energies[top] / std::max(.01, median) - 1.6) / 3);
          peak_kind = "motion";
        }
      }
    }
    if (peak >= 0) rows[members[std::size_t(peak)]].at_peak = true;

    // Sequence heads.
    const double sigma = std::max(1.0, double(n) / 5);
    for (std::size_t k = 0; k < n; ++k) {
      auto& heads = rows[members[k]].heads;
      heads.set(CullHead::burst_position, double(k) / double(n - 1), 1);
      if (peak >= 0) {
        const double d = double(k) - peak;
        heads.set(CullHead::peak_action, std::exp(-d * d / (2 * sigma * sigma)), peak_confidence);
      }
    }

    // Rank: the photographer's own decisions first, then the profile.
    std::vector<CullRankKey> keys(n);
    for (std::size_t k = 0; k < n; ++k) keys[k] = cull_rank_key(rows[members[k]].heads, profile);
    const auto standing = [&](std::size_t k) {
      const int v = frames[members[k]].verdict;
      return v == 1 ? 2 : v == 2 ? 0 : 1;
    };
    std::vector<std::size_t> order(n);
    std::iota(order.begin(), order.end(), 0);
    std::stable_sort(order.begin(), order.end(), [&](std::size_t a, std::size_t b) {
      if (standing(a) != standing(b)) return standing(a) > standing(b);
      return cull_rank_before(keys[a], keys[b]);
    });
    for (std::size_t r = 0; r < n; ++r) rows[members[order[r]]].rank = int(r);

    const std::size_t pick = order[0];
    const bool has_pick = standing(pick) > 0;
    const auto focus_of = [&](std::size_t k) { return head_or(rows[members[k]].heads, CullHead::subject_focus, 0); };
    const double pick_focus = focus_of(pick);
    const bool eyes_level = frames[members[pick]].has_subject && frames[members[pick]].subject.level == CullSubjectLevel::eyes;

    if (has_pick) {
      auto& row = rows[members[pick]];
      row.role = CullBurstRole::pick;
      double sharpest = 0;
      for (std::size_t k = 0; k < n; ++k) sharpest = std::max(sharpest, focus_of(k));
      const bool is_sharpest = pick_focus >= sharpest - .02;
      const bool near_peak = peak >= 0 && std::abs(int(pick) - peak) <= 1;
      const char* subject = eyes_level ? "eyes" : "subject";
      if (standing(pick) == 2) row.reason = "Your pick";
      else if (near_peak && is_sharpest)
        row.reason = std::string("Sharpest ") + subject + (std::string(peak_kind) == "apex" ? " at the top of the action" : " at the peak of the action");
      else if (near_peak) row.reason = std::string("Peak of the action, ") + subject + " sharp";
      else if (is_sharpest) row.reason = std::string("Sharpest ") + subject + " in burst";
      else row.reason = "Best balance of moment and focus";
    }

    int alternates = 0;
    for (std::size_t r = has_pick ? 1 : 0; r < n; ++r) {
      const std::size_t k = order[r];
      auto& row = rows[members[k]];
      const auto& frame = frames[members[k]];
      const double focus = focus_of(k);
      const std::string when = !has_pick ? "" : k < pick ? "earlier moment" : "later moment";

      // The same moment as any frame ranked above it.
      if (signatures) {
        double closest = 1;
        std::size_t twin = pick;
        for (std::size_t above = 0; above < r; ++above) {
          const auto other = order[above];
          const auto m = cull_signature_motion(frames[members[other]].signature, frame.signature);
          if (m.energy < closest) {
            closest = m.energy;
            twin = other;
          }
        }
        row.heads.set(CullHead::duplicate_similarity, 1 - clamp01(closest / (options.duplicate_energy * 4)), .6);
        if (closest < options.duplicate_energy) {
          row.role = CullBurstRole::duplicate;
          const auto phrase = sharpness_phrase(focus, focus_of(twin));
          row.reason = twin == pick ? "Same moment as the pick, " + (phrase == "as sharp" ? std::string("no sharper") : phrase)
                                    : "Same moment as a better frame, " + (phrase == "as sharp" ? std::string("no sharper") : phrase);
          continue;
        }
      }
      if (frame.validity == CullValidityState::suspect) {
        row.role = CullBurstRole::review;
        row.reason = "May not be a photograph";
        continue;
      }
      const bool passed = keys[k].passed && standing(k) > 0;
      const bool close = has_pick && passed && !keys[k].buckets.empty() &&
                         (keys[k].buckets[0] >= keys[pick].buckets[0] || keys[k].total >= keys[pick].total - .04);
      if (close && alternates < options.max_alternates) {
        ++alternates;
        row.role = CullBurstRole::alternate;
        const auto phrase = sharpness_phrase(focus, pick_focus);
        row.reason = capitalized(when + ", " + (phrase == "as sharp" ? std::string("just as sharp") : phrase));
        continue;
      }
      if (close) {
        row.role = CullBurstRole::review;
        row.reason = "Close call with the pick";
        continue;
      }
      const auto& focus_head = row.heads.get(CullHead::subject_focus);
      if (passed && (!focus_head.present || focus_head.confidence < .3)) {
        row.role = CullBurstRole::review;
        row.reason = "Too little detail to judge focus";
        continue;
      }
      const int anchor = peak >= 0 ? peak : int(pick);
      const bool before = int(k) < anchor;
      row.role = before ? CullBurstRole::build_up : CullBurstRole::follow_through;
      std::string moment = peak >= 0 ? (before ? "before the peak" : "after the peak") : (before ? "earlier moment" : "later moment");
      std::string quality;
      if (!keys[k].passed && keys[k].failed_gate >= 0) {
        const auto gate = profile.gates[std::size_t(keys[k].failed_gate)].head;
        quality = gate == CullHead::subject_focus ? "subject out of focus"
                  : gate == CullHead::camera_shake ? "camera shake"
                  : gate == CullHead::eyes_open ? "eyes closed"
                                                : "not usable";
      } else {
        quality = has_pick ? sharpness_phrase(focus, pick_focus) : "";
        if (quality == "as sharp") quality = "as sharp as the pick";
      }
      row.reason = capitalized(quality.empty() ? moment : moment + ", " + quality);
    }
  }
  return rows;
}

} // namespace lenslabs
