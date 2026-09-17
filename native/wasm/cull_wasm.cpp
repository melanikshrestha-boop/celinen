// WebAssembly face of the C++ cull engine (native/src/cull.cpp). The analysis
// worker writes a decoded frame straight into this module's memory, gets one
// packed reading back, and later hands every reading to the shoot-level pass.
//
// Frames cross the boundary as flat double arrays rather than JSON or strings:
// a shoot is thousands of frames, and the layout is shared with
// src/lib/studio/cull/engine.ts.
#include "lenslabs/cull.hpp"
#include <cstdlib>
#include <cstring>
#include <new>
#include <string>
#include <vector>

namespace {
lenslabs::Image source;
std::vector<lenslabs::CullFace> faces;
std::vector<double> buffer;  // shared scratch: faces in, reading/frames in, rows out
std::vector<std::int32_t> rows;
std::string error;

constexpr std::size_t reading_fields = 27;
constexpr std::size_t color_bytes = 48;
constexpr std::size_t reading_doubles = reading_fields + color_bytes;
constexpr std::size_t frame_doubles = reading_doubles + 3; // capture time, verdict, unreadable
constexpr std::size_t row_fields = 6;
constexpr std::size_t face_doubles = 9;

// Faces written by the caller into the shared buffer (layout: celinen_cull_faces).
void read_faces(std::uint32_t count) {
  faces.clear();
  for (std::uint32_t i = 0; i < count && (i + 1) * face_doubles <= buffer.size(); ++i) {
    const double* in = buffer.data() + std::size_t(i) * face_doubles;
    lenslabs::CullFace face;
    face.x = in[0];
    face.y = in[1];
    face.width = in[2];
    face.height = in[3];
    face.sharpness = in[4];
    face.eyes_open = int(in[5]);
    face.score = in[6];
    face.closed_probability = in[7];
    face.confidence = in[8];
    faces.push_back(face);
  }
}

template <class Work> int guarded(Work work) {
  try {
    error.clear();
    work();
    return 1;
  } catch (const std::bad_alloc&) {
    error = "This shoot is too large for the browser's memory.";
  } catch (const std::exception& failure) {
    error = failure.what();
  } catch (...) {
    error = "Cull failed.";
  }
  return 0;
}

void write_reading(const lenslabs::CullReading& r, double* out) {
  out[0] = r.acuity_subject;
  out[1] = r.acuity_best;
  out[2] = r.texture;
  out[3] = r.motion;
  out[4] = r.global_smear ? 1 : 0;
  out[5] = r.noise;
  out[6] = r.brightness;
  out[7] = r.subject_luma;
  out[8] = r.clipped_highlights;
  out[9] = r.clipped_shadows;
  out[10] = r.subject_clipped;
  out[11] = r.black_point;
  out[12] = r.median;
  out[13] = r.white_point;
  out[14] = r.subject_x;
  out[15] = r.subject_y;
  // A 64-bit hash does not survive a double, so it travels as two halves.
  out[16] = double(std::uint32_t(r.hash >> 32));
  out[17] = double(std::uint32_t(r.hash & 0xffffffffu));
  out[18] = r.sharpness;
  out[19] = r.quality;
  out[20] = r.has_face ? 1 : 0;
  out[21] = r.eyes_closed ? 1 : 0;
  out[22] = r.face_soft ? 1 : 0;
  out[23] = r.face_count;
  out[24] = r.eyes_uncertain ? 1 : 0;
  out[25] = r.eyes_closed_probability;
  out[26] = r.eyes_confidence;
  for (std::size_t i = 0; i < color_bytes; ++i) out[reading_fields + i] = r.color[i];
}

lenslabs::CullReading read_reading(const double* in) {
  lenslabs::CullReading r;
  r.acuity_subject = in[0];
  r.acuity_best = in[1];
  r.texture = in[2];
  r.motion = in[3];
  r.global_smear = in[4] != 0;
  r.noise = in[5];
  r.brightness = in[6];
  r.subject_luma = in[7];
  r.clipped_highlights = in[8];
  r.clipped_shadows = in[9];
  r.subject_clipped = in[10];
  r.black_point = in[11];
  r.median = in[12];
  r.white_point = in[13];
  r.subject_x = in[14];
  r.subject_y = in[15];
  r.hash = (std::uint64_t(std::uint32_t(in[16])) << 32) | std::uint32_t(in[17]);
  r.sharpness = in[18];
  r.quality = in[19];
  r.has_face = in[20] != 0;
  r.eyes_closed = in[21] != 0;
  r.face_soft = in[22] != 0;
  r.face_count = int(in[23]);
  r.eyes_uncertain = in[24] != 0;
  r.eyes_closed_probability = in[25];
  r.eyes_confidence = in[26];
  for (std::size_t i = 0; i < color_bytes; ++i)
    r.color[i] = std::uint8_t(in[reading_fields + i]);
  return r;
}
} // namespace

