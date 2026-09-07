# Local Studio workflow backtest — September 4, 2026

## Outcome and boundary

Implemented and verified locally: the existing Studio folder-drop flow now uses persistent C++ workers for preview decode/analysis when the native engine is available; `review bursts` opens conservative native grouping and linked comparison; `prepare 2 press photos` opens a keeper-only deadline ZIP workflow. The existing header, left Assistant, contact sheet, loupe and edit desk were retained. New workflows are secondary dialogs, also accessible through the existing overflow menu.

This is a **fixture/regression backtest**, not a labeled sports-selection accuracy study. No 90% accuracy, full RAW development, production-native deployment, or world's-fastest claim is established. No user shoot was inspected, changed, uploaded or delivered. Deadline pixels still use the existing browser renderer; native C++ is integrated for decode/analysis/grouping, not a complete editor replacement.

## Reproduction

```sh
make -C native -j4
make -C native test
make -C native sanitize
bun test
npx tsc --noEmit
npm run build
npm run dev
```

Native HTTP tests need permission to bind ephemeral loopback ports. The transport is serve-only and macOS-local; public production builds do not expose it. Browser testing used the installed browse skill against `http://localhost:8080/studio`, at 1280×720, in an isolated browser profile and named fixture project. No existing user project was cleared.

Browser helpers in `scripts/qa/`:

- `native-workflow.browser.js`: chat folder drop of three included real JPEGs plus one byte-identical fixture copy. Requires an empty project named `QA native workflow — September 4`; directory handles are simulated, so this is not an OS permission-dialog test.
- `native-timing.browser.js`: three concurrent native requests, repeated three times, reporting cache flags. Restart the dev server before a cold run; always inspect flags rather than assuming coldness.
- `capture-deadline.browser.js`: observes the next explicit fixture ZIP download without preventing it, for byte inspection.
- `deadline-fidelity.browser.js`: compares the two recorded fixture outputs with independent calls to the existing Studio renderer. Expected hashes correspond to the recorded two-keeper recipe, not arbitrary projects.

## Verified results

| Check | Result |
|---|---|
| Web/workflow/transport regression suite | 541 tests passed; 4,696 assertions; 0 failures |
| Native release checks | 4,536 passed: core 462, decoder 72, pipeline 172, worker 337, bursts 3,493 |
| Native ASan + UBSan | All five suites passed |
| TypeScript, touched-feature lint, production build | Passed; build retains existing framework deprecation/chunk warnings |
| Chat folder import | All four fixtures readable and persisted with `analysisBackend: native-cpp`; all initially undecided |
| Persistence | Four frames, originals and native metadata restored after dev-server reload |
| Orientation | EXIF-oriented portrait produced an upright 960×1280 native preview |
| Burst comparison | Exactly the known copied pair grouped; explicitly labeled similar frames, not a confirmed burst; 2× linked preview visually checked |
| Picks | Keeping one comparison candidate did not reject its alternative; export preserved two keepers and two undecided frames |
| Deadline workflow | Explicit recipe preview → JPEG preparation → download; exactly two JPEGs plus manifest |
| Export fidelity | Both downloaded JPEG SHA-256 hashes exactly matched independent existing-renderer calls with current edits |
| Source safety | All three original fixture SHA-256 hashes unchanged after import, grouping and export |
| Browser runtime | No application errors observed; existing Canvas2D readback performance warning remains |

The browser skill influenced verification: it exercised the actual controls, exposed the saved-project reload boundary, and provided screenshots and downloaded-byte inspection rather than relying only on successful route loads.

## Timing observations—not throughput or accuracy promises

Machine: Apple M3 Pro, 11 logical CPUs, 18 GiB RAM, macOS 14.3; Apple clang 15.0.0, optimized C++20 build. Measurements are single-session observations, not statistically controlled comparisons.

Three unique JPEGs, 7,355,315 total source bytes, requested concurrently through the real local HTTP transport:

