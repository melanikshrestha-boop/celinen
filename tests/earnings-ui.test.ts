import { describe, expect, test } from "bun:test";
import {
  earningsPeriodRange,
  safePaymentUrl,
  invoiceDraftCsv,
  formatEarningsMoney,
} from "../src/components/earnings/earnings-ui";
import { legacyWorkbenchRedirect, scopeToolHref } from "../src/lib/workbench-projects";
import { primaryNavigationPath } from "../src/components/workbench/primary-navigation";

describe("Earnings UI boundaries", () => {
  test("old bookmarks resolve to the canonical primary surface without losing context", () => {
    expect(legacyWorkbenchRedirect("/money?shoot=legacy#ledger", null, true)).toEqual({
      href: "/earnings?shoot=legacy#ledger",
    });
    expect(legacyWorkbenchRedirect("/earnings", null, true)).toBeNull();
    expect(primaryNavigationPath("/money")).toBe("/earnings");
    expect(primaryNavigationPath("/earnings")).toBe("/earnings");
    expect(scopeToolHref("/earnings", { kind: "ready", projectId: "unused" })).toBe("/earnings");
  });
  test("calendar filters never include future cash by default", () => {
    expect(earningsPeriodRange("month", "2026-09-08")).toEqual({
      from: "2026-09-01",
      to: "2026-09-08",
    });
    expect(earningsPeriodRange("year", "2026-09-08")).toEqual({
      from: "2026-01-01",
      to: "2026-09-08",
    });
    expect(earningsPeriodRange("all", "2026-09-08")).toEqual({ from: null, to: null });
  });
  test("receipts cannot navigate to unsafe or impostor payment domains", () => {
    for (const value of [
      null,
      "",
      "javascript:alert(1)",
      "data:text/html,x",
      "https://invoice.stripe.com.evil.test/a",
      "https://invoice.stripe.com@evil.test/a",
      "https://user:password@invoice.stripe.com/a",
      "http://invoice.stripe.com/a",
      "/api/refund",
    ])
      expect(safePaymentUrl(value)).toBeNull();
    expect(safePaymentUrl("https://invoice.stripe.com/i/example")).toBe(
      "https://invoice.stripe.com/i/example",
    );
  });
  test("draft export is explicitly not a paid receipt or sent invoice and neutralizes formulas", () => {
    const csv = invoiceDraftCsv({
      id: "draft-1",
      clientName: '=HYPERLINK("bad")',
      clientEmail: null,
      description: "Sports coverage",
      amountCents: 120050,
      dueDate: null,
      shootId: "legacy",
    });
    expect(csv).toContain("Draft — not sent");
    expect(csv).toContain("'=");
    expect(csv).toContain('"120050"');
    expect(csv).toContain('"USD"');
    expect(csv).toContain('"legacy"');
  });
  test("currency formatting respects zero and three-decimal units", () => {
    expect(formatEarningsMoney(12345, "USD")).toBe("$123.45");
    expect(formatEarningsMoney(12345, "JPY")).toContain("12,345");
    expect(formatEarningsMoney(12345, "KWD")).toContain("12.345");
  });
});
