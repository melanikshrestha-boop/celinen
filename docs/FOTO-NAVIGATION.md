# FOTO navigation handoff

This pass reorganizes the existing app around **Shoots**, following the latest sidebar brief. It does not build the future CRM described in [FOTO-JOBS-PLAN.md](FOTO-JOBS-PLAN.md), migrate client records, or replace Cull/Develop.

## Navigation reference

There are five primary destinations and one separate creation action. Icons are Lucide, 20px with a consistent 1.65 stroke.

| Label     | Route           | Icon        | Connected behavior                                                                                       |
| --------- | --------------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| Tonight   | `/tonight`      | `Clock3`    | Next-24-hours view; currently an honest empty state because saved album schemas have no kickoff field.   |
| Shoots    | `/shoots`       | `Camera`    | Search and open existing saved shoots and local project albums.                                          |
| Library   | `/library`      | `Grid2X2`   | Full saved inventory, including the existing directory rename and recovery controls.                     |
| Deliver   | `/deliver`      | `Send`      | Existing Galleries, Saved galleries, and local-only Outreach drafts desks.                               |
| Money     | `/money`        | `Wallet`    | Existing earnings, recorded income/expenses, invoice drafts, and bookkeeping exports.                    |
| New shoot | Creation action | `SquarePen` | Opens a fresh shoot overview, then saves its directory name. Duplicate clicks are blocked while opening. |

The sidebar shows at most eight recents. Details use a stored genre where available, otherwise a count with its catalog provenance, plus an explicitly labeled **Updated** date. Directory counts say **Cull photos** when positive and omit zero counts: Develop has its own catalog, so zero Cull photos does not mean zero photos overall. Local Project counts retain **photos**. Sport and kickoff are never guessed from titles or modification dates. Recovery-pending entries lead to Library. Counts are omitted when unavailable; no fabricated Tonight or unpublished-gallery badge is displayed.

Opening a shoot keeps six workflow tabs in the Workbench header:

| Tab       | Canonical route          | Status                                                                                                                                                |
| --------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview  | `/shoots/:id`            | Saved name/count/update date; links to Cull and the saved assistant. Scheduling, stage, contact, and deadline fields say when they are not connected. |
| Cull      | `/shoots/:id/cull`       | Existing persistent Studio controller and its save/leave guards.                                                                                      |
| Develop   | `/shoots/:id/develop`    | Existing Develop page and non-destructive store, not a new editor implementation.                                                                     |
| Gallery   | `/shoots/:id/gallery`    | Existing shared delivery desk, explicitly labeled as not yet filtered to this shoot.                                                                  |
| Social    | `/shoots/:id/social`     | Explicit placeholder; no post is created or sent.                                                                                                     |
| SmartFile | `/shoots/:id/smart-file` | Explicit placeholder; no connected proposal/contract/e-signature/deposit workflow.                                                                    |

Saved assistant conversations remain reachable from Overview. All tools and account settings remain secondary destinations; they are not extra primary navigation items.

If saving a newly opened shoot fails, New shoot retries the same pending UUID and title rather than creating another record. A blocked navigation does not write a new directory entry.

## Source identity and redirects

Directory shoot keys use their existing UUID or `legacy`. The separate local Project repository uses `project:<uuid>` (encoded as `project%3A…` in the URL). These map back to the existing storage implementations; no photo database is renamed or replaced. Local project albums are excluded from cloud-account reads.

The canonical path owns the source. Invalid or conflicting path/query references fail closed instead of loading another shoot. Workflow-tab and Overview links retain query parameters and fragments only when the current decoded shoot key matches the target. Saved-assistant links translate a valid delivery handoff into the workspace-prefixed equivalent, preserving serialized frame/version IDs. Switching to another shoot does not copy the previous shoot's source references.

| Legacy entry                                          | Destination                          |
| ----------------------------------------------------- | ------------------------------------ |
| `/clients`                                            | `/shoots`                            |
| `/jobs`                                               | `/shoots`                            |
| `/earnings`                                           | `/money`                             |
| `/outbound`                                           | `/deliver`                           |
| `/develop` with a valid explicit or remembered source | That shoot's canonical Develop route |
| `/develop` without a known source                     | `/library`                           |

Redirects preserve search/hash, including explicit delivery-version handoffs. Malformed source references are shown as errors, not replaced with a remembered source. `/outbound` opens the Deliver hub; the former founder desk is under **Outreach drafts** (`/deliver?desk=outbound`) in local mode. Its existing suppression and manual-contact rules are unchanged.

## Appearance and accessibility

New preferences default to dark mode and translucent navigation. Light and System remain supported. Neutral sidebar/Settings surfaces share tokens; explicit custom palettes, gradients, font preferences, and disabled translucency remain intact. Resolving Light/System changes display tokens, not saved preference records.

The default UI uses the existing sans-serif product font stack. Navigation uses a subtle selected fill and left indicator, not white inversion. Focus outlines, `aria-current`, icon-rail tooltips, and 44px rail/mobile targets are provided. High contrast, reduced transparency, disabled translucency, and unsupported backdrop filtering receive solid fallbacks.

