# Release 1: device-local projects

Date: **2026-09-04**. Status: **bounded local beta; documented browser workflows and controlled fault checks verified**. This record describes the tested scope and remaining limits, not production readiness or full-platform completion. Real OS crashes, naturally exhausted storage, two-UI-tab concurrency and large-shoot field performance remain separate gates.

The verified small-project path is a named, client-optional project containing source references, selections, supported edits, frozen proofs, photographer-recorded feedback and a recoverable archive. It keeps the existing visual system. It does **not** provide a signed-in client portal, cloud backup, production RAW development or verified sports intelligence.

## How to run the local beta

Use the existing checkout and its installed dependencies. If dependencies are missing, install from the checked-in Bun lockfile with `bun install --frozen-lockfile` first.

```sh
cd "/Users/melanishrestha/Documents/ChatGPT/New project/intelligent-image-aid"
bun run dev
```

Use the loopback URL printed by Vite. The working session has used `http://localhost:8080`; a busy port can produce a different URL. Browser records belong to the exact origin: `localhost`, `127.0.0.1` and different ports do not share a workspace. Do not clear storage to troubleshoot missing work.

Local mode requires a development build, `VITE_LOCAL_SINGLE_USER="true"`, and a loopback hostname. `src/lib/app-mode.ts` rejects this bypass on a production or LAN hostname. This is a single-user development convenience, not an authentication design. The project workflow needs browser IndexedDB, cryptographic hashing and supported image/canvas decoding. Storage capacity and browser policy can still prevent a save.

### How to save and reopen a project

1. Open `/projects`, select **New project**, enter a name/type/brief and select **Save project**. A client, booking and invoice are optional. Select **Open Studio**, then import a small set of permitted JPEGs.
2. Make keeper decisions and supported edits. Plain-English editing remains a proposal workflow: review the affected images and adjustments before applying. Returning through **Project** saves the current named project before opening its details.
3. Reopen through **Open Studio** and confirm the same images, picks and edits. A named project uses `/studio?project=<project-id>`; legacy `/studio` remains a separate current-shoot workspace.

To preserve an existing legacy shoot, use **Save project** in Studio, enter a name/type and select **Save and open project**. It checks available storage when the browser exposes an estimate, hashes connected originals and previews, and creates a separate project. The legacy snapshot is not deleted. Preview-only frames remain explicitly preview-only; naming a project cannot recreate missing originals.

Do not navigate away during an unfinished import/proposal or assume an in-memory edit has survived a crash. Named-project saves are queued and revision-checked, with a short autosave debounce. Reopening and checking the result is the acceptance test, not the mere presence of a save button.

### How to prepare a local proof and recorded-approval download

1. Choose between **1 and 200 keepers** without import errors in Studio, save, then open the project details.
2. Use **Prepare keepers proof** under **Proof & review · device-local**. This creates a new frozen set of JPEG renditions, at most **1600 pixels on the long edge**, from the current supported edit versions. Preparing another proof does not change an earlier one.
3. Select a proof/image, enter a reviewer label and record a favorite, approval or revision request. The UI and record explicitly say the **photographer recorded** this feedback. It is not evidence that the named person signed in or submitted it.
4. Use **Download recorded approvals**. The ZIP contains approved proof JPEGs and `manifest.json`, identifying the project, proof, frames, exact edit versions, rendered checksums and recorded approvals. Inspect the actual download and pixels.

The latest feedback choice for the exact proof/frame/version determines eligibility. A favorite is not an approval; a later revision request removes that approval from the current download selection. A new proof does not inherit approvals from an older proof. An edit after approval cannot silently replace the approved rendition.

These are bounded proof JPEGs, not guaranteed full-resolution finals or RAW renders. Preview-only sources and embedded RAW previews cannot yield missing source detail. The export path limits the selected proof JPEG payload to **100 MiB** before ZIP packaging. An export event says `download-prepared`; it does not confirm that a browser saved the file, that anyone received it, or that a client downloaded it.

### How to archive and restore

