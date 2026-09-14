#include "lenslabs/canonical_v2.hpp"
#include <algorithm>
#include <array>
#include <cerrno>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

namespace lenslabs::canonical_v2 {
namespace {
struct Descriptor {
  int fd;
  ~Descriptor() { if (fd>=0) close(fd); }
};
bool unchanged(const struct stat& a,const struct stat& b) {
  return a.st_dev==b.st_dev && a.st_ino==b.st_ino && a.st_size==b.st_size &&
#ifdef __APPLE__
    a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec && a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec &&
    a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec && a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec;
#else
    a.st_mtim.tv_sec==b.st_mtim.tv_sec && a.st_mtim.tv_nsec==b.st_mtim.tv_nsec &&
    a.st_ctim.tv_sec==b.st_ctim.tv_sec && a.st_ctim.tv_nsec==b.st_ctim.tv_nsec;
#endif
}
void read_exact(int fd, std::span<std::uint8_t> bytes, std::size_t offset) {
  std::size_t n=0;
  while (n<bytes.size()) {
    const auto got=pread(fd,bytes.data()+n,bytes.size()-n,static_cast<off_t>(offset+n));
    if (got<0 && errno==EINTR) continue;
    if (got<=0) throw Error(ErrorCode::source_changed,"source","Incomplete source read");
    n+=static_cast<std::size_t>(got);
  }
}
}
VerifiedSource verify_source(const std::string& path,const Control& control) {
  control.check("source");
  if (path.find('\0')!=std::string::npos)
    throw Error(ErrorCode::invalid_source,"source","Embedded NUL in path");
  Descriptor input{open(path.c_str(),O_RDONLY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK)};
  struct stat before{},after{};
  if (input.fd<0 || fstat(input.fd,&before)!=0 || !S_ISREG(before.st_mode) || before.st_size<=0)
    throw Error(ErrorCode::invalid_source,"source","Expected a nonempty regular file, not a symlink");
  if (static_cast<std::uint64_t>(before.st_size)>max_source_bytes)
    throw Error(ErrorCode::limit_exceeded,"source","Source exceeds 512 MiB");
  VerifiedSource result;
  try { result.bytes_.resize(static_cast<std::size_t>(before.st_size)); }
  catch (const std::bad_alloc&) {
    throw Error(ErrorCode::resource_exhausted,"source","Source snapshot allocation failed");
  }
  constexpr std::size_t chunk=64*1024;
  for (std::size_t offset=0;offset<result.bytes_.size();offset+=chunk) {
    control.check("source");
    read_exact(input.fd,std::span(result.bytes_).subspan(offset,std::min(chunk,result.bytes_.size()-offset)),offset);
  }
  // Independent second read checks all bytes, not only mtime or a partial hash.
  std::array<std::uint8_t,chunk> check{};
  for (std::size_t offset=0;offset<result.bytes_.size();offset+=chunk) {
    control.check("source");
    const auto n=std::min(chunk,result.bytes_.size()-offset);
    read_exact(input.fd,std::span(check).first(n),offset);
    if (!std::equal(check.begin(),check.begin()+n,result.bytes_.begin()+offset))
      throw Error(ErrorCode::source_changed,"source","Source contents changed");
  }
  if (fstat(input.fd,&after)!=0 || !unchanged(before,after))
    throw Error(ErrorCode::source_changed,"source","Source metadata changed");
  result.hash_=sha256(result.bytes_);
  control.check("source");
  return result;
}
} // namespace lenslabs::canonical_v2
