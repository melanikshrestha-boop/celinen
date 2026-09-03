# LensLabs roadmap

## Done
- Workspace (Event Desk, Pick, Metadata, etc.) is sign-in gated; animated locked screen.
- Simplified Event Desk: 3 animated stat tiles + slim source rows, logo motion.
- Home page shows an animated Event Desk demo instead of the real one.
- Consent-based shoot concierge on /portal: opt-in only, one question at a time, writes a brief + style tags for the photographer; turning it off deletes the transcript.
- Photographers' room at /community: channels (general, pricing, clients, boundaries, gear, critique), live-polling feed, member profiles with handles.
- Mobile pass: 3-up gallery grid with lazy/priority image loading, tighter shoot grid, 16px form inputs and tighter padding on the portal booking form.

## Next
- [ ] Stripe: paste test keys, then sync real charges into Earnings and turn the portal "Pay now" into an in-app payment (blocked — no Stripe keys in the project yet).
- [ ] Passive photographer profiling: infer photographer type from editing behavior, no repeated in-workflow questions.
- [ ] Pricing help: rate guidance so new pros don't underprice.
- [ ] Client acquisition/marketing surface.
- [ ] Boundaries: scheduling/expectation guardrails for late or demanding clients.
- [ ] Photographer-side view of client vibe briefs inside the Event Desk.

## Shipped — rates, payments, ambassadors
- `/rates` — photographer sets shoot packages + studio profile; published packages appear in client portals.
- Portal rate cards + "Pay now" that creates a Stripe hosted invoice on the photographer's connected account (needs Stripe keys to complete).
- Shoot concierge now ends in a real booking: type, date, location, budget → `booking_requests` with the AI brief attached.
- Pricing page upgrade form → saves signup, hands off to `/signup` checkout with plan/billing/email prefilled; states the % and $ saved.
- `/ambassador` — campus program page for Big Ten / D1 sports shooters, application writes to `ambassador_applications`.
