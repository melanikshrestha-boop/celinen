# Provider boundaries and release gates

Research date: **2026-09-04**. Official documentation was checked on this date; rates, supported cameras, API availability, and account eligibility must be rechecked before release. This is an implementation contract and cost model, not a claim that the integrations below are production-ready. No services were provisioned or payments attempted for this research.

## 1. Ownership and execution boundaries

LensLabs owns project/asset identities, edit recipes, photographer decisions, consent, job state, audit events, client authorization, and reconciliation. Providers supply capabilities; a provider response is not authority to publish, charge, identify a person, overwrite a source, or change a photographer's selection.

| Boundary | Required behavior |
| --- | --- |
| Local originals | Read only by default. Persist identity/reconnect information separately from preview caches. Never represent cached previews as original RAW files. |
| AI proposal | Record model/engine version, scope, uncertainty and reversible changes; show before/after and require application. AI-written captions and roster matches remain suggestions until approved. |
| Cloud processing | A separate opt-in per project/workspace policy. Show files/derivatives leaving the device, destination/provider, retention and estimated cost before enqueueing. |
| External side effect | Distinct explicit actions for publish, invite, send invoice and collect payment. A local draft/preview is never a public client portal. |
| Background job | Durable job ID, asset/version fingerprint, attempt count, cancellation, bounded retries and resumable output. Retry cannot apply a change twice. |
| Tenant boundary | Resolve workspace and client grants server-side on every request. Filenames, email matches, AI outputs and provider metadata are not authorization. |

## 2. Stripe: two separate money flows

Stripe distinguishes software subscriptions from a Connect platform enabling merchants to receive their own customer payments. Its SaaS guide permits platform subscription fees and application fees, but the photographer's full payment volume is not LensLabs subscription revenue. [Stripe SaaS platform documentation](https://docs.stripe.com/connect/saas)

| Flow | Payer → recipient | LensLabs accounting |
| --- | --- | --- |
| LensLabs plan | Photographer/studio → LensLabs | SaaS subscription revenue; plan entitlements follow verified subscription state. |
| Photography invoice | Client → photographer's connected account | Photographer income. Store gross, fees, refunds and net separately; do not count it as LensLabs SaaS revenue. |
| Optional application fee | Connected payment → LensLabs | Distinct platform fee, only if explicitly configured/disclosed. Do not silently add one. |

