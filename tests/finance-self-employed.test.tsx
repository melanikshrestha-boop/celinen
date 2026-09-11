import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  FinanceEquity,
  FinanceForecast,
  FinanceInvest,
  FinanceTax,
  type FinanceDeskScope,
} from "../src/components/earnings/FinanceDesks";
import { FinanceTaxHub, RetirementPathways } from "../src/components/earnings/FinanceTaxHub";
import {
  FEDERAL_ESTIMATED_DATES_2026,
  RETIREMENT_PATHWAYS,
  SELF_EMPLOYED_REFERENCE,
  TAX_RECORD_CHECKLIST,
  TAX_SOURCES,
} from "../src/lib/self-employed-resources";
import { buildPhotographerBooks } from "../src/lib/photographer-books";
import { PRODUCT_NAME } from "../src/lib/product";
import {
  buildEarningsLedger,
  type EarningsInvoice,
  type EarningsRow,
} from "../src/lib/earnings-ledger";

const money = (minor: number) => `USD ${(minor / 100).toFixed(2)}`;
const scope: FinanceDeskScope = {
  currency: "USD",
  period: { from: "2026-09-01", to: "2026-09-30" },
  shootId: "shoot-a",
  complete: true,
};
function row(id: string, overrides: Partial<EarningsRow> = {}): EarningsRow {
  return {
    id,
    sourceId: id,
    date: "2026-09-01",
    shootId: "shoot-a",
    who: id,
    clientId: null,
    description: id,
    category: "",
    type: "invoice",
    status: "open",
    amountMinor: 12025,
    currency: "USD",
    source: "invoice",
    accounting: "invoice",
    outstandingMinor: 12025,
    dueDate: "2026-09-15",
    eligibleForTotals: true,
    linked: true,
    warnings: [],
    ...overrides,
  };
}
const scopeBooks = (rows: readonly EarningsRow[]) =>
  buildPhotographerBooks(rows, {
    currency: scope.currency,
    period: scope.period,
    shootId: scope.shootId,
    today: "2026-09-10",
  });

test("tax references specify 2026, reviewed date, federal scope and original official destinations", () => {
  expect(SELF_EMPLOYED_REFERENCE.year).toBe(2026);
  expect(SELF_EMPLOYED_REFERENCE.reviewedOn).toBe("2026-09-10");
  expect(FEDERAL_ESTIMATED_DATES_2026.map((item) => item.date)).toEqual([
    "2026-04-15",
    "2026-06-15",
    "2026-09-15",
    "2027-01-15",
  ]);
  for (const source of Object.values(TAX_SOURCES)) {
    const url = new URL(source);
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("www.irs.gov");
    expect(url.search).toBe("");
  }
  const html = renderToStaticMarkup(createElement(FinanceTaxHub));
  for (const label of [
    "Schedule C",
    "Schedule SE",
    "Form 1040-ES",
    "2026 estimated-payment calendar",
    "State, local and cross-border",
    "not four equal calendar quarters",
    "Payment status is not tracked here",
  ])
    expect(html).toContain(label);
  expect(html).toContain('dateTime="2027-01-15"');
  expect(html).toContain('dateTime="2026-09-10"');
  expect(html).not.toContain("Tax paid");
  expect(html).not.toContain("File now");
});

