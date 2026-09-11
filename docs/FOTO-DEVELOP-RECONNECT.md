# Reviewed original reconnection

## Available in Develop

Choose **Reconnect** when this library has missing originals, then **Choose Photos** or
**Choose Folder**. A read-only scan checks exact original filenames and saved full-byte
fingerprints. Only unique verified matches start selected. Legacy filename-only matches
require individual approval; ambiguous, mismatched and unknown-format fingerprints cannot
be silently attached.

The review is bounded to 10,000 files and 10,000 targets, with 40 visible match rows per page.
Unsupported/unreadable files are individually reported. Matching does not mean a corrupt
file can decode: every selected original must produce an actual native preview first.
Cancelling a scan invalidates all partial matches. Stopping attachment preserves completed
transactions and reports partial success; it does not pretend to roll them back.

## Safety and processing

The executor is sequential. It rereads only the current target photo/document pair before
decoding, then attaches media atomically only if the scan-time filename/fingerprint are
unchanged and the original is still absent. The transaction preserves existing IDs, display
names, treatments, revisions, ratings, snapshots and history. A file decode error allows the
next selected original to continue; a storage/identity conflict stops the batch.

Single-file reconnect uses the same compare-and-save guard. This fixes a demonstrated race
where a second writer could restore an unknown-fingerprint original while the stale first
writer subsequently filled its missing preview from different bytes.

Preview generation uses the existing native C++ pipeline at 1,600 pixels, with the existing
RAW fallback. This is not a new camera decoder or a claim of sensor-level histogram parity.
The editor's full-quality render lane is paused during reconnection, then resumes from
the saved original. Exact committed receipts are adopted immediately, including a commit
which completes just before cancellation.

## Verified September 8, 2026

- Main working-tree regression: **1,779 passed, 21 skipped, 1 TODO, 0 failed; 361,877 assertions**.
  The first sandboxed run could not open six temporary loopback test servers; the authorized
  rerun passed. The TODO remains the versioned RAW white-balance continuity model.
- TypeScript, scoped ESLint and production build passed.
- Isolated Git candidate: **74 focused tests passed, 64,837 assertions**, including 43
  actual-dialog-handler lifecycle checks. Candidate TypeScript, scoped lint and build passed.
- Actual browser/native/IndexedDB QA used only reserved synthetic libraries 101 and 102.
  Scanning preserved all 337 synthetic histories. A valid image after a corrupt image
  reconnected; only the two selected decodable files were attached. Filename-only,
  ambiguous, mismatched and not-found entries remained unchanged.
- A 22,933,504-byte public Sony ARW passed the actual file chooser and retained SHA-256
  `cbbd0930c7d8706dff84c68a2004454266e6fd0d8354f5f76a106b5d776e0223`.
  JPEG/PNG original hashes and all 337 edit documents also remained exact.
- Actual folder chooser scanned 261 fixture-directory entries, selected no replacements,
  and skipped the three connected originals. Non-photo entries were reported as warnings.
- Real IndexedDB race checks: stale attachment rejected; exactly one of two concurrent
  attachments committed; source/preview stayed paired; abort after durable commit still
  returned its receipt; all documents stayed unchanged.
- Reload displayed three real previews, three histogram channels, enabled Export and the
  saved +0.5 EV. Desktop and 390×844 mobile dialog screenshots were inspected.
- After exact-key/hash/history audit, **340 synthetic photo records and their 340 documents**
  were removed from the two QA namespaces; empty readback passed. The customer's 337-record
  library and latest shoot were never accessed by these tests. Fixtures are reproducible.

Evidence: `tests/develop-batch-reconnect.browser.js`,
`tests/develop-batch-reconnect-races.browser.js`,
`tests/develop-batch-reconnect-cleanup.browser.js`, and the focused reconnect tests.
Screenshots: `/private/tmp/foto-batch-review-desktop.png`,
`/private/tmp/foto-batch-reconnect-mobile.png`.
Reports: `/private/tmp/foto-reconnect-full-suite-verified.log`,
`/private/tmp/foto-reconnect-candidate-tests.log`.

## Limits

This is safe local relinking, not cloud synchronization, generic renamed-file recovery,
all-camera support, a speed benchmark, or full Lightroom parity. Filename-only attachment
cannot prove historical identity. RAW WB continuity, advanced denoise/removal quality and
other gaps in the capability matrix remain. The private Git candidate includes only this
reconnect feature and its required receipt-storage foundation; other local Develop/CRM/UI
work and environment files are deliberately excluded.
