#include "lenslabs/cull_validity.hpp"
#include "cull_dsp.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <numeric>
#include <stdexcept>
#include <vector>

// The validity gate. Measurement first (every family of evidence computed on
// one working copy), then a decision that reads only the evidence, so the rules
// can be audited — and later replaced by a learned head — without touching the
// measurement.
namespace lenslabs {
namespace {
using dsp::clamp01;
using dsp::Plane;

constexpr unsigned working_edge = 640;

struct Rgb {
  unsigned width = 0, height = 0;
  std::vector<std::uint8_t> r, g, b;
};

// Box-resample to at most `working_edge` on the long side, so every threshold
// below is in the same units whatever size the caller decoded at.
Rgb working_copy(const Image& image) {
  const unsigned longest = std::max(image.width, image.height);
  const double scale = longest > working_edge ? double(working_edge) / longest : 1.0;
  Rgb out;
  out.width = std::max(1u, unsigned(std::lround(image.width * scale)));
  out.height = std::max(1u, unsigned(std::lround(image.height * scale)));
  const auto n = std::size_t(out.width) * out.height;
  out.r.resize(n);
  out.g.resize(n);
  out.b.resize(n);
  for (unsigned y = 0; y < out.height; ++y) {
    const unsigned y0 = unsigned(std::size_t(y) * image.height / out.height);
    const unsigned y1 = std::max(y0 + 1, unsigned(std::size_t(y + 1) * image.height / out.height));
    for (unsigned x = 0; x < out.width; ++x) {
      const unsigned x0 = unsigned(std::size_t(x) * image.width / out.width);
      const unsigned x1 = std::max(x0 + 1, unsigned(std::size_t(x + 1) * image.width / out.width));
      std::uint32_t sums[3] = {0, 0, 0}, count = 0;
      for (unsigned sy = y0; sy < std::min(y1, image.height); ++sy)
        for (unsigned sx = x0; sx < std::min(x1, image.width); ++sx) {
          const auto* p = image.rgba.data() + (std::size_t(sy) * image.width + sx) * 4;
          sums[0] += p[0];
          sums[1] += p[1];
          sums[2] += p[2];
          ++count;
        }
      const auto i = std::size_t(y) * out.width + x;
      out.r[i] = std::uint8_t((sums[0] + count / 2) / std::max<std::uint32_t>(count, 1));
      out.g[i] = std::uint8_t((sums[1] + count / 2) / std::max<std::uint32_t>(count, 1));
      out.b[i] = std::uint8_t((sums[2] + count / 2) / std::max<std::uint32_t>(count, 1));
    }
  }
  return out;
}

// Radial power spectrum of the central square: slope, fit error and the
// strongest periodic spike.
void measure_spectrum(const Plane& plane, CullValidityEvidence& e) {
  const unsigned side = std::min(plane.width, plane.height);
  std::size_t n = 256;
  while (n > 32 && n > side) n >>= 1;
  if (side < 32) return;
  const unsigned x0 = (plane.width - side) / 2, y0 = (plane.height - side) / 2;
  const auto square = dsp::resample_box(plane, x0, y0, x0 + side, y0 + side, unsigned(n), unsigned(n));
  double mean = 0;
  for (auto v : square.values) mean += v;
  mean /= double(square.values.size());
  std::vector<std::complex<double>> field(n * n);
  // Hann window: without it the frame's own border is a step edge that
  // imposes a 1/f^2 spectrum on everything, noise included.
  std::vector<double> window(n);
  for (std::size_t i = 0; i < n; ++i) window[i] = .5 - .5 * std::cos(2 * dsp::pi * double(i) / double(n - 1));
  for (std::size_t y = 0; y < n; ++y)
    for (std::size_t x = 0; x < n; ++x)
      field[y * n + x] = (square.values[y * n + x] - mean) * window[x] * window[y];
  dsp::fft2(field, n, false);

  const std::size_t half = n / 2;
  std::vector<double> ring_sum(half, 0), ring_max(half, 0);
  std::vector<std::size_t> ring_count(half, 0);
  for (std::size_t v = 0; v < n; ++v)
    for (std::size_t u = 0; u < n; ++u) {
      const double ku = u < half ? double(u) : double(u) - double(n);
      const double kv = v < half ? double(v) : double(v) - double(n);
      const auto radius = std::size_t(std::lround(std::hypot(ku, kv)));
      if (radius == 0 || radius >= half) continue;
      const double power = std::norm(field[v * n + u]);
      ring_sum[radius] += power;
      ring_max[radius] = std::max(ring_max[radius], power);
      ++ring_count[radius];
    }
  double total = 0;
  for (auto s : ring_sum) total += s;
  if (total <= 1e-9) return;

  // Log-spaced groups between a low and a mid-high radius: the lowest rings are
  // dominated by the scene layout, the highest by the resize and compression.
  const double r_low = 2, r_high = double(n) * .36;
  constexpr int groups = 12;
  std::vector<std::pair<double, double>> points; // log r, log power
  for (int k = 0; k < groups; ++k) {
    const double a = r_low * std::pow(r_high / r_low, double(k) / groups);
    const double b = r_low * std::pow(r_high / r_low, double(k + 1) / groups);
    double sum = 0, weight = 0, radius_sum = 0;
    for (std::size_t r = std::size_t(std::ceil(a)); r < std::size_t(std::ceil(b)) && r < half; ++r) {
      if (!ring_count[r]) continue;
      sum += ring_sum[r] / double(ring_count[r]);
      radius_sum += double(r);
      weight += 1;
    }
    if (weight <= 0 || sum <= 0) continue;
    points.emplace_back(std::log10(radius_sum / weight), std::log10(sum / weight + 1e-12));
  }
  if (points.size() >= 4) {
    double sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const auto& [x, y] : points) {
      sx += x;
      sy += y;
      sxx += x * x;
      sxy += x * y;
    }
    const double m = double(points.size());
    const double denominator = m * sxx - sx * sx;
    if (std::abs(denominator) > 1e-12) {
      const double slope = (m * sxy - sx * sy) / denominator;
      const double intercept = (sy - slope * sx) / m;
      double error = 0;
      for (const auto& [x, y] : points) error += std::pow(y - (intercept + slope * x), 2);
      e.spectral_slope = -slope;
      e.spectral_fit_error = std::sqrt(error / m);
    }
  }
  // A periodic structure (stripes, screentone, a test chart) puts its energy in
  // a few coefficients of a ring; a scene spreads it round the ring.
  double peak = 0;
  for (std::size_t r = 4; r + 2 < half; ++r) {
    if (ring_count[r] < 24 || ring_sum[r] <= 0) continue;
    const double ring_mean = ring_sum[r] / double(ring_count[r]);
    // Rings that carry almost no energy cannot spike meaningfully.
    if (ring_sum[r] < total * 1e-4) continue;
    peak = std::max(peak, std::log10(ring_max[r] / ring_mean));
  }
  e.spectral_peak = peak;
}

void measure(const Rgb& rgb, const Plane& plane, CullValidityEvidence& e) {
  const unsigned w = rgb.width, h = rgb.height;
  const std::size_t pixels = std::size_t(w) * h;

  // Tone.
  std::array<std::uint32_t, 256> histogram{};
  double sum = 0, squares = 0;
  std::size_t clipped_low = 0, clipped_high = 0, gray = 0;
  double saturation = 0;
  for (std::size_t i = 0; i < pixels; ++i) {
    const double v = plane.values[i];
    ++histogram[std::size_t(std::clamp(std::lround(v), 0l, 255l))];
    sum += v;
    squares += v * v;
    clipped_low += v <= 4;
    clipped_high += v >= 251;
    const int hi = std::max({rgb.r[i], rgb.g[i], rgb.b[i]});
    const int lo = std::min({rgb.r[i], rgb.g[i], rgb.b[i]});
    gray += hi - lo <= 6;
    saturation += hi > 0 ? double(hi - lo) / hi : 0;
  }
  e.luma_mean = sum / double(pixels);
  e.luma_std = std::sqrt(std::max(0.0, squares / double(pixels) - e.luma_mean * e.luma_mean));
  e.clipped_low = double(clipped_low) / double(pixels);
  e.clipped_high = double(clipped_high) / double(pixels);
  e.grayscale = double(gray) / double(pixels);
  e.saturation = saturation / double(pixels);
  {
    const auto percentile = [&](double fraction) {
      const auto target = std::size_t(fraction * double(pixels));
      std::size_t seen = 0;
      for (std::size_t v = 0; v < 256; ++v) {
        seen += histogram[v];
        if (seen > target) return double(v);
      }
      return 255.0;
    };
    e.luma_low = percentile(.02);
    e.luma_high = percentile(.98);
  }

  // Coherence: lag-1 autocorrelation.
  {
    const double variance = e.luma_std * e.luma_std;
    if (variance > 1e-6) {
      double cx = 0, cy = 0;
      std::size_t nx = 0, ny = 0;
      for (unsigned y = 0; y < h; ++y)
        for (unsigned x = 0; x < w; ++x) {
          const double a = plane.at(x, y) - e.luma_mean;
          if (x + 1 < w) {
            cx += a * (plane.at(x + 1, y) - e.luma_mean);
            ++nx;
          }
          if (y + 1 < h) {
            cy += a * (plane.at(x, y + 1) - e.luma_mean);
            ++ny;
          }
        }
      e.autocorrelation = ((nx ? cx / double(nx) : 0) + (ny ? cy / double(ny) : 0)) / (2 * variance);
    } else {
      e.autocorrelation = 1;
    }
  }

  // Blocks: exact fills and the grain floor.
  {
    constexpr unsigned block = 8;
    std::size_t blocks = 0, smooth = 0, exact = 0, exact_smooth = 0, exact_extreme = 0;
    std::vector<double> grains;
    for (unsigned by = 0; by + block <= h; by += block)
      for (unsigned bx = 0; bx + block <= w; bx += block) {
        ++blocks;
        int range = 0;
        double total = 0, total_sq = 0;
        std::array<int, 3> lo{255, 255, 255}, hi{0, 0, 0};
        for (unsigned y = by; y < by + block; ++y)
          for (unsigned x = bx; x < bx + block; ++x) {
            const auto i = std::size_t(y) * w + x;
            lo[0] = std::min<int>(lo[0], rgb.r[i]);
            hi[0] = std::max<int>(hi[0], rgb.r[i]);
            lo[1] = std::min<int>(lo[1], rgb.g[i]);
            hi[1] = std::max<int>(hi[1], rgb.g[i]);
            lo[2] = std::min<int>(lo[2], rgb.b[i]);
            hi[2] = std::max<int>(hi[2], rgb.b[i]);
            total += plane.values[i];
            total_sq += double(plane.values[i]) * plane.values[i];
          }
        for (int c = 0; c < 3; ++c) range = std::max(range, hi[std::size_t(c)] - lo[std::size_t(c)]);
        const double mean = total / double(block * block);
        const double deviation = std::sqrt(std::max(0.0, total_sq / double(block * block) - mean * mean));
        const bool midtone = mean >= 12 && mean <= 243;
        const bool is_exact = range <= 1;
        if (!midtone) {
          exact_extreme += is_exact;
          continue;
        }
        exact += is_exact;
        if (deviation < 3.5) {
          ++smooth;
          exact_smooth += is_exact;
          grains.push_back(dsp::immerkaer_noise(plane, bx, by, bx + block, by + block));
        }
      }
    if (blocks) {
      e.exact_flat = double(exact) / double(blocks);
      e.exact_flat_extreme = double(exact_extreme) / double(blocks);
      e.smooth_share = double(smooth) / double(blocks);
    }
    if (smooth) e.exact_flat_smooth = double(exact_smooth) / double(smooth);
    if (!grains.empty()) {
      std::nth_element(grains.begin(), grains.begin() + std::ptrdiff_t(grains.size() / 2), grains.end());
      e.grain = grains[grains.size() / 2];
    }
  }

  // Palette: how much of the mid-tone image is made of a dozen colours.
  {
    std::vector<std::uint32_t> counts(1u << 18, 0), all(1u << 18, 0);
    std::size_t midtone = 0;
    for (std::size_t i = 0; i < pixels; ++i) {
      const auto key = (std::size_t(rgb.r[i] >> 2) << 12) | (std::size_t(rgb.g[i] >> 2) << 6) | (rgb.b[i] >> 2);
      ++all[key];
      const double v = plane.values[i];
      if (v < 10 || v > 245) continue;
      ++midtone;
      ++counts[key];
    }
    {
      std::vector<std::uint32_t> used;
      for (auto c : all)
        if (c) used.push_back(c);
      std::sort(used.begin(), used.end(), std::greater<>());
      std::size_t covered = 0, colours = 0;
      for (auto c : used) {
        covered += c;
        ++colours;
        if (covered * 10 >= pixels * 9) break;
      }
      e.palette_count = double(colours);
    }
    if (midtone >= pixels / 20) {
      std::array<std::uint32_t, 12> top{};
      for (auto c : counts) {
        if (c <= top.back()) continue;
        top.back() = c;
        std::sort(top.begin(), top.end(), std::greater<>());
      }
      e.palette_top = double(std::accumulate(top.begin(), top.end(), 0.0)) / double(midtone);
    }
  }

  // Edges: density, axis alignment, and flat flanks.
  if (w >= 16 && h >= 16) {
    constexpr double strong = 120; // Sobel magnitude of a ~30-code step
    std::size_t edges = 0, maxima = 0, flanked = 0;
    double energy = 0, axis_energy = 0;
    const auto sobel = [&](unsigned x, unsigned y, double& gx, double& gy) {
      gx = (plane.at(x + 1, y - 1) + 2 * plane.at(x + 1, y) + plane.at(x + 1, y + 1)) -
           (plane.at(x - 1, y - 1) + 2 * plane.at(x - 1, y) + plane.at(x - 1, y + 1));
      gy = (plane.at(x - 1, y + 1) + 2 * plane.at(x, y + 1) + plane.at(x + 1, y + 1)) -
           (plane.at(x - 1, y - 1) + 2 * plane.at(x, y - 1) + plane.at(x + 1, y - 1));
    };
    const auto local_range = [&](int cx, int cy) {
      float lo = 255, hi = 0;
      for (int dy = -1; dy <= 1; ++dy)
        for (int dx = -1; dx <= 1; ++dx) {
          const int x = std::clamp(cx + dx, 0, int(w) - 1), y = std::clamp(cy + dy, 0, int(h) - 1);
          const float v = plane.at(unsigned(x), unsigned(y));
          lo = std::min(lo, v);
          hi = std::max(hi, v);
        }
      return double(hi - lo);
    };
    for (unsigned y = 2; y + 2 < h; ++y)
      for (unsigned x = 2; x + 2 < w; ++x) {
        double gx, gy;
        sobel(x, y, gx, gy);
        const double magnitude = std::hypot(gx, gy);
        if (magnitude < strong) continue;
        ++edges;
        energy += magnitude;
        const double angle = std::atan2(std::abs(gy), std::abs(gx)); // 0..pi/2
        if (angle < 6 * dsp::pi / 180 || angle > 84 * dsp::pi / 180) axis_energy += magnitude;
        // Only the ridge of each edge, so a thick blurred edge counts once.
        const double ux = gx / magnitude, uy = gy / magnitude;
        const int ax = int(std::lround(ux)), ay = int(std::lround(uy));
        double ga, gb, tmp;
        sobel(unsigned(int(x) + ax), unsigned(int(y) + ay), ga, tmp);
        const double ahead = std::hypot(ga, tmp);
        sobel(unsigned(int(x) - ax), unsigned(int(y) - ay), gb, tmp);
        const double behind = std::hypot(gb, tmp);
        if (magnitude < ahead || magnitude < behind) continue;
        ++maxima;
        // Flat on both sides, somewhere two to five pixels out: far enough to
        // clear an ink line's own width, near enough to stay in its fill.
        const auto flat_side = [&](double sign) {
          for (int distance = 2; distance <= 5; ++distance)
            if (local_range(int(x) + int(std::lround(sign * ux * distance)),
                            int(y) + int(std::lround(sign * uy * distance))) <= 2.0)
              return true;
          return false;
        };
        if (flat_side(1) && flat_side(-1)) ++flanked;
      }
    e.edge_density = double(edges) / double(pixels);
    e.edge_axis = energy > 0 ? axis_energy / energy : 0;
    e.edge_flank_flat = maxima ? double(flanked) / double(maxima) : 0;
  }

  // Structure: frozen bottom rows, and full-width bands.
  {
    const auto row_difference = [&](unsigned y) {
      double total = 0;
      for (unsigned x = 0; x < w; ++x) total += std::abs(plane.at(x, y) - plane.at(x, y - 1));
      return total / double(w);
    };
    unsigned frozen = 0;
    double frozen_luma = 0;
    for (unsigned y = h - 1; y >= 1; --y) {
      if (row_difference(y) > .02) break;
      ++frozen;
      double row = 0;
      for (unsigned x = 0; x < w; ++x) row += plane.at(x, y);
      frozen_luma += row / double(w);
    }
    // A clipped band is a black floor or a blown sky, not a truncated file.
    if (frozen) {
      frozen_luma /= double(frozen);
      if (frozen_luma > 6 && frozen_luma < 249 && frozen + 1 < h) e.frozen_rows = double(frozen + 1) / double(h);
    }

    // Breaks: a row (or column) boundary whose difference towards its
    // neighbour is far above the frame's typical one. A scene changes smoothly
    // from one scanline to the next; shifted or recoloured bands of a damaged
    // file change all at once, across the full width.
    const auto breaks = [&](bool rows) {
      const unsigned lines = rows ? h : w, span = rows ? w : h;
      if (lines < 8) return 0.0;
      std::vector<double> difference(lines, 0);
      for (unsigned k = 1; k < lines; ++k) {
        double total = 0;
        for (unsigned t = 0; t < span; ++t)
          total += std::abs(rows ? plane.at(t, k) - plane.at(t, k - 1) : plane.at(k, t) - plane.at(k - 1, t));
        difference[k] = total / double(span);
      }
      std::vector<double> sorted(difference.begin() + 1, difference.end());
      std::nth_element(sorted.begin(), sorted.begin() + std::ptrdiff_t(sorted.size() / 2), sorted.end());
      const double typical = sorted[sorted.size() / 2];
      std::vector<unsigned> found;
      for (unsigned k = 2; k + 1 < lines; ++k) {
        const double around = std::max(difference[k - 1], difference[k + 1]);
        if (difference[k] > 1.8 * around + 2 && difference[k] > 1.5 * typical + 2) found.push_back(k);
      }
      // Breaks on a fixed short period are JPEG block edges from a partial-scale
      // decode of a heavily compressed file, not damage: leave them out.
      unsigned count = unsigned(found.size());
      if (found.size() >= 4)
        for (unsigned period = 2; period <= 8; ++period) {
          std::array<unsigned, 8> residues{};
          for (auto k : found) ++residues[k % period];
          const unsigned aligned = *std::max_element(residues.begin(), residues.begin() + period);
          // Block edges land on nearly every period line; damage is sparse.
          if (aligned * 10 >= found.size() * 7 && aligned * period * 2 >= lines) {
            count = unsigned(found.size()) - aligned;
            break;
          }
        }
      return 100.0 * double(count) / double(lines);
    };
    e.band_rows = std::max(breaks(true), breaks(false));
  }

  measure_spectrum(plane, e);
}

struct Finding {
  CullValidityKind kind = CullValidityKind::photo;
  double confidence = 0;
};

Finding strongest(std::initializer_list<Finding> findings) {
  Finding best;
  for (const auto& f : findings)
    if (f.confidence > best.confidence) best = f;
  return best;
}

// The decision reads only the evidence. Each detector returns the confidence
// that the frame is its kind of non-photograph; the strongest wins.
Finding decide(const CullValidityEvidence& e) {
  const double range = e.luma_high - e.luma_low;
  const double any_exact = e.exact_flat + e.exact_flat_extreme;

  // No content at all.
  Finding blank;
  if (e.luma_std < 2.5 && range <= 8) {
    const bool dark = e.luma_mean < 24, light = e.luma_mean > 231;
    // Pure black is a black frame; black with grain or a leak is a lens cap.
    blank.kind = dark ? (e.luma_std > .6 ? CullValidityKind::misfire : CullValidityKind::black)
                 : light ? CullValidityKind::white
                         : CullValidityKind::flat;
    blank.confidence = .98;
  }

  // Blown or crushed with nothing recoverable in what is left.
  Finding exposure;
  if (e.clipped_high >= .8) {
    exposure.kind = CullValidityKind::extreme_exposure;
    exposure.confidence =
        .6 + .38 * clamp01((e.clipped_high - .8) / .15) * (e.edge_density < .01 ? 1 : .6);
  }
  if (e.clipped_low >= .85 && e.luma_high < 40) {
    exposure.kind = CullValidityKind::black;
    exposure.confidence = std::max(exposure.confidence, .6 + .38 * clamp01((e.clipped_low - .85) / .12));
  }

  // Lens cap, pocket, the inside of a bag: dark and featureless, often with a
  // faint leak of light.
  Finding misfire;
  if (e.luma_mean < 40 && e.luma_high < 70 && e.edge_density < .002) {
    misfire.kind = CullValidityKind::misfire;
    misfire.confidence =
        .55 + .4 * clamp01((70 - e.luma_high) / 40) * clamp01((.002 - e.edge_density) / .002);
  } else if (e.edge_density < .0003 && e.luma_std < 14 && e.spectral_slope > 3.2) {
    // Any brightness: nothing but a smooth wash of light. Never more than a maybe
    // — a defocused frame of a plain wall looks the same.
    misfire.kind = CullValidityKind::misfire;
    misfire.confidence = .5 + .3 * clamp01((e.spectral_slope - 3.2) / 1.0);
  }

  // Static: no coherence, a flat spectrum, and none of the exact fills or
  // few-colour palette that text and line art also show at this scale.
  Finding noise;
  if (e.luma_std > 6 && any_exact < .03) {
    const double incoherent = clamp01((.6 - e.autocorrelation) / .4);
    const double white = clamp01((1.2 - e.spectral_slope) / .8);
    const double evidence = incoherent * white;
    noise.kind = CullValidityKind::noise;
    noise.confidence = evidence > 0 ? .45 + .54 * std::sqrt(evidence) : 0;
  }

  // Truncated or damaged file.
  Finding corrupt;
  {
    double logit = -4.5;
    if (e.truncated) logit += 3.4;
    else if (e.decoder_warnings > 0) logit += .8;
    // A drawing or a screen capture can end in a band of one flat colour, and
    // that is its design, not a decode that stopped early.
    const bool drawn = e.palette_count < 24 && any_exact > .2;
    logit += (drawn ? 1.5 : 7.5) * clamp01((e.frozen_rows - .015) / .06);
    // Scanline breaks that are not a periodic pattern and not a drawing.
    if (e.spectral_peak < 2.0 && e.palette_count > 24) logit += 6.0 * clamp01((e.band_rows - 1.2) / 3);
    corrupt.kind = CullValidityKind::corrupted;
    corrupt.confidence = dsp::sigmoid(logit);
  }

  // Test patterns: a handful of exact colours laid out on a grid or repeating.
  Finding pattern;
  {
    double logit = -6;
    logit += 2.5 * clamp01((12 - e.palette_count) / 8);
    logit += 1.5 * clamp01((any_exact - .3) / .4);
    logit += 2.0 * clamp01((e.edge_axis - .8) / .15);
    logit += 1.5 * clamp01((e.spectral_peak - 1.9) / .6);
    logit += 1.0 * clamp01((e.band_rows - 3) / 8);
    // A smooth synthetic ramp: no grain, no edges, nothing but smooth blocks.
    if (e.edge_density < .0005 && e.smooth_share > .8 && e.grain < .05) logit += 4.5;
    pattern.kind = CullValidityKind::test_pattern;
    pattern.confidence = dsp::sigmoid(logit);
  }

  // Drawn or rendered, not photographed.
  Finding rendered;
  {
    // Fills: exact colour across whole blocks. Photographs almost never hold one
    // exact mid-tone colour over a block at this scale; paper white and ink
    // black count less, because blown skies and black backdrops do the same.
    const double fills = clamp01((e.exact_flat - .03) / .25) + .5 * clamp01((e.exact_flat_extreme - .1) / .4);
    // Ink: flat colour on both sides of strong edges.
    const double ink = e.edge_density > .002 ? clamp01((e.edge_flank_flat - .1) / .35) : 0;
    // A few colours make most of the picture. On its own this describes a studio
    // backdrop just as well, so it only counts next to fills or ink.
    const double palette = clamp01((e.palette_top - .3) / .5) * clamp01(std::max(fills, ink) * 2);
    double logit = -4.6 + 2.6 * std::min(fills, 1.2) + 2.6 * ink + 1.2 * palette;
    // Sensor grain where the frame is smooth argues for a camera.
    if (e.smooth_share > .05) {
      if (e.grain < .12) logit += 1.2;
      else if (e.grain < .3) logit += .4;
      else if (e.grain > .7) logit -= 1.4;
    } else if (e.exact_flat_extreme > .15) {
      logit += .6; // nothing smooth except paper: a page, not a scene
    }
    // Two measurements that separate cleanly on real files: 121 photographs
    // from three cameras never needed fewer than about two thousand colours to
    // make nine tenths of the frame, and never held more than a fifth of their
    // blocks as exact paper white or ink black; drawings, logos and interfaces
    // sit at a few dozen colours and half their blocks. Grain has to be absent
    // too, so a low-key or high-key photograph with a big clipped area cannot
    // be caught by either on its own.
    if (e.grain < .3) {
      logit += 1.6 * clamp01((600 - e.palette_count) / 500);
      logit += 1.8 * clamp01((e.exact_flat_extreme - .22) / .35);
    }
    // Bilevel pages: paper and ink, with a sliver of gray between.
    if (e.grayscale > .95 && e.clipped_high + e.clipped_low > .35 && e.palette_count < 24) logit += 1.4;
    // High-frequency text or screentone over a page.
    if (e.spectral_slope < 1.2 && any_exact > .05) logit += .9 * clamp01((1.2 - e.spectral_slope) / .8);
    if (e.spectral_peak > 1.9 && any_exact > .05) logit += .6;
    rendered.confidence = dsp::sigmoid(logit);
    // Which rendering. UI and documents are built on a grid; drawings are not.
    const bool paper = e.luma_mean > 150 && e.grayscale > .85 && e.saturation < .1;
    if (e.edge_axis >= .5 && paper) rendered.kind = CullValidityKind::document;
    else if (e.edge_axis >= .5) rendered.kind = CullValidityKind::screenshot;
    else rendered.kind = CullValidityKind::illustration;
  }

  // A test pattern is also a rendering; name it as the more specific kind when
  // its layout says so: a few colours on an axis grid, or strict repetition.
  const bool patterned = e.palette_count <= 10 &&
                         (e.edge_axis >= .9 || (e.band_rows >= 8 && e.spectral_peak >= 2.2));
  if (patterned && std::max(pattern.confidence, rendered.confidence) > .5) {
    pattern.confidence = std::max(pattern.confidence, rendered.confidence);
    rendered.confidence = 0;
  }

  return strongest({blank, exposure, misfire, noise, corrupt, pattern, rendered});
}

const char* reason_for(CullValidityKind kind, CullValidityState state) {
  const bool maybe = state == CullValidityState::suspect;
  switch (kind) {
    case CullValidityKind::photo: return "";
    case CullValidityKind::noise: return maybe ? "Looks like noise" : "No photographic structure";
    case CullValidityKind::flat: return maybe ? "Almost blank" : "Blank frame";
    case CullValidityKind::black: return maybe ? "Almost black" : "Black frame";
    case CullValidityKind::white: return maybe ? "Almost white" : "White frame";
    case CullValidityKind::test_pattern: return maybe ? "May be a test pattern" : "Test pattern";
    case CullValidityKind::corrupted: return maybe ? "File may be damaged" : "Corrupted file";
    case CullValidityKind::misfire: return maybe ? "May be an accidental shot" : "Accidental shot";
    case CullValidityKind::extreme_exposure: return maybe ? "Almost no detail left" : "No recoverable detail";
    case CullValidityKind::illustration:
      return maybe ? "May be an illustration" : "Illustration, not a photograph";
    case CullValidityKind::screenshot: return maybe ? "May be a screenshot" : "Screenshot";
    case CullValidityKind::document: return maybe ? "May be a document" : "Document, not a photograph";
  }
  return "";
}
} // namespace

