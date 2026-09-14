# Active migration: Workers with static assets

The owner selected Workers on 2026-09-13. The default Nitro/TanStack Start build
already supports Workers, so Pages is not materially simpler. No product rewrite
or replacement of the C++ backend is required.

## Build and deployment

- Private repository: `melanikshrestha-boop/intelligent-image-aid`.
- Branch: `main`.
- Install: `bun install --frozen-lockfile`.
- Build: `bun run build:workers`.
- Server output: `.output/server/index.mjs`.
- Static output: `.output/public`.
- Generated config: `.output/server/wrangler.json`, compatibility `2026-09-10`,
  `nodejs_compat`, static binding `ASSETS`.
- Intended new Worker: `lenslab-web` in account
  `126e9ae2c8ea356a21ca5f2cf95dd022`. Read-only API check confirmed it did not exist
  before this migration. No other Worker should be overwritten.
- Temporary deploy command:
  `bunx wrangler@4.131.1 deploy --config .output/server/wrangler.json --name lenslab-web --keep-vars`.
- Set that build/deploy command in Workers Builds after connecting GitHub.
  Authorize only the private repository needed for this project. Select `main` as
  production branch. Never point this Worker at `lenslab.dev` before temporary checks pass.
- `scripts/verify-workers-build.ts` rejects a missing server/assets binding,
  missing Node compatibility, inline generated vars or custom-domain routes.

The existing `@lovable.dev/vite-tanstack-config` dependency is a build helper, not
the hosting provider. Retaining it preserves the current frontend build behavior.
The existing AI and one Stripe gateway still depend on Lovable services. Moving
hosting does not remove those APIs or create replacement provider credentials.

## Required configuration

Build/public:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_APP_ORIGIN` = actual temporary Workers URL until cutover
- `VITE_POSTHOG_ENABLED=true`
- `VITE_POSTHOG_HOST=https://us.i.posthog.com`
- `VITE_POSTHOG_KEY` = project 607971 capture token, never a personal API key

Runtime:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `LOVABLE_API_KEY` (encrypted secret; actual chat inference)
- `SUPABASE_SERVICE_ROLE_KEY` (encrypted secret; existing privileged business,
  delivery and research operations; never expose it to the browser)

Configure build variables in Workers Builds; configure runtime variables/secrets
under Worker Settings. They are separate. Rebuild for any `VITE_*` change.
Keep existing integration-specific secrets/settings listed in
`CLOUDFLARE-PAGES-MIGRATION.md`; those names remain valid on Workers.
Do not commit `.env.development`, other credentials or local auth files.
PostHog remains consent-gated, with replay/autocapture disabled. Do not enable V2.

## Qualification before cutover

- Both production build and Wrangler upload dry-run passed locally.
- Local production `workerd` runtime: homepage 200; anonymous `POST /api/chat` 401.
- Full application tests: 2,455 pass; 5 previously established appearance failures;
  21 skip; 1 todo. New dashboard callback/API tests: 22 pass. Changed-file lint and
  whitespace checks pass. Global TypeScript checking remains non-clean as described
  in the preceding migration report; no failing test was deleted/hidden.
- Server/static dry-run: 6,152.28 KiB raw; 1,359.30 KiB gzip; 370 static files.
- GitHub linkage, temporary public URL, owner Google login, signed-in dashboard,
  actual AI response and consented PostHog ingestion require external verification.
  A 401 response proves the auth gate, not successful signed-in chat.

Use only a harmless test conversation; no uploads of customer photos, no paid
bookings, exports, social publishing or writes to originals as part of hosting QA.
Add the actual temporary auth return URL to Supabase's allowed redirect URLs while
retaining the old domain. Keep the existing Google-to-Supabase provider callback.

## Exact cutover procedure, gated on all checks above

1. Record the existing authoritative nameservers, `lenslab.dev` root/www records,
   mail/verification records, and Lovable custom-domain setup for rollback.
2. Ensure the active `lenslab.dev` Cloudflare zone belongs to this account. If DNS
   is hosted elsewhere, onboard the full zone and preserve MX/TXT records before
   the owner changes registrar nameservers. Do not guess existing DNS values.
3. Change public origin variables from the temporary Worker URL to
   `https://lenslab.dev`, and check relevant integration return URLs. Build the same
   qualified commit with these settings.
4. In Worker `lenslab-web` > Settings > Domains & Routes > Add > Custom Domain,
   enter `lenslab.dev`. Only now approve replacing a conflicting Lovable root
   record. Cloudflare provisions the DNS mapping and certificate. Do not add a
   wildcard Worker Route or manually CNAME the apex to an invented workers.dev URL.
5. Wait for the custom domain/certificate to become active; verify homepage,
   owner login, dashboard/calendar, real chat and PostHog on `lenslab.dev` again.
6. Keep Lovable's deployment/account intact until Cloudflare production passes and
   rollback is retained. If verification fails, restore the recorded Lovable domain
   mapping; do not delete either deployment. Do not revoke the AI/Stripe gateway
   keys while they remain in use.

References:
- https://nitro.build/deploy/providers/cloudflare
- https://developers.cloudflare.com/workers/ci-cd/builds/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
