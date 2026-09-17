#pragma once
#include <cstddef>
#include <cstdint>
#include <deque>
#include <vector>

namespace lenslabs {
inline constexpr double voice_output_rate = 16000; // speech-to-text native rate

// Tunables are in milliseconds of 16 kHz audio so behavior is independent of the
// microphone's hardware rate.
struct VoiceOptions {
  unsigned pre_roll_ms = 300;      // audio kept before the detected onset (soft consonants)
  unsigned onset_ms = 60;          // continuous speech required to open a segment
  unsigned end_silence_ms = 700;   // pause that closes a segment: a thought, not a breath
  unsigned tail_ms = 200;          // silence kept after the last word
  unsigned min_speech_ms = 250;    // shorter bursts are key taps and clicks, not words
  unsigned soft_limit_ms = 24000;  // after this, split at the next short pause...
  unsigned hard_limit_ms = 30000;  // ...and unconditionally here (upload bound)
};

// Microphone front end for dictation: DC removal, band-limited resampling to
// 16 kHz PCM16, adaptive-noise-floor voice activity detection, and utterance
// segmentation. Streaming and allocation-light; one instance per open microphone.
// Deterministic signal processing: no model, no network, no retained audio
// beyond the current segment and its pre-roll.
class VoiceFrontEnd {
 public:
  explicit VoiceFrontEnd(double input_rate, VoiceOptions options = {});
  // Mono float samples in [-1, 1] at the input rate. Any chunk size.
  void push(const float* samples, std::size_t count);
  // End of dictation: close the open segment, if it holds enough speech.
  void flush();
  bool speaking() const { return open_; }
  // Smoothed 0..1 loudness for a level meter (fast attack, slow release).
  float level() const { return level_; }
  std::size_t segments() const { return ready_.size(); }
  // Oldest finished segment, peak-normalized 16 kHz PCM16. Empty when none.
  const std::vector<std::int16_t>& front() const;
  void pop();

 private:
  void resample(float sample);
  void frame_ready();
  void close_segment();

  VoiceOptions options_;
  // Resampler: windowed-sinc evaluated at each output instant over a ring of
  // recent input. The cutoff tracks the lower of the two Nyquist limits.
  double ratio_;            // input samples per output sample
  int half_width_;          // taps on each side, in input samples
  double cutoff_;           // normalized to the input rate (cycles/sample)
  std::vector<float> ring_;
  std::size_t ring_mask_ = 0;
  std::uint64_t written_ = 0; // input samples consumed
  double next_output_ = 0;    // input-time of the next output sample
  float dc_x_ = 0, dc_y_ = 0;

  // 20 ms analysis frames at 16 kHz.
  static constexpr std::size_t frame_samples = 320;
  std::vector<float> frame_;
  double noise_floor_ = 0;
  bool floor_primed_ = false;
  float level_ = 0;

  bool open_ = false;
  unsigned onset_run_ = 0, silence_run_ = 0, speech_frames_ = 0;
  std::deque<float> pre_roll_;
  std::vector<float> segment_;
  std::deque<std::vector<std::int16_t>> ready_;
};
} // namespace lenslabs
