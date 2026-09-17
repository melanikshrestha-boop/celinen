#include "lenslabs/faces.hpp"
#include <algorithm>
#include <cmath>
#include <optional>
#include <stdexcept>
#include <string>

namespace lenslabs {
namespace {

constexpr double pi = 3.14159265358979323846;
constexpr int mesh_size = 256;       // Face Mesh V2 input edge
constexpr int mesh_landmarks = 478;
constexpr double roi_scale = 1.5;    // MediaPipe's face rectangle: 1.5x the face, square

double clamp01(double v) { return std::clamp(v, 0.0, 1.0); }
// 0 at `from`, 1 at `to`, linear between; `from` may exceed `to` for a falling ramp.
double ramp(double value, double from, double to) {
  if (from == to) return value >= to ? 1 : 0;
  return clamp01((value - from) / (to - from));
}

// The 146 landmarks Blendshape V2 reads, in order
// (mediapipe/tasks/cc/vision/face_landmarker/face_blendshapes_graph.cc).
constexpr std::array<int, 146> blendshape_landmarks = {
    0,   1,   4,   5,   6,   7,   8,   10,  13,  14,  17,  21,  33,  37,  39,  40,  46,  52,  53,  54,
    55,  58,  61,  63,  65,  66,  67,  70,  78,  80,  81,  82,  84,  87,  88,  91,  93,  95,  103, 105,
    107, 109, 127, 132, 133, 136, 144, 145, 146, 148, 149, 150, 152, 153, 154, 155, 157, 158, 159, 160,
    161, 162, 163, 168, 172, 173, 176, 178, 181, 185, 191, 195, 197, 234, 246, 249, 251, 263, 267, 269,
    270, 276, 282, 283, 284, 285, 288, 291, 293, 295, 296, 297, 300, 308, 310, 311, 312, 314, 317, 318,
    321, 323, 324, 332, 334, 336, 338, 356, 361, 362, 365, 373, 374, 375, 377, 378, 379, 380, 381, 382,
    384, 385, 386, 387, 388, 389, 390, 397, 398, 400, 402, 405, 409, 415, 454, 466, 468, 469, 470, 471,
    472, 473, 474, 475, 476, 477};
constexpr int eye_blink_left = 9, eye_blink_right = 10; // blendshape indices

// Eye contours in the Face Mesh topology. "Right" is the subject's right eye,
// which appears on the left of the image in a frontal face.
constexpr std::array<int, 16> right_eye_contour = {33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246};
constexpr std::array<int, 16> left_eye_contour = {263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466};
constexpr int right_eye_outer = 33, left_eye_outer = 263;
constexpr int right_cheek = 234, left_cheek = 454, forehead = 10, chin = 152;

// A square region of the upright original, rotated so the eye line is level.
struct Roi {
  double cx = 0, cy = 0, side = 0, angle = 0;
};

// MediaPipe's rotation: the angle that brings the vector from the right eye to
// the left eye onto the x axis, wrapped to [-pi, pi).
double level_angle(double x0, double y0, double x1, double y1) {
  double angle = -std::atan2(-(y1 - y0), x1 - x0);
  return angle - 2 * pi * std::floor((angle + pi) / (2 * pi));
}

struct Point3 {
  double x = 0, y = 0, z = 0;
};

struct MeshPass {
  Roi roi;
  double presence = 0;
  // On the heap: two passes of 478 points each would otherwise take most of
  // WebAssembly's 64 KB stack.
  std::vector<Point3> local = std::vector<Point3>(mesh_landmarks);    // in the 256px tensor
  std::vector<Point3> original = std::vector<Point3>(mesh_landmarks); // upright original pixels
  Image tensor;                                  // the crop the model saw, RGBA
  double blink_left = 0, blink_right = 0, detail = 0;
};

// Bilinear sample of the patch at original pixel coordinates, edges replicated.
void sample(const Patch& patch, double ox, double oy, std::uint8_t* out) {
  const auto& image = patch.image;
  const double px = std::clamp((ox - patch.origin_x) * patch.scale - .5, 0.0, double(image.width - 1));
  const double py = std::clamp((oy - patch.origin_y) * patch.scale - .5, 0.0, double(image.height - 1));
  const auto x0 = std::uint32_t(px), y0 = std::uint32_t(py);
  const auto x1 = std::min(x0 + 1, image.width - 1), y1 = std::min(y0 + 1, image.height - 1);
  const double fx = px - x0, fy = py - y0;
  const auto at = [&](std::uint32_t x, std::uint32_t y, int c) {
    return double(image.rgba[(std::size_t(y) * image.width + x) * 4 + std::size_t(c)]);
  };
  for (int c = 0; c < 3; ++c) {
    const double top = at(x0, y0, c) * (1 - fx) + at(x1, y0, c) * fx;
    const double bottom = at(x0, y1, c) * (1 - fx) + at(x1, y1, c) * fx;
    out[c] = std::uint8_t(std::lround(std::clamp(top * (1 - fy) + bottom * fy, 0.0, 255.0)));
  }
  out[3] = 255;
}

// Luma standard deviation inside a tensor-space box.
double box_contrast(const Image& image, double x0, double y0, double x1, double y1) {
  const auto left = std::uint32_t(std::clamp(x0, 0.0, double(image.width)));
  const auto right = std::uint32_t(std::clamp(x1, 0.0, double(image.width)));
  const auto top = std::uint32_t(std::clamp(y0, 0.0, double(image.height)));
  const auto bottom = std::uint32_t(std::clamp(y1, 0.0, double(image.height)));
  double sum = 0, squares = 0;
  std::size_t count = 0;
  for (auto y = top; y < bottom; ++y)
    for (auto x = left; x < right; ++x) {
      const auto* p = image.rgba.data() + (std::size_t(y) * image.width + x) * 4;
      const double luma = .299 * p[0] + .587 * p[1] + .114 * p[2];
      sum += luma;
      squares += luma * luma;
      ++count;
    }
  if (count < 4) return 0;
  const double mean = sum / double(count);
  return std::sqrt(std::max(0.0, squares / double(count) - mean * mean));
}

} // namespace

struct FaceReader::Models {
  std::optional<nn::Model> detector, landmarks, blendshapes;
  // YuNet outputs by stride: cls, obj, bbox, kps for 8, 16, 32.
  std::array<std::array<std::size_t, 4>, 3> heads{};
};

FaceReader::FaceReader() : models_(std::make_unique<Models>()) {}
FaceReader::~FaceReader() = default;
FaceReader::FaceReader(FaceReader&&) noexcept = default;
FaceReader& FaceReader::operator=(FaceReader&&) noexcept = default;

bool FaceReader::can_detect() const noexcept { return models_->detector.has_value(); }
bool FaceReader::can_read_eyes() const noexcept {
  return models_->landmarks.has_value() && models_->blendshapes.has_value();
}

void FaceReader::load(Model kind, const std::uint8_t* bytes, std::size_t size) {
  switch (kind) {
    case Model::detector: {
      auto model = nn::Model::onnx(bytes, size);
      std::array<std::array<std::size_t, 4>, 3> heads{};
      if (model.input_count() != 1 || model.output_count() != 12)
        throw std::invalid_argument("The face detector is not YuNet.");
      const char* prefixes[4] = {"cls_", "obj_", "bbox_", "kps_"};
      const int strides[3] = {8, 16, 32};
      for (int s = 0; s < 3; ++s)
        for (int k = 0; k < 4; ++k) {
          const std::string name = std::string(prefixes[k]) + std::to_string(strides[s]);
          bool found = false;
          for (std::size_t o = 0; o < model.output_count(); ++o)
            if (model.output_name(o) == name) {
              heads[std::size_t(s)][std::size_t(k)] = o;
              found = true;
            }
          if (!found) throw std::invalid_argument("The face detector is missing output " + name + ".");
        }
      models_->detector = std::move(model);
      models_->heads = heads;
      return;
    }
    case Model::landmarks: {
      auto model = nn::Model::tflite(bytes, size);
      if (model.input_count() != 1 || model.output_count() < 2)
        throw std::invalid_argument("The landmark model is not Face Mesh V2.");
      models_->landmarks = std::move(model);
      return;
    }
    case Model::blendshapes: {
      auto model = nn::Model::tflite(bytes, size);
      if (model.input_count() != 1 || model.output_count() != 1)
        throw std::invalid_argument("The blendshape model is not Blendshape V2.");
      models_->blendshapes = std::move(model);
      return;
    }
  }
}

std::vector<DetectedFace> FaceReader::detect(const Image& image, double min_score) const {
  if (!models_->detector) throw std::logic_error("The face detector is not loaded.");
  if (image.width < 32 || image.height < 32 || image.rgba.size() != std::size_t(image.width) * image.height * 4)
    throw std::invalid_argument("Face detection needs an RGBA image of at least 32 pixels.");
  // YuNet downsamples five times and adds upsampled features back, so the
  // input is padded with black to a multiple of 32, as OpenCV does.
  const int width = int(image.width), height = int(image.height);
  const int padded_w = ((width - 1) / 32 + 1) * 32, padded_h = ((height - 1) / 32 + 1) * 32;
  nn::Tensor input;
  input.shape = {1, 3, padded_h, padded_w};
  input.data.assign(std::size_t(3) * std::size_t(padded_h) * std::size_t(padded_w), 0.0f);
  const std::size_t plane = std::size_t(padded_h) * std::size_t(padded_w);
  for (int y = 0; y < height; ++y)
    for (int x = 0; x < width; ++x) {
      const auto* p = image.rgba.data() + (std::size_t(y) * image.width + std::size_t(x)) * 4;
      const std::size_t at = std::size_t(y) * std::size_t(padded_w) + std::size_t(x);
      // BGR, 0..255: the channel order and range OpenCV feeds it.
      input.data[at] = p[2];
      input.data[plane + at] = p[1];
      input.data[2 * plane + at] = p[0];
    }
  std::vector<nn::Tensor> inputs;
  inputs.push_back(std::move(input));
  const auto outputs = models_->detector->run(std::move(inputs));

  std::vector<DetectedFace> found;
  const int strides[3] = {8, 16, 32};
  for (int s = 0; s < 3; ++s) {
    const int stride = strides[s];
    const int columns = padded_w / stride, rows = padded_h / stride;
    const auto& head = models_->heads[std::size_t(s)];
    const auto& cls = outputs[head[0]].data;
    const auto& obj = outputs[head[1]].data;
    const auto& box = outputs[head[2]].data;
    const auto& kps = outputs[head[3]].data;
    const auto cells = std::size_t(columns) * std::size_t(rows);
    if (cls.size() != cells || obj.size() != cells || box.size() != cells * 4 || kps.size() != cells * 10)
      throw std::invalid_argument("The face detector's outputs do not match its input size.");
    for (int r = 0; r < rows; ++r)
      for (int c = 0; c < columns; ++c) {
        const auto i = std::size_t(r) * std::size_t(columns) + std::size_t(c);
        const double score = std::sqrt(clamp01(cls[i]) * clamp01(obj[i]));
        if (score < min_score) continue;
        DetectedFace face;
        face.score = score;
        const double cx = (c + box[i * 4]) * stride, cy = (r + box[i * 4 + 1]) * stride;
        face.width = std::exp(double(box[i * 4 + 2])) * stride;
        face.height = std::exp(double(box[i * 4 + 3])) * stride;
        face.x = cx - face.width / 2;
        face.y = cy - face.height / 2;
        for (int n = 0; n < 5; ++n) {
          face.landmarks[std::size_t(2 * n)] = (kps[i * 10 + std::size_t(2 * n)] + c) * stride;
          face.landmarks[std::size_t(2 * n + 1)] = (kps[i * 10 + std::size_t(2 * n + 1)] + r) * stride;
        }
        if (!(face.width > 0) || !(face.height > 0) || !std::isfinite(face.x) || !std::isfinite(face.y)) continue;
        found.push_back(face);
      }
  }
  // Greedy non-maximum suppression at IoU .3, OpenCV's default for YuNet.
  std::sort(found.begin(), found.end(), [](const auto& a, const auto& b) { return a.score > b.score; });
  std::vector<DetectedFace> kept;
  for (const auto& face : found) {
    const bool overlaps = std::any_of(kept.begin(), kept.end(), [&](const DetectedFace& other) {
      const double ix = std::max(0.0, std::min(face.x + face.width, other.x + other.width) - std::max(face.x, other.x));
      const double iy = std::max(0.0, std::min(face.y + face.height, other.y + other.height) - std::max(face.y, other.y));
      const double overlap = ix * iy;
      return overlap / (face.width * face.height + other.width * other.height - overlap) > .3;
    });
    if (!overlaps) kept.push_back(face);
  }
  // Faces far outside the frame are artefacts of the padding.
  kept.erase(std::remove_if(kept.begin(), kept.end(),
                            [&](const DetectedFace& face) {
                              const double cx = face.x + face.width / 2, cy = face.y + face.height / 2;
                              return cx < 0 || cy < 0 || cx > width || cy > height;
                            }),
             kept.end());
  return kept;
}

namespace {

// Runs Face Mesh on one region and Blendshape V2 on its landmarks.
std::optional<MeshPass> run_mesh(const nn::Model& landmarks, const nn::Model& blendshapes, const Roi& roi,
                                 const PatchSource& source) {
  MeshPass pass;
  pass.roi = roi;
  // The patch has to hold the rotated square, whose corners reach
  // side * sqrt(2) / 2 from the centre.
  const double reach = roi.side * .7072 + 2;
  Patch patch;
  const double wanted = double(mesh_size) / roi.side;
  if (!source(roi.cx - reach, roi.cy - reach, roi.cx + reach, roi.cy + reach, std::min(1.0, wanted), patch) ||
      patch.image.width < 2 || patch.image.height < 2)
    return std::nullopt;
  // Real detail across the region: the model input is 256 pixels either way,
  // but a crop upsampled from a small face carries only this many.
  pass.detail = roi.side * std::min(patch.scale, wanted) / roi_scale;

  pass.tensor = Image{mesh_size, mesh_size, mesh_size, mesh_size, {}};
  pass.tensor.rgba.resize(std::size_t(mesh_size) * mesh_size * 4);
  nn::Tensor input;
  input.shape = {1, mesh_size, mesh_size, 3};
  input.data.resize(std::size_t(mesh_size) * mesh_size * 3);
  const double cosine = std::cos(roi.angle), sine = std::sin(roi.angle);
  for (int j = 0; j < mesh_size; ++j)
    for (int i = 0; i < mesh_size; ++i) {
      const double u = (i + .5) / mesh_size - .5, v = (j + .5) / mesh_size - .5;
      const double ox = roi.cx + (cosine * u - sine * v) * roi.side;
      const double oy = roi.cy + (sine * u + cosine * v) * roi.side;
      auto* pixel = pass.tensor.rgba.data() + (std::size_t(j) * mesh_size + std::size_t(i)) * 4;
      sample(patch, ox, oy, pixel);
      const std::size_t at = (std::size_t(j) * mesh_size + std::size_t(i)) * 3;
      // RGB scaled to 0..1, from the model's own metadata (mean 0, std 255).
      for (int c = 0; c < 3; ++c) input.data[at + std::size_t(c)] = float(pixel[c]) / 255.0f;
    }
  std::vector<nn::Tensor> inputs;
  inputs.push_back(std::move(input));
  const auto outputs = landmarks.run(std::move(inputs));
  if (outputs[0].data.size() != std::size_t(mesh_landmarks) * 3 || outputs[1].data.size() != 1)
    throw std::invalid_argument("The landmark model's outputs are not Face Mesh V2's.");
  // The second output is the face-presence logit.
  pass.presence = 1 / (1 + std::exp(-double(outputs[1].data[0])));
  for (int k = 0; k < mesh_landmarks; ++k) {
    auto& local = pass.local[std::size_t(k)];
    local.x = outputs[0].data[std::size_t(k) * 3];
    local.y = outputs[0].data[std::size_t(k) * 3 + 1];
    local.z = outputs[0].data[std::size_t(k) * 3 + 2];
    const double u = local.x / mesh_size - .5, v = local.y / mesh_size - .5;
    auto& point = pass.original[std::size_t(k)];
    point.x = roi.cx + (cosine * u - sine * v) * roi.side;
    point.y = roi.cy + (sine * u + cosine * v) * roi.side;
    point.z = local.z / mesh_size * roi.side;
  }
  nn::Tensor points;
  points.shape = {1, int(blendshape_landmarks.size()), 2};
  points.data.resize(blendshape_landmarks.size() * 2);
  for (std::size_t k = 0; k < blendshape_landmarks.size(); ++k) {
    const auto& point = pass.original[std::size_t(blendshape_landmarks[k])];
    points.data[k * 2] = float(point.x);
    points.data[k * 2 + 1] = float(point.y);
  }
  std::vector<nn::Tensor> shape_inputs;
  shape_inputs.push_back(std::move(points));
  const auto shapes = blendshapes.run(std::move(shape_inputs));
  if (shapes[0].data.size() != 52) throw std::invalid_argument("The blendshape model's output is not 52 scores.");
  pass.blink_left = clamp01(shapes[0].data[eye_blink_left]);
  pass.blink_right = clamp01(shapes[0].data[eye_blink_right]);
  return pass;
}

// MediaPipe's region for the next pass: the landmarks' bounding box, levelled
// on the outer eye corners, 1.5x and square.
Roi roi_from_landmarks(const MeshPass& pass) {
  double x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18;
  for (const auto& point : pass.original) {
    x0 = std::min(x0, point.x), x1 = std::max(x1, point.x);
    y0 = std::min(y0, point.y), y1 = std::max(y1, point.y);
  }
  const auto& right = pass.original[right_eye_outer];
  const auto& left = pass.original[left_eye_outer];
  return Roi{(x0 + x1) / 2, (y0 + y1) / 2, std::max(x1 - x0, y1 - y0) * roi_scale,
             level_angle(right.x, right.y, left.x, left.y)};
}

// The closed score one pass implies: both eyes when the face is frontal, the
// eye facing the camera as the head turns (the far eye is foreshortened and
// partly hidden, and its blink score means little).
double pass_closed(const MeshPass& pass, double& yaw, bool& left_nearer) {
  const auto& right = pass.local[right_eye_outer];
  const auto& left = pass.local[left_eye_outer];
  const auto& right_cheek_point = pass.local[right_cheek];
  const auto& left_cheek_point = pass.local[left_cheek];
  yaw = std::atan2(left_cheek_point.z - right_cheek_point.z, left_cheek_point.x - right_cheek_point.x) * 180 / pi;
  left_nearer = left.z < right.z; // smaller z is closer to the camera
  const double both = (pass.blink_left + pass.blink_right) / 2;
  const double near = left_nearer ? pass.blink_left : pass.blink_right;
  const double turned = ramp(std::abs(yaw), 20, 40);
  return (1 - turned) * both + turned * near;
}

} // namespace

void score_eyes(EyeReading& r, double detector_score) {
  // Probability: the blendshape blink scores, already combined per head turn
  // by the caller into closed_probability. Confidence: the weakest of the
  // independent reasons to doubt it. Each ramp runs from "cannot trust" to
  // "no reason for doubt".
  const double size = ramp(r.detail, 48, 120);             // pixels of real detail across the face
  const double sharp = r.sharpness < 0 ? 0 : ramp(r.sharpness, .15, .4); // eyes resolved at all
  const double certain = ramp(detector_score, .7, .9);
  const double present = ramp(r.presence, .6, .95);       // the landmark model sees a face
  const double turned = ramp(std::abs(r.yaw), 50, 30);     // one eye hidden past about 40 degrees
  // Looking down closes the lids visually: the classic false blink.
  const double down = ramp(r.pitch, 35, 15);
  const double up = ramp(-r.pitch, 45, 25);
  const double visible = ramp(r.eye_contrast, 4, 10);      // a dark visor or deep shadow flattens the eyes
  const double stable = r.refined ? ramp(r.disagreement, .3, .1) : 1;
  r.confidence = std::min({size, sharp, certain, present, turned, down, up, visible, stable});
}

EyeReading FaceReader::read_eyes(const DetectedFace& face, const PatchSource& source) const {
  if (!can_read_eyes()) throw std::logic_error("The eye models are not loaded.");
  EyeReading reading;
  // First region: the detection, levelled on its eye landmarks. YuNet's box
  // reaches higher up the forehead than Face Mesh's landmarks do; measured on
  // the fixtures, the landmark region is 0.93x the size and 4% of its side
  // lower, so the first region starts there instead of costing a second pass.
  const double side = std::max(face.width, face.height) * roi_scale * .93;
  const Roi first{face.x + face.width / 2, face.y + face.height / 2 + .04 * side, side,
                  level_angle(face.landmarks[0], face.landmarks[1], face.landmarks[2], face.landmarks[3])};
  auto pass = run_mesh(*models_->landmarks, *models_->blendshapes, first, source);
  if (!pass) return reading;
  reading.presence = pass->presence;
  if (pass->presence < .5) return reading; // no face the landmark model recognizes: unknown

  double yaw = 0;
  bool left_nearer = false;
  double closed = pass_closed(*pass, yaw, left_nearer);
  const Roi second = roi_from_landmarks(*pass);
  // Refine when the first pass could be a blink, or when its region was far
  // from where the landmarks say the face is: that is exactly when one pass is
  // not enough to trust.
  const bool shifted = std::hypot(second.cx - first.cx, second.cy - first.cy) > .15 * first.side ||
                       second.side > first.side * 1.35 || second.side < first.side / 1.35;
  if (closed >= FaceReadOptions{}.refine_above || shifted) {
    if (auto refined = run_mesh(*models_->landmarks, *models_->blendshapes, second, source)) {
      double refined_yaw = 0;
      bool refined_left = false;
      const double refined_closed = pass_closed(*refined, refined_yaw, refined_left);
      reading.refined = true;
      reading.disagreement = std::abs(refined_closed - closed);
      if (refined->presence >= .5) {
        pass = std::move(refined);
        closed = refined_closed;
        yaw = refined_yaw;
        left_nearer = refined_left;
      }
    }
  }

  const auto& local = pass->local;
  reading.read = true;
  reading.presence = pass->presence;
  reading.blink_left = pass->blink_left;
  reading.blink_right = pass->blink_right;
  reading.yaw = yaw;
  reading.left_nearer = left_nearer;
  reading.pitch = std::atan2(local[chin].z - local[forehead].z, local[chin].y - local[forehead].y) * 180 / pi;
  reading.detail = pass->detail;
  reading.closed_probability = clamp01(closed);

  // The eyes in the model's own crop, where they sit level.
  double contrast = 0, band_x0 = mesh_size, band_y0 = mesh_size, band_x1 = 0, band_y1 = 0;
  for (const auto* contour : {&right_eye_contour, &left_eye_contour}) {
    double x0 = mesh_size, y0 = mesh_size, x1 = 0, y1 = 0;
    for (const int k : *contour) {
      x0 = std::min(x0, local[std::size_t(k)].x), x1 = std::max(x1, local[std::size_t(k)].x);
      y0 = std::min(y0, local[std::size_t(k)].y), y1 = std::max(y1, local[std::size_t(k)].y);
    }
    const double w = x1 - x0;
    // The eye opening plus a margin of lid, so a closed eye still has an area.
    contrast += box_contrast(pass->tensor, x0 - .15 * w, (y0 + y1) / 2 - .3 * w, x1 + .15 * w, (y0 + y1) / 2 + .3 * w) / 2;
    band_x0 = std::min(band_x0, x0 - .25 * w), band_x1 = std::max(band_x1, x1 + .25 * w);
    band_y0 = std::min(band_y0, (y0 + y1) / 2 - .45 * w), band_y1 = std::max(band_y1, (y0 + y1) / 2 + .45 * w);
  }
  reading.eye_contrast = contrast;
  const auto to_pixel = [](double v) { return std::uint32_t(std::clamp(v, 0.0, double(mesh_size))); };
  reading.sharpness = region_acuity(pass->tensor, to_pixel(band_x0), to_pixel(band_y0), to_pixel(band_x1), to_pixel(band_y1));
  score_eyes(reading, face.score);
  return reading;
}

std::vector<FaceResult> FaceReader::read(const Image& frame, double original_width, double original_height,
                                         const PatchSource& source, const FaceReadOptions& options) const {
  std::vector<FaceResult> results;
  if (!can_detect()) return results;
  const auto detections = detect(frame, options.detect_score);
  const double fx = original_width / frame.width, fy = original_height / frame.height;
  const double aspect = double(frame.width) / frame.height;
  for (const auto& detection : detections) {
    FaceResult result;
    result.face.x = detection.x / frame.width;
    result.face.y = detection.y / frame.height;
    result.face.width = detection.width / frame.width;
    result.face.height = detection.height / frame.height;
    result.face.score = detection.score;
    result.original = detection;
    result.original.x *= fx, result.original.width *= fx;
    result.original.y *= fy, result.original.height *= fy;
    for (std::size_t n = 0; n < 10; n += 2) {
      result.original.landmarks[n] *= fx;
      result.original.landmarks[n + 1] *= fy;
    }
    results.push_back(result);
  }
  const auto by_prominence = [&](const FaceResult& a, const FaceResult& b) {
    return face_prominence(a.face, aspect) > face_prominence(b.face, aspect);
  };
  std::stable_sort(results.begin(), results.end(), by_prominence);
  if (can_read_eyes() && !results.empty()) {
    const double lead = face_prominence(results.front().face, aspect);
    int judged = 0;
    for (auto& result : results) {
      if (judged >= options.max_judged) break;
      if (face_prominence(result.face, aspect) < options.judge_prominence * lead) break;
      if (result.face.score < options.judge_score || result.original.width < options.judge_min_pixels) continue;
      ++judged;
      result.eyes = read_eyes(result.original, source);
      if (!result.eyes.read) continue;
      result.face.sharpness = result.eyes.sharpness;
      result.face.closed_probability = result.eyes.closed_probability;
      result.face.confidence = result.eyes.confidence;
    }
    // Sharpness at the eyes is now known for the judged faces: rank again.
    std::stable_sort(results.begin(), results.end(), by_prominence);
  }
  if (results.size() > options.max_faces) results.resize(options.max_faces);
  return results;
}

} // namespace lenslabs
