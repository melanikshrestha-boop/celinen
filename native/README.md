# LensLabs C++ native preview engine

Original C++20 implementation. No Python, Rust, Node runtime, downloaded AI model, or third-party source package is required by this executable. macOS builds link Apple's installed ImageIO, CoreGraphics and CoreFoundation system frameworks.

**Status:** the C++ engine is connected to the existing local Studio for import previews, analysis and conservative burst review. The React interface is retained; it is not a native desktop rewrite or full RapidRAW replacement. This connection is **development-only on loopback**, not a deployed native service. Deadline JPEG export deliberately retains the existing browser renderer for current edit compatibility. See the [RapidRAW audit and migration gates](../docs/RAPIDRAW-CPP-PLAN.md).

## Build and verify

From this repository:

```sh
make -C native -j4
make -C native test
make -C native sanitize
native/build/lenslabs-native --help
```

Requires Apple's Command Line Tools, `clang++` with C++20, and `make`. No CMake installation is needed. Sanitizer builds are separate from release builds and should never supply performance numbers.

Current verification: 4,536 native checks across the core (462), decoder (72), pipeline (172), worker protocol (337) and burst grouping (3,493) suites. Release and sanitizer component checks passed. The web/transport/workflow suite has 541 passing tests. These counts establish regression coverage, not photographic accuracy or unique-photo throughput.

The [local workflow backtest](../docs/NATIVE-WORKFLOW-BACKTEST.md) records the real browser run, fixture timings, downloaded JPEG checksums and the remaining labeled-shoot benchmark.

## Use the engine in local Studio

Build the native executables, start the existing web app with `npm run dev`, and open the loopback Studio URL printed by Vite. Keep the normal Studio folder-drop workflow. No interface migration, Python conversion, or native desktop installation is required.

The [Vite development transport](../src/server/native-studio-plugin.ts) exposes three local routes:

- `GET /__native/status`: reports engine availability and the local session token.
- `POST /__native/analyze`: processes one uploaded source through a C++ worker.
- `POST /__native/bursts`: groups validated analysis receipts in C++ for photographer review.

The serve-only transport validates the exact loopback Host/port and request marker; processing POSTs also require the matching Origin and session token. It does not expose arbitrary filesystem paths or a public production API. Four persistent C++ workers handle sources up to **128 MiB each**, returning an upright preview up to **1,280px** and measurements made at **256px**. Temporary input files are separate from the photographer's originals.

The transport's in-memory preview cache is limited to **64 MiB and 256 entries**. Keys include the uploaded bytes' SHA-256 and the native executable's fingerprint, so rebuilding the executable cannot silently reuse old-engine results. This is distinct from the standalone scan command's metadata-based analysis cache described below; neither is durable shoot storage.

When the native engine is absent, the existing browser import path remains available. A job that starts on the native path and fails is reported explicitly rather than silently changing processing backends. Grouping with camera-time confidence requires compatible clock semantics and a device-level camera identity; missing evidence produces appearance-only candidates, not invented burst timing. Suggestions preserve the photographer's picks and require review. These groups do not understand peak action, faces, players or jersey numbers.

## Prepare a deadline set

The existing Studio menu and supported chat command open a secondary deadline workflow without replacing the main layout. A set contains only previously chosen keepers, in Studio order: 1–200 frames, JPEGs with a maximum 2,048px edge, and one local ZIP capped at 100 MiB. It snapshots exact files, edits and crop focus; changed membership, source identity or edits invalidate the preview before download.

Preparation is serial, cancellable and retryable. Failures are listed per frame; incomplete sets cannot be downloaded as a successful delivery. The final **Download deadline set** action requires explicit approval and does not send anything to a client. JPEG dimensions, byte counts, source/output checksums and exact edit-version hashes accompany caption/copyright in `manifest.json`—**sidecar metadata, not embedded IPTC**.

This workflow reuses the **existing Studio browser renderer**, including warmth and crop, rather than substituting the native preview renderer's different tone math. RAW inputs use their embedded preview in this export path; neither it nor the native preview engine is full RAW development. A browser download request is not proof of external delivery.

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

Recognizing a RAW filename extension does not establish camera support. ImageIO decides what this installed macOS can decode; unsupported/truncated images produce per-file errors. Tests currently use JPEG/PNG/TIFF fixtures, **not a representative RAW-camera set**. Other operating systems need a decoder adapter before this CLI can build there.

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
