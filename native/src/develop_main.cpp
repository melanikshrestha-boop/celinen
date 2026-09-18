#include "lenslabs/develop.hpp"
#include "lenslabs/upright.hpp"
#include <iostream>
#include <iterator>
#include <sstream>
#include <cmath>
#include <stdexcept>
#include <string>
#include <utility>
int main(int argc, char** argv) {
  try {
    if(argc!=4 && argc!=5) throw std::invalid_argument("Expected source, edge, quality and optional source mode.");
    auto number=[](const char* raw) { const std::string text(raw); std::size_t used=0; const double n=std::stod(text,&used); if(used!=text.size()) throw std::invalid_argument("Invalid number."); return n; };
    const double edge=number(argv[2]), quality=number(argv[3]);
    if(!std::isfinite(edge)||edge<32||edge>lenslabs::develop_max_edge||std::floor(edge)!=edge||!std::isfinite(quality)||quality<.5||quality>1) throw std::invalid_argument("Invalid export dimensions.");
    // The recipe may be followed by one "UPRIGHT_1" line of 13 numbers: the
    // perspective transform, applied to the decoded source before the recipe.
    const std::string text{std::istreambuf_iterator<char>(std::cin),std::istreambuf_iterator<char>()};
    const auto marker=text.find("UPRIGHT_1");
    std::istringstream recipe(text.substr(0,marker));
    auto settings=lenslabs::read_develop_protocol(recipe);
    lenslabs::UprightTransform upright;
    if(marker!=std::string::npos) {
      std::istringstream line(text.substr(marker+9));
      double values[13];
      for(auto& value:values) if(!(line>>value)) throw std::invalid_argument("Truncated Upright values.");
      line>>std::ws;
      if(!line.eof()) throw std::invalid_argument("Extra Upright values.");
      upright=lenslabs::read_upright_values(values,13);
    }
    const std::string mode=argc==5?argv[4]:"preview";
    if(mode!="preview"&&mode!="raw") throw std::invalid_argument("Invalid source mode.");
    lenslabs::Image decoded;
    if(mode=="raw") {
      decoded=lenslabs::decode_raw_develop(argv[1],static_cast<unsigned>(edge),settings.exposure,settings.temperature,settings.tint);
      settings.exposure=0;settings.temperature=0;settings.tint=0;
    } else decoded=lenslabs::decode_develop_preview(argv[1],static_cast<unsigned>(edge));
    if(!lenslabs::upright_identity(upright)) decoded=lenslabs::apply_upright(decoded,upright);
    // RAW exposure/WB have already been applied above. Do not allocate and run
    // millions of identity edits for imports or exposure/WB-only RAW recipes.
    // Moving the owned decoded buffer preserves its exact bytes and dimensions.
    const auto image=lenslabs::is_neutral_develop(settings)
      ? std::move(decoded) : lenslabs::develop(decoded,settings,edge>lenslabs::develop_standard_edge);
    const auto bytes=lenslabs::encode_develop_jpeg(image,quality);
    if(bytes.size()>32*1024*1024) throw std::runtime_error("Export exceeds limit.");
    std::cout.write(reinterpret_cast<const char*>(bytes.data()),std::streamsize(bytes.size()));
    return std::cout ? 0 : 1;
  } catch(...) { std::cerr << "Develop processing failed. Source unchanged.\n"; return 1; }
}
