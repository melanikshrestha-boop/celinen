// Cull intelligence: the validity gate, shoot membership, subject focus,
// scoring heads and burst roles. Every fixture is procedural (cull_fixtures.hpp).
#include "cull_fixtures.hpp"
#include "lenslabs/cull.hpp"
#include "lenslabs/cull_heads.hpp"
#include "lenslabs/cull_sequence.hpp"
#include "lenslabs/cull_shoot_membership.hpp"
#include "lenslabs/cull_subject.hpp"
#include "lenslabs/cull_validity.hpp"
#include "lenslabs/exif.hpp"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <iostream>
#include <map>
#include <random>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
using namespace lenslabs;
int checks = 0;
void check(bool passed, const std::string& label) {
  ++checks;
  if (!passed) throw std::runtime_error(label);
}

// ---------------------------------------------------------------- validity --

struct Case {
  const char* name;
  Image image;
  // Accepted outcomes: a frame that must be caught may land on invalid, or on
  // suspect when `suspect_ok`; a photograph must be valid.
  bool photo;
  std::vector<CullValidityKind> kinds;
  bool suspect_ok = false;
  CullDecodeHints hints = {};
};

void validity_tests() {
  using fixtures::canvas;
  using K = CullValidityKind;
  std::vector<Case> cases;
  // Photographs, including the hard ones: blurred, dark, bright, clean studio.
  cases.push_back({"natural 1/f with grain", fixtures::natural(), true, {}});
  cases.push_back({"natural, second scene", fixtures::natural(640, 427, 99, 2.0, 140, 50), true, {}});
  cases.push_back({"natural, almost no grain", fixtures::natural(640, 427, 5, .3), true, {}});
  cases.push_back({"natural, out of focus", fixtures::box_blur(fixtures::natural(640, 427, 8), 3), true, {}});
  cases.push_back({"natural, underexposed", fixtures::natural(640, 427, 12, 1.5, 35, 20), true, {}});
  cases.push_back({"natural, high key", fixtures::natural(640, 427, 13, 1.0, 215, 25), true, {}});
  cases.push_back({"natural, steep spectrum", fixtures::natural(640, 427, 14, 1.2, 120, 40, 2.6), true, {}});
  cases.push_back({"natural, shallow spectrum", fixtures::natural(640, 427, 15, 1.2, 120, 40, 1.6), true, {}});
  cases.push_back({"studio portrait", fixtures::portrait(), true, {}});
  cases.push_back({"studio portrait, clean", fixtures::portrait(427, 640, 12, .4), true, {}});
  cases.push_back({"natural, small working size", fixtures::natural(320, 213, 16), true, {}});
  // Not photographs.
  cases.push_back({"colour static", fixtures::static_noise(), false, {K::noise}});
  cases.push_back({"gray static", fixtures::static_noise(640, 427, 5, false), false, {K::noise}});
  cases.push_back({"gaussian static", fixtures::gaussian_static(), false, {K::noise}});
  cases.push_back({"flat gray", canvas(640, 427, 128, 128, 128), false, {K::flat}});
  cases.push_back({"black", canvas(640, 427, 0, 0, 0), false, {K::black}});
  cases.push_back({"white", canvas(640, 427, 255, 255, 255), false, {K::white}});
  cases.push_back({"lens cap", fixtures::lens_cap(), false, {K::misfire, K::black}});
  cases.push_back({"stripes", fixtures::stripes(), false, {K::test_pattern}});
  cases.push_back({"colour bars", fixtures::color_bars(), false, {K::test_pattern}});
  cases.push_back({"checkerboard", fixtures::checkerboard(), false, {K::test_pattern}});
  cases.push_back({"truncated, gray fill", fixtures::truncated_gray(), false, {K::corrupted}});
  cases.push_back({"truncated, smeared rows", fixtures::truncated_smear(), false, {K::corrupted}});
  cases.push_back({"blocky bands", fixtures::blocky_bands(), false, {K::corrupted}, true});
  {
    Case c{"blocky bands, decoder warned", fixtures::blocky_bands(), false, {K::corrupted}};
    c.hints.decoder_warnings = 3;
    cases.push_back(c);
  }
  {
    Case c{"truncated, small gray fill, decoder saw EOF", fixtures::truncated_gray(.93), false, {K::corrupted}};
    c.hints.truncated = true;
    c.hints.decoder_warnings = 1;
    cases.push_back(c);
  }
  cases.push_back({"manga page", fixtures::manga(), false, {K::illustration, K::document}});
  cases.push_back({"manga page, second", fixtures::manga(452, 640, 77), false, {K::illustration, K::document}});
  cases.push_back({"anime still", fixtures::anime(), false, {K::illustration}});
  cases.push_back({"anime still, second", fixtures::anime(640, 360, 88), false, {K::illustration, K::screenshot}});
  cases.push_back({"app screenshot", fixtures::screenshot(), false, {K::screenshot, K::document}});
  cases.push_back({"document", fixtures::document(), false, {K::document, K::screenshot}});
  cases.push_back({"blown out", [] {
                     auto image = canvas(640, 427, 255, 255, 255);
                     for (unsigned y = 180; y < 200; ++y)
                       for (unsigned x = 300; x < 330; ++x) fixtures::set(image, int(x), int(y), 230, 228, 225);
                     return image;
                   }(),
                   false, {K::extreme_exposure, K::white, K::flat}});

  // The confusion summary: printed every run so threshold drift is visible.
  std::map<std::string, int> tally;
  for (const auto& c : cases) {
    const auto v = assess_cull_validity(c.image, c.hints);
    const std::string outcome = std::string(cull_validity_state_name(v.state)) + "/" + cull_validity_kind_name(v.kind);
    std::printf("  validity  %-44s %-24s %.2f  %s\n", c.name, outcome.c_str(), v.confidence, v.reason);
    if (c.photo) {
      ++tally[v.state == CullValidityState::valid ? "photo->valid" : "photo->FLAGGED"];
      check(v.state == CullValidityState::valid, std::string("photograph flagged: ") + c.name + " as " + outcome);
      check(std::string(v.reason).empty(), std::string("a valid frame has no reason: ") + c.name);
    } else {
      const bool caught = v.state == CullValidityState::invalid || (c.suspect_ok && v.state == CullValidityState::suspect);
      ++tally[caught ? "junk->caught" : "junk->MISSED"];
      check(caught, std::string("non-photograph not caught: ") + c.name + " as " + outcome);
      check(std::find(c.kinds.begin(), c.kinds.end(), v.kind) != c.kinds.end(),
            std::string("wrong kind for ") + c.name + ": " + cull_validity_kind_name(v.kind));
      check(v.confidence >= .5 && v.confidence <= 1, std::string("confidence out of range: ") + c.name);
      check(!std::string(v.reason).empty(), std::string("a flagged frame explains itself: ") + c.name);
    }
  }
  std::printf("  validity confusion:");
  for (const auto& [k, n] : tally) std::printf(" %s=%d", k.c_str(), n);
  std::printf("\n");

  // Plain-English reasons are the ones the photographer sees.
  check(std::string(assess_cull_validity(fixtures::manga()).reason) == "Illustration, not a photograph",
        "illustration reason");
  check(std::string(assess_cull_validity(fixtures::static_noise()).reason) == "No photographic structure",
        "noise reason");
  check(std::string(assess_cull_validity(fixtures::truncated_gray()).reason) == "Corrupted file", "corrupt reason");

  // Borderline → suspect, never invalid: lower the invalid bar out of reach and
  // the same frame comes back as a maybe.
  {
    CullValidityOptions cautious;
    cautious.invalid_at = 1.0;
    const auto v = assess_cull_validity(fixtures::anime(), {}, cautious);
    check(v.state == CullValidityState::suspect, "below the invalid bar is suspect");
    check(std::string(v.reason) == "May be an illustration", "suspect reason is hedged");
  }
  // A lone decoder warning (some cameras write harmless extra bytes) never
  // flags a real photograph.
  {
    CullDecodeHints warned;
    warned.decoder_warnings = 2;
    check(assess_cull_validity(fixtures::natural(), warned).state == CullValidityState::valid,
          "a harmless decoder warning alone is not corruption");
  }
  // The gate measures at a fixed working size: a larger decode of the same
  // photograph is still a photograph.
  {
    const auto big = fixtures::natural(1000, 667, 31);
    check(assess_cull_validity(big).state == CullValidityState::valid, "large working image stays valid");
  }
  bool threw = false;
  try {
    assess_cull_validity(canvas(20, 20));
  } catch (const std::invalid_argument&) {
    threw = true;
  }
  check(threw, "tiny image rejected");

  // The gate in front of the scorer: an invalid frame is never measured.
  {
    const auto junk = measure_cull_gated(fixtures::manga());
    check(!junk.measured && junk.reading.quality == 0 && junk.reading.acuity_subject == 0,
          "an invalid frame never reaches the sharpness scorer");
    const auto photo = measure_cull_gated(fixtures::natural());
    check(photo.measured && photo.reading.quality > 0, "a photograph is measured");
  }

  // The gated shoot pass: the manga page that scored "Sharp and well exposed"
  // is withheld, rejected with its validity reason, and does not move the
  // shoot's calibration.
  {
    std::vector<CullFrameInput> frames;
    std::vector<CullValidity> validity;
    for (int i = 0; i < 6; ++i) {
      const auto image = fixtures::natural(640, 427, 100 + std::uint32_t(i));
      CullFrameInput f;
      f.id = "p" + std::to_string(i);
      f.reading = measure_cull(image);
      f.capture_time_ms = 1000.0 * 60 * i;
      frames.push_back(f);
      validity.push_back(assess_cull_validity(image));
    }
    const auto page = fixtures::manga();
    CullFrameInput junk;
    junk.id = "manga";
    junk.reading = measure_cull(page); // what the ungated engine would have used
    junk.capture_time_ms = 1000.0 * 60 * 7;
    frames.push_back(junk);
    validity.push_back(assess_cull_validity(page));
    const auto ungated = cull_shoot(frames);
    const auto gated = cull_shoot_gated(frames, validity);
    check(gated.back().row.verdict == CullVerdict::reject, "invalid frame suggested as reject");
    check(gated.back().row.score == 0 && gated.back().row.group == -1, "invalid frame has no score or group");
    check(std::string(gated.back().validity_reason) == "Illustration, not a photograph", "gated reason");
    for (std::size_t i = 0; i + 1 < frames.size(); ++i)
      check(gated[i].validity == CullValidityState::valid, "photographs pass the gated pass");
    (void)ungated;
    // The photographer's own keep is never overruled.
    frames.back().verdict = 1;
    check(cull_shoot_gated(frames, validity).back().row.verdict == CullVerdict::undecided,
          "photographer decision on an invalid frame is left alone");
    bool mismatch = false;
    try {
      cull_shoot_gated(frames, {});
    } catch (const std::invalid_argument&) {
      mismatch = true;
    }
    check(mismatch, "validity must cover every frame");
  }
}

