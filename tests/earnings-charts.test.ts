import { describe, expect, test } from "bun:test";
import { buildEarningsCharts } from "../src/lib/earnings-charts";
import {
  buildEarningsLedger,
  summarizeEarnings,
  type EarningsRow,
} from "../src/lib/earnings-ledger";
import type { ConnectedPaymentReceipt } from "../src/lib/earnings/stripe-receipts";

const all = { from: null, to: null };
const options = { period: all, today: "2026-09-08", currency: "USD" };
function row(id: string, patch: Partial<EarningsRow> = {}): EarningsRow {
  return {
    id,
    sourceId: id,
    date: "2026-09-08",
    shootId: "shoot-a",
    who: null,
    clientId: null,
    description: id,
    category: "Portraits",
    type: "payment",
    status: "recorded",
    amountMinor: 10000,
    currency: "USD",
    source: "manual",
    accounting: "collection",
    outstandingMinor: 0,
    dueDate: null,
    eligibleForTotals: true,
    linked: true,
    warnings: [],
    ...patch,
  };
}
function receipt(patch: Partial<ConnectedPaymentReceipt> = {}): ConnectedPaymentReceipt {
  return {
    id: "acct_one:ch_one",
    accountId: "acct_one",
    chargeId: "ch_one",
    paymentIntentId: "pi_one",
    invoiceId: null,
    stripeInvoiceId: null,
    shootId: "shoot-a",
    clientId: null,
    sourceKind: "gallery",
    currency: "usd",
    amountMinor: 10000,
    collectedMinor: 10000,
    refundedMinor: 2500,
    netMinor: 7500,
    status: "paid",
    createdAt: "2026-09-01T01:00:00Z",
    paidAt: "2026-09-01T01:00:00Z",
    dateBasis: "balance-transaction",
    description: "Gallery",
    livemode: true,
    disputed: false,
    linkStatus: "linked",
    refunds: [
      { id: "re_one", amountMinor: 2500, createdAt: "2026-09-02T01:00:00Z", status: "succeeded" },
    ],
    refundHistoryComplete: true,
    legacyObjectIds: ["ch_one"],
    warnings: [],
    ...patch,
  };
}

