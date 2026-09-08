# FOTO Photo Lab · Develop sprint

## Scope and provenance

User requested a dedicated mini-Lightroom page inside this existing app, starting
from `4e1d941` on `codex/lenslabs-photographer-platform`. Do not replace Studio,
Clients, Books, projects, authentication, or user originals. `.env.development`
is local-only and was already modified at the start. No new app/project.

Eight-hour scheduled continuation deadline: **2026-09-08 17:14 UTC**. Automation
`lenslabs-aftershoot-and-pixieset-build-sprint` continues this scope hourly; pause
at deadline and report gaps. Routine unchanged progress stays quiet.

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

| Area | Status | Acceptance evidence required |
| --- | --- | --- |
| Dedicated route and reference layout | Implemented | Inspected desktop 1440×1000 and phone 390×844; no horizontal overflow; original Studio route retained |
| Native basic/presence controls | Implemented | C++ neutral identity, actual pixel changes and original unchanged; UI exposure changes actual rendered pixels |
| Curve, HSL, grading | Implemented subset | Master plus independent red/green/blue point curves, eight-channel HSL, three tonal grading ranges; native pixel and browser history checks; grading wheels remain |
| Grain, vignette, fade, bloom, halation, film falloff | Implemented | Deterministic native effects and bounded outputs; falloff is a hue-preserving highlight shoulder, not a proprietary stock emulation |
| Crop/straighten/rotate/flip | Implemented | Native geometry tests, square-crop UI/native output check; source-coordinate overlay |
| Linear/radial masks | Implemented | Native feather/invert/enable/local adjustments, UI placement and saved mask history; no brush/AI masking |
| Presets/history/snapshots | Implemented | Original + five look presets, custom presets, snapshots, undo/redo; per-photo IndexedDB history; merge-only reimports |
| Copy/paste/previous/sync | Implemented | Preserve target crop/masks by default; optional batch sync; atomic conflict rollback checked in real IndexedDB |
| Import/library/filmstrip | Implemented | Original bytes or clearly labeled preview source; same-name originals content-addressed; supported Studio adjustments seeded only on first import |
| Export | Implemented subset | Native JPEG sRGB, long edge up to 4096 without upscaling; sensor RAW decoding; exact downloadable JPEG proof, Fit/100% inspection and cancellation; original never overwritten |
| Recovery-file import | Implemented | Explicit file/selection/preview/restore; atomic revision guards, originals and current metadata retained, appended undoable treatment; real reload and fault-injection checks |
| Cross-tab and scope isolation | Implemented | Revision conflicts, simultaneous writers, quota rollback, account/project isolation; Develop cannot acknowledge a stale Studio writer's baseline |
| AI masks/healing/AI denoise | Not implemented | Requires real models; do not expose fake controls |
| Lens profiles, HDR, soft proofing, full RAW workflow | Partial / gaps | LibRaw sensor decode exists; not a full high-bit-depth color-managed RAW workflow |

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

## Remaining sprint priorities

1. Crop-preview race, hidden filtered Sync targets, and keyboard modal focus
   fixes are implemented and tested. Retain the regressions during new UI work.
2. Exact sensor-RAW export proof, independent RGB curves, film falloff and safe
   recovery import are implemented and tested. Preserve the new regressions.
3. Add richer color grading interaction and selective copy/sync options with
   pixel and persistence regression checks.
4. Expose presets/history on narrow screens, improve dialog/keyboard access, and
   keep photo view dominant with the outer workspace sidebar collapsed.
   Extend the tested single-original reconnect to a carefully fingerprinted
   folder/batch flow for legacy projects; never match unrelated originals
   silently or reset saved edit history.
5. Develop brush masks and source-coordinate correctness before adding AI tools.
6. Full-resolution/high-bit-depth color management, TIFF export, lens profiles,
   healing, AI denoise/masking, HDR and soft proofing remain unimplemented. Do not
   imply placeholders provide these capabilities.

Other limitations: saved neutral thumbnails do not yet show every live edit;
legacy Studio imports only
carry settings that map explicitly to this engine. No customer originals are
uploaded or rewritten, and there is no cloud production-parity claim.

## Handoff discipline

Run focused tests, TypeScript and build, and live browser tests using disposable
fixtures. Do not inflate test counts or equate repeated smoke tests with parity.
Push only scoped validated source changes to the existing private branch. Git
sync is not proof of production deployment. Update this document with exact
commands, results, known gaps and next steps before yielding.
