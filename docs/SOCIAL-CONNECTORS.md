# Social connectors and the publishing calendar

Celinen posts to Instagram, Facebook Pages, Threads, LinkedIn, X, TikTok and YouTube from the server, now or at a scheduled time, through each platform's official API and nothing else. Bluesky, Mastodon and Discord keep the older pasted-credential path. Pinterest, Google Business and WooCommerce still open the network's own compose sheet.

**Status:** built and tested against recorded API response shapes (`tests/social-connectors.test.ts`, `tests/social-scheduler.test.ts`, 46 tests). **Not live-verified.** No developer-portal app, real OAuth login, upload or post has been made on any of the seven platforms. Everything a live call would prove is listed at the end.

---

## What is where

| Piece                     | File                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| Limits, validation, types | `src/lib/social/connectors.ts` (pure; the page uses it too)                                     |
| Connections and OAuth     | `src/lib/business/social-connections.server.ts` (+ `instagram.server.ts`, `facebook.server.ts`) |
| Media buckets and checks  | `src/lib/business/social-media.server.ts`                                                       |
| One publisher per network | `src/lib/business/social-publishers/*.server.ts`                                                |
| The calendar and runner   | `src/lib/business/schedule.server.ts` (`createSchedule`, `tickDuePosts`, …)                     |
| Server functions          | `src/lib/business/schedule.functions.ts`, `social-connectors.functions.ts`                      |
| Cron trigger              | `vite.config.ts` → generated `wrangler.json`; hook `src/server/social-schedule-nitro.ts`        |
| Manual tick               | `POST /api/schedule/tick` with header `x-schedule-key`                                          |
| Media proxy for TikTok    | `GET /api/social-media/<ticket>`                                                                |
| Migration                 | `drizzle/migrations/0028_social_connectors_and_calendar.sql`                                    |

### How a post travels

1. **Schedule.** The page calls `createScheduledPost` with a caption, the networks, a time and, for photos/videos, the declared facts (bytes, SHA-256, size, duration). One `social_publications` row (kind `schedule`) holds one **unit** per network. The page uploads the files through the returned owner-scoped signed tickets and calls `readyScheduledPost`; until then the row is not runnable.
2. **Tick.** Every minute Cloudflare fires the Worker's `scheduled` handler; `tickDuePosts` claims each due row under a **lease** (a conditional `UPDATE … WHERE lease IS NULL OR lease_until < now()`), so a second tick, or "post now" from the page, shares the work instead of doubling it.
3. **Verify.** Every file is re-read and checked against what was declared (JPEG/PNG headers, MP4 `moov` probe, streaming SHA-256 by byte range). A mismatch fails the unit before any provider sees a byte.
4. **Publish.** The unit's publisher does the platform's steps, saving every id it gets (container ids, upload ids, session URIs) into `progress`, and writes `progress.committedAt` right before the **one** call that makes a post visible.
5. **Settle.** `posted` with the remote id and link; `failed` with a plain reason; `scheduled` again with backoff (1 m, 5 m, 15 m, 1 h; 5 attempts) for rate limits, quotas and outages; or `uncertain` when the visible call got no answer. An uncertain unit is **never re-sent**: the runner asks the provider (container status, upload session, recent posts) up to three times, then leaves it for a human.
6. **Clean up.** Media is deleted once every unit settled; posts whose media never arrived are cancelled after a day; a week-old settled row loses its media regardless.

Status machine per unit: `scheduled → publishing → posted | failed | uncertain | cancelled`. The record's status is derived from its units (`posting` while any unit is in flight).

---

## What Melani has to do

### 1. Database (Supabase `yzyvooeoyavqtmjvsptv`)

Apply `drizzle/migrations/0028_social_connectors_and_calendar.sql` **before deploying**. Production has 0027; 0028 is additive:

- new table `social_provider_connections` (Threads, LinkedIn, X, TikTok, YouTube; RLS on, service role only, sealed credentials);
- two nullable columns on `social_oauth_states` (`provider`, `verifier` for PKCE);
- one partial index on `social_publications` for the due-work read;
- private bucket `publishing-video-v1` (MP4/MOV, 1 GiB). Photos keep using `publishing-media-v1`.

Instagram and Facebook rows are untouched.

### 2. Worker `lenslab-web` runtime secrets (never `VITE_*`)

Shared by every network, already required by Instagram:

| Secret                                      | Value                                                                                        |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `SOCIAL_TOKEN_KEY`                          | 64 hex characters (`openssl rand -hex 32`). Changing it makes every stored token unreadable. |
| `PUBLISH_ORIGIN`                            | `https://lenslab.dev`                                                                        |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | already set                                                                                  |

