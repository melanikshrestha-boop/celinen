// lenslabs-raw-decode: the RAW converter on the command line.
//
//   lenslabs-raw-decode probe   <file.ARW>
//   lenslabs-raw-decode preview <file.ARW> <out.jpg>     the embedded JPEG
//   lenslabs-raw-decode camera  <file.ARW> <out.cam>     white-balanced linear
//                                                        camera RGB, no profile
//   lenslabs-raw-decode decode  <file.ARW> <out.ppm> [options]
//   lenslabs-raw-decode bench   <file.ARW> [options]
//
// Options: --half --bilinear --no-recover --scene-referred --exposure <stops>
//          --temp <K> --tint <t> --band <rows> --shoulder <s>
//
// `camera` exists so the profile fitter can see the sensor's own colour before
// any camera profile is applied; it is the one mode that runs on a body this
// repository has no profile for.
#include "lenslabs/raw_decode.hpp"
#include <chrono>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

namespace {
using namespace lenslabs::raw;

std::vector<std::uint8_t> read_file(const std::string& path) {
  std::ifstream in(path, std::ios::binary | std::ios::ate);
  if (!in) throw std::runtime_error("Could not open " + path);
  const auto size = in.tellg();
  if (size <= 0) throw std::runtime_error(path + " is empty");
  std::vector<std::uint8_t> bytes(static_cast<std::size_t>(size), 0);
  in.seekg(0);
  in.read(reinterpret_cast<char*>(bytes.data()), size);
  if (!in) throw std::runtime_error("Could not read " + path);
  return bytes;
}

struct Options {
  DecodeRequest request;
  bool half = false;
};

Options parse(int argc, char** argv, int from) {
  Options o;
  for (int i = from; i < argc; ++i) {
    const std::string flag = argv[i];
    const auto next = [&]() -> double {
      if (i + 1 >= argc) throw std::runtime_error(flag + " needs a value");
      return std::stod(argv[++i]);
    };
    if (flag == "--half") o.half = true;
    else if (flag == "--bilinear") o.request.quality = Demosaic::bilinear;
    else if (flag == "--no-recover") o.request.highlight_recovery = false;
    else if (flag == "--scene-referred") o.request.baseline_tone = false;
    else if (flag == "--exposure") o.request.rendering.exposure = next();
    else if (flag == "--shoulder") o.request.rendering.shoulder = next();
    else if (flag == "--temp") o.request.temperature = next();
    else if (flag == "--tint") o.request.tint = next();
    else if (flag == "--band") o.request.band = std::uint32_t(next());
    else throw std::runtime_error("Unknown option " + flag);
  }
  if (o.half) o.request.quality = Demosaic::half;
  return o;
}

void print_metadata(const RawMetadata& meta) {
  std::printf("valid            %s%s%s\n", meta.valid ? "yes" : "no ", meta.valid ? "" : " — ",
              meta.valid ? "" : meta.reason.c_str());
  std::printf("camera           %s %s\n", meta.make.c_str(), meta.model.c_str());
  std::printf("orientation      %d\n", meta.orientation);
  std::printf("sensor raster    %u x %u\n", meta.raw_width, meta.raw_height);
  std::printf("active area      %u x %u at %u,%u\n", meta.active.width, meta.active.height,
              meta.active.x, meta.active.y);
  std::printf("picture area     %u x %u at %u,%u  (%.1f MP)\n", meta.crop.width, meta.crop.height,
              meta.crop.x, meta.crop.y, double(meta.active_pixels()) / 1e6);
  std::printf("packing          %s, %u bits, %s\n", packing_name(meta.packing),
              meta.bits_per_sample, meta.little_endian ? "little endian" : "big endian");
  std::printf("strips           %zu, first at %llu for %llu bytes\n", meta.strip_offsets.size(),
              meta.strip_offsets.empty() ? 0ull : (unsigned long long)meta.strip_offsets[0],
              meta.strip_counts.empty() ? 0ull : (unsigned long long)meta.strip_counts[0]);
  std::printf("cfa              %ux%u  ", meta.cfa.width, meta.cfa.height);
  for (std::uint32_t i = 0; i < meta.cfa.width * meta.cfa.height; ++i)
    std::printf("%c", meta.cfa.color[i] == Cfa::red ? 'R' : meta.cfa.color[i] == Cfa::blue ? 'B' : 'G');
  std::printf("\n");
  std::printf("black            %.1f %.1f %.1f %.1f\n", meta.black[0], meta.black[1], meta.black[2],
              meta.black[3]);
  std::printf("white            %.1f\n", meta.white);
  std::printf("as-shot neutral  %s %.5f %.5f %.5f\n", meta.as_shot_neutral_known ? "yes" : "no ",
              meta.as_shot_neutral[0], meta.as_shot_neutral[1], meta.as_shot_neutral[2]);
  std::printf("profile          %s (%s)\n", profile_source_name(meta.profile.source),
              meta.profile.description.empty() ? "none" : meta.profile.description.c_str());
  std::printf("baseline curve   %s\n", meta.profile.tone_curve.present
                                            ? "yes, from the camera profile"
                                            : "no — this render is scene-referred");
  std::printf("embedded jpeg    %llu bytes at %llu\n", (unsigned long long)meta.preview_length,
              (unsigned long long)meta.preview_offset);
  if (meta.valid && meta.profile.known && meta.as_shot_neutral_known) {
    const auto white = white_point_from_neutral(meta.profile, meta.as_shot_neutral);
    const auto reading = reading_from_chromaticity(white);
    std::printf("white balance    %.0f K, tint %+.1f  (xy %.4f %.4f)\n", reading.kelvin,
                reading.tint, white.x, white.y);
  }
}

void write_ppm(const std::string& path, std::uint32_t width, std::uint32_t height,
               const std::uint8_t* rgba) {
  std::ofstream out(path, std::ios::binary);
  if (!out) throw std::runtime_error("Could not write " + path);
  out << "P6\n" << width << " " << height << "\n255\n";
  std::vector<std::uint8_t> row(std::size_t(width) * 3);
  for (std::uint32_t y = 0; y < height; ++y) {
    for (std::uint32_t x = 0; x < width; ++x)
      for (int c = 0; c < 3; ++c) row[std::size_t(x) * 3 + std::size_t(c)] = rgba[(std::size_t(y) * width + x) * 4 + std::size_t(c)];
    out.write(reinterpret_cast<const char*>(row.data()), std::streamsize(row.size()));
  }
  if (!out) throw std::runtime_error("Could not finish writing " + path);
}

// White-balanced linear camera RGB, with no camera profile applied, at half
// size. The header is "LLCAM1", then two little-endian uint32 and float32 RGB.
int dump_camera(const std::vector<std::uint8_t>& bytes, const std::string& path) {
  const auto meta = read_raw_metadata(bytes.data(), bytes.size());
  if (!meta.valid) {
    std::cerr << meta.reason << "\n";
    return 2;
  }
  if (!meta.as_shot_neutral_known) {
    std::cerr << "This file records no as-shot white balance, so its camera RGB has no anchor.\n";
    return 2;
  }
  const auto mosaic = unpack_mosaic(bytes.data(), bytes.size(), meta);
  auto levels = normalise_levels(mosaic, meta);
  const auto gains = white_balance_gains(meta.as_shot_neutral);
  apply_white_balance(levels, meta.cfa, meta.crop.x, meta.crop.y, gains);
  const auto rgb = demosaic_mosaic(levels, meta.cfa, meta.crop.x, meta.crop.y, Demosaic::half);
  std::ofstream out(path, std::ios::binary);
  if (!out) throw std::runtime_error("Could not write " + path);
  out.write("LLCAM1", 6);
  const std::uint32_t header[3] = {rgb.width, rgb.height, std::uint32_t(meta.orientation)};
  out.write(reinterpret_cast<const char*>(header), sizeof(header));
  const double neutral[3] = {meta.as_shot_neutral[0], meta.as_shot_neutral[1], meta.as_shot_neutral[2]};
  out.write(reinterpret_cast<const char*>(neutral), sizeof(neutral));
  out.write(reinterpret_cast<const char*>(rgb.data.data()),
            std::streamsize(rgb.data.size() * sizeof(float)));
  if (!out) throw std::runtime_error("Could not finish writing " + path);
  std::printf("%u %u\n", rgb.width, rgb.height);
  return 0;
}

} // namespace

