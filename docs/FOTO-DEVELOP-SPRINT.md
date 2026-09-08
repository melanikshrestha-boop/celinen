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
| Curve, HSL, grading | Implemented subset | Master RGB point curve, eight-channel HSL, three tonal grading ranges; native range fixtures; no independent R/G/B curves yet |
| Grain, vignette, fade, bloom, halation | Implemented | Deterministic native effects and bounded outputs; no claim of Adobe/Sunroom algorithm equivalence |
| Crop/straighten/rotate/flip | Implemented | Native geometry tests, square-crop UI/native output check; source-coordinate overlay |
| Linear/radial masks | Implemented | Native feather/invert/enable/local adjustments, UI placement and saved mask history; no brush/AI masking |
| Presets/history/snapshots | Implemented | Neutral + six look entries, custom presets, snapshots, undo/redo; per-photo IndexedDB history; merge-only reimports |
| Copy/paste/previous/sync | Implemented | Preserve target crop/masks by default; optional batch sync; atomic conflict rollback checked in real IndexedDB |
| Import/library/filmstrip | Implemented | Original bytes or clearly labeled preview source; same-name originals content-addressed; supported Studio adjustments seeded only on first import |
| Export | Implemented subset | Native JPEG sRGB, long edge up to 4096 without upscaling; optional sensor RAW decoding; original never overwritten |
| Cross-tab and scope isolation | Implemented | Revision conflicts, simultaneous writers, quota rollback, account/project isolation; Develop cannot acknowledge a stale Studio writer's baseline |
| AI masks/healing/AI denoise | Not implemented | Requires real models; do not expose fake controls |
| Lens profiles, HDR, soft proofing, full RAW workflow | Partial / gaps | LibRaw sensor decode exists; not a full high-bit-depth color-managed RAW workflow |

## Verified milestone, September 8

- `npx tsc --noEmit` and targeted ESLint: pass.
- `npm run build`: production bundle passes. This does **not** deploy a hosted
  native worker. The working native transport is registered in the local Vite
  runtime used by `npm run dev:lab`.
- `bun test tests/develop-engine.test.ts tests/develop-store.test.ts
  tests/native-transport.test.ts tests/native-client.test.ts --timeout 30000`:
  **57 tests, zero failures, 61,431 assertions**. This includes existing culling
  transport checks, 1,000 bounded transport combinations, and 1,000 independent
  history/undo/JSON-reload sequences. Repetition is not a claim of feature parity.
- Native release tests: **24,147 assertions**, including 1,000 actual renders.
  Same unit suite under ASan/UBSan passes. Sanitized sensor-RAW test: 11 assertions.
- Browser storage tests: **19 checks** against real IndexedDB, including atomic
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
  below, this is **69 browser checks**, not 69 end-to-end camera or Lightroom
  feature certifications.
- Independent review fixes verified: ten unit tests and **12 browser checks**
  cover source-geometry preview provenance, filtered Sync targets and dialog
  focus/Tab/Shift-Tab/Escape/opener restoration. The test delays actual native
  response delivery to exercise the geometry race. Files:
  `tests/develop-ui-state.test.ts`, `tests/develop-ui-boundaries.browser.js`.
- Existing workbench, local-development identity and Studio-safety tests:
  **59 passed**, zero failed. The expected tool catalogue now includes Develop.
- Desktop and mobile screenshots inspected locally. Phone width 390px matches
  document width 390px. Phone editing works, but left-panel preset/history tools
  still need a compact accessible drawer.

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
preview and full sensor export may differ; the export dialog says so.

## Remaining sprint priorities

1. Crop-preview race, hidden filtered Sync targets, and keyboard modal focus
   fixes are implemented and tested. Retain the regressions during new UI work.
2. Add a sensor-RAW proof preview so the user can inspect the exact export source
   treatment before downloading; test with user-authorized real RAW fixtures.
3. Add independent RGB curves, richer color grading interaction, film falloff,
   and selective copy/sync options with pixel and persistence regression checks.
4. Expose presets/history on narrow screens, improve dialog/keyboard access, and
   keep photo view dominant with the outer workspace sidebar collapsed.
5. Develop brush masks and source-coordinate correctness before adding AI tools.
6. Full-resolution/high-bit-depth color management, TIFF export, lens profiles,
   healing, AI denoise/masking, HDR and soft proofing remain unimplemented. Do not
   imply placeholders provide these capabilities.

Other limitations: saved neutral thumbnails do not yet show every live edit;
recovery JSON can be downloaded but has no import UI; legacy Studio imports only
carry settings that map explicitly to this engine. No customer originals are
uploaded or rewritten, and there is no cloud production-parity claim.

## Handoff discipline

Run focused tests, TypeScript and build, and live browser tests using disposable
fixtures. Do not inflate test counts or equate repeated smoke tests with parity.
Push only scoped validated source changes to the existing private branch. Git
sync is not proof of production deployment. Update this document with exact
commands, results, known gaps and next steps before yielding.
