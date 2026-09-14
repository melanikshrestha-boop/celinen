# PostHog: consented photography lifecycle

Project **607971**, US Cloud (`Default project`). This is source integration,
not a live deployment or evidence of real-event ingestion. The owner approved a
photography-only push with subscription producers explicitly blocked.

## Actual producers

| Event | Source of truth and limits |
| --- | --- |
| `app_opened` | Verified, non-lab account + accepted analytics consent, once per mounted analytics session. Anonymous/lab visits are not tracked. |
| `signup_completed` | Explicit successful password-signup response with returned identities, then matching verified account. Memory-only marker expires after 30 minutes. Unconfirmed accounts, restored logins, OAuth/magic-link inference and cross-tab confirmation are not counted. |
| `shoot_created` | First durable named/populated local shoot-directory entry, excluding device recovery. Separate consented ledger deduplicates UUIDs. |
| `second_shoot_created` | Second distinct **consented creation observed on this browser**, not lifetime or cross-device account history. Retention dashboards should also count distinct `shoot_created.shoot_id` per opaque identity. |
| `import_started` | Original drop/file-picker event, before enumeration. |
| `import_completed` | Successful coordinator settlement including final durable journal. A settled batch may include individual decode failures/duplicates: not a claim every file saved. Cancellation/quota/final-journal failure do not emit completion. |
| `decode_failed` | Aggregated preview/decode attempt failures at import settlement, excluding cancellation. `photo_count` is failed-attempt count. No error text/source names. Fingerprint/sidecar/storage errors are not mislabeled as decoder errors. |
| `cull_started`, `cull_completed`, `cull_failed` | Actual import-analysis/cull and explicit suggestion calculation. Completion means computation/proposal ready, not acceptance or durable save. Partial analysis failures emit an aggregate failure; all-failed retries do not report completion. |
| `first_select_shown` | First recommended keeper rendered in Studio's visible loupe, once per cull run. Timing starts at **cull operation, not drop** and includes time until the user views it. Not a model latency benchmark. |
| `burst_opened` | Successfully grouped, rendered comparison page, including adjacent-group navigation. Loading/error dialog alone does not count. |
| `keeper_accepted`, `keeper_overridden`, `reject_overridden` | Actual K/X/pick or accepted proposal compared with recommendations produced in this view. Restored manual picks are not invented AI recommendations. Discarded proposals lose attribution. Actions, not save acknowledgments. |
| `export_started`, `export_completed` | Confirmed Develop image export and Studio originals-keeper ZIP. Completion requires available bytes and browser download invocation, not proof of OS save. Preview/navigation, metadata-only exports and gallery publishing are not counted. |
| `subscription_started`, `subscription_cancelled` | **Unwired.** Checkout creation exists, but no verified Lenslab subscription lifecycle/ownership/cancellation producer. No redirect, success query or photographer Connect invoice is subscription evidence. |

## Privacy and isolation

- Existing `foto_consent=accepted` required on every send. Nothing queued before
  consent, no retrospective replay. Verified account switches close the old client
  synchronously. Async operations retain exact session-generation fences, even A→B→A.
- Revocation aborts requests, queues, pending analytics transactions and signup
  markers. Same-origin tabs receive a consent-change BroadcastChannel signal;
  unsupported browsers also check cookies per send and reconcile on focus. Bytes
  already transmitted cannot be recalled.
- No PostHog SDK, autocapture, replay, DOM/canvas/screenshots, console capture,
  automatic URLs/referrers or arbitrary exceptions. All viewers/inputs are excluded
  because there is **no recorder**, not merely CSS masking. Leave project replay OFF.
- Opaque authenticated UUID is `distinct_id` and `user_id`. Never email. No profile
  objects, photo pixels, thumbnails, filenames, local paths, captions, client names
  or auth tokens in events. Caller identity overrides are discarded.
- Strict numeric/enum/UUID allowlist. `camera_category`, OS, architecture and sport
  are allowed enums but omitted without trustworthy source data. Cull receipts map
  explicitly to `native-cpp-v1`, `browser-v1`, or `mixed-v1`; missing receipts omit
  domain. V1 is never labeled V2.
- `processing_ms` is monotonic operation timing. Import `photos_per_second` is
  saved entries / end-to-end import duration, **not decoder throughput**.
