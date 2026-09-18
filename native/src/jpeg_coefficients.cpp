#include "lenslabs/jpeg_coefficients.hpp"
#include <algorithm>
#include <array>
#include <csetjmp>
#include <string>
#include <vector>
extern "C" {
#include <jpeglib.h>
#include <jerror.h> // the JWRN_* warning codes

// libjpeg's inverse DCTs (jidctint.c). Exported by the library but declared
// only in its private jdct.h, so they are declared here with the same
// signature. jpeg_idct_islow is the full 8x8 transform; the others are the
// scaled variants libjpeg itself picks for a component's DCT size.
#define LENSLABS_IDCT(name) \
  void name(j_decompress_ptr, jpeg_component_info*, JCOEFPTR, JSAMPARRAY, JDIMENSION);
LENSLABS_IDCT(jpeg_idct_islow)
LENSLABS_IDCT(jpeg_idct_1x1) LENSLABS_IDCT(jpeg_idct_2x2) LENSLABS_IDCT(jpeg_idct_3x3)
LENSLABS_IDCT(jpeg_idct_4x4) LENSLABS_IDCT(jpeg_idct_5x5) LENSLABS_IDCT(jpeg_idct_6x6)
LENSLABS_IDCT(jpeg_idct_7x7) LENSLABS_IDCT(jpeg_idct_9x9) LENSLABS_IDCT(jpeg_idct_10x10)
LENSLABS_IDCT(jpeg_idct_11x11) LENSLABS_IDCT(jpeg_idct_12x12) LENSLABS_IDCT(jpeg_idct_13x13)
LENSLABS_IDCT(jpeg_idct_14x14) LENSLABS_IDCT(jpeg_idct_15x15) LENSLABS_IDCT(jpeg_idct_16x16)
LENSLABS_IDCT(jpeg_idct_16x8) LENSLABS_IDCT(jpeg_idct_14x7) LENSLABS_IDCT(jpeg_idct_12x6)
LENSLABS_IDCT(jpeg_idct_10x5) LENSLABS_IDCT(jpeg_idct_8x4) LENSLABS_IDCT(jpeg_idct_6x3)
LENSLABS_IDCT(jpeg_idct_4x2) LENSLABS_IDCT(jpeg_idct_2x1) LENSLABS_IDCT(jpeg_idct_8x16)
LENSLABS_IDCT(jpeg_idct_7x14) LENSLABS_IDCT(jpeg_idct_6x12) LENSLABS_IDCT(jpeg_idct_5x10)
LENSLABS_IDCT(jpeg_idct_4x8) LENSLABS_IDCT(jpeg_idct_3x6) LENSLABS_IDCT(jpeg_idct_2x4)
LENSLABS_IDCT(jpeg_idct_1x2)
#undef LENSLABS_IDCT
}