test("record checklist is usable native form controls without persistence or filing", () => {
  const html = renderToStaticMarkup(createElement(FinanceTaxHub));
  expect((html.match(/type="checkbox"/g) ?? []).length).toBe(TAX_RECORD_CHECKLIST.length);
  expect((html.match(/<label>/g) ?? []).length).toBe(TAX_RECORD_CHECKLIST.length);
  expect(html).toContain("<fieldset");
  expect(html).toContain("aria-describedby=");
  expect(html).toContain("Tax preparation records");
  expect(html).toContain("Marks reset when you leave this desk");
  expect(html).not.toContain('checked=""');
  expect(html).not.toContain("<form");
  for (const path of [
    "../src/lib/self-employed-resources.ts",
    "../src/components/earnings/FinanceTaxHub.tsx",
    "../src/components/earnings/FinanceDesks.tsx",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    expect(source).not.toMatch(
      /localStorage|indexedDB|sessionStorage|createServerFn|useServerFn|fetch\s*\(/,
    );
  }
});

test("retirement pathways describe plan limits, not personal investment balances or contribution advice", () => {
  const html = renderToStaticMarkup(createElement(RetirementPathways));
  expect((html.match(/<summary>/g) ?? []).length).toBe(4);
  for (const plan of RETIREMENT_PATHWAYS) expect(html).toContain(plan.title);
  for (const text of [
    "USD 24,500",
    "USD 72,000",
    "USD 17,000",
    "USD 18,100",
    "USD 7,500",
    "USD 1,100",
    "shared across",
    "not both",
    "does not open accounts",
  ])
    expect(html).toContain(text);
  expect(html).not.toContain("Connect brokerage");
  expect(html).not.toContain("You can contribute");
  expect(html).toContain(`${PRODUCT_NAME} does not open accounts`);
  expect(html).toContain("Roth eligibility depends on income and filing status.");
});

test("equipment spending respects currency, shoot and period without mutating ledger records", () => {
  const expense = {
    type: "expense",
    accounting: "expense",
    status: "recorded",
    category: "Equipment",
    outstandingMinor: 0,
  } as const;
  const rows = [
    row("camera", { ...expense, amountMinor: 12345 }),
    row("other currency", { ...expense, currency: "EUR", amountMinor: 90000 }),
    row("other shoot", { ...expense, shootId: "shoot-b", amountMinor: 90000 }),
    row("last month", { ...expense, date: "2026-08-15", amountMinor: 90000 }),
    row("not eligible", { ...expense, eligibleForTotals: false, amountMinor: 90000 }),
  ];
  const before = JSON.stringify(rows);
  const html = renderToStaticMarkup(
    createElement(FinanceInvest, { books: scopeBooks(rows), rows, scope, money }),
  );
  expect(html.indexOf("Retirement pathways")).toBeLessThan(
    html.indexOf("Recorded equipment spending"),
  );
  expect(html).toContain("USD 123.45");
  expect(html).not.toContain("USD 900.00");
  expect(html).not.toContain("other currency");
  expect(html).not.toContain("last month");
  expect(html).toContain("not a brokerage balance");
  expect(JSON.stringify(rows)).toBe(before);
});

test("equity remains unavailable and a known period net remains explicitly cash flow", () => {
  const rows = [
    row("receipt", {
      type: "payment",
      accounting: "collection",
      amountMinor: 150025,
      outstandingMinor: 0,
    }),
  ];
  const books = scopeBooks(rows);
  const html = renderToStaticMarkup(createElement(FinanceEquity, { books, money }));
  const cards = html.split("<article");
  expect(cards[1]).toContain("Equity snapshot");
  expect(cards[1]).toContain("Unavailable");
  expect(cards[1]).not.toContain("USD 1500.25");
  expect(cards[2]).toContain("Recorded cash flow");
  expect(cards[2]).toContain("USD 1500.25");
  expect(cards[2]).toContain("Receivables");
  expect(html).toContain("assets minus liabilities");
});

test("verified cash books do not imply verified receivables or an empty invoice forecast", () => {
  const books = scopeBooks([
    row("payment", {
      type: "payment",
      accounting: "collection",
      amountMinor: 55025,
      outstandingMinor: 0,
    }),
  ]);
  const equity = renderToStaticMarkup(
    createElement(FinanceEquity, { books, money, balancesAvailable: false }),
  );
  expect(equity).toContain("USD 550.25");
  expect(equity).toContain("Receivables</dt><dd>—</dd>");
  expect(equity).toContain("Overdue</dt><dd>—</dd>");
  expect(equity).toContain("Invoice balances are unavailable");
  const forecast = renderToStaticMarkup(
    createElement(FinanceForecast, {
      rows: [],
      today: "2026-09-10",
      money,
      onOpen: () => {},
      scope: { ...scope, complete: true, invoiceBalancesAvailable: false },
    }),
  );
  expect(forecast).toContain("Forecast totals are unavailable");
  expect(forecast).not.toContain("Nothing scheduled");
  expect(forecast).not.toContain("USD 0.00");
  const confirmed = renderToStaticMarkup(
    createElement(FinanceForecast, {
      rows: [],
      today: "2026-09-10",
      money,
      onOpen: () => {},
      scope: { ...scope, complete: true, invoiceBalancesAvailable: true },
    }),
  );
  expect(confirmed).toContain("USD 0.00");
  expect(confirmed).toContain("Nothing scheduled");
});

test("expense corrections retain their sign and do not become an empty tax record", () => {
  const rows = [
    row("equipment correction", {
      type: "expense",
      accounting: "expense",
      category: "Equipment",
      amountMinor: -300,
      outstandingMinor: 0,
      status: "recorded",
    }),
  ];
  const books = scopeBooks(rows);
  const tax = renderToStaticMarkup(createElement(FinanceTax, { books, money }));
  expect(tax).toContain("USD -3.00");
  expect(tax).not.toContain("No expenses recorded");
  const invest = renderToStaticMarkup(createElement(FinanceInvest, { books, rows, scope, money }));
  expect(invest).toContain('data-kind="in">USD 3.00');
  expect(invest).not.toContain("−USD -3.00");
});

test("invoice forecast preserves exact balances, due order and scope without counting drafts or tests", () => {
  const rows = [
    row("later", { dueDate: "2026-10-10", amountMinor: 99999, outstandingMinor: 5000 }),
    row("today", { dueDate: "2026-09-10", outstandingMinor: 2025 }),
    row("older issued", { date: "2026-08-10", outstandingMinor: 1000 }),
    row("overdue", { dueDate: "2026-09-09" }),
    row("undated", { dueDate: null }),
    row("EUR", { currency: "EUR" }),
    row("other shoot", { shootId: "shoot-b" }),
    row("draft", { status: "draft" }),
    row("test", { eligibleForTotals: false, status: "test-open" }),
    row("future issued", { date: "2026-09-11" }),
    row("missing issued", { date: null }),
    row("paid", { status: "paid", outstandingMinor: 0 }),
  ];
  const before = JSON.stringify(rows);
  const html = renderToStaticMarkup(
    createElement(FinanceForecast, { rows, today: "2026-09-10", scope, money, onOpen: () => {} }),
  );
  expect(html).toContain("USD 80.25");
  expect(html).not.toContain("USD 999.99");
  expect(html.indexOf("<strong>today</strong>")).toBeLessThan(
    html.indexOf("<strong>later</strong>"),
  );
  expect(html).toContain("<strong>older issued</strong>");
  expect(html).not.toContain("<strong>EUR</strong>");
  expect(html).not.toContain("<strong>draft</strong>");
  expect(html).not.toContain("<strong>test</strong>");
  expect(html).not.toContain("<strong>missing issued</strong>");
  expect(html).toContain("not guaranteed cash");
  expect(html).toContain('dateTime="2026-09-10"');
  expect(html).toContain("Open invoices without a due date</dt><dd>1");
  expect(html).toContain("Overdue open invoices</dt><dd>1");
  expect(JSON.stringify(rows)).toBe(before);
});

test("invoice forecast retains actual ledger balances after workspace display-status projection", () => {
  const today = "2026-09-10";
  const invoice = (id: string, patch: Partial<EarningsInvoice> = {}): EarningsInvoice => ({
    id,
    createdAt: "2026-08-01T12:00:00Z",
    dueDate: "2026-09-18",
    amountMinor: 15000,
    outstandingMinor: 5025,
    currency: "USD",
    status: "open",
    shootId: "shoot-a",
    clientId: id,
    clientName: id,
    ...patch,
  });
  const ledger = buildEarningsLedger({
    today,
    period: scope.period,
    providerComplete: true,
    invoices: [
      invoice("Verified upcoming"),
      invoice("Verified due today", { dueDate: today, outstandingMinor: 1000 }),
      invoice("Verified overdue", { dueDate: "2026-09-09", outstandingMinor: 2000 }),
      invoice("Verified undated", { dueDate: null, outstandingMinor: 3000 }),
      invoice("Other currency", { currency: "EUR" }),
      invoice("Other shoot", { shootId: "shoot-b" }),
      invoice("Not issued", { createdAt: "2026-09-11T12:00:00Z" }),
      invoice("Draft", { status: "draft" }),
      invoice("Void", { status: "void" }),
      invoice("Unverified"),
    ],
  });
  // EarningsWorkspace projects canonical open statuses for ledger presentation.
  const rows = ledger.rows.map((entry) => ({
    ...entry,
    status:
      entry.sourceId === "Unverified"
        ? "unverified"
        : entry.status === "open"
          ? entry.dueDate && entry.dueDate < today
            ? "overdue"
            : "upcoming"
          : entry.status,
  }));
  expect(rows.find((entry) => entry.sourceId === "Verified upcoming")?.status).toBe("upcoming");
  expect(rows.find((entry) => entry.sourceId === "Verified overdue")?.status).toBe("overdue");
  const before = JSON.stringify(rows);
  const html = renderToStaticMarkup(
    createElement(FinanceForecast, {
      rows,
      today,
      scope: { ...scope, invoiceBalancesAvailable: true },
      money,
      onOpen: () => {},
    }),
  );
  expect(html).toContain("USD 60.25");
  expect(html).not.toContain("Nothing scheduled");
  expect(html).toContain("<strong>Verified upcoming</strong>");
  expect(html).toContain("<strong>Verified due today</strong>");
  expect(html.indexOf("Verified due today")).toBeLessThan(html.indexOf("Verified upcoming"));
  expect(html).toContain("Overdue open invoices</dt><dd>1");
  expect(html).toContain("Open invoices without a due date</dt><dd>1");
  for (const excluded of [
    "Other currency",
    "Other shoot",
    "Not issued",
    "Draft",
    "Void",
    "Unverified",
  ])
    expect(html).not.toContain(`<strong>${excluded}</strong>`);
  expect(JSON.stringify(rows)).toBe(before);
});

test("incomplete books and invalid reporting dates do not become confirmed zeros", () => {
  const tax = renderToStaticMarkup(createElement(FinanceTax, { books: null, money }));
  expect(tax).toContain("Expense records are unavailable");
  expect(tax).not.toContain("No expenses recorded");
  const invest = renderToStaticMarkup(
    createElement(FinanceInvest, {
      books: null,
      rows: [],
      scope: { ...scope, complete: false },
      money,
    }),
  );
  expect(invest).toContain("Equipment records are unavailable");
  expect(invest).not.toContain("USD 0.00");
  for (const props of [
    { today: "2026-09-10", scope: { ...scope, complete: false } },
    { today: "invalid", scope },
  ]) {
    const forecast = renderToStaticMarkup(
      createElement(FinanceForecast, { rows: [], money, onOpen: () => {}, ...props }),
    );
    expect(forecast).toContain("Forecast totals are unavailable");
    expect(forecast).not.toContain("USD 0.00");
    expect(forecast).not.toContain("Nothing scheduled");
  }
});
