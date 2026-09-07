# Plain-English editing and client workflow — 2026-09-04

## Product boundary

Keep the existing Lovable layout. The Studio's assistant, contact sheet and loupe
stay in their existing columns. Plain-English editing is promoted within the edit
desk; manual adjustments remain under “Fine-tune manually”. Culling decides what
deserves further work; editing changes the look only after the photographer approves.

The user's Photo Mechanic / Imagen description establishes this workflow, but does
not define a numerical “90%” benchmark. No AGI, world-fastest, selection-accuracy or
production-readiness score is claimed.

## Try in local Studio

- “Make this brighter and warmer.”
- “Make my keepers warmer but keep them natural.”
- “Make this black and white.”
- “Keep the top 40.”
- “Open frame 3000.”

Recognized editing requests produce a reversible proposal. Preview the before/after,
choose the previewed photo, keepers or whole shoot, then apply or discard. Photos are
identified by fixed IDs and the single-photo preview names its target. Applying while
viewing another frame first returns to an affected preview and requires another explicit
acceptance. A changed batch membership, manual pick or edit invalidates a stale proposal.
Acceptance also requires the affected photo to have rendered successfully; a pending
or failed decode cannot leave a different photo visible and still authorize Apply.
Exports wait until the proposal is applied or discarded. Undo restores prior metadata;
original files are never modified. Pending previews and undo history are not persisted
across reload; accepted edits and picks are.

The local language interpreter is a finite, tested phrase-to-adjustment planner, not
an open-ended visual agent. It supports whole-photo light/color adjustments, fixed
looks and centered crop presets. “Natural” means a gentler adjustment, not protected
skin tones. Object/background removal, athlete/jersey recognition, subject masks,
reference-style matching and deblurring are unsupported and refused without applying
a partial command. Negations and ambiguous restrictions are refused atomically.
The optional hosted planner receives metadata, not visual understanding; it stops
after a preview or failed tool. No new AI provider or paid service was enabled.

## Clients → booking → delivery preview

Local Clients starts empty, with real saved lead records rather than demo contacts.
Track acquisition source, contact details, creative brief, next follow-up date,
stage and optional exact-cent budget. Add bookings and manually record confirmation,
completion or cancellation. This records your agreement; it does not contact anyone.

Explicitly link existing gallery/invoice drafts by ID and inspect a read-only client
portal preview. Earnings can create invoice drafts using a selected CRM contact's
stable ID; legacy invoice-only contacts and old draft records remain compatible.
No inferred email matching links financial or delivery records.

Client records use versioned local storage with Web Locks and revision checks.
Malformed, partial or stale snapshots fail closed instead of replacing saved data.
The portal is device-local: no public URL, invitation, email, client authentication,
payment collection or deployment is part of this release.

Cloud code was also tightened: unassigned guest requests cannot be listed or claimed
by an arbitrary studio, gallery attachment requires ownership, and client-account
linking requires a confirmed email with literal comparison and race-safe predicates.
These changes were tested locally, not against a live database. Public intake routing,
RLS validation and authenticated portal end-to-end testing remain release gates.

## Verification

- 209 unit tests; TypeScript, scoped ESLint and production build pass.
- Synthetic 3,000-photo import, preview-only persistence, before/after pixel changes,
  named-photo acceptance guard, batch apply/undo, keeper protection, cull accept/undo,
  frame-3000 navigation, HMR/reload restoration and unsupported-command refusal checked
  in an isolated browser. See SPORTS-CULLING.md for measurements and their limits.
- Injected a synthetic decoder failure: the stale canvas was hidden and Apply refused;
  restored the decoder and reloaded the isolated test tab afterward.
- Isolated client flow: lead → confirmed booking → gallery/invoice links → portal
  preview → reload; Earnings CRM contact selection → invoice draft → reload. Exact
  $1,250.25 preserved. No client messages, payments or public sharing occurred.
- QA fixtures were created only in isolated test browser storage. No real shoot or
  client data was replaced. Existing dirty repository work remains uncommitted.
