# FOTO Develop · assisted editing and portable looks

September 8, 2026. This guide covers the current local Develop additions, not
Lightroom feature parity or a production deployment. C++ performs image processing;
React/TypeScript remains the interface, validation, transport and local storage.
The existing Studio is not replaced. See [Develop scope](FOTO-DEVELOP-SPRINT.md)
and [navigation](FOTO-NAVIGATION.md) for the wider application.

## Use the features

### Reduce noise and inspect detail

In **Detail**, adjust **Luminance noise**, then sharpening; use **100% preview**
and compare Before. The C++ operator now denoises before calculating sharpening
detail, so sharpening no longer simply cancels the denoise operation. Color noise
has its own chroma-smoothing control. Grain is an intentional effect applied later;
lower it when evaluating noise removal.

This is a bounded 5×5 bilateral luminance filter, not trained AI denoise, sensor
reconstruction, or Adobe's algorithm. Strong settings can soften fine texture and
cannot recover lost detail. Preview pixels are not full-resolution RAW pixels;
inspect an export proof at the intended size before delivery.

### Estimate a look from an edited reference

1. Select the source photo. Under **Presets**, choose **Match edited reference…**
   and supply the edited version of that same, uncropped frame and orientation.
2. Run the fit; compare Original, Reference and Estimated look, including warnings.
   The held-out RGB error is a numerical comparison, not a perceptual-quality score
   or proof that the photographs are correctly aligned.
3. Choose **Apply estimated look** for an undoable edit, or name and save a preset.
   Nothing is applied just by choosing a file or obtaining a result.

The fitter estimates a limited global tone/color treatment from small sRGB
previews. It does not extract the original editing settings. It cannot reliably
recover camera profiles, retouching, local masks, grain, cropping or clipped data.
Different subjects or crops are not supported style-transfer inputs.

Applying deliberately replaces the current global color, tone and film effects;
it does not stack the fit on top of the old global treatment. It preserves grain
amount/size/luminance, luminance and color noise reduction, sharpening, crop and
masks through `reference-apply.ts`. Exposure and white balance are among the
replaced global settings. The fitting basis is Develop's neutral sRGB preview;
an embedded-camera preview and a later sensor RAW export can differ. “Estimated”
does not mean an exact Lightroom match.

### Suggest a crop, then approve it

Open **Crop & straighten → Automatic crop…**, choose a target format and click
**Suggest crop**. Inspect the preview, angle, confidence and retained-frame amount
before choosing **Apply suggested crop**. Cancel leaves the crop unchanged; Undo
returns to the previous crop after applying.

The local C++ analysis uses measured edges and contrast, with a bounded
near-horizontal line scan. It does not recognize people, faces, balls, subjects or
the “real” horizon. A roof or stand can be mistaken for a horizon. Low-detail or
transparent images may receive no change. Requested framing is declined when it
would remove too much area or measured detail: at least **70% of effective source
area** remains, including the trimming needed for straightening. Application
replaces the existing crop, rotation and flips, while retaining color, detail and
masks. Masks are retained, not repositioned by subject recognition.

### Copy a photo or change its displayed name

Use **Photo actions → Create virtual copy**, or **Copy photo in FOTO → Paste photo
as virtual copy**. This is an in-app, current-library operation, not an operating
system file clipboard. Each copy gets its own photo ID, edit history and snapshots;
source bytes, original filename and fingerprint remain unchanged. The copy starts
with the source's treatment and metadata. It is not another physical source file
written into the photographer's folder, and browser storage deduplication is not
guaranteed.

**Rename for library & exports…** changes the display/export name only. It does
not rename the source on disk or change the filename required for reconnecting.
Names are checked for unsafe characters and collisions. Automatically derived
copy/export names safely handle older filenames; a new explicit rename is stricter.
Missing media must be reconnected before copying; a preview-only copy remains
preview-only rather than becoming an original.

### Package or import a portable preset

Choose **Import / export presets…**. Select the current look or a saved preset,
enter a title and optional creator, description and license text, then export the
`.foto-preset.json` file. Importing first loads a package for review; **Save** adds
a new local preset rather than targeting an existing preset by ID.

Packages carry validated FOTO settings and the entered metadata. Photo-specific
crop and masks are excluded; image bytes, account IDs and local paths are not
automatically embedded. Review your own metadata before sharing it. Creator/license
text is not ownership verification, legal enforcement or a digital signature.
This prepares a file that can be distributed elsewhere; there is no preset
marketplace, checkout, automatic publishing, payout or Adobe-preset compatibility
in this addition.

### Keep the interface neutral

Develop's header is neutral dark rather than blue-tinted. In Appearance, sidebar
opacity runs from **20–100%**, defaults to **80%**, and is adjustable in 5-point
steps. Explicit saved preferences remain respected. Disabling translucency or
using increased contrast makes the surface solid. This is CSS transparency and
blur within the app, not native macOS wallpaper sampling or desktop vibrancy.

Histogram display also offers measured RGB/luminance and explicit linear/log
height scaling. Changing the display mode does not change a photo's pixels.

## Developer boundaries

