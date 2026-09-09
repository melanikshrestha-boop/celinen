import type Stripe from "stripe";
import { z } from "zod";

export const invoiceDraftInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    client_id: z.string().uuid(),
    shoot_id: z.string().uuid(),
    amount: z.number().finite().positive().max(999999.99),
    description: z.string().trim().min(1).max(2000).default("Photography services"),
    due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((date) => {
        const parsed = new Date(`${date}T00:00:00Z`);
        return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === date;
      })
      .nullable()
      .optional(),
    expected_updated_at: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .refine(
    (value) => Math.abs(value.amount * 100 - Math.round(value.amount * 100)) < 1e-7,
    "Use an exact amount with at most two decimal places.",
  );
export type InvoiceDraftInput = z.infer<typeof invoiceDraftInputSchema>;
export const invoiceSendInputSchema = z
  .object({ id: z.string().uuid(), expected_updated_at: z.string().datetime({ offset: true }) })
  .strict();
export const pendingInvoicePrefix = "foto_pending:";
export function pendingInvoiceReservation(invoiceId: string, now: number): string {
  return `${pendingInvoicePrefix}${invoiceId}:${now}`;
}
export function isPendingInvoiceReservation(value: string | null): boolean {
  return !!value?.startsWith(pendingInvoicePrefix);
}

export interface InvoiceSendInput {
  id: string;
  ownerId: string;
  shootId: string;
  accountId: string;
  amount: number;
  currency: string;
  description: string;
  dueDate: string | null;
  email: string;
  clientName: string;
  stripeInvoiceId: string;
}
export type InvoiceStripeSender = Pick<Stripe, "customers" | "invoices" | "invoiceItems">;
export function verifiedInvoicePaymentUrl(
  invoice: Pick<Stripe.Invoice, "id" | "status" | "metadata" | "hosted_invoice_url">,
  expected: { stripeId: string; localId: string; ownerId: string },
): string {
  if (
    invoice.id !== expected.stripeId ||
    invoice.metadata?.["lenslabs_invoice_id"] !== expected.localId ||
    invoice.metadata?.["lenslabs_user_id"] !== expected.ownerId ||
    invoice.status !== "open" ||
    !invoice.hosted_invoice_url
  )
    throw new Error("The current invoice is not payable. Ask your photographer to review it.");
  const url = new URL(invoice.hosted_invoice_url);
  if (url.origin !== "https://invoice.stripe.com" || url.username || url.password)
    throw new Error("The current payment URL could not be verified.");
  return url.href;
}
/** Validate before claiming a durable send reservation as well as at the
 * provider boundary. Invalid input must not freeze an otherwise editable draft. */
export function validateInvoiceSend(input: InvoiceSendInput, now = Date.now()) {
  if (
    !/^acct_[A-Za-z0-9]+$/.test(input.accountId) ||
    !input.shootId ||
    !input.ownerId ||
    !input.id ||
    input.currency !== "usd" ||
    !z.string().email().safeParse(input.email).success
  )
    throw new Error("A valid shoot, client email and USD connected account invoice are required.");
  const amount = Math.round(input.amount * 100);
  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    amount > 99999999 ||
    Math.abs(input.amount * 100 - amount) > 1e-7
  )
    throw new Error("Invalid invoice amount.");
  const due = input.dueDate
    ? Math.floor(new Date(`${input.dueDate}T23:59:59Z`).getTime() / 1000)
    : null;
  if (due !== null && (!Number.isSafeInteger(due) || due <= now / 1000))
    throw new Error("Choose a future invoice due date.");
  return { amount, due };
}
/** Called only after an authenticated owner explicitly confirms the current
 * draft. The DB reservation predates any provider write and survives errors. */
