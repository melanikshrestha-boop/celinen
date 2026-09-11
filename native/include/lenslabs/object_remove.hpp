#pragma once
#include <cstdint>
#include <vector>

namespace lenslabs {
// Texture reconstruction only. The caller supplies an explicit reviewed instance mask.
// Pixels outside that mask are copied byte-for-byte; the source is never modified.
std::vector<std::uint8_t> remove_object_texture(
    const std::vector<std::uint8_t>& rgba, const std::vector<std::uint8_t>& mask,
    unsigned width, unsigned height);
}
