# Sports culling foundation — 2026-09-04

## Current local checkpoint — 2026-09-13

The September 4 sections below are historical measurements and workflow notes,
not current performance guarantees. The current scoped changes are documented
in [Culling and preset verification](CULLING-PRESET-QA-2026-09-13.md).

Canonical shoot import now reserves a native worker before uploading source
bytes, reuses its JPEG preview and actual mechanical measurements, and persists
source/account/shoot-bound analysis receipts with the photo document. `Analyzed`
advances only after the storage acknowledgement; preview availability alone
does not count. Valid receipts survive reopening Cull and avoid needless repeat
analysis. Failed native jobs remain explicit; the existing Develop fallback is
used only when native analysis is unavailable. Full RAW Develop/export remains
a separate source-rendering path.

CLI decode/analysis staging holds bounded permits through the queue and receipt
delivery. The worker reuses its existing source properties for capture metadata.
See [native measurements](../native/ANALYSIS-PERFORMANCE.md) for the measured
benefit, exact commands and limits. ImageIO decoding remains the dominant cost;
none of the repeated-fixture rates below or in that report establishes a
representative-shoot target.

A trained Core ML shared encoder with quality/action heads and embeddings,
conditional second-pass analysis, learned sequence ranking and athlete identity
are **not delivered** by this checkpoint. A representative 10,000-RAW shoot
completed and ranked in at most 25 seconds remains unverified. Missing neural
capabilities are not replaced with invented outputs, confident automatic rejects
or a claim that focus/exposure/hash heuristics understand sporting action.

## Interface contract

Preserve the Lovable presentation from commit `980d276`. The homepage, navigation,
Studio layout, Delivery cards and Earnings tables remain the existing design.
Local development on loopback skips signup; production authentication is unchanged.
No deployment or scheduled release is configured by this change.

## Working pipeline

- Decode and score in up to four local workers, with at most two RAW files active.
- Use embedded RAW JPEG previews; this is not a full RAW development engine.
- Display completed previews during ingest; keep/reject and navigation work immediately.
- Match reconnects by stable path/size/mtime and preserve decisions and edits.
- Match XMP sidecars by directory and basename, avoiding cross-card filename collisions.
- Index 64-bit image hashes for duplicate suggestions. Keep highest-score representatives
  with stable ties; direct-match grouping avoids transitive collapse across a changing burst.
- Cancel import without discarding displayed frames; originals are never changed.
- Persist previews and decisions locally, support undo, reconnect originals before export.

The current quality ranking is focus/exposure/hash heuristics, with optional browser
FaceDetector measurements. It is not a trained sports-action model. Missing face
detection stays unavailable. Similarity flags are suggestions, not proof that two
action frames are interchangeable. Manual review is required.

## Verification

`bun test` (209 tests), `npx tsc --noEmit`, scoped ESLint, and `bun run build` passed.
Build retains existing dependency deprecation/chunk-size warnings.

Earlier foundation checks in headless Chromium, local development build, synthetic fixtures:

| Check | Result |
| --- | --- |
| 300 JPEG files, 1280 × 720, twelve repeating synthetic patterns | 0.8 s import, reported 356 files/s |
| First preview observed in DOM | 73 ms |
| Largest 30 ms test-heartbeat interval during import | 48 ms |
| Manual pick while ingesting | Preserved through completion and reload |
| Offline keep top 12, then undo | 12 keepers, then original 1 keeper restored |
| Actual worker vs main-thread analysis, same synthetic image | Identical hash, sharpness and brightness |
| Browser face detector | Unavailable; no inferred eye checks |
| Local gallery draft; local invoice draft | Created; invoice displayed exact $12.34; neither shared nor sent |

Hash-stage benchmark: `bun scripts/benchmark-culling.ts`. Five-trial median,
Bun 1.3.14. On 5,000 synthetic burst hashes: indexed 16.54 ms, brute-force
rank-first baseline 1,952.58 ms. On 5,000 diverse hashes: 17.30 ms vs 7,337.39 ms.
The brute-force baseline uses the same rank-first grouping semantics for a fair
index comparison; grouping intentionally differs from the old all-pairs flagging.
These are synthetic stage measurements, not RAW throughput, action-recognition
accuracy, comparative product benchmarks, or evidence of world-fastest performance.

The subsequent plain-English/review release added viewport-windowed thumbnails,
before/after proposals, explicit scope and acceptance, and stale-proposal protection.
On a stable development build, 3,000 synthetic 1280 × 720 JPEGs (twelve repeating
patterns) imported in 3.64 seconds: first DOM preview 72 ms, largest 30 ms heartbeat
interval 47 ms, 66 mounted thumbnails at the tested desktop width. All 3,000 saved;
the manual keeper, last-frame selection and previews survived reload. Applying a
whole-shoot warmth proposal saved 3,000 edited records; undo restored the prior
per-frame edits. Cull acceptance changed 2,999 undecided frames, preserved the manual
keeper, and undo restored the earlier decisions. A development Fast Refresh lifecycle
issue found during the first run was fixed and rechecked separately.

This is a synthetic browser stress test, not a photo-selection accuracy result.
Full-shoot preview blobs still reside in browser memory/storage. Real camera RAWs,
memory pressure, representative sporting moments and long-running imports require
separate validation. See [the workflow contract](./PLAIN-ENGLISH-WORKFLOW.md).

## Reference and next validation

The live https://lenslab.dev landing page and signup form match this repository's
Lovable design. Signup exposes Google, email/password and magic-link entry.
The protected signed-in flow has not been validated in an authenticated account.

Photo Mechanic reference: https://home.camerabits.com/tour-photo-mechanic/ —
review thumbnails while ingest is still running; keyboard-first selection.
Imagen reference: https://imagen-ai.com/culling/ — grouping and suggested selections,
followed by photographer review. These are workflow references, not parity claims.

Before a public sports-culling claim: benchmark consenting, representative RAW/JPEG
shoots across cameras and machines; label blur, ball/athlete visibility, key action,
faces and duplicate bursts; measure keeper recall and time-to-first-review. A trained
sports model, athlete/jersey identification and authenticated cloud workflows remain
separate implementation work. Cloud delivery/payment actions are intentionally
unavailable in local-only drafts.