1. In project details, select **Download archive**. The app verifies referenced media before preparing a `.lenspack` containing the project document and its stored originals, previews and proof blobs.
2. Keep the downloaded file outside browser storage. Treat it as private: the package is **not encrypted** and may contain original photos, names, briefs and business reference snapshots. Do not use it as a public gallery link.
3. In a separate supported test origin/profile, choose **Restore archive**. Inspect the proposed frame/original/version/proof counts. Inspection does not write records. Select **Confirm restore**, reopen the project and verify files, edits, decisions and exact-version proofs.

The package is a custom versioned binary container, not a ZIP. It checks the format, manifest, graph relationships, declared lengths, required blobs and SHA-256 bytes before committing. Checksums detect byte changes; they are not a signature proving who created an archive.

Current hard limits are **256 MiB per archive**, **16 MiB for the JSON manifest**, **128 MiB per stored blob/source file** and **20,000 archive blobs**. The project schema separately permits at most 20,000 frames; this is a validation bound, not a verified performance claim. No streaming/split archive or unlimited large-shoot backup is implemented. A typical full-resolution 3,000-image assignment can exceed these limits by orders of magnitude.

Restoring an existing project ID succeeds only when the stored document exactly matches the archive document. A conflicting revision is refused, not merged or overwritten. An identical archive can supply checksum-verified media for that document. There is no automatic rollback to an older document and no project-copy/migration conflict UI in this slice.

### Troubleshooting without discarding work

| Visible failure | Safe next action |
| --- | --- |
| Project is absent | Verify browser profile, hostname and port. Check a known archive; do not clear the original origin's data. |
| Storage unavailable or quota exceeded | Preserve source files and existing browser records. Free unrelated storage only deliberately; use a smaller permitted test set or wait for the native storage path. A storage estimate is not a reservation. |
| Stale project/revision conflict | Stop competing edits, reload the latest record and review changes before retrying. There is no silent last-writer-wins merge. |
| Missing/corrupt media | Preserve the error and originals. Restore a matching verified archive; do not substitute a preview as an original. |
| An older cached preview is sideways | The orientation fix does not rewrite existing cached pixels or frozen proofs. Reimport/regenerate from the original, then prepare a new proof where needed. Preserve old versions; do not claim an existing cached preview was repaired automatically. |
| Archive refused | Check the displayed format/size/integrity/conflict error. An incompatible or oversized package is not partially imported. Do not bypass validation. |
| No approved files | Check the selected proof and latest feedback for each exact version. Favorite and revision are not approval. |

## Model and lifecycle reference

| Record | Identity and behavior |
| --- | --- |
| Project | UUID, schema version, revision, title/type/brief, optional explicit business links, frames and history. Local owner labels (`local-studio`, `local-photographer`) are not authenticated users. |
| Frame/asset | Stable frame ID and asset ID, original filename/type/time, metadata, separate original/preview blob references and current edit version. Matching filenames never establish identity. |
| Original and preview | Present source bytes receive a SHA-256 blob ID. A source-backed initial asset can use `sha256:<hash>`; an unknown source starts `unverified:<id>`. Reconnecting a provisional asset preserves its stable identity/history while adding a verified original. Preview bytes never become source identity merely because they are available. |
| Edit version | Asset, supported adjustments, processor (`lenslabs-canvas-v1`), actor, basis and time. New supported settings append/reuse an identified version; existing history is not rewritten. |
| Decision/activity | Append-only selection changes and project actions. Saved human decisions remain distinct from model suggestions and client feedback. |
| Proof/feedback | Immutable proof item pins frame, asset, edit version and rendered blob. Feedback names that exact proof/version and records its local photographer provenance. |
| Export | Exact proof/version identifiers and `download-prepared` state. No implied publication, payment or delivery receipt. |

`lenslabs-projects-v1` in IndexedDB has separate `projects` and `blobs` stores. Documents and new media commit together in a transaction after validation/hashing. Revision checks reject stale writers. Advancing a project cannot remove existing frames or rewrite preserved original/history records. On open, required media is checked for presence and matching bytes; unreadable state is reported, not silently pruned.

Related business links use explicit IDs. Saving the brief can capture local client, booking, invoice and gallery **reference snapshots** with capture times. They provide context for this project, not a live source of truth. Restoring a project does **not** create/replace CRM contacts, confirm bookings, import financial ledgers, settle invoices, publish galleries or synchronize those other stores. Recheck the actual linked workspace before taking any business action.

