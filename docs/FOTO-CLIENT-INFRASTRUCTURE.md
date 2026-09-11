# FOTO client infrastructure

September 8, 2026. This increment adds practical client views, reviewed message
handoffs and a local C++ payment-receipt renderer. It does not establish a hosted
client portal, automated messaging service or full Pixieset/Lightroom parity.

## How to use the client workflow

1. Open **Clients → People** to search actual contacts by name, organization,
   email, phone, specialty or notes. **Follow-ups** shows scheduled, non-archived
   reminders in date order. **Board** shows all six saved stages: New, Contacted,
   Quoted, Booked, Delivered and Archived.
2. Open a contact to edit its details, schedule a follow-up, or add/edit a booking.
   Bookings retain their IDs and creation dates. A confirmed booking sets the
   client stage to Booked; it does not create a shoot, signed contract or payment.
3. Use **All fields** or the contact's saved-record details for the older sheet
   fields. Existing records and explicit gallery/invoice IDs remain intact.
   Missing or conflicting links are disclosed, not resolved by matching names.

Contact loading does not seed, prune, reorder or rewrite records. Local writes
use a browser lock plus a revision check; stale forms must be reopened. Account
mode uses the existing authenticated client functions, not an automatic import
of device gallery/invoice drafts. Storage errors remain visible. Legacy “Paid”,
NDA, gallery, PIN and password labels are retained planning data, not proof of
payment, signatures, gallery views or functioning access controls. The optional
USD planning budget is not collected revenue.

Implementation: [ClientsSheet](../src/components/clients/ClientsSheet.tsx),
[ClientEditor](../src/components/clients/ClientEditor.tsx),
[CRM helpers](../src/lib/clients/crm.ts),
[client persistence](../src/lib/client-workspace.ts) and
[route loading](../src/routes/clients.tsx).

## How to prepare a customer receipt

In **Earnings**, open an eligible payment and expand **Customer Receipt**. Review
the business and customer names, then choose **Create Receipt**. The payment must
be a positive, exact collection with a real shoot link, known currency and a
payment date no later than today. Editing receipt names does not edit the ledger.

- **Manually recorded** means an existing manual payment marked Recorded. It is
  not independently verified by a payment provider.
- **Provider verified** requires a complete, connected, live provider snapshot
  no older than five minutes. Charge/account, shoot/client, currency, captured/net
  amount and payment date must match. Refunded, disputed, pending, unlinked or
  incomplete records are rejected. The date is checked in the ledger timezone;
  invalid timestamps and clocks more than 30 seconds ahead are rejected.
- Preparation and subsequent download/share actions recheck eligibility. A
  changed payment or snapshot invalidates the prepared artifact; expired provider
  verification requires **Refresh Earnings**. The C++ renderer formats the
  supplied provenance label; it does not authenticate Stripe itself.

**Download Receipt** produces print-ready HTML. Open that file and use the
browser's Print/Save as PDF command if needed. The native engine also returns
plain text for messages; it does **not** generate a PDF. Unknown payment methods
are omitted. No tax calculation, balance claim or guessed tender is added.

**Copy Text**, **Open Text Draft**, **Open Email Draft** and the available system
share sheet hand a reviewed draft to the user's apps. They do not send through a
FOTO provider or record a delivery confirmation. On Apple platforms the message
is copied first and a recipient-only `sms:` link opens Messages; paste, review
and send there. Other clients may accept the encoded SMS body, but support varies.
If an app or clipboard handoff fails, the review text remains selectable.

Implementation: [payment projection](../src/lib/receipts/from-earnings.ts),
[receipt UI](../src/components/earnings/CustomerReceipt.tsx),
[message composer](../src/components/customer/MessageComposer.tsx) and
[recipient/URI validation](../src/lib/customer-message.ts).

## Native receipt reference

