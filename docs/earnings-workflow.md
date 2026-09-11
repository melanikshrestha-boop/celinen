# Earnings: payments attached to the work

The primary surface is **Earnings** (`/earnings`); `/money` remains a compatible redirect. Its Ledger separates invoices, gallery orders, expenses and payouts. There is no mount-time sample-data insertion, and no existing financial history is deleted as part of the redesign.

## Product reference

HoneyBook's [Finance Overview](https://help.honeybook.com/en/articles/9510015-navigating-the-finance-overview-page) separates completed, overdue and upcoming payments. Its [cash-flow and project-profit documentation](https://help.honeybook.com/en/articles/12293332-honeybook-cash-flow-project-profit) distinguishes collected income from forecasts and requires project-assigned expenses for project profit. FOTO applies that distinction to shoots rather than copying a general bookkeeping dashboard.

## Accounting boundaries

- Collected is period cash receipts less individually dated successful refunds. **Net Cash Flow** subtracts recorded expenses. This recorded-activity subtotal is not profit, taxable income or a bank balance: unrecorded fees/costs, depreciation, asset purchases and tax liabilities are not fully modeled. Never sum different currencies.
- Outstanding/overdue are current, verified issued invoice balances, not invoice drafts. The Invoices filter intentionally includes all dates so older open invoices remain reachable.
- One canonical connected-account charge is one payment. An invoice and its charge cannot count twice. Payouts are transfers, not additional income.
- Pending, failed and test-mode payments are visible but excluded from real earnings. Unlinked Stripe charges remain visible for review, outside confirmed shoot income.
- Legacy rows remain preserved. Missing currencies or unverified provider balances are labeled; they do not become confident zero balances.
- Dates use the browser's reporting timezone. CSV retains record/source/shoot identities and guards against spreadsheet formula injection.

## What is connected

Local development (`npm run dev:lab`) supports guarded local manual entries, invoice drafts, shoot association and exports. It deliberately disables cloud services. Saving a local draft does **not** send it, create a payable invoice or mark it collected.

Authenticated workspaces can read their own Stripe connected account and send reviewed invoice drafts when their existing Stripe and database configuration is available. Provider operations must use owned shoot/client records, current invoice revisions and idempotent requests. External sending only occurs when the user chooses Send.

Stripe account authority is server-signed and bound to the workspace owner and connected account; an editable profile account ID alone is never sufficient. OAuth completion is browser-bound and single-use. Older unsigned connections must reconnect, without deleting their records. Invoice sends recheck the actual Stripe recipient as well as the reviewed client; changed or uncertain state fails closed. Cached invoice URLs cannot bypass provider verification.

Current in-app invoice creation/editing/sending supports USD. Existing foreign-currency drafts are retained read-only. Receipt reports remain currency-separated. Provider reads are bounded and disclose partial results; database reads fail closed if a complete, consistent result cannot be obtained. Unverified sent invoices suppress confirmed outstanding/overdue totals rather than turning missing evidence into zero.

SmartFile booking/deposits and gallery checkout are not yet end-to-end connected. The gallery filter is ready to display classified provider receipts, but does not fabricate sales. Live payouts, payment-reminder scheduling, bank linking, tax filing and automatic processor-fee lines are not claimed as shipped.

## Interaction

Use the approved Wonder type system: a shared serif for the interface and monospace for numeric values, neutral dark/light surfaces, restrained selected states and a compact payment pulse. Manual data entry is in a drawer, not a spreadsheet footer. A row opens details and the linked shoot. Hover-only pin/archive controls apply per exact chat/shoot row, with keyboard-focus and touch access, persistent organization, archive recovery and Undo.

## Recorded-data charts

Earnings uses pitch black (`#000000`) in dark mode and Wonder's neutral light surface (`#f7f7fa`) in light mode, independent of saved canvas/background colors. No financial records are rewritten.

Insights shows three primary line/area graphs: **Collected**, **Expenses**, and **Net Cash Flow**. Refunds are available in a separate disclosure, because they are already deducted from Collected. There is no prescribed accounting-standard chart count; three primary graphs keep the receipt, cost and resulting cash movement legible without repeating refunds as another deduction. A zero-only series keeps its exact total and a compact status instead of a large empty plot. Nonzero offsetting movements still render a real trend even if their period total is zero.