// -------------------------------------------------------------- membership --

CullMembershipInput shot(const std::string& body, double time_ms, std::uint32_t w, std::uint32_t h,
                         const std::string& name, std::uint8_t tint = 120) {
  CullMembershipInput f;
  if (!body.empty()) {
    f.has_exif = true;
    const auto bar = body.find('|');
    f.make = body.substr(0, bar);
    f.model = body.substr(bar + 1);
    f.serial = "1234";
  }
  f.capture_time_ms = time_ms;
  f.width = w;
  f.height = h;
  f.file_name = name;
  f.has_look = true;
  for (std::size_t i = 0; i < f.color.size(); ++i) f.color[i] = std::uint8_t(tint + (i % 3) * 10 + (i / 3) % 4);
  f.hash = 0x0f0f0f0f0f0f0f0full;
  return f;
}

std::string dsc(int n) {
  char buffer[32];
  std::snprintf(buffer, sizeof buffer, "_DSC%04d.JPG", n);
  return buffer;
}

void membership_tests() {
  const double start = 1.78e12; // a Saturday in 2026
  const double second = 1000;

  // Pure helpers.
  check(cull_name_pattern("_DSC1234.JPG") == "_dsc#4", "name pattern");
  check(cull_name_pattern("IMG_20240501_101112.jpg") == "img_#8_#6", "phone name pattern");
  check(cull_describe_duration(3.1 * 365.25 * 24 * 3600 * 1000) == "3 years", "years");
  check(cull_describe_duration(1 * 24 * 3600 * 1000.0) == "1 day", "one day");
  check(cull_describe_duration(5 * 3600 * 1000.0) == "5 hours", "hours");

  // 1. One camera, one afternoon: nobody is flagged.
  {
    std::vector<CullMembershipInput> frames;
    for (int i = 0; i < 200; ++i)
      frames.push_back(shot("sony|ilce-7rm5", start + i * 9 * second, 9504, 6336, dsc(1000 + i)));
    const auto result = assess_shoot_membership(frames);
    for (const auto& r : result) check(r.state == CullMembershipState::member, "single camera shoot is all members");
  }

  // 2. Two bodies (different sizes and naming) plus phone B-roll inside the
  //    span: still one shoot.
  {
    std::vector<CullMembershipInput> frames;
    for (int i = 0; i < 150; ++i)
      frames.push_back(shot("sony|ilce-1", start + i * 12 * second, 8640, 5760, dsc(2000 + i)));
    for (int i = 0; i < 60; ++i) {
      char name[32];
      std::snprintf(name, sizeof name, "DSC_%04d.JPG", 400 + i);
      frames.push_back(shot("nikon corporation|nikon z 9", start + 30 * second + i * 29 * second, 8256, 5504, name, 125));
    }
    for (int i = 0; i < 8; ++i) {
      char name[32];
      std::snprintf(name, sizeof name, "IMG_%04d.HEIC.jpg", 7000 + i);
      frames.push_back(shot("apple|iphone 15 pro", start + 200 * second + i * 190 * second, 4032, 3024, name, 118));
    }
    // One odd phone frame of its own, still inside the afternoon.
    frames.push_back(shot("google|pixel 8", start + 900 * second, 4080, 3072, "PXL_20260917_101500123.jpg", 122));
    const auto result = assess_shoot_membership(frames);
    int flagged = 0;
    for (const auto& r : result) flagged += r.state != CullMembershipState::member;
    check(flagged == 0, "multi-camera shoot flags nobody, flagged " + std::to_string(flagged));
  }

  // 3. The founder's case: a Sony portrait shoot with a manga screenshot, an
  //    anime still and Google images dropped in.
  {
    std::vector<CullMembershipInput> frames;
    for (int i = 0; i < 120; ++i)
      frames.push_back(shot("sony|ilce-7m4", start + i * 20 * second, 7008, 4672, dsc(3000 + i), 140));
    const std::size_t first_junk = frames.size();
    auto manga = shot("", -1, 1170, 2532, "manga_chapter_12.jpg", 240);
    manga.hash = 0xf0f0f0f0f0f0f0f0ull;
    for (auto& c : manga.color) c = 250;
    frames.push_back(manga);
    auto anime = shot("", -1, 1920, 1080, "anime-still.jpg", 60);
    anime.hash = 0x123456789abcdef0ull;
    frames.push_back(anime);
    frames.push_back(shot("", -1, 736, 1104, "images (3).jpeg", 200));
    frames.push_back(shot("", -1, 1200, 800, "8f3a9c0e1b2d4f5a6e7c8b9a0d1e2f3a.jpg", 30));
    const auto result = assess_shoot_membership(frames);
    for (std::size_t i = 0; i < first_junk; ++i)
      check(result[i].state == CullMembershipState::member, "real portrait frames stay members");
    for (std::size_t i = first_junk; i < frames.size(); ++i) {
      std::printf("  membership  %-40s %-9s %.2f  %s\n", frames[i].file_name.c_str(),
                  cull_membership_state_name(result[i].state), result[i].confidence, result[i].reason.c_str());
      check(result[i].state == CullMembershipState::outsider, "dropped-in download is an outsider: " + frames[i].file_name);
      check(result[i].reason.find("No camera data") == 0, "strongest reason first: " + result[i].reason);
      check(result[i].evidence & membership_no_camera_data, "no camera data bit");
    }
    check(result[first_junk + 2].evidence & membership_download_size, "download size bit");
  }

  // 4. A frame from the same camera three years earlier, left on the card.
  {
    std::vector<CullMembershipInput> frames;
    for (int i = 0; i < 80; ++i)
      frames.push_back(shot("sony|ilce-7m4", start + i * 20 * second, 7008, 4672, dsc(100 + i)));
    frames.push_back(shot("sony|ilce-7m4", start - 3 * 365.25 * 24 * 3600 * 1000, 7008, 4672, dsc(9001)));
    const auto result = assess_shoot_membership(frames);
    const auto& old = result.back();
    std::printf("  membership  %-40s %-9s %.2f  %s\n", "old frame, same camera", cull_membership_state_name(old.state),
                old.confidence, old.reason.c_str());
    check(old.state == CullMembershipState::suspect, "one strong evidence family is at most a suspect");
    check(old.reason == "Taken 3 years before this shoot", "time reason: " + old.reason);
    check(old.time_offset_ms < 0, "offset is before");
  }

  // 5. A second body whose clock was never set: its own frames agree with each
  //    other, so it is a clock, not a different year.
  {
    std::vector<CullMembershipInput> frames;
    for (int i = 0; i < 100; ++i)
      frames.push_back(shot("canon|eos r5", start + i * 20 * second, 8192, 5464, "IMG_" + std::to_string(1000 + i) + ".JPG"));
    for (int i = 0; i < 12; ++i)
      frames.push_back(shot("canon|eos r6", 1.0e12 + i * 20 * second, 5472, 3648, "IMG_" + std::to_string(5000 + i) + ".JPG"));
    const auto result = assess_shoot_membership(frames);
    for (const auto& r : result) check(r.state == CullMembershipState::member, "offset clock body stays in the shoot");
  }

  // 6. A shoot that was exported without metadata: missing EXIF is normal here.
  {
    std::vector<CullMembershipInput> frames;
    for (int i = 0; i < 40; ++i) frames.push_back(shot("", -1, 2048, 1365, "export-" + std::to_string(i) + ".jpg"));
    const auto result = assess_shoot_membership(frames);
    for (const auto& r : result) check(r.state == CullMembershipState::member, "all-exported shoot flags nobody");
  }

  // 7. Too few frames to profile; invalid frames never define the shoot.
  {
    std::vector<CullMembershipInput> frames(3, shot("", -1, 640, 480, "a.jpg"));
    for (const auto& r : assess_shoot_membership(frames)) check(r.state == CullMembershipState::member, "tiny shoot");
    std::vector<CullMembershipInput> mixed;
    for (int i = 0; i < 30; ++i) mixed.push_back(shot("sony|a1", start + i * second, 8640, 5760, dsc(i)));
    auto junk = shot("", -1, 640, 480, "noise.jpg");
    junk.invalid = true;
    mixed.push_back(junk);
    const auto result = assess_shoot_membership(mixed);
    check(result.back().state == CullMembershipState::member && result.back().reason.empty(),
          "the validity gate speaks for invalid frames");
  }
}

