# Public landing page: design review and implementation

Date: 2026-09-07. Status: DONE_WITH_CONCERNS (local only; reduced-motion device emulation unavailable).

Scope: the homepage, savings calculator, workflow overview, and homepage navigation/footer.
Studio, account forms, processing, saved shoots, calculator arithmetic, and publishing permissions were not changed by this pass.

## Research actually read

Michael Filipiuk, [UI Design Principles](https://ebooks.karbust.me/Technology/UI%20Design%20Principles%20-%20Michael%20Filipiuk.pdf).
The linked PDF contains 323 pages. Read the following relevant PDF page ranges in full, not the entire book:
30–35 (hierarchy), 45–55 (layout), 56–80 (typography), 96–105 (color), 124–138 (buttons), 223–237 (white space).
Visually inspected PDF pages 33 and 132 as well. PDF page numbers are four greater than the printed chapter pagination.

Applied principles: make prominence reflect importance; group related content through proximity and alignment; define a small type/spacing palette; distinguish primary actions from secondary links; use consistent button geometry and complete interaction states. These are design principles, not measured evidence that this page will convert better.

Cross-checked accessibility with [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and consistency/minimalism with [Nielsen Norman Group's usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/).
The book's taste recommendations are not universal requirements. No text, artwork, or CSS from the book was shipped.

## Findings and fixes

| Observed problem | Applied change | Verification |
| --- | --- | --- |
| Heavy sans hero, Georgia savings headings, monospace ticker: three unrelated treatments | Existing Inter Tight throughout; shared heading weights and sizes | Computed type family matches across headings and paragraphs |
| Different CTA radii, colors, hover lifts and shadows | Shared primary/link variants; no button gradients or shadows | Both main CTAs match height, font, fill, text and radius |
| Warm/green bordered metrics compete with blue labels and red hero | Neutral surface/text tokens, same subdued metric treatment | Computed gradient and border checks; screenshots |
| Oversized workflow panels and loose internal gaps | Smaller panels, 8/16/24/32 spacing rhythm, aligned content widths | Desktop and mobile review; five workflow stages still reachable |
| Fake terminal results, timing claims, generated domain, replacement badges | Removed unsupported promotional claims and demo output | Rendered copy and metadata checks |
| Footer mixed dead labels, an unrelated email and working links | Four real public links; homepage-only compact footer | Each public destination opened successfully |
| Offscreen sections were hidden by scroll-reveal styling | Homepage content remains visible without reveal effects | Computed visibility and screenshot checks |

## Implementation contract

- This is a scoped dark public page; it does not override the app's appearance preferences.
- Background #101112; surface #1b1c1d; main text #ecebe7; secondary text #b4b5b6; CTA #e5e2dc with #1c1d1e text.
- Main actions: 48px minimum height, 16px/600 text, 8px radius. Compact navigation and icon targets: 44px minimum.
- Form labels/inputs: 16px. Supporting notes: 14px. Eyebrows: 12px, modest tracking.
- Input outlines communicate interaction. No structural divider lines or decorative shadows.
- Main sections share a 1120px maximum width and 24px outer margins. Mobile becomes one column.
- No new fonts, icon packs, dependencies, assets or animation libraries.
- One shared main primary-action class. The optional landing Nav variant does not change the default Nav on other pages.
- Savings remain explicit editable examples, not reported customer outcomes. Time value remains separate from cash savings and costs.
- Advanced retouching and connected-account publishing limitations remain visible.

## Verification

- Existing calculator/workflow QA: **31 browser checks passed**, including invalid inputs, resets, formula disclosure, carousel endpoints, large values, reload and 320/390/768/1440px layouts.
- New design QA: **40 checks passed**, including desktop/mobile geometry, primary-button consistency, solid-surface text contrast of at least 4.5:1, skip-link focus, mobile-menu dismissal/focus restoration, public links and default navigation outside the landing page.
- Full suite: **1,096 tests passed**, 0 failed, 68 files / 198,824 assertions. This includes the existing 1,000 calculator scenarios, not 1,000 visual reviews.
- TypeScript, scoped ESLint, production build and git diff whitespace checks passed.
- The first full-suite attempt could not bind its localhost HTTP fixture in the sandbox. The same suite passed with local-listener permission; no test logic was changed.
- The first menu assertion ran before its closing animation ended. The harness now waits for unmount and focus restoration before checking both.
- Browser reduced-motion emulation was denied by the QA tool's allowlist. Only the loaded CSS override was verified; no claim of live device emulation.

Evidence:

- Before: /private/tmp/lenslabs-home-before.png and /private/tmp/lenslabs-design-before.png.
- After: /private/tmp/lenslabs-marketing-design-qa/home-desktop.png, home-mobile.png, savings-desktop.png.
- Check receipts: /private/tmp/lenslabs-marketing-design-qa/checks.json and /private/tmp/lenslabs-marketing-savings-qa/checks.json.
- Test/build logs: /private/tmp/lenslabs-design-tests.log and /private/tmp/lenslabs-design-build.log.

Preview: http://127.0.0.1:8085/#savings. Not committed, pushed or published.
No claim of measured conversion improvement, guaranteed time savings, competitor parity, or a full-product design audit.
