# Production chat 502: Workers AI model retirement

## Root cause and evidence

The configured `@cf/meta/llama-3.1-8b-instruct` model has been retired. A live
same-account request returned HTTP **410**, Cloudflare code **5028**:

> AiError: Model has been deprecated: @cf/meta/infire-llama-3.1-8b-instruct was deprecated on 2026-05-30.

[Cloudflare's retirement notice](https://developers.cloudflare.com/changelog/post/2026-05-08-planned-model-deprecations/)
confirms the retirement and continued availability of the fast variant.

The production route used Cloudflare REST, not an AI binding. Production binding
metadata confirmed its REST secret names exist, but no `AI` binding existed.
Missing binding was therefore not the cause of the old REST implementation's
failure. REST credentials were not printed or extracted from production.

Important evidence boundary: the failing upstream probe used the operator's
Wrangler OAuth credentials against the same account, endpoint and model. It did
not use the unreadable production REST secret. Production discarded upstream
error bodies without logging them. No authenticated production chat request was
available during this investigation, so the exact user request's log correlation
and production REST token permissions remain unverified.

Baseline GitHub and `/api/version` both identified
`57ce5c6df51a2cff292a240bc60707c7cf0ad2fe`. The previous Cloudflare web version was
`4bd82328-1af1-4b19-b594-12e2dfd2a37f`.

## Isolated change

- Use `env.AI.run` with `@cf/meta/llama-3.1-8b-instruct-fast` in Workers.
- Generate the `AI` binding in the production Wrangler configuration.
- Preserve `CLOUDFLARE_AI_ENABLED`; missing binding fails closed in Workers.
- Keep explicit REST configuration for local Node development only. No runtime
  binding-to-REST fallback and no former-host gateway.
- Normalize native tool definitions and responses to the existing Lenslab
  message/tool-proposal contract; the transport executes no tools.
- Retain the 25-second timeout and output-token cap; bound returned JSON to 64 KiB.
- Log structured request IDs, model, transport, duration, failure category,
  upstream status and numeric provider code. Exception names and provider
  summaries are allowlisted. No prompts, photos, paths, filenames, tool arguments,
  user identities, credentials or arbitrary provider text are logged.
- Propagate request IDs and `Cache-Control: no-store` through `/api/chat`.

No UI, auth policy, analytics, photography, C++ V1/V2 code, native service
configuration, production switches, originals, or export/publishing behavior
changes are included. Existing `CANONICAL_V2` service binding and `keep_vars`
remain intact. Existing REST secrets are not removed by this fix.

## Verification

- Before implementation: new regression tests failed on the old transport.
- After implementation: all focused photography/chat tests pass (44 tests).
- Full suite comparison used clean-main and isolated-hotfix worktrees with the
  same dependencies, unchanged native binaries and local-network permissions.
- Five appearance failures and one V2 assertion-count wrapper failure reproduce
  on clean main. No failing test is deleted, skipped, or loosened.
- Clean main: **2,476 passed, 6 failed, 21 skipped, 1 todo**. Hotfix full suite:
  **2,484 passed, 6 failed, 21 skipped, 1 todo**. All eight added tests pass.
  Earlier sandbox-only socket errors disappeared when both suites were run with
  the same local-network permissions; they were not code fixes or test skips.
- Targeted production transport/route lint and whitespace checks pass.

| Test / group | Clean main | Chat hotfix | Introduced by hotfix? |
| --- | --- | --- | --- |
| Compact sidebar row metric | Fail | Fail | No |
| Official connector mark paths | Fail | Fail | No |
| Develop light chrome tokens | Fail | Fail | No |
| Default appearance | Fail | Fail | No |
| Shared typography | Fail | Fail | No |
| V2 controller wrapper | Expects 37; all 40 scenario assertions pass | Same | No |
| Native HTTP/social processing checks | Pass | Pass | No |
| Photography/chat tests | 36 pass | 44 pass | No; 8 added |

Native binding verification used a loopback-only Wrangler development Worker
with a real remote AI binding in the production account, the actual application
transport and photography policy, and synthetic messages:

| Request | HTTP | Observed result | Wall time |
| --- | --- | --- | --- |
| `hi` | 200 | Nonempty photographer-assistant reply | 960 ms |
| Follow-up rainy-day portrait ideas | 200 | Contextual reply | 1,311 ms |
| Lenslab `set_filter` request | 200 | Valid `set_filter({filter:"keepers"})` proposal | 548 ms |

These are actual upstream smoke results, **not authenticated production E2E**
and not a performance benchmark. The read-only tool was proposed, not executed
against a user's shoot. No photographs were supplied.

The production build succeeds and generated Wrangler config includes `AI`,
`ASSETS`, and the unchanged private native service binding. Anonymous production
`POST /api/chat` returns 401 without invoking AI.

## Release gate and production checklist

The hotfix is not declared deployed or fully verified by this document.
The pre-existing sixth test failure needs an explicit hotfix release exception;
the user requested that V2 remain untouched. Authenticated browser access is also
required to complete the production checks. No credentials should be pasted
into chat.

After release approval:

1. Push only this isolated commit to main without force-pushing; refresh main
   first and stop on concurrent conflicting changes.
2. Rebuild from that exact committed SHA using the existing private production
   build environment. Deploy only `lenslab-web` from
   `.output/server/wrangler.json`. Do not deploy the native service.
3. Check deployed binding metadata for `AI`, preserved runtime variables and
   unchanged `CANONICAL_V2` service.
4. Verify GitHub main SHA equals `https://lenslab.dev/api/version`.
5. Tail sanitized `/api/chat` logs. In a genuinely authenticated session, send
   `hi`, a follow-up, and a read-only Lenslab tool request. Require 200, valid
   replies/proposal, and request-ID-correlated `chat_ai` completion logs.
6. Confirm anonymous chat remains 401 and inspect browser network destinations
   for zero former-host runtime requests. Do not infer authenticated success
   from a build, homepage, synthetic auth, or the loopback binding probe.

Rollback: use Cloudflare's `lenslab-web` version rollback to the previously
recorded web version only; leave the native service and switches unchanged.
That rollback restores the retired model and therefore also restores the known
chat failure. A forward fix is preferable; do not restore the former-host gateway.
