#pragma once
#include "lenslabs/cull.hpp"
#include <array>
#include <cstdint>
#include <vector>

// Scoring heads and genre profiles.
//
// A head is one named judgment about a frame, 0..1, with its own confidence.
// Today most heads are filled model-free from the engine's measurements; a
// learned model (a MediaPipe landmarker, an aesthetic or expression network)
// fills the same slot later without changing anything downstream. Every head is
// optional: absent means "no evidence", which is not the same as a bad score.
//
// Profiles turn heads into a ranking. A plain weighted average lets a great
// composition buy back a missed focus; photographers do not cull that way. A
// profile is instead:
//   1. gates     — a confident failure on a gate head (not a photograph, subject
//                  out of focus, eyes closed at a wedding) ranks below every
//                  frame that passes, whatever else it has;
//   2. tiers     — lexicographic priority: tier 1 decides unless two frames are
//                  within its resolution, then tier 2, and so on;
//   3. weights   — only inside a tier, where the heads are genuinely
//                  interchangeable.
namespace lenslabs {

enum class CullHead : std::uint8_t {
  validity,             // is a usable photograph (1) .. not a photograph (0)
  subject_confidence,   // a subject was found (1) .. none (0)
  subject_focus,        // subject sharpness
  eye_focus,            // sharpness on the eyes
  eyes_open,            // eyes open (1) .. closed (0)
  exposure,             // subject well exposed (1) .. unusable (0)
  noise,                // noisy (1) .. clean (0)            [lower is better]
  camera_shake,         // shaken (1) .. steady (0)          [lower is better]
  subject_motion,       // subject smeared (1) .. frozen (0) [lower is better]
  composition,          // placement and framing
  aesthetic,            // overall appeal (learned only)
  expression,           // expression quality (learned only)
  peak_action,          // at the decisive moment (1) .. far from it (0)
  occlusion,            // subject blocked (1) .. clear (0)  [lower is better]
  duplicate_similarity, // near-identical to a better frame (1) .. unique (0) [lower is better]
  burst_position,       // position in the burst, 0 first .. 1 last [informational]
  ball_visibility,      // the ball or puck is visible and near the action
  pose,                 // body pose reads as athletic / intentional
  count
};

inline constexpr std::size_t cull_head_count = std::size_t(CullHead::count);

struct CullHeadValue {
  double value = 0;      // 0..1 in the head's own direction (see the enum)
  double confidence = 0; // 0..1
  bool present = false;
};

struct CullHeadSet {
  std::array<CullHeadValue, cull_head_count> heads{};
  void set(CullHead head, double value, double confidence);
  const CullHeadValue& get(CullHead head) const { return heads[std::size_t(head)]; }
  // Fills every head `other` has that this set lacks, or where `other` is more
  // confident. Learned heads override model-free ones this way.
  void merge(const CullHeadSet& other);
};

const char* cull_head_name(CullHead head) noexcept;
// False for heads where a lower value is better (noise, shake, motion,
// occlusion, duplicate similarity) and for the informational burst position.
bool cull_head_higher_is_better(CullHead head) noexcept;

enum class CullGenre : std::uint8_t { sports, wedding, portrait, event };
const char* cull_genre_name(CullGenre genre) noexcept;

struct CullGate {
  CullHead head;
  double minimum;        // on the oriented value (higher is better)
  double min_confidence; // below this the gate cannot fail a frame
};
struct CullTierTerm {
  CullHead head;
  double weight;
};
struct CullTier {
  std::vector<CullTierTerm> terms;
  double resolution; // tier scores closer than this are a tie at this tier
};
struct CullProfile {
  CullGenre genre;
  std::vector<CullGate> gates;
  std::vector<CullTier> tiers;
};

const CullProfile& cull_profile(CullGenre genre);

// A comparable key: gates first, then each tier's bucket, then the total as the
// last tiebreak. Buckets (rather than a tolerance compare) keep the ordering a
// strict weak ordering, so it can drive std::sort.
struct CullRankKey {
  bool passed = true;
  int failed_gate = -1;         // index into the profile's gates, -1 when none failed
  std::vector<int> buckets;     // one per tier
  std::vector<double> scores;   // one per tier, 0..1
  double total = 0;             // weighted over every tier
};

CullRankKey cull_rank_key(const CullHeadSet& heads, const CullProfile& profile);
// True when `a` ranks strictly ahead of `b`.
bool cull_rank_before(const CullRankKey& a, const CullRankKey& b) noexcept;

// Model-free heads from the per-frame scorer's reading: exposure, noise,
// camera shake, subject motion, and a composition prior from the subject
// position. Everything else stays absent.
CullHeadSet cull_heads_from_reading(const CullReading& reading);

} // namespace lenslabs
