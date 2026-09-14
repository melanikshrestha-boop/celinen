# Cloudflare Pages migration — prepared, not deployed

Historical Pages preparation. The owner subsequently selected Workers with static
assets; use `CLOUDFLARE-WORKERS-MIGRATION.md` for the active deployment target.

Updated 2026-09-13. No Cloudflare project, DNS record, custom domain, production
deployment, Git commit, or Git push was created by this work. Lovable remains live.
Cloudflare account access and GitHub integration authorization are still required.

## Build contract

This is a TanStack Start SSR application, not a static Vite SPA. The API and server
functions must be deployed together with the frontend. The existing Nitro version
is pinned at `3.0.260603-beta`.

- Repository: `melanikshrestha-boop/intelligent-image-aid` (private).
- Intended production branch: `main`, after review of this currently local change.
- Install: `bun install --frozen-lockfile` using the repository lockfile.
- Build: `bun run build:pages`.
- Output: `dist` (not `.output/public` or `dist/assets`).
- The script explicitly selects `NITRO_PRESET=cloudflare_pages` and checks for
  `dist/_worker.js/index.js`, browser assets, and worker routing for application/API requests.
- Use Pages Functions advanced mode, with compatibility date `2026-09-10` and
  `nodejs_compat`, as in the generated `dist/_worker.js/wrangler.json`.
- The generated worker name includes the local checkout name; it is NOT an existing
  Cloudflare project. Choose the project name in Cloudflare's Git integration.
- Do not replace API responses with an SPA `200 /index.html` fallback.
- A successful bundle is not a successful deployed-worker runtime test.

Native C++ Vite development plugins are not a hosted C++ service. This migration
does not enable V2 or change decoder authority. Keep native processing separate.

## Configuration — names only

Configure each intended Cloudflare environment independently. Never paste secret
values into a chat, commit an env file, or expose server secrets through `VITE_*`.

| Location | Variable | Purpose |
| --- | --- | --- |
| Build, public | `VITE_SUPABASE_URL` | Existing Supabase project URL |
| Build, public | `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser publishable key, never service-role key |
| Build, public | `VITE_APP_ORIGIN` | Temporary Pages origin during testing; `https://lenslab.dev` only at cutover |
| Build, public | `VITE_POSTHOG_ENABLED=true` | Existing consent-gated instrumentation |
| Build, public | `VITE_POSTHOG_HOST=https://us.i.posthog.com` | Existing US project ingestion host |
| Build, public | `VITE_POSTHOG_KEY` | Project capture token, not a personal API key |
| Runtime | `SUPABASE_URL` | Same project as browser configuration |
| Runtime | `SUPABASE_PUBLISHABLE_KEY` | Server-side user authentication |
| Runtime, secret | `LOVABLE_API_KEY` | Current AI gateway authorization for `/api/chat` and vibe assistant |
| Runtime, secret | `SUPABASE_SERVICE_ROLE_KEY` | Existing privileged business, delivery and research services, not anonymous chat access |

Hosting independence does NOT remove existing service dependencies: AI still calls
`ai.gateway.lovable.dev`; one Stripe implementation calls
`connector-gateway.lovable.dev/stripe`. Their existing keys must be provisioned
securely and verified from Pages. If the keys cannot be used there, stop: migrating
those providers requires a separate reviewed change. Do not invent credentials or
silently replace models/payment accounts. Google sign-in already uses Supabase OAuth.

Preserve these feature-specific settings if those integrations are currently enabled:

- Stripe Connect: `STRIPE_SECRET_KEY`, `STRIPE_CONNECT_CLIENT_ID`,
  `STRIPE_CONNECT_WEBHOOK_SECRET`, `APP_ORIGIN` (temporary origin for tests).
- Existing gateway payments: `STRIPE_SANDBOX_API_KEY`, `STRIPE_LIVE_API_KEY`,
  `LOVABLE_API_KEY`, public `VITE_PAYMENTS_CLIENT_TOKEN`. Test without charging.
