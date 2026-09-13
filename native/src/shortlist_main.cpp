#include "lenslabs/shortlist.hpp"
#include <iostream>
int main(){try {auto [frames,target]=lenslabs::read_shortlist_protocol(std::cin);
  std::cout<<lenslabs::shortlist_json(lenslabs::requested_shortlist(frames,target))<<'\n';return 0;
}catch(const std::exception& e){std::cerr<<"Shortlist failed: "<<e.what()<<'\n';return 1;}}
