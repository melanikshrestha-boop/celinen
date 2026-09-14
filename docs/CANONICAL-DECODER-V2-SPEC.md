# Shared C++ canonical decoder V2 — specification and migration plan

**Status: historical design draft with subsequently approved isolated implementation.**

For the current source-only handoff, isolation checks and reproduction commands,
see [V2 isolated handoff](CANONICAL-V2-ISOLATED-HANDOFF.md). The owner approved
publishing only this disabled V2 foundation to GitHub main, not deploying it or
changing V1. Original proposal wording below is retained as design history;
it is not a claim that every proposed stage or service has been implemented.

**Subsequent authorization, 2026-09-13:** the owner approved Stage A implementation and Stage B fixture testing, with no push/deployment. The owner then approved replacing the unverified HP profile with ICC's licensed `sRGB2014.icc` and reviewing a pinned LCMS security revision. The implementation lock uses LCMS **2.19.1**, with the reviewed `CubeSize` overflow corrections, and profile SHA-256 **384b832de3412066743b52a75ee906b6fb9fb8d9e09e936fc2c43223815c6e0a**. These supersede the original dependency/profile proposals below; all V1/customer/export boundaries remain. The original draft is retained for design history, not used as an executable dependency lock. See `native/canonical-v2.lock.json` for the current candidate. Insert Stage B.5: private shadow deployment may be considered after fixture fundamentals pass, but requires separate authorization; no deployment is authorized here.

Proposed domain: `sports-canonical-rgba256-v2`.

This document specifies a new experimental pixel contract, not a fix that makes Linux reproduce Apple's V1 pixels. All normative words below describe the proposed V2 implementation **after approval**. They do not describe capabilities already shipped.

This step changes only this document. V1 decoder behavior, goldens, production, UI, sports weights, thresholds, existing decisions, customer data and export behavior remain untouched. Nothing is pushed, merged or deployed. Approval of this specification would authorize Stage A only, not production migration.

## 1. Decision and evidence

Use the same pinned C++ JPEG, color, integer-resize and orientation implementations on supported Mac and Linux targets. Do not use ImageIO, CoreGraphics, ColorSync, libvips, operating-system thumbnails or GPU decoding to produce V2 canonical pixels. Keep V1 independently available for historical compatibility and rollback.

The stage-isolation investigation (`DECODER-STAGE-ISOLATION-2026-09-13.md`, retained on the separate local `codex/native-analysis-streaming` branch) establishes why this is an architecture change:

- All five fixtures already differ at the decoded native RGB boundary; Apple's exact private cause remains unproven.
- Isolated color conversion contributes another smaller difference for the Samsung P3 fixture.
- The closest tested libvips resize still changes sharpness by 12–32% against the isolated ImageIO control.
- The shared integer-area control matches 15/15 Mac/Linux comparisons. This proves that control's tested reproducibility, **not** V1 equivalence or complete V2 correctness.
- The prior Linux V1 gate remains blocked. A new domain must not turn that failure into a pass by relabeling results.

The separately developed Sports Cull foundation (`SPORTS-CULL-ALPHA.md`, retained on the local `codex/native-analysis-streaming` branch) uses `sports-canonical-rgba256-v1`. That work is not included in this isolated handoff and does not yet establish sports-model accuracy. V2 pixels, downstream technical determinism and sports usefulness have separate gates.

## 2. V2 pixel contract

| Property | Proposed rule |
|---|---|
| Domain | Exact ASCII string `sports-canonical-rgba256-v2`; never inferred from image shape |
| Direct input | One complete 8-bit Huffman JPEG: baseline/sequential or progressive; grayscale, RGB or YCbCr |
| RAW input | Initially qualified Sony ARW camera variants only; extract the pinned LibRaw primary embedded JPEG; never develop sensor pixels as fallback |
| Initial real camera fixtures | Existing Nikon D3/D700 JPEGs, Samsung S23+ JPEG and Sony A6000/A7 IV ARWs; these are candidates, not a declaration of family-wide support |
| Not admitted initially | CMYK/YCCK, 12/16-bit or arithmetic/lossless JPEG, MPO/multiple-image or recognized HDR gain-map containers, HEIC, PNG, TIFF; unqualified RAW variants |
| Output | One tightly packed, row-major RGBA buffer; stride exactly `4 × width`; no padding |
| Channels | Byte offsets 0/1/2/3 are R/G/B/A; never native-word-order ARGB or BGR |
| Bit depth | Unsigned 8 bits per channel; exactly four bytes per pixel |
| Color | Fixed sRGB output profile identified below; gamma-encoded sRGB code values, not linear-light samples |
| Alpha | Always 255; straight/unassociated, never premultiplied; alpha is not inferred from JPEG data |
| Orientation | Upright output, effective EXIF orientation 1; preserve source orientation separately |
| Geometry | Preserve aspect ratio with specified integer rounding; no crop, padding, stretch or upscaling; longest edge at most 256 |
| Analysis eligibility | Both canonical dimensions must be at least 3 for the existing analysis kernel; otherwise explicit unsupported-geometry error, not fabricated padding |
| Source immutability | Read-only verified source bytes; no original modification, rating writes, deletion or replacement |

