#pragma once
// The runtime's intermediate form, shared by the ONNX and TensorFlow Lite
// loaders and the executor. Private to native/src.
#include "lenslabs/nn.hpp"
#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace lenslabs::nn {

enum class Layout : std::uint8_t { nchw, nhwc };
// prelu carries one slope per output channel (Op::alpha).
enum class Activation : std::uint8_t { none, relu, relu6, prelu };

enum class Kind : std::uint8_t {
  conv,            // grouped 2D convolution (depthwise is groups == channels)
  max_pool,
  resize_nearest,
  add, sub, mul, div, squared_difference,
  neg, relu, prelu, sigmoid, sqrt, rsqrt,
  transpose, reshape, pad, mean, sum, strided_slice, concat,
  dequantize,      // float16 constants; always folded at load
};

struct Op {
  Kind kind{};
  std::vector<int> inputs, outputs; // value ids; -1 marks an absent optional input
  Layout layout = Layout::nchw;
  Activation activation = Activation::none;
  // Spatial attributes (conv, max_pool). Explicit padding is top, left,
  // bottom, right; `same` asks for TensorFlow's SAME padding, which depends on
  // the input size and is therefore resolved at run time.
  int kernel_h = 0, kernel_w = 0, stride_h = 1, stride_w = 1, dilation_h = 1, dilation_w = 1;
  std::array<int, 4> pads{};
  bool same = false;
  int groups = 1;
  // Conv parameters, packed by finalize() as OIHW plus bias. in_channels is
  // per group. TensorFlow Lite marks depthwise convolutions explicitly because
  // their weights are laid out differently.
  std::vector<float> weights, bias;
  int out_channels = 0, in_channels = 0;
  bool depthwise = false;
  int depth_multiplier = 1;
  std::vector<float> alpha; // per-channel slopes of a fused PReLU
  // resize_nearest
  float scale_h = 1, scale_w = 1;
  // Generic integer attributes: transpose perm, reshape shape (ONNX), axes.
  std::vector<int> ints;
  int axis = 0;
  bool keep_dims = false;
  int begin_mask = 0, end_mask = 0, shrink_mask = 0; // strided_slice
};

struct Value {
  std::string name;
  bool constant = false;
  Tensor tensor; // valid when constant
};

struct Graph {
  std::vector<Value> values;
  std::vector<Op> ops;
  std::vector<int> inputs, outputs;
  // For each value, the index of the last op that reads it (or ops.size() for
  // graph outputs), so activations are released as soon as nothing needs them.
  std::vector<std::size_t> last_use;

  int add_value(std::string name) {
    values.push_back(Value{std::move(name), false, {}});
    return int(values.size() - 1);
  }
  // Folds constant subgraphs (float16 dequantization), packs convolution
  // weights, fuses ReLU and per-channel PReLU into the convolution that
  // precedes them and computes activation lifetimes. Every loader calls this last.
  void finalize();
};

// Shared helpers for loaders.
std::size_t element_count(const std::vector<int>& shape);
float half_to_float(std::uint16_t half) noexcept;

} // namespace lenslabs::nn
