#pragma once

#include "lenslabs/engine.hpp"
#include <CoreFoundation/CoreFoundation.h>
#include <ImageIO/ImageIO.h>
#include <array>
#include <chrono>

// Shared parser: called on properties of the held source descriptor.
namespace lenslabs::capture_detail {
inline std::string text_property(CFDictionaryRef dictionary, CFStringRef key) {
  if (!dictionary) return {};
  const auto value = CFDictionaryGetValue(dictionary, key);
  if (!value || CFGetTypeID(value) != CFStringGetTypeID()) return {};
  const auto text = static_cast<CFStringRef>(value);
  if (CFStringGetLength(text) > 256) return {};
  std::array<char, 1025> bytes{};
  if (!CFStringGetCString(text, bytes.data(), bytes.size(), kCFStringEncodingUTF8)) return {};
  std::string result(bytes.data());
  while (!result.empty() && result.back() == ' ') result.pop_back();
  const auto first = result.find_first_not_of(' ');
  return first == std::string::npos ? std::string{} : result.substr(first);
}

inline CFDictionaryRef dictionary_property(CFDictionaryRef dictionary, CFStringRef key) {
  if (!dictionary) return nullptr;
  const auto value = CFDictionaryGetValue(dictionary, key);
  return value && CFGetTypeID(value) == CFDictionaryGetTypeID()
    ? static_cast<CFDictionaryRef>(value) : nullptr;
}

inline int digits(const std::string& text, std::size_t offset, std::size_t count) {
  if (offset + count > text.size()) return -1;
  int result = 0;
  for (std::size_t i = offset; i < offset + count; ++i) {
    if (text[i] < '0' || text[i] > '9') return -1;
    result = result * 10 + text[i] - '0';
  }
  return result;
}

inline void parse_capture_time(CaptureMetadata& metadata, const std::string& date,
                        const std::string& subsecond, const std::string& offset) {
  if (date.size() != 19 || date[4] != ':' || date[7] != ':' || date[10] != ' ' ||
      date[13] != ':' || date[16] != ':') return;
  const auto year = digits(date, 0, 4), month = digits(date, 5, 2), day = digits(date, 8, 2);
  const auto hour = digits(date, 11, 2), minute = digits(date, 14, 2), second = digits(date, 17, 2);
  const std::chrono::year_month_day calendar{
    std::chrono::year(year), std::chrono::month(static_cast<unsigned>(month)), std::chrono::day(static_cast<unsigned>(day))};
  if (year < 1900 || year > 9999 || !calendar.ok() || hour < 0 || hour > 23 ||
      minute < 0 || minute > 59 || second < 0 || second > 59) return;
  int milliseconds = 0;
  if (!subsecond.empty()) {
    if (subsecond.size() > 9 || digits(subsecond, 0, subsecond.size()) < 0) return;
    for (std::size_t n = 0; n < 3; ++n)
      milliseconds = milliseconds * 10 + (n < subsecond.size() ? subsecond[n] - '0' : 0);
  }
  auto time = std::chrono::sys_days(calendar) + std::chrono::hours(hour) +
    std::chrono::minutes(minute) + std::chrono::seconds(second) + std::chrono::milliseconds(milliseconds);
  metadata.basis = "camera_clock";
  if (!offset.empty()) {
    const auto hours = digits(offset, 1, 2), minutes = digits(offset, 4, 2);
    if (offset.size() != 6 || (offset[0] != '+' && offset[0] != '-') || offset[3] != ':' ||
        hours < 0 || hours > 14 || minutes < 0 || minutes > 59 || (hours == 14 && minutes != 0)) return;
    const auto sign = offset[0] == '-' ? -1 : 1;
    time -= std::chrono::minutes(sign * (hours * 60 + minutes));
    metadata.basis = "utc";
  }
  const auto captured_at_ms = std::chrono::duration_cast<std::chrono::milliseconds>(time.time_since_epoch()).count();
  // The burst contract reserves nonpositive values for "unknown". An old or
  // misconfigured camera clock must not make an otherwise valid photo fail.
  if (captured_at_ms <= 0) { metadata.basis.clear(); return; }
  metadata.captured_at_ms = captured_at_ms;
}

inline CaptureMetadata from_properties(CFDictionaryRef properties) {
  CaptureMetadata result;
  const auto exif = dictionary_property(properties, kCGImagePropertyExifDictionary);
  const auto tiff = dictionary_property(properties, kCGImagePropertyTIFFDictionary);
  parse_capture_time(result, text_property(exif, kCGImagePropertyExifDateTimeOriginal),
    text_property(exif, kCGImagePropertyExifSubsecTimeOriginal), text_property(exif, CFSTR("OffsetTimeOriginal")));
  const auto make = text_property(tiff, kCGImagePropertyTIFFMake);
  const auto model = text_property(tiff, kCGImagePropertyTIFFModel);
  const auto serial = text_property(exif, kCGImagePropertyExifBodySerialNumber);
  // Length-prefixed components prevent ambiguous camera-key concatenations.
  result.camera_model = make + (make.empty() || model.empty() ? "" : " ") + model;
  if (!serial.empty()) {
    result.camera_key = std::to_string(make.size()) + ":" + make + std::to_string(model.size()) + ":" + model +
      std::to_string(serial.size()) + ":" + serial;
    // Match the transport's UTF-8 byte bound. Do not truncate an identity:
    // truncation could merge two different cameras into the same burst group.
    if (result.camera_key.size() > 512) result.camera_key.clear();
    else result.camera_key_basis = "make_model_serial";
  }
  return result;
}
} // namespace lenslabs::capture_detail
