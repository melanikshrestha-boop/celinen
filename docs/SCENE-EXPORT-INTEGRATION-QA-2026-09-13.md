# Scene, review and export integration — 2026-09-13

Local checkpoint, not a production publication or a customer-shoot benchmark.
The live LAB source is the ChatGPT checkout on port 8085; the private development
branch is `codex/native-analysis-streaming`. Original camera files, customer
libraries and the user's current shoot were not changed by QA.

## Changes

- Existing shoot menu: **Find scene changes**. Chat can request scene changes or
  outliers. One compact selector intersects the existing Red dots / Keepers
  filter. K/X and Undo remain the decision authority. Suggestions never move,
  reject or delete photographs.
- Native C++ grouping uses compatible preview evidence, folder/camera changes
  and verified capture-time gaps. It is explicitly not semantic subject/location
  recognition. Possible visual outliers are uncertain; exposure or camera movement
  can explain a difference. Expressions and unrelatedness are not proven.
- Ready JPEGs can commit before a stalled RAW, retaining canonical input order.
  See [import queue evidence](IMPORT-QUEUE-QA-2026-09-13.md).
- **Export keepers** freezes the current scene's exact ordered keeper IDs after
  flushing edits. Develop renders their saved native versions for approval, then
  archives exactly those prepared JPEG bytes. Missing sources, stale recipes,
  changed picks, foreign scopes and unavailable native processing fail explicitly.
  No hosted or Canvas fallback substitutes pixels. Current cap: 200 photos and
  100 MiB per native ZIP; larger sets need smaller selections.
- Removed the active local fake-send-gallery shortcut and duplicate export
  callback. Original ZIP remains a separately named menu action and does not
  claim to include Develop edits. No gallery is silently published or sent.

## Browser regressions found and corrected

1. In embedded Studio, `position: static` made the header's z-index ineffective.
   The positioned photo canvas covered the shoot-menu items: a real click on
   Find scene changes timed out and hit-testing found the canvas above it.
   Changing only that header to `position: relative` made the same click pass.
2. The embedded toolbar was nowrap. At 390 px the scene selector began at x=389
   and was clipped. Wrapping the existing toolbar keeps the control inside the
   viewport without adding a panel or changing the surrounding shell.
3. A same-shoot navigation during an awaited export flush left a busy label behind.
   Owner-fenced proof/error handling remains; mounted-view cleanup now clears busy.
   Actual callback regression tests cover stale flush and stale render completion.

## Executed browser proof

Separate Chromium QA profile, six instances of three repository public fixtures,
new shoot `13f09242-677c-4586-bf57-f430453dc93b`. Seed metadata creates three folder
groups, four red undecided frames and two keepers; it is not detector accuracy
ground truth. Original hashes and neutral native history were read back unchanged.

- C++ endpoint returned three ordered groups of two. Selecting scene 3 and
  Red dots showed only its two frames. K then X reduced its red queue to zero;
  two Cmd-Z actions restored both without changing another scene. Pick changes
  retained the scene selector and keyboard focus.
- All scenes restored the two-keeper export action. It opened the existing
  Develop export dialog with precisely seeded IDs ending `:1` and `:3`, despite
  the active photograph being `:4`. Download was unavailable before native proof.
- Both native proofs rendered, then the actual Download ZIP button was clicked.
  The produced `foto-2-native-jpegs.zip` was **4,274,440 bytes**. The exact file
  order, byte lengths, CRCs and SHA-256 hashes matched the displayed proofs:

| Entry                                 |     Bytes | SHA-256                                                            |
| ------------------------------------- | --------: | ------------------------------------------------------------------ |
| `2 · basketball-action-usaf-pd.jpg`   | 1,563,843 | `3a774012a8aeb54232fae8a251a32745a0c5b8efe418307117b796ac8cc800fb` |
| `4 · basketball-hangar-usnavy-pd.jpg` | 2,710,283 | `dd153403da698a70cba825f07daa6408774def4b17877d0bbecbab67b1434336` |

- The Cull button returned to the same shoot at `/shoots/<id>/cull`; the export
  scope did not persist into that route. All six originals and two keeper decisions
  remained available. This proves local download handoff, not recipient delivery.
- Desktop light and 390 × 844 light/dark screenshots were opened and inspected.
  Dark Studio measured document width 390 and selector x=80, right=247: no horizontal
  overflow. Both Red dots and scene selection remain available.
- Browser IndexedDB reload, cancellation and preservation checks are recorded in
  [the import report](IMPORT-QUEUE-QA-2026-09-13.md).

Repro fixtures: [scene seed](../tests/scene-navigation-seed.browser.js),
[proof-byte verification](../tests/develop-scene-export-proof.browser.js),
[storage ordering](../tests/develop-import-order.browser.js). They require an
explicit isolated-profile guard. The proof observer reads already-created Blobs;
it does not weaken CSP or fetch camera files. It restores its observers afterwards.

## Gates and remaining limits

Native scene release and sanitizer suites: **3,535 checks, zero failures**.
Production build and scoped lint passed. The full suite has five known baseline
appearance failures (sidebar metric, connector marks, Develop light chrome,
default appearance, shared typography); these were not hidden by changing the
user's chosen design. See the import report for its recorded full-suite run.
The final toolbar regression also passes. Project-wide TypeScript is not clean;
no new diagnostics were found in the changed import/export helpers.

No valid cold/warm timings, memory measurement, expression accuracy or unrelated
subject accuracy exist for the user's approximately 300 photos yet. The actual
browser connection failed and their exact source folder path is pending. Synthetic
300/10,000 scheduling tests must not be presented as RAW throughput. No 300/400
photos-per-second claim is supported. The existing hourly overnight heartbeat is
retargeted to this work and must not execute older photo-deletion requests.

Git push is not Lovable Publish. This checkpoint does not claim a new live
`lenslab.dev` build, Google sign-in verification, or a hosted C++ service.