describe("read-only, exact earnings chart projections", () => {
  test("calendar cash flow equals existing totals with dated refunds and negative corrections", () => {
    const rows = [
      row("august", { date: "2026-08-31", amountMinor: 10001 }),
      row("refund", { date: "2026-09-01", accounting: "refund", amountMinor: -2501 }),
      row("income", { amountMinor: 3000 }),
      row("income-correction", { amountMinor: -500 }),
      row("expense", {
        accounting: "expense",
        type: "expense",
        amountMinor: 2000,
        category: "Equipment",
      }),
      row("expense-credit", {
        accounting: "expense",
        type: "expense",
        amountMinor: -250,
        category: "Equipment",
      }),
    ];
    const snapshot = structuredClone(rows);
    for (const value of rows) Object.freeze(value);
    Object.freeze(rows);
    const chart = buildEarningsCharts(rows, options);
    expect(chart.months).toEqual([
      {
        month: "2026-08",
        collectedMinor: 10001,
        refundsMinor: 0,
        expensesMinor: 0,
        netMinor: 10001,
      },
      {
        month: "2026-09",
        collectedMinor: -1,
        refundsMinor: 2501,
        expensesMinor: 1750,
        netMinor: -1751,
      },
    ]);
    expect(chart.incomeCategories).toEqual([{ category: "Portraits", amountMinor: 13001 }]);
    expect(chart.expenseCategories).toEqual([{ category: "Equipment", amountMinor: 2000 }]);
    expect(chart.totals).toEqual({
      collectedMinor: 10000,
      refundsMinor: 2501,
      expensesMinor: 1750,
      netMinor: 8250,
      positiveCollectionsMinor: 13001,
      collectionAdjustmentsMinor: -500,
      positiveExpensesMinor: 2000,
      expenseAdjustmentsMinor: -250,
    });
    expect(rows).toEqual(snapshot);
  });

  test("canonical provider dates are already timezone resolved; a later refund never rewrites collection month", () => {
    const ledger = buildEarningsLedger({
      period: all,
      today: options.today,
      timeZone: "America/Los_Angeles",
      payments: [receipt()],
    });
    const chart = buildEarningsCharts(ledger.rows, { ...options, complete: ledger.complete });
    expect(chart.months.map((value) => [value.month, value.collectedMinor])).toEqual([
      ["2026-08", 10000],
      ["2026-09", -2500],
    ]);
    expect(chart.incomeCategories).toEqual([{ category: "Gallery sales", amountMinor: 10000 }]);
    expect(chart.totals.collectedMinor).toBe(ledger.metrics[0]!.collectedMinor);
    expect(chart.totals.refundsMinor).toBe(2500);
  });

  test("currency, shoot and exact date boundaries match the existing summary without currency conversion", () => {
    const rows = [
      row("inside", { date: "2026-09-02", amountMinor: 123 }),
      row("early", { date: "2026-09-01", amountMinor: 400 }),
      row("late", { date: "2026-09-04", amountMinor: 500 }),
      row("foreign", { date: "2026-09-02", currency: "JPY", amountMinor: 1234 }),
      row("other-shoot", { date: "2026-09-02", shootId: "shoot-b", amountMinor: 2000 }),
      row("unassigned", { date: "2026-09-02", shootId: null, linked: false, amountMinor: 321 }),
    ];
    const selected = {
      ...options,
      period: { from: "2026-09-02", to: "2026-09-03" },
      shootId: "shoot-a",
    };
    expect(buildEarningsCharts(rows, selected).totals.collectedMinor).toBe(123);
    expect(buildEarningsCharts(rows, { ...selected, currency: "JPY" }).totals.collectedMinor).toBe(
      1234,
    );
    expect(buildEarningsCharts(rows, { ...selected, shootId: null }).totals.collectedMinor).toBe(
      321,
    );
    expect(buildEarningsCharts(rows, selected).months).toHaveLength(1);
  });

  test("unpaid invoices, transfers, test-mode, pending/failed/unlinked or unreconciled rows never become cash flow", () => {
    const rows = [
      row("invoice", { accounting: "invoice", type: "invoice", status: "paid" }),
      row("payout", { accounting: "transfer", type: "payout" }),
      row("legacy", { accounting: "unreconciled", source: "legacy" }),
      row("test", { eligibleForTotals: false, status: "test-paid", source: "stripe" }),
      row("pending", { eligibleForTotals: false, status: "pending", source: "stripe" }),
      row("failed", { eligibleForTotals: false, status: "failed", source: "stripe" }),
      row("unlinked", { eligibleForTotals: false, linked: false, shootId: null, source: "stripe" }),
      row("undated", { date: null }),
      row("unknown-currency", { currency: null }),
    ];
    const result = buildEarningsCharts(rows, options);
    expect(result.hasActivity).toBe(false);
    expect(result.months).toEqual([]);
    expect(result.incomeCategories).toEqual([]);
    expect(result.totals.collectedMinor).toBe(0);
  });

  test("positive categories have deterministic ordering/fallbacks and never hide negative-only cash flow", () => {
    const chart = buildEarningsCharts(
      [
        row("a", { category: "B", amountMinor: 100 }),
        row("b", { category: "A", amountMinor: 100 }),
        row("blank", { category: "  ", amountMinor: 200 }),
        row("expense", { accounting: "expense", category: "", amountMinor: 20 }),
      ],
      options,
    );
    expect(chart.incomeCategories).toEqual([
      { category: "Uncategorized income", amountMinor: 200 },
      { category: "A", amountMinor: 100 },
      { category: "B", amountMinor: 100 },
    ]);
    expect(chart.expenseCategories).toEqual([
      { category: "Uncategorized expenses", amountMinor: 20 },
    ]);
    const negative = buildEarningsCharts(
      [row("refund", { accounting: "refund", amountMinor: -50 })],
      options,
    );
    expect(negative.hasActivity).toBe(true);
    expect(negative.incomeCategories).toEqual([]);
    expect(negative.months[0]!.collectedMinor).toBe(-50);
  });

  test("bounded monthly ranges fill only calendar gaps, all-dates use recorded endpoints, empty stays empty", () => {
    const rows = [row("one", { date: "2026-03-12" })];
    const year = buildEarningsCharts(rows, {
      ...options,
      period: { from: "2026-01-01", to: "2026-04-12" },
    });
    expect(year.months.map((value) => value.month)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
    expect(year.months[0]!.collectedMinor).toBe(0);
    expect(buildEarningsCharts(rows, options).months).toHaveLength(1);
    expect(
      buildEarningsCharts([], { ...options, period: { from: "2026-01-01", to: options.today } })
        .months,
    ).toEqual([]);
    expect(buildEarningsCharts([row("zero", { amountMinor: 0 })], options).hasActivity).toBe(false);
  });

  test("daily mode preserves partial-month endpoints, leap days and DST calendar labels", () => {
    const chart = buildEarningsCharts([row("leap", { date: "2024-02-29", amountMinor: 99 })], {
      ...options,
      period: { from: "2024-02-28", to: "2024-03-01" },
      granularity: "day",
    });
    expect(chart.granularity).toBe("day");
    expect(chart.points.map((value) => [value.date, value.collectedMinor])).toEqual([
      ["2024-02-28", 0],
      ["2024-02-29", 99],
      ["2024-03-01", 0],
    ]);
    expect(chart.months).toHaveLength(2);
    const dst = buildEarningsCharts([row("dst", { date: "2026-03-08" })], {
      ...options,
      period: { from: "2026-03-07", to: "2026-03-09" },
      granularity: "day",
    });
    expect(dst.points.map((value) => value.date)).toEqual([
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
    ]);
    expect(buildEarningsCharts([], { ...options, granularity: "day" }).points).toEqual([]);
  });

  test("incomplete provider data stays incomplete rather than a fabricated verified graph", () => {
    const result = buildEarningsCharts([row("recorded")], { ...options, complete: false });
    expect(result.complete).toBe(false);
    expect(result.totals.collectedMinor).toBe(10000);
  });

  test("extreme calendar ranges bound zero filling without truncating historical money", () => {
    const rows = [
      row("ancient", { date: "0001-01-01", amountMinor: 1 }),
      row("current", { amountMinor: 2 }),
    ];
    const chart = buildEarningsCharts(rows, { ...options, granularity: "day" });
    expect(chart.months).toHaveLength(2);
    expect(chart.points).toHaveLength(2);
    expect(chart.omittedEmptyMonths).toBeGreaterThan(1200);
    expect(chart.omittedEmptyPoints).toBeGreaterThan(3660);
    expect(chart.totals.collectedMinor).toBe(3);
  });

  test("invalid calendar precision, duplicate identities, unsupported currency and unsafe sums fail closed", () => {
    for (const date of ["2026-09", "2026-02-29", "2026-09-08T00:00:00Z", ""])
      expect(() => buildEarningsCharts([row("one", { date })], options)).toThrow();
    expect(() =>
      buildEarningsCharts([], { ...options, period: { from: "2026-09-09", to: "2026-09-08" } }),
    ).toThrow();
    expect(() => buildEarningsCharts([], { ...options, period: { from: "", to: null } })).toThrow();
    expect(() => buildEarningsCharts([], { ...options, currency: "usd" })).toThrow();
    expect(() => buildEarningsCharts([], { ...options, currency: "ZZZ" })).toThrow();
    expect(() => buildEarningsCharts([row("same"), row("same")], options)).toThrow();
    for (const amountMinor of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() => buildEarningsCharts([row("invalid", { amountMinor })], options)).toThrow();
    expect(() =>
      buildEarningsCharts(
        [
          row("large", { amountMinor: Number.MAX_SAFE_INTEGER }),
          row("overflow", { amountMinor: 1 }),
        ],
        options,
      ),
    ).toThrow();
  });

  test("1,000 deterministic datasets reconcile every point, category and correction to ledger totals", () => {
    for (let seed = 0; seed < 1000; seed++) {
      const rows = Array.from({ length: 12 }, (_, i) =>
        row(`${seed}:${i}`, {
          date: `2026-${String((i % 9) + 1).padStart(2, "0")}-${String((seed % 27) + 1).padStart(2, "0")}`,
          amountMinor: i % 5 === 0 ? -(seed + i) : seed * 7 + i,
          accounting: i % 5 === 0 ? "refund" : i % 3 === 0 ? "expense" : "collection",
          category: `Category ${i % 3}`,
          currency: i % 7 === 0 ? "JPY" : "USD",
          shootId: i % 4 === 0 ? "shoot-b" : "shoot-a",
          eligibleForTotals: i % 11 !== 0,
        }),
      );
      const selected = {
        ...options,
        shootId: seed % 2 === 0 ? "shoot-a" : "shoot-b",
        granularity: seed % 2 === 0 ? ("day" as const) : ("month" as const),
      };
      const chart = buildEarningsCharts(rows, selected);
      const expected = summarizeEarnings(rows, selected).find((value) => value.currency === "USD")!;
      for (const key of ["collectedMinor", "refundsMinor", "expensesMinor", "netMinor"] as const) {
        expect(chart.totals[key]).toBe(expected[key]);
        expect(chart.months.reduce((sum, value) => sum + value[key], 0)).toBe(expected[key]);
        expect(chart.points.reduce((sum, value) => sum + value[key], 0)).toBe(expected[key]);
      }
      expect(chart.incomeCategories.every((value) => value.amountMinor > 0)).toBe(true);
      expect(chart.expenseCategories.every((value) => value.amountMinor > 0)).toBe(true);
      expect(
        chart.incomeCategories.reduce((sum, value) => sum + value.amountMinor, 0) +
          chart.totals.collectionAdjustmentsMinor -
          chart.totals.refundsMinor,
      ).toBe(expected.collectedMinor);
      expect(
        chart.expenseCategories.reduce((sum, value) => sum + value.amountMinor, 0) +
          chart.totals.expenseAdjustmentsMinor,
      ).toBe(expected.expensesMinor);
    }
  });
});
