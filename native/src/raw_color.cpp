#include "lenslabs/raw_color.hpp"
#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace lenslabs::raw {
namespace {

// Bradford cone response, the adaptation the DNG specification uses.
constexpr Matrix3 bradford_cone{0.8951, 0.2664, -0.1614, -0.7502, 1.7135,
                                0.0367, 0.0389,  -0.0685, 1.0296};

// Robertson's isotherms over the CIE 1960 UCS: reciprocal megakelvin, u, v and
// the isotherm's slope. Published data (Wyszecki & Stiles, *Color Science*,
// 2nd ed., table 1(3.11)); the method is Robertson, JOSA 58 (1968) 1528.
struct Isotherm {
  double mired, u, v, slope;
};
constexpr Isotherm robertson[31] = {
    {0, 0.18006, 0.26352, -0.24341},   {10, 0.18066, 0.26589, -0.25479},
    {20, 0.18133, 0.26846, -0.26876},  {30, 0.18208, 0.27119, -0.28539},
    {40, 0.18293, 0.27407, -0.30470},  {50, 0.18388, 0.27709, -0.32675},
    {60, 0.18494, 0.28021, -0.35156},  {70, 0.18611, 0.28342, -0.37915},
    {80, 0.18740, 0.28668, -0.40955},  {90, 0.18880, 0.28997, -0.44278},
    {100, 0.19032, 0.29326, -0.47888}, {125, 0.19462, 0.30141, -0.58204},
    {150, 0.19962, 0.30921, -0.70471}, {175, 0.20525, 0.31647, -0.84901},
    {200, 0.21142, 0.32312, -1.0182},  {225, 0.21807, 0.32909, -1.2168},
    {250, 0.22511, 0.33439, -1.4512},  {275, 0.23247, 0.33904, -1.7298},
    {300, 0.24010, 0.34308, -2.0637},  {325, 0.24792, 0.34655, -2.4681},
    {350, 0.25591, 0.34951, -2.9641},  {375, 0.26400, 0.35200, -3.5814},
    {400, 0.27218, 0.35407, -4.3633},  {425, 0.28039, 0.35577, -5.3762},
    {450, 0.28863, 0.35714, -6.7262},  {475, 0.29685, 0.35823, -8.5955},
    {500, 0.30505, 0.35907, -11.324},  {525, 0.31320, 0.35968, -15.628},
    {550, 0.32129, 0.36011, -23.325},  {575, 0.32931, 0.36038, -40.770},
    {600, 0.33724, 0.36051, -116.45}};

// One tint unit is 1/3000 of a CIE 1960 UCS unit off the Planckian locus, which
// is the scale Lightroom's slider is graduated in.
//
// The sign is the part worth stating, and it is negative for a reason. A
// positive tint means the scene's illuminant was green — a fluorescent tube,
// light bounced off foliage — so the render is corrected towards magenta. That
// makes the slider behave the way a photographer expects in both directions at
// once: dragging towards Magenta raises the number and pushes the picture
// magenta, and a frame shot under fluorescent light opens showing a positive
// tint. With the sign the other way round both of those invert.
constexpr double tint_scale = -3000.0;

struct Uv {
  double u, v;
};
Uv uv_of(const Chromaticity& c) noexcept {
  const double d = -2 * c.x + 12 * c.y + 3;
  if (std::abs(d) < 1e-12) return {0, 0};
  return {4 * c.x / d, 6 * c.y / d};
}
Chromaticity xy_of(const Uv& uv) noexcept {
  const double d = 2 * uv.u - 8 * uv.v + 4;
  if (std::abs(d) < 1e-12) return {0, 0};
  return {3 * uv.u / d, 2 * uv.v / d};
}

// The temperature a CalibrationIlluminant code stands for, 0 when it names none.
double illuminant_temperature(int light_source) noexcept {
  const auto xy = illuminant_chromaticity(light_source);
  if (xy.y <= 0) return 0;
  const auto reading = reading_from_chromaticity(xy);
  return reading.known ? reading.kelvin : 0;
}

// DNG's reciprocal-temperature blend between the two calibration illuminants.
Matrix3 interpolate(const ColorProfile& profile, double kelvin, bool forward) {
  const Matrix3& m1 = forward ? profile.forward_matrix_1 : profile.color_matrix_1;
  const Matrix3& m2 = forward ? profile.forward_matrix_2 : profile.color_matrix_2;
  if (!profile.dual) return m1;
  const double t1 = illuminant_temperature(profile.illuminant_1);
  const double t2 = illuminant_temperature(profile.illuminant_2);
  if (!(t1 > 0) || !(t2 > 0) || t1 == t2) return m1;
  // Order them so `low` is the warmer (lower Kelvin) calibration.
  const bool first_is_low = t1 < t2;
  const double low = first_is_low ? t1 : t2, high = first_is_low ? t2 : t1;
  const Matrix3& m_low = first_is_low ? m1 : m2;
  const Matrix3& m_high = first_is_low ? m2 : m1;
  double g;
  if (kelvin <= low)
    g = 1;
  else if (kelvin >= high)
    g = 0;
  else
    g = (1 / kelvin - 1 / high) / (1 / low - 1 / high);
  Matrix3 out{};
  for (int i = 0; i < 9; ++i) out[i] = g * m_low[i] + (1 - g) * m_high[i];
  return out;
}

// The camera calibration matrix at a temperature, blended the same way.
Matrix3 interpolate_calibration(const ColorProfile& profile, double kelvin) {
  if (!profile.dual) return profile.camera_calibration_1;
  const double t1 = illuminant_temperature(profile.illuminant_1);
  const double t2 = illuminant_temperature(profile.illuminant_2);
  if (!(t1 > 0) || !(t2 > 0) || t1 == t2) return profile.camera_calibration_1;
  const bool first_is_low = t1 < t2;
  const double low = first_is_low ? t1 : t2, high = first_is_low ? t2 : t1;
  const Matrix3& m_low = first_is_low ? profile.camera_calibration_1 : profile.camera_calibration_2;
  const Matrix3& m_high = first_is_low ? profile.camera_calibration_2 : profile.camera_calibration_1;
  double g;
  if (kelvin <= low)
    g = 1;
  else if (kelvin >= high)
    g = 0;
  else
    g = (1 / kelvin - 1 / high) / (1 / low - 1 / high);
  Matrix3 out{};
  for (int i = 0; i < 9; ++i) out[i] = g * m_low[i] + (1 - g) * m_high[i];
  return out;
}

// The temperature to evaluate a profile at, for a scene white point.
double kelvin_of(const Chromaticity& white) noexcept {
  const auto reading = reading_from_chromaticity(white);
  return reading.known ? reading.kelvin : 5000;
}

// XYZ (D50) -> camera, at the illuminant a chromaticity implies. This is DNG's
// FindXYZtoCamera: analog balance, times the per-unit calibration, times the
// colour matrix interpolated between the two calibration illuminants.
Matrix3 xyz_to_camera(const ColorProfile& profile, const Chromaticity& white) {
  const double kelvin = kelvin_of(white);
  return multiply(diagonal(profile.analog_balance),
                  multiply(interpolate_calibration(profile, kelvin),
                           interpolate(profile, kelvin, false)));
}

} // namespace

