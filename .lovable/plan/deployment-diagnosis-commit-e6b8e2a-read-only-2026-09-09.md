# Deployment diagnosis — commit e6b8e2a (read-only)

## Verdict

The published site is deployed but every page crashes. The publish dialog's "Your website was updated" is not evidence of a healthy deploy — the hosted logs show `https://lenslab.dev/auth?mode=signin&next=%2Fearnings` and `https://lenslab.dev/` both returning **500** right now, with a real server error behind them.

## First concrete failure

Hosted worker logs (last hour, live production) repeat this on every request:

```text
Error: Disallowed operation called within global scope. Asynchronous I/O
(ex: fetch() or connect()), setting a timeout, and generating random values
are not allowed within global scope.
    at uniqueId (_ssr/studio-3NE_ba-E.mjs:1494:40)
    at _ssr/studio-3NE_ba-E.mjs:1492:26        (status 500)
GET https://lenslab.dev/auth?mode=signin&next=%2Fearnings → 500
GET https://lenslab.dev/                      → 500
```

Source of that frame:

- `src/lib/develop/store.ts:314`
  `const notificationOrigin: string = import.meta.hot?.data["developNotificationOrigin"] ?? uniqueId();`
- `src/lib/develop/store.ts:339-344` — `uniqueId()` calls `globalThis.crypto.randomUUID()`, falling back to `Math.random()`.

Both are **random-value generation at module top level**. The Cloudflare Workers runtime forbids that outside a request handler. It runs during module evaluation of the shared `_ssr/studio-*.mjs` chunk, which the SSR entry pulls in, so the failure is not scoped to the Studio route — it takes down every server-rendered route, `/auth` included.

This is a runtime-only constraint, which is exactly why both documented local builds pass: `LOVABLE_SANDBOX=1` default preset and `LOVABLE_NITRO_PRESET=lovable-fetch-bundle` both compile the module fine and never evaluate it under workerd.

Timeline in the logs: `/auth?mode=signin&next=%2Fearnings` returned **200** at 21:51:19Z and has returned **500** on every hit from 22:23:30Z onward — consistent with this commit's deploy being the change that broke it.

## Required fix

Make `notificationOrigin` lazy so no random value is generated at module scope:

- Replace the eager `const notificationOrigin = ... ?? uniqueId()` with a lazily-initialised accessor (e.g. a module-level `let cached: string | undefined` plus `function notificationOrigin(): string` that fills it on first call).
- Update the three consumers — `store.ts:318` (HMR dispose), `store.ts:1301` (outgoing broadcast message), `store.ts:2056` (incoming origin comparison) — to call the accessor instead of reading the constant.
- Keep the HMR `dispose`/`data` round-trip so the dev-time identity still survives hot reloads.

All three call sites run inside browser-side handlers, so nothing generates randomness during SSR module evaluation afterwards.

## On the other two symptoms

- **"Worker bundle not found for `_worker_bundle.json`"** (preview loader) and **"Build unsuccessful"** (Git import): no `lovable-build-error-diagnostics` record is retrievable from this sandbox, and `/tmp/observability/build-errors.log` does not exist for this commit — so I cannot state a confirmed cause for those two. They are consistent with the packaging step for this commit not producing a usable bundle, with the preview loader falling back to the last good artifact, but that is unconfirmed and should be verified against the hosted packaging log before anyone acts on it.
- The production 500 above **is** confirmed from live worker logs and is independent of those two: even with a perfectly packaged bundle, every route would still 500 until the module-scope random value is removed.

## Scope

Diagnosis only. No files, branches, database, auth settings, billing, or publication were changed. No secrets or customer data are reproduced here.