This is CSS backdrop blur over app content. It does **not** add a native macOS vibrancy layer, expose desktop wallpaper, or imitate traffic-light window controls. Develop's image/color-processing tokens are not changed by this navigation pass.

## Files changed

- Shell: `src/components/workbench/PrimaryNavigation.tsx`, `primary-navigation.ts`, `Workbench.tsx`, `context.ts`, `RecentShoots.tsx`, and `workbench.css`.
- Hubs and workflow shell: `src/components/shoots/{navigation.ts,ShootsHub.tsx,ShootWorkspaceFrame.tsx,shoots.css}`.
- Binding and registry: `src/lib/{workbench.ts,workbench-projects.ts}` and generated `src/routeTree.gen.ts`.
- New route adapters: `src/routes/{-legacy-redirect.tsx,-shoot-workspace.tsx,tonight.tsx,shoots.tsx,shoots.index.tsx,library.tsx,money.tsx,jobs.tsx}`, plus `shoots.$id.tsx` and its index/cull/develop/gallery/social/smart-file children.
- Existing entry wrappers: `src/routes/{clients.tsx,earnings.tsx,outbound.tsx,develop.tsx,deliver.tsx}`.
- Shared appearance: `src/lib/appearance.ts`, `src/styles.css`, `src/components/account/{settings-workspace.css,workspace-personalization.css,AccentColorPicker.tsx,AppearanceBasics.tsx}`.
- Regression coverage: `tests/{shoot-navigation.test.ts,shoot-routing.test.ts,primary-navigation.test.tsx,sidebar-theme-surfaces.test.ts,accent-color-picker.test.ts,workbench.test.ts}` and `scripts/qa/sidebar-navigation-browser.js`.

No native engine, remote integration, environment file, original photo, ledger history, or saved client database is intentionally changed by this navigation work. The new summary adapter is read-only. Library retains existing legacy-directory discovery, which can index a previously saved legacy shoot without moving its photos. New shoot creation and explicitly invoked existing rename/recovery actions retain their normal storage effects; no new backend or photo-data migration is added.

## Run and verify

From the repository directory:

```sh
npm install
npm run dev:lab
```

The local app uses `http://127.0.0.1:8085`. Keep the existing local environment configuration; do not commit it.

```sh
bun test tests/shoot-navigation.test.ts tests/shoot-routing.test.ts tests/primary-navigation.test.tsx tests/sidebar-theme-surfaces.test.ts tests/workbench.test.ts
npx tsc --noEmit
```

Final verification on 2026-09-08:

- Full suite: **1,398 passed, 20 skipped, 0 failed; 297,903 assertions** across 96 files. The existing optional RAW/Lua coverage remains skipped where its fixtures/runtime are absent. Localhost bridge tests require permission to bind temporary local ports.
- Production build, `npx tsc --noEmit`, ESLint on all changed TypeScript files, Prettier checks, and `git diff --check` passed.
- The saved browser regression passed **32 checks**: five primary destinations, six workflow tabs, active selection, visible panes, persistent Cull, Develop mount, single creation action, sans-serif typography, 44px targets, and no horizontal overflow.
- Additional rendered checks covered Dark/Light persistence, Light Blue → Default selection, collapsed navigation, 390×844 and 812×375 layouts, drawer scrolling, Escape and focus restoration, legacy redirects with search/hash, mixed-case Cull links, and invalid source errors. Invalid links did not expose the previous editor/photo.
- One public JPEG imported through Develop's UI and rendered again after a full reload at its canonical shoot URL. This used an isolated QA browser, not customer photos or their browser storage.

The design-review pass informed the shared neutral materials, consistent spacing/font treatment, compact icon rail, and accessible interaction states. These checks verify navigation and theme behavior, not full Lightroom parity or future provider integrations.

For rendered acceptance, check all five primary links, New shoot, all six workflow tabs, old bookmarks, browser back/reload, Library rename/recovery, and a delivery-version-to-Cull handoff. Verify dark/light/system, an existing custom palette, opaque/high-contrast mode, keyboard focus, collapsed/mobile navigation, and unchanged photo counts/edits using isolated QA fixtures rather than customer data.

## Remaining work

- Add real kickoff/deadline/stage metadata before enabling Tonight counts, heroes countdowns, or a pipeline board. Modification time is not a schedule.
- Connect an actual shoot-to-gallery association before automatically selecting a gallery or claiming a shoot-specific delivery status/count.
- Unify or explicitly bridge Cull and Develop ingestion/catalogs before presenting one total photo count. This navigation pass does not copy Develop imports into Cull or change either editor's internal storage.
- Keep Money based on recorded transactions. Parent sales, automated balance reconciliation, tax filing, and integrated payment settlement are not added here.
- Star-to-Story/player cards, publishing permissions/provider readback, roster/FaceFind consent/privacy, SmartFile signatures, and booking deposits need explicit implementations and end-to-end verification. A visible tab is not an integration.
- Preserve source originals, account boundaries, existing histories, and explicit approval for sends/publishing while adding those workflows. No automatic backend or data migration is part of this pass.
