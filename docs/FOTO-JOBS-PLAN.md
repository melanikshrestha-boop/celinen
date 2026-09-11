# FOTO Jobs: game-night workflow plan

Status: requested future work, not an implementation or launch claim. Captured September 8, 2026.

The current priority is **finish Develop color grading, histogram controls, grain, and lighting-aware film-look adjustments before building this CRM**. This document preserves the next product direction without changing routes, records, labels, or customer data now. See [Develop sprint](FOTO-DEVELOP-SPRINT.md) and [adaptive-tone research](FOTO-ADAPTIVE-TONE-NOTES.md).

## Product direction

Put **Jobs**, not Clients, at the center of the business workspace. An organization has contacts; a job is one game, picture day, or tournament. The photographer should move from an inquiry to booking, selects, delivery, sales, and rebooking without rebuilding the context at each step.

The user's intended positioning is “HoneyBook books the job, Zenfolio sells pictures, we run game night end to end.” This is the user's product hypothesis, **not a verified account of either competitor's capabilities**. Do not publish it as a factual competitor comparison without fresh primary-source research. Likewise, helping creatives earn more is the goal, not a guaranteed income outcome.

This is a Jobs-first information model, not a request to delete the existing client database, rename stored `shoot` IDs, replace Studio, or turn every contact into an invented job.

## Requested records

Field names below capture the requested future domain. They are not existing API signatures. Stable IDs, account ownership, timestamps, revisions, and source receipts will be necessary implementation fields.

| Record           | Requested fields and relationships                                                                                                                                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization     | `name`, `type`, `logo`, `billing_address`, `notes`, `default_rate_card`. Examples: USC Athletics, a high school, a club, or a media organization.                                                                                                                                                     |
| Contact          | `name`, `role`, `email`, `phone`, `org_id`, preferred SMS/email channel. Roles include athletic director, coach, sports information director (SID), editor, and booster.                                                                                                                              |
| Job              | `title`, `org_id`, `sport`, home/away, `venue`, `kickoff_at`, `shoot_at`, `heroes_deadline_at`, `gallery_deadline_at`, `stage`, `cover_asset_id`, `gallery_id`, `amount_quoted`, `amount_paid`, `balance_due`, `next_action`, `assigned_to`. One job represents one game, picture day, or tournament. |
| Package          | Start with **Sideline + heroes same-night**, **Full gallery 24h**, and **Team day + parent store**. Package selection proposes deliverables/deadlines; the photographer reviews them for the actual job.                                                                                              |
| SmartFile        | Branded proposal, contract, deposit invoice, electronic signature, and payment in one client-facing booking flow, linked to the job.                                                                                                                                                                  |
| Roster, optional | `athlete_name`, `jersey`, `team`, `guardian_email`, `qr_code`, `face_id`. Never require a face record merely to create a job or sell a digital photo.                                                                                                                                                 |
| Gallery          | Job link, optional FaceFind index, PIN/roster/public privacy choice, and products.                                                                                                                                                                                                                    |
| Sale             | Parent/organization buyer, line items, total, `stripe_id`, and fulfillment. Digital delivery is the first priority.                                                                                                                                                                                   |
| SocialPost       | A starred frame prepared for Instagram Story, X, or TikTok; destination, `status`, and `posted_at`. A prepared/exported asset is not a published post.                                                                                                                                                |
| Activity         | Job timeline including signed, heroes sent, gallery live, Story posted, and paid, with actor, time, and an actual receipt or explicitly manual source.                                                                                                                                                |

“Heroes” means the small set of strongest same-night selects, separate from the complete gallery. Keep kickoff, photographer call time, heroes deadline, and full-gallery deadline distinct. Store unambiguous timestamps and a display timezone; do not silently shift game-night deadlines when the viewer travels.

## Pipeline and next actions

The requested sequence is:

`Lead → Quoted → Booked → Shoot → Heroes out → Gallery live → Sold/Paid → Archive`

