#include "lenslabs/social.hpp"
#include <iostream>
#include <stdexcept>
#include <string>

int main(int argc, char** argv) {
  try {
    if (argc != 8) throw std::invalid_argument("Usage: lenslabs-social source portrait|square|story fit|fill x y zoom black|white");
    lenslabs::SocialFrame frame;
    const std::string format = argv[2], mode = argv[3], background = argv[7];
    if (format == "portrait") frame.format = lenslabs::SocialFormat::portrait;
    else if (format == "square") frame.format = lenslabs::SocialFormat::square;
    else if (format == "story") frame.format = lenslabs::SocialFormat::story;
    else throw std::invalid_argument("Invalid format");
    if (mode != "fit" && mode != "fill") throw std::invalid_argument("Invalid mode");
    if (background != "black" && background != "white") throw std::invalid_argument("Invalid background");
    frame.fit = mode == "fit";
    frame.background = background == "white" ? 255 : 0;
    const auto number = [](const char* input) { std::size_t used; const std::string text(input); const double v = std::stod(text, &used); if (used != text.size()) throw std::invalid_argument("Invalid number"); return v; };
    frame.x = number(argv[4]); frame.y = number(argv[5]); frame.zoom = number(argv[6]);
    const auto image = lenslabs::frame_social(lenslabs::decode_preview(argv[1], 4096), frame);
    const auto jpeg = lenslabs::encode_jpeg(image, 0.92);
    if (jpeg.size() > 8 * 1024 * 1024) throw std::runtime_error("Social JPEG exceeds 8 MiB");
    std::cout.write(reinterpret_cast<const char*>(jpeg.data()), std::streamsize(jpeg.size()));
    return std::cout ? 0 : 1;
  } catch (...) {
    std::cerr << "Social framing failed. Source unchanged.\n";
    return 1;
  }
}
