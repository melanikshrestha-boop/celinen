#include "lenslabs/cull_validity.hpp"
#include <stdexcept>

// The gate wired in front of the existing scorer. Kept apart from
// cull_validity.cpp so modules that only need the validity measurement (the
// shoot intelligence module) do not link the frame scorer.
namespace lenslabs {

CullGatedReading measure_cull_gated(const Image& image, const std::vector<CullFace>& faces,
                                    const CullDecodeHints& hints,
                                    const CullValidityOptions& options) {
  CullGatedReading out;
  out.validity = assess_cull_validity(image, hints, options);
  if (out.validity.state == CullValidityState::invalid) return out; // never scored
  out.reading = measure_cull(image, faces);
  out.measured = true;
  return out;
}

std::vector<CullGatedRow> cull_shoot_gated(const std::vector<CullFrameInput>& frames,
                                           const std::vector<CullValidity>& validity,
                                           const CullOptions& options) {
  if (validity.size() != frames.size())
    throw std::invalid_argument("Validity must be given for every frame.");
  auto withheld = frames;
  for (std::size_t i = 0; i < withheld.size(); ++i)
    if (validity[i].state == CullValidityState::invalid) withheld[i].unreadable = true;
  const auto rows = cull_shoot(withheld, options);

  std::vector<CullGatedRow> out(frames.size());
  for (std::size_t i = 0; i < frames.size(); ++i) {
    auto& gated = out[i];
    gated.row = rows[i];
    gated.validity = validity[i].state;
    gated.validity_reason = validity[i].reason;
    const bool undecided = frames[i].verdict == 0;
    if (validity[i].state == CullValidityState::invalid) {
      gated.row.score = 0;
      gated.row.group = -1;
      gated.row.best_of_group = false;
      gated.row.duplicate = false;
      // The photographer's own decision still stands; only a suggestion changes.
      if (undecided) {
        gated.row.verdict = CullVerdict::reject;
        gated.row.reason = CullReason::none; // the validity reason says why
      }
    } else if (validity[i].state == CullValidityState::suspect && undecided &&
               gated.row.verdict == CullVerdict::keep) {
      // A maybe is shown to the photographer, never kept on the engine's word.
      gated.row.verdict = CullVerdict::undecided;
      gated.row.reason = CullReason::none;
    }
  }
  return out;
}

} // namespace lenslabs
