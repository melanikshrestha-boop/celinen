#!/bin/sh
# Compile the C++ engines to WebAssembly for the hosted site.
#   sh native/wasm/build.sh        (from the repository root)
# Needs Emscripten's em++ on PATH, or EMSDK pointing at an activated emsdk.
# The .wasm outputs are committed so deploys and CI never need the toolchain;
# rebuild and commit them whenever native/src/develop*.cpp, look_match.cpp,
# upright.cpp, exif.cpp or voice.cpp change.
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
  native/src/develop.cpp native/src/develop_auto.cpp native/src/look_match.cpp native/src/upright.cpp \
  native/src/exif.cpp native/wasm/develop_wasm.cpp \
  -sEXPORTED_FUNCTIONS=_celinen_error,_celinen_engine,_celinen_alloc,_celinen_release,_celinen_source,_celinen_develop,_celinen_result_width,_celinen_result_height,_celinen_result_pixels,_celinen_result_release,_celinen_suggest,_celinen_look_size,_celinen_look_describe,_celinen_look_inputs,_celinen_look_match,_celinen_upright_forget,_celinen_upright_develop,_celinen_upright_solve \
  -o src/lib/develop/wasm/celinen-develop.wasm

# The cull engine: measured per frame in the analysis worker, then one
# shoot-level pass that ranks and groups what it measured.
# shellcheck disable=SC2086
em++ $COMMON -sINITIAL_MEMORY=16777216 -sMAXIMUM_MEMORY=536870912 \
  native/src/cull.cpp native/wasm/cull_wasm.cpp \
  -sEXPORTED_FUNCTIONS=_celinen_cull_error,_celinen_cull_reading_size,_celinen_cull_frame_size,_celinen_cull_row_size,_celinen_cull_source,_celinen_cull_faces,_celinen_cull_measure,_celinen_cull_judge_eyes,_celinen_cull_frames,_celinen_cull_shoot,_celinen_cull_release \
  -o src/lib/studio/cull/celinen-cull.wasm

# The RAW container API (which embedded JPEG is best, which way up it goes)
# is linked into ingest and into its own small module for the loupe and the
# preview worker, so every surface asks the same C++.
RAW_EXPORTS="_celinen_raw_input,_celinen_raw_inspect,_celinen_raw_kind,_celinen_raw_container_orientation,_celinen_raw_truncated,_celinen_raw_candidate,_celinen_raw_probe,_celinen_raw_describe,_celinen_raw_rank,_celinen_raw_order,_celinen_raw_orientation,_celinen_raw_retag,_celinen_raw_output,_celinen_raw_output_size,_celinen_raw_release"
FACE_EXPORTS="_celinen_ingest_model_input,_celinen_ingest_load_model,_celinen_ingest_faces_ready,_celinen_ingest_faces,_celinen_ingest_face_count,_celinen_ingest_face_fields,_celinen_ingest_reading_fields"

# Ingest: one call per photo — EXIF, one entropy decode kept as coefficients,
# the working frame, faces and eyes (YuNet, Face Mesh V2 and Blendshape V2 on
# the in-engine runtime), the cull measurement and the filmstrip thumbnail, so a
# ten-thousand frame card never waits on the browser's own decoder. libjpeg is
# Emscripten's own IJG port. The camera's AF area (maker note) and the
# focus-hit judgment ride along. Photos libjpeg cannot read arrive as
# browser-decoded RGBA (run_pixels). SIMD roughly halves the face models' time;
# every browser that runs the Studio has shipped WebAssembly SIMD since 2023.
# shellcheck disable=SC2086
em++ $COMMON -msimd128 --use-port=libjpeg -sINITIAL_MEMORY=67108864 -sMAXIMUM_MEMORY=1073741824 \
  native/src/cull.cpp native/src/exif.cpp native/src/focus_hit.cpp native/src/raw_preview.cpp \
  native/src/jpeg_coefficients.cpp native/src/faces.cpp \
  native/src/nn.cpp native/src/nn_onnx.cpp native/src/nn_tflite.cpp \
  native/wasm/ingest_wasm.cpp native/wasm/raw_wasm.cpp \
  -sEXPORTED_FUNCTIONS=_celinen_ingest_error,_celinen_ingest_metadata,_celinen_ingest_focus,_celinen_ingest_input,_celinen_ingest_run,_celinen_ingest_run_pixels,_celinen_ingest_damaged,_celinen_ingest_reading,_celinen_ingest_capture_time,_celinen_ingest_capture_utc,_celinen_ingest_camera,_celinen_ingest_source_width,_celinen_ingest_source_height,_celinen_ingest_frame_width,_celinen_ingest_frame_height,_celinen_ingest_thumbnail,_celinen_ingest_thumbnail_size,_celinen_ingest_pixels,_celinen_ingest_release,$RAW_EXPORTS,$FACE_EXPORTS \
  -o src/lib/studio/cull/celinen-ingest.wasm

# RAW inspection alone, for the loupe (main thread) and the preview worker.
# shellcheck disable=SC2086
em++ $COMMON -sINITIAL_MEMORY=2097152 -sMAXIMUM_MEMORY=268435456 \
  native/src/exif.cpp native/src/raw_preview.cpp native/wasm/raw_wasm.cpp \
  -sEXPORTED_FUNCTIONS=$RAW_EXPORTS \
  -o src/lib/studio/cull/celinen-raw.wasm

# Social framing: the same frame_social() the local tool runs, plus a libjpeg
# encoder, so the page produces the exact feed JPEG Instagram fetches.
# shellcheck disable=SC2086
em++ $COMMON --use-port=libjpeg -sINITIAL_MEMORY=16777216 -sMAXIMUM_MEMORY=268435456 \
  native/src/social.cpp native/wasm/social_wasm.cpp \
  -sEXPORTED_FUNCTIONS=_celinen_social_error,_celinen_social_source,_celinen_social_frame,_celinen_social_jpeg,_celinen_social_jpeg_size,_celinen_social_release \
  -o src/lib/social/wasm/celinen-social.wasm

if [ -f native/wasm/voice_wasm.cpp ]; then
  # shellcheck disable=SC2086
  em++ $COMMON -sINITIAL_MEMORY=4194304 -sMAXIMUM_MEMORY=67108864 \
    native/src/voice.cpp native/wasm/voice_wasm.cpp \
    -sEXPORTED_FUNCTIONS=_celinen_voice_open,_celinen_voice_input,_celinen_voice_push,_celinen_voice_level,_celinen_voice_speaking,_celinen_voice_segment_samples,_celinen_voice_segment,_celinen_voice_segment_release,_celinen_voice_flush \
    -o src/lib/voice/wasm/celinen-voice.wasm
fi
ls -l src/lib/develop/wasm/celinen-develop.wasm src/lib/studio/cull/celinen-cull.wasm src/lib/studio/cull/celinen-ingest.wasm src/lib/studio/cull/celinen-raw.wasm src/lib/social/wasm/celinen-social.wasm src/lib/voice/wasm/celinen-voice.wasm 2>/dev/null
