#include "lenslabs/canonical_v2.hpp"
#include <iostream>
#include <string>

using namespace lenslabs::canonical_v2;
std::string quote(const std::string& s) {
  std::string out="\"";constexpr char hex[]="0123456789abcdef";
  for(unsigned char c:s) {
    if(c=='"'||c=='\\'){out+='\\';out+=c;}
    else if(c<32){out+="\\u00";out+=hex[c>>4];out+=hex[c&15];}
    else out+=c;
  }return out+'"';
}
int main(int argc,char** argv) {
  // Test-only command: no directory creation, pixel output, sidecars or network.
  if(argc!=4||std::string(argv[1])!="--experimental-v2") {
    std::cerr<<"DISABLED: explicit --experimental-v2 source fixed-profile required\n";return 2;
  }
  try {
    Control control(true);
    const auto source=verify_source(argv[2],control),profile=verify_source(argv[3],control);
    const auto result=canonicalize(source,profile.bytes(),control);
    const auto& p=result.provenance;
    std::cout<<"{\"status\":\"ok\",\"qualified\":false,\"domain\":"<<quote(p.feature_domain)
      <<",\"contract\":"<<quote(p.contract_sha256)<<",\"source\":"<<quote(p.source_sha256)
      <<",\"preview\":"<<quote(p.prepared_preview_sha256)<<",\"jpeg\":"<<quote(p.jpeg_input_sha256)
      <<",\"input_profile\":"<<quote(p.input_profile_sha256)<<",\"output_profile\":"<<quote(p.output_profile_sha256)
      <<",\"profile_policy\":"<<quote(result.profile_policy)<<",\"orientation\":"<<result.source_orientation
      <<",\"canonical\":"<<quote(p.canonical_output_sha256)<<",\"tensor\":"<<quote(p.canonical_tensor_sha256)<<",\"stages\":[";
    bool first=true;
    for(const auto& s:p.stages){if(!first)std::cout<<',';first=false;
      std::cout<<"{\"stage\":"<<quote(s.stage)<<",\"version\":"<<quote(s.version)<<",\"width\":"<<s.width
        <<",\"height\":"<<s.height<<",\"sha256\":"<<quote(s.sha256)<<'}';}
    std::cout<<"]}\n";return 0;
  }catch(const Error& e){std::cout<<"{\"status\":\"error\",\"code\":"<<quote(code_name(e.code))
    <<",\"stage\":"<<quote(e.stage)<<",\"message\":"<<quote(e.what())<<"}\n";return 1;}
  catch(const std::exception&){std::cerr<<"INTERNAL_ERROR\n";return 1;}
}