Per network (the Social accounts page names whichever of these is missing):

| Network       | Secrets                                                    | Optional                                                          |
| ------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| Instagram     | `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`                 | `INSTAGRAM_API_VERSION` (default `v25.0`)                         |
| Facebook Page | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`                   | `FACEBOOK_API_VERSION` (default `v23.0`), `FACEBOOK_EXTRA_SCOPES` |
| Threads       | `THREADS_APP_ID`, `THREADS_APP_SECRET`                     |                                                                   |
| LinkedIn      | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`             | `LINKEDIN_ORGANIZATION_SCOPES=true`                               |
| X             | `X_CLIENT_ID`, `X_CLIENT_SECRET`                           |                                                                   |
| TikTok        | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`                | `TIKTOK_AUDITED=true` (only after TikTok's audit)                 |
| YouTube       | `GOOGLE_YOUTUBE_CLIENT_ID`, `GOOGLE_YOUTUBE_CLIENT_SECRET` | `YOUTUBE_DAILY_QUOTA` (default 10000)                             |
| Manual tick   | `SCHEDULE_TICK_KEY` (falls back to `SOCIAL_TOKEN_KEY`)     |                                                                   |

```bash
for s in THREADS_APP_ID THREADS_APP_SECRET LINKEDIN_CLIENT_ID LINKEDIN_CLIENT_SECRET \
         X_CLIENT_ID X_CLIENT_SECRET TIKTOK_CLIENT_KEY TIKTOK_CLIENT_SECRET \
         GOOGLE_YOUTUBE_CLIENT_ID GOOGLE_YOUTUBE_CLIENT_SECRET; do
  wrangler secret put $s --name lenslab-web
done
```

### 3. The cron trigger

`vite.config.ts` declares `triggers: { crons: ["* * * * *"] }` under Nitro's `cloudflare.wrangler`. Nitro merges that into `.output/server/wrangler.json`, which is what Workers Builds deploys (`bunx wrangler deploy --config .output/server/wrangler.json --name lenslab-web --keep-vars`). `scripts/verify-workers-build.ts` refuses a build without it. **Nothing to configure by hand**; after the next deploy, Worker → Settings → Triggers should show the cron. If it does not, the Workers Builds deploy command is not using the generated config — check it.

The manual path, for tests or a stuck queue:

```bash
curl -X POST https://lenslab.dev/api/schedule/tick -H "x-schedule-key: $SCHEDULE_TICK_KEY"
```

The page can also call `runDueScheduledPosts` (own posts only) and `runScheduledPost` for one post.

### 4. Redirect URLs, exactly

Every developer portal must list the callback below, and `PUBLISH_ORIGIN` must be `https://lenslab.dev`.

| Network       | Redirect URL                                     |
| ------------- | ------------------------------------------------ |
| Instagram     | `https://lenslab.dev/publish`                    |
| Facebook Page | `https://lenslab.dev/publish?connector=facebook` |
| Threads       | `https://lenslab.dev/publish?connector=threads`  |
| LinkedIn      | `https://lenslab.dev/publish?connector=linkedin` |
| X             | `https://lenslab.dev/publish?connector=x`        |
| TikTok        | `https://lenslab.dev/publish?connector=tiktok`   |
| YouTube       | `https://lenslab.dev/publish?connector=youtube`  |

---

## Per platform

Every limit below is enforced in `validateUnit` before a provider is called. Doc URLs are beside the code that uses them.

### Instagram (existing; Reels added)

- **Portal / app:** Meta for Developers, Business app, product **Instagram** → "API setup with Instagram business login". See `docs/INSTAGRAM-PUBLISHING.md` for the full setup.
- **Scopes:** `instagram_business_basic`, `instagram_business_content_publish` (+ comments/insights).
- **Works today with only her account:** yes, in Standard Access, once she is an Instagram tester on the app. Business/Creator accounts only.
- **Review:** Advanced Access + Business Verification before any other photographer can connect.
- **Now supported:** feed photo, carousel (2–10), story (9:16), **Reels** (`media_type=REELS`, MP4/MOV, 3 s – 15 min, ≤ 1 GB, `share_to_feed`).
- **Limits:** caption 2200 chars; 100 API posts / 24 h (read live from `content_publishing_limit`).
- **Reconcile:** container `status_code` (`PUBLISHED` / `EXPIRED` / `ERROR`).

### Facebook Page (existing; posts added)

