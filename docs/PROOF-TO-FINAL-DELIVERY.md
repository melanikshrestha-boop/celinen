# Proof-to-final delivery

## Release state

Implemented in the existing LensLabs checkout. `/deliver` again defaults to the existing Lovable delivery interface. The proof-to-final pilot remains explicitly opt-in at `/deliver?workflow=1`; `/review/$id` is its private client gallery. `/deliver?legacy=1` remains valid. No previous gallery data, Studio layout, shared stylesheet or originals were replaced by the launch-hardening pass. The optional pilot uses the existing Shell chrome.

**Not a live-client release yet.** This development environment does not have `SUPABASE_SERVICE_ROLE_KEY`, the migration connection, or a verified deployed delivery origin. The app therefore supports preparing device-local drafts and read-only client previews, but refuses to produce a remotely usable invitation. Local preparation is not remote publication. Browser/mobile interaction QA and isolated real-Supabase integration tests remain release gates.

## The workflow

1. Create a private draft with title, client/team label, welcome note, selection allowance, and expiry.
2. Add images or import saved Studio keepers. Freeze current edits into distinct JPEG proof, phone, and high-resolution renditions. The local IndexedDB outbox stores prepared bytes before network work; it is a retry cache, not the source of truth for shared decisions.
3. Connect and upload. Server-created immutable object paths bind owner, gallery, version, rendition, and SHA-256. Retry uses the same reservation; completion checks byte count, SHA-256 and JPEG dimensions. Upload progress is distinct from verified readiness.
4. Review and publish versions, then create a private invitation. A new link revokes the prior invitation. Clients share one collaborative selection and display label; this is bearer-link access, **not verified individual identity**.
5. Clients select photos, then explicitly submit a version-linked selection snapshot. Favourites alone do not approve an edit. Reopening selections preserves submission history and suspends existing approvals/download access.
6. Clients and photographers exchange photo-specific, plain-text comments. Explicit revision requests revoke approval and download access for that photo. Comments never execute as assistant instructions or automatically change edits.
7. Open a source-linked photo in local Studio, make changes, then use Bring Studio keepers to prepare the newer edit, or upload a revised finished image directly. Versions are immutable. Publishing a replacement requires fresh client approval.
8. Mark requests addressed; the client still explicitly approves the selected published version. The photographer then releases the exact approved versions.
9. Download phone copies, high-resolution JPEGs, or bounded ZIP parts. Every file is checked before it is offered. ZIPs cap at 30 files / 80 MiB, sign each file just before fetching, and fail as a whole on incomplete or revoked files. Download preparation is never reported as confirmed saving/backup.

## Security and data boundaries

- New server-write-only `delivery_rooms` table with RLS enabled and all anon/authenticated table privileges revoked. Authenticated photographer server functions verify the owner. Client endpoints validate a 256-bit random invitation stored only as a SHA-256 hash.
- Invitation secret travels in the URL fragment, not a server URL/query string. The client keeps it in tab-scoped session storage and removes it from the address bar. Private responses use `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, and no-index headers.
- The separate `delivery-private-v1` bucket must remain private, JPEG-only, with a positive file-size ceiling at most 30 MiB. Actual upload, client-open and media-signing operations verify this, not just the UI readiness check. No new browser storage policy permits arbitrary object writes or overwrites.
- Client DTOs omit unpublished media, private source/project references, request fingerprints, unpublished-version comments/activity, and hashes for unreleased phone/high-resolution files.
- Mutations use optimistic compare-and-swap revisions and operation fingerprints. A stale action never overwrites another device. Lost-response retries reuse operation IDs. Upload completions preserve newest-version ordering.
- Approval/release histories are retained. Revocation does not erase the historical decision. Closing uses a separate server-only atomic safety operation and audit table, so an exhausted activity/metadata budget cannot block revocation. Reopening does not resurrect an old link.
- Actual account identity keys the workspace. Account changes dispose invitation dialogs, previews and pending actions. Outbox drafts/jobs bind to the owning account; Connect deliberately claims an explicitly device-local draft and its existing files in one transaction. A late job cannot cross a claim made by another tab. Legacy synchronized outbox records without provable ownership are preserved but hidden, not auto-assigned; recovery requires an explicit ownership-verification path before a later release.
- Streamed verification retains at most 256 KiB of JPEG header plus runtime chunks instead of buffering complete renditions. It checks size, digest, frame/scan structure and end marker; it does not fully decode pixels. There are two global verification leases, at most one per owner, a 45-second request deadline and 90-second crash-recovery leases. The commit RPC checks the still-valid token atomically.
- Storage admission requires an enabled row in `delivery_owner_limits`. The default is 10 GiB and 10,000 rendition objects per approved account. Pending versions reserve three full 30 MiB slots before any signed write ticket; verified immutable versions settle to their actual byte totals once. Retries do not double-charge. Abandoned reservations are never automatically refunded or deleted. Migration0015 accounts for existing ready and pending versions and leaves existing owners disabled pending explicit approval.
- Signed media URLs live at most 120 seconds (or remaining gallery lifetime). Already signed or downloaded bytes cannot be recalled. UI locking is not DRM, and proof images can always be saved or screenshotted by an authorized viewer.
- Per-client and owner rate limits are enforced in a server-only SQL function. Logs/analytics must not record RPC bodies or fragment credentials. Any third-party runtime analytics should be disabled on private gallery pages before rollout.
- Existing legacy galleries retain their old behavior; they are not automatically migrated into this stronger access model. Do not present their previous download toggles as equivalent protection.

## Connecting the existing deployment

Use the existing Lovable/Supabase/Cloudflare deployment. Do not migrate the app to a different hosting account or publish local client photos while testing.

1. Apply `drizzle/migrations/0014_proof_to_final_delivery.sql`, then `0015_delivery_launch_guards.sql` through the existing approved migration workflow. Both are registered in the migration journal. The second preserves existing deliveries and expands the old hard metadata constraint slightly to reserve closure headroom. Never regenerate the intentionally blank Drizzle schema or drop/recreate legacy tables.
2. Configure server-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on the server. Keep the existing publishable browser keys. Never put a service-role key in a `VITE_` variable or paste it into chat.
3. Deploy the validated route/server changes to the existing app. Set server-only `DELIVERY_PUBLIC_ORIGIN` to that verified HTTPS origin (for example `https://lenslab.dev`, only after the new route is deployed there). A localhost origin is explicitly refused.
4. Verify bucket privacy, table grants/RLS, fixed SQL function search path, and RPC execute grants on a test project first. Confirm direct anonymous and authenticated database/storage reads are denied.
5. Enable only the approved pilot photographer's verified auth user ID in `delivery_owner_limits`; review any backfilled usage first. Do not grant browser permissions or enable all registrations. Sign in at `/deliver?workflow=1`. Prepare a fixture-only gallery and test the full flow in a separate client browser/device: comments, submit, revision, new version, resolve, approve, release, phone and ZIP download, expiry and revocation. Check invitation links without an existing browser session.
6. Check touch targets, focus restoration, image refresh, iOS download behavior, offline comment preservation, IndexedDB quota errors and reload/retry. Verify storage content hashes with an interrupted upload and a deliberately missing object.
7. Configure retention monitoring for rate-limit rows and abandoned immutable upload reservations. Do not run blanket cleanup: retain referenced originals/versions and obtain explicit approval for any deletion policy.