`renderCustomerReceipt(model, signal)` validates the model, obtains a local
capability token, and posts the bounded binary packet to the Vite bridge. The
bridge starts `native/build/lenslabs-receipt` without a shell. C++ produces
deterministic `{html, text}` JSON over stdout; no receipt file is written by the
renderer or bridge.

| Boundary        | Implementation / limit                                                                                                                                                                                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model and codec | [`protocol.ts`](../src/lib/receipts/protocol.ts): receipt ID, issued/paid calendar dates, business/customer/shoot names, description, optional payment method, explicit source label, currency and positive safe-integer minor amount. Currency precision is 0, 2 or 3 decimals; money formatting uses integers. |
| Input           | FRCP version 1; big-endian integer header and ten length-prefixed UTF-8 fields; total ≤8 KiB. Individual byte limits include ID 128, business/customer 160 each, shoot 200, description 2,000 and payment method 80. Invalid UTF-8, controls, invalid dates, overflow and extra/truncated bytes are rejected.    |
| Local bridge    | [`native-receipt.ts`](../src/server/native-receipt.ts): `GET /__receipt/status`, `POST /__receipt/render`; loopback/Host/origin/request/token guards, no-store responses, one active request, 10-second upload/request deadline, 3-second child timeout.                                                         |
| Native output   | [`receipt.cpp`](../native/src/receipt.cpp): compact white, sans-serif print layout, escaped HTML, no scripts/external assets, plain text; JSON ≤64 KiB. Errors do not echo customer fields.                                                                                                                      |
| Browser client  | [`native-client.ts`](../src/lib/receipts/native-client.ts): localhost only, bounded streamed responses, cancellation and 15-second overall timeout; no fabricated fallback when the engine is absent.                                                                                                            |

The plugin is registered in both Vite development configurations. It is **not**
included as an available service in a static hosted build. Rendering is portable
C++20; the broader photo engine has separate platform/dependency requirements.

### Build and verify locally

From the repository root, with dependencies installed, Make, a C++20 compiler
(default `clang++`) and Bun available:

```sh
make -C native build/lenslabs-receipt build/receipt-tests
native/build/receipt-tests
bun test tests/native-customer-receipt.test.ts tests/customer-receipt.test.ts tests/clients-crm.test.tsx
bun test tests/customer-receipt-http.test.ts
npm run dev:lab
```

The HTTP test uses synthetic data and an ephemeral loopback listener; sandboxed
runners may need permission to bind that listener. It does not open customer
accounts or send messages. If status reports the engine unavailable, build the
receipt executable and restart the local Vite server; a hosted page cannot use
this local-only feature.

## Focused verification and image-processing correction

Receipt verification completed: **11 Bun protocol/native/client tests, 274
assertions**, plus **1 actual HTTP test, 25 assertions**. The C++ receipt suite
passed **2,211 assertions** in optimized and AddressSanitizer/UndefinedBehaviorSanitizer
builds. Scoped lint and TypeScript checks passed. Projection and CRM tests are
separate suites; these figures are not a claim that the entire application suite
or live provider workflow passed.

A local synthetic benchmark measured **1.040 ms median / 1.482 ms p95** over 25
warmed serial requests. It includes TypeScript validation, a fresh C++ process,
HTML/text rendering and JSON decoding. It excludes HTTP, browser interaction,
printing and message delivery; it is not a cross-device performance promise.

This increment also fixes Develop's **color-noise reduction before sharpening
and texture**. Previously, extracting detail from the noisy signal could cancel
the color-noise control when combined with sharpening. The native pipeline now
cleans color first and extracts detail from that result. Color-noise-only recipes
retain their previous pixels; tests cover combined controls, determinism,
unchanged source/alpha, grayscale detail and tiny uniform images. This remains
classical decoded-image processing, not trained AI or sensor-RAW reconstruction.
High settings can soften color detail; preview and export sizes can differ.

