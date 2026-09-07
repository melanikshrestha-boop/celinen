# Isolated account QA

Run from the repository root:

```sh
bunx vite --config scripts/qa/account-workspace/vite.config.ts
```

Use a disposable browser tab at **http://127.0.0.1:8083/**. This is a separate origin from the real app. It renders the actual AccountProvider, AccountSetup, ProfileForm, AccountMenu, Settings, Chat navigation button, Sidebar primitives, and workspace styles. The surrounding tool navigation is a minimal fixture shell, not the whole photo engine. Supabase and external services are stubbed: this cannot certify live OAuth, production persistence, Gmail, or publishing.

Finish the two-field setup with a synthetic workspace name. Then run:

```sh
/Users/melanishrestha/.claude/skills/gstack/browse/dist/browse eval scripts/qa/account-workspace/check.browser.js
/Users/melanishrestha/.claude/skills/gstack/browse/dist/browse eval scripts/qa/account-workspace/session.browser.js
```

`check.browser.js` changes only the synthetic profile and browser-local preferences. It covers all six settings sections, save failure/retry, duplicate submission, cancel, retained drafts, theme changes, text/motion settings, connector readiness, shortcut filtering, storage estimates and horizontal overflow. Run at 320, 390, 820 and 1440px. Also check a 640×450 viewport with enlarged root text (32px), restoring normal text afterward. Inspect screenshots, not only bounding boxes.

`session.browser.js` deliberately switches between two synthetic account IDs during a save, tests setup failure/retry, and delays session verification across setup completion. Reload afterward: setup should stay complete, with the correct account profile and isolated preferences. Fixture profile persistence uses a QA-only local key to simulate server readback; production uses authenticated Supabase metadata.

Both scripts reject any other origin. Do not modify the guard or point them at a user's signed-in session. Do not use test names or local-storage fixtures as production identity data. `window.__accountQA.reset()` clears only the fixture identity key, not real shoots or application accounts.

Production acceptance still requires the published app and an authorized test account: homepage → sign up → verified sign-in → profile setup → workspace → settings save → fresh-browser login. Test real configured provider callbacks and profile persistence without inspecting passwords or verification codes.
