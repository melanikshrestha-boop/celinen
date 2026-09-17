# Supabase schema drift

Audit date: 2026-09-16. Scope: every table, RPC and storage bucket the app code touches, against the migrations in this repository. Nothing was applied or changed in any database.

## Verdict

Every table, RPC and bucket the code queries **has a migration in this repo**. No call site queries an object that the repo cannot create. The drift is operational: production has to be brought up to `drizzle/migrations`. No application code was changed for this audit.

Three things make that harder than it sounds, in order of severity:

1. **Production is a different Supabase project than the repo tooling points at.** The live bundle on `lenslab.dev` talks to project `yzyv…` (the `VITE_SUPABASE_URL` in `.env.production.local`). `supabase/config.toml` (`project_id`) and `.env` point at `trlm…`, the original Lovable project. Any CLI command run with repo defaults targets the wrong database.
2. **There is no `supabase/migrations` directory**, so `supabase db push` has nothing to push. Migrations live in `drizzle/migrations` and are applied with drizzle-kit (`drizzle.config.ts`, connection string from `LOVABLE_DB_MIGRATION_URL`).
3. **Three SQL files are not in the drizzle journal**, so `drizzle-kit migrate` silently skips them: `0019_commerce_network`, `0020_conversation_controls`, `0021_facebook_social_connections`. `drizzle/migrations/meta/_journal.json` has 21 entries for 24 SQL files. These three were written to be applied by hand (see `docs/COMMERCE-NETWORK-PLAN.md`, `docs/CONVERSATION-CONTROLS-QA.md`).

## Tables the code queries

"Typed" means present in `src/integrations/supabase/types.ts` (19 of 38 migrated tables are; the rest are queried through untyped casts, so a column typo there is a runtime error, not a compile error).

| Table | Migration | Typed | Queried from | If missing in production (PostgREST `PGRST205`) |
| --- | --- | --- | --- | --- |
| `signups` | 0000 | yes | `utils/payments.functions.ts` | Paid checkout cannot record the signup. |
| `lightroom_sync` | 0000 | yes | `routes/api/public/lightroom.ts` | Lightroom plugin sync fails. |
| `profiles` | 0001 | yes | finance, rates, earnings, client portal, Stripe connect callback/webhook | Earnings, rates and Stripe Connect fail; new-user trigger `handle_new_user` has nowhere to write. |
| `clients` | 0001 | yes | finance, rates, earnings, client portal, vibe | Client list, invoices and portal fail. |
| `shoots` | 0001 | yes | finance, earnings, client portal, canonical V2 gateway | Earnings and V2 ownership checks fail. |
| `invoices` | 0001 | yes | finance, earnings, client portal, Stripe webhook | Invoices fail; paid webhooks cannot settle. |
| `transactions` | 0001 | yes | finance | Earnings ledger fails. |
| `stripe_oauth_states` | 0001 | yes | finance, Stripe connect callback | Stripe Connect onboarding cannot complete. |
| `galleries` | 0002 | yes | delivery, client portal, shoot app | Gallery create/open fails (the Deliver desk). |
| `gallery_photos` | 0002 (+0013, 0023) | yes | delivery, shoot app | Gallery contents fail. |
| `gallery_favorites` | 0002 (+0011) | yes | delivery | Client favorites fail. |
| `booking_requests` | 0005 | yes | client portal, shoot app, vibe | Booking intake fails. |
| `client_uploads` | 0005 (+0022) | yes | client portal, shoot app | Client uploads fail. |
| `lightroom_workspaces` | 0006 (+0007) | yes | lightroom functions, public lightroom API | Lightroom workspace tokens fail. |
| `vibe_sessions` | 0009 | yes | vibe | Vibe sessions fail. |
| `community_posts`, `community_profiles` | 0009 | yes | community | Photographers' room fails. |
| `ambassador_applications` | 0012 | yes | `routes/ambassador.tsx` (browser) | Form shows its retry message; already fails soft. |
| `shoot_packages` | 0012 | yes | rates | Packages and rates fail. |
| `delivery_rooms` | 0014 | no | `delivery/remote.server.ts` | Proof-to-final delivery rooms fail. |
| `delivery_owner_limits`, `delivery_verification_slots` | 0015 | no | `delivery/remote.server.ts` | Delivery launch guards fail closed. |
| `workspace_chats` | 0017 (+0020, unjournaled) | no | `chat-history.functions.ts` | Cloud chat history unavailable; the workspace already degrades to a temporary local history (`tests/chat-history-degraded.test.ts`). Without 0020, pin/archive/delete fail. |
| `business_clients` | 0018 | no | `business/clients.functions.ts` | Business client list fails. |
| `social_connections`, `social_oauth_states`, `social_publications` | 0018 | no | Instagram/Facebook servers, publishing, story cover | Social accounts and publishing fail. |
| `commerce_shops`, `photographer_directory`, `photographer_inquiries` | 0019 (unjournaled) | no | `commerce/service.server.ts` | Shop, directory and inquiries fail. |
| `facebook_social_connections` | 0021 (unjournaled) | no | `business/facebook.server.ts` | Facebook connection fails. |

