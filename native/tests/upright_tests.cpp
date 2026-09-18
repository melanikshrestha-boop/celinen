// Upright against scenes with known geometry. Each scene is ray traced from a
// camera with an exact roll, pitch, yaw and focal length, so every recovered
// angle has a ground truth rather than a reference screenshot.
#include "lenslabs/exif.hpp"
#include "lenslabs/upright.hpp"
#include <chrono>
#include <cmath>
#include <cstdio>
#include <functional>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {
using namespace lenslabs;
constexpr double pi = 3.14159265358979323846;
constexpr double degree = pi / 180;
int checks = 0;
void check(bool passed, const std::string& label) {
  ++checks;
  if (!passed) throw std::runtime_error(label);
}
std::string fmt(double v) { char b[32]; std::snprintf(b, sizeof b, "%.3f", v); return b; }

struct Camera { double roll = 0, pitch = 0, yaw = 0, focal35 = 35; };

// World: y down, camera at the origin looking along +z before rotation.
// R = Rz(roll) Rx(pitch) Ry(yaw) maps world to camera, matching upright.hpp.
void world_ray(const Camera& c, double px, double py, double f, double& dx, double& dy, double& dz) {
  double x = px / f, y = py / f, z = 1;
  // R^T = Ry(-yaw) Rx(-pitch) Rz(-roll), applied right to left.
  double cr = std::cos(-c.roll * degree), sr = std::sin(-c.roll * degree);
  double x1 = cr * x - sr * y, y1 = sr * x + cr * y, z1 = z;
  double cp = std::cos(-c.pitch * degree), sp = std::sin(-c.pitch * degree);
  double y2 = cp * y1 - sp * z1, z2 = sp * y1 + cp * z1, x2 = x1;
  double cy = std::cos(-c.yaw * degree), sy = std::sin(-c.yaw * degree);
  dx = cy * x2 + sy * z2; dy = y2; dz = -sy * x2 + cy * z2;
}

// A street corner: a facade facing the camera, a side wall receding to the
// right, a ground plane and bright sky. Windows give long vertical and
// horizontal edges.
double building(double dx, double dy, double dz) {
  double best = 1e30, value = dy < 0 ? .86 : .42; // sky or distant ground
  const auto windows = [](double u, double v, double base) {
    const double cu = std::fmod(std::fmod(u, 2.4) + 2.4, 2.4), cv = std::fmod(std::fmod(v, 3.0) + 3.0, 3.0);
    return cu > .6 && cu < 1.8 && cv > .8 && cv < 2.4 ? .18 : base;
  };
  if (dz > 1e-9) { // front facade z = 14, x in [-16, 9], y in [-24, 3]
    const double t = 14 / dz, x = dx * t, y = dy * t;
    if (x >= -16 && x <= 9 && y >= -24 && y <= 3 && t < best) { best = t; value = windows(x + 16, y + 24, .62); }
  }
  if (dx > 1e-9) { // side wall x = 9, z in [14, 40]
    const double t = 9 / dx, z = dz * t, y = dy * t;
    if (z >= 14 && z <= 40 && y >= -24 && y <= 3 && t < best) { best = t; value = windows(z, y + 24, .5); }
  }
  if (dy > 1e-9) { // ground y = 3
    const double t = 3 / dy;
    if (t < best) { best = t; value = .38; }
  }
  return value;
}

// Open water under sky: a single horizon, nothing vertical.
double seascape(double, double dy, double dz) {
  if (dz <= 0) return .5;
  return dy < 0 ? .78 : .3;
}

Image render(std::uint32_t w, std::uint32_t h, const Camera& c, const std::function<double(double, double, double)>& scene) {
  Image image{w, h, w, h, std::vector<std::uint8_t>(std::size_t(w) * h * 4)};
  const double f = upright_focal_from_35mm(c.focal35) * std::hypot(w, h);
  for (std::uint32_t y = 0; y < h; ++y)
    for (std::uint32_t x = 0; x < w; ++x) {
      double sum = 0;
      for (int sy = 0; sy < 3; ++sy)
        for (int sx = 0; sx < 3; ++sx) {
          double dx, dy, dz;
          world_ray(c, x + (sx + .5) / 3 - w * .5, y + (sy + .5) / 3 - h * .5, f, dx, dy, dz);
          sum += scene(dx, dy, dz);
        }
      const auto v = std::uint8_t(std::lround(sum / 9 * 255));
      const auto i = (std::size_t(y) * w + x) * 4;
      image.rgba[i] = image.rgba[i + 1] = image.rgba[i + 2] = v;
      image.rgba[i + 3] = 255;
    }
  return image;
}

