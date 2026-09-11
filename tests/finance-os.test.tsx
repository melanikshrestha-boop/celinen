import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { FinanceOs, readFinanceDesk } from "../src/components/earnings/FinanceOs";
import { FinanceOverview } from "../src/components/earnings/FinanceOverview";
import { FinanceEquity, FinanceInvest } from "../src/components/earnings/FinanceDesks";
import type { PhotographerBooks } from "../src/lib/photographer-books";

const books: PhotographerBooks = {
  currency: "USD",
  collectedMinor: 250000,
  netMinor: 180000,
  expensesMinor: 70000,
  gallerySalesMinor: 0,
  outstandingMinor: 40000,
  overdueMinor: 0,
  previousCollectedMinor: 200000,
  previousNetMinor: 150000,
  previousExpensesMinor: 50000,
  previousGalleryMinor: 0,
  openInvoices: 1,
  paidThisPeriod: 2,
  expenseCount: 1,
  payoutCount: 0,
  spark: [
    { date: "2026-09-01", collectedMinor: 100000, netMinor: 80000, expensesMinor: 20000, galleryMinor: 0 },
    { date: "2026-09-08", collectedMinor: 250000, netMinor: 180000, expensesMinor: 70000, galleryMinor: 0 },
  ],
  incomeLines: [{ label: "Weddings", amountMinor: 250000 }],
  expenseLines: [{ label: "Equipment", amountMinor: 70000 }],
  stream: [
    {
      id: "row-1",
      who: "Jordan",
      label: "Wedding balance",
      amountMinor: 150000,
      date: "2026-09-08",
      kind: "in",
    },
  ],
};

test("finance desk reads the books query and lists Origin-style tracks", () => {
  expect(readFinanceDesk("")).toBe("earnings");
  expect(readFinanceDesk("?desk=invest")).toBe("invest");
  expect(readFinanceDesk("?desk=nope")).toBe("earnings");
  const html = renderToStaticMarkup(
    createElement(FinanceOs, {
      desk: "earnings",
      onDesk: () => {},
      onInvoice: () => {},
      children: "body",
    }),
  );
  expect(html).toContain("Earnings");
  expect(html).toContain("Transactions");
  expect(html).toContain("Invest");
  expect(html).toContain("Forecast");
  expect(html).toContain("Equity");
  expect(html).toContain("Tax");
  expect(html).toContain("New invoice");
});

test("overview paints ledger totals, not Origin demo merchants", () => {
  const html = renderToStaticMarkup(
    createElement(FinanceOverview, {
      books,
      rows: [],
      today: "2026-09-10",
      money: (value) => `USD ${(value / 100).toFixed(2)}`,
      onOpen: () => {},
    }),
  );
  expect(html).toContain("Earned this period");
  expect(html).toContain("USD 2500.00");
  expect(html).toContain("Jordan");
  expect(html).toContain("Category breakdown");
  expect(html).toContain("Upcoming");
  expect(html).not.toContain("Apollo Bagels");
  expect(html).not.toContain("$5,070");
  expect(html).not.toContain("Origin");
});

test("invest and equity stay honest about photographer books", () => {
  const invest = renderToStaticMarkup(
    createElement(FinanceInvest, {
      books,
      rows: [],
      money: (value) => `USD ${(value / 100).toFixed(2)}`,
    }),
  );
  expect(invest).toContain("not a brokerage");
  const equity = renderToStaticMarkup(
    createElement(FinanceEquity, {
      books,
      money: (value) => `USD ${(value / 100).toFixed(2)}`,
    }),
  );
  expect(equity).toContain("USD 1800.00");
  expect(equity).toContain("Receivables");
  expect(equity).not.toContain("325,47");
});

test("finance os css stays dark and neon for the invoice CTA", () => {
  const css = readFileSync(new URL("../src/components/earnings/finance-os.css", import.meta.url), "utf8");
  expect(css).toContain("--fos-neon: #4d6fff");
  expect(css).toContain("color-scheme: dark");
  expect(css).toContain(".finance-os__cta");
});
