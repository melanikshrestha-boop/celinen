# Delivery recovery component QA

This is a loopback-only test harness, **not the LensLabs application or a published client gallery**.
It mounts the production `DeliveryGallery` and the real delivery state machine with two synthetic
metadata records and the existing public-domain JPEG fixture. It imports no cloud RPCs, account
provider, credentials, or customer photographs. HTTP writes and network faults are simulated.

From the repository root:

```sh
bunx --no-install vite --config scripts/qa/delivery-recovery/vite.config.ts
bun scripts/qa/delivery-recovery/check.ts /absolute/path/to/browse
```

The server binds only `127.0.0.1:8086` and refuses another port. The configured CSP limits network
requests to that origin; local blob workers support the existing export code. Keep the normal
development lab on 8085 untouched. Open `http://127.0.0.1:8086/`, never the `file://` HTML.

The check uses real component buttons at 390×844 and 1440×1000. It verifies separate photo notes,
change-request intent, reload recovery, offline send, lost-success receipt reconciliation, explicit
version carry-forward, edits made while a send is pending, replacement-invitation isolation,
storage failure feedback, scroll-reachable mobile actions, overflow and console errors. Each run
removes only this fixture's named session records on the QA origin. No real shoot storage is read.

Screenshots are written under `/private/tmp/lenslabs-delivery-recovery-*.png`. The gallery's session
storage is temporary, tab-local composition recovery, not the source of truth for submitted notes.
The fake transport persists only the named synthetic room so reload behavior can be exercised.

This does not verify actual iOS/Safari, a mobile keyboard, device storage eviction, network uploads,
Supabase deployment, real sign-in, or real client delivery. Keep those as separate release checks.

## Studio feedback reference

`http://127.0.0.1:8086/handoff.html` mounts the production `CullChat` and `DeliveryReference`
components with synthetic project metadata. It uses the actual handoff validation and temporary
session storage. The account provider is not mounted, and no credentials, cloud transport or
real shoot storage are used. The deliberately hostile sample comment tests plain-text rendering;
it is not an instruction. The fake action callback records only explicit QA chat commands.

```sh
bun scripts/qa/delivery-recovery/check-handoff.ts /absolute/path/to/browse
```

Fourteen browser checks cover matching-version labels, unresolved request counts, collapsed
references, changed adjustments, source-photo focus, account mismatch, long/Unicode notes,
escaped client markup, absence from chat history/input, explicit-only action execution, phone
composer reachability, desktop rail width, black/light views and console errors. Screenshots
are `/private/tmp/lenslabs-studio-handoff-{mobile,desktop,light}.png`.

This is component integration QA, not an authenticated Delivery-to-Studio cloud roundtrip or a
full-workspace layout test. Named-project handoffs remain local-only; real-device and release
verification are separate gates.

## Culling/edit approval basis

`http://127.0.0.1:8086/proposal.html` mounts the production `CullChat`/`ProposalReview` with the
real proposal builders and atomic apply helper. Two synthetic metadata frames stay entirely
in memory; no source image is decoded, no account is mounted and no shoot storage is accessed.

```sh
bun scripts/qa/delivery-recovery/check-proposal.ts /absolute/path/to/browse
```

Eleven browser checks verify explicit approval, a newer decision on an unchanged compared frame,
same-name/size/timestamp source replacement, readable stale-preview recovery, discard, fresh
approval, selected-photo isolation, thumbnail refresh/reordering, mobile fit, desktop rail width,
black/light themes and a clean console. Screenshots are
`/private/tmp/lenslabs-cull-basis-{mobile,desktop,light}.png`.

The fixture substitutes only local state callbacks. It does not exercise the full Studio route's
render-readiness fence, persistence/undo, C++ analysis, source decoding, cloud accounts or real
device behavior. Those remain separate checks; these synthetic fixtures are not an accuracy or
RAW-processing benchmark.
