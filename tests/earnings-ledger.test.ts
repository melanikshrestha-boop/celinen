import { describe, expect, test } from "bun:test";
import {
  buildEarningsLedger,
  earningsCsv,
  earningsDateInZone,
  filterEarningsRows,
  type EarningsInvoice,
  type LegacyFinanceTransaction,
} from "../src/lib/earnings-ledger";
import {
  currencyExponent,
  decimalToMinorUnits,
  formatFinanceMoney,
  minorUnitsDecimal,
  parseFinanceAmount,
} from "../src/lib/finance-money";
import {
  buildLocalInvoiceDraft,
  buildLocalLedgerEntry,
  emptyLocalFinanceState,
} from "../src/lib/local-finance-store";
import type { ConnectedPaymentReceipt } from "../src/lib/earnings/stripe-receipts";

const all = { from: null, to: null },
  today = "2026-09-08";
const base = { period: all, today, timeZone: "America/Los_Angeles" };
const usd = (result: ReturnType<typeof buildEarningsLedger>) =>
  result.metrics.find((m) => m.currency === "USD")!;
function local() {
  const state = emptyLocalFinanceState();
  for (const [id, kind, amount, shootId] of [
    ["cash", "income", "100.01", "shoot-a"],
    ["old", "income", "12.99", null],
    ["expense", "expense", "25.01", "shoot-a"],
  ] as const) {
    const result = buildLocalLedgerEntry(
      { occurredOn: today, description: id, category: kind, kind, amount, shootId },
      { id, now: "2026-09-08T12:00:00Z" },
    );
    if (!result.ok) throw new Error(result.error);
    state.entries.push(result.value);
  }
  return state;
}
function payment(patch: Partial<ConnectedPaymentReceipt> = {}): ConnectedPaymentReceipt {
  return {
    id: "acct_A:ch_one",
    accountId: "acct_A",
    chargeId: "ch_one",
    paymentIntentId: "pi_one",
    invoiceId: "invoice-a",
    stripeInvoiceId: "in_one",
    shootId: "shoot-a",
    clientId: "client-a",
    sourceKind: "invoice",
    currency: "usd",
    amountMinor: 10000,
    collectedMinor: 10000,
    refundedMinor: 0,
    netMinor: 10000,
    status: "paid",
    createdAt: "2026-09-01T00:00:00Z",
    paidAt: "2026-09-02T12:00:00Z",
    dateBasis: "balance-transaction",
    description: "Game coverage",
    livemode: true,
    disputed: false,
    linkStatus: "linked",
    refunds: [],
    refundHistoryComplete: true,
    legacyObjectIds: ["ch_one", "pi_one", "in_one"],
    warnings: [],
    ...patch,
  };
}
function invoice(patch: Partial<EarningsInvoice> = {}): EarningsInvoice {
  return {
    id: "invoice-a",
    createdAt: "2026-08-01T12:00:00Z",
    dueDate: "2026-09-07",
    amountMinor: 15000,
    outstandingMinor: 5000,
    currency: "USD",
    status: "open",
    shootId: "shoot-a",
    clientId: "client-a",
    clientName: "Athletics",
    ...patch,
  };
}
function legacy(patch: Partial<LegacyFinanceTransaction> = {}): LegacyFinanceTransaction {
  return {
    id: "old-row",
    occurred_on: today,
    description: "Historical payment",
    kind: "income",
    category: "Other income",
    amount: "100.00",
    shoot_id: null,
    source: "manual",
    ...patch,
  };
}