This Month uses calendar days; This Year and All Dates use calendar months. Charts follow the period, currency and shoot filters; ledger tabs and text search only filter the ledger. Activity is blue; positive and negative Net Cash Flow use green and red, with signed values also available in text. The dotted blue average is a calendar average including zero-activity intervals, not a margin, growth rate or forecast. Graphs use a two-column layout when the content region is at least 700px wide, rather than depending on the whole viewport's width.

Breakdown contains Collection Mix and Expense Mix donut pies. They show positive recorded category amounts, not net income; dated refunds and negative historical corrections are disclosed separately and reconcile to the pulse. Gallery Sales is part of Collected. Outstanding and Overdue remain current verified balance indicators, not fabricated historical series. Empty, incomplete and loading states never render invented chart data.

### Accounting references

- [IRS Publication 538](https://www.irs.gov/publications/p538) distinguishes cash-method receipt/payment timing from accrual earned/incurred timing. FOTO's recorded cash activity does not select or change a customer's tax accounting method.
- [IRS Publication 334](https://www.irs.gov/publications/p334) explains net receipts after returns/allowances, costs of goods sold, expenses, and sales-tax distinctions. A chart is not a substitute for classifying those records correctly.
- [SEC financial-statement guide](https://www.sec.gov/about/reports-publications/investorpubsbegfinstmtguide) distinguishes profit from cash movement. FOTO does not claim a complete income statement, cash-flow statement or balance sheet.
- [IRS Publication 583](https://www.irs.gov/publications/p583) covers supporting receipts and record reconciliation. The ledger and source documents remain authoritative; charts are a read-only presentation.

Graph values are available by pointer, touch, arrow keys or the expandable Chart Data table. Pie legends expose exact currency amounts and proportions without relying only on color. The aggregation is read-only, uses the canonical ledger and integer minor units, and excludes drafts, failed/test payments, payouts and unlinked provider receipts under the existing accounting rules. No extra dependencies or provider calls were added.

Chart verification: 94 targeted finance/chart tests passed, including 1,000 randomized reconciliation datasets; 16 isolated-browser regression checks passed. Dark/light and 390px layouts were visually inspected; a narrow-axis label overlap was fixed. TypeScript, scoped lint and the production build passed. QA records were confined to an isolated browser, not inserted into customer history.

## Verification, September 8, 2026

- Full suite: 1,503 passed, 20 skipped, zero failures; the skips cover optional external RAW fixtures and Lua-runtime integration coverage.
- TypeScript check passed. Production build passed. Changed-file lint is checked separately; the untouched legacy `Pie.tsx` has existing formatting diagnostics and is no longer the Earnings dashboard.
- Isolated browser: draft save is not income; exact manual amount, shoot, payer and tender round-trip; pin/archive/Undo preserve source records; details restore keyboard focus; New chat opens the composer from Earnings; dark/light use the same font; mobile has no document overflow.
- Fresh isolated browser: no automatic ledger rows or finance storage created. IndexedDB organization regression checks preserve unrelated stores, binary media and account scope.
- No live Stripe sends, charges, refunds, customer migrations or real account-payment readback were performed. Live payment integration still requires an authorized connected-account end-to-end test. The local lab mode is intentionally offline from providers.

## Wonder interface verification, September 9, 2026

- The actual Wonder source uses Source Serif 4 for interface text and system monospace for financial values/axes. The shared FOTO font is now self-hosted, preloaded, and checked for successful Roman/Italic loading, with the original OFL license retained.
- Three primary cash-activity charts, secondary Refunds, and two Breakdown pies were checked with isolated dated/currency-separated fixtures. Regression cases cover one-cent and zero-decimal currency axes, sign-crossing and one-sided Net graphs, and offsetting records that must not be labeled as absent.
- The final full suite passed: 1,915 passed, 19 skipped, one existing RAW white-balance TODO, zero failures. Loopback HTTP tests require permission to bind temporary local test servers. TypeScript, scoped source lint, formatting, and the production build passed. Browser fixture scripts compile as async function bodies, not standalone modules.
- Isolated browser checks passed for loaded font roles, amounts, filters, keyboard/pointer readouts, dark/light, 390px/944px/1280px layouts, and compact zero-activity states. All 23 mobile settings navigation targets measured 44px. The exact reserved QA ledger was removed and absence read back; customer libraries and financial history were not modified.
- These checks verify this presentation update, not full Lightroom parity or live financial integrations. Public publication and production Google sign-in verification remain owner-gated; a successful local build or private Git checkpoint is not a public deployment.