- **Portal / app:** same Meta app, product **Facebook Login**.
- **Scopes:** `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`. Page **video** additionally needs `publish_video`: add it to the app, then set `FACEBOOK_EXTRA_SCOPES=publish_video` and reconnect. The shipped dialog is unchanged until that variable is set.
- **Works today:** yes, in Development Mode with her admin account and her own Page. Personal profiles have no posting API.
- **Review:** App Review + Business Verification for the `pages_*` permissions before another photographer's Page.
- **Now supported:** text (`/feed`), one photo (`/photos`), several photos (unpublished photos + `attached_media`), video by URL (`graph-video.facebook.com/{page}/videos`, ≤ 1 GB), story (existing).
- **Reconcile:** `/{page}/feed`, `/{page}/videos`, `/{page}/stories` matched by text and creation time.

### Threads

- **Portal / app:** Meta for Developers → add the **Threads API** product (a "Threads" use case app). App ID/secret are the Threads ones, not the Facebook ones. https://developers.facebook.com/docs/threads/get-started
- **Scopes:** `threads_basic`, `threads_content_publish`.
- **Tokens:** short-lived → long-lived (60 days) via `th_exchange_token`; renewed with `th_refresh_token` once a day old. No PKCE.
- **Works today with only her account:** yes — Standard Access covers accounts with a role on the app (add her Threads account as a tester and accept in Threads).
- **Review:** App Review for `threads_content_publish` before other photographers can connect.
- **Supported:** text, one image (JPEG/PNG, ≤ 8 MB, 320–1440 px wide, ≤ 10:1), one video (MP4/MOV, ≤ 1 GB, ≤ 5 min), carousel (2–20 items).
- **Limits:** text 500 chars; 250 posts / 24 h (read live from `threads_publishing_limit`).
- **Reconcile:** container `status` (`PUBLISHED` / `EXPIRED` / `ERROR`), then the user's recent threads for the permalink.

### LinkedIn

- **Portal / app:** https://www.linkedin.com/developers/ → create an app tied to a Company Page (a Page is required to create an app; she can make one for Celinen). Add products **Sign In with LinkedIn using OpenID Connect** (self-serve) and **Share on LinkedIn** (self-serve) → `openid profile w_member_social`.
- **Organization posting** (`w_organization_social` + `r_organization_admin`) needs the **Community Management API** product, which is application-only (LinkedIn reviews the business case; historically weeks). Off by default; set `LINKEDIN_ORGANIZATION_SCOPES=true` only once approved, then reconnect. Until then posts go out as the member.
- **Tokens:** 60-day access token, **no refresh token** for standard apps (programmatic refresh is a Marketing Developer Platform feature). The page shows **Reconnect** at expiry. No PKCE.
- **Works today with only her account:** yes — member posting through self-serve products needs no review.
- **Supported:** text, one image, several images (`multiImage`), one video (Videos API: initializeUpload → PUT parts with ETags → finalizeUpload → wait for `AVAILABLE`). Posts API with `LinkedIn-Version: 202509`.
- **Limits:** commentary 3000 chars; image ≤ 8 MB (LinkedIn allows more; Celinen stays low); video 75 KB – 500 MB, 3 s – 30 min, aspect 1:2.4 – 2.4:1; **150 posts / day per member**, 100,000 / day per app.
- **Reconcile:** `GET /rest/posts?q=author` matched by commentary and `createdAt` — this read needs `r_member_social`, which most apps do not have; without it a lost answer stays **Unconfirmed**.

### X

- **Portal / app:** https://developer.x.com/ → Project → App → **User authentication settings**: OAuth 2.0, type "Web App", callback above, website `https://lenslab.dev`. Copy the OAuth 2.0 **Client ID** and **Client Secret** (not the API key pair).
- **Scopes:** `tweet.read tweet.write users.read offline.access media.write`. PKCE S256; the token request is authenticated as a confidential client (Basic auth).
- **Tokens:** 2-hour access token, single-use refresh token (`offline.access`). Refresh runs under a lease so two runners cannot invalidate each other.
- **Works today with only her account:** yes on the **Free** tier — but Free allows **17 posts / 24 h per user** (and per app), and Free apps are limited to one app and one environment. **Basic** ($200/mo as of 2025) allows 100 / 24 h per user, 1667 / app. Celinen does not hard-code the tier: it reads `x-user-limit-24hour-*` and `x-app-limit-24hour-*` headers, stores them on the connection, and turns a 429 with `remaining: 0` into a quota failure that waits for the reset.
- **Review:** none for posting; the app just has to exist.
- **Supported:** text (280 weighted chars; every URL counts 23), up to 4 images (JPEG/PNG/WEBP ≤ 5 MB), or one video (MP4 H.264/AAC ≤ 512 MB, 0.5 – 140 s, 1:3 – 3:1) through `POST /2/media/upload/initialize` → `/append` (≤ 5 MB per chunk) → `/finalize` → `STATUS` polling.
- **Reconcile:** `GET /2/users/:id/tweets?max_results=5` matched by text and `created_at` (t.co rewrites are tolerated by matching the text before the first URL).

