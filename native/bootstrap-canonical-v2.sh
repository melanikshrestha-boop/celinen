#!/bin/sh
# Local isolated build only. No installs outside native/build-v2, no network at runtime.
set -eu
cd "$(dirname "$0")"
export LC_ALL=C LANG=C
mkdir -p build-v2/downloads build-v2/deps
downloads=$(pwd)/build-v2/downloads
root=$(pwd)/build-v2
if [ "${V2_SANITIZE:-0}" = 1 ]; then root="$root/instrumented"; fi
mkdir -p "$root/deps"
fetch() {
  file=$1 expected=$2 url=$3
  if [ ! -f "$downloads/$file" ]; then
    curl -fL --max-time 120 --max-filesize 20000000 "$url" -o "$downloads/$file"
  fi
  actual=$(shasum -a 256 "$downloads/$file" | cut -d ' ' -f 1)
  [ "$actual" = "$expected" ] || { echo "CHECKSUM MISMATCH: $file" >&2; exit 1; }
}
fetch libjpeg-turbo-3.1.4.1.tar.gz ecae8008e2cc9ade2f2c1bb9d5e6d4fb73e7c433866a056bd82980741571a022 https://github.com/libjpeg-turbo/libjpeg-turbo/releases/download/3.1.4.1/libjpeg-turbo-3.1.4.1.tar.gz
fetch lcms2-2.19.1.tar.gz bfc54f7bab59fbc921012014a8032e4cba4abd46db47d46b76416a8c0b2815c8 https://github.com/mm2/Little-CMS/releases/download/lcms2.19.1/lcms2-2.19.1.tar.gz
fetch LibRaw-0.22.2.tar.gz de86b035655accff8d4010f1a221fdf50d353cb7b1422ba26f14a0db92612cfa https://www.libraw.org/data/LibRaw-0.22.2.tar.gz
fetch sRGB2014.icc 384b832de3412066743b52a75ee906b6fb9fb8d9e09e936fc2c43223815c6e0a https://registry.color.org/rgb-registry/profiles/sRGB2014.icc
cmake_bin=${CMAKE:-cmake}
build_jobs=${V2_BUILD_JOBS:-2}
case "$build_jobs" in 1|2|3|4) ;; *) echo "V2_BUILD_JOBS must be 1 through 4" >&2; exit 1;; esac
"$cmake_bin" --version
for archive in libjpeg-turbo-3.1.4.1 lcms2-2.19.1 LibRaw-0.22.2; do
  tar -xzf "$downloads/$archive.tar.gz" -C "$root/deps"
done
flags="-O2 -fno-fast-math -ffp-contract=off"
if [ "${V2_SANITIZE:-0}" = 1 ]; then flags="-O1 -g -fno-fast-math -ffp-contract=off -fsanitize=address,undefined -fno-omit-frame-pointer"; fi
"$cmake_bin" -S "$root/deps/libjpeg-turbo-3.1.4.1" -B "$root/deps/jpeg-build" \
  -DCMAKE_C_COMPILER=clang -DCMAKE_C_FLAGS="$flags" -DWITH_SIMD=OFF \
  -DENABLE_SHARED=OFF -DENABLE_STATIC=ON -DWITH_TURBOJPEG=OFF \
  -DCMAKE_INSTALL_PREFIX="$root/prefix"
"$cmake_bin" --build "$root/deps/jpeg-build" -j"$build_jobs"
"$cmake_bin" --install "$root/deps/jpeg-build"
(cd "$root/deps/lcms2-2.19.1"; CC=clang CFLAGS="$flags" ./configure \
  --prefix="$root/prefix" --disable-shared --enable-static --without-jpeg --without-tiff; make -j"$build_jobs"; make install)
(cd "$root/deps/LibRaw-0.22.2"; make -f Makefile.dist -j"$build_jobs" lib/libraw_r.a CXX=clang++ \
  CFLAGS="-std=c++20 $flags -I. -DLIBRAW_MAX_THUMBNAIL_MB=32")
echo "V2 dependencies built. This is not fixture qualification or deployment."
