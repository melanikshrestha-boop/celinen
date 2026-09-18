# Instagram publishing and account management

Photographers can post keepers from **Cull** and selections from **Develop** to Instagram as a single photo or a 2–10 photo carousel, and manage their own posts from **Social accounts** (`/publish`): media list, insights, and comments (reply, hide, delete).

**Status:** built and tested against recorded Graph API response shapes and in an isolated browser harness. **Not live-verified.** No Meta app credentials or Business/Creator test account were available, so no real OAuth login, container, publish, comment action or insights call has been made.

## What the API can and cannot do

Meta's _Instagram API with Instagram Login_ (checked 2026-09-17):

- Works only for **professional accounts** (Business or Creator). **Personal Instagram accounts are not supported by any Meta API.**
- There is **no API for the home feed** or for reading other people's timelines. Celinen does not scrape or automate the Instagram app or website, and must never do so.
- Feed images must be **JPEG**, at most **8 MB**, **320–1440 px** wide, aspect **4:5 to 1.91:1**. Captions: **2,200 characters**, **30 hashtags**, **20 @mentions**. Carousels: **2–10** items; a carousel counts as one post.
- Publishing quota: the guide says **100 API posts per rolling 24 hours**, while the `content_publishing_limit` reference still says 50. Celinen reads `config.quota_total` from the API instead of hard-coding either.
- Tokens: long-lived tokens last **60 days** and can be refreshed once they are **at least 24 hours old**.
- Insights: `impressions` is deprecated; the metrics used are `reach`, `likes`, `comments`, `saved` and `shares`. Carousel children have no insights. Numbers can lag by up to 48 hours.
- Comments: you cannot reply to a hidden comment; only top-level comments take replies; only the media owner can delete comments on their media.

## How it works

1. **Frame (browser, C++).** The composer renders each photo, using the Develop engine (C++ → wasm) for Develop selections or the camera JPEG for Cull keepers. It then frames it with `frame_social()` from `native/src/social.cpp`, compiled to `src/lib/social/wasm/celinen-social.wasm`, to **1080×1350 (4:5)** or **1080×1080 (1:1)**, and encodes a baseline JPEG with libjpeg. The photographer drags each preview to place the crop.
2. **Confirm.** Pressing **Post** shows the actual JPEGs that will be sent, the caption, and a button naming the account (**Post to @username**). Nothing is sent until that second click.
3. **Upload.** `createInstagramPost` saves the draft (keyed by a composer-chosen UUID) and returns owner-scoped signed **upload** tickets for `publishing-media-v1/<owner>/<post>/<n>.jpg`. The page uploads the exact bytes.
4. **Publish (Worker).** Each call to `advanceInstagramPost` runs one step, bounded to about 25 seconds, under a row lease:
   1. Re-download every upload and check its size, SHA-256 and JPEG header dimensions against what was confirmed.
   2. Check `content_publishing_limit`.
   3. Create the containers, with a **15-minute** signed URL per photo. A carousel gets child containers (`is_carousel_item`), then a `CAROUSEL` container.
   4. Poll `status_code` with backoff, and give up after **5 minutes** of processing.
   5. Save status `publishing`, then call `media_publish` **once**.
   6. Fetch the permalink and delete the uploaded media.
5. **Never twice.** If the `media_publish` answer is lost, the post becomes `uncertain`. It is then settled by reading the container's `status_code` (`PUBLISHED`, or `EXPIRED`/`ERROR`) and is never re-sent. Clear refusals are safe to retry and are marked `failed`: the publish limit (subcode 2207042), rate limits (codes 4/17/32/613), an expired token (190), and an expired container.
6. **Cleanup.** Uploaded media is deleted after publish or **Discard**. Drafts older than 24 hours (containers expire at 24 hours) are swept the next time the photographer creates a post.
7. **Management.** Every management call uses the token of the account connected to the signed-in owner. Before acting on a post or comment, Celinen checks two things: the post (media id) must be on that connected account, and the comment must belong to that post. Each view is gated on its scope. If a scope is missing, the view shows **Reconnect**.

Tokens are AES-256-GCM sealed, with the Celinen owner id as associated data, in `social_connections.credential`. They never reach the browser or any `VITE_*` variable. A token is refreshed when it is more than a day old and has used a quarter of its 60 days. Concurrent refreshes use compare-and-swap.

## Setup Melani must do

### 1. Database (Supabase `yzyvooeoyavqtmjvsptv`)

Apply `drizzle/migrations/0026_instagram_account_management.sql` **before deploying this code**. It is additive only:

- It adds `scopes`, `account_type` and `token_refreshed_at` to `social_connections`.
- It adds a partial index on `social_publications`.

