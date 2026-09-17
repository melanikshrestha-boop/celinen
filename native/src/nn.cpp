#include "nn_graph.hpp"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <memory>
#include <numeric>
#include <stdexcept>
#include <utility>

// Executor and kernels. Spatial kernels work on planar (NCHW) memory: a
// depthwise or pointwise convolution then becomes a sum of contiguous plane
// scalings, which the compiler vectorizes on both native and wasm SIMD without
// hand-written intrinsics. TensorFlow Lite graphs are NHWC, so a 4-D value can
// be *stored* planar while its shape stays NHWC; it is only reordered when an
// op that depends on axis order (reshape, transpose, reduce...) reads it. The
// landmark model runs end to end without a single reorder.
namespace lenslabs::nn {

std::size_t Tensor::elements() const noexcept { return element_count(shape); }

std::size_t element_count(const std::vector<int>& shape) {
  // Bounded well below what a 32-bit WebAssembly address space can hold, so a
  // corrupt shape fails here instead of wrapping into a small allocation.
  constexpr std::size_t limit = std::size_t(1) << 28;
  std::size_t count = 1;
  for (const int dim : shape) {
    if (dim < 0) throw std::invalid_argument("Negative tensor dimension.");
    if (dim && count > limit / std::size_t(dim)) throw std::invalid_argument("Tensor is too large.");
    count *= std::size_t(dim);
  }
  return count;
}

float half_to_float(std::uint16_t half) noexcept {
  const std::uint32_t sign = (half >> 15) & 1u, exponent = (half >> 10) & 0x1fu, mantissa = half & 0x3ffu;
  float value;
  if (exponent == 0) value = std::ldexp(float(mantissa), -24);            // subnormal
  else if (exponent == 31) value = mantissa ? std::numeric_limits<float>::quiet_NaN()
                                            : std::numeric_limits<float>::infinity();
  else value = std::ldexp(float(mantissa | 0x400u), int(exponent) - 25);
  return sign ? -value : value;
}

namespace {

struct Arg {
  const Tensor* tensor = nullptr;
  bool planar = false; // NHWC-shaped, NCHW-ordered data
};
struct Out {
  Tensor tensor;
  bool planar = false;
};

[[noreturn]] void fail(const char* message) { throw std::invalid_argument(message); }

void nhwc_to_nchw(const float* in, int h, int w, int c, float* out) {
  const std::size_t plane = std::size_t(h) * std::size_t(w);
  for (std::size_t p = 0; p < plane; ++p)
    for (int ch = 0; ch < c; ++ch) out[std::size_t(ch) * plane + p] = in[p * std::size_t(c) + std::size_t(ch)];
}
void nchw_to_nhwc(const float* in, int h, int w, int c, float* out) {
  const std::size_t plane = std::size_t(h) * std::size_t(w);
  for (int ch = 0; ch < c; ++ch)
    for (std::size_t p = 0; p < plane; ++p) out[p * std::size_t(c) + std::size_t(ch)] = in[std::size_t(ch) * plane + p];
}

// A tensor in the model's own axis order, borrowed when it already is and
// reordered into an owned copy when it was stored planar.
class Native {
 public:
  explicit Native(const Arg& arg) {
    if (!arg.planar) {
      view_ = arg.tensor;
      return;
    }
    const auto& shape = arg.tensor->shape;
    owned_.shape = shape;
    owned_.data.resize(arg.tensor->data.size());
    nchw_to_nhwc(arg.tensor->data.data(), shape[1], shape[2], shape[3], owned_.data.data());
    view_ = &owned_;
  }
  Native(const Native&) = delete;
  Native& operator=(const Native&) = delete;
  const Tensor& operator*() const { return *view_; }
  const Tensor* operator->() const { return view_; }

 private:
  Tensor owned_;
  const Tensor* view_ = nullptr;
};

// A 4-D value as planes (C x H x W), whatever layout the op declares.
class Planes {
 public:
  Planes(const Arg& arg, Layout layout) {
    const auto& shape = arg.tensor->shape;
    if (shape.size() != 4 || shape[0] != 1) fail("Spatial ops need a 4-D tensor with batch 1.");
    if (layout == Layout::nchw) {
      c = shape[1], h = shape[2], w = shape[3];
      data = arg.tensor->data.data();
    } else {
      h = shape[1], w = shape[2], c = shape[3];
      if (arg.planar) {
        data = arg.tensor->data.data();
      } else {
        owned_.resize(arg.tensor->data.size());
        nhwc_to_nchw(arg.tensor->data.data(), h, w, c, owned_.data());
        data = owned_.data();
      }
    }
  }
  Planes(const Planes&) = delete;
  Planes& operator=(const Planes&) = delete;
  int c = 0, h = 0, w = 0;
  const float* data = nullptr;

