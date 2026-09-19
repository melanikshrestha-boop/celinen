// WebAssembly face of the cull intelligence passes: the validity gate, the
// subject focus hierarchy, the sequence signature, shoot membership and burst
// roles (native/src/cull_validity.cpp, cull_subject.cpp, cull_sequence.cpp,
// cull_shoot_membership.cpp).
//
// It is a separate module from celinen-cull.wasm on purpose: the per-frame
// scorer and these shoot-level passes change independently, and a shoot pass
// should not pay for the scorer's code (or its model, later) to load.
//
// Numbers cross as flat double arrays and text as one NUL/record-separated
// blob, because a shoot is ten thousand frames and JSON would cost more than
// the analysis. The layouts are shared with src/lib/studio/cull/intel.ts and
// the two must change together.
#include "cull_intel_layout.hpp"
#include "lenslabs/cull_heads.hpp"
#include "lenslabs/cull_sequence.hpp"
#include "lenslabs/cull_shoot_membership.hpp"
#include "lenslabs/cull_subject.hpp"
#include "lenslabs/cull_validity.hpp"
#include <cstdint>
#include <new>
#include <string>
#include <vector>

namespace {
using namespace lenslabs;

using wire::subject_doubles;
using wire::validity_doubles;
constexpr std::size_t head_doubles = cull_head_count * 2;
constexpr std::size_t membership_in_doubles = 8 + 48;
constexpr std::size_t membership_out_doubles = 4;
constexpr std::size_t sequence_in_doubles = 18 + head_doubles;
constexpr std::size_t sequence_out_doubles = 5 + head_doubles;
constexpr std::size_t signature_bytes = cull_signature_width * cull_signature_height;
constexpr char unit_separator = '\x1f', record_separator = '\x1e';

Image source;
std::vector<double> numbers;   // shared scratch: inputs in, results out
std::vector<std::uint8_t> signatures;
std::string text_in, text_out; // records in, plain-English reasons out
std::string error;
CullSequenceSignature frame_signature;

template <class Work> bool guarded(Work work) {
  try {
    error.clear();
    work();
    return true;
  } catch (const std::bad_alloc&) {
    error = "This shoot is too large for the browser's memory.";
  } catch (const std::exception& failure) {
    error = failure.what();
  } catch (...) {
    error = "The cull intelligence pass failed.";
  }
  return false;
}

void write_heads(const CullHeadSet& heads, double* out) {
  for (std::size_t i = 0; i < cull_head_count; ++i) {
    out[i * 2] = heads.heads[i].value;
    // A negative confidence means the head was never measured, which is not the
    // same as a measurement of zero.
    out[i * 2 + 1] = heads.heads[i].present ? heads.heads[i].confidence : -1;
  }
}

CullHeadSet read_heads(const double* in) {
  CullHeadSet heads;
  for (std::size_t i = 0; i < cull_head_count; ++i)
    if (in[i * 2 + 1] >= 0) heads.set(CullHead(i), in[i * 2], in[i * 2 + 1]);
  return heads;
}

// One record's fields, split on the unit separator.
std::vector<std::string> fields_at(const std::string& blob, std::size_t& at, std::size_t count) {
  std::vector<std::string> out(count);
  for (std::size_t i = 0; i < count; ++i) {
    std::string value;
    while (at < blob.size() && blob[at] != unit_separator && blob[at] != record_separator)
      value += blob[at++];
    if (at < blob.size() && blob[at] == unit_separator) ++at;
    out[i] = value;
  }
  while (at < blob.size() && blob[at] != record_separator) ++at;
  if (at < blob.size()) ++at;
  return out;
}
} // namespace