const Matrix3 srgb_to_xyz_d65{0.4123908, 0.3575843, 0.1804808, 0.2126390, 0.7151687,
                              0.0721923, 0.0193308, 0.1191948, 0.9505322};
const Matrix3 xyz_to_srgb_d65{3.2409699,  -1.5373832, -0.4986108, -0.9692436, 1.8759675,
                              0.0415551,  0.0556301,  -0.2039770, 1.0569715};

Matrix3 multiply(const Matrix3& a, const Matrix3& b) noexcept {
  Matrix3 out{};
  for (int r = 0; r < 3; ++r)
    for (int c = 0; c < 3; ++c) {
      double sum = 0;
      for (int k = 0; k < 3; ++k) sum += a[r * 3 + k] * b[k * 3 + c];
      out[r * 3 + c] = sum;
    }
  return out;
}

Vector3 multiply(const Matrix3& a, const Vector3& b) noexcept {
  return {a[0] * b[0] + a[1] * b[1] + a[2] * b[2], a[3] * b[0] + a[4] * b[1] + a[5] * b[2],
          a[6] * b[0] + a[7] * b[1] + a[8] * b[2]};
}

Matrix3 diagonal(const Vector3& v) noexcept { return {v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]}; }

Matrix3 invert(const Matrix3& m) {
  const double det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) +
                     m[2] * (m[3] * m[7] - m[4] * m[6]);
  if (!std::isfinite(det) || std::abs(det) < 1e-12)
    throw std::runtime_error("This camera profile's colour matrix cannot be inverted.");
  const double s = 1 / det;
  return {s * (m[4] * m[8] - m[5] * m[7]), s * (m[2] * m[7] - m[1] * m[8]),
          s * (m[1] * m[5] - m[2] * m[4]), s * (m[5] * m[6] - m[3] * m[8]),
          s * (m[0] * m[8] - m[2] * m[6]), s * (m[2] * m[3] - m[0] * m[5]),
          s * (m[3] * m[7] - m[4] * m[6]), s * (m[1] * m[6] - m[0] * m[7]),
          s * (m[0] * m[4] - m[1] * m[3])};
}

