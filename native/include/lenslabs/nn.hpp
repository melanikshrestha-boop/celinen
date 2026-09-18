#pragma once
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

// A small float32 inference runtime for the cull engine's two face models.
//
// Why not onnxruntime-web or MediaPipe's own runtime: each lane of the ingest
// pool already holds the decoded frame inside this WebAssembly module, and a
// ten-megabyte second runtime per lane would cost more memory and start-up than
// the models themselves (a quarter megabyte and three and a half megabytes).
// The models only use convolutions, pooling, resizing and elementwise maths, so
// the runtime executes exactly those, reading the upstream files byte for byte:
// the shipped model files are the published artifacts, verifiable by hash.
//
// Parity with the reference runtimes (onnxruntime and TensorFlow Lite) is
// checked in native/tests/nn_tests.cpp against outputs they produced.
namespace lenslabs::nn {

// Dense float32 tensor. `shape` is always in the model's own axis order
// (NCHW for ONNX, NHWC for TensorFlow Lite).
struct Tensor {
  std::vector<int> shape;
  std::vector<float> data;
  std::size_t elements() const noexcept;
};

struct Graph; // defined in native/src/nn_graph.hpp

class Model {
 public:
  // Both parse untrusted-shaped bytes defensively: a malformed file throws
  // std::invalid_argument, never reads out of bounds.
  static Model onnx(const std::uint8_t* bytes, std::size_t size);
  static Model tflite(const std::uint8_t* bytes, std::size_t size);

  Model(Model&&) noexcept;
  Model& operator=(Model&&) noexcept;
  ~Model();

  // Runs the graph. Inputs are given in the model's declared input order and
  // outputs come back in its declared output order. Batch size must be 1.
  std::vector<Tensor> run(std::vector<Tensor> inputs) const;

  std::size_t input_count() const noexcept;
  std::size_t output_count() const noexcept;
  const std::string& output_name(std::size_t index) const;

 private:
  explicit Model(std::unique_ptr<Graph> graph);
  std::unique_ptr<Graph> graph_;
};

} // namespace lenslabs::nn