| Stage        | Starter next action                                             |
| ------------ | --------------------------------------------------------------- |
| Lead         | Send SmartFile                                                  |
| Quoted       | Nudge the decision-maker                                        |
| Booked       | Confirm call time                                               |
| Shoot        | Open cull and select heroes                                     |
| Heroes out   | Send the heroes link to the SID                                 |
| Gallery live | Notify the eligible parent audience                             |
| Sold/Paid    | Ask for a review or rebooking                                   |
| Archive      | Retain the job and its history; offer an explicit rebook action |

These are editable suggestions, not automatic sends. Keep stage and next action separately editable and dated. Show who owns the next action. A sent proposal does not prove a booking; a gallery going live does not prove a sale; a sale does not prove a zero job balance. The combined **Sold/Paid** label needs a clear payment substatus in implementation so it does not conceal unpaid or refunded work.

## Workspace and detail layout

Use a compact, aligned product interface with the shared sans-serif font, subtle left selection, and accessible stage pills that work without color alone. Do not add decorative dividers or large dashboard cards merely to fill space. Remove misleading device-count/sync copy such as “4 saved on device” when it implies a sync guarantee the product cannot provide. Any storage status must accurately distinguish local save from confirmed remote synchronization.

The primary views are:

- **Board:** Kanban organized by the requested stages, with job cover, organization, deadline, and next action.
- **Tonight:** jobs with kickoff in the next 24 hours and a clear heroes countdown. Show overdue unfinished delivery work separately rather than hiding it when kickoff passes.
- **Money:** jobs with a positive outstanding balance. Distinguish quoted amounts, collected payments, refunds, and gallery sales.

Table columns, in the requested order: **Job · Sport · Org · Kickoff · Heroes due · Gallery · $ · Stage · Next action · Cover**. Keep the main job identity readable on narrow screens; secondary fields can move to details without losing access.

Job detail tabs:

1. Overview
2. SmartFile
3. Roster
4. Cull & selects
5. Gallery & FaceFind
6. Sales
7. Social
8. Activity

SmartFile actions: **Client preview**, **Send**, **Reminder**, **Mark signed**. A manually marked signature must remain visibly distinct from a verified electronic-signature receipt.

Gallery actions: **Publish**, **Copy parent link**, and the requested parent-notification action, described by the user as “SMS blast.” The actual send flow must show the intended, eligible audience and exact message before confirmation. Do not make public publishing or bulk messaging a side effect of changing stage.

## Completion journey

The target acceptance scenario is a real, consenting test job, not seeded success counters:

1. An athletic director inquires. Create the organization/contact or link existing records without duplicates.
2. Prepare a package-based SmartFile, preview it as the client, then explicitly send it.
3. Receive a verifiable signature and deposit receipt; the job becomes Booked under the chosen booking policy.
4. Confirm call time. Ingest actual originals, cull, and star the heroes without altering source bytes.
5. Deliver the heroes by their deadline and retain the destination receipt.
6. Publish the approved gallery under its selected privacy policy. Optionally prepare and explicitly publish a permitted social asset.
7. A parent uses the permitted search or roster flow, selects a photo, and completes a real test purchase.
8. The sale appears once in Sales, fulfillment is confirmed, and payment/refund state reconciles correctly.
9. Record settlement of the job's remaining balance, ask for a review/rebook, and archive without erasing history.

Every stage must survive reload, interrupted requests, duplicate callbacks, retries, and account switches without invented status or double charging/sending. “Link copied,” “email client opened,” and “file exported” are distinct outcomes, not delivery or payment confirmation.

## Integration and privacy gates

These are proposed engineering release gates, not a claim that provider integrations, legal requirements, or consent workflows are already satisfied.

