# Creator-first sharing

Status: DONE_WITH_CONCERNS. Implemented and verified locally; not deployed.

## Product loop

Publish approved photo copies with permission → share the public story → recipients view without signup → forward the story or contact its creator → optionally create their own LensLabs workspace.

Creator benefit comes first: named public attribution, portfolio navigation, and a targeted inquiry path. No artificial likes, views, income promises, referral balances, forced account wall, unsolicited messages, or automatic social posting were added. This slice supports photo stories, not video hosting.

## Use

1. In Network, explicitly publish a creator profile and choose whether to accept requests. Private account names are never substituted for unpublished identities.
2. In Publish, select approved/released finals and confirm public-publishing permission as before.
3. Once the portfolio destination is published, use **Share story** in publishing history or on the public story itself.
4. A recipient can view and forward the story without an account. **Work with this creator** opens that exact creator. Sending an inquiry requires verified sign-in and returns to the same recipient.

Requests use the existing inbox workflow, idempotency protection and server authorization. They are inquiries, not confirmed paid bookings. No email notification is implied. Unavailable creators get a portfolio link instead of a booking CTA. Hidden profiles do not expose their name or offer inquiries.

## Preview/privacy boundary

- Server-rendered Open Graph/X metadata is specific to each published story.
- The cover URL is stable: `/api/public/stories/:id/cover`. It rechecks publication and explicit permission for each request, then serves only the first bounded JPEG copy in `publishing-media-v1` whose owner/story/version path matches the record.
- No private gallery capability, original, client name, private note, account email, or signed storage URL is put into the forwarded URL or preview metadata.
- Invalid, unpublished, and non-permissioned records do not yield an image. Storage failures return a retryable generic response. Responses are no-store and nosniff.
- Unpublishing stops new preview requests. Messaging platforms may keep previously fetched previews or recipients' saved copies. The publishing screen states this limitation.
- Copy confirms only after the writer resolves, with selectable manual fallback. Native sharing handles cancellation separately. Email is a recipient-free draft. Pending/late dialog operations are fenced.

The implementation follows the [Open Graph protocol](https://ogp.me/) for item-specific previews and the browser's [Web Share behavior](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share), including user-triggered sharing and cancellation. Actual preview rendering/caching remains controlled by each messaging platform.

## Evidence

- 1,018 regression tests passed across 61 files, including 29 new story/preview/privacy tests. 193,228 assertions.
- 35 isolated browser assertions passed: public story, creator attribution, targeted inquiry, copy success/fallback, native share success/cancellation/unavailable, payload allowlist, late results, duplicate prevention, focus return, 1440/768/390/320 widths, long Unicode titles and light/dark rendering.
- TypeScript and production build passed. Scoped ESLint: no errors; two existing PublishDesk hook warnings remain. Existing build chunk/inlineDynamicImports warnings remain.
- `git diff --check` passed. Final browser console and application error capture were clean.
- Screenshots were inspected. The light-mode capture was corrected to wait until the opening animation settled; the original intermediate animation frame is not the final state.

Reproduce with `bun test tests/story-sharing.test.tsx` and the isolated Vite fixture at `scripts/qa/story-sharing/vite.config.ts` (127.0.0.1:8091), then run `bun scripts/qa/story-sharing/check.ts /Users/melanishrestha/.codex/skills/gstack/browse/dist/browse`.

Evidence: `/private/tmp/lenslabs-story-sharing-qa/` contains tests.log, build.log, checks.json and screenshots. Synthetic fixture data and API doubles were used; no real messages, clipboard contents, account credentials, public photos or user shoots were changed. The lab's cloud restrictions remain intact.

## Release limits

This repository is already connected to Lovable and has extensive pre-existing uncommitted work. No commit, push, database migration, new hosting project or public deployment was performed. `.env.development` was not read or modified. The existing application preview remains on port 8085; the QA fixture is not a customer site.

Before a production claim: deploy the reviewed changes through the existing LensLab hosting path; verify with one explicitly authorized public story and opted-in creator; check recipient signup/inquiry against real server services; forward the authorized link in the desired messaging apps and verify their unfurl; unpublish it and verify new cover requests stop. Native OS delivery and third-party cached previews have not been end-to-end tested. No real account or publication should be created automatically for this check.
