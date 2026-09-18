# Posting hearted photos to stories

Heart photos in **Develop** (the heart button, or `H`), filter to **Hearted**, press **Stories**, tick the destinations, confirm once. Celinen posts to Instagram and Facebook stories itself and hands the framed photos to Snapchat.

**Status:** built and tested against recorded Graph API response shapes. **Not live-verified.** No Meta app credentials, Instagram Business account or Facebook Page were available, so no real OAuth login, container, story publish or reconciliation has run against a live API. Everything below that a live call would prove is marked.

---

## What each platform actually allows

### Instagram stories — supported, Celinen posts them

Meta's Content Publishing API (checked 2026-09-18):

- Two steps: `POST /{ig-user-id}/media` with `media_type=STORIES` and `image_url`, then `POST /{ig-user-id}/media_publish` with `creation_id`.
- **Professional accounts only** (Business or Creator). Personal Instagram accounts have no API at all.
- JPEG, **8 MB** maximum, **9:16** recommended — anything else is cropped or padded by Instagram. Celinen frames every story to **1080×1920** so nothing is cropped by surprise.
- `alt_text` and `collaborators` are documented as unsupported for stories. `caption` and `location_id` are **not documented either way**; reports say they are silently ignored. Celinen sends neither rather than depending on that.
- Stories last **24 hours**. There is no API to delete one early, and its insights disappear with it.
- The publishing quota is documented as **100 per 24 hours** in the guide and **50** in the `content_publishing_limit` reference. **Whether stories count toward it is not documented anywhere.** The feed publisher reads the live `quota_total`; the story broadcaster does not pre-check, and relies on Meta's own refusal (subcode `2207042`), which it reports as a clean failure that is safe to retry later.

Permission: **`instagram_business_content_publish`** — the same one feed posting already asks for. **If Instagram feed posting works, story posting needs no new permission and no new review.**

### Facebook Page stories — supported, Celinen posts them

- Two steps: `POST /{page-id}/photos` with `url` and `published=false` to get a photo id, then `POST /{page-id}/photo_stories` with `photo_id`. The answer is `{ success: true, post_id }`.
- **Pages only.** There is no API for personal-profile stories, and there will not be one.
- Requires a **Page access token**, and the connected person must be able to `CREATE_CONTENT` on that Page.
- Photo: JPEG, **10 MB** maximum. No aspect-ratio requirement is documented for photo stories, but 9:16 is what they are displayed at. Facebook refuses URLs blocked by `robots.txt` and refuses Meta's own CDN.
- **A photo already used in a published post cannot become a story** (error `506`). Celinen uploads a separate unpublished photo for every story, so this cannot happen by reuse.
- Only one documented read-back: `GET /{page-id}/stories`. Celinen uses it to settle a lost confirmation. **Unverified against a live Page: whether its `media_id` is the unpublished photo id.** If it is not, a lost confirmation simply stays "Unconfirmed" and is never re-sent, which is the safe outcome either way.

Permissions: **`pages_show_list`**, **`pages_read_engagement`**, **`pages_manage_posts`** — exactly what the existing Facebook connection already requests. `publish_video` is **not** required for photo stories.

### Snapchat — no, and here is exactly why

**There is no compliant way for Celinen's server to post a story to a photographer's Snapchat account.** This is not a gap in the build; the API does not exist.

- **Creative Kit Web** shares a **link plus an optional 400×400 sticker**. It cannot set the photo behind the Snap at all — the Snap's media is whatever the user captures in the camera. Sending real pixels into the Snapchat editor needs the **native iOS/Android SDK**, which a web app does not have. Snap also restricts URL attachments to pre-approved use cases and explicitly prohibits "automatic link-outs from Snapchat to 3rd party applications."
- **Camera Kit** is an AR lens SDK. It does not publish anything, and its commercial terms are negotiated with Snap.
- **The Public Profile API** (`businessapi.snapchat.com`) does have real `POST .../stories` endpoints — but it is **allowlist-only** ("send your client ID to your Snap contact"), needs a Snap business relationship and an Ads Manager org, targets **brand/creator Public Profiles rather than personal accounts**, and its story constraints are documented for **video**. Not viable for a self-serve product.
- **Login Kit** grants display name, Bitmoji and an app-scoped external id. **There is no posting scope.**
- Snapchat's Terms forbid automated access and third-party apps interacting with the service without written consent; the Developer Terms forbid acting "through any automated... means". Driving a photographer's personal account would breach both and risk her account.

**What Celinen does instead:** frames the same 1080×1920 JPEGs and hands them to the phone's own share sheet via the Web Share API (`navigator.share` with files), which puts Snapchat directly in the sheet on a phone. Where that is unavailable — desktop, or a browser without file sharing — it saves the files. The result line says **"Save to post"**, never "Posted". Celinen does not scrape Snapchat, automate an account, or touch an unofficial endpoint, and must never start.

---

## What Melani has to do

### 1. Database (Supabase `yzyvooeoyavqtmjvsptv`)

Apply, in order, **before deploying this code**:

1. `drizzle/migrations/0026_instagram_account_management.sql` — if it has not been applied yet (it ships with the Instagram feed work).
2. `drizzle/migrations/0027_story_broadcasts.sql` — additive only: **one partial index**. No new table, no new column, no change to any existing row.

Story sets reuse `social_publications` and the private `publishing-media-v1` bucket that Instagram feed posts already use. Nothing else is needed.

### 2. Instagram — likely nothing new

Story publishing uses `instagram_business_content_publish`, which the Instagram connection already requests. See `docs/INSTAGRAM-PUBLISHING.md` for the app setup.