 private:
  std::vector<float> owned_;
};

Out spatial_out(Layout layout, int c, int h, int w) {
  Out out;
  out.tensor.shape = layout == Layout::nchw ? std::vector<int>{1, c, h, w} : std::vector<int>{1, h, w, c};
  out.tensor.data.assign(std::size_t(c) * std::size_t(h) * std::size_t(w), 0);
  out.planar = layout == Layout::nhwc;
  return out;
}

// Output size and leading padding along one axis.
std::pair<int, int> window(int in, int kernel, int stride, int dilation, int pad_before, int pad_after,
                           bool same) {
  if (in <= 0 || kernel <= 0 || stride <= 0 || dilation <= 0) fail("Invalid window.");
  const int span = (kernel - 1) * dilation + 1;
  if (same) {
    const int out = (in + stride - 1) / stride;
    const int total = std::max(0, (out - 1) * stride + span - in);
    return {out, total / 2};
  }
  const int padded = in + pad_before + pad_after;
  if (padded < span) fail("Window is larger than its input.");
  return {(padded - span) / stride + 1, pad_before};
}

// Applies a fused activation to planar (C x plane) output.
void activate(const Op& op, std::vector<float>& data, int channels) {
  switch (op.activation) {
    case Activation::none: return;
    case Activation::relu:
      for (auto& v : data) v = std::max(v, 0.0f);
      return;
    case Activation::relu6:
      for (auto& v : data) v = std::clamp(v, 0.0f, 6.0f);
      return;
    case Activation::prelu: {
      // One slope per channel; written branch-free so each plane vectorizes.
      const std::size_t plane = data.size() / std::size_t(channels);
      for (int c = 0; c < channels; ++c) {
        const float slope = op.alpha[std::size_t(c)];
        float* v = data.data() + std::size_t(c) * plane;
        for (std::size_t i = 0; i < plane; ++i) v[i] = std::max(v[i], 0.0f) + slope * std::min(v[i], 0.0f);
      }
      return;
    }
  }
}

// Four running sums instead of one: a single float accumulator cannot be
// vectorized without licence to reorder additions, four independent ones can.
float dot(const float* a, const float* b, std::size_t count) {
  float s0 = 0, s1 = 0, s2 = 0, s3 = 0;
  std::size_t k = 0;
  for (; k + 4 <= count; k += 4) {
    s0 += a[k] * b[k];
    s1 += a[k + 1] * b[k + 1];
    s2 += a[k + 2] * b[k + 2];
    s3 += a[k + 3] * b[k + 3];
  }
  for (; k < count; ++k) s0 += a[k] * b[k];
  return s0 + s1 + s2 + s3;
}

// Copies one plane into `padded` with zero borders, so kernels index it
// without bounds checks.
void pad_plane(const float* plane, int h, int w, int top, int left, int padded_h, int padded_w,
               std::vector<float>& padded) {
  padded.assign(std::size_t(padded_h) * std::size_t(padded_w), 0.0f);
  for (int y = 0; y < h; ++y)
    std::memcpy(padded.data() + std::size_t(y + top) * std::size_t(padded_w) + std::size_t(left),
                plane + std::size_t(y) * std::size_t(w), sizeof(float) * std::size_t(w));
}

Out convolve(const Op& op, const Arg& input) {
  const Planes in(input, op.layout);
  if (in.c != op.in_channels * op.groups) fail("Convolution input channels do not match its weights.");
  const int groups = op.groups;
  const int in_per_group = in.c / groups, out_per_group = op.out_channels / groups;
  if (in_per_group * groups != in.c || out_per_group * groups != op.out_channels)
    fail("Convolution groups do not divide its channels.");
  const auto [oh, top] = window(in.h, op.kernel_h, op.stride_h, op.dilation_h, op.pads[0], op.pads[2], op.same);
  const auto [ow, left] = window(in.w, op.kernel_w, op.stride_w, op.dilation_w, op.pads[1], op.pads[3], op.same);
  Out out = spatial_out(op.layout, op.out_channels, oh, ow);
  const std::size_t out_plane = std::size_t(oh) * std::size_t(ow);
  const std::size_t in_plane = std::size_t(in.h) * std::size_t(in.w);
  const std::size_t width = std::size_t(ow);
  float* result = out.tensor.data.data();
  if (!op.bias.empty())
    for (int o = 0; o < op.out_channels; ++o)
      std::fill_n(result + std::size_t(o) * out_plane, out_plane, op.bias[std::size_t(o)]);
  const auto weight = [&](int o, int ic, int ky, int kx) {
    return op.weights[((std::size_t(o) * std::size_t(in_per_group) + std::size_t(ic)) * std::size_t(op.kernel_h) +
                       std::size_t(ky)) * std::size_t(op.kernel_w) + std::size_t(kx)];
  };
  // The padded extent every tap stays inside.
  const int padded_h = std::max(in.h + top, (oh - 1) * op.stride_h + (op.kernel_h - 1) * op.dilation_h + 1);
  const int padded_w = std::max(in.w + left, (ow - 1) * op.stride_w + (op.kernel_w - 1) * op.dilation_w + 1);

  // Work proceeds in strips of output rows small enough that a strip of every
  // plane involved stays in cache; walking whole megabyte-sized planes per
  // tap is what makes a naive convolution memory-bound rather than compute-bound.
  const int strip = std::max(1, 4096 / ow);

  if (groups == in.c && in_per_group == 1 && out_per_group == 1) {
    // Depthwise: each channel filters itself. Row by row, every tap is a
    // scaled add along one contiguous padded row.
    std::vector<float> padded;
    for (int c = 0; c < in.c; ++c) {
      pad_plane(in.data + std::size_t(c) * in_plane, in.h, in.w, top, left, padded_h, padded_w, padded);
      for (int y = 0; y < oh; ++y) {
        float* target = result + std::size_t(c) * out_plane + std::size_t(y) * width;
        for (int ky = 0; ky < op.kernel_h; ++ky) {
          const float* row = padded.data() + std::size_t(y * op.stride_h + ky * op.dilation_h) * std::size_t(padded_w);
          const auto step = std::size_t(op.stride_w), gap = std::size_t(op.dilation_w);
          int kx = 0;
          // Three taps per pass: each output sample is loaded and stored once
          // per kernel row instead of once per tap, which is where the time
          // goes once the arithmetic is vectorized.
          for (; kx + 3 <= op.kernel_w; kx += 3) {
            const float w0 = weight(c, 0, ky, kx), w1 = weight(c, 0, ky, kx + 1), w2 = weight(c, 0, ky, kx + 2);
            const float* s0 = row + std::size_t(kx) * gap;
            const float* s1 = s0 + gap;
            const float* s2 = s1 + gap;
            if (step == 1)
              for (std::size_t x = 0; x < width; ++x) target[x] += w0 * s0[x] + w1 * s1[x] + w2 * s2[x];
            else
              for (std::size_t x = 0; x < width; ++x)
                target[x] += w0 * s0[x * step] + w1 * s1[x * step] + w2 * s2[x * step];
          }
          for (; kx < op.kernel_w; ++kx) {
            const float w = weight(c, 0, ky, kx);
            const float* source = row + std::size_t(kx) * gap;
            for (std::size_t x = 0; x < width; ++x) target[x] += w * source[x * step];
          }
        }
      }
    }
    activate(op, out.tensor.data, op.out_channels);
    return out;
  }

  // Small outputs with wide inputs (the landmark model's last stages, down to
  // a single pixel feeding 1,434 outputs): per-row passes would be mostly loop
  // overhead, so gather each output pixel's whole receptive field once and take
  // one dot product per output channel against its packed weights.
  const std::size_t field = std::size_t(in_per_group) * std::size_t(op.kernel_h) * std::size_t(op.kernel_w);
  if (out_plane * 2 <= field) {
    std::vector<float> padded(std::size_t(in.c) * std::size_t(padded_h) * std::size_t(padded_w));
    {
      std::vector<float> plane;
      for (int c = 0; c < in.c; ++c) {
        pad_plane(in.data + std::size_t(c) * in_plane, in.h, in.w, top, left, padded_h, padded_w, plane);
        std::copy(plane.begin(), plane.end(), padded.begin() + std::ptrdiff_t(std::size_t(c) * plane.size()));
      }
    }
    const std::size_t padded_plane = std::size_t(padded_h) * std::size_t(padded_w);
    std::vector<float> receptive(field);
    for (int y = 0; y < oh; ++y)
      for (int x = 0; x < ow; ++x) {
        const std::size_t p = std::size_t(y) * width + std::size_t(x);
        for (int g = 0; g < groups; ++g) {
          float* at = receptive.data();
          for (int ic = 0; ic < in_per_group; ++ic) {
            const float* plane = padded.data() + std::size_t(g * in_per_group + ic) * padded_plane;
            for (int ky = 0; ky < op.kernel_h; ++ky) {
              const float* row = plane + std::size_t(y * op.stride_h + ky * op.dilation_h) * std::size_t(padded_w);
              for (int kx = 0; kx < op.kernel_w; ++kx)
                *at++ = row[std::size_t(x * op.stride_w + kx * op.dilation_w)];
            }
          }
          for (int oc = 0; oc < out_per_group; ++oc) {
            const int o = g * out_per_group + oc;
            const float* w = op.weights.data() + std::size_t(o) * field;
            result[std::size_t(o) * out_plane + p] += dot(w, receptive.data(), field);
          }
        }
      }
    activate(op, out.tensor.data, op.out_channels);
    return out;
  }

  const bool pointwise = op.kernel_h == 1 && op.kernel_w == 1 && op.stride_h == 1 && op.stride_w == 1 &&
                         top == 0 && left == 0 && oh == in.h && ow == in.w;
  if (pointwise) {
    // Each output plane is a weighted sum of the input planes, strip by strip.
    for (int y0 = 0; y0 < oh; y0 += strip) {
      const std::size_t begin = std::size_t(y0) * width;
      const std::size_t count = std::size_t(std::min(strip, oh - y0)) * width;
      for (int g = 0; g < groups; ++g)
        for (int oc = 0; oc < out_per_group; ++oc) {
          const int o = g * out_per_group + oc;
          float* target = result + std::size_t(o) * out_plane + begin;
          const auto source = [&](int ic) { return in.data + std::size_t(g * in_per_group + ic) * in_plane + begin; };
          int ic = 0;
          // Four input planes per pass, for the same reason as the depthwise taps.
          for (; ic + 4 <= in_per_group; ic += 4) {
            const float w0 = weight(o, ic, 0, 0), w1 = weight(o, ic + 1, 0, 0), w2 = weight(o, ic + 2, 0, 0),
                        w3 = weight(o, ic + 3, 0, 0);
            const float* s0 = source(ic);
            const float* s1 = source(ic + 1);
            const float* s2 = source(ic + 2);
            const float* s3 = source(ic + 3);
            for (std::size_t p = 0; p < count; ++p) target[p] += w0 * s0[p] + w1 * s1[p] + w2 * s2[p] + w3 * s3[p];
          }
          for (; ic < in_per_group; ++ic) {
            const float w = weight(o, ic, 0, 0);
            const float* s0 = source(ic);
            for (std::size_t p = 0; p < count; ++p) target[p] += w * s0[p];
          }
        }
    }
    activate(op, out.tensor.data, op.out_channels);
    return out;
  }

  // General case, one output row at a time. Every tap's samples for the row
  // are first laid out contiguously (a row-sized im2col: with a stride they
  // are gathered once, without one they are the padded row itself), then each
  // output channel adds three taps per pass along the row, which vectorizes.
  const std::size_t padded_plane = std::size_t(padded_h) * std::size_t(padded_w);
  std::vector<float> padded(std::size_t(in.c) * padded_plane);
  {
    std::vector<float> plane;
    for (int c = 0; c < in.c; ++c) {
      pad_plane(in.data + std::size_t(c) * in_plane, in.h, in.w, top, left, padded_h, padded_w, plane);
      std::copy(plane.begin(), plane.end(), padded.begin() + std::ptrdiff_t(std::size_t(c) * padded_plane));
    }
  }
  const auto step = std::size_t(op.stride_w), gap = std::size_t(op.dilation_w);
  const std::size_t taps = std::size_t(op.kernel_h) * std::size_t(op.kernel_w);
  std::vector<const float*> samples(std::size_t(in.c) * taps);
  std::vector<float> gathered(step == 1 ? 0 : samples.size() * width);
  for (int y = 0; y < oh; ++y) {
    for (int c = 0; c < in.c; ++c)
      for (int ky = 0; ky < op.kernel_h; ++ky) {
        const float* row = padded.data() + std::size_t(c) * padded_plane +
                           std::size_t(y * op.stride_h + ky * op.dilation_h) * std::size_t(padded_w);
        for (int kx = 0; kx < op.kernel_w; ++kx) {
          const std::size_t slot = std::size_t(c) * taps + std::size_t(ky) * std::size_t(op.kernel_w) + std::size_t(kx);
          const float* source = row + std::size_t(kx) * gap;
          if (step == 1) {
            samples[slot] = source;
          } else {
            float* line = gathered.data() + slot * width;
            for (std::size_t x = 0; x < width; ++x) line[x] = source[x * step];
            samples[slot] = line;
          }
        }
      }
    for (int g = 0; g < groups; ++g)
      for (int oc = 0; oc < out_per_group; ++oc) {
        const int o = g * out_per_group + oc;
        float* target = result + std::size_t(o) * out_plane + std::size_t(y) * width;
        for (int ic = 0; ic < in_per_group; ++ic) {
          const std::size_t base = std::size_t(g * in_per_group + ic) * taps;
          for (int ky = 0; ky < op.kernel_h; ++ky) {
            const std::size_t first = base + std::size_t(ky) * std::size_t(op.kernel_w);
            int kx = 0;
            for (; kx + 3 <= op.kernel_w; kx += 3) {
              const float w0 = weight(o, ic, ky, kx), w1 = weight(o, ic, ky, kx + 1), w2 = weight(o, ic, ky, kx + 2);
              const float* s0 = samples[first + std::size_t(kx)];
              const float* s1 = samples[first + std::size_t(kx) + 1];
              const float* s2 = samples[first + std::size_t(kx) + 2];
              for (std::size_t x = 0; x < width; ++x) target[x] += w0 * s0[x] + w1 * s1[x] + w2 * s2[x];
            }
            for (; kx < op.kernel_w; ++kx) {
              const float w = weight(o, ic, ky, kx);
              const float* s0 = samples[first + std::size_t(kx)];
              for (std::size_t x = 0; x < width; ++x) target[x] += w * s0[x];
            }
          }
        }
      }
  }
  activate(op, out.tensor.data, op.out_channels);
  return out;
}

Out max_pool(const Op& op, const Arg& input) {
  const Planes in(input, op.layout);
  const auto [oh, top] = window(in.h, op.kernel_h, op.stride_h, 1, op.pads[0], op.pads[2], op.same);
  const auto [ow, left] = window(in.w, op.kernel_w, op.stride_w, 1, op.pads[1], op.pads[3], op.same);
  Out out = spatial_out(op.layout, in.c, oh, ow);
  const std::size_t in_plane = std::size_t(in.h) * std::size_t(in.w);
  if (op.kernel_h == 2 && op.kernel_w == 2 && op.stride_h == 2 && op.stride_w == 2 && top == 0 && left == 0 &&
      oh * 2 <= in.h && ow * 2 <= in.w) {
    // The common 2x2 halving, with no padding to consider.
    for (int c = 0; c < in.c; ++c) {
      const float* plane = in.data + std::size_t(c) * in_plane;
      float* target = out.tensor.data.data() + std::size_t(c) * std::size_t(oh) * std::size_t(ow);
      for (int y = 0; y < oh; ++y) {
        const float* a = plane + std::size_t(2 * y) * std::size_t(in.w);
        const float* b = a + std::size_t(in.w);
        for (std::size_t x = 0; x < std::size_t(ow); ++x)
          target[std::size_t(y) * std::size_t(ow) + x] =
              std::max(std::max(a[2 * x], a[2 * x + 1]), std::max(b[2 * x], b[2 * x + 1]));
      }
    }
    activate(op, out.tensor.data, in.c);
    return out;
  }
  for (int c = 0; c < in.c; ++c) {
    const float* plane = in.data + std::size_t(c) * in_plane;
    float* target = out.tensor.data.data() + std::size_t(c) * std::size_t(oh) * std::size_t(ow);
    for (int y = 0; y < oh; ++y)
      for (int x = 0; x < ow; ++x) {
        // Padding never wins a max: only in-frame samples are compared.
        float best = -std::numeric_limits<float>::infinity();
        for (int ky = 0; ky < op.kernel_h; ++ky) {
          const int iy = y * op.stride_h - top + ky;
          if (iy < 0 || iy >= in.h) continue;
          for (int kx = 0; kx < op.kernel_w; ++kx) {
            const int ix = x * op.stride_w - left + kx;
            if (ix < 0 || ix >= in.w) continue;
            best = std::max(best, plane[std::size_t(iy) * std::size_t(in.w) + std::size_t(ix)]);
          }
        }
        target[std::size_t(y) * std::size_t(ow) + std::size_t(x)] = best;
      }
  }
  activate(op, out.tensor.data, in.c);
  return out;
}

// ONNX Resize, mode nearest, coordinate_transformation_mode asymmetric,
// nearest_mode floor: output pixel (y, x) takes input (floor(y / s), floor(x / s)).
Out resize_nearest(const Op& op, const Arg& input) {
  const Planes in(input, op.layout);
  const int oh = int(std::floor(float(in.h) * op.scale_h)), ow = int(std::floor(float(in.w) * op.scale_w));
  if (oh <= 0 || ow <= 0) fail("Resize produced an empty tensor.");
  Out out = spatial_out(op.layout, in.c, oh, ow);
  std::vector<int> xs(std::size_t(ow), 0);
  for (int x = 0; x < ow; ++x) xs[std::size_t(x)] = std::min(in.w - 1, int(std::floor(float(x) / op.scale_w)));
  for (int c = 0; c < in.c; ++c) {
    const float* plane = in.data + std::size_t(c) * std::size_t(in.h) * std::size_t(in.w);
    float* target = out.tensor.data.data() + std::size_t(c) * std::size_t(oh) * std::size_t(ow);
    for (int y = 0; y < oh; ++y) {
      const int iy = std::min(in.h - 1, int(std::floor(float(y) / op.scale_h)));
      const float* line = plane + std::size_t(iy) * std::size_t(in.w);
      for (int x = 0; x < ow; ++x) target[std::size_t(y) * std::size_t(ow) + std::size_t(x)] = line[xs[std::size_t(x)]];
    }
  }
  return out;
}

std::vector<std::size_t> strides_of(const std::vector<int>& shape) {
  std::vector<std::size_t> strides(shape.size(), 1);
  for (std::size_t i = shape.size(); i-- > 1;) strides[i - 1] = strides[i] * std::size_t(shape[i]);
  return strides;
}

template <class F> Out binary(const Arg& a_arg, const Arg& b_arg, F f) {
  const auto& a = *a_arg.tensor;
  const auto& b = *b_arg.tensor;
  // Planar storage survives when both sides share it, or one side is a scalar.
  const bool a_scalar = a.data.size() == 1, b_scalar = b.data.size() == 1;
  if ((a_arg.planar || b_arg.planar) &&
      ((a_arg.planar && b_arg.planar && a.shape == b.shape) || (a_arg.planar && b_scalar) ||
       (b_arg.planar && a_scalar))) {
    const auto& big = a_arg.planar ? a : b;
    Out out{Tensor{big.shape, std::vector<float>(big.data.size())}, true};
    for (std::size_t i = 0; i < big.data.size(); ++i)
      out.tensor.data[i] = f(a.data[a_scalar ? 0 : i], b.data[b_scalar ? 0 : i]);
    return out;
  }
  const Native na(a_arg), nb(b_arg);
  const auto& x = *na;
  const auto& y = *nb;
  const std::size_t rank = std::max(x.shape.size(), y.shape.size());
  std::vector<int> shape(rank, 1), xs(rank, 1), ys(rank, 1);
  for (std::size_t i = 0; i < rank; ++i) {
    if (i < x.shape.size()) xs[rank - x.shape.size() + i] = x.shape[i];
    if (i < y.shape.size()) ys[rank - y.shape.size() + i] = y.shape[i];
  }
  for (std::size_t i = 0; i < rank; ++i) {
    if (xs[i] != ys[i] && xs[i] != 1 && ys[i] != 1) fail("Shapes do not broadcast.");
    shape[i] = std::max(xs[i], ys[i]);
  }
  Out out{Tensor{shape, std::vector<float>(element_count(shape))}, false};
  if (x.shape == y.shape) {
    for (std::size_t i = 0; i < x.data.size(); ++i) out.tensor.data[i] = f(x.data[i], y.data[i]);
    return out;
  }
  auto x_strides = strides_of(xs), y_strides = strides_of(ys);
  for (std::size_t i = 0; i < rank; ++i) {
    if (xs[i] == 1) x_strides[i] = 0;
    if (ys[i] == 1) y_strides[i] = 0;
  }
  std::vector<int> index(rank, 0);
  std::size_t xi = 0, yi = 0;
  for (std::size_t o = 0; o < out.tensor.data.size(); ++o) {
    out.tensor.data[o] = f(x.data[xi], y.data[yi]);
    for (std::size_t d = rank; d-- > 0;) {
      ++index[d];
      xi += x_strides[d];
      yi += y_strides[d];
      if (index[d] < shape[d]) break;
      xi -= x_strides[d] * std::size_t(shape[d]);
      yi -= y_strides[d] * std::size_t(shape[d]);
      index[d] = 0;
    }
  }
  return out;
}

template <class F> Out unary(const Arg& arg, F f) {
  Out out{Tensor{arg.tensor->shape, std::vector<float>(arg.tensor->data.size())}, arg.planar};
  for (std::size_t i = 0; i < out.tensor.data.size(); ++i) out.tensor.data[i] = f(arg.tensor->data[i]);
  return out;
}

Out prelu(const Arg& input, const Arg& alpha_arg) {
  const auto& x = *input.tensor;
  const auto& alpha = *alpha_arg.tensor;
  // One slope per channel, the case every PReLU in these models is.
  const bool per_channel = x.shape.size() == 4 && !alpha_arg.planar && !alpha.shape.empty() &&
                           alpha.data.size() == std::size_t(x.shape[3]) &&
                           std::all_of(alpha.shape.begin(), alpha.shape.end() - 1, [](int d) { return d == 1; });
  if (!per_channel)
    return binary(input, alpha_arg, [](float v, float a) { return v >= 0 ? v : v * a; });
  Out out{Tensor{x.shape, std::vector<float>(x.data.size())}, input.planar};
  const std::size_t channels = alpha.data.size();
  const std::size_t plane = std::size_t(x.shape[1]) * std::size_t(x.shape[2]);
  for (std::size_t i = 0; i < x.data.size(); ++i) {
    const std::size_t channel = input.planar ? i / plane : i % channels;
    const float v = x.data[i];
    out.tensor.data[i] = v >= 0 ? v : v * alpha.data[channel];
  }
  return out;
}

std::vector<int> resolve_axes(std::vector<int> axes, std::size_t rank) {
  for (auto& axis : axes) {
    if (axis < 0) axis += int(rank);
    if (axis < 0 || axis >= int(rank)) fail("Axis out of range.");
  }
  std::sort(axes.begin(), axes.end());
  axes.erase(std::unique(axes.begin(), axes.end()), axes.end());
  return axes;
}

std::vector<int> ints_of(const Tensor& tensor) {
  std::vector<int> values(tensor.data.size());
  for (std::size_t i = 0; i < values.size(); ++i) values[i] = int(std::lround(tensor.data[i]));
  return values;
}

Out reduce(const Op& op, const Arg& input, const Arg* axes_arg) {
  const Native in(input);
  const auto& x = *in;
  const auto axes = resolve_axes(axes_arg ? ints_of(*axes_arg->tensor) : op.ints, x.shape.size());
  std::vector<int> kept = x.shape;
  for (const int axis : axes) kept[std::size_t(axis)] = 1;
  const auto out_strides = strides_of(kept);
  std::vector<float> sums(element_count(kept), 0);
  std::vector<int> index(x.shape.size(), 0);
  for (std::size_t i = 0; i < x.data.size(); ++i) {
    std::size_t o = 0;
    for (std::size_t d = 0; d < x.shape.size(); ++d)
      if (kept[d] != 1) o += std::size_t(index[d]) * out_strides[d];
    sums[o] += x.data[i];
    for (std::size_t d = x.shape.size(); d-- > 0;) {
      if (++index[d] < x.shape[d]) break;
      index[d] = 0;
    }
  }
  if (op.kind == Kind::mean) {
    const float count = float(x.data.size()) / float(sums.size());
    for (auto& v : sums) v /= count;
  }
  std::vector<int> shape;
  for (std::size_t d = 0; d < kept.size(); ++d)
    if (op.keep_dims || !std::binary_search(axes.begin(), axes.end(), int(d))) shape.push_back(kept[d]);
  return Out{Tensor{shape, std::move(sums)}, false};
}

Out transpose(const Arg& input, std::vector<int> perm) {
  const Native in(input);
  const auto& x = *in;
  if (perm.size() != x.shape.size()) fail("Transpose permutation does not match rank.");
  perm = [&] {
    auto sorted = perm;
    std::sort(sorted.begin(), sorted.end());
    for (std::size_t i = 0; i < sorted.size(); ++i)
      if (sorted[i] != int(i)) fail("Invalid transpose permutation.");
    return perm;
  }();
  std::vector<int> shape(perm.size());
  for (std::size_t i = 0; i < perm.size(); ++i) shape[i] = x.shape[std::size_t(perm[i])];
  Out out{Tensor{shape, std::vector<float>(x.data.size())}, false};
  if (shape.size() == 4 && x.shape[0] == 1 && perm == std::vector<int>{0, 2, 3, 1}) {
    nchw_to_nhwc(x.data.data(), x.shape[2], x.shape[3], x.shape[1], out.tensor.data.data());
    return out;
  }
  if (shape.size() == 4 && x.shape[0] == 1 && perm == std::vector<int>{0, 3, 1, 2}) {
    nhwc_to_nchw(x.data.data(), x.shape[1], x.shape[2], x.shape[3], out.tensor.data.data());
    return out;
  }
  const auto in_strides = strides_of(x.shape);
  std::vector<std::size_t> steps(perm.size());
  for (std::size_t i = 0; i < perm.size(); ++i) steps[i] = in_strides[std::size_t(perm[i])];
  std::vector<int> index(shape.size(), 0);
  std::size_t source = 0;
  for (std::size_t o = 0; o < out.tensor.data.size(); ++o) {
    out.tensor.data[o] = x.data[source];
    for (std::size_t d = shape.size(); d-- > 0;) {
      source += steps[d];
      if (++index[d] < shape[d]) break;
      source -= steps[d] * std::size_t(shape[d]);
      index[d] = 0;
    }
  }
  return out;
}

Out reshape(const Arg& input, std::vector<int> target) {
  const Native in(input);
  const auto& x = *in;
  std::size_t known = 1;
  int infer = -1;
  for (std::size_t i = 0; i < target.size(); ++i) {
    if (target[i] == 0 && i < x.shape.size()) target[i] = x.shape[i]; // ONNX: keep this dim
    if (target[i] == -1) {
      if (infer >= 0) fail("Reshape infers more than one dimension.");
      infer = int(i);
    } else if (target[i] <= 0) {
      fail("Invalid reshape dimension.");
    } else {
      known *= std::size_t(target[i]);
    }
  }
  if (infer >= 0) {
    if (known == 0 || x.data.size() % known) fail("Reshape cannot infer a dimension.");
    target[std::size_t(infer)] = int(x.data.size() / known);
  }
  if (element_count(target) != x.data.size()) fail("Reshape changes the element count.");
  return Out{Tensor{target, x.data}, false};
}

Out pad(const Arg& input, const Tensor& paddings) {
  const auto values = ints_of(paddings);
  const auto rank = input.tensor->shape.size();
  if (values.size() != rank * 2) fail("Pad needs two paddings per axis.");
  for (const int v : values)
    if (v < 0) fail("Negative padding is not supported.");
  if (input.planar) {
    // NHWC paddings applied to planar storage: batch and planes stay, the
    // channel padding becomes whole zero planes after the existing ones.
    const auto& x = *input.tensor;
    if (values[0] || values[1] || values[6]) fail("Planar pad only supports trailing channel padding.");
    const int h = x.shape[1], w = x.shape[2], c = x.shape[3];
    const int nh = h + values[2] + values[3], nw = w + values[4] + values[5], nc = c + values[7];
    Out out{Tensor{{1, nh, nw, nc}, std::vector<float>(std::size_t(nh) * std::size_t(nw) * std::size_t(nc), 0)}, true};
    for (int ch = 0; ch < c; ++ch)
      for (int y = 0; y < h; ++y)
        std::memcpy(out.tensor.data.data() + (std::size_t(ch) * std::size_t(nh) + std::size_t(y + values[2])) * std::size_t(nw) + std::size_t(values[4]),
                    x.data.data() + (std::size_t(ch) * std::size_t(h) + std::size_t(y)) * std::size_t(w), sizeof(float) * std::size_t(w));
    return out;
  }
  const auto& x = *input.tensor;
  std::vector<int> shape(rank);
  for (std::size_t d = 0; d < rank; ++d) shape[d] = x.shape[d] + values[d * 2] + values[d * 2 + 1];
  Out out{Tensor{shape, std::vector<float>(element_count(shape), 0)}, false};
  const auto out_strides = strides_of(shape);
  std::vector<int> index(rank, 0);
  for (std::size_t i = 0; i < x.data.size(); ++i) {
    std::size_t o = 0;
    for (std::size_t d = 0; d < rank; ++d) o += std::size_t(index[d] + values[d * 2]) * out_strides[d];
    out.tensor.data[o] = x.data[i];
    for (std::size_t d = rank; d-- > 0;) {
      if (++index[d] < x.shape[d]) break;
      index[d] = 0;
    }
  }
  return out;
}

// TensorFlow StridedSlice without ellipsis or new-axis masks.
Out strided_slice(const Op& op, const Arg& input, const Tensor& begin_t, const Tensor& end_t, const Tensor& strides_t) {
  const Native in(input);
  const auto& x = *in;
  const auto rank = x.shape.size();
  auto begin = ints_of(begin_t), end = ints_of(end_t), step = ints_of(strides_t);
  if (begin.size() != rank || end.size() != rank || step.size() != rank) fail("Strided slice needs one index per axis.");
  std::vector<int> start(rank), count(rank);
  for (std::size_t d = 0; d < rank; ++d) {
    const int dim = x.shape[d];
    if (step[d] == 0) fail("Strided slice step is zero.");
    const bool shrink = (op.shrink_mask >> d) & 1;
    int b = begin[d], e = end[d];
    if (b < 0) b += dim;
    if (e < 0) e += dim;
    if (step[d] > 0) {
      b = (op.begin_mask >> d) & 1 ? 0 : std::clamp(b, 0, dim);
      e = (op.end_mask >> d) & 1 ? dim : std::clamp(e, 0, dim);
    } else {
      b = (op.begin_mask >> d) & 1 ? dim - 1 : std::clamp(b, -1, dim - 1);
      e = (op.end_mask >> d) & 1 ? -1 : std::clamp(e, -1, dim - 1);
    }
    if (shrink) {
      if (b < 0 || b >= dim) fail("Strided slice shrinks past the axis.");
      e = b + 1;
      step[d] = 1;
    }
    start[d] = b;
    count[d] = step[d] > 0 ? std::max(0, (e - b + step[d] - 1) / step[d]) : std::max(0, (b - e - step[d] - 1) / -step[d]);
  }
  const auto in_strides = strides_of(x.shape);
  std::vector<float> data(element_count(count));
  std::vector<int> index(rank, 0);
  for (std::size_t o = 0; o < data.size(); ++o) {
    std::size_t source = 0;
    for (std::size_t d = 0; d < rank; ++d)
      source += std::size_t(start[d] + index[d] * step[d]) * in_strides[d];
    data[o] = x.data[source];
    for (std::size_t d = rank; d-- > 0;) {
      if (++index[d] < count[d]) break;
      index[d] = 0;
    }
  }
  std::vector<int> shape;
  for (std::size_t d = 0; d < rank; ++d)
    if (!((op.shrink_mask >> d) & 1)) shape.push_back(count[d]);
  return Out{Tensor{shape, std::move(data)}, false};
}

Out concat(const Op& op, const std::vector<Arg>& args) {
  std::vector<std::unique_ptr<Native>> natives;
  for (const auto& arg : args) natives.push_back(std::make_unique<Native>(arg));
  const auto& first = **natives.front();
  const auto rank = first.shape.size();
  const int axis = resolve_axes({op.axis}, rank).front();
  std::vector<int> shape = first.shape;
  shape[std::size_t(axis)] = 0;
  for (const auto& native : natives) {
    const auto& t = **native;
    if (t.shape.size() != rank) fail("Concatenation ranks differ.");
    for (std::size_t d = 0; d < rank; ++d)
      if (int(d) != axis && t.shape[d] != first.shape[d]) fail("Concatenation shapes differ.");
    shape[std::size_t(axis)] += t.shape[std::size_t(axis)];
  }
  std::size_t outer = 1, inner = 1;
  for (int d = 0; d < axis; ++d) outer *= std::size_t(shape[std::size_t(d)]);
  for (std::size_t d = std::size_t(axis) + 1; d < rank; ++d) inner *= std::size_t(shape[d]);
  std::vector<float> data;
  data.reserve(element_count(shape));
  for (std::size_t o = 0; o < outer; ++o)
    for (const auto& native : natives) {
      const auto& t = **native;
      const std::size_t block = std::size_t(t.shape[std::size_t(axis)]) * inner;
      data.insert(data.end(), t.data.begin() + std::ptrdiff_t(o * block), t.data.begin() + std::ptrdiff_t((o + 1) * block));
    }
  return Out{Tensor{shape, std::move(data)}, false};
}

const Tensor& need(const std::vector<Arg>& args, std::size_t i) {
  if (i >= args.size() || !args[i].tensor) fail("An operator is missing an input.");
  return *args[i].tensor;
}

Out evaluate(const Op& op, const std::vector<Arg>& args) {
  need(args, 0);
  switch (op.kind) {
    case Kind::conv: return convolve(op, args[0]);
    case Kind::max_pool: return max_pool(op, args[0]);
    case Kind::resize_nearest: return resize_nearest(op, args[0]);
    case Kind::add: need(args, 1); return binary(args[0], args[1], [](float a, float b) { return a + b; });
    case Kind::sub: need(args, 1); return binary(args[0], args[1], [](float a, float b) { return a - b; });
    case Kind::mul: need(args, 1); return binary(args[0], args[1], [](float a, float b) { return a * b; });
    case Kind::div: need(args, 1); return binary(args[0], args[1], [](float a, float b) { return a / b; });
    case Kind::squared_difference:
      need(args, 1);
      return binary(args[0], args[1], [](float a, float b) { return (a - b) * (a - b); });
    case Kind::neg: return unary(args[0], [](float v) { return -v; });
    case Kind::relu: return unary(args[0], [](float v) { return std::max(v, 0.0f); });
    case Kind::sigmoid: return unary(args[0], [](float v) { return 1.0f / (1.0f + std::exp(-v)); });
    case Kind::sqrt: return unary(args[0], [](float v) { return std::sqrt(v); });
    case Kind::rsqrt: return unary(args[0], [](float v) { return 1.0f / std::sqrt(v); });
    case Kind::prelu: need(args, 1); return prelu(args[0], args[1]);
    case Kind::dequantize: return unary(args[0], [](float v) { return v; });
    case Kind::transpose: return transpose(args[0], args.size() > 1 && args[1].tensor ? ints_of(*args[1].tensor) : op.ints);
    case Kind::reshape: return reshape(args[0], args.size() > 1 && args[1].tensor ? ints_of(*args[1].tensor) : op.ints);
    case Kind::pad: return pad(args[0], need(args, 1));
    case Kind::mean:
    case Kind::sum: return reduce(op, args[0], args.size() > 1 && args[1].tensor ? &args[1] : nullptr);
    case Kind::strided_slice: return strided_slice(op, args[0], need(args, 1), need(args, 2), need(args, 3));
    case Kind::concat: return concat(op, args);
  }
  fail("Unknown operator.");
}

} // namespace

void Graph::finalize() {
  const auto is_constant = [&](int id) { return id < 0 || values[std::size_t(id)].constant; };

  // Fold every op whose inputs are all constants (float16 weights and the
  // shape arithmetic around them): the graph that runs per frame is then only
  // the work that depends on the frame.
  std::vector<Op> kept;
  for (auto& op : ops) {
    const bool foldable = op.kind != Kind::conv && !op.inputs.empty() &&
                          std::all_of(op.inputs.begin(), op.inputs.end(), is_constant);
    if (!foldable) {
      kept.push_back(std::move(op));
      continue;
    }
    std::vector<Arg> args;
    for (const int id : op.inputs) args.push_back(Arg{id < 0 ? nullptr : &values[std::size_t(id)].tensor, false});
    auto result = evaluate(op, args);
    if (op.outputs.size() != 1) fail("Folded operators must have one output.");
    auto& value = values[std::size_t(op.outputs[0])];
    value.constant = true;
    value.tensor = std::move(result.tensor);
  }
  ops = std::move(kept);

  // Pack convolution weights as OIHW plus bias. This runs after folding
  // because TensorFlow Lite stores weights as float16 behind a DEQUANTIZE.
  for (auto& op : ops) {
    if (op.kind != Kind::conv) continue;
    if (op.inputs.size() < 2 || op.inputs[1] < 0 || !is_constant(op.inputs[1]))
      fail("Convolution weights must be constant.");
    const auto& weights = values[std::size_t(op.inputs[1])].tensor;
    const auto& s = weights.shape;
    if (s.size() != 4) fail("Convolution weights must be 4-D.");
    int o_count = 0, i_count = 0, kh = 0, kw = 0;
    op.weights.clear();
    if (op.layout == Layout::nchw) { // ONNX: OIHW already
      o_count = s[0], i_count = s[1], kh = s[2], kw = s[3];
      op.weights = weights.data;
    } else if (!op.depthwise) { // TensorFlow Lite CONV_2D: OHWI
      o_count = s[0], kh = s[1], kw = s[2], i_count = s[3];
      op.weights.resize(weights.data.size());
      for (int o = 0; o < o_count; ++o)
        for (int y = 0; y < kh; ++y)
          for (int x = 0; x < kw; ++x)
            for (int i = 0; i < i_count; ++i)
              op.weights[((std::size_t(o) * std::size_t(i_count) + std::size_t(i)) * std::size_t(kh) + std::size_t(y)) * std::size_t(kw) + std::size_t(x)] =
                  weights.data[((std::size_t(o) * std::size_t(kh) + std::size_t(y)) * std::size_t(kw) + std::size_t(x)) * std::size_t(i_count) + std::size_t(i)];
    } else { // TensorFlow Lite DEPTHWISE_CONV_2D: 1 x H x W x (C * multiplier)
      if (s[0] != 1 || op.depth_multiplier <= 0 || s[3] % op.depth_multiplier) fail("Invalid depthwise weights.");
      kh = s[1], kw = s[2], o_count = s[3], i_count = 1;
      op.groups = o_count / op.depth_multiplier;
      op.weights.resize(weights.data.size());
      for (int o = 0; o < o_count; ++o)
        for (int y = 0; y < kh; ++y)
          for (int x = 0; x < kw; ++x)
            op.weights[(std::size_t(o) * std::size_t(kh) + std::size_t(y)) * std::size_t(kw) + std::size_t(x)] =
                weights.data[(std::size_t(y) * std::size_t(kw) + std::size_t(x)) * std::size_t(o_count) + std::size_t(o)];
    }
    if ((op.kernel_h && op.kernel_h != kh) || (op.kernel_w && op.kernel_w != kw))
      fail("Convolution kernel_shape does not match its weights.");
    if (o_count <= 0 || i_count <= 0 || kh <= 0 || kw <= 0 || op.groups <= 0 || o_count % op.groups)
      fail("Invalid convolution weights.");
    op.kernel_h = kh, op.kernel_w = kw, op.out_channels = o_count, op.in_channels = i_count;
    op.bias.clear();
    if (op.inputs.size() > 2 && op.inputs[2] >= 0) {
      if (!is_constant(op.inputs[2])) fail("Convolution bias must be constant.");
      const auto& bias = values[std::size_t(op.inputs[2])].tensor;
      if (bias.data.size() != std::size_t(o_count)) fail("Convolution bias does not match its weights.");
      op.bias = bias.data;
    }
    op.inputs.resize(1);
  }

  // Fuse a ReLU, or a PReLU with one constant slope per channel, into the
  // convolution that feeds it when nothing else reads the convolution's
  // output. The landmark model follows almost every convolution with a PReLU;
  // fused, that is one pass over each output plane instead of a second tensor.
  {
    std::vector<int> readers(values.size(), 0);
    for (const auto& op : ops)
      for (const int id : op.inputs)
        if (id >= 0) ++readers[std::size_t(id)];
    for (const int id : outputs) ++readers[std::size_t(id)];
    std::vector<int> producer(values.size(), -1);
    for (std::size_t i = 0; i < ops.size(); ++i)
      for (const int id : ops[i].outputs) producer[std::size_t(id)] = int(i);
    std::vector<bool> removed(ops.size(), false);
    for (std::size_t i = 0; i < ops.size(); ++i) {
      auto& op = ops[i];
      if (op.kind != Kind::relu && op.kind != Kind::prelu) continue;
      const int source = op.inputs[0];
      const int from = source >= 0 ? producer[std::size_t(source)] : -1;
      if (from < 0 || readers[std::size_t(source)] != 1) continue;
      auto& conv = ops[std::size_t(from)];
      if (conv.kind != Kind::conv || conv.activation != Activation::none) continue;
      if (op.kind == Kind::prelu) {
        if (op.inputs.size() != 2 || op.inputs[1] < 0 || !is_constant(op.inputs[1])) continue;
        const auto& slopes = values[std::size_t(op.inputs[1])].tensor;
        // Only one slope per channel, in the NHWC graph's channel position, fuses.
        const bool per_channel =
            conv.layout == Layout::nhwc && slopes.data.size() == std::size_t(conv.out_channels) &&
            !slopes.shape.empty() &&
            std::all_of(slopes.shape.begin(), slopes.shape.end() - 1, [](int d) { return d == 1; });
        if (!per_channel) continue;
        conv.activation = Activation::prelu;
        conv.alpha = slopes.data;
      } else {
        conv.activation = Activation::relu;
      }
      conv.outputs = op.outputs;
      removed[i] = true;
    }
    std::vector<Op> fused;
    for (std::size_t i = 0; i < ops.size(); ++i)
      if (!removed[i]) fused.push_back(std::move(ops[i]));
    ops = std::move(fused);
  }

  // Constants nothing reads any more (weights now packed, folded inputs) are freed.
  std::vector<bool> referenced(values.size(), false);
  for (const auto& op : ops)
    for (const int id : op.inputs)
      if (id >= 0) referenced[std::size_t(id)] = true;
  for (const int id : outputs) referenced[std::size_t(id)] = true;
  for (std::size_t i = 0; i < values.size(); ++i)
    if (values[i].constant && !referenced[i]) {
      values[i].tensor.data.clear();
      values[i].tensor.data.shrink_to_fit();
    }

  last_use.assign(values.size(), 0);
  for (std::size_t i = 0; i < ops.size(); ++i)
    for (const int id : ops[i].inputs)
      if (id >= 0) last_use[std::size_t(id)] = i;
  for (const int id : outputs) last_use[std::size_t(id)] = ops.size();
}

Model::Model(std::unique_ptr<Graph> graph) : graph_(std::move(graph)) {}
Model::Model(Model&&) noexcept = default;
Model& Model::operator=(Model&&) noexcept = default;
Model::~Model() = default;

std::size_t Model::input_count() const noexcept { return graph_->inputs.size(); }
std::size_t Model::output_count() const noexcept { return graph_->outputs.size(); }
const std::string& Model::output_name(std::size_t index) const {
  return graph_->values.at(std::size_t(graph_->outputs.at(index))).name;
}

std::vector<Tensor> Model::run(std::vector<Tensor> inputs) const {
  const auto& graph = *graph_;
  if (inputs.size() != graph.inputs.size()) fail("Wrong number of model inputs.");
  std::vector<Out> slots(graph.values.size());
  for (std::size_t i = 0; i < inputs.size(); ++i) {
    if (element_count(inputs[i].shape) != inputs[i].data.size()) fail("Model input shape does not match its data.");
    slots[std::size_t(graph.inputs[i])].tensor = std::move(inputs[i]);
  }
  const auto arg = [&](int id) {
    if (id < 0) return Arg{};
    const auto& value = graph.values[std::size_t(id)];
    if (value.constant) return Arg{&value.tensor, false};
    return Arg{&slots[std::size_t(id)].tensor, slots[std::size_t(id)].planar};
  };
  for (std::size_t i = 0; i < graph.ops.size(); ++i) {
    const auto& op = graph.ops[i];
    std::vector<Arg> args;
    args.reserve(op.inputs.size());
    for (const int id : op.inputs) args.push_back(arg(id));
    auto result = evaluate(op, args);
    slots[std::size_t(op.outputs.at(0))] = std::move(result);
    // Release activations nothing later reads; peak memory is then a few
    // feature maps rather than the whole network.
    for (const int id : op.inputs)
      if (id >= 0 && !graph.values[std::size_t(id)].constant && graph.last_use[std::size_t(id)] == i) {
        slots[std::size_t(id)] = Out{};
      }
  }
  std::vector<Tensor> outputs;
  outputs.reserve(graph.outputs.size());
  for (const int id : graph.outputs) {
    const auto& value = graph.values[std::size_t(id)];
    if (value.constant) {
      outputs.push_back(value.tensor);
      continue;
    }
    auto& slot = slots[std::size_t(id)];
    if (slot.planar) {
      const Native native(Arg{&slot.tensor, true});
      outputs.push_back(*native);
    } else {
      outputs.push_back(std::move(slot.tensor));
    }
  }
  return outputs;
}

} // namespace lenslabs::nn