extern "C" {
const char* celinen_cull_error() { return error.c_str(); }
std::uint32_t celinen_cull_reading_size() { return reading_doubles; }
std::uint32_t celinen_cull_frame_size() { return frame_doubles; }
std::uint32_t celinen_cull_row_size() { return row_fields; }

// Size the retained frame and return its RGBA pointer for the caller to fill.
std::uint8_t* celinen_cull_source(std::uint32_t width, std::uint32_t height) {
  const bool sized = guarded([&] {
    if (!width || !height || width > 4096 || height > 4096)
      throw std::invalid_argument("Cull needs a working image no larger than 4096 pixels.");
    source.rgba.assign(std::size_t(width) * height * 4, 0);
    source.width = source.source_width = width;
    source.height = source.source_height = height;
  });
  if (!sized) source = {};
  return sized ? source.rgba.data() : nullptr;
}

// Nine doubles per face: x, y, width, height (normalized), sharpness, legacy
// eyes (-1 unknown, 0 closed, 1 open), detector score, closed probability,
// confidence (negative score and probability when unknown). Returns the buffer
// to write them into.
double* celinen_cull_faces(std::uint32_t count) {
  if (count > 64) return nullptr;
  const bool sized = guarded([&] { buffer.assign(std::size_t(count) * face_doubles, 0); });
  return sized ? buffer.data() : nullptr;
}

// Measures the retained frame with the faces last written. Returns a pointer to
// one packed reading, or null with celinen_cull_error() set.
const double* celinen_cull_measure(std::uint32_t face_count) {
  const bool measured = guarded([&] {
    if (!source.width) throw std::invalid_argument("No frame is loaded.");
    read_faces(face_count);
    const auto reading = lenslabs::measure_cull(source, faces);
    buffer.assign(reading_doubles, 0);
    write_reading(reading, buffer.data());
  });
  return measured ? buffer.data() : nullptr;
}

/** Decides the eyes of the faces last written, with explicit thresholds: the
 * engine's own rule, re-run at other operating points by the evaluation.
 * Returns state * 256 + primary + 1 (state 0 unknown, 1 open, 2 uncertain,
 * 3 closed; primary -1 when there are no faces), or -1 with the error set.
 */
int celinen_cull_judge_eyes(std::uint32_t face_count, double frame_aspect, double closed_probability,
                            double min_confidence, double uncertain_probability, double companion_prominence) {
  int result = -1;
  const bool judged = guarded([&] {
    read_faces(face_count);
    lenslabs::EyeThresholds thresholds;
    thresholds.closed_probability = closed_probability;
    thresholds.min_confidence = min_confidence;
    thresholds.uncertain_probability = uncertain_probability;
    thresholds.companion_prominence = companion_prominence;
    const auto verdict = lenslabs::judge_eyes(faces, frame_aspect, thresholds);
    result = int(verdict.state) * 256 + verdict.primary + 1;
  });
  return judged ? result : -1;
}

// Room for `count` packed frames; the caller fills it and calls the pass below.
double* celinen_cull_frames(std::uint32_t count) {
  if (count > 200000) return nullptr;
  const bool sized = guarded([&] { buffer.assign(std::size_t(count) * frame_doubles, 0); });
  return sized ? buffer.data() : nullptr;
}

// Runs the shoot-level pass. Returns a pointer to `count` rows of
// (verdict, reason, score, group, best_of_group, duplicate), or null on failure.
const std::int32_t* celinen_cull_shoot(std::uint32_t count, double keep_bias, double burst_gap_ms,
                                       std::uint32_t hash_tolerance) {
  const bool judged = guarded([&] {
    if (std::size_t(count) * frame_doubles > buffer.size())
      throw std::invalid_argument("Cull frame buffer is incomplete.");
    std::vector<lenslabs::CullFrameInput> frames(count);
    for (std::uint32_t i = 0; i < count; ++i) {
      const double* in = buffer.data() + std::size_t(i) * frame_doubles;
      auto& frame = frames[i];
      // The photographer's own ids stay in the page; position is identity here.
      frame.id = std::to_string(i);
      frame.reading = read_reading(in);
      frame.capture_time_ms = in[reading_doubles];
      frame.verdict = int(in[reading_doubles + 1]);
      frame.unreadable = in[reading_doubles + 2] != 0;
    }
    lenslabs::CullOptions options;
    options.keep_bias = keep_bias;
    options.burst_gap_ms = burst_gap_ms;
    options.hash_tolerance = hash_tolerance;
    const auto judged_rows = lenslabs::cull_shoot(frames, options);
    rows.assign(std::size_t(count) * row_fields, 0);
    for (std::size_t i = 0; i < judged_rows.size(); ++i) {
      const auto& row = judged_rows[i];
      std::int32_t* out = rows.data() + i * row_fields;
      out[0] = std::int32_t(row.verdict);
      out[1] = std::int32_t(row.reason);
      out[2] = row.score;
      out[3] = row.group;
      out[4] = row.best_of_group ? 1 : 0;
      out[5] = row.duplicate ? 1 : 0;
    }
  });
  return judged ? rows.data() : nullptr;
}

// Frees the retained frame and buffers between shoots.
void celinen_cull_release() {
  source = {};
  faces.clear();
  buffer.clear();
  buffer.shrink_to_fit();
  rows.clear();
  rows.shrink_to_fit();
}
}