### Implementation map

| File | Responsibility |
| --- | --- |
| `src/routes/projects.tsx` | Project list/details, explicit reference capture and inspect/confirm archive restore |
| `src/components/studio/SaveProject.tsx` | Copy an existing Studio snapshot into a named project |
| `src/routes/studio.tsx` | Named-project session integration and existing editor |
| `src/components/projects/ProjectProofs.tsx` | Local proof selection, recorded feedback and download controls |
| `src/lib/projects/model.ts` | Schema, relationship validation and preserved-history rules |
| `src/lib/projects/repository.ts` | IndexedDB transaction, revision and media checks |
| `src/lib/projects/studio-adapter.ts` | Capture/hydrate Studio snapshots and queued project saves |
| `src/lib/projects/proofing.ts` | Frozen JPEG rendering, exact-version feedback and approved download preparation |
| `src/lib/projects/archive.ts` | Bounded, checksummed `.lenspack` read/write |

## Verification record

Run targeted tests from the repository root:

```sh
bun test tests/project-model.test.ts tests/project-archive.test.ts
```

The final 2026-09-04 full-suite run passed **312 tests, with 0 failures and 3,689 assertions across 20 files**. The project tests cover schema/relationship validation, colliding filenames, original/preview identity, source reconnection, immutable history, stale revisions, exact-version relationships and archive corruption/size/format defenses. Browser checks below add actual storage, rendering and download evidence; none establishes production isolation or every hardware/format combination.

Companion verification commands:

```sh
bun test
bunx tsc --noEmit
bun run build
```

| Required check | Verified scope / remaining limits |
| --- | --- |
| Model/archive unit invariants | Full suite: 312 passing tests, 0 failures, 3,689 assertions across 20 files. |
| Create/import/edit/save/reopen through rendered UI | Passed the small named-project path in isolated Chromium: three real fixtures, three manual keepers, two applied edit changes, two frozen proofs and saved/reopened project records. This is workflow evidence, not a formal pixel-by-pixel layout comparison. |
| Legacy Studio → named project without losing the legacy shoot | Passed the actual Save project dialog using one volleyball original in a confirmed-empty isolated legacy workspace. `QA copied legacy photo` reopened with the original available and an upright 960 × 1280 review; reopening legacy Studio still showed its unchanged one-frame preview. |
| Real permitted photographs and colliding names | Three licensed fixtures under `tests/fixtures/photos` were used end to end, totaling 7,355,315 original bytes. Colliding filenames are covered by model tests; a real multi-camera field assignment remains unverified. |
| Proof pixels, orientation and exact-version approval | Downloaded color portrait was upright at 1200 × 1600; its SHA-256 matched the manifest. After a new black-and-white edit/proof, the old color approval stayed bound to the old version and the new proof had zero inherited approvals. Broader crop/color/format coverage remains open. |
| Clean-origin archive restore and checksum equality | UI-generated 9,510,757-byte archive restored through Inspect/Confirm from `localhost` to an empty `127.0.0.1` origin. Revision 18, all three original hashes, five edit versions, six decisions, two proofs and two feedback events were preserved. Preview-only browser restore remains a separate case. |
| Controlled transaction failure, corruption, stale writer and restore conflict | Passed in browser IndexedDB: identical restore unchanged; corrupted archive and missing media rejected; injected quota exception rolled back queued media and document writes; stale commit and conflicting older archive rejected without replacing newer work. Details below. Real OS crash, natural quota exhaustion and two simultaneous UI tabs remain untested. |
| Typecheck, scoped lint, production build and whitespace checks | All passed, alongside the full suite. Build still reports legacy `inputValidator` deprecation and bundling warnings. No whole-repo lint pass claimed and no deployment performed. |
| Fresh runtime console | No errors; canvas readback performance warnings remain. This does not establish a performance budget. |
| Large-shoot latency and memory | Not established by these tests. Record machine/browser, format, dimensions, real source bytes and first-useful-preview/export timings separately |

