import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { FinanceOverview } from "../src/components/earnings/FinanceOverview";
import {
  FinanceEquity,
  FinanceForecast,
  FinanceInvest,
  FinanceTax,
} from "../src/components/earnings/FinanceDesks";
import { buildPhotographerBooks } from "../src/lib/photographer-books";
import {
  buildEarningsLedger,
  summarizeEarnings,
  type EarningsInvoice,
  type EarningsRow,
} from "../src/lib/earnings-ledger";
import { formatFinanceMoney } from "../src/lib/finance-money";
import { SpendSankey } from "../src/components/earnings/SpendSankey";

// Only immutable, synthetic ledger projections and server-rendered components.
// These tests must never open a real account, browser store, or payment service.
const today = "2026-09-10";
const period = { from: "2026-09-01", to: today };
const money = (minor: number) => formatFinanceMoney(minor, "USD");
const scope = { currency: "USD", period, shootId: "reserved-shoot-a", complete: true };

test("narrow Earnings charts keep their intrinsic ratio instead of desktop-height letterboxing", () => {
  const css = readFileSync(
    new URL("../src/components/earnings/finance-os.css", import.meta.url),
    "utf8",
  );
  const narrow = css.slice(css.indexOf("@container earnings (max-width: 620px)"));
  expect(narrow).toMatch(/\.finance-os__stage \.finance-os__plot\s*\{[^}]*min-height:\s*0/);
  expect(narrow).toMatch(/\.finance-os__stage \.finance-os__plot\s*\{[^}]*max-height:\s*none/);
});
function row(id: string, patch: Partial<EarningsRow> = {}): EarningsRow {
  return {
    id,
    sourceId: id,
    date: "2026-09-08",
    shootId: "reserved-shoot-a",
    who: "Reserved client",
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
function booksFor(rows: EarningsRow[]) {
  return buildPhotographerBooks(rows, { ...scope, today });
}

describe("finance dashboard preserves complete money and unknown states", () => {
  test.each([0, 1, 3, 10001])(
    "chart guides never send fractional minor units to money formatting (%s)",
    (amountMinor) => {
      const rows = [row("odd-minor-units", { amountMinor })];
      const amounts: number[] = [];
      const html = renderToStaticMarkup(
        <FinanceOverview
          books={booksFor(rows)}
          rows={rows}
          today={today}
          money={(value) => {
            amounts.push(value);
            return money(value);
          }}
          onOpen={() => {}}
        />,
      );
      expect(amounts.every(Number.isSafeInteger)).toBe(true);
      expect(html).toContain(money(amountMinor));
      if (amountMinor > 0) expect(html).toContain("Use Left and Right arrows to inspect dates");
    },
  );

  test("a positive-only category chart names its basis instead of pretending it equals net collections", () => {
    for (const donut of [true, false]) {
      const html = renderToStaticMarkup(
        <SpendSankey
          sourceLabel="Collected"
          sourceMinor={15000}
          slices={[
            { label: "Portraits", amountMinor: 20000 },
            { label: "Refunds", amountMinor: -5000 },
          ]}
          money={money}
          donut={donut}
        />,
      );
      expect(html).toContain("Positive categories");
      expect(html).toContain("$200.00");
      expect(html).toContain("The recorded total is $150.00 after refunds or corrections");
      expect(html).not.toContain('aria-label="Collected');
    }
  });

  test("collection entries are not presented as paid jobs or a refund-distorted average", () => {
    const rows = [
      row("deposit"),
      row("balance"),
      row("refund", { accounting: "refund", type: "refund", amountMinor: -5000 }),
    ];
    const html = renderToStaticMarkup(
      <FinanceOverview
        books={booksFor(rows)}
        rows={rows}
        today={today}
        money={money}
        onOpen={() => {}}
        balancesAvailable={false}
      />,
    );
    expect(html).toContain("<dt>Collection entries</dt><dd>2</dd>");
    expect(html).toContain("<dt>Open invoices</dt><dd>—</dd>");
    expect(html).not.toContain("Paid jobs");
    expect(html).not.toContain("Avg job");
    expect(html).toContain("Net cash flow");
    expect(html).toContain("vs previous equal-length period");
  });

  test("a fully refunded sale preserves its zero-valued chart and activity", () => {
    const rows = [
      row("receipt"),
      row("full-refund", { accounting: "refund", type: "refund", amountMinor: -10000 }),
    ];
    const books = booksFor(rows);
    const html = renderToStaticMarkup(
      <FinanceOverview books={books} rows={rows} today={today} money={money} onOpen={() => {}} />,
    );
    expect(books.collectedMinor).toBe(0);
    expect(html).toContain("Collected by date. Exact amounts in chart data below.");
    expect(html).toContain("Chart Data");
    expect(html).toContain("full-refund");
    expect(html).not.toContain("No recorded activity in this period.");
  });

  test("every positive category remains represented after the eighth category", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row(`reserved-income-${i}`, { category: `Category ${i + 1}`, amountMinor: 10001 + i }),
    );
    const books = booksFor(rows);
    const before = JSON.stringify({ rows, books });
    const html = renderToStaticMarkup(
      <FinanceOverview books={books} rows={rows} today={today} money={money} onOpen={() => {}} />,
    );
    expect(books.incomeLines).toHaveLength(12);
    expect(books.incomeLines.reduce((total, line) => total + line.amountMinor, 0)).toBe(
      books.collectedMinor,
    );
    for (const line of books.incomeLines)
      expect(html).toContain(`aria-label="${line.label}: ${money(line.amountMinor)}"`);
    expect(JSON.stringify({ rows, books })).toBe(before);
  });

  test("the rebuilt presentation never changes refund, correction, currency or shoot accounting", () => {
    const rows = [
      row("income"),
      row("refund", { accounting: "refund", amountMinor: -2500, type: "refund" }),
      row("equipment", {
        accounting: "expense",
        type: "expense",
        amountMinor: 3000,
        category: "Equipment",
      }),
      row("expense-correction", {
        accounting: "expense",
        type: "expense",
        amountMinor: -200,
        category: "Equipment",
      }),
      row("other-shoot", { shootId: "reserved-shoot-b", amountMinor: 90000 }),
      row("other-currency", { currency: "JPY", amountMinor: 90000 }),
      row("not-collected", { eligibleForTotals: false, amountMinor: 90000, status: "pending" }),
    ];
    const books = booksFor(rows);
    const summary = summarizeEarnings(rows, { ...scope, today }).find(
      (value) => value.currency === "USD",
    )!;
    const before = JSON.stringify({ rows, books });
    renderToStaticMarkup(
      <FinanceOverview books={books} rows={rows} today={today} money={money} onOpen={() => {}} />,
    );
    renderToStaticMarkup(<FinanceInvest books={books} rows={rows} money={money} scope={scope} />);
    renderToStaticMarkup(<FinanceEquity books={books} money={money} />);
    renderToStaticMarkup(<FinanceTax books={books} money={money} />);
    expect(books.collectedMinor).toBe(7500);
    expect(books.expensesMinor).toBe(2800);
    expect(books.netMinor).toBe(4700);
    expect(books.collectedMinor).toBe(summary.collectedMinor);
    expect(books.expensesMinor).toBe(summary.expensesMinor);
    expect(books.netMinor).toBe(summary.netMinor);
    expect(JSON.stringify({ rows, books })).toBe(before);
  });

  test("spending breakdown retains every expense category and its exact minor-unit amount", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row(`reserved-expense-${i}`, {
        accounting: "expense",
        type: "expense",
        category: `Expense ${i + 1}`,
        amountMinor: 7501 + i,
      }),
    );
    const books = booksFor(rows);
    const before = JSON.stringify({ rows, books });
    const html = renderToStaticMarkup(
      <FinanceOverview
        books={books}
        rows={rows}
        today={today}
        money={money}
        onOpen={() => {}}
        spending
      />,
    );
    expect(books.expenseLines).toHaveLength(12);
    expect(books.expenseLines.reduce((total, line) => total + line.amountMinor, 0)).toBe(
      books.expensesMinor,
    );
    for (const line of books.expenseLines)
      expect(html).toContain(`aria-label="${line.label}: ${money(line.amountMinor)}"`);
    expect(html).toContain(
      `aria-label="Expenses breakdown: ${money(books.expensesMinor)} across ${books.expenseLines.length} categories"`,
    );
    expect(JSON.stringify({ rows, books })).toBe(before);
  });

  test("refunds show one outgoing sign and expense credits show incoming cash without changing totals", () => {
    const rows = [
      row("reserved-sign-collection"),
      row("reserved-sign-refund", {
        who: "Refund client",
        accounting: "refund",
        type: "refund",
        amountMinor: -4500,
      }),
      row("reserved-sign-expense", {
        accounting: "expense",
        type: "expense",
        amountMinor: 3000,
      }),
      row("reserved-sign-expense-credit", {
        who: "Expense credit client",
        accounting: "expense",
        type: "expense",
        amountMinor: -1000,
      }),
    ];
    const books = booksFor(rows);
    const before = JSON.stringify({ rows, books });
    const html = renderToStaticMarkup(
      <FinanceOverview books={books} rows={rows} today={today} money={money} onOpen={() => {}} />,
    );
    expect(html).toMatch(/<em data-kind="out">[−-]\$45\.00<\/em>/);
    expect(html).toMatch(/<em data-kind="in">\+\$10\.00<\/em>/);
    expect(html).not.toMatch(/[−-]\s*[−-]\$/);
    expect(books.collectedMinor).toBe(5500);
    expect(books.expensesMinor).toBe(2000);
    expect(books.netMinor).toBe(3500);
    expect(JSON.stringify({ rows, books })).toBe(before);
  });

  test("unavailable overview is not a zero chart or a claim that transactions and invoices are empty", () => {
    const amounts: number[] = [];
    const html = renderToStaticMarkup(
      <FinanceOverview
        books={null}
        rows={[]}
        today={today}
        money={(value) => {
          amounts.push(value);
          return money(value);
        }}
        onOpen={() => {}}
      />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("Financial data unavailable");
    expect(html).not.toContain("<svg");
    expect(html).not.toMatch(/No recorded cash|No open invoices|No split in this period/);
    expect(amounts).toEqual([]);
  });

  test("upcoming payments excludes draft, void, unverified and not-yet-issued invoice balances", () => {
    const invoice = (id: string, patch: Partial<EarningsRow> = {}) =>
      row(id, {
        accounting: "invoice",
        type: "balance",
        status: "open",
        who: id,
        date: "2026-08-01",
        dueDate: "2026-09-18",
        amountMinor: 12000,
        outstandingMinor: 12000,
        ...patch,
      });
    const approved = invoice("Verified older-issued client");
    const rejected = [
      invoice("Draft client must not appear", { status: "draft" }),
      invoice("Void client must not appear", { status: "void" }),
      invoice("Unverified client must not appear", { eligibleForTotals: false }),
      invoice("Future-issued client must not appear", { date: "2026-09-11" }),
      invoice("Unknown issue date client must not appear", { date: null }),
      invoice("Other currency client must not appear", { currency: "JPY" }),
    ];
    const rows = [approved, ...rejected];
    const before = JSON.stringify(rows);
    const html = renderToStaticMarkup(
      <FinanceOverview
        books={booksFor(rows)}
        rows={rows}
        today={today}
        money={money}
        onOpen={() => {}}
      />,
    );
    expect(html).toContain(approved.who!);
    for (const value of rejected) expect(html).not.toContain(value.who!);
    expect(html).toContain("Due 2026-09-18");
    expect(JSON.stringify(rows)).toBe(before);
  });

  test("real ledger invoice balances survive the workspace upcoming and overdue display projection", () => {
    const invoices: EarningsInvoice[] = [
      {
        id: "reserved-projection-upcoming",
        createdAt: "2026-08-01T12:00:00Z",
        dueDate: "2026-09-18",
        amountMinor: 60000,
        outstandingMinor: 60000,
        currency: "USD",
        status: "open",
        shootId: scope.shootId,
        clientId: "reserved-projection-client-a",
        clientName: "Verified projected upcoming client",
      },
      {
        id: "reserved-projection-overdue",
        createdAt: "2026-08-01T12:00:00Z",
        dueDate: "2026-09-05",
        amountMinor: 20000,
        outstandingMinor: 17500,
        currency: "USD",
        status: "open",
        shootId: scope.shootId,
        clientId: "reserved-projection-client-b",
        clientName: "Verified projected overdue client",
      },
    ];
    const beforeInvoices = JSON.stringify(invoices);
    const ledger = buildEarningsLedger({
      invoices,
      period,
      today,
      timeZone: "UTC",
      providerComplete: true,
      shootId: scope.shootId,
    });
    expect(ledger.rows.map((value) => value.status)).toEqual(["open", "open"]);
    // EarningsWorkspace projects labels after the canonical ledger is built.
    // Exercise those real rows rather than fabricating already-open view data.
    const rows = ledger.rows.map((value) => ({
      ...value,
      status:
        value.status === "open"
          ? value.dueDate && value.dueDate < today
            ? "overdue"
            : "upcoming"
          : value.status,
    }));
    expect(new Set(rows.map((value) => value.status))).toEqual(new Set(["upcoming", "overdue"]));
    const books = booksFor(rows);
    const beforeRows = JSON.stringify(rows);
    const html = renderToStaticMarkup(
      <FinanceOverview
        books={books}
        rows={rows}
        today={today}
        money={money}
        onOpen={() => {}}
        balancesAvailable
      />,
    );
    expect(html).toContain("Verified projected upcoming client");
    expect(html).toContain("$600.00");
    expect(html).toContain("Overdue");
    expect(html).toContain("$175.00");
    expect(html).toContain("Due 2026-09-18");
    expect(html).not.toContain("No open invoices");
    expect(books.outstandingMinor).toBe(77500);
    expect(books.overdueMinor).toBe(17500);
    expect(JSON.stringify(rows)).toBe(beforeRows);
    expect(JSON.stringify(invoices)).toBe(beforeInvoices);
  });

  test("unavailable tax records do not claim no expenses were recorded", () => {
    const html = renderToStaticMarkup(<FinanceTax books={null} money={money} />);
    expect(html).toMatch(/unavailable/i);
    expect(html).not.toMatch(/No expenses recorded|\$0\.00/);
  });

  test("known cash books cannot fabricate verified invoice balances or a due calendar", () => {
    const rows = [
      row("reserved-known-income", { amountMinor: 34900 }),
      row("reserved-unavailable-balance", {
        accounting: "invoice",
        type: "balance",
        status: "open",
        who: "Provisional invoice client must not appear",
        amountMinor: 99999,
        outstandingMinor: 99999,
        dueDate: "2026-09-18",
      }),
    ];
    const html = renderToStaticMarkup(
      <FinanceOverview
        books={booksFor(rows)}
        rows={rows}
        today={today}
        money={money}
        onOpen={() => {}}
        balancesAvailable={false}
      />,
    );
    expect(html).toContain("$349.00");
    expect(html).toMatch(/<dt>Outstanding<\/dt><dd>—<\/dd>/);
    expect(html).toMatch(/unavailable/i);
    expect(html).not.toContain("$999.99");
    expect(html).not.toContain("Provisional invoice client must not appear");
    expect(html).not.toContain("2026-09-18, invoices due");
    expect(html).not.toContain("No open invoices");
  });

  test("unavailable equipment books do not publish a zero count or an empty gear log", () => {
    const html = renderToStaticMarkup(
      <FinanceInvest books={null} rows={[]} money={money} scope={{ ...scope, complete: false }} />,
    );
    expect(html).toMatch(/unavailable/i);
    expect(html).not.toMatch(/<dd>0<\/dd>|Tag expenses|\$0\.00/);
  });

  test("incomplete forecast data is unavailable, while a complete empty scope may report zero", () => {
    const amounts: number[] = [];
    const pending = renderToStaticMarkup(
      <FinanceForecast
        rows={[]}
        today={today}
        money={(value) => {
          amounts.push(value);
          return money(value);
        }}
        onOpen={() => {}}
        scope={{ ...scope, complete: false }}
      />,
    );
    expect(pending).toMatch(/unavailable/i);
    expect(pending).not.toMatch(/Nothing scheduled|\$0\.00|0 invoices/);
    expect(amounts).toEqual([]);
    const empty = renderToStaticMarkup(
      <FinanceForecast rows={[]} today={today} money={money} onOpen={() => {}} scope={scope} />,
    );
    expect(empty).toContain("$0.00");
  });
});

