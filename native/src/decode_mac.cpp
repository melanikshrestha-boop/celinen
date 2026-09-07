#include "lenslabs/engine.hpp"

#include <CoreFoundation/CoreFoundation.h>
#include <CoreGraphics/CoreGraphics.h>
#include <ImageIO/ImageIO.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cerrno>
#include <cmath>
#include <cstring>
#include <fcntl.h>
#include <limits>
#include <stdexcept>
#include <sys/stat.h>
#include <unistd.h>
#include <utility>

namespace lenslabs {
namespace {

constexpr std::uint64_t max_source_bytes = 512ULL * 1024 * 1024;
constexpr std::uint64_t max_source_pixels = 250000000;
constexpr std::uint32_t max_preview_edge = 4096;

template <class T> class CFHandle {
 public:
  explicit CFHandle(T value = nullptr) noexcept : value_(value) {}
  ~CFHandle() { if (value_) CFRelease(value_); }
  CFHandle(const CFHandle&) = delete;
  CFHandle& operator=(const CFHandle&) = delete;
  CFHandle(CFHandle&& other) noexcept : value_(std::exchange(other.value_, nullptr)) {}
  T get() const noexcept { return value_; }
  explicit operator bool() const noexcept { return value_ != nullptr; }
 private:
  T value_;
};

class FileDescriptor {
 public:
  explicit FileDescriptor(int value) noexcept : value_(value) {}
  ~FileDescriptor() { if (value_ >= 0) close(value_); }
  FileDescriptor(const FileDescriptor&) = delete;
  FileDescriptor& operator=(const FileDescriptor&) = delete;
  int get() const noexcept { return value_; }
 private:
  int value_;
};

CFHandle<CFMutableDictionaryRef> dictionary() {
  CFHandle<CFMutableDictionaryRef> result(CFDictionaryCreateMutable(
      kCFAllocatorDefault, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks));
  if (!result) throw std::runtime_error("Could not allocate ImageIO options.");
  return result;
}

double numeric_property(CFDictionaryRef properties, CFStringRef key,
                        const char* label, double absent = 0) {
  const auto value = CFDictionaryGetValue(properties, key);
  if (!value) return absent;
  double number = 0;
  if (CFGetTypeID(value) != CFNumberGetTypeID() ||
      !CFNumberGetValue(static_cast<CFNumberRef>(value), kCFNumberDoubleType, &number) ||
      !std::isfinite(number) || std::floor(number) != number) {
    throw std::runtime_error(std::string("Invalid image metadata: ") + label + ".");
  }
  return number;
}

struct Input {
  int fd;
  off_t size;
  std::atomic<int> read_error{0};
};

// ImageIO reads the descriptor we validated, not a path it could reopen after a
// final-component symlink/file replacement. No callback reads beyond its size.
std::size_t read_at(void* opaque, void* buffer, off_t position, std::size_t count) noexcept {
  auto& input = *static_cast<Input*>(opaque);
  if (position < 0 || position >= input.size) return 0;
  count = std::min(count, static_cast<std::size_t>(input.size - position));
  auto* output = static_cast<std::uint8_t*>(buffer);
  std::size_t total = 0;
  while (total < count) {
    const auto read = pread(input.fd, output + total, count - total,
                            position + static_cast<off_t>(total));
    if (read < 0 && errno == EINTR) continue;
    if (read <= 0) {
      input.read_error.store(read < 0 ? errno : EIO, std::memory_order_relaxed);
      break;
    }
    total += static_cast<std::size_t>(read);
  }
  return total;
}

bool same_file_snapshot(const struct stat& before, const struct stat& after) noexcept {
  return before.st_dev == after.st_dev && before.st_ino == after.st_ino &&
         before.st_size == after.st_size &&
         before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec &&
         before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec &&
         before.st_ctimespec.tv_sec == after.st_ctimespec.tv_sec &&
         before.st_ctimespec.tv_nsec == after.st_ctimespec.tv_nsec;
}

std::size_t rgba_size(std::uint32_t width, std::uint32_t height) {
  if (!width || !height || width > max_preview_edge || height > max_preview_edge)
    throw std::invalid_argument("Preview dimensions must be between 1 and 4096 pixels per edge.");
  return static_cast<std::size_t>(width) * height * 4;
}

}  // namespace

Image decode_preview(const std::filesystem::path& path, std::uint32_t max_edge) {
  if (max_edge < 8 || max_edge > max_preview_edge)
    throw std::invalid_argument("Preview max_edge must be between 8 and 4096.");
  const auto& native_path = path.native();
  if (native_path.empty() || native_path.find('\0') != std::string::npos)
    throw std::invalid_argument("A nonempty image path without NUL bytes is required.");
  if (native_path.size() > static_cast<std::size_t>(std::numeric_limits<CFIndex>::max()))
    throw std::invalid_argument("Image path is too long.");
  CFHandle<CFURLRef> url(CFURLCreateFromFileSystemRepresentation(
      kCFAllocatorDefault, reinterpret_cast<const UInt8*>(native_path.data()),
      static_cast<CFIndex>(native_path.size()), false));
  std::array<UInt8, PATH_MAX> resolved{};
  if (!url || !CFURLGetFileSystemRepresentation(url.get(), true, resolved.data(), resolved.size()))
    throw std::invalid_argument("Could not represent the image filesystem path.");

  FileDescriptor fd(open(reinterpret_cast<const char*>(resolved.data()),
                         O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK));
  if (fd.get() < 0)
    throw std::runtime_error(std::string("Could not open image (symlinks are not accepted): ") +
                             std::strerror(errno));
  struct stat before{};
  if (fstat(fd.get(), &before) != 0 || !S_ISREG(before.st_mode))
    throw std::invalid_argument("Image input must be a regular file, not a directory or device.");
  if (before.st_size <= 0 || static_cast<std::uint64_t>(before.st_size) > max_source_bytes)
    throw std::invalid_argument("Image file must be nonempty and no larger than 512 MiB.");

  Input input{fd.get(), before.st_size};
  const CGDataProviderDirectCallbacks callbacks{0, nullptr, nullptr, read_at, nullptr};
  CFHandle<CGDataProviderRef> provider(CGDataProviderCreateDirect(&input, input.size, &callbacks));
  if (!provider) throw std::runtime_error("Could not create a bounded image data provider.");
  auto options = dictionary();
  CFDictionarySetValue(options.get(), kCGImageSourceShouldCache, kCFBooleanFalse);
  CFDictionarySetValue(options.get(), kCGImageSourceShouldAllowFloat, kCFBooleanFalse);
  CFHandle<CGImageSourceRef> source(CGImageSourceCreateWithDataProvider(provider.get(), options.get()));
  if (!source || !CGImageSourceGetType(source.get()) || CGImageSourceGetCount(source.get()) == 0)
    throw std::runtime_error("Unsupported or unreadable image format; no ImageIO preview is available.");
  const auto frame_index = CGImageSourceGetPrimaryImageIndex(source.get());
  if (frame_index >= CGImageSourceGetCount(source.get()))
    throw std::runtime_error("ImageIO did not identify a readable primary image.");
  CFHandle<CFDictionaryRef> properties(CGImageSourceCopyPropertiesAtIndex(source.get(), frame_index, options.get()));
  if (!properties) throw std::runtime_error("Image dimensions could not be read safely.");
  const double width = numeric_property(properties.get(), kCGImagePropertyPixelWidth, "width");
  const double height = numeric_property(properties.get(), kCGImagePropertyPixelHeight, "height");
  const double orientation = numeric_property(properties.get(), kCGImagePropertyOrientation, "orientation", 1);
  if (width < 1 || height < 1 || width > max_source_pixels || height > max_source_pixels ||
      width * height > static_cast<double>(max_source_pixels))
    throw std::invalid_argument("Source image exceeds the 250-million-pixel limit or has invalid dimensions.");
  if (orientation < 1 || orientation > 8)
    throw std::invalid_argument("Source image has an invalid EXIF orientation.");

  auto thumbnail_options = dictionary();
  const auto edge = static_cast<std::int32_t>(max_edge);
  CFHandle<CFNumberRef> edge_value(CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &edge));
  if (!edge_value) throw std::runtime_error("Could not allocate thumbnail size metadata.");
  CFDictionarySetValue(thumbnail_options.get(), kCGImageSourceThumbnailMaxPixelSize, edge_value.get());
  CFDictionarySetValue(thumbnail_options.get(), kCGImageSourceCreateThumbnailWithTransform, kCFBooleanTrue);
  CFDictionarySetValue(thumbnail_options.get(), kCGImageSourceCreateThumbnailFromImageAlways, kCFBooleanTrue);
  CFDictionarySetValue(thumbnail_options.get(), kCGImageSourceShouldCacheImmediately, kCFBooleanTrue);
  CFDictionarySetValue(thumbnail_options.get(), kCGImageSourceShouldAllowFloat, kCFBooleanFalse);
  CFHandle<CGImageRef> thumbnail(CGImageSourceCreateThumbnailAtIndex(source.get(), frame_index, thumbnail_options.get()));
  if (!thumbnail || input.read_error.load(std::memory_order_relaxed) != 0 ||
      CGImageSourceGetStatusAtIndex(source.get(), frame_index) != kCGImageStatusComplete)
    throw std::runtime_error("ImageIO could not decode a bounded preview. No full-size fallback was attempted.");
  const auto output_width = CGImageGetWidth(thumbnail.get());
  const auto output_height = CGImageGetHeight(thumbnail.get());
  if (!output_width || !output_height || output_width > max_edge || output_height > max_edge)
    throw std::runtime_error("ImageIO returned a thumbnail outside the requested size bound.");