### TikTok

- **Portal / app:** https://developers.tiktok.com/ → app → add **Login Kit** and **Content Posting API** → scopes `user.info.basic`, `video.publish`, `video.upload`. Redirect URL as above. PKCE S256.
- **Unaudited apps — the honest part:** until TikTok audits the app, every Direct Post is forced **private** (`SELF_ONLY`) and the post note says so. `TIKTOK_AUDITED=true` lifts that only after the audit passes; setting it early makes TikTok refuse (`unaudited_client_can_only_post_to_private_accounts`). Unaudited apps are also capped in how many distinct users may post.
- **Photo posts** only pull from a URL on a **verified domain**. Celinen serves them at `https://lenslab.dev/api/social-media/<ticket>` (HMAC-signed, 15 minutes, one object). In the TikTok portal, verify the URL prefix **`https://lenslab.dev/api/social-media/`** under Content Posting API → URL properties; until then TikTok answers `url_ownership_unverified`.
- **Video** goes by `FILE_UPLOAD` in chunks (≤ 5 MB whole; otherwise 10 MB chunks with the remainder in the last one), then `status/fetch` until `PUBLISH_COMPLETE`.
- **Works today with only her account:** yes, privately (SELF_ONLY), with her account added as a test user. Public posting for anyone requires the audit.
- **Tokens:** 24-hour access token, 365-day refresh token.
- **Limits:** title 2200 chars (video), description 4000 (photo); video 3 s – the creator's `max_video_post_duration_sec` (usually 10 min), ≤ 1 GB in Celinen's bucket; photos ≤ 35, ≤ 20 MB each; `creator_info/query` is called before every post as TikTok requires; TikTok's own per-user daily cap shows up as `spam_risk_too_many_posts` and is treated as a quota (6-hour wait).
- **Reconcile:** `status/fetch` by `publish_id`. Post ids are 64-bit and are read from the raw response text, not `JSON.parse`, which would round them. No permalink: `user.info.basic` has no @handle.

### YouTube

- **Portal / app:** https://console.cloud.google.com/ → project → enable **YouTube Data API v3** → OAuth consent screen (External) → OAuth client, type **Web application**, redirect URI as above. Scopes `youtube.upload` + `youtube.readonly`. PKCE S256, `access_type=offline`, `prompt=consent`.
- **Works today with only her account:** yes — while the consent screen is in **Testing**, add her Google account as a test user. **Testing-mode refresh tokens expire after 7 days**, so she will reconnect weekly until the app is published/verified. `youtube.upload` is a sensitive scope: publishing the consent screen to Production requires Google's verification (privacy policy, homepage, video demo).
- **Unverified API projects:** videos uploaded through an API project that has not passed YouTube's **API compliance audit** are **locked as private** by YouTube. Public Shorts for other photographers need that audit (the "YouTube API Services – Audit and Quota Extension" form).
- **Quota:** `videos.insert` costs **1600 units**; the default project quota is **10,000 units / day** (Pacific time) → 6 uploads a day across all users. Celinen keeps the day's spend on the connection and refuses the seventh with "tried again tomorrow" before any bytes move; `YOUTUBE_DAILY_QUOTA` raises the ceiling after Google grants an extension.
- **Supported:** one video via the resumable protocol (`uploadType=resumable`, 8 MiB chunks, `308` resume, `Content-Range: bytes */N` to query). Title ≤ 100 chars (no `<`/`>`), description ≤ 5000 bytes, privacy `public|unlisted|private`. A vertical clip ≤ 3 min gets a `/shorts/` link; anything else `youtu.be`.
- **Reconcile:** the upload session itself answers `200 + video id` once complete, `308` while bytes are owed, `404/410` when it expired (safe to start again).

### Bluesky, Mastodon, Discord (unchanged)

Pasted app password / token / webhook, sealed in the record at scheduling time, sent once. No read-back exists, so a lost answer is **Unconfirmed** and never re-sent.

---

## Security

