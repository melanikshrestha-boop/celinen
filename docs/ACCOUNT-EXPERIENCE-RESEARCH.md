# Account and workspace experience

Reviewed September 6, 2026. This is a focused implementation reference, not a claim to have tested every screen or copied a proprietary application exactly.

## Reference findings

Lovable creates a personal workspace after account creation and separates account identity from workspace membership and billing. LensLabs now confirms a name and personal workspace name on the first verified workspace visit, saves them to the authenticated account, and returns directly on later visits. Public browsing and the existing sign-in providers stay unchanged. [Lovable account creation](https://docs.lovable.dev/introduction/create-an-account)

Lovable separates profile information from preferences and linked login methods. LensLabs uses editable name/workspace fields, a read-only sign-in email and provider, and explicit save/error states. A workspace name is presentation metadata: it does not grant membership or move anyone's shoots. [Lovable account settings](https://docs.lovable.dev/introduction/lovable-account-settings)

Codex groups settings by purpose, supports the settings keyboard shortcut, appearance preferences, message-send behavior, and keyboard-shortcut discovery. LensLabs follows these interaction patterns for Account, Appearance, Chat, Connections, Data & privacy, and Keyboard shortcuts. The requested Black/Light-only appearance takes precedence over Codex's broader theme choices. Native-only capabilities, billing quotas, and unconfigured connectors are not simulated. [Codex settings](https://learn.chatgpt.com/docs/reference/settings)

## Implementation decisions

- Adapt to the actual settings pane, not only the browser width. A compact section picker replaces the second sidebar below 760px of content width; controls stack when the detail pane is narrower than 460px.
- Use full-width profile inputs and wrapping identity text. No additional dashboard cards or marketing introduction.
- Persist account profile/setup completion with the authenticated server request. Validate names, retain Unicode, reject control characters and unknown input fields, check the expected account before the request, and verify the response owner.
- Keep browser appearance and send-key preferences account-scoped and explicitly browser-local. Do not claim cloud synchronization for these settings.
- Preserve profile drafts across settings-section changes. Block accidental navigation with unsaved changes, retain failed-save input, and prevent double submission.
- Keep Chat navigation distinct from New chat. Opening Chat returns to the current shoot; New chat starts fresh while the previous shoot stays available.
- Keep the original Studio engine, delivery workflow, account isolation, and saved media intact. No database migration, media rewrite, or provider permission expansion is required for this profile change.

## What this does not establish

The official documentation and supplied screenshots establish interaction patterns, not a verified pixel-for-pixel first-registration sequence. We did not create a competitor account, inspect anyone's password, or exercise paid/native-only features. Real provider authentication, production profile persistence, and configured external services still need a signed-in live acceptance pass after publication. The isolated QA fixture tests real LensLabs components with synthetic authentication responses, not those external services.
