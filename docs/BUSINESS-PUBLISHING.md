# Clients and post-delivery publishing

Implemented locally, not deployed. Real Instagram login/publishing and live cloud persistence still need hosting configuration and account testing. No real content was posted during development.

## Product behavior

- `/clients`: compact client rows, stage editing, dated follow-ups, overdue filter, done/snooze actions, CSV export and calendar reminder export. Existing contacts, bookings and linked local drafts are preserved. Account records use the server; previous unassigned browser records remain separately accessible through **Previous device records**, never silently migrated to an account.
- Calendar reminders are an `.ics` download. The photographer must import it into their calendar to receive alerts while LensLabs is closed. It is not a live calendar subscription or a background email-reminder service.
- Delivery offers **Share finals to portfolio & Instagram** once finals are released. `/publish` is available in the workspace tool menu and via “open Instagram” in chat.
- Choose approved, released versions, at most ten per post, order them, draft/edit a caption, choose destinations and explicitly confirm public-use permission. The caption helper is currently deterministic and uses only supplied details, genre and tone. It does not send photos to an AI provider or identify people.
- Publishing uses separate JPEG copies and separate destination receipts. Portfolio success survives Instagram failure. Instagram's final publish request is never automatically repeated after an uncertain response; **Check outcome** reconciles container status without reposting.
- Your public portfolio lives at `/photographer/<account-id>`, with individual stories at `/p/<publication-id>`. Unpublish stops new page access; previously issued image URLs may work for two minutes. Downloaded copies and Instagram posts cannot be recalled by unpublishing the portfolio.
- This is a LensLabs-hosted portfolio story, not a Wix/Squarespace/WordPress connector, custom domain, feed scheduler, Reels publisher, or multi-network manager. Those are not implemented in this slice.

## Hosting activation

1. Apply `drizzle/migrations/0018_business_publishing.sql` after the existing delivery migrations, with a database backup and migration review. It adds four RLS-locked tables, a revision-checked client save function, and the private `publishing-media-v1` JPEG bucket. No historical records are updated or deleted.
2. Set server-only `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in the existing Lovable hosting environment. The service key must never be a `VITE_` variable or browser credential.
3. Configure a Meta app for **Instagram API with Instagram Login**, Business/Creator accounts. Set server-only `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `SOCIAL_TOKEN_KEY` (64 hex characters from a cryptographically random 32-byte key), and `PUBLISH_ORIGIN` (the exact HTTPS website origin). Keep the encryption key stable across redeploys; changing it requires reconnecting accounts.
4. Register exactly `<PUBLISH_ORIGIN>/publish` as the Instagram OAuth redirect. Request `instagram_business_basic` and `instagram_business_content_publish`. Set `INSTAGRAM_API_VERSION` to the version tested for the app; current code defaults to v23.0.
5. Use Meta's test roles first. Public customer access requires Meta's applicable app review/advanced access and policy requirements, including privacy/data deletion setup. No review has been submitted or approved here.
6. Deploy this code to the existing LensLabs host. Verify encrypted token storage, cancellation/expired OAuth states, permission denial, reconnecting to a different account, provider rate limits, a single-photo post and a carousel using a consenting test account. Revoke the app in Instagram's Apps and websites settings when removing the grant; LensLabs Disconnect removes its stored credential only.

### Important launch limits

- Production OAuth and public publishing have not been verified because app credentials are absent locally.
- Supported publishing media is JPEG, under 8 MB, with an Instagram crop from 4:5 through 1.91:1. Other crops remain eligible for the portfolio. No automatic cropping occurs.
- Instagram refresh-token renewal is not scheduled; expiry is shown and reconnect is required.
- Publishing is request-driven, not a background scheduler. Saved partial jobs can be continued from history. Orphaned unpublished copies/containers may consume storage after an interruption; add retention/cleanup and per-owner byte quotas before a broad public launch. Account post count is bounded, but it is not a billing quota system.

## Verification

- `bun test`: 764 passing after this slice (includes 17 business tests). Local HTTP bridge tests need permission to bind their isolated localhost listener.
- `node scripts/business-sql-check.mjs /absolute/pglite-runtime`: isolated PostgreSQL migration, revision conflict, no-delete guard, account separation, RLS permissions and private-bucket checks passed.
- `npx tsc --noEmit` and `npm run build` passed.
- Synthetic browser harness `output/business-qa` renders the actual publishing component, with fixture services instead of accounts or network writes. Desktop/mobile selection, caption drafting, permission gate, confirmation and both destination receipts verified. Client creation and overdue indicator verified. Harness is not a production route and never connects a real account.

## Research

- Aftershoot already offers cull/edit/retouch/gallery delivery: https://support.aftershoot.com/en/articles/15692478-from-aftershoot-to-galleries-full-workflow
- Current gallery features: https://aftershoot.com/galleries/
- Meta's own Instagram Login/API collection: https://www.postman.com/meta/instagram/folder/1z5vxzu/instagram-api-with-instagram-login
- Meta publishing reference: https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-ab559ffb-8e2c-4b0a-b43a-5737b6d2f672

The homepage comparison now uses conditional workflow criticism, not fabricated competitor pricing or an unsupported claim that Aftershoot has no delivery system.
