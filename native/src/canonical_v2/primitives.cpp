#include "lenslabs/canonical_v2.hpp"
#include <algorithm>
#include <array>
#include <limits>
#include <utility>

namespace lenslabs::canonical_v2 {
Error::Error(ErrorCode c, std::string s, std::string d)
    : std::runtime_error(std::move(d)), code(c), stage(std::move(s)) {}
const char* code_name(ErrorCode c) noexcept {
  switch (c) {
    case ErrorCode::disabled: return "DISABLED";
    case ErrorCode::cancelled: return "CANCELLED";
    case ErrorCode::invalid_source: return "INVALID_SOURCE";
    case ErrorCode::source_changed: return "SOURCE_CHANGED";
    case ErrorCode::limit_exceeded: return "LIMIT_EXCEEDED";
    case ErrorCode::resource_exhausted: return "RESOURCE_EXHAUSTED";
    case ErrorCode::invalid_geometry: return "UNSUPPORTED_GEOMETRY";
    case ErrorCode::invalid_orientation: return "INVALID_ORIENTATION";
    case ErrorCode::dependency_gate_blocked: return "DEPENDENCY_GATE_BLOCKED";
    case ErrorCode::unsupported_domain: return "UNSUPPORTED_DOMAIN";
    case ErrorCode::unsupported_source: return "UNSUPPORTED_SOURCE";
    case ErrorCode::invalid_jpeg: return "INVALID_JPEG";
    case ErrorCode::invalid_icc: return "INVALID_ICC_PROFILE";
    case ErrorCode::unsupported_icc: return "UNSUPPORTED_ICC_PROFILE";
    case ErrorCode::profile_required: return "PROFILE_REQUIRED";
    case ErrorCode::invalid_raw_preview: return "INVALID_RAW_PREVIEW";
  }
  return "UNKNOWN_ERROR";
}
void Control::check(const char* stage) const {
  if (cancelled_.load()) throw Error(ErrorCode::cancelled, stage, "Experimental job cancelled");
  if (!enabled_.load()) throw Error(ErrorCode::disabled, stage, "Experimental admission disabled");
}
namespace {
std::uint64_t pixel_count(std::uint32_t w, std::uint32_t h) {
  if (!w || !h) throw Error(ErrorCode::invalid_geometry, "geometry", "Zero dimension");
  const auto n = std::uint64_t(w) * h;
  if (w > max_dimension || h > max_dimension || n > max_pixels)
    throw Error(ErrorCode::limit_exceeded, "geometry", "Raster limit exceeded");
  return n;
}
Rgba allocate(std::uint32_t w, std::uint32_t h) {
  const auto n = pixel_count(w, h);
  try { return {w, h, std::vector<std::uint8_t>(static_cast<std::size_t>(n * 4))}; }
  catch (const std::bad_alloc&) {
    throw Error(ErrorCode::resource_exhausted, "pixels", "Pixel allocation failed");
  }
}
} // namespace
Geometry target_geometry(std::uint32_t w, std::uint32_t h) {
  pixel_count(w, h);
  const std::uint64_t m = std::max(w, h);
  if (m > 256) {
    w = static_cast<std::uint32_t>(std::max<std::uint64_t>(1, (2ULL*w*256+m)/(2*m)));
    h = static_cast<std::uint32_t>(std::max<std::uint64_t>(1, (2ULL*h*256+m)/(2*m)));
  }
  if (w < 3 || h < 3)
    throw Error(ErrorCode::invalid_geometry, "geometry", "Canonical edge below analysis minimum");
  return {w,h};
}
void validate_rgba(const Rgba& a) {
  if (pixel_count(a.width, a.height) * 4 != a.bytes.size())
    throw Error(ErrorCode::invalid_geometry, "pixels", "Packed RGBA size mismatch");
  for (std::size_t i=3; i<a.bytes.size(); i+=4)
    if (a.bytes[i] != 255)
      throw Error(ErrorCode::invalid_source, "pixels", "Expected opaque RGBA8");
}
Rgba resize(const Rgba& a, const Control& control) {
  control.check("resize");
  validate_rgba(a);
  const auto [w,h] = target_geometry(a.width, a.height);
  auto b = allocate(w,h);
  const std::uint64_t W=a.width, H=a.height, denominator=W*H;
  for (std::uint64_t y=0; y<h; ++y) {
    control.check("resize");
    for (std::uint64_t x=0; x<w; ++x) {
      std::array<std::uint64_t,4> sum{};
      for (auto sy=y*H/h; sy<((y+1)*H+h-1)/h; ++sy) {
        const auto wy=std::min((sy+1)*h,(y+1)*H)-std::max(sy*h,y*H);
        for (auto sx=x*W/w; sx<((x+1)*W+w-1)/w; ++sx) {
          const auto wx=std::min((sx+1)*w,(x+1)*W)-std::max(sx*w,x*W);
          for (unsigned c=0;c<4;++c) sum[c]+=a.bytes[(sy*W+sx)*4+c]*wx*wy;
        }
      }
      for (unsigned c=0;c<4;++c)
        b.bytes[(y*w+x)*4+c]=static_cast<std::uint8_t>((sum[c]+denominator/2)/denominator);
    }
  }
  // Bounds above prove sum <= 255*max_pixels and coordinate products fit uint64.
  control.check("resize");
  return b;
}
Rgba orient(const Rgba& a, unsigned exif, const Control& control) {
  control.check("orientation");
  validate_rgba(a);
  if (exif<1 || exif>8)
    throw Error(ErrorCode::invalid_orientation, "orientation", "EXIF must be 1 through 8");
  auto b=allocate(exif>=5?a.height:a.width, exif>=5?a.width:a.height);
  for (std::uint32_t y=0;y<b.height;++y) {
    control.check("orientation");
    for (std::uint32_t x=0;x<b.width;++x) {
      std::uint32_t sx=x,sy=y;
      switch (exif) {
        case 2: sx=a.width-1-x; break;
        case 3: sx=a.width-1-x; sy=a.height-1-y; break;
        case 4: sy=a.height-1-y; break;
        case 5: sx=y; sy=x; break;
        case 6: sx=y; sy=a.height-1-x; break;
        case 7: sx=a.width-1-y; sy=a.height-1-x; break;
        case 8: sx=a.width-1-y; sy=x; break;
        default: break;
      }
      std::copy_n(a.bytes.data()+4*(std::size_t(sy)*a.width+sx),4,
                  b.bytes.data()+4*(std::size_t(y)*b.width+x));
    }
  }
  control.check("orientation");
  return b;
}
std::string tensor_hash(const Rgba& a) {
  validate_rgba(a);
  const auto g=target_geometry(a.width,a.height);
  if (g.width!=a.width || g.height!=a.height)
    throw Error(ErrorCode::invalid_geometry,"seal","Not a canonical-sized tensor");
  std::vector<std::uint8_t> bytes(domain, domain+std::char_traits<char>::length(domain));
  bytes.push_back(0);
  for (auto n : {a.width,a.height})
    for (unsigned shift=0;shift<32;shift+=8) bytes.push_back(static_cast<std::uint8_t>(n>>shift));
  bytes.insert(bytes.end(),a.bytes.begin(),a.bytes.end());
  return sha256(bytes);
}
} // namespace lenslabs::canonical_v2
