import type Stripe from "stripe";
import {
  normalizeConnectedInvoices,
  normalizeConnectedPayments,
  type ConnectedEarningsSnapshot,
  type FinanceInvoiceBinding,
} from "./stripe-receipts";

export type EarningsStripeReader = Pick<
  Stripe,
  "charges" | "refunds" | "invoicePayments" | "invoices"
>;
/** Bounded paginated provider read; never imports into or rewrites the legacy
 * transaction table. Pagination limits/errors remain explicit in the receipt. */
export async function readConnectedEarnings(
  input: {
    accountId: string;
    ownerId: string;
    ownedInvoices: FinanceInvoiceBinding[];
    ownedShootIds: string[];
    clientNames: Record<string, string>;
    bindingsComplete: boolean;
  },
  stripe: EarningsStripeReader,
  options: { maxPages?: number; now?: () => number } = {},
): Promise<ConnectedEarningsSnapshot> {
  if (!/^acct_[A-Za-z0-9]+$/.test(input.accountId)) throw new Error("Invalid connected account.");
  const now = options.now ?? Date.now,
    started = now(),
    deadline = started + 25_000;
  const maxPages = Math.min(10, Math.max(1, options.maxPages ?? 10));
  const opts = { stripeAccount: input.accountId, timeout: 8_000, maxNetworkRetries: 0 };
  async function pages(
    name: string,
    fetchPage: (cursor?: string) => Promise<{ data: Array<{ id: string }>; has_more: boolean }>,
  ) {
    const items: Array<{ id: string }> = [],
      seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      if (now() >= deadline)
        return { items, complete: false, warning: `${name} reading reached its time limit.` };
      const response = await fetchPage(cursor);
      for (const item of response.data)
        if (!seen.has(item.id)) {
          items.push(item);
          seen.add(item.id);
        }
      if (!response.has_more) return { items, complete: true, warning: null };
      const next = response.data.at(-1)?.id;
      if (!next || next === cursor)
        return { items, complete: false, warning: `${name} pagination did not advance.` };
      cursor = next;
    }
    return {
      items,
      complete: false,
      warning: `${name} is limited to the latest ${maxPages * 100} records; totals are incomplete.`,
    };
  }
  const requests = [
    pages("Payments", (cursor) =>
      stripe.charges.list(
        {
          limit: 100,
          expand: ["data.balance_transaction"],
          ...(cursor ? { starting_after: cursor } : {}),
        },
        opts,
      ),
    ),
    pages("Refunds", (cursor) =>
      stripe.refunds.list({ limit: 100, ...(cursor ? { starting_after: cursor } : {}) }, opts),
    ),
    pages("Invoice payment links", (cursor) =>
      stripe.invoicePayments.list(
        { limit: 100, ...(cursor ? { starting_after: cursor } : {}) },
        opts,
      ),
    ),
    pages("Invoices", (cursor) =>
      stripe.invoices.list({ limit: 100, ...(cursor ? { starting_after: cursor } : {}) }, opts),
    ),
  ];
  const settled = await Promise.allSettled(requests);
  const results = settled.map((result) =>
    result.status === "fulfilled"
      ? result.value
      : {
          items: [],
          complete: false,
          warning: "A provider read failed; saved history is unchanged.",
        },
  );
  const [charges, refunds, links, invoices] = results;
  if (!charges || !refunds || !links || !invoices || settled[0]?.status === "rejected")
    throw new Error("Connected payments could not be read. Saved history is unchanged.");
  const normalized = normalizeConnectedPayments({
    ...input,
    charges: charges.items,
    refunds: refunds.items,
    invoicePayments: links.items,
    refundsComplete: refunds.complete,
  });
  const warnings = results
    .flatMap((result) => (result.warning ? [result.warning] : []))
    .concat(normalized.warnings);
  if (!input.bindingsComplete)
    warnings.push("The owned shoot or invoice list is incomplete; some payments may be unlinked.");
  const invoiceRows = normalizeConnectedInvoices(
    invoices.items,
    input.ownedInvoices,
    input.ownerId,
    input.ownedShootIds,
    input.clientNames,
  );
  return {
    connection: "connected",
    accountId: input.accountId,
    fetchedAt: new Date(now()).toISOString(),
    complete:
      results.every((r) => r.complete) && normalized.ignored === 0 && input.bindingsComplete,
    receipts: normalized.receipts,
    invoices: invoiceRows,
    unmatchedCount: normalized.receipts.filter((r) => r.linkStatus !== "linked").length,
    warnings: [...new Set(warnings)],
  };
}
