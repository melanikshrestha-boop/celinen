#pragma once
#include "lenslabs/cull_heads.hpp"
#include "lenslabs/cull_subject.hpp"
#include "lenslabs/cull_validity.hpp"
#include "lenslabs/engine.hpp"
#include <array>
#include <cstdint>
#include <string>
#include <vector>

// Sequence intelligence: the burst, not the frame, is what a sports
// photographer culls. Eight frames of one play hold one decisive moment; the
// question is never "is frame 5 good?" but "which of these is the picture, and
// what are the others for?".
//
// Each burst (grouped by cull_shoot) is ranked with a genre profile over the
// scoring heads, and every frame gets a role with a one-line reason:
//   PICK            the frame to deliver
//   ALTERNATE       a different moment nearly as good
//   REVIEW          the engine cannot call it; worth a human look
//   BUILD-UP        before the peak of the action
//   FOLLOW-THROUGH  after the peak
//   DUPLICATE       the same moment as a better frame
//
// Model-free today: subject sharpness from the focus hierarchy, motion energy
// from compact luma signatures of consecutive frames (after cancelling camera
// pan), and the action peak from where motion is strongest or where the
// subject's vertical travel reverses (the top of a jump). Learned heads — pose,
// ball, expression — plug into the same CullHeadSet and outrank these.
namespace lenslabs {

inline constexpr unsigned cull_signature_width = 32, cull_signature_height = 24;

// A 32x24 box-averaged luma thumbnail. Small enough to keep for every frame of
// a ten-thousand frame card (768 bytes each), large enough to see a player move.
struct CullSequenceSignature {
  std::array<std::uint8_t, cull_signature_width * cull_signature_height> luma{};
};
CullSequenceSignature cull_sequence_signature(const Image& image);

// How different two signatures are after the best small camera pan is
// cancelled, 0 identical .. ~1 unrelated. Exposure-invariant. The optional
// outputs give the pan (in signature cells) and where the remaining change is
// centred (normalized 0..1).
struct CullMotion {
  double energy = 0;
  int pan_x = 0, pan_y = 0;
  double centre_x = .5, centre_y = .5;
};
CullMotion cull_signature_motion(const CullSequenceSignature& a, const CullSequenceSignature& b);

enum class CullBurstRole : std::uint8_t { none, pick, alternate, review, build_up, follow_through, duplicate };
const char* cull_burst_role_name(CullBurstRole role) noexcept;

struct CullSequenceFrame {
  int group = -1;              // burst id from cull_shoot; -1 stands alone
  double capture_time_ms = -1; // <0 unknown: input order is used
  bool has_signature = false;
  CullSequenceSignature signature;
  bool has_subject = false;
  CullSubjectFocus subject;
  CullHeadSet heads; // reading heads (cull_heads_from_reading) and any learned heads
  CullValidityState validity = CullValidityState::valid;
  int verdict = 0; // the photographer's: 0 undecided, 1 keep, 2 reject
};

struct CullSequenceRow {
  CullBurstRole role = CullBurstRole::none;
  std::string reason;       // one plain-English line; empty for role none
  int rank = -1;            // 0 is the pick; -1 outside a burst
  int burst_size = 0;
  double motion = 0;        // motion energy arriving at this frame, 0..1
  bool at_peak = false;     // this frame is the estimated action peak
  CullHeadSet heads;        // the heads the ranking used, including sequence heads
};

struct CullSequenceOptions {
  CullGenre genre = CullGenre::sports;
  // Signature difference below which two frames are the same moment.
  double duplicate_energy = .06;
  int max_alternates = 2;
};

std::vector<CullSequenceRow> assign_burst_roles(const std::vector<CullSequenceFrame>& frames,
                                                const CullSequenceOptions& options = {});

} // namespace lenslabs
