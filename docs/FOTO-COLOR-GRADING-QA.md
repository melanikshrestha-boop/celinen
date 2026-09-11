# FOTO grading and histogram milestone · September 8, 2026

Built on `776fd1d` in the existing private photographer-platform branch. C++ remains the image operator; React provides controls and source-preview statistics. No source originals, customer libraries, environment values, or authentication settings were changed by this work. Browser tests used reserved synthetic/public-photo libraries only.

## Fixed and added

- Replaced the inert gray grading swatch with actual shadows, midtones, highlights and global hue/saturation wheels, numeric H/S/L, per-wheel reset and three-way/detail views. Pointer modifiers, keyboard repeat, Escape/cancel and history are exercised through real React handlers.
- Fixed two native tonal-model defects: Blending zero previously eliminated the midtone contribution; Balance moved the tonal regions in the wrong direction. Normalized overlapping tonal windows now follow the documented control direction. Their math is independently implemented, not Adobe's proprietary algorithm. [Adobe's grading engineer explains the controls](https://blog.adobe.com/en/publish/2020/10/20/introducing-color-grading).
- Existing recipes default to legacy rendering, preserving previously saved appearances. New/reset recipes use the corrected tonal model. Nonneutral legacy grades offer **Use updated grading**; changing it is undoable. Old protocol versions 1/2 still parse; the rebuilt operator accepts protocol 3.
- The histogram now analyzes every opaque pixel of the bounded rendered sRGB preview, with 256 bins per channel. Five tonal regions respond to dragging and keyboard input; blue black-clipping and red RGB-highlight overlays match the displayed image. Diagnostics remain switchable in Before view and available on small screens.
- Added explicit source-derived **Auto exposure** and the **Adapt built-in looks to light** toggle. Analysis does not compound previous edits, does not infer artistic intent, and never resets manual exposure for an unanalysable/extreme source. The source-highlight guard is not a guarantee against clipping from later creative adjustments. [Implemented math and limitations](FOTO-ADAPTIVE-TONE-NOTES.md).
- Added deterministic luminance-shaped grain alongside existing grain size, fade, vignette, bloom, halation and film falloff. This follows the general signal-dependent synthesis approach, not calibrated film-stock simulation. [ITU film-grain synthesis reference](https://www.itu.int/epublications/publication/itu-t-h-suppl-21-2025-01-film-grain-synthesis-technology-for-video-applications).
- Shared grading transaction ownership and a page-wide competing-pointer/click guard prevent another touch from saving a cancelled preview. Keyboard edits coalesce into one undo step. Visible grading labels no longer truncate while accessible names retain the tonal range.

## Verification

Counts describe distinct test layers and overlap; do not add assertions together or call these thousands of camera workflows.

- Full Bun suite: **1,316 passed, 20 skipped, zero failures; 285,343 assertions**. Local loopback test servers were permitted. The skipped optional suites are not verified features.
- Native suite: **104,485 assertions** across seven executables. Develop alone: **72,320 assertions** passing normally and under AddressSanitizer/UndefinedBehaviorSanitizer. Includes 1,000 bounded setting combinations and every exposed Basic/Effects/Detail control, 8 HSL channels × 3 controls, four grading wheels, grain size, curves and manual masks on suitable fixtures.
- Twelve nonneutral legacy rendered JPEGs compared byte-identical against the pre-change executable.
- Numeric/gesture focused suite: **27 tests, 6,136 assertions**, including 1,000 wheel-coordinate round trips and 1,000 varied source distributions. These are deterministic numeric checks, not 1,000 real-camera or visual-quality evaluations.
- [Histogram/adaptive browser regression](../scripts/qa/develop-grading-browser.js): **34 checks**, isolated QA32. Actual PNG import, C++ output, histogram change, exact undo, overlays, global grade persistence, source-derived dark/bright behavior, keyboard grouping and extreme-source safety.
- [Wheel browser regression](../tests/develop-grading.browser.js): **20 checks**, isolated QA7. Synthetic pointer/key events call actual React handlers with a per-wheel pointer-capture shim; real IndexedDB and native pixels. Includes modifiers, cancelling, overlapping-wheel rejection, source/metadata preservation and undo/redo.
- [Cross-panel pointer regression](../tests/develop-pointer.browser.js): **7 checks**, QA7. Competing pointer down, click and keyboard input are blocked; a rejected late click cannot activate a preset after cancellation; persisted document and redo history compare exactly unchanged.
- [Real-photo export regression](../scripts/qa/develop-grading-export-browser.js): **9 checks**, QA33. Public sports JPEG and Sony A6000 RAW uploaded through the actual file input. A real browser Shift+ArrowUp set Global saturation 10 and it survived reload. The graded sensor-RAW proof is **4,096 × 2,736**, **4,907,359 bytes**, and its download compares byte-for-byte identical. All 25,624,576 original RAW bytes remain unchanged. Both Sony A6000/A7 IV were also tested directly through the native transport.
- Desktop 1,440 × 1,000 and mobile 390 × 844 screenshots visually inspected with real photography. Mobile histogram is visible; the viewport fits without horizontal overflow. Typography continues using the shared sans-serif token.
- TypeScript, scoped ESLint, formatting, production build and diff whitespace checks passed. A development hot-reload hook-signature error during editing cleared on a clean reload; final verification uses fresh loads, not that stale component instance.

## Still not Lightroom Classic parity

Current delivery is JPEG/sRGB up to a 4,096-pixel long edge. Grading works on the decoded working image; already-clipped RGB detail cannot be reconstructed by lowering Highlights. Full-resolution high-bit-depth color-managed RAW output, camera/lens profiles, calibrated film stocks, brush/AI masks, healing, AI denoise, HDR/panorama and print soft-proofing remain gaps. No fake controls or completion claims were added for them.

The sports Jobs/SmartFile/roster/gallery/sales direction is captured in [FOTO Jobs plan](FOTO-JOBS-PLAN.md); that document is a deferred build specification, not implemented CRM, payments, Face Find or social publishing. The existing Develop continuation remains the active scope.
