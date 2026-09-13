# Changelog

All notable LensLabs changes are documented here.

## [0.1.0.1] - 2026-09-12

### Added — local checkpoint, 2026-09-13

- Bound native decode/analysis staging and reserve decoder lanes before original-body upload. Reuse native previews and report stage timings and actual preview provenance.
- Persist source-bound mechanical analysis with photo transactions, retain it on reload, and avoid unchanged full-library save work. Preserve review, history and inert pre-reconnect evidence with strict source/revision guards.
- Review approximate Lightroom XMP global controls, HSL and explicit point curves in the existing preset exchange. Disclose unsupported Adobe settings and apply bounded source-lighting exposure adaptation without replacing crop or masks.

### Fixed — local checkpoint, 2026-09-13

- Open the dashboard photo/folder picker directly and keep jersey/people tools opt-in through the assistant.
- Preserve native analysis dimensions/provenance when culling saves larger display previews; handle stale import notifications and missing-original reconnection without false save conflicts.
- Add fail-first persistence, upload admission, cancellation, source binding and preset regressions. See the [checkpoint evidence and remaining requirements](docs/CULLING-PRESET-QA-2026-09-13.md). This is not a claim of trained sports inference, 400 photos/second, complete Adobe compatibility or hosted native deployment.

### Changed

- Stream native analysis through three grayscale rows instead of a full-image scratch buffer, preserving histogram and sharpness arithmetic and existing scoring rules. No interface or delivery behavior changes.
- Add exact-parity and scratch-allocation regression tests plus a repeatable synthetic analysis benchmark. See [analysis performance](native/ANALYSIS-PERFORMANCE.md) for measurements and limits.

## [0.1.0.0] - 2026-09-07

### Added

- Work from a compact photographer-first desktop workspace with project-scoped chats, pinnable conversation controls, sections, sharing, archiving, deletion, and keyboard shortcuts.
- Configure appearance, language, notifications, voice, imports, profile specialties, large-source avatar cropping, invitations, and other account preferences from the rebuilt settings workspace.
- Cull, reconnect, recover, and hand off exact photo versions while preserving original-file identity, decisions, comments, and interrupted local work.
- Export collision-safe sidecars and connect exact-path Lightroom workflows without rewriting original photo files.
- Prepare C++-rendered social frames and publish approved work to Instagram Stories, Facebook Page Stories, public portfolios, and client-facing story links.
- Manage photographer clients, earnings, bookkeeping exports, delivery feedback, a public creator network, and an interactive pre-sign-in savings estimate.
- Protect the new Facebook credential store with service-role-only access, row-level security, owner isolation, bounded encrypted payloads, and migration regressions.

### Changed

- Unified the interface on a compact sans-serif typography system and removed persistent sidebar actions that competed with each project or conversation.
- Reframed shoots as projects and chats as shoots where that language matches a photographer's workflow.
- Reduced inline profile-avatar metadata to a token-safe thumbnail budget while still accepting source images up to 50 MB and resizing them locally.

### Fixed

- Prevented same-metadata photos, long paths, stale proposals, delayed hashing, interrupted saves, and account or project switches from silently overwriting or misbinding work.
- Prevented uncertain social-provider responses and failed receipt saves from duplicating public posts on retry.
- Kept private connector details, unsent drafts, access secrets, original paths, and unpublished media out of shared conversations and public previews.
