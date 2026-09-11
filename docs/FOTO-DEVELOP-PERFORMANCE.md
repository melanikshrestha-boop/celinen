# Develop import and histogram performance

## Scope and measurement

September 8, 2026. Local Vite development server at `127.0.0.1:8085`, headless Chromium at 1440 × 1000. The initial three-photo import experiment used three sequential before runs and three sequential after runs, with native benchmarking paused during browser measurements. Later native and library experiments state their own sample sizes below. These are local measurements, not production SLAs or a promise for every camera/card/computer.

Each run used a fresh reserved QA library and the same already-local public fixtures, in this order:

- Sony A6000 ARW: 25,624,576 bytes.
- Sony A7 IV small ARW: 22,933,504 bytes.
- Public CC0 volleyball portrait JPEG: 3,148,228 bytes.

This is **two RAWs plus one JPEG**, not the customer's three photographs. Customer libraries/originals were not used or altered. The actual in-app browser could not be controlled by the available UI service, so the customer-specific upload delay is not claimed reproduced.

Timings start at the real file input's `change` event, not at page navigation. Thumbnail readiness requires a decoded image; editing readiness requires the selected full-quality image and enabled Export. Upload means a local browser-to-local-native transfer, not a cloud upload.

| Metric, median of three runs                 |     Before |      After |
| -------------------------------------------- | ---------: | ---------: |
| First decoded thumbnail                      |   957.7 ms |   308.6 ms |
| All three decoded thumbnails                 |   957.7 ms |   767.1 ms |
| Selected full-quality image ready for export | 3,006.2 ms | 2,016.9 ms |
| Largest animation-frame gap during the run   |   234.1 ms |    75.0 ms |

The new temporary import preview first appeared at the same time as the first thumbnail. It is labeled **Import preview**, is not an export proof, and cannot be used as a crop/mask coordinate surface. The editor replaces it with the full-quality native result. This early preview must not be presented as a faster full-resolution sensor decode.

All three after runs started the pixel-analysis worker and performed **zero full-image main-thread pixel reads**. After-run histogram readiness was 2,511.6 / 2,100.3 / 2,098.3 ms. The first after run was slower (including its first native request); the reported medians include it.

Raw browser timing receipts: `/private/tmp/foto-speed-before-{1,2,3}.json` and `/private/tmp/foto-speed-after-{1,2,3}.json`. Temporary runtime receipts are not a substitute for the checked-in regression tests.

## Changes

- Import publishes exact photo/edit receipts only after the atomic IndexedDB transaction completes. It no longer waits for the last file to reveal the first photo or reloads the whole library for each receipt.
- Startup merges existing Studio media through saved receipts, avoiding its second full-library read. Existing originals and editing history remain merge-only.
- Import owns the bounded native processing lane while a batch is running. Opening its first preview does not start a competing full-sensor render.
- Cancelling folder enumeration before its first save flush forces a fresh final read; an old accumulator cannot replace the newly saved editing document.
- Neutral native treatment, inactive tone math and unchanged geometry avoid unnecessary processing. Constant grading colors are computed once per recipe, not once per pixel.
- Native RAW resizing at exactly original resolution uses byte-exact RGB-to-RGBA expansion instead of a box resampler.
- Histogram/clipping decoding and counting run in one bounded worker lane. Stale jobs are cancelled; browsers without worker canvas support use bounded cooperative tiles.
- Histogram luminance bins count actual encoded luminance instead of re-binning rounded 1024-bin linear values. The exact grayscale ramp retains all 256 bins (previously 238).
- Histogram paths are memoized; pointer previews are coalesced to one animation frame with an exact final commit. Individual R/G/B channel views and the `J` clipping shortcut are available.
- A graph describes the last measured displayed image and is marked updating while that image changes. Import previews and Before views retain explicit provenance.
- The RGB hover readout samples exactly one source pixel per animation frame; a component-local subscription avoids rerendering the entire editor on every pointer movement. Before/After transitions wait for the correct loaded image, and compare views do not report ambiguous samples.
- Tone-curve gestures retain pointer and recipe ownership. Cancel/lost capture restores the owned draft without adding history; external Undo/Reset and a second pointer cannot overwrite newer edits.

