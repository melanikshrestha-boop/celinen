# Culling and preset checkpoint — 2026-09-13

This document records the local implementation and its verification boundaries.
It does not establish hosted deployment, completion of the larger sports-culling
brief, or Adobe rendering equivalence. Original bytes, photographer decisions,
crop/mask intent and existing history remain protected by the current workflow.

## Delivered in this checkpoint

### Native scheduling and measured stages

`process()` uses a fixed-capacity decode→analysis queue with one analysis consumer
when multiple image permits are available. A permit follows its job through
decode, queue, analysis and receipt delivery, preserving the previous conservative
256 MiB kernel-buffer admission estimate. ImageIO/LibRaw internal allocations
are additional. A single admitted image uses fused processing. `--fused` allows
paired CLI comparison. Cancellation stops admission; queued work is abandoned
and in-flight system decoding is allowed to return. Callback failures stop and
join the workers. No new model or scoring rule is introduced.

The native worker obtains capture metadata from the decoder's held source and
existing properties instead of opening and parsing the source again. RAW capture
metadata comes from the original source, not the embedded JPEG. The previous
capture-time/camera-key parser and area-average analysis math remain intact.
Previews at or below 256px can be analyzed without a redundant RGBA copy.

Worker responses expose the actual preview origin, original dimensions, analyzed
dimensions, and measured stage times. `decode_total` includes source setup, RAW
extraction, ImageIO decode/resize, RGBA conversion and metadata. Those substages
must not be added again to total decoding time. ImageIO combines decode,
orientation and thumbnail resize, so no separate JPEG-only throughput is claimed.

### Admission before transfer and preview reuse

The browser first sends a small authenticated same-origin request to
`/__native/admission`. Four native lanes are reserved with random single-use
tokens; the bounded FIFO queue holds no photo bodies. Waiting requests time out
after 30 seconds and unclaimed reservations expire after 15 seconds. A claimed
lane stays owned until its upload/processing cleanup finishes. Cancellation while
waiting removes the waiter. Cancellation after reservation does not start the
upload; an abandoned token expires. A busy or failed upload is not automatically
resent as another original-body transfer. Existing loopback, Host, Origin and
session-token checks cover admission as well as processing.

Canonical import reuses the native result's JPEG preview and measurements instead
of performing an additional full Develop render solely to populate Cull. The
native path still returns a bounded preview and performs mechanical analysis at
the worker's 256px analysis edge. At most four preparation jobs, including at most
two RAW preparations, are active. When native analysis is unavailable, the prior
Develop preparation path remains available; a native failure is not silently
rerouted. Full RAW editing/export retains its separate rendering requirements.

`embedded_raw_jpeg`, `raster_decode` and unknown older-worker origin remain
distinct. Filename extensions do not prove embedded-preview provenance. An older
worker's measured result may be retained with explicit unknown representation;
it does not become full-resolution source or RAW-development evidence.

### Durable mechanical analysis

Photo documents now carry a versioned mechanical receipt bound to namespace,
photo ID and source digest. It records engine/version, measured representation
and dimensions, exact clipping percentages, hash, tone statistics and available
capture evidence. Invalid or foreign receipts are rejected. Unknown capabilities
remain unavailable; saved measurements are not trained-model predictions.

Import stores the receipt with the canonical photo/document and increments
`Analyzed` only after the storage acknowledgement. Failed persistence does not
advance `Saved` or `Analyzed`; a commit that finishes just before cancellation
still remains acknowledged. Preview-only fallback does not invent analysis.

Cull projects valid saved receipts when reopened. Unchanged flushes avoid a
full-library read/write, while changed review/analysis reads the affected
documents and uses revision checks. Import notifications merge validated commit
receipts and preserve manifest order; incomplete notification batches fall back
to the repository read. Older records, original attachments, existing treatment
history and photographer picks are retained. Stale editor writes cannot silently
erase a newer analysis receipt.

### Lightroom XMP and adaptive preset application