## Honest scope / capacity

- Schema caps are 3,000 photos, 30 versions per photo, and 20,000 ordinary recorded actions, subject to a stricter 4 MiB application metadata budget and the account's storage allowance. These maxima are not promised simultaneously. The database has a 16 MiB-plus-4-KiB last-resort guard for legacy rows and safety closure. Metadata is a compare-and-swap JSON document, not an unbounded distributed event store. Real hosted load testing remains required before promising high-concurrency/large-history performance.
- Only 48 previews render per grid page; media requests cap at 60. Uploads and rendering are sequential and user-retryable to bound memory and network pressure; this is not TUS/multipart resumable byte streaming. A failed file reuses completed rendition uploads.
- Proofs: up to 1,600 px; phone: 2,048 px; high-resolution JPEG: 4,800 px; each rendition at most 30 MiB. Actual dimensions and byte sizes are shown. Source originals, RAW containers and location metadata are not uploaded.
- Reuses the existing browser edit renderer to preserve current edit semantics. This is not a new C++ processing kernel, a full RAW developer, or Adobe colour-management equivalence. RAW Studio sources use embedded previews in this path. The test proof fixture was rendered by the existing C++ engine.
- Feedback updates by refresh/focus and 20-second polling. No email notifications, SMS, contracts, payments, per-person identity verification or video proofing are claimed in this release.
- Device-local drafts and outbox bytes can be lost if the browser's storage is cleared. They are not a backup. Unsent comments currently survive failed requests and version changes while the gallery is mounted, but not a page reload/navigation. Do not promise offline comment sync. Shared decisions are authoritative only after the server confirms them.

## Verification evidence

- Production build and TypeScript checks pass.
- Final full repository suite: **614 tests passed, 0 failed, 4,916 assertions across 33 files**. The existing loopback HTTP bridge tests needed permission to open a local test listener; no production backend was contacted.
- 41 new workflow tests cover state/role gates, immutable version/selection/release histories, retries, delayed completion, duplicate/foreign IDs, hidden draft data, expiry, filename/input boundaries and a synthetic 3,000-photo metadata submission.
- Server tests use an isolated fake Supabase HTTP transport and real JPEG bytes. They cover owner isolation, bucket privacy/ceiling enforcement, missing/corrupt uploads, partial retries, quota refusal, verification admission, full-log revocation, invitation rotation, CAS conflicts, idempotency and final-download authorization. They do not prove deployed SQL policies or real cross-device behavior.
- `scripts/delivery-sql-check.mjs` executes both migrations in a disposable PGlite database: **50 assertions** cover legacy backfill, quota charging/settlement, grants, lease expiry, stale-token commit rejection, closure replay and preserved history. `scripts/delivery-outbox-check.ts` uses isolated fake IndexedDB and mocked networking: **17 assertions** cover ownership, a claim/render race, stale writes and authentication changing mid-upload. Neither script touches a real database or browser profile. Temporary test tools were installed outside the project; no production dependency was added.
- Stream tests verify real JPEG bytes across tiny/changing chunk boundaries, oversize cancellation, stalled-body abort, checksum/dimension mismatch and malformed SOF-only images. Account policy tests cover A/B/sign-out visibility and legacy preparation order.
- 6 additional download tests cover a 3,000-item partition plan, byte/count bounds, duplicate/unreleased metadata, HTTP error bodies, checksum failures, ZIP completeness, mid-batch revocation, and cancellation.
- The 3,000-photo metadata-only test took approximately 37 ms on one observed run; this is **not** a 3,000-photo upload, rendering, culling, or mobile benchmark.
- Non-browser HTTP checks returned 200 for both local routes and verified the private gallery's no-store/no-referrer/no-index/nosniff headers.
- Targeted lint and TypeScript checks pass; the final production build succeeds. A browser-bundle scan found no service-role configuration names, invitation-hash database fields, or rate-limit RPC implementation. The three original fixture SHA-256 values remain unchanged.

Primary storage references: [Supabase private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), [signed uploads](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl), and [signed URL lifetime](https://supabase.com/docs/guides/storage/serving/downloads).