## Larger export option

The default remains 4,096 pixels. A separate **Up to 8,192 px / 36 MP** option enables larger output without upscaling. The verified public Sony A6000 exports at 6,024 × 4,024; this is not unlimited original-resolution support. A larger source fits within both dimensions and the pixel budget. Native RAW-source bounds remain 60 MP / 128 MiB, and JPEG output remains capped at 32 MiB.

Larger renders hold an exclusive processing lease. Standard processing keeps its existing two-raster/one-RAW limits. Cancellation, deadline and process errors retain the lease until the native child has actually closed. The server checks the returned JPEG dimensions before accepting it, and the histogram worker enforces the same pixel limit before allocating a canvas.

Measured native prototype peaks: the A6000 combined-effects recipe used approximately 1,052 MiB; a synthetic 36 MP combined-effects recipe used 1,322 MiB. Browser decoding, worker canvases and clipping overlays add memory beyond those native figures. Large output is deliberately opt-in, not the new default or a claim of low-memory operation.

Object removal has a separate 4,096-pixel render cap. Choosing a larger export does not force an oversized removal allocation or silently change the editor/export setting. The dialog discloses the separate rendered copy and never replaces the original.

## Large-library rendering

Separate exploratory before/after runs used 337 and 1,000 distinct **64 × 48 synthetic JPEGs**, generated previews and neutral documents. These measure SPA opening, DOM work, selection and filtering—not RAW import throughput. Both versions used the same 1440 × 1000 viewport with heavy native benchmarks paused. There is one run per size/version, not a statistically established median or production SLA.

The old filmstrip rendered every button/image and created an object URL for every thumbnail. Lazy image loading did not avoid that DOM/URL work. The new window keeps visible thumbnails plus four neighbors on each side, and at most one additional focused item. Scrolling never selects a photo; global IDs, filters, ratings and Home/End selection still address the full library.

| Filmstrip check                         | 337 before → after | 1,000 before → after |
| --------------------------------------- | -----------------: | -------------------: |
| Mounted thumbnail images                |           337 → 15 |           1,000 → 15 |
| First native-owned image ready          |   661.3 → 388.3 ms |     822.0 → 398.2 ms |
| Next photo native-ready                 |    151.1 → 87.5 ms |      599.6 → 61.3 ms |
| Largest long task, initial opening      |         108 → 0 ms |          265 → 66 ms |
| Largest long task, entire measured flow |         108 → 0 ms |          617 → 66 ms |
| Largest animation-frame gap             |    116.7 → 49.0 ms |      616.6 → 78.6 ms |

Zero long tasks means none crossed the browser's reporting threshold, not zero CPU work. The 617 ms baseline stall occurred during later filter expansion, not initial opening. After runs verified all logical photo IDs, window bounds, scrolling to the last photo, exact native-source ownership, four filters and unchanged source/preview/document digests. Each removed only its generated records and confirmed zero remaining records and object URLs after unmount. Receipts: `/private/tmp/foto-volume{337,1000}-result.json` and `/private/tmp/foto-volume{337,1000}-after-result.json`.

Library mode showed the same mechanism independently. A separate responsive, vertically windowed grid preserves missing-source cards, ratings, arrow/Home/End selection and double-click opening.

| Library check, 1,000 synthetic photos         |   Before |   After |
| --------------------------------------------- | -------: | ------: |
| Mounted grid image elements                   |    1,000 |      24 |
| Peak total tracked live object URLs           |    1,017 |      41 |
| Visible images decoded after clicking Library | 338.8 ms | 26.6 ms |
| Largest animation-frame gap                   | 183.7 ms | 15.8 ms |
| Last photo native-ready after opening         |  94.6 ms | 90.9 ms |