The focused Develop results reported for this fix are **113,322 native assertions**
and **16 passing Bun tests with one optional fixture skipped**. Sources:
[`develop.cpp`](../native/src/develop.cpp),
[`develop_tests.cpp`](../native/tests/develop_tests.cpp) and
[`develop-engine.test.ts`](../tests/develop-engine.test.ts). See the existing
[Develop assist guide](FOTO-DEVELOP-ASSIST.md) for broader editing limits.

## References and remaining work

The [monday.com photographer CRM article](https://monday.com/blog/crm-and-sales/crm-for-photographers/)
is product/workflow context, not an independent comparison or evidence of FOTO
features. Pixieset's own [Studio Manager](https://pixieset.com/studio-manager/)
and [Client Gallery](https://pixieset.com/client-gallery/) pages describe their
booking/business and gallery-delivery products. Their claims do not establish
FOTO integration, migration or feature parity.

Messaging follows the recipient-only behavior documented in
[Apple SMS Links](https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/SMSLinks/SMSLinks.html);
[RFC 5724](https://www.rfc-editor.org/rfc/rfc5724.html) defines the broader SMS URI
scheme and body encoding. Actual destination-app support and delivery are outside
this implementation's confirmation boundary.

Still unproven end-to-end: hosted customer gallery access/delivery, a real live
customer payment/receipt journey, provider SMS/email delivery and readback,
automated follow-ups, and complete Pixieset or Lightroom parity. Saved links,
local previews, successful rendering and message-app handoffs are not substitutes
for those checks.

## Final integration checks

- Full application suite: 1,622 passed, 20 optional skips, zero failures,
  including mobile-layout and title-lifecycle regressions. The skips are optional
  Lua-runtime tests and the opt-in real Sony RAW fixture, not passed camera coverage.
- TypeScript and scoped lint passed; production client/server build completed.
  Existing dependency deprecation and route-export optimization warnings remain.
- The browse skill exercised the real local UI with synthetic data: 12 receipt
  checks and 16 CRM checks. Downloaded C++ HTML preserved the preview's amount,
  identity, shoot and method, and escaped user-entered text. Ledger bytes stayed
  unchanged. No text, email or provider notification was sent.
- Actual client creation, booking, contact editing, phone/email search,
  follow-up filtering and board moves passed. The other client's record remained
  byte-for-byte unchanged. Reload retained both contacts and booking identity.
- Visual inspection at 1440px and 390px found and fixed a mobile contact-table
  clipping issue. Contact, stage and follow-up now stay together on small screens;
  the dark canvas is black and the client surface has a neutral white light state.
- Only the exact synthetic QA records were removed afterwards. Original empty QA
  client/finance stores were restored and pre-existing shoot-directory records
  were preserved. Real user-browser records were not used as fixtures.

Reproducible browser fixtures: `tests/customer-receipt.browser.js`, then
`tests/clients-people.browser.js`, followed by
`tests/customer-infrastructure-cleanup.browser.js`. Run only in a fresh isolated
local-lab browser; the scripts refuse existing customer financial/client data.

### Idle render-loop investigation

Status: DONE. A final browse check found repeated `Maximum update depth exceeded`
errors on Clients despite passing feature tests. The investigate skill traced the
feedback loop to a title effect depending on the whole navigation context. That
context changes during rendering; the parent title setter allocated new state
even when the title was identical.

Clients now depends only on the stable setter, route and primitive title. The
Workbench setter also returns the existing state for unchanged titles. The actual
component lifecycle fixture fails against the old effect after 25 renders, then
passes 200 identity-only context refreshes with zero extra title writes after the
fix. Seven intentional title transitions still work. A fresh live Clients page
remained ready through an idle check with no console errors. This fix changes no
persisted client/shoot records.

Regression: `tests/clients-title-lifecycle.fixture.ts`, run from
`tests/clients-crm.test.tsx`. The fix is confined to the Clients title effect and
Workbench title setter, not a navigation or storage redesign.