// ------------------------------------------------------------------- EXIF --

std::vector<std::uint8_t> exif_jpeg() {
  // Little-endian TIFF: IFD0 {Make, Model, Software, ExifIFD}, ExifIFD
  // {DateTimeOriginal, LensModel, PixelXDimension (SHORT), PixelYDimension (LONG)}.
  std::vector<std::uint8_t> tiff;
  const auto u16 = [&](std::uint16_t v) { tiff.push_back(v & 0xff); tiff.push_back(v >> 8); };
  const auto u32 = [&](std::uint32_t v) { for (int i = 0; i < 4; ++i) tiff.push_back((v >> (8 * i)) & 0xff); };
  const std::string make = "SONY", model = "ILCE-7M4", software = "ILCE-7M4 v2.00", stamp = "2026:09:12 14:03:22",
                    lens = "FE 85mm F1.4 GM";
  tiff = {'I', 'I', 42, 0};
  u32(8);
  // IFD0 at 8: 4 entries -> 2 + 48 + 4 = 54 bytes; data from 62.
  std::uint32_t data = 8 + 2 + 4 * 12 + 4;
  std::vector<std::pair<std::uint32_t, std::string>> blobs;
  const auto text_entry = [&](std::uint16_t tag, const std::string& value) {
    u16(tag); u16(2); u32(std::uint32_t(value.size() + 1)); u32(data);
    blobs.push_back({data, value});
    data += std::uint32_t(value.size() + 1);
  };
  u16(4);
  text_entry(0x010f, make);
  text_entry(0x0110, model);
  text_entry(0x0131, software);
  const std::uint32_t exif_ifd_at = data;
  u16(0x8769); u16(4); u32(1); u32(exif_ifd_at);
  u32(0);
  for (const auto& [at, value] : blobs) {
    tiff.resize(at);
    tiff.insert(tiff.end(), value.begin(), value.end());
    tiff.push_back(0);
  }
  blobs.clear();
  data = exif_ifd_at + 2 + 4 * 12 + 4;
  tiff.resize(exif_ifd_at);
  u16(4);
  text_entry(0x9003, stamp);
  text_entry(0xa434, lens);
  u16(0xa002); u16(3); u32(1); u16(7008); u16(0);
  u16(0xa003); u16(4); u32(1); u32(4672);
  u32(0);
  for (const auto& [at, value] : blobs) {
    tiff.resize(at);
    tiff.insert(tiff.end(), value.begin(), value.end());
    tiff.push_back(0);
  }
  std::vector<std::uint8_t> jpeg = {0xff, 0xd8, 0xff, 0xe1};
  const auto length = std::uint16_t(2 + 6 + tiff.size());
  jpeg.push_back(length >> 8);
  jpeg.push_back(length & 0xff);
  for (char c : std::string("Exif\0\0", 6)) jpeg.push_back(std::uint8_t(c));
  jpeg.insert(jpeg.end(), tiff.begin(), tiff.end());
  jpeg.push_back(0xff);
  jpeg.push_back(0xd9);
  return jpeg;
}

