// WebAssembly face of the C++ Develop engine. The hosted site cannot spawn
// lenslabs-develop, so the same develop()/read_develop_protocol() code is
// compiled to wasm and driven from a Web Worker. No second renderer exists:
// a recipe renders through identical C++ whether it runs locally or hosted.
//
// Memory contract (single-threaded, one worker owns one instance):
//   1. celinen_source(w,h) sizes the retained source and returns its RGBA
//      pointer; the worker writes decoded pixels straight into it (no copy).
//   2. celinen_develop(protocol,len,high_res) renders the retained source.
//      The source stays resident, so a slider drag re-sends only recipe text.
//   3. celinen_result_* expose the finished image until the next render.
// Every entry point returns 0 on failure; celinen_error() explains why.
#include "lenslabs/develop.hpp"
#include "lenslabs/develop_auto.hpp"
#include "lenslabs/look_match.hpp"
#include <cstdlib>
#include <new>
#include <sstream>
#include <string>

namespace {
lenslabs::Image source, result;
lenslabs::DevelopAuto suggestion;
std::string error;
std::vector<double> look_described, look_inputs, look_matched;

// Exceptions must never cross the C ABI: an uncaught throw aborts the whole
// instance and strands the worker. Translate each into a recoverable message.
template <class Work> int guarded(Work work) {
  try {
    error.clear();
    work();
    return 1;
  } catch (const std::bad_alloc&) {
    error = "This photo is too large for the browser's memory at this size.";
  } catch (const std::exception& failure) {
    error = failure.what();
  } catch (...) {
    error = "Develop failed.";
  }
  return 0;
}
} // namespace