Container signatures and decoder headers, not filename extensions, determine format. File names and IDs remain identity metadata and do not affect pixels. An extension/header conflict is reported; no alternate parser is silently tried. A supported-format registry records exact fixture-qualified camera/source modes. CR3, NEF, RAF and DNG can later supply fixtures and adapters without changing this output contract, but are not initially claimed supported. Any change in the chosen pixels requires a new domain after V2 is frozen.

### Admission limits

Initial experimental limits are explicit safety proposals, not throughput claims: source file at most 512 MiB; direct JPEG at most 128 MiB; prepared RAW-preview JPEG at most 32 MiB + 65,536 bytes; assembled ICC at most 4 MiB; decoded raster at most 67,108,864 pixels and either dimension at most 65,535. All lengths, offsets and products use checked unsigned arithmetic before allocation.

Run one job per isolated worker initially, with a 1.5 GiB resident-memory ceiling and 120-second processing deadline. Resource exhaustion returns an error; it must never select a lower-resolution decode or a different profile. Experimental admission starts with one active worker and at most eight queued descriptors, not eight transferred large bodies. Later concurrency qualification may change resource scheduling, not successful pixel output. Deployment resource limits remain subject to Stage F capacity evidence and owner approval.

## 3. Pipeline, ownership and stage receipts

```text
Read-only source descriptor / immutable source snapshot
             │ full-content SHA-256 + stable-source verification
             ▼
      Identify and validate container
             │
        ┌────┴──────────────┐
        │ direct JPEG      │ qualified RAW
        │                  ▼
        │          LibRaw embedded-preview extraction
        │          (no sensor development)
        └──────────┬───────┘
                   ▼
       Verified prepared JPEG + bounded EXIF/ICC parsing
                   ▼
       libjpeg-turbo full-resolution RGB8 decode
                   ▼
       Fixed-profile LittleCMS normalization → sRGB RGBA8
                   ▼
       Shared integer-area resize → unoriented RGBA8
                   ▼
       EXIF 1–8 exact pixel permutation
                   ▼
       Canonical RGBA8 + immutable V2 provenance receipt
                   │
                   ▼
       Separate experimental feature/decision evaluation
       (not the existing customer decision/export store)
```

All pixel buffers are owned by the job, with RAII lifetime and no process-global mutable decoder state. Input views borrow from that job's immutable source. Library instances and color contexts are per job. A stage transfers an owned result only on success. An error discards partial buffers and carries its stage, typed code and job ID; it does not publish a partial success. Bounded scratch storage is private to the worker and removed on success, failure or cancellation; source paths are never cleanup targets.

| Stage | Input → output | Ownership/error boundary | Required diagnostic provenance |
|---|---|---|---|
| Verify | Source descriptor → immutable verified byte source | Keep the same descriptor/snapshot; reject changed size/stat/content; do not reopen by mutable pathname | Source hash/size, source mode, verification revision |
| Extract | Qualified RAW bytes → prepared embedded JPEG | Per-job LibRaw; reject missing/non-JPEG/corrupt/oversized preview; no sensor fallback | LibRaw/build version, extraction adapter version, selected primary thumbnail descriptor, prepared-preview hash |
| Parse | JPEG bytes → validated header, orientation and ICC | Bounded parser; reject conflicting/invalid metadata that affects pixels | Parser policy version, raw orientation, profile hash and interpretation policy |
| Decode | JPEG → full-size RGB8 in stored orientation | Per-job libjpeg instance; fatal errors and warning policy below | JPEG/build settings, dimensions, pre-color RGB hash |
| Color | RGB8 + profile policy → full-size sRGB RGBA8 | Per-job LCMS context; explicit identity or transform path; no OS lookup | Input/output profile hashes, transform policy/flags, post-color hash |
| Resize | sRGB RGBA8 → bounded unoriented RGBA8 | Checked integer accumulator; reject invalid geometry/overflow | Resize version, input/output geometry, post-resize hash |
| Orient | Small RGBA8 + resolved EXIF → upright RGBA8 | New small owned buffer; exact permutation only | Source/effective orientation, post-orientation hash |
| Seal | Upright pixels → canonical result + receipt | Atomic result publication; generation/owner fence outside pure pixel function | Domain/contract hash, canonical hashes and all stage versions |

For RAW, `prepared_preview_sha256` means the exact JPEG byte buffer supplied to libjpeg. LibRaw may insert EXIF into its returned JPEG: do not mislabel this as a hash of a contiguous byte range in the original ARW. If an original embedded payload can independently be located, record its hash and offsets as additional evidence, never substitute it for the prepared-input hash.

Read-only source verification uses an owned immutable snapshot or the existing validated-descriptor strategy plus full-content verification and source-stability checks. A source that changes during the operation returns `SOURCE_CHANGED`. Modification time alone is not full-content verification. Source hashes exclude sidecars: V2 does not apply sidecar edits or orientation overrides. Future sidecar-driven pixel changes require their own explicit input contract.

## 4. Library and JPEG proposal

| Component | Proposed pin | Rationale / qualification condition |
|---|---|---|
| libjpeg-turbo | **3.1.4.1**, official release tarball | Explicit maintenance release, not a floating system dependency; pin archive SHA-256, compiler and build flags before Stage A is runnable |
| LittleCMS | **2.18**, official release archive | Stable release proposal, not an RC or system-selected converter; archive hash and build receipt required |
| LibRaw | **0.22.2**, existing extraction bootstrap | Preserve the inspected extraction policy in an isolated V2 adapter; no changes to V1's helper |
| Resize | `integer-area-rgba8-v1` | Precisely specified below; derived from the tested control, not a claim of ImageIO equivalence |
| Orientation | `exif-permute-v1` | Integer indexing only |
| Decoder policy | `canonical-decoder-v2.0.0-draft` | Freeze as an approved contract artifact before publishing any qualified V2 receipt |

