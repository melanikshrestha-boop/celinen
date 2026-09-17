// Parity of the in-engine inference runtime with the reference runtimes.
//
// The expected numbers below were produced by onnxruntime 1.19 (YuNet) and
// TensorFlow Lite 2.16 (Face Mesh V2, Blendshape V2) on the same deterministic
// inputs this test generates, so any drift in a kernel, a loader or a graph
// rewrite (constant folding, activation fusion, planar storage) shows up here.
//
//   build/nn-tests ../src/lib/studio/cull/models
#include "lenslabs/nn.hpp"
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
int checks = 0;
void check(bool passed, const std::string& label) {
  ++checks;
  if (!passed) throw std::runtime_error(label);
}

std::vector<std::uint8_t> slurp(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) throw std::runtime_error("Missing model file " + path);
  return {std::istreambuf_iterator<char>(in), {}};
}

// Knuth multiplicative hash, top byte: the same sequence numpy produced.
lenslabs::nn::Tensor pattern(std::vector<int> shape, float divisor) {
  lenslabs::nn::Tensor t;
  t.shape = std::move(shape);
  t.data.resize(t.elements());
  for (std::size_t i = 0; i < t.data.size(); ++i)
    t.data[i] = float((std::uint32_t(i) * 2654435761u) >> 24) / divisor;
  return t;
}

struct Expected {
  const char* name;
  std::size_t count;
  double mean_abs, max_abs;
  std::pair<std::size_t, double> samples[4];
};

bool close(double actual, double expected) {
  return std::abs(actual - expected) <= 2e-4 * std::max(1.0, std::abs(expected));
}

void expect_outputs(const lenslabs::nn::Model& model, const std::vector<lenslabs::nn::Tensor>& outputs,
                    const std::vector<Expected>& expected, const std::string& label) {
  check(outputs.size() == expected.size(), label + ": output count");
  for (std::size_t o = 0; o < expected.size(); ++o) {
    const auto& e = expected[o];
    const auto& data = outputs[o].data;
    const std::string what = label + " " + e.name;
    check(model.output_name(o) == e.name, what + ": output order");
    check(data.size() == e.count, what + ": element count");
    double sum = 0, peak = 0;
    for (const float v : data) {
      sum += std::abs(v);
      peak = std::max(peak, double(std::abs(v)));
    }
    check(close(sum / double(data.size()), e.mean_abs), what + ": mean magnitude");
    check(close(peak, e.max_abs), what + ": peak magnitude");
    for (const auto& [index, value] : e.samples) check(close(data[index], value), what + ": sampled value");
  }
}

bool rejects(const std::vector<std::uint8_t>& bytes, bool onnx) {
  try {
    if (onnx) lenslabs::nn::Model::onnx(bytes.data(), bytes.size());
    else lenslabs::nn::Model::tflite(bytes.data(), bytes.size());
  } catch (const std::invalid_argument&) {
    return true;
  }
  return false;
}
} // namespace