extern "C" {
const char* celinen_error() { return error.c_str(); }
const char* celinen_engine() { return lenslabs::engine_version; }

// Scratch space for the recipe text.
void* celinen_alloc(std::uint32_t bytes) { return std::malloc(bytes); }
void celinen_release(void* pointer) { std::free(pointer); }

std::uint8_t* celinen_source(std::uint32_t width, std::uint32_t height) {
  const bool sized = guarded([&] {
    if (!lenslabs::valid_develop_dimensions(width, height, true))
      throw std::invalid_argument("Invalid Develop image.");
    // Drop the previous result first: at the 36MP bound the two buffers
    // together are the difference between fitting in wasm32 and not.
    result = {};
    source.rgba.assign(std::size_t(width) * height * 4, 0);
    source.width = source.source_width = width;
    source.height = source.source_height = height;
  });
  if (!sized) source = {};
  return sized ? source.rgba.data() : nullptr;
}

int celinen_develop(const char* protocol, std::uint32_t length, int high_resolution) {
  return guarded([&] {
    if (!protocol || !source.width) throw std::invalid_argument("No Develop image is loaded.");
    std::istringstream input(std::string(protocol, length));
    const auto settings = lenslabs::read_develop_protocol(input);
    result = {};
    result = lenslabs::develop(source, settings, high_resolution != 0);
  });
}
std::uint32_t celinen_result_width() { return result.width; }
std::uint32_t celinen_result_height() { return result.height; }
const std::uint8_t* celinen_result_pixels() { return result.rgba.data(); }
// Hand the result's memory back as soon as the worker has copied it out.
void celinen_result_release() { result = {}; }

// Nine doubles followed by two flags, in DevelopAuto declaration order.
const double* celinen_suggest() {
  static double values[11];
  const bool measured = guarded([&] {
    if (!source.width) throw std::invalid_argument("No Develop image is loaded.");
    suggestion = lenslabs::suggest_develop(source);
  });
  if (!measured) return nullptr;
  const auto& s = suggestion;
  const double next[11] = {s.exposure, s.contrast, s.highlights, s.shadows, s.whites, s.blacks,
                           s.temperature, s.tint, s.vibrance,
                           double(s.white_balance_measured), double(s.applicable)};
  for (int i = 0; i < 11; ++i) values[i] = next[i];
  return values;
}

// ---- Match a look (native/src/look_match.cpp) ----
// 1. Per inspiration: load it as the source, celinen_look_describe() returns
//    celinen_look_size() doubles for the page to keep.
// 2. Per photo: load it as the source, celinen_look_inputs(count) returns room
//    for count descriptors, celinen_look_match(count, recipe) solves, and the
//    returned doubles follow the LookMatch layout below.
std::uint32_t celinen_look_size() { return std::uint32_t(lenslabs::look_descriptor_size); }

const double* celinen_look_describe() {
  const bool described = guarded([&] {
    if (!source.width) throw std::invalid_argument("No inspiration image is loaded.");
    look_described = lenslabs::serialize_look(lenslabs::describe_look(source));
  });
  return described ? look_described.data() : nullptr;
}

double* celinen_look_inputs(std::uint32_t count) {
  const bool sized = guarded([&] {
    if (count < 1 || count > 16) throw std::invalid_argument("Use between one and sixteen inspiration photos.");
    look_inputs.assign(std::size_t(count) * lenslabs::look_descriptor_size, 0);
  });
  return sized ? look_inputs.data() : nullptr;
}

// Layout: applicable, distance, evaluations, renders; exposure, contrast,
// highlights, shadows, whites, blacks, temperature, tint, saturation, vibrance,
// clarity, dehaze; curve count, 16 (x, y) pairs; 8 x (hue, saturation,
// luminance); shadow, midtone, highlight, global grade (hue, saturation,
// luminance); balance, blending, tonal model; grain, grain size, grain
// luminance, fade, vignette, bloom, halation, film falloff, curve interpolation.
const double* celinen_look_match(std::uint32_t count, const char* protocol, std::uint32_t length,
                                 std::uint32_t output_edge) {
  const bool matched = guarded([&] {
    if (!source.width) throw std::invalid_argument("No photo is loaded.");
    if (!protocol || count < 1 || look_inputs.size() != std::size_t(count) * lenslabs::look_descriptor_size)
      throw std::invalid_argument("Drop an inspiration photo first.");
    std::vector<lenslabs::LookDescriptor> looks;
    for (std::uint32_t i = 0; i < count; ++i)
      looks.push_back(lenslabs::deserialize_look(look_inputs.data() + std::size_t(i) * lenslabs::look_descriptor_size,
                                                 lenslabs::look_descriptor_size));
    std::istringstream input(std::string(protocol, length));
    const auto current = lenslabs::read_develop_protocol(input);
    const auto match = lenslabs::match_look(source, lenslabs::combine_looks(looks), current, output_edge);
    const auto& s = match.settings;
    look_matched.assign(4, 0);
    look_matched[0] = match.applicable ? 1 : 0;
    look_matched[1] = match.distance;
    look_matched[2] = match.evaluations;
    look_matched[3] = match.renders;
    for (double v : {s.exposure, s.contrast, s.highlights, s.shadows, s.whites, s.blacks, s.temperature, s.tint,
                     s.saturation, s.vibrance, s.clarity, s.dehaze})
      look_matched.push_back(v);
    look_matched.push_back(double(s.curve.size()));
    for (std::size_t i = 0; i < 16; ++i) {
      look_matched.push_back(i < s.curve.size() ? s.curve[i].x : 0);
      look_matched.push_back(i < s.curve.size() ? s.curve[i].y : 0);
    }
    for (const auto& h : s.hsl)
      for (double v : {h.hue, h.saturation, h.luminance}) look_matched.push_back(v);
    for (const auto* g : {&s.shadow_grade, &s.midtone_grade, &s.highlight_grade, &s.global_grade})
      for (double v : {g->hue, g->saturation, g->luminance}) look_matched.push_back(v);
    for (double v : {s.balance, s.blending, s.tonal_grading ? 1.0 : 0.0, s.grain, s.grain_size, s.grain_luminance,
                     s.fade, s.vignette, s.bloom, s.halation, s.film_falloff, double(s.curve_interpolation)})
      look_matched.push_back(v);
  });
  return matched ? look_matched.data() : nullptr;
}
}
