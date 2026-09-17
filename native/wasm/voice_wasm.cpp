// WebAssembly face of the C++ dictation front end (native/src/voice.cpp).
// One instance serves one open microphone. The page writes each audio chunk
// straight into the input buffer, then collects finished 16 kHz PCM16 segments.
// Entry points return -1 (or null) on failure instead of throwing across the ABI.
#include "lenslabs/voice.hpp"
#include <memory>
#include <vector>

namespace {
std::unique_ptr<lenslabs::VoiceFrontEnd> voice;
std::vector<float> input;
}

extern "C" {
int celinen_voice_open(double sample_rate) {
  try {
    voice = std::make_unique<lenslabs::VoiceFrontEnd>(sample_rate);
    return 1;
  } catch (...) {
    voice.reset();
    return -1;
  }
}
// Chunk buffer for `count` samples; valid until the next call into the module.
float* celinen_voice_input(std::uint32_t count) {
  try {
    if (count > (1u << 20)) return nullptr; // ~5 s at 192 kHz: no real callback is larger
    input.resize(count);
    return input.data();
  } catch (...) {
    return nullptr;
  }
}
// Process the first `count` samples of the chunk buffer. Returns finished segments waiting.
int celinen_voice_push(std::uint32_t count) {
  try {
    if (!voice || count > input.size()) return -1;
    voice->push(input.data(), count);
    return int(voice->segments());
  } catch (...) {
    return -1;
  }
}
int celinen_voice_flush() {
  try {
    if (!voice) return -1;
    voice->flush();
    return int(voice->segments());
  } catch (...) {
    return -1;
  }
}
float celinen_voice_level() { return voice ? voice->level() : 0; }
int celinen_voice_speaking() { return voice && voice->speaking(); }
std::uint32_t celinen_voice_segment_samples() { return voice ? std::uint32_t(voice->front().size()) : 0; }
const std::int16_t* celinen_voice_segment() { return voice ? voice->front().data() : nullptr; }
void celinen_voice_segment_release() { if (voice) voice->pop(); }
}
