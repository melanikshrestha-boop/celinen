# LensLabs commerce and photographer network

Research and implementation checkpoint: September 7, 2026.

## Product decision

One workspace, not a collection of external dashboards. Print shop and Photographer network open as ordinary shoot workspace tabs through All tools or “open shop” / “open marketplace” in chat. The existing Studio interface, private photos and public homepage remain unchanged.

This is an initial implementation, **not a launched commerce platform**. Native domain checkout, paid print orders, production fulfillment, contractual bookings and review submission are not enabled. No domain or provider subscription has been purchased. Nothing in this release imports private accounts into public discovery.

## Provider choices and evidence

### Domains: embedded registration, not a link to a registrar

[Entri Sell](https://developers.entri.com/domain-purchasing) supplies an embedded domain-purchase experience with registrar partners handling registration billing and renewals. Partner choice affects country, language and extension support. Validate the actual contracted experience before promising a completely inline checkout.

[Entri's current integration guide](https://developers.entri.com/getting-started) offers a unified buy/connect modal. Authentication is issued server-side; credentials must not enter browser bundles. Restrict tokens to the intended domain, DNS configuration and user where supported. Do not auto-start registration from chat.

[Entri Power](https://developers.entri.com/power/overview) can supply custom-domain reverse proxying and TLS. This is a candidate, not an activated host. Tenant mapping, ownership verification, allowed origin paths and certificate lifecycle must work before registration opens. Never accept arbitrary client-provided proxy destinations or Host headers as proof of tenant ownership.

The intended LensLabs sequence is: choose portfolio/shop → search availability → review first-year AND renewal price → choose renewal behavior → explicit registrar purchase → verify email/ownership → DNS pending → TLS pending → live. Server-verified provider status must drive each state. A browser callback, payment-success page or DNS edit is insufficient proof of a live site.

[Lovable's domain documentation](https://docs.lovable.dev/features/custom-domain) demonstrates the lifecycle users expect: ownership, renewal management, DNS verification and SSL. Selling each photographer their own domain requires a multi-tenant implementation; attaching one domain to the LensLabs application is not equivalent.

### Seller payments: keep the business setup in LensLabs

[Stripe embedded onboarding](https://docs.stripe.com/connect/supported-embedded-components/account-onboarding) collects and validates seller requirements inside a platform's interface. Some flows still require secure Stripe authentication. Preserve the existing Standard Connect integration until the account model and platform liability decision are approved; do not silently create replacement accounts.

Require verified seller capabilities before accepting payment. Build an immutable order record and payment-attempt key before checkout. Verify signed payment webhooks, reconcile uncertain responses and protect against double charges and duplicate fulfillment. Keep buyer money, photographer payout, platform fees, tax and shipping distinct. Country availability is provider-dependent, not “every country supported.”

### Print production: lab fulfillment and photographer fulfillment

[Prodigi's Print API](https://www.prodigi.com/print-api/docs/reference/) is a candidate for lab production. Its quote endpoint supplies product and shipping costs without placing an order. Order submission can begin fulfillment immediately, so activation must require artwork validation, destination-specific quotes, payment verification, a cancellation policy and idempotent reconciliation. Sandbox quote and fulfillment tests come before live orders.

The draft product model supports either self-fulfilled or lab-fulfilled prints. Final provider selection is pending the founder's fulfillment preference. Both need size, medium, margin, production time, rights/consent and returns information. Lab products additionally need an explicit provider SKU, crop and resolution checks. Never send a private proof or local source file to a lab merely because it appears in a shoot.

### Shopify migration: preview, preserve, then move

[Shopify's CSV documentation](https://help.shopify.com/en/manual/products/import-export/using-csv) distinguishes products, variants, images and market-specific fields. This release imports selected product/variant fields from a bounded product export, with an explicit base currency. It does not convert prices or take over a running Shopify store.

The importer recognizes legacy and current column aliases, quoted text/newlines, multiple variants and image-only rows. It rejects ambiguous duplicates and malformed prices. Preview precedes adding to the draft; saving is separate. Existing source identities are skipped rather than overwritten, including archived products. Image URLs remain inert references, not downloaded artwork.

**Not migrated:** customer data, passwords, orders, gift cards, discounts, taxes, inventory, apps, shipping profiles, multi-market pricing, domain ownership or redirects. A full migration needs a separate reconciliation and cutover plan; the current import is not advertised as a full Shopify replacement. Before launch, import explicit product identifiers, collect rights, produce print-ready assets, verify variant mappings and review SEO redirects. Retain Shopify until paid test orders and refunds reconcile.

## Implemented in this release

- Private print catalog with named shop, manual products, price/currency, fulfillment preference, editing, reversible archiving and server revision conflicts. No silent product deletion.
- Shopify CSV preview and non-overwriting import. Limits: 2 MB CSV, 2,000 rows, 500 catalog variants. Supported draft currencies are USD, EUR, GBP, CAD, AUD, NZD and JPY; no conversion.
- Domain choices saved with the shop, explicitly labeled **not checked / not registered**. This is a shortlist, not domain availability or checkout.
- Explicitly opt-in public photographer profiles, searchable by name, place, specialty and language. No private account or community profile is auto-published.
- In-app booking/collaboration inquiries, received/sent inboxes, acceptance of interest, decline and withdrawal. No payment, contract, booking confirmation, email or push notification is implied.
- Reputation ordering based only on the separate verified-review table: a Wilson lower confidence bound of 4–5-star outcomes, followed by review count and deterministic name/id ties. Average and review count are displayed separately. There is no public review-writing endpoint yet; unreviewed photographers receive no fabricated stars. Ranking is not an identity check, safety guarantee or claim of superiority over another marketplace.

## Data and safety

Apply the additive `drizzle/migrations/0019_commerce_network.sql` to the existing Supabase project through the established reviewed migration process. Do not reset, reseed or replace existing schemas. The four new tables have RLS enabled and no direct anonymous/authenticated access; scoped server functions use the existing verified-account middleware. Private mutations carry an expected account id, checked against the verified actor before any database write.

Catalog and directory saves use transactional revision checks. Inquiry creation takes a per-sender transaction lock, supports retry with the same identity/payload, allows only one pending request per pair and limits new requests to 20 per sender per rolling day. Only the recipient can accept/decline; only the sender can withdraw. Requests are accepted only while the target is visible and accepting inquiries. Profile withdrawal does not erase existing inbox records.

The new verified-review table is reserved for a future payment/booking settlement service. Before enabling submissions, require one review per real completed booking, enforce client/photographer participation, add fraud/dispute handling and audit the settlement source. Do not seed public ratings for appearances.

## Activation gates, in order

1. Review/apply the additive database migration and test with two non-production accounts. Source sync does not apply SQL automatically.
2. Open Lovable's project and publish the validated changes; confirm the exact release on lenslab.dev. A Git push alone is not publication.
3. Select Entri registrar/hosting contracts, configure server-only credentials and callback domains, and validate tenant ownership/TLS in a pilot. Domain buying remains closed until that succeeds.
4. Confirm lab versus self-fulfillment and seller payment-account model. Build artwork preparation, public storefront, final quotes, checkout, order management, payout, refund and fulfillment webhooks. Complete sandbox and approved live low-value test orders before opening sales.
5. Add marketplace blocking/reporting, moderation, scoped conversations, notification consent, availability/calendar, contracts, deposit/payment records and verified review submission before broad public promotion.

## Validation

`bun test` covers the existing application plus importer, exact-price, source-preservation, account-expectation and reputation tests. `node scripts/commerce-sql-check.mjs /absolute/pglite-runtime` validates actual PostgreSQL behavior in memory, without production credentials. `scripts/qa/commerce/` runs the real new components with synthetic data at 127.0.0.1:8084; browser checks exercise save failure/retry, import duplicates, edit/archive, domain honesty, inquiry retries and profile visibility. Synthetic tests are not proof of a live provider integration or production deployment.
