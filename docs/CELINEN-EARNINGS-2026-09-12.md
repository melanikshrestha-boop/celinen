# Celinen Earnings · September 12, 2026

This is a local implementation checkpoint, not a production publication receipt.
Public name and tab title remain defined by `src/lib/product.ts`.

## What changed

- Earnings and Spending share a responsive activity-chart / category-ring layout.
  The canvas follows the workspace theme: white in Light, black in Dark. Panels,
  filters, menus and all seven finance desks use the same theme and sans-serif.
- Collected, Expenses and Net cash flow are switchable views of existing ledger
  data. Positive Net is green, negative Net red, and other activity blue. Keyboard
  arrows, Home and End inspect exact dates; the chart data table remains available.
- Axis guides round to valid integer minor units without rounding recorded points.
  This fixes the fully-refunded/odd-minor-unit chart crash.
- The Expenses tab now uses the expense total and categories together. Category
  rings explicitly identify positive-only categories when refunds or corrections
  make their sum differ from the recorded total. All positive categories remain
  accessible in the scrollable legend; empty data produces no invented chart.
- Payment-row counts are called Collection entries, not Paid jobs. The misleading
  average-job figure was removed. Comparisons name their equal-length prior period.
- Open-invoice counts exclude test/unverified and non-open records, matching the
  currency, shoot and as-of-date boundaries. Unknown balances remain unavailable.
- Tax adds eight expandable, IRS-linked preparation topics: self-employment tax,
  health insurance/HSA, W-9/contractors, depreciation, mileage, meals, home office
  and QBI. Existing 2026 estimated-payment dates and Solo 401(k), SEP, SIMPLE and
  IRA references remain available. The new topics have their own review date.
- The dashboard shell uses a 60px rail on phones and removes its reserved
  Appearance gutter. At 390px, Earnings now has 330px instead of 50px. Desktop
  widths and preferences survive resizing, including interrupted sidebar drags;
  icon navigation retains accessible names.

## Financial boundaries

No customer ledger, invoice, payment, account or photo was modified for QA. This
pass does not change collection, refund, expense, tax or investment calculations.
The invoice **count** eligibility fix is the only bookkeeping projection change.

Invest is an educational retirement hub and recorded equipment-spending view, not
a brokerage. Forecast lists verified unpaid invoice balances, not promised income.
Equity remains explicitly unavailable without dated asset and liability balances.
Tax is U.S. federal preparation guidance, not filing, deduction approval or a
personal contribution/tax calculator. State/local/cross-border guidance is linked.
The checklist explicitly resets on leaving the Tax desk; it does not file or save.

Sources include [IRS self-employed guidance](https://www.irs.gov/businesses/small-businesses-self-employed/self-employed-individuals-tax-center),
[2026 retirement limits](https://www.irs.gov/retirement-plans/cola-increases-for-dollar-limitations-on-benefits-and-contributions),
[contractor reporting](https://www.irs.gov/instructions/i1099mec), and
[2026 HSA guidance](https://www.irs.gov/irb/2026-02_IRB).

## Reproduce the presentation checks safely

From this repository:

```sh
./node_modules/.bin/vite --config tests/finance-visual.vite.config.ts --mode finance-qa
```

Open `http://127.0.0.1:8096/tests/finance-visual.html`. This is a storage-free fixture
using the real presentation components and synthetic rows. It disables Vite env
loading and permits only same-origin network connections. It is not the real
authenticated app and must never be used as production, payment or RAW proof.

Check Light/Dark at 390, 768 and 1440px, all seven tabs, expanded tax topics,
empty/unavailable/invoice-unavailable data, USD/JPY/KWD and the period filters.
Transactions in this fixture is explicitly a placeholder; use the actual local
app to check the real ledger. Chart data should agree with the selected metric;
keyboard inspection must retain exact minor-unit amounts.

## Verification so far

- 84 focused financial/mobile tests passed; 19,804 assertions.
- Storage-free browser checks: 71 assertions each at 390, 768 and 1440px, covering
  both themes, all desk canvases/panels, shared font, overflow and tax links/details.
- USD, JPY and KWD formatting, exact keyboard inspection, empty and unavailable
  states checked interactively. Real local LAB route themes/dropdowns checked.
  The invoice dialog fits 390px, respects Light and was closed without submission.
  Mobile Dark uses a black canvas; restoring 1440px restores the 248px desktop rail.
- Production client/SSR build and scoped finance/test lint passed after the
  mobile-shell fix. Shell logic lint passes; pre-existing AppDashboard formatting
  warnings were left untouched to avoid unrelated file-wide churn.
- Final environment-free full suite: 2,339 passed, 21 skipped, 1 TODO and 5 failed,
  with 455,092 assertions across 228 files. Exact committed baseline `033e64e`: 2,317 passed,
  the same skips/TODO and the same five failures. No new finance failures.
- Existing failures: connector mark path, Develop chrome color, default-theme
  assertion, compact-sidebar row token and workbench typography fallback.
- The unrelated, intentionally failing untracked
  `tests/develop-analysis-persistence.test.ts` was excluded. Optional RAW fixtures
  were not enabled. These results do not establish import or native RAW parity.

## Git / live handoff

- Worktree: ChatGPT `intelligent-image-aid`, local branch
  `codex/lenslabs-photographer-platform`; starting HEAD `033e64e`.
- Final readback found the implementation checkpointed locally at `c425c64`.
  This document's final verification addendum remains an unstaged local edit.
- Read-only remote check: `main` remains `8210e95`, remote platform remains
  `af28aaa`. Remote platform and local history diverge; never force-push either.
- Publishing-branch choice was requested before push/merge. No Git push or Lovable
  Publish action has occurred during this pass. Do not claim the live site changed.
- Real HMR is `http://127.0.0.1:8080/`. The isolated unauthenticated browser is
  redirected to sign-in there. LAB8085 is supplemental local UI evidence only,
  not landing or authenticated production evidence.
- Preserve tracked dirty `.env.development` and the unrelated untracked Develop
  regression. Neither belongs in this changeset. The dirty Codex mirror was not
  overwritten; no public marketing files changed.
- After branch integration and release gates, the owner must use Lovable
  **Publish → Publish changes**, then verify the actual live build and Google
  return destination. A Git push alone is not publication.
