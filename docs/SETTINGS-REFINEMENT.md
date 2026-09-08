# LensLabs Settings — refinement report

September 7, 2026. Reference: the user's Codex screenshot and 23-section specification.
This updates the existing application, not a separate demo. **No production deployment.**

## Interface and routes

Full-height charcoal shell; gold switches; 26% rail clamped to 260–400px; 780px content column;
independent scrolling; mobile navigation drawer; no operating-system chrome or copied identity.
`/settings` redirects to `/settings/general`. Canonical routes retain shoot/workspace context,
refresh, browser history, section titles and one internal Settings tool tab.

| Group | `/settings/` paths, in order |
| --- | --- |
| Personal | `general`, `import`, `profile`, `appearance`, `voice`, `configuration`, `personalization`, `pets`, `keyboard-shortcuts`, `usage-billing`, `analytics`, `account` |
| Integrations | `computer-use`, `computer-history`, `appshots`, `plugins`, `browser` |
| Coding | `hooks`, `connections`, `git`, `environments`, `worktrees` |
| Standalone | `archived` |

The typed inventory in `src/lib/settings-inventory.ts` records control IDs, page, type, default,
scope, validation, permissions, dependencies and status. Search resolves actual rows, focuses and
scrolls to them, and briefly highlights them. Keyboard results, counts and empty states work.
Search preserves mounted editors; unsaved forms/crops/imports guard navigation.

## Persistence and safety

- Appearance, shortcuts, import behavior, voice selection/rate, notifications, companion,
  source-link destination and assistant preferences persist **per account on this browser**.
  Cross-device preference sync still needs an authenticated settings endpoint and server revision
  handling. It is a remaining requirement, not a completed cloud feature.
- Verified profiles use the existing authenticated endpoint, extended with cropped avatar and
  biography. Name/workspace name remain supported. Save/Cancel preserve drafts on errors.
  Celine is only the loopback lab persona, with no fabricated account, email, plan or entitlement.
- Observed stale profile/preference edits are rejected; unrelated local preference edits merge.
  Local storage is not transactional across tabs. Simultaneous races and server-side profile
  revision enforcement need stronger backend compare-and-swap handling.
- The existing account-switch/expired-auth guards remain. A failed local write does not advance
  the effective value or report success. No tokens, credentials, original photos or chat history
  enter settings exports. Companion images and custom instructions are included explicitly.
- Settings/theme imports are strict, versioned JSON bounded to 32 KiB/8 KiB. Companion uploads
  become bounded 128px JPEG crops; SVG/packages are rejected. Imports cannot enable cloud sharing
  or desktop notifications, grant native access, install plugins, execute hooks or publish anything.
- Default permissions remain narrow; Full access is disabled because no elevated executor exists.
  Photo originals remain read-only and proposed edits require approval.

## Capability matrix

Working means connected to real browser/application behavior; hardware/provider verification
remains bounded by the test notes below. No claim of full native Codex parity.