Reproduce the controlled checks using [the local recovery QA guide](../../scripts/qa/README.md). Its failure-injection script is deliberately restricted to an isolated QA project/origin and is not for a user's working shoot.

### Observed browser and downloaded-file evidence

The isolated Chromium run created a named QA project and imported three licensed photographs. All three were manually marked keepers. Applying brighter/warmer adjustments to the portrait brought the project to four edit versions; applying black-and-white later brought it to five. Two offline feedback events were recorded in order, favorite then approve. They remain photographer-entered test feedback, not remote client activity.

The recorded-approval ZIP was **667,442 bytes**. Its color portrait JPEG was **666,023 bytes**, **1200 × 1600**, visually upright, and its measured SHA-256 was:

```text
711a5e1f91631a73efdacb8f28fedeca26748b721a93238614b23a268661b278
```

That hash matched the ZIP manifest. The later black-and-white proof neither replaced the approved color file nor inherited its approval. The clean-origin restore retained the exact revision and relationships listed above; it did not rely on the destination already having project media.

Testing found and corrected a double-rotation issue: the tested browser's native decode ignored `imageOrientation: "none"`, so the previous manual orientation step rotated an already oriented image again. The corrected fixture decoded at **3000 × 4000**, with an upright **960 × 1280** review image and the upright exported proof described above. Source-backed rendering/export now uses the corrected path for this tested case. Existing sideways cached previews or old frozen proofs are not automatically regenerated; reimport/regeneration from originals is still required.

The development run also led to fixes for a hot-reload session-controller issue, duplicate checkpoint ordering and unsafe-integer revisions. A separate Save project dialog run verified that copying the single volleyball source into a named project did not remove or replace the legacy workspace's one-frame preview. The fresh runtime console had no errors; canvas readback performance warnings remained.

### Controlled browser storage failures

All of the following checks passed in the isolated browser QA workspace:

- Repeating an identical archive restore left the stored document unchanged.
- A corrupted archive payload byte was rejected; missing referenced media was rejected.
- Injecting a `DOMException` named `QuotaExceededError` at `projects.put`, **after a media addition had been queued**, aborted the full transaction. The before/after project and blob key sets were identical, so no partial media addition remained.
- A stale-revision commit was rejected.
- Restoring an older, conflicting archive was rejected, and the newer document remained unchanged.

The quota check was a controlled IndexedDB exception simulation, **not** actual disk exhaustion or an OS/browser crash. The stale-writer check exercised the storage boundary, **not** two users interacting in simultaneous UI tabs. These remaining scenarios, larger workloads and other browsers still need dedicated testing. The real-photograph workflow covers three fixtures on one tested browser, not 3,000 real-image throughput, every camera format or sports-selection accuracy.

Do not replace these concrete scenarios with an arbitrary task-completion percentage. Future sports evaluation must separately measure keeper recall, selection precision, important-moment/subject coverage and correction time against photographer-labeled real shoots.

## Gates beyond this local release

- **Real client portal:** authenticated identities, project/file-level authorization, exact-version remote feedback, expiring/revocable grants and two-account adversarial tests. Route hiding and `noindex` are not security boundaries.
- **Money and communication:** separately configured SaaS billing versus photographer revenue; verified provider accounts, stable idempotency, duplicate/out-of-order event reconciliation, exact ledgers, authorized recipients and no fake sent/paid states.
- **Production image processing:** licensed decoder and rendering pipeline, supported camera/mode fixtures, color/orientation/metadata round trips and native storage/reconnect tests. LibRaw is not itself a complete finished-photo renderer.
- **Sports intelligence:** permitted commercial data/model rights, evaluated still-photo subject/action/jersey behavior and visible uncertainty. A general sharpness/similarity baseline does not establish athlete focus, peak action or commercial dataset rights.
- **Durable backup and team work:** off-device copies with tested restoration/retention, larger streaming workloads, access-aware sync and visible conflicts. Local cache and archive download preparation alone are not verified backup.

See [the product plan](PRODUCT-PLAN.md) for the thirteen-category replacement matrix and phased full vision, and [provider boundaries](PROVIDER-BOUNDARIES.md) for dated official sources and cost assumptions. No bounded local result justifies canceling an incumbent service automatically.
