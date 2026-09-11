import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EarningsCharts } from "../src/components/earnings/EarningsCharts";
import { buildEarningsCharts } from "../src/lib/earnings-charts";
import { buildEarningsLedger, type EarningsRow } from "../src/lib/earnings-ledger";
import { formatFinanceMoney } from "../src/lib/finance-money";

const today = "2026-09-08";
const period = { from: "2026-09-01", to: today };
function row(id: string, patch: Partial<EarningsRow> = {}): EarningsRow {
  return {
    id,
    sourceId: id,
    date: "2026-09-03",
    shootId: "shoot-one",
    who: null,
    clientId: null,
    description: id,
    category: "Event Coverage",
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
function model(
  rows: EarningsRow[] = [],
  options: Partial<Parameters<typeof buildEarningsCharts>[1]> = {},
) {
  return buildEarningsCharts(rows, {
    period,
    today,
    currency: "USD",
    granularity: "day",
    ...options,
  });
}
function render(
  value: ReturnType<typeof model> | null,
  loading = false,
  scopeLabel = "September 2026 · All Shoots",
) {
  return renderToStaticMarkup(
    <EarningsCharts model={value} loading={loading} scopeLabel={scopeLabel} />,
  );
}
function plain(html: string) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/<!--.*?-->/g, "")
    .replace(/\s+/g, " ");
}
const cashRows = () => [
  row("collection"),
  row("refund", {
    amountMinor: -2000,
    accounting: "refund",
    category: "",
    source: "stripe",
    status: "succeeded",
  }),
  row("expense", {
    amountMinor: 9000,
    accounting: "expense",
    type: "expense",
    category: "Equipment",
  }),
];

