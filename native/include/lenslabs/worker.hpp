#pragma once

#include "lenslabs/engine.hpp"
#include <iosfwd>

namespace lenslabs {

// IPC only; not a network listener. The local transport owns private input files.
// Request: LENS1 <edge 8..2048> <hex absolute path> LF (maximum 8192 bytes).
// Response: JSON LF, then exactly preview_bytes JPEG bytes, no delimiter.
// Complete invalid requests are recoverable; oversized/truncated frames exit 2.
int run_worker(std::istream& input, std::ostream& output);

// Area-average downsampling for bounded, reproducible analysis of one decode.
Image analysis_preview(const Image& image);

} // namespace lenslabs
