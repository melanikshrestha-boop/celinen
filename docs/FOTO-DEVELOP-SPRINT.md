# FOTO Photo Lab · Develop sprint

## Scope and provenance

User requested a dedicated mini-Lightroom page inside this existing app, starting
from `4e1d941` on `codex/lenslabs-photographer-platform`. Do not replace Studio,
Clients, Books, projects, authentication, or user originals. `.env.development`
is local-only and was already modified at the start. No new app/project.

Automation `lenslabs-aftershoot-and-pixieset-build-sprint` is active and continues
this scope hourly, with no fixed end deadline. The earlier eight-hour stop has
been removed. Continue within the authorized scope until the user changes or
stops the automation; report meaningful verified progress, failures, or a need
for input. Routine unchanged progress stays quiet. An hourly continuation is not
a claim of uninterrupted execution or a promise of Lightroom feature parity.

## Reference evidence

- [User's Sunroom reference](https://x.com/sharifshameem/status/2097213330507403711):
  120.75-second video accessible in X browser without signing in. Root sampled
  playback: filmstrip selection, preset list, effects panel, Basic adjustments,
  changing photograph and zoom. Supplied screenshots provide the clearest layout.
  Do not claim every frame or hidden feature was inspected.
- [Adobe Develop workspace](https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/develop-module-tools.html)
- [Develop behavior](https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/develop-module-options.html)
- [Tone and color](https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/image-tone-color.html)
- [Color mixer](https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/color-mixer.html)
- [Masking](https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/masking.html)
- [Keyboard shortcuts](https://helpx.adobe.com/lightroom-classic/desktop/introduction-to-lightroom-classic/keyboard-shortcuts.html)

The reference's Halation, Bloom, Fade and Film falloff are not evidence of Adobe
algorithm parity. Previous copies the last-selected photo, not index minus one.
Before must never mutate the recipe. Keep crop and masks in a documented source
coordinate system. Native C++ is the pixel operator; TypeScript is UI/transport.

## Implementation ownership, current turn

- Root: `/develop` route, workbench navigation, Develop UI, integration and QA.
- `develop_engine`: `src/lib/develop/contract.ts`, `client.ts`, native C++ kernel,
  server transport, native tests and Makefile.
- `develop_storage`: independent IndexedDB library and recipe/history/preset store,
  pure state helpers and tests. Never writes Studio's databases.
- `develop_reference`: reference research, independent UI review, read-only Studio
  session hydration fix, and crop/selection/dialog boundary review.

## Acceptance matrix (update from actual results)

Latest local milestones: [measured import, histogram and large-library speed](FOTO-DEVELOP-PERFORMANCE.md), plus [current precision and capability audit](FOTO-DEVELOP-PARITY.md). These include uncommitted work; a narrow Git handoff does not imply all local features are on the remote branch.
Earlier: [working grading, histogram, adaptive film looks and evidence](FOTO-COLOR-GRADING-QA.md).

These statuses describe tested subsets, not equivalence to Lightroom Classic.
The reported preview/export mismatch is corrected and verified with real JPEG
and Sony RAW browser uploads. The earlier import incident remains a required
regression baseline. High-quality object reconstruction is still incomplete:
the new on-device selection and experimental texture fill do not constitute
generative removal or full Lightroom parity.

| Area | Status | Acceptance evidence required |
| --- | --- | --- |
| Dedicated route and reference layout | Implemented | Inspected desktop 1440×1000 and phone 390×844; no horizontal overflow; original Studio route retained |
| Native basic/presence controls | Implemented | C++ neutral identity, actual pixel changes and original unchanged; UI exposure changes actual rendered pixels |
| Curve, HSL, grading | Implemented subset | Master plus independent RGB point curves, legacy Linear and opt-in shape-preserving Smooth; eight-channel HSL; interactive shadows/midtones/highlights/global wheels, numeric H/S/L, corrected new tonal model with explicit legacy compatibility; independent FOTO math, not Adobe algorithm parity |
| Grain, vignette, fade, bloom, halation, film falloff | Implemented | Deterministic native effects, grain size and luminance shaping; optional source-derived exposure for built-in looks; not calibrated film-stock emulation |
| Histogram and automatic exposure | Implemented subset | Actual rendered 256-bin RGB histogram, five draggable/keyboard tonal regions, clipping percentages and overlays; explicit bounded source-derived Auto exposure, not Adobe Auto Tone or sensor histogram |
| Crop/straighten/rotate/flip | Implemented | Native geometry tests, square-crop UI/native output check; source-coordinate overlay |
| Linear/radial masks | Implemented | Native feather/invert/enable/local adjustments, UI placement and saved mask history; no brush/AI masking |
| Presets/history/snapshots | Implemented | Original + five look presets, custom presets, snapshots, undo/redo; per-photo IndexedDB history; merge-only reimports |
| Copy/paste/previous/sync | Implemented | Preserve target crop/masks by default; optional batch sync; atomic conflict rollback checked in real IndexedDB |
| Import/library/filmstrip | Reported batch/empty-state regression repaired; wider camera coverage remains partial | Valid files continue after per-file errors; chooser/drop/nested-folder/cancel/duplicate/reload checks pass. Missing originals stay discoverable without an empty filmstrip. Existing private missing images still require their actual originals |
| Export | Implemented subset | Default native JPEG sRGB up to 4096, opt-in up to 8192 / 36 MP without upscaling; editor, proof and actual download byte-identical in JPEG and Sony RAW browser tests; same selected source/mode/recipe/size/quality, Fit/100% inspection and cancellation; original never overwritten |
| Detail precision | Implemented subset | Radius, Fine detail and edge Masking added to conventional sharpening; native and UI/reload tests. Luminance/chroma denoise remain conventional filters with texture tradeoffs, not learned AI denoise |
| Recovery-file import | Implemented | Explicit file/selection/preview/restore; atomic revision guards, originals and current metadata retained, appended undoable treatment; real reload and fault-injection checks |
| Cross-tab and scope isolation | Implemented | Revision conflicts, simultaneous writers, quota rollback, account/project isolation; Develop cannot acknowledge a stale Studio writer's baseline |
| Object selection/removal; AI denoise | Experimental removal only; AI denoise not implemented | macOS14+ Vision foreground instances, click selection, deterministic C++ texture fill, review and separate PNG copy. Native safety +10 browser checks pass; grouped people and visible fill artifacts remain. No generative or denoise model |
| Lens profiles, HDR, soft proofing, full RAW workflow | Partial / gaps | LibRaw sensor decode exists; not a full high-bit-depth color-managed RAW workflow |

## Earlier priority: import reliability, September 8

Baseline inspected: `893730d`. The user reports that Develop cannot import photos,
and the existing project has 337 legacy records without original bytes or saved
previews. Keep those records, IDs, metadata and edit history intact. A filename
or RAW extension alone cannot reconstruct an original; none of the checks below
restored or verified the user's missing originals.

The confirmed batch failure belongs to the UI/import orchestration, not a blanket
failure of the C++ decoder. At the baseline, one outer `try/catch` surrounds the
entire file loop: an unsupported or corrupt file prevents later valid files from
being attempted. Source review also identified two visibility/recovery traps:

- Refresh retains the old selection and active filter, so a successfully saved
  import can remain invisible behind a previous missing-source photo or filter.
- The duplicate check skips an already-known content ID without checking whether
  usable original/preview bytes remain. This applies to matching IDs; it is not
  evidence that all 337 legacy Studio IDs match fresh content-addressed imports.

### Import and typography repair, current milestone

Before the fix, the actual browser file input received a corrupt JPEG followed by
a valid synthetic JPEG and reported **0 photos imported**. After the fix, the
same ordering imports the valid file and reports the failing filename. Individual
decode failures no longer stop subsequent files; abort or a storage failure stops
the batch. Successful receipts choose the first imported photo and reset filters.
Exact-ID reimports may enrich missing media without replacing the edit document.
Unknown legacy files are never silently matched by name.

The empty/missing-media state has no disabled editing rails or placeholder
filmstrip. It offers file/folder import, folder drop, an expandable missing-file
list, explicit reconnect, and recovery import/export. Available-media navigation
skips unavailable records; an empty filter is distinct from an empty library.
Library still exposes matching missing-source records for recovery.

One bundled OpenAI Sans default now spans the workspace, Develop, settings,
Clients, Books and Outbound. Explicit custom/serif preferences are retained; actual
code and keyboard text have a separate code-font token. No saved preferences were
rewritten.

Fresh checks (counts overlap; do not add these to historical milestones):

- Full suite with local test-server permission: **1,286 passed, 20 skipped,
  0 failed, 279,176 assertions**. Two sandbox-denied loopback servers passed when
  permitted. Two pre-existing test expectations from `4e1d941` were corrected
  without changing application behavior: low-contrast accent pairs must reject;
  the chat import test checks its existing placeholder and exactly one action.
- Import unit suite: **16 passed, 4,058 assertions**, including **1,000 varied
  mixed-file batches** with independently checked failures, duplicate handling,
  cancellation, source-byte identity and committed receipts. This is not 1,000
  real-camera or end-to-end upload runs.
- Real browser: **17 import checks**, then **17 edge checks**, using an isolated
  `shoot:eeaf3000-1111-4222-8333-000000000011` library containing 337 synthetic
  missing records. All 337 edit documents compared unchanged. Checks include
  corrupt-first ordering, file drop, folder picker, nested-folder drop, cancel,
  retry after cancel, filtered navigation, actual preview and saved exposure.
- Actual file-input upload of the public Sony A6000 and A7 IV fixtures: both
  imported, rendered, appeared in the filmstrip and survived reload. Originals
  are 25,624,576 and 22,933,504 bytes, respectively.
- Imported Sony RAW export: **7 checks**. The C++ sensor render produced a
  **4,096 × 2,736 JPEG, 3,557,333 bytes**; the download bytes exactly match its
  displayed proof. The edited synthetic import retained exposure 1.25 after
  component reload. QA captured generated Blob objects rather than relaxing CSP;
  direct `fetch(blob:)` remains intentionally blocked by the app's connect policy.
- Real IndexedDB: **27 checks**, including same-ID missing-media healing without
  changing history/rating/revision and isolation across accounts/libraries.
- Independent UI review found and closed two additional regressions: filtered
  Library must still show matching missing-source records, and recovery import
  must remain reachable without an image. **4 additional browser checks passed**.
- Rendered typography: **50 checks**, including the locally loaded font,
  default/restored sans, explicit serif and independently selected code fonts.
- TypeScript, scoped lint, production build and diff whitespace checks passed.
  Empty desktop and loaded desktop/mobile layouts were visually inspected.

The user's actual browser storage could not be read back in this turn because the
computer-use service failed to start. Its original 337 entries were not mutated
by QA; tests used isolated namespaces. Reopening the actual Develop URL was queued
in the app, not confirmed visible. Do not claim that the missing private RAW bytes
have been restored or that every camera/format is supported.

### Native isolation evidence from this investigation

The running local service at `127.0.0.1:8085` reports a ready C++ Develop engine
and sensor RAW support. The actual `renderDevelop` client was exercised against
that service with disposable/public fixtures, without writing any library:

| Fixture | Mode and JPEG output dimensions | Result |
| --- | --- | --- |
| Public-domain basketball JPEG | Preview, 1600×1007 | JPEG returned; source SHA-256 unchanged |
| CC0 volleyball JPEG | Preview, 1200×1600 | JPEG returned; source SHA-256 unchanged |
| Verified Sony A6000 ARW | Preview and sensor RAW, each 1600×1069 | Both JPEGs returned; source SHA-256 unchanged |
| Verified Sony A7 IV ARW | Preview and sensor RAW, each 1600×1067 | Both JPEGs returned; source SHA-256 unchanged |
| Generated Bayer DNG without an embedded thumbnail | Preview unavailable; sensor RAW, 128×96 | Expected preview failure, then successful sensor fallback |

That is eight live calls: seven successful JPEG responses and one expected
thumbnail-path failure. Response dimensions were checked; these calls are not
browser import or camera-color accuracy certification. Existing checksum-verified
Sony provenance remains in `native/README.md`.

Focused regression commands run during this investigation:

```sh
LENSLABS_RAW_FIXTURES=/private/tmp/lenslabs-raw-check.WA148X \
  bun test tests/develop-engine.test.ts \
  -t 'A6000 and A7 IV|sensor RAW demosaic|renders edited pixels' --timeout 120000
bun test tests/develop-client.test.ts --timeout 10000
```

Results: engine **3 passed / 28 assertions**, client **12 passed / 44 assertions**;
**15 tests passed, zero failed, 72 assertions** in total. These are a focused
rerun, not additions to the earlier combined-suite counts. The temporary Sony
path is machine-local; supply another directory containing the verified fixtures
if it no longer exists. No native/client changes were justified by this repro.

Current native bounds: macOS ImageIO plus pinned LibRaw; nonempty source up to
128 MiB; preview long edge 1600; export long edge at most 4096, without upscaling;
sensor RAW/active image limit 60,000,000 pixels; final 8-bit sRGB JPEG. Two Develop
jobs can run concurrently, with one sensor-RAW lane. Definite worker-busy 429s
receive at most four seconds of scheduled client retry waits; long jobs can still
require a user retry. The native job timeout is 60 seconds. Two real Sony models
and a synthetic Bayer DNG are evidence of those paths, not universal ARW/NEF/CR3
or other camera support.

### P0 completion gate

- Import a valid JPEG, corrupt image, unsupported sidecar and valid RAW in one
  batch, including the bad file first. Every independent valid image must still
  be attempted; report individual failures and accurate committed counts.
- Test file chooser, folder chooser and drag/drop separately, including nested
  folder traversal and cancel. Cancel stops future work; it must not claim
  already-committed originals were rolled back.
- After successful import, select a usable imported image, reveal it despite
  prior filters, render real pixels, edit, export, and reload its saved treatment.
  Also test duplicate-only import and a library containing only missing sources.
- Reconnecting a known source must verify its fingerprint and retain the old
  photo ID, rating and history. Unknown legacy identity requires explicit
  attachment, never a silent same-filename guess. A folder/batch reconnect needs
  its own ambiguity review and remains separate from ordinary folder import.
- Verify decode errors, unavailable engine, 429 contention, storage/quota failure,
  zero-byte sources, aborts and stale refreshes cannot report false success or
  discard saved edits. All destructive/fault tests use disposable libraries.
- Read back the real 337-record library without mutation before claiming its
  preservation. Do not claim the originals are recovered until actual source
  attachment and decoded-image verification have occurred.

## Second milestone, September 8, approximately 11:00 UTC

Added independent RGB curves and Film falloff with real native processing.
Existing v1 recipes, presets and histories acquire neutral defaults without
rewriting stored records. Native protocol 2 carries the new controls; protocol 1
is still accepted. The two Sony neutral exports remain byte-identical to the
previous milestone. Curves are bounded piecewise-linear interpolation, not a
claim of proprietary Adobe curve behavior.

Export now offers **Preview export**. It renders the chosen source, long edge
and JPEG quality and displays that very Blob. Export reuses the exact bytes if
the photo/source/recipe/size/quality still match; changes immediately invalidate
the proof. Fit and 100% inspection are available. RAW sensor and saved-preview
modes are distinct, with honest provenance labels. This is an output JPEG
preview, **not ICC/print soft proofing**. Cancellation was tested against a real
sensor job. An initial browser run was interrupted by HMR contention; the clean
rerun passed. The client now retries only definite worker-busy 429 responses,
for at most eight 500ms waits, with separate one-time token refresh and abort
checks. It never retries uncertain network failures.

Recovery JSON can now be downloaded and imported from the left Recovery panel.
Import never selects photos automatically. Select existing photos, preview the
changes, then confirm. Recovery appends the recovered active treatment, preserves
current metadata/originals/snapshots and existing history, and rejects stale
revisions or partial batch writes. Missing IDs are shown but never fabricated.
Two real issues found during verification are fixed:

- Initialization could invalidate an immediate first file read; it now runs
  before the chooser becomes interactive. A deterministic lifecycle test failed
  before the fix and passed afterward.
- A successful recovery followed by a failed library reload could leave the
  editor displaying an old recipe. The parent now adopts committed receipts
  immediately. An actual IndexedDB commit plus injected next-read failure verifies
  the displayed recipe, subsequent export, and next-save revision.

Verification for this milestone:

- TypeScript, scoped ESLint and the production build passed. Existing TanStack
  validator deprecation warnings remain. This is a bundle check, not a hosted
  deployment of the native engine.
- Final combined native/client/store/UI/workbench/Studio/lifecycle suites:
  **163 pass, zero fail, 61,854 assertions across 11 files**, with both
  checksum-verified Sony RAW fixtures enabled.
- Native release and ASan/UBSan Develop suites: **34,803 assertions each**,
  including 1,000 actual renders, channel isolation and neutral identity.
- New browser suites: **85 checks** across RGB curves (15), raster export proof
  (10), sensor export proof (12), sensor cancellation (6), recovery transactions
  (13), recovery UI/reload (21), and committed-refresh failure (8).
- Existing browser suites rerun: **83 checks** across import/edit/export (18),
  reload (4), UI geometry/filter/modal boundaries (12), storage (25), Studio
  read-only hydration (16), and missing-original reconnect (8).
- These are targeted checks, including overlapping assertions across scenarios,
  not 168 distinct feature or camera certifications. All mutating browser checks
  used disposable synthetic/public-fixture libraries; the real 337-photo library
  and local environment were not modified.
- Desktop editor and exact RAW export dialog inspected at 1440×1000; the proof
  dialog also inspected at 390×844 with no horizontal overflow and both final
  actions visible. Visual artifacts are in the local temporary folder
  `/private/tmp/foto-develop-milestone.DHumKr/`, not in the Git handoff. The Codex
  app-open request was queued, but the native UI inspection service was
  unavailable on two attempts; do not claim this turn visibly opened the user tab.

Browser QA route IDs end in `007` (synthetic reconnect/curves/recovery), `009`
(verified public Sony A6000 RAW), and `010` (fresh two-image editor regression).
If the browser runner restarts with empty storage, recreate only these fixtures.
Curve test button lookup must prefer aria-label over text because History can
contain an identical curve name. Avoid app edits/HMR during native browser checks.

## First verified milestone, September 8

- `npx tsc --noEmit` and targeted ESLint: pass.
- `npm run build`: production bundle passes. This does **not** deploy a hosted
  native worker. The working native transport is registered in the local Vite
  runtime used by `npm run dev:lab`.
- Final combined regression: **132 tests, zero failures, 61,703 assertions**
  across Develop engine/store/UI-state, native transport/client, workbench,
  development-lab and Studio-safety suites, with the verified Sony fixture
  directory explicitly supplied. This includes existing culling transport,
  1,000 bounded transport combinations, and 1,000 independent history/undo/
  JSON-reload sequences. Repetition is not a claim of feature parity. The HTTP
  tests require permission to bind temporary loopback ports; a restricted run
  reported a port-binding failure and the permitted rerun passed.
- Native release tests: **24,147 assertions**, including 1,000 actual renders.
  Same unit suite under ASan/UBSan passes. Sanitized sensor-RAW test: 11 assertions.
- Browser storage tests: **25 checks** against real IndexedDB, including atomic
  rollback, competing writers, original bytes, initial Studio settings and safe
  reimports. `tests/develop-store.browser.js`.
- Studio read-only boundary: **16 browser checks** and five existing session
  safety unit tests. `tests/studio-session-readonly.browser.js` ensures reading
  Studio from Develop cannot authorize a stale overwrite or recreate a cleared
  session.
- UI integration: **18 checks passed** (import, rendered pixels, undo/redo,
  Before, photo isolation, copy/paste, rating, crop, masks, preset, actual export
  handler output, custom preset save and snapshot restore). Export verification
  captures the download Blob and decodes the JPEG. **Four further checks** after
  a real page reload confirmed the recipe, rating, custom preset and snapshot.
  `tests/develop-ui.browser.js` and `tests/develop-reload.browser.js`. Alongside
  storage and Studio-safety browser tests plus the 12 review-boundary checks
  below plus eight missing-original recovery checks, this is **83 browser checks**, not 83 end-to-end camera or Lightroom
  feature certifications.
- Independent review fixes verified: ten unit tests and **12 browser checks**
  cover source-geometry preview provenance, filtered Sync targets and dialog
  focus/Tab/Shift-Tab/Escape/opener restoration. The test delays actual native
  response delivery to exercise the geometry race. Files:
  `tests/develop-ui-state.test.ts`, `tests/develop-ui-boundaries.browser.js`.
- Existing workbench, local-development identity and Studio-safety tests:
  **59 passed**, zero failed. The expected tool catalogue now includes Develop.
- Final inspection of the actual existing 337-photo project exposed legacy
  records with neither original bytes nor a saved preview. The page now says
  **Original file needed**, offers **Reconnect original**, and disables pixel
  edits/export until image data exists. A separate disposable legacy-record
  regression passed **eight browser checks**: wrong-file rejection, correct
  source attachment with the same Studio ID, no duplicate, unchanged edit
  history, exposure, temperature and rating. Existing known SHA-256 or Studio
  chain fingerprints are verified; unknown historical identity is disclosed
  and requires explicit user-selected attachment. No existing original is
  overwritten. `tests/develop-reconnect-seed.browser.js` then
  `tests/develop-reconnect.browser.js` reproduce this case.
- Desktop and mobile screenshots inspected locally. Phone width 390px matches
  document width 390px. Phone layout loads without horizontal overflow, but
  touch-specific interaction coverage is limited and left-panel preset/history
  tools still need a compact accessible drawer.

The full RAW path is tested with an original synthetic Bayer DNG without an
embedded thumbnail and the previously documented A6000/A7 IV fixture files.
It performs LibRaw unpack/demosaic with camera white balance and exposure before
conversion to an 8-bit sRGB working image. The optional Sony test passed with
12 assertions: fixture SHA-256 hashes match `native/README.md` before and after
processing, and all four neutral/edited sensor exports decode successfully.
A6000 output: 1600×1069; A7 IV output: 1600×1067. Rendered images were visually
inspected; this is not a camera-color fidelity comparison. Reproduce with:

```sh
LENSLABS_RAW_FIXTURES=/path/to/verified-fixtures bun test tests/develop-engine.test.ts -t 'A6000 and A7 IV' --timeout 120000
```

Without that explicit fixture path, the real-camera test is skipped. CR3, NEF
and other real camera models have not been validated. This earlier milestone
still used differing thumbnail/sensor paths. The later [parity repair](FOTO-DEVELOP-PARITY.md)
uses one chosen path and exact edited JPEG bytes for both editor and export.

## Lightroom Classic gap matrix and next steps

Official Adobe **Lightroom Classic**, not the separate cloud Lightroom product,
was reviewed on September 8, 2026. Sources below describe workflow expectations;
they do not provide Adobe's proprietary implementation or certify FOTO's output.
This is a prioritized capability inventory, not an exhaustive enumeration of
every Classic menu item. P0 means an existing workflow is blocked; P1 means the
next professional-workflow foundation; P2 means advanced capability after those
foundations. Priorities are project recommendations, not claims made by Adobe.
The FOTO column refers to this dedicated Develop page and its tested transport,
not an audit of every other FOTO module.

| Priority / capability | Classic reference | FOTO Develop now | Next deliverable and proof required |
| --- | --- | --- | --- |
| **P0 · Reliable import and immediate visibility** | [Folder import][adobe-import] and [import options][adobe-import-options] cover source selection, previews, duplicate handling and destination choices. | Mixed-file batch abort confirmed at baseline; root's repair must pass the P0 gate above. | Per-file outcomes, usable active selection, chooser/folder/drop parity, cancel and real reload/export test. Never use a native smoke test as UI completion evidence. |
| **P0 · Missing originals** | [Locate missing photos][adobe-missing] distinguishes missing files and reconnects individual files or folders. | Single-original attachment has isolated tests; 337 legacy records still lack image bytes. Ordinary reimport is not a verified batch relink. | Fingerprinted candidate matching, explicit ambiguous-match review, retained IDs/history, original-hash readback and unchanged-library floor. |
| **P1 · Ingest ownership and disk safety** | [Camera/card import][adobe-card] and [folder import][adobe-import] distinguish copying from retaining files in place; [import options][adobe-import-options] include secondary copy and presets. | Browser-local Blob storage, not a native managed folder/catalog workflow. | Explicit source/destination policy, capacity estimate, staged writes and verified second-copy option. Folder chooser alone must not imply card ingest, source moves or backups. Never move/delete source files implicitly. |
| **P1 · Preview cache and large libraries** | [Smart Previews][adobe-smart] distinguish original availability and an editable offline proxy. | Cached JPEG previews and honest RAW provenance labels; neutral thumbnails do not show every active edit. No Adobe Smart Preview compatibility. | Versioned edited-thumbnail cache, bounded background queue and viewport loading; offline/reconnect states; memory and timing reports on a reproducible large disposable library. |
| **P1 · High-bit-depth RAW/color pipeline** | [Color management][adobe-color] and [export settings][adobe-export] distinguish editing/display/output profiles and high-bit output. | LibRaw sensor demosaic and exposure/WB exist, then processing uses an 8-bit sRGB image; 4096-edge export cap. | Preserve linear high-bit/float data through adjustments, explicit input/output transforms and ICC embedding, tiled/full-resolution processing. Test gradients, clipping, profile charts, orientation and memory bounds across licensed real-camera fixtures. |
| **P1 · Basic panel precision** | [Tone and color][adobe-tone] covers white-balance sampling, tone and camera profiles. | Real bounded tone/presence controls; temperature/tint are relative adjustments, not calibrated Kelvin or Adobe camera-profile matching. | White-balance eyedropper, measured RAW WB representation, supported profile selection, clipping visualization and a documented Auto adjustment. Verify a neutral target and golden images; do not label a generic slider a camera-calibrated control. |
| **P1 · Complete color controls** | [Color Mixer][adobe-mixer] includes sampled Point Color and affected-range inspection; [tone/color][adobe-tone] covers curves and grading. | Master/RGB piecewise-linear curves, eight HSL ranges and three grading ranges with balance/blending. No parametric curve, Point Color, dedicated B&W mixer or full grading-wheel interaction. | Add individual capabilities with serialized defaults, undo/reload, channel/range isolation and pixel tests. Preserve v1 recipes and neutral identity; matching labels is not matching Adobe's math. |
| **P1 · Optics and perspective** | [Develop tools][adobe-develop] includes lens correction; [Upright][adobe-upright] includes guided and manual perspective correction. | Crop, straighten, quarter-turn rotation and flips work; lens-profile correction, chromatic-aberration/defringe and perspective transforms do not. | Licensed/versioned lens data plus manual distortion/CA controls, then guide-driven transform. Test straight-line charts, edge sampling and crop/mask coordinate roundtrips. |
| **P1 · Local adjustment completeness** | [Masking][adobe-masks] includes brushes, gradients, ranges, composite selections and automatic selections. | At most 12 linear/radial masks with exposure, temperature and saturation; no brush, mask intersection/subtraction or range masks. | Source-coordinate brush strokes/erase/flow first, then mask composition and luminance/color ranges. Check feathering at multiple scales, pan/zoom/rotation, undo, copy semantics and exact export. AI selection is a separate P2 item. |
| **P1 · Detail and conventional retouch** | [Retouching][adobe-retouch] exposes sharpening radius/detail/masking and noise controls; [Develop tools][adobe-develop] also identifies heal, clone and red-eye tools. | Actual sharpening and luminance/color-noise amounts exist; no detailed sharpening controls, spot/heal/clone or red-eye correction. | Edge-masked sharpening and tunable denoise with a native-resolution inspection path; non-destructive clone/heal strokes with source provenance. Verify texture retention and halos on noisy/detail fixtures; do not relabel a blur filter AI denoise. |
| **P1 · Editing throughput and comparison** | [Develop tools][adobe-develop] and [Develop options][adobe-options] describe comparison, history, presets and selective transfer. | Before/After, snapshots, undo/redo, Previous, copy/paste and atomic Sync subsets work. Fine-grained control-group selection and a separate reference-photo view remain. | Explicit selective copy UI and source/target counts, reference image isolated from the active recipe, useful keyboard shortcuts, narrow-screen preset/history access. Preserve stale-render, modal-focus, filtered-target and revision-conflict regressions. |
| **P1 · Professional export** | [Export workflow][adobe-export-workflow] and [export settings][adobe-export] include reusable settings, formats, color space, sizing, metadata, sharpening and watermarks. | One JPEG/sRGB output path, up to 4096 edge; exact JPEG proof and cancellation work. No complete batch export queue or full-resolution/TIFF workflow. | After the high-bit pipeline: 16-bit TIFF and full-resolution JPEG, output profiles, metadata privacy controls, filename collisions, preset/batch queue and optional watermark/output sharpening. Decode actual downloads and verify dimensions, profiles, metadata, source hashes and cancel behavior. |
| **P1 · Durable library and recovery** | [Catalog backup][adobe-backup] explicitly separates catalog backups from photo backups. | Atomic scoped IndexedDB and undoable JSON recipe recovery work. Recovery JSON does not contain source pixels and is not an original-photo backup. | Portable manifest plus separately verified originals, quota/storage-persistence status, restart/crash recovery and a restore rehearsal into a fresh disposable workspace. No cleanup of user media during migration. |
| **P2 · Catalog organization and interchange** | [Collections][adobe-collections], [browsing/filtering][adobe-browse] and [sidecars][adobe-sidecars] cover more than a filmstrip. | Ratings/flags, limited filters and FOTO recovery JSON; selected legacy Studio settings map explicitly. No full Classic catalog, Smart Collection, virtual-copy or XMP/ACR interpretation claim. | Collections/stacks/keywords and independent treatment versions, metadata search, then documented supported sidecar fields with unknown-field preservation. Roundtrip fixtures must show which settings transfer and which cannot; never silently treat Adobe values as this engine's equivalents. |
| **P2 · ICC/print soft proofing** | [Soft-proof behavior][adobe-options] uses destination profiles, gamut warnings and rendering intent. | Exact downloadable JPEG preview only; it is not a printer/display simulation. | Proof profile/intent, gamut overlay and independent proof treatment after color management is implemented. Validate known ICC test charts and output-profile readback; retain clear labeling between JPEG proof and print soft proof. |
| **P2 · AI tools and depth effects** | [Enhance][adobe-enhance] describes Denoise, Raw Details and Super Resolution; [Masking][adobe-masks] describes automatic selections. | No learned denoise/upscaling, subject/people/sky masks, generative removal or depth-based lens blur. | Evaluate licensed runnable models, compatible hardware, data locality, cost and failure behavior first. Then real held-out quality tests and correction controls. No simulated results, undisclosed uploads or Adobe/Firefly model claims. |
| **P2 · HDR and multi-image processing** | [HDR output][adobe-hdr] is distinct from [panorama/HDR merging][adobe-panorama]. | SDR single-image processing only. Dehaze, bloom or highlight recovery is not HDR merge/output. | Alignment/deghosting and source-preserving merge artifacts; separately implement HDR working/display/export transforms and SDR fallback. Verify moving subjects, seams, output metadata and actual compatible displays. |
| **P2 · External editing and full desktop workflow** | [External editing][adobe-external] defines rendered-file format, profile and bit-depth handoff. | No demonstrated Develop-to-external-editor roundtrip or cross-platform packaged-native parity. | Explicit export-and-open destination with completion/readback, return-file versioning and source safety; packaged engine capability/permission tests. Camera tethering, print layouts, map, book, slideshow and publishing are separate Classic workflows, not fulfilled by adding a Develop panel. |

Execution order: close the P0 import/visibility gate, then complete safe relinking
and usable cache/navigation. Build high-bit/color/export foundations alongside
small independently testable editing improvements. Keep richer color grading,
selective Sync and narrow-screen access in the queue; do not drop existing
crop-preview, recovery, RGB, exact-export, cancellation or Studio-isolation tests.
Advanced models, HDR and broader Classic modules must not delay a reliable
import → edit → export loop or silently broaden the current implementation scope.

### Documentation and completion rules

- For each matrix row, record the exact shipped subset, reproduction command,
  fixture provenance and output inspection, not just the presence of a control.
- Separate functional matching, visual similarity, performance and pixel/color
  fidelity. Each requires different evidence; passing one never implies all four.
- Use the existing Studio and other FOTO modules where appropriate without
  overwriting their data or redesigning them as a side effect. Legacy settings
  transfer only through explicit supported mappings.
- No customer originals are uploaded or rewritten. Native local-server success,
  a private Git push and a web bundle build are each different from a production
  desktop release; none proves full Lightroom Classic parity.

[adobe-import]: https://helpx.adobe.com/lightroom-classic/desktop/import-photos/import-photos-video-catalog.html
[adobe-card]: https://helpx.adobe.com/lightroom-classic/desktop/import-photos/importing-photos-lightroom-basic-workflow.html
[adobe-import-options]: https://helpx.adobe.com/lightroom-classic/desktop/import-photos/photo-video-import-options.html
[adobe-missing]: https://helpx.adobe.com/lightroom-classic/desktop/manage-catalogs-and-files/locate-missing-photos.html
[adobe-smart]: https://helpx.adobe.com/lightroom-classic/desktop/viewing-photos/lightroom-smart-previews.html
[adobe-color]: https://helpx.adobe.com/lightroom-classic/desktop/workspace/color-management.html
[adobe-develop]: https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/develop-module-tools.html
[adobe-tone]: https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/image-tone-color.html
[adobe-mixer]: https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/color-mixer.html
[adobe-upright]: https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/guided-upright-perspective-correction.html
[adobe-masks]: https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/masking.html
[adobe-retouch]: https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/retouch-photos.html
[adobe-options]: https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/develop-module-options.html
[adobe-export]: https://helpx.adobe.com/lightroom-classic/desktop/export-photos/export-files-disk-or-cd.html
[adobe-export-workflow]: https://helpx.adobe.com/lightroom-classic/desktop/export-photos/exporting-photos-basic-workflow.html
[adobe-backup]: https://helpx.adobe.com/lightroom-classic/desktop/manage-catalogs-and-files/back-catalog.html
[adobe-collections]: https://helpx.adobe.com/lightroom-classic/desktop/organize-photos-in-lightroom-classic/photo-collections.html
[adobe-browse]: https://helpx.adobe.com/lightroom-classic/desktop/viewing-photos/browse-compare-photos.html
[adobe-sidecars]: https://helpx.adobe.com/lightroom-classic/desktop/organize-photos-in-lightroom-classic/create-xmp-acr-files.html
[adobe-enhance]: https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/enhance-details.html
[adobe-hdr]: https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/hdr-output.html
[adobe-panorama]: https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/panorama.html
[adobe-external]: https://helpx.adobe.com/lightroom-classic/desktop/work-with-external-editors/external-editing-preferences.html

## Color-noise and sharpening correction, September 8

Native color-noise cleanup now runs before sharpening/texture detail extraction.
Previously sharpening could restore the same chroma noise the denoise stage had
removed. The regression fails against the old ordering and passes with the fix;
denoise-only golden pixels, source bytes and alpha remain preserved. Native
Develop tests passed 113,322 assertions in optimized and ASan/UBSan builds.
The Develop engine integration tests passed 16 tests / 1,122 assertions, with
one optional real Sony fixture skipped. Generated Bayer RAW and JPEG proof/export
checks ran. This is not proof of full Lightroom parity or all-camera coverage.

See [client infrastructure](FOTO-CLIENT-INFRASTRUCTURE.md) for the concurrent CRM,
C++ receipt and manual message-handoff work, safety boundaries and verification.

## Preview-only reimport repair, September 8

Root cause: the duplicate list used the same predicate as the viewable filmstrip
(original **or** preview). A content-addressed photo with a saved preview but no
original was therefore skipped before its original could be restored. Only
photos with both nonempty original and preview Blobs now qualify as complete
duplicates. Source-only entries can regenerate missing previews as well.
The existing merge-only store still preserves IDs, history, ratings and source
bytes. This does not silently match the 337 historical Studio records by filename.

Verification of this narrow repair:

- The old predicate failed both a focused unit regression and the real browser
  reimport check. The fixed import suite passed **20 tests / 4,088 assertions**.
- `tests/develop-import-repair.browser.js` in reserved shoot081: **29 checks**
  across empty-state, preview-only restoration, corrupt-first chooser import
  (sidecar, public JPEG and Sony A7 IV RAW), corrupt-first PNG drop and reload.
  All 337 synthetic legacy records and every pre-existing edit document remained
  byte-identical. Four usable imported media entries appeared without 337 empty
  filmstrip tiles. The eight reload/layout checks also passed at 390px width.
- Full current working-tree suite: **1,626 passed, 20 skipped, zero failed**;
  TypeScript, scoped lint and production build passed. The optional real-camera
  unit fixture remains separately gated; the Sony fixture ran in the browser.
  The isolated staged candidate also passed 63 import/store/UI-state tests,
  TypeScript and production build without the other uncommitted features.
- The current working-tree RAW editor/proof/download path was also exercised
  after import: identical JPEG SHA-256
  `43880e52e6b3a3414133bdc00baea2b302e8f8dcd39d6e19afa3644dfc9d5f53`.
  This validates the adjacent local parity work, not an additional change in
  this narrow duplicate-check repair or a claim of Adobe color equivalence.
- User-browser inspection remains unavailable because the computer-use service
  failed to start. The real 337-record library was not accessed or modified;
  do not describe synthetic preservation as a readback of private originals.

Reproduce with the local C++ engine running: open
`/shoots/eeaf3000-1111-4222-8333-000000000081/develop` in an isolated test browser,
run the browser script once to seed, reload, then run it again to verify repair.
Upload a corrupt JPEG, an XMP sidecar, the repository CC0 volleyball JPEG and the
checksum-verified `sony-a7iv-small.ARW` from `native/README.md` through the file
input. Set `globalThis.fotoImportRepairAction` to `verify-upload`, then `drop`,
then `reload` (after reloading), running the script at each step. Never seed a
customer library or clear a database to prepare QA. Browser fixture directories
and environment files are not part of the Git handoff.

Still open: reviewed batch/folder relink UI, actual-original recovery, broader
camera validation and the high-bit-depth/full-resolution pipeline. Keep this
repair separate from those unimplemented capabilities and other local work.

## Handoff discipline

Run focused tests, TypeScript and build, and live browser tests using disposable
fixtures. Do not inflate test counts or equate repeated smoke tests with parity.
Push only scoped validated source changes to the existing private branch. Git
sync is not proof of production deployment. Update this document with exact
commands, results, known gaps and next steps before yielding.

## Faster cancelled-render handoff, September 8, 23:00 UTC

Scoped change: only client busy-retry timing and its regressions. The first wait
is now 100 ms, then 200 / 300 / 400 / 600 / 700 / 800 / 900 ms. There are still
at most eight retries and four seconds of scheduled waits. The one 403 token
renewal does not reset that budget. Requests keep the same source/settings/signal;
network failures and other errors are not replayed. Server lanes and pixel math
are unchanged by this patch.

In three before and three after isolated Node/native public-fixture trials,
the median next-JPEG handoff was 639.2 ms before and 221.4 ms after. The first
retry dropped from 501.9 to 102.1 ms. Both versions made two requests per next
photo with identical submitted bytes, original hashes and JPEG output. The
cancelled request's handler completed within 3.9 ms; this is an upper bound on
lane release including file cleanup, not an exact process-close timestamp.
These are cancellation handoffs, not end-to-end user upload or general RAW
throughput measurements. Longer contention can resend bodies earlier and wait
longer at later retry boundaries; the count/total-wait bounds are unchanged.

`tests/develop-client.test.ts` covers the exact schedule, every token-renewal
boundary, cancellation before/after a timer, independent overlapping requests,
immutable packets and error receipts. The 100 ms regression failed against the
old 500 ms implementation before the fix. `tests/develop-retry-handoff.fixture.ts`
uses Node's HTTP runtime like Vite, real C++ processing and public SHA-verified
files; it requires actual connection close and unchanged output/source hashes.
It never reads or writes a customer library. The fixture falls back to the older
4,096-edge engine's RAW lane for compatibility; that is a different target from
the larger-export/JPEG timing experiment.

Reproduce: `LENSLABS_RAW_FIXTURES=/path/to/verified-fixtures bun test tests/develop-client.test.ts`
and `LENSLABS_RAW_FIXTURES=/path/to/verified-fixtures node --import tsx tests/develop-retry-handoff.fixture.ts`.
Working-tree verification: full suite 1,759 pass / 19 skip / one explicit TODO /
zero failures; TypeScript, scoped lint and production build pass. The TODO is
the still-unimplemented versioned RAW white-balance continuity fix. This is not
full Lightroom parity, hosted deployment or proof of all-camera support.

The isolated Git candidate also passed 46 focused tests / 1,364 assertions,
TypeScript, scoped lint and production build. It was checked again against a
fresh build of its own unchanged baseline native sources (88,713 native Develop
assertions), not only the newer working-tree binary. These candidate results
are separate from the full working-tree suite above. The fixture requires macOS,
Node, installed repository dev dependencies including tsx, the native executable,
and the checksum-verified RAW directory. No environment files were copied into
the isolated candidate.

Local handoff readback: private branch now contains `ab07ac8` (four scoped files:
retry client, retry tests, Node fixture and this standalone milestone). The broader
local Develop/CRM/Earnings/UI work and environment files were not included in
that commit. Remote SHA and local HTTP 200 were checked after push; neither is
a claim of hosted deployment or full parity.

## Reviewed batch reconnection milestone — September 8, 2026

Implemented the previously unmounted folder/file reconnect planner as a reviewed Develop
dialog with exact-fingerprint defaults, explicit filename-only approval, bounded rows and
per-file native decode. Single and batch reconnect now require a current missing-original
identity at atomic commit; the cross-tab wrong-preview race is closed. Existing documents
and revisions are preserved. Successful attachments are adopted even when Stop follows
a committed write. See [FOTO-DEVELOP-RECONNECT.md](FOTO-DEVELOP-RECONNECT.md).

Actual browser/native/IndexedDB checks passed using separate synthetic namespaces:
337 histories unchanged, valid-after-corrupt continued, real public Sony RAW picker retained
its exact bytes, folder picker skipped connected originals, cross-tab attachment race failed
closed, cancellation after commit retained its receipt. Desktop/mobile review was inspected.
All 340 disposable photo/document pairs were audited, removed and verified absent afterward.
No customer library was accessed by QA.

Full working-tree suite: 1,779 pass / 21 skip / 1 TODO / 0 fail, 361,877 assertions.
TypeScript, scoped lint and build passed. Isolated reconnect-only Git candidate:
74 focused tests / 64,837 assertions, TypeScript/lint/build passed. Environment files and
broader local Develop/CRM/UI changes were not copied into that candidate.
This completes reviewed local relinking, not all-camera decoding or full Lightroom parity.

Private Git handoff readback: `2aca1e70bf367aa4cf1560e094d015047aab2859`
is now on `codex/lenslabs-photographer-platform` (17 scoped files). Remote SHA,
empty Git index and local Develop HTTP 200 were verified after push. The app open
request was queued by Codex; this is not a claim of a visible user-tab inspection.
Broader local Develop/CRM/UI changes and `.env.development` remain uncommitted.

## Continuous RAW white-balance native foundation — September 9, 2026

**Native opt-in groundwork only; the editor's known legacy WB jump is not yet
fixed in the running app.** The existing five-argument decoder remains the default.
A separate six-argument overload accepts `RawWhiteBalanceModel::resolved`; no
protocol, recipe schema, default treatment, UI, preview cache or export caller
selects it in this milestone. There is no automatic migration of saved edits.

Investigation reproduced a baseline-policy switch: with missing camera WB,
exact zero uses LibRaw's camera/automatic policy, while the old nonzero branch
uses daylight multipliers. The new overload applies FOTO's existing relative
Temp/Tint gains to the coefficients already resolved by pinned LibRaw 0.22.2,
before its sensor scaling/clipping/demosaic. Zero delegates unchanged. This uses
one decode and no additional frame allocation or sensor scan; it is not an
import-throughput improvement or calibrated Kelvin control.

The protected `scale_colors_loop` hook is specific to the audited LibRaw version.
Known non-RGB/RGBG layouts, unnormalized fallback coefficients, invalid scales,
unsafe float-to-int bounds and bypassed/duplicate hook applications fail closed
for nonzero opt-in WB. Ordinary five-argument calls retain the old path. The
guards do not claim to harden all legacy or upstream LibRaw processing.

Verification:

- The checked-in `tests/develop-raw-wb-continuous.test.ts` builds current native
  source in a temporary directory instead of using a possibly stale object.
  Six tests / 3,598 assertions pass: 12 original synthetic Bayer DNGs, 48
  controls each, camera/missing/partial WB, orientations 1/6, exposure -5/0/+5,
  signed zero, +/-0.000001, small and extreme Temp/Tint.
- All 576 old-API versus explicit-legacy cases are byte-exact. Twelve combined
  legacy pixel checksums match independent pre-change goldens on macOS arm64
  with pinned LibRaw. All 216 zero/tiny cases are neutral-exact; source SHA-256s
  remain unchanged. These are synthetic arithmetic checks, not camera calibration.
- An isolated negative control forced the new overload back to legacy. The
  tiny-step continuity assertion failed as expected (mean 3.8173, maximum 38
  RGB8 codes on missing-WB input); it passes with the new implementation.
- 37 invalid-control/model cases reject before source access. Three checked-in
  malformed/unsupported DNG variants each reject three times with the exact
  expected error; the safe neutral paths remain legacy-exact.
- Public A6000 and A7 IV originals were SHA-verified before/after. Four recipes
  per camera matched the pre-change five-argument bytes in both legacy APIs.
  Resolved neutral/tiny cases stayed exact; modest adjustments changed pixels.
  Ten resolved Sony checks were repeated after arithmetic hardening.
- Independent ASan/UBSan/float-cast-overflow checks passed the 576-case matrix,
  all legacy goldens, 37 invalid arguments, and four safety fixtures. Only the
  wrapper/probe were instrumented; the pinned static LibRaw archive was not.
  No LibRaw-internal sanitizer coverage or leak guarantee is claimed.
- Full working tree: 1,785 pass / 21 skip / one explicit integration TODO /
  zero fail, 365,475 assertions. TypeScript and scoped lint passed.
- Isolated five-file Git candidate: 1,488 pass / 21 skip / zero fail,
  304,581 assertions. Its own `make -j4 all test`, TypeScript, scoped lint and
  production build passed. The native Develop suite includes 88,713 assertions.
  Existing dependency deprecation notices remain. No environment files were
  copied into this candidate; the app's active native binary was not rebuilt.

Reproduce on macOS after installing the pinned native dependency:
`bun test tests/develop-raw-wb-continuous.test.ts`. The standalone probe also
supports `--invalid`, `--neutral PATH` and `--reject PATH EXPECTED_ERROR`.
The `FOTO_WB_BASELINE_ONLY` compile switch captures old-API goldens against a
pre-change object; do not regenerate goldens from the new wrapper itself.

Before editor integration, explicitly version/preserve the old rendering choice
through import/reconnect, presets, reset, reference matching, undo, snapshots,
recovery, selective sync, neutral histograms, Before and preview/export keys.
An opt-in compatibility mode was proposed to the user; no reply has been
assumed. Keep existing saved treatments on legacy rendering.

Camera limitations remain: LibRaw can label three-plane CMY DNG metadata RGBG,
so its descriptor is not sufficient proof of RGB calibration. Broader color-plane
validation and representative camera/gray-chart evidence are required before
all-camera or color-accuracy claims. The current high-bit-depth/RAW fidelity and
full Lightroom capability gaps remain open. This milestone adds no UI control,
histogram feature, production deployment or new import-speed claim.

Private Git readback: `6bbc8f082251e11f935a10b76b2aa9cf5ff68294` is on
`codex/lenslabs-photographer-platform`. The five-file commit excludes unrelated
local work and environment files. Remote SHA, empty Git index and local Develop
HTTP 200 were verified after push; the initial sandbox-only DNS/loopback checks
failed, and the permitted read-only checks succeeded. No browser appearance or
new editor behavior is claimed for this native-only milestone.

## Exact-output RAW resampling, September 9, 04:35 UTC

Two bounded performance changes were investigated independently. This private
Git milestone contains only the native resampler, its C++ probe/Bun runner, and
this note. The current local editor's neutral-recipe reuse work remains outside
this commit because its newer preview/export foundation is not yet in HEAD.

The C++ RAW decoder now computes each axis's box-overlap weights once. It keeps
the original multiplication order, sy/sx/channel accumulation, rounding and
opaque alpha; native-size output uses an exact RGB-to-RGBA copy. Source-file
snapshot checks, LibRaw processing, existing white-balance selection, sensor
bounds and the branch's 4096 edge limit are unchanged.

Evidence:

- The production helper matches an independent literal pre-change resampler in
  25,733 deterministic cases / 52,415,596 output bytes. The same matrix passes
  ASan/UBSan: every small downscale pair, one-pixel axes, endpoint/rounding cases,
  patterns/random data and large one-dimensional extents. Input and output-tail
  sentinels remain intact. LibRaw itself is not sanitizer-instrumented.
- Eight source-linked old/new public Sony comparisons (two cameras, edges
  1600/4096, neutral and nonzero RAW controls) preserve entire RGBA and JPEG
  bytes; original SHA-256 hashes are unchanged.
- Five alternating scratch trials per variant measured only the resize stage:
  A6000 median 50.64 -> 32.81 ms at 1600, 134.85 -> 74.12 ms at 4096;
  A7 IV small 30.04 -> 15.97 ms at 1600. These are not end-to-end import
  measurements; demosaic remains a larger cost. No two-second/all-camera claim.
- Isolated HEAD-based candidate: all nine native suites passed (120,952
  checks); full Bun 1,490 pass / 21 skip / 0 fail, 304,583 assertions.
  TypeScript, production build and scoped lint passed. The first sandbox run
  could not bind test HTTP servers; the loopback-permitted rerun passed.
  Existing build deprecation/chunk warnings remain.
- All 793 archived tracked files were compared against HEAD: only the intended
  RAW source differs, plus two new tests. Environment files were not copied.

Reproduce: build the pinned native dependency, run
`make -C native all test` and `bun test tests/develop-raw-resample.test.ts`.
The probe includes the actual private implementation in its translation unit;
the baseline loop is independent, not a second invocation of the new helper.

Full Lightroom parity remains unfinished. This milestone does not activate the
pending opt-in RAW white-balance model, add a new histogram capability, or
introduce a decoded-RAW cache. Any future cache needs explicit memory bounds,
cancellation, source/white-balance identity and exact preview/export readback.

## Local editor: remove redundant neutral RAW renders

A saved legacy neutral recipe (or an inactive grading hue/grain shape) could
force a second full RAW decode because reuse compared whole JSON to new defaults.
The local Develop page now validates a conservative native-equivalent no-op
predicate once per recipe. It checks exact effective amounts, HSL, curves, masks
and crop without rewriting saved settings; RAW exposure/temperature/tint are
checked before any post-decode reset. Reuse additionally requires a nonempty
native receipt with the same selected photo, source Blob, mode, edge and quality.
The actual full recipe still owns the export proof and saved history.

This remains local/uncommitted with the newer editor foundation, not silently
bundled into the smaller native Git milestone above.

Verification:

- New neutral suite: 14 tests / 592 assertions, including real JPEG and generated
  sensor RAW render equivalence, active-control rejection, old-field defaults,
  invalid inactive fields, exact ownership and immutable input documents.
- Real UI fixture only: reserved shoot ...103 and checksum-verified public A6000.
  Before: two successful full native RAW requests for an untouched legacy recipe.
  After: one, with identical displayed JPEG SHA-256
  `60114ecf01ef91676a7125d5b3aa668be26fff907cf955faf93b72efb849abcb`.
  Export proof and captured JPEG download matched those exact bytes. Full saved
  document/metadata were unchanged by opening/exporting. Exposure still rendered
  new pixels and a new live histogram; Undo restored exact neutral image and
  histogram without another decode. Existing prior history, rating and pick held.
- The 12-check browser regression also passed after rebuilding the local C++
  engine with the new resampler. The initial repeat-run harness wrongly required
  preservation of discarded redo history; corrected to preserve the prior
  committed history prefix and wait for Undo persistence. No app history code
  changed. The standalone browser body is syntax-checked as an async function
  (it is not a normal importable JS module for ESLint).
- Full local suite before rebuild: 1,801 pass / 21 skip / 1 explicit WB integration
  TODO / 0 fail, 366,069 assertions. TypeScript and production build passed.
  Six sandbox-only HTTP bind failures passed with loopback permission.
  After rebuild: native tests passed (Develop 442,188 assertions); focused
  import/native/neutral/resampler suite 57 pass / 1 skip / 0 fail, 5,848 assertions.
  Scoped source/TypeScript-test lint passed. Desktop screenshot inspected;
  console showed only the existing ClientsWorkspace code-splitting warning.

Run `tests/develop-neutral-reuse.browser.js` as a browse async eval body only
on its hard-coded disposable shoot after importing the public A6000 fixture.
It must never target the user's 337-photo or active shoot. The result proves a
specific redundant-decode fix, not complete Lightroom fidelity or general
fresh-import speed. Next larger performance work is avoiding repeated demosaic
for post-decode-only edits, after designing a bounded and cancellable cache.

Private native milestone readback: `9eb4463200d4ad25205aaf63f6b9086506083e11`
matches the remote `codex/lenslabs-photographer-platform` branch. The repository
was verified private and the Git index empty after push. The local Develop page
returned HTTP 200. The app-open request was queued, not proof of a visible tab.
Only the disposable ...103 photo/document pair was deleted after exact namespace,
source-hash and saved-state checks; readback found zero remaining QA records.
Both public Sony RAW files retain their original SHA-256 hashes. No customer
shoots, originals, history or environment files were modified by these checks.

## 2026-09-09 — Stop owns and cancels the original file read

Narrow import-responsiveness milestone. Before this change, normal Develop import
passed cancellation to decoding but not to its initial `File.arrayBuffer()`.
A controlled pending-read regression reproduced Stop staying pending with no
`FileReader.abort()` call. The scratch pre-fix test was red against `9eb4463`;
releasing its old pending read confirmed there were no preview or save calls.

`developPhotoFromFile` now accepts an optional AbortSignal. Normal import forwards
its signal; browser calls use a fresh FileReader with one settlement and explicit
listener cleanup. Stop detaches handlers before aborting an active read because
FileReader abort events are synchronous. Reader failures are not silently retried.
Both read paths reject invalid or incomplete buffers before SHA-256. Exact
whole-file `sha256:` identities, existing originals, durable receipts and histories
remain unchanged. No schema migration or data repair was performed.

The fallback when FileReader is absent remains awaited. An already-started
Web Crypto digest also remains awaited, then checks cancellation: the API has
no cancellation parameter. This avoids leaving expensive work behind after a
Stop/retry cycle. It does not make SHA-256 cancellable or promise instantaneous
physical disk cancellation. Reconnect and Studio chunk-chain fingerprinting
are intentionally unchanged.

API references: [File API abort semantics](https://www.w3.org/TR/FileAPI/#abort),
[Web Crypto digest](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest).

Verification:

- 20 new entrypoint tests cover actual abort ordering, reentrancy, late events,
  pre-abort/custom/null reasons, reader-originated abort, constructor/start/read
  failure, length/admission checks, equal source SHA, awaited fallback and hash,
  independent calls, and exact post-save receipts.
- Full current local tree: 1,821 pass / 21 skip / 1 existing WB integration TODO /
  0 fail; 366,385 assertions. TypeScript, scoped source/test lint and build passed.
- Clean candidate based on `9eb4463`: 1,510 pass / 21 skip / 0 fail; 304,899
  assertions. TypeScript, scoped lint and production build passed. Its native
  executables and nine native suites were built from candidate source; 120,952
  checks passed. The first test attempt lacked those executables and had three
  social-operator startup failures; all passed after the normal native build.
- Real-browser smoke on the newer local editor: public A6000 RAW was selected
  through the actual file input. Stop reached a LOADING browser FileReader,
  called its real abort, left zero photo/document records, and allowed retry.
  Retrying imported the exact original. A corrupt JPEG in a mixed drag/drop
  did not block the valid public JPEG. Existing RAW history remained identical.
  Exposure changed pixels and the live histogram; export proof and captured
  JPEG download were byte-identical to the edited display. Reload preserved
  originals and saved history. The harness explicitly reselected the edited
  JPEG after reload (which initially selects the first photo), and waited for
  the histogram to settle. It did not change application selection behavior.
- Desktop screenshot inspected. The expected corrupt-photo native request
  returned 500; no unexplained QA HTTP error was found. The existing
  ClientsWorkspace code-splitting warning remains.
- Only the two public QA photos and their two edit documents in reserved shoot
  `eeaf3000-1111-4222-8333-000000000104` were deleted, after namespace and source
  checksum checks. Readback found zero remaining QA records. Both public Sony
  files and the public JPEG retain their original disk checksums.

The browser smoke uses newer uncommitted local editor features; it is not proof
that those features are included in this Git milestone. Its local browser fixture
stays with that editor foundation. This scoped commit contains only store/import,
the new unit regression and this note. It does not publish environment files,
change native binaries, activate the pending opt-in RAW white-balance model,
add histogram features, establish whole-import speedup, or complete Lightroom parity.

Private readback: `38e718c01f5fd3c3bb9da4cfee0a8d556e8ea1e6` matches the
remote photographer-platform branch; Git index is empty. The continuation
heartbeat remains ACTIVE. Main native binaries were not rebuilt or replaced by
this import-read change. The request to show local Develop in Codex was queued;
the separate visible-browser service could not start, so visible opening was
not confirmed. Isolated browser QA above did execute against the running app.

Next throughput work must measure end-to-end RAW import phases and investigate a
bounded decoded-RAW reuse design before implementing it. Required cache identity
includes exact source, source mode, RAW controls and decode quality; cancellation,
memory eviction and stale-result ownership are prerequisites. Do not activate the
unapproved opt-in white-balance model, change old recipes, or claim camera-wide
Lightroom fidelity from the public Sony fixtures.

## September 9: measured import phases and exact opaque JPEG optimization

This milestone follows the active import-speed priority. It removes one avoidable
native allocation, not the remaining import bottleneck or the Lightroom parity
gap. The investigate skill kept the change tied to measured work and exact output
invariants; browse was used for actual chooser imports, not mocked success.

### Root cause and bounded change

The macOS JPEG encoder copied every RGBA image and ran white compositing even
when every alpha byte was already 255. For opaque input that integer operation
is exactly identity. It now validates dimensions/byte length, checks all alpha
bytes, and borrows the immutable caller buffer through synchronous ImageIO
encoding. Any nonopaque pixel still uses the exact previous owned-copy and
integer-white-composite fallback. Bitmap flags, sRGB, quality, orientation,
rendering intent, output limits and caller ownership are unchanged. Provider,
image and destination RAII handles are released before either input owner dies.
This does not claim that ImageIO itself makes no internal copies.

Public Sony A6000, 4096-edge, isolated alternating native measurements:
alpha preparation median **15.47 ms -> 3.09 ms**, avoiding one **44.8 MB** RGBA
allocation. The smaller A7IV sample avoided about 33 MB. RAW unpack/demosaic and
edited-pixel processing still dominate much larger parts of the workflow.
These are stage measurements, not a whole-import speedup or a device-wide
performance guarantee.

### Regression and current local browser evidence

- New production-TU probe: each optimized and ASan/UBSan run passed 1,040 exact
  JPEG comparisons with unchanged source bytes: 76 opaque borrowed buffers and
  964 transparent owned composites, plus 28 invalid admissions and 24 concurrent
  cases. Qualities 0/0.5/0.95/1, one-pixel/odd dimensions, first/middle/last alpha
  boundaries and all 256 alpha/channel combinations are covered.
- An independent literal old encoder matches JPEG bytes but fails the
  `OPAQUE_INPUT_WAS_COPIED` structural assertion. Both actual pre-edit local and
  pre-edit HEAD source versions were also compiled against the new probe and
  failed that assertion. Output-equality tests alone would not detect this fix.
- Clean candidate uses HEAD's existing single JPEG wrapper: 1,040 valid calls.
  Newer local code explicitly reports 524 standard + 516 high-resolution-wrapper
  calls. This proves wrapper execution, not all larger-than-4096 dimensions.
  ASan/UBSan instrument the probe/production TU, not Apple frameworks or the
  existing LibRaw archive.
- Six actual three-file imports (three before / three after) used the public
  A6000 RAW, A7IV-small RAW and volleyball JPEG through the real file chooser.
  Every import retained all three exact original SHA-256s and documents, performed
  one whole-file hash per original, and completed four successful native requests.
  Display, export proof and captured JPEG download were byte-identical in all six
  runs, including across the before/after boundary:
  `60114ecf01ef91676a7125d5b3aa668be26fff907cf955faf93b72efb849abcb`.
- The newer local browser's first-thumbnail median was 382 -> 613 ms; all-three
  thumbnails 1,420 -> 1,964 ms; editor-ready 2,795 -> 3,396 ms. **These browser
  measurements do not establish an end-to-end speed improvement.** Native request
  timings were variable, and the first baseline was cold. Do not conceal the
  slower after medians or attribute the whole difference to this narrow change.
  Request timings include transport/process work; FileReader loadend spans can
  include later event-listener work. Instrumented phases are not additive.
- The public QA records were isolated in reserved shoots ending 105..110. After
  exact namespace, source and saved-document checks, only their 18 photos and
  18 documents were removed. Each namespace read back empty. Original public
  files on disk retained their hashes. Customer libraries, including the 337
  legacy records and the active user shoot, were not inspected or changed.
- Desktop screenshot inspected: three usable thumbnails, actual sensor-RAW image
  and live histogram, no broken-image placeholders. This milestone adds no new
  histogram controls; earlier histogram/exposure regression coverage still passes.

### Validation and handoff boundary

Current local native rebuild: 10 suites, 476,663 checks passed.
Current local full Bun: 1,824 pass, 21 skip, 1 opt-in-WB TODO, 0 fail;
366,390 assertions. TypeScript, scoped lint and the normal production build pass.
The local-only lab config intentionally refuses production builds; the guard
was retained and the normal config was used successfully.

Clean candidate based on `38e718c`: native 9 suites / 120,952 checks; full Bun
1,513 pass, 21 skip, 0 fail / 304,904 assertions; TypeScript, scoped lint and normal
production build pass. Existing skip reasons and unrelated build warnings remain.

Only the opaque encoder hunk, its two test files and this standalone appended note
belong to the private Git milestone. Older high-resolution decoder/refactor,
editor, histogram, CRM, finance and UI work remains local and must not be staged
with it. The local browser phase fixture stays with that newer editor foundation.
No environment file, protocol, authentication, RAW white-balance default, old
recipe, customer original or saved edit is changed by this milestone. Local native
binaries were rebuilt; Git sync is not a production deployment.

Next: investigate repeatable RAW decoding/request latency and browser long tasks
before a larger optimization. A decoded-RAW cache needs bounded memory, exact
source/mode/control/quality identity, cancellation and stale-result ownership.
Fingerprint worker work must retain one exact SHA, abort behavior and durable
per-file import receipts. Do not activate the pending opt-in WB model or claim
camera-wide, color-management, AI-denoise or full Lightroom parity. The existing
continuation remains active.

Private readback: `c61a32a90452f5ecacae74db065544769913793d` matches the remote
photographer-platform branch; index is empty. The current local native build
contains the optimization, with all earlier unrelated working files retained.
The six browser timing receipts are `/private/tmp/foto-import-phases-before-1.json`
through `before-3.json` and `after-1.json` through `after-3.json`. Native comparison
evidence is `/private/tmp/foto-raw-stages.QL0BnO/results.json`; exact/sanitizer/red
proof is `/private/tmp/foto-jpeg-opaque.V3OLna/`. Clean candidate validation is in
`/private/tmp/foto-jpeg-candidate.oIPE7s` with `/private/tmp/foto-jpeg-candidate-*.log`.
The request to show the user's Develop route in Codex was queued. A second visible
browser check failed to start the computer-use service, so visible opening is not
confirmed. This does not invalidate the isolated real-browser QA above.

## Current checkpoint: unified import fairness and exact-version safety

This section supersedes the historical working-tree and typography notes above.
`0f96a91` already contains the shared repository/canonical Develop foundation;
`dd564aa` contains the reviewed Wonder UI/Earnings checkpoint. Both are on the
private photographer-platform branch. The current approved interface uses the
actual self-hosted **Source Serif 4** Wonder font and system-monospace numeric
values, black dark mode and Wonder's light surface. Do not restore the older
sans-serif instruction. The existing hourly heartbeat was updated in place to
retain this latest user decision.

### Reproduced and fixed

- `a27e295`: four RAW files at the head of a batch occupied every preparation
  slot, starving a later JPEG. Separate bounded fingerprint and preview queues
  now allow raster preparation while RAW slots are full. Source identity/name
  ownership and successful-save order remain input-ordered. Four active/ready
  previews, at most two active RAW previews, and a single commit writer remain
  bounded. A reserved commit slot prevents an ahead-ready buffer from deadlocking
  an earlier duplicate retry. Cancellation drains owned work; completed receipts
  remain saved, and quota failure stops further admission.
- `65ac0f9`: routing rejected valid long photo IDs, including frame references
  whose additive `studio:` prefix crossed 2,000 characters. Routes now share the
  existing 4,200-character frame limit and 4,207-character Develop limit. Version
  IDs still have their existing 2,000-character bound. No identity is shortened
  or reassigned.
- `afdf624`: background imports now own their document-unload warning even when
  every React view unsubscribes or unmounts. Protection lasts through discovery,
  cancellation, pending photo receipts, final import reports and lock release;
  separate jobs cannot release one another's guard. In-app route navigation stays
  unblocked. This is browser unload protection, not a guarantee against OS/process
  termination or a claim that unsaved originals are durable.
- Delivery references currently identify archived legacy treatments, **not** a
  native Develop history entry. The old flow validated that version existed but
  then hydrated/adopted the latest recipe. The new shared boundary blocks both
  Develop hooks and the hidden legacy Studio controller for an unresolved exact
  delivery reference. It does not substitute or export the working edit. An
  explicitly labeled full-navigation action can leave the delivery reference and
  open that exact photo's current working edit; invalid references have no fallback.
  Native editing of an exact historical delivery version remains unimplemented.
- The safety boundary independently honors explicit URL versions even when the
  Workbench intentionally retains a different remembered same-project context.
  It has its own small stylesheet so a cold legacy URL does not rely on Develop
  having loaded earlier. Neutral inverse-canvas actions replace legacy red/blue
  primary-color inheritance, including contrasting keyboard focus.

### Verification and remaining gates

- Full local Bun regression: **1,945 passed, 19 skipped, 1 existing opt-in-WB TODO,
  0 failed; 369,594 assertions**. TypeScript, scoped ESLint, source formatting and normal
  production build pass. Log receipts: `/private/tmp/foto-unified-next-regression.log`
  (earlier pass), `/private/tmp/foto-unified-final-regression.log` and
  `/private/tmp/foto-unified-final-build.log` (final source).
- Isolated browser regression: **111 checks passed**, including warm same-project
  focus, both legacy routes, cold legacy stylesheet loading, hidden controller
  replacement, zero reserved record writes/native requests, and actual full-page
  working-edit navigation preserving exact project/frame while removing version
  context. No QA photo/project records were created or deleted; all five reserved
  store counts read back zero and the QA status marker was removed. A separate
  CSS-only repeat inspected dark/light at 390 and 1280 pixels after neutralizing
  the action, including real keyboard focus and 44-pixel touch targets. Screenshots:
  `/private/tmp/foto-wonder-qa.giAs6T/delivery-boundary-{dark,light}-{390,1280}.png`.
- Browser limitation: the deliberately rejected, empty warm-project fixture hung
  its save/navigation guard before a confirmation appeared. Only that first
  transition uses an explicitly documented test-only blocker bypass. Legacy/cold
  navigation and the final real working-edit anchor do not bypass it. This is not
  normal drop/edit/save navigation proof; investigate failed-load navigation
  separately. The regression lives in `tests/develop-delivery-boundary.browser.js`
  and is evaluated as an async function body, not a standalone JavaScript module.
- Import validation includes the previously failing RAW-prefix case, exact
  duplicate retry ownership, bounded read/preview buffers, cancellation and
  full-buffer deadlock cases, 64 committed schedule-model cases and an independent
  180-batch adversarial timing review. These are scheduler tests, **not RAW import
  throughput benchmarks**.
- Later JPEG preparation is now independent of RAW preview admission, but durable
  commits still wait for earlier rows. Unsaved previews are not yet editable, and
  folder/sidecar discovery still gates coordinator admission. The 1,000-entry /
  3-second drop-event target has **not** been established by this checkpoint.
- Separate preview/analysis/durable timing, cross-view manifest adoption, broader
  drop/picker performance trials, exact historical native-version support, and
  the remaining full workflow release gates still need work. Existing HDR/color
  management/AI and full Lightroom parity limits are unchanged.
- No customer library, original, saved history, financial record, environment file,
  authentication setting or external customer message is modified by this work.
  Private Git checkpoints are not a live deployment. Lovable remains at the
  owner-login handoff; its publishing branch, explicit publication to `lenslab.dev`
  and production Google session/return flow require separate verification.

## 2026-09-09 save-safety checkpoint after sky-entry release

The latest public design and workspace recovery are shipped in `6948a8f`.
`lenslab.dev` was explicitly published through Lovable, and the live mountain
artwork and scoped public OpenAI Sans styles were verified. The approved private
chat tables and owner-checked RPCs are installed; the signed-in hosted workspace
opens. This supersedes the older owner-login/publication status above. See
`FOTO-SKY-ENTRY-RELEASE.md` for scope and backend receipts. Google account selection
and completion remain owner-only. Upload-permission migration 0022 remains
unapproved and was not installed.

### Reproduced failures and fixes

- Same-shoot `?photo=` navigation retained the editor while asynchronous hydration
  loaded another photo. A late gesture could arrive after the initial save flush
  and be discarded by adoption. A route-specific hydration fence now hides old
  controls immediately and rejects their late callbacks. Superseded and unmounted
  load requests cannot adopt a snapshot or report a stale error. Existing drafts
  still flush through the normal repository fence before navigation proceeds.
- Registration timing included lock/journal admission waits. It now records the
  original drop's completed discovery independently, with owner/cancellation
  fencing; picker registration is measured immediately.
- Preview-stage and durable completion were previously reported together, before
  the final import journal succeeded. Preparation now has its own completion
  callback; durable completion waits for the final journal transaction. Quota
  failure leaves the durable-completion time unset while retaining actual saved
  photo receipts. Preparation completion includes failed/duplicate terminal rows;
  it is not a claim that every source produced a usable preview.
- Added a regression for periodic journal quota failure: stop admission, retain
  committed photos, fence uncancelable late previews, hold the unload/lock guard
  through the final journal, and permit retry only after owned work drains.

### Verification

- Fail-first tests reproduced three import-timing failures and three hydration
  failures before their fixes. All new tests pass afterward.
- Full regression: **2,023 passed, 21 skipped, one existing opt-in RAW white-balance
  TODO, zero failed; 370,103 assertions across 2,045 tests / 165 files**.
- TypeScript, scoped ESLint, formatting, diff checks, and production build passed.
  The actual built worker returned 200 HTML for `/` and the sign-in return route
  on a cold start with outbound access disabled; zero outbound calls occurred.
- Real isolated Chromium regression: **15 checks passed**. Actual Exposure control
  adjustment followed by normal router navigation preserved the draft. A delayed
  real IndexedDB manifest read hid stale controls; its superseded response could
  not select an older target. A real reload preserved exact IDs/order, adjustment
  history, and SHA-256 original bytes. Only reserved synthetic QA records were
  removed. `tests/develop-warm-navigation.browser.js` documents the gate; its tiny
  PNG fixtures establish navigation behavior, not RAW throughput.
- A separate metadata-only exercise ran 42 trials (drop/picker, 1/337/1,000 entries,
  seven trials each) on Apple M3 Pro / 18 GiB / Bun 1.3.14. Warm median registration
  for folder batches was 0.120 / 8.683 / 29.587 ms; picker batches were 0.057 /
  0.206 / 0.515 ms, with roughly 76–77 ms batched snapshot visibility. It used
  synthetic entry callbacks and in-memory admission gates, not real filesystem
  enumeration, browser paint, network, RAW decoding, or durable saving.

### Remaining gates

Real unique-RAW cold/warm 1/337/1,000-photo trials, memory/responsiveness measurements,
analysis completion, the broader cross-view/drop/export matrix, and exact native
historical-version support remain open. Enumeration/sidecar discovery still gates
heavy preparation, and ordered durable commits still wait for earlier rows.
**The 1,000 entries / three-second reference-machine target is not established.**
No customer originals, accounts, financial records, environment files, public
design, native rendering math, or export proof were changed in this checkpoint.
A push is not publication: verify the connected branch, explicitly publish, and
read back the live assets before reporting this checkpoint deployed.

## 2026-09-10 local dialog-navigation repair; concurrent-work release hold

The latest published baseline is `b63e550` (public motion/navigation/pricing and
resource-page polish). Its whimsical public design supersedes the older public
typography directions above. Do not restore old public styling from this log.

### Reproduced and repaired locally

Automatic crop and reference matching aborted their workers when the dialog
unmounted, but released the parent processing lock only while the dialog was
still mounted. Same-shoot photo navigation preserves DevelopEditor and unmounts
its dialogs while hydration runs. The parent could therefore stay busy and keep
the newly loaded photo's controls unavailable.

The two dialogs now release their own processing lock during cleanup. Controller
identity prevents an old worker's catch/finally from touching a replacement
operation; synchronous admission guards prevent double-starts before React
rerenders. Cancellation is checked between each asynchronous processing stage.
No recipe, crop proposal, original bytes, persistence schema or native pixel math
was changed. Crop/reference application still requires the explicit Apply action.

Owned files in this checkpoint: `AutoCropDialog.tsx`, `ReferencePresetDialog.tsx`,
`tests/develop-dialog-lifecycle.test.ts`, and this appended note. Other modified
and untracked files belong to concurrent work and must not be staged with this fix.

### Evidence and limits

- Initial source-derived lifecycle gate: 8 pass / 8 fail. Expanded red gate:
  8 pass / 10 fail. After the fix, all 22 final lifecycle tests pass, including
  cleanup, late uncancelable reads, replacement operations, effect reactivation,
  duplicate starts, failure and cancellation between stages.
- Lifecycle plus existing warm-navigation/reference-application checks:
  **28 pass, 185 assertions**. Scoped ESLint, Prettier and diff checks pass.
- Existing isolated import/save/navigation gate: **124 pass, 6,438 assertions**.
- Full regression on the working-copy snapshot: **2,068 pass, 21 skip, one existing
  RAW-WB TODO, one failure; 370,511 assertions**. The same marketing workflow
  presentation failure was present before the dialog patch. This is not a green
  release gate. Source continued changing during the audit, so revalidate the
  final integrated checkout before publication.
- These dialog tests execute actual component bodies/handlers with instance-local
  fake hooks and processing promises. They do not establish a new full-browser,
  native-pixel or RAW-throughput benchmark. Real navigation during a running
  crop/reference operation remains a browser verification step.

### Concurrent work requiring coordination

New marketing/settings/checkout/personal-style changes appeared after the Grok
handoff and continued growing during the audit. No active teammate owns them in
this thread. The user was asked whether Grok is still editing or wants takeover.
Do not overwrite, stage, publish or silently discard those changes.

At audit time, TypeScript reported three missing `override` modifiers in
`SectionGuard.tsx` and an exact-optional `customerEmail` error in `signup.tsx`.
The new personal-style module also failed three disposable in-memory isolation
probes: one browser-wide sample key, another account's opt-out suppressing samples,
and clearing the shared log instead of only the current account. This is a
same-browser isolation defect; no actual customer loss or remote leak was tested.
Recheck these findings against any subsequent Grok edits before changing them.

Logs: `/private/tmp/foto-dialog-lifecycle-red.log`,
`/private/tmp/foto-dialog-lifecycle-full-regression.log`, and
`/private/tmp/foto-heartbeat-20260910-typecheck.log`. Independent account-isolation
probe: `/private/tmp/foto-personal-style-isolation-audit.test.ts`; handoff audit:
`/private/tmp/foto-heartbeat-20260910-audit.md`.

The dialog repair is local and uncommitted. No push, Lovable publication, backend
migration or customer-library operation was performed by this checkpoint.

## 2026-09-13 account/import lifetime checkpoint

Current local base before this run: `217d064`. See
[September 12 checkpoint](CELINEN-2026-09-12-CHECKPOINT.md) for the hosted renderer
capability guard, recipe snapshots, Earnings checks and Git divergence. Historical
font and publication notes above are not instructions to restore an older UI.
This run preserves the latest committed interface and makes no presentation redesign.

### Reproduced lifecycle defect and fix

`1efec97` moved bare `/develop`, `/earnings` and other destinations into the
dashboard shell. Route-independent imports intentionally survived that navigation,
but account cancellation still lived only inside the now-unmounted Workbench.
Signing out or changing accounts on a dashboard/public/setup surface could leave
the previous owner's job running. Its store remained scoped to the old owner;
this was not evidence of a cross-account data leak.

`f5f6d65` moves the existing account cancellation effect to `WorkbenchBoundary`,
which covers every shell and is mounted under the account-keyed root. Same-owner
navigation does not cancel imports. On an owner change, pending old-owner work is
cancelled, late preview results cannot save, and already-committed transaction
receipts remain in that original owner's library. No source bytes, repository
schema, rendering math, Auth API or saved preferences changed.

### Regression corrections and verification

- Five new boundary/session tests failed before the effect move and pass afterward.
  They execute the actual boundary branches and cancellation loop with real import
  sessions, in-memory stores and synthetic files. They cover canonical Workbench,
  dashboard, public and setup branches, matching-owner work, late previews and an
  in-flight committed receipt. They are not an authenticated browser or RAW benchmark.
- Combined import/account/navigation/gallery checks: **45 passed, 218 assertions**.
- `5bc7277` corrects two stale expectations without weakening safety: bare Develop
  must protect temporary chat on shell unmount, while canonical same-shoot Develop
  remains usable; gallery registration must retain the default `proofs` and explicit
  `edited` folders alongside exact paths, dimensions, owner and ordering.
- `71d12b6` fixes three exact-optional TypeScript errors in the previous checkpoint's
  capability hints. Browser and Detail checks: **49 passed, 332 assertions**.
- Final full suite: **2,284 passed, 21 skipped, 1 existing TODO, 10 failed** across
  2,316 tests / 221 files. The remaining failures are the previously recorded
  presentation and combined-suite fixture failures, not waived release gates.
- Production build, scoped ESLint and whitespace checks passed. Strict TypeScript
  remains red with **151 diagnostics**, identical by file/message (excluding line
  offsets) to the environment-free `8210e95` archive. Do not report typecheck green.
- Logs: `/private/tmp/celinen-account-import-final-20260913.log`,
  `/private/tmp/celinen-heartbeat-full-20260913.log`,
  `/private/tmp/celinen-heartbeat-build-20260913.log` and
  `/private/tmp/celinen-heartbeat-typecheck-final-20260913.log`.

All changes are local commits. The unanswered main-versus-platform branch choice
still prevents pushing; no merge, history rewrite, mirror overwrite or Lovable
publication was attempted. `.env.development` remains the only unrelated dirty
file. No customer library was accessed. The existing heartbeat was updated in
place to retain this branch hold and preserve current typography rather than
replaying superseded design instructions. The three-second/1,000-entry target,
real RAW performance matrix and live Google/publication gates remain open.

## 2026-09-13 Studio namespace and pending-dialog checkpoint

Base for this run: `8e551a0`. Continued the local import/edit/save gates without
changing the current UI, touching customer libraries, or publishing.

### Two reproduced integration defects

- **Dashboard Studio opened a different library from Develop.** After `/studio`
  moved outside Workbench, its standalone route omitted `storageScope`. Studio's
  repository and import session defaulted to `device-local`; its canonical
  `/shoots/.../develop` destination instead used the signed-in account. The shoot
  and selected-photo URL could be correct while the storage namespace was wrong.
  `984c26a` passes the verified owner explicitly, keys the controller by owner and
  validated binding, and removes the optional device-local default from Studio's
  component contract. All three production callers supply scope. Missing identity
  cannot instantiate Studio; conflicting deep links fail closed. Workbench's
  existing persistent controller and exact local delivery references are retained.
- **A pending snapshot could contaminate another photo's next save.** With A at
  exposure +1 and B at -1, a snapshot action waiting in its initial flush could
  resume after accepted same-shoot navigation hydrated B. `updateDoc(A, true)`
  replaced B's global active draft with A's recipe; the next `commitDraft` wrote
  +1 into B. `db2c1fd` binds dialog actions and export results to their admission
  hydration owner, and only updates the active draft when the document's photo ID
  matches the selected photo. Legitimate background document writes still persist
  to their own photo. Same-owner snapshot and preview cancellation still work;
  late export successes/errors cannot download or update the new route's proof,
  notice, or dialog. No early operation-lock release was added.

Existing device-local records, originals, identities and histories were **not**
moved, deleted, or assigned to a signed-in owner. This fixes future route ownership;
it is not an automatic recovery/migration of imports previously saved under the
wrong namespace. Such recovery must retain explicit ownership and source checks.

### Evidence and remaining gates

- New route fixture initially had **2 passes / 9 failures**, including the actual
  Studio repository/import initializer mismatch. With the fix plus the full-length
  delivery-reference case, **12 tests pass**. The latter preserves a 4,200-character
  frame, 2,000-character version, handoff, selected ID and project namespace.
- The new dialog fixture initially had **1 pass / 2 failures** for wrong-photo
  draft/save corruption. All **8 tests pass** after the fix, including deferred
  export success/failure and same-owner cancellation. Fixtures execute actual
  component actions/route bindings/leave guards with isolated hooks and synthetic
  in-memory I/O. They are not an authenticated end-to-end browser or RAW benchmark.
- Combined targeted gate: **240 passed, 1,891 assertions, 14 files**.
- Full suite with temporary loopback test ports allowed: **2,304 passed, 21 skipped,
  1 TODO, 10 failed; 2,336 tests / 223 files**. The ten failed test names exactly
  match the previous checkpoint. An initial sandboxed run also failed native HTTP
  port binding; those environment failures disappear in the loopback-enabled run.
- Production build passes. Strict TypeScript remains at **151 diagnostics**, with
  identical normalized file/message output to the previous checkpoint. DevelopPage
  and both new test files pass scoped ESLint. Studio has four pre-existing Prettier
  errors reproduced from the pre-edit source; no new lint diagnostics were added.
  Whitespace checks pass. The overall release gate is still not green.
- Logs: `/private/tmp/celinen-studio-scope-before-20260913.log`,
  `/private/tmp/celinen-dialog-navigation-before-20260913.log`,
  `/private/tmp/celinen-workflow-targeted-20260913.log`,
  `/private/tmp/celinen-workflow-full-loopback-20260913.log`,
  `/private/tmp/celinen-workflow-final-build-20260913.log`, and
  `/private/tmp/celinen-workflow-final-typecheck-20260913.log`.

Both fixes are local commits. The owner has not answered the main-versus-platform
branch choice; no push, merge, mirror copy, backend mutation or Lovable Publish was
performed. `.env.development` remains untouched and unstaged. Real folder/RAW
performance, authenticated drop-to-export, hosted capability implementation and
live sign-in/publication remain separate open gates; these checks do not establish
the three-second/1,000-entry target or Lightroom parity.

## 2026-09-13 Canonical Cull roundtrip and catalog receipt checkpoint

Base: `7f93d29`; implementation checkpoint: `1dcd42b`. Kept current presentation
and customer libraries untouched.

### Reproduced and repaired

- **Cull snapshots reimported canonical photos as legacy copies.** A fresh isolated
  LAB browser imported three synthetic JPEGs through the actual standalone Studio
  file input and opened full Develop automatically. After Cull and reopening
  Develop, the canonical library grew from three `sha256:` originals to six rows:
  three extra `studio:sha256:` preview-only records. The new serialized Cull
  projection carries an explicit account-and-shoot namespace plus canonical photo
  ID. Both adoption boundaries validate that reference against the current own
  photo/document and skip reimporting it. Missing/foreign/mismatched references
  fail before any batch write. Unmarked legacy records, even hash-shaped IDs,
  still adopt additively; existing duplicate records are not deleted or merged.
  Virtual copies, missing originals, unresolved legacy crops and histories stay.
  Fail-first integration tests: **1 passed / 2 failed**; expanded roundtrip suite:
  **7 passed / 85 assertions**.
- **Coalesced notifications replayed superseded entries.** A retained A/B import
  receipt still replayed stale A after A's own later save replaced its notification.
  Refresh failed before rereading A, leaving durable B invisible. Overlapping
  receipts could also revert names and reorder earlier imports behind later ones.
  Catalog assembly now accepts only each photo's still-authoritative receipt,
  rereads document-only notifications, and preserves first-seen order before the
  existing validating merge. Stale/duplicate/mismatched authoritative receipts
  still fail closed; dirty active drafts stay separate. Fail-first: **2 passed /
  3 failed**; all five new catalog regressions now pass.
- **Public-page test mocks contaminated workspace tests.** `8210d98` isolates
  legal/blog presentation tests in bounded child Bun processes. Original six
  child tests and 71 assertions are unchanged. Partial account/router mocks no
  longer poison unrelated workspace SSR or AccentColorPicker tests. Both prior
  poison probes now pass 20/20; the combined four-file probe passes 21 parent
  tests. This is test isolation, not a production auth/UI change.

### Real browser evidence and limits

`tests/develop-studio-roundtrip.browser.js` uses only reserved shoot IDs under
`eeaf3000-1111-4222-8333-1c13570904xx` on the separately isolated LAB at 8085.
It never accepts a customer account or namespace. The passing run used `...0431`:

- Actual Studio file-input change → automatic full Develop → Exposure +0.85 →
  Cull navigation initiated **4.4 ms** after the change, with the known pending
  work confirmation explicitly accepted → Develop → real browser reload.
- Exact three IDs/order, original byte digests, edit history and Cull pick survive.
- The displayed edited pixels equal the approved export proof; the intercepted
  actual JPEG download is byte-identical to that proof. Proof SHA-256:
  `884bc9eca38b59abffce37ea0430c7c00f6f57c03ea9b3ba6cd40153ba6b4daa`.
- **30 browser checks pass.** Result:
  `/private/tmp/celinen-studio-roundtrip-browser-20260913.json`; inspected screenshot:
  `/private/tmp/celinen-studio-roundtrip-20260913.png`. Reserved synthetic fixtures
  remain in the disposable QA profile for inspection. No customer records read,
  mutated, migrated or deleted.
- These are three tiny generated 480 x 320 JPEGs, not a RAW performance trial,
  physical OS folder gesture, authenticated cloud test, or proof of the
  three-second/1,000-entry target. Export capture prevents an actual filesystem
  download but exercises the application download path and exact emitted bytes.
- An initial fast-navigation probe without controlled confirmation handling failed
  its save assertion; controlled cold and warm probes passed. The suspected
  mutable router-blocker array was disproved against the installed history code.
  No speculative save-layer change was made. The LAB correctly denied a test-only
  `fetch(blob:)`; comparison now uses decoded canvas pixels without relaxing CSP.
  A separate older warm-navigation fixture passed its first seven checks, but its
  reload/cleanup invocation was interrupted by navigation; it is not counted as
  a completed browser gate here.

### Verification and release hold

- Final targeted gate: **107 passed, 64,038 assertions across 8 matched files**.
  Independently reviewed provenance, foreign-account/missing-source/virtual-copy
  cases and preservation of genuine legacy identities.
- Full loopback-enabled suite: **2,317 passed, 21 skipped, 1 TODO, 5 failed;
  2,344 tests across 225 files**. Remaining failures are the same five existing
  presentation expectations (sidebar metrics, connector icons, light Develop
  chrome, default appearance and typography). No visual rollback was made to
  satisfy superseded expectations.
- Production build passes. Strict TypeScript remains **151 diagnostics**, with
  identical normalized file/message output to the previous checkpoint. Scoped
  ESLint passes for all changed production and Bun test files. The browser fixture
  passes formatting and async-evaluator-body syntax checks; it intentionally has
  top-level return statements and is not an ordinary JS module for ESLint.
- Logs: `/private/tmp/celinen-roundtrip-targeted-final-20260913.log`,
  `/private/tmp/celinen-roundtrip-full-20260913.log`,
  `/private/tmp/celinen-roundtrip-build-20260913.log`,
  `/private/tmp/celinen-roundtrip-typecheck-20260913.log`, and
  `/private/tmp/celinen-roundtrip-lint-20260913.log`.

Local checkpoints only: no push, merge, rebase, mirror overwrite, backend change
or Lovable publication. The unanswered main-versus-platform branch choice remains
the publishing hold. `.env.development` is untouched and unstaged. This does not
claim existing duplicate recovery, RAW throughput, full hosted editing support,
live Google sign-in or production publication has passed.
