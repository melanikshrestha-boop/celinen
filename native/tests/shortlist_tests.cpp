#include "lenslabs/shortlist.hpp"
#include <iostream>
#include <sstream>
#include <stdexcept>
using namespace lenslabs;
unsigned checks=0;
void check(bool ok) { ++checks; if(!ok) throw std::runtime_error("shortlist check " + std::to_string(checks)); }
template<class F> void invalid(F fn) { bool failed=false; try {fn();} catch(const std::invalid_argument&) {failed=true;} check(failed); }
ShortlistFrame frame(std::string id, std::string folder="one", double score=90) {
  ShortlistFrame f; f.frame.id=id; f.frame.folder=folder; f.frame.score=score;
  f.frame.hash=0xaaaaaaaaaaaaaaaaULL; f.frame.sharpness=200; f.frame.brightness=120;
  f.frame.hash_domain="native-cpp"; f.frame.time_basis="unknown";
  f.analysis_available=f.source_available=true; return f;
}
int main() { try {
  auto a=frame("a"), b=frame("b"), c=frame("c","two",80);
  auto r=requested_shortlist({a,b,c},2);
  check(r.candidate_ids==std::vector<std::string>({"a","c"}));
  check(r.selected_ids==r.candidate_ids && r.shortfall==0);
  a.frame.verdict=Verdict::keep; b.frame.verdict=Verdict::reject;
  c.manual_review=true;
  r=requested_shortlist({a,b,c},2);
  check(r.selected_ids==std::vector<std::string>({"a"}));
  check(r.review_ids==std::vector<std::string>({"c"}) && r.shortfall==1);
  a.source_available=false; c.frame.verdict=Verdict::keep;
  r=requested_shortlist({a,b,c},1);
  check(r.selected_ids==std::vector<std::string>({"a","c"}) && r.manual_keeps_over_target==1);
  for(int flag=0;flag<6;++flag) {
    auto f=frame("f");
    if(flag==0)f.analysis_available=false; if(flag==1)f.source_available=false;
    if(flag==2)f.error=true; if(flag==3)f.manual_review=true;
    if(flag==4)f.review_required=true; if(flag==5)f.frame.sharpness=64;
    r=requested_shortlist({f},1); check(r.candidate_ids.empty() && r.review_ids==std::vector<std::string>({"f"}));
  }
  auto dark=frame("dark"); dark.frame.brightness=20;
  check(requested_shortlist({dark},1).candidate_ids.size()==1);
  dark.frame.score=20; dark.underexposed=true;
  check(requested_shortlist({dark},1).candidate_ids.size()==1);
  dark.review_required=true;check(requested_shortlist({dark},1).candidate_ids.empty());
  auto low=frame("low","one",69); check(requested_shortlist({low},1).shortfall==1);
  invalid([&]{requested_shortlist({a,a},1);}); invalid([&]{requested_shortlist({a},0);});
  invalid([&]{requested_shortlist({a},100001);});
  std::istringstream input("LENSSHORTLIST1 1 1\n3\nLENSBURST2 1\n61 aaaaaaaaaaaaaaaa 90 200 120 0 - - undecided native-cpp unknown\n");
  auto parsed=read_shortlist_protocol(input); check(parsed.first.size()==1 && parsed.second==1);
  check(requested_shortlist(parsed.first,1).candidate_ids==std::vector<std::string>({"a"}));
  check(shortlist_json(r).find("suggestions-only")!=std::string::npos);
  for(const auto text:{"LENSSHORTLIST1 1 1\n64\n", "LENSSHORTLIST1 0 0\nLENSBURST2 0\n",
    "LENSSHORTLIST1 1 1\n3\nLENSBURST2 0\n", "LENSSHORTLIST1 1 1\n3\nLENSBURST1 1\n61 aaaaaaaaaaaaaaaa 90 200 120 0 - - keep\n"})
    invalid([&]{std::istringstream bad(text);read_shortlist_protocol(bad);});
  auto tied=requested_shortlist({frame("z"),frame("a")},1);check(tied.candidate_ids==std::vector<std::string>({"z"}));
  std::vector<ShortlistFrame> large;large.reserve(100000);
  for(unsigned i=0;i<100000;++i)large.push_back(frame(std::to_string(i),std::to_string(i/2)));
  auto bounded=requested_shortlist(large,50000);
  check(bounded.selected_ids.size()==50000 && bounded.groups_covered==50000 && bounded.group_count==50000);
  check(bounded.candidate_ids[0]=="0" && bounded.candidate_ids.back()=="99998");
  large.push_back(frame("overflow"));invalid([&]{requested_shortlist(large,1);});
  std::cout<<checks<<" shortlist checks passed\n"; return 0;
} catch(const std::exception& e) {std::cerr<<e.what()<<'\n';return 1;} }
