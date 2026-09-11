import { describe, expect, test } from "bun:test";
import { buildPhotographerBooks } from "../src/lib/photographer-books";
import { summarizeEarnings, type EarningsRow } from "../src/lib/earnings-ledger";

function row(id: string, patch: Partial<EarningsRow> = {}): EarningsRow {
  return {
    id,
    sourceId: id,
    date: "2026-09-08",
    shootId: "shoot-a",
    who: "Client",
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

describe("photographer books", () => {
  test("collected and net match summarizeEarnings", () => {
    const rows = [
      row("in"),
      row("exp", { accounting: "expense", type: "expense", category: "Equipment", amountMinor: 2500 }),
    ];
    const options = { period: { from: "2026-09-01", to: "2026-09-30" }, today: "2026-09-10", currency: "USD" };
    const books = buildPhotographerBooks(rows, options);
    const metric = summarizeEarnings(rows, options).find((item) => item.currency === "USD")!;
    expect(books.collectedMinor).toBe(metric.collectedMinor);
    expect(books.expensesMinor).toBe(metric.expensesMinor);
    expect(books.netMinor).toBe(metric.netMinor);
    expect(books.paidThisPeriod).toBe(1);
    expect(books.expenseCount).toBe(1);
  });

  test("does not invent a prior period when the window is unbounded", () => {
    const books = buildPhotographerBooks([row("in")], {
      period: { from: null, to: null },
      today: "2026-09-10",
      currency: "USD",
    });
    expect(books.previousCollectedMinor).toBeNull();
  });

  test("activity stream lists newest eligible money first", () => {
    const books = buildPhotographerBooks(
      [
        row("old", { date: "2026-09-01", who: "Ada" }),
        row("new", { date: "2026-09-09", who: "Bea", amountMinor: 5000 }),
      ],
      { period: { from: "2026-09-01", to: "2026-09-30" }, today: "2026-09-10", currency: "USD" },
    );
    expect(books.stream[0]?.who).toBe("Bea");
    expect(books.stream[1]?.who).toBe("Ada");
  });
});
