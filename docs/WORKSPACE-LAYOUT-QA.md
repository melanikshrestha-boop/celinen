# Workspace visual refactor · 2026-09-07

Status: DONE_WITH_CONCERNS. Implemented and verified locally; not published.

## Scope

The attached workspace specification was implemented as a presentation refactor. The empty welcome wrapper, prompts, upload hero and empty status badge are removed. The only empty-canvas instruction is the textarea placeholder `Drop your shoot folder.`

Shared geometry: 272px desktop sidebar, 56px toolbar, 820px maximum conversation/composer column, 24px desktop clearance, 12px phone gutters, and a 64px empty composer. The textarea grows to 192px, then scrolls. Actual tool tabs remain functional inside the single toolbar; a chat with no open tools has no decorative tab row.

Recent shoots are text-led. Conversations are nested under their owning active shoot. Primary navigation and the account control remain outside the scrolling recent list. Below 1024px navigation is an overlay drawer with focus restoration. Chat actions remain mounted when the drawer is closed. Narrow-screen chat menus open vertically to avoid the observed 5px left-edge clipping.

The import shelf describes the actual selection, not a second upload queue. Unknown counts remain unknown during directory enumeration. Individual supported images use their real temporary object-URL thumbnail; folders use one compact summary. Stop uses the existing import cancellation path. Dismiss removes only the receipt, never imported photos. Selection/drop stays in the conversation; opening Studio is explicit. Existing directory traversal, native/browser processing, sidecars, proposal review and persistence remain unchanged.

No authentication, account identity, billing, database schema, settings values, server integration, or original photo data was changed in this pass. Pre-existing dirty work was preserved, including the development environment file. No commit, push, migration or deployment was made.

## Evidence

- 989 regression tests passed across 60 files (193,146 assertions).
- 99 isolated-browser matrix checks passed across 1440×900, 1280×800, 1024×768 and 390×844.
- 13 focused checks passed for light mode, tablet drawer behavior, 44px mobile send target, Shift+Enter, IME Enter, draft restoration, whitespace readiness, short viewport, cancellation, and a real image thumbnail.
- TypeScript, scoped ESLint and `git diff --check` passed.
- Production client/server build passed. Existing TanStack/Vite deprecation notices remain.
- No browser console errors were observed in the final matrix or focused checks.

Measured empty composer geometry:

| Viewport | Left | Width | Height | Bottom clearance |
| --- | ---: | ---: | ---: | ---: |
| 1440×900 | 446px | 820px | 64px | 24px |
| 1280×800 | 366px | 820px | 64px | 24px |
| 1024×768 | 296px | 704px | 64px | 24px |
| 390×844 | 12px | 366px | 64px | 12px |

The matrix captures empty, one-line, multiline, selected folder, long folder name, populated conversation, chat menu, account menu and error states. It verifies shared-column alignment, menu bounds, no page overflow, reserved hover-action space, sidebar collapse, scroll-position preservation and Jump to latest. Synthetic File objects pass through the real drop handler and folder walker; fixtures are not added to the user's browser or shoot.

## Reproduce

With the existing development lab running on `http://127.0.0.1:8085`, use the separately launched gstack browser (the script refuses a non-launched session):

```sh
bun scripts/qa/workspace-layout-check.ts /Users/melanishrestha/.codex/skills/gstack/browse/dist/browse
bun scripts/qa/workspace-layout-check.ts /Users/melanishrestha/.codex/skills/gstack/browse/dist/browse extras
```

Artifacts: `/private/tmp/lenslabs-workspace-layout-qa/`. This includes `checks.json`, `extra-checks.json`, viewport/state PNGs, `matrix.html`, `matrix.png`, and `final-build.log`. The fixture runner uses random synthetic shoot IDs in isolated Chromium and restores that browser's presentation preferences afterward. It does not touch the live shoot `d32945d1-257b-4884-bc6b-38a58725c6b3`.

## Verification limits

Responsive Chromium and a short 390×480 viewport were tested, not a physical phone with its native software keyboard. VisualViewport resizing and safe-area spacing are implemented; device-level iOS/Android keyboard behavior still needs a real-device pass.

Inspecting the user's live browser inventory was denied by auto-review to protect unrelated signed-in tabs. That denial was respected; no cookies, passwords or private browser state were imported. The native preview request was queued, so this report does not claim the user's existing tab was inspected or visibly refreshed. Native live-browser inspection would require the user's approval. The local application URL remains usable directly; these changes have not been published to the production site.
