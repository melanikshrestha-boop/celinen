# Local MVP checkpoint: shortlist, approve, reopen, exact export

Date: 2026-09-13. Builds on private checkpoint `6c6f2b6`; this report is local LAB evidence, not a production publication or an end-to-end RAW speed claim.

## User-facing path

Keep the current application design. In an imported shoot, open **Shoot actions → Ask celinen**, then enter `shortlist 40 photos`. The C++ service proposes a requested-count set using available mechanical quality and uncertain sequence groups. Existing K/X choices stay; missing evidence, review holds and suspicious quality stay for review. Underexposure alone is not a reject. Unchosen frames are not rejected. No picks change before **Accept suggestions**.

After reviewing, `prepare 20 press photos` opens the first 20 already-kept frames in the current scene scope in full Develop. If fewer are available, say so and carry only those frames. This does not automatically download, publish, or send. Review **Preview export set**, then explicitly download the native JPEG ZIP. Exact IDs/order/version scope is carried into the export; no latest-version substitution.

On the dashboard-hosted Pick page, the existing assistant was previously not rendered at all. It is now accessible from the existing actions menu in a persistent, themed chat dialog. The older Workbench path uses its existing Quick Chat. No app shell, photo desk, typography system or native desktop interface was replaced. Escape closes chat without discarding its draft or pending approval; culling keyboard shortcuts do not pass through dialog controls.

## Reproduced failures and fixes

1. Restoring a shoot called the first import-cull pass without an explicit ID set, silently turning old undecided photos into keeps. A fresh public fixture reproduced it before implementation. Hydration now admits no verdict candidates. New imports use a source-bound admission queue; manual K/X/U, undo, cancellation and owner/source changes invalidate queued decisions. A failed old analysis cannot leave a newly admitted photo permanently waiting: overlapping requests get one guarded follow-up, not a failure retry loop.
2. A passive second tab read the import journal once, showed interrupted progress, and never followed durable completion. Read-only observers now coalesce journal notifications, fence stale reads/revisions/accounts and follow the next job. They do not become owners or cancel another tab. Nonterminal stored activity is explicitly unverified, not asserted live.
3. Deadline text parsing preserved a count but the real route ignored it and opened the selected photo. The requested already-kept subset now reaches the canonical export-scope write through the actual callback chain.
4. Showing dashboard chat exposed a keyboard boundary bug: X/K/arrows/Space on dialog buttons affected the photo behind it. Fail-first tests extract the actual handler. Native and ARIA dialog/menu targets now stop those photo shortcuts.

## Actual isolated browser run

Only fresh synthetic libraries and repository public JPEG fixtures were used. Customer libraries, the current 300-photo shoot, original disk files and cloud libraries were not modified or uploaded for QA.

- QA shoot: `aef383e0-2922-493d-9e71-2b92038bc4bd`, six fixture instances of three public JPEGs. Native analysis and source SHA-256 checks are real; folder names, review labels and initial picks are seeded test data.
- Before the request: two keeps, one reject, one manual red review hold, two undecided. Fresh route restore kept these unchanged.
- Typed `shortlist 3 photos` in the visible current-shoot chat. Native candidate was frame 0; existing keeps were 1 and 3. Red-held frame 5 stayed for review. The displayed proposal affected exactly one frame; durable picks were unchanged before approval.
- With chat Close focused, pressing X did not reject the underlying frame. Accepted the displayed proposal, then reloaded. Saved result: keeps 0/1/3, reject 4, undecided 2/5 with frame 5's red label intact. All six original hashes, IDs, order and one-entry Original histories remained unchanged.
- At 390×844, light and dark chat fit the viewport without horizontal overflow. Escape/reopen preserved the draft `prepare 1 press photos` and returned focus to the textarea. Existing menu, desktop and approval interactions were also exercised.
- Typed that deadline request after reload. Develop opened with a one-frame explicit export scope, not all three keepers. Requested actual native set preview; downloaded the real ZIP and compared the entry to the displayed native proof.
- ZIP `foto-1-native-jpegs.zip`: **1,564,009 bytes**, exactly one entry. JPEG `1 · basketball-action-usaf-pd.jpg`: **1,563,843 bytes**, 2256×1420, SHA-256 `3a774012a8aeb54232fae8a251a32745a0c5b8efe418307117b796ac8cc800fb`. Ordered ID `qa-scene:aef383e0-2922-493d-9e71-2b92038bc4bd:0`. Native proof bytes, filename, order and ZIP CRC matched. Blob observation respected CSP and restored its temporary hooks.

Reproduction helpers: `tests/scene-navigation-seed.browser.js`, `tests/studio-shortlist.browser.js`, `tests/develop-scene-export-proof.browser.js` (shortlist-deadline mode). These enforce the isolated LAB profile and exact new fixture markers; they are not customer-library scripts.

### Two-tab durable import report