void exif_tests() {
  const auto bytes = exif_jpeg();
  const auto facts = read_exif(bytes.data(), bytes.size());
  check(facts.has_exif, "exif found");
  check(facts.make == "sony" && facts.model == "ilce-7m4", "make and model");
  check(facts.camera_key == "sony|ilce-7m4", "camera key unchanged");
  check(facts.lens == "fe 85mm f1.4 gm", "lens model");
  check(facts.software == "ilce-7m4 v2.00", "software");
  check(facts.exif_width == 7008 && facts.exif_height == 4672, "pixel dimensions, short and long");
  check(facts.capture_time_ms > 0, "capture time still parsed");
  const std::uint8_t bare[] = {0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0, 0};
  const auto none = read_exif(bare, sizeof bare);
  check(!none.has_exif && none.make.empty() && none.exif_width == 0, "no exif block");
  // Truncated in the middle of the IFD: defaults, no crash.
  for (std::size_t cut = 4; cut < bytes.size(); cut += 7) (void)read_exif(bytes.data(), cut);
}

// ---------------------------------------------------------- subject focus --

Image with_subject(const Image& background, double cx, double cy, double radius, int blur_radius,
                   std::uint32_t seed = 5) {
  auto subject = fixtures::natural(background.width, background.height, seed, 1.0, 200, 45);
  if (blur_radius > 0) subject = fixtures::box_blur(subject, blur_radius);
  auto image = background;
  for (unsigned y = 0; y < image.height; ++y)
    for (unsigned x = 0; x < image.width; ++x) {
      const double d = std::hypot(x - cx, y - cy);
      const double alpha = std::clamp(radius - d + .5, 0.0, 1.0);
      if (alpha <= 0) continue;
      const auto i = (std::size_t(y) * image.width + x) * 4;
      fixtures::blend(image, int(x), int(y), subject.rgba[i], subject.rgba[i + 1] * .8, subject.rgba[i + 2] * .6, alpha);
    }
  return image;
}