Created by migrations and used only inside SQL functions (not queried directly): `delivery_rate_limits`, `delivery_safety_events`, `delivery_upload_budget`, `workspace_chat_write_limits`, `workspace_search_leases`, `workspace_search_usage`, `photographer_verified_reviews`.

## RPCs the code calls

All are defined in migrations: `business_save_clients` (0018), `commerce_save_shop`, `directory_discover`, `directory_save_profile`, `directory_send_inquiry` (0019, unjournaled), `delivery_take_request` (0014), `delivery_close_room`, `delivery_commit_verified`, `delivery_acquire_verification`, `delivery_release_verification`, `delivery_reserve_upload`, `delivery_settle_upload` (0015), `workspace_take_search`, `workspace_release_search` (0016). `save_workspace_chat` is defined in 0017 and replaced in 0020; `delete_workspace_chat` exists only in 0020 (unjournaled).

## Storage

One bucket, `deliveries`, with policies from 0003 and 0022. Used by delivery, client portal, shoot app and the browser upload in `routes/deliver.tsx`.

## Measure the drift (read-only, run it yourself)

This lists which tables PostgREST exposes in production without reading a row. It was not run during this audit. Use the **production** project's URL and publishable key (the values in `.env.production.local`):

```sh
set -a; . ./.env.production.local; set +a
for t in signups profiles clients shoots invoices transactions galleries gallery_photos \
  workspace_chats delivery_rooms social_publications commerce_shops facebook_social_connections; do
  printf '%-32s %s\n' "$t" "$(curl -s -o /dev/null -w '%{http_code}' \
    "$VITE_SUPABASE_URL/rest/v1/$t?select=*&limit=0" -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY")"
done
```

`404` means the table is missing (`PGRST205`). `200` or `401` means it exists (RLS decides the rest).

## Apply (not run; needs an explicit go-ahead)

Every migration is additive, but this is a production database write. Take a backup first (Supabase dashboard → Database → Backups) and confirm the target is the `yzyv…` project.

1. Point drizzle at production. `LOVABLE_DB_MIGRATION_URL` must be the **production** project's Postgres connection string (Supabase dashboard → Connect → Session pooler). Do not commit it.
2. Apply the journaled migrations:
   ```sh
   LOVABLE_DB_MIGRATION_URL='postgresql://…' bunx drizzle-kit migrate
   ```
   If production already has `signups` from a hand-run 0000, drizzle's `__drizzle_migrations` table will be empty and 0000 will be retried. Check whether 0000 is idempotent against that database before running; if it is not, baseline the journal table first.
3. Apply the three unjournaled files by hand, in order, after step 2 (0020 replaces a function from 0017):
   ```sh
   psql "$LOVABLE_DB_MIGRATION_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/migrations/0019_commerce_network.sql
   psql "$LOVABLE_DB_MIGRATION_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/migrations/0020_conversation_controls.sql
   psql "$LOVABLE_DB_MIGRATION_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/migrations/0021_facebook_social_connections.sql
   ```
4. Reload the PostgREST schema cache so REST sees the new tables: `NOTIFY pgrst, 'reload schema';`
5. Re-run the measurement above; every row should be `200` or `401`.
6. The repo's SQL checks (`scripts/*-sql-check.mjs`, `scripts/check-*-storage.ts`) verify the migration files against a temporary in-memory PostgreSQL (PGlite), never production.

## Follow-ups (not done here)

- Journal 0019–0021 (or renumber them after 0023) so one command applies everything.
- Regenerate `src/integrations/supabase/types.ts` from the production project once it is migrated, so the 19 untyped tables are checked at compile time.
- Point `supabase/config.toml` and `.env` at the production project, or delete the stale `trlm…` references, so tooling cannot target the wrong database by default.
