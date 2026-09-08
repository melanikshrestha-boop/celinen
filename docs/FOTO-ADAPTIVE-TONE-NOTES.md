# FOTO image-adaptive tone: research and implementation proposal

Status: research and proposed engineering policy, September 8, 2026. This document does not implement an algorithm or claim visual parity with Lightroom. Current native behavior was inspected during the color-grading work after baseline `776fd1d`; recheck the renderer when implementing.

## Implemented policy in this grading milestone

The shipped helper is [histogram.ts](../src/lib/develop/histogram.ts). It measures all opaque pixels of the bounded native sRGB preview: 256 bins per RGB channel, 1,024 linear-luminance bins and a maximum-channel distribution. No extra thumbnail downsampling hides clipping endpoints.

- **Auto exposure** is an explicit, one-step undoable action. It proposes `clamp(.65 * log2(.18 / medianLinearY), -1, 1)` EV from the neutral source, not the edited output. Empty or extreme-lighting inputs are explicit no-ops and preserve manual exposure.
- Positive EV is capped by `.98 / P99.5(maxLinearRGB)` headroom and rounded downward to hundredths of a stop. Negative suggestions are bounded independently. The ignored upper 0.5% tail and later creative controls mean this is **not** a zero-clipping guarantee. The UI says “Exposure limited by source highlights”; the actual rendered histogram and red clipping overlay remain the final diagnostic.
- “Adapt built-in looks to light” is enabled initially in response to the user's request. Turning it off applies the authored built-in recipe. Saved/custom presets are never automatically adapted. All current built-in recipes have base EV zero; adding a nonzero base requires extending the math below rather than silently discarding it.
- Applying a preset is an explicit replacement of its creative treatment, preserving crop and masks. Its adapted exposure uses the same immutable source measurement, so repeated applications cannot compound. Warm negative and Classic monochrome enable the new luminance-shaped grain when adaptation is on. The renderer—not browser CSS—creates grain.
- The native grain envelope at strength 100 is `sqrt(4L(1-L))`, where `L` is the edited working-image luma after fade/falloff/vignette. Strength zero preserves the prior per-channel grain calculation exactly. This is deterministic synthetic texture, not measured film stock or detected camera noise.

The remainder records research and a more conservative future proposal policy (including a separate preview/apply step and full-look clipping budget). Those are not claims about this implementation. The implemented Auto button immediately renders and saves one undoable exposure step; the export dialog still requires an actual source-mode proof before download.

## The problem

A fixed creative preset sees very different input from a night game, sunlit pitch, or indoor portrait. A measured exposure starting point can help, but histogram statistics cannot tell whether a dark image is intentional, whether a bright background matters more than the subject, or which film interpretation the photographer wants. The product should propose a small, reversible adjustment, not declare the photo correct.

## Evidence and its limits