  Image image;
  image.width = static_cast<std::uint32_t>(output_width);
  image.height = static_cast<std::uint32_t>(output_height);
  image.source_width = static_cast<std::uint32_t>(orientation >= 5 ? height : width);
  image.source_height = static_cast<std::uint32_t>(orientation >= 5 ? width : height);
  image.rgba.resize(rgba_size(image.width, image.height));
  CFHandle<CGColorSpaceRef> color_space(CGColorSpaceCreateWithName(kCGColorSpaceSRGB));
  if (!color_space) throw std::runtime_error("Could not create the sRGB output color space.");
  CFHandle<CGContextRef> context(CGBitmapContextCreate(
      image.rgba.data(), image.width, image.height, 8, static_cast<std::size_t>(image.width) * 4,
      color_space.get(), kCGBitmapByteOrder32Big | static_cast<CGBitmapInfo>(kCGImageAlphaPremultipliedLast)));
  if (!context) throw std::runtime_error("Could not allocate the bounded RGBA preview context.");
  const CGRect bounds = CGRectMake(0, 0, image.width, image.height);
  CGContextSetRGBFillColor(context.get(), 1, 1, 1, 1);
  CGContextFillRect(context.get(), bounds);
  CGContextSetBlendMode(context.get(), kCGBlendModeNormal);
  CGContextSetInterpolationQuality(context.get(), kCGInterpolationHigh);
  CGContextDrawImage(context.get(), bounds, thumbnail.get());
  CGContextFlush(context.get());
  // White compositing guarantees straight/opaque RGBA, not premultiplied color.
  for (std::size_t offset = 3; offset < image.rgba.size(); offset += 4)
    if (image.rgba[offset] != 255) throw std::runtime_error("Preview compositing did not produce opaque RGBA.");
  struct stat after{};
  if (input.read_error.load(std::memory_order_relaxed) != 0 || fstat(fd.get(), &after) != 0 ||
      !same_file_snapshot(before, after))
    throw std::runtime_error("Source changed or became unreadable while its preview was decoding; retry the original file.");
  return image;
}

