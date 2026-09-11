import { z } from "zod";

const minor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const stamp = z.string().datetime();
export const connectedRefundReceiptSchema = z
  .object({
    id: z.string(),
    amountMinor: minor,
    createdAt: stamp,
    status: z.enum(["succeeded", "pending", "failed"]),
  })
  .strict();
export type ConnectedRefundReceipt = z.infer<typeof connectedRefundReceiptSchema>;
export const connectedPaymentReceiptSchema = z
  .object({
    id: z.string(),
    accountId: z.string(),
    chargeId: z.string(),
    paymentIntentId: z.string().nullable(),
    invoiceId: z.string().nullable(),
    stripeInvoiceId: z.string().nullable(),
    shootId: z.string().nullable(),
    clientId: z.string().nullable(),
    sourceKind: z.enum(["invoice", "deposit", "gallery", "unclassified"]),
    currency: z.string().regex(/^[a-z]{3}$/),
    amountMinor: minor,
    collectedMinor: minor,
    refundedMinor: minor,
    netMinor: minor,
    status: z.enum(["paid", "pending", "failed", "refunded"]),
    createdAt: stamp,
    paidAt: stamp.nullable(),
    dateBasis: z.enum(["balance-transaction", "invoice-payment", "unknown"]),
    description: z.string(),
    livemode: z.boolean(),
    disputed: z.boolean(),
    linkStatus: z.enum(["linked", "unlinked"]),
    refunds: z.array(connectedRefundReceiptSchema),
    refundHistoryComplete: z.boolean(),
    legacyObjectIds: z.array(z.string()),
    warnings: z.array(z.string()),
  })
  .strict();
export type ConnectedPaymentReceipt = z.infer<typeof connectedPaymentReceiptSchema>;
export interface ConnectedInvoiceReceipt {
  id: string;
  stripeInvoiceId: string;
  createdAt: string;
  issuedAt: string | null;
  dueDate: string | null;
  amountMinor: number;
  outstandingMinor: number;
  currency: string;
  status: "draft" | "open" | "paid" | "void" | "uncollectible";
  shootId: string | null;
  clientId: string | null;
  clientName: string | null;
  livemode: boolean;
  hostedInvoiceUrl: string | null;
}
export interface ConnectedEarningsSnapshot {
  connection: "connected" | "not-connected" | "unavailable";
  accountId: string | null;
  complete: boolean;
  fetchedAt: string;
  receipts: ConnectedPaymentReceipt[];
  invoices: ConnectedInvoiceReceipt[];
  unmatchedCount: number;
  warnings: string[];
}
export interface FinanceInvoiceBinding {
  id: string;
  user_id: string;
  stripe_invoice_id: string | null;
  shoot_id: string | null;
  client_id: string | null;
}

const objectId = (value: unknown): string | null =>
  typeof value === "string"
    ? value
    : value && typeof value === "object" && "id" in value && typeof value.id === "string"
      ? value.id
      : null;
type ProviderKey =
  | "id"
  | "object"
  | "metadata"
  | "managed_payments"
  | "plan"
  | "lenslabs_source"
  | "lenslabs_user_id"
  | "lenslabs_invoice_id"
  | "lenslabs_shoot_id"
  | "payment_intent"
  | "payment"
  | "invoice"
  | "charge"
  | "created"
  | "currency"
  | "amount"
  | "amount_captured"
  | "amount_refunded"
  | "status"
  | "paid"
  | "captured"
  | "balance_transaction"
  | "status_transitions"
  | "paid_at"
  | "disputed"
  | "description"
  | "livemode"
  | "parent"
  | "type"
  | "subscription"
  | "finalized_at"
  | "due_date"
  | "total"
  | "amount_remaining"
  | "hosted_invoice_url";
type ProviderRecord = Record<string, unknown> & Partial<Record<ProviderKey, unknown>>;
const record = (value: unknown): ProviderRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as ProviderRecord) : {};
const epoch = (value: unknown): string | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value < 253402300799
    ? new Date(value * 1000).toISOString()
    : null;
const providerMinor = (value: unknown): number => minor.parse(value);
/** Stripe retains two decimal input places for zero-decimal ISK/UGX.
 * Normalize exactly to ISO minor units used by Intl and the Money domain. */
export function stripeAmountToMinor(value: unknown, currency: string): number {
  const amount = providerMinor(value);
  if (currency !== "isk" && currency !== "ugx") return amount;
  if (amount % 100 !== 0) throw new Error("Stripe currency amount is not an exact minor unit.");
  return amount / 100;
}
const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Current provider objects, not arrival-ordered webhook deltas. One Charge is
 * one payment. Refund IDs remain separately dated, never re-dated to the sale.
 * netMinor is after refunds BEFORE processor fees, tax and other costs. */