// Median absolute tilt of near-vertical segments, in degrees.
double vertical_tilt(const Image& image) {
  double scale = 0;
  const auto segments = detect_upright_segments(image, 1024, scale);
  std::vector<std::pair<double, double>> tilts;
  double total = 0;
  for (const auto& s : segments) {
    const double len = std::hypot(s.x2 - s.x1, s.y2 - s.y1);
    double a = std::atan2(s.x2 - s.x1, s.y2 - s.y1) / degree; // 0 = vertical
    if (a > 90) a -= 180;
    if (a < -90) a += 180;
    if (std::abs(a) > 20 || len < 40) continue;
    tilts.push_back({std::abs(a), len});
    total += len;
  }
  std::sort(tilts.begin(), tilts.end());
  double run = 0;
  for (const auto& [tilt, len] : tilts) if ((run += len) >= total / 2) return tilt;
  return 90;
}

std::vector<std::uint8_t> exif_jpeg(double focal_mm, int focal_35mm) {
  // SOI, APP1 "Exif\0\0", little-endian TIFF, IFD0 with an ExifIFD pointer,
  // ExifIFD with FocalLength (RATIONAL) and FocalLengthIn35mmFilm (SHORT).
  std::vector<std::uint8_t> tiff;
  const auto u16 = [&](unsigned v) { tiff.push_back(v & 255); tiff.push_back(v >> 8); };
  const auto u32 = [&](unsigned v) { for (int i = 0; i < 4; ++i) tiff.push_back((v >> (8 * i)) & 255); };
  tiff.insert(tiff.end(), {'I', 'I'}); u16(42); u32(8);
  u16(1); u16(0x8769); u16(4); u32(1); u32(26); u32(0);            // IFD0 at 8, ends at 26
  u16(2);                                                          // ExifIFD at 26
  u16(0x920a); u16(5); u32(1); u32(26 + 2 + 24 + 4);               // rational at 56
  u16(0xa405); u16(3); u32(1); u16(unsigned(focal_35mm)); u16(0);
  u32(0);
  u32(unsigned(std::lround(focal_mm * 10))); u32(10);
  std::vector<std::uint8_t> jpeg{0xff, 0xd8, 0xff, 0xe1};
  const auto length = tiff.size() + 8;
  jpeg.push_back(std::uint8_t(length >> 8)); jpeg.push_back(std::uint8_t(length & 255));
  jpeg.insert(jpeg.end(), {'E', 'x', 'i', 'f', 0, 0});
  jpeg.insert(jpeg.end(), tiff.begin(), tiff.end());
  jpeg.insert(jpeg.end(), {0xff, 0xd9});
  return jpeg;
}

double ms_since(std::chrono::steady_clock::time_point start) {
  return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
}
} // namespace

