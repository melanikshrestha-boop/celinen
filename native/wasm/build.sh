#!/bin/sh
# Compile the C++ engines to WebAssembly for the hosted site.
#   sh native/wasm/build.sh        (from the repository root)
# Needs Emscripten's em++ on PATH, or EMSDK pointing at an activated emsdk.
# The .wasm outputs are committed so deploys and CI never need the toolchain;
# rebuild and commit them whenever native/src/develop*.cpp or voice.cpp change.
# tests/develop-wasm.test.ts and tests/voice-wasm.test.ts run the committed binaries.
set -eu
cd "$(dirname "$0")/../.."
if ! command -v em++ >/dev/null 2>&1; then
  if [ -n "${EMSDK:-}" ] && [ -f "$EMSDK/emsdk_env.sh" ]; then
    # shellcheck disable=SC1091
    . "$EMSDK/emsdk_env.sh" >/dev/null 2>&1
  else
    echo "em++ not found. Install emsdk (https://emscripten.org) and set EMSDK." >&2
    exit 1
  fi
fi

# Standalone reactor modules: no JS glue, no filesystem, no main(). Exceptions
# use native wasm EH so a rejected recipe is an error message, not an abort.
COMMON="-std=c++20 -O3 -DNDEBUG -Inative/include -fwasm-exceptions
  -sSTANDALONE_WASM=1 --no-entry -sALLOW_MEMORY_GROWTH=1 -sFILESYSTEM=0"

# 36MP bound: RGBA in + float working set + blur scratch + RGBA out. 2 GiB is
# the most every shipping browser grants wasm32; smaller devices fail the
# allocation and the engine reports it instead of crashing.
# shellcheck disable=SC2086
em++ $COMMON -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY=2147483648 \
  native/src/develop.cpp native/src/develop_auto.cpp native/wasm/develop_wasm.cpp \
  -sEXPORTED_FUNCTIONS=_celinen_error,_celinen_engine,_celinen_alloc,_celinen_release,_celinen_source,_celinen_develop,_celinen_result_width,_celinen_result_height,_celinen_result_pixels,_celinen_result_release,_celinen_suggest \
  -o src/lib/develop/wasm/celinen-develop.wasm

if [ -f native/wasm/voice_wasm.cpp ]; then
  # shellcheck disable=SC2086
  em++ $COMMON -sINITIAL_MEMORY=4194304 -sMAXIMUM_MEMORY=67108864 \
    native/src/voice.cpp native/wasm/voice_wasm.cpp \
    -sEXPORTED_FUNCTIONS=_celinen_voice_open,_celinen_voice_input,_celinen_voice_push,_celinen_voice_level,_celinen_voice_speaking,_celinen_voice_segment_samples,_celinen_voice_segment,_celinen_voice_segment_release,_celinen_voice_flush \
    -o src/lib/voice/wasm/celinen-voice.wasm
fi
ls -l src/lib/develop/wasm/celinen-develop.wasm src/lib/voice/wasm/celinen-voice.wasm 2>/dev/null