namespace lenslabs {
namespace {

using Idct = void (*)(j_decompress_ptr, jpeg_component_info*, JCOEFPTR, JSAMPARRAY, JDIMENSION);

// The same table jddctmgr.c's start_pass selects from.
Idct idct_for(int h, int v) {
  switch ((h << 8) + v) {
    case (1 << 8) + 1: return jpeg_idct_1x1;
    case (2 << 8) + 2: return jpeg_idct_2x2;
    case (3 << 8) + 3: return jpeg_idct_3x3;
    case (4 << 8) + 4: return jpeg_idct_4x4;
    case (5 << 8) + 5: return jpeg_idct_5x5;
    case (6 << 8) + 6: return jpeg_idct_6x6;
    case (7 << 8) + 7: return jpeg_idct_7x7;
    case (8 << 8) + 8: return jpeg_idct_islow;
    case (9 << 8) + 9: return jpeg_idct_9x9;
    case (10 << 8) + 10: return jpeg_idct_10x10;
    case (11 << 8) + 11: return jpeg_idct_11x11;
    case (12 << 8) + 12: return jpeg_idct_12x12;
    case (13 << 8) + 13: return jpeg_idct_13x13;
    case (14 << 8) + 14: return jpeg_idct_14x14;
    case (15 << 8) + 15: return jpeg_idct_15x15;
    case (16 << 8) + 16: return jpeg_idct_16x16;
    case (16 << 8) + 8: return jpeg_idct_16x8;
    case (14 << 8) + 7: return jpeg_idct_14x7;
    case (12 << 8) + 6: return jpeg_idct_12x6;
    case (10 << 8) + 5: return jpeg_idct_10x5;
    case (8 << 8) + 4: return jpeg_idct_8x4;
    case (6 << 8) + 3: return jpeg_idct_6x3;
    case (4 << 8) + 2: return jpeg_idct_4x2;
    case (2 << 8) + 1: return jpeg_idct_2x1;
    case (8 << 8) + 16: return jpeg_idct_8x16;
    case (7 << 8) + 14: return jpeg_idct_7x14;
    case (6 << 8) + 12: return jpeg_idct_6x12;
    case (5 << 8) + 10: return jpeg_idct_5x10;
    case (4 << 8) + 8: return jpeg_idct_4x8;
    case (3 << 8) + 6: return jpeg_idct_3x6;
    case (2 << 8) + 4: return jpeg_idct_2x4;
    case (1 << 8) + 2: return jpeg_idct_1x2;
    default: return nullptr;
  }
}

struct Failure {
  jpeg_error_mgr manager;
  std::jmp_buf escape;
  std::string* message;
  // Data-corruption warnings seen while reading, counted exactly as the
  // streaming decoder counts them.
  bool ended_early = false;
  int corrupt = 0;
};

void on_error(j_common_ptr info) {
  auto* failure = reinterpret_cast<Failure*>(info->err);
  char text[JMSG_LENGTH_MAX] = {};
  (*info->err->format_message)(info, text);
  *failure->message = text[0] ? text : "This photo could not be decoded.";
  std::longjmp(failure->escape, 1);
}
void ignore_message(j_common_ptr) {}

// Warnings arrive with msg_level -1; trace messages (>= 0) are ignored, as are
// the harmless ones every camera file carries.
void on_warning(j_common_ptr info, int level) {
  if (level >= 0) return;
  info->err->num_warnings++;
  auto* failure = reinterpret_cast<Failure*>(info->err);
  switch (info->err->msg_code) {
    case JWRN_JPEG_EOF:
    case JWRN_HIT_MARKER:
      failure->ended_early = true;
      failure->corrupt++;
      break;
    case JWRN_ARITH_BAD_CODE:
    case JWRN_HUFF_BAD_CODE:
    case JWRN_BOGUS_PROGRESSION:
    case JWRN_MUST_RESYNC:
    case JWRN_NOT_SEQUENTIAL:
      failure->corrupt++;
      break;
    default: break;
  }
}

std::uint32_t div_up(std::uint64_t a, std::uint64_t b) { return std::uint32_t((a + b - 1) / b); }

// jdcolor.c's YCbCr to RGB tables (SCALEBITS 16), built the same way.
struct ColorTables {
  std::array<int, 256> cr_r{}, cb_b{};
  std::array<std::int32_t, 256> cr_g{}, cb_g{};
  ColorTables() {
    constexpr int bits = 16;
    const auto fix = [](double x) { return std::int32_t(x * (1 << bits) + .5); };
    for (int i = 0; i < 256; ++i) {
      const std::int32_t x = i - 128;
      // DESCALE rounds, RIGHT_SHIFT is arithmetic: both as jmorecfg.h defines them.
      cr_r[std::size_t(i)] = int((fix(1.402) * x + (1 << (bits - 1))) >> bits);
      cb_b[std::size_t(i)] = int((fix(1.772) * x + (1 << (bits - 1))) >> bits);
      cr_g[std::size_t(i)] = -fix(0.714136286) * x;
      cb_g[std::size_t(i)] = -fix(0.344136286) * x + (1 << (bits - 1));
    }
  }
};
const ColorTables& color_tables() {
  static const ColorTables tables;
  return tables;
}

} // namespace

struct JpegCoefficients::State {
  jpeg_decompress_struct info{};
  Failure failure{};
  jvirt_barray_ptr* coefficients = nullptr;
  bool created = false;
  // jdmaster.c's sample_range_limit table: limit[x] = clamp(x, 0, 255) for
  // x in [-512, 767]. The inverse DCTs index it with their own offset.
  std::array<JSAMPLE, 1280> range{};
  std::vector<std::array<int, DCTSIZE2>> multipliers; // per component, ISLOW style

