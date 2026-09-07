# Settings workspace

Reference: user-supplied Codex screenshots and the [official Settings reference](https://learn.chatgpt.com/docs/reference/settings), consulted September 7, 2026.
The screenshots define the visual target. Browser limitations are not represented as granted
desktop permissions. This is an adapted settings surface, not complete Codex feature parity.

## What changes behavior

- Black/light appearance, chat text size, reduced motion, sidebar visibility and pointer cursors.
- Enter versus Command/Control+Enter to send; Shift+Enter remains a newline.
- Cloud-assistant opt-out is checked before unmatched messages reach the hosted planner.
  The development lab blocks cloud calls regardless of the stored preference.
- Suggested commands fill the chat composer and require Send; they never execute on click.
- Import speed selects one worker in Gentle mode; Balanced keeps existing bounded parallelism.
- XMP sidecar preference controls parsing for subsequent imports, not existing edits.
- Wake-lock requests are tied to active processing and visible tabs; browser denial is possible.
- Personality/custom instructions are included as user preferences on future hosted requests,
  subordinate to the existing tool-safety instructions. No local command pretends to use them.
- Read-aloud buttons and playback rate use browser speech synthesis; no microphone is opened.
- Cat/dog companion, show/hide via menu or Ctrl+Space outside text fields.
- Research source links obey current-tab/new-tab preference; internal shoot tabs are unchanged.
- Export/import/reset preferences; imports validate a bounded, versioned JSON file, reject
  unknown fields and require confirmation before replacement. No credential or identity export.
- Profile editing uses the existing verified-account implementation outside the lab. Celine Nova
  is only the initial local development persona; no fake Supabase user, email, Pro plan or credits.
- Account menu opens real storage usage, shows/hides pet, offers the public homepage invitation,
  opens Settings, and preserves guarded sign-out/close-workspace behavior. Clipboard denial
  offers a manually selectable link instead of falsely reporting success.

## Navigation and data safety

- 21 indexed sections under Personal, Integrations and Photography; query matches labels/terms.
- Section hashes preserve the shoot query and do not create a tab for every settings section.
- Search hides, rather than unmounts, the active settings editor so drafts survive a search.
- Unsaved drafts block section navigation as well as leaving Settings. Cancel keeps typed data.
- Full-page settings UI hides the workspace chrome without unmounting the shoot controller.
- Responsive mobile navigation closes after selecting a section. Both panes scroll independently.
- Device preferences remain account-scoped. No data migration, deletion or production auth change.

## Explicitly unavailable / adapted

Desktop computer control, arbitrary file access, screen recording, automatic Appshots, OS menu
bar behavior and unattended background processes need a native implementation. They are shown
as unsupported capabilities, not functional switches. Git/worktrees are explained through existing
non-destructive edits, originals, shoots and delivery versions. No executable shell hooks added.
Live voice conversation, cloud billing balances, lifetime token analytics and unconfigured
connectors are not fabricated. Existing connection screens remain the source of readiness.

## Verification

- TypeScript, changed-source lint and normal production build pass.
- 815 tests / 0 failures across 47 files, including preference migration, bounded values,
  file transfer validation, processing limits, search and dev/production identity separation.
- `scripts/qa/settings-check.ts` drives the existing browser through all 21 sections and checks
  title, hash, retained shoot, no horizontal overflow, mobile navigation and profile visibility.
- Manually tested: Celine local profile persistence; unsaved-name Cancel; searching with an
  unsaved draft; sidecar preference across reload; saved custom instructions; Light across reload;
  invalid JSON rejection; valid JSON confirmation/application; Usage menu; invite copy fallback;
  pet visibility and Ctrl+Space; Command+, returns to Settings with the same shoot.
- Speech playback and browser-granted wake locks are wired but actual audio/sleep prevention
  have not been verified on the user's hardware. No real login, billing, client publish or OAuth
  action was performed in this pass.
- Normal production build scanned for Celine/dev-lab identity markers: none found.
- Production publication is not claimed. The working test surface remains loopback-only 8085.
