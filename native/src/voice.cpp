#include "lenslabs/voice.hpp"
#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace lenslabs {
namespace {
constexpr double pi = 3.14159265358979323846;
constexpr unsigned frame_ms = 20;
std::size_t samples_for(unsigned ms) { return std::size_t(voice_output_rate * ms / 1000); }
const std::vector<std::int16_t> no_segment;
} // namespace

VoiceFrontEnd::VoiceFrontEnd(double input_rate, VoiceOptions options) : options_(options) {
  if (!std::isfinite(input_rate) || input_rate < 8000 || input_rate > 192000)
    throw std::invalid_argument("Unsupported microphone sample rate.");
  ratio_ = input_rate / voice_output_rate;
  // Ten zero crossings of the low-pass on each side: >70 dB of alias rejection
  // with a Hann window, at ~60 taps for a 48 kHz microphone.
  half_width_ = int(std::ceil(10 * std::max(1.0, ratio_)));
  // Pass band ends at 92% of the lower Nyquist so the transition band, not
  // speech energy, absorbs the roll-off.
  cutoff_ = .5 * .92 * std::min(1.0, 1 / ratio_);
  std::size_t size = 256;
  while (size < std::size_t(half_width_) * 2 + 8) size <<= 1;
  ring_.assign(size, 0);
  ring_mask_ = size - 1;
  frame_.reserve(frame_samples);
}

void VoiceFrontEnd::push(const float* samples, std::size_t count) {
  // One-pole DC blocker (~60 Hz corner): laptop microphones carry an offset and
  // handling rumble that would otherwise read as constant "speech" energy.
  const float pole = float(1 - 2 * pi * 60 / (ratio_ * voice_output_rate));
  for (std::size_t i = 0; i < count; ++i) {
    const float x = std::isfinite(samples[i]) ? std::clamp(samples[i], -1.0f, 1.0f) : 0.0f;
    const float y = x - dc_x_ + pole * dc_y_;
    dc_x_ = x;
    dc_y_ = y;
    resample(y);
  }
}

void VoiceFrontEnd::resample(float sample) {
  ring_[written_ & ring_mask_] = sample;
  ++written_;
  // Emit every output instant whose full filter support has now arrived.
  while (next_output_ + half_width_ < double(written_)) {
    const auto center = std::int64_t(std::floor(next_output_));
    double sum = 0, weights = 0;
    for (std::int64_t n = center - half_width_ + 1; n <= center + half_width_; ++n) {
      if (n < 0) continue; // before the stream began: silence
      const double distance = next_output_ - double(n);
      const double window = .5 + .5 * std::cos(pi * distance / half_width_);
      const double phase = 2 * pi * cutoff_ * distance;
      const double weight = (std::abs(phase) < 1e-9 ? 1.0 : std::sin(phase) / phase) * window;
      sum += weight * ring_[std::uint64_t(n) & ring_mask_];
      weights += weight;
    }
    // Normalizing by the realized weights holds unity gain at every fractional phase.
    frame_.push_back(float(weights > 1e-9 ? sum / weights : 0));
    next_output_ += ratio_;
    if (frame_.size() == frame_samples) frame_ready();
  }
}

void VoiceFrontEnd::frame_ready() {
  double energy = 0;
  for (float v : frame_) energy += double(v) * v;
  const double rms = std::sqrt(energy / frame_samples);

  // Noise floor: falls quickly into any quiet gap, rises only slowly and never
  // while a segment is open, so sustained speech cannot raise its own threshold.
  // Capped at first sight so dictation that begins mid-word is still detected.
  if (!floor_primed_) {
    noise_floor_ = std::min(rms, .01);
    floor_primed_ = true;
  } else if (rms < noise_floor_) {
    noise_floor_ = .7 * noise_floor_ + .3 * rms;
  } else if (!open_) {
    noise_floor_ = .995 * noise_floor_ + .005 * rms;
  }
  noise_floor_ = std::max(noise_floor_, 1e-4);
  // Hysteresis: a higher bar to start than to continue keeps word endings attached.
  const double threshold = open_ ? std::max(.004, noise_floor_ * 2.2) : std::max(.006, noise_floor_ * 3.5);
  const bool speech = rms > threshold;

  const float target = float(std::min(1.0, rms * 4));
  level_ += (target - level_) * (target > level_ ? .6f : .15f);

  if (!open_) {
    pre_roll_.insert(pre_roll_.end(), frame_.begin(), frame_.end());
    const auto keep = samples_for(options_.pre_roll_ms + options_.onset_ms);
    while (pre_roll_.size() > keep) pre_roll_.pop_front();
    onset_run_ = speech ? onset_run_ + 1 : 0;
    if (onset_run_ * frame_ms >= options_.onset_ms) {
      segment_.assign(pre_roll_.begin(), pre_roll_.end());
      pre_roll_.clear();
      open_ = true;
      speech_frames_ = onset_run_;
      silence_run_ = 0;
    }
  } else {
    segment_.insert(segment_.end(), frame_.begin(), frame_.end());
    if (speech) { ++speech_frames_; silence_run_ = 0; } else ++silence_run_;
    const auto length_ms = segment_.size() * 1000 / std::size_t(voice_output_rate);
    if (silence_run_ * frame_ms >= options_.end_silence_ms ||
        (length_ms >= options_.soft_limit_ms && silence_run_ * frame_ms >= 160) ||
        length_ms >= options_.hard_limit_ms)
      close_segment();
  }
  frame_.clear();
}

void VoiceFrontEnd::close_segment() {
  const unsigned silence_ms = silence_run_ * frame_ms;
  if (silence_ms > options_.tail_ms)
    segment_.resize(segment_.size() - std::min(segment_.size(), samples_for(silence_ms - options_.tail_ms)));
  if (speech_frames_ * frame_ms >= options_.min_speech_ms && !segment_.empty()) {
    float peak = 0;
    for (float v : segment_) peak = std::max(peak, std::abs(v));
    // Lift quiet speakers toward -3 dBFS for the recognizer; never more than
    // +20 dB, so a near-silent room is not amplified into hiss.
    const float gain = peak > 1e-4f ? std::clamp(.707f / peak, 1.0f, 10.0f) : 1.0f;
    std::vector<std::int16_t> pcm(segment_.size());
    for (std::size_t i = 0; i < segment_.size(); ++i)
      pcm[i] = std::int16_t(std::lround(std::clamp(segment_[i] * gain, -1.0f, 1.0f) * 32767));
    ready_.push_back(std::move(pcm));
  }
  segment_.clear();
  open_ = false;
  onset_run_ = silence_run_ = speech_frames_ = 0;
}

void VoiceFrontEnd::flush() {
  if (open_) close_segment();
  frame_.clear();
  pre_roll_.clear();
  onset_run_ = 0;
}

const std::vector<std::int16_t>& VoiceFrontEnd::front() const {
  return ready_.empty() ? no_segment : ready_.front();
}
void VoiceFrontEnd::pop() {
  if (!ready_.empty()) ready_.pop_front();
}
} // namespace lenslabs
