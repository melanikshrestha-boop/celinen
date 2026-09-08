# Settings workspace — historical implementation notes

**Superseded:** the current implementation, canonical routes, verification and capability matrix
are in [SETTINGS-REFINEMENT.md](./SETTINGS-REFINEMENT.md). The earlier hash routes, Black/Light-only
choices and photography analogies below are retained as history, not current behavior.

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
- Read-aloud buttons use the selected browser voice and playback rate; unavailable voice IDs
  fall back without erasing the saved preference. No microphone is opened. Some browser voices
  can use an online speech service.
- Completion notifications support Always, When away and Never. A settled live chat creates a
  generic alert, not a claim that proposed edits were applied. Restoring history creates no alert.
  Optional desktop delivery requires existing browser permission; permission is requested only
  from its explicit button. Unsupported/denied desktop delivery falls back to an in-app alert.
  Notifications contain no response text, photo previews, filenames or client identity.
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

- 23 indexed sections under Personal, Integrations, Photography and Archived; query matches labels/terms.
- Archived chats has a direct Restore action. Its filter overrides retained component state when
  navigating from Activity history; a browser regression caught and verified this transition.
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
- 876 tests / 0 failures across 52 files, including preference migration, bounded values,
  file transfer validation, processing limits, search and dev/production identity separation.
- `scripts/qa/settings-check.ts` drives the existing browser through all 23 sections and checks
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

### September 7 refinement verification

- Retained the dedicated sidebar, black canvas, subtle groups and Celine local profile. Widened
  the navigation rail to 280px and contained the main column to 920px including padding.
- Verified Always notifications across reload, the in-app test button, a real harmless local
  chat completion alert, and a usable composer afterward. No desktop permission was granted.
- Created one synthetic QA conversation in shoot `592c4b76-9da7-4ac6-83aa-f4cfcbbd8712`, archived
  it, found it in the dedicated archive section, restored it, and verified the retained shoot ID.
  No photographs were imported or altered for these tests.
- Verified Black/Light are the only theme choices and Light persists after reload; verified
  1.25x speech rate and an installed Samantha voice selection persist. Actual audio output and
  OS notification delivery remain unverified; neither is claimed from UI tests.
- Final TypeScript, changed-source lint, build, and whitespace checks pass. Unit tests include
  notification focus policy, opt-out, denied/throwing desktop fallbacks, no unsolicited permission
  requests, portable voice selection, and the archive filter regression.