- The account must be **Business or Creator**.
- **Standard Access** (no review) covers accounts with a role on the app — so **posting stories to Melani's own Instagram works today**, once the app exists and she is an Instagram tester on it.
- **Advanced Access** — needed before any other photographer can connect — requires App Review of `instagram_business_content_publish` plus Business Verification. The review submission needs a screencast of the **whole** flow end to end (heart → Stories → confirm → posted), step-by-step instructions, and test credentials.

### 3. Facebook — a Page, and secrets that may not be set yet

The Facebook connection code already existed (`src/lib/business/facebook.server.ts`) but had no mounted UI: the desk that handled the `?connector=facebook` callback and the Page picker was orphaned, so Facebook could be started and never finished. **Social accounts** (`/publish`) now has a Facebook card that completes the callback and chooses the Page. Check whether the app was ever configured.

At **developers.facebook.com**, on the same Business app:

1. Add the **Facebook Login** product.
2. **Valid OAuth Redirect URI:** `https://lenslab.dev/publish?connector=facebook` (exactly `PUBLISH_ORIGIN` + `/publish?connector=facebook`).
3. Permissions to request: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`.
4. The Page must be one Melani can create content on. Personal profiles cannot be used.

**Advanced Access** for the three `pages_*` permissions needs App Review and Business Verification before another photographer's Page can be connected. **Development Mode with her own app-admin account and her own Page needs no review** — but Meta's permission reference pages were returning HTTP 500 during this research, so **the exact per-permission review criteria are unverified**. Re-check them before submitting.

### 4. Cloudflare Worker `lenslab-web` — runtime secrets, never `VITE_*`

Already required by the Instagram work:

| Secret                                       | Value                                                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`  | from the Instagram business login setup                                                                     |
| `SOCIAL_TOKEN_KEY`                           | 64 hex characters: `openssl rand -hex 32`. Keep it stable — changing it makes every stored token unreadable |
| `PUBLISH_ORIGIN`                             | `https://lenslab.dev`                                                                                       |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | already required                                                                                            |

New for Facebook stories:

| Secret                 | Value                                                    |
| ---------------------- | -------------------------------------------------------- |
| `FACEBOOK_APP_ID`      | the Facebook app id (not the Instagram one)              |
| `FACEBOOK_APP_SECRET`  | the Facebook app secret                                  |
| `FACEBOOK_API_VERSION` | optional; defaults to `v23.0` (Graph `v26.0` is current) |

```bash
wrangler secret put FACEBOOK_APP_ID --name lenslab-web
wrangler secret put FACEBOOK_APP_SECRET --name lenslab-web
```

Facebook reuses `SOCIAL_TOKEN_KEY` and `PUBLISH_ORIGIN`. **Nothing new is needed at build time, and no story secret may ever be a `VITE_*` variable** — Page tokens are sealed with AES-256-GCM in `facebook_social_connections` and never reach the browser.

### 5. Snapchat — nothing to set up, and nothing to apply for

No app, no key, no review. If Melani ever wants real Snapchat publishing, the only compliant route is a Snap partnership for the Public Profile API, which means a Snap business contact and a Public Profile rather than a personal account.

---

## What works today with only her own accounts

|                                                       | Works now                                                          | Needs App Review                        |
| ----------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------- |
| Heart photos, Hearted filter, framing to 9:16         | Yes — no accounts needed at all                                    | —                                       |
| Instagram stories to her own Business/Creator account | Yes, once the Meta app exists and she is an Instagram tester on it | Only to let other photographers connect |
| Facebook stories to her own Page                      | Yes, in Development Mode as an app admin                           | Only to let other photographers connect |
| Snapchat hand-off                                     | Yes, on a phone via the share sheet; a download elsewhere          | Never applicable                        |

## First live test

1. In Develop, heart three photos and switch the filter to **Hearted**.
2. Press **Stories**, tick **Instagram** and **Facebook**, and check the account and Page names shown.
3. Drag one preview to place its 9:16 crop, press **Post**, check the confirmation images are the ones you want, press **Post** again.
4. Check both apps: three story frames on each, in order, cropped as placed.
5. Press **Post** again on the same set and confirm **nothing new appears** in either app.
6. On a phone, tick **Snapchat**, post, then **Save for Snapchat** and confirm the share sheet offers Snapchat.
7. Check the Supabase bucket has no leftover objects under your owner id.

## What is unverified until that test

- Whether Instagram stories count against the publishing quota.
- Whether `GET /{page-id}/stories` returns the unpublished photo id as `media_id`, which is what settles a lost Facebook confirmation. If it does not, such a story reads "Unconfirmed" forever and is never re-sent.
- The real `image_url` fetch timeout on Meta's side. Signed URLs live 15 minutes, which is far longer than the documented behaviour suggests is needed, but no number is published.
- Whether Facebook rejects Supabase's signed URLs for any reason (it rejects `robots.txt`-blocked hosts and its own CDN).
- Facebook Page story expiry. The Page Stories doc does not mention 24 hours or any per-day cap.

## Tests

- `tests/story-broadcast.test.ts` — the request shapes both platforms receive, partial failure across destinations, retry sending only what never left, double-post protection, the per-destination state machine, lost-confirmation reconciliation, reconnect, rate limits, container timeout, expiry and discard.
- `tests/develop-hearts.test.ts` — hearts surviving a reload, a document stored before hearts existed, and the Hearted filter.
- `tests/social-wasm.test.ts` — the committed C++ wasm framing 9:16 deterministically.
