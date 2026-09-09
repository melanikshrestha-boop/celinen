import Stripe from "stripe";

export async function verifyConnectedEvent(
  body: string,
  signature: string | null,
  secret: string,
): Promise<Stripe.Event> {
  if (!secret || !signature || !body || new TextEncoder().encode(body).length > 2 * 1024 * 1024)
    throw new Error("Invalid webhook request.");
  return Stripe.webhooks.constructEventAsync(body, signature, secret, 300);
}
export interface InvoiceWebhookDependencies {
  resolveOwner(account: string): Promise<string | null>;
  retrieveInvoice(
    id: string,
    account: string,
  ): Promise<{
    id: string;
    status: string | null;
    metadata?: Record<string, string> | null;
    hosted_invoice_url?: string | null;
  }>;
  saveInvoice(
    owner: string,
    invoice: {
      id: string;
      status: "draft" | "sent" | "paid" | "void";
      hostedInvoiceUrl: string | null;
    },
  ): Promise<void>;
}
/** Payment rows are derived once from current connected-account charges by the
 * read adapter. This event mirror never emits invoice+charge duplicate income,
 * never trusts metadata to choose an owner, and never rewrites old ledger rows. */
export async function handleConnectedInvoiceEvent(
  event: { type: string; account?: string | undefined; data: { object: unknown } },
  dependencies: InvoiceWebhookDependencies,
): Promise<"ignored" | "updated"> {
  const account = event.account;
  if (!account || !/^acct_[A-Za-z0-9]+$/.test(account)) return "ignored";
  if (
    ![
      "invoice.paid",
      "invoice.payment_failed",
      "invoice.finalized",
      "invoice.voided",
      "invoice.marked_uncollectible",
      "invoice.updated",
      "invoice.sent",
    ].includes(event.type)
  )
    return "ignored";
  const object = event.data.object;
  const id =
    object && typeof object === "object" && "id" in object && typeof object.id === "string"
      ? object.id
      : null;
  if (!id || !/^in_[A-Za-z0-9]+$/.test(id)) throw new Error("Invalid invoice event.");
  const owner = await dependencies.resolveOwner(account);
  if (!owner) return "ignored";
  const invoice = await dependencies.retrieveInvoice(id, account);
  if (
    invoice.id !== id ||
    (invoice.metadata?.["lenslabs_user_id"] && invoice.metadata["lenslabs_user_id"] !== owner)
  )
    return "ignored";
  const status =
    invoice.status === "open" || invoice.status === "uncollectible" ? "sent" : invoice.status;
  // Payable is not emailed: a finalization/update cannot claim a send.
  if (status === "sent" && event.type !== "invoice.sent" && invoice.status === "open")
    return "ignored";
  if (status !== "draft" && status !== "sent" && status !== "paid" && status !== "void")
    throw new Error("Unrecognized invoice status.");
  const hostedInvoiceUrl =
    invoice.hosted_invoice_url &&
    /^https:\/\/invoice\.stripe\.com\//.test(invoice.hosted_invoice_url)
      ? invoice.hosted_invoice_url
      : null;
  await dependencies.saveInvoice(owner, { id, status, hostedInvoiceUrl });
  return "updated";
}
