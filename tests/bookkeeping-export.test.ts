import { describe, expect, test } from "bun:test";
import {
  bookkeepingCsv,
  bookkeepingTotals,
  categoryExport,
  entriesForYear,
  ledgerExport,
  type BookkeepingEntry,
} from "../src/lib/bookkeeping-export";
import { projectDisplayTitle, shootDisplayTitle } from "../src/lib/workspace-labels";

const entry = (patch: Partial<BookkeepingEntry> = {}): BookkeepingEntry => ({
  id: "test",
  date: "2026-01-01",
  kind: "income",
  amount: 100,
  category: "Portraits",
  label: "Portrait session",
  eventId: null,
  source: "manual",
  ...patch,
});

describe("project and shoot presentation", () => {
  test("shows stored titles; Shoot #N is creation order, not a display remap", () => {
    expect(shootDisplayTitle({ title: "Shoot #1", named: true })).toBe("Shoot #1");
    expect(shootDisplayTitle({ title: "Napa wedding", named: true })).toBe("Napa wedding");
    expect(projectDisplayTitle({ title: "Shoot #1" })).toBe("Shoot #1");
    expect(projectDisplayTitle({ title: "Untitled shoot", named: false })).toBe("Untitled shoot");
    expect(projectDisplayTitle({ title: "Raw-Photos" })).toBe("Raw-Photos");
  });
});

describe("bookkeeping exports", () => {
  test("filters exact calendar years without modifying or dropping saved records", () => {
    const rows = [
      entry({ date: "2025-12-31" }),
      entry(),
      entry({ date: "2026-12-31" }),
      entry({ date: "2027-01-01" }),
    ];
    const snapshot = JSON.stringify(rows);
    expect(entriesForYear(rows, "2026")).toHaveLength(2);
    expect(entriesForYear(rows, "2024")).toEqual([]);
    expect(entriesForYear(rows, "all")).toEqual(rows);
    expect(JSON.stringify(rows)).toBe(snapshot);
    expect(() => entriesForYear(rows, "26")).toThrow();
  });
  test("keeps cents, losses, and the full recorded cost of meals", () => {
    expect(
      bookkeepingTotals([
        entry({ amount: 0.1 }),
        entry({ amount: 0.2 }),
        entry({ kind: "expense", category: "Meals (50%)", amount: 20 }),
      ]),
    ).toEqual({ income: 0.3, expense: 20, net: -19.7 });
    expect(
      categoryExport([entry({ kind: "expense", category: "Meals (50%)", amount: 20 })], "2026"),
    ).toContain('"20.00","USD"');
  });
  test("exports IDs, accurate dates, original descriptions, currency and source", () => {
    const csv = ledgerExport(
      [entry({ label: 'Client, "A"\nsecond line', eventId: "project-1" })],
      "2026",
      () => "Project, A",
    );
    expect(csv).toContain('"Client, ""A""\nsecond line"');
    expect(csv).toContain('"project-1","Project, A","100.00","USD","manual"');
    expect(csv).not.toContain("Schedule C");
  });
  test("neutralizes formula injection including whitespace-prefixed formulas", () => {
    for (const value of ["=1+1", "+SUM(A1)", "-1+2", "@SUM(A1)", "\t=1", " \r\n@SUM(A1)"]) {
      expect(bookkeepingCsv([[value]])).toStartWith("\"'");
    }
    expect(bookkeepingCsv([[-20]])).toBe('"-20"\r\n');
    expect(bookkeepingCsv([["-19.70"]])).toBe('"-19.70"\r\n');
  });
  test("rejects nonfinite and unsafe values instead of exporting fabricated totals", () => {
    for (const amount of [NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
      expect(() => ledgerExport([entry({ amount })], "all")).toThrow();
    }
  });
  test("empty export has headers, summary is explicitly bookkeeping rather than taxable income", () => {
    expect(ledgerExport([], "all").trim().split("\r\n")).toHaveLength(1);
    expect(categoryExport([], "all")).toContain("not taxable income");
  });
  test("1,000 deterministic income and expense scenarios reconcile to integer cents", () => {
    for (let i = 0; i < 1000; i++) {
      const incomeCents = i * 127 + 1;
      const expenseCents = (1000 - i) * 53;
      const rows = [
        entry({ amount: incomeCents / 100 }),
        entry({ kind: "expense", amount: expenseCents / 100 }),
      ];
      expect(bookkeepingTotals(rows)).toEqual({
        income: incomeCents / 100,
        expense: expenseCents / 100,
        net: (incomeCents - expenseCents) / 100,
      });
    }
  });
});
