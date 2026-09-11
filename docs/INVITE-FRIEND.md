# Invite a friend

Implemented in the existing profile menu and Settings > Account. Search Settings for
“invite a friend” to jump directly to it. Both entry points use one compact, accessible dialog.

This is a public product invitation, not a workspace membership, private gallery token,
referral-credit program or server-sent email service. Friends create their own account.

## Behavior

- Shares `https://lenslab.dev/auth?next=%2Fworkspace&mode=signup` by default. The previous
  `lenslabs.dev` default failed DNS resolution; the singular domain's real signup page was
  verified in a signed-out browser. Configured public application origins remain supported.
  Loopback configuration falls back to the public site so friends never receive localhost links.
- Copy confirms success only after the clipboard write resolves. Missing or denied clipboard
  access selects the complete read-only link and gives manual-copy instructions.
- Share appears only when the browser exposes native sharing. Cancellation and refusal allow
  retrying or copying. Native completion is not presented as proof of recipient delivery.
- Open email draft supplies the subject and link, with no recipient. The user chooses who to
  send it to and sends from their mail app. No mail provider integration or background send.
- URL and share payload never contain profile names, email addresses, shoot IDs, chat content,
  tokens or private workspace permissions.
- Repeated clicks are guarded while pending. Closing and reopening fences late results.
  Escape closes the dialog and returns focus to the correct launching control.

## Verification — September 7, 2026

- 10 invitation tests repeated 1,000 times: **10,000 pass, 0 fail**.
- Full suite: **981 pass, 0 fail**, 59 files, 192,830 assertions.
- Production build, TypeScript, scoped lint and whitespace checks pass.
- **27 real-browser assertions pass:** both entry points, keyboard focus, copy fallback/retry,
  native share outcomes, mailto content, pending/late results, reload, search, clean console,
  1440/768/390/320px layouts and the live signed-out recipient signup page.

Browser runner: `scripts/qa/invite-friend-check.ts` with the installed browse executable.
Evidence: `/private/tmp/lenslabs-invite-friend-qa/` (checks JSON and desktop/mobile screenshots).
The runner uses isolated launched Chromium and a synthetic shoot. It does not import real
cookies, read the system clipboard, change user data, create accounts, send messages or email.
Clipboard success and native share are tested with controlled API doubles; the actual browser's
denied-copy path was also checked. Email clients, OS share destinations and completed real
account verification remain outside this test. The live recipient page loaded and requested
the recipient's own information; no credentials were entered.

Harness fixes: the visible Settings profile-menu selector was scoped away from a hidden duplicate;
a multi-statement expression was corrected; layout assertions now wait for opening animations
and allow one pixel of browser rounding. The final complete run passed.

Local source updated only. No commit, push, account change or production deployment was made.
Existing unrelated work and `.env.development` were preserved.
