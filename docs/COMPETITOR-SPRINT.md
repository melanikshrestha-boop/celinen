# LensLabs: culling and client-delivery sprint

Started 2026-09-07 09:33 UTC. Stop by **2026-09-08 09:33 UTC**.
User authorized a separate no-sign-in development workspace and a day of competitor research,
implementation, testing, and deployment. The first three hours prioritize understanding actual
Aftershoot and Pixieset workflows. This is a bounded sprint, not a claim of full product parity.

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