extern "C" {
const char* celinen_intel_error() { return error.c_str(); }
std::uint32_t celinen_intel_validity_size() { return validity_doubles; }
std::uint32_t celinen_intel_subject_size() { return subject_doubles; }
std::uint32_t celinen_intel_head_count() { return cull_head_count; }
std::uint32_t celinen_intel_signature_size() { return signature_bytes; }
std::uint32_t celinen_intel_membership_in_size() { return membership_in_doubles; }
std::uint32_t celinen_intel_membership_out_size() { return membership_out_doubles; }
std::uint32_t celinen_intel_sequence_in_size() { return sequence_in_doubles; }
std::uint32_t celinen_intel_sequence_out_size() { return sequence_out_doubles; }
const char* celinen_intel_text() { return text_out.c_str(); }

// Size the retained frame and hand back its RGBA buffer to fill.
std::uint8_t* celinen_intel_source(std::uint32_t width, std::uint32_t height) {
  const bool sized = guarded([&] {
    if (!width || !height || width > 4096 || height > 4096)
      throw std::invalid_argument("The cull needs a working image no larger than 4096 pixels.");
    source.rgba.assign(std::size_t(width) * height * 4, 0);
    source.width = source.source_width = width;
    source.height = source.source_height = height;
  });
  if (!sized) source = {};
  return sized ? source.rgba.data() : nullptr;
}

/** Judges the retained frame: validity, then the subject focus hierarchy and
 * the sequence signature. Returns the packed validity and subject doubles, with
 * the two plain-English lines in celinen_intel_text() ("reason\x1fevidence").
 */
const double* celinen_intel_frame(std::uint32_t decoder_warnings, std::uint32_t truncated) {
  const bool done = guarded([&] {
    if (!source.width) throw std::invalid_argument("No frame is loaded.");
    CullDecodeHints hints;
    hints.decoder_warnings = int(decoder_warnings);
    hints.truncated = truncated != 0;
    const auto validity = assess_cull_validity(source, hints);
    numbers.assign(validity_doubles + subject_doubles, 0);
    wire::write_validity(validity, numbers.data());
    CullSubjectFocus subject;
    // An invalid frame has no subject worth finding, and no scorer should run
    // on it: skip straight past the hierarchy.
    if (validity.state != CullValidityState::invalid) subject = measure_subject_focus(source);
    wire::write_subject(subject, numbers.data() + validity_doubles);
    frame_signature = cull_sequence_signature(source);
    text_out = std::string(validity.reason) + unit_separator + subject.evidence;
  });
  return done ? numbers.data() : nullptr;
}

// The 32x24 luma signature of the frame last judged.
const std::uint8_t* celinen_intel_frame_signature() { return frame_signature.luma.data(); }

// Room for `count` packed membership frames and for their text records.
double* celinen_intel_membership_numbers(std::uint32_t count) {
  if (count > 200000) return nullptr;
  return guarded([&] { numbers.assign(std::size_t(count) * membership_in_doubles, 0); }) ? numbers.data() : nullptr;
}
char* celinen_intel_text_in(std::uint32_t bytes) {
  if (bytes > 64u * 1024 * 1024) return nullptr;
  return guarded([&] { text_in.assign(bytes, '\0'); }) ? text_in.data() : nullptr;
}

/** Runs the membership pass. Returns `count` rows of
 * (state, confidence, evidence bits, time offset ms); the reasons are in
 * celinen_intel_text(), one per line.
 */
const double* celinen_intel_membership(std::uint32_t count, double suspect_at, double outsider_at) {
  const bool done = guarded([&] {
    if (std::size_t(count) * membership_in_doubles > numbers.size())
      throw std::invalid_argument("The membership buffer is incomplete.");
    std::vector<CullMembershipInput> frames(count);
    std::size_t at = 0;
    for (std::uint32_t i = 0; i < count; ++i) {
      const double* in = numbers.data() + std::size_t(i) * membership_in_doubles;
      auto& f = frames[i];
      f.has_exif = in[0] != 0;
      f.capture_time_ms = in[1];
      f.width = std::uint32_t(in[2]);
      f.height = std::uint32_t(in[3]);
      f.has_look = in[4] != 0;
      f.hash = (std::uint64_t(std::uint32_t(in[5])) << 32) | std::uint32_t(in[6]);
      f.invalid = in[7] != 0;
      for (std::size_t c = 0; c < f.color.size(); ++c) f.color[c] = std::uint8_t(in[8 + c]);
      const auto fields = fields_at(text_in, at, 6);
      f.make = fields[0];
      f.model = fields[1];
      f.serial = fields[2];
      f.lens = fields[3];
      f.software = fields[4];
      f.file_name = fields[5];
    }
    CullMembershipOptions options;
    options.suspect_at = suspect_at;
    options.outsider_at = outsider_at;
    const auto rows = assess_shoot_membership(frames, options);
    numbers.assign(std::size_t(count) * membership_out_doubles, 0);
    text_out.clear();
    for (std::size_t i = 0; i < rows.size(); ++i) {
      double* out = numbers.data() + i * membership_out_doubles;
      out[0] = double(rows[i].state);
      out[1] = rows[i].confidence;
      out[2] = double(rows[i].evidence);
      out[3] = rows[i].time_offset_ms;
      text_out += rows[i].reason;
      text_out += '\n';
    }
  });
  return done ? numbers.data() : nullptr;
}

// Room for `count` packed sequence frames, and for their signatures.
double* celinen_intel_sequence_numbers(std::uint32_t count) {
  if (count > 200000) return nullptr;
  return guarded([&] { numbers.assign(std::size_t(count) * sequence_in_doubles, 0); }) ? numbers.data() : nullptr;
}
std::uint8_t* celinen_intel_signatures(std::uint32_t count) {
  if (count > 200000) return nullptr;
  return guarded([&] { signatures.assign(std::size_t(count) * signature_bytes, 0); }) ? signatures.data() : nullptr;
}

/** Runs the sequence pass. Returns `count` rows of
 * (role, rank, burst size, motion, at peak) followed by the heads the ranking
 * used; the one-line reasons are in celinen_intel_text(), one per line.
 */
const double* celinen_intel_sequence(std::uint32_t count, std::uint32_t genre, double duplicate_energy,
                                     std::uint32_t max_alternates) {
  const bool done = guarded([&] {
    if (std::size_t(count) * sequence_in_doubles > numbers.size())
      throw std::invalid_argument("The sequence buffer is incomplete.");
    if (genre > 3) throw std::invalid_argument("Unknown genre.");
    std::vector<CullSequenceFrame> frames(count);
    const bool have_signatures = signatures.size() >= std::size_t(count) * signature_bytes;
    for (std::uint32_t i = 0; i < count; ++i) {
      const double* in = numbers.data() + std::size_t(i) * sequence_in_doubles;
      auto& f = frames[i];
      f.group = int(in[0]);
      f.capture_time_ms = in[1];
      f.has_signature = in[2] != 0 && have_signatures;
      if (f.has_signature)
        for (std::size_t c = 0; c < signature_bytes; ++c)
          f.signature.luma[c] = signatures[std::size_t(i) * signature_bytes + c];
      f.has_subject = in[3] != 0;
      f.subject.level = CullSubjectLevel(int(in[4]));
      f.subject.region = {in[5], in[6], in[7], in[8], in[9]};
      f.subject.focus = in[10];
      f.subject.focus_confidence = in[11];
      f.subject.eye_focus = in[12];
      f.subject.eyes_open = in[13];
      f.subject.subject_size = in[14];
      f.subject.saliency = in[15];
      f.validity = CullValidityState(int(in[16]));
      f.verdict = int(in[17]);
      f.heads = read_heads(in + 18);
    }
    CullSequenceOptions options;
    options.genre = CullGenre(genre);
    options.duplicate_energy = duplicate_energy;
    options.max_alternates = int(max_alternates);
    const auto rows = assign_burst_roles(frames, options);
    numbers.assign(std::size_t(count) * sequence_out_doubles, 0);
    text_out.clear();
    for (std::size_t i = 0; i < rows.size(); ++i) {
      double* out = numbers.data() + i * sequence_out_doubles;
      out[0] = double(rows[i].role);
      out[1] = rows[i].rank;
      out[2] = rows[i].burst_size;
      out[3] = rows[i].motion;
      out[4] = rows[i].at_peak ? 1 : 0;
      write_heads(rows[i].heads, out + 5);
      text_out += rows[i].reason;
      text_out += '\n';
    }
  });
  return done ? numbers.data() : nullptr;
}

// Hands every buffer back between shoots.
void celinen_intel_release() {
  source = {};
  numbers.clear();
  numbers.shrink_to_fit();
  signatures.clear();
  signatures.shrink_to_fit();
  text_in.clear();
  text_in.shrink_to_fit();
  text_out.clear();
  text_out.shrink_to_fit();
}
}
