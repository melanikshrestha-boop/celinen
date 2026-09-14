# Private Canonical V2 service

This is an opt-in backend, not a replacement for V1. The frozen decoder contract
and customer qualification flags remain unchanged. No frontend workflow selects
V2 automatically. No model, score weights, exports, XMP, originals or V1 decisions
are written by this service.

## Boundaries

`lenslab-web /api/native/v2` verifies the user's Supabase identity with `getUser`
and queries `shoots.id/user_id` through that user's RLS context. It forwards only
allowlisted headers over the `CANONICAL_V2` service binding. Its private bridge
credential is distinct from user tokens and the native-process credential.

The private Worker requires the bridge credential on **every** route. A single
Durable Object owns admission, rate state, cancellation and separate V2 receipts.
One active image; no waiting image queue; 30 admissions/minute/user; one maximum
container instance. Receipts retain hashes/provenance, not returned image pixels.
Restart marks active work interrupted and destroys the old process. There is no
silent retry or fallback. Receipt TTL is 24 hours, pruned opportunistically.

The C++ supervisor runs as UID 10001 with a 64 MiB upload ceiling, one child per
image, 20-second upload budget, 45-second processing wall timeout, 30 CPU seconds,
3 GiB child address-space ceiling and 1 MiB response ceiling. The Worker has a
75-second upstream budget. Standard-1 supplies 0.5 vCPU and 4 GiB memory. The
container sleeps after 60 idle seconds and has outbound Internet disabled.
Only generated private temporary files are removed; originals are never mounted.

The RAW contract is **embedded JPEG preview extraction**, not full RAW sensor
development. The retained JPEG/Sony fixture gate is not broad camera or sports
selection qualification.

## Runtime configuration

Both Workers: `LENSLABS_CANONICAL_V2_ENABLED=false`, empty
`LENSLABS_V2_OWNER_IDS`, encrypted `LENSLABS_V2_BRIDGE_TOKEN`.
The web Worker additionally needs its existing Supabase URL/publishable key and
the service binding. Do not put any secret in Vite build variables.
PostHog cannot authorize native processing. Existing consent/revocation and
photography instrumentation are not changed.

Generate the ignored deployment configuration with `render-config.mjs` using the
exact Cloudflare **digest** of the CI-qualified linux/amd64 image. Never rebuild
on a different host and assume it is the tested artifact. The configuration
records the current committed Worker SHA and explicitly forces both gates off.
The pinned SDK and Wrangler are installed with `npm ci --ignore-scripts` here.

After both Workers exist, explicitly run `configure-bridge.mjs
--rotate-and-probe`. It rotates both encrypted bridge secrets together and proves
authenticated native health/ready, anonymous 401, and dark processing 503. The
token is generated in memory and is not printed or written to disk. A partial
rotation fails closed; rerun to rotate both again. This creates Worker versions
but does not activate processing. Verify the web version endpoint separately.

## API

- `GET /api/native/v2`: authenticated allowlisted-owner health.
- `POST /api/native/v2`: original bytes, `Content-Type: application/octet-stream`,
  bounded Content-Length, `X-Shoot-Id`, `X-Source-Sha256`. Server generates job ID.
- `GET /api/native/v2?job=<id>`: same-owner/same-shoot hash receipt.
- `DELETE /api/native/v2?job=<id>`: same-owner cancellation (202 while stopping).

All responses are no-store. Each V2 response identifies
`sports-canonical-rgba256-v2` and `customer_authority:false`.
Unknown ownership returns 404; missing authentication 401; non-allowlisted users
403; disabled processing 503; busy/rate-limited 429. Native errors do not invoke V1.

## Emergency stop and rollback

Set the independent server switch false in **both** Workers to block new work.
For immediate active-job termination, authenticated operator `POST /kill` on the
private Worker durably latches disabled and destroys the container. It has no
public app forwarding route. Use the bridge credential via a secret manager or
rotate it; do not paste it into chat, URLs or command history. With the switch
explicitly false, operator `POST /reset-kill` clears that latch and destroys the
old process; it cannot activate processing. Re-enabling requires a separately
reviewed owner allowlist and explicit switches, plus container restart to apply
the native environment. Owner activation is **not** part of a dark deployment.

To roll the web app back, redeploy a reviewed prior `lenslab-web` version. V1 is
untouched and needs no data rollback. Keep the private service disabled. Worker
versions and the immutable image digest must be recorded in release evidence.

## Qualification status

AMD64 normal and fully instrumented ASan/UBSan pass 510 cases / 1,950 stage hashes
each, plus 38 primitive checks, 14 decoder tests and 10,000 malformed mutations.
See `docs/CANONICAL-V2-AMD64-QUALIFICATION.md` for exact receipts and CI links.

Container packaging initially exposed two upstream operational bugs (compiler
PATH, then treating a legitimate PID-1 supervisor as an orphan). Neither changed
the canonical decoder. The final packaged-image and HTTP gates must pass before
upload/deploy. Live deployment and owner activation require their own evidence;
this README is not a deployment receipt. Real 300-photo timing/accuracy results
have not been claimed.