std::vector<std::uint8_t> encode_jpeg(const Image& image, double quality) {
  if (!std::isfinite(quality) || quality < 0 || quality > 1)
    throw std::invalid_argument("JPEG quality must be finite and between 0 and 1.");
  const auto required = rgba_size(image.width, image.height);
  if (image.rgba.size() != required)
    throw std::invalid_argument("JPEG input must contain exactly width * height * 4 RGBA bytes.");
  auto opaque = image.rgba;
  for (std::size_t i = 0; i < opaque.size(); i += 4) {
    const auto alpha = static_cast<unsigned>(opaque[i + 3]);
    for (std::size_t channel = 0; channel < 3; ++channel)
      opaque[i + channel] = static_cast<std::uint8_t>(
          (static_cast<unsigned>(opaque[i + channel]) * alpha + 255U * (255U - alpha) + 127U) / 255U);
    opaque[i + 3] = 255;
  }
  CFHandle<CGColorSpaceRef> color_space(CGColorSpaceCreateWithName(kCGColorSpaceSRGB));
  CFHandle<CGDataProviderRef> provider(CGDataProviderCreateWithData(nullptr, opaque.data(), opaque.size(), nullptr));
  if (!color_space || !provider) throw std::runtime_error("Could not allocate JPEG color data.");
  CFHandle<CGImageRef> source(CGImageCreate(image.width, image.height, 8, 32,
      static_cast<std::size_t>(image.width) * 4, color_space.get(),
      kCGBitmapByteOrder32Big | static_cast<CGBitmapInfo>(kCGImageAlphaLast), provider.get(), nullptr, false, kCGRenderingIntentDefault));
  if (!source) throw std::runtime_error("Could not create the bounded JPEG source image.");
  CFHandle<CFMutableDataRef> data(CFDataCreateMutable(kCFAllocatorDefault, 0));
  if (!data) throw std::runtime_error("Could not allocate JPEG output memory.");
  CFHandle<CGImageDestinationRef> destination(CGImageDestinationCreateWithData(data.get(), CFSTR("public.jpeg"), 1, nullptr));
  if (!destination) throw std::runtime_error("The system JPEG encoder is unavailable.");
  const std::int32_t upright = 1;
  CFHandle<CFNumberRef> quality_value(CFNumberCreate(kCFAllocatorDefault, kCFNumberDoubleType, &quality));
  CFHandle<CFNumberRef> orientation_value(CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &upright));
  if (!quality_value || !orientation_value) throw std::runtime_error("Could not allocate JPEG encoding options.");
  auto properties = dictionary();
  CFDictionarySetValue(properties.get(), kCGImageDestinationLossyCompressionQuality, quality_value.get());
  CFDictionarySetValue(properties.get(), kCGImagePropertyOrientation, orientation_value.get());
  CGImageDestinationAddImage(destination.get(), source.get(), properties.get());
  if (!CGImageDestinationFinalize(destination.get())) throw std::runtime_error("JPEG encoding failed; no file was written.");
  const auto length = CFDataGetLength(data.get());
  if (length <= 0 || static_cast<std::uint64_t>(length) > 128ULL * 1024 * 1024)
    throw std::runtime_error("JPEG output is empty or exceeds the bounded output limit.");
  const auto* bytes = CFDataGetBytePtr(data.get());
  return {bytes, bytes + static_cast<std::size_t>(length)};
}

const char* decoder_name() noexcept {
  return "Apple ImageIO bounded preview (system-supported formats; not a full RAW processor)";
}

}  // namespace lenslabs
