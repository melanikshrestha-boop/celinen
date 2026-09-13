# Celinen checkpoint · September 12, 2026

Base: `8210e95`. Worktree: the ChatGPT `intelligent-image-aid` tree.

## Earnings

- Verified the current financial presentation with storage-free synthetic records at
  `tests/finance-visual.html`. Light background is `rgb(255, 255, 255)`; dark is
  `rgb(0, 0, 0)`. Both fit a 390px viewport without document overflow. No financial
  records, customer accounts, originals, or preferences were used for QA.
- Removed the desktop chart minimum height on narrow screens. The 390px fixture's
  plot now has its intrinsic 117.47px height instead of 220px of letterboxing.
- Retained existing Earnings, Spending, Transactions, Invest, Forecast, Equity and
  Tax desks. This checkpoint does not replace the later committed top-row design.
- Verified 2026 retirement amounts and federal estimated-payment dates against IRS
  sources. Clarified that the general estimated-tax rule has two conditions, the
  smaller-of comparison, the 12-month prior-return requirement and higher-income
  thresholds. Added a warning to use current-year retirement worksheet limits.
- No changes to cash-flow, refund, invoice or expense calculations. The Tax and
  Invest desks remain educational references, not tax filing, contribution-limit,
  brokerage or investment-advice services. Equity remains unavailable without
  dated assets and liabilities.

Sources: [2026 Form 1040-ES](https://www.irs.gov/pub/irs-pdf/f1040es.pdf),
[Publication 560](https://www.irs.gov/publications/p560),
[2026 retirement limits](https://www.irs.gov/retirement-plans/cola-increases-for-dollar-limitations-on-benefits-and-contributions).

## Hosted Develop correctness

- Reproduced the hosted renderer silently ignoring valid curve, HSL, grading,
  detail, masks, film and straighten settings. A curve intended to lift a midpoint
  to white left it unchanged. These recipes now fail before decoding or mutating
  pixels, rather than returning a misleading successful JPEG.
- Browser controls and presets disclose native-only effects and prevent selecting
  unavailable controls. Supported basic tone, white balance and straight crop /
  quarter-turn / flip remain available. Existing recipes and histories are intact;
  the local C++ path remains available for advanced edits. This is a capability
  guard, not an implementation of those missing hosted effects.
- A failed recipe clears stale edited previews and export proofs. Source previews
  are labeled as such, and comparison is disabled when an edited result is absent.
- Independently reproduced mutation of a queued caller recipe: an admitted neutral
  midpoint changed from 128 to 176 after the caller changed exposure. The client
  now snapshots settings before queue admission for both native and browser paths.

## Verification and remaining gates

- Fail-first regressions reproduced the ignored-effect and queued-mutation defects.
- Focused client/browser, warm navigation, dialog lifecycle, finance, repository and
  import-lifecycle run: **143 passed, 1 optional native integration skipped**.
- Additional Detail handler regressions: **9 passed**. Disabled panels cannot
  reset a saved recipe; enabled native sliders retain their compatibility resets.
- Independent curve lifecycle, grading and browser guard review: **56 passed**.
- Native HTTP/processing run with loopback access: **66 passed, 1 optional Sony RAW
  fixture skipped**. This does not establish 337/1,000 real RAW import performance.
- Production build and scoped lint passed. The final full-suite run is **not
  green: 2,277 passed, 21 skipped, 1 todo, 12 failed** (2,311 tests / 220 files).
  The remaining presentation, cloud-history and gallery assertions also failed on
  an isolated committed-base archive. Some presentation tests pass alone but fail
  in the combined suite. They remain release follow-ups, not waived gates.
- Full-suite baseline archive excluded environment files and customer libraries.
  Its optional binary tests had different availability; its native/social skips
  and failures are not a performance comparison.

## Git and publication

- Never stage `.env.development`; its existing tracked changes are unrelated.
- Fresh remote check: `origin/main` was `8210e95`; the platform branch was `af28aaa`
  with separate Lovable commits. Do not force-push or replace either history.
  Requested the owner's publishing-branch choice before pushing this checkpoint.
- Git push is not Lovable publication. No Publish action or backend migration was
  performed. Live Earnings redirected the isolated QA browser to Google sign-in;
  owner authentication, final return destination and the signed-in live theme are
  still unverified. Do not infer production success from the synthetic fixture.
- The Codex mirror was not overwritten. These edits do not change the public
  marketing site, and another dirty checkout must not be flattened for a handoff.
