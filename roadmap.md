# LensLabs roadmap

## Done
- Pick / cull studio (RAW + JPEG, scoring, flags, develop, export)
- Production OS shell: Desk, Metadata, Packages, Adobe, Send
- Lightroom plugin + XMP bridge
- Pricing, signup + Stripe checkout
- Earnings ledger with Schedule C / 1099 exports
- Assistant rail (chat-driven culling)

## This pass
- [x] Shoot bar as a real page (`/shoot`): drop photos anywhere → auto-cull → keepers → Lightroom XMP
- [x] Lovable-style split layout: chat panel on the LEFT, work canvas on the RIGHT (studio + shoot)
- [x] Earnings: real shoot data per job — income, hours worked, turnaround vs deadline, profit per hour
- [x] Sign-in gate for beta: Google first, email fallback, wired to "Get started"

## Next
- [ ] Persist shoot sessions per signed-in user
- [ ] Team seats / shared packages

## 2026-09-02
- [x] Lightroom plugin points at live lenslab.dev bridge (+workspace)
- [x] Portfolio: paste existing Pixieset/Squarespace URL -> replicate + edit
- [x] Auth: LegionEdge-style sign in / sign up pages for "Get started"
- [x] Light mode accent = blue (not red); tagline "Go create more."

## 2026-09-02 (later)
- [x] REPLACES card: real logos + monthly cost of the average photographer stack
- [x] Portfolio replication redo — copies palette, type, nav, layout, hero (editable)
- [ ] Culling speed: any image type, ~2s for a full drop, with live timing readout
- [ ] Publish to lenslab.dev and verify pricing / plugin / portfolio live

## 2026-09-02 (backend pass)
- [x] Supabase schema: profiles, clients, shoots, transactions, invoices (+RLS, grants, signup trigger)
- [ ] Server functions: ledger/clients/shoots/invoices CRUD scoped to the signed-in photographer
- [ ] Stripe Connect Standard OAuth (photographer connects their own Stripe)
- [ ] Sync Stripe charges + payouts into transactions
- [ ] Stripe invoices (create + send) and webhook (invoice.paid, charge.succeeded)
- [ ] Wire Earnings + Clients UI to live data (no mock seeds)
- [ ] NEW: real client delivery system — gallery links, client favourites, downloads
