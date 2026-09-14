# Isolated PostHog handoff — September 13, 2026

Parent: clean `origin/main` **91f059f1aadff1988d6aa6ba8027ce2df0ed6e09**.
Scope: consented photography analytics only. The owner explicitly approved pushing
this scope with subscription producers unwired. No live deployment is authorized
by this commit. See [integration details](POSTHOG-INTEGRATION.md) for event semantics,
privacy, required build configuration and real-ingestion verification.

## Regression gates

| Check | Clean main | Analytics change | Introduced? |
| --- | --- | --- | --- |
| Compact sidebar marker/row/focus appearance assertion | Fail | Fail | No |
| Official X/Snapchat connector-mark assertion | Fail | Fail | No |
| Develop import report/empty-stage light chrome assertion | Fail | Fail | No |
| Default Dark/System appearance assertion | Fail | Fail | No |
| Shared typography assertion | Fail | Fail | No |
| Export busy/queue regression cases | Pass | Pass | No failure in these runs |
| Full Bun suite | 2343 pass, 5 fail, 21 skip, 1 todo | **2401 pass, same 5 fail, 21 skip, 1 todo** | **Zero new failures; 58 additional passing tests** |
| Full Vite production build | Previously qualified parent | **Pass** | No |
| TypeScript diagnostics (normalized without line offsets) | 152 | Identical 152 | Zero added/removed |
| Native `make -C native test` | Pass after native build | Pass | No |
| V1 identical-input decision binaries | `reject` | `reject` | No |
| V2 isolation tests | Pass | 4 pass | No native/contract/build diff |
| Separate consented-milestone persistence checks | Not present | 8 pass | New coverage |

The first fresh baseline attempt lacked native binaries (three operator failures,
56 extra skipped native cases). It was **not** used as the comparison. Built clean
main's native executables from its unchanged source with the same pinned LibRaw
dependency, then reran the complete suite. No tests were removed/hidden and none of
the five known failures were altered. Two existing extracted-action harnesses now
inject the real analytics dependency; their original navigation/HMR assertions
remain, with additional success/failure/consent coverage.

Native passing checks: 472 core; 97 decoder; 180 pipeline; 337 worker; 3499 burst;
37 people; 27615 social; 442188 Develop; 29 reference; 45 crop; 2211 receipt;
12 gallery; 6 settings; 6 calendar. No Mac/Linux decoder changes were made, so this
task does not claim a new cross-platform decoder qualification or staging release.

Synthetic 10,000-item batch acceptance proves aggregation/count preservation,
**not** photo-decoding performance. No user photos or real analytics events used.

Local evidence:
- `/tmp/celinen-posthog-baseline-tests.log`
- `/tmp/celinen-posthog-final-tests.log`
- `/tmp/celinen-posthog-final-build.log`
- `/tmp/celinen-posthog-baseline-types.log`
- `/tmp/celinen-posthog-final-types.log`
- `/tmp/celinen-posthog-native-tests.log`
- Persistence runner: `scripts/check-product-milestones.ts` with separately pinned
  `fake-indexeddb@6.2.5`; isolated in-memory databases, no real browser storage.

## Exact included files

1. `src/lib/product-analytics.ts` — allowlisted event transport, privacy, queue.
2. `src/lib/product-lifecycle.ts` — account/session fences, operation timing, review aggregation and consented milestones.
3. `src/components/account/ProductAnalytics.tsx` — verified-account/consent effect.
4. `src/components/account/AccountProvider.tsx` — synchronous identity fence.
5. `src/components/account/AuthScreen.tsx` — explicit password-signup marker.
6. `src/components/marketing/CookieConsent.tsx` — revoke/cross-tab notifications.
7. `src/routes/__root.tsx` — invisible analytics effect mount.
8. `src/routes/studio.tsx` — cull, first rendered keeper, review, original-ZIP events.
9. `src/lib/develop/import-session.ts` — import/durable settlement/decode failure events.
10. `src/lib/studio/shoot-directory.ts` — post-commit creation notification.
11. `src/components/develop/DevelopPage.tsx` — confirmed image-export events.
12. `src/components/studio/BurstReview.tsx` — rendered group event.
13. `tests/product-analytics.test.ts` — transport/privacy/consent.
14. `tests/product-lifecycle.test.ts` — account epochs/timing/review/batch/signup.
15. `tests/product-analytics-component.test.ts` — actual account/consent effect.
16. `tests/product-studio-lifecycle.test.ts` — actual Studio callbacks + unchanged V1 outcomes.
17. `tests/develop-import-session.test.ts` — actual import producer/failure/consent/HMR checks.
18. `tests/develop-dialog-navigation.test.ts` — actual export producer/navigation/failure checks.
19. `scripts/check-product-milestones.ts` — isolated IndexedDB producer/abort/concurrency checks.
20. `docs/POSTHOG-INTEGRATION.md` — exact wiring, limitations and operator steps.
21. `docs/POSTHOG-HANDOFF.md` — this qualification record.

## Intentionally excluded / unchanged

- All `.env*` files, project tokens, personal keys, build outputs and QA dependencies.
- All native V1/V2 code, frozen references, decoder dependencies/profiles, weights,
  thresholds, receipts, selection algorithms and rendered output implementations.
- Existing local branch `/tmp/celinen-main` and its older V1/admission work.
- UI layout/styles/copy, photo originals, existing customer stores and cloud data.
- New subscription billing authority, OAuth account-creation inference, V2 staging,
  flag changes, website publication, galleries/social publishing and dashboards
  populated with fabricated data.

## Outstanding owner/backend work

All three PostHog build variables are absent from this worktree/process;
the live Lovable build configuration is **not verified**. Configure them securely
before an approved build/publication. Then verify a stored `app_opened` in project
607971 using the operator procedure. Git sync alone is not publication or ingestion.

17 event names have real producers, with documented coverage boundaries.
Subscription start/cancellation remain unwired. Password signup is observed only
when explicit signup and matching verified-session transition occur in this tab.
Second-shoot is browser-observed, not global account-lifetime truth. V2 remains
disconnected and unqualified; no server kill switch was enabled.
