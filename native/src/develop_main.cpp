#include "lenslabs/develop.hpp"
#include <iostream>
#include <cmath>
#include <stdexcept>
#include <string>
int main(int argc, char** argv) {
  try {
    if(argc!=4 && argc!=5) throw std::invalid_argument("Expected source, edge, quality and optional source mode.");
    auto number=[](const char* raw) { const std::string text(raw); std::size_t used=0; const double n=std::stod(text,&used); if(used!=text.size()) throw std::invalid_argument("Invalid number."); return n; };
    const double edge=number(argv[2]), quality=number(argv[3]);
    if(!std::isfinite(edge)||edge<32||edge>4096||std::floor(edge)!=edge||!std::isfinite(quality)||quality<.5||quality>1) throw std::invalid_argument("Invalid export dimensions.");
    auto settings=lenslabs::read_develop_protocol(std::cin);
    const std::string mode=argc==5?argv[4]:"preview";
    if(mode!="preview"&&mode!="raw") throw std::invalid_argument("Invalid source mode.");
    lenslabs::Image decoded;
    if(mode=="raw") {
      decoded=lenslabs::decode_raw_develop(argv[1],static_cast<unsigned>(edge),settings.exposure,settings.temperature,settings.tint);
      settings.exposure=0;settings.temperature=0;settings.tint=0;
    } else decoded=lenslabs::decode_preview(argv[1],static_cast<unsigned>(edge));
    const auto image=lenslabs::develop(decoded,settings);
    const auto bytes=lenslabs::encode_jpeg(image,quality);
    if(bytes.size()>32*1024*1024) throw std::runtime_error("Export exceeds limit.");
    std::cout.write(reinterpret_cast<const char*>(bytes.data()),std::streamsize(bytes.size()));
    return std::cout ? 0 : 1;
  } catch(...) { std::cerr << "Develop processing failed. Source unchanged.\n"; return 1; }
}
