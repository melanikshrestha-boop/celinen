# FOTO local C++ engines

The current FOTO workspace shares canonical, account-and-shoot-scoped photo and
review records between Cull and Develop. Develop uses `lenslabs-develop` for
editing and JPEG export; legacy Studio renderer descriptions later in this file
are historical, not an alternate renderer for current canonical treatments.
See [Develop capabilities and gaps](../docs/FOTO-DEVELOP-PARITY.md) and
[dated verification milestones](../docs/FOTO-DEVELOP-SPRINT.md). This is a local
macOS implementation, not a published native service or a completed Lightroom
replacement.

## Current local build and workflow

On a fresh macOS checkout, build the pinned native dependency and executables
before opening Develop:

```sh
npm i
sh native/bootstrap-libraw.sh
make -C native -j4
npm run dev:lab
```

Open `http://127.0.0.1:8085/shoots` and enter the selected shoot's Develop tab.
The `/develop` compatibility route retains supported project/shoot bindings.
The separate lab command keeps local development identity out of the production
configuration. Native binaries, original photos and local environment files are
not part of the Git handoff. Owner login, publication and live Google sign-in
must be verified separately; local lab operation does not prove any of them.

Canonical imports retain exact source fingerprints and original bytes, commit
photo/document receipts atomically, and preserve existing IDs and histories.
Legacy metadata and unresolved edit/crop intent remain archived without claiming
pixel-equivalent conversion; historical Studio versions and old stores are not
rewritten. Review projection must not send a native treatment through the legacy
browser renderer as though the two recipes were interchangeable.

Import registration means discovering browser file handles, not completing RAW
decode or durable storage. The UI reports those phases separately; its new-import
analysis remains pending until real analysis is recorded. Registration targets
are not decode/save guarantees. Native source registration/receipt reuse is not
yet implemented, so persistent browser storage does not eliminate subsequent
native source transfers or decoding. See the
[performance measurement boundaries](../docs/FOTO-DEVELOP-PERFORMANCE.md).

Develop provides exposure/color/presence, master and independent RGB point curves,
HSL, tonal color grading, deterministic film effects and highlight falloff,
detail, crop/straighten/rotate/flip, and
manual radial/linear masks. Recipes, snapshots and history are kept separately
from originals. `GET /__develop/status` and protected `POST /__develop/render`
are loopback development routes, not a hosted production API. Source RAW export
uses LibRaw sensor demosaic; saved-preview export is separately labeled.
Preview export displays the exact JPEG bytes that will be downloaded, with
source/recipe/size/quality invalidation and cancellable sensor processing.
Recovery files can restore explicitly selected treatments as undoable history
steps without replacing originals or current review metadata.
Current output is JPEG/sRGB with a 4,096px default long edge and an explicit
8,192px / 36-million-pixel option, without upscaling. Both output caps apply;
this is not unlimited original resolution or a complete 16-bit Lightroom
pipeline. RAW source bounds remain 128 MiB / 60 MP and JPEG output is capped at
32 MiB. Larger renders use an exclusive processing lease. Experimental object
removal has a separate 4,096px cap and produces a separate copy. Other operating
systems still require a decoder/encoder adapter. Stored process models retain
their version semantics; the continuous RAW white-balance foundation is not
silently activated for existing recipes or advertised as a completed editor fix.

## Hosted engines (WebAssembly)

lenslab.dev cannot spawn `lenslabs-develop`, so the same C++ is compiled to
WebAssembly and run in the browser. There is no second renderer: `develop()`,
`read_develop_protocol()` and the recipe text protocol are shared byte for byte.

- `native/wasm/develop_wasm.cpp` → `src/lib/develop/wasm/celinen-develop.wasm`.
  Runs in a Web Worker. The decoded photo stays resident in the engine, so a
  slider drag sends only recipe text. Measured in Chromium on an M-series Mac at
  the 1,600px preview: about 60 ms for basic tone, about 200 ms for a heavy
  recipe (curve, mixer, clarity, sharpening, grain, vignette, straighten).
  JPEG/PNG/WebP sources only: sensor RAW, automatic crop, reference match and
  object removal still need the local executables.
