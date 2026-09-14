#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p build-v2/service-deps
curl --fail --location --max-time 120 --max-filesize 1000000 \
  https://raw.githubusercontent.com/yhirose/cpp-httplib/278c2979e8c68468960c3073e28e1c51b098d6a4/httplib.h \
  -o build-v2/service-deps/httplib.h
actual=$(shasum -a 256 build-v2/service-deps/httplib.h | cut -d ' ' -f 1)
test "$actual" = 1f99e51881c4c9d0649b27c611442c2f4d9bcfec5a22a14d5fcd1f8106f730b4
curl --fail --location --max-time 120 --max-filesize 100000 \
  https://raw.githubusercontent.com/yhirose/cpp-httplib/278c2979e8c68468960c3073e28e1c51b098d6a4/LICENSE \
  -o build-v2/service-deps/LICENSE
actual=$(shasum -a 256 build-v2/service-deps/LICENSE | cut -d ' ' -f 1)
test "$actual" = 4b45cbe16d7b71b89ae6127e26e0d90a029198ca5e958ad8e3d0b8bbed364d8b
