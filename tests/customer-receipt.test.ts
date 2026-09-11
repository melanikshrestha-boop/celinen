import { describe, expect, test } from "bun:test";
import { customerReceiptFromEarnings, receiptUnavailable } from "../src/lib/receipts/from-earnings";
import type { EarningsRow } from "../src/lib/earnings-ledger";
import type { ConnectedEarningsSnapshot } from "../src/lib/earnings/stripe-receipts";
import { customerEmailDraft, customerPhone, customerSmsDraft } from "../src/lib/customer-message";

const row: EarningsRow = {
  id: "manual:entry-1",
  sourceId: "entry-1",
  date: "2026-09-08",
  shootId: "shoot-1",
  who: "Jordan",
  clientId: "client-1",
  description: "Portrait deposit",
  category: "Deposit",
  type: "payment",
  status: "recorded",
  amountMinor: 12500,
  currency: "USD",
  source: "manual",
  accounting: "collection",
  outstandingMinor: 0,
  dueDate: null,
  eligibleForTotals: true,
  linked: true,
  warnings: [],
  paymentMethod: "Cash",
};
const input = {
  today: "2026-09-08",
  studioName: "Photo Studio",
  customerName: "Jordan",
  shootName: "Portraits",
  snapshot: null,
  nowMs: Date.parse("2026-09-08T18:01:00Z"),
};
const proof: ConnectedEarningsSnapshot = {
  connection: "connected",
  accountId: "acct_1",
  complete: true,
  fetchedAt: "2026-09-08T18:00:00Z",
  invoices: [],
  unmatchedCount: 0,
  warnings: [],
  receipts: [
    {
      id: "receipt-1",
      accountId: "acct_1",
      chargeId: "ch_1",
      paymentIntentId: "pi_1",
      invoiceId: null,
      stripeInvoiceId: null,
      shootId: "shoot-1",
      clientId: "client-1",
      sourceKind: "deposit",
      currency: "usd",
      amountMinor: 12500,
      collectedMinor: 12500,
      refundedMinor: 0,
      netMinor: 12500,
      status: "paid",
      createdAt: "2026-09-08T08:00:00Z",
      paidAt: "2026-09-08T08:00:00Z",
      dateBasis: "balance-transaction",
      description: "Portrait deposit",
      livemode: true,
      disputed: false,
      linkStatus: "linked",
      refunds: [],
      refundHistoryComplete: true,
      legacyObjectIds: [],
      warnings: [],
    },
  ],
};
const paid = {
  ...row,
  id: "payment:receipt-1",
  sourceId: "ch_1",
  source: "stripe" as const,
  status: "paid",
};

