# Public workflow and savings section

Implemented September 7, 2026 at `/#savings`. Local preview: http://127.0.0.1:8085/#savings.
Not published, committed, or pushed. Existing release approval gate remains in place.

## Presentation and claims

- Screenshot-inspired editorial heading, dark bordered metric cards, subtle warm/green backdrops,
  ivory CTA, and a five-stage workflow carousel. Scoped CSS does not change Studio or settings.
- Replaces the old static mock desk stats; no new authentication gate or backend dependency.
- Example: 10 hours/week × 48 weeks × $50/hour = $24,000 annual **time value**.
- Example software delta: ($120/month in tools actually canceled − $40/month LensLabs budget)
  × 12 months = $960. Combined potential annual value: $24,960.
- These are editable planning assumptions, not measured performance, actual earnings, customer
  savings, a verified competitor comparison, or quoted plan pricing. Time value and cash savings
  are disclosed separately. Costs above savings produce negative results, not a zero floor.
- Inputs stay in component memory; no calculator data is uploaded or persisted. Reload starts
  with the explicitly labeled example. Actual sign-in and remembered workspaces are unchanged.
- Advanced retouching is explicitly left to the photographer's editor; publishing requires a
  connected account. The carousel does not advertise unbuilt automatic retouching or print sales.

## Verification

- 28 focused unit/render/public-entry tests pass (5,191 assertions), including 1,000 varied
  calculator scenarios checked against independent cent-based arithmetic.
- TypeScript, scoped ESLint, and `git diff --check` pass.
- Production `npm run build` passes; log: `/private/tmp/lenslabs-marketing-build.log`.
- 31 isolated browser checks pass: all five inputs recalculate; blank/out-of-range/fractional-week
  validation; negative costs; reset; disclosure keyboard controls; formula; carousel forward/back
  and final-card visibility; 320/390/768/1440px layouts; maximum-value mobile fit; reload; no console errors.
- Desktop, mobile, and workflow screenshots were opened and visually inspected.
- Browser evidence: `/private/tmp/lenslabs-marketing-savings-qa/` (`checks.json`, `desktop.png`,
  `mobile.png`, `workflow-mobile.png`). The test browser is launched independently, never attached
  to the user's tabs, accounts, or cookies. Synthetic inputs only; no sign-in submission.

Repeat from this repository:

```sh
bun test tests/savings-estimate.test.tsx tests/public-entry.test.tsx
bun scripts/qa/marketing-savings-check.ts /Users/melanishrestha/.codex/skills/gstack/browse/dist/browse
```

The QA script accounts for same-hash navigation preserving React state, empty CLI fill arguments,
and Embla selection events firing before scroll animation settles. A test-browser restart during
an earlier run was recovered before the final complete passing run; no application change was
needed for that infrastructure issue.
