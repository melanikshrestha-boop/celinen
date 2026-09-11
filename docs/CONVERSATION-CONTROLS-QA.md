# Conversation controls and creative preferences

Verified September 7, 2026 in the existing loopback development app at
`http://127.0.0.1:8085`. This is a local implementation, not a production release.

## Available now

- Each saved conversation has hover/focus pin and more-actions buttons. The menu
  includes client sharing, rename, pin/unpin, archive/restore, confirmed deletion,
  custom sections, Quick Chat, unread status and Adobe export. There is no
  chatgpt.com action. Archived chats remain accessible from the history header
  and Settings → Archived.
- The conversation header's plus button starts another chat in the same shoot.
  The main New chat action still starts a separate shoot. Deleting a conversation
  does not delete its shoot, photographs, edits or other conversations.
- Quick Chat uses the existing conversation and composer. Closing or expanding
  it preserves the draft; it does not duplicate the assistant or send a message.
- Client sharing previews the transcript before exporting self-contained HTML.
  Original photos, tool receipts, unsent drafts and private connector requests
  are excluded. Text is escaped and the file uses a restrictive CSP. Supported
  browsers can share the actual file through the device share sheet. Unsupported
  browsers retain the download action. A downloaded copy cannot be revoked.
- Adobe export uses the current Studio session's collision-safe sidecar exporter.
  It downloads one ZIP containing matching XMP paths and supported edits/picks.
  It preserves existing star ratings rather than inventing stars from AI scores.
  Extract separately, back up existing XMP, and read metadata in the editor.
- General and Appearance expose System/Dark/Light, System/Standard/More contrast,
  eight accent presets, validated hex colors, an optional two-color selection
  marker and an optional workspace dot grid. Photographs are not tinted.
- English/Spanish/auto-detect preferences affect navigation, common settings
  labels and assistant reply instructions. Some detailed help/tool copy remains
  English; auto-detect currently falls back to English for other locales.
- File destination choices open Studio, the Adobe export dialog, or the real
  folder-import picker. The browser cannot launch native Adobe/Finder or access
  arbitrary folders without selection.
- Shortcuts are searchable, recordable, removable and resettable. Conflicts and
  reserved browser combinations are rejected. Added actions cover per-shoot and
  temporary chats, Quick/side chat, archive, unread, pin, rename, new window,
  composer focus and Go to photo (the photography equivalent of Go to line).
  Website starter bindings differ where the browser owns a native shortcut.
- Temporary chats are memory-only, with discard confirmation when leaving a
  populated chat. This does not make cloud assistant requests private from the
  selected assistant provider; it only changes history/draft persistence.

## Verification results

| Check                                       | Result                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| Full repository suite                       | 988 passed, 0 failed; 193,134 assertions across 60 files               |
| Browser chat lifecycle                      | 27 checkpoints passed                                                  |
| Browser appearance/shortcuts                | 27 checkpoints passed, including 320/390/768/1440px widths             |
| Browser notification behavior               | 9 checkpoints passed                                                   |
| Browser Adobe/photo-jump path               | 13 checkpoints passed                                                  |
| Browser native-share lifecycle              | 9 checkpoints passed                                                   |
| Browser IndexedDB stress                    | 2 checkpoints passed, including 1,000 cycles / 4,000 safety assertions |
| Isolated PostgreSQL migration checks        | 52 assertions passed                                                   |
| TypeScript, scoped ESLint, whitespace check | Passed                                                                 |
| Production build                            | Passed; existing dependency deprecation/chunk warnings remain          |

Browser tests use a separately launched Chromium, synthetic conversations and a
128px canvas-generated PNG. They do not import the user's browser cookies, send
real messages, prompt for OS notification permission, or mutate the user's shoot.
Notification and native-share provider boundaries are controlled test doubles;
downloaded HTML/XMP bytes and actual UI state/persistence are verified directly.
The Adobe ZIP was parsed and CRC-checked, but was not imported inside Lightroom.

The 1,000-cycle test verifies wrong-shoot deletion rejection, stale revision
rejection, metadata persistence and stale-writer rejection after deletion. The
SQL test applies the old migration, inserts legacy data, then applies the new
migration and verifies owner/RLS isolation, compatibility, CAS and quotas.

Reproducible browser phases:

```sh
bun scripts/qa/conversation-controls-check.ts /path/to/browse chat
bun scripts/qa/conversation-controls-check.ts /path/to/browse storage
bun scripts/qa/conversation-controls-check.ts /path/to/browse appearance
bun scripts/qa/conversation-controls-check.ts /path/to/browse notifications
bun scripts/qa/conversation-controls-check.ts /path/to/browse adobe
bun scripts/qa/conversation-controls-check.ts /path/to/browse sharing
```

Run against an isolated launched browser, never an attached real-user session.
Artifacts and screenshots are in `/private/tmp/lenslabs-conversation-controls-qa`.
The new unit regressions are in `tests/conversation-controls.test.ts`.

## Release boundary

`drizzle/migrations/0020_conversation_controls.sql` must be applied through the
approved database release workflow before deploying the new cloud conversation
controls. It was tested in isolated PostgreSQL, **not applied remotely**. No
commit, push, account bypass or production deployment was performed for this turn.

Desktop notifications require browser permission and an open LensLabs page.
Background push after closing the app is not connected. Public hosted/revocable
conversation links, automatic client delivery, native Adobe/Finder launching and
additional translated locales are not represented as completed features.