| Page | Working now | Remaining dependency or gap |
| --- | --- | --- |
| General | Import speed, suggestions, cloud opt-out, send key, notifications, processing wake-lock request/status | Native menu bar/folder/terminal/panel; translations; steering/queue dispatcher; notification sounds |
| Import | Existing non-destructive Studio folder/files, XMP preference, Adobe handoff | No new universal migration/merge wizard or proprietary project importer |
| Profile | Name, workspace, crop/replace/remove avatar, biography, Save/Cancel, existing authenticated endpoint | No public handle/profile route; real account write not exercised in this local-only task |
| Appearance | Light/Dark/System; presets; colors/fonts/sizes; density/translucency; reduced motion; pointers; validated import/export/reset/undo | Custom dark colors/fonts/density target Settings. Light/Dark and existing chat preferences affect the app; no arbitrary CSS/fonts |
| Voice | Explicit microphone selection/test/meter/stop, permission errors, late-grant cleanup; read-aloud voices/rate/preview | Live conversation, speech recognition, transcripts, input-language controls and push-to-talk need a speech service |
| Configuration | Actual worker counts/mode; shared native health timeout/retry values; enforced approval policy; import diff/confirmation/export/reset | No arbitrary model/engine selector or user override of security/runtime limits; preferences remain browser-scoped |
| Personalization | Tone, detail, terminology, instructions on future hosted requests, below tool-safety policy | No project-instruction editor or memory collection/review/deletion service |
| Pets | Original LensLabs vectors, show/hide/preview, optional blink, reduced motion, left/right/reset, validated custom crop/save/remove | In-app only; no desktop overlay or task-status claim. Companion cannot intercept clicks |
| Keyboard shortcuts | Search/record/edit ten actual workspace/review bindings, conflicts, per-action reset, confirmed reset-all; fixed navigation documented | Not every existing fixed editor key is remappable; no OS-wide hotkeys |
| Usage & billing | Real browser storage estimate and persistent-storage permission; honest disconnected billing state | Entitlements, billing periods, invoices, roles and billing-management service |
| Analytics | Existing shoot-count/business-record entry points | No new historic aggregation, date-range charts/export, retention or product-analytics consent service |
| Account | Actual identity/auth method outside lab, guarded sign-out, profile/local backup/storage controls | MFA, provider-specific password changes, remote sessions, whole-account export/deletion/ownership workflows |
| Computer use | Accurate disconnected native state and selected-file boundary | Native app control, system permissions, app approvals and revoke-all executor |
| Computer history | Off/unavailable activity collection; not renamed chat history | Activity-context collector, summaries, timeline, consent/retention/deletion engine |
| Appshots | Explicit browser-selected capture, single-frame preview, discard, PNG download; sharing stops after capture | No accessible-text extraction, automatic app access or direct attach-to-chat path. Not stored until downloaded |
| Plugins | Accurate runtime/discovery limitations | Installable registry/executor, versioning, permission review and real publishers; no fake marketplace |
| Browser | Actual source-link destination preference and search entry point | No automation extension, website permission store, ordinary-browser-profile access or credential sharing |
| Hooks | Disabled execution with accurate explanation | Controlled event dispatcher, dry runs, deduplication, logs and execution isolation |
| Connections | Existing Gmail, search, Adobe/Lightroom, social/portfolio surfaces preserved | Each provider's configuration, credentials, grants and services. No new grant/revocation performed |
| Git | Correct technical meaning; disabled operations | Authorized Git executor, repository status and review; not photo history |
| Environments | Actual local native-engine readiness and browser-runtime information | General environment CRUD, setup commands, secret references and resource governance |
| Worktrees | Correct Git-worktree meaning; runtime requirement | Authorized creation/inspection/removal and dirty/active-task checks; not copied shoots |
| Archived | Existing archived conversation search/restore in original shoot | No invented cross-resource archive/deletion service; originals, gallery access and billing untouched |

## URLs and connected services

`src/lib/application-origin.ts` centralizes **https://lenslabs.dev**, as requested. `VITE_APP_ORIGIN`
supports a configured public deployment origin; server callbacks use `APP_ORIGIN` where applicable.
Internal links stay relative. Local/staging and legitimate Google/payment/storage endpoints are
not blindly rewritten. No credentials or `.env.development` contents were changed or exposed.

Routes exist for `/help`, `/docs`, `/docs/settings`, `/docs/permissions`, `/privacy`, `/terms`,
and `/security`. Missing reviewed legal/security content is stated plainly, not invented.
Before future release, verify plural-domain ownership/routing and registered provider callback/
return URLs. Earlier material used singular `lenslab.dev`; this task does not verify plural DNS.

## Verification

- **944 unit/regression tests passed, 0 failed**, across 57 files. Includes existing account
  isolation/session ordering, delivery integrity, import and processing regressions. This is not
  944 live-account flows. Bun runner, with local Lua 5.1 fixtures where required.
- TypeScript, changed-source ESLint and normal production build pass.
- **99 browser checks:** all 23 pages at 1528×992, 1440×900, 1024×768 and 390×844. Routes/titles,
  desktop refresh, context, overflow, duplicate IDs, history, indexed search targets, persisted
  preferences and guarded unsaved navigation. Every indexed control has a rendered target.
- Additional local checks: shortcut conflict/assignment/reset; storage failure rollback; generated
  avatar crop/save/reload/removal; companion image/animation/position persistence and reset.
- Synthetic media: no microphone request on page load; denial and cancelled late-grant cleanup;
  screen-capture preview with all tracks stopped. This verifies lifecycle/error handling, **not
  physical microphone quality, actual OS permission dialogs or hardware**.
- Real provider login/writes, billing, revoked sessions, offline cloud round trips, cross-device
  sync and hotkey mutations on user photographs remain unverified. No claim otherwise.
- Visually inspected screenshots live under `/private/tmp/lenslabs-settings-qa-20260907/`:
  `general-1528.png`, `appearance-1528.png`, `appearance-1440.png`, `appearance-1024.png`,
  `appearance-390.png`, `appearance-light.png`, `profile-1528.png`, plus `report.json`.
- QA used a separate browser and synthetic shoot `592c4eee-0c8e-4f6c-bd43-4fd583bd1b9a`.
  User shoots/real accounts stayed untouched. Test avatars were removed. No production deployment,
  purchases, messages, subscriptions, gallery publication or external account changes.

## References

The user's screenshot defines layout. Runtime boundaries follow
[browser file access](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API),
[screen wake locks](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API), and
[accessible target sizing](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
The [official Settings reference](https://learn.chatgpt.com/docs/reference/settings) was consulted;
LensLabs does not claim every capability of that native application.