Vector3 xyz_from_chromaticity(const Chromaticity& c) noexcept {
  if (c.y <= 1e-9) return {0, 0, 0};
  return {c.x / c.y, 1.0, (1 - c.x - c.y) / c.y};
}

Chromaticity chromaticity_of(const Vector3& xyz) noexcept {
  const double sum = xyz[0] + xyz[1] + xyz[2];
  if (!(std::abs(sum) > 1e-12)) return {0, 0};
  return {xyz[0] / sum, xyz[1] / sum};
}

const char* profile_source_name(ProfileSource source) noexcept {
  switch (source) {
    case ProfileSource::dng_tags: return "the file's own DNG colour tags";
    case ProfileSource::model_table: return "a profile compiled in for this camera model";
    default: return "no camera colour profile";
  }
}

Chromaticity illuminant_chromaticity(int light_source) noexcept {
  switch (light_source) {
    case 1: case 4: case 9: case 18: case 20: return {0.3457, 0.3585}; // daylight / D55-ish
    case 2: return {0.3721, 0.3751};                                   // fluorescent (F2)
    case 3: case 17: return {0.4476, 0.4074};                          // tungsten / Standard A
    case 10: case 11: case 12: return {0.3324, 0.3474};                // flash / cloudy family
    case 21: return {d65.x, d65.y};
    case 22: return {0.29902, 0.31485};                                // D75
    case 23: return {d50.x, d50.y};
    case 24: return {0.4476, 0.4074};                                  // ISO studio tungsten
    case 14: return {0.37208, 0.37529};                                // cool white fluorescent
    case 15: return {0.31310, 0.33727};                                // white fluorescent D
    default: return {0, 0};
  }
}

Chromaticity white_point_for(double kelvin) noexcept {
  if (!(kelvin > 0)) return d65;
  const double t = std::clamp(kelvin, 1000.0, 40000.0);
  double x;
  if (t <= 4000) {
    // CIE daylight's own polynomial does not reach below 4000 K; the Planckian
    // locus approximation (Kim et al.) does, and is what raw converters use.
    x = -0.2661239e9 / (t * t * t) - 0.2343589e6 / (t * t) + 0.8776956e3 / t + 0.179910;
  } else if (t <= 7000) {
    x = -4.6070e9 / (t * t * t) + 2.9678e6 / (t * t) + 0.09911e3 / t + 0.244063;
  } else {
    x = -2.0064e9 / (t * t * t) + 1.9018e6 / (t * t) + 0.24748e3 / t + 0.237040;
  }
  double y;
  if (t <= 4000)
    y = -0.9549476 * x * x * x - 1.37418593 * x * x + 2.09137015 * x - 0.16748867;
  else
    y = -3.000 * x * x + 2.870 * x - 0.275;
  return {x, y};
}