void subject_tests() {
  // A soft, dim background with one bright textured subject off-centre.
  const auto background = fixtures::box_blur(fixtures::natural(480, 320, 42, .8, 70, 18), 4);
  const auto sharp = with_subject(background, 330, 130, 55, 0);
  const auto soft = with_subject(background, 330, 130, 55, 3);

  const auto salient = measure_subject_focus(sharp);
  std::printf("  subject  salient level=%s focus=%.2f conf=%.2f saliency=%.2f box=(%.2f,%.2f %.2fx%.2f)\n",
              cull_subject_level_name(salient.level), salient.focus, salient.focus_confidence, salient.saliency,
              salient.region.x, salient.region.y, salient.region.width, salient.region.height);
  check(salient.level == CullSubjectLevel::salient, "model-free saliency finds the subject");
  const double centre_x = salient.region.x + salient.region.width / 2, centre_y = salient.region.y + salient.region.height / 2;
  check(std::abs(centre_x - 330.0 / 480) < .15 && std::abs(centre_y - 130.0 / 320) < .15, "salient box is on the subject");
  check(std::string(salient.evidence) == "Focus judged on the most distinct region", "evidence level is reported");
  const auto soft_focus = measure_subject_focus(soft);
  check(salient.focus > soft_focus.focus + .15, "subject focus separates sharp from soft");

  // Detectors take precedence, in order: eyes, face, body, object.
  CullDetections detections;
  detections.objects.push_back({.6, .2, .2, .3, .9});
  check(measure_subject_focus(sharp, detections).level == CullSubjectLevel::object, "object rung");
  detections.bodies.push_back({.55, .1, .35, .8, .8});
  check(measure_subject_focus(sharp, detections).level == CullSubjectLevel::body, "body over object");
  CullFaceDetection face;
  face.face = {.6, .25, .15, .2, .95};
  detections.faces.push_back(face);
  const auto face_level = measure_subject_focus(sharp, detections);
  check(face_level.level == CullSubjectLevel::face && face_level.eye_focus < 0, "face over body");
  detections.faces[0].eyes = {{.62, .3, .04, .03, .9}, {.7, .3, .04, .03, .9}};
  detections.faces[0].eyes_open = .1;
  const auto eyes_level = measure_subject_focus(sharp, detections);
  check(eyes_level.level == CullSubjectLevel::eyes && eyes_level.eye_focus >= 0, "eyes over face");
  check(eyes_level.eyes_open == .1, "eyes-open evidence passes through");
  check(std::string(eyes_level.evidence) == "Focus judged on the eyes", "eyes evidence text");
  // A detector box on featureless paper falls through to the next rung.
  CullDetections bogus;
  bogus.objects.push_back({1.5, 1.5, .1, .1, .9}); // outside the frame
  bogus.faces.push_back({{.1, .1, .1, .1, .1}, {}, -1}); // too unsure to use
  check(measure_subject_focus(sharp, bogus).level == CullSubjectLevel::salient, "unusable detections are ignored");

  // Nothing stands out: judged on the frame's sharpest detail, never "no face".
  const auto texture = measure_subject_focus(fixtures::natural(480, 320, 43));
  check(texture.level == CullSubjectLevel::salient || texture.level == CullSubjectLevel::frame, "uniform texture");
  const auto blank = measure_subject_focus(fixtures::canvas(480, 320, 90, 90, 90));
  check(blank.level == CullSubjectLevel::none && std::string(blank.evidence) == "No detail to judge focus on",
        "featureless frame has no subject evidence");
}

