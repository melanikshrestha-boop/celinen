#pragma once
#include "lenslabs/engine.hpp"
#include <array>
#include <cstdint>
#include <vector>

// Upright: perspective and level correction from the photo's own straight lines.
//
// Geometry model (every stored number is resolution independent):
//   Centered pixel coordinates p = (x - W/2, y - H/2), y down. A pinhole camera
//   with focal length f (pixels) sees the world through the rotation
//       R = Rz(roll) * Rx(pitch) * Ry(yaw)      (world -> camera)
//   World "down" is +y, so vertical lines meet at the image of R*(0,1,0) and a
//   facade's horizontal lines at the image of R*(1,0,0). Undoing the rotation is
//   the homography K * R^T * K^-1: the picture a level camera at the same spot
//   would have taken. Solved angles are the camera's; the renderer removes them.
//   Focal length is stored as f / image diagonal, so a 1,024px analysis and a
//   36MP export describe the same correction.
namespace lenslabs {

enum class UprightMode : int { off = 0, auto_ = 1, level = 2, vertical = 3, full = 4, guided = 5 };

using Homography = std::array<double, 9>; // row major, maps (x, y, 1)

struct UprightSegment {
  double x1 = 0, y1 = 0, x2 = 0, y2 = 0; // analysis-image pixel coordinates
  double strength = 0;                   // mean gradient magnitude along the region
};

// A guide drawn by the photographer, in normalized source coordinates [0, 1].
struct UprightGuide { double x1 = 0, y1 = 0, x2 = 0, y2 = 0; };

struct UprightRequest {
  UprightMode mode = UprightMode::auto_;
  std::uint32_t analysis_edge = 1024;   // long edge measured; clamped to 256..2048
  double focal = 0;                     // f / diagonal; 0 = take from EXIF or the default
  double k1 = 0;                        // radial distortion of the source (0 = rectilinear)
  std::vector<UprightGuide> guides;     // Guided mode only, at most 4
};

enum class UprightFocalSource : int { fallback = 0, exif_35mm = 1, exif_sensor = 2, measured = 3, guided = 4 };

struct UprightSolution {
  UprightMode requested = UprightMode::off;
  UprightMode applied = UprightMode::off; // what the evidence supported
  bool fallback = false;                  // true when applied is weaker than requested
  double roll = 0, pitch = 0, yaw = 0;    // camera angles removed by the render, degrees
  double focal = 0;                       // f / diagonal used for the solve
  UprightFocalSource focal_source = UprightFocalSource::fallback;
  double confidence = 0;                  // 0..1 for the applied correction
  std::uint32_t segments = 0, vertical_segments = 0, horizontal_segments = 0;
};

// Manual Transform sliders plus the solved camera angles. The render is the
// same function of these numbers at every resolution.
struct UprightTransform {
  double roll = 0, pitch = 0, yaw = 0; // degrees, solved (0 when Upright is off)
  double focal = 0;                    // f / diagonal; 0 = 35mm-equivalent default
  double k1 = 0;
  double vertical = 0, horizontal = 0; // -100..100 keystone
  double rotate = 0;                   // -10..10 degrees
  double aspect = 0;                   // -100..100, positive widens
  double scale = 100;                  // 50..150 percent
  double x_offset = 0, y_offset = 0;   // -100..100 percent of half the frame
  bool constrain_crop = false;
};

struct UprightRect { double x = 0, y = 0, width = 1, height = 1; }; // normalized

// EXIF-derived focal, f / diagonal. 35mm equivalents compare by diagonal (43.27mm).
double upright_focal_from_35mm(double focal_35mm);
inline constexpr double upright_default_focal_35mm = 35;

// --- Pipeline stages, exposed for tests --------------------------------------
// Gradient region-growing line segments on a luma image (values 0..1).
std::vector<UprightSegment> detect_upright_segments(const std::vector<float>& luma,
    std::uint32_t width, std::uint32_t height, double min_length);
// Multi-scale detection on an RGBA working image resized to `analysis_edge`.
// Returned coordinates are in that analysis image; `scale` receives
// analysis pixels per source pixel.
std::vector<UprightSegment> detect_upright_segments(const Image& image,
    std::uint32_t analysis_edge, double& scale, double k1 = 0);

UprightSolution solve_upright(const Image& image, const UprightRequest& request,
                              const std::uint8_t* exif = nullptr, std::size_t exif_size = 0);
// Guided solve on its own: needs no pixels, only the guides and the frame shape.
UprightSolution solve_upright_guides(const std::vector<UprightGuide>& guides,
    std::uint32_t width, std::uint32_t height, double focal);

// True when the transform leaves every pixel where it was.
bool upright_identity(const UprightTransform& transform);
void validate_upright(const UprightTransform& transform);
// Output pixel -> source pixel for a width x height frame (pixel centers at +0.5).
Homography upright_homography(const UprightTransform& transform, std::uint32_t width, std::uint32_t height);
// Largest axis-aligned rectangle of the given aspect (width/height) inside the
// convex quadrilateral `quad` (x0,y0 .. x3,y3 in order), normalized to the frame.
UprightRect inscribed_rect(const std::array<double, 8>& quad, double aspect,
                           std::uint32_t width, std::uint32_t height);
// Bicubic resample into a frame of the same size. Areas the source never
// covered are white, as a print would be.
Image apply_upright(const Image& source, const UprightTransform& transform);

// Protocol line shared by the local executable: "UPRIGHT_1" + 13 numbers.
UprightTransform read_upright_values(const double* values, std::size_t count);
} // namespace lenslabs
