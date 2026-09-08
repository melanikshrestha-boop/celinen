# Projects, shoots, and business workspace

## Scope

- Sidebar terminology: the existing photo/session container is presented as a project; its existing conversation records are presented as shoots.
- Storage keys, URL `shoot` parameters, IDs, photos, and user-authored names are unchanged. Only unnamed legacy labels receive a display alias.
- New projects are registered in Recents even with no imported photos.
- Project rows, shoot rows, and group headings share a 12px text inset. Pin/menu actions retain hover, keyboard-focus, and touch behavior.
- Client database and Earnings are directly accessible. These two tools use the full desktop content area; Studio keeps its assistant/editor layout.

## Client database

Local-personal mode reads and saves the existing device client store. It no longer attempts cloud authentication. Signed-in cloud and explicit legacy-record paths remain separate. Contact records, stages, bookings, and follow-ups retain their existing persistence and conflict checks.

## Earnings and tax preparation

The overview shows recorded income, recorded expenses, and net before tax for all dates or a selected calendar year. Invoice drafts, uncollected agreements, estimates, and demo jobs are not substituted for earnings. Existing entries and legacy categories are preserved; editing a legacy category keeps it available in the selector.

CSV exports include transaction IDs, dates, categories, descriptions, project references, amounts, explicit USD currency, and source. Category summaries export recorded costs in full, not presumed deductions. Commas, quotes, and newlines are retained; spreadsheet formula prefixes are neutralized without changing numeric losses.

This is bookkeeping preparation, not electronic tax filing. Currency is currently USD; no currency conversion or country-specific tax calculation is implied. The old blanket tax percentages, Schedule C mappings, 1099 determinations, and unsupported tax-software import promises were removed from this screen, not from any saved records.

For the recordkeeping/filing distinction, reviewed primary references:

- [IRS recordkeeping](https://www.irs.gov/businesses/small-businesses-self-employed/recordkeeping): income and expense records plus supporting documentation.
- [IRS self-employed tax center](https://www.irs.gov/businesses/small-businesses-self-employed/self-employed-individuals-tax-center): return preparation and tax worksheets are separate from recording transactions. This US guidance is not applied as a global rule.

## Verification

- `tests/bookkeeping-export.test.ts`: year boundaries, integer-cent totals, losses, full meal costs, CSV escaping/formula injection, invalid amounts, 1,000 deterministic calculation scenarios, and non-mutating label compatibility.
- `scripts/qa/sidebar-hover-check.ts`: existing navigation/pinning/keyboard/mobile regression flow updated to the requested terminology.
- `scripts/qa/business-workspace-check.ts`: measured text alignment, project persistence, local contact save/search/reload, recorded income/expense persistence, year filtering, actual download-Blob contents, responsive layout, and existing-record preservation.
- Browser fixtures are appended only in isolated launched Chromium, never in the user's active browser. They do not validate live Stripe processing or tax filing. No deployment is performed.

Observed results: 28 sidebar checks and 20 business-workspace checks passed. The full 1,104-test suite passed; a later repeated run returned one intermittent 429 in the existing C++ social-export HTTP test (expected 200). The isolated native-transport recheck passed. That intermittent result is not treated as a consistently green native-export path, and no transport code was changed in this UI/bookkeeping pass.