These are one exploratory run each, not a general 12.7× speed guarantee. The old grid's lazy-load-dependent cards collapsed: its scroll height was 8,523 pixels, versus 49,523 for the new fixed 189-pixel cards with a 198-pixel row stride. Therefore the comparison is not identical visible-card geometry. The 41 URLs include 17 from warmup/non-grid consumers, not 41 grid thumbnails. The final flow passed nine checks, retained exact source/preview/document digests, then removed its generated 1,000 photo/document pairs with zero remaining records and zero tracked URLs after unmount. Receipts: `/private/tmp/foto-grid1000-before-result.json` and `/private/tmp/foto-grid1000-after-result.json`. Desktop and mobile card layouts were visually inspected.

## Native Detail controls and quality boundaries

Radius (0.5–3 rendered pixels), Fine detail (0–100) and Edge masking (0–100) are real native adjustments. Radius uses a fractional separable local blur; Fine detail gates weak sharpening residuals; Edge masking protects low-gradient areas. This is independent classical sharpening, not Adobe's private algorithm, focus reconstruction or learned denoising. Inspect at 100% and use restraint on noisy or heavily compressed input.

Compatibility defaults are Radius 1, Fine detail 100 and Edge masking 0. Absent old fields receive these defaults without rewriting saved input. Protocols 1–3 retain prior behavior; nondefault Detail settings use protocol 4 unless Smooth curves select protocol 5. Sharpening amount zero makes the three new fields pixel-inactive. Portable presets, Undo/Redo, snapshots and recovery retain their values.

The native optimized and sanitized suites each passed **172,273 assertions** at this checkpoint. Twenty-five legacy JPEG pairs remained byte-identical. Sixteen actual v4 serializer → sanitized-native DNG renders passed, including all eight orientations. A public Sony test produced distinct v3/v4 JPEGs with unchanged source bytes. Live Detail verification passed **10 checks plus 3 real-reload checks**, including independently changed pixels, exact Undo/Redo, saved values and identical editor/export/reloaded-export SHA-256 `14f39b3e3856889a632530bee486de49539c96c835b2cfa07648b09256482e71`.

Three paired synthetic 36 MP all-effects runs stayed below 2 GiB native peak RSS, but allocator variation was substantial: old 1,341–1,431 MiB, extended 1,240–1,625 MiB. Do not claim equal measured peaks. Bounded row rings replace a candidate full-frame guide allocation. The synthetic capacity fixture's denoise threshold suppresses its sharpening residuals, so equal output fingerprints there are **capacity evidence, not proof of visible Detail differences**. Real-photo and edge/noise tests supply the separate effect evidence.

A scratch-only 224-render denoise experiment used four deterministic 256 × 256 clean targets with known zero-mean luminance/chroma/mixed noise. On its flat-field case, luminance strength 100 reduced noise variance 94.5%, and color strength 100 reduced chroma-noise energy 88.7%. Those are synthetic measurements, not camera-quality promises. At maximum strength the test retained about 77% of a gray step's adjacent contrast and 33.5% of a near-isoluminant color step's contrast. Coherent texture also softened. No existing denoise algorithm was silently retuned from these fixtures. Reproducible limitations and all metrics: `/private/tmp/foto-denoise-truth.1cgBqF/REPORT.md` and `metrics.csv`.

The final actual UI control sweep passed **81 checks across 25 controls**: all 13 Basic controls, six standalone film effects, three Detail amounts and the three tonal grading saturations. Every case produced a different native JPEG, a completed histogram and byte-exact Undo to the explicitly asserted neutral baseline. Other photographs' histories and RAW source bytes stayed unchanged. This tests wiring and reversibility, not Adobe equivalence or the aesthetic quality of every setting. Receipt: `/private/tmp/foto-controls-sweep-final-live.json`. The earlier 80-check run did not explicitly assert neutrality and its generic Reset selector could match the Crop Reset; the final fixture scopes the global footer Reset and verifies the complete saved recipe before starting.