  ~State() {
    if (created) jpeg_destroy_decompress(&info);
  }
};

JpegCoefficients::JpegCoefficients() = default;
JpegCoefficients::~JpegCoefficients() = default;

const std::string& JpegCoefficients::error() const noexcept { return error_; }
bool JpegCoefficients::ended_early() const noexcept { return state_ && state_->failure.ended_early; }
bool JpegCoefficients::corrupt() const noexcept { return state_ && state_->failure.corrupt > 0; }
std::uint32_t JpegCoefficients::width() const noexcept { return state_ ? state_->info.image_width : 0; }
std::uint32_t JpegCoefficients::height() const noexcept { return state_ ? state_->info.image_height : 0; }
std::uint32_t JpegCoefficients::scaled_width(unsigned numerator) const noexcept {
  return state_ ? div_up(std::uint64_t(state_->info.image_width) * numerator, 8) : 0;
}
std::uint32_t JpegCoefficients::scaled_height(unsigned numerator) const noexcept {
  return state_ ? div_up(std::uint64_t(state_->info.image_height) * numerator, 8) : 0;
}

bool JpegCoefficients::read(const std::uint8_t* bytes, std::size_t size, std::size_t max_blocks) {
  state_.reset();
  error_.clear();
  auto state = std::make_unique<State>();
  auto& info = state->info;
  state->failure.message = &error_;
  info.err = jpeg_std_error(&state->failure.manager);
  state->failure.manager.error_exit = on_error;
  state->failure.manager.output_message = ignore_message;
  state->failure.manager.emit_message = on_warning;
  if (setjmp(state->failure.escape)) return false; // State's destructor releases libjpeg
  jpeg_create_decompress(&info);
  state->created = true;
  jpeg_mem_src(&info, bytes, static_cast<unsigned long>(size));
  if (jpeg_read_header(&info, TRUE) != JPEG_HEADER_OK) {
    error_ = "This photo could not be decoded.";
    return false;
  }
  const bool colour = info.jpeg_color_space == JCS_YCbCr && info.num_components == 3;
  const bool rgb = info.jpeg_color_space == JCS_RGB && info.num_components == 3 && info.color_transform == JCT_NONE;
  const bool gray = info.jpeg_color_space == JCS_GRAYSCALE && info.num_components == 1;
  if (!(colour || rgb || gray) || info.block_size != DCTSIZE || info.data_precision != 8 || info.CCIR601_sampling) {
    error_ = "Unsupported JPEG layout for coefficient rendering.";
    return false;
  }
  // Coefficient memory is 128 bytes per block for the whole image; beyond the
  // bound the streaming decoder is the better trade.
  std::size_t blocks = 0;
  for (int c = 0; c < info.num_components; ++c) {
    const auto& component = info.comp_info[c];
    blocks += std::size_t(div_up(std::uint64_t(info.image_width) * component.h_samp_factor, info.max_h_samp_factor * 8u)) *
              div_up(std::uint64_t(info.image_height) * component.v_samp_factor, info.max_v_samp_factor * 8u);
  }
  if (blocks > max_blocks) {
    error_ = "This photo is too large to keep as coefficients.";
    return false;
  }
  info.dct_method = JDCT_ISLOW;
  state->coefficients = jpeg_read_coefficients(&info);
  if (!state->coefficients) {
    error_ = "This photo could not be decoded.";
    return false;
  }
  for (int i = 0; i < 1280; ++i) state->range[std::size_t(i)] = JSAMPLE(std::clamp(i - 512, 0, 255));
  info.sample_range_limit = state->range.data() + 512;
  state->multipliers.assign(std::size_t(info.num_components), {});
  for (int c = 0; c < info.num_components; ++c) {
    const auto* table = info.comp_info[c].quant_table;
    if (!table) continue; // no data was ever coded for it: its blocks stay zero
    for (int i = 0; i < DCTSIZE2; ++i) state->multipliers[std::size_t(c)][std::size_t(i)] = table->quantval[i];
  }
  state_ = std::move(state);
  return true;
}

bool JpegCoefficients::render(unsigned numerator, Image& out) {
  return render_region(numerator, 0, 0, scaled_width(numerator), scaled_height(numerator), out);
}

bool JpegCoefficients::render_region(unsigned numerator, std::uint32_t x0, std::uint32_t y0, std::uint32_t x1,
                                     std::uint32_t y1, Image& out) {
  error_.clear();
  if (!state_ || numerator < 1 || numerator > 8) {
    error_ = "No photo is loaded.";
    return false;
  }
  auto& info = state_->info;
  const auto output_width = scaled_width(numerator), output_height = scaled_height(numerator);
  x1 = std::min(x1, output_width);
  y1 = std::min(y1, output_height);
  if (x0 >= x1 || y0 >= y1) {
    error_ = "Empty region.";
    return false;
  }

  // Per component: the DCT size libjpeg would use at this scale (it scales
  // subsampled chroma up in the transform instead of upsampling, as
  // jpeg_calc_output_dimensions does with fancy upsampling off), and how many
  // output pixels each sample then covers.
  struct Plan {
    int dct_h, dct_v, expand_h, expand_v;
    Idct idct;
    std::uint32_t block_x0, block_y0, blocks_wide, blocks_high;
    std::vector<JSAMPLE> samples;
    std::uint32_t samples_wide;
  };
  const int min_dct = int(numerator);
  const int components = info.num_components;
  std::vector<Plan> plans(static_cast<std::size_t>(components));
  for (int c = 0; c < components; ++c) {
    const auto& component = info.comp_info[c];
    auto& plan = plans[std::size_t(c)];
    int ssize = 1;
    while (min_dct * ssize <= DCTSIZE / 2 && info.max_h_samp_factor % (component.h_samp_factor * ssize * 2) == 0)
      ssize *= 2;
    plan.dct_h = min_dct * ssize;
    ssize = 1;
    while (min_dct * ssize <= DCTSIZE / 2 && info.max_v_samp_factor % (component.v_samp_factor * ssize * 2) == 0)
      ssize *= 2;
    plan.dct_v = min_dct * ssize;
    if (plan.dct_h > plan.dct_v * 2) plan.dct_h = plan.dct_v * 2;
    else if (plan.dct_v > plan.dct_h * 2) plan.dct_v = plan.dct_h * 2;
    const int in_h = component.h_samp_factor * plan.dct_h / min_dct;
    const int in_v = component.v_samp_factor * plan.dct_v / min_dct;
    if (in_h <= 0 || in_v <= 0 || info.max_h_samp_factor % in_h || info.max_v_samp_factor % in_v) {
      error_ = "Unsupported JPEG sampling.";
      return false;
    }
    plan.expand_h = info.max_h_samp_factor / in_h;
    plan.expand_v = info.max_v_samp_factor / in_v;
    plan.idct = idct_for(plan.dct_h, plan.dct_v);
    if (!plan.idct) {
      error_ = "Unsupported JPEG scaling.";
      return false;
    }
    // Samples, then blocks, under the output rectangle.
    const std::uint32_t sx0 = x0 / std::uint32_t(plan.expand_h), sx1 = (x1 - 1) / std::uint32_t(plan.expand_h) + 1;
    const std::uint32_t sy0 = y0 / std::uint32_t(plan.expand_v), sy1 = (y1 - 1) / std::uint32_t(plan.expand_v) + 1;
    plan.block_x0 = sx0 / std::uint32_t(plan.dct_h);
    plan.block_y0 = sy0 / std::uint32_t(plan.dct_v);
    const std::uint32_t bx1 = std::min(component.width_in_blocks, (sx1 - 1) / std::uint32_t(plan.dct_h) + 1);
    const std::uint32_t by1 = std::min(component.height_in_blocks, (sy1 - 1) / std::uint32_t(plan.dct_v) + 1);
    if (plan.block_x0 >= bx1 || plan.block_y0 >= by1) {
      error_ = "Region outside the photo.";
      return false;
    }
    plan.blocks_wide = bx1 - plan.block_x0;
    plan.blocks_high = by1 - plan.block_y0;
    plan.samples_wide = plan.blocks_wide * std::uint32_t(plan.dct_h);
    plan.samples.assign(std::size_t(plan.samples_wide) * plan.blocks_high * std::uint32_t(plan.dct_v), 0);
  }
  out = Image{x1 - x0, y1 - y0, info.image_width, info.image_height, {}};
  out.rgba.assign(std::size_t(out.width) * out.height * 4, 255);
  std::vector<jpeg_component_info> components_copy(info.comp_info, info.comp_info + components);
  std::vector<JSAMPROW> rows(16);

  // Only the virtual-array access can raise a libjpeg error here, and every
  // object that must be released already exists above this point.
  if (setjmp(state_->failure.escape)) return false;
  for (int c = 0; c < components; ++c) {
    auto& plan = plans[std::size_t(c)];
    auto& component = components_copy[std::size_t(c)];
    component.dct_table = state_->multipliers[std::size_t(c)].data();
    for (std::uint32_t by = 0; by < plan.blocks_high; ++by) {
      JBLOCKARRAY block_rows = (*info.mem->access_virt_barray)(
          reinterpret_cast<j_common_ptr>(&info), state_->coefficients[c], plan.block_y0 + by, 1, FALSE);
      for (int r = 0; r < plan.dct_v; ++r)
        rows[std::size_t(r)] = plan.samples.data() + (std::size_t(by) * std::size_t(plan.dct_v) + std::size_t(r)) * plan.samples_wide;
      if (plan.dct_h == 1 && plan.dct_v == 1) {
        // One sample a block is the usual case for a camera-sized original,
        // and it is jpeg_idct_1x1's whole body: the DC term, descaled by eight.
        // Inlined because a call for each of a million blocks is most of the cost.
        const int* quant = state_->multipliers[std::size_t(c)].data();
        JSAMPLE* row = rows[0];
        for (std::uint32_t bx = 0; bx < plan.blocks_wide; ++bx) {
          const int dc = int(block_rows[0][plan.block_x0 + bx][0]) * quant[0] + (512 << 3) + (1 << 2);
          // The inverse DCTs index sample_range_limit - RANGE_SUBSET, which is
          // this table 128 entries in.
          row[bx] = state_->range[std::size_t(((dc >> 3) & 1023) + 128)];
        }
        continue;
      }
      for (std::uint32_t bx = 0; bx < plan.blocks_wide; ++bx)
        plan.idct(&info, &component, block_rows[0][plan.block_x0 + bx], rows.data(), JDIMENSION(bx * std::uint32_t(plan.dct_h)));
    }
  }

  // Upsampling by replication and colour conversion, pixel for pixel as
  // jdsample.c and jdcolor.c (or jdmerge.c, which computes the same values)
  // produce them.
  const auto& tables = color_tables();
  const JSAMPLE* limit = info.sample_range_limit;
  // Which sample column each output column reads, per component, computed once.
  std::vector<std::vector<std::uint32_t>> columns(static_cast<std::size_t>(components));
  for (int c = 0; c < components; ++c) {
    const auto& plan = plans[std::size_t(c)];
    auto& map = columns[std::size_t(c)];
    map.resize(out.width);
    for (std::uint32_t x = x0; x < x1; ++x)
      map[x - x0] = std::min(x / std::uint32_t(plan.expand_h) - plan.block_x0 * std::uint32_t(plan.dct_h),
                             plan.samples_wide - 1);
  }
  std::array<const JSAMPLE*, 3> lines{};
  for (std::uint32_t y = y0; y < y1; ++y) {
    for (int c = 0; c < components; ++c) {
      const auto& plan = plans[std::size_t(c)];
      const std::uint32_t last = plan.blocks_high * std::uint32_t(plan.dct_v) - 1;
      const std::uint32_t row = std::min(y / std::uint32_t(plan.expand_v) - plan.block_y0 * std::uint32_t(plan.dct_v), last);
      lines[std::size_t(c)] = plan.samples.data() + std::size_t(row) * plan.samples_wide;
    }
    auto* target = out.rgba.data() + std::size_t(y - y0) * out.width * 4;
    for (std::uint32_t i = 0; i < out.width; ++i, target += 4) {
      const int a = lines[0][columns[0][i]];
      if (components == 1) {
        target[0] = target[1] = target[2] = JSAMPLE(a);
        continue;
      }
      const int b = lines[1][columns[1][i]], c = lines[2][columns[2][i]];
      if (info.jpeg_color_space == JCS_RGB) {
        target[0] = JSAMPLE(a), target[1] = JSAMPLE(b), target[2] = JSAMPLE(c);
        continue;
      }
      target[0] = limit[a + tables.cr_r[std::size_t(c)]];
      target[1] = limit[a + int((tables.cb_g[std::size_t(b)] + tables.cr_g[std::size_t(c)]) >> 16)];
      target[2] = limit[a + tables.cb_b[std::size_t(b)]];
    }
  }
  return true;
}

} // namespace lenslabs
