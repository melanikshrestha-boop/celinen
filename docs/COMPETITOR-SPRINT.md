# LensLabs: culling and client-delivery sprint

Started 2026-09-07 09:33 UTC. Stop by **2026-09-08 09:33 UTC**.
User authorized a separate no-sign-in development workspace and a day of competitor research,
implementation, testing, and deployment. The first three hours prioritize understanding actual
Aftershoot and Pixieset workflows. This is a bounded sprint, not a claim of full product parity.

## Latest user priority: Codex-style Settings

The user subsequently requested the Settings layout from their Codex screenshots, adapted to
photography, with a **Celine Nova development persona only**. Implemented locally on the existing
8085 server; real account authentication and the public signup design are unchanged. Do not
revert this work during the competitor sprint. See `docs/SETTINGS-REFINEMENT.md` for controls,
verification, and explicit native/cloud limitations. Changes in this pass have not been published
to production. Keep the separate local development link available for the user.

## Working link and isolation

- **http://127.0.0.1:8085/workspace** is the actual LensLabs application, not a QA HTML mockup.
- Start with `bun run dev:lab`. Keep the retained server alive for the user's testing.
- Loopback-only, exact host/origin checks, separate browser origin and device-local data.
- No Supabase identity, real credentials, cloud sessions, cloud calls, OAuth, or server-function
  endpoints in this mode. Local imports, culling, edits, chat history, settings, and delivery drafts
  use existing product implementations. Original source files are never overwritten by import.
- A page reload preserves previews and decisions; original file handles may need reconnecting.
- Public client links, shared comments/approval, payments, provider connections and cloud publishing
  still require the real signed-in website. A local gallery preview is not a shared client gallery.
- Normal `vite.config.ts`, AccountProvider, Supabase client, and `app-mode.ts` are unchanged.
  The lab config refuses all builds. Never add an auth-bypass query parameter or production flag.
- `scripts/qa/commerce/index.html` is a test fixture entry, not the website. Do not hand it off again.

## Pass 1: implemented / verification

- Separate dev-only provider, local SDK endpoint with networking disabled, production-excluded
  Vite transform, loopback Host/Origin validation, restrictive connection policy, blocked cloud RPC.
- Verified normal production build contains none of the lab identity/provider markers.
- Explicit attempt to build the lab correctly fails before producing a deployable bundle.
- Browser: opens without authentication; imported generated `auth-lens.jpg`; renamed the shoot
  `Lab QA — lens test`; reloaded and recovered its name/preview; New chat creates an empty shoot
  while the prior shoot remains in Recent Shoots. Chat can submit and Delivery opens in a shoot tab.
- Created `Lab QA — delivery draft` for `QA only — no client`, on this device only.
  Prepared the generated lens JPEG; reloaded, reopened the draft, and recovered its local preview.
- Settings: saved a synthetic local profile, switched to Light, reloaded, and read back both the
  saved name and light theme without horizontal overflow. No real account was edited.
- Device-local delivery no longer probes cloud readiness before sign-in. This removes expected
  blocked RPC errors while preserving the signed-in readiness check; stale failures are fenced.
- Live HTTP checks: workspace 200; cloud RPC, OAuth, API and cross-origin requests 403. Raw `curl`
  forged Host check returns 403. Node fetch ignored the custom Host header in this environment,
  so use a raw HTTP client for that assertion. Listener verified as `127.0.0.1:8085` only.
- Normal app browser test: `http://localhost:8080/workspace` redirects to
  `/auth?next=%2Fworkspace&mode=signup`, with the real email field visible. No authentication bypass.
- Mobile browser check at 390×844: composer visible, Black view restored, no horizontal overflow.
  Desktop and mobile screenshots inspected; evidence in `/private/tmp/lenslabs-lab-desktop.png`
  and `/private/tmp/lenslabs-lab-mobile.png` (temporary, not customer assets).
- 807 tests pass / 0 fail / 185,700 assertions. Typecheck, changed-source lint and production build pass.
  This is not 185,700 end-to-end trials or a real 3,000-RAW accuracy benchmark.
- Fixed an existing probabilistic test: token tampering sometimes replaced `Z` with `Z`, making
  the mutation a no-op. It now always changes the character; encryption implementation unchanged.
- In-app browser service unavailable. Open-in-Codex queued; headed browser handoff failed.
  Fallback `open http://127.0.0.1:8085/workspace` succeeded. Browser QA used isolated Chromium.

## Evidence ledger (first research pass)

Sources below were read on September 7, 2026. Product claims are not independent benchmarks.
No competitor account created, no trial purchased, no customer photos uploaded.

### Aftershoot

