# FOTO public-site polish

Scope: preserve the approved mountain artwork and OpenAI Sans; add gentle arrival/scroll fades, a right-edge menu, a real public information directory, and explicit USD pricing presentation. No photo, financial calculation, backend-permission, or private-workspace changes. Existing local environment changes were not inspected or included.

## Verification before publishing

- Full Bun suite: 2,041 passed, 21 skipped, one existing RAW white-balance TODO, zero failures. A sandbox-only first run could not bind six loopback HTTP tests; the complete isolated-loopback rerun passed.
- TypeScript, scoped ESLint, Prettier, whitespace checks, and production build passed.
- Built production worker: 15 successful public/auth SSR routes plus a real 404 for an unknown article. Outbound network was disabled; zero outbound calls occurred.
- Twelve motion tests cover missing browser APIs, reduced motion, visible/tall/offscreen targets, focus, anchors, page restoration, teardown, and stale observer responses. Tests reproduced and then verified fixes for callbacks after partial observer registration failure and after a hash jump.
- Browser checks: actual 320px, 427px, 520px, 1280px and 1707px CSS viewports; no document overflow. A wide pricing comparison scrolls within its own region. The desktop menu ends at the viewport's 24px content inset; mobile uses 20px. Small screens omit only the decorative CTA arrow.
- Checked home to Pricing, Blog, article, Product anchor, Privacy and back; shared fonts/nav/footer survive navigation. Visible scroll targets were opaque, offscreen targets faded out, and footer columns revealed at the bottom.
- Pricing tests include 48 account/audience/billing render combinations, signup payload normalization, failed-submission behavior, free-account routing, and USD cent precision. These are local regression checks, not live payment proof.

## Deliberate limits

- No customer libraries, real payments, or sign-in credentials were used for QA. Reduced-motion behavior was checked in deterministic tests and styles, not by changing the owner's OS setting.
- Paid amounts and billing IDs are unchanged. The pre-existing Hobby monthly mismatch remains: the pricing form lists USD 20 while signup lists USD 16. Owner-approved pricing reconciliation is separate from this presentation release.
- Privacy/Terms pages retain their explicit unconfigured-policy notice. An owner-reviewed policy is still needed; this change does not invent legal terms.
- Public footer patterns were checked against https://cursor.com and https://lovable.dev. Motion uses progressive enhancement based on IntersectionObserver and prefers-reduced-motion.
- Publication is a separate gate: push the reviewed branch, explicitly publish in the existing Lovable project, then read back lenslab.dev. A local build alone is not deployment proof.