WhiteBalanceReading reading_from_chromaticity(const Chromaticity& c) noexcept {
  WhiteBalanceReading out;
  if (!(c.y > 1e-9)) return out;
  const Uv uv = uv_of(c);
  double last_distance = 0, last_du = 0, last_dv = 0;
  for (int i = 1; i < 31; ++i) {
    // The isotherm's unit direction, then the signed distance to it.
    double du = 1, dv = robertson[i].slope;
    const double length = std::sqrt(1 + dv * dv);
    du /= length;
    dv /= length;
    double uu = uv.u - robertson[i].u, vv = uv.v - robertson[i].v;
    double distance = -uu * dv + vv * du;
    if (distance <= 0 || i == 30) {
      if (distance > 0) distance = 0;
      distance = -distance;
      const double f = i == 1 ? 0.0 : distance / (last_distance + distance);
      const double mired = robertson[i - 1].mired * f + robertson[i].mired * (1 - f);
      if (!(mired > 0)) return out;
      out.kelvin = 1e6 / mired;
      // Where the point sits relative to the interpolated isotherm, in UCS
      // units, scaled into the units a photographer's tint slider uses.
      uu = uv.u - (robertson[i - 1].u * f + robertson[i].u * (1 - f));
      vv = uv.v - (robertson[i - 1].v * f + robertson[i].v * (1 - f));
      double bu = du * (1 - f) + last_du * f, bv = dv * (1 - f) + last_dv * f;
      const double blend = std::sqrt(bu * bu + bv * bv);
      if (!(blend > 1e-12)) return out;
      bu /= blend;
      bv /= blend;
      out.tint = (uu * bu + vv * bv) * tint_scale;
      out.known = true;
      return out;
    }
    last_distance = distance;
    last_du = du;
    last_dv = dv;
  }
  return out;
}

Chromaticity chromaticity_from_reading(double kelvin, double tint) noexcept {
  if (!(kelvin > 0)) return d65;
  const double mired = std::clamp(1e6 / kelvin, robertson[0].mired + 1e-9, robertson[30].mired);
  int i = 0;
  while (i < 29 && robertson[i + 1].mired < mired) ++i;
  const double span = robertson[i + 1].mired - robertson[i].mired;
  const double f = span > 0 ? (robertson[i + 1].mired - mired) / span : 0;
  const double u = robertson[i].u * f + robertson[i + 1].u * (1 - f);
  const double v = robertson[i].v * f + robertson[i + 1].v * (1 - f);
  // The two bracketing isotherm directions, blended the same way the forward
  // reading blends them, so the two are exact inverses.
  double du0 = 1, dv0 = robertson[i].slope;
  double l0 = std::sqrt(1 + dv0 * dv0);
  du0 /= l0;
  dv0 /= l0;
  double du1 = 1, dv1 = robertson[i + 1].slope;
  double l1 = std::sqrt(1 + dv1 * dv1);
  du1 /= l1;
  dv1 /= l1;
  double bu = du0 * f + du1 * (1 - f), bv = dv0 * f + dv1 * (1 - f);
  const double blend = std::sqrt(bu * bu + bv * bv);
  if (!(blend > 1e-12)) return d65;
  bu /= blend;
  bv /= blend;
  const double offset = tint / tint_scale;
  return xy_of({u + bu * offset, v + bv * offset});
}

Matrix3 bradford_adaptation(const Chromaticity& from, const Chromaticity& to) {
  const Vector3 source = multiply(bradford_cone, xyz_from_chromaticity(from));
  const Vector3 target = multiply(bradford_cone, xyz_from_chromaticity(to));
  for (int i = 0; i < 3; ++i)
    if (!(std::abs(source[i]) > 1e-12))
      throw std::runtime_error("This white point cannot be adapted.");
  const Matrix3 scale = diagonal({target[0] / source[0], target[1] / source[1],
                                  target[2] / source[2]});
  return multiply(invert(bradford_cone), multiply(scale, bradford_cone));
}

