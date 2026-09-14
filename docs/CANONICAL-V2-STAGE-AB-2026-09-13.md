# Canonical V2 — Stage A/B local implementation report

Date: 2026-09-13. **Experimental only; not qualified for deployment.**

This is the historical Stage A/B report from the broader local branch. Its V1
counts, local evidence links and original image setup are not the isolated-main
handoff results. Use [the isolated handoff report](CANONICAL-V2-ISOLATED-HANDOFF.md)
for fresh-main counts, exact inclusion/exclusion scope and runnable setup.

V2 is now implemented as an isolated C++ library and test executable. It is not connected to a production processing route, UI, culling decisions, ratings, XMP, or export. V1 remains the production authority. No push, merge, deployment, original-photo modification, or golden-reference update was performed.

This is a new, versioned pixel contract, **not a claim that the previous Linux implementation now matches Apple V1**. The earlier investigation found divergence at decoded RGB, a separate small P3 color-conversion difference, and substantial resize/sharpness differences. Apple's private implementation/environment cause remains unproven. V2 removes those platform-specific operations from its own path; it does not adjust final brightness or sharpness scores to disguise drift.

## 1. Implementation and files changed

| File | Purpose |
|---|---|
| `native/include/lenslabs/canonical_v2.hpp` | Domain, limits, immutable verified source, owned pixels, control token, typed errors, provenance and stage receipts |
| `native/src/canonical_v2/source.cpp` | Read-only regular-file descriptor; full-content snapshot, reread/stat verification and hash |
| `native/src/canonical_v2/sha256.cpp` | Portable SHA-256 and known-answer coverage |
| `native/src/canonical_v2/primitives.cpp` | Integer geometry, area resize, exact orientation permutation, tensor hash and control checks |
| `native/src/canonical_v2/decode.cpp` | Bounded JPEG/EXIF/ICC parsing, shared JPEG and LCMS pipeline, allowlisted Sony preview extraction |
| `native/tests/canonical_v2_tests.cpp` | Primitive, geometry, source, cancellation and independent-thread unit checks |
| `native/tests/canonical_v2_decoder_tests.cpp` | JPEG contract cases and bounded malformed-prefix mutation tests |
| `native/tests/canonical_v2_probe.cpp` | Explicitly enabled, read-only fixture CLI; JSON receipts, no image/export writes |
| `native/canonical-v2.lock.json` | Exact artifact hashes, parameters, approved profile revision and disabled deployment flags |
| `native/bootstrap-canonical-v2.sh` | Checksum-verified local static dependency builds; separate instrumented build; bounded build parallelism |
| `native/v2.mk` | Separate build graph; no production Makefile target changes |
| `native/Dockerfile.v2-sanitizer-test` | Local test-image extension with missing Clang sanitizer runtime |
| `tests/canonical-v2-parity.mjs` | Mac/Linux fixture runner, stage hashes, negative cases, source-preservation checks, build receipts, fail-closed qualification result |
| `native/.gitignore` | Ignore isolated `build-v2/` artifacts |
| `docs/CANONICAL-DECODER-V2-SPEC.md` | Record subsequent implementation approval and approved dependency/profile supersession, retaining original draft history |
| This report | Evidence, limits, results and remaining release gates |

Other dirty/untracked files already present in this checkout were preserved. In particular, existing modifications to V1 sources and `native/Makefile` were not authored or reverted in this task.

## 2. Locked artifacts and reviewed revision

The owner explicitly approved ICC's licensed profile in place of the unverified HP artifact, and review of the pinned LCMS patch revision. The old HP artifact is not the V2 output profile.

| Artifact | Version | SHA-256 of downloaded artifact |
|---|---|---|
| libjpeg-turbo source | 3.1.4.1 | `ecae8008e2cc9ade2f2c1bb9d5e6d4fb73e7c433866a056bd82980741571a022` |
| LittleCMS source | 2.19.1 | `bfc54f7bab59fbc921012014a8032e4cba4abd46db47d46b76416a8c0b2815c8` |
| LibRaw source | 0.22.2 | `de86b035655accff8d4010f1a221fdf50d353cb7b1422ba26f14a0db92612cfa` |
| ICC sRGB2014.icc | ICC 2015 copyright; 3,024 bytes | `384b832de3412066743b52a75ee906b6fb9fb8d9e09e936fc2c43223815c6e0a` |
| CMake macOS universal archive | 3.31.8 | `d1449f969c54d5c00886d5b643340d493dfb3c81cb39ee29b35453395c11ebf7` |
| CMake Linux aarch64 archive | 3.31.8 | `609735983e3bdf24b6ab379d918458d64196fe72b98226f62dd5e9fe7b2997cc` |