| Round | Wall time | Cache |
|---|---:|---|
| First batch | 177.1 ms | 0/3 hits |
| Second batch | 14.6 ms | 3/3 hits |
| Third batch | 10.1 ms | 3/3 hits |

These timings include local upload/spooling, hashing, process/decoder work when uncached, JPEG receipt transfer and client validation. Source-fixture fetching precedes timing. They exclude directory discovery, saved-project persistence, UI paint, and deadline rendering. OS file caches were not flushed. Outputs are up to 1280px with analysis at 256px. Do not extrapolate three photos into 3,000-photo throughput.

The release burst test grouped **3,000 synthetic analysis receipts** in **0.473 ms**, using 5,400 hash comparisons in its latest run. This measures only grouping already-computed metadata, not decoding 3,000 unique photos. The deadline stress test selects 200 outputs from 3,000 metadata fixtures using a test renderer; it is not a 200-image pixel benchmark.

## Downloaded fixture evidence

ZIP: 1,670,643 bytes; two JPEGs and `manifest.json`; no unrelated frames.

| Output | Actual dimensions | Edits | SHA-256 |
|---|---|---|---|
| `press-001.jpg` | 1536×1920 | Portrait; warmth +2; 4:5 crop | `b2c4e518a301170814a8887969fbc04e31ca58c1806457773a777491e730debe` |
| `press-002.jpg` | 2048×1289 | Basketball action; original crop; zero adjustments | `65fe54cda1ae55039365d8fe9e207e8009f550be4770b4612f635fa9e0b122e4` |

Longest edge is a maximum, not an upscaling guarantee; cropping can reduce final dimensions. JPEG quality was 92%. Caption and copyright are in the manifest, **not embedded IPTC**. The manifest records source checksums, exact edits and edit-version checksums and explicitly distinguishes a prepared download from client delivery. Extracted portrait pixels were visually inspected and upright.

Source hashes remained:

- Basketball action: `716ebc16299ef61adf2e73ad798505d67fc4dfa0dfab0bed228f13834d50ab5a`
- Basketball hangar: `cb8e1799a10fc4d315f7f80628f552a95c75296db1c37473839d380b42d9c80d`
- Volleyball portrait: `5685e8468969ca05da9de250f5848df5318e6b47b1a14d4aebd5c19675224fce`

Fixture provenance is in `tests/fixtures/photos/README.md`. Temporary screenshots and the inspected ZIP are local QA artifacts, not published deliverables.

## Safety regressions covered

Exact loopback Host/Origin/token checks; malformed/non-ASCII token rejection; byte-bounded identifiers; unknown/mixed camera clocks; native/browser hash-domain isolation; corrupt/missing input recovery; occupied workers; cancellation and reuse; source-byte upload instead of client-supplied paths; cache limits and hits; malformed framed responses; old EXIF dates and oversized camera identities; protected manual decisions; frozen export versions; cancellation/resume; failed-frame retry; incomplete/stale ZIP blocking; count/size bounds; unchanged source checksums.

Native workers and cache keys are tied to the executable fingerprint, so subsequent jobs after a rebuild cannot reuse old-engine receipts. An absent local engine may fall back to existing browser import; a failed native job is explicitly reported, not silently reprocessed with another backend.

## Still required for the sports backtest

A user-selected folder with at least 3,000 **unique originals**, ideally multiple cameras/RAW formats, plus the photographer's keeper labels/XMP ratings. Measure cold ingest, first usable preview, total time, peak memory, errors, cancellation and restart separately from keeper recall, selection precision, missed decisive moments and correction time. Keep a held-out shoot for validation; do not tune thresholds on the same shoot used to claim accuracy.

No labeled shoot was supplied in this run, so real-shoot speed, missed-keeper rate, peak-action judgment and any proposed 90% bar remain unmeasured. Native edit parity, full RAW color development, durable native job resume, embedded IPTC and production packaging remain separate work.
