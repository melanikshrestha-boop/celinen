#include "lenslabs/cull.hpp"
#include <algorithm>
#include <cmath>
#include <numeric>
#include <stdexcept>
#include <utility>

// Measuring a frame, then judging it against the rest of the shoot.
//
// The old scoring took one Laplacian variance over a 256px thumbnail and
// compared it to fixed thresholds. Detail-rich frames saturate that number, so
// a whole shoot lands on the same score and nothing is culled. Three changes
// fix that: focus is measured as the ratio of gradient energy at a short and a
// long stride, which is the frame's resolving power and cancels out how much
// contrast a scene happens to carry; it is measured per tile and weighted
// toward the subject, so a sharp background behind a soft face is a miss rather
// than a keeper; and the final score is calibrated against this shoot's own
// range, the way a photographer culls — relative to the other frames.
namespace lenslabs {
namespace {
constexpr double pi = 3.14159265358979323846;

double clamp01(double v) { return std::clamp(v, 0.0, 1.0); }
double luma(double r, double g, double b) { return .299 * r + .587 * g + .114 * b; }

struct Tile {
  double contrast = 0;  // standard deviation of luma
  // Gradient energy along four directions at a short and a long stride. Kept
  // apart because a smear only destroys detail across its own direction: a
  // frame dragged sideways still has crisp horizontal edges, and averaging the
  // directions together would call it sharp.
  std::array<double, 4> near{}, far{};
  double mean = 0;
  double weight = 0;    // subject weight
  double acuity = 0;    // the weakest direction that still has detail to resolve
  double smear = 0;     // 0 isotropic .. 1 detail lost in one direction only
  int smear_axis = -1;  // which direction was lost, for frame-wide agreement
  bool textured = false;
};
// right, down, down-right, down-left
constexpr std::array<std::pair<int, int>, 4> directions{{{1, 0}, {0, 1}, {1, 1}, {-1, 1}}};
constexpr int near_stride = 1, far_stride = 8;

// Immerkaer's estimator: a kernel that is blind to smooth content, so what it
// leaves behind is the sensor's own grain.
double estimate_noise(const std::vector<float>& gray, unsigned w, unsigned h) {
  if (w < 3 || h < 3) return 0;
  double sum = 0;
  std::size_t count = 0;
  for (unsigned y = 1; y + 1 < h; ++y)
    for (unsigned x = 1; x + 1 < w; ++x) {
      const auto i = std::size_t(y) * w + x;
      const double value = gray[i - w - 1] - 2 * gray[i - w] + gray[i - w + 1] -
                           2 * gray[i - 1] + 4 * gray[i] - 2 * gray[i + 1] +
                           gray[i + w - 1] - 2 * gray[i + w] + gray[i + w + 1];
      sum += std::abs(value);
      ++count;
    }
  return count ? std::sqrt(pi / 2) * sum / (6.0 * double(count)) : 0;
}

// 1D DCT-II, used twice for the 32x32 perceptual hash.
void dct32(const double* in, double* out) {
  for (int k = 0; k < 32; ++k) {
    double sum = 0;
    for (int n = 0; n < 32; ++n) sum += in[n] * std::cos(pi * (2 * n + 1) * k / 64.0);
    out[k] = sum * (k == 0 ? std::sqrt(1.0 / 32.0) : std::sqrt(2.0 / 32.0));
  }
}

// Box-average the working luma to a fixed 32x32 so the hash does not depend on
// the source's size or on how it was resized.
std::array<double, 32 * 32> hash_grid(const std::vector<float>& gray, unsigned w, unsigned h) {
  std::array<double, 32 * 32> grid{};
  for (int row = 0; row < 32; ++row)
    for (int column = 0; column < 32; ++column) {
      const auto x0 = std::size_t(column) * w / 32;
      const auto x1 = std::max(x0 + 1, std::size_t(column + 1) * w / 32);
      const auto y0 = std::size_t(row) * h / 32;
      const auto y1 = std::max(y0 + 1, std::size_t(row + 1) * h / 32);
      double sum = 0;
      std::size_t count = 0;
      for (auto y = y0; y < std::min<std::size_t>(y1, h); ++y)
        for (auto x = x0; x < std::min<std::size_t>(x1, w); ++x) {
          sum += gray[y * w + x];
          ++count;
        }
      grid[std::size_t(row) * 32 + column] = count ? sum / double(count) : 0;
    }
  return grid;
}

std::uint64_t perceptual_hash(const std::vector<float>& gray, unsigned w, unsigned h) {
  const auto grid = hash_grid(gray, w, h);
  std::array<double, 32 * 32> rows{}, columns{};
  for (int row = 0; row < 32; ++row) dct32(grid.data() + row * 32, rows.data() + row * 32);
  for (int column = 0; column < 32; ++column) {
    double in[32], out[32];
    for (int row = 0; row < 32; ++row) in[row] = rows[std::size_t(row) * 32 + column];
    dct32(in, out);
    for (int row = 0; row < 32; ++row) columns[std::size_t(row) * 32 + column] = out[row];
  }
  // The low-frequency 8x8 block without its DC term: overall brightness must
  // not decide whether two frames are the same photograph.
  std::array<double, 64> low{};
  for (int row = 0; row < 8; ++row)
    for (int column = 0; column < 8; ++column)
      low[std::size_t(row * 8 + column)] = columns[std::size_t(row) * 32 + column];
  std::array<double, 63> rest{};
  std::copy(low.begin() + 1, low.end(), rest.begin());
  std::nth_element(rest.begin(), rest.begin() + 31, rest.end());
  const double median = rest[31];
  std::uint64_t hash = 0;
  for (int i = 0; i < 64; ++i)
    hash = (hash << 1) | std::uint64_t(i != 0 && low[std::size_t(i)] > median);
  return hash;
}

double percentile_of(std::vector<double> values, double fraction) {
  if (values.empty()) return 0;
  const auto at = std::size_t(std::clamp(fraction, 0.0, 1.0) * double(values.size() - 1) + .5);
  std::nth_element(values.begin(), values.begin() + std::ptrdiff_t(at), values.end());
  return values[at];
}
} // namespace

unsigned cull_hash_distance(std::uint64_t a, std::uint64_t b) noexcept {
  std::uint64_t value = a ^ b;
  unsigned count = 0;
  while (value) {
    value &= value - 1;
    ++count;
  }
  return count;
}

const char* cull_reason_name(CullReason reason) noexcept {
  switch (reason) {
    case CullReason::out_of_focus: return "out of focus";
    case CullReason::motion_blur: return "motion blur";
    case CullReason::missed_focus: return "focus missed the subject";
    case CullReason::eyes_closed: return "eyes closed";
    case CullReason::exposure: return "exposure";
    case CullReason::duplicate: return "near-identical frame scored better";
    case CullReason::best_of_burst: return "best of burst";
    case CullReason::strong_frame: return "sharp and well exposed";
    case CullReason::none: return "";
  }
  return "";
}

CullReading measure_cull(const Image& image, const std::vector<CullFace>& faces) {
  const auto w = image.width, h = image.height;
  const auto pixels = std::size_t(w) * h;
  if (w < 32 || h < 32 || w > 4096 || h > 4096 || image.rgba.size() != pixels * 4)
    throw std::invalid_argument("Cull needs a decoded working image between 32 and 4096 pixels.");

  CullReading out;
  std::vector<float> gray(pixels);
  std::array<std::uint32_t, 256> histogram{};
  double sum = 0;
  std::size_t high = 0, low = 0;
  for (std::size_t i = 0; i < pixels; ++i) {
    const auto* p = image.rgba.data() + i * 4;
    const double value = luma(p[0], p[1], p[2]);
    gray[i] = float(value);
    ++histogram[std::size_t(std::clamp(value, 0.0, 255.0))];
    sum += value;
    high += value > 250;
    low += value < 5;
  }
  out.brightness = sum / double(pixels);
  out.clipped_highlights = 100.0 * double(high) / double(pixels);
  out.clipped_shadows = 100.0 * double(low) / double(pixels);
  {
    const auto at = [&](double fraction) {
      const auto target = std::size_t(fraction * double(pixels));
      std::size_t seen = 0;
      for (std::size_t v = 0; v < histogram.size(); ++v) {
        seen += histogram[v];
        if (seen >= target) return double(v);
      }
      return 255.0;
    };
    out.black_point = at(.02);
    out.median = at(.5);
    out.white_point = at(.98);
  }
  out.noise = estimate_noise(gray, w, h);
  out.hash = perceptual_hash(gray, w, h);

  // Legacy Laplacian variance: saved sessions and older receipts still carry
  // this number, so keep producing it unchanged.
  {
    double mean = 0, deviation = 0;
    std::size_t count = 0;
    for (unsigned y = 1; y + 1 < h; ++y)
      for (unsigned x = 1; x + 1 < w; ++x) {
        const auto i = std::size_t(y) * w + x;
        const double value = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
        const double delta = value - mean;
        mean += delta / double(++count);
        deviation += delta * (value - mean);
      }
    out.sharpness = count ? std::max(0.0, deviation / double(count)) : 0;
  }

  // Color signature: a 4x4 grid of mean RGB. Two frames with the same layout
  // but a different scene or light separate here.
  for (int row = 0; row < 4; ++row)
    for (int column = 0; column < 4; ++column) {
      const auto x0 = std::size_t(column) * w / 4, x1 = std::size_t(column + 1) * w / 4;
      const auto y0 = std::size_t(row) * h / 4, y1 = std::size_t(row + 1) * h / 4;
      double channels[3] = {0, 0, 0};
      std::size_t count = 0;
      for (auto y = y0; y < y1; ++y)
        for (auto x = x0; x < x1; ++x) {
          const auto* p = image.rgba.data() + (y * w + x) * 4;
          for (int c = 0; c < 3; ++c) channels[c] += p[c];
          ++count;
        }
      for (int c = 0; c < 3; ++c)
        out.color[std::size_t((row * 4 + column) * 3 + c)] =
            std::uint8_t(count ? std::lround(channels[c] / double(count)) : 0);
    }

  // Tiles of at least about 28px, so the long stride still fits inside one.
  const unsigned columns = std::clamp(w / 28u, 6u, 32u), rows = std::clamp(h / 28u, 6u, 32u);
  std::vector<Tile> tiles(std::size_t(columns) * rows);
  const double noise_energy = 2 * out.noise * out.noise; // grain, one direction, any stride
  for (unsigned tr = 0; tr < rows; ++tr)
    for (unsigned tc = 0; tc < columns; ++tc) {
      auto& tile = tiles[std::size_t(tr) * columns + tc];
      const unsigned x0 = tc * w / columns, x1 = (tc + 1) * w / columns;
      const unsigned y0 = tr * h / rows, y1 = (tr + 1) * h / rows;
      double total = 0, squares = 0;
      std::size_t count = 0;
      std::array<double, 4> near_sum{}, far_sum{};
      std::array<std::size_t, 4> near_count{}, far_count{};
      for (unsigned y = y0; y < y1; ++y)
        for (unsigned x = x0; x < x1; ++x) {
          const auto i = std::size_t(y) * w + x;
          const double value = gray[i];
          total += value;
          squares += value * value;
          ++count;
          for (std::size_t d = 0; d < directions.size(); ++d) {
            // The long stride may reach past the tile into its neighbours. That
            // keeps the sample honest instead of shrinking it at tile edges.
            const auto sample = [&](int stride, double& energy, std::size_t& taken) {
              const int sx = int(x) + directions[d].first * stride;
              const int sy = int(y) + directions[d].second * stride;
              if (sx < 0 || sy < 0 || sx >= int(w) || sy >= int(h)) return;
              const double delta = gray[std::size_t(sy) * w + std::size_t(sx)] - value;
              energy += delta * delta;
              ++taken;
            };
            sample(near_stride, near_sum[d], near_count[d]);
            sample(far_stride, far_sum[d], far_count[d]);
          }
        }
      if (!count) continue;
      tile.mean = total / double(count);
      tile.contrast = std::sqrt(std::max(0.0, squares / double(count) - tile.mean * tile.mean));
      std::array<double, 4> resolving{};
      std::array<bool, 4> judged{};
      double weakest = 2;
      for (std::size_t d = 0; d < directions.size(); ++d) {
        if (!near_count[d] || !far_count[d]) continue;
        // Uncorrelated grain adds the same energy to a difference at any
        // stride, so it has to come out before the ratio means anything.
        tile.near[d] = std::max(0.0, near_sum[d] / double(near_count[d]) - noise_energy);
        tile.far[d] = std::max(0.0, far_sum[d] / double(far_count[d]) - noise_energy);
        if (tile.far[d] <= std::max(6.0, 3 * noise_energy)) continue;
        resolving[d] = std::sqrt(tile.near[d] / tile.far[d]);
        judged[d] = true;
        weakest = std::min(weakest, resolving[d]);
      }
      tile.textured = std::any_of(judged.begin(), judged.end(), [](bool ok) { return ok; }) &&
                      tile.contrast > 2.5;
      if (!tile.textured) continue;
      // A well-focused JPEG resolves an edge in roughly one and a half pixels
      // once it has been through a lens, a Bayer filter and a resize.
      tile.acuity = clamp01(weakest / .66);
      // Smear is measured between perpendicular pairs — horizontal against
      // vertical, and the two diagonals. Comparing every direction with every
      // other would report a smear for any kernel that is not perfectly round,
      // including the sampling grid itself.
      for (const auto& [a, b] : {std::pair<std::size_t, std::size_t>{0, 1}, {2, 3}}) {
        if (!judged[a] || !judged[b]) continue;
        const double strong = std::max(resolving[a], resolving[b]);
        if (strong <= 1e-9) continue;
        const double loss = 1 - std::min(resolving[a], resolving[b]) / strong;
        if (loss > tile.smear) {
          tile.smear = clamp01(loss);
          tile.smear_axis = int(resolving[a] < resolving[b] ? a : b);
        }
      }
    }

  // Subject weight: the middle of the frame, anything that stands out from the
  // frame's average tone, and any face the caller measured.
  double tone_mean = 0;
  for (const auto& tile : tiles) tone_mean += tile.mean;
  tone_mean /= double(tiles.size());
  double weight_total = 0, weighted_x = 0, weighted_y = 0;
  for (unsigned tr = 0; tr < rows; ++tr)
    for (unsigned tc = 0; tc < columns; ++tc) {
      auto& tile = tiles[std::size_t(tr) * columns + tc];
      const double cx = (tc + .5) / columns, cy = (tr + .5) / rows;
      const double radius = std::hypot(cx - .5, (cy - .45) * 1.1);
      double weight = std::exp(-radius * radius / (2 * .3 * .3));
      // Tone distinctiveness only. Weighting by contrast would quietly weight by
      // sharpness too, and the subject would be defined as whatever is in focus
      // — which is the one thing this measurement has to be able to disagree with.
      weight *= .45 + .55 * clamp01(std::abs(tile.mean - tone_mean) / 40);
      for (const auto& face : faces)
        if (cx >= face.x && cx <= face.x + face.width && cy >= face.y && cy <= face.y + face.height)
          weight = std::max(weight, 1.0) * 3;
      tile.weight = tile.textured ? weight : 0;
      weight_total += tile.weight;
      weighted_x += tile.weight * cx;
      weighted_y += tile.weight * cy;
    }
  out.subject_x = weight_total > 0 ? weighted_x / weight_total : .5;
  out.subject_y = weight_total > 0 ? weighted_y / weight_total : .5;

  std::vector<double> textured_acuity;
  double subject_luma = 0, subject_weight = 0, subject_clipped = 0;
  for (const auto& tile : tiles) {
    if (!tile.textured) continue;
    textured_acuity.push_back(tile.acuity);
    subject_luma += tile.mean * tile.weight;
    subject_weight += tile.weight;
    if (tile.mean > 248) subject_clipped += tile.weight;
  }
  out.texture = double(textured_acuity.size()) / double(tiles.size());
  out.acuity_best = percentile_of(textured_acuity, .9);
  out.subject_luma = subject_weight > 0 ? subject_luma / subject_weight : out.brightness;
  out.subject_clipped =
      subject_weight > 0 ? 100 * subject_clipped / subject_weight : out.clipped_highlights;

  // Subject acuity, in two steps. First decide what the subject is: the
  // heaviest third of the weight, which is the middle of the frame, whatever
  // stands out, and any face. Then, inside it, take the sharpest quarter,
  // because a portrait is judged on the eyes and not on the soft shoulder
  // beside them. Picking the sharpest tiles first would instead let a crisp
  // background behind a soft subject pass as a keeper.
  {
    std::vector<const Tile*> core;
    for (const auto& tile : tiles)
      if (tile.textured && tile.weight > 0) core.push_back(&tile);
    std::sort(core.begin(), core.end(),
              [](const Tile* a, const Tile* b) { return a->weight > b->weight; });
    double total = 0;
    for (const auto* tile : core) total += tile->weight;
    double taken = 0;
    std::vector<std::pair<double, double>> subject; // acuity, weight
    for (const auto* tile : core) {
      if (taken >= total * .35 && subject.size() >= 4) break;
      subject.emplace_back(tile->acuity, tile->weight);
      taken += tile->weight;
    }
    std::sort(subject.begin(), subject.end(),
              [](const auto& a, const auto& b) { return a.first > b.first; });
    double target = 0;
    for (const auto& entry : subject) target += entry.second;
    target *= .25;
    double acuity = 0, used = 0;
    for (const auto& [value, weight] : subject) {
      const double take = std::min(weight, target - used);
      if (take <= 0) break;
      acuity += value * take;
      used += take;
    }
    out.acuity_subject = used > 0 ? acuity / used : out.acuity_best;
  }

  // Smear: detail lost in one direction only, and the same direction across the
  // frame. Soft in every direction is plain defocus, not motion.
  {
    double weighted = 0, weight = 0;
    std::array<double, 4> axis_weight{};
    for (const auto& tile : tiles) {
      if (!tile.textured || tile.acuity > .8) continue;
      const double share = std::max(.05, tile.weight);
      weighted += tile.smear * share;
      weight += share;
      if (tile.smear_axis >= 0 && tile.smear > .25)
        axis_weight[std::size_t(tile.smear_axis)] += share;
    }
    // Compression and fine texture give every frame some directional bias, so
    // the smear only becomes "motion" to the degree the frame is actually soft.
    const double asymmetry = weight > 0 ? clamp01(weighted / weight * 1.6) : 0;
    out.motion = asymmetry * clamp01((.65 - out.acuity_subject) / .25);
    const double dominant = *std::max_element(axis_weight.begin(), axis_weight.end());
    const double agreed = std::accumulate(axis_weight.begin(), axis_weight.end(), 0.0);
    out.global_smear = out.motion > .3 && agreed > weight * .35 && dominant > agreed * .55;
  }

  for (const auto& face : faces) {
    out.has_face = true;
    if (face.eyes_open == 0) out.eyes_closed = true;
  }
  out.face_soft = out.has_face && out.acuity_subject < .5;

  // Absolute quality: focus dominates, exposure can only take a frame down, and
  // a frame with nothing in focus anywhere cannot be rescued by its histogram.
  double exposure_penalty = 0;
  if (out.subject_luma < 42) exposure_penalty += std::min(.35, (42 - out.subject_luma) / 120);
  if (out.subject_luma > 225) exposure_penalty += std::min(.35, (out.subject_luma - 225) / 90);
  if (out.subject_clipped > 12) exposure_penalty += std::min(.25, (out.subject_clipped - 12) / 160);
  if (out.clipped_shadows > 35) exposure_penalty += std::min(.15, (out.clipped_shadows - 35) / 300);
  const double noise_penalty = std::min(.12, std::max(0.0, out.noise - 6) / 90);
  // Defocus is already fully counted by acuity; only a directional smear adds
  // a penalty of its own.
  const double motion_penalty = out.global_smear ? out.motion * .18 : 0;
  double quality =
      out.acuity_subject * 100 * (1 - exposure_penalty - noise_penalty - motion_penalty);
  if (out.eyes_closed) quality *= .45;
  if (out.texture < .04) quality *= .7; // almost nothing resolvable in the frame
  out.quality = std::clamp(quality, 0.0, 100.0);
  return out;
}

namespace {
bool same_scene(const CullReading& a, const CullReading& b, unsigned tolerance) {
  if (cull_hash_distance(a.hash, b.hash) > tolerance) return false;
  // A layout can repeat across a venue; the color signature has to agree too.
  double difference = 0;
  for (std::size_t i = 0; i < a.color.size(); ++i)
    difference += std::abs(int(a.color[i]) - int(b.color[i]));
  return difference / double(a.color.size()) < 18;
}
} // namespace

std::vector<CullRow> cull_shoot(const std::vector<CullFrameInput>& frames,
                                const CullOptions& options) {
  if (!std::isfinite(options.keep_bias) || options.keep_bias < 0 || options.keep_bias > 1 ||
      !std::isfinite(options.burst_gap_ms) || options.burst_gap_ms < 0 ||
      options.hash_tolerance > 16)
    throw std::invalid_argument("Invalid cull options.");
  std::vector<CullRow> rows(frames.size());
  for (std::size_t i = 0; i < frames.size(); ++i) rows[i].id = frames[i].id;

  // Judgeable frames only: an unreadable file is not a bad photograph.
  std::vector<std::size_t> judgeable;
  for (std::size_t i = 0; i < frames.size(); ++i)
    if (!frames[i].unreadable) judgeable.push_back(i);
  if (judgeable.empty()) return rows;

  // Calibrate against this shoot. A studio session and a dim reception do not
  // share an absolute focus threshold, but inside one shoot the photographer's
  // own best frames say what "sharp" meant that day. Absolute floors stop an
  // entirely soft shoot from promoting its least-bad frame.
  std::vector<double> acuities, qualities;
  acuities.reserve(judgeable.size());
  qualities.reserve(judgeable.size());
  for (auto i : judgeable) {
    acuities.push_back(frames[i].reading.acuity_subject);
    qualities.push_back(frames[i].reading.quality);
  }
  const double top = percentile_of(acuities, .85), middle = percentile_of(acuities, .5);
  const double sharp_bar = std::max(.42, std::min(top * .78, middle + .04));
  const double soft_bar = std::max(.26, top * .55);
  const double quality_top = percentile_of(qualities, .9);

  for (auto i : judgeable) {
    // Score relative to this shoot's best, so the range is usable in the UI
    // instead of every frame sitting at 99.
    const double relative = quality_top > 1 ? frames[i].reading.quality / quality_top
                                            : frames[i].reading.quality / 100;
    rows[i].score = int(std::lround(std::clamp(relative * 96 + 2, 1.0, 99.0)));
  }

  // Group bursts and near-duplicates. A burst is a run of the same scene with no
  // gap longer than the burst gap between neighbours. Anything looser chains a
  // whole game into one group, because a court or a pitch looks the same from
  // the same position all night — and one group means one keeper.
  std::vector<std::size_t> order = judgeable;
  std::stable_sort(order.begin(), order.end(), [&](std::size_t a, std::size_t b) {
    const double ta = frames[a].capture_time_ms, tb = frames[b].capture_time_ms;
    if (ta >= 0 && tb >= 0 && ta != tb) return ta < tb;
    return a < b;
  });
  std::vector<int> group(frames.size(), -1);
  int groups = 0;
  for (std::size_t position = 0; position < order.size(); ++position) {
    const auto index = order[position];
    const auto& frame = frames[index];
    for (std::size_t back = 1; back <= 12 && back <= position; ++back) {
      const auto other = order[position - back];
      const auto& candidate = frames[other];
      // Two bodies shooting the same play are two sequences, not one burst.
      if (!frame.camera_key.empty() && !candidate.camera_key.empty() &&
          frame.camera_key != candidate.camera_key)
        continue;
      if (frame.capture_time_ms >= 0 && candidate.capture_time_ms >= 0) {
        // Frames are in capture order, so everything further back is older still.
        if (frame.capture_time_ms - candidate.capture_time_ms > options.burst_gap_ms) break;
      } else if (back > 3) {
        // Without a capture time only immediate neighbours can be called a burst.
        break;
      }
      if (!same_scene(frame.reading, candidate.reading, options.hash_tolerance)) continue;
      group[index] = group[other] >= 0 ? group[other] : (group[other] = groups++);
      break;
    }
  }
  for (std::size_t i = 0; i < frames.size(); ++i) rows[i].group = group[i];

  // Best of each group: a frame the photographer kept, otherwise the highest
  // score. A frame they rejected is never the keeper the others are judged
  // against — the rest of that burst deserves a look, not a matching reject.
  const auto standing = [&](std::size_t i) {
    const int verdict = frames[i].verdict;
    return verdict == 1 ? 2 : verdict == 2 ? 0 : 1; // kept, undecided, rejected
  };
  std::vector<int> best(std::size_t(groups), -1);
  for (auto i : judgeable) {
    const auto g = group[i];
    if (g < 0) continue;
    const auto current = best[std::size_t(g)];
    if (current < 0) {
      best[std::size_t(g)] = int(i);
      continue;
    }
    const auto incumbent = standing(std::size_t(current));
    const auto challenger = standing(i);
    if (challenger > incumbent ||
        (challenger == incumbent && rows[i].score > rows[std::size_t(current)].score))
      best[std::size_t(g)] = int(i);
  }

  for (auto i : judgeable) {
    auto& row = rows[i];
    const auto& reading = frames[i].reading;
    const auto g = group[i];
    row.best_of_group = g >= 0 && best[std::size_t(g)] == int(i);
    row.duplicate = g >= 0 && !row.best_of_group;
    if (frames[i].verdict != 0) continue; // suggestions are for undecided frames only

    if (reading.eyes_closed) {
      row.verdict = CullVerdict::reject;
      row.reason = CullReason::eyes_closed;
      continue;
    }
    if (reading.acuity_subject < soft_bar) {
      row.verdict = CullVerdict::reject;
      row.reason = reading.global_smear ? CullReason::motion_blur
                   : reading.acuity_best > reading.acuity_subject + .22
                       ? CullReason::missed_focus
                       : CullReason::out_of_focus;
      continue;
    }
    if (reading.subject_luma < 26 || reading.subject_luma > 242 || reading.subject_clipped > 45) {
      row.verdict = CullVerdict::reject;
      row.reason = CullReason::exposure;
      continue;
    }
    if (row.duplicate) {
      // Only a duplicate that is actually worse than its group's keeper. A
      // near-identical frame that scores higher is the one to look at, not to
      // throw away because a neighbour was decided first.
      if (rows[std::size_t(best[std::size_t(g)])].score >= row.score + 3) {
        row.verdict = CullVerdict::reject;
        row.reason = CullReason::duplicate;
        continue;
      }
      row.duplicate = false;
    }
    const double keep_at = 62 + (options.keep_bias - .5) * -40;
    if (reading.acuity_subject >= sharp_bar && row.score >= keep_at) {
      row.verdict = CullVerdict::keep;
      row.reason = row.best_of_group ? CullReason::best_of_burst : CullReason::strong_frame;
    }
  }
  return rows;
}
} // namespace lenslabs
