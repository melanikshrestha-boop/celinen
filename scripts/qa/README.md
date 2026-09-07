# How to check local project recovery

These are bounded regression checks for device-local projects, not a general benchmark, sports-culling accuracy evaluation, or proof of 3,000-photo throughput. The original failure-injection body passed in isolated Chromium on 2026-09-04. See the [release evidence and limits](../../docs/product/RELEASE-1.md) and [fixture provenance](../../tests/fixtures/photos/README.md).

## Safety and setup

Use a separate disposable QA browser profile, with no user shoots, on the development app's **`127.0.0.1` origin**. The script rejects other hostnames but cannot verify profile isolation. Never rename a user project to satisfy its guard. Do not clear the user's browser storage or run unrelated saves while fault injection is active.

Start the existing development server if needed:

```sh
bun run dev
```

Use the actual printed port. Development local-single-user mode must be enabled as described in the release guide. `localhost`, `127.0.0.1`, and different ports have separate storage. Keep source fixtures unchanged; save exports into a separate QA output directory.

## Manual UI workflow with real fixtures

1. Open `/projects`, choose **New project**, and create exactly **QA real photo project — R1**, without a client or invoice. Open its Studio and import the three JPEGs in `tests/fixtures/photos/`.
2. Mark the three frames as keepers. Preview and apply a supported plain-English edit to the volleyball portrait, then return through **Project**. Reopen Studio and verify the persisted picks and edits. Inspect the portrait visually for upright orientation.
3. Choose **Prepare keepers proof**. Record a favorite and then approval on the portrait using a clearly marked QA reviewer label. Download recorded approvals and inspect the actual ZIP: decode the JPEG, check its orientation and dimensions, and compare its SHA-256 to `manifest.json`. These are photographer-recorded choices, not authenticated client actions.
4. Change the portrait to black-and-white, save, and prepare another proof. Confirm the old proof remains color and approved, while the new proof has its own version and no inherited approval. Switch between proof sets and inspect their exact-version labels and feedback history.
5. Choose **Download archive**. In an empty, separate QA origin/profile, select **Restore archive**, inspect its counts, then **Confirm restore**. Reopen and compare original hashes, current edits, immutable versions, decisions, proofs and feedback. For the script below, the restored destination must be `127.0.0.1` and retain the exact QA title above. Do not clear the source origin to simulate recovery.

## Run the browser failure checks

Use your installed gstack browse binary and target the isolated QA tab. On this machine it is:

```sh
QA_BROWSE="/Users/melanishrestha/.claude/skills/gstack/browse/dist/browse"
"$QA_BROWSE" url
```

Verify the returned URL belongs to the intended `127.0.0.1` development tab and that the QA project has real imported/restored media. Run from the repository root:

```sh
"$QA_BROWSE" eval scripts/qa/project-failures.browser.js
```

The file is an **async browser eval body**, including a top-level `return`; do not run it as a Node module or a Bun test. It intentionally appends `QA competing writer checkpoint.` to the fixture's brief and adds activity, advancing the project revision. Every rerun adds another checkpoint. It temporarily overrides the IndexedDB document-write method and restores it in `finally`.

A passing result returns three `true` flags (`idempotentRestore`, `transactionLeftNoPartialRecords`, `newerWorkUnchanged`) and five rejection messages for corrupted archive bytes, missing media, injected quota failure, stale writers and conflicting restore. Verify all three flags are `true` and all five strings explain the intended failure. Any thrown error fails the check.

The checks cover identical restore, an in-memory corrupted archive, missing-media rejection, transaction rollback when a quota error is injected after media writes are queued, stale revisions, conflicting restore, and preservation of the newer document. Injection is not actual disk exhaustion, an OS crash test, or multi-device concurrency testing. The tiny synthetic `.bin` source is only for storage-failure testing; it is not used as photographic or performance evidence.

## Troubleshooting and companion tests

- **Recovery QA origin only / QA project missing:** stop and check profile, hostname, port and exact project title. Do not weaken the guard or substitute a real shoot.
- **Missing/corrupt media or unexpected rejection:** retain the error and current state. Restore the QA fixture from a verified archive in a fresh isolated profile before retrying; do not bypass checksum validation.
- **Unexpected partial records or overwritten newer work:** treat it as a regression. Preserve the result and reproduce only in QA. Do not run the script against more projects.

Pure unit checks do not exercise browser IndexedDB, pixels or download behavior:

```sh
bun test tests/project-model.test.ts tests/project-archive.test.ts tests/project-studio-adapter.test.ts tests/project-proofing.test.ts
```

Record the browser/version, actual origin, fixture counts, returned result, downloaded-file checks and any failures with each manual run. Do not turn these scenarios into an arbitrary completion percentage.
