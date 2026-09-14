#include "lenslabs/canonical_v2.hpp"
#include <array>
#include <cstdio>
#include <iostream>
#include <thread>
#include <unistd.h>

using namespace lenslabs::canonical_v2;
int passed=0;
void check(bool okay,const char* name) {
  if (!okay) throw std::runtime_error(name);
  ++passed;
  std::cout << "PASS " << name << '\n';
}
template<class F> void fails(F f,ErrorCode expected,const char* name) {
  try { f(); } catch(const Error& e) {check(e.code==expected,name);return;}
  throw std::runtime_error(std::string("Expected error: ")+name);
}
Rgba pixels(unsigned w,unsigned h) {
  Rgba a{w,h,std::vector<std::uint8_t>(std::size_t(w)*h*4)};
  for(std::size_t i=0;i<a.bytes.size();i+=4) a.bytes[i+3]=255;
  return a;
}
int main() {
 try {
  Control control(true);
  check(sha256({})=="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","SHA empty");
  std::string abc="abc";
  check(sha256({reinterpret_cast<const std::uint8_t*>(abc.data()),abc.size()})==
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad","SHA abc");
  std::vector<std::uint8_t> million(1000000,'a');
  check(sha256(million)=="cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0","SHA million-a");
  check(target_geometry(1616,1080).height==171,"Sony geometry round half up");
  check(target_geometry(3504,2336).height==171,"Sony second geometry");
  check(target_geometry(1024,14).height==4,"exact half up geometry");
  check(target_geometry(255,100).width==255,"no upscale");
  fails([]{target_geometry(0,4);},ErrorCode::invalid_geometry,"zero size");
  fails([]{target_geometry(65536,3);},ErrorCode::limit_exceeded,"dimension cap");
  fails([]{target_geometry(8193,8192);},ErrorCode::limit_exceeded,"pixel cap");
  fails([]{target_geometry(60000,3);},ErrorCode::invalid_geometry,"narrow unsupported");
  auto small=pixels(3,2);
  for(unsigned i=0;i<6;++i) small.bytes[4*i]=static_cast<std::uint8_t>(i);
  constexpr std::array<const char*,8> permutations={"012345","210543","543210","345012","031425","304152","524130","251403"};
  for(unsigned o=1;o<=8;++o) {
    const auto b=orient(small,o,control);
    bool exact=b.width==(o>=5?2U:3U) && b.height==(o>=5?3U:2U);
    for(unsigned i=0;i<6;++i) exact &= b.bytes[4*i]==permutations[o-1][i]-'0';
    check(exact,("EXIF "+std::to_string(o)).c_str());
  }
  auto rotated=small;
  for(unsigned i=0;i<4;++i) rotated=orient(rotated,6,control);
  check(rotated.bytes==small.bytes && rotated.width==small.width,"four turns identity");
  fails([&]{orient(small,0,control);},ErrorCode::invalid_orientation,"orientation zero");
  fails([&]{orient(small,9,control);},ErrorCode::invalid_orientation,"orientation nine");
  auto bad=small;bad.bytes.pop_back();
  fails([&]{orient(bad,1,control);},ErrorCode::invalid_geometry,"truncated buffer");
  bad=small;bad.bytes[3]=0;
  fails([&]{orient(bad,1,control);},ErrorCode::invalid_source,"nonopaque input");
  auto image=pixels(512,512);
  for(unsigned y=0;y<512;++y) for(unsigned x=0;x<512;++x) {
    const auto i=4*(y*512+x); image.bytes[i]=x%2?255:0;image.bytes[i+1]=y%2?255:0;image.bytes[i+2]=37;
  }
  auto scaled=resize(image,control);
  bool exact=true;
  for(std::size_t i=0;i<scaled.bytes.size();i+=4)
    exact &= scaled.bytes[i]==128 && scaled.bytes[i+1]==128 && scaled.bytes[i+2]==37 && scaled.bytes[i+3]==255;
  check(exact && scaled.width==256 && scaled.height==256,"integer area block mean ties up");
  check(resize(scaled,control).bytes==scaled.bytes,"identity copy pixels");
  auto odd=pixels(513,511);
  for(std::size_t i=0;i<odd.bytes.size();i+=4) odd.bytes[i]=83;
  auto constant=resize(odd,control);exact=true;
  for(std::size_t i=0;i<constant.bytes.size();i+=4) exact &= constant.bytes[i]==83;
  check(exact,"odd dimensions constant preservation");
  auto transposed=scaled;transposed.width=128;transposed.height=512;
  fails([&]{tensor_hash(transposed);},ErrorCode::invalid_geometry,"seal rejects oversize tensor");
  auto a=pixels(3,4),b=pixels(4,3);
  check(sha256(a.bytes)==sha256(b.bytes) && tensor_hash(a)!=tensor_hash(b),"tensor hash includes geometry");
  Control disabled;
  fails([&]{resize(image,disabled);},ErrorCode::disabled,"default off");
  Control cancelled(true);cancelled.cancel();
  fails([&]{resize(image,cancelled);},ErrorCode::cancelled,"cancel gate");
  Control revoked(true);revoked.disable();
  fails([&]{orient(small,1,revoked);},ErrorCode::disabled,"kill switch");
  std::array<std::string,4> hashes;
  std::vector<std::thread> threads;
  for(unsigned i=0;i<4;++i) threads.emplace_back([&,i]{hashes[i]=tensor_hash(resize(image,control));});
  for(auto& t:threads)t.join();
  check(hashes[0]==hashes[1] && hashes[1]==hashes[2] && hashes[2]==hashes[3],"four independent jobs");
  char path[]="/tmp/celinen-v2-unit-XXXXXX";
  const int fd=mkstemp(path);
  if(fd<0)throw std::runtime_error("mkstemp");
  if(write(fd,abc.data(),abc.size())!=3)throw std::runtime_error("write fixture");
  close(fd);
  const auto source=verify_source(path,control);
  check(source.hash()==sha256(source.bytes()) && source.bytes().size()==3,"verified source snapshot");
  check(verify_source(path,control).hash()==source.hash(),"original unchanged");
  std::string link=std::string(path)+"-link";
  if(symlink(path,link.c_str())!=0)throw std::runtime_error("symlink");
  fails([&]{verify_source(link,control);},ErrorCode::invalid_source,"no symlink input");
  unlink(link.c_str());unlink(path);
  fails([&]{verify_source("/tmp",control);},ErrorCode::invalid_source,"no directory input");
  fails([&]{verify_source(std::string("/tmp\0trailing",13),control);},ErrorCode::invalid_source,"no embedded NUL");
  std::cout << "TOTAL " << passed << " passed; no decoder qualification claimed\n";
  return 0;
 } catch(const std::exception& e) {std::cerr << "FAIL " << e.what() << '\n';return 1;}
}
