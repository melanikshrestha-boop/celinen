# Client gallery milestone — 2026-09-13

## Implemented in this checkpoint

- Existing Delivery controls now offer gallery-scoped font (workspace / clean sans / editorial), theme (visitor / light / dark), even or natural-proportion grids, and compact or comfortable spacing. Studio and the marketing shell are unchanged.
- Up to three cover photos, bound to immutable **version IDs**. Only verified versions belonging to this gallery can be selected. Clients see only currently published cover versions. Publishing a replacement never substitutes it for the chosen cover. No arbitrary CSS, tracking URLs, remote font loaders, or customer originals are added.
- Optional selection deadline and an editable maximum selection count, in the existing creation/settings flow. The server clock rejects new picks, unpicks, and submissions at the cutoff. Saved picks/history survive. Comments, approvals, and released downloads remain available until gallery expiry.
- Only the photographer can extend/clear a deadline. Submitted selections require an explicit reopen before request changes, and the limit cannot drop below saved picks. Reopening still pauses final downloads; extending an unsubmitted request does not silently approve/release anything.
- A device draft may connect after its selection window closes: its original, expired deadline is retained. This does not reopen selection. The new-gallery UI prevents accidentally choosing a past deadline; an explicit owner extension is required after the cutoff.
- Metadata persists in existing account-scoped local drafts and remote JSON state. Local presentation/request saves use independent compare-and-swap transactions; stale upload refreshes preserve both. No destructive migration.

Existing full/web-size final downloads, immutable approvals, private invitations, photo comments and selection exports remain in place. Their existence is not proof that the production backend or provider accounts are configured.

## Verification

- `bun test tests/delivery-*.test.ts tests/delivery-*.test.tsx`: 157 passed, including real workflow transitions and isolated server-transport tests. No customer libraries used.
- Production build succeeds. Targeted source lint succeeds. Full typecheck still reports 152 repository errors, outside the changed gallery files.
- Full regression run with ephemeral loopback servers allowed: 2,596 passed, 21 skipped, 1 todo, 5 existing appearance assertions failed. Subsequent deadline-adoption and viewport-theme regressions add two targeted passing tests. The earlier sandboxed run also blocked six loopback transport tests; it is not the release result.
- Real browser fixture at isolated `127.0.0.1:8086`: saved choices/deadline survive reload, account and stale-tab writes are rejected, stale upload refreshes preserve settings, photo/feedback state remains unchanged. Checked desktop light/editorial, phone dark/sans, viewer theme and arrow-key navigation, and no horizontal overflow at 390px. Explicit client-page appearance also covers the outer viewport, so a visitor's dark preference does not leave black gutters around a light gallery; owner previews do not recolor the workspace.
- These are gallery metadata/presentation tests using public JPEG fixtures, **not** a RAW ingest benchmark, payment test, email-delivery test or live publication proof.

### Reproduce the browser fixture

Run normal Vite on isolated port 8086 (`vite dev --host 127.0.0.1 --port 8086 --strictPort`). Open that origin in an isolated browser profile; wait for app hydration/network idle. In that test browser:

```js
await (await import('/tests/fixtures/delivery/design-preview.tsx')).mount()
await (await import('/tests/fixtures/delivery/design-preview.tsx')).checkStorageBoundaries()
```

After a reload or HMR refresh, wait for hydration before mounting again. Wait for fixture images to decode before capturing screenshots. The fixture refuses production and customer lab port 8085; it is not a production route. It uses only its own gallery ID and public test images. Never seed QA records into a customer origin/profile.

## Remaining work — do not advertise as available

1. **Named collaborators and selection requests:** per-participant identity, scoped/revocable invitations, audit attribution, assignment status, pinned coordinates tied to immutable versions, and private reference attachments. Current private links share one client identity and one selection set; no separate-user collaboration claim.
2. **Real print/book commerce:** choose and connect a licensed fulfillment provider; model products, dimensions, crops/bleed, print-resolution warnings, shipping/tax quotes, authenticated checkout, payment webhooks, idempotent order submission, refund/cancellation handling and provider readback. No invented checkout links or simulated successful purchases. Dynamic physical-scale previews need actual product dimensions.
3. **Sales automation:** explicit recipient/marketing consent, suppression/unsubscribe, verified sender setup, durable jobs, retry/idempotency and actual order attribution. No emails or reminders are sent by this checkpoint.
4. **Desktop uploader and production C++ service:** continue the Linux parity gate and authenticated, bounded processing service. Current Linux prototype has unresolved output differences; do not release it or claim 800+ photos/minute from gallery UI tests.
5. **Shared boards and Figma:** separate permissioned board/asset API with subscriptions, revocation and exportable rendition rights, then a real Figma plugin. Do not treat installing another company's plugin as Celinen implementation.

## Release boundary

No paid service was purchased, provider connected, real client invited, customer photo published, or production site deployed in this checkpoint. Git and Lovable publication remain separate. Gallery source can be shipped independently of the uncommitted Linux prototype only after reviewing the full release branch and its existing failures. Live end-to-end proof still requires the configured private backend and an explicitly published Lovable build.
