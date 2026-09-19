#pragma once
#include "lenslabs/cull_subject.hpp"
#include "lenslabs/cull_validity.hpp"
#include <cstddef>

// The packed wire layout for one frame's validity and subject focus.
//
// Two modules write it — the ingest lane (native/wasm/ingest_wasm.cpp), which
// already holds the decoded pixels, and the shoot-level intelligence module
// (native/wasm/cull_intel_wasm.cpp) — and one reader decodes it
// (src/lib/studio/cull/intel.ts). Keeping the writers here means the two can
// never drift from each other; the reader checks the sizes at instantiation.
namespace lenslabs::wire {

inline constexpr std::size_t validity_doubles = 29;
inline constexpr std::size_t subject_doubles = 12;

inline void write_validity(const CullValidity& v, double* out) {
  const auto& e = v.evidence;
  out[0] = double(v.state);
  out[1] = double(v.kind);
  out[2] = v.confidence;
  out[3] = e.luma_mean;
  out[4] = e.luma_std;
  out[5] = e.luma_low;
  out[6] = e.luma_high;
  out[7] = e.clipped_low;
  out[8] = e.clipped_high;
  out[9] = e.spectral_slope;
  out[10] = e.spectral_fit_error;
  out[11] = e.spectral_peak;
  out[12] = e.autocorrelation;
  out[13] = e.grain;
  out[14] = e.smooth_share;
  out[15] = e.exact_flat;
  out[16] = e.exact_flat_smooth;
  out[17] = e.exact_flat_extreme;
  out[18] = e.palette_top;
  out[19] = e.palette_count;
  out[20] = e.saturation;
  out[21] = e.grayscale;
  out[22] = e.edge_density;
  out[23] = e.edge_axis;
  out[24] = e.edge_flank_flat;
  out[25] = e.frozen_rows;
  out[26] = e.band_rows;
  out[27] = e.decoder_warnings;
  out[28] = e.truncated ? 1 : 0;
}

inline void write_subject(const CullSubjectFocus& s, double* out) {
  out[0] = double(s.level);
  out[1] = s.region.x;
  out[2] = s.region.y;
  out[3] = s.region.width;
  out[4] = s.region.height;
  out[5] = s.region.confidence;
  out[6] = s.focus;
  out[7] = s.focus_confidence;
  out[8] = s.eye_focus;
  out[9] = s.eyes_open;
  out[10] = s.subject_size;
  out[11] = s.saliency;
}

} // namespace lenslabs::wire