- [Official culling workflow](https://support.aftershoot.com/en/articles/5223473-get-started-with-aftershoot-culling):
  import includes RAW/JPEG, subfolder choice and memory-card backup options. Automated mode suggests
  selections; assisted mode groups duplicates and shows scores/key faces without assigning ratings.
  Grid, Loupe and Survey support review. Target culling, existing ratings and export destinations
  matter as much as raw analysis. Preserve photographer picks rather than silently replacing them.
- [Product tour](https://aftershoot.com/product-tour/) and
  [Galleries](https://aftershoot.com/galleries/): current scope also includes editing, retouching,
  delivery, proofing, photo discovery and print sales. Treat offline claims, accuracy, speed,
  storage/pricing and fulfillment quality as unverified until measured or independently checked.
- Hands-on attempt: loaded product-tour page in Chromium, entered the iframe titled
  `Self-guided demo of the Aftershoot platform`. Its Supademo embed requires an email before
  Get Started; Previous/Next are disabled. Did not submit the user's email or bypass this gate.
  Embed observed: `https://app.supademo.com/embed/cmchk0vwn036u2b0ix4xas5m4?embed_v=2`.
- [Official culling guides](https://support.aftershoot.com/en/collections/2941484-aftershoot-culling-guides):
  next targeted reads are blur preferences, keeping Lightroom/Capture One ratings, flags,
  low-storage handling, people filters and exporting.
- [Aftershoot Academy: full workflow](https://www.youtube.com/watch?v=hm0spiL7s9E), February 23, 2024:
  indexed description and chapters read, **not watched**. Chapters cover import (00:06), culling
  (01:15), editing (03:26), Adobe export (04:36), computer export (08:13).
- [Aftershoot Academy: beginner culling](https://www.youtube.com/watch?v=GUFMHp_ejVg), April 29, 2024:
  indexed description read; direct video fetch failed. Do not treat this older tutorial as proof of
  current UI. Transcript/video inspection remains outstanding.

### Pixieset

- [Proofing with Favorites](https://help.pixieset.com/hc/en-us/articles/115003733131-Using-favorite-lists-for-client-proofing):
  lists are email-associated; clients can maintain multiple lists, rename/share them and signal
  completion. Preset lists support limits/instructions; notes attach to favorited photos.
- [Photo notes](https://help.pixieset.com/hc/en-us/articles/115003733191-How-does-my-client-add-a-note-or-a-comment-on-a-photo):
  clients access a Favorites list before adding notes. Opportunity to test in LensLabs: direct
  photo-specific revision requests that do not require first making the photo a favorite.
- [Photographer Favorites activity](https://help.pixieset.com/hc/en-us/articles/115002991071-How-can-I-review-my-client-s-Favorite-Activity):
  workflow includes notes, filename/CSV export, Lightroom handoff, copying to sets, and downloads.
- [Download experience](https://help.pixieset.com/hc/en-us/articles/115003594212),
  [download limits](https://help.pixieset.com/hc/en-us/articles/115003008091), and
  [expiry reminders](https://help.pixieset.com/hc/en-us/articles/115003009131-How-do-I-send-automated-expiry-reminder-emails-to-my-clients):
  preserve client clarity around PINs, ZIP readiness, resolution, expiry and limits. Summaries read;
  detailed edge-case comparison still outstanding.
- [Official demo](https://demo.pixieset.com/) and [examples](https://pixieset.com/example/):
  public demo exists across weddings, real estate, commercial, portraits, families and travel.
  No private galleries or dashboard accessed.
- Hands-on attempt: opened `/jadenapartmentsnobhillsanfrancisco/` in Chromium. Cloudflare showed
  security verification, then "Verification successful. Waiting ..."; no gallery controls were
  available during inspection. Do not count this as testing Favorites, comments or downloads.
- [Getting started tutorial](https://help.pixieset.com/hc/en-us/articles/36095928499469-Getting-Started-with-Client-Gallery-Tutorial-Video):
  chapter list read: upload, sets, design, settings, preview, sharing, client activity, homepage.
  Embedded Vimeo 1078378788 was fetched but returned no transcript. **Not watched.**
- [Proofing tutorial](https://help.pixieset.com/hc/en-us/articles/4407465730317-Proofing-with-Favorites-Tutorial-Video):
  chapter list read: Favorites settings, client experience, photographer activity, preset list.
  Embedded Vimeo 1007070517 not retrievable. **Not watched.**
- [Client-facing YouTube walkthrough](https://www.youtube.com/watch?v=3w89q7bdSXI): discovered;
  direct fetch failed. Await accessible video/transcript before deriving additional claims.

## Prioritized next passes (do not mark done without evidence)

### Pass 2: review metadata and handoff research (September 7, 2026)

Source-based findings, not hands-on competitor claims:

| Workflow | Evidence | LensLabs implication |
| --- | --- | --- |
| Existing photographer ratings | [Aftershoot's XMP handoff guide](https://support.aftershoot.com/en/articles/9190048-how-do-i-keep-my-stars-colors-when-i-bring-my-images-from-lightroom-or-capture-one) requires metadata writes before transfer and re-reads afterward. | Keep source stars/labels independent of analysis scores and culling picks. |
| Independent manual selection | [Aftershoot Flags and Linear Culling](https://support.aftershoot.com/en/articles/11533864-faq-flags-linear-culling-what-changed), dated May 22, 2026, describes manual flags, export by flags, and combined review filters. | An explicit reject must outrank a high source star rating; first-pass proposals must protect it. |
| Creative blur | [Aftershoot blur settings](https://support.aftershoot.com/en/articles/6508135-get-the-correct-blur-settings) distinguishes lenient, moderate and strict preferences for different photographic intent. | Do not infer creative intent from sharpness alone. Existing protected picks remain protected; a validated intent-specific mode remains open work. |
| Client selections into an editor | [Pixieset Lightroom Copy List](https://help.pixieset.com/hc/en-us/articles/115003505192-Viewing-Client-Favorites-in-Lightroom) documents partial-filename matches and virtual-copy caveats. | Audit exact source IDs/version mapping before adding copy lists; basename-only matching can choose the wrong frame. |

- Adobe's [XMP Basic namespace](https://developer.adobe.com/xmp/docs/xmp-namespaces/xmp/) defines
  ratings as -1 (rejected) or 0–5 (0 unrated). LensLabs now validates that range. Rejection is
  exported through the separate pick flag; -1 is not sent into Lightroom's catalog star field.
- A newer [Aftershoot walkthrough](https://www.youtube.com/watch?v=pbuyqWMyb9A), indexed as June 25,
  2026, was discovered; direct video open failed. No watched-video claim. The [Pixieset Lightroom
  Favorites video page](https://help.pixieset.com/hc/en-us/articles/4407465609613-How-do-I-view-my-client-s-Favorites-in-Lightroom-Tutorial-Video)
  was read but did not yield a transcript. Existing gated public demos were not repeatedly retried.

Implemented in this slice:

- Corrected import precedence: an explicit rejected pick no longer becomes a keeper because it
  has 3–5 stars. Applied to both XMP ingest and the existing Lightroom bridge.
- Exported stars come from imported review metadata, not the machine score. Unrated stays zero.
  A rescued XMP rejection exports as an un-rejected zero-star pick instead of conflicting flags.
- Canonical Adobe attribute/element ratings and picks accept single quotes and whitespace;
  invalid/out-of-range scalars do not become picks. Source color labels survive and XML-escape.
- Existing first-pass, proposal, reconnect, original-byte, account and Studio layout behavior
  is preserved. No new UI panel, authentication change or pixel-processing implementation.
- Scope caveats: this remains the existing limited Adobe-sidecar importer/exporter, not a lossless
  general XMP editor. Unrecognized edit fields and namespace aliases are not newly supported.
  Export status warns to back up existing sidecars before replacing them with this limited output.
  Real Lightroom/Capture One application roundtrips remain untested.

Validation: 831 tests pass, 0 failures across 48 files; 186,029 assertions. TypeScript, changed-source
lint and production build pass. Sixteen new tests cover rejection precedence, source ratings,
labels/escaping, malformed scalars, proposals and reconnect. Actual isolated-browser import of
the generated lens JPEG plus a synthetic 5-star/rejected XMP showed Reject selected, 5★ and the
custom label, all preserved after reload. QA shoot `36688a73-3ed0-4f51-ba3d-913630423c03`;
no user/client photos used. Browser evidence: `/private/tmp/lenslabs-metadata-reject-qa.png`.
The existing chat command `write xmp sidecars` requested one local download and displayed the
limited-metadata warning; file contents were covered by unit roundtrips, not a real Lightroom app.

Release: implementation commit `02d877875fb4356efd7e35ab984255c6306f504c` was pushed to the existing
`origin/main` and confirmed with `git ls-remote`. This includes the preceding validated Settings
slice. `.env.development` remains the only unrelated local modification and was not committed.
**Source sync only: production Publish and live website verification have not occurred.**

## Pass 3: folder-preserving sidecar export (2026-09-07)

Research read this pass:

- [Pixieset's Lightroom upload guide](https://help.pixieset.com/hc/en-us/articles/115003504512-How-do-I-upload-from-Lightroom)
  describes Collection/Set hierarchy, re-publishing edited images and duplicate-filename detection.
  Its structure-only sync does not synchronize uploaded/removed photos. These are documented
  behaviors, not hands-on claims about the gated application.
- [Aftershoot's missing-source guide](https://support.aftershoot.com/en/articles/6673089-no-smart-previews-or-raws-found)
  explains how catalog paths determine where originals are sought, and asks photographers to verify
  renamed sources against their previews. Inference for LensLabs: a filename alone is insufficient
  evidence for applying metadata to the correct photograph. No additional video was watched.

Implemented behind the existing Studio menu and chat command:

- One `LensLabs-sidecars.zip` preserves imported folder paths; no per-photo download burst or
  flattening. Original files and existing sidecars are not written to or read by the export planner.
- All-or-nothing validation runs before creating the ZIP/download. A shared basename with different
  exported picks, supported edits, stars or labels fails clearly. Identical metadata for exact-path
  RAW/JPEG companions produces one sidecar; unreviewed/unreadable companions block that target.
- Case/Unicode aliases, unsafe/absolute/traversal paths, portable filename limits, folder/file name
  collisions, and case-aliased folders are rejected rather than silently renamed. Full original
  path text is retained for valid international filenames; shared ZIP headers now flag UTF-8.
- Bounded to 20,000 source records and a 32 MiB generated archive. Status explains separate
  extraction, matching paths and backup before manually replacing any existing XMP.
- Existing limited XMP compatibility is unchanged: unsupported edits/crops/masks are not magically
  made lossless. Real Lightroom/Capture One end-to-end import still needs a licensed-app check.

Validation: **848 tests pass**, 0 failures, 49 files / 186,120 assertions; 17 added regression tests.
TypeScript, changed-file lint, production build and diff whitespace checks pass. Production output
has no Celine/lab-origin identity markers. No dependency, authentication or Studio layout changes.

Actual isolated browser QA imported two copies of the generated lens JPEG under separate camera
folders, including an accented/emoji folder, with different synthetic XMP stars/picks/labels.
The real chat export requested one ZIP. Its 1,393-byte generated Blob was captured using temporary
local instrumentation forwarding the native download unchanged; `unzip -t` passed, and archive
metadata readback showed keep/2 stars and reject/5 stars with their separate labels and paths.
The system CLI's filename display is locale-limited; UTF-8 bytes and header flags are independently
covered by tests. This is verified browser-generated output, not a claim about an editor import.
An initial attempt to fetch a Blob URL for inspection was correctly rejected by the lab's CSP;
the CSP was not changed. A later conflicting `.jpeg` companion showed the expected error and
**zero download anchors**. Reload removed all instrumentation and retained the three QA frames.
No runtime errors after reload; the existing canvas readback performance warning remains.
Evidence: `/private/tmp/lenslabs-sidecar-conflict-qa.png` and
`/private/tmp/lenslabs-sidecar-verified.zip`. No customer photographs or real account data used.

Release gate: this pass and the previous progress-note update remain **local and uncommitted**.
A policy check rejected the previous documentation commit/push to `main`; explicit approval was
requested and has not arrived. Do not retry that push or substitute another remote write to bypass
the gate. Preserve `.env.development` unchanged. The previous `02d8778` source sync is not a
production Publish; no deployment was performed in this pass.

## Pass 4: folder-matched Lightroom bridge (2026-09-07)

Completed the pending Lightroom-matching slice after the Settings refinement, preserving both
sets of local changes. Research this pass was source-based, not new competitor hands-on access:

- Re-read [Pixieset's Lightroom Favorites guide](https://help.pixieset.com/hc/en-us/articles/115003505192-Viewing-Client-Favorites-in-Lightroom):
  its Contains search may include partial filenames and does not distinguish virtual copies.
  LensLabs therefore requires folder paths and original extensions, rather than a name-only list.
- Re-read [Aftershoot's flags guide](https://support.aftershoot.com/en/articles/11533864-faq-flags-linear-culling-what-changed):
  manual flags participate in filtered export and Lightroom handoff. Preserve the photographer's
  explicit picks and stars as separate fields; do not convert an analysis score into stars.
- [Adobe's Lightroom Classic SDK overview](https://developer.adobe.com/lightroom-classic/)
  confirms Lua is the plug-in interface. The public SDK-console link yielded no readable reference,
  and the SDK-guide download timed out. No installed/real Lightroom catalog was exercised.
  No additional video was watched; the prior demo/access gaps remain, not completed research hours.

Implemented behind the existing Studio controls:

- Incoming matches use exact relative folder-path suffixes, including extensions. Windows and
  UNC separators work; case and Unicode normalization are not guessed. Loose files require
  re-importing the matching folder. Duplicate paths/virtual copies abort before applying metadata.
- Each incoming source is parsed once and indexed by requested suffix depths. All 5,000 records
  can share one filename without an all-pairs namesake scan. Unmatched photos stay untouched.
- The generated 1.3 plug-in preflights every outgoing target under the catalog write gate before
  metadata writes. Missing/ambiguous targets prevent the whole batch. Clearing a pick sets zero;
  source stars/labels are retained independently of the score. This is path identity, not a hash
  proof that a file at a matching path contains the same image bytes.
- The API and plug-in use a new `relative-path-v1` protocol. Older filename-only plug-ins and
  old queued verdict batches must be upgraded/re-published; they cannot consume the new batch.
- Studio blocks sync during pending edit proposals and rejects stale incoming responses after
  an intervening edit/shoot change. Queuing verdicts is reported as queued, not applied.
- Incoming/outgoing batches have a 5,000-record maximum with no silent truncation. Invalid stars,
  picks, source fields, captions and develop scalars fail validation. Whole stars are required for
  this Lightroom bridge; the separate XMP rating parser's numeric behavior is unchanged.
- Request bodies are bounded to 8 MiB before parsing, including chunked or falsely declared
  Content-Length requests. Malformed UTF-8 is rejected rather than altering source-path text.
  Workspace/kind/direction types are validated before account lookup. Existing token ownership
  checks are unchanged; the local no-sign-in lab still blocks the bridge entirely.

Verification:

- **884 tests pass, 0 fail, 53 files / 191,313 assertions.** 29 targeted bridge tests pass.
- Generated plug-in modules were parsed and executed with real Lua 5.1.5 against a synthetic
  Lightroom catalog harness, not a licensed Lightroom installation. A reversed 5,000-photo
  namesake catalog preserved each pick and star rating; a 5,001-frame batch produced zero writes.
  The combined two-batch fixture took about 299 ms in the focused local run, including JSON and
  subprocess overhead. This is not a RAW processing benchmark or Lightroom performance claim.
- Covered path segments, RAW/JPEG extension separation, Unicode, Windows paths, virtual copies,
  duplicate/missing targets, clearing picks, invalid fields, old protocol rejection, and streaming
  input limits. Full-suite HTTP fixtures required the existing sandbox exception for loopback
  binding; the restricted run's native-HTTP bind failure was not an application regression.
- Typecheck, changed-source lint, production build and whitespace checks pass. No new dependency,
  C++ processing change, Studio layout change, account migration or real photo mutation.

Release remains local and uncommitted under the prior explicit approval gate. Do not retry a
remote write or infer that a successful build is publication. Normal website and plug-in releases
must be synchronized before advertising the new bridge. Settings remain intact; `.env.development`
is unrelated and must not be staged or altered.

## Pass 5: truthful plug-in receipts and bounded response decoding (2026-09-07)

Closed the next local wire-protocol gap without changing Studio, signup, Settings or auth.

Reproduced in actual Lua 5.1.5 before the fix: the old codec removed null array entries, changed
escaped Unicode and control characters, rounded millisecond timestamps and develop numbers to
six significant digits, and accepted incomplete input or failed to terminate on malformed input.
The old push action also treated any non-empty HTTP body, including an error body, as success.

Implemented:

- A standalone generated JSON module preserves null entries/empty arrays, converts escaped
  Unicode and surrogate pairs to exact UTF-8, preserves double-precision numbers, and rejects
  malformed input, trailing junk, duplicate keys, non-finite numbers, invalid UTF-8 and unpaired
  surrogates. Encoding rejects cycles and mixed/sparse array tables. Decode/encode are bounded to
  8 MiB, 64 nesting levels and 250,000 values. No evaluation of server-supplied code is involved.
- The same-workspace, complete-count, positive-timestamp server receipt is required before a push
  reports that the bridge received photos. This is explicitly not a claim that Studio applied them.
  Invalid/error/read responses cannot masquerade as a valid empty queue. Valid empty queues tell
  the photographer to publish selections first. Remote error text/credentials are not echoed.
- Null labels keep the previous no-update behavior, while a null frame now fails preflight instead
  of disappearing and enabling a partial batch. Oversized selections stop before metadata writes.
- Added Stop live sync, a single shared watcher, and generation-safe stopping. An unconfirmed
  response pauses the watcher rather than making repeated silent requests. Stopping prevents future
  requests; an already in-flight request can still finish. Plug-in version is now 1.3.1.
- README now distinguishes catalog SDK updates, requested XMP writes and bridge receipt; removed
  the misleading claim that the plug-in never touches the Lightroom catalog.

Research: [RFC 8259](https://www.rfc-editor.org/info/rfc8259/) covers JSON grammar, character
escaping, interoperability issues with duplicate names/unpaired surrogates and parser limits.
The [Lua 5.1 manual](https://www.lua.org/manual/5.1/manual.html) documents protected errors and
array iteration stopping at missing keys. These informed the codec and its tests; no competitor
app/video was newly accessed or watched in this pass. The SDK/download access gaps remain.

Verification: **896 tests pass, 0 fail, 54 files / 191,347 assertions.** Twelve added tests include
600 deterministic nested JSON fixtures, bounded invalid-response checks, simulated HTTP receipts,
watcher lifecycle and actual generated Push/Watch/Stop execution. The 5,000-photo simulated-catalog
test still passes with null-entry preflight protection. These use synthetic metadata and SDK shims,
not a real Lightroom installation, catalog, server account or customer photographs. Typecheck,
changed-source lint, production build and whitespace checks pass. No new dependencies.

Release remains local behind the existing explicit approval gate; no push or production Publish.
The codec is bounded after the SDK returns an HTTP body; it does not claim to control the SDK's
network buffering or timeouts. SDK-thrown network errors, real catalog/disk failures and installed
Lightroom integration still need licensed-app verification. A hard SDK task exception may require
Stop live sync before restarting. Catalog/disk failures after preflight are not claimed atomic.

Next incomplete scoped item: inspect delivery revision handoff and mobile recovery with synthetic
photos. Real Lightroom/Capture One roundtrip, supported SDK verification and user-approved RAW
performance fixtures remain separate gates. Continue within the deadline and release boundary.

## Pass 6 — exact-version client notes and mobile recovery (2026-09-07, 15:41 UTC heartbeat)

Found a user-visible defect in the real gallery composer: changing photos reset the single
`Request a change` checkbox while keeping the note body. A client could unknowingly send an
ordinary comment instead of a revision request. Notes and retry IDs also existed only in React
memory, so refreshing a mobile tab could lose composition or turn a lost-success retry into a
second comment.

- Every note now retains its photo ID, immutable version ID, body, revision intent and retry ID.
  Switching photos no longer changes intent. Publishing a new version keeps the old note separate;
  the existing explicit carry-forward action moves its text and intent with a new operation ID.
- Client composition is recovered in session storage only after a valid invitation has loaded.
  It is scoped to gallery plus invitation generation, with no access token, media or account data
  in the note cache. A replacement invitation does not inherit the previous generation's notes.
  Owner/preview views do not gain persisted client drafts. Cloud comments remain authoritative.
- Writes happen with the edit, not after a delayed effect. Bounded validation rejects malformed,
  duplicated, cross-scope or oversized caches; quota failures retain in-memory text and show a
  warning. No truncation. Recovery is limited to 128 notes/1 MiB serialized per scope; larger
  in-memory composition is not falsely claimed saved. Browsers may still evict tab storage.
- Exact retry IDs survive reload. Returned server comments reconcile only the matching ID, version,
  photo, actor, body and intent. A late successful send cannot erase a newer text/checkbox edit.
  The real server's existing receipt gate was exercised with restored draft data: one revision,
  no duplicate, no fabricated approval or release. No API/schema/auth permission changes.
- Client gallery state is keyed by gallery and invitation generation. Old refresh completions no
  longer end the current loading state. Navigation with unsent composition gets the standard
  browser warning when supported. Studio/signup/settings layouts and saved shoots are unchanged.

Research: [Pixieset's photo-note help](https://help.pixieset.com/hc/en-us/articles/115003733191-How-does-my-client-add-a-note-or-a-comment-on-a-photo)
describes notes on favorite images and photographer review in Favorite Activity, including CSV
export. This supports prioritizing reliable photo-specific feedback; it is not evidence of how
Pixieset handles reloads or offline errors. No newly claimed hands-on competitor access or video
viewing in this pass.

Verification: **908 tests pass, 0 fail, 55 files / 191,407 assertions** with the existing Lua 5.1
runtime. Twelve added tests cover scoped note persistence, per-photo intent, exact-version moving,
late responses, receipt matching, invalid caches, storage limits and actual server replay through
the isolated fake Supabase transport. Typecheck, changed-source lint, production build and
whitespace checks pass. Production assets contain no QA harness, Celine lab identity or 8085 lab
markers. No dependency changes.

The new `scripts/qa/delivery-recovery` harness renders the production gallery component and domain
transitions with synthetic metadata and the existing public-domain image, behind a loopback-only
server with no cloud transport. Browser checks cover 390×844 and 1440×1000, real button clicks,
reloads, offline/lost/delayed responses, version carry-forward, invitation isolation, storage errors,
mobile scroll reachability and no horizontal overflow. The first reachability check incorrectly
scrolled the background page; scrolling the actual dialog verified the send button. Harness-only
hot-reload root cleanup and blob-worker CSP were corrected before the clean-console final rerun.
This is not a published gallery, real device test or end-to-end cloud delivery verification.

Release remains local behind the existing explicit approval gate. No commit, push or production
Publish was attempted. The 8085 development lab is preserved; the temporary 8086 QA server is
stopped after verification. Real iOS keyboard/storage behavior and authenticated cloud delivery
remain unverified. Next scoped item: carry the client's exact-version revision summary into the
existing Studio handoff without automatically applying an edit or changing the interface.

## Pass 7 — exact-version feedback beside the Studio source (2026-09-07, 16:41 UTC slice)

The existing owner action **Open in Studio** now carries a read-only feedback snapshot into the
existing Assistant rail. This is an enhancement of the local named-project handoff, not a new
cloud-project capability. Production named-project restrictions and authentication are unchanged.

- The snapshot contains only the selected delivered version's comments, change-request intent,
  resolution state, gallery revision and capture time. No media, invitation capabilities, access
  tokens or client text enter the URL. Temporary session storage is account-scoped and expires
  after 24 hours; missing, denied, oversized, invalid or mismatched data produces an explicit
  recovery message. Notes are never silently truncated or reassigned to a newer version.
- Source validation checks project, frame, immutable edit version, asset and original SHA-256.
  Account/gallery/revision changes during project loading abort the handoff. Distinct references
  to the same photo retain separate workspace bindings; contextual tool navigation preserves the
  reference without rewinding another tab's active context.
- Studio preserves current edits. The reference says whether adjustments match the reviewed
  version and labels itself a snapshot, not live feedback. No restoration, application, resolution,
  approval or publication happens automatically. Reference text renders outside the chat log and
  input; it is never appended to assistant instructions, conversation history or tool commands.
- The reference is collapsible, uses the current black/light typography and colors, and keeps long
  notes in a bounded scroll region. Source-photo focus is the only contextual action. Other screens,
  source photos, saved edits and real account state were not modified.

Primary-source research: [Pixieset photo notes](https://help.pixieset.com/hc/en-us/articles/115003733191-How-does-my-client-add-a-note-or-a-comment-on-a-photo)
describes reviewing photo notes in Favorite Activity and CSV export. Its
[Lightroom favorites workflow](https://help.pixieset.com/hc/en-us/articles/115003505192-Viewing-Client-Favorites-in-Lightroom)
uses filename filtering and documents partial-name and virtual-copy limitations. This motivated
explicit source/version matching, not a claim that LensLabs replaces either product. No new
hands-on competitor account access or video viewing is claimed.

Verification: **922 tests pass, 0 fail, 56 files / 191,486 assertions**. Fourteen new tests cover
snapshot isolation and limits, corruption/expiry, exact source identity, current-edit preservation,
late identity changes, route context, direct-upload refusal and escaped client text. The previous
17 gallery-recovery browser checks and 14 new Assistant/reference checks all pass: **31 browser
checks**, 390×844 and 1440×1000, black/light views, clean console. Screenshots were visually
inspected. These use production components and real domain helpers with synthetic metadata and
simulated actions; they are not full-workspace or authenticated cloud roundtrip tests.

Typecheck, changed-source lint, production build and whitespace checks pass. Production output
contains no QA globals, Celine lab identity or development-lab markers. No dependency changes.
The existing release approval gate remains: no commit, push or production Publish was attempted.
The actual 8085 lab is retained; the temporary 8086 QA server is stopped after testing. Real-device,
real-account and published-gallery verification remain outstanding. Next bounded slice: inspect
culling review of protected photographer choices and burst alternatives without auto-accepting
suggestions or changing the Studio interface.

## Pass 8 — stale culling and edit approval protection (2026-09-07, 17:42 UTC slice)

Reproduced two LensLabs defects with failing tests before changing implementation: a cull could
remain valid after a new decision on an unchanged compared frame; an edit preview could remain
valid after replacing its source with a different File of the same name, size and timestamp.

The existing proposal now captures an in-memory approval basis for the full compared scope,
including unchanged cull candidates. It checks source object identity, source availability,
edits, picks, analysis/capture metadata and imported review metadata before any changes apply.
Duplicate IDs and old/inconsistent preview records fail closed with a fresh-preview message.
Empty error messages still mark unreadable frames. Source reconnects conservatively require a
fresh preview even if the bytes happen to match. No file bytes are read, copied or uploaded for
these checks. The approval basis is transient, not stored in project/history or sent to AI.

Photo reorder and disposable thumbnail refresh remain valid. Selected-photo edits ignore changes
to unrelated sources. Applying remains all-or-nothing, and transform results are copied so a
mutable adjustment object cannot silently alter the preview. No Studio/workspace/settings/signup
layout changed. The existing first-pass culler already preserves keep/reject choices; explicit
whole-shoot reranking commands still disclose that they may replace picks and require approval.
This pass does not change their algorithms or claim improved culling accuracy.

Research: Aftershoot's [miscellaneous settings](https://support.aftershoot.com/en/articles/15692450-miscellaneous-settings-in-aftershoot)
documents retaining existing ratings/colors and review behavior; its
[culling workflow](https://support.aftershoot.com/en/articles/5223473-get-started-with-aftershoot-culling)
distinguishes automated suggestions from assisted manual decisions. These support prioritizing
photographer control, not attributing LensLabs defects to Aftershoot. Official documentation was
read; no competitor account, new hands-on session or video viewing is claimed for this slice.

Verification: **932 tests pass, 0 fail, 56 files / 191,565 assertions**. Ten added tests cover the
two reproduced defects, nested/in-place changes on unchanged candidates, duplicate/old approval
records, unreadable scope, harmless refresh/reorder, unrelated-source changes, mutable transform
aliases, and atomic refusal followed by fresh approval of a 3,000-frame metadata batch. This is
not a real 3,000-RAW benchmark. **11 new browser checks** pass using production approval/chat
components and the real domain helpers at 390×844 and 1440×1000, with black/light views and clean
console. Screenshots were inspected. Full-route render readiness, saved-session/undo behavior and
real-device/cloud roundtrips are not established by this isolated component fixture.

Typecheck, changed-source/QA lint, production build and whitespace checks pass. Production output
has no QA globals, Celine persona or lab markers. No dependency changes or production auth edits.
Release remains local behind the existing approval gate; no commit, push or Publish attempted.
Keep the actual 8085 lab available; stop only the temporary 8086 QA server. Next bounded slice:
resume the documented public competitor workflow/video research or inspect source-reconnect and
review-filter recovery, preserving all current UI and saved shoots.

## Pass 9 — exact, bounded sidecar import (2026-09-07, 18:44 UTC slice)

Reproduced a case-collision defect before fixing it: `Card/IMG_0001.JPG` and
`card/IMG_0001.xmp` shared a lowercased sidecar key. A case-distinct source name had the same
problem. Import now retains exact folder/stem case and Unicode while accepting different
extension case. Windows path separators are normalized as before. This prevents silent metadata
transfer between case-distinct sources; it does not infer a match for renamed files.

Multiple distinct sidecars for one exact target are ambiguous and none wins by file order.
Repeating the same File object is harmless. Reads are sequential, limited to **256 KiB per
sidecar and 16 MiB per import**, with strict UTF-8 decoding and cancellation checks. Unreadable,
oversized, ambiguous, over-budget, and unmatched sidecars appear in the existing import status;
the corresponding metadata is not applied. These are explicit safety limits, not claims of
support for every possible XMP encoding or unusually large sidecar. RAW/JPEG files remain usable.
Cancelling during sidecar reading leaves existing photos and decisions unchanged.

The investigation stayed in `src/lib/studio/ingest.ts`, the existing Studio import path, its
regression tests, and this log. No layout, Settings, signup, auth, pixel engine, dependencies,
user environment file, or stored shoot data changed. Previously modified Studio code is preserved.

Research: Aftershoot's [source-reconnect guidance](https://support.aftershoot.com/en/articles/6673089-no-smart-previews-or-raws-found)
requires finding the intended originals when catalog references change; its
[culling workflow](https://support.aftershoot.com/en/articles/5223473-get-started-with-aftershoot-culling)
separates suggestions from manual selection. These informed the priority of conservative metadata
matching. This is a LensLabs defect, not a finding about Aftershoot. Official documentation was
read; no new competitor account session or video viewing is claimed.

Verification: **952 tests pass, 0 fail, 57 files / 192,734 assertions**. Eight new tests cover
case-distinct names/folders, exact Unicode/path matching, duplicate order independence, an
unreadable duplicate contender, failed/invalid UTF-8 reads, byte budgets, cancellation, and
visible unmatched-sidecar notices. Typecheck, changed-source lint, production build and whitespace
checks pass. The real retained loopback server responds **HTTP 200** at the synthetic Studio
route; this is a route health check, not browser proof of import behavior. No new browser interaction,
real RAW performance benchmark, remote account, or published-gallery test was performed in this slice.

Release remains local: no commit, push, or Publish attempted, and the existing approval gate
remains. Keep port 8085 available. A separate unresolved source-reconnect concern remains:
name/size/timestamp identity alone cannot prove reselected original bytes match a saved preview.
Address that through the source/project integrity path in a separate bounded pass; this sidecar
fix does not claim to solve content-identity verification or cross-device restoration.

## Pass 10 — verify original bytes before reconnect (2026-09-07, 21:01 UTC slice)

The investigation reproduced two failures before implementation: a metadata-identical but
different original could replace a photo while inheriting its saved picks/edits, and an old
preview-only record could be treated as a verified original using only its file ID. Both
regression tests failed against the prior merge and pass with the new checks.

New imports now record a versioned, full-byte fingerprint before analysis. The fingerprint
uses chained SHA-256 over fixed 4 MiB chunks, with a seed binding format, byte length and chunk
size. This is **not** the raw-file SHA-256 used for project archives, and not the perceptual
similarity hash used for culling. Reads are bounded per import lane, cancellable between reads,
check short reads, and cache successful results by immutable File object only. No dependency,
pixel-processing engine, original-file writes, or upload path changed.

Reconnect checks run before decoding/publishing a replacement. A second merge guard checks
the actual incoming File's verified fingerprint against the current saved source, preserving
live decisions and rejecting stale/replaced source objects. Rejected replacements no longer
revoke the saved preview URL. The existing import receipt explains skipped reconnects.
Session signatures include the fingerprint so a fingerprint-only update persists; project
metadata already carries it through its existing data-only adapter. Preview-only files are
never hashed as originals. Old preview-only records without a fingerprint remain untouched;
the receipt directs a separate-shoot import for review, not automatic migration or guessed
matching. Renamed/moved-file reconciliation and legacy manual relinking remain separate work.

Research refreshed Aftershoot's [missing-original guidance](https://support.aftershoot.com/en/articles/6673089-no-smart-previews-or-raws-found):
it documents catalog paths and reconnecting missing RAWs, including checking that a differently
named image is actually the intended one. This informed the recovery priority, not a claim
about an Aftershoot defect. [MDN's digest documentation](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest)
confirms Web Crypto does not stream input; bounded chunk reads avoid a whole-original buffer.
No new competitor-account access or video viewing is claimed.

Verification: **1,028 tests pass, 0 fail, 61 files / 193,261 assertions**. Ten new tests cover
the two reproduced failures, exact reconnect with live decisions, forged/copied fingerprint
fields, legacy/malformed records, source changes after verification, independent Node SHA-256
chain vectors, mutations in every chunk, bounded reads, short/failed reads and cancellation.
Typecheck, changed-source lint, production build and whitespace checks pass.

**12 isolated browser checks pass** using production import/session helpers, browser Web Crypto,
real IndexedDB and an actual document reload. The synthetic account/shoot scope never touches
user storage. Repro harness: `/private/tmp/lenslabs-source-reconnect-check.mjs`, served through
the existing loopback-only QA fixture on 8091; no outside connections or real sign-in.
The actual 8085 Studio was also exercised in an isolated launched browser with a new synthetic
shoot and the repository's public-domain JPEG (385,875 bytes). Import, keeper selection, saved
exposure, reload, identical-source reconnect and a one-byte-altered same-name/size/timestamp
refusal were checked. The altered file was refused before analysis; the saved keeper/exposure
and preview remained. The rejection screenshot was inspected. Console has an existing Canvas
readback performance warning, no application errors. This is not a real RAW throughput test.

**Next recovery defect discovered, not fixed here:** refreshing immediately after a slider
edit can beat the existing 350 ms autosave debounce and async pagehide write. A synthetic
exposure change from 0 to 1 was lost on immediate reload; after a completed save, it survives
reload. Audit the pending-save/reload boundary next, preserving cross-tab conflict protection.
Also audit distinct new import files that share the same path/size/timestamp; this pass protects
replacement of existing frames, not that separate initial-batch de-duplication concern.

No layout, signup, Settings, auth, stored user shoots, or environment configuration changed.
Release remains local behind the existing approval gate: no commit, push, or Publish attempted.
Keep the actual 8085 lab running; stop only the temporary 8091 QA fixture after verification.

## Pass 11 — pending-save reload protection (2026-09-07, 22:45 UTC heartbeat)

Investigation reproduced the pending-save gap in the actual 8085 Studio with a fresh synthetic
shoot and the repository's `auth-lens.jpg` (146,682 bytes). Setting Exposure from 0 to 1 and
dispatching a cancelable `beforeunload` in the same event turn left the event unprotected.
The existing guard checked unfinished imports, previews, chat activity and save conflicts, but
not an adjustment waiting for the 350 ms autosave debounce or its asynchronous transaction.

The route now tracks the latest successfully saved immutable frame/selection/filter snapshot.
Reload protection reads the synchronous live refs, so it is armed before React's save effect
or debounce runs. Scheduling a write is not an acknowledgment; only successful completion clears
that snapshot. A delayed older completion cannot clear a newer edit or rewind a newer receipt.
Failures keep the existing save-paused recovery state and warning. Each Studio controller has its
own tracker. This introduces no second datastore, metadata migration, background upload, changes
to write ordering, or bypass of existing IndexedDB/project revision checks. Debounced writes and
visibility/pagehide flushing remain; the new protection is a warning, not synchronous storage.

Primary-source check: [MDN beforeunload](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event)
documents the browser's generic confirmation, required user interaction and unreliable mobile
termination behavior; [pagehide](https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event)
also is not guaranteed on every termination. Normal cancelable reload is covered. If the user
chooses to discard, force-quits, loses power, or the OS kills the browser, uncommitted changes
may still be lost. Do not advertise crash-proof persistence. No competitor app or video was
newly tested/watched in this slice; the research access gaps above remain.

Verification: **1,063 tests pass, 0 fail, 67 files / 193,629 assertions**, with the existing Lua
5.1.5 test runtime. Eight added tests cover the pre-debounce gap, outstanding writes, newer edits,
failures, out-of-order/duplicate receipts, selection/filter changes, controller isolation and
empty-shoot handling. Typecheck, changed-source/QA lint and production build pass.

**16 isolated browser checks pass** in `scripts/qa/studio-save-boundary-check.ts`. The actual
native reload confirmation was dismissed and the adjustment retained; a later completed save
survived a real document reload. Temporarily holding a synthetic IndexedDB completion receipt
did not mark the pending/newer edit saved. A controlled write refusal retained the warning and
the prior committed value. The injected behavior was removed by reload. Screenshots of the
existing save-paused/recovered UI were inspected; no application runtime errors. Evidence:
`/private/tmp/lenslabs-save-boundary-qa/`. This is desktop Chromium, not a real mobile OS or crash
test. The wrapper covers the named-project save promise too, but no new authenticated/project
browser test is claimed. Existing synthetic conflict/project tests remain in the full suite.

Status: **DONE_WITH_CONCERNS** for the accidental-reload boundary, with the OS/crash limitations
above. Studio, signup, Settings, sidebar, original photos, real account data and `.env.development`
were preserved. No commit, push or Publish was attempted under the existing release gate; the
real local 8085 server remains available. The next bounded recovery item is initial-batch files
that have identical path/size/timestamp but different original bytes; do not merge those by
metadata identity. Crash recovery journaling and licensed-editor/real-RAW tests remain separate.

## Pass 12 — preserve distinct same-metadata originals (2026-09-07, 23:59 UTC heartbeat)

The Investigate workflow reproduced two failures before implementation: both the initial
Studio file filter and folder-drop collector removed one of two different five-byte files
named `same.jpg` with the same timestamp. Their names, sizes and dates were identical; their
original bytes were not. Both new regression tests failed against the prior code.

Root cause: metadata keys were being used as source identity before verification. Folder
collection now removes only a repeated File handle at the same path; Studio's pre-read filter
removes only repeated File objects. A per-import resolver uses the existing bounded full-byte
fingerprint before assigning identities to colliding sources. Distinct new originals receive
deterministic content-qualified IDs. Concurrent copies with verified identical bytes resolve
to one incoming frame. Ordinary imports retain their existing ID format. Saved IDs, selections,
metadata and original files are never migrated or rewritten by this change.

Reloaded collision records reconnect individually to their own decisions. A different-byte
source presented against an existing metadata group remains refused as an unverified reconnect,
including forged digest/ID fields and older previews without fingerprints. This deliberately
does not infer whether a third same-metadata source is an intentional addition; use a separate
shoot for that ambiguous case. An unreadable new colliding source is explicitly skipped in the
receipt rather than assigned a guessed ID; readable siblings can still import. Retry is possible
after the source becomes readable. Copies are claimed only after verification; cancellation
or failed reads do not reserve their identity.

Shared sidecar targets are withheld when the incoming same-metadata photo group is ambiguous.
The existing import receipt explains the skipped metadata. This is conservative even for
separate handles that later prove to be identical copies. Normal RAW/JPEG companion pairs remain
unchanged. No Studio layout, Settings, signup, marketing, backend decoder, auth, environment file,
dependency, or stored user-shoot change is part of this slice.

Research: refreshed [Aftershoot's missing-original guidance](https://support.aftershoot.com/en/articles/6673089-no-smart-previews-or-raws-found),
which describes reconnecting catalog references and verifying the intended source, and
[MDN's lastModified reference](https://developer.mozilla.org/en-US/docs/Web/API/File/lastModified),
which describes modification timestamps rather than content identity. The defect and its fix
are verified LensLabs findings, not a claim about Aftershoot. No new competitor session or
video viewing is claimed. Prior demo/access/transcript gaps remain open.

Verification: **1,096 tests pass, 0 fail, 68 files / 198,824 assertions**, with the existing Lua
5.1.5 runtime. Twelve added regressions cover both reproduced pre-read losses, input-order
independence, concurrent verified copies, ordinary/legacy IDs, separate reload/reconnect
decisions, changed bytes, forged identity fields, legacy missing fingerprints, ambiguous
sidecars, cancellation and failed-read retry. Existing folder overlap, traversal, source
reconnect, cross-tab persistence and project tests still pass. TypeScript, scoped lint,
production build and whitespace checks pass.

**11 actual Studio browser checks pass** with a fresh synthetic shoot and two same-name,
same-size, same-timestamp JPEGs made from the repository's `auth-lens.jpg` with different trailing
bytes (146,683 bytes each). This tests byte identity, not perceptual similarity or AI accuracy.
The real folder-drop path, C++ previews, independent Keep/Reject, actual reload, single-source
reconnect, changed-source refusal, repeated-copy collapse and ambiguous sidecar refusal were
checked. The first-pass proposal was explicitly discarded only in this synthetic shoot before
reload testing; approval protections were not bypassed. Screenshot inspected, no application
runtime errors. Harness: `/private/tmp/lenslabs-ingest-collision-check.ts`; evidence:
`/private/tmp/lenslabs-ingest-collision-qa/`. Browser isolation did not access real accounts,
cookies, user photos or prior shoots.

Status: **DONE_WITH_CONCERNS** for initial-batch identity collisions. Existing long-path ID limits
and ambiguous later additions need a separate usability/export-boundary audit. The foreground
LibRaw decoder work and its two-Sony-fixture repeat measurements are separately documented in
`native/README.md`; this heartbeat adds no real RAW speed or 20,000-photo benchmark claim.
No commit, push, or Publish attempted under the current release approval gate. Keep the actual
8085 lab running. Next bounded item: verify content-qualified IDs through XMP/Adobe/project
handoff (including repeated basenames and long-path limits), or resume the documented public
competitor workflow research; do not weaken original-source verification.

## Pass 13 — long-path identity through project and delivery (2026-09-08 01:44 UTC)

Bounded follow-up to Pass 12; no UI, source-file, storage migration, auth or C++ pixel changes.
The investigation workflow reproduced two deterministic schema failures before their fixes:

- A synthetic 4,000-character relative path imports with a content-qualified photo ID, but
  `captureProject` failed with Zod's 2,000-character ID limit. The path itself was within the
  project's existing 4,000-character allowance.
- After fixing project validation, the same identity was rejected by Delivery's source-frame
  reference, which independently capped IDs at 2,000 characters.

`src/lib/photo-identity.ts` now supplies a shared, finite 4,200-character photo-ID limit to the
project model and Delivery source references. This includes path, size, timestamp and the
fingerprint suffix without trimming or changing any identity. Unrelated record IDs, filenames,
source paths, archive byte limits, checksums and exact-version relationships retain their bounds.
Nothing in saved projects or real user photos was rewritten.

Six new regression tests in `tests/project-ingest-handoff.test.ts` exercise import → capture →
binary lenspack export/parse → validation → hydration → verified reconnect/re-save, including
independent Keep/Reject, edits, selected frame, proofs and recorded feedback. Changed source
bytes remain refused. Repeated basenames in different folders keep separate XMP picks and
Adobe payload paths. Different originals with the same full path remain distinct inside the
project, but conflicting sidecars and ambiguous Adobe targets are refused. Overlong identities,
overlong metadata paths, unrelated record IDs and missing selected-frame relationships fail.

The portable XMP ZIP path limit remains **1,024 UTF-8 bytes**, even though project paths can
be longer. This pass deliberately does not rename/truncate paths or guess Adobe targets.
The Adobe payload accepts an unambiguous supported relative path; this is not a claim that a
live Lightroom installation imported it. No Adobe application or customer catalog was used.

Primary-source check: [Adobe's metadata documentation](https://helpx.adobe.com/lightroom-classic/desktop/organize-photos-in-lightroom-classic/metadata-basics-actions.html)
distinguishes proprietary-RAW XMP sidecars from embedded metadata for JPEG/TIFF/PSD/DNG and
notes the additional ACR sidecar in newer Lightroom versions. Therefore a generated XMP
payload is not evidence of a complete cross-format or AI-edit round trip. These restrictions
remain explicit; no ACR/AI-edit parity is claimed.

Verification: **137 focused tests pass (625 assertions)**. Fresh full suite:
**1,110 pass, 0 fail, 199,880 assertions across 70 files, 6.15 seconds**.
TypeScript, scoped ESLint, production build and whitespace checks pass. Full-suite log:
`/private/tmp/lenslabs-project-identity-tests.log`; build log:
`/private/tmp/lenslabs-project-identity-build.log`. This was domain/serialization testing with
synthetic bytes, not a new rendered-browser test, real RAW benchmark or live Adobe trial.

Status: **DONE_WITH_CONCERNS**: the schema mismatch is fixed locally; portable-path refusal and
live Adobe compatibility remain bounded as above. No commit, push or Publish was attempted
under the standing release-approval gate. Existing 8085 lab and foreground business-workspace
changes are preserved. Next useful item: research and test an explicit, collision-safe user
workflow for same-path later additions or long-path Adobe handoff; do not silently re-key photos.

## Pass 14 — direct issue-bucket review (2026-09-08 02:48 UTC heartbeat)

Primary-source refresh, not competitor account testing:

- [Aftershoot's current culling guide](https://support.aftershoot.com/en/articles/5223473-get-started-with-aftershoot-culling)
  separates photographer flags from automated selections and exposes blur, closed-eyes,
  duplicates and unrated groups for review. Its assisted mode provides scores and duplicate/key-face
  context without assigning ratings or labels. [Grid, Loupe and Survey documentation](https://support.aftershoot.com/en/articles/9189985-using-grid-loupe-and-survey-mode-views)
  also describes filter groups and synchronized comparison, but this pass does not claim LensLabs
  survey-view parity or any direct Aftershoot session.
- [Pixieset's proofing overview](https://help.pixieset.com/hc/en-us/articles/115003797011-Pixieset-and-Proofing)
  documents client completion notification, per-photo notes and filename/CSV handoff.
  [Pixieset download activity](https://help.pixieset.com/hc/en-us/articles/360000930212-Reviewing-Collection-Download-Activity)
  distinguishes full-gallery, single-photo and video activity and describes seven-day link expiry.
  LensLabs already has immutable selection submission and exact-version notes; truthful download
  activity remains a separate server-receipt audit. No Pixieset dashboard or private gallery was used.

Implemented without adding a panel or changing persisted picks:

- The existing Focus / eyes, Exposure and Duplicates counters are now buttons. Selecting one shows
  only frames carrying that exact issue family and switches the existing filter label to Flagged.
- Focus includes blur, soft focus, face softness and closed eyes; Exposure includes under- and
  overexposure; Duplicates includes only the existing duplicate flag. Source order is preserved.
- Zero-count buckets are disabled. The active bucket has `aria-pressed`; selecting the ordinary
  filter menu clears the issue bucket. The counters do not accept/reject a photo, apply the pending
  first pass or alter source files.

Verification: four new unit tests cover every issue family, mixed flags, stable order, counts,
null filtering and source-array immutability. **52 focused tests pass / 0 fail (187 assertions)**
across ingest, Studio commands, workspace recovery and the new filter. TypeScript, scoped ESLint
and whitespace checks pass. Fresh full suite: **1,100 pass / 0 fail, 19 optional Lua-runtime
checks skipped, 194,836 assertions across 72 files**; the production build passes with its existing
deprecation advisories. Browser QA used a fresh loopback-only synthetic shoot with four
repository/public-domain JPEG fixtures: all four appeared, the two detected Exposure issues reduced
the filmstrip to two, the button exposed pressed state, the ordinary All photos filter restored four,
and disabled zero-count buckets remained non-actionable. No new console errors. Screenshot inspected:
`/private/tmp/lenslabs-review-filter-active.png`. This is workflow verification, not a culling
accuracy benchmark; pending AI suggestions were not accepted and no real/user photographs changed.

Next bounded delivery item: design an authenticated, idempotent download-handoff receipt that says
only what the browser actually verified and handed off. Do not call it a completed client download,
and do not add it until stale-revision, retry and privacy behavior are tested.

## Pass 15 — authenticated browser-handoff receipts (2026-09-08 03:54 UTC heartbeat)

Primary-source refresh, not a Pixieset account or dashboard test:

- [Pixieset's download-activity guide](https://help.pixieset.com/hc/en-us/articles/360000930212-Reviewing-Collection-Download-Activity)
  calls its records initiated or generated downloads, separates gallery, single-photo and video
  activity, and exposes resolution, sets, PIN where applicable and the initiation date. It also
  states that generated gallery links expire after seven days. This supports recording a bounded
  handoff event, not claiming that the operating system saved or opened a file.
- [Pixieset's current client-download guide](https://help.pixieset.com/hc/en-us/articles/115003594212-Your-client-s-download-experience)
  documents separate individual and gallery ZIP flows, browser download destinations, multiple ZIP
  parts for large galleries and optional email/PIN steps. LensLabs did not copy its identity fields:
  the existing invitation capability remains the client credential, and no client email, PIN,
  filename, object path, checksum or invitation token is added to the activity event.
- [Pixieset's current download settings](https://help.pixieset.com/hc/en-us/articles/115003795572-Collection-Download-Settings)
  documents per-collection, full-gallery and single-photo controls plus web/high-resolution choices.
  LensLabs still exposes only released, exact-version finals. Download-limit/contact settings remain
  an explicit gap, not an implemented or tested claim.

Implemented in the existing proof-to-final surface:

- An individual file or checked ZIP is offered only after the existing byte-count and SHA-256 checks.
  Immediately after the browser handoff, the client sends an authenticated `downloadHandoff` command
  through the existing private invitation and compare-and-swap revision boundary.
- The server independently verifies that every referenced exact version is still approved, released
  and downloadable. Only clients can create the event. Individual receipts contain exactly one
  version; ZIP parts contain at most the existing 30-file batch limit; duplicate version IDs fail.
- The persisted wording is intentionally narrow: `Browser handoff recorded ...; final save location
  not verified`. Activity never says a download completed. A failed or stale activity write tells the
  client the browser handoff happened but the receipt did not update, and the same operation ID can be
  retried without creating a second event or repurposed for another command.

Verification: **69 focused workflow/download/server tests pass / 0 fail (213 assertions)**. New domain
and isolated fake-Supabase regressions cover client-only authorization, unreleased/expired/duplicate
refusal, single-file bounds, exact wording, operation-ID conflict, stale compare-and-swap retry and a
lost-success retry producing exactly one event. Browser QA used the production gallery component with
two synthetic released versions and the repository's public-domain JPEG: one integrity-checked phone
file and one two-file checked ZIP were handed to the browser, both receipts appeared in Activity, the
390px dialog had no horizontal overflow and no new non-font interaction errors appeared. Screenshots
inspected: `/private/tmp/lenslabs-download-handoff-activity-mobile.png` and
`/private/tmp/lenslabs-download-handoff-zip-mobile.png`.

Limitations: this was simulated authenticated transport on loopback, not Supabase, a published link,
Safari Files, Photos, or a real client device. The browser's final save/open location remains unknowable
and is not represented. Current concurrent workspace changes introduce a separate TypeScript error in
`src/lib/clients/sheet.ts:251` and invalid OpenAI Sans files emit existing page-load warnings; neither
was changed or hidden by this delivery slice. The full suite reached 1,113 pass / 19 skip / 1 fail; the
sole failure is the existing local HTTP bridge fixture receiving `EADDRINUSE` from `listen(0)`, and an
isolated rerun reproduces it after all 15 preceding native-transport tests pass. Next bounded item:
owner-facing activity filtering/CSV
that preserves the browser-handoff semantic, or consented real-device recovery testing; do not add
email tracking or download limits without a privacy/product decision.

## Pass 16 — owner Activity filters and truthful CSV (2026-09-08 04:52 UTC heartbeat)

Primary-source refresh, not competitor account testing:

- [Pixieset's Favorite Activity guide](https://help.pixieset.com/hc/en-us/articles/115002991071-How-can-I-review-my-client-s-Favorite-Activity)
  documents photographer-side favorite lists, client notes and filename CSV export. Its
  [photo-note guide](https://help.pixieset.com/hc/en-us/articles/115003733191-How-does-my-client-add-a-note-or-a-comment-on-a-photo)
  says exported favorite lists include client notes. This supports an owner export surface, but it
  does not establish the fields or identity safety LensLabs needs for an editor handoff.
- [Pixieset's download-activity guide](https://help.pixieset.com/hc/en-us/articles/360000930212-Reviewing-Collection-Download-Activity)
  documents a collection-level CSV and calls gallery activity initiated downloads. LensLabs keeps
  its stronger wording from Pass 15: a browser handoff was recorded and the final save location was
  not verified.
- [Aftershoot's current export guide](https://support.aftershoot.com/en/articles/7048858-how-to-export-your-culled-images-from-aftershoot)
  documents exporting the active cull filter to a folder or another application. This pass does not
  claim a direct Aftershoot session or change LensLabs culling/export behavior.

Implemented in the existing owner Activity tab without adding a dashboard:

- The photographer can filter shared activity by All, Client, Selections, Feedback or Downloads.
  Private upload reservations stay excluded. Source history remains append-only and unmodified;
  unknown future event wording remains visible under All instead of being silently discarded.
- Export CSV follows the active filter and uses UTC timestamp, generic actor, bounded category and
  the exact shared activity text. It does not add invitation tokens, storage paths, hashes or client
  email. Every cell is quoted and spreadsheet-formula prefixes are neutralized.
- Download rows retain `final save location not verified` exactly. Neither the UI nor CSV says a
  browser handoff completed a save. Filter/export controls are owner-only; the client Activity view
  remains unchanged.

Verification: **77 focused delivery tests pass / 0 fail (236 assertions)**, including eight new
activity classification/filter/CSV tests for stable order, hidden reservations, source immutability,
Unicode, quotes, newlines, formula injection and exact browser-handoff wording. TypeScript, scoped
ESLint, production build and whitespace checks pass. A 390×844 synthetic owner gallery verified all
five filters, client-only rows, active-filter CSV contents, no horizontal overflow and no new console
errors. Screenshot inspected: `/private/tmp/lenslabs-owner-activity-mobile.png`.

Limitations: browser QA used loopback, synthetic workflow history and repository/public-domain media,
not Supabase, a published invitation, Pixieset, Aftershoot or real client data. The full concurrent
suite reached **1,121 pass / 19 skip / 3 fail**. The failures are outside this slice: the existing
native HTTP fixture still receives `EADDRINUSE` from `listen(0)`, concurrent Appearance work breaks
one accent contrast assertion, and concurrent chat-copy work changed a tested empty-composer
placeholder. Each reproduces in its own targeted test; none was changed or hidden here. Next bounded
item: export the submitted selection snapshot and photo notes with exact LensLabs photo/version IDs
so repeated camera filenames cannot target the wrong frame. Do not call a filename-only CSV an Adobe
round trip.

## Pass 17 — exact submitted-selection and note export (2026-09-08 06:49 UTC heartbeat)

Primary-source refresh, not competitor account testing:

- [Pixieset's Favorite Activity guide](https://help.pixieset.com/hc/en-us/articles/115002991071-How-can-I-review-my-client-s-Favorite-Activity)
  documents photographer-side favorite lists, client notes and filename CSV export. Its
  [photo-note guide](https://help.pixieset.com/hc/en-us/articles/115003733191-How-does-my-client-add-a-note-or-a-comment-on-a-photo)
  confirms that exported favorite-list CSVs include client notes.
- [Pixieset's Lightroom Copy List guide](https://help.pixieset.com/hc/en-us/articles/115003505192-Viewing-Client-Favorites-in-Lightroom)
  documents a filename search workflow and warns that partial filename matches can return extra
  images and virtual copies need manual checking. LensLabs therefore does not use a camera filename
  as selection identity or call this CSV an Adobe round trip.
- [Aftershoot's current export guide](https://support.aftershoot.com/en/articles/7048858-how-to-export-your-culled-images-from-aftershoot)
  documents filter-based folder/application export with star ratings, color labels and edits. This
  pass does not claim an Aftershoot session and does not change LensLabs culling or editor export.

Implemented in the existing owner Feedback tab without adding another panel:

- The photographer can export the latest immutable submitted-selection snapshot. Current mutable
  picks cannot change the export after submission or reopening.
- Every row contains the submission timestamp and ID, exact LensLabs photo ID, exact version ID,
  filename and version number. Repeated camera filenames remain separate rows. A missing historic
  version or duplicate submitted identity fails the whole export instead of silently omitting or
  guessing a photo.
- Only client notes attached to that exact submitted photo/version pair are included. Notes for a
  newer version, another photo or the photographer are not joined by filename. Change-request status
  remains explicit as None, Addressed or Open.
- Every CSV cell is quoted, Unicode and multiline notes are preserved, and spreadsheet-formula
  prefixes are neutralized. The control is owner-only and the client Feedback view remains unchanged.

Verification: **71 focused delivery tests pass / 0 fail (237 assertions)**, including five new
selection-export tests for repeated filenames, immutable latest submissions, exact-version client
notes, Unicode/quotes/newlines, formula injection, missing history, duplicate identities and source
immutability. TypeScript, scoped ESLint, production build and whitespace checks pass. A synthetic
390×844 owner gallery captured the CSV, verified both exact photo/version pairs plus a quoted Unicode
change request, confirmed no horizontal overflow and confirmed the client cannot see the control.
Screenshot inspected: `/private/tmp/lenslabs-owner-selection-export-mobile.png`.

Limitations: browser QA used loopback, synthetic workflow state and repository/public-domain media,
not Supabase, a published invitation, Lightroom, Capture One, Pixieset, Aftershoot or real client
data. The CSV is a safe LensLabs interchange record, not proof that another editor imported it. The
full concurrent suite reached **1,128 pass / 19 skip / 3 fail**. The three failures remain outside
this slice: the local HTTP bridge fixture receives `EADDRINUSE` from `listen(0)`, concurrent Appearance
work breaks one accent contrast assertion, and concurrent chat-copy work changed a tested empty
composer placeholder. None was changed or hidden here. Next bounded item: produce an explicitly
scoped Lightroom/Capture One lookup handoff from the exact selection identities, with duplicate-name
ambiguity blocking rather than being guessed; do not claim editor import until tested in that editor.

## Pass 18 — ambiguity-safe editor lookup handoff (2026-09-08 07:52 UTC heartbeat)

Primary-source basis, not Lightroom, Capture One or competitor account testing:

- [Pixieset's Lightroom Copy List guide](https://help.pixieset.com/hc/en-us/articles/115003505192-Viewing-Client-Favorites-in-Lightroom)
  documents copying a comma-formatted filename list into Lightroom search. It also warns that
  `Contains` can return partial filename matches and that virtual copies cannot be uniquely selected.
- [Pixieset's Capture One guide](https://help.pixieset.com/hc/en-us/articles/11068982092429-Viewing-Client-Favorites-in-Capture-One)
  documents pasting a space-delimited filename list into Capture One's Select by Filename List flow.
- [Aftershoot's current export guide](https://support.aftershoot.com/en/articles/7048858-how-to-export-your-culled-images-from-aftershoot)
  documents direct application/folder export from a filtered cull. This LensLabs slice is deliberately
  narrower: it copies a lookup list and does not claim direct editor import, metadata write-back or a
  completed round trip.

Implemented beside the exact selection CSV in the existing owner Feedback tools:

- One compact Editor lookup menu copies the latest immutable submitted filenames in the documented
  comma-delimited Lightroom or space-delimited Capture One format. Mutable current picks and newer
  published versions cannot retarget the list.
- The helper fails closed on exact, case-only or Unicode-normalized duplicate filenames before it
  touches the clipboard. Lightroom also blocks comma delimiters and filename substrings that could
  over-select under `Contains`; Capture One blocks whitespace that would split one filename into
  multiple tokens.
- The UI says the LensLabs CSV remains the exact selection record because only that file carries
  exact photo/version IDs. Clipboard unavailability and every ambiguity surface as an error; the UI
  does not silently copy a partial list or claim another editor received it. The control remains
  photographer-only.

Verification: **120 focused delivery tests pass / 0 fail (430 assertions)**, including four new editor
lookup tests covering both target formats, immutable submitted-version identity, source immutability,
case/Unicode duplicates, target delimiters and Lightroom substring ambiguity. TypeScript, scoped
ESLint, production build and whitespace checks pass. A synthetic 390x844 owner gallery intercepted
the clipboard locally, verified both exact list formats, blocked a case-only duplicate without another
clipboard write, fit without horizontal overflow and showed no new non-font console errors. The client
Feedback view exposed no editor control. Screenshot inspected:
`/private/tmp/lenslabs-editor-lookups-mobile.png`.

Limitations: this used loopback, a mocked clipboard, synthetic workflow state and repository/public-
domain media. It did not open Lightroom, Capture One, Supabase, a published invitation, Pixieset,
Aftershoot or real client data, and therefore does not claim a successful editor import. Virtual-copy
ambiguity cannot be detected from LensLabs filenames, so the exact-ID CSV remains authoritative. The
full concurrent suite reached **1,132 pass / 19 skip / 3 fail**. The same three unrelated failures
remain: the local HTTP bridge fixture receives `EADDRINUSE` from `listen(0)`, concurrent Appearance
work breaks one accent contrast assertion, and concurrent chat-copy work changed a tested empty
composer placeholder. None was changed or hidden here. Next bounded item: return to culling review and
close one measured creative-control or unreadable-file recovery gap without inventing quality claims.

## Remaining sprint order

1. **Finish research hours 1–3.** Walk public Aftershoot product tour and Pixieset demo. Record exact
   interactions tried; inspect available video/transcripts. Create a workflow comparison, not an
   unranked feature wishlist. Ask for account access only if necessary; never purchase a trial.
2. **Cull with creative control.** Audit existing BurstReview, first-pass proposals, undo, imported
   ratings and review filters. Test deliberate motion blur, closed-eye portraits, duplicate-looking
   variations, unreadable files, nested folders, RAW+JPEG pairs and protected keepers. Close one
   measured gap at a time. Keep all pixel-processing work in the existing C++ engine.
3. **Proof-to-final handoff.** Audit actual delivery model/reducer and shared-client surface. Prioritize
   direct photo comments, submitted versus still-changing selections, version-linked approvals,
   revision summaries into Studio, and explicit next actions. Add a clearly labeled local rehearsal
   only if it uses real domain logic and never masquerades as remote publication.
4. **Batch scale and recovery.** Real supported RAW/JPEG fixture benchmark (currently missing),
   bounded memory, progress/cancel/resume, save-conflict recovery, original-file reconnect,
   interruptions during upload/export. Record machine/dataset/clock and distinguish metadata tests.
5. **Delivery on a phone.** Test narrow screens, single-photo downloads and ZIP retry, expired/revoked
   links, passcodes, no-photo galleries, long notes, two clients, double-submit, stale image versions.
6. **Release each validated slice.** Typecheck/lint, targeted regressions + full tests/build, inspect
   exact diff, commit/push scoped files only. Preserve `.env.development` and unrelated work.
   Existing Lovable-connected Git source sync is not production Publish. Verify deployed build and
   real auth/storage/schema readiness before claiming live delivery. Do not replatform.

## Gates and stopping rules

- Preserve compact cinematic signup and existing black/light workspace. No speculative redesign.
- No superiority/accuracy claims without a ground-truth photographer-selected dataset and metric.
- Do not claim to have consumed complete apps/videos/books from landing pages or search snippets.
- External OAuth, deployment UI, credentials, migrations and user-owned RAW benchmark assets may
  need user action. Mark precise missing step; continue unaffected local work.
- No purchases, domain registration, external invitations/messages, customer-photo publication or
  account/security changes without specific authorization. Do not bypass competitor access controls.
- Heartbeat `lenslabs-aftershoot-and-pixieset-build-sprint`: hourly, bounded to 24 occurrences.
  At/after the deadline summarize measured results and pause it; do not extend the sprint silently.
- Notify only useful milestones, failures or needed user action. Do not repeatedly report no change.