Chromaticity white_point_from_neutral(const ColorProfile& profile, const Vector3& neutral) {
  Chromaticity last = d50;
  for (int pass = 0; pass < 32; ++pass) {
    const Matrix3 to_camera = xyz_to_camera(profile, last);
    Chromaticity next = chromaticity_of(multiply(invert(to_camera), neutral));
    if (!(next.y > 1e-6)) return last;
    if (std::abs(next.x - last.x) + std::abs(next.y - last.y) < 1e-8) return next;
    // Two matrices either side of an illuminant can oscillate; settle between.
    if (pass == 31) return {(last.x + next.x) * 0.5, (last.y + next.y) * 0.5};
    last = next;
  }
  return last;
}

Vector3 neutral_for_white_point(const ColorProfile& profile, const Chromaticity& white) {
  const Vector3 camera = multiply(xyz_to_camera(profile, white), xyz_from_chromaticity(white));
  if (!(camera[1] > 1e-9))
    throw std::runtime_error("This white balance is outside the camera's range.");
  return {camera[0] / camera[1], 1.0, camera[2] / camera[1]};
}

Matrix3 camera_to_working(const ColorProfile& profile, const Vector3& neutral) {
  if (!profile.known)
    throw std::runtime_error("This camera has no colour profile, so its RAW cannot be converted.");
  for (double v : neutral)
    if (!std::isfinite(v) || v <= 0)
      throw std::runtime_error("This file's white balance is not usable.");
  const Chromaticity white = white_point_from_neutral(profile, neutral);
  Matrix3 camera_to_xyz_d50;
  if (profile.has_forward) {
    // DNG 1.7.1 §6: the forward matrix already lands in the D50 PCS, so the
    // white balance is the diagonal that takes the camera's neutral to the
    // reference neutral rather than a chromatic adaptation.
    const double kelvin = kelvin_of(white);
    const Matrix3 ab_cc =
        multiply(diagonal(profile.analog_balance), interpolate_calibration(profile, kelvin));
    const Vector3 reference = multiply(invert(ab_cc), neutral);
    for (double v : reference)
      if (!(std::abs(v) > 1e-9))
        throw std::runtime_error("This camera profile's reference neutral is degenerate.");
    const Matrix3 d = diagonal({1 / reference[0], 1 / reference[1], 1 / reference[2]});
    camera_to_xyz_d50 =
        multiply(interpolate(profile, kelvin, true), multiply(d, invert(ab_cc)));
  } else {
    // No forward matrix: invert the colour matrix at the scene's own white and
    // chromatically adapt that white onto the D50 PCS, which is what makes a
    // neutral subject come out neutral.
    camera_to_xyz_d50 =
        multiply(bradford_adaptation(white, d50), invert(xyz_to_camera(profile, white)));
  }
  Matrix3 working =
      multiply(xyz_to_srgb_d65, multiply(bradford_adaptation(d50, d65), camera_to_xyz_d50));
  // One scalar left to fix: the camera's neutral must land on the working
  // space's own white, not merely on some grey. Without this the sensor's
  // white level renders at an arbitrary brightness that differs per camera,
  // and every exposure number downstream would mean something different on
  // each body.
  const Vector3 rendered = multiply(working, neutral);
  if (!(rendered[1] > 1e-9))
    throw std::runtime_error("This camera profile sends a neutral to black.");
  for (double& value : working) value /= rendered[1];
  return working;
}

double srgb_encode(double linear) noexcept {
  if (!(linear > 0)) return 0;
  if (linear >= 1) return 1;
  return linear <= 0.0031308 ? linear * 12.92 : 1.055 * std::pow(linear, 1 / 2.4) - 0.055;
}

double srgb_decode(double encoded) noexcept {
  if (!(encoded > 0)) return 0;
  if (encoded >= 1) return 1;
  return encoded <= 0.04045 ? encoded / 12.92 : std::pow((encoded + 0.055) / 1.055, 2.4);
}

} // namespace lenslabs::raw