describe("workspace preference and public presentation theme boundaries", () => {
  test("AccountProvider applies the saved theme and current system preference", () => {
    const provider = readFileSync(
      new URL("../src/components/account/AccountProvider.tsx", import.meta.url),
      "utf8",
    );
    expect(provider).toMatch(/applyAppearance\(\s*preferences,\s*media\.matches\s*\)/);
    expect(provider).not.toMatch(/applyAppearance\(\s*\{\s*\.\.\.preferences,\s*theme:/);
    expect(provider).toContain('window.matchMedia("(prefers-color-scheme: dark)")');
    expect(provider).toContain('media.addEventListener("change", apply)');
    expect(provider).toContain('media.removeEventListener("change", apply)');
    expect(provider).toContain("[scope, preferences]");
  });

  test("public marketing and authentication keep separate scoped white surfaces", () => {
    const publicCss = readFileSync(
      new URL("../src/components/marketing/sky-entry.css", import.meta.url),
      "utf8",
    );
    const authCss = readFileSync(
      new URL("../src/components/account/auth-screen.css", import.meta.url),
      "utf8",
    );
    for (const block of [
      publicCss.match(/\.marketing-page\s*\{([^}]+)\}/)?.[1],
      authCss.match(/\.auth-screen\s*\{([^}]+)\}/)?.[1],
    ]) {
      expect(block).toBeDefined();
      expect(block).toContain("color-scheme: light;");
      expect(block).toContain("background: #fff;");
    }
  });
});
