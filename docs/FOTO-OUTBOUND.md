# FOTO outbound desk

## Scope

`/outbound` is the founder's **device-local FOTO acquisition desk**, separate from photographers' client records. It is available in `npm run dev:lab` at `http://127.0.0.1:8085/outbound`. The normal production route does not expose the desk; it explains that the founder tool is local-only. Existing Studio, Develop, finance, authentication, and `.env.development` are unchanged.

The new feature adds no backend service or model subscription. Its browser-side workflow and IndexedDB store extend the existing TypeScript app; the existing C++ image operator is unchanged. Clearing browser site data removes local records. CSV exports contain private contact details; store them appropriately. CSV is an interchange format, **not a full history/approval backup**. Device-local identity scoping is not encryption or a multi-user security boundary.

## Daily workflow

1. Set your actual name, offer, ask, and contact details in Campaign settings. Defaults describe an invitation to discuss the developing FOTO workspace, not unverified savings or feature-parity claims.
2. Add a photographer/studio or import a CSV. Record their specialty, an actual observation, its public source and date, and why FOTO could fit. Research links open searches for manual investigation; there is no background scraper or automatic lead enrichment.
3. Prepare and edit a deterministic draft from the supplied facts. This is template assembly, **not model-generated reasoning or independently verified evidence**. The evidence checklist is not a buying-intent probability.
4. Approve the saved draft. Changed text, contact details or campaign settings invalidate approval. Missing/future/older-than-30-days evidence blocks approval and sharing.
5. Copy the approved message or open it in your own email application. Neither action sends or marks the prospect as contacted. Actually send outside FOTO, then explicitly log that contact.
6. Record actual replies and conversions, with notes, and set a manual follow-up date. These are self-reported outcomes, never provider delivery receipts, verified payments, or revenue. No timers send messages.
7. Do-not-contact is permanent in this first version and survives imports and campaign changes. A seven-day cooldown applies after a logged contact, even if the person replies; a recorded conversion stops further prospect outreach.

## Persistence and import boundaries

- IndexedDB: `foto-outbound-v1`, `workspaces` store, keyed by exact local identity scope; not by shoot/project.
- Every mutation validates the full schema and checks the expected revision inside one read-write transaction. A stale tab cannot overwrite a newer record. Failed/corrupt reads never silently become an empty replacement.
- Notifications carry scope/revision only. Copy rereads the current revision; opening email requires a successfully committed, validated composer-request record. Async side effects stop after the component unmounts.
- Prospect cap: 1,000. CSV cap: 2 MB. Activity cap: 500 per prospect; errors preserve existing history instead of pruning it.
- Duplicate normalized emails and company websites are rejected, including suppressed contacts. Recognized social platforms preserve profile paths so distinct photographers do not collapse into one lead.
- CSV previews before commit and imports atomically. Exported workflow columns cannot import approval/contact history. Spreadsheet-formula prefixes are escaped in CSV exports.

## Reference verification

Requested post: <https://x.com/nifinet/status/2096695883077452085>. X returned 403 and the actual post text was not retrievable. Do not claim the post/video was read.

Related primary reference: [nifinet/gtm-brain-v2](https://github.com/nifinet/gtm-brain-v2). Its lead-memory, qualification, draft, outcome loop informed this adaptation. Its default signals and delivery are stubs; the delivery adapter prints synthetic IDs and is not a real sender. FOTO did **not** copy its live-send claims, synthetic leads, model-dependent safety decisions, or dry-run-as-contact behavior. No third-party source code was copied.

## Verification on September 8, 2026

- `bun test tests/outbound-model.test.ts tests/outbound-storage.test.ts tests/workbench.test.ts`: **99 passing tests / 16,856 assertions**. Includes 1,000 varied deterministic workflow scenarios plus 1,000 changed-draft approval checks; these are not 1,000 human end-to-end sessions.
- `npx tsc --noEmit`, scoped ESLint, and `npm run build` passed.
- Browser workflow: **43 checks** for campaign setup, prospect creation, draft/edit/reapproval, intercepted mailto, manual outcomes, follow-up, suppression, actual IndexedDB CAS, and duplicate suppression. Additional **11 checks** exercised quoted CSV upload, dirty-state preservation, remote changes, clipboard API handoff, and stale-tab suppression. Actual OS mail delivery and real clipboard permissions are not certified by the intercepted test.
- Desktop 1440 px and mobile 390 px inspected, including the campaign dialog. No horizontal page overflow or fresh console errors in the project-scoped QA session. Standard sans-serif typography extends to the shell on this route.
- Fixtures use `example.test` addresses in an isolated browser. No messages were sent and no real prospect list was imported.

Browser scripts: `scripts/qa/outbound-browser.js` and `scripts/qa/outbound-edge-browser.js`. Run with gstack `eval` in an isolated empty local browser only; scripts refuse a real/populated desk. Reports are `globalThis.fotoOutboundQA` and `globalThis.fotoOutboundEdgeQA`. The edge script expects a second QA CSV record named `QA Import Photographer`, company `QA Goods, Studio`, email `import@example.test`, notes `CSV quote test: "hello"`, and fresh source evidence.

## Not implemented / live sending prerequisites

There is no automatic market monitoring, web enrichment, LLM judge, unattended sequence sender, reply sync, email-provider delivery tracking, or verified activation/revenue attribution. The existing Gmail connector remains read-only and local lab cloud services remain disabled.

A live-send phase needs an explicitly selected sender/provider, appropriate outreach permissions, configured sender identity and domain, approved recipients and exact messages, provider-level idempotency and event deduplication, bounce/opt-out suppression, delivery readback, and tested reply handling. Do not broaden Gmail permissions or launch outreach automatically from this desk.
