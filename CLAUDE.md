# Celinen (lenslab.dev)

Photography SaaS for sports photographers. Product brand **Celinen** (not FOTO / LensLabs). User-facing nav: Shoots (never Jobs).

## Stack
- App: TanStack Start / Vite → Cloudflare Worker `lenslab-web` on `https://lenslab.dev`
- Auth/DB: Supabase project `yzyvooeoyavqtmjvsptv`
- Analytics: PostHog US (consent-gated custom client)
- Repo: `https://github.com/melanikshrestha-boop/celinen.git` (local folder may still be `intelligent-image-aid`)

## Claude Code MCP
Project `.mcp.json` includes:
- `supabase` → `https://mcp.supabase.com/mcp`
- `cloudflare` → `https://mcp.cloudflare.com/mcp`

On first open in this folder, approve pending MCP servers, then authenticate:

```bash
claude
# /mcp → approve supabase + cloudflare → Authenticate each
```

or:

```bash
claude mcp login supabase
claude mcp login cloudflare
```

Prefer these MCPs for dashboard/DB/Worker work. Do not put service-role or Stripe secrets in `VITE_*` or commit them.

## Worker secrets (runtime)
Required on `lenslab-web` (wrangler secret / CF dashboard), not in browser env:
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PROJECT_ID` (usually present)
- `SUPABASE_SERVICE_ROLE_KEY` (privileged server paths)
- `STRIPE_SECRET_KEY` (test until told otherwise)
- `XAI_API_KEY` (Grok STT / chat cleanup; without it dictation falls back to browser speech)

Build-time public Stripe: `VITE_PAYMENTS_CLIENT_TOKEN` on Cloudflare Builds.

## Product rules
- Unpaid signup: Continue with Google → `/auth?mode=signup&next=/studio` (no WaitlistForm / dead checkout banner)
- Consent cookie: write `celinen_consent`, read legacy `foto_consent`
- Speed is the moat; fix user-breaking bugs before polish
