# RapidRAW reference and original C++ engine plan

Updated 2026-09-04. Status: **C++ import/analysis and conservative burst review are integrated into local Studio** through a development-only loopback transport. The existing web interface at https://lenslab.dev/studio remains the visual reference: C++ is the processing-engine boundary, not a native UI rewrite. Deadline sets reuse the existing browser renderer for exact compatibility with current Studio edits; they are not native-rendered exports.

Verification now covers **541 web/transport/workflow tests and 4,536 native checks**: core 462, decoder 72, pipeline 172, worker protocol 337 and burst grouping 3,493. Native release and AddressSanitizer/UndefinedBehaviorSanitizer component checks passed. Limited earlier standalone repeated-fixture timings are recorded in [native benchmarks](../native/BENCHMARKS.md); they do not measure the new integrated workflow. A representative 3,000-unique-photo sports assignment and photographer-labeled quality benchmark remain acceptance gates. Neither test counts nor repeated fixtures establish 90% accuracy or “world's fastest” performance.

## What the reference actually uses

The read-only audit inspected [RapidRAW](https://github.com/CyberTimon/RapidRAW/tree/ec50408e91f86f1422687c1a804c8eeb623c153a), pinned to `ec50408e91f86f1422687c1a804c8eeb623c153a`. Its source was temporarily cloned for inspection, not incorporated into LensLabs. No RapidRAW code, shaders, models or assets were copied into this implementation.

RapidRAW uses Rust/Tauri for native processing, React/TypeScript for UI, and WGSL/WGPU for GPU rendering. RAW decoding uses a `rawler`/DngLab fork, not LibRaw. Local AI uses Rust bindings to ONNX Runtime. See [Cargo.toml:17](https://github.com/CyberTimon/RapidRAW/blob/ec50408e91f86f1422687c1a804c8eeb623c153a/src-tauri/Cargo.toml#L17) and [package.json:21](https://github.com/CyberTimon/RapidRAW/blob/ec50408e91f86f1422687c1a804c8eeb623c153a/package.json#L21).

Python is not its normal editing engine. The main repository's Python script [updates translation JSON](https://github.com/CyberTimon/RapidRAW/blob/ec50408e91f86f1422687c1a804c8eeb623c153a/src/i18n/update_translations.py#L143). Its separate optional [AI Connector](https://github.com/CyberTimon/RapidRAW-AI-Connector) is Python middleware for ComfyUI. Native dependencies may themselves contain C/C++; changing the application's language alone is not a speed benchmark.

## Implementation status and feature roadmap

Statuses describe this C++ effort, not replacement of existing browser features. “Verified core” means the bounded local checks above passed, not production release or feature parity. Upstream feature groups are grounded in its [feature inventory](https://github.com/CyberTimon/RapidRAW/blob/ec50408e91f86f1422687c1a804c8eeb623c153a/README.md#L515).

| Feature group | Current C++ status | Next acceptance boundary |
|---|---|---|
| Intake and preview | Local Studio integration: four persistent C++ workers, ImageIO previews, bounded upload/preview cache, explicit receipts and failure handling; standalone nested discovery retained | Representative RAW/camera set, durable jobs and 3,000 unique originals |
| Culling and similarity | Native focus/exposure/aHash signals and conservative review groups; time-based groups need compatible camera identity/clock evidence, otherwise appearance-only | Photographer-labeled sports quality, action/subject understanding and full-shoot latency; no automatic deletion |
| Everyday editing | C++ non-destructive exposure, contrast, highlights, shadows and saturation exist as a preview renderer; Studio retains its current browser edit renderer | Native edit parity including crop/warmth, history integration and color fidelity; preview JPEG is not full RAW |
| Export and automation | Existing Studio now prepares keeper-only deadline ZIPs with a frozen edit/source manifest, cancellation, failed-frame retry and explicit local download; standalone native JPEG encoder remains no-clobber | Native-rendered edit fidelity, embedded IPTC, expanded formats and approved remote delivery |
| Library workflow | Native processing feeds the existing Studio without changing its layout; saved shoots, picks and browser workflow remain in place | Durable preview cache, restartable jobs, expanded metadata and batch/history integration |
| RAW, color and optics | System-supported previews only | Full RAW development, profiles, curves/HSL, lens corrections, geometry and color-fidelity fixtures |
| GPU and photographic effects | Not implemented this pass | Profile before GPU work; tiling, display transfer, detail, denoise, LUTs, grain, glow and depth blur |
| Masks and retouching | Not implemented this pass | Brush/AI masks, clone/heal, skin tools, object removal; model rights and local/privacy gates |
| Multi-image processing | Not implemented this pass | HDR, panorama, focus stacking, collage and negative conversion |
| Capture and delivery | Local deadline download only; no production-native transport or external delivery confirmation | Tethering, camera controls, secure remote destinations, expanded formats, embedded metadata and durable batch reliability |

Current interfaces: [engine.hpp](../native/include/lenslabs/engine.hpp), [pipeline.hpp](../native/include/lenslabs/pipeline.hpp), [worker.hpp](../native/include/lenslabs/worker.hpp), [bursts.hpp](../native/include/lenslabs/bursts.hpp). Source: [analysis](../native/src/analysis.cpp), [pipeline](../native/src/pipeline.cpp), [ImageIO adapter](../native/src/decode_mac.cpp), [worker protocol](../native/src/worker.cpp), [burst grouping](../native/src/bursts.cpp). The web boundary is [development transport](../src/server/native-studio-plugin.ts) → [browser client](../src/lib/studio/native-client.ts); [deadline export](../src/lib/studio/deadline-export.ts) coordinates the existing browser renderer and ZIP helper. [Build and verification commands](../native/README.md) cover all five native test executables.

## Architecture and performance gates

The implemented local boundary is UI intent → validated native job → preview/results → explicit photographer acceptance. Vite exposes serve-only `/__native/status`, `/__native/analyze` and `/__native/bursts` routes, with exact loopback Host/port validation and matching Origin/session-token requirements for processing POSTs. This is not a production native bridge and is unavailable on the public deployed site. Native decode/analysis kernels and burst grouping run in C++; the existing React UI and local request transport are retained.

Four persistent C++ workers accept sources up to 128 MiB, returning at most 1,280px previews with 256px analysis. The preview cache is bounded by 64 MiB and 256 entries, keyed by uploaded-source SHA-256 and the executable fingerprint. The standalone CLI still has its separate metadata-identity analysis cache. Neither cache is durable project storage. Missing native binaries permit the existing browser import fallback; failed native jobs surface explicit errors. Keep originals separate from working pixels and generated outputs. Cancellation must be checked at the workflow boundary; do not promise immediate interruption of an operating-system decoder.

Deadline delivery is deliberately a separate compatibility path: existing browser-rendered JPEGs, only photographer-approved keepers, maximum 200 frames/2,048px/100 MiB ZIP, and a frozen source/edit version manifest. Retry retains successful frames, but any failures or stale selection/edit/source state block final download. Caption and copyright remain sidecar metadata, not embedded IPTC. Nothing is sent remotely; no accepted picks are inferred from grouping recommendations.

Learn from RapidRAW's [latest-request preview scheduling](https://github.com/CyberTimon/RapidRAW/blob/ec50408e91f86f1422687c1a804c8eeb623c153a/src/hooks/useImageProcessing.ts#L277), [visible-region GPU tiles](https://github.com/CyberTimon/RapidRAW/blob/ec50408e91f86f1422687c1a804c8eeb623c153a/src-tauri/src/gpu_processing.rs#L1303), caching and bounded exports, without translating its implementation. These choices trade work and memory against latency; C++ alone supplies none of those guarantees.

Measure separately:

- **Cold decode:** unique originals, first usable result, total decode/analysis time, failures and peak memory. Record machine, formats, resolution and cache conditions.
- **Warm cache:** report cache hits separately. Repeating a few fixtures is not a 3,000-photo benchmark.
- **Real sports shoot:** at least 3,000 unique photos; separate discovery, decode, analysis and grouping costs. Measure keeper recall, precision, important-moment/subject coverage and photographer correction time separately; establish thresholds with labeled shoots.
- **Native/UI integration:** measure the now-connected local path's input-to-preview latency, frame responsiveness, cancellation, cache behavior and stale-result protection while processing continues. Measure deadline JPEG preparation/download separately because it uses the existing browser renderer.

RapidRAW's [culling module](https://github.com/CyberTimon/RapidRAW/blob/ec50408e91f86f1422687c1a804c8eeb623c153a/src-tauri/src/culling.rs#L125) uses thumbnail heuristics and perceptual similarity, not sports-aware action or jersey understanding. Neither that source nor our mechanical signals proves sports accuracy or “world's fastest” performance.

## Licensing and release boundary

RapidRAW is [AGPL-3.0](https://github.com/CyberTimon/RapidRAW/blob/ec50408e91f86f1422687c1a804c8eeb623c153a/LICENSE#L183), including modified network-interaction obligations. Translating covered code into C++ does not erase those obligations; “copy all” is not the default plan.

Separate assets/dependencies need separate review: [the locked `rawler` fork](https://raw.githubusercontent.com/CyberTimon/RapidRAW-DngLab/3289454e9a65f5c973594687cca35602fa8181e3/rawler/Cargo.toml) declares LGPL-2.1; [Lensfun](https://raw.githubusercontent.com/lensfun/lensfun/master/README.md) distinguishes LGPL-3.0 library from CC BY-SA 3.0 profiles; [Spektrafilm LUTs](https://github.com/CyberTimon/RapidRAW/blob/ec50408e91f86f1422687c1a804c8eeb623c153a/src-tauri/resources/film_luts/SPEKTRAFILM_LICENSE.txt#L46) use CC BY-SA 4.0; the optional connector is Apache-2.0. Model/runtime provenance is not cleared by download hashes. This is not legal clearance.

Keep the [existing chat workspace](CHAT-WORKSPACE.md) and [platform roadmap](product/PRODUCT-PLAN.md) intact. This pass does not deliver GPU rendering, full RAW, AI models, masks, HDR, tethering, or production portal/auth/payment infrastructure.