| Surface                  | Gate before claiming it works                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local data and migration | Stable account-scoped IDs, per-record revisions, transactional saves, explicit conflict handling, tested backup/recovery, and merge-only import. Preserve historical contacts, bookings, photos, edit documents, invoice/payment records, and original IDs. Preview proposed mappings before a guided migration; never silently move unassigned device records into an account.                           |
| SmartFile                | Server-controlled access, explicit recipient confirmation, actual provider delivery/signature receipts, expiration/revocation where supported, and replay-safe callbacks. Manual “signed” status records its source and cannot masquerade as provider verification. Review signature and retention requirements for launch jurisdictions with qualified counsel.                                          |
| Payments and Money       | Integer minor units and explicit currency; verified processor receipts or clearly labeled manual records. Compute balance from the agreed charge and reconciled payments/refunds; do not force it to zero when moving stage. Prevent duplicate charges and reconcile uncertain requests. An uncollected quote or projected parent sale is not earnings.                                                   |
| Gallery                  | Permission checks on originals, previews, purchase downloads, and roster data; test public, PIN, and roster modes as separate policies. Test revocation and understand any already-issued download access. A PIN is not a substitute for authorization to private athlete/guardian records.                                                                                                               |
| Roster and FaceFind      | Optional and off by default. Prefer roster/jersey/QR discovery without face processing first. Before any face index, establish the appropriate permissions, clear purpose, access boundaries, retention/deletion process, and jurisdiction-specific review, especially for minors. Treat matches as fallible suggestions, never identity proof. Do not make a face index or guardian contact list public. |
| Parent notifications     | Explicit channel preferences and eligible audience; opt-out/suppression, rate limits, appropriate timing, secure contact handling, and a reviewed send confirmation. A guardian email on a roster is not automatically permission to send promotions. Verify actual delivery/failure receipts; retries must not duplicate a campaign.                                                                     |
| Social                   | Real destination authorization, valid media/frame preparation, approved public-use rights, explicit publish confirmation, token expiry/disconnect handling, provider readback, and uncertain-outcome reconciliation. Instagram Stories, X, and TikTok must each be proven independently; do not substitute logos or successful OAuth for an actual post.                                                  |
| Activity                 | Append-only attributable events with source and receipt; no fabricated “paid,” “signed,” “sent,” or “posted” rows. Corrections reference prior events rather than silently rewriting them.                                                                                                                                                                                                                |

The requested `face_id`, `stripe_id`, and destination names reserve places in the future model. Their presence does not prove any corresponding connection or permission is available. No real messages, contracts, charges, or public posts are authorized by this planning document.

## Proposed sequencing after Develop

1. **Jobs foundation:** organization/contact/job relationships, next actions, Board/Tonight/Money, safe local persistence and export, guided linking of existing records, and accurate manual activity.
2. **Booking:** package templates, SmartFile preview, then verified signature/payment integrations behind explicit setup and launch gates.
3. **Game-night delivery:** connect existing ingest/cull/hero selection to the job, deadlines, privacy-tested gallery publishing, and attributable receipts.
4. **Digital sales:** verified checkout, gallery download fulfillment, parent/organization receipts, and reconciliation into Sales/Money.
5. **Optional discovery and distribution:** roster/QR first; reviewed FaceFind separately; permitted parent notifications and independently verified social destinations.

Each increment must expose only genuinely available actions. This sequence is a proposed implementation breakdown; it does not override the user's color-grading-first priority.

## Explicit deferrals

- A Dubsado-style freeform canvas.
- Multiple brands under one workspace.
- Deep QuickBooks integration.
- Print-lab APIs and automated lab fulfillment.
- District commissions.
- A full website builder.
- Wedding-specific aliases or workflows.
- Player cards until the basic game-night and digital-sales journey works.

Keep guided migration, optional roster/QR, and digital-first sales in scope for the future Jobs build. Keep the existing Studio interface intact under [AGENTS.md](../AGENTS.md).

## Existing context to inspect before implementation

- [Projects and business workspace](PROJECTS-AND-BUSINESS-WORKSPACE.md): existing terminology, identity preservation, local client data, and recorded earnings.
- [Business publishing](BUSINESS-PUBLISHING.md): existing delivery/publishing boundaries and previously documented unverified provider work. Recheck the implementation before reusing historical verification claims.
- [Develop sprint](FOTO-DEVELOP-SPRINT.md): source preservation, import/recovery, and current editing scope.

This plan adds no current functionality and does not migrate or delete any customer records.
