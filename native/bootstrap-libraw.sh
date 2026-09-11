#!/bin/sh
# Explicit, local-only dependency setup. No model downloads or global install.
set -eu
cd "$(dirname "$0")"
version=0.22.2
checksum=de86b035655accff8d4010f1a221fdf50d353cb7b1422ba26f14a0db92612cfa
mkdir -p build/deps
dependency_root="$(pwd)/build/deps"
prefix="$dependency_root/libraw-$version"
if [ -f "$prefix/lib/libraw_r.a" ] && [ -f "$prefix/include/libraw/libraw.h" ] && \
   [ -f "$prefix/share/licenses/LICENSE.CDDL" ]; then
  echo "LibRaw $version is already built locally."
  exit 0
fi
task_dir=$(mktemp -d "$dependency_root/libraw-setup.XXXXXX")
archive="$task_dir/LibRaw-$version.tar.gz"
if [ "$#" -eq 1 ]; then
  cp "$1" "$archive"
else
  curl --fail --location --show-error --max-time 120 --max-filesize 3000000 \
    "https://www.libraw.org/data/LibRaw-$version.tar.gz" -o "$archive"
fi
actual=$(shasum -a 256 "$archive" | cut -d ' ' -f 1)
[ "$actual" = "$checksum" ] || { echo "LibRaw checksum mismatch; nothing was built." >&2; exit 1; }
tar -xzf "$archive" -C "$task_dir"
cd "$task_dir/LibRaw-$version"
# No OpenMP oversubscription, external codecs, model weights or RAW development
# dependencies. JPEG preview pixels use the existing color-managed ImageIO path.
make -f Makefile.dist -j4 lib/libraw_r.a CXX=clang++ \
  CFLAGS="-std=c++20 -O2 -I. -DLIBRAW_MAX_THUMBNAIL_MB=32"
mkdir -p "$prefix/lib" "$prefix/include/libraw"
cp lib/libraw_r.a "$prefix/lib/"
cp libraw/*.h "$prefix/include/libraw/"
mkdir -p "$prefix/share/licenses"
cp COPYRIGHT LICENSE.CDDL LICENSE.LGPL "$prefix/share/licenses/"
echo "Built LibRaw $version locally. Source and licenses retained in $task_dir."