const char* cull_validity_kind_name(CullValidityKind kind) noexcept {
  switch (kind) {
    case CullValidityKind::photo: return "photo";
    case CullValidityKind::noise: return "noise";
    case CullValidityKind::flat: return "flat";
    case CullValidityKind::black: return "black";
    case CullValidityKind::white: return "white";
    case CullValidityKind::test_pattern: return "test-pattern";
    case CullValidityKind::corrupted: return "corrupted";
    case CullValidityKind::misfire: return "misfire";
    case CullValidityKind::extreme_exposure: return "extreme-exposure";
    case CullValidityKind::illustration: return "illustration";
    case CullValidityKind::screenshot: return "screenshot";
    case CullValidityKind::document: return "document";
  }
  return "photo";
}

const char* cull_validity_state_name(CullValidityState state) noexcept {
  switch (state) {
    case CullValidityState::valid: return "valid";
    case CullValidityState::suspect: return "suspect";
    case CullValidityState::invalid: return "invalid";
  }
  return "valid";
}

CullValidity assess_cull_validity(const Image& image, const CullDecodeHints& hints,
                                  const CullValidityOptions& options) {
  const auto w = image.width, h = image.height;
  if (w < 32 || h < 32 || w > 4096 || h > 4096 || image.rgba.size() != std::size_t(w) * h * 4)
    throw std::invalid_argument("Validity needs a decoded working image between 32 and 4096 pixels.");
  if (!(options.suspect_at > 0 && options.suspect_at <= options.invalid_at && options.invalid_at <= 1))
    throw std::invalid_argument("Invalid validity thresholds.");

  CullValidity out;
  const auto rgb = working_copy(image);
  Plane plane{rgb.width, rgb.height, std::vector<float>(std::size_t(rgb.width) * rgb.height)};
  for (std::size_t i = 0; i < plane.values.size(); ++i)
    plane.values[i] = float(dsp::luma(rgb.r[i], rgb.g[i], rgb.b[i]));
  out.evidence.decoder_warnings = hints.decoder_warnings;
  out.evidence.truncated = hints.truncated;
  measure(rgb, plane, out.evidence);

  const auto finding = decide(out.evidence);
  out.confidence = finding.confidence;
  if (finding.confidence >= options.invalid_at) out.state = CullValidityState::invalid;
  else if (finding.confidence >= options.suspect_at) out.state = CullValidityState::suspect;
  out.kind = out.state == CullValidityState::valid ? CullValidityKind::photo : finding.kind;
  out.reason = reason_for(out.kind, out.state);
  return out;
}

} // namespace lenslabs