A separate final Color Mixer sweep passed **103 checks across all 24 HSL controls** (eight ranges × Hue/Saturation/Luminance). Each stored only its intended range/value, changed the actual native JPEG, completed the histogram, and undid to exact baseline JPEG bytes and settings. All three original source hashes and the other two full documents stayed unchanged. This is control wiring and reversibility on one public Sony photo, not accuracy against a calibrated color chart or additional Color Grading coverage. Receipt: `/private/tmp/foto-color-controls-final-live.json`; replay body: `tests/develop-color-controls.browser.js`.

## Native equivalence and timing

The final raster-stage optimization uses an **exact 256-entry RGB float table**, not an interpolated approximation. Input codes are already RGB8; the table applies the original exposure expression, float rounding and independent global temperature/tint expressions once per possible code. Later cross-channel math and local masks are untouched. This adds about 3 KiB, not another image allocation. Across 22,676 parameter combinations and all 256 codes, **17,415,168 float-bit comparisons were exact**. Final optimized and sanitized native suites each passed **442,188 assertions**, 25 legacy JPEG pairs and 16 new mixed-feature raster/RAW pairs remained byte-identical, and the reference executable was relinked.

Five alternating 2.97 MP core-only trials measured Exposure **254.4 → 43.8 ms**, global Temp/Tint **58.3 → 42.6 ms**, both **269.9 → 43.2 ms**, and a Smooth/Detail/grade/denoise/grain combination **532.9 → 275.6 ms**. These exclude decoding, encoding, network and browser work. Sensor RAW exposure/white balance is handled by LibRaw, so these numbers must **not** be described as RAW import or demosaic speedups. Full scope and all trials: `/private/tmp/foto-source-table.ppsjeq/REPORT.md` and `bench.json`.

## Smooth point curves

Smooth is explicit and opt-in; every existing/absent interpolation setting remains Linear. It uses shape-preserving cubic Hermite segments following the [PCHIP slope construction](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.PchipInterpolator.html), with bounded coefficient tables computed once, no segment overshoot, and exact control-point interpolation. Two-point curves remain lines. Numerically unrepresentable slopes fall back to the existing whole-curve linear evaluation. The UI samples the same function, including exact knots. Native and TypeScript helper evaluations agreed exactly across **107 tables / 56,508 samples**, including non-monotone artistic curves. That numeric comparison ran through Bun; the separate live browser checks below verify integration.

Protocol 5 carries the interpolation choice after the complete Detail tail; protocols 1–4 keep old behavior. A reference fit transfers its own Linear interpolation together with its fitted points, rather than combining those points with an unrelated prior Smooth mode. The real UI passed **13 edit checks and 5 reload checks** for independent master/Red points, a single mode-change history step, exact Undo/Redo, unchanged originals/other histories, and identical editor/proof/reloaded-export SHA-256 `a438e6d0d6cc1746e62b88045c9b588eba73bab0902fd6200940955a30dc192b`. The first test attempt queried the Red control before React completed switching channels; adding a readiness wait fixed the test, not the application. Receipts: `/private/tmp/foto-smooth-curve-live.json` and `/private/tmp/foto-smooth-curve-reload-live.json`.

## Earlier native timing checkpoints

Native performance work uses the same decoder quality and unchanged denoise ordering. Optimized versus pre-change outputs were compared byte-for-byte, not judged by similar-looking screenshots.

Neutral large-output render medians (five alternating runs): A6000 1,416 → 1,018 ms; A7 IV small 580 → 262 ms. Source hashes were unchanged. All 25 initial paired JPEG comparisons were identical.