// ------------------------------------------------------------------ heads --

void heads_tests() {
  const auto& sports = cull_profile(CullGenre::sports);
  // Gate: a confident soft subject ranks below everything that passes.
  CullHeadSet soft, dull;
  soft.set(CullHead::subject_focus, .1, .9);
  soft.set(CullHead::peak_action, 1, 1);
  dull.set(CullHead::subject_focus, .5, .9);
  dull.set(CullHead::peak_action, 0, 1);
  const auto soft_key = cull_rank_key(soft, sports), dull_key = cull_rank_key(dull, sports);
  check(!soft_key.passed && soft_key.failed_gate == 1, "focus gate fails confidently soft frame");
  check(cull_rank_before(dull_key, soft_key), "gate beats every tier");
  // An unconfident soft reading cannot fail the gate.
  CullHeadSet unsure = soft;
  unsure.set(CullHead::subject_focus, .1, .2);
  check(cull_rank_key(unsure, sports).passed, "low confidence never fails a gate");

  // Lexicographic: tier 1 decides; tier 2 cannot buy it back.
  CullHeadSet moment, craft;
  moment.set(CullHead::peak_action, .9, 1);
  moment.set(CullHead::subject_focus, .8, 1);
  moment.set(CullHead::occlusion, 1, 1);        // badly blocked
  craft.set(CullHead::peak_action, .5, 1);
  craft.set(CullHead::subject_focus, .8, 1);
  craft.set(CullHead::occlusion, 0, 1);
  craft.set(CullHead::ball_visibility, 1, 1);
  craft.set(CullHead::expression, 1, 1);
  check(cull_rank_before(cull_rank_key(moment, sports), cull_rank_key(craft, sports)), "tier 1 outranks tier 2");
  // Within one tier-1 bucket, tier 2 decides.
  CullHeadSet a = craft, b = craft;
  b.set(CullHead::occlusion, 1, 1);
  b.set(CullHead::expression, 0, 1);
  check(cull_rank_before(cull_rank_key(a, sports), cull_rank_key(b, sports)), "tie at tier 1 goes to tier 2");
  // Not a plain average: a big tier-3 lead cannot beat a tier-1 lead.
  CullHeadSet pretty = b;
  pretty.set(CullHead::composition, 1, 1);
  pretty.set(CullHead::exposure, 1, 1);
  pretty.set(CullHead::subject_focus, .55, 1);
  check(cull_rank_before(cull_rank_key(a, sports), cull_rank_key(pretty, sports)), "not a plain average");

  // Strict weak ordering over random head sets, so std::sort is safe.
  std::mt19937 rng(7);
  std::uniform_real_distribution<double> u(0, 1);
  std::vector<CullRankKey> keys;
  for (int i = 0; i < 60; ++i) {
    CullHeadSet h;
    for (std::size_t k = 0; k < cull_head_count; ++k)
      if (u(rng) < .6) h.set(CullHead(k), u(rng), u(rng));
    keys.push_back(cull_rank_key(h, cull_profile(CullGenre(i % 4))));
  }
  for (const auto& x : keys) {
    check(!cull_rank_before(x, x), "irreflexive");
    for (const auto& y : keys)
      for (const auto& z : keys)
        if (cull_rank_before(x, y) && cull_rank_before(y, z)) check(cull_rank_before(x, z), "transitive");
  }

  // Merge: a confident learned head replaces the model-free one; absent stays absent.
  CullHeadSet base, learned;
  base.set(CullHead::subject_focus, .4, .6);
  learned.set(CullHead::subject_focus, .9, .95);
  learned.set(CullHead::expression, .7, .8);
  base.merge(learned);
  check(base.get(CullHead::subject_focus).value == .9 && base.get(CullHead::expression).present, "merge");
  check(!base.get(CullHead::pose).present, "absent head stays absent");

  // Wedding: closed eyes are a gate there.
  CullHeadSet closed;
  closed.set(CullHead::eyes_open, 0, .9);
  check(!cull_rank_key(closed, cull_profile(CullGenre::wedding)).passed, "wedding eyes gate");
  check(cull_rank_key(closed, cull_profile(CullGenre::sports)).passed, "sports has no eyes gate");

  // Reading heads are all in range.
  const auto reading = measure_cull(fixtures::natural());
  const auto heads = cull_heads_from_reading(reading);
  for (const auto& h : heads.heads)
    if (h.present) check(h.value >= 0 && h.value <= 1 && h.confidence >= 0 && h.confidence <= 1, "head range");
  check(!heads.get(CullHead::aesthetic).present, "learned-only heads stay absent");
}

