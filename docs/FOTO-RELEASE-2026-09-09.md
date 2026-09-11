# FOTO release checks — September 9, 2026

## Verified publishing target

### Latest execution outcome

**Recovery published and checked:** the validated hotfix `2f4a026` was merged
with Lovable's concurrent startup repair, preserving both Git histories. The
combined private branch SHA is `c8576d76bb3fdb6d3b58e1fb2184acf577635d5e`, verified
by remote readback. The source is identical to the final tested hotfix; the merge
only adds Lovable's diagnosis document. No force push or environment-file change.

After explicit **Publish changes**, Lovable reported **Your website was updated**.
Independent browser checks on the real `lenslab.dev` now render the homepage and
interactive sign-in page, with no browser errors in those checks. The loaded
font is **Source Serif 4** (`document.fonts.check` true); the live homepage body
is `rgb(0, 0, 0)`. The sign-in screen uses the same font. `/earnings` correctly
requires authentication. Clicking Google on the real sign-in page reaches
Google's account chooser, with the `/earnings` return context retained in the
initiating URL. The owner must select their account; final session installation
and the authenticated Earnings graphs are **not yet verified**. The account
chooser is left open in the existing browser for this owner-only step.

**Database repair not applied:** the live preflight still reports no
`verified_booking_email(text)` function, two client-upload policies, a private
deliveries bucket and migration watermark `1788520019592`. Action review blocked
the permissions-only 0022 transaction pending explicit owner approval of its
grant/RLS/Storage access impact. No transaction executed. The editor was replaced
with a harmless read-only query, and approval was requested. Do not retry through
another interface or treat broad deployment approval as this missing authority.
The earlier `main` rollback is no longer needed and was never performed.

The historical failure and reproducible repair evidence follow.

Release `e6b8e2aa51314b6ec5ae65c928f75bb3b4cc462b` is committed and verified on
the existing private FOTO branch. Final regression: **2,003 pass, 19 skip,
1 pre-existing opt-in RAW-WB TODO, 0 fail**. Standard production build and both
documented Lovable sandbox build modes passed locally.

The explicit Lovable **Publish changes** action reported **Your website was
updated**, but immediate and repeated checks of `lenslab.dev/` and `/auth` return
**This page didn't load**. This is a failed live deployment, not completion.
No live database migration or customer-data mutation was performed.

An attempted recovery switch to `main` was blocked by action review pending
specific owner approval. Approval was requested; the branch remains FOTO. Do not
bypass that block or rewrite Git history. The read-only Lovable Plan diagnosis
identified the actual production failure: `src/lib/develop/store.ts` created a
notification ID with `crypto.randomUUID()` at module evaluation. Cloudflare
forbids global-scope crypto operations; importing the shared Studio chunk crashed
every SSR route. This has also been reproduced in the real local workerd runtime
using the committed `e6b8e2a` store, not merely a source assertion.

The repair lazily creates the notification identity when the store uses it and
shares its holder across HMR, including a hot reload before the first save.
It does not switch branches or change customer records. The final full suite is
**2,006 pass, 19 skip, 1 existing TODO, 0 fail** (369,863 expectations); TypeScript,
scoped lint/format and production build pass. The standalone
`scripts/check-workers-cold-start.mjs` reproduces the old crash and verifies two
request-time UUIDs after the fix. Three isolated notification tests cover lazy
import, cross-store identity, echoes and HMR before/after first use.

The complete freshly built modular worker also passed an isolated Miniflare
SSR smoke check: `/` and `/auth?mode=signin&next=%2Fearnings` both returned 200 HTML,
with zero outbound calls and no credentials/customer bindings. The initial
Miniflare 500 was its temporary assets-router configuration; removing that router
resolved the harness issue without source changes. This smoke check does not
verify static assets or OAuth completion. Renewed publication and live readback
remain required. The record below is not a statement that its SQL repair is live.

Existing Lovable project `90a3d4fe-ecf0-4ee7-8a26-d2bff0b4545c` (Lens AI Studio),
private repository `melanikshrestha-boop/intelligent-image-aid`, destination
`lenslab.dev`. With owner approval, switched the connected branch from `main` to
`codex/lenslabs-photographer-platform`. This is **not** proof of publication.

The selected preview requested commit `664a80ea` but the hosted worker log reported
`Worker bundle not found`. The public site still served the older account UI at
the start of this release. Do not mark either the new UI or Google login live
until a successful hosted build, explicit publication and live readback.

## Upload security repair

- Verified account or guest-booking identity, canonical exact object paths and
  completed nonempty Storage object checks before admitting reference records.
- No first-visible-client matching for uploads. Unassigned uploads remain private;
  the UI does not claim they were delivered to a photographer.
- Gallery registration/signing/deletion validates the exact owner and gallery.
  Invalid legacy records remain intact with unavailable URLs; they never authorize
  removal of another gallery's originals.
- A successful transfer is not a successful record. Failed files remain retryable;
  unknown acknowledgements reconcile an authorized exact path without resending.
  Account/token changes fence queued work and discard only RAM retry state.
- `0022_upload_path_ownership.sql` revokes direct client-upload writes, adds
  restrictive path/Storage guards and verified-account booking-email reads.
  It changes policies/grants only, not customer rows or files. Reapplication is
  safe. Previously issued six-hour download links are not retroactively revoked.

## Live database preflight (metadata only)

The `deliveries` bucket is private. Existing Storage rules are owner-prefix scoped.
The hosted default table grants are broader than the historical SQL files,
including UPDATE and TRUNCATE, so revocation is necessary in addition to RLS.
The migration table's latest entry is timestamp `1788520019592` (0013). Later
delivery, workspace and publishing migrations are **not established as applied**.
No customer rows or originals were used for QA.

The journal registers 0022 at its next index (19); indexes are independent of SQL
filename prefixes. Existing unregistered 0019–0021 files were not silently queued
as part of this security repair. If those features are later approved for database
rollout after 0022, use deliberate migrations with newer timestamps; adding their
old timestamps would be skipped by Drizzle. Reconcile the actual migration ledger
before running any bulk migration. A manually applied security-only hotfix must
not advance the migration watermark past unapplied 0014–0018.

## Reproducible local verification

- `bun test`: full app suite with isolated RAW fixtures, no customer library.
- `npx tsc --noEmit`; scoped ESLint and Prettier; `npm run build`.
- `node scripts/upload-security-sql-check.mjs /absolute/isolated/node_modules/@electric-sql/pglite`:
  executes the real baseline migrations and the new policy repair in disposable
  PostgreSQL. Demonstrates old bypasses, blocked cross-owner operations, verified
  guest access, nonempty object validation and unchanged legacy rows.

The final targeted upload suite has 58 passing tests (263 expectations). The SQL
harness has 46 passing assertions; independent review also exercised broad hosted
grants and repeated application with 52 passing assertions. Production build,
TypeScript, scoped lint and formatting pass locally.

Four lockfile-only security patches retain existing compatible dependency ranges:
brace-expansion 1.1.18 and 5.0.9, js-yaml 4.3.2, nanoid 3.3.18. Frozen installation
and compatibility tests pass. Bun audit reports no high findings and one moderate
esbuild advisory in the development-only Drizzle toolchain. No Drizzle serve
endpoint is exposed by this application. Lovable's dependency rescan is still
required; a transitive dependency fix is not assumed to clear its separate report.

These checks do not establish production Storage signed-PUT behavior, Google
sign-in completion, migration application, 1,000-RAW performance or Lightroom
parity. Native C++ processing is not automatically deployed by a web publication.
