# Import queue checkpoint: 2026-09-13

Ready photos now save while an earlier RAW preview is still pending, without
changing the shoot's final input order. This checkpoint proves scheduling and
storage behavior with synthetic files. It does not measure the user's roughly
300-photo shoot, RAW decoding speed, or hosted performance. That benchmark still
needs the user's exact folder path and permission to process it.

## Root cause and red/green evidence

Previously, input-ordered saves retained every prepared-preview slot until the
earliest file committed. With four preparation slots, a gated first RAW left
three JPEG previews ready, zero saves, and no capacity to start another preview.

[develop-import-ordering.test.ts](../tests/develop-import-ordering.test.ts)
reproduces the failure with one gated RAW and 299 independent JPEG-named files:

| Observation before releasing RAW                    | Before | After |
| --------------------------------------------------- | -----: | ----: |
| Later photos durably acknowledged by the test store |      0 |   299 |
| Final imported photos after releasing RAW           |    300 |   300 |
| Final report retains exact input order              |    Yes |   Yes |

The new compact-index regression also failed before its repair: committing one
photo read the entire 1,000-row journal. It now reads only the active admission,
that photo's registered row, and its immutable source/order binding. A later
insertion also reads its specific anchor. The shoot manifest still carries the
full ordered ID list; this is not a claim of constant-time storage overall.

## Ordering and persistence contract

- [import.ts](../src/lib/develop/import.ts) commits ready results through one
  writer. Identity claims still advance in input order. Duplicate success waits
  for the winning source's durable acknowledgment, not successful preparation.
- Each ordered write binds version, exact account/shoot namespace, job ID,
  photo-only ordinal, full SHA-256 photo ID and source digest. Storage atomically
  saves the original, preview, document, immutable binding and manifest insertion.
  A verified later ordinal from the same job supplies the insertion anchor.
- [store.ts](../src/lib/develop/store.ts) maintains a compact owner header and
  per-row admission index in the existing `importJobs` store. The existing
  revision-checked journal transaction updates these records together, indexing
  changed rows. Completed-journal immutability remains intact. Old journal
  formats remain readable and acquire the derived index through the guarded
  save path; no database-version migration or existing-photo renumbering occurs.
- [import-session.ts](../src/lib/develop/import-session.ts) durably admits the
  processing phase before ordered writes. Distinct supported file handles must
  match registered photo-only ordinals. Changed final discovery order pauses
  before source reads. Sidecars, unsupported files and repeated handles cannot
  shift those ordinals; same filenames in different folders remain distinct.
- Existing-photo enrichment preserves history, picks and prior order. It cannot
  become a new-job insertion anchor. Cull and Develop consume canonical manifest
  order instead of receipt-completion order. No existing duplicates are deleted.

Heavy preparation remains bounded to four active/ready/committing previews,
including at most two active RAW preparations, with at most four fingerprint
reads and one writer. Ready selection uses a queue; anchor lookup uses binary
search. Lightweight handles, identity claims and ordering metadata scale with
the batch, subject to the existing 50,000-row and 8 MiB journal limits.

Stop drains noncancellable work and retains completed transactions. Quota or
transaction failure stops further saves without claiming duplicates for an
unacknowledged winner. Namespace, source, anchor and stale-owner failures reject
atomically. The original drop-event timing origin remains unchanged.

## Verification

Final focused regression run: **277 pass, 0 fail, 75,592 assertions**, 26 files.
It covers cancellation, failed-winner duplicate counts, earliest retry/sidecars,
actual folder-collector ordinal agreement, malformed discovery order, journal
CAS, old-journal indexing, atomic rollback, virtual copies, missing originals,
and incremental Cull order with preserved picks/history/selection/filter.
The store unit tests use an isolated transaction double, not browser IndexedDB.

```sh
bun --no-env-file test tests/develop-import*.test.ts tests/develop-store.test.ts tests/shoot-repository.test.ts tests/drop-import*.test.ts tests/develop-reconnect*.test.ts tests/cull*.test.ts
```

Scoped ESLint and `git diff --check` passed. No TypeScript diagnostics were found
in the three changed import/store files; the project-wide typecheck is not clean.
The integration owner's final full-suite result was **2,512 pass, 21 skip,
1 todo, 5 known baseline appearance failures**. Those failures were not hidden
by changing the user's design or weakening the assertions.

A separate 10,000-file scheduler smoke saved 9,999 before RAW release and returned
all 10,000 in exact order. Its approximately 592 ms pre-release duration used tiny
synthetic bytes, mocked previews and mocked acknowledgments. It is not a camera
decode, IndexedDB, end-to-end import, or photos-per-second benchmark.

## Real Chromium / IndexedDB verification

The integration owner ran
[develop-import-order.browser.js](../tests/develop-import-order.browser.js)
in an isolated Chromium profile at `http://127.0.0.1:8085`. Final run:
`5de84b3c-8472-43b3-b08d-1c3888b5763b`, database
`foto-import-order-qa:5de84b3c-8472-43b3-b08d-1c3888b5763b`.

- Twelve JPEG-named synthetic originals were both durable and acknowledged while
  the RAW-named synthetic original remained gated. Previews were tiny generated
  JPEGs; no camera decoder or customer source was involved.
- A Keep decision saved while RAW was pending. After release, all 13 exact
  SHA-256 IDs, input order and original bytes matched; history, pick, selection
  and filter remained intact.
- Cancellation in a separate owner/namespace drained and retained exactly one
  acknowledged original without changing the first shoot.
- A real page reload reopened the same isolated database and passed **22 checks**.
  Test databases were retained; the fixture performs no customer-data cleanup.

Related: [native preview/analysis checkpoint](CULLING-PRESET-QA-2026-09-13.md)
and [scene-navigation checkpoint](SCENE-NAVIGATION-QA-2026-09-13.md). These checks
do not establish unrelated-subject recognition, scene accuracy, or performance
on the user's pending 300-photo folder.