- `native/src/develop_auto.cpp` measures a frame and solves exposure, contrast,
  highlights, shadows, whites, blacks, white balance and vibrance against
  `develop.cpp`'s own tone equations (the Auto button). Deterministic statistics,
  not a trained model.
- `native/wasm/voice_wasm.cpp` → `src/lib/voice/wasm/celinen-voice.wasm`. The
  dictation front end (`native/src/voice.cpp`): DC removal, band-limited
  resampling to 16 kHz PCM16, adaptive-noise-floor voice activity detection and
  utterance segmentation. `public/voice/capture.worklet.js` only forwards
  microphone samples to it.

```sh
sh native/wasm/build.sh        # needs Emscripten (em++ on PATH, or EMSDK set)
bun test tests/develop-wasm.test.ts tests/voice-wasm.test.ts
```

The `.wasm` files are committed so deploys and CI never need the toolchain.
Rebuild and commit them whenever `develop*.cpp` or `voice.cpp` change; the two
test files above execute the committed binaries. The site's CSP allows
WebAssembly compilation with `'wasm-unsafe-eval'` only; scripts still cannot `eval`.

## Historical Studio transport and standalone CLI reference

The following notes preserve the September 7 preview/culling milestone, its
legacy UI/export behavior, source audit and measured results. They do not imply
that the current canonical import automatically runs analysis, that legacy
deadline/social exports support native Develop treatments, or that those old
test counts describe the current checkout. Standalone CLI commands and their
bounds are distinct from the current Develop transport above.

Original C++20 implementation with pinned LibRaw 0.22.2 for embedded RAW JPEG previews. No Python, Rust, Node runtime or downloaded AI model is required by this executable. macOS builds link Apple's installed ImageIO, CoreGraphics and CoreFoundation frameworks for bounded raster decoding and sRGB JPEG output.

**Historical status (September 7):** the C++ engine was connected to the existing local Studio for import previews, analysis and conservative burst review. The React interface was retained; it was not a native desktop rewrite or full RapidRAW replacement. This connection was **development-only on loopback**, not a deployed native service. Deadline JPEG export retained the existing browser renderer for that milestone's edit compatibility. See the [RapidRAW audit and migration gates](../docs/RAPIDRAW-CPP-PLAN.md).

## Build and verify

From this repository:

```sh
sh native/bootstrap-libraw.sh
make -C native -j4
make -C native test
make -C native sanitize
native/build/lenslabs-native --help
```

Requires Apple's Command Line Tools, `clang++` with C++20, and `make`. The explicit bootstrap downloads a checksum-pinned source archive and builds only a local static dependency under ignored `native/build/deps`; it does not install globally. Pass a previously downloaded archive as its argument for offline setup. Ordinary `make` never downloads anything. CMake/`lenscull_core` packaging from the larger culling brief is still pending. Sanitizer builds are separate from release builds and should never supply performance numbers.

With the optional Sony corpus below, historical native verification was 32,207 checks across the core (462), decoder (128), pipeline (172), worker protocol (337), burst grouping (3,493), and social framing (27,615) suites. Release and sanitizer component checks passed at that milestone. The sanitizer build instruments LensLabs code; the separately built LibRaw static dependency is not sanitizer-instrumented. These counts establish regression coverage, not photographic accuracy, unique-photo throughput or current release totals.

The [local workflow backtest](../docs/NATIVE-WORKFLOW-BACKTEST.md) records the real browser run, fixture timings, downloaded JPEG checksums and the remaining labeled-shoot benchmark.

## Historical local Studio integration

Build the native executables, start the existing web app with `npm run dev`, and open the loopback Studio URL printed by Vite. Keep the normal Studio folder-drop workflow. No interface migration, Python conversion, or native desktop installation is required.

