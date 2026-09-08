# Settings retest — September 7, 2026

Scope: the current 23-section Settings workspace at the separate loopback lab. This is
local QA and a narrow upload fix, not a production release or a claim of native Codex parity.
Existing project changes and the user's environment file were preserved; no commit or push.

## Fixed: SETTINGS-001 — raster uploads with missing MIME labels

The real Profile UI rejected a valid PNG if the browser's File.type was empty. It displayed
“Choose a JPEG, PNG or WebP under 4 MB.” The screenshot alone does not establish whether this
was the cause of the user's particular file; the user was asked for that original to verify it.

The avatar/companion reader now recognizes JPEG, PNG and WebP signatures from at most 16 header
bytes, normalizes the decoder's MIME hint, and still requires successful browser decoding.
Files over 4 MiB are rejected before reading. Existing 20-megapixel and cropped-output bounds
remain. SVG/HTML disguised as PNG, corrupt images and oversized files cannot become avatars.
No new image formats, external uploads, account permissions or layout changes.

Browser evidence under /private/tmp/lenslabs-settings-audit-20260907-1900/:

- avatar-missing-mime.png: reproduced rejection before the fix.
- avatar-missing-mime-after.png: the same valid PNG reaches the actual crop controls.
- profile-avatar-saved.png: crop saved, reloaded and decoded as a 128px JPEG.
- import-invalid-state.png: invalid settings rejected with no open confirmation.
- capture-synthetic.png: synthetic frame preview after its stream tracks are stopped.

## Automated repetition

Final full suite: **971 passed, 0 failed**, 58 files, 192,788 assertions.
Settings stress run: **1,000 repetitions of each of six test files**, **69,000 passed,
0 failed**, 1,433,000 assertions. These are 69 repeated test cases per iteration, not
69,000 different features and not 1,000 live provider/account/hardware journeys.

Files: settings-refinement, settings-workspace, account-settings, shoot-tabs-appearance,
workspace-notifications, and the 19 new avatar-image regression cases. Coverage includes
schema bounds, all section identities, preference isolation and stale changes, theme
contrast/roundtrips, consent-safe imports, shortcut conflicts, notifications, scoped tabs,
image signatures, missing/wrong MIME hints, read failures and size boundaries.

Commands:

    LENSLABS_TEST_LUA=/private/tmp/lenslabs-lua-qa.hvcroe/lua-5.1.5/src/lua bun test
    bun test tests/settings-refinement.test.ts tests/settings-workspace.test.ts tests/account-settings.test.ts tests/shoot-tabs-appearance.test.tsx tests/workspace-notifications.test.ts tests/avatar-image.regression-1.test.ts --rerun-each=1000

Normal production build succeeds. Typecheck, scoped lint and whitespace checks pass.
No new dependencies. Build output is not a deployment.

## Browser coverage and isolation

The existing isolated launched Chromium browser drives the real 8085 app, not an HTML mockup.
No real browser cookies, accounts, saved shoots or profile are imported. Only synthetic shoot
592c4eee-0c8e-4f6c-bd43-4fd583bd1b9a is used. Avatar fixtures contain generated solid pixels.
Test profile changes are restored and test avatars removed.

Reproducible runners:

- scripts/qa/settings-live-audit.ts: navigation, profile and controls phases.
- scripts/qa/settings-recovery-audit.ts: storage failure and shortcut flows.
- scripts/qa/settings-media-audit.ts: synthetic microphone/capture lifecycle.

Navigation covers every page at 1440×900, 1024×768, 390×844 and 320×740: route/heading,
shoot context, desktop reload, duplicate IDs, horizontal overflow and console errors.
All indexed search targets are present. Search focus/empty state and back/forward are checked.

Profile checks cover save/reload of name, workspace and Unicode biography; unsaved navigation;
PNG/JPEG/WebP crop, save/reload/removal/cancellation; corrupt, unsupported and oversized inputs;
and recovery after an invalid upload. Storage failures preserve effective preferences, unsaved
profile text and the ability to retry. Shortcut tests cover search, conflict rejection, recording,
reload, per-command reset and cancelling reset-all.

Control checks exercise locally available switches and each dropdown option in General, Import,
Appearance, Configuration, Personalization, Pets and Browser. Changes are reloaded and restored.
Color modes and interface/code size bounds are checked against applied DOM/CSS; instructions
and terminology persist. Portable import is previewed, cancelled, applied and rejected when invalid.
This does not prove a hosted assistant used those preferences in a real conversation.

Media checks use explicit synthetic API replacements in the test browser: no physical microphone,
screen or other app is accessed. They verify no access request on mount, denial/retry, microphone
meter/stop, stopping late permission grants, capture preview/discard and release of all tracks.
Reload removes these test replacements. Physical hardware and real OS permission dialogs remain
unverified. The tests do not send audio, screenshots or photos to a service.

Test harness corrections were not product bugs: the CLI rejects empty-string fill arguments;
primitive output could conflate the string “false” with a boolean; Radix option labels require
exact accessible selectors; closed dialogs remain briefly mounted for exit animations. Assertions
were corrected and rerun. The production fix is confined to the avatar reader.

## Not completed or not established by this test

See SETTINGS-REFINEMENT.md for the full per-page capability matrix. These remain explicit gaps:

- Cross-device preference sync and server-side atomic stale-profile protection.
- Real authentication/session revocation, cloud profile writes, billing and entitlements.
- Live voice conversations, actual microphone quality and OS capture/notification permissions.
- Native computer control/history, menu bar, terminals, installed plugins, hooks, Git and worktrees.
- Live Gmail/social/search-provider authorization and remote publication.
- Actual photo-editing hotkey effects on a ground-truth RAW dataset and real native-engine speed.

Pages for unsupported capabilities are checked for navigation and their honest disabled state.
They are not counted as working integrations. No connection is granted, account signed out, billing
changed, photo published, purchase made or production deployment attempted by this retest.

## Final browser result

**293 browser assertions passed across five phases:** navigation 189, controls 70,
profile 14, storage recovery/shortcuts 10, synthetic media lifecycle 10.
The final navigation and controls rerun completed successfully after the harness corrections.
These counts are assertions within workflows, not 293 different features or full end-to-end journeys.

Result: the tested local Settings flows pass, with the unsupported and unverified capabilities
above still outstanding. This is not an all-features-ready or production-release certification.
The real user's profile, avatar, shoots and sign-in session were not changed.
