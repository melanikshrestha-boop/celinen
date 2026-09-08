# Profile improvements — September 7, 2026

## Delivered locally

- Replaced the workspace-name input with a searchable photography specialty picker: 54 named specialties and Other, up to five selections, with an 80-character custom specialty.
- Retained the existing workspace name in metadata. Specialty changes do not rename workspaces or alter shoots/conversations.
- Removed the renaming explanation and settings row divider lines. Kept input/focus boundaries.
- Raised raster source limits from 4 MiB / 20 MP to 50 MiB / 100 MP (30,000 px maximum per side). JPEG, PNG and WebP only; not RAW, HEIC or TIFF.
- Added dimension preflight before native browser decoding. Headers must be available in the first 2 MiB. Large full-resolution bitmaps are released after making a maximum-2048px working copy; browser peak decoder memory still depends on source dimensions and implementation.
- Crop starts at 512px for profiles, then adapts JPEG quality/resolution to the existing 40,000-character metadata limit. Companion crops remain 128px with their existing smaller output budget.
- Processing runs on the device. No original image, source filename or EXIF is stored in profile metadata. No new paid service or dependency was introduced.
- Specialty fields use the existing authenticated profile metadata path and device-local lab profile. Old callers omit new fields without erasing them. Profile information remains private; this does not publish marketplace listings.

## Research

The catalog uses [PPA's public specialty categories](https://www.findaphotographer.com/search), grouped and extended with common commercial subfields. It is a curated list, not a claim that every possible specialty has a standardized name. Other permits a photographer's own description. No photographer records were harvested.

## Verification

- `bun test tests/account-profile.test.ts tests/profile-specialties.test.ts tests/avatar-large-source.test.ts tests/avatar-image.regression-1.test.ts tests/settings-refinement.test.ts tests/settings-workspace.test.ts tests/account-settings.test.ts`: **72 passed**, 1,833 assertions.
- `bun scripts/qa/profile-specialties-check.ts /path/to/browse`: **35 passed** in a separate launched browser on the device-local lab, never the user's browser session.
- Real browser-generated fixtures: 24 MP JPEG, EXIF-rotated JPEG, WebP, and a **12,712,268-byte PNG** without an OS MIME label.
- PNG crop saved as **32,923 characters**, below the metadata budget. SHA-256 of the source was unchanged.
- Checked crop zoom, crop cancellation, invalid content, over-limit rejection/recovery, save/reload, removal/cancellation, five-selection limit, custom text, keyboard focus, and 390px/1280px layouts. The isolated QA profile was restored afterward.
- TypeScript, scoped ESLint, diff whitespace checks, and production build passed. Build reports existing dependency/deprecation warnings. The synthetic pixel-readback test can emit a browser performance hint; no browser runtime errors were recorded.

## Not claimed

Not deployed or pushed. No live authenticated cloud account was modified; cloud metadata handling has regression coverage but this run verified end-to-end persistence in the local lab. No subscription, public profile, marketplace or revenue outcome was created by this change.
