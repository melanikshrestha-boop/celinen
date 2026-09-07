# Account entry repair — September 7, 2026

## Compact refinement

The subsequent refinement keeps the same lens asset and dark photographic identity while reducing the normal desktop card from 560 × 845px to **484 × 698px**. Measured at 1440 × 1000: 26px vertical / 30px horizontal padding, 29px semibold heading, 14px subtitle, 13px labels, 45px inputs, 47px Google and primary buttons, and a 76px trust row. Controls and trust row share exact left/right edges.

The CTA is flat, subdued ivory with no gradient; the panel has a quieter border/shadow and the existing background is dimmed through a CSS overlay. Placeholders are exactly `Pablo Picasso`, `picasso@gmail.com`, and `At least 8 characters`. The signup magic-link action is removed; returning users still have passwordless recovery on the sign-in screen.

**53 browser checks pass**, including the requested dimensions, alignment, exact placeholders, absence of signup clutter, and existing auth interactions with simulated provider responses. Desktop and 390px phone screenshots were inspected. A 320px viewport and 200% text size have no horizontal overflow or clipped controls. All 804 existing tests, TypeScript, changed-component ESLint, and the production build pass. The live-provider and Lovable publication limits below are unchanged.

## Correct product surface

Use `http://localhost:8080/auth?mode=signup&next=%2Fworkspace` for the running local website.
`scripts/qa/commerce/index.html` is an isolated test harness, not a deployable app or product preview. Opening it using `file://` cannot load its Vite/TypeScript application. It now shows an explanation and links to the real app instead of an empty white page.

## Visual reference

Matched the supplied September 7, 12:35 AM reference: full-screen dark optical background, centered translucent panel, LensLabs logo, account heading, inline mode switch, Google button, artist placeholders, email/password controls, ivory submit button, local-originals reassurance, and client-portal link. Sign-in shares this treatment. Workspace and Studio styling/data are unchanged.

No fake Terms or Privacy Policy links were added: the repository has no published legal-policy routes. Owner-approved policies remain a launch requirement, rather than implied consent to nonexistent documents.

Background: `public/images/auth-lens.jpg`, 1672 × 941, approximately 143 KB. Created with built-in imagegen, then JPEG-encoded for delivery. Only the backdrop is an image; all form controls are real HTML.

Generation prompt: “Cinematic photorealistic dark camera-lens backdrop, landscape 16:9. Massive black lens cropped along the far right edge with subtle amber, copper and pink reflections. Restrained warm diagonal flare from the far left at upper-middle height. Soft charcoal studio atmosphere; central 60 percent nearly black negative space. No people, text, logos, watermarks, UI, forms, panels, or buttons.”

## Functional verification

`scripts/qa/auth-form-checks.js` runs inside the REAL local auth page using the browse tool's `eval` command. It temporarily intercepts provider responses in that single signed-out test tab and restores fetch afterward. It does not persist a synthetic session, create users, send email, or change real account/shoot data.

40 passing browser checks cover:

- Signup defaults, empty artist-placeholder values, labels and password-manager semantics.
- Required/invalid-email validation and password reveal.
- Duplicate submission suppression and locked controls while a request is pending.
- Signup profile metadata and safe email-return destination.
- Confirmation-required responses without a false workspace unlock.
- Cleared passwords/reveal state and errors when appropriate.
- Sign-in with existing passwords shorter than eight characters.
- Invalid credentials, retry, and passwordless email sign-in.
- No implicit account creation from the sign-in magic-link action.
- Local Google recovery without navigating to the dead `/~oauth/initiate` route.
- Actual public-home and client-portal navigation targets.
- Responsive layout and clean mode switching.

Visual checks: desktop 1440 × 1000, phone 390 × 844, narrow screen 320 × 740, and 200% text size. No horizontal document/control overflow. Long pages scroll normally rather than clipping the form.

Full existing suite: 804 tests pass, 0 fail, 185671 assertions. TypeScript and changed-component ESLint pass. Production build passes. The loopback HTTP bridge suite requires normal local-network access; its sandbox failure is not an application regression.

## Live-provider and release limits

Public provider-settings probe succeeds and reports email/signup enabled. A read-only direct Google authorization probe returns HTTP 400, `Unsupported provider: missing OAuth secret`, despite its enabled flag. Local Google therefore offers email sign-in or same-tab navigation to the hosted Lovable sign-in flow. This change does not manufacture a Google session or silently bypass authentication.

No real credential entry, Google consent, live email delivery, or completed live signup was performed by the agent. These remain separate provider acceptance checks. The local UI is not proof of production deployment. Source must sync to Lovable and the owner must publish its latest version to update lenslab.dev.