The [Vite development transport](../src/server/native-studio-plugin.ts) exposes local routes:

- `GET /__native/status`: reports engine availability and the local session token.
- `POST /__native/analyze`: processes one uploaded source through a C++ worker.
- `POST /__native/bursts`: groups validated analysis receipts in C++ for photographer review.
- `POST /__native/people`: clusters event-local 512-d face embeddings in C++ (InsightFace matching math). Never names people. Does not download buffalo weights. See [InsightFace](INSIGHTFACE.md).
- `POST /__native/social-frame`: creates a bounded social JPEG from an uploaded edited copy in C++; availability is reported as `socialReady` by the status route.

The serve-only transport validates the exact loopback Host/port and request marker; processing POSTs also require the matching Origin and session token. It does not expose arbitrary filesystem paths or a public production API. Four persistent C++ workers handle sources up to **128 MiB each**, returning an upright preview up to **1,280px** and measurements made at **256px**. Temporary input files are separate from the photographer's originals.

The transport's in-memory preview cache is limited to **64 MiB and 256 entries**. Keys include the uploaded bytes' SHA-256 and the native executable's fingerprint, so rebuilding the executable cannot silently reuse old-engine results. This is distinct from the standalone scan command's metadata-based analysis cache described below; neither is durable shoot storage.

When the native engine is absent, the existing browser import path remains available. A job that starts on the native path and fails is reported explicitly rather than silently changing processing backends. Grouping with camera-time confidence requires compatible clock semantics and a device-level camera identity; missing evidence produces appearance-only candidates, not invented burst timing. Suggestions preserve the photographer's picks and require review. These groups do not understand peak action, faces, players or jersey numbers.

## Historical deadline-set workflow

The existing Studio menu and supported chat command open a secondary deadline workflow without replacing the main layout. A set contains only previously chosen keepers, in Studio order: 1–200 frames, JPEGs with a maximum 2,048px edge, and one local ZIP capped at 100 MiB. It snapshots exact files, edits and crop focus; changed membership, source identity or edits invalidate the preview before download.

Preparation is serial, cancellable and retryable. Failures are listed per frame; incomplete sets cannot be downloaded as a successful delivery. The final **Download deadline set** action requires explicit approval and does not send anything to a client. JPEG dimensions, byte counts, source/output checksums and exact edit-version hashes accompany caption/copyright in `manifest.json`—**sidecar metadata, not embedded IPTC**.

This workflow reuses the **existing Studio browser renderer**, including warmth and crop, rather than substituting the native preview renderer's different tone math. RAW inputs use their embedded preview in this export path; neither it nor the native preview engine is full RAW development. A browser download request is not proof of external delivery.

## Historical post and Story framing

The Studio **Shoot actions → Share to social** flow calls `lenslabs-social`. It produces 1080×1350 portrait, 1080×1080 square, or 1080×1920 Story JPEGs with fit/fill, positioning, zoom, and black/white padding. Source files remain unchanged. The operator writes JPEG bytes to stdout:

```sh
native/build/lenslabs-social /path/to/input.jpg story fit 0.5 0.5 1 black
```

Capture stdout through an application pipe rather than running this binary directly in an interactive terminal. Inputs receive the same bounded ImageIO preview decode used by the native engine. The new social kernel has 27,615 regression assertions and is included in `make test` and `make sanitize`.

Existing Studio edits are preserved through the browser renderer before native framing. The OAuth/provider bridge remains TypeScript, and the current Cloudflare deployment cannot execute this macOS binary. See [social connectors and deployment requirements](../docs/SOCIAL-CONNECTORS.md) for the exact supported scope and live-publishing gates.

## Read a shoot

```sh
native/build/lenslabs-native scan "/path/to/shoot" --threads 4
```

Folder discovery is recursive and cancellable. It reports unreadable directories and limit truncation, ignores symlinks/non-photo extras, and preserves relative paths. Decoding and analysis run on a bounded worker pool. Ctrl-C stops scheduling and waits for active system decoder calls to return.

