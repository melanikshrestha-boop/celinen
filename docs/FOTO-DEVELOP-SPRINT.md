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

Latest milestone: [working grading, histogram, adaptive film looks and evidence](FOTO-COLOR-GRADING-QA.md).

These statuses describe tested subsets, not equivalence to Lightroom Classic.
The latest priority is working color grading, histogram interactions and adaptive
film looks. The earlier import incident remains a required regression baseline.

| Area | Status | Acceptance evidence required |
| --- | --- | --- |
| Dedicated route and reference layout | Implemented | Inspected desktop 1440×1000 and phone 390×844; no horizontal overflow; original Studio route retained |
| Native basic/presence controls | Implemented | C++ neutral identity, actual pixel changes and original unchanged; UI exposure changes actual rendered pixels |
| Curve, HSL, grading | Implemented subset | Master plus independent RGB point curves; eight-channel HSL; interactive shadows/midtones/highlights/global wheels, numeric H/S/L, corrected new tonal model with explicit legacy compatibility; independent FOTO math, not Adobe algorithm parity |
| Grain, vignette, fade, bloom, halation, film falloff | Implemented | Deterministic native effects, grain size and luminance shaping; optional source-derived exposure for built-in looks; not calibrated film-stock emulation |
| Histogram and automatic exposure | Implemented subset | Actual rendered 256-bin RGB histogram, five draggable/keyboard tonal regions, clipping percentages and overlays; explicit bounded source-derived Auto exposure, not Adobe Auto Tone or sensor histogram |
| Crop/straighten/rotate/flip | Implemented | Native geometry tests, square-crop UI/native output check; source-coordinate overlay |
| Linear/radial masks | Implemented | Native feather/invert/enable/local adjustments, UI placement and saved mask history; no brush/AI masking |
| Presets/history/snapshots | Implemented | Original + five look presets, custom presets, snapshots, undo/redo; per-photo IndexedDB history; merge-only reimports |
| Copy/paste/previous/sync | Implemented | Preserve target crop/masks by default; optional batch sync; atomic conflict rollback checked in real IndexedDB |
| Import/library/filmstrip | Reported batch/empty-state regression repaired; wider camera coverage remains partial | Valid files continue after per-file errors; chooser/drop/nested-folder/cancel/duplicate/reload checks pass. Missing originals stay discoverable without an empty filmstrip. Existing private missing images still require their actual originals |
| Export | Implemented subset | Native JPEG sRGB, long edge up to 4096 without upscaling; sensor RAW decoding; exact downloadable JPEG proof, Fit/100% inspection and cancellation; original never overwritten |
| Recovery-file import | Implemented | Explicit file/selection/preview/restore; atomic revision guards, originals and current metadata retained, appended undoable treatment; real reload and fault-injection checks |
| Cross-tab and scope isolation | Implemented | Revision conflicts, simultaneous writers, quota rollback, account/project isolation; Develop cannot acknowledge a stale Studio writer's baseline |
| AI masks/healing/AI denoise | Not implemented | Requires real models; do not expose fake controls |
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
and other real camera models have not been validated. Thumbnail-based RAW
preview and full sensor export may differ; the exact export preview now makes
that difference inspectable before downloading.

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