export function normalizeConnectedPayments(input: {
  accountId: string;
  ownerId: string;
  charges: unknown[];
  refunds: unknown[];
  invoicePayments: unknown[];
  ownedInvoices: FinanceInvoiceBinding[];
  ownedShootIds: string[];
  refundsComplete: boolean;
}): { receipts: ConnectedPaymentReceipt[]; ignored: number; warnings: string[] } {
  if (!/^acct_[A-Za-z0-9]+$/.test(input.accountId))
    throw new Error("A connected account is required.");
  const shoots = new Set(input.ownedShootIds),
    invoices = input.ownedInvoices.filter((i) => i.user_id === input.ownerId);
  const refundMap = new Map<string, ProviderRecord>();
  for (const value of input.refunds) {
    const r = record(value);
    if (r.object === "refund" && typeof r.id === "string") refundMap.set(r.id, r);
  }
  const chargeMap = new Map<string, ProviderRecord>();
  let ignored = 0;
  for (const value of input.charges) {
    const c = record(value);
    if (c.object === "charge" && typeof c.id === "string") chargeMap.set(c.id, c);
    else ignored++;
  }
  const receipts: ConnectedPaymentReceipt[] = [],
    warnings: string[] = [];
  for (const c of chargeMap.values()) {
    try {
      const metadata = record(c.metadata);
      // The platform's own checkout is not a photographer's client payment.
      if (
        metadata.managed_payments === "true" ||
        metadata.plan ||
        metadata.lenslabs_source === "subscription"
      ) {
        ignored++;
        continue;
      }
      if (metadata.lenslabs_user_id && metadata.lenslabs_user_id !== input.ownerId) {
        ignored++;
        warnings.push("A payment with conflicting owner metadata was excluded.");
        continue;
      }
      const chargeId = text(c.id),
        paymentIntentId = objectId(c.payment_intent);
      if (!/^ch_[A-Za-z0-9]+$/.test(chargeId)) throw new Error("Invalid charge ID.");
      const payments = input.invoicePayments.map(record).filter((p) => {
        const payment = record(p.payment);
        return (
          (paymentIntentId && objectId(payment.payment_intent) === paymentIntentId) ||
          objectId(payment.charge) === chargeId
        );
      });
      const stripeIds = new Set(
        payments.map((p) => objectId(p.invoice)).filter((id): id is string => !!id),
      );
      const matched = invoices.filter(
        (i) =>
          stripeIds.has(i.stripe_invoice_id ?? "") ||
          (metadata.lenslabs_invoice_id && i.id === metadata.lenslabs_invoice_id),
      );
      const invoice = matched.length === 1 && stripeIds.size <= 1 ? matched[0]! : null;
      const claimedShoot = text(metadata.lenslabs_shoot_id) || invoice?.shoot_id || null;
      const conflict =
        !!(
          invoice?.shoot_id &&
          metadata.lenslabs_shoot_id &&
          invoice.shoot_id !== metadata.lenslabs_shoot_id
        ) ||
        !!(invoice && stripeIds.size === 1 && !stripeIds.has(invoice.stripe_invoice_id ?? "")) ||
        matched.length > 1 ||
        stripeIds.size > 1;
      const shootId = !conflict && claimedShoot && shoots.has(claimedShoot) ? claimedShoot : null;
      const createdAt = epoch(c.created);
      if (!createdAt) throw new Error("Invalid payment date.");
      const currency = z
        .string()
        .regex(/^[a-z]{3}$/)
        .parse(c.currency);
      const amountMinor = stripeAmountToMinor(c.amount, currency),
        captured = stripeAmountToMinor(c.amount_captured, currency),
        refundedMinor = stripeAmountToMinor(c.amount_refunded, currency);
      if (captured > amountMinor || refundedMinor > captured)
        throw new Error("Invalid captured/refunded amount.");
      const paid = c.status === "succeeded" && c.paid === true && c.captured === true;
      const collectedMinor = paid ? captured : 0;
      const status =
        c.status === "failed"
          ? "failed"
          : !paid
            ? "pending"
            : refundedMinor === collectedMinor && collectedMinor > 0
              ? "refunded"
              : "paid";
      const refunds: ConnectedRefundReceipt[] = [];
      for (const r of refundMap.values())
        if (objectId(r.charge) === chargeId) {
          const date = epoch(r.created);
          if (!date || r.currency !== currency) throw new Error("Invalid refund date or currency.");
          refunds.push({
            id: text(r.id),
            amountMinor: stripeAmountToMinor(r.amount, currency),
            createdAt: date,
            status:
              r.status === "succeeded"
                ? "succeeded"
                : r.status === "failed" || r.status === "canceled"
                  ? "failed"
                  : "pending",
          });
        }
      refunds.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      const refundTotal = refunds
        .filter((r) => r.status === "succeeded")
        .reduce((sum, r) => sum + r.amountMinor, 0);
      const refundHistoryComplete = input.refundsComplete && refundTotal === refundedMinor;
      const balance = record(c.balance_transaction),
        invoicePayment = payments.find((p) => p.status === "paid");
      const balanceDate = epoch(balance.created),
        invoiceDate = epoch(record(invoicePayment?.status_transitions).paid_at);
      const paidAt = paid ? (balanceDate ?? invoiceDate) : null;
      const rowWarnings: string[] = [];
      if (!shootId)
        rowWarnings.push(
          conflict
            ? "Conflicting shoot references; not included in shoot earnings."
            : "Link to an owned shoot before including in earnings.",
        );
      if (paid && !paidAt)
        rowWarnings.push("Payment posting date is unavailable; period totals are incomplete.");
      if (!refundHistoryComplete)
        rowWarnings.push("Refund history is incomplete; period net cannot be confirmed.");
      if (c.disputed === true)
        rowWarnings.push("Payment is disputed; dispute settlement is not reconciled here.");
      receipts.push(
        connectedPaymentReceiptSchema.parse({
          id: `${input.accountId}:${chargeId}`,
          accountId: input.accountId,
          chargeId,
          paymentIntentId,
          invoiceId: invoice?.id ?? null,
          stripeInvoiceId: invoice?.stripe_invoice_id ?? null,
          shootId,
          clientId: invoice?.client_id ?? null,
          sourceKind: invoice
            ? "invoice"
            : metadata.lenslabs_source === "deposit"
              ? "deposit"
              : metadata.lenslabs_source === "gallery"
                ? "gallery"
                : "unclassified",
          currency,
          amountMinor,
          collectedMinor,
          refundedMinor,
          netMinor: Math.max(0, collectedMinor - refundedMinor),
          status,
          createdAt,
          paidAt,
          dateBasis: paidAt ? (balanceDate ? "balance-transaction" : "invoice-payment") : "unknown",
          description: text(c.description) || `Stripe payment ${chargeId}`,
          livemode: c.livemode === true,
          disputed: c.disputed === true,
          linkStatus: shootId ? "linked" : "unlinked",
          refunds,
          refundHistoryComplete,
          legacyObjectIds: [
            chargeId,
            ...(invoice?.stripe_invoice_id ? [invoice.stripe_invoice_id] : []),
            ...(paymentIntentId ? [paymentIntentId] : []),
          ],
          warnings: rowWarnings,
        }),
      );
    } catch {
      ignored++;
      warnings.push("A malformed provider payment was excluded; saved history is unchanged.");
    }
  }
  return { receipts, ignored, warnings: [...new Set(warnings)] };
}

