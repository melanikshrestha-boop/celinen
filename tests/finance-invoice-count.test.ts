import { describe, expect, test } from "bun:test";
import { buildEarningsLedger, type EarningsRow } from "../src/lib/earnings-ledger";
import type { ConnectedInvoiceReceipt } from "../src/lib/earnings/stripe-receipts";
import { buildPhotographerBooks } from "../src/lib/photographer-books";

const options = {
  period: { from: "2026-09-01", to: "2026-09-12" },
  today: "2026-09-12",
  currency: "USD",
  shootId: "synthetic-shoot",
};

function invoiceRow(id: string, patch: Partial<EarningsRow> = {}): EarningsRow {
  return {
    id,
    sourceId: id,
    date: "2026-09-01",
    shootId: options.shootId,
    who: "Synthetic client",
    clientId: null,
    description: "Synthetic invoice",
    category: "",
    type: "invoice",
    status: "open",
    amountMinor: 10000,
    currency: "USD",
    source: "invoice",
    accounting: "invoice",
    outstandingMinor: 10000,
    dueDate: "2026-09-15",
    eligibleForTotals: true,
    linked: true,
    warnings: [],
    ...patch,
  };
}

describe("verified open invoice count", () => {
  test("test-mode provider invoices do not count as real open invoices", () => {
    const invoice = (id: string, livemode: boolean): ConnectedInvoiceReceipt => ({
      id,
      stripeInvoiceId: id,
      createdAt: "2026-09-01T12:00:00Z",
      issuedAt: "2026-09-01T12:00:00Z",
      dueDate: "2026-09-15",
      amountMinor: 10000,
      outstandingMinor: 10000,
      currency: "USD",
      status: "open",
      shootId: options.shootId,
      clientId: null,
      clientName: "Synthetic client",
      livemode,
      hostedInvoiceUrl: null,
    });
    const ledger = buildEarningsLedger({
      ...options,
      timeZone: "UTC",
      invoices: [invoice("synthetic-live", true), invoice("synthetic-test", false)],
    });
    const before = structuredClone(ledger.rows);
    const books = buildPhotographerBooks(ledger.rows, options);
    expect(ledger.rows.find((row) => row.status === "test-open")?.eligibleForTotals).toBe(false);
    expect(books.openInvoices).toBe(1);
    expect(books.outstandingMinor).toBe(10000);
    expect(ledger.rows).toEqual(before);
  });

  test("only eligible open invoices and their verified due-status labels count", () => {
    const rows = [
      ...["open", "upcoming", "overdue"].map((status) => invoiceRow(status, { status })),
      ...["draft", "paid", "void", "uncollectible", "unverified", "test-open"].map((status) =>
        // A stale balance must not turn a closed or unverified status into an open invoice.
        invoiceRow(status, { status }),
      ),
      invoiceRow("ineligible", { eligibleForTotals: false }),
      invoiceRow("settled", { outstandingMinor: 0 }),
      invoiceRow("collection", { accounting: "collection", type: "payment" }),
    ];
    const before = structuredClone(rows);
    expect(buildPhotographerBooks(rows, options).openInvoices).toBe(3);
    expect(rows).toEqual(before);
  });

  test("open balances retain currency, shoot and as-of-today scope, not cash-period scope", () => {
    const rows = [
      invoiceRow("older-open", { date: "2026-08-01" }),
      invoiceRow("issued-today", { date: options.today }),
      invoiceRow("future-issued", { date: "2026-09-13" }),
      invoiceRow("unknown-issued", { date: null }),
      invoiceRow("other-currency", { currency: "EUR" }),
      invoiceRow("other-shoot", { shootId: "another-synthetic-shoot" }),
    ];
    const before = structuredClone(rows);
    const books = buildPhotographerBooks(rows, options);
    expect(books.openInvoices).toBe(2);
    expect(books.outstandingMinor).toBe(20000);
    expect(rows).toEqual(before);
  });
});
