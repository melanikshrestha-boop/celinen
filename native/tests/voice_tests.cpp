#include "lenslabs/voice.hpp"
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {
constexpr double pi = 3.14159265358979323846;
int checks = 0;
void check(bool passed, const char* label) { ++checks; if (!passed) throw std::runtime_error(label); }

// Deterministic room tone: a tiny LCG hiss, far below speech level.
struct Room {
  std::uint32_t state = 12345;
  float next(float amplitude) {
    state = state * 1664525u + 1013904223u;
    return (float(state >> 8) / float(1u << 24) * 2 - 1) * amplitude;
  }
};
// Voiced-speech stand-in: a 180 Hz fundamental with harmonics under a 4 Hz syllable envelope.
void speak(std::vector<float>& out, double rate, double seconds, float amplitude, Room& room) {
  const auto n = std::size_t(rate * seconds);
  for (std::size_t i = 0; i < n; ++i) {
    const double t = i / rate, envelope = .55 + .45 * std::sin(2 * pi * 4 * t);
    const double voice = std::sin(2 * pi * 180 * t) + .5 * std::sin(2 * pi * 360 * t) + .3 * std::sin(2 * pi * 1260 * t);
    out.push_back(float(voice / 1.8 * envelope) * amplitude + room.next(.0008f));
  }
}
void hush(std::vector<float>& out, double rate, double seconds, Room& room) {
  const auto n = std::size_t(rate * seconds);
  for (std::size_t i = 0; i < n; ++i) out.push_back(room.next(.0008f) + .02f); // with a DC offset
}
void tone(std::vector<float>& out, double rate, double seconds, double hz, float amplitude) {
  const auto n = std::size_t(rate * seconds);
  for (std::size_t i = 0; i < n; ++i) out.push_back(float(std::sin(2 * pi * hz * i / rate)) * amplitude);
}
// Feed in uneven chunks, the way an audio callback and a message port deliver it.
void feed(lenslabs::VoiceFrontEnd& voice, const std::vector<float>& audio) {
  std::size_t at = 0, chunk = 128;
  while (at < audio.size()) {
    const auto take = std::min(chunk, audio.size() - at);
    voice.push(audio.data() + at, take);
    at += take;
    chunk = chunk == 128 ? 2048 : chunk == 2048 ? 441 : 128;
  }
}
double seconds_of(const std::vector<std::int16_t>& pcm) { return pcm.size() / lenslabs::voice_output_rate; }
std::size_t zero_crossings(const std::vector<std::int16_t>& pcm) {
  std::size_t count = 0;
  for (std::size_t i = 1; i < pcm.size(); ++i) if ((pcm[i - 1] < 0) != (pcm[i] < 0)) ++count;
  return count;
}
}

int main() {
  try {
    for (double rate : {48000.0, 44100.0, 16000.0}) {
      Room room; std::vector<float> audio;
      hush(audio, rate, 1.0, room); speak(audio, rate, 1.2, .2f, room); hush(audio, rate, 1.2, room);
      lenslabs::VoiceFrontEnd voice(rate);
      feed(voice, audio);
      check(voice.segments() == 1 && !voice.speaking(), "One utterance closes into one segment after its pause.");
      const double length = seconds_of(voice.front());
      // 0.3 s pre-roll + 1.2 s speech + 0.2 s tail, within two analysis frames.
      check(length > 1.55 && length < 1.85, "The segment keeps its onset and a short tail, not the silence.");
      int peak = 0; for (auto v : voice.front()) peak = std::max(peak, std::abs(int(v)));
      check(peak > 20000 && peak <= 32767, "Quiet speech is lifted toward full scale without clipping.");
      voice.pop();
      check(voice.segments() == 0 && voice.front().empty(), "A popped segment is released.");
    }
    {
      Room room; std::vector<float> audio;
      hush(audio, 48000, .8, room);
      tone(audio, 48000, .03, 3000, .6f); // a key tap: loud, 30 ms
      hush(audio, 48000, 1.2, room);
      lenslabs::VoiceFrontEnd voice(48000);
      feed(voice, audio); voice.flush();
      check(voice.segments() == 0, "A key tap is not mistaken for a word.");
    }
    {
      std::vector<float> audio; tone(audio, 48000, 2.0, 1000, .25f);
      lenslabs::VoiceFrontEnd voice(48000);
      feed(voice, audio); voice.flush();
      check(voice.segments() == 1, "Flush closes the open segment at the end of dictation.");
      const auto& pcm = voice.front();
      const double expected = 2 * 1000 * seconds_of(pcm);
      check(std::abs(double(zero_crossings(pcm)) - expected) < expected * .01, "A 1 kHz tone is still 1 kHz after resampling.");
    }
    {
      // 10 kHz is above the 8 kHz output Nyquist: it must vanish, not fold to 6 kHz.
      std::vector<float> audio; tone(audio, 48000, 1.5, 10000, .5f);
      lenslabs::VoiceFrontEnd voice(48000);
      feed(voice, audio); voice.flush();
      check(voice.segments() == 0 && voice.level() < .02f, "Out-of-band energy is rejected instead of aliasing into speech.");
    }
    {
      Room room; std::vector<float> audio;
      hush(audio, 16000, .5, room); speak(audio, 16000, 65, .2f, room);
      lenslabs::VoiceFrontEnd voice(16000);
      feed(voice, audio); voice.flush();
      double total = 0; std::size_t count = voice.segments();
      check(count >= 3, "Unbroken speech is split into uploadable segments.");
      while (voice.segments()) {
        check(seconds_of(voice.front()) <= 30.05, "No segment exceeds the hard limit.");
        total += seconds_of(voice.front()); voice.pop();
      }
      check(total > 64.5 && total < 66, "Splitting loses no speech.");
    }
    {
      // Dictation that begins mid-sentence: no quiet lead-in to learn the room from.
      Room room; std::vector<float> audio;
      speak(audio, 48000, 1.0, .15f, room); hush(audio, 48000, 1.0, room);
      lenslabs::VoiceFrontEnd voice(48000);
      feed(voice, audio);
      check(voice.segments() == 1 && seconds_of(voice.front()) > .9, "Speech present from the first sample is captured.");
    }
    {
      bool rejected = false;
      try { lenslabs::VoiceFrontEnd voice(4000); } catch (const std::invalid_argument&) { rejected = true; }
      check(rejected, "An unusable sample rate is rejected.");
      lenslabs::VoiceFrontEnd voice(48000);
      const float poison[4] = {NAN, INFINITY, -INFINITY, 7};
      voice.push(poison, 4); voice.flush();
      check(voice.segments() == 0 && std::isfinite(voice.level()), "Non-finite input cannot poison the filter state.");
    }
    std::cout << "PASS voice: " << checks << " checks\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "FAIL voice: " << error.what() << "\n";
    return 1;
  }
}