int main() {
  try {
    const std::uint32_t W = 1200, H = 800;

    { // Geometry kernel: identity, sliders, singular turns and the inscribed crop.
      Image flat{16, 12, 16, 12, std::vector<std::uint8_t>(16 * 12 * 4)};
      for (std::size_t i = 0; i < flat.rgba.size(); ++i) flat.rgba[i] = std::uint8_t((i * 37) % 251);
      for (std::size_t i = 3; i < flat.rgba.size(); i += 4) flat.rgba[i] = 255;
      UprightTransform identity;
      check(upright_identity(identity), "Default transform is the identity.");
      check(apply_upright(flat, identity).rgba == flat.rgba, "Identity resampling copies every byte.");
      UprightTransform bad; bad.rotate = 11;
      bool threw = false;
      try { validate_upright(bad); } catch (const std::invalid_argument&) { threw = true; }
      check(threw, "Rotate beyond 10 degrees is rejected.");
      const double values[13] = {1, -2, 3, .8, 0, 10, -10, 2, 5, 110, 4, -4, 1};
      const auto read = read_upright_values(values, 13);
      check(read.pitch == -2 && read.scale == 110 && read.constrain_crop, "Protocol values keep their order.");
      threw = false;
      try { read_upright_values(values, 12); } catch (const std::invalid_argument&) { threw = true; }
      check(threw, "A short protocol line is rejected.");

      // Crop inside a known trapezoid, checked against a brute-force search.
      const std::array<double, 8> quad{100, 50, 1100, 0, 1000, 800, 200, 760};
      const auto r = inscribed_rect(quad, 1.5, W, H);
      const auto inside = [&](double x, double y) {
        for (int i = 0; i < 4; ++i) {
          const int j = (i + 1) % 4;
          const double c = (quad[j * 2] - quad[i * 2]) * (y - quad[i * 2 + 1]) - (quad[j * 2 + 1] - quad[i * 2 + 1]) * (x - quad[i * 2]);
          if (c < -1e-6 * 1000) return false;
        }
        return true;
      };
      const double x0 = r.x * W, y0 = r.y * H, x1 = (r.x + r.width) * W, y1 = (r.y + r.height) * H;
      check(inside(x0, y0) && inside(x1, y0) && inside(x1, y1) && inside(x0, y1), "Inscribed crop lies inside the quad.");
      check(std::abs((x1 - x0) / (y1 - y0) - 1.5) < 1e-6, "Inscribed crop keeps the frame aspect.");
      double brute = 0;
      for (double cx = 100; cx <= 1100; cx += 5)
        for (double cy = 0; cy <= 800; cy += 5) {
          double lo = 0, hi = 800;
          for (int k = 0; k < 30; ++k) {
            const double m = (lo + hi) / 2, hw = m * .75, hh = m * .5;
            (inside(cx - hw, cy - hh) && inside(cx + hw, cy - hh) && inside(cx + hw, cy + hh) && inside(cx - hw, cy + hh) ? lo : hi) = m;
          }
          brute = std::max(brute, lo);
        }
      check(y1 - y0 >= brute * .995, "Inscribed crop is maximal (height " + fmt(y1 - y0) + " vs search " + fmt(brute) + ").");
      std::cout << "inscribed crop height " << fmt(y1 - y0) << " px, brute force " << fmt(brute) << " px\n";
    }

    { // EXIF focal length, 35mm equivalent and TIFF-based files.
      const auto jpeg = exif_jpeg(24, 36);
      const auto facts = read_exif(jpeg.data(), jpeg.size());
      check(std::abs(facts.focal_length_mm - 24) < 1e-9, "EXIF focal length reads.");
      check(facts.focal_length_35mm == 36, "EXIF 35mm equivalent reads.");
      const std::vector<std::uint8_t> tiff(jpeg.begin() + 12, jpeg.end() - 2);
      check(read_exif(tiff.data(), tiff.size()).focal_length_35mm == 36, "A TIFF-based RAW header reads directly.");
      const std::vector<std::uint8_t> torn(jpeg.begin(), jpeg.begin() + 40);
      check(read_exif(torn.data(), torn.size()).focal_length_35mm == 0, "Truncated EXIF yields nothing.");
    }

    struct Case { const char* name; Camera camera; UprightMode mode; };
    const auto solve = [&](const Camera& camera, UprightMode mode, double focal_hint, double* elapsed = nullptr,
                           std::uint32_t edge = 1024) {
      const auto image = render(W, H, camera, building);
      UprightRequest request;
      request.mode = mode;
      request.focal = focal_hint;
      request.analysis_edge = edge;
      const auto start = std::chrono::steady_clock::now();
      auto solution = solve_upright(image, request);
      if (elapsed) *elapsed = ms_since(start);
      return std::pair{solution, image};
    };

    { // Vertical: known roll and pitch come back; verticals end up vertical.
      for (const Camera camera : {Camera{3, -12, 0}, Camera{-4, -20, 5}, Camera{1.5, 8, -6}}) {
        const auto [s, image] = solve(camera, UprightMode::vertical, upright_focal_from_35mm(35));
        std::cout << "vertical  truth roll " << camera.roll << " pitch " << camera.pitch << " -> roll " << fmt(s.roll)
                  << " pitch " << fmt(s.pitch) << " conf " << fmt(s.confidence) << " segments " << s.segments
                  << " (v " << s.vertical_segments << ")\n";
        check(s.applied == UprightMode::vertical && !s.fallback, "Vertical mode is supported by a facade.");
        check(std::abs(s.roll - camera.roll) < .3, "Vertical roll within 0.3 deg.");
        check(std::abs(s.pitch - camera.pitch) < .6, "Vertical pitch within 0.6 deg.");
        check(s.confidence >= .5, "A facade is strong evidence.");
        UprightTransform t;
        t.roll = s.roll; t.pitch = s.pitch; t.focal = s.focal;
        const double before = vertical_tilt(image), after = vertical_tilt(apply_upright(image, t));
        std::cout << "          median vertical tilt " << fmt(before) << " -> " << fmt(after) << " deg\n";
        check(after < .35 && after < before, "Rendered verticals are vertical.");
      }
    }

    { // Full: yaw too, with the facade and its side wall both visible.
      for (const Camera camera : {Camera{-2, -10, 15}, Camera{2.5, -14, -12}}) {
        const auto [s, image] = solve(camera, UprightMode::full, upright_focal_from_35mm(35));
        std::cout << "full      truth " << camera.roll << "/" << camera.pitch << "/" << camera.yaw << " -> " << fmt(s.roll)
                  << "/" << fmt(s.pitch) << "/" << fmt(s.yaw) << " conf " << fmt(s.confidence) << " (h "
                  << s.horizontal_segments << ")\n";
        check(s.applied == UprightMode::full, "Full mode is supported by two facades.");
        check(std::abs(s.roll - camera.roll) < .3 && std::abs(s.pitch - camera.pitch) < .6, "Full roll/pitch accurate.");
        check(std::abs(s.yaw - camera.yaw) < 1, "Full yaw within 1 deg.");
      }
    }

    { // No EXIF: the default focal still makes verticals exact, and two finite
      // vanishing points measure the real focal length.
      const Camera camera{1, -15, 18, 24};
      const auto [s, image] = solve(camera, UprightMode::full, 0);
      std::cout << "no-exif   truth f/diag " << fmt(upright_focal_from_35mm(24)) << " -> " << fmt(s.focal) << " source "
                << int(s.focal_source) << " angles " << fmt(s.roll) << "/" << fmt(s.pitch) << "/" << fmt(s.yaw) << "\n";
      check(s.applied == UprightMode::full, "Full mode without EXIF.");
      check(s.focal_source == UprightFocalSource::measured, "Focal length is measured from orthogonal vanishing points.");
      check(std::abs(s.focal / upright_focal_from_35mm(24) - 1) < .08, "Measured focal within 8%.");
      check(std::abs(s.yaw - camera.yaw) < 1.5 && std::abs(s.pitch - camera.pitch) < 1, "Angles with a measured focal.");
      UprightTransform t;
      t.roll = s.roll; t.pitch = s.pitch; t.yaw = s.yaw; t.focal = s.focal;
      check(vertical_tilt(apply_upright(image, t)) < .4, "Full correction leaves verticals vertical.");
    }

    { // EXIF bytes drive the focal length.
      const Camera camera{0, -12, 10, 50};
      const auto image = render(W, H, camera, building);
      const auto jpeg = exif_jpeg(33, 50);
      UprightRequest request;
      request.mode = UprightMode::full;
      const auto s = solve_upright(image, request, jpeg.data(), jpeg.size());
      std::cout << "exif      focal source " << int(s.focal_source) << " yaw " << fmt(s.yaw) << " pitch " << fmt(s.pitch) << "\n";
      check(s.focal_source == UprightFocalSource::exif_35mm, "EXIF 35mm focal is used.");
      check(std::abs(s.focal - upright_focal_from_35mm(50)) < 1e-12, "EXIF focal converts by diagonal.");
      check(std::abs(s.pitch - camera.pitch) < .6 && std::abs(s.yaw - camera.yaw) < 1, "EXIF-focal solve accurate.");
    }

    { // Level: a tilted horizon with nothing vertical.
      for (double roll : {4.0, -7.5}) {
        const auto sea = render(W, H, Camera{roll, 0, 0}, seascape);
        UprightRequest request;
        request.mode = UprightMode::level;
        const auto s = solve_upright(sea, request);
        std::cout << "level     truth roll " << roll << " -> " << fmt(s.roll) << " conf " << fmt(s.confidence) << "\n";
        check(s.applied == UprightMode::level && std::abs(s.roll - roll) < .2, "Level recovers a horizon within 0.2 deg.");
        request.mode = UprightMode::vertical;
        const auto v = solve_upright(sea, request);
        check(v.applied == UprightMode::level && v.fallback, "Vertical falls back to Level without verticals.");
        check(std::abs(v.roll - roll) < .2 && v.pitch == 0, "The fallback keeps only the level.");
        request.mode = UprightMode::auto_;
        const auto a = solve_upright(sea, request);
        check(a.applied == UprightMode::level && a.pitch == 0 && a.yaw == 0, "Auto on a seascape only levels.");
      }
      // Level on a building uses its geometry, not the converging horizontals.
      const auto [s, image] = solve(Camera{3, -12, 14}, UprightMode::level, upright_focal_from_35mm(35));
      std::cout << "level     building roll 3 -> " << fmt(s.roll) << "\n";
      check(s.applied == UprightMode::level && std::abs(s.roll - 3) < .4 && s.pitch == 0, "Level on a turned facade.");
    }

    { // Auto: tilt removed fully, keystone corrected at least partly.
      const Camera camera{2, -16, 8};
      const auto [s, image] = solve(camera, UprightMode::auto_, upright_focal_from_35mm(35));
      std::cout << "auto      truth " << camera.roll << "/" << camera.pitch << "/" << camera.yaw << " -> " << fmt(s.roll)
                << "/" << fmt(s.pitch) << "/" << fmt(s.yaw) << " conf " << fmt(s.confidence) << "\n";
      check(s.applied == UprightMode::auto_, "Auto applies to a facade.");
      check(std::abs(s.roll - camera.roll) < .3, "Auto roll accurate.");
      check(s.pitch <= camera.pitch * .4 && s.pitch >= camera.pitch - .6, "Auto corrects most of the keystone.");
    }

    { // Weak evidence: noise and a blank frame change nothing.
      Image noise{W, H, W, H, std::vector<std::uint8_t>(std::size_t(W) * H * 4)};
      std::uint64_t state = 1234567;
      for (std::size_t i = 0; i < noise.rgba.size(); ++i) {
        state = state * 6364136223846793005ull + 1442695040888963407ull;
        noise.rgba[i] = (i % 4 == 3) ? 255 : std::uint8_t(96 + (state >> 58));
      }
      for (auto mode : {UprightMode::auto_, UprightMode::full, UprightMode::vertical, UprightMode::level}) {
        UprightRequest request;
        request.mode = mode;
        const auto s = solve_upright(noise, request);
        check(s.applied == UprightMode::off && s.confidence == 0 && s.roll == 0 && s.pitch == 0 && s.yaw == 0,
              "Noise yields no correction.");
      }
      Image blank{640, 480, 640, 480, std::vector<std::uint8_t>(640 * 480 * 4, 128)};
      UprightRequest request;
      check(solve_upright(blank, request).applied == UprightMode::off, "A blank frame yields no correction.");
      bool threw = false;
      try { solve_upright(Image{}, request); } catch (const std::invalid_argument&) { threw = true; }
      check(threw, "No image is an error, not a guess.");
    }

    { // Guided: photographer lines from a known camera.
      const Camera camera{2, -8, 10};
      const double focal = upright_focal_from_35mm(35), f = focal * std::hypot(W, H);
      // Project world points through R = Rz Rx Ry and K.
      const auto project = [&](double X, double Y, double Z, double& u, double& v) {
        const double cy = std::cos(camera.yaw * degree), sy = std::sin(camera.yaw * degree);
        double x = cy * X + sy * Z, y = Y, z = -sy * X + cy * Z;
        const double cp = std::cos(camera.pitch * degree), sp = std::sin(camera.pitch * degree);
        double y2 = cp * y - sp * z, z2 = sp * y + cp * z;
        const double cr = std::cos(camera.roll * degree), sr = std::sin(camera.roll * degree);
        double x3 = cr * x - sr * y2, y3 = sr * x + cr * y2;
        u = (f * x3 / z2 + W * .5) / W;
        v = (f * y3 / z2 + H * .5) / H;
      };
      const auto guide = [&](double X1, double Y1, double Z1, double X2, double Y2, double Z2) {
        UprightGuide g;
        project(X1, Y1, Z1, g.x1, g.y1);
        project(X2, Y2, Z2, g.x2, g.y2);
        return g;
      };
      const std::vector<UprightGuide> guides{guide(-6, -8, 20, -6, 2, 20), guide(5, -9, 22, 5, 1, 22),
                                             guide(-7, -3, 20, 6, -3, 20), guide(-6, 1, 24, 7, 1, 24)};
      const auto start = std::chrono::steady_clock::now();
      const auto s = solve_upright_guides(guides, W, H, focal);
      const double elapsed = ms_since(start);
      std::cout << "guided    truth " << camera.roll << "/" << camera.pitch << "/" << camera.yaw << " -> " << fmt(s.roll)
                << "/" << fmt(s.pitch) << "/" << fmt(s.yaw) << " f " << fmt(s.focal) << " vs " << fmt(focal)
                << " conf " << fmt(s.confidence) << " in " << fmt(elapsed) << " ms\n";
      check(s.applied == UprightMode::guided, "Four guides solve.");
      check(std::abs(s.roll - camera.roll) < .2 && std::abs(s.pitch - camera.pitch) < .2 && std::abs(s.yaw - camera.yaw) < .3,
            "Guided angles within 0.3 deg.");
      check(s.confidence > .9, "Consistent guides are confident.");
      // Every guide is axis-aligned after the render's homography.
      UprightTransform t;
      t.roll = s.roll; t.pitch = s.pitch; t.yaw = s.yaw; t.focal = s.focal;
      const auto map = upright_homography(t, W, H);
      // map is output->source; invert numerically by solving for each endpoint.
      const auto forward = [&](double sx, double sy, double& ox, double& oy) {
        ox = sx; oy = sy;
        for (int i = 0; i < 50; ++i) { // Newton on the 2D map
          const auto at = [&](double x, double y, double& u, double& v) {
            const double z = map[6] * x + map[7] * y + map[8];
            u = (map[0] * x + map[1] * y + map[2]) / z; v = (map[3] * x + map[4] * y + map[5]) / z;
          };
          double u, v, ux, vx, uy, vy;
          at(ox, oy, u, v); at(ox + 1e-3, oy, ux, vx); at(ox, oy + 1e-3, uy, vy);
          const double a = (ux - u) / 1e-3, b = (uy - u) / 1e-3, c = (vx - v) / 1e-3, d = (vy - v) / 1e-3;
          const double det = a * d - b * c, ex = sx - u, ey = sy - v;
          ox += (d * ex - b * ey) / det; oy += (-c * ex + a * ey) / det;
        }
      };
      for (std::size_t i = 0; i < guides.size(); ++i) {
        double ax, ay, bx, by;
        forward(guides[i].x1 * W, guides[i].y1 * H, ax, ay);
        forward(guides[i].x2 * W, guides[i].y2 * H, bx, by);
        const double off = i < 2 ? std::atan2(std::abs(bx - ax), std::abs(by - ay)) : std::atan2(std::abs(by - ay), std::abs(bx - ax));
        check(off / degree < .1, "Guide " + std::to_string(i) + " becomes axis-aligned (" + fmt(off / degree) + " deg).");
      }
      // One vertical guide: roll only, and that guide ends up vertical.
      const auto one = solve_upright_guides({guides[0]}, W, H, focal);
      check(one.applied == UprightMode::guided && one.pitch == 0 && one.yaw == 0 && std::abs(one.roll) > .5, "One guide only rotates.");
      check(one.confidence > .9, "One guide is exactly satisfied.");
      check(solve_upright_guides({}, W, H, focal).applied == UprightMode::off, "No guides, no correction.");
      UprightGuide dot{.5, .5, .5005, .5};
      check(solve_upright_guides({dot}, W, H, focal).applied == UprightMode::off, "A click is not a guide.");
    }

    { // Radial distortion: barrel-distorted verticals solve accurately when k1 is known.
      const Camera camera{2, -12, 0};
      const double k1 = -.08; // barrel: the model's undistort pulls edges outward
      // Distorted pixel p_d shows the clean scene at p_u = p_d (1 + k1 r_d^2).
      Image distorted{W, H, W, H, std::vector<std::uint8_t>(std::size_t(W) * H * 4)};
      {
        const double f = upright_focal_from_35mm(35) * std::hypot(W, H), cx = W * .5, cy = H * .5, r2 = cx * cx + cy * cy;
        for (std::uint32_t y = 0; y < H; ++y)
          for (std::uint32_t x = 0; x < W; ++x) {
            double sum = 0;
            for (int sy = 0; sy < 3; ++sy)
              for (int sx = 0; sx < 3; ++sx) {
                const double dx = x + (sx + .5) / 3 - cx, dy = y + (sy + .5) / 3 - cy;
                const double g = 1 + k1 * (dx * dx + dy * dy) / r2;
                double rx, ry, rz;
                world_ray(camera, dx * g, dy * g, f, rx, ry, rz);
                sum += building(rx, ry, rz);
              }
            const auto i = (std::size_t(y) * W + x) * 4;
            distorted.rgba[i] = distorted.rgba[i + 1] = distorted.rgba[i + 2] = std::uint8_t(std::lround(sum / 9 * 255));
            distorted.rgba[i + 3] = 255;
          }
      }
      UprightRequest request;
      request.mode = UprightMode::vertical;
      request.focal = upright_focal_from_35mm(35);
      const auto naive = solve_upright(distorted, request);
      request.k1 = k1;
      const auto aware = solve_upright(distorted, request);
      std::cout << "lens k1   naive roll/pitch " << fmt(naive.roll) << "/" << fmt(naive.pitch) << " (" << int(naive.applied)
                << "), aware " << fmt(aware.roll) << "/" << fmt(aware.pitch) << " (truth 2/-12)\n";
      check(aware.applied == UprightMode::vertical, "Distortion-aware solve succeeds.");
      check(std::abs(aware.roll - camera.roll) < .3 && std::abs(aware.pitch - camera.pitch) < .8, "Distortion-aware angles accurate.");
      UprightTransform t;
      t.roll = aware.roll; t.pitch = aware.pitch; t.focal = aware.focal; t.k1 = k1;
      const double tilt = vertical_tilt(apply_upright(distorted, t));
      std::cout << "          distorted render median vertical tilt " << fmt(tilt) << " deg\n";
      check(tilt < .5, "Rendering with k1 straightens and uprights the verticals.");
    }

    { // Clutter: sensor noise and random strokes (branches, wires) around the facade.
      const Camera camera{-2.5, -13, 9};
      auto image = render(W, H, camera, building);
      std::uint64_t state = 99;
      const auto next = [&]() { state = state * 6364136223846793005ull + 1442695040888963407ull; return double(state >> 11) * 0x1.0p-53; };
      for (int stroke = 0; stroke < 60; ++stroke) {
        const double x0 = next() * W, y0 = next() * H, a = next() * pi, len = 40 + next() * 260;
        const auto tone = std::uint8_t(next() < .5 ? 20 : 235);
        for (double t = 0; t < len; t += .5)
          for (int wdt = -1; wdt <= 1; ++wdt) {
            const long x = std::lround(x0 + std::cos(a) * t - std::sin(a) * wdt), y = std::lround(y0 + std::sin(a) * t + std::cos(a) * wdt);
            if (x < 0 || y < 0 || x >= long(W) || y >= long(H)) continue;
            const auto i = (std::size_t(y) * W + std::size_t(x)) * 4;
            image.rgba[i] = image.rgba[i + 1] = image.rgba[i + 2] = tone;
          }
      }
      for (std::size_t i = 0; i < image.rgba.size(); i += 4) {
        const double n = (next() + next() + next() - 1.5) * 24; // ~8 codes std
        const auto v = std::uint8_t(std::clamp(image.rgba[i] + n, 0.0, 255.0));
        image.rgba[i] = image.rgba[i + 1] = image.rgba[i + 2] = v;
      }
      UprightRequest request;
      request.mode = UprightMode::full;
      request.focal = upright_focal_from_35mm(35);
      const auto s = solve_upright(image, request);
      std::cout << "clutter   truth " << camera.roll << "/" << camera.pitch << "/" << camera.yaw << " -> " << fmt(s.roll) << "/"
                << fmt(s.pitch) << "/" << fmt(s.yaw) << " conf " << fmt(s.confidence) << " segments " << s.segments << "\n";
      check(s.applied == UprightMode::full, "Full mode survives clutter.");
      check(std::abs(s.roll - camera.roll) < .4 && std::abs(s.pitch - camera.pitch) < .8 && std::abs(s.yaw - camera.yaw) < 1.5,
            "Clutter does not bias the angles.");
    }

    { // Constrain Crop fills the frame: no white corners remain.
      const auto image = render(W, H, Camera{3, -14, 0}, building);
      UprightTransform t;
      t.roll = 3; t.pitch = -14; t.focal = upright_focal_from_35mm(35);
      const auto open = apply_upright(image, t);
      t.constrain_crop = true;
      const auto cropped = apply_upright(image, t);
      const auto white_corners = [&](const Image& img) {
        int count = 0;
        for (auto [x, y] : {std::pair{1u, 1u}, std::pair{W - 2, 1u}, std::pair{W - 2, H - 2}, std::pair{1u, H - 2}}) {
          const auto i = (std::size_t(y) * W + x) * 4;
          count += img.rgba[i] == 255 && img.rgba[i + 1] == 255;
        }
        return count;
      };
      check(white_corners(open) >= 1, "An uncropped keystone correction exposes blank corners.");
      check(white_corners(cropped) == 0, "Constrain Crop leaves no blank corners.");
      // Manual sliders compose and stay finite.
      t.vertical = -40; t.horizontal = 25; t.rotate = -3; t.aspect = 30; t.scale = 120; t.x_offset = 10; t.y_offset = -10;
      const auto manual = apply_upright(image, t);
      check(manual.width == W && manual.height == H, "Manual transform keeps the frame size.");
    }

    { // Timing at the analysis sizes the browser uses (native, single thread).
      const Camera camera{2, -12, 10};
      for (std::uint32_t edge : {1024u, 1536u, 2048u}) {
        const std::uint32_t w = edge, h = edge * 2 / 3;
        const auto image = render(w, h, camera, building);
        UprightRequest request;
        request.mode = UprightMode::full;
        request.analysis_edge = edge;
        request.focal = upright_focal_from_35mm(35);
        double best = 1e9;
        UprightSolution s;
        for (int i = 0; i < 3; ++i) {
          const auto start = std::chrono::steady_clock::now();
          s = solve_upright(image, request);
          best = std::min(best, ms_since(start));
        }
        UprightTransform t;
        t.roll = s.roll; t.pitch = s.pitch; t.yaw = s.yaw; t.focal = s.focal;
        const auto start = std::chrono::steady_clock::now();
        apply_upright(image, t);
        std::cout << "timing    " << w << "x" << h << " solve " << fmt(best) << " ms, render " << fmt(ms_since(start))
                  << " ms, segments " << s.segments << ", yaw " << fmt(s.yaw) << "\n";
        check(std::abs(s.yaw - camera.yaw) < 1 && std::abs(s.pitch - camera.pitch) < .6, "Accurate at " + std::to_string(edge) + "px.");
      }
    }
    std::cout << "upright tests passed (" << checks << " checks)\n";
    return 0;
  } catch (const std::exception& failure) {
    std::cerr << "upright test failed after " << checks << " checks: " << failure.what() << "\n";
    return 1;
  }
}