`tests/develop-import-observer.browser.js` created UUID-namespaced synthetic database `foto-import-observer-qa:12b0826e-2905-4d02-9a96-ce8830dac794`. Tab B observed saved 1 of 2 while A's RAW-named synthetic input was gated, could not cancel A, then followed A's complete 2 of 2 without manual restore. B then followed a different one-photo job and passed again after full reload. All three original synthetic byte hashes matched; observer timings remained unknown. This checks real IndexedDB/BroadcastChannel behavior, not a real RAW decoder.

## Regression and performance gates

- Full Bun: **2,562 passed, 21 skipped, 1 todo, 5 failed**, 456,945 assertions across 254 files (41.95 s). The five failures are the known compact-sidebar, connector-marks, Develop-light-chrome, default-dark and shared-typography assertions. No additional failures. Final focused rerun: **117 passed / 580 assertions**, including the actual route callbacks, native protocol, observer, restored/admitted picks, keyboard access, command safety and deadline scope.
- Native `make test`: all 16 test executables passed, including 29 shortlist checks. Optional external RAW fixture checks skipped because those fixtures were unavailable.
- New shortlist AddressSanitizer/UndefinedBehaviorSanitizer: 29 checks passed, no sanitizer diagnostics.
- Production build passed. Existing code-splitting/chunk-size warnings remain. Whole-project typecheck has pre-existing errors; do not claim a clean whole-project typecheck.
- [Metadata-only native benchmark](../native/SHORTLIST-BENCHMARK.md): 337/1,000/10,000 synthetic receipts, one first plus five repeat fresh-process invocations per size. Repeat medians 2.511/6.215/59.898 ms on Apple M3 Pro, 18 GiB. Includes process launch, native parsing/grouping/selection and output; no pixel reads, uploads, persistence, network or image analysis. No controlled cold-cache trial or persistent-worker trial was performed.

## Still not established / next gates

- Obtain the exact original roughly 300-photo source folder before repeated read-only full RAW trials. Separately measure drop-to-registration, first/all previews, analysis, durable completion, memory and responsiveness, with cold/warm conditions documented. Synthetic fixtures must not stand in for this.
- Semantic out-of-shoot content, subject/location changes, expression quality and peak sports action remain unproven. Measured sequence/scene suggestions are only navigation aids. No trained semantic model or perfect keeper selection is claimed.
- Hosted native processing, production Google sign-in, live Stripe checkout, client delivery/recipient readback and Lovable publication still need their own owner-connected gates. A local JPEG ZIP is not a completed client delivery.
- Existing dashboard and Workbench shells remain distinct. This change repairs the current-shoot chat access and canonical export handoff without redesigning Melani's approved interfaces.
- Push only validated files to the existing private branch; do not stage `.env.development`, customer originals, build-baseline or sanitizer artifacts. Do not rewrite main. Git push does not publish `lenslab.dev`.

## Overnight follow-up: durable refresh must not abandon new-photo culling

Reproduced another integration defect after `bc8d55a`: a JPEG could save while a RAW was still processing, but the final full catalog read produced a new JavaScript File handle for that same original. Studio correctly treats a changed handle as a stale analysis/admission boundary, so this accidentally removed the newly imported JPEG from automatic culling. A terminal RAW failure is one reproducible trigger because it adds no photo receipt and therefore takes the full-read path.

The fix is confined to Cull's canonical File cache. It reuses a verified full-SHA original across IndexedDB handle clones only when namespace, photo ID, creation time, source availability, source metadata and File metadata still match. Preview-only, missing-source and unverified legacy records do not get this shortcut. Studio's exact-File asynchronous fence, source/account guards and manual K/X/U invalidation remain unchanged. This relies on canonical imports' verified identities and the store's immutable-original contract; it is not a new rehash of potentially corrupted database content on every read. No UI or C++ processing behavior changed.

Evidence:

- Fail-first unit reproduction: equivalent full-read File handles failed reference equality before the change. Added identity, availability, metadata, recreation and namespace negative cases.
- Eight integration cases execute the actual Studio callbacks with the actual import session, repository and a structured-clone transaction double. A held RAW fails after the JPEG saves; automatic admission survives the final full read, manual K/X/U wins, and changed owner/digest/File/availability invalidates. No unnecessary second decode; originals, order, history and existing analysis remain unchanged.
- Real isolated Chromium/IndexedDB reproduction in `tests/cull-source-refresh.browser.js`: baseline run `2d3981eb-2e00-4552-bac4-1646cb724a51` failed at the first retained-handle assertion. After the local patch and reload, fresh run `744150aa-9ba1-4af4-b11f-59eff65c70d0` passed all **19 checks**, including three full rereads, analysis admission, save/reopen, exact ID/order/history and reverified original SHA-256. Both used tiny explicitly synthetic bytes in UUID-named QA databases, not customer libraries or a RAW throughput benchmark.
- Full regression: **2,573 passed, 21 skipped, 1 todo, the same 5 known appearance failures**, 457,112 assertions across 255 files (78.75 s). Production build and scoped ESLint passed. Independent source-safety review found no blocker.

The local `8085` module is updated. This is a local recovery fix, not proof of production publication, semantic culling accuracy, or the requested real 300-photo import speed.
