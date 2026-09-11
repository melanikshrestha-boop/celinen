# Social framing and connectors

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

## Direct publishing status and setup

The authenticated Publishing desk now includes Instagram feed, Instagram Story, and Facebook Page Story destinations alongside portfolio publication. It records independent destination results and never automatically retries an uncertain external write. Instagram uncertainty is reconciled from a saved container; Facebook uncertainty requires checking the actual Page before any new publication.

**This is not connected or deployed by this change.** The current local lab intentionally does not call cloud publishing. The existing Cloudflare deployment cannot execute the macOS native binary, so native-dependent framing and Stories remain disabled there. Running this flow live requires an approved C++-capable service/host and a compatible decoder adapter for non-macOS hosts. Do not route production users' photos to a developer's loopback server.

An authorized administrator must complete these steps before a live test:

1. Apply `drizzle/migrations/0021_facebook_social_connections.sql` to the existing database. It stores owner-bound, encrypted Page credentials with RLS and service-role-only access. This migration has **not** been applied by this change.
2. Configure `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `SOCIAL_TOKEN_KEY` (64 hex characters), and `PUBLISH_ORIGIN` (the exact HTTPS website origin). Optional `FACEBOOK_API_VERSION` defaults to `v23.0`; verify the app's supported version before enabling production traffic. Keep secrets on the server, never in client Vite variables.
3. Register the exact callback `https://YOUR-ORIGIN/publish?connector=facebook`. Grant approved `pages_show_list`, `pages_read_engagement`, and `pages_manage_posts` permissions. Complete Meta's review/access requirements for the accounts being supported.
4. Sign in as the real LensLabs owner, connect Facebook, and explicitly select an authorized Page. Personal Facebook-profile Stories are not supported by this API path. The current connector conservatively uses the returned credential expiry and requires reconnecting when it expires; automatic token renewal is not implemented.
5. Configure the existing Instagram connection separately. Instagram feed supports professional accounts; the current Stories flow requires a Business account and content-publishing access. Prepared images must be temporarily fetchable by Meta during publication.
6. On the compatible host, review the exact approved photo, selected destinations, and Facebook Page, then approve a controlled live post. Verify each destination on its real platform. No such live post has been made in this implementation task.

Retries preserve the pinned original Instagram account/Facebook Page and publication ID. Disconnecting a LensLabs credential does not revoke the external Meta grant; revoke that in the provider's settings if required.

## Verification

- C++ release and Address/UndefinedBehavior sanitizer tests passed, including 27,615 social framing assertions over synthetic fixtures. These are repeated regression checks, not 27,615 unique photographs or a throughput benchmark.
- Browser-tested local preparation with a public-domain basketball fixture at 1280×720 and 390×844. The downloaded ZIP was decoded: 1080×1350 feed JPEG, two 1080×1920 Story JPEGs, and the exact sample caption. Both layouts fit without horizontal overflow; all sliders have accessible labels; unsupported file sharing explains the download alternative.
- The final social/transport/publishing run passed **48 tests, 348 assertions**. TypeScript and the production build passed. Scoped lint had no errors and two existing PublishDesk hook warnings; this is not a claim of warning-free repository-wide lint.
- Unit tests cover output dimensions, invalid bounds, cancellation, source preservation, provider-independent outcomes, failed persistence, and lost publishing confirmations without duplicate reposts.
- OAuth and provider publication tests use controlled responses. Real Meta login, app-review eligibility, and live publication remain unverified.

## Primary API references

- [Meta Instagram API collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-ab559ffb-8e2c-4b0a-b43a-5737b6d2f672): content-publishing permissions, professional-account restrictions, JPEG inputs, Story containers, and publishing lifecycle.
- [Meta Business SDK Page API](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/page.py): unpublished photo staging and Page `photo_stories` publication with `photo_id`. The implementation uses these endpoints through its existing server HTTP bridge; it does not import this Python SDK.