NDJSON receipts arrive as frames complete; `index` is the stable discovered index, not completion order. Receipts include oriented source/preview dimensions, focus/exposure statistics, a perceptual hash, a suggested verdict, and at most 32 prior similar-frame candidates. Truncated similarity lists are explicit. No suggestion is accepted, no source file is changed, and hash similarity alone never rejects a photo. Group candidates are not ranked by artistic quality.

The in-process LRU stores analysis, **not full image buffers**, with a configurable 0–4,096 entry limit. Identity includes path, size, modification time, device, inode and change time. Sources are rechecked on cache hits and around processing; the decoder also checks its held file descriptor. This is cache invalidation, not a cryptographic archive-integrity guarantee.

Default analysis edge: 256px. Changing it changes sharpness measurements; do not compare quality thresholds across resolutions without calibration. These are deterministic mechanical signals, not face/eyes/jersey recognition or a learned sports model.

## Render a new preview

```sh
native/build/lenslabs-native render "/path/input.jpg" "/path/new-preview.jpg" \
  --edge 1600 --exposure 0.5 --contrast -10 --highlights -40 \
  --shadows 20 --saturation -5
```

This writes a **new**, upright sRGB JPEG of bounded resolution. Exposure is EV; other controls use -100…100. Existing paths, originals and symlink destinations are not overwritten. A private temporary file is flushed and published with a no-clobber operation. Failed publication removes only that private temporary file.

The renderer copies the input buffer. Zero adjustments preserve RGBA bytes exactly before JPEG encoding. Nonzero adjustments are simple whole-image operations on an 8-bit sRGB preview—not scene-linear, high-bit-depth RAW processing or Adobe pixel parity. JPEG export embeds sRGB and upright orientation; it does **not** preserve the source's complete EXIF/IPTC metadata.

## Bounds and platform

These are standalone CLI/kernel bounds; the Studio transport uses the stricter 128 MiB source and 1,280px preview limits above.

- Sources: regular files, nonempty, at most 512 MiB and 250 million metadata pixels.
- Preview decode: maximum edge 8–4,096; no unbounded full-resolution fallback.
- Analysis/render kernel: 3–8,192px per edge, at most 16 Mi pixels; tiny/narrow images can be refused by analysis.
- Pool: 1–16 requested workers, reduced by an estimated 256 MiB budget for simultaneous RGBA plus luma kernel buffers. ImageIO's internal allocations are additional; this is **not a hard process RSS ceiling**.
- Discovery: at most 100,000 photos, 500,000 entries, and 64 nested levels.
- Processing: at most 100,000 operations. Cancellation returns partial receipts with an explicit summary.

Recognizing a RAW filename extension does not establish camera support. LibRaw identifies the source from bytes, including extensionless Studio uploads, and extracts its embedded JPEG without unpacking or developing sensor data. ImageIO then decodes that JPEG, preserving its orientation and converting to sRGB. Each job owns a heap-allocated LibRaw instance and reads the validated file descriptor through a bounded stream; no whole-RAW buffer, mmap or path reopen is used. The compile-time thumbnail allocation cap is 32 MiB, embedded JPEG pixel limit is 32 Mi pixels, and cumulative parser-read budget is 128 MiB. These are layered bounds, **not a hard process RSS ceiling**.

Unsupported/missing/non-JPEG RAW previews remain explicit errors for review. This is not full RAW development, a sensor-integrity check, RAW highlight-recovery analysis, or universal camera support. An intact JPEG preview cannot prove the sensor payload is intact. Ordinary raster formats continue through ImageIO. Other operating systems still need a raster/color-management adapter.

## Sony RAW regression, 2026-09-07

The old engine failed both real samples below: the A6000 reported no ImageIO source, and the A7 IV reported invalid/absent dimensions. This reproduced the user's **class of failure**, not the exact `DSC6973.ARW`, which was not supplied. The new decoder test failed before the change and passes afterward.