Version sources: [libjpeg-turbo 3.1.4.1 release](https://github.com/libjpeg-turbo/libjpeg-turbo/releases/tag/3.1.4.1), [LittleCMS 2.18 release](https://github.com/mm2/Little-CMS/releases/tag/lcms2.18). These are proposals, not newly installed libraries or claims that the versions are the latest. Stage A must verify official source integrity, licenses and security advisories; a pin alone is not a security review.

The existing [LibRaw bootstrap](../native/bootstrap-libraw.sh) pins archive SHA-256 `de86b035655accff8d4010f1a221fdf50d353cb7b1422ba26f14a0db92612cfa`. Its extraction uses `unpack_thumb()` and `dcraw_make_mem_thumb()`, not `unpack()`/`dcraw_process()`. Sensor demosaicing, RAW white balance, highlight recovery, black-level treatment and RAW gamma are therefore **not executed** in this domain. Camera-rendered preview appearance is part of the source. Never substitute developed RAW when a preview is absent.

### JPEG settings — no implementation-time discretion

Use the decompression API with `dct_method=JDCT_ISLOW`, `do_fancy_upsampling=TRUE`, `do_block_smoothing=FALSE`, `scale_num=1`, `scale_denom=1`, `out_color_space=JCS_RGB`, and `quantize_colors=FALSE`. Decode the complete raster before resize; no DCT shrink-on-load, partial progressive display or thumbnail substitution. Untagged grayscale is expanded to equal R/G/B. Reject unsupported component/precision/encoding combinations before allocation. The settings use the [pinned public JPEG API](https://raw.githubusercontent.com/libjpeg-turbo/libjpeg-turbo/3.1.4.1/src/jpeglib.h).

Reference build: compile SIMD out (`WITH_SIMD=OFF`), no GPU, no `-ffast-math`, `-Ofast` or `-march=native`; use explicit target baseline and disable floating-point contraction. Record toolchain and dependency configuration. Do not toggle process environment variables per request. [libjpeg-turbo documents build-time SIMD disabling](https://github.com/libjpeg-turbo/libjpeg-turbo).

Optimized build: a separate, explicitly identified binary may enable CPU SIMD only after every admitted format/subsampling case passes the exact reference comparison on each CPU architecture. Optimization cannot select another IDCT, chroma policy, scale, profile or rounding rule. Failed equivalence keeps that binary unqualified; reference execution remains the only eligible experimental path. No optimized speed results count as qualified until its hashes pass.

JPEG error manager: convert fatal library errors to a typed job failure through a boundary that cannot jump across live C++ destructors. Treat all decoder warnings as failures in the initial policy, including truncation/recovery. Require complete decoding and a valid end-of-image marker; tolerate trailing bytes only as recorded container data, not a second image to decode. Never accept synthetic EOI recovery or partially filled output. Preserve the original warning/error code in private diagnostics.

## 5. Color contract

Proposed fixed destination is the exact sRGB IEC61966-2.1 profile used in the investigation, SHA-256:

`2b3aa1645779a9e634744faf9b01e9102b0c9b88fd6deced7934df86b949af7e`.

**Packaging gate:** verify this artifact's origin and redistribution permission before vendoring it. This specification does not assert a license. If it cannot be packaged, return to architecture review and choose a different fixed profile before freezing V2; do not silently generate a replacement. At runtime load only the packaged, hash-verified bytes. No OS profile lookup and no timestamp-bearing profile generation.

Assemble embedded ICC APP2 chunks in their declared sequence, not arrival order. Require consistent chunk counts, no duplicates/gaps and bounded total length. Validate declared size, tag offsets, profile class, RGB color space and supported transform structure. Initial scope accepts RGB input/display matrix-and-TRC profiles, ICC v2/v4; other valid profiles return `UNSUPPORTED_ICC_PROFILE`. Grayscale JPEG with a grayscale ICC is initially unsupported rather than treating a gray transform as an RGB one. These limits must be checked against the retained real P3/sRGB fixtures at Stage B.

Profile policy:

1. Valid supported embedded ICC is authoritative; conflicting EXIF color labels are retained as diagnostics, not alternate transforms.
2. Embedded bytes identical to the fixed output profile use an explicit identity copy. Equality is the profile SHA-256, not the human-readable profile name.
3. No ICC: assume the fixed sRGB interpretation and record `assumed_srgb_missing_icc`, unless recognized metadata explicitly declares a different color space (for example Adobe RGB), in which case return `PROFILE_REQUIRED`. Unknown/unset color-space metadata does not invent an Adobe RGB profile.
4. ICC present but malformed, incomplete or unsupported: fail. Never route this case through the missing-profile rule.

Transform policy: LCMS 2.18, `TYPE_RGBA_8` input/output with alpha initialized to 255, `INTENT_RELATIVE_COLORIMETRIC`, flags `cmsFLAGS_NOCACHE | cmsFLAGS_NOOPTIMIZE | cmsFLAGS_COPY_ALPHA` (`0x04000140`). No black-point compensation, proofing, gamut-check mode, plug-ins or platform acceleration. Set chromatic adaptation state explicitly to 1.0. [Pinned LCMS API definitions](https://raw.githubusercontent.com/mm2/Little-CMS/lcms2.18/include/lcms2.h).

Use round-to-nearest floating environment, strict compiler floating-point semantics and a recorded math-library/toolchain configuration. **These settings are a testable proposal, not proof that LCMS is byte-identical across architectures.** If the color stage differs by even one byte, Stage B fails. Investigate the transform implementation or bring an alternative shared deterministic color design back for review. Do not loosen the pixel gate, compensate brightness afterward, or introduce platform-specific color tables.

Color normalization occurs at full JPEG dimensions. Resize then averages the gamma-encoded sRGB bytes. Linear-light resizing might be attractive for other purposes, but is a different algorithm and is not this V2 proposal.

## 6. Deterministic integer-area resize

Let `W,H` be decoded stored-orientation dimensions and `M=max(W,H)`.

```text
If M <= 256: w=W, h=H (byte copy, no upscale).
Otherwise:
  w = max(1, floor((2*W*256 + M) / (2*M)))
  h = max(1, floor((2*H*256 + M) / (2*M)))
```

All operations are checked unsigned 64-bit integer operations. Ties round up. The longer output dimension is exactly 256; the shorter follows the formula, not a library's implicit geometry. For example 1616×1080 and 3504×2336 both become 256×171. Reject a resulting dimension below 3 for this analysis domain. Do not force a square or reuse a separately produced 1280-pixel preview.

Kernel: exact source-pixel area overlap with each destination footprint. For destination `(x,y)` and overlapping source `(sx,sy)`:

```text
wx = min((sx+1)*w, (x+1)*W) - max(sx*w, x*W)
wy = min((sy+1)*h, (y+1)*H) - max(sy*h, y*H)
D  = W*H
sum[c] = Σ source[sy,sx,c] * wx * wy
dest[y,x,c] = floor((sum[c] + floor(D/2)) / D)
```

Iterate `sx` from `floor(x*W/w)` through `ceil((x+1)*W/w)-1`, and similarly for `sy`. Implement integer ceiling with checked arithmetic. Half-open source footprints meet exactly: no extrapolation, mirrored border, clamp-generated duplicate pixels or extra border weight. Weights sum to `D` per destination pixel. All accumulators are unsigned 64-bit; no floating coefficients, intermediate separable rounding or architecture-specific vector reductions. Alpha remains 255 under the same formula.

With admitted `W*H <= 67,108,864`, channel sum is at most `255*W*H`; still check every multiplication/addition before use. Overflow, zero dimensions or out-of-range indexing are errors, never wrap/clamp fallback. Final arithmetic cannot exceed 255 when validated; an out-of-range result is an internal failure.

The equations are taken from the isolated [`fixed_area` control](../native/tests/decoder_stage_probe.cpp), not the current production resize. Implementing these equations as a reusable V2 module still requires independent edge-case tests and sanitizers. Reproducing its limited prior control result does not qualify a complete decoder.

## 7. Exact orientation after resize

Resolve orientation before pixel processing, but apply it **after** resize. For direct JPEG use the unique valid EXIF IFD0 orientation; absence means 1 with `orientation_absent` provenance. Duplicate conflicting tags, malformed orientation storage or values outside 1–8 fail. Non-pixel metadata absent from otherwise valid EXIF is simply unavailable.

For RAW use the orientation of the prepared LibRaw JPEG. Require consistency with the container's orientation when that can be independently resolved; conflicts fail. If the prepared preview lacks orientation, the V2 extraction adapter must supply a uniquely resolved EXIF-equivalent container orientation or report `ORIENTATION_UNRESOLVED`. Do not guess from width/height, auto-rotate twice or assume a maker-specific flip enum equals EXIF.

In this table `w,h` are the resized, unrotated dimensions. Destination coordinates are `(x,y)`; copy all four bytes from `(sx,sy)`:

| EXIF | Destination dimensions | sx | sy |
|---:|---|---|---|
| 1 | w × h | x | y |
| 2 | w × h | w−1−x | y |
| 3 | w × h | w−1−x | h−1−y |
| 4 | w × h | x | h−1−y |
| 5 | h × w | y | x |
| 6 | h × w | y | h−1−x |
| 7 | h × w | w−1−y | h−1−x |
| 8 | h × w | w−1−y | x |

No interpolation or color conversion occurs here. Output orientation is 1, while the receipt retains raw tag, resolved orientation and resolution source. Sensor dimensions, encoded preview dimensions and canonical dimensions remain distinct metadata fields.

## 8. Provenance, determinism and downstream boundary

A successful result must carry:

- Domain string, approved contract artifact hash, decoder policy version and implementation/build ID.
- LibRaw version/build and extraction-policy version when applicable; JPEG library version, complete settings and reference/optimized mode.
- Color engine/version, flags, profile policy and input/output profile SHA-256; resize and orientation implementation versions.
- Complete source SHA-256 and byte size; prepared-preview SHA-256 for RAW; exact JPEG-input SHA-256 for all inputs.
- Encoded, sensor-if-known, resized and upright dimensions; source/resolved/effective orientation; alpha/stride/channel/depth contract.
- SHA-256 of pre-color RGB, post-color RGBA, resized RGBA and final canonical RGBA for qualification diagnostics.
- Source revision, owner/job/request IDs, cancellation generation and success status. Private identifiers stay out of public logs.

`canonical_output_sha256` hashes exactly the packed RGBA bytes. Also store a geometry-aware `canonical_tensor_sha256` over: UTF-8 domain bytes, one NUL byte, width as little-endian uint32, height as little-endian uint32, then RGBA bytes. Stage hashes use documented channel layout plus separately compared dimensions; no native struct serialization. Hashes use lowercase hexadecimal. Timings, paths and platform names do not enter pixel hashes.

**Invariant:** identical verified source bytes + the same frozen V2 feature domain produce byte-identical successful canonical output on every supported platform. Input format selection, embedded-preview selection, profile resolution and orientation cannot depend on account, locale, filename, wall clock, environment profile availability or scheduling. Resource failure may prevent an output, but cannot alter an output that is returned as successful.

Initial qualification matrix: macOS ARM64, Linux ARM64 and Linux x86-64 on actual target hardware. Emulation is useful development evidence but does not qualify an architecture. Repeat reference runs in normal and restricted environments. The absence of CoreGraphics is necessary, not sufficient evidence of determinism.

Each stage must match its counterpart exactly, including prepared JPEG, decoded RGB, color output, resize and orientation buffers. A differing stage stops qualification even when final pixels happen to converge. Unsupported modes return the same semantic error category; private library error text need not match. A failed stage is never accepted using a pixel tolerance or final-score offset.

The domain covers the frozen pixel-affecting policy. Before freeze, drafts/results are explicitly unqualified and keyed by contract hash; after freeze a pixel-changing library/settings/profile/extraction change requires a new domain and review. A byte-preserving maintenance build may retain the domain only after the full regression gate. Toolchain and library pins must never float.

### Pixels are not the entire culling contract

Keep analysis kernel hash, feature schema, inference model digest, weights/configuration hash, sequence metadata policy and selection-policy revision alongside the pixel receipt. Do not label a platform-independent pixel tensor as proof of equivalent floating-point analysis or inference.

On the same V2 tensor, deterministic technical features and derived decisions must also match across targets. Compare each brightness, sharpness, blur/exposure component, descriptor, threshold branch, burst assignment, ranking/tie order and keeper/reject result. Canonical numeric feature serialization must be specified by the future adapter; non-finite values are errors. If the unchanged kernel cannot meet this gate, stop and request a separately scoped analysis-determinism review—do not change its coefficients in the decoder project.

V1-versus-V2 differences are a separate migration-quality evaluation. Exact V2 Mac/Linux parity does not imply V1-equivalent pixels or decisions. Conversely, similar decisions on five samples do not excuse unequal V2 bytes.

## 9. V1/V2 coexistence and rollback

V1 remains frozen, with its existing code, golden hashes, captured outputs, decisions and known environment provenance retained. Historical decisions are facts, not recomputation requests. Preserve licensed reference binaries/environment receipts where possible; an Apple OS update cannot be assumed to reproduce previously captured pixels.

V2 starts as an off-by-default, local experimental command/worker path. It must not change the existing `feature_version` constant or relabel `unqualified_linux` as trusted. A future explicit adapter admits only a verified domain/build receipt into a separately owned experimental session. Clients cannot gain qualification by sending a domain string.

Separate cache/result keys include owner, shoot/job, original file ID, source revision/hash, domain, contract hash and analysis-policy revision. Keep complete long IDs and original ordering. Never overwrite V1 cache slots or reuse V1 scores under V2 provenance. Cross-account caches and globally mutable job state are prohibited.

V2 shadow results are append-only alternatives. They cannot overwrite manual picks, ratings, edits, review history or delivery references. Manual overrides remain authoritative in their existing source/version context; do not copy AI recommendations across domains as manual actions. A future opt-in migration records explicit per-shoot active-domain selection and a rollback pointer, without deleting either history.

Current export remains untouched. Experimental V2 does not write XMP, publish galleries or choose a new delivery version. Any eventual approved integration must carry exact source/frame/edit-version references through existing export authority, never resolve “latest” silently. A decoder migration does not authorize native Develop or RAW export changes.

Rollback procedure at any runtime stage: disable V2 admission, fence/cancel outstanding V2 generations, drain or discard their unpublished results, restore the previous explicit V1 selection, and retain V2 diagnostic history privately. Completed V1 transactions and originals do not move. Rollback never means deleting customer records, regenerating V1 goldens or recomputing their decisions. A V1 runtime security problem can require disabling processing while preserving history; rollback is not permission to run a vulnerable decoder indefinitely.

## 10. Failure policy

| Condition | Required result and recovery |
|---|---|
| Corrupt/truncated JPEG or libjpeg warning | `INVALID_JPEG`; no partial pixels/features. Retain original; user may retry a complete source |
| Corrupt/missing/non-JPEG RAW preview | `INVALID_RAW_PREVIEW` or `PREVIEW_UNAVAILABLE`; no sensor development or OS thumbnail fallback |
| Unsupported RAW/camera/container | `UNSUPPORTED_SOURCE`; retain entry and report unsupported analysis, not REJECT |
| Malformed/incomplete ICC | `INVALID_ICC_PROFILE`; never assume sRGB for a profile that is present but broken |
| Valid unsupported ICC | `UNSUPPORTED_ICC_PROFILE`; requires separately qualified profile support |
| Missing ICC | Explicit assumed-sRGB policy above; `PROFILE_REQUIRED` if metadata declares another space |
| Invalid/conflicting EXIF orientation | `INVALID_ORIENTATION`; unresolved RAW orientation has its own code; absent direct-JPEG orientation is declared identity |
| Oversized input/raster/profile or impossible geometry | `LIMIT_EXCEEDED` or `UNSUPPORTED_GEOMETRY` before large allocation; no downscaled decode fallback |
| Partial file still being copied / source changes | No successful result; `SOURCE_NOT_READY`/`SOURCE_CHANGED`. Watcher may retry a new verified revision after stability, at most three automatic attempts |
| Allocation failure / worker memory ceiling | `RESOURCE_EXHAUSTED`; pause admission, clean owned scratch and retain completed results; never return zero-valued metrics |
| Deadline / cancellation / stale generation | `TIMEOUT`/`CANCELLED`; stop worker as needed, fence late results, clean owned scratch |
| Unknown or mismatched domain/contract | `UNSUPPORTED_DOMAIN`/`PROVENANCE_MISMATCH`; never route silently to V1 or an arbitrary current decoder |
| Cross-platform hash mismatch | Qualification failure; freeze rollout and preserve both stage receipts for diagnosis |

An unavailable analysis is not an automatic reject and not a low score. Callers receive a typed failure/availability state, not invented blur, expression, exposure or confidence values. Retries are bounded, idempotent by verified source revision and never repeatedly upload a large body before queue admission. This document does not authorize production server work.

## 11. Migration sequence and implementation phases

Every row is future work. Stages run in order; a blocker is reported rather than skipped. The existing Linux V1 compatibility gate remains present and its failure remains visible. It is not bypassed by editing expected outputs; any eventual release using a different V2 contract requires an explicitly approved release-policy decision at H.

| Stage | Work and evidence required to exit | Rollback / stopping action |
|---|---|---|
| **A — Implement isolated experiment** | After architecture approval only: immutable dependency/profile lock; pure C++ stages; receipts/errors; off-by-default entry point; unit tests. No UI or customer session integration | Disable/remove experimental entry point without touching V1; keep investigation evidence |
| **B — Fixture parity** | Exact stage/output hashes on all three architectures, reference repeats and admitted optimized candidates; decoder/color/resize/orientation/error/sanitizer gates below | Keep V2 unqualified; diagnose first divergent stage; no weakened tolerance |
| **C — Read-only ~300-image corpus** | Owner-approved manifest of at least 300 distinct original hashes, existing fixtures retained; verified originals before/after; complete per-file outcome and camera/profile breakdown | Stop at failed/unsupported cases; preserve partial diagnostics; no library mutation or automatic exclusion from denominator |
| **D — V1/V2 technical comparison** | Same sources, frozen V1 reference artifacts/config and V2 outputs; full feature/threshold/rank/decision drift ledger, including burst composition and near-threshold cases | Keep V1 active; retain V2 alternatives; any proposed scoring change returns to separate review |
| **E — Manual sports gold** | Photographer-labeled independent sports dataset; frozen evaluation protocol and model identity if available; quality gates below. Technical placeholders cannot stand in for sports inference | No sports qualification without labels/components; no automatic “good enough” based on technical test pass |
| **F — Performance** | Only after correctness/quality: separately measured stage and complete-cull runs; workload hashes, CPU/RAM and reference/SIMD comparisons | Disable unqualified optimization; do not trade correctness for an SLO |
| **G — Limited internal qualification** | Explicit internal opt-in, no customer default; replay, cancellation, restart/account fencing and rollback rehearsal; bounded soak and signed evidence review | Disable V2, fence jobs, restore V1 selection; preserve both histories |
| **H — Production migration** | Separate explicit human approval of build, camera scope, quality/performance results, release-policy change and rollback plan. Any server/UI/export integration needs its own reviewed scope | Stop admission and restore the preceding supported V1 path/selection; preserve original and manual history |

Stage D distinguishes an existing stored V1 decision from a new V1 rerun. If a historical output is unavailable, record that limitation instead of regenerating a golden or presenting a different Apple environment as the original reference.

## 12. Acceptance gates

Gates have PASS / FAIL / BLOCKED outcomes. Missing evidence is BLOCKED, never PASS. The following is a proposed test protocol, **not test results from this document-writing step**.

| Gate | Objective criterion |
|---|---|
| Cross-platform bytes | All admitted fixtures: identical prepared JPEG, RGB, color, resized and oriented hashes AND dimensions on Mac ARM64/Linux ARM64/Linux x86-64; zero mismatches. Ten fresh-process repeats per platform, queue concurrency 1/2/4, reordered admissions, cold/warm runs |
| JPEG | Baseline and progressive, grayscale, RGB/YCbCr, 4:4:4/4:2:2/4:2:0, odd sizes and block boundaries; exact reference output; all corrupt/truncated/unsupported fixtures yield expected typed errors |
| Color | Fixed sRGB identity exact; existing P3, RGB matrix/TRC and independently sourced Adobe RGB fixtures cross-platform exact; ICC chunks reordered/missing/duplicated, oversized/tag-offset errors and absent-profile policies tested |
| Resize | Constants, impulses, ramps, checkerboards, odd/even/tie geometry, one-axis extremes and maximum admitted dimensions; all bytes match an independently reviewed integer oracle; no intermediate resize substitution |
| Orientation | EXIF 1–8 on asymmetric labeled grids and real JPEG/RAW fixtures; every coordinate and swapped dimension checked; identity and repeated-rotation invariants; invalid/conflicting tags fail |
| Memory/parser safety | ASan/UBSan for accepted/error corpus and boundary cases; TSan for concurrent contexts; no findings. At least 10,000 bounded seeded parser mutations with no crash, leak, hang or out-of-bounds access. Record seeds/builds; this is not exhaustive security proof |
| Originals/history | Full source hashes before/after identical for every fixture/corpus source; V1 golden manifest hashes unchanged; no V1 decision/history writes in operation traces; cancellation/restart/failure-injection tests show no cross-domain overwrite |
| V1 regression | Existing V1 tests still run unchanged; no new regression against the recorded baseline. The pre-existing Linux parity failure remains explicitly reported as a release blocker, not hidden by V2 tests |
| Real corpus | At least 300 distinct, approved files; 100% accounted for, source hashes verified, zero unexpected decode failures in the declared supported subset and zero parity mismatches. Known unsupported inputs remain visible in overall counts |
| Downstream V2 determinism | Identical technical features/threshold branches/burst assignments/rankings/decisions from identical V2 tensors across targets. Missing inference stays missing; fixed model/metadata/config receipts required |
| V1/V2 drift review | Ledger for every technical delta, threshold crossing, burst/rank/top-K change and classification flip. Zero unreviewed flips involving manual keeps or gold hero frames. No final-score compensation or existing threshold adjustment |
| Sports quality | Gold hero-frame miss count zero on the frozen evaluation set; V2 keeper precision/recall and top-50/100/200 overlap must be no worse than frozen V1 on the same evaluable set. Also satisfy owner-approved absolute floors, per-sport/camera checks and maximum override rate; those policy values must be signed before evaluation, not chosen afterward |
| Performance | Every timed admitted output retains qualified hashes; zero unexpected failures; memory/deadline limits honored; meet an owner-approved workload/hardware SLO fixed before the run. No throughput target is claimed until measured |
| Internal rollout | Restart/cancel/stale-worker/account-switch/partial-save/rollback tests pass; one full representative internal job completes without touching a V1 record; explicit sign-off required |

No-worse-than-V1 is not sufficient if V1 itself is poor. Absolute sports-quality floors, gold labels and supported sports are currently unresolved and block E. Report uncertainty and sample counts for precision/recall/overlap; do not claim generalization from a few fixtures or tune against a held-out test set. When fewer than K eligible frames exist, report top-K as not evaluable, not a perfect overlap.

Fixture organization separates: synthetic algorithm oracles, retained frozen V1 artifacts, independently approved V2 references, negative/error inputs, real camera compatibility files and private human-labeled sports evaluation. A candidate must never generate and approve its own expected output in the same test command. V2 golden creation is a separate reviewed operation with source/policy/build receipts; V1 files are read-only. Every future decoder/dependency change runs both relevant suites.

Metadata gets a separate retained-source comparison: filename/file ID, sensor and preview dimensions, orientation, capture time plus timezone/precision, camera make/model, lens, ISO, shutter, aperture, focal length, sequence/burst fields, rating and color label. Missing values remain absent; do not manufacture timestamps from file order or modification time. Compare existing fixtures' known values and preservation of raw metadata against frozen references; ambiguous/malformed metadata must not silently alter grouping. Additional camera fixtures each carry a metadata expectation manifest.

## 13. Future performance protocol — no optimization now

After B–E, measure JPEG and RAW-preview workloads separately at 1,000 / 5,000 / 10,000 / 20,000 distinct images when approved fixtures exist. Also retain 100/1,000/5,000 sports benchmark sizes for the labeled set. Missing sizes are reported as unavailable; repeated copies of a tiny dataset are a stress test, not camera-coverage or sports-quality evidence.

Record separately:

- Discovery/full-source verification and disk I/O time/bytes; RAW preview extraction images/sec and latency.
- Full JPEG decode images/sec, color conversion/sec, resize/sec, orientation/sealing time and complete canonicalization/sec.
- Metadata time, technical analysis time, model/inference time and complete culling images/sec; unavailable model stages are explicitly absent.
- Original detection/drop time, first usable canonical result, first useful ranked result and durable completion; do not reset the timer after enumeration.
- CPU utilization (core equivalents and total-machine percentage), total/peak resident RAM for worker group, concurrency, queue occupancy, failure categories and network bytes sent.
- Reference versus SIMD wall time/CPU/RAM with hashes checked; decode-only speed is not import/upload or end-to-end culling speed.

Use identical manifests, build receipts, machine/OS/storage settings and analysis configuration for comparisons. Report cold and warm trials separately, at least five measured trials with median and p95 per-image latency plus total-job time; document how cold state is achieved rather than assuming cache eviction. Keep tracing/hash verification cost visible, and report any excluded setup separately. Network-free local canonicalization has measured zero network traffic only if verified, not inferred. No JPEG thumbnail benchmark substitutes for RAW source transfer, preview extraction or 20,000-photo memory behavior.

If corpus size, hardware or labels are absent, report the exact missing prerequisite. No fabricated “400 photos/sec,” no background task declared complete when only rows are registered, and no quality reduction to make a speed result.

## 14. Risks, tradeoffs and unresolved decisions

| Risk | Mitigation / open decision |
|---|---|
| V1/V2 decision drift | New domain and shadow histories; D/E review. Integer-area sharpness is not V1 sharpness; unchanged thresholds are comparison controls, not automatically calibrated V2 policy |
| Existing-user compatibility | Explicit per-shoot activation, original IDs/revisions/manual history retained; current export unchanged |
| LCMS/toolchain differences | Strict build/policy and exact stage gate; settings alone do not prove determinism. Failure returns to architecture review |
| Camera preview variation | Qualify actual camera/firmware/source fixtures. Embedded JPEG already contains camera processing; it is not neutral sensor data |
| Limited initial input/profile scope | Surface unsupported status; expand only with fixtures and review, not silent fallback. Confirm whether gray ICC/LUT profiles or other RAW families are needed before first internal release |
| Library/security upgrades | Immutable dependency receipts and regression gates; byte-changing updates need a new domain; security failure may disable affected input support |
| Fixed ICC redistribution | Verify rights and exact artifact before Stage A; unresolved packaging blocks a frozen V2 build |
| Future Windows | Not supported by this initial qualification. Add Windows x86-64/ARM64 build/math/path/source-lifecycle tests and the complete hash matrix before claiming support |
| Benchmark contamination | Separate synthetic tests, stress duplicates, tuning and held-out gold; fixed manifests, no silent failed-image filtering, cold/warm disclosure |
| Accidental golden regeneration | Separate commands/directories and review rights; V1 reference hashes checked before/after; no auto-update flag in gate runner |
| Resource limits | Large/progressive JPEG coefficients and ICC parsing can consume substantial memory; bounded isolated jobs may reject inputs rather than alter pixels |
| No qualified sports model/dataset yet | E remains blocked until legitimate components/labels exist; no expression/action claims from unavailable features |

Tradeoff: this chooses reproducibility and inspectable behavior over reproducing undocumented Apple internals. It also chooses the tested integer-area algorithm over a potentially prettier resampler. That choice is reversible during draft review, but changing it after domain freeze requires a new domain. A general RAW-development pipeline and a production authenticated server are separate projects, not hidden extensions of this specification.

## 15. Estimated future files/modules — not changes made now

These are proposed locations, to be confirmed at Stage A; no stubs or code are created by this specification. Approximately 12–18 new focused source/test/build artifacts, plus narrowly scoped later adapters, are expected; this is a scope estimate, not a delivery-time promise.

| Area | Likely future files / scope |
|---|---|
| Pure contract/result | `native/include/lenslabs/canonical_v2.hpp` — buffer, receipt, typed errors, limits; no mutable global session |
| Core stages | `native/src/canonical_v2/source.cpp`, `jpeg.cpp`, `color.cpp`, `resize.cpp`, `orientation.cpp`, `provenance.cpp` |
| RAW adapter | Isolated V2 adapter around the inspected embedded-preview policy; preserve `raw_preview_source.hpp` behavior and its V1 callers |
| Dependencies/profiles | V2 dependency lock/bootstrap and hash-pinned, license-reviewed profile artifact; no platform-installed implicit dependencies |
| Native tests | `native/tests/canonical_v2_tests.cpp`, test-only stage probe and parser safety/fuzz entry points |
| Cross-platform harness | `tests/canonical-v2-parity.mjs` and versioned manifests for cameras, metadata and negative cases; reuse evidence conventions, not V1 golden generation |
| Build/CI | Add isolated V2 Makefile/CI targets after approval; preserve existing decoder/V1 gate targets and failure reporting |
| Later analysis boundary | Explicit V2-only experimental worker/session adapter; do not simply change the domain constant in `sports.hpp` or relax existing validation |
| Later corpus/benchmarks | Read-only runner extensions, drift ledger and resource measurements; no production UI or export changes |

No frontend files, customer data migrations, culling coefficient changes, production routing changes or current export modules belong to Stage A. Any necessary expansion must be brought back for approval.

## 16. Human approval questions and stopping point

Before Stage A:

1. Approve this exact shared-stack policy: libjpeg-turbo 3.1.4.1 ISLOW/fancy/full decode, LCMS 2.18, integer-area resize in gamma-encoded sRGB, orientation last, and strict byte identity?
2. Approve initial preview-only RAW scope and explicit unsupported-format/profile behavior, including the proposed limits, rather than a fallback to sensor development or OS decoding?
3. Approve the fixed output-profile choice **subject to verified redistribution rights**, or require a different licensed fixed profile before the contract is frozen?

Before corpus/quality qualification:

4. Which read-only 300-image manifest may be used, and which sports/cameras must be represented? Do not infer access to all customer libraries from this approval.
5. Who supplies/reviews manual sports gold and approves the absolute precision/recall/overlap floors, maximum override rate and representative performance SLO before the evaluation is run?

Before production, separately:

6. After evidence review, may the release policy admit the independently qualified V2 domain while retaining V1's unresolved Linux compatibility result and historical path? Which internal users/shoots may opt in first?

**Current result: architecture draft only. V2 is not implemented, parity is not proven, Linux is not safe to deploy, and no benchmark or metadata-test result is newly claimed. Stop here for review.**
