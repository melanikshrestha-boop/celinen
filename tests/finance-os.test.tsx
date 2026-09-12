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
  monthDays: [
    {
      date: "2026-09-08",
      collectedMinor: 130000,
      expensesMinor: 0,
      netMinor: 130000,
    },
  ],
  recentMonths: [
    { month: "2026-04", collectedMinor: 0, expensesMinor: 0, netMinor: 0 },
    { month: "2026-05", collectedMinor: 80000, expensesMinor: 10000, netMinor: 70000 },
    { month: "2026-06", collectedMinor: 0, expensesMinor: 0, netMinor: 0 },
    { month: "2026-07", collectedMinor: 0, expensesMinor: 0, netMinor: 0 },
    { month: "2026-08", collectedMinor: 0, expensesMinor: 0, netMinor: 0 },
    { month: "2026-09", collectedMinor: 250000, expensesMinor: 70000, netMinor: 180000 },
  ],
};

test("analytics filters are Origin pills, not native Mac selects", () => {
  const workspace = readFileSync(
    new URL("../src/components/earnings/EarningsWorkspace.tsx", import.meta.url),
    "utf8",
  );
  expect(workspace).toContain("BooksFilter");
  expect(workspace).toContain("This month");
  expect(workspace).not.toContain('label="Appearance"');
  expect(workspace).not.toContain('value: "system"');
  expect(workspace).not.toMatch(/<select[\s\S]*This month/);
  expect(workspace).not.toMatch(/<select[\s\S]*All shoots/);
  const landing = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
  expect(landing).not.toContain("AnalyticsSection");
  expect(landing).not.toContain("USD 4,280");
  const overview = readFileSync(
    new URL("../src/components/earnings/FinanceOverview.tsx", import.meta.url),
    "utf8",
  );
  expect(overview).toContain("SpendSankey");
  const sankey = readFileSync(
    new URL("../src/components/earnings/SpendSankey.tsx", import.meta.url),
    "utf8",
  );
  expect(sankey).toContain("spend-sankey__bar");
  expect(sankey).not.toContain("<rect");
});

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
  expect(html).toContain("finance-os__hero-figure");
  expect(html).toContain("USD 2500.00");
  expect(html).toContain("Jordan");
  expect(html).toContain("Allocation");
  expect(html).toContain("Weddings");
  expect(html).toContain("Upcoming");
  expect(html).toContain("Paid jobs");
  expect(html).toContain("Open invoices");
  expect(html).toContain("Gallery sales");
  expect(html).toContain("finance-os__stage");
  expect(html).not.toContain("finance-os__monthcal");
  expect(html).not.toContain("Collected this month");
  expect(html).not.toContain("Category breakdown");
  expect(html).toContain("spend-sankey__bar");
  expect(html).not.toContain("finance-os__bars");
  expect(html).not.toContain("Apollo Bagels");
  expect(html).not.toContain("$5,070");
  expect(html).not.toContain("Origin");
});

test("yearly goal is chips and collected, not HoneyBook copy or insurance", () => {
  const html = renderToStaticMarkup(
    createElement(FinanceOverview, {
      books,
      rows: [],
      today: "2026-09-10",
      money: (value) => `USD ${(value / 100).toFixed(2)}`,
      onOpen: () => {},
      yearCollectedMinor: 250000,
      goalMinor: null,
      onGoal: () => {},
      onAsk: () => {},
    }),
  );
  expect(html).toContain("40k");
  expect(html).toContain("Ask");
  expect(html).not.toContain("New year, new goals");
  expect(html).not.toContain("small business insurance");
  expect(html).not.toContain("QuickBooks");
  const set = renderToStaticMarkup(
    createElement(FinanceOverview, {
      books,
      rows: [],
      today: "2026-09-10",
      money: (value) => `USD ${(value / 100).toFixed(2)}`,
      onOpen: () => {},
      yearCollectedMinor: 250000,
      goalMinor: 4_000_000,
      onGoal: () => {},
    }),
  );
  expect(set).toContain("progressbar");
  expect(set).toContain("/ mo");
  expect(set).not.toContain("40k");
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

test("finance os is light by default and only dark under html.dark", () => {
  const css = readFileSync(new URL("../src/components/earnings/finance-os.css", import.meta.url), "utf8");
  expect(css).toContain("--fos-neon: #4d6fff");
  expect(css).toContain("--fos-bg: #f4f3f0");
  expect(css).toContain("color-scheme: light");
  expect(css).toMatch(/:root\.dark[\s\S]*--fos-bg: #0c0c0c/);
  expect(css).toMatch(/:root\.dark[\s\S]*color-scheme: dark/);
  expect(css).toContain(".finance-os__cta");
  expect(css).toMatch(/\.finance-os \.finance-os__board\s*\{[^}]*border: 0/);
  expect(css).toMatch(/\.finance-os \.finance-os__card\s*\{[^}]*border: 0/);
  const os = readFileSync(new URL("../src/components/earnings/FinanceOs.tsx", import.meta.url), "utf8");
  expect(os).not.toContain("finance-os__mark");
});