describe("Receipt projection preserves payment truth", () => {
  test("manual receipt contains exact recorded money and method without claiming verification or inventing tax", () => {
    const before = JSON.stringify(row);
    const receipt = customerReceiptFromEarnings(row, input);
    expect(receipt.amountMinor).toBe(12500);
    expect(receipt.paymentMethod).toBe("Cash");
    expect(receipt.sourceLabel).toBe("Manually recorded");
    expect(receipt.receiptId).toBe("FOTO-entry-1");
    expect(receipt.paidOn).toBe(row.date!);
    expect(receipt).not.toHaveProperty("tax");
    expect(JSON.stringify(row)).toBe(before);
  });
  test("only matching live provider payment is verified; source is immutable", () => {
    const before = JSON.stringify(proof);
    expect(customerReceiptFromEarnings(paid, { ...input, snapshot: proof }).sourceLabel).toBe(
      "Provider verified",
    );
    expect(JSON.stringify(proof)).toBe(before);
    for (const patch of [
      { accountId: "other" },
      { livemode: false },
      { status: "pending" },
      { disputed: true },
      { refundHistoryComplete: false },
      { refundedMinor: 1 },
      {
        refunds: [
          { id: "r", amountMinor: 1, status: "pending", createdAt: "2026-09-08T08:00:00Z" },
        ],
      },
      { linkStatus: "unlinked" },
      { paidAt: null },
      { shootId: "other" },
      { clientId: "other" },
      { collectedMinor: 1 },
      { netMinor: 1 },
      { currency: "jpy" },
      { paidAt: "2026-09-07T08:00:00Z" },
    ]) {
      const changed = {
        ...proof,
        receipts: [{ ...proof.receipts[0]!, ...patch }],
      } as ConnectedEarningsSnapshot;
      expect(receiptUnavailable(paid, changed, input.today, "UTC", input.nowMs)).not.toBeNull();
    }
    expect(receiptUnavailable(paid, { ...proof, complete: false }, input.today)).not.toBeNull();
    expect(receiptUnavailable(paid, null, input.today)).not.toBeNull();
  });
  test("provider dates use the ledger timezone, not the viewer's UTC day", () => {
    const snapshot = {
      ...proof,
      receipts: [{ ...proof.receipts[0]!, paidAt: "2026-09-08T01:00:00Z" }],
    };
    expect(
      receiptUnavailable(
        { ...paid, date: "2026-09-07" },
        snapshot,
        input.today,
        "America/Los_Angeles",
        input.nowMs,
      ),
    ).toBeNull();
    expect(
      receiptUnavailable(paid, snapshot, input.today, "America/Los_Angeles", input.nowMs),
    ).not.toBeNull();
  });
  test("provider verification expires; unknown/future snapshot clocks fail closed", () => {
    const fetched = Date.parse(proof.fetchedAt);
    expect(receiptUnavailable(paid, proof, input.today, "UTC", fetched + 300000)).toBeNull();
    for (const clock of [fetched + 300001, fetched - 30001, NaN, Infinity])
      expect(receiptUnavailable(paid, proof, input.today, "UTC", clock)).not.toBeNull();
    expect(
      receiptUnavailable(paid, { ...proof, fetchedAt: "invalid" }, input.today, "UTC", fetched),
    ).not.toBeNull();
    expect(receiptUnavailable(row, null, input.today, "UTC", fetched + 99999999)).toBeNull();
    expect(() =>
      customerReceiptFromEarnings(paid, { ...input, snapshot: proof, nowMs: fetched + 300001 }),
    ).toThrow("Refresh Earnings");
  });
  test("drafts, expenses, refunds, future, unlinked and unverified rows never become receipts", () => {
    for (const patch of [
      { accounting: "invoice", type: "invoice" },
      { accounting: "expense" },
      { accounting: "refund" },
      { type: "payout" },
      { eligibleForTotals: false },
      { amountMinor: -1 },
      { amountMinor: 0 },
      { amountMinor: Number.MAX_SAFE_INTEGER + 1 },
      { shootId: null },
      { linked: false },
      { date: null },
      { date: "2026-02-30" },
      { date: "2026-09-09" },
      { currency: null },
      { currency: "ZZZ" },
      { source: "legacy" },
      { status: "draft" },
    ])
      expect(
        receiptUnavailable({ ...row, ...patch } as EarningsRow, null, input.today),
      ).not.toBeNull();
  });
  test("all supported precisions preserve integer money and customer edits cannot change the ledger", () => {
    for (const [currency, exponent] of [
      ["USD", 2],
      ["JPY", 0],
      ["KWD", 3],
    ] as const) {
      const receipt = customerReceiptFromEarnings(
        { ...row, currency, amountMinor: 9007199254740991 },
        input,
      );
      expect(receipt.exponent).toBe(exponent);
      expect(receipt.amountMinor).toBe(9007199254740991);
    }
    for (const key of ["studioName", "customerName", "shootName"] as const)
      expect(() => customerReceiptFromEarnings(row, { ...input, [key]: " " })).toThrow();
    expect(
      customerReceiptFromEarnings({ ...row, paymentMethod: undefined }, input).paymentMethod,
    ).toBe("");
  });
});

describe("Customer messaging is a reviewed draft handoff", () => {
  test("SMS preserves exact Unicode text, cannot add extra recipients, and Apple uses documented recipient-only handoff", () => {
    const text = "PAYMENT RECEIPT\nJordan & Jo • NPR 2,500\nThanks!";
    expect(customerPhone("+1 (415) 555-0100")).toBe("+14155550100");
    expect(customerSmsDraft("+14155550100", text)).toBe(
      `sms:+14155550100?body=${encodeURIComponent(text)}`,
    );
    expect(customerSmsDraft("+14155550100", text, true)).toBe("sms:+14155550100");
    for (const phone of [
      "4155550100",
      "+012345678",
      "+14155550100,+14155550101",
      "+14155550100?body=changed",
      "javascript:alert(1)",
      "\n+14155550100\nbcc=bad",
    ])
      expect(() => customerSmsDraft(phone, text)).toThrow();
  });
  test("email subject/body are escaped, addresses reject header and recipient injection", () => {
    const draft = customerEmailDraft(
      "client@example.com",
      "Receipt & Gallery",
      "Line one\n&bcc=not-a-header",
    );
    expect(draft).toBe(
      "mailto:client@example.com?subject=Receipt%20%26%20Gallery&body=Line%20one%0A%26bcc%3Dnot-a-header",
    );
    for (const email of [
      "a@example.com,b@example.com",
      "a@example.com?bcc=b@example.com",
      "a@example.com\r\nBcc:b@example.com",
      "a@example.com;b@example.com",
    ])
      expect(() => customerEmailDraft(email, "Receipt", "Paid")).toThrow();
    expect(() => customerEmailDraft("client@example.com", "Receipt\nBcc:bad", "Paid")).toThrow();
    expect(() => customerSmsDraft("+14155550100", "\u0000")).toThrow();
    expect(() => customerSmsDraft("+14155550100", "x".repeat(12001))).toThrow();
  });
});