describe("integer money and calendar boundaries", () => {
  test("parses currency precision without rounding, currency conversion or floating point loss", () => {
    expect(parseFinanceAmount("$1,234.56", "USD")).toBe(123456);
    expect(parseFinanceAmount("1234", "JPY")).toBe(1234);
    expect(parseFinanceAmount("1.234", "KWD")).toBe(1234);
    expect(parseFinanceAmount(".99", "EUR")).toBe(99);
    for (const value of ["1.001", "1e3", "12,34", "-2", "0", "", "."])
      expect(parseFinanceAmount(value, "USD")).toBeNull();
    expect(parseFinanceAmount("1.01", "JPY")).toBeNull();
    expect(() => currencyExponent("ZZZ")).toThrow();
    expect(() => decimalToMinorUnits("90071992547409.92")).toThrow();
    expect(decimalToMinorUnits("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
    expect(minorUnitsDecimal(Number.MAX_SAFE_INTEGER, "USD")).toBe("90071992547409.91");
    expect(formatFinanceMoney(Number.MAX_SAFE_INTEGER, "USD")).toBe("$90,071,992,547,409.91");
    expect(formatFinanceMoney(-1, "USD")).toBe("-$0.01");
    expect(formatFinanceMoney(1234, "JPY")).toBe("¥1,234");
  });
  test("uses explicit timezone across midnight and rejects impossible dates", () => {
    expect(earningsDateInZone("2026-09-01T01:00:00Z", "America/Los_Angeles")).toBe("2026-08-31");
    expect(earningsDateInZone("2026-09-01T01:00:00Z", "UTC")).toBe("2026-09-01");
    expect(() => earningsDateInZone("2026-02-30T00:00:00Z", "UTC")).toThrow();
    expect(() => earningsDateInZone("2026-09-01", "UTC")).toThrow();
    expect(() =>
      buildEarningsLedger({ ...base, period: { from: "2026-10-01", to: today } }),
    ).toThrow();
    expect(() => buildEarningsLedger({ ...base, today: "2026-02-29" })).toThrow();
  });
});

describe("safe read-only earnings projections", () => {
  test("preserves unassigned historical money and caller arrays exactly", () => {
    const state = local(),
      original = JSON.stringify(state);
    const result = buildEarningsLedger({ ...base, local: state });
    expect(result.rows).toHaveLength(3);
    expect(result.rows.find((r) => r.sourceId === "old")?.shootId).toBeNull();
    expect(usd(result).collectedMinor).toBe(11300);
    expect(usd(result).expensesMinor).toBe(2501);
    expect(usd(result).netMinor).toBe(8799);
    expect(JSON.stringify(state)).toBe(original);
    expect(
      usd(buildEarningsLedger({ ...base, local: state, shootId: "shoot-a" })).collectedMinor,
    ).toBe(10001);
    expect(usd(buildEarningsLedger({ ...base, local: state, shootId: null })).collectedMinor).toBe(
      1299,
    );
  });
  test("invoice drafts and paid invoices never synthesize revenue or an overdue balance", () => {
    const state = local();
    const draft = buildLocalInvoiceDraft({
      clientName: "Client",
      clientEmail: "",
      description: "Draft only",
      amount: "9999",
      dueDate: "2026-01-01",
      shootId: "shoot-a",
    });
    if (!draft.ok) throw new Error(draft.error);
    state.invoices.push(draft.value);
    const result = buildEarningsLedger({
      ...base,
      local: state,
      invoices: [
        invoice({ status: "paid" }),
        invoice({ id: "void", status: "void" }),
        invoice({ id: "bad-debt", status: "uncollectible" }),
      ],
    });
    expect(usd(result).collectedMinor).toBe(11300);
    expect(usd(result).outstandingMinor).toBe(0);
    expect(usd(result).overdueMinor).toBe(0);
    expect(result.rows.filter((r) => r.type === "invoice")).toHaveLength(4);
  });
  test("current open balances include older issued invoices; due today is not overdue", () => {
    const result = buildEarningsLedger({
      ...base,
      period: { from: "2026-09-01", to: "2026-09-30" },
      invoices: [
        invoice(),
        invoice({ id: "today", dueDate: today }),
        invoice({ id: "future", createdAt: "2026-10-01T12:00:00Z" }),
      ],
    });
    expect(usd(result).outstandingMinor).toBe(10000);
    expect(usd(result).overdueMinor).toBe(5000);
    expect(usd(result).collectedMinor).toBe(0);
    expect(() =>
      buildEarningsLedger({ ...base, invoices: [invoice({ outstandingMinor: 20000 })] }),
    ).toThrow();
  });
  test("counts captured payments once even with invoice and legacy import records", () => {
    const result = buildEarningsLedger({
      ...base,
      payments: [payment()],
      invoices: [invoice({ status: "paid" })],
      legacyTransactions: [
        legacy({ source: "stripe", stripe_object_id: "pi_one", currency: "USD" }),
      ],
    });
    expect(result.rows).toHaveLength(3);
    expect(usd(result).collectedMinor).toBe(10000);
    expect(result.rows.find((r) => r.source === "legacy")?.status).toBe("reconciled");
    expect(result.rows.find((r) => r.source === "legacy")?.amountMinor).toBe(10000);
  });
  test("refunds belong to their actual period, not the original sale's period", () => {
    const receipt = payment({
      paidAt: "2026-08-15T12:00:00Z",
      refundedMinor: 2500,
      netMinor: 7500,
      refunds: [
        { id: "re_one", amountMinor: 2500, createdAt: "2026-09-03T12:00:00Z", status: "succeeded" },
      ],
    });
    const august = buildEarningsLedger({
      ...base,
      payments: [receipt],
      period: { from: "2026-08-01", to: "2026-08-31" },
    });
    const september = buildEarningsLedger({
      ...base,
      payments: [receipt],
      period: { from: "2026-09-01", to: "2026-09-30" },
    });
    expect(usd(august).collectedMinor).toBe(10000);
    expect(usd(september).collectedMinor).toBe(-2500);
    expect(usd(september).refundsMinor).toBe(2500);
    expect(usd(september).netMinor).toBe(-2500);
    expect(usd(buildEarningsLedger({ ...base, payments: [receipt] })).collectedMinor).toBe(7500);
  });
  test("failed/pending/test payments and pending refunds are not collected money", () => {
    const payments = [
      payment({ status: "pending", collectedMinor: 0, netMinor: 0, paidAt: null }),
      payment({
        id: "test",
        chargeId: "ch_test",
        livemode: false,
        linkStatus: "unlinked",
        shootId: null,
        refundedMinor: 1000,
        netMinor: 9000,
        refunds: [
          {
            id: "re_test",
            amountMinor: 1000,
            createdAt: "2026-09-03T12:00:00Z",
            status: "succeeded",
          },
        ],
      }),
      payment({
        id: "failed",
        chargeId: "ch_failed",
        status: "failed",
        collectedMinor: 0,
        netMinor: 0,
        paidAt: null,
      }),
    ];
    const result = buildEarningsLedger({ ...base, payments });
    expect(usd(result).collectedMinor).toBe(0);
    expect(usd(result).unlinkedMinor).toBe(0);
    const pendingRefund = payment({
      refunds: [
        {
          id: "re_pending",
          amountMinor: 3000,
          createdAt: "2026-09-03T12:00:00Z",
          status: "pending",
        },
      ],
    });
    expect(usd(buildEarningsLedger({ ...base, payments: [pendingRefund] })).collectedMinor).toBe(
      10000,
    );
  });
  test("unlinked payments remain visible separately; missing dates stay unknown", () => {
    const result = buildEarningsLedger({
      ...base,
      payments: [payment({ shootId: null, linkStatus: "unlinked" })],
    });
    expect(result.rows).toHaveLength(1);
    expect(usd(result).collectedMinor).toBe(0);
    expect(usd(result).unlinkedMinor).toBe(10000);
    expect(result.warnings.join(" ")).toContain("Unlinked");
    const unknown = buildEarningsLedger({
      ...base,
      payments: [payment({ paidAt: null, dateBasis: "unknown" })],
    });
    expect(unknown.rows[0]?.date).toBeNull();
    expect(filterEarningsRows(unknown.rows, { period: all })).toHaveLength(1);
    expect(filterEarningsRows(unknown.rows, { period: { from: today, to: today } })).toHaveLength(
      0,
    );
    expect(usd(unknown).collectedMinor).toBe(0);
    expect(unknown.complete).toBe(false);
  });
  test("partial provider/refund/dispute evidence marks subtotals provisional, never invents adjustments", () => {
    const partial = buildEarningsLedger({
      ...base,
      payments: [payment()],
      providerComplete: false,
    });
    expect(partial.complete).toBe(false);
    expect(usd(partial).collectedMinor).toBe(10000);
    const incompleteRefund = buildEarningsLedger({
      ...base,
      payments: [payment({ refundedMinor: 2000, netMinor: 8000, refundHistoryComplete: false })],
    });
    expect(incompleteRefund.complete).toBe(false);
    expect(usd(incompleteRefund).collectedMinor).toBe(10000);
    expect(incompleteRefund.rows.filter((row) => row.accounting === "refund")).toHaveLength(0);
    expect(buildEarningsLedger({ ...base, payments: [payment({ disputed: true })] }).complete).toBe(
      false,
    );
    expect(buildEarningsLedger({ ...base, local: local() }).complete).toBe(true);
  });
  test("payouts are informational; unknown-currency legacy imports do not become USD", () => {
    const result = buildEarningsLedger({
      ...base,
      legacyTransactions: [
        legacy(),
        legacy({ id: "payout", source: "stripe-payout", amount: "500.00", currency: "USD" }),
        legacy({ id: "unknown", source: "stripe", amount: "12.34" }),
      ],
    });
    expect(usd(result).collectedMinor).toBe(10000);
    expect(result.rows.find((r) => r.sourceId === "unknown")?.currency).toBeNull();
    expect(result.rows.find((r) => r.sourceId === "unknown")?.amountMinor).toBe(1234);
    expect(filterEarningsRows(result.rows, { period: all, filter: "payouts" })).toHaveLength(1);
    expect(result.warnings.join(" ")).toContain("no recorded currency");
    expect(result.complete).toBe(false);
  });
  test("gallery sales are a subset of collected money, separated by currency", () => {
    const result = buildEarningsLedger({
      ...base,
      payments: [
        payment({ sourceKind: "gallery" }),
        payment({ id: "euro", chargeId: "ch_euro", currency: "eur", sourceKind: "gallery" }),
        payment({
          id: "yen",
          chargeId: "ch_yen",
          currency: "jpy",
          amountMinor: 350,
          collectedMinor: 350,
          netMinor: 350,
        }),
      ],
    });
    expect(result.metrics.map((m) => m.currency)).toEqual(["EUR", "JPY", "USD"]);
    expect(usd(result).gallerySalesMinor).toBe(10000);
    expect(usd(result).collectedMinor).toBe(10000);
    expect(result.metrics.find((m) => m.currency === "JPY")?.collectedMinor).toBe(350);
    expect(
      filterEarningsRows(result.rows, { period: all, filter: "gallery", currency: "EUR" }),
    ).toHaveLength(1);
  });
  test("receipt inconsistencies, duplicate identities and overflowing totals fail visibly", () => {
    for (const receipt of [
      payment({ collectedMinor: 20000 }),
      payment({ refundedMinor: 3000, netMinor: 7000 }),
      payment({ netMinor: 9999 }),
      payment({ collectedMinor: NaN }),
    ])
      expect(() => buildEarningsLedger({ ...base, payments: [receipt] })).toThrow();
    expect(() => buildEarningsLedger({ ...base, payments: [payment(), payment()] })).toThrow();
    const state = local();
    state.entries[0]!.amountCents = Number.MAX_SAFE_INTEGER;
    expect(() => buildEarningsLedger({ ...base, local: state })).toThrow();
    expect(() =>
      buildEarningsLedger({ ...base, legacyTransactions: [legacy({ amount: "12.345" })] }),
    ).toThrow();
  });
  test("export keeps exact amounts, identities, unknown currencies and neutralizes formulas", () => {
    const result = buildEarningsLedger({
      ...base,
      legacyTransactions: [
        legacy({ description: '=IMPORTDATA("bad")', amount: "90071992547409.91" }),
        legacy({ id: "unknown", source: "stripe", amount: "12.34" }),
      ],
    });
    const csv = earningsCsv(result.rows, () => "+unsafe shoot");
    expect(csv).toContain('"90071992547409.91","USD"');
    expect(csv).toContain('"12.34","UNKNOWN"');
    expect(csv).toContain("'=IMPORTDATA");
    expect(csv).toContain("'+unsafe shoot");
    expect(csv).toContain('"legacy:old-row"');
  });
  test("1,000 varied deterministic ledgers conserve exact money and never mutate inputs", () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const state = local();
      state.entries[0]!.amountCents = seed * 103;
      state.entries[1]!.amountCents = (seed % 23) + 1;
      state.entries[2]!.amountCents = seed * 17;
      const before = JSON.stringify(state),
        result = buildEarningsLedger({ ...base, local: state });
      expect(usd(result).netMinor).toBe(seed * 86 + (seed % 23) + 1);
      expect(result.rows).toHaveLength(3);
      expect(JSON.stringify(state)).toBe(before);
    }
  });
});