int main(int argc, char** argv) try {
  if (argc < 3) {
    std::cerr << "usage: lenslabs-raw-decode <probe|preview|camera|decode|bench> <file.ARW> [...]\n";
    return 1;
  }
  const std::string command = argv[1];
  const auto bytes = read_file(argv[2]);

  if (command == "probe") {
    print_metadata(read_raw_metadata(bytes.data(), bytes.size()));
    return 0;
  }
  if (command == "preview") {
    if (argc < 4) throw std::runtime_error("preview needs an output path");
    const auto meta = read_raw_metadata(bytes.data(), bytes.size());
    if (!meta.preview_length) {
      std::cerr << "This file names no embedded JPEG.\n";
      return 2;
    }
    std::ofstream out(argv[3], std::ios::binary);
    out.write(reinterpret_cast<const char*>(bytes.data() + meta.preview_offset),
              std::streamsize(meta.preview_length));
    if (!out) throw std::runtime_error("Could not write the preview");
    return 0;
  }
  if (command == "camera") {
    if (argc < 4) throw std::runtime_error("camera needs an output path");
    return dump_camera(bytes, argv[3]);
  }
  if (command == "decode" || command == "bench") {
    const int first_option = command == "decode" ? 4 : 3;
    if (command == "decode" && argc < 4) throw std::runtime_error("decode needs an output path");
    const auto options = parse(argc, argv, first_option);
    const auto clock = std::chrono::steady_clock::now;
    const auto started = clock();
    const auto meta = read_raw_metadata(bytes.data(), bytes.size());
    if (!meta.valid) {
      std::cerr << meta.reason << "\n";
      return 2;
    }
    Decoder decoder(bytes.data(), bytes.size(), meta, options.request);
    const auto prepared = clock();
    std::size_t peak = 0;
    int steps = 0;
    while (decoder.step()) {
      peak = std::max(peak, decoder.resident_bytes());
      ++steps;
    }
    peak = std::max(peak, decoder.resident_bytes());
    const auto finished = clock();
    const auto ms = [](auto a, auto b) {
      return std::chrono::duration<double, std::milli>(b - a).count();
    };
    std::printf("%s  %ux%u  prepare %.0f ms  bands %.0f ms (%d steps)  total %.0f ms  peak %.0f MB\n",
                argv[2], decoder.width(), decoder.height(), ms(started, prepared),
                ms(prepared, finished), steps + 1, ms(started, finished), double(peak) / 1e6);
    const auto& wb = decoder.white_balance();
    std::printf("white balance %.0f K tint %+.1f (%s)\n", wb.kelvin, wb.tint,
                wb.known ? "from the file" : "assumed");
    if (command == "decode") write_ppm(argv[3], decoder.width(), decoder.height(), decoder.pixels());
    return 0;
  }
  std::cerr << "Unknown command " << command << "\n";
  return 1;
} catch (const std::exception& failure) {
  std::cerr << failure.what() << "\n";
  return 2;
}