describe("Earnings charts render canonical recorded values", () => {
  test("cash-flow labels and accessible table expose exact signed values and date/currency", () => {
    const html = render(model(cashRows()));
    const text = plain(html);
    for (const title of [
      "Insights",
      "Collected",
      "Expenses",
      "Net Cash Flow",
      "Refunds",
      "Collection Mix",
      "Expense Mix",
      "Chart Data",
    ])
      expect(text).toContain(title);
    expect(text).toContain("Daily · USD");
    expect(text).toContain("Sep 3, 2026");
    expect(text).toContain("$80.00");
    expect(text).toContain("$90.00");
    expect(text).toContain("-$10.00");
    expect(html).toContain('aria-label="Earnings charts"');
    expect(html).toContain('role="img"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("Use left and right arrows to inspect dates");
    expect(html).toContain(
      "<caption>September 2026 · All Shoots · USD · recorded amounts</caption>",
    );
    expect(html).toContain('class="earnings-chart-zero"');
    expect(html).not.toMatch(/(?:NaN|Infinity|undefined)/);
  });

  test("pie uses gross positive receipts with explicit refunds and exact accessible breakdown", () => {
    const html = render(model(cashRows()));
    expect(plain(html)).toContain("Before $20.00 in refunds. Collected: $80.00.");
    expect(html).toContain('aria-label="Event Coverage: $100.00, 100.0 percent"');
    expect(html).toContain('aria-label="Equipment: $90.00, 100.0 percent"');
    expect(html).toContain('aria-label="Collection Mix breakdown"');
    expect(html).toContain('aria-label="Expense Mix breakdown"');
    expect(html).toContain("Positive recorded amounts only.");
    // Two real categories, no invented positive refund slice.
    expect((html.match(/pathLength="1"/g) ?? []).length).toBe(2);
  });

  test("signed historical corrections are disclosed, not turned into negative pie arcs", () => {
    const html = render(
      model([
        row("collection"),
        row("income-correction", { amountMinor: -500 }),
        row("expense", {
          accounting: "expense",
          type: "expense",
          amountMinor: 2000,
          category: "Travel",
        }),
        row("expense-correction", {
          accounting: "expense",
          type: "expense",
          amountMinor: -300,
          category: "Travel",
        }),
      ]),
    );
    const text = plain(html);
    expect(text).toContain("-$5.00 in corrections");
    expect(text).toContain("Collected: $95.00");
    expect(text).toContain("-$3.00 in corrections");
    expect(text).toContain("Recorded expenses: $17.00");
    expect(html).toContain('aria-label="Event Coverage: $100.00, 100.0 percent"');
    expect(html).toContain('aria-label="Travel: $20.00, 100.0 percent"');
    expect(html).not.toMatch(/stroke-dasharray="-/);
  });

  test("each real pie is a complete non-overlapping partition of positive category amounts", () => {
    const html = render(
      model([
        row("event", { amountMinor: 8000, category: "Event" }),
        row("licensing", { amountMinor: 2000, category: "Licensing" }),
        row("travel", {
          amountMinor: 1000,
          accounting: "expense",
          type: "expense",
          category: "Travel",
        }),
        row("equipment", {
          amountMinor: 3000,
          accounting: "expense",
          type: "expense",
          category: "Equipment",
        }),
      ]),
    );
    const pies = [...html.matchAll(/<svg viewBox="0 0 120 120"[\s\S]*?<\/svg>/g)];
    expect(pies).toHaveLength(2);
    for (const [pieIndex, pie] of pies.entries()) {
      const arcs = [...pie[0].matchAll(/<circle[^>]*pathLength="1"[^>]*>/g)];
      expect(arcs).toHaveLength(2);
      let position = 0;
      for (const [arcIndex, arc] of arcs.entries()) {
        const [fraction, gap] = arc[0]
          .match(/stroke-dasharray="([^"]+)"/)![1]!
          .split(" ")
          .map(Number);
        const offset = Number(arc[0].match(/stroke-dashoffset="([^"]+)"/)![1]);
        expect(fraction!).toBeCloseTo((pieIndex === 0 ? [0.8, 0.2] : [0.75, 0.25])[arcIndex]!, 12);
        expect(fraction! + gap!).toBeCloseTo(1, 12);
        expect(offset).toBeCloseTo(-position, 12);
        position += fraction!;
      }
      expect(position).toBeCloseTo(1, 12);
    }
  });

  test("empty and zero-only records render no fabricated graph, slices or date table", () => {
    for (const value of [model(), model([row("zero", { amountMinor: 0 })])]) {
      const html = render(value);
      for (const message of [
        "No net collections in this period",
        "No net expenses in this period",
        "No net activity",
        "No refunds recorded",
      ])
        expect(plain(html)).toContain(message);
      expect(html).not.toContain("<svg");
      expect(html).not.toContain("<table");
      expect(html).not.toContain("pathLength");
    }
  });

  test("missing, incomplete and loading models never expose unverified charts or values", () => {
    for (const value of [null, model(cashRows(), { complete: false })]) {
      const html = render(value);
      expect(plain(html)).toContain("Charts unavailable until recorded amounts can be verified.");
      expect(html).toContain('role="status"');
      expect(html).not.toContain("<svg");
      expect(html).not.toContain("<table");
      expect(html).not.toContain("$100.00");
    }
    // A cached complete model must not leak previous values during a new load.
    for (const value of [null, model(cashRows())]) {
      const html = render(value, true);
      expect(plain(html)).toContain("Loading charts…");
      expect(html).not.toContain("<svg");
      expect(html).not.toContain("$100.00");
      expect(html).not.toContain("<table");
    }
  });

  test("refund-only cash flow remains negative without an invented income pie", () => {
    const html = render(
      model([
        row("refund", { amountMinor: -2000, accounting: "refund", source: "stripe", category: "" }),
      ]),
    );
    expect(plain(html)).toContain("-$20.00");
    expect(plain(html)).toContain("$20.00 in refunds");
    expect(html).toContain('class="earnings-chart-zero"');
    // Collected and Net Cash Flow are negative; Refunds is secondary.
    // Expenses has no activity and therefore no invented zero plot.
    expect((html.match(/<svg/g) ?? []).length).toBe(3);
    expect(plain(html)).toContain("No net expenses in this period");
    expect(html).not.toContain("pathLength");
  });

  test("refunds are counted once in Collected and never deducted a second time from Net Cash Flow", () => {
    const value = model(cashRows());
    expect(value.totals).toMatchObject({
      collectedMinor: 8000,
      expensesMinor: 9000,
      refundsMinor: 2000,
      netMinor: -1000,
    });
    expect(value.totals.netMinor).toBe(value.totals.collectedMinor - value.totals.expensesMinor);
    expect(
      value.points.every((point) => point.netMinor === point.collectedMinor - point.expensesMinor),
    ).toBe(true);
    const html = render(value);
    expect(html).not.toContain("-$30.00");
    expect(html).toContain("already deducted from Collected");
    expect(html).toContain("Not profit, taxable income or a bank balance");
  });

  test("expense-only periods keep collected compact without hiding recorded expenses or the cash loss", () => {
    const html = render(
      model([
        row("software", {
          amountMinor: 4900,
          accounting: "expense",
          type: "expense",
          category: "Software",
        }),
      ]),
    );
    const figures = [
      ...html.matchAll(/<figure class="earnings-metric-chart"[\s\S]*?<\/figure>/g),
    ].map((match) => match[0]);
    expect(figures[0]).toContain("No net collections in this period");
    expect(figures[0]).not.toContain("<svg");
    expect(figures[1]).toContain("$49.00");
    expect(figures[1]).toContain("<svg");
    expect(figures[2]).toContain("-$49.00");
    expect(figures[2]).toContain("<svg");
    expect(figures[3]).not.toContain("<svg");
    // Only the two active cash-flow series plus the real expense pie.
    expect(html.match(/<svg/g) ?? []).toHaveLength(3);
  });

  test("negative-only expense corrections never claim no expense records exist", () => {
    const html = render(
      model([
        row("expense-credit", {
          accounting: "expense",
          type: "expense",
          amountMinor: -300,
          category: "Travel",
        }),
      ]),
    );
    const text = plain(html);
    expect(text).toContain("No positive expenses recorded in this period.");
    expect(text).toContain("-$3.00 in corrections. Recorded expenses: -$3.00.");
    expect(text).toContain("$3.00");
    expect(html).not.toContain("pathLength");
  });

  test("manual data retains account totals and excludes invoices/payouts/unlinked receipts from charts", () => {
    const ledger = buildEarningsLedger({
      today,
      period,
      legacyTransactions: [
        {
          id: "old-cash",
          occurred_on: "2026-09-02",
          description: "Old cash",
          kind: "income",
          category: "Manual",
          amount: "12.34",
          shoot_id: null,
          source: "manual",
        },
        {
          id: "payout",
          occurred_on: "2026-09-02",
          description: "Payout",
          kind: "income",
          category: "Payout",
          amount: "888.88",
          shoot_id: null,
          source: "stripe-payout",
          currency: "USD",
        },
      ],
    });
    const html = render(
      model([
        ...ledger.rows,
        row("unlinked", {
          amountMinor: 77777,
          eligibleForTotals: false,
          linked: false,
          source: "stripe",
        }),
        row("invoice", {
          amountMinor: 66666,
          accounting: "invoice",
          type: "invoice",
          outstandingMinor: 66666,
        }),
        row("unknown-currency", { amountMinor: 55555, currency: null, eligibleForTotals: false }),
      ]),
    );
    expect(plain(html)).toContain("$12.34");
    for (const value of ["$888.88", "$777.77", "$666.66", "$555.55"])
      expect(html).not.toContain(value);
  });

  test("JPY and KWD stay in their own currency units with exact calendar-year labels", () => {
    for (const currency of ["JPY", "KWD"]) {
      const html = render(
        model([row("amount", { amountMinor: 12345, currency, date: "2026-02-15" })], {
          currency,
          period: { from: "2026-01-01", to: "2026-03-31" },
          granularity: "month",
        }),
      );
      const text = plain(html);
      expect(text).toContain(`Monthly · ${currency}`);
      expect(text).toContain("Feb 2026");
      expect(text).toContain(formatFinanceMoney(12345, currency).replace(/\s+/g, " "));
      expect(text).not.toContain("$123.45");
    }
  });

  test("category and shoot labels are escaped as text", () => {
    const html = render(
      model([row("xss", { category: '<img src=x onerror="alert(1)">' })]),
      false,
      '<script>alert("scope")</script>',
    );
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
  });

  test("extreme ranges disclose omitted empty periods without losing the actual money", () => {
    const value = model(
      [
        row("old", { date: "1800-01-01", amountMinor: 100 }),
        row("new", { date: "2026-09-08", amountMinor: 200 }),
      ],
      {
        period: { from: "1800-01-01", to: "2026-09-08" },
        granularity: "month",
      },
    );
    expect(value.omittedEmptyPoints).toBeGreaterThan(0);
    const html = render(value);
    expect(plain(html)).toContain("$3.00");
    expect(plain(html)).toMatch(/empty.*omitted|omitted.*empty/i);
  });
});
