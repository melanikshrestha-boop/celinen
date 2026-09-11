# Sidebar hover and desktop-style navigation

Verified locally on September 7, 2026 at `http://127.0.0.1:8085`.

## Changes

- Each chat's pin and overflow controls appear on its own hover, keyboard focus, or while its menu is open. Pinned and active chats no longer keep controls visible at rest.
- Chat-heading new/archive controls are hover/focus-only. The chat-specific search button and search field are removed. Touch devices retain reachable controls.
- Compact Lens Lab header with the existing aperture mark, sidebar toggle and working Back/Forward controls. No cloud icons or simulated macOS traffic lights.
- New chat creates a conversation in the current shoot; New shoot creates a separate shoot. Studio, Delivery and Clients remain in All tools.
- Translucent charcoal/light material with backdrop blur, neutral selection and native system typography. High-contrast/reduced-transparency fallback remains opaque.
- History state is outside the shoot-keyed chat session and mobile drawer. QA caught and fixed Forward being reset on a shoot switch.

## Verification

- TypeScript: `npx tsc --noEmit` passed.
- Targeted ESLint for the changed components, hook and new QA scripts passed without warnings.
- `bun test tests/conversation-controls.test.ts tests/shoot-tabs-appearance.test.tsx tests/account-settings.test.ts tests/settings-workspace.test.ts`: 39 passed, 0 failed.
- `scripts/qa/sidebar-hover-check.ts`: 28 isolated-browser checks passed. Covers hidden/hover/focus controls, pinned persistence, menu reachability, archive view, new chat versus new shoot, Back/Forward, branching history, tools navigation, unchanged synthetic transcript, translucency, high contrast, mobile geometry and drawer dismissal. No browser runtime errors.
- `scripts/qa/sidebar-polish-check.ts`: 72 isolated-browser checks passed across desktop/mobile, dark/light and yellow/gradient accents. Covers typography, neutral selection, target size, overflow, account-menu font and keyboard focus. No console messages.
- `npm run build` passed after the final source changes.
- The older conversation-controls browser script now hovers the intended controls before clicking; its full suite was not rerun in this pass.

Evidence is in `/private/tmp/lenslabs-sidebar-hover-qa/` and `/private/tmp/lenslabs-sidebar-polish-rgKp9p/`. Desktop idle/hover and dark/light mobile screenshots were visually inspected.

## Boundaries

All browser mutations used synthetic chats in a separate launched QA browser. No real user chats, photos, credentials, or account sessions were modified. Existing Celine development identity and Studio processing were preserved. No deployment, push or commit was performed. Browser backdrop blur cannot provide OS wallpaper vibrancy or native macOS window controls; those belong to the future desktop shell.
