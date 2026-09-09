import { describe, expect, test } from "bun:test";
import {
  allowedInvoicePreviousStatuses,
  assertSupportedInvoiceCurrency,
  readCompleteFinanceRows,
  type InvoiceMirrorStatus,
} from "../src/lib/earnings/finance-integrity.server";

describe("terminal invoice status guards", () => {
  test("delayed sent/draft cannot regress paid or void, or switch terminals", () => {
    for (const terminal of ["paid", "void"] as const) {
      for (const stale of ["draft", "sent", terminal === "paid" ? "void" : "paid"] as const)
        expect(allowedInvoicePreviousStatuses(stale)).not.toContain(terminal);
      expect(allowedInvoicePreviousStatuses(terminal)).toContain(terminal);
    }
  });
  test("concurrent invoice.sent update released after payment leaves paid", async () => {
    let status: InvoiceMirrorStatus = "draft";
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const save = async (next: InvoiceMirrorStatus, wait?: Promise<void>) => {
      if (wait) await wait;
      // Models the single atomic SQL UPDATE ... WHERE status IN (...).
      if (allowedInvoicePreviousStatuses(next).includes(status)) status = next;
    };
    const sent = save("sent", delayed);
    await save("paid");
    release();
    await sent;
    expect(status).toBe("paid");
    await save("draft");
    expect(status).toBe("paid");
  });
  test("unsupported legacy currency rejected, never silently converted", () => {
    expect(() => assertSupportedInvoiceCurrency("usd")).not.toThrow();
    for (const currency of ["eur", "jpy", "isk", "USD", ""])
      expect(() => assertSupportedInvoiceCurrency(currency)).toThrow(
        "original currency is preserved",
      );
  });
});

describe("complete bounded owned finance reads", () => {
  test("loads beyond default 1000 rows with exact count and preserves IDs", async () => {
    const rows = Array.from({ length: 2301 }, (_, i) => ({ id: String(i), amount: i }));
    const ranges: number[][] = [];
    const result = await readCompleteFinanceRows(async (from, to) => {
      ranges.push([from, to]);
      return { data: rows.slice(from, to + 1), count: rows.length, error: null };
    }, "Transactions");
    expect(result).toEqual(rows);
    expect(ranges).toEqual([
      [0, 499],
      [500, 999],
      [1000, 1499],
      [1500, 1999],
      [2000, 2499],
    ]);
  });
  test("verified empty result is allowed; read errors/missing count are not empty data", async () => {
    expect(
      await readCompleteFinanceRows(async () => ({ data: [], count: 0, error: null }), "Rows"),
    ).toEqual([]);
    for (const response of [
      { data: [], count: 0, error: new Error("RLS/network") },
      { data: null, count: 0, error: null },
      { data: [], count: null, error: null },
    ])
      await expect(readCompleteFinanceRows(async () => response, "Rows")).rejects.toThrow(
        "completely",
      );
  });
  test("server cap below requested page rejects incomplete collection", async () => {
    await expect(
      readCompleteFinanceRows(
        async () => ({ data: [{ id: "a" }], count: 3, error: null }),
        "Rows",
        { pageSize: 2 },
      ),
    ).rejects.toThrow("truncated");
  });
  test("row-count drift and duplicate IDs reject totals instead of shrinking history", async () => {
    await expect(
      readCompleteFinanceRows(
        async (from) => ({ data: [{ id: String(from) }], count: from ? 3 : 2, error: null }),
        "Rows",
        { pageSize: 1 },
      ),
    ).rejects.toThrow("changed");
    await expect(
      readCompleteFinanceRows(
        async () => ({ data: [{ id: "same" }], count: 2, error: null }),
        "Rows",
        { pageSize: 1 },
      ),
    ).rejects.toThrow("changed");
  });
  test("max rows and malformed totals fail closed", async () => {
    for (const count of [3, 1.5, -1, Number.NaN])
      await expect(
        readCompleteFinanceRows(async () => ({ data: [], count, error: null }), "Rows", {
          pageSize: 1,
          maxPages: 2,
        }),
      ).rejects.toThrow();
  });
});