| Area              | Enforced limit or integration point                                                                                                                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Develop rendering | `contract.ts` / `client.ts`: nonempty source up to 128 MiB; normal preview edge 1600; requested output edge 32–4096; sensor RAW limited to 60 million pixels. JPEG sRGB output, not a full high-bit-depth RAW workflow.                                                    |
| Reference fit     | `reference.ts`, `reference-contract.ts`, `native-reference.ts`, `native/src/reference.cpp`: opaque aligned 16–128-pixel dimensions; maximum paired packet 131,080 bytes; aspect-ratio mismatch guard; one fit lane; 15-second child timeout; JSON result capped at 16 KiB. |
| Automatic crop    | `auto-crop.ts`, `native-crop.ts`, `native/src/crop_suggest.cpp`: analysis up to 384 pixels per side; packet at most 589,840 bytes; target aspect 0.25–4; correction bounded to ±8°; one crop lane; 10-second child / 20-second client request timeout; 16 KiB result cap.  |
| Local transport   | Serve-only localhost endpoints use origin/request/token validation, bounded inputs and cancellation. These processing paths do not upload files to external providers. A static production build does not supply the local C++ service.                                    |
| Copies and rename | `photo-management.ts` and `createDevelopStore()` in `store.ts`: account + library scope; atomic photo/document insertion with source revision guard; rename compares the expected old name. Conflicts or storage failures are errors, not successful saves.                |
| Preset package    | `preset-package.ts`: strict `foto-develop-preset`, version 1, UTF-8 JSON at most 256 KiB; title 100 characters, creator 160, description/license 4,000 each. New import IDs; account-scoped presets; additive recipe defaults remain backward-compatible.                  |

Before replacing a recipe or opening these operations, the parent flushes the
current draft and serializes mutating actions. Do not bypass the store's compare-
and-save guards or migrate the Studio database to implement these features.
Virtual-copy insertion must remain one transaction: no orphan photo after a
failed document write. Preserve originals and original-identity metadata even
when display names change.

If the engine is unavailable, run `make -C native` from this repository, then
restart/reload the existing local app (`npm run dev:lab`). A failed decode, missing
original, unsupported package, expired request or save conflict must remain a
visible error. Reconnect only the actual original; never fabricate replacement
bytes from a filename. On a save failure, retain the working draft and use the
existing recovery-file action rather than resetting local storage.

## Verification recorded for this addition

These are individual checks, not a fresh full-suite or deployment sign-off.
Assertion counts include per-pixel checks; do not interpret them as independent
photos, camera models, client assignments or accuracy percentages.

| Check                                       | Observed result                                                                                                                                                                                                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `native/build/develop-tests`                | 88,713 assertions passed, including 1,000 bounded render combinations. New noise fixtures check reduction at two amplitudes, sharpening interaction, source immutability, color differences, alpha, strong edges, uniform fields and one-pixel dimensions. |
| `native/build/reference-tests`              | 29 assertions passed. Controlled synthetic pairs exercise bounded fitting and error reduction, not real-world style recovery certification.                                                                                                                |
| `native/build/crop-suggest-tests`           | 45 assertions passed. Geometry/retention and deterministic synthetic-scene checks, not semantic composition accuracy.                                                                                                                                      |
| `tests/develop-store.test.ts`               | 31 tests passed; history/recovery, source identity, scope and failure invariants.                                                                                                                                                                          |
| `tests/develop-photo-management.test.ts`    | 11 tests passed; naming, inherited filenames, independent copy history, immutable source identity and portable-package validation.                                                                                                                         |
| `tests/develop-reference-apply.test.ts`     | 1 test passed; explicit global replacement with independent detail/geometry retained and no aliasing.                                                                                                                                                      |
| `tests/develop-histogram-display.test.ts`   | 2 tests passed; counts preserved, honest empty data, linear/log normalization.                                                                                                                                                                             |
| `tests/develop-photo-management.browser.js` | 29 real IndexedDB checks passed in an isolated synthetic library, including conflict handling, namespace isolation, atomic rollback, concurrent copies and retained original bytes. No customer originals were modified for this QA.                       |

The four listed Bun files were also run together: 45 passed, zero failed, 62,314
assertions. Historical full-suite results in other documents do not establish
the status of this addition.

### Integrated verification

The September 8 integration run completed with **1,430 Bun tests passed, 20 skipped,
zero failed**, with 298,166 assertions. Skips require optional camera/Lua fixtures.
TypeScript, changed-file ESLint and the production build passed. The production
build is a packaging check, not a deployed C++ backend.

An isolated browser library, using a public-domain USAF basketball fixture, verified:

- Import, rename, copy/paste into a distinct virtual copy, and persistence after reload.
- Same-frame edited-reference fitting through the UI: held-out RGB error approximately
  7.4 to 4.0 / 255 (45% reduction), explicit save/apply, and Undo. This is one test
  photo, not a general accuracy promise.
- Low-confidence crop retains the source frame; an approved 16:9 suggestion creates
  an undoable history entry.
- RGB/luminance and linear/log histogram controls operate without changing treatment.
- Luminance noise at 100 changes 1,424,204 pixels in the 1600×1007 preview; Undo restores
  the prior treatment. Noise-reduction quality is separately checked by the synthetic
  native fixtures, not inferred simply from changed pixels.
- Exported JSON was inspected (3,327 bytes), then imported and saved through the UI.
  Creator/license metadata survives the round trip. Choosing Current clears it.
- Default opacity 80%; keyboard-selected 20% persists on reload; 100% is solid.
  Header remains RGB(22,22,22) in dark and RGB(249,249,249) in light even with
  a custom blue `#111827` canvas. Light mode was visually inspected.
- Reference comparison reviewed at 1440×1000 and 390×844; the narrow dialog is
  350 pixels wide inside a 390-pixel document, with internal vertical scrolling.
  No application console errors during the final reference flow.

All photo and preference mutations above were confined to the isolated QA browser.
The customer's library, originals and `.env.development` were not changed.

## Research context

The spatial-and-intensity weighting family is described by Tomasi and Manduchi's
[Bilateral Filtering for Gray and Color Images](https://users.soe.ucsc.edu/~manduchi/Papers/ICCV98.pdf).
FOTO's bounded luminance implementation is its own implementation, not a claim to
reproduce every variant or evaluation in that paper. No paper establishes Adobe
parity or a quality guarantee for the current reference-fit or crop heuristics.
