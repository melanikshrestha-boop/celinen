import { describe, expect, test } from "bun:test";
import {
  activityHeat,
  compactChartAmount,
  daysInMonth,
  monthEndDate,
  recentMonthKeys,
} from "../src/lib/finance-graphs";
import { buildPhotographerBooks } from "../src/lib/photographer-books";
import type { EarningsRow } from "../src/lib/earnings-ledger";

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
    amountMinor: 130000,
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

describe("photographer chart labels", () => {
  test("compact cells match Origin-style $80 / $1.3K and never invent a zero dollar", () => {
    expect(compactChartAmount(0, "USD")).toBe("–");
    expect(compactChartAmount(400, "USD")).toBe("$4");
    expect(compactChartAmount(8000, "USD")).toBe("$80");
    expect(compactChartAmount(130000, "USD")).toBe("$1.3K");
    expect(activityHeat(0, 100)).toBe(0);
    expect(activityHeat(80, 100)).toBe(3);
  });

  test("month boards fill empty days and six months from the ledger, not a demo series", () => {
    expect(monthEndDate("2026-09")).toBe("2026-09-30");
    expect(daysInMonth("2026-09")).toHaveLength(30);
    expect(recentMonthKeys("2026-09-10", 6)).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
    const books = buildPhotographerBooks(
      [
        row("sep"),
        row("may", { id: "may", sourceId: "may", date: "2026-05-02", amountMinor: 80000 }),
      ],
      { period: { from: "2026-09-01", to: "2026-09-30" }, today: "2026-09-10", currency: "USD" },
    );
    expect(books.monthDays).toHaveLength(30);
    expect(books.monthDays.find((day) => day.date === "2026-09-08")?.collectedMinor).toBe(130000);
    expect(books.monthDays.find((day) => day.date === "2026-09-01")?.collectedMinor).toBe(0);
    expect(books.recentMonths.map((row) => row.month)).toEqual(recentMonthKeys("2026-09-10", 6));
    expect(books.recentMonths.find((row) => row.month === "2026-05")?.collectedMinor).toBe(80000);
    expect(books.recentMonths.find((row) => row.month === "2026-04")?.collectedMinor).toBe(0);
  });
});