For the edited pixel-processing stage alone, A7 IV 1600-edge medians were grading 147.5 → 47.5 ms, curves 90.1 → 35.9 ms, luminance denoise 100.4 → 63.8 ms, grain 61.1 → 24.6 ms, clarity 69.6 → 34.0 ms, combined 255.2 → 145.4 ms. These exclude RAW decode and JPEG encode. They are not end-to-end UI speedups. The second optimization passed 1,000 distinct synthetic recipes and 96 paired public-fixture render comparisons with identical bytes.

Optimized and Address/UndefinedBehaviorSanitizer native suites each passed 113,708 assertions at this earlier checkpoint, superseded by the final 442,188-assertion native run above.

## Verification and limits

- Actual IndexedDB receipt test: 20 checks passed; its six disposable records were removed with zero remaining records confirmed. It includes atomic failure, observer failure and cancellation-after-commit cases.
- Actual component lifecycle tests cover stale analysis ownership, Before provenance, cancellation, clipping ownership and lightweight image loading.
- The default pipeline remains bounded, preview/export matched and non-destructive. Full Lightroom Classic parity is not claimed. High-bit-depth processing, broader camera coverage, RAW-calibrated white balance and output above the stated pixel budget remain separate gaps.
- Histogram RGB counts and warnings describe the rendered sRGB image, **not unclipped sensor RAW values**. Exposure assistance measures a neutral render, not the current artistically graded output.
- UI reference behavior was checked against [Adobe's tone and color documentation](https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/image-tone-color.html). FOTO's mathematical implementation is its own; Adobe engine equivalence is not claimed.

## Final integration checkpoint

Completed live checks at this checkpoint:

- **37 import lifecycle checks:** dirty-draft preservation during delayed/unreadable directory enumeration, cancellation, late callbacks, first-preview visibility before a second request completes, durable first-photo retention after Stop, and the next edit's compare-and-swap/history. Four disposable records removed; zero remained. Directory handles and delayed requests are synthetic test inputs driving the real React/collector/native/IndexedDB path; this is not an OS-originated drag or throughput measurement.
- **17 histogram checks:** exact RGB readout, 100 pointer events coalesced into one 1 × 1 read, channel/scale geometry, Before provenance, compare suppression, `J` clipping, released full-size clipping canvas when disabled, and unchanged documents. Final receipt: `/private/tmp/foto-histogram-final-live.json`.
- **10 larger-export checks:** real Exposure and Grain controls change the histogram/render and persist. Editor, proof and intercepted download payload are byte-identical at 6,024 × 4,024 on the final Smooth/Detail/source-table build. All original bytes and the other two photo histories are unchanged. SHA-256: `26e52f3fa2d094b12f0642f6e75fd7ed8cdd0580a499c59baf040499120b546c`. This verifies the actual download payload, not an OS file-save dialog. Receipt: `/private/tmp/foto-highres-final-parity-live.json`.
- **7 removal integration checks:** a 6,024 × 4,024 editor prepares a separate 4,096 × 2,736 removal image; cancellation preserves its 8,192 setting and all three histories, and creates no copy.
- **17 rapid-navigation checks:** 12 rapid four-arrow cycles plus eight settled selections retained native source ownership, never enabled stale-frame export, preserved all source/preview/document digests, and restored selection. The instrumented run made 77 requests: 38 successful, 32 cancelled as obsolete, and seven explicit worker-busy responses recovered through the existing bounded retry path. This is not a zero-429 claim; that checkpoint used eight fixed 500 ms waits. The later cancellation-handoff checkpoint below changes their timing. Request instrumentation hashes large RAW bodies, so this is correctness stress—not a throughput benchmark. Receipt: `/private/tmp/foto-navigation-stress-live.json`.
- **10 actual worker/fallback checks:** all histogram bins and counts matched on the same 4,096 × 2,736 native image; worker cancellation/queued follow-up and cooperative-fallback cancellation/reuse passed without document changes. The fallback yielded 85 animation frames with a 16.9 ms largest gap in this diagnostic. Concurrent native tests mean its 257 ms worker / 709.6 ms fallback observations are not a controlled performance comparison. Receipt: `/private/tmp/foto-analysis-fallback-live.json`.
- Actual 390 × 844 viewport has a 390-pixel document width, no document-wide horizontal overflow, visible Import/Export and the same sans-serif stack. Final desktop/mobile Develop and Library screenshots were inspected: `/private/tmp/foto-{develop,library}-final-{desktop,mobile}.png`.
- Reloading the cleaned public QA library shows the real empty state: zero rendered-photo images, zero filmstrip buttons, zero histogram paths and enabled Import / Import photos / Choose folder actions. No stale editing panel or export action is displayed. Receipt and inspected screenshot: `/private/tmp/foto-empty-develop-final.json` and `/private/tmp/foto-develop-empty-final.png`.
- Native high-resolution checkpoint: 128,727 assertions in both optimized and sanitized builds; decoder 153 optimized / 97 sanitized assertions, plus 16 sanitized orientation/render cases. Six legacy 4,096-pixel JPEG pairs remained byte-identical. The final native Develop suite passes 442,188 assertions in both optimized and sanitized builds, including newer Smooth/Detail/table cases.
- Final full repository run, with public Sony fixtures enabled: **1,753 passed, 19 skipped, one explicit TODO, zero failures, 361,609 assertions** across 136 files. The skips require the optional Lua runtime; the TODO records the unresolved versioned RAW white-balance continuity fix, not a passing implementation. The earlier 1,748-test checkpoint and separate 33-test Sony pass are superseded by this final run. TypeScript, scoped Develop TypeScript/component lint, `make -C native all`, `make -C native test` and production build passed. All 33 browser-evaluation bodies compile in their real AsyncFunction envelope; running ordinary module-mode ESLint on them reports top-level-return parse errors and is not claimed as a passing check.

After final browser QA, cleanup first audited all 21 original SHA-256 values and exact photo/document keys in reserved libraries `eeaf3000-1111-4222-8333-000000000091` through `...097`. One atomic compare-and-swap transaction removed only those 21 public QA photos and 21 QA documents; readback confirmed zero photos/documents in each namespace. Public source files, screenshots, reports, presets, Studio records and all other namespaces were untouched. These intentionally discarded QA edit histories are not restored by reimporting the source files. Audit and removal receipts: `/private/tmp/foto-public-performance-cleanup-audit.json` and `/private/tmp/foto-public-performance-cleanup-final.json`.

Full Lightroom Classic parity remains unfinished; the concrete precision, RAW WB, profiles, recovery and removal-quality gaps are listed in [the capabilities audit](FOTO-DEVELOP-PARITY.md). `tests/develop-raw-wb-boundary.test.ts` now reproduces the known missing-camera-WB discontinuity on tiny generated DNGs using a direct native RGBA probe. It characterizes current legacy behavior and separately records a future versioned-continuity TODO; no processing or saved-recipe behavior was changed by that diagnostic.

## Reproduction boundaries

Run from the repository root on macOS with the pinned native dependency already bootstrapped as described in `native/README.md`:

```sh
make -C native all
make -C native test
bun test
npx tsc --noEmit
npm run build
```

The default tests do not download RAW files. Enable `LENSLABS_RAW_FIXTURES` only for a local directory containing the two checksum-verified public assets documented in `native/README.md`. Sanitizer binaries are correctness checks, never timing baselines. The generated white-balance diagnostic requires the built macOS native objects; other platforms explicitly skip that native probe.

Live `.browser.js` files are async browser-evaluation bodies, not standalone Node scripts. Use a separate local QA browser/profile and their exact reserved routes. Large-library fixture actions create, measure and remove only generated records; the public-photo cleanup body verifies every exact source digest and namespace before allowing an atomic removal. Do not replace their guards with customer shoot IDs or use them to clear a real library. Public source files and any customer `.env` configuration are never cleanup targets.

The app must have the local native service running (`npm run dev:lab`, loopback port 8085). A hosted static page or the production web build alone does not supply the macOS C++ executables. These changes remain in the existing local working tree; this verification did not commit, push, deploy, replace the branch or alter account settings.

## Cancellation handoff, September 8, 23:00 UTC continuation

A definite busy response used to schedule its first retry after 500 ms even when the cancelled process had already closed. The client now uses waits of **100, 200, 300, 400, 600, 700, 800 and 900 ms**. The maximum remains eight retries and 4,000 ms of scheduled waiting, independent of one token renewal. Source, recipe and signal are snapshotted once; uncertain failures are never retried. Native concurrency and memory limits are unchanged.

Three sequential before and three sequential after trials used an isolated **Node** HTTP server, the real Develop transport and C++ executable, a checksum-verified public A6000 RAW blocking the larger-export lane, then the public CC0 JPEG. The first actual 429 triggers cancellation of the blocker. No IndexedDB, customer photo, browser navigation or cloud upload participates in this narrow experiment.

| Median of three trials              |    Before |     After |
| ----------------------------------- | --------: | --------: |
| First retry after actual 429/cancel |  501.9 ms |  102.1 ms |
| Next JPEG received                  |  639.2 ms |  221.4 ms |
| Requests for next JPEG              |         2 |         2 |
| Submitted bytes for next JPEG       | 6,299,140 | 6,299,140 |

The cancelled request's handler completed within 2.6–3.7 ms before and 2.2–3.9 ms after cancellation. This includes temporary-file cleanup and is an **upper bound** on lane release, not an instrumented child-close timestamp. Each trial required a real connection-close event, an actual 429 followed by 200, the identical immutable retry packet, unchanged original hashes and the same output JPEG SHA-256: `ea3b9ef475fae758425778addbd120944673e250673f90fb2efa30ddd3ffd8b4`.

An initial Bun HTTP-server harness did not deliver the same abort/response-close event as Node; those measurements were discarded. The retained fixture runs in Node like Vite and fails if the connection never reports cancellation. Receipts: `/private/tmp/foto-retry-node-before.log` and `/private/tmp/foto-retry-node-after.log`.

This improves fast cancellation handoffs, **not every busy job**. A long-running RAW can encounter more early retries, resending its body, and the later backoff can wait longer than the former fixed cadence at some release times. The retry count and cumulative scheduled wait remain bounded; wall time also includes transport and native processing. There is no claim of universally faster RAW processing or a production SLA.

Reproduce on macOS after building the native engine: `LENSLABS_RAW_FIXTURES=/path/to/verified-fixtures node --import tsx tests/develop-retry-handoff.fixture.ts`. Engines with the older 4,096-edge capability instead use their single RAW lane and a generated Bayer DNG target; that validates compatibility but is not the JPEG timing experiment above. The test has phase/subprocess deadlines and does not leave a running fixture on failure.

Final recheck: **1,759 passed, 19 skipped, one explicit RAW-WB TODO, zero failures, 361,770 assertions**. TypeScript, scoped lint and production build passed. An isolated candidate also passed 46 focused tests / 1,364 assertions, TypeScript, lint and build, then repeated the focused tests against its own rebuilt baseline native engine (88,713 native Develop assertions).

Only the four-file retry fix was pushed to the existing private branch as `ab07ac8dd48c3d172c4e820b3dcacdfde2c828e3`; remote readback confirmed it. That commit contains the client retry change, its unit/integration fixture and a standalone sprint entry. The broader import/histogram/curves/Detail/high-resolution work documented above remains local and was not silently included. The environment files and unrelated changes were neither staged nor modified. This was Git sync, not a hosted deployment.