- Adobe describes Basic tone controls as interacting and image-adaptive, with a workflow that establishes brightness and then inspects bright/dark regions and clipping. Settings depend on the photograph and intended result. This supports separate tonal measurements and review; it does **not** publish Adobe's algorithm or justify copying its numeric slider values into FOTO. [Adobe tone-control procedure](https://helpx.adobe.com/lightroom-classic/desktop/help/tone-control-adjustment.html)
- Adobe documents Exposure in stops and uses RGB histograms plus channel-specific clipping indicators. This supports labeling exposure in EV and checking channels individually rather than checking only a grayscale average. FOTO's recovery capabilities remain different from Adobe's. [Adobe tone, color, and histograms](https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/image-tone-color.html)
- Reinhard and colleagues use scene luminance and a chosen key to guide photographic tone reproduction. Their discussion explicitly distinguishes low-, normal-, and high-key intent; a normal-key mapping is not right for every scene. The paper concerns tone reproduction of available luminance information, not reconstructing missing detail in a clipped JPEG. FOTO's median-based proposal below is **not** their published method. [Photographic tone reproduction for digital images, 2002, sections 2–3](https://www.cs.utah.edu/docs/techreports/2002/pdf/UUCS-02-001.pdf)
- The sRGB transfer function and linear-light luminance coefficients provide a defined numeric domain for exposure calculations. The source specifies color math, not photographic auto-exposure policy. [W3C relative luminance definition](https://www.w3.org/TR/WCAG22/#dfn-relative-luminance)

## Current FOTO constraints

The authoritative recipe is [contract.ts](../src/lib/develop/contract.ts). Exposure spans `[-5, 5]` EV. Most signed tone controls span `[-100, 100]`. The current working schema adds defaults for legacy histories, including channel curves, film falloff, grading model/global grading, and luminance-shaped grain. Any proposal must clone and validate the complete recipe, preserving fields it does not own.

The pixel operator is [develop.cpp](../native/src/develop.cpp). Its preview exposure stage decodes sRGB, multiplies each linear channel by `2^exposure`, re-encodes, and clamps. Temperature, highlights/shadows, whites/blacks, contrast, curves, color effects, masks, and film effects follow. Most tonal masks use encoded-channel luma, not linear relative luminance.

**Protect highlights before increasing exposure.** Later Highlights or Film falloff cannot recreate values discarded by that earlier clamp. A film shoulder applied downstream can change their appearance but cannot recover lost separation.

The RAW path is different: [develop_main.cpp](../native/src/develop_main.cpp) gives exposure/temperature/tint to [develop_raw.cpp](../native/src/develop_raw.cpp) before demosaic, then zeroes those controls for the later operator. Statistics from an embedded JPEG or cached preview do not describe unclipped sensor data. The RAW export proof must be rendered from the actual RAW source. Do not label preview-derived numbers as sensor dynamic range or RAW highlight recovery.

Current limits include a 1,600-pixel preview long edge, 4,096-pixel export long edge, 128 MB input cap, and 60 MP RAW sensor cap. The browser's displayed histogram describes decoded/rendered pixels at its analysis resolution, not an original sensor histogram or a color-managed print proof.

## Proposed measurements

Input: neutral decoded image pixels, source identity/mode, immutable base recipe, and an explicit look intent. Do not analyze an already adapted result and repeatedly compound its correction.

1. Bound both dimensions, for example a proportional fit inside 256 × 256, with at most 65,536 samples. Fix the resampling method and record analysis dimensions. Downsampling can hide small specular highlights; treat clipping checks at this resolution as approximate.
2. Ignore fully transparent pixels and rendering padding. Define the policy for partially transparent pixels; excluding them is a conservative initial choice for photos. Never count transparent black as scene shadows.
3. Normalize channels to `c ∈ [0,1]` and decode sRGB:

   ```text
   linear(c) = c / 12.92                          when c <= 0.04045
             = ((c + 0.055) / 1.055)^2.4           otherwise
   Y = .2126*linear(R) + .7152*linear(G) + .0722*linear(B)
   M = max(linear(R), linear(G), linear(B))
   ```

   This follows the linked sRGB definition. Use `Y` for exposure arithmetic and `M` for channel headroom. Keep encoded luma separately when approximating FOTO's existing tonal masks.

4. Calculate exact sorted-sample percentiles with a fixed interpolation convention, such as index `(n-1)*p` with linear interpolation. Suggested summaries: `Y` P10/P50/P90/P99.5, `M` P99.5, valid sample count, and per-channel shadow/highlight endpoint fractions. A 256-bin display histogram is a separate view and need not determine the exposure proposal.
5. Return no adjustment with a reason when there are no valid samples, invalid dimensions, non-finite values, or essentially no tonal information. The information thresholds are engineering policy and need fixture-based tuning, not assertions of perceptual truth.

Avoid gray-world white balance here: green grass, team colors, sunset, or theatrical lighting can dominate the mean without being an unwanted cast. Do not change temperature, tint, HSL, color-grading palette, crop, masks, or grain from a brightness statistic.

## Conservative EV proposal

The constants and percentile choice below are **FOTO heuristics proposed for testing**, not values prescribed by Adobe, W3C, or Reinhard. Start with exposure-only adaptation; it has a clear unit and a smaller failure surface than automatically changing six interacting tone controls.

Let `E0` be the base recipe exposure, `K` an explicitly chosen tonal target, and `s` a strength in `[0,1]`. For a normal-key starting point, an example is `K=.18`, `s=.35`. Do not assume `.18` is the correct median of every photograph. Night/high-key looks need author-selected intent or no automatic normalization.

```text
epsilon = 1e-6
baseMedian = max(P50(Y) * 2^E0, epsilon)
requestedDelta = clamp(s * log2(K / baseMedian), -.75, .75)
candidateExposure = clamp(E0 + requestedDelta, -5, 5)
```

`baseMedian` is a pre-clamp approximation for the exposure stage, not a prediction of the final preset's median after curves and other controls. State this limitation. An alternative look design can declare an exposure-normalization target before the artistic recipe, but it must not silently replace the meaning of existing saved presets.

For a positive delta, impose a channel-headroom cap:

```text
safeTotalExposure = log2(.98 / max(P99.5(M), epsilon))
positiveAllowance = max(0, safeTotalExposure - E0)
delta = min(candidateExposure - E0, positiveAllowance)
```

Leave a negative requested delta under its own bounded policy. Do not force a negative delta solely because a specular tail is already clipped. Include `E0` in the calculation; applying the cap to the delta alone fails when the preset already has positive exposure.

A percentile cap deliberately ignores a tail and therefore cannot promise zero clipping. Also calculate the fraction of sampled pixels whose **any** linear RGB channel would exceed 1 under the total candidate exposure. Compare it to the same fraction for `E0`. An initial additional-clipping allowance might be 0.1 percentage point; make the chosen allowance explicit and test it. If exceeded, shrink only the proposed positive delta toward zero with a bounded deterministic search. Never equate an already clipped pixel with recoverable detail.

Preserve any existing manual work unless the photographer explicitly chooses to replace it with the selected base look. A proposal result should include source identity/mode, base-recipe identity, analysis version, proposed delta, summaries, and any limiting reasons. Recomputing from the same source/base/intent must return the same proposal. Applying it twice must not stack another automatic correction.

## Native proof and later tonal work

Render baseline and candidate with the actual native operator under the same source mode and geometry. Check the displayed output and per-channel clipping, since temperature, contrast, whites, curves, masks, and film effects can defeat an exposure-only prediction. A bounded fallback to less correction is appropriate; do not silently alter the creative palette to make the histogram look full.

The current preview operator's encoded-luma shift is:

```text
shift = shadows*.0025*(1-luma)^2 + highlights*.0025*luma^2
      + blacks*.0015*(1-luma)^5 + whites*.0015*luma^5
```

This describes FOTO source code, not Adobe's controls. If a later version proposes highlight/shadow changes, these weights explain the local direction, but downstream contrast/clamping and interacting stages make them unsuitable as a full inverse solver. Keep adjustments small and separately bounded, prove them against native output, and leave intentional deep blacks or bright whites alone unless requested. Do not directly transplant “Highlights -50 / Shadows +50” from another renderer.

Grain amount, size, and luminance shaping are stylistic choices. Do not call synthetic grain camera-noise detection or named-film emulation without calibration data and evaluation. Image-specific brightness adaptation and a creative grain envelope can coexist without pretending the latter was measured from film stock.

## Review, provenance, and safety

- Use wording such as **Adapt to this photo** and **Suggested exposure +0.20 EV**, with **Preview-based** when applicable. Do not use “perfect,” “best,” “AI analysis,” or “Lightroom-equivalent” for this deterministic feature.
- Describe measurement limitations rather than inventing a confidence percentage. Tiny, nearly constant, mostly clipped, highly chromatic, backlit, or strongly low/high-key scenes need extra review; a histogram cannot identify the subject or the photographer's intent.
- Preview first; save one labeled, undoable history entry only on Apply. Cancel leaves history and originals unchanged.
- A photo/account/project change, new source attachment, recipe edit, or component unmount invalidates an in-flight proposal. Check source identity and expected document revision again when saving.
- Keep original bytes untouched. Cached statistics are replaceable derived data, not a replacement for originals, saved previews, or recipes.
- An embedded-preview result and a sensor-RAW export may differ. Show the actual RAW export proof before downloading and retain its source-quality label.

## Required regression evidence

| Case                                                        | Expected evidence                                                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Known linear gray, no clipping                              | +1 EV doubles linear intensity within numeric/output quantization tolerance; encoded values do not simply double.                                |
| Saturated red/blue highlight with low luminance             | Channel guard limits brightening even when `Y` is low.                                                                                           |
| Sparse speculars versus a large clipped region              | Existing clipping and additional clipping are reported separately; tail tolerance never becomes a zero-clipping claim.                           |
| Black, white, transparent, flat, tiny, malformed inputs     | Finite bounded result or explicit no-op; no NaN, infinite gain, fabricated samples, or crash.                                                    |
| Portrait, panorama, extreme aspect ratio                    | Both analysis dimensions and sample count stay bounded.                                                                                          |
| Nonzero base EV, repeated adaptation                        | Total-EV guard is correct; same source/base/version is deterministic and does not compound.                                                      |
| Manual recipe and old serialized recipes                    | RGB curves, grading model/global field, grain controls, crop, masks, and unrelated settings survive; schema defaults remain backward-compatible. |
| Native proof with strong curves/whites/temperature/grain    | Output measurements expose approximation limits; no unsupported claim of preservation based only on JavaScript estimates.                        |
| Embedded JPEG versus sensor RAW                             | Provenance is explicit; tests do not assert equal pixels or sensor highlight recovery from preview measurements.                                 |
| Slow analysis, photo/scope change, conflicting save, cancel | Stale result cannot apply; originals, current history, metadata, and revision guards remain intact.                                              |
| Successful Apply and Undo                                   | One persisted history entry; undo restores the exact preceding recipe across reload.                                                             |

Use varied deterministic synthetic fixtures for numerical invariants and consenting real sports/night/portrait/high-key photographs for appearance review. A thousand unit scenarios do not establish a thousand real-camera workflows or subjective image quality. Record each type of evidence separately.

Related: [Develop sprint](FOTO-DEVELOP-SPRINT.md), [future Jobs plan](FOTO-JOBS-PLAN.md).
