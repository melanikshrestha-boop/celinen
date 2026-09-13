#include "lenslabs/shortlist.hpp"
#include <algorithm>
#include <charconv>
#include <sstream>
#include <queue>
#include <tuple>
#include <unordered_map>
#include <unordered_set>
#include <stdexcept>
namespace lenslabs {
Shortlist requested_shortlist(const std::vector<ShortlistFrame>& frames, std::size_t target) {
  if (!target || target>100000 || frames.size()>100000) throw std::invalid_argument("Shortlist count/frame limit is 100000");
  std::vector<BurstFrame> evidence; evidence.reserve(frames.size());
  std::unordered_map<std::string,std::size_t> positions;
  for(std::size_t i=0;i<frames.size();++i) {
    evidence.push_back(frames[i].frame); positions.emplace(frames[i].frame.id,i);
    if(!frames[i].analysis_available || frames[i].error) {
      evidence.back().hash_domain="unknown"; evidence.back().time_basis="unknown";
    }
  }
  const auto groups=group_scene_candidates(evidence); // validates all IDs, metrics and domains
  Shortlist result; result.target_count=target; result.group_count=groups.size();
  std::vector<std::vector<std::size_t>> candidates(groups.size());
  std::vector<std::size_t> counts(groups.size()), cursors(groups.size());
  std::unordered_set<std::string> selected;
  std::size_t manual=0;
  for(std::size_t g=0;g<groups.size();++g) for(const auto& id:groups[g].frame_ids) {
    const auto i=positions.at(id); const auto& f=frames[i];
    if(f.frame.verdict==Verdict::keep) {selected.insert(id);++manual;++counts[g];continue;}
    if(f.frame.verdict==Verdict::reject) continue;
    if(!f.analysis_available || !f.source_available || f.error || f.manual_review || f.review_required ||
       f.frame.hash_domain=="unknown" || f.frame.sharpness<130 || f.frame.brightness>200 ||
       (f.frame.score<70 && !f.underexposed)) result.review_ids.push_back(id);
    else candidates[g].push_back(i);
  }
  const auto better=[&](std::size_t a,std::size_t b) {return frames[a].frame.score!=frames[b].frame.score
    ? frames[a].frame.score>frames[b].frame.score : a<b;};
  for(auto& group:candidates) std::sort(group.begin(),group.end(),better);
  // Each round represents another candidate per group. Existing manual keeps
  // occupy their group's earlier rounds; no manual decision is displaced.
  using Next=std::tuple<std::size_t,std::size_t,std::size_t>; // occupied round, input index, group
  const auto later=[&](const Next& a,const Next& b) {return std::get<0>(a)!=std::get<0>(b)
    ? std::get<0>(a)>std::get<0>(b) : better(std::get<1>(b),std::get<1>(a));};
  std::priority_queue<Next,std::vector<Next>,decltype(later)> next(later);
  for(std::size_t g=0;g<groups.size();++g) if(!candidates[g].empty()) next.emplace(counts[g],candidates[g][0],g);
  while(selected.size()<target && !next.empty()) {
    const auto [round,i,g]=next.top(); next.pop();
    selected.insert(frames[i].frame.id); result.candidate_ids.push_back(frames[i].frame.id);
    ++cursors[g];++counts[g];
    if(cursors[g]<candidates[g].size()) next.emplace(counts[g],candidates[g][cursors[g]],g);
  }
  for(const auto& f:frames) if(selected.contains(f.frame.id)) result.selected_ids.push_back(f.frame.id);
  result.shortfall=target>selected.size()?target-selected.size():0;
  result.manual_keeps_over_target=manual>target?manual-target:0;
  result.groups_covered=std::count_if(counts.begin(),counts.end(),[](auto n){return n>0;});
  return result;
}
std::pair<std::vector<ShortlistFrame>,std::size_t> read_shortlist_protocol(std::istream& input) {
  const auto line=[&] {std::string s; char c; while(input.get(c)) {if(c=='\n')return s;
    if(s.size()>=128)throw std::invalid_argument("Oversized shortlist header");s+=c;}
    throw std::invalid_argument("Incomplete shortlist header");};
  const auto number=[](const std::string& s) {std::size_t n=0;auto [end,err]=std::from_chars(s.data(),s.data()+s.size(),n);
    if(err!=std::errc{} || end!=s.data()+s.size())throw std::invalid_argument("Invalid shortlist integer");return n;};
  std::istringstream header(line()); std::string magic,target_text,count_text,extra;
  if(!(header>>magic>>target_text>>count_text)||header>>extra||magic!="LENSSHORTLIST1")throw std::invalid_argument("Invalid shortlist header");
  const auto target=number(target_text),count=number(count_text);
  if(!target||target>100000||count>100000)throw std::invalid_argument("Invalid shortlist bounds");
  std::vector<std::size_t> masks; masks.reserve(count);
  for(std::size_t i=0;i<count;++i) {auto mask=number(line());if(mask>63)throw std::invalid_argument("Invalid eligibility mask");masks.push_back(mask);}
  auto evidence=read_burst_protocol(input);
  if(evidence.size()!=count)throw std::invalid_argument("Shortlist row count mismatch");
  std::vector<ShortlistFrame> frames;frames.reserve(count);
  for(std::size_t i=0;i<count;++i) {
    if(!evidence[i].scene_only)throw std::invalid_argument("Shortlist requires explicit evidence domains");
    frames.push_back({std::move(evidence[i]),bool(masks[i]&1),bool(masks[i]&2),bool(masks[i]&4),bool(masks[i]&8),bool(masks[i]&16),bool(masks[i]&32)});
  }
  return {std::move(frames),target};
}
std::string shortlist_json(const Shortlist& r) {
  const auto array=[](const auto& ids) {std::string out="[";bool comma=false;for(const auto& id:ids){if(comma)out+=',';comma=true;out+='"';
    for(char c:id){if(c=='"'||c=='\\')out+='\\';out+=c;}out+='"';}return out+"]";};
  std::ostringstream out;out<<"{\"status\":\"suggestions-only\",\"method\":\"measured-diversity-v1\",\"selectedIds\":"<<array(r.selected_ids)
    <<",\"candidateIds\":"<<array(r.candidate_ids)<<",\"reviewIds\":"<<array(r.review_ids)<<",\"targetCount\":"<<r.target_count
    <<",\"shortfall\":"<<r.shortfall<<",\"manualKeepsOverTarget\":"<<r.manual_keeps_over_target
    <<",\"groupsCovered\":"<<r.groups_covered<<",\"groupCount\":"<<r.group_count
    <<",\"limitations\":[\"Suggestions only; photographer decisions are preserved.\",\"Diversity uses uncertain preview/folder/camera-time groups, not unique action, subject, expression or location recognition.\",\"Mechanical quality ranks candidates; unchosen frames are not rejected. Review flags and missing evidence require judgment.\"]}";return out.str();
}
}