- Tokens are AES-256-GCM sealed with the owner id as associated data; nothing that reaches the page contains one (`viewSchedule` strips `sealedSecrets` and provider `progress`; `connectorStatus` returns names and states only).
- OAuth `state` is 32 random bytes, stored hashed, owner-bound, single-use, 10-minute expiry; the PKCE verifier is sealed at rest and only its S256 challenge leaves the server.
- Redirect URLs derive from `PUBLISH_ORIGIN`, never from the request.
- Every server function takes the owner from the verified session; every table has RLS on with no `anon`/`authenticated` grants.
- The media proxy serves one object per HMAC ticket, 15 minutes, `no-store`, `noindex`; the path pattern is pinned to `<owner>/social/<post>/<n>.<ext>`.
- Upstream error text is never stored or shown; every reason is Celinen's own words.

---

## Tests

- `tests/social-connectors.test.ts` — missing-secret reporting, PKCE/state/single-use/expiry, every provider's connect, refresh under a lease (two runners, one refresh), refusal → reconnect, outage keeps a valid token, LinkedIn expiry, platform limits, MP4 probe, video verification, proxy tickets.
- `tests/social-scheduler.test.ts` — tickets → ready, idempotent create, list/cancel/reschedule, each platform's request shapes, X tier quota and reset, YouTube quota, TikTok chunking and privacy, Reels, Facebook post kinds, multi-network units, lost answer → uncertain → reconciled, refusal after commit, crash resume from saved ids, concurrent runners, wrong-account guard, revoked token, backoff and attempt cap, tampered media, sweeps, and version-1 records.

## Unverified until a live test

- Every OAuth dialog, token response and profile call on all seven platforms — the fixtures follow the documentation, not a recording of a live answer.
- Whether Supabase signed URLs are accepted by Meta (Instagram, Threads, Facebook) as `image_url`/`video_url`/`file_url` for videos up to 1 GB within their fetch timeouts.
- LinkedIn `Videos API` part sizes and the `LinkedIn-Version` month accepted at the time of testing (versions are sunset after about a year; bump `LINKEDIN_VERSION` in `social-connections.server.ts`).
- X v2 media upload endpoint shapes (`/2/media/upload/initialize|append|finalize`) against a Free-tier app, and the exact quota header names on a 429.
- TikTok URL-prefix verification for `https://lenslab.dev/api/social-media/`, and whether `PULL_FROM_URL` follows the proxy's `Range` handling.
- YouTube's behaviour for an unaudited project (private lock) and the Testing-mode 7-day refresh expiry.
- The Cloudflare cron actually appearing on the Worker after a Workers Builds deploy (the generated config carries it; the dashboard will confirm).

---

## Local framing (unchanged)

## Available in local Studio

Select a photo, open **Shoot actions → Share to social**, adjust the frame, and choose **Prepare formats**. One action prepares:

| Destination     | JPEG dimensions                    |
| --------------- | ---------------------------------- |
| Instagram post  | 1080 × 1350, or square 1080 × 1080 |
| Instagram Story | 1080 × 1920                        |
| Facebook Story  | 1080 × 1920                        |

Fit preserves the whole photograph with black or white padding. Fill supports horizontal/vertical positioning and zoom. Story guides are preview-only, never burned into exports. Instagram and Facebook Stories reuse the same prepared 9:16 image.

**Download all** provides a ZIP of the destination JPEGs and `caption.txt`. **Share this format** uses the device's supported file-sharing sheet, or explains the download alternative. A share-sheet handoff is not evidence that a post was published. Captions are not burned into the image, and each destination app decides whether to accept share-sheet text.

This workflow handles **one selected photo**, not video, Reels, scheduled publishing, or bulk multi-photo Stories. Originals are never overwritten. RAW inputs still use their available preview through the existing Studio renderer; this is not full RAW development.

## What is C++

`native/build/lenslabs-social` performs final framing, resizing, bilinear resampling, alpha compositing, and JPEG encoding. It writes JPEG bytes to stdout and has no output-path overwrite operation.

The web interface still applies existing Studio edit math to a temporary copy before sending it to C++. Authentication, OAuth, publication records, and provider HTTP requests still use the existing TypeScript server bridge. **The entire backend has not been migrated to C++.** No end-to-end speed comparison is established merely by choosing C++.

The local transport requires exact loopback Host/Origin validation, the Studio request marker, and a session token. Inputs are bounded to 16 MiB, outputs to 8 MiB, controls are validated, and one social job runs at a time with a 30-second deadline. Temporary files are private and removed after success, failure, or cancellation.