// --------------------------------------------------------------- sequence --

struct Burst {
  std::vector<CullSequenceFrame> frames;
  std::vector<Image> images;
};

CullSequenceFrame frame_from(const Image& image, int group, double time) {
  CullSequenceFrame f;
  f.group = group;
  f.capture_time_ms = time;
  f.has_signature = true;
  f.signature = cull_sequence_signature(image);
  f.has_subject = true;
  f.subject = measure_subject_focus(image);
  f.heads = cull_heads_from_reading(measure_cull(image));
  f.validity = assess_cull_validity(image).state;
  return f;
}

void sequence_tests() {
  // Signatures and motion.
  const auto background = fixtures::box_blur(fixtures::natural(480, 320, 50, .8, 80, 20), 3);
  {
    const auto a = cull_sequence_signature(with_subject(background, 150, 160, 40, 0));
    const auto same = cull_signature_motion(a, a);
    check(same.energy < .01 && same.pan_x == 0 && same.pan_y == 0, "identical signatures have no motion");
    const auto moved = cull_signature_motion(a, cull_sequence_signature(with_subject(background, 330, 160, 40, 0)));
    check(moved.energy > .08, "a moving subject is motion");
    check(moved.centre_x > .3 && moved.centre_x < .75, "motion centre lies between the positions");
    // Exposure change alone is not motion.
    auto brighter = with_subject(background, 150, 160, 40, 0);
    for (std::size_t i = 0; i < brighter.rgba.size(); ++i)
      if (i % 4 != 3) brighter.rgba[i] = std::uint8_t(std::min(255, int(brighter.rgba[i] * 1.2)));
    check(cull_signature_motion(a, cull_sequence_signature(brighter)).energy < .06, "exposure is not motion");
  }

  // 1. A jump: the subject rises, tops out at frame 4, falls. Only the apex is
  //    perfectly sharp.
  {
    std::vector<CullSequenceFrame> frames;
    const int n = 9;
    for (int k = 0; k < n; ++k) {
      const double t = k - 4.0;
      const double y = 90 + 5.5 * t * t; // top of the jump at k = 4
      const auto image = with_subject(background, 110 + 30 * k, y, 38, k == 4 ? 0 : 2);
      frames.push_back(frame_from(image, 7, 1e12 + 50.0 * k));
    }
    const auto rows = assign_burst_roles(frames);
    int pick = -1;
    for (int k = 0; k < n; ++k) {
      std::printf("  burst jump  frame %d  %-14s rank %d  motion %.2f%s  %s\n", k, cull_burst_role_name(rows[std::size_t(k)].role),
                  rows[std::size_t(k)].rank, rows[std::size_t(k)].motion, rows[std::size_t(k)].at_peak ? " PEAK" : "",
                  rows[std::size_t(k)].reason.c_str());
      if (rows[std::size_t(k)].role == CullBurstRole::pick) pick = k;
      check(!rows[std::size_t(k)].reason.empty(), "every burst role has a reason");
      check(rows[std::size_t(k)].burst_size == n, "burst size");
    }
    check(rows[4].at_peak, "apex of the jump is the peak");
    check(pick == 4, "the sharp apex is the pick");
    check(rows[4].reason == "Sharpest subject at the top of the action", "pick reason: " + rows[4].reason);
    for (int k = 0; k < 3; ++k)
      check(rows[std::size_t(k)].role == CullBurstRole::build_up || rows[std::size_t(k)].role == CullBurstRole::alternate ||
                rows[std::size_t(k)].role == CullBurstRole::review,
            "early frames are build-up");
    for (int k = 6; k < n; ++k)
      check(rows[std::size_t(k)].role == CullBurstRole::follow_through || rows[std::size_t(k)].role == CullBurstRole::alternate ||
                rows[std::size_t(k)].role == CullBurstRole::review,
            "late frames are follow-through");
    check(rows[0].role == CullBurstRole::build_up && rows[0].reason.rfind("Before the peak", 0) == 0,
          "first frame reason: " + rows[0].reason);
    check(rows[8].role == CullBurstRole::follow_through && rows[8].reason.rfind("After the peak", 0) == 0,
          "last frame reason: " + rows[8].reason);
    check(rows[4].heads.get(CullHead::peak_action).present && rows[4].heads.get(CullHead::peak_action).value == 1,
          "peak head on the apex");
  }

  // 2. The apex is badly out of focus: the pick moves to the sharp frame next to
  //    the peak, never to the soft apex.
  {
    std::vector<CullSequenceFrame> frames;
    const int n = 9;
    for (int k = 0; k < n; ++k) {
      const double t = k - 4.0;
      const auto image = with_subject(background, 110 + 30 * k, 90 + 5.5 * t * t, 38, k == 4 ? 5 : 0);
      frames.push_back(frame_from(image, 3, 1e12 + 50.0 * k));
    }
    const auto rows = assign_burst_roles(frames);
    check(rows[4].role != CullBurstRole::pick, "soft apex is not the pick");
    int pick = -1;
    for (int k = 0; k < n; ++k)
      if (rows[std::size_t(k)].role == CullBurstRole::pick) pick = k;
    std::printf("  burst soft apex  pick %d (%s), apex role %s (%s)\n", pick, rows[std::size_t(std::max(pick, 0))].reason.c_str(),
                cull_burst_role_name(rows[4].role), rows[4].reason.c_str());
    check(pick >= 3 && pick <= 5, "pick stays at the peak");
  }

  // 3. Same moment three times: the sharpest is the pick, the others duplicates.
  {
    std::vector<CullSequenceFrame> frames;
    const std::array<int, 3> blur{2, 0, 1};
    for (int k = 0; k < 3; ++k)
      frames.push_back(frame_from(with_subject(background, 240, 150, 50, blur[std::size_t(k)]), 11, 1e12 + 30.0 * k));
    const auto rows = assign_burst_roles(frames);
    check(rows[1].role == CullBurstRole::pick, "sharpest of identical frames is the pick");
    check(rows[0].role == CullBurstRole::duplicate && rows[2].role == CullBurstRole::duplicate, "others are duplicates");
    check(rows[0].reason.rfind("Same moment as", 0) == 0 && rows[0].reason.find("softer") != std::string::npos,
          "duplicate reason: " + rows[0].reason);
    check(rows[0].heads.get(CullHead::duplicate_similarity).value > .7, "duplicate similarity head");
  }

  // 4. Photographer decisions: a kept frame is the pick; a rejected frame never is.
  {
    std::vector<CullSequenceFrame> frames;
    for (int k = 0; k < 4; ++k)
      frames.push_back(frame_from(with_subject(background, 100 + 80 * k, 160, 40, k == 3 ? 3 : 0), 1, 1e12 + 40.0 * k));
    frames[3].verdict = 1;
    auto rows = assign_burst_roles(frames);
    check(rows[3].role == CullBurstRole::pick && rows[3].reason == "Your pick", "photographer's keep is the pick");
    frames[3].verdict = 0;
    rows = assign_burst_roles(frames);
    int best = -1;
    for (int k = 0; k < 4; ++k)
      if (rows[std::size_t(k)].role == CullBurstRole::pick) best = k;
    check(best >= 0, "a pick exists");
    frames[std::size_t(best)].verdict = 2;
    rows = assign_burst_roles(frames);
    check(rows[std::size_t(best)].role != CullBurstRole::pick && rows[std::size_t(best)].role != CullBurstRole::alternate,
          "rejected frame is never pick or alternate");
  }

  // 5. Outside bursts: standalone frames and invalid frames get no role; a group
  //    of one is its own pick; a suspect frame is sent to review.
  {
    std::vector<CullSequenceFrame> frames;
    frames.push_back(frame_from(with_subject(background, 200, 160, 40, 0), -1, 1e12));
    frames.push_back(frame_from(with_subject(background, 200, 160, 40, 0), 5, 1e12 + 10));
    auto junk = frame_from(fixtures::manga(480, 320), 9, 1e12 + 20);
    frames.push_back(junk);
    frames.push_back(frame_from(with_subject(background, 100, 160, 40, 0), 9, 1e12 + 30));
    auto maybe = frame_from(with_subject(background, 300, 160, 40, 1), 9, 1e12 + 40);
    maybe.validity = CullValidityState::suspect;
    frames.push_back(maybe);
    frames.push_back(frame_from(with_subject(background, 380, 160, 40, 1), 9, 1e12 + 50));
    const auto rows = assign_burst_roles(frames);
    check(rows[0].role == CullBurstRole::none && rows[0].reason.empty(), "standalone frame has no role");
    check(rows[1].role == CullBurstRole::pick && rows[1].reason == "Only frame of this moment", "group of one");
    check(frames[2].validity == CullValidityState::invalid && rows[2].role == CullBurstRole::none, "invalid frame is outside the burst");
    check(rows[4].role == CullBurstRole::review && rows[4].reason == "May not be a photograph", "suspect goes to review");
  }

  // 6. Genre changes the ranking: with eyes evidence, a portrait profile picks
  //    open eyes over a sharper frame with closed eyes.
  {
    std::vector<CullSequenceFrame> frames;
    for (int k = 0; k < 2; ++k) {
      auto f = frame_from(with_subject(background, 240, 160, 50, k == 0 ? 0 : 1), 2, 1e12 + 20.0 * k);
      f.heads.set(CullHead::eyes_open, k == 0 ? 0 : 1, .9);
      f.heads.set(CullHead::expression, .6, .5);
      frames.push_back(f);
    }
    CullSequenceOptions portrait;
    portrait.genre = CullGenre::portrait;
    const auto rows = assign_burst_roles(frames, portrait);
    check(rows[1].role == CullBurstRole::pick, "portrait: open eyes win over sharper closed eyes");
  }

  bool threw = false;
  try {
    CullSequenceOptions bad;
    bad.max_alternates = -1;
    assign_burst_roles({}, bad);
  } catch (const std::invalid_argument&) {
    threw = true;
  }
  check(threw, "invalid sequence options");
}
} // namespace

int main() {
  try {
    validity_tests();
    membership_tests();
    exif_tests();
    subject_tests();
    heads_tests();
    sequence_tests();
  } catch (const std::exception& failure) {
    std::cerr << "cull intelligence test failed after " << checks << " checks: " << failure.what() << "\n";
    return 1;
  }
  std::cout << "cull intelligence tests passed (" << checks << " checks)\n";
  return 0;
}