int main(int argc, char** argv) {
  const std::string dir = argc > 1 ? argv[1] : "../src/lib/studio/cull/models";
  try {
    const auto yunet_bytes = slurp(dir + "/face_detection_yunet_2023mar.onnx");
    const auto mesh_bytes = slurp(dir + "/face_landmarks_detector.tflite");
    const auto blend_bytes = slurp(dir + "/face_blendshapes.tflite");
    const auto yunet = lenslabs::nn::Model::onnx(yunet_bytes.data(), yunet_bytes.size());
    const auto mesh = lenslabs::nn::Model::tflite(mesh_bytes.data(), mesh_bytes.size());
    const auto blend = lenslabs::nn::Model::tflite(blend_bytes.data(), blend_bytes.size());

    {
      // Not the 640x640 the file declares: YuNet is fully convolutional and the
      // engine runs it at the working frame's own size.
      std::vector<lenslabs::nn::Tensor> in;
      in.push_back(pattern({1, 3, 96, 128}, 1));
      expect_outputs(yunet, yunet.run(std::move(in)),
                     {
                         {"cls_8", 192, 0.667750277, 0.776489496, {{0, 0.61345613}, {64, 0.692770839}, {128, 0.724974513}, {191, 0.549157083}}},
                         {"cls_16", 48, 0.530121135, 0.579932213, {{0, 0.559145927}, {16, 0.540983498}, {32, 0.579932213}, {47, 0.5068928}}},
                         {"cls_32", 12, 0.554812799, 0.584477067, {{0, 0.538317084}, {4, 0.516837001}, {8, 0.525499642}, {11, 0.562368035}}},
                         {"obj_8", 192, 6.44320001e-07, 1.37984753e-05, {{0, 2.44379044e-06}, {64, 2.98023224e-07}, {128, 5.96046448e-08}, {191, 2.71201134e-06}}},
                         {"obj_16", 48, 8.20867717e-06, 5.87999821e-05, {{0, 5.08129597e-05}, {16, 2.5331974e-06}, {32, 1.37090683e-06}, {47, 4.11570072e-05}}},
                         {"obj_32", 12, 0.000177976986, 0.000850707293, {{0, 4.60147858e-05}, {4, 5.35845757e-05}, {8, 6.06477261e-05}, {11, 0.000505834818}}},
                         {"bbox_8", 768, 0.661301391, 1.34095514, {{0, 0.278146923}, {256, 0.16873008}, {512, 0.209994733}, {767, 0.864151359}}},
                         {"bbox_16", 192, 0.278796593, 0.586320758, {{0, 0.392263174}, {64, 0.369413942}, {128, 0.380872369}, {191, -0.102764532}}},
                         {"bbox_32", 48, 0.924818922, 1.4427861, {{0, 1.0208174}, {16, 1.09882581}, {32, 0.819566846}, {47, 1.1409502}}},
                         {"kps_8", 1920, 0.678214299, 2.29966283, {{0, -0.292728484}, {640, -0.0663092434}, {1280, 0.117678195}, {1919, 0.708602071}}},
                         {"kps_16", 480, 0.452140016, 0.905970931, {{0, 0.208752498}, {160, 0.208148867}, {320, 0.221536666}, {479, 0.538475931}}},
                         {"kps_32", 120, 1.029479, 2.57609558, {{0, 0.205090195}, {40, 0.213959098}, {80, 0.0654868633}, {119, 1.18615031}}},
                     },
                     "YuNet");
    }
    {
      std::vector<lenslabs::nn::Tensor> in;
      in.push_back(pattern({1, 256, 256, 3}, 255));
      expect_outputs(mesh, mesh.run(std::move(in)),
                     {
                         {"Identity", 1434, 82.4801665, 196.852844, {{0, 118.192612}, {478, 68.5720901}, {956, 5.61003923}, {1433, -3.26244903}}},
                         {"Identity_1", 1, 1.86468506, 1.86468506, {{0, 1.86468506}, {0, 1.86468506}, {0, 1.86468506}, {0, 1.86468506}}},
                         {"Identity_2", 1, 4.0642858e-13, 4.0642858e-13, {{0, 4.0642858e-13}, {0, 4.0642858e-13}, {0, 4.0642858e-13}, {0, 4.0642858e-13}}},
                     },
                     "Face Mesh");
    }
    {
      std::vector<lenslabs::nn::Tensor> in;
      in.push_back(pattern({1, 146, 2}, 1));
      expect_outputs(blend, blend.run(std::move(in)),
                     {
                         {"StatefulPartitionedCall:0", 52, 0.172625993, 0.780660629, {{0, 7.52586202e-05}, {17, 0.245082051}, {34, 0.656471789}, {51, 1.37821498e-05}}},
                     },
                     "Blendshapes");
    }
    {
      // The same model twice gives the same answer: nothing leaks between runs.
      std::vector<lenslabs::nn::Tensor> a, b;
      a.push_back(pattern({1, 146, 2}, 1));
      b.push_back(pattern({1, 146, 2}, 1));
      check(blend.run(std::move(a))[0].data == blend.run(std::move(b))[0].data, "Runs are deterministic.");
    }
    {
      // Malformed files are refused with an error, never read out of bounds.
      check(rejects({}, true) && rejects({}, false), "An empty model is refused.");
      for (const std::size_t cut : {std::size_t(7), std::size_t(64), yunet_bytes.size() / 2, yunet_bytes.size() - 1})
        check(rejects(std::vector<std::uint8_t>(yunet_bytes.begin(), yunet_bytes.begin() + std::ptrdiff_t(cut)), true),
              "A truncated ONNX model is refused.");
      for (const std::size_t cut : {std::size_t(8), std::size_t(512), mesh_bytes.size() / 2})
        check(rejects(std::vector<std::uint8_t>(mesh_bytes.begin(), mesh_bytes.begin() + std::ptrdiff_t(cut)), false),
              "A truncated TFLite model is refused.");
      check(rejects(mesh_bytes, true), "A TFLite file is not accepted as ONNX.");
      check(rejects(yunet_bytes, false), "An ONNX file is not accepted as TFLite.");
      std::vector<lenslabs::nn::Tensor> wrong;
      wrong.push_back(pattern({1, 146, 3}, 1));
      bool refused = false;
      try {
        blend.run(std::move(wrong));
      } catch (const std::invalid_argument&) {
        refused = true;
      }
      check(refused, "An input of the wrong shape is refused.");
    }
    std::cout << "PASS nn: " << checks << " checks\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "FAIL nn: " << error.what() << "\n";
    return 1;
  }
}