- Four in-flight requests, 128 sanitized memory-only waiting events, two-second
  deadline, no retries/disk event queue. Capture timestamp precedes queuing.
  Over-capacity/network events may be lost: not a financial/audit source of truth.
  Batch review actions aggregate by event with `photo_count`/`manual_overrides`;
  dashboards must sum those counts, not treat each event as exactly one photo.
- Separate `lenslabs-consented-product-milestones-v1` IndexedDB stores only opaque
  account/shoot UUID deduplication and count capped at three. Never writes photo
  stores. Missing/disabled config creates no analytics ledger. Browser reset can
  restart the observed milestone. Committed markers remain after revocation;
  future capture stops. Marker commit followed by network failure may lose an event.
- GeoIP/person-profile processing disabled. Browser credentials/referrer omitted.
  PostHog still sees normal network metadata. Public write-only project token is
  only in the API envelope, never event properties; never a personal API key.

## V2 remains unavailable to customers

Flag `canonical_decoder_v2`, ID **883838**:
https://us.posthog.com/project/607971/feature_flags/883838

September 13 readback returned both `status: ACTIVE` and `active: false`, rollout
0%. These are different fields. **No flag setting changed.** Analytics does not
evaluate this flag or start native processing.

Canonical contract remains unqualified: deployment/customer authority/export false.
No production V2 worker/auth adapter exists. Future processing must require BOTH
PostHog eligibility AND `LENSLABS_CANONICAL_V2_ENABLED=true`, plus server-side
ownership/authorization. Missing/false switch must deny V2; PostHog cannot bypass
the server or parity gates.

No decoder/model/score/threshold/V1 recipe/original/export bytes/UI design changed.
Nothing deployed; no synthetic event sent to project 607971.

## Build environment still required

Securely set these in the environment that actually builds `lenslab.dev`:

```text
VITE_POSTHOG_ENABLED=true
VITE_POSTHOG_HOST=https://us.i.posthog.com
VITE_POSTHOG_KEY=<project 607971 write-only project token>
```

Only these variables configure analytics. Do not paste/commit the token or use a
personal API key. The Codex connector does not install Vite build variables. They
must exist **before build**. Git push is not Lovable publication. Do not publish
until build configuration is confirmed.

### Verify real ingestion after approved, configured publication

1. Open `https://lenslab.dev`, accept analytics cookies, sign in with a verified
   account and open the workspace. Anonymous 8085 lab cannot prove this event.
2. Inspect Network POST `https://us.i.posthog.com/i/v0/e/`: `app_opened`, opaque
   identity, no filename/URL/email/photo properties. Do not copy token into reports.
3. In project **607971 → Activity / Events**, filter `app_opened` and the exact
   opaque account ID/time. Network success alone is not stored-event evidence.
4. Reject consent and repeat an action: no new captures. Switch accounts: no old
   identity or late results may leak into the next account.
5. With a disposable QA shoot, verify import → cull → rendered keeper → accept/
   override → confirmed download, then create a second distinct shoot.
6. Once real events arrive, build Activation, Retention and Performance/trust
   dashboards. Do not chart unwired subscriptions or label browser-observed
   second-shoot milestones as global lifetime retention.

## Reproducible checks

```sh
bun test
bun run build
bun test tests/product-analytics.test.ts tests/product-lifecycle.test.ts tests/product-studio-lifecycle.test.ts tests/develop-import-session.test.ts tests/develop-dialog-navigation.test.ts tests/canonical-v2-isolation.test.ts
bun scripts/check-product-milestones.ts /absolute/path/to/fake-indexeddb/build/esm/index.js
```

Persistence simulator pinned to `fake-indexeddb@6.2.5` in a temporary QA directory;
no new application dependencies. Synthetic files, offline transports and isolated
in-memory databases only. Final results and exact files: `POSTHOG-HANDOFF.md`.

## Remaining blockers

Authoritative backend producers for subscriptions and complete OAuth/email signup
coverage; build configuration; approved publication; real-browser consent/network
validation and stored-event readback. Cross-device retention needs real events
from those devices. Authenticated V2 staging is separate work, not authorized here.

References: https://posthog.com/docs/api/capture and
https://posthog.com/docs/feature-flags/phased-rollout
