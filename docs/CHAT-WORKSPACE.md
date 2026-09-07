# Chat-first photography workspace

The signed-in home is `/workspace`. This is the user's September 5 explicit request to replace the top-navigation application shell with a Codex-like chat and sidebar. Public marketing, authentication, and client gallery routes remain outside the shell. Local single-user mode still opens without sign-in.

## Behavior

- The real Studio controller owns one mounted photo chat and shoot. A React portal places that chat in the central conversation. Opening or hiding a tool does not unmount it.
- Sidebar links open URL-backed, closable tool tabs. Modified clicks remain real links. Command-K searches tools; `open delivery` and `open proofing` are explicit navigation commands, not authorization to send photographs.
- The default sidebar shows Chat, Studio, Delivery, and Clients. All 18 tools remain available in the keyboard-searchable **All tools** menu (also Command/Ctrl-K or the tab-strip +). Projects stay in the project selector; Gmail, research, and business features are not removed.
- The workspace chat has no starter-action buttons or duplicate import links. Its composer retains just attachment + and Send at rest. Progress, Stop import, and proposal approval controls appear when relevant.
- Embedded Studio uses one filter selector instead of five filter buttons, with Auto-cull in Shoot actions and export visible only with keepers. Its empty drop surface remains clickable/keyboard accessible. Standalone Studio retains its original controls.
- Inactive tab-close icons appear on hover/focus for mouse users, and remain visible for touch. Mobile uses one Chat/Tool switch. The tools menu supports arrow keys, Enter, and Escape with focus return.
- Chat accepts the existing folder drop and file/folder picker. Plain-English edits and supported Adobe settings still stage reviewable proposals; originals and approval boundaries are unchanged.
- Below 850px, Chat and the active tool use a header toggle. Hidden tools do not receive photo/video shortcuts. A direct tool link opens its tool on mobile.
- Studio tab identity includes project, source frame, and exact delivery version. Invalid, conflicting, and unsupported project references block editing rather than opening an unrelated shoot.
- Switching tools retains the photo conversation. Changing the actual shoot/version starts a separate controller and warns if conversation, import, or preview work will be lost. Chat history is session-local, not a durable multi-conversation service.
- A project selector opens existing local shoots. Each shoot has its own tab strip. The + button can open multiple distinct Gmail and research tabs; switching tabs preserves each pane's search, results, and readable message. Research/message titles update without changing the tab identity. Up to 32 tabs can be opened through workspace controls.
- Gmail and research panes stay mounted until closed or signed out. Other tool tabs are navigable views, not background processes. Gallery/comment/client forms and live video review have leave guards. Reopening Video requires reconnecting originals; review marks are saved.
- `search the web for indoor sports lighting` and `search my gmail for Halden` open a scoped tab. Only an explicit current chat request can start a search automatically; merely restoring a URL never reads mail or runs a paid search. Search results and message bodies are not added to the assistant's context.
- Returning to a research/mail tab for the current project preserves the currently reviewed delivery version, even if that tab was opened at an earlier revision. Initial deep-link loading and switching to a different project honor the link's original source identity.
- Tabs, drafts, search results, and mailbox connection are session-local. Reloading restores the current tool URL, not the full tab session. Named projects still require local single-user mode; this feature does not add cloud project storage.

## Data boundaries

Private workspaces remount when the authenticated account changes. Studio IndexedDB and video review localStorage use account-specific namespaces, including write queues, revision state, and locks. Existing unnamed device-local records remain in their original namespace without migration or deletion. These namespaces prevent accidental cross-account restoration; they are not encryption against someone with browser/device access.

## Verification

- `bun test`: routing, proposals, folder imports, delivery state/security, native processing, and review persistence.
- `bun scripts/workbench-storage-check.ts /absolute/runtime-with-fake-indexeddb`: isolated Studio A/B/device separation, delayed writes, clear preservation, and stale writer rejection. Does not touch real browser storage.
- `npx tsc --noEmit`, production build, targeted ESLint, and `git diff --check`.
- `node scripts/workspace-search-sql-check.mjs /absolute/runtime-with-pglite`: isolated owner/global search budget, concurrent lease, expiry, and database privilege checks.
- No visual browser QA or real OAuth provider sign-in has been performed for this change. Local preview only; the existing Lovable/Supabase deployment has not been published or reconfigured.

Provider activation and privacy boundaries are documented in [WORKSPACE-CONNECTIONS.md](./WORKSPACE-CONNECTIONS.md).