**Proposed initial choice:** direct connected-account charges for a single photographer serving a client, subject to the actual account configuration and country/eligibility review. Charge type determines the fund flow, statement identity, and which balance bears refunds/chargebacks. Do not swap to destination charges or separate transfers as an implementation shortcut. [Stripe charge types](https://docs.stripe.com/connect/charges)

The repo currently has a direct platform client in `src/lib/stripe-connect.server.ts` and a separate Lovable-gateway client in `src/lib/stripe.server.ts`. Keep server credentials, account context, sandbox/live state and event destinations explicit. Do not infer that a gateway connection supports Connect operations. The existing Standard OAuth flow must not be silently migrated to Accounts v2: Stripe's new Billing/Connect guide states that existing Accounts v1 accounts are not supported by that integration path. [Stripe Billing with Connect](https://docs.stripe.com/connect/integrate-billing-connect)

### Webhook and retry gate

Stripe delivery is unordered and can be duplicated; live automatic retries can continue for three days. Platform-account events and connected-account events have different destinations/context. [Webhook delivery behavior](https://docs.stripe.com/webhooks#event-delivery-behaviors), [Connect webhooks](https://docs.stripe.com/connect/webhooks)

LensLabs requirements:

- Verify the signature over the raw body with the official SDK; bind connected `account` to our server-owned workspace mapping. Treat metadata as supplementary, never the primary tenant selector.
- Durably enqueue valid events before acknowledging. Use unique event receipts plus business-operation uniqueness; recording `invoice.paid` and its related successful charge must not create two income entries.
- Reconcile provider objects when needed rather than trusting event arrival order. Model partial refunds, disputes, voids and disconnects without deleting financial history.
- Transactionally update the ledger and receipt state; queue email/entitlement effects through an outbox. Retry failed work, expose terminal failures, and support replay.
- Reuse a stable operation key for uncertain outbound POST retries. A provider idempotency key is not our permanent ledger key: Stripe may prune keys after at least 24 hours and can replay the first response, including an error. [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)

**Observed code gate, not a live incident claim:** `src/routes/api/public/stripe/connect-webhook.ts` currently handles both `invoice.paid` and `charge.succeeded` using different object IDs, selects a metadata user ID before connected-account lookup, does not inspect database result errors consistently, and returns success after caught handler failure. Before real money: prove no double income, no cross-tenant posting and no lost retry with duplicate/out-of-order events, database outages and replay fixtures. A successful Checkout redirect alone must never grant paid status.

## 3. LibRaw is a decoder, not the editing product

LibRaw extracts sensor data, decode metadata and embedded previews; it also provides basic conversion, but its authors explicitly place production-quality rendering outside its core scope. It offers LGPL 2.1 or CDDL 1.0 licensing. This is not a blanket conclusion about shipping a particular native/WASM binary: review the chosen version, modifications, linked dependencies, notices and distribution obligations. [LibRaw purpose and licensing](https://www.libraw.org/about)

The current `src/lib/imaging.ts` scans RAW files for an embedded JPEG; `package.json` does not declare LibRaw. Therefore the current path is **embedded-preview review**, not verified full-resolution RAW development. Do not advertise RAW sensor recovery, camera color fidelity or Lightroom-equivalent rendering from that path.

Release requirements:

- Pin the decoder/build features and record their hash. Verify each camera + firmware + compression/bit-depth combination with real fixtures; a camera name on a library list is necessary evidence, not proof our build handles every mode. LibRaw's published list is explicitly conditional on compiled features. [LibRaw supported cameras](https://www.libraw.org/supported-cameras)
- Separate fast embedded-preview ingest from on-demand full RAW decode. Report which representation is being shown/exported, including preview dimensions.
- Define our rendering pipeline: orientation, white balance, black/white levels, demosaic, working/output color spaces, camera profile, highlight handling, noise and output encoding. Compare against approved reference renders.
- Test malformed/truncated files in a sandbox, cancellation, memory ceilings, unusual pixel dimensions and missing previews. Unsupported files retain their original identity and a recoverable error; never fabricate a successful render.
- Keep originals immutable; recipes, source fingerprints and versioned rendered exports are separate assets. A decoder upgrade must not silently rerender delivered work.

## 4. Browser filesystem limits

The File System Access API accesses user-selected files/folders under browser permission controls; modifying disk files needs write permission. Support must be feature-detected, with file input/download fallbacks. It does not authorize broad Desktop/Documents traversal merely because a user opened LensLabs. [Chrome File System Access documentation](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)

Do not assume all permissions expire on tab close or always persist: Chrome's newer flow can offer persistent permission, handles can be stored in IndexedDB, and users can revoke access. Check permission and source availability at use time; provide **Reconnect originals** without discarding picks or edit recipes. [Chrome persistent file permissions](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api)

Gate the advertised browser/OS matrix with denied/revoked access, removed drives, moved folders, same-name files, browser restart, private mode and storage exhaustion. A handle is not a backup. Browser cache is not an archival promise. Desktop-only capabilities such as dependable long-running ingest/file watching require a separately tested native agent; do not silently claim them from a web tab.

## 5. IPTC/XMP interoperability

Use the official **IPTC Photo Metadata 2025.1** property definitions and machine-readable technical reference. Keep descriptive metadata, rights and develop settings distinct. [IPTC standard and reference resources](https://iptc.org/standards/photo-metadata/iptc-standard/)

Minimum supported mapping, when exported:

| LensLabs meaning | XMP property / value shape |
| --- | --- |
| Photographer | `dc:creator` / ordered names |
| Caption | `dc:description` / language alternative |
| Headline | `photoshop:Headline` / text |
| Keywords | `dc:subject` / unordered text collection |
| Copyright notice | `dc:rights` / language alternative |
| Credit line | `photoshop:Credit` / text |
| Content creation date | `photoshop:DateCreated` / date, preserving known precision/offset |
| Approved names of people shown | `Iptc4xmpExt:PersonInImage` / unordered names |
| Accessibility description | `Iptc4xmpCore:AltTextAccessibility` / language alternative |

These mappings follow the [2025.1 specification](https://www.iptc.org/std/photometadata/specification/IPTC-PhotoMetadata-2025.1.html). A jersey OCR result is not a verified person's name. Store number, team, roster version, confidence and confirmation separately until a user approves identity/caption output.

Current `buildXmpSidecar` writes a small Camera Raw setting/rating subset; it is not general IPTC round-trip support. Release gate: namespace-aware XML parsing, safe serialization, preservation of unknown fields, Unicode/multi-value/language-alt fixtures, original capture-time preservation, and non-destructive merge/conflict UX. Reopen exported JPEG/TIFF/XMP in actual supported Photo Mechanic and Lightroom versions and compare values. Declare exact supported settings; never promise pixel-identical rendering merely because another app reads a sidecar.

## 6. WCAG 2.2 AA is a tested target

The conformance target is complete supported workflows at WCAG 2.2 AA, not a passing automated scan. Test keyboard navigation/no traps, focus visibility, screen-reader names/status updates, color-independent verdicts, text/non-text contrast, zoom/reflow and errors. [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)

For this product, specifically test unobscured focus under the filmstrip/chat, alternatives to crop/selection dragging, sufficient target size or spacing, accessible authentication and avoiding redundant client entry. These include criteria added in 2.2; minimum pointer target size is 24×24 CSS px subject to defined exceptions. [W3C changes in 2.2](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/)

Release evidence must include keyboard-only import→review→edit→export and lead→booking→portal flows; screen-reader checks; status announcements that do not flood on 3,000 assets; virtualized-grid focus retention; and no global single-key shortcuts while typing. Preserve the Lovable layout while correcting access failures. Do not display a conformance badge before the full scoped evaluation passes.

## 7. SoccerNet: research evidence, not permission or a quality claim

The SoccerNet FAQ explicitly excludes commercial use of its dataset and says algorithm licenses vary. Do not ship training data, weights, clips or a commercially derived feature solely because a repository can be downloaded. Require rights review covering the specific data, code, weights and intended use, or collect/licence our own commercial corpus. [SoccerNet FAQ](https://www.soccer-net.org/faq)

Its jersey task uses player **tracklets**, with numbers 1–99 and a not-visible class; blur, resolution and intermittent visibility are known difficulties. Its accuracy metric does not directly prove single-photo jersey OCR or verified player identity. [SoccerNet jersey task](https://www.soccer-net.org/tasks/jersey-number-recognition)

The action-spotting benchmark concerns timestamps for 17 event classes in broadcast soccer videos. It is not a benchmark for choosing a photographer's best still, preserving creative blur, or understanding every sport. **Inference:** transferring its results to sideline RAW photos, other sports or creative preference needs a separate evaluation. [SoccerNet action spotting](https://www.soccer-net.org/tasks/action-spotting)

Sports-AI release gate: consented/licensed still-photo holdout sets split by event, photographer and camera; low-light/motion/occlusion subsets; roster/date/team disambiguation; calibrated abstention; and human review. Report keep-worthy-frame recall, false-reject rate, burst representative agreement and per-subgroup jersey precision/coverage separately. “90%” must specify task, denominator, holdout and uncertainty; 90% generic accuracy or an AGI claim is not an acceptance test. Do not auto-delete originals or train on client shoots by default.

## 8. Cost assumptions, not a price quote

No provider price or account-specific contract has been verified for this plan. Populate prices only after choosing region, currency, billing mode, retention, processing hardware/model and a dated provider quote/rate card. No unlimited-cloud promise is justified by these assumptions.

**Illustrative monthly workloads — chosen planning inputs, not observed customer averages:** decimal MB/GB; 35 MB source RAW, 0.4 MB review derivative, 8 MB final JPEG; one derivative per imported photo; originals remain local by default; cloud finals/previews retained three months once that feature exists. Counts exclude replicas, backups, metadata, logs, thumbnails beyond the one assumed derivative and failed/repeated exports.

| Profile | Seats; shoots/month × photos | Photos/month | Local source volume | New preview volume | Assumed delivered share; new final volume |
| --- | --- | ---: | ---: | ---: | --- |
| Portrait solo | 1; 4 × 600 | 2,400 | 84 GB | 0.96 GB | 20%; 3.84 GB |
| Sports solo | 1; 8 × 3,000 | 24,000 | 840 GB | 9.6 GB | 10%; 19.2 GB |
| Small studio | 3; 12 × 1,500 | 18,000 | 630 GB | 7.2 GB | 20%; 28.8 GB |

Under these assumptions, steady-state three-month cloud preview+final storage would be **14.4 / 86.4 / 108 GB**, respectively, before replicas/backups. If finals are downloaded twice, final-download traffic is **7.68 / 38.4 / 57.6 GB/month**, before gallery browsing. Optional one-month cloud-original retention would add **84 / 840 / 630 GB**. Actual retention billing must use byte-hours, not blindly multiply a partial first month.

Use a scenario calculator, not a hard-coded “cost per photo”:

```text
monthly cost = byte-months × storage rate
             + delivered bytes × applicable transfer rate
             + PUT/GET/list/transform operations × operation rates
             + decode/inference CPU/GPU seconds × compute rates
             + metered model image/token units × selected model rates
             + database, auth, queue, email, monitoring, backup and support costs
             + platform-borne payment, refund, dispute and currency-conversion costs
```

Model cloud-AI routing at **0%, 1% and 10%** of imports (not promised achievable rates), then multiply by retries, multi-view/before-after requests and actual model metering. Local analysis avoids a cloud inference bill for that pass but still consumes user CPU, memory, battery and time. Benchmark those costs and disclose them.

For video, build a separate duration/bitrate/transcode model: an assumed two-hour 100 Mb/s source is 90 GB before proxies. The photo workload above does not price video, RAW archival, generative edits or egress-heavy client traffic.

**Cost release gate:** measure p50/p95 job cost on these workloads and a 2× burst; include failed/cancelled/retried jobs; per-workspace concurrency and spend caps; show expected upload/processing costs; pause paid work before budget overrun; retain recoverable job state. Verify the actual account's rates immediately before setting plan allowances. Payment processing fees and photographers' payment volume must never be blended into subscription margin invisibly.

## 9. Go-live evidence checklist

- [ ] Decoder version/features/license review and real camera-mode fixture matrix.
- [ ] Original-file integrity, source reconnect, storage-pressure and job-recovery tests.
- [ ] Approved export/metadata round trips in supported external applications.
- [ ] Licensed model/data inventory and honest sports/creative-quality holdout report.
- [ ] Tenant-isolation tests across client portal, storage links and all provider callbacks.
- [ ] Stripe sandbox replay/outage/refund/dispute tests and reconciled integer-minor-unit ledgers.
- [ ] Separate SaaS entitlements, photographer invoices and platform-fee accounting.
- [ ] WCAG 2.2 AA scoped manual and automated evaluation, with unresolved findings visible.
- [ ] Measured workload costs, current rate sources, user-facing limits and spend controls.

Unchecked gates block the corresponding public claim or external side effect; they do not block local draft/review work that clearly labels its limitations.