`social_connections`, `social_oauth_states`, `social_publications` and the private `publishing-media-v1` bucket (JPEG only, 8 MiB) already exist in production. This was checked 2026-09-17; there were 0 Instagram connections.

Until 0024 is applied, reads still work, but **connecting Instagram fails** because the new columns are written.

### 2. Meta app (developers.facebook.com)

1. Create a **Business** app. Add the **Instagram** product, then open **API setup with Instagram business login**.
2. Under **Set up Instagram business login**:
   - **Redirect URL:** `https://lenslab.dev/publish` (exactly `PUBLISH_ORIGIN` + `/publish`).
   - **Deauthorize callback URL** and **Data deletion request URL:** these are required for review. Celinen has no endpoints for them yet. Build them before submitting for review; do not point them at placeholder pages.
3. Copy the **Instagram App ID** and **Instagram App Secret**. These are the Instagram-login values, not the Facebook app ID.
4. Permissions to request:
   - `instagram_business_basic`
   - `instagram_business_content_publish`
   - `instagram_business_manage_comments`
   - `instagram_business_manage_insights`

   Meta's pages disagree on whether the insights permission applies to Instagram Login. Confirm it is listed in the App Dashboard. If it is not, insights will show **Reconnect** and everything else still works.

5. **Standard Access** works right away for accounts that have a role on the app. Add your own Instagram Business/Creator account as an Instagram tester and accept the invite in Instagram.
6. **Advanced Access** is required before any photographer who is not an app role holder can connect. It needs **App Review** plus **Business Verification**:
   - a 1024×1024 icon;
   - a privacy policy URL;
   - step-by-step test instructions;
   - a screencast per permission;
   - test credentials;
   - at least one successful call per permission.

### 3. Cloudflare Worker `lenslab-web` (runtime secrets, never `VITE_*`)

| Secret                      | Value                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `INSTAGRAM_APP_ID`          | Instagram App ID from step 2                                                                                                   |
| `INSTAGRAM_APP_SECRET`      | Instagram App Secret from step 2                                                                                               |
| `SOCIAL_TOKEN_KEY`          | 64 hex characters: `openssl rand -hex 32`. Keep it stable: changing it makes every stored token unreadable (reconnect needed). |
| `PUBLISH_ORIGIN`            | `https://lenslab.dev`                                                                                                          |
| `SUPABASE_URL`              | already required                                                                                                               |
| `SUPABASE_SERVICE_ROLE_KEY` | already required                                                                                                               |
| `INSTAGRAM_API_VERSION`     | optional; defaults to `v25.0` (latest in Meta's Instagram examples; Graph `v26.0` exists)                                      |

```bash
wrangler secret put INSTAGRAM_APP_ID --name lenslab-web
wrangler secret put INSTAGRAM_APP_SECRET --name lenslab-web
wrangler secret put SOCIAL_TOKEN_KEY --name lenslab-web
wrangler secret put PUBLISH_ORIGIN --name lenslab-web
```

Nothing new is needed at build time.

### 4. First live test

Use your own test account:

1. Go to **Social accounts**, choose **Connect**, and check that `@username` appears.
2. In Cull, keep one JPEG, choose **Instagram** and post it. Check that the post appears on Instagram and the permalink opens.
3. Post a 3-photo carousel from Develop and check the order and crop.
4. Try a reply, hide/unhide, delete and insights on the new post.
5. Check that the Supabase bucket has no leftover objects under your owner id.

## Known limits

- Cull can only post keepers whose original JPEG, PNG or WebP was read in this browser tab. RAW keepers, and sessions reopened later, post from Develop.
- Feed photos only: no Reels, video, scheduling, alt text, user tags or location. Stories are a separate path — hearted sets broadcast from Develop; see `docs/STORIES-SETUP.md`. The older delivery Stories path is unchanged.
- Posting is request-driven. If the tab closes while Instagram is still processing, the post stays in **Social accounts** with **Check again**. There is no background job.
- Token refresh happens when the account is used. A connection left unused for 60 days expires and needs **Reconnect**.
- `/publish` also handles the Facebook callback (`?connector=facebook`). That handler lived in the unmounted `PublishDesk` and is still not mounted; see the audit notes in the implementation report.

## Tests

- `tests/instagram-publishing.test.ts`: connect, refresh, single and carousel publish, container error/timeout/processing, duplicate-retry and lost-confirmation idempotency, concurrent leases, rate and publish limits, storage cleanup, cross-owner authorization, comment actions, insights, scope gating.
- `tests/social-wasm.test.ts`: the committed C++ wasm frames 4:5 and 1:1 JPEGs deterministically and rejects bad input.
- `scripts/qa/instagram/`: isolated browser harness (port 8094) that renders the real composer, the account card and the wasm framing, with labelled fixture server functions. Run it with `bunx vite --config scripts/qa/instagram/vite.config.ts`.
