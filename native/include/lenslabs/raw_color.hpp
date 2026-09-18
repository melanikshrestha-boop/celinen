#pragma once
#include <array>
#include <cstdint>
#include <string>

// The colour half of the RAW converter: what a camera's raw RGB means, and what
// "5200 K, +8 tint" means when the numbers come from a sensor rather than from
// a slider.
//
// The model is the one the DNG specification publishes (Adobe, DNG 1.7.1,
// chapters 5 and 6): two colour matrices at two illuminants, interpolated by
// reciprocal temperature, an optional forward matrix, a per-unit calibration
// and an analog balance. A file that carries those tags is decoded from its own
// numbers. A file that does not — every Sony ARW — needs a profile from
// somewhere else; `ColorProfile::description` always says which, and a decode
// with no profile at all says so rather than quietly rendering sRGB-as-camera.
//
// Temperature and tint are Robertson's 1968 isotherm method over the CIE 1960
// UCS, from the published table in Wyszecki & Stiles, *Color Science*, 2nd ed.,
// table 1(3.11). That is the same construction Lightroom's two sliders use: the
// temperature is the correlated colour temperature of the scene's neutral, and
// the tint is its signed distance from the Planckian locus along the isotherm.
namespace lenslabs::raw {

using Matrix3 = std::array<double, 9>; // row major
using Vector3 = std::array<double, 3>;

inline constexpr Matrix3 identity3{1, 0, 0, 0, 1, 0, 0, 0, 1};

Matrix3 multiply(const Matrix3& a, const Matrix3& b) noexcept;
Vector3 multiply(const Matrix3& a, const Vector3& b) noexcept;
Matrix3 diagonal(const Vector3& v) noexcept;
// Throws std::runtime_error on a singular matrix rather than producing infinities.
Matrix3 invert(const Matrix3& m);

struct Chromaticity {
  double x = 0, y = 0;
};
Vector3 xyz_from_chromaticity(const Chromaticity& c) noexcept;
Chromaticity chromaticity_of(const Vector3& xyz) noexcept;

// CIE standard illuminants used as the PCS and the working-space white.
inline constexpr Chromaticity d50{0.34567, 0.35850};
inline constexpr Chromaticity d65{0.31272, 0.32903};

// Where a ColorProfile came from, said out loud everywhere it matters.
enum class ProfileSource : std::uint8_t {
  none = 0,
  // The file's own DNG colour tags. Every DNG, and any RAW that carries them.
  dng_tags = 1,
  // A profile compiled into this repository for a camera model that ships no
  // colour tags. `description` names how it was obtained.
  model_table = 2,
};
const char* profile_source_name(ProfileSource source) noexcept;

struct ColorProfile {
  bool known = false;
  ProfileSource source = ProfileSource::none;
  // XYZ (D50 PCS) -> camera reference space, at each calibration illuminant.
  Matrix3 color_matrix_1 = identity3, color_matrix_2 = identity3;
  // EXIF LightSource codes, e.g. 17 Standard A, 21 D65, 23 D50.
  int illuminant_1 = 21, illuminant_2 = 0;
  bool dual = false;
  Matrix3 camera_calibration_1 = identity3, camera_calibration_2 = identity3;
  // Camera reference (white balanced) -> XYZ D50. Optional; without it the
  // colour matrix is inverted and chromatically adapted instead.
  Matrix3 forward_matrix_1 = identity3, forward_matrix_2 = identity3;
  bool has_forward = false;
  Vector3 analog_balance{1, 1, 1};
  std::string description;
};

// A profile for a model with no colour tags of its own, or an unknown profile
// when the table has none. Never guesses: an unknown model comes back
// `known == false` and the caller must say so on screen.
ColorProfile profile_for_model(const std::string& make, const std::string& model);

// The chromaticity of an EXIF LightSource code; {0,0} when the code names no
// fixed illuminant.
Chromaticity illuminant_chromaticity(int light_source) noexcept;

// The Planckian locus below 4000 K and the CIE daylight locus above it, which
// is the pair the DNG specification and every raw converter use.
Chromaticity white_point_for(double kelvin) noexcept;

// Robertson: a chromaticity to a correlated colour temperature and a signed
// distance from the locus. `valid` is false past the table's 1667-25000 K.
struct WhiteBalanceReading {
  bool known = false;
  double kelvin = 0;
  double tint = 0;
  // The camera-space neutral this reading describes, green normalised to 1.
  Vector3 neutral{1, 1, 1};
};
WhiteBalanceReading reading_from_chromaticity(const Chromaticity& c) noexcept;
Chromaticity chromaticity_from_reading(double kelvin, double tint) noexcept;

// Bradford chromatic adaptation between two white points.
Matrix3 bradford_adaptation(const Chromaticity& from, const Chromaticity& to);

// The scene's white point implied by a camera-space neutral, by the DNG
// iteration: guess a white point, interpolate the colour matrix there, invert
// it onto the neutral, and repeat until the chromaticity stops moving.
Chromaticity white_point_from_neutral(const ColorProfile& profile, const Vector3& neutral);

// The camera-space neutral a photographer asking for `kelvin`/`tint` means.
Vector3 neutral_for_white_point(const ColorProfile& profile, const Chromaticity& white);

// The matrix that takes white-balanced-in-camera-space linear RGB to the linear
// working space (sRGB primaries, D65 white, no transfer function). Includes the
// white balance itself, so feeding it raw camera RGB is a single multiply.
Matrix3 camera_to_working(const ColorProfile& profile, const Vector3& neutral);

// The working space's own transfer function, used only at the very end.
double srgb_encode(double linear) noexcept;
double srgb_decode(double encoded) noexcept;

// Linear sRGB (D65) <-> XYZ (D65), for tests and for the profile fitter.
extern const Matrix3 srgb_to_xyz_d65;
extern const Matrix3 xyz_to_srgb_d65;

} // namespace lenslabs::raw