- Delivery: `GALLERY_VISITOR_SECRET`, `DELIVERY_PUBLIC_ORIGIN`.
- Research: `BRAVE_SEARCH_API_KEY`.
- Instagram: `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_API_VERSION`.
- Facebook: `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_API_VERSION`.
- Both social providers: `PUBLISH_ORIGIN`, `SOCIAL_TOKEN_KEY`. Preserve the existing
  encryption key; substituting a new one can make saved connections unreadable.
- Gmail: public `VITE_GOOGLE_GMAIL_CLIENT_ID`.
- Scheduled endpoints: `LOVABLE_CRON_SECRET`, optional `LOVABLE_CRON_SECRET_PREVIOUS`.
  Scheduling must be configured separately; a Pages build does not migrate cron jobs.
- `XAI_API_KEY` is used by the local voice STT development plugin, not the dashboard
  chat route. Moving hosting does not turn that local plugin into a production endpoint.

These names were inventoried from source; presence or correctness of production
secret values has not been verified. Do not disable unavailable integrations with
fake success states. PostHog consent, disabled replay/autocapture, and privacy
allowlists are unchanged.

## Chat diagnosis and repair

Before this change, `AppDashboard.send()` ran local `replyFor()` canned responses
and defaulted unmatched text to Pick navigation. It never called the chat API.
The preceding Studio chat fix did not repair this separate dashboard handler.

A live unauthenticated probe of `POST https://lenslab.dev/api/chat` on September 13
returned **401**, JSON category **authentication required**:
`{"error":"Sign in to use the assistant."}`. This proves route reachability, NOT
successful signed-in inference, working AI credits, or missing configuration.
There is no captured signed-in failed request yet; do not invent its status.

The local repair sends conversation/history to same-origin `/api/chat` with the
current account's Supabase bearer token and `mode: conversation`, without tools.
It respects cloud-assistant settings; no photos are sent. It fences account changes,
navigation cancellation and late replies, limits requests to 30 seconds, blocks
duplicate pending sends, and displays failure instead of a canned success. Existing
dashboard history stays account-scoped on the device. It is not a new cloud-history
implementation. Explicit navigation commands remain local. General conversation
does not reserve venues, pay, send emails, or publish anything.

Calendar repair: container-responsive layout hides the secondary mini-calendar when
the panel is narrow; timed columns have a 48px minimum with a shared horizontal
scroll area. No calendar storage was changed. The read-only real-component fixture
`bun scripts/qa/calendar-layout.tsx --baseline` reproduces overlapping labels;
`bun scripts/qa/calendar-layout.tsx` renders the repair. Files go into ignored `output/`.
At a 700px dashboard inside a 1280px viewport, the baseline day-label positions were
only about 7px apart; repaired day tracks are 48px apart. At 390px viewport the page
stays 390px wide and the 388px calendar grid scrolls inside its own panel. Dark mode
retains the existing dark background and light text. These are fixture checks, not
evidence that the live site was updated.

## Temporary Pages verification — required before DNS

1. Owner signs into Cloudflare and authorizes the private repository in its GitHub
   integration. Create a **Git-integrated Pages project**, branch `main`; no custom
   domain yet. Review/test and push the repair before expecting it in this build.
2. Add build variables, runtime secrets, compatibility settings, and the final
   generated temporary `https://<project>.pages.dev` origin. Rebuild when build-time
   variables change. Pages preview/production environment settings are separate.
3. Add the temporary return URL to the existing Supabase Auth redirect allowlist.
   Keep `lenslab.dev` allowed. Do not replace the Supabase project or databases.
   Preserve the Google provider's existing Supabase callback URI; verify login's
   final destination remains Pages during this test.
4. Visit homepage and nested routes directly and after reload. Sign in using the
   owner's browser; never inspect or copy credentials/session tokens into logs.
5. Test `/dashboard`, calendar at phone/narrow/desktop widths, and a harmless
   conversation such as “Help me plan an indoor portrait shoot.” Verify one
   `POST /api/chat`, valid JSON reply, next-turn context, reload history, and a clear
   error when unavailable. Anonymous API requests must remain 401.