Contract-lock SHA-256: `b2192332fda7ee7c95761e9e6ec90f2091d4bbda7b2751f23a1d8768e2b6a6fb`.

The [ICC profile registry](https://registry.color.org/rgb-registry/srgbprofiles) identifies the chosen artifact, and the [ICC profile-library license](https://registry.color.org/profile-library/) permits redistribution of ICC-owned profiles unchanged. Its embedded copyright identifies ICC. Keep the exact artifact and license notice in any future distribution.

The pinned [LCMS 2.19.1 release](https://github.com/mm2/Little-CMS/releases/tag/lcms2.19.1) was inspected for the `CubeSize` overflow corrections associated with upstream [da6110b](https://github.com/mm2/Little-CMS/commit/da6110b) and [e0641b1](https://github.com/mm2/Little-CMS/commit/e0641b1). The pinned source contains the widened accumulator and pre-multiplication bound. Its runtime version remains **2190**, so runtime checking alone cannot identify this patch; the archive/build lock supplies exact identity. No claim of a comprehensive security audit is made.

[LibRaw's reported OpenMP wavelet-denoise issue](https://github.com/LibRaw/LibRaw/issues/842) is not on this preview-only execution path, which does not enable OpenMP or perform sensor processing. This is a scoped assessment, not a declaration that all LibRaw parsing is safe. Future distributed packages still require complete upstream notices/source and a reviewed license-compliance bundle. No package was distributed here.

## 3. Explicit decoder parameters

- Output domain: `sports-canonical-rgba256-v2`; opaque, tightly packed RGBA8; longest edge 256, no upscale, crop, padding, or stretch. Minimum analysis edge 3.
- Geometry rounds ties upward using integer arithmetic. Resize is the shared `integer-area-rgba8-v1`; orientation is `exif-permute-v1`, applied after resize.
- JPEG: complete 8-bit Huffman baseline/sequential/progressive raster; gray/RGB/YCbCr admitted. `JDCT_ISLOW`, fancy upsampling enabled, block smoothing disabled, scale 1/1, RGB8 output, no quantization. SIMD compiled out. Warnings are fatal, not partial-success previews.
- ICC: bounded RGB matrix/TRC input/display profiles only. Fixed sRGB2014 output, relative-colorimetric intent, adaptation 1.0, `NOCACHE | NOOPTIMIZE | COPY_ALPHA` (`0x04000140`). Identical fixed-profile input uses the explicit identity path. Missing ICC is recorded as assumed sRGB; malformed/empty ICC does not silently become missing. Recognized non-sRGB metadata without its required profile is rejected.
- Rounding: reference floating environment must be `FE_TONEAREST`; no fast-math or floating-point contraction. Reference builds do not enable GPU or OS image frameworks.
- RAW: LibRaw 0.22.2 `open_buffer` → `unpack_thumb` → prepared JPEG. Initial camera allowlist: Sony ILCE-6000 and ILCE-7M4. No sensor `unpack`/development fallback. Demosaicing, RAW automatic brightness, sensor white balance, black-level correction, highlight processing and RAW gamma are **not executed**. Preview/container orientation disagreement is an error.
- Source: immutable snapshot from a read-only, no-follow regular-file descriptor, stat and full-content reread checks. Maximum source 512 MiB, direct JPEG 128 MiB, ICC 4 MiB, decoded raster 67,108,864 pixels; explicit geometry and RAW-preview limits.
- Controls: off by default; cancellation/disable checked at boundaries and within row processing. These are cooperative checks, not a claim that a third-party call can be interrupted instantly. Future worker supervision must supply hard process deadlines.
- Provenance includes contract/source/prepared-JPEG/profile hashes and five stage receipts. `qualified` remains false. RAW prepared-preview hashes describe LibRaw's returned JPEG, not a falsely claimed contiguous original byte range.

## 4. Stage B evidence and results

Normal reference run: [run.json](/var/folders/4d/pz7_vbhj5cl30r9sl7jdjq1c0000gn/T/celinen-v2-parity-dqnS79/run.json).

Executed on native Mac ARM64 and Linux ARM64 in a local VZ VM, not CPU emulation. Five real fixture files: Nikon D3/D700 JPEG, Samsung S23+ P3 JPEG, Sony A6000/A7 IV ARW. Plus eight EXIF-orientation derivatives and four negative fixtures.

**Normal run: 13/13 valid cases match all five stage hashes across two fresh-process repeats: 130/130 comparisons. Four negative cases return their expected typed failures on both targets in both repeats (16 responses). Zero mismatches; no first divergent stage in this executed V2 subset.** Five original fixture sources, all 17 scratch inputs, and eight protected V1/reference files retain their hashes.

Final fully instrumented run: [run.json](/var/folders/4d/pz7_vbhj5cl30r9sl7jdjq1c0000gn/T/celinen-v2-parity-LCNhYi/run.json), [Linux build/test log](/var/folders/4d/pz7_vbhj5cl30r9sl7jdjq1c0000gn/T/celinen-v2-parity-LCNhYi/linux-build.log). **17/17 cases pass; 130/130 cross-platform stage comparisons match, also matching the earlier normal run. Zero sanitizer findings reported.** All implementation source hashes in this run were checked against the final local files and match. All original/scratch/protected-file preservation checks pass. The runner exits 2 deliberately: fixture subset passed, full qualification blocked.

The normal run preceded the final error-only RAW memory/cancellation propagation correction; the final instrumented run tests that correction. Mac normal unit/decoder tests were also rebuilt and passed after it.

### Full stage hashes, Mac ARM64 = Linux ARM64

Each row below gives the identical hash observed on both targets in the normal run. `prepared-jpeg` dimensions are intentionally 0×0 until decoded; decoded dimensions follow the original stored orientation.

| Fixture | Stage | SHA-256 |
|---|---|---|
| basketball-action | prepared JPEG | `716ebc16299ef61adf2e73ad798505d67fc4dfa0dfab0bed228f13834d50ab5a` |
| | decoded RGB, 2256×1420 | `b2bb9278f40ea0eb09e4ee9f3e0b8f872e952c0361442f0b6f495d0ea9d7ad38` |
| | color RGBA | `d7f8ac364e3f92350e74139b6ae727d6619e49bbaad1890cedcb8103bc565143` |
| | resized RGBA, 256×161 | `8b3803cee8d7c076f330a8224efb2c8519f6e16eef54d93dc00cf6b954f8830a` |
| | oriented RGBA, 256×161 | `8b3803cee8d7c076f330a8224efb2c8519f6e16eef54d93dc00cf6b954f8830a` |
| basketball-hangar | prepared JPEG | `cb8e1799a10fc4d315f7f80628f552a95c75296db1c37473839d380b42d9c80d` |
| | decoded RGB, 4256×2832 | `a358fef4f1d3a2596373ee2d2f91d9e4102b7be601574e7e6b08f0c1aa19ec68` |
| | color RGBA | `593bc9a7f0e53418ffb26bda6661f4955befbf1c56f3a306b27b2b140950c23e` |
| | resized RGBA, 256×170 | `43bf1f71ce069c19655a30c311bad32e1680854094f76c15dedda9c82be9727b` |
| | oriented RGBA, 256×170 | `43bf1f71ce069c19655a30c311bad32e1680854094f76c15dedda9c82be9727b` |
| volleyball-portrait | prepared JPEG | `5685e8468969ca05da9de250f5848df5318e6b47b1a14d4aebd5c19675224fce` |
| | decoded RGB, 4000×3000 | `4fba1ff91e368b1619c70978b2da15ef893e79706977ddb70c861e8a8ae934b2` |
| | color RGBA | `5cf1df0affa3e86d5934f0af175957dc34fe2544622724001deacd73134f999c` |
| | resized RGBA, 256×192 | `8ce41f9fbfab6f1892fc757426727bb8b274f07b2c3b9feac1175e36c154da3e` |
| | oriented RGBA, 192×256 | `b9d9ddf5c2f077bd0ad56ee7ca56eb8b1fec701a7057d786d695d6addd1a9446` |
| sony-a6000 | prepared JPEG | `e15e796010641f428dcba22d076a9e2d9a649d75e1480581dc700887bd92e414` |
| | decoded RGB, 1616×1080 | `b162e1bf9079a3f0f3b5d7ad2827647bd3209a90c8bd98951cc44d388e7c24cc` |
| | color RGBA | `917457c4cce3d80ed8ba8d109ac53ccc3e23d819a4a5da349bcab9bf0cba1ba0` |
| | resized RGBA, 256×171 | `88a4340a1cba6b93d797c7156293c46292f95bd5cde68775e18672cb8874275e` |
| | oriented RGBA, 256×171 | `88a4340a1cba6b93d797c7156293c46292f95bd5cde68775e18672cb8874275e` |
| sony-a7iv-small | prepared JPEG | `200c1e5d9da99c9092ff28308a36c768186897b70a589c87794173d7442b546b` |
| | decoded RGB, 3504×2336 | `9cd3596ec0c47a23e0ee55d6dfd953d8b419e811a2e374a5da4d5ffc858b9baf` |
| | color RGBA | `26c71b5237d7a835b69864219b25ab5b81d81d480ee8dc2516177bc022bc470d` |
| | resized RGBA, 256×171 | `de1b08ba7508bd1e49d77bfe999d52db22be65821a9f78b9d85f89b499e4cc3d` |
| | oriented RGBA, 256×171 | `de1b08ba7508bd1e49d77bfe999d52db22be65821a9f78b9d85f89b499e4cc3d` |

Full per-target receipts, tensor/source/profile hashes, orientation derivatives, build hashes and compiler identities are in the JSON evidence. Linux x86-64: **not run; no physical target supplied**, no fabricated hashes or emulated qualification.

## 5. Test inventory

| Test actually executed | Result / scope |
|---|---|
| Mac primitive units, normal and ASan/UBSan | 38 checks passed per run |
| Linux normal primitive units | 38 checks passed |
| Mac JPEG contract tests | 14 passed; baseline/progressive, gray/RGB, sampling variants, corrupt fixed profile, empty ICC |
| Mac fully instrumented dependency tests | 38 primitive + 14 decoder cases passed |
| Mac bounded mutations, instrumented | 10,000 typed errors, zero partial-success outputs, no reported ASan/UBSan finding |
| Mac fully instrumented real fixtures | All five succeeded with stage hashes equal to normal; no reported ASan/UBSan finding |
| Mac TSan primitive tests | 38 passed; includes four independent resize/hash jobs; not full decoder concurrency qualification |
| Cross-platform normal fixture subset | 17 cases passed as detailed above |
| Cross-platform fully instrumented final fixture subset | 17 cases passed; all five stages exact for 13 valid cases × two repeats; 16 expected negative responses |
| Linux fully instrumented units/dependencies | 38 primitive + 14 decoder cases passed; 10,000 bounded mutations returned typed errors; no reported ASan/UBSan finding |
| JS and shell syntax | `node --check tests/canonical-v2-parity.mjs` and `sh -n native/bootstrap-canonical-v2.sh` passed |

The mutation test truncates/mutates a progressive-JPEG prefix of at most 201 bytes. It is useful bounded parser coverage, **not** broad entropy-stream, ICC, RAW, or security fuzzing. Synthetic sampling cases are not camera-compatibility or sports-quality evidence.

### Sanitizer setup failures retained as evidence

1. [Initial Linux instrumented attempt](/var/folders/4d/pz7_vbhj5cl30r9sl7jdjq1c0000gn/T/celinen-v2-parity-krcnKm/run.json): base image lacked Clang ASan runtime archives. Added `libclang-rt-14-dev:arm64=1:14.0.6-12` in a separate local test image; original image untouched.
2. [Second instrumented attempt](/var/folders/4d/pz7_vbhj5cl30r9sl7jdjq1c0000gn/T/celinen-v2-parity-yOopiP/run.json): compiler was killed while building LibRaw under the 1.5 GiB container cap. No fixture execution reached. The rerun uses serial dependency compilation and a bounded 3 GiB test container. This resource change is for sanitizer testing, not a validated production capacity recommendation.

## 6. V1 regression result

Fresh local checks, using existing V1 code unchanged in this task:

| Existing suite | Observed result |
|---|---|
| Sports foundation | 77 assertions passed; synthetic, not model accuracy |
| Shortlist | 29 checks passed |
| Core | 500 checks, 0 failures |
| Streaming analysis | 1,047 checks, 0 failures |
| Decoder, JPEG-only invocation | 97 assertions passed |
| Decoder, both approved Sony RAW fixtures enabled | 209 assertions passed, including orientation/source preservation |
| Worker | 432 checks passed |
| Develop | 442,188 assertions passed, including 1,000 bounded render combinations |

The old V1 Mac/Linux parity gate was **not rerun** here. Its previously documented failure remains a release blocker for that old Linux path; these unit passes do not replace it. V2 has not been wired into the sports analyzer and no model, weight, threshold, decision or export behavior was changed.

## 7. Remaining gates and deployment answer

**Not safe to deploy as customer production. Full Stage B qualification is not claimed.**

- No physical Linux x86-64 evidence; no ten-repeat, concurrency 1/2/4, cold/warm full-decoder qualification matrix.
- Broader malformed-input, ICC and camera compatibility coverage remains. Currently tested Sony models are not a promise for all Sony ARW variants, CR3, NEF, RAF or DNG.
- Full-decoder TSan and cancellation/resource-pressure/timeout lifecycle coverage remain. Cooperative library cancellation is not a substitute for a hard worker deadline.
- Metadata beyond the pixel-affecting orientation/profile contract is not newly qualified here: timestamp, lens, exposure settings, sequence, rating and label parity require their later tests.
- A private service would still need authenticated job ownership, queue/admission and hard-timeout supervision, structured job IDs/logs, separate durable result storage, failure cleanup and operational kill-switch wiring. The core's disabled control and read-only CLI provide building blocks, not an already deployed server.
- No 300-photo corpus, sports-label evaluation, V1/V2 decision-drift review, or throughput benchmark was run. No speed or precision/recall claim is supported by these fixture tests.

The local architecture cannot publish or export, never grants itself qualification, and does not route customer requests. **The executed ARM64 fixture fundamentals pass**, including exact orientation, preserved sources, expected malformed-input errors and the instrumented accepted/error corpus. However, the complete technical prerequisites for an operational private-shadow service are **not yet met**: full qualification and the supervision/authenticated service adapter remain outstanding as listed above. No shadow deployment is authorized in this task and no shadow server has been deployed.

The local sanitizer test image is `sha256:4eb5907bd4aaf983660799acaa9f115f05f647b76cff614603e46fdccf4c4327`. The final evidence records both compilers, native ARM64 operating systems, probe/static-library binary hashes and implementation-source hashes. A local test image is not a hosted deployment. The test container was removed automatically; the test VM is stopped at handoff.

## 8. Reproduction

From `/tmp/celinen-main`, with the pinned archives/profile available and the named local ARM64 test VM running:

```sh
make -C native -f v2.mk all test decoder-test
node tests/canonical-v2-parity.mjs --raw-root /tmp/celinen-parity-umZSE4/corpus
UBSAN_OPTIONS=halt_on_error=1 node tests/canonical-v2-parity.mjs --raw-root /tmp/celinen-parity-umZSE4/corpus --instrumented
```

For first build, `native/bootstrap-canonical-v2.sh` verifies all dependency archives. `V2_SANITIZE=1` builds separately under `native/build-v2/instrumented`; it does not instrument a binary against uninstrumented dependencies and call that full dependency coverage. Use pinned CMake 3.31.8 via `CMAKE=...` and `V2_BUILD_JOBS=1` on the constrained Linux test VM.

The qualification runner returns **2 (BLOCKED)** when the tested subset passes but remaining gates exist, and 1 for execution/mismatch failure. It does not emit a successful release status. JSON explicitly records `qualified:false` and `deploymentAllowed:false`.
