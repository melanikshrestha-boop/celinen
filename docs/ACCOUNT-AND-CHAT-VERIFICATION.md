# Account, settings, and chat workspace

Implemented September 6, 2026. This is a functional account/settings/chat pass, not a claim of complete Codex feature parity.

## Working behavior

- A single account provider owns restored Supabase sessions, user identity, and explicit sign-out. Cached restoration cannot override a newer authentication event. Sign-out checks pending work and binds to the starting identity. Local development has a separately labeled device profile and a persistent close/reopen state, not fake cloud authentication.
- Profile names are validated. Hosted profile updates use an owner-checked, captured bearer request, not the SDK method that can rewrite a signed-out session after a delayed response. Cached identity is refreshed from Auth on reopening.
- The sidebar profile menu opens settings and signs out. Settings has account, appearance, chat, connections, data/privacy, and keyboard sections. Theme, text size, reduced motion, send shortcut, and sidebar visibility affect the real interface and persist per account on the device.
- Private chat history supports recent conversations, title search, rename, archive/restore, export, and New chat without resetting photos. Local history/drafts use separate IndexedDB storage. Hosted sent messages use an owner-only table; cloud drafts remain in an account-owned memory map and require confirmation before logout. Draft-only conversations create a content-free metadata row so their local draft remains reachable while the tab stays open.
- A failed chat save preserves the newest recovery snapshot. Concurrent writers use revision checks. Restored messages are historical text, not executable tool calls. Gmail/search requests are redacted before chat persistence and excluded from planner context.
- Safe tool-tab locations survive reload; connection requests, message subjects, private query strings, and focused delivery links are not persisted. Existing Studio state, approval requirements, photo storage, and C++ processing remain separate.
- Connection controls use actual Gmail authorization/configuration and search readiness. The previous fake Lightroom connection switch was removed. Browser storage shows a real origin-wide estimate, not an invented account quota or subscription balance.

## Verification

- TypeScript and targeted lint pass.
- Full regression suite: 706 tests, including account restoration ordering, bounded preferences, keyboard behavior, connector privacy, safe tab metadata, and chat-save admission.
- Isolated IndexedDB checks cover chat reload/drafts, account/project isolation, rename, archive/restore, stale revisions and racing first saves. Existing Studio storage regression script also passes.
- Isolated PostgreSQL check: 33 assertions covering owner isolation, direct-write denial, CAS, archive/restore, strict RPC records, cloud-draft rejection, rate limits and owner row quotas. These checks do not contact hosted databases.
- Browser QA used the separate `127.0.0.1:8080` origin with a test profile and one repository fixture photo. It did not sign out of the real account or edit the user's `localhost` shoot. Verified profile save/reload, light theme, reduced motion, mobile settings at 390px, Enter versus Ctrl+Enter, sent history and draft restoration, rename/archive/restore, New chat retaining the photo, closure blocked by a preview, persistent local closure/reopen, settings shortcut, real storage estimate, and safe tool-tab restoration.
- Observed no JavaScript errors in these flows. Chromium emitted existing Canvas2D readback-performance warnings during fixture processing.

## Deployment and remaining verification

This pass is local. Keep the established Lovable/Supabase deployment; do not create a second hosting project.

Before enabling hosted chat history, apply `0017_private_workspace_chats.sql` through the existing migration workflow and deploy the matching server functions. The migration is additive and grants authenticated clients SELECT plus the owner-scoped save RPC, not direct writes. It enforces 500 conversations and 50 MiB per owner, with 300 saves/minute. Archived records still count.

Hosted Google sign-in, token expiry/revocation, profile saving against real Auth, account switching between two real users, Gmail consent/revocation and in-app search require live-provider verification after deployment. They were not represented as tested by the local-profile browser checks. Gmail requires the configured Google OAuth client and approved origins; search requires the existing provider/backend setup. No production deployment, provider authorization, email sending, paid plan, or usage entitlement was created in this pass.

Cloud unsent drafts do not survive closing/reloading the tab; this is disclosed in Settings and next to the composer. Device-local profiles are not a security boundary. Secure remote access uses actual hosted authentication.