/** Only explicitly owned FOTO invoices enter receivables; provider invoice paid
 * status does not create another payment row. */
export function normalizeConnectedInvoices(
  values: unknown[],
  bindings: FinanceInvoiceBinding[],
  ownerId: string,
  shootIds: string[],
  clientNames: Record<string, string>,
): ConnectedInvoiceReceipt[] {
  const rows: ConnectedInvoiceReceipt[] = [],
    seen = new Set<string>();
  for (const value of values) {
    const invoice = record(value),
      id = text(invoice.id);
    const binding = bindings.find((b) => b.user_id === ownerId && b.stripe_invoice_id === id);
    if (!binding || seen.has(id)) continue;
    // Subscription invoices belong to SaaS billing, not this client-invoice flow.
    if (record(invoice.parent).type === "subscription_details" || invoice.subscription) continue;
    const status = z.enum(["draft", "open", "paid", "void", "uncollectible"]).parse(invoice.status);
    const createdAt = epoch(invoice.created);
    if (!createdAt) throw new Error("Invalid invoice date.");
    const currency = z
      .string()
      .regex(/^[a-z]{3}$/)
      .parse(invoice.currency);
    rows.push({
      id: binding.id,
      stripeInvoiceId: id,
      createdAt,
      issuedAt: epoch(record(invoice.status_transitions).finalized_at),
      dueDate: epoch(invoice.due_date)?.slice(0, 10) ?? null,
      amountMinor: stripeAmountToMinor(invoice.total, currency),
      outstandingMinor:
        status === "open" || status === "uncollectible"
          ? stripeAmountToMinor(invoice.amount_remaining, currency)
          : 0,
      currency,
      status,
      shootId: binding.shoot_id && shootIds.includes(binding.shoot_id) ? binding.shoot_id : null,
      clientId: binding.client_id,
      clientName: binding.client_id ? (clientNames[binding.client_id] ?? null) : null,
      livemode: invoice.livemode === true,
      hostedInvoiceUrl:
        typeof invoice.hosted_invoice_url === "string" &&
        /^https:\/\/invoice\.stripe\.com\//.test(invoice.hosted_invoice_url)
          ? invoice.hosted_invoice_url
          : null,
    });
    seen.add(id);
  }
  return rows;
}