export async function performInvoiceSend(
  input: InvoiceSendInput,
  stripe: InvoiceStripeSender,
  rememberProviderId: (stripeId: string) => Promise<void>,
  now = Date.now(),
) {
  const { amount, due } = validateInvoiceSend(input, now);
  const assertRecipient = (invoice: Pick<Stripe.Invoice, "customer_email">, afterSend = false) => {
    if (invoice.customer_email !== input.email)
      throw new Error(
        afterSend
          ? "Stripe returned a different recipient after the send request. Reconcile the invoice in Stripe before retrying; delivery is not assumed."
          : "The actual Stripe invoice recipient changed. Review the existing invoice before sending.",
      );
  };
  const opts = { stripeAccount: input.accountId, timeout: 10_000, maxNetworkRetries: 0 };
  const key = (operation: string) => ({
    ...opts,
    idempotencyKey: `foto:invoice:${input.id}:${operation}:v1`,
  });
  let providerId = input.stripeInvoiceId;
  if (isPendingInvoiceReservation(providerId)) {
    const parts = providerId.split(":"),
      started = Number(parts[2]);
    if (
      parts[1] !== input.id ||
      !Number.isSafeInteger(started) ||
      started > now ||
      now - started > 23 * 60 * 60_000
    )
      throw new Error(
        "This invoice has an uncertain older send attempt. Reconcile it in Stripe before retrying; nothing was resent.",
      );
    const customer = await stripe.customers.create(
      { email: input.email, name: input.clientName },
      key("customer"),
    );
    const created = await stripe.invoices.create(
      {
        customer: customer.id,
        collection_method: "send_invoice",
        auto_advance: false,
        ...(due ? { due_date: due } : { days_until_due: 14 }),
        description: input.description,
        metadata: {
          lenslabs_invoice_id: input.id,
          lenslabs_user_id: input.ownerId,
          lenslabs_shoot_id: input.shootId,
          lenslabs_source: "invoice",
          lenslabs_send_started: String(started),
          lenslabs_client_email: input.email,
        },
      },
      key("create"),
    );
    providerId = created.id;
    if (!/^in_[A-Za-z0-9]+$/.test(providerId))
      throw new Error("Stripe did not return an invoice ID.");
    await rememberProviderId(providerId);
  }
  if (!/^in_[A-Za-z0-9]+$/.test(providerId)) throw new Error("Invalid Stripe invoice reference.");
  let invoice = await stripe.invoices.retrieve(providerId, {}, opts);
  assertRecipient(invoice);
  const metadata = invoice.metadata ?? {};
  if (
    metadata["lenslabs_invoice_id"] !== input.id ||
    metadata["lenslabs_user_id"] !== input.ownerId ||
    metadata["lenslabs_shoot_id"] !== input.shootId ||
    metadata["lenslabs_client_email"] !== input.email
  )
    throw new Error(
      "Stripe invoice ownership, shoot or recipient binding does not match. Review the existing invoice before retrying.",
    );
  if (invoice.status === "void" || invoice.status === "uncollectible")
    throw new Error("This invoice cannot be sent.");
  if (invoice.status === "paid") return { invoice, delivery: "already-paid" as const };
  const started = Number(metadata["lenslabs_send_started"]);
  if (!Number.isSafeInteger(started) || started > now || now - started > 23 * 60 * 60_000)
    throw new Error(
      "An older issued invoice must be reconciled in Stripe before another email is attempted.",
    );
  if (invoice.status === "draft") {
    const customerId =
      typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
    if (!customerId) throw new Error("Stripe invoice has no customer.");
    await stripe.invoiceItems.create(
      {
        customer: customerId,
        invoice: providerId,
        amount,
        currency: "usd",
        description: input.description,
      },
      key("line"),
    );
    invoice = await stripe.invoices.retrieve(providerId, {}, opts);
    assertRecipient(invoice);
    if (invoice.total !== amount || invoice.currency !== "usd")
      throw new Error("Stripe invoice total changed; review it before sending.");
    invoice = await stripe.invoices.finalizeInvoice(
      providerId,
      { auto_advance: false },
      key("finalize"),
    );
  }
  // Finalization freezes customer_email. Check the returned finalized invoice,
  // closing a customer-email change between our draft read and finalization.
  assertRecipient(invoice);
  if (invoice.status !== "open" || invoice.total !== amount || invoice.currency !== "usd")
    throw new Error("The invoice is not ready to send.");
  const sent = await stripe.invoices.sendInvoice(providerId, {}, key("send"));
  assertRecipient(sent, true);
  if (sent.id !== providerId || (sent.status !== "open" && sent.status !== "paid"))
    throw new Error("Stripe did not confirm the invoice request.");
  return {
    invoice: sent,
    delivery: sent.livemode ? ("stripe-accepted" as const) : ("test-no-email" as const),
  };
}