The first implementation also exposed a macOS worker-thread stack overflow in LibRaw construction (`___chkstk_darwin`, verified with LLDB). Each decoder is now independently heap-owned. The regression uses an actual worker thread rather than just the main-thread stack.

Fetch these separately into a test directory, verify checksums, name them as below, and set `LENSLABS_RAW_FIXTURES` when running `make -C native test` or `make -C native sanitize`. No test silently downloads a corpus. Without the variable the suite explicitly prints a RAW-fixture skip. Both are listed as CC0 in the [raw.pixls.us catalog](https://raw.pixls.us/json/getrepository.php), checked 2026-09-07; they are technical fixtures, not endorsements or photographer-quality ground truth.

| Local name | Original test asset | SHA-256 |
| --- | --- | --- |
| `sony-a6000.ARW` | [Sony A6000 compressed, catalog 1971](https://raw.pixls.us/getfile.php/1971/nice/Sony%20-%20ILCE-6000%20-%2012bit%2012bit%20compressed%20(3:2).ARW), 25,624,576 bytes | `ce8b4957281a817d52a07a691e2468567b6c78223bd0b514ffc1c65b002b8d89` |
| `sony-a7iv-small.ARW` | [Sony A7 IV lossless-small, catalog 6931](https://raw.pixls.us/getfile.php/6931/nice/Sony%20-%20ILCE-7M4%20-%204:3.ARW), 22,933,504 bytes | `cbbd0930c7d8706dff84c68a2004454266e6fd0d8354f5f76a106b5d776e0223` |

Tests cover useful bounded previews, extensionless uploads, byte preservation, JPEG encode/reopen, malformed/truncated inputs, and 90/180/270-degree orientation on disposable copies (both geometry and actual corner pixels). Decoded capture dimensions are 6024×4024 and 3516×2344; the 1280px previews are 1280×855 and 1280×853. Capture dimensions come from LibRaw; the existing Studio label continues to show working-preview dimensions.

One isolated browser shoot imported both via the actual loopback C++ transport (UI reported two C++ imports in about 0.7 seconds), displayed inspected photo previews, and preserved manual Keep/Reject choices through reload and original reconnection. The existing browser **Export frame** produced a 3,072,314-byte JPEG that reopened via `createImageBitmap` at 3504×2336. The QA tool could not retrieve its blob URL to disk, so this verifies generated bytes and browser decoding, not a downloaded file on the user's machine. This export still uses the existing browser renderer, not a newly substituted C++ exporter. The full app suite passed 1,063 tests, 0 failures, 193,629 assertions across 67 files. This does not exercise every camera, model, or a real client account.

Repeated-decoding smoke test: **1,000 uncached operations on these same two RAW files**, four workers, 256px analysis edge, normal warm OS cache, `--quiet`, 2026-09-07. Hardware: Apple M3 Pro, 18 GiB RAM; macOS 14.3 (23D56), Apple clang 15.0.0, LensLabs C++20 `-O3`, LibRaw `-O2`. Result: 1,000 decoded, zero failures, 4.985 seconds, first result 39.2 ms, process peak RSS 244.6 MiB. This excludes similarity serialization, uploads, browser UI and native dependency compilation. It is **not a 1,000-unique-photo throughput benchmark**, keeper-recall test or proof of 20,000-photo capacity.

## Dependency and reference audit for the culling brief

- Adopted: [LibRaw 0.22.2](https://github.com/LibRaw/LibRaw/tree/b93f6e45c194f5df9b02a43b1af9a54b4f41f33f), revision `b93f6e45c194f5df9b02a43b1af9a54b4f41f33f`; official archive SHA-256 `de86b035655accff8d4010f1a221fdf50d353cb7b1422ba26f14a0db92612cfa`. Its [COPYRIGHT](https://github.com/LibRaw/LibRaw/blob/b93f6e45c194f5df9b02a43b1af9a54b4f41f33f/COPYRIGHT) offers LGPL-2.1 or CDDL-1.0; this integration selects CDDL-1.0 and retains both notices plus the exact source archive. Before binary distribution, package the applicable notices and corresponding LibRaw source/access instructions; local build success is not distribution compliance approval. No upstream source was patched. Build uses upstream `Makefile.dist`, thread-safe `libraw_r`, no OpenMP, JPEG/DNG SDK/LCMS/RawSpeed/model integrations. [LibRaw's C++ API](https://www.libraw.org/docs/API-CXX.html) is the extraction/recycling reference.
- Reference only: [QuickRawPicker](https://github.com/RawLabo/QuickRawPicker/tree/c4498975fb25a81b9a705fca277f96b9320ce8f8), revision `c4498975fb25a81b9a705fca277f96b9320ce8f8`. LICENSE contains LGPL-2.1 and identifies LibRaw/libjpeg-turbo. No application code copied or linked.
- Reference only: [Facet](https://github.com/ncoevoet/facet/tree/12268910398f11b09090c8adae4083e9c99a1caa), revision `12268910398f11b09090c8adae4083e9c99a1caa`. Application LICENSE is MIT; that does not establish licenses or calibration for its separately supplied models. No code or weights copied.
- Reference only: [SuperPicky](https://github.com/jamesphotography/SuperPicky/tree/5b57b011c8b7080500c28ad3132c070d2a503670), revision `5b57b011c8b7080500c28ad3132c070d2a503670`. Its actual LICENSE is AGPL-3.0, regardless of README/badge claims. No code or weights copied.
- [Current digiKam upstream](https://invent.kde.org/graphics/digikam) could not be retrieved in this pass. No revision/license compatibility conclusion was made and no source copied. Its audit remains open.
- No new model weights, OpenCV/ONNX/CoreML, libjpeg-turbo, hnswlib, SQLite or Adobe XMP SDK dependency has been selected. Their exact-version and model-weight license/accuracy audits remain required **before** adoption. Existing ImageIO performs the JPEG pixel decode in this slice; it is not presented as libjpeg-turbo.

This completes a bounded RAW-preview repair, **not the full sports-culling build brief**. Next work remains CMake/headless library packaging, durable native SQLite checkpoints and resumable scans, explicit unavailable/uncertain feature receipts, staged verified native exports, safe metadata/capture pairing, and event-held-out evaluation before learned face/eye/action models. No face/blink/jersey/peak-action model is introduced here. No 99% keeper-retention or 20,000-photo claim is supported by these two fixtures. The original Studio layout, auth, billing, settings, delivery and original files are unchanged; native support remains local-only.

## Measure honestly

Run benchmarks sequentially after compilation/testing has finished:

```sh
native/build/lenslabs-native scan tests/fixtures/photos --threads 1 --cache-entries 0 --repeat 100 --quiet
native/build/lenslabs-native scan tests/fixtures/photos --threads 4 --cache-entries 0 --repeat 100 --quiet
native/build/lenslabs-native scan tests/fixtures/photos --threads 4 --cache-entries 1024 --repeat 1000 --quiet
```

`--quiet` skips per-frame serialization and similarity lookup, so these commands measure decode/analysis/cache work—not the complete interactive culling workflow. OS filesystem cache state is not controlled. `repeat` reuses the **same three source photos**; 3,000 repeated operations are not 3,000 unique photos.

Measure a real assignment separately with cache disabled, no repeat, normal similarity receipts, fixed edge, source format/camera mix, first-preview latency, completion time and peak RSS. The local Studio transport must be measured end to end as a separate path: upload, native decode/analysis, preview return, grouping, UI responsiveness and cancellation. Its SHA-256 preview cache is not the CLI cache, so report those hits separately too. No comparison to RapidRAW, Adobe, or the existing browser implementation is established by these CLI measurements. No “world's fastest,” neural sports-understanding or 90%-accuracy claim is established.

Exit codes: 0 completed; 1 invalid invocation/fatal failure; 2 partial, failed, truncated or empty scan; 130 cancelled.