6. Record request URL, status, response category and missing variable **names** for
   any failure. Redact cookies, authorization headers, message text and tokens.
7. Before analytics consent: no PostHog requests. After explicit consent: confirm
   `app_opened` ingestion in project 607971. Confirm revocation stops events and
   replay/autocapture remain disabled. A connector alone is not ingestion proof.
8. Verify relevant existing integrations without publishing, charging, changing
   customer libraries, or enabling native V2. Do not call staging successful until
   homepage, authentication, dashboard, chat and PostHog all pass.

## DNS/custom-domain cutover — only after the above passes

1. Record existing authoritative nameservers, root/www DNS records, MX/TXT mail
   records and Lovable domain configuration for rollback. No current DNS inventory
   or zone-ownership check has been performed in this task.
2. In Pages > project > Custom domains, add `lenslab.dev` **before** manually adding
   a DNS alias. Cloudflare requires the apex domain to be a zone in the same account
   using Cloudflare authoritative nameservers. If it is not, first migrate the full
   zone and preserve mail/verification records; this is an owner-approved step.
3. Follow the custom-domain wizard to create the root alias to
   `<project>.pages.dev`. Use its actual generated target, never the illustrative one.
   If serving `www`, add it separately and choose the desired canonical redirect.
4. Set the build/runtime public origins back to `https://lenslab.dev`; update any
   changed provider redirect/webhook configuration deliberately. Redeploy, wait for
   the custom domain/certificate to become active, and repeat signed-in smoke tests.
5. Only after verified public traffic and a rollback checkpoint may Lovable hosting
   be disconnected. Keep the previous deployment available during observation.
   Do not revoke gateway AI/payment credentials while the app still uses them.

Official references:
- https://nitro.build/deploy/providers/cloudflare
- https://developers.cloudflare.com/pages/functions/advanced-mode/
- https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/
- https://developers.cloudflare.com/pages/configuration/custom-domains/

## Qualification record

Final local qualification:

- Full suite: **2,455 pass, 5 fail, 21 skip, 1 todo**, 2,482 tests across 235 files,
  40.13 seconds. The five failures match the previously established appearance
  baseline: compact sidebar presentation, X/Snapchat connector marks, Develop light
  chrome, default/system appearance, and shared typography. None was hidden/deleted.
- Dashboard-specific tests: **22 pass** including the actual Send callback,
  authenticated API helper, account/cancellation fencing, errors and calendar rules.
- Pages production build and generated artifact checks: **pass**.
- ESLint for the changed TypeScript files and `git diff --check`: **pass**.
- Global TypeScript checking remains non-clean: existing dashboard router Link/search
  typing diagnostics and other repository diagnostics are not repaired by this task.
- Live unauthenticated `/api/chat` probe: **401**, expected authentication requirement.
- No native decoder, model, threshold, original file, V1/V2 authority or analytics
  privacy configuration changed.

Changed/new files in this local handoff (including the preceding Studio chat repair):

- `package.json`
- `scripts/verify-pages-build.ts`
- `scripts/qa/calendar-layout.tsx`
- `src/lib/dashboard-assistant.ts`
- `src/lib/photography-assistant.ts`
- `src/components/dashboard/AppDashboard.tsx`
- `src/components/dashboard/IosCalendar.tsx`
- `src/components/dashboard/ios-calendar.css`
- `src/components/studio/CullChat.tsx`
- `src/routes/api/chat.ts`
- `tests/dashboard-assistant.test.ts`
- `tests/photography-assistant.test.ts`
- `docs/PHOTOGRAPHER-CONVERSATION-HANDOFF.md`
- `docs/CLOUDFLARE-PAGES-MIGRATION.md`

Hosted runtime, signed-in Pages chat, real PostHog ingestion, DNS, external-provider
portability and end-to-end production behavior remain **unverified** until account
access/configuration is ready.
