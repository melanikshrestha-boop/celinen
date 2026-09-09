# FOTO release checks — September 9, 2026

## Verified publishing target

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