Develop's preset exchange accepts a reviewed, explicitly approximate XMP
translation. Supported fields cover global exposure/tone, presence, native
detail controls, eight-channel HSL, and explicit master/RGB point curves.
The [field mapping](adobe-settings.md#develop-xmp-preset-files--2026-09-13) lists
supported ranges. Adobe profiles, Kelvin/white balance, local/AI adjustments,
geometry and unmapped settings remain disclosed omissions. Named curves without
explicit points are not silently treated as imported curves.

The import is data-only and bounded; unsupported-only presets, malformed XML,
external entities, ambiguous duplicate settings and invalid supported numbers
are refused. The user acknowledges the translation before saving/exporting its
portable preset. Import does not apply to a photo. Normal preset application
preserves current crop and masks and enters editable history.

Adaptive lighting adjusts exposure from source-preview histogram evidence and
available highlight headroom while retaining the authored look's other controls.
It waits for source statistics and does not report a preset applied if editing
is rejected. This is a bounded heuristic, not scene understanding or Adobe Auto.

## Verification recorded so far

Full native release and AddressSanitizer/UndefinedBehaviorSanitizer suites passed
for the native changes. The optional CC0 Sony RAW corpus was unavailable and
explicitly skipped; the separately built LibRaw dependency is not sanitizer
instrumented. Existing checked-in public JPEG fixtures retained their bytes.

The native benchmark evidence is in
[ANALYSIS-PERFORMANCE.md](../native/ANALYSIS-PERFORMANCE.md). Three paired
300-operation CLI trials on three repeated JPEGs showed only about a 1% staged
change. Three 102-operation worker trials at 1280px reduced per-request medians
from 47.08–48.26 ms to 44.20–45.30 ms; full-run timing was noisy and one candidate
trial was slower. Every paired JPEG/analysis/tone/capture content checksum matched.
One 1002-operation, 256px, single-worker run on the same three JPEGs took
16.767 seconds. These are repeated-source stage measurements, not a unique shoot
or evidence of 400 photos/s. ImageIO decoding remains the main cost.

Targeted admission/client/parser tests passed during independent review. Storage
and import regressions use isolated test fixtures, including IndexedDB doubles;
they are not live customer-library recovery or real camera-quality evidence.
The following commands identify the relevant repeatable checks:

```sh
make -C native test
make -C native sanitize
bun test tests/native-admission.test.ts tests/native-admission-client.test.ts tests/native-preview-provenance.test.ts
bun test tests/develop-import-native-preview.test.ts tests/develop-import-analysis-ack.test.ts tests/develop-analysis-durability.test.ts tests/studio-compatibility-save.test.ts
bun test tests/lightroom-native-preset.test.ts tests/adaptive-preset.test.ts tests/adobe-paste.test.ts
```

## Browser verification

The actual lab at `http://127.0.0.1:8085` was tested in an isolated Chromium
profile using only the three checked-in public JPEG fixtures. No customer
library, customer original or production database was changed by QA.

- Dashboard picker → Studio: three native admission requests, exactly three
  original analysis uploads and zero full Develop renders during import.
- Final warm/cache-reused smoke run: first and all three visible previews at
  249 ms from the original picker change event. An earlier first observed run
  took 528.3 ms; source OS-cache state was uncontrolled. These are three-image
  smoke timings, not cold RAW or unique 1,000/10,000-photo benchmarks. Do not
  extrapolate a photos-per-second claim from them.
- Reload: three frames and decisions restored with zero analysis uploads.
  Saved native version remained `lenslabs-cpp-0.1`; analysis dimensions were
  192×256, 256×161 and 256×170 rather than the larger display-preview sizes.
- Original blobs were read back and SHA-256 checked: 3,148,228; 3,032,556; and
  1,174,531 bytes, each exactly matching its fixture/content identity.
- Reject → open Develop within 68.3 ms: rejected frame remained rejected in
  the stored document. Selection correctly advanced to the next frame.
- Imported `tests/fixtures/lightroom-global-look.xmp` in the existing preset
  exchange. Saving stayed disabled until approximate-translation acceptance.
  Temperature and CameraProfile omissions were visible. Applied exposure 0.25,
  contrast 12, highlights −20, shadows 15, vibrance 8, blue HSL −6/+10/−4 and the
  four-point curve survived a fresh Develop reload in editable history.
- Native export proof and actual downloaded JPEG both measured 2256×1420,
  1,643,532 bytes and SHA-256
  `243a219792c42825553633e355c4b8474e5412bd9ba282356a6ed30c3902fc58`.
  This proves the approved native proof matched the download, not Adobe pixels.
- Existing layout was visually inspected after reload. No new shell, typography
  system or color design was introduced. People/jersey tools remained closed.

Browser testing caught and regression tests protect against loss of receipt
provenance when display dimensions differ. Independent review also caught a
stale buffered import receipt conflicting with a newer pick and an unbound
receipt blocking edits after explicit original reconnection. The fixes preserve
strict merge guards, use a validated reread for stale notifications, and keep
the exact old unbound receipt inert without relabeling it as new-source analysis.
Runtime/legacy projections cannot resurrect that stale evidence.

Final full Bun run: **2,399 pass, 21 skip, 1 todo, 5 fail** (2,426 tests;
455,439 assertions). The five appearance failures are unchanged at baseline
`1ceac9c`: brand-mark, Develop light chrome, shoot-tabs default appearance,
sidebar metrics and typography expectations. Those files were compared with
baseline; neither the shipped appearance nor assertions were rewritten to hide
the baseline failures. Web production build and scoped changed-code ESLint pass.
Project-wide TypeScript checks still report existing diagnostics; this is not
a claim of a globally clean typecheck or production-ready 400-photo/s engine.

## Still required for the larger brief

- A trained, licensed and evaluated Core ML shared encoder with multi-head
  quality/action outputs and usable embeddings; current statistics are mechanical.
- A measured conditional second-pass cascade and learned sequence ranking, with
  uncertain/unsupported cases retained for photographer review.
- Representative, consenting RAW/JPEG sports shoots with camera mix, labels,
  keeper recall, correction time, first usable image and failure rates measured.
- Verification of **10,000 unique sports RAWs → final ranked cull in ≤25 seconds**
  on the target hardware, including discovery, extraction, decode, analysis,
  grouping and durable writes. No current fixture run meets that evidentiary bar.
- Sustained RAW memory/cancellation testing, actual Core ML batching/device
  measurements, and cold/warm source-cache reporting.
- Real Lightroom-exported preset round trips and photographed-output comparison;
  matching supported control values is not matching Adobe pixels.
- Hosted native service/desktop distribution and production validation. A Git
  push or web publication does not deploy the macOS C++ worker.
