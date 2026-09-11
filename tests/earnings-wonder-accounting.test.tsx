import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EarningsCharts } from "../src/components/earnings/EarningsCharts";
import { buildEarningsCharts } from "../src/lib/earnings-charts";
import { type EarningsRow, summarizeEarnings } from "../src/lib/earnings-ledger";

const options = {
  period: { from: "2026-09-01", to: "2026-09-03" },
  today: "2026-09-03",
  currency: "USD",
  granularity: "day" as const,
};
const row = (id: string, patch: Partial<EarningsRow> = {}): EarningsRow => ({
  id,
  sourceId: id,
  date: "2026-09-01",
  shootId: "qa-shoot",
  who: null,
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
});
const render = (rows: EarningsRow[], currency = "USD") =>
  renderToStaticMarkup(
    <EarningsCharts
      model={buildEarningsCharts(rows, { ...options, currency })}
      scopeLabel="QA Period"
    />,
  );
const metric = (html: string, key: string) =>
  html.match(new RegExp(`<figure[^>]*data-metric="${key}"[\\s\\S]*?<\\/figure>`))?.[0] ?? "";
const tickLabels = (panel: string) =>
  [...panel.matchAll(/<g aria-hidden="true">[\s\S]*?<text[^>]*>([^<]+)<\/text><\/g>/g)].map(
    (match) => match[1],
  );

describe("Wonder earnings presentation keeps accounting boundaries", () => {
  test("only three metric panels precede the collapsed Refunds disclosure", () => {
    const html = render([row("payment")]);
    const core = html.split('<details class="earnings-refunds-detail">')[0]!;
    expect([...core.matchAll(/data-metric="([^"]+)"/g)].map((match) => match[1])).toEqual([
      "collectedMinor",
      "expensesMinor",
      "netMinor",
    ]);
    expect(html).toContain('<details class="earnings-refunds-detail"><summary>Refunds');
    expect(html).not.toContain('<details class="earnings-refunds-detail" open');
    expect(html).toContain("Net Cash Flow");
    expect(html).toContain("Not profit, taxable income or a bank balance.");
    expect(html).toContain("Collection Mix");
    expect(html).not.toContain("Income Mix");
  });

  test("one expense never creates large zero-only collection and refund plots", () => {
    const html = render([
      row("software", { accounting: "expense", type: "expense", amountMinor: 4900 }),
    ]);
    for (const key of ["collectedMinor", "refundsMinor"]) {
      const panel = metric(html, key);
      expect(panel).toContain('data-empty="true"');
      expect(panel).toContain("$0.00");
      expect(panel).not.toContain('class="earnings-plot"');
    }
    expect(metric(html, "collectedMinor")).toContain("No net collections in this period");
    expect(metric(html, "expensesMinor")).toContain('class="earnings-plot"');
    expect(metric(html, "netMinor")).toContain("-$49.00");
    expect(html).toContain("Chart Data");
    expect(html).toContain("Sep 3, 2026");
  });

  test("a zero period total with offsetting dated cash movement still draws the real series", () => {
    const html = render([
      row("payment"),
      row("refund", { date: "2026-09-03", accounting: "refund", amountMinor: -10000 }),
    ]);
    const collected = metric(html, "collectedMinor");
    expect(collected).toContain("$0.00");
    expect(collected).not.toContain('data-empty="true"');
    expect(collected).toContain('class="earnings-plot"');
    expect(collected.match(/<circle /g)).toHaveLength(3);
  });

  test("same-day receipts and corrections netting to zero never claim no underlying records", () => {
    const html = render([
      row("payment"),
      row("refund", { accounting: "refund", amountMinor: -10000 }),
      row("cost", { accounting: "expense", type: "expense", amountMinor: 4900 }),
      row("correction", { accounting: "expense", type: "expense", amountMinor: -4900 }),
    ]);
    const collected = metric(html, "collectedMinor"),
      expenses = metric(html, "expensesMinor");
    expect(collected).toContain("No net collections in this period");
    expect(expenses).toContain("No net expenses in this period");
    for (const panel of [collected, expenses]) {
      expect(panel).toContain("$0.00");
      expect(panel).toContain('data-empty="true"');
      expect(panel).not.toContain('class="earnings-plot"');
      expect(tickLabels(panel)).toEqual([]);
    }
    expect(html).not.toContain("No collections recorded");
    expect(html).not.toContain("No expenses recorded");
    expect(html).toContain("Chart Data");
    expect(html).toContain("Before $100.00 in refunds. Collected: $0.00.");
  });

  test("smallest-unit currency axes have distinct accurate labels and no invented negative-only upper bound", () => {
    for (const [currency, unit] of [
      ["USD", "0.01"],
      ["JPY", "1"],
      ["KWD", "0.001"],
    ]) {
      const positive = metric(
          render([row(`tiny-${currency}`, { currency, amountMinor: 1 })], currency),
          "collectedMinor",
        ),
        negative = metric(
          render(
            [row(`refund-${currency}`, { currency, accounting: "refund", amountMinor: -1 })],
            currency,
          ),
          "collectedMinor",
        );
      expect(tickLabels(positive)).toEqual([unit, "0"]);
      expect(tickLabels(negative)).toEqual(["0", `-${unit}`]);
      expect(new Set(tickLabels(positive)).size).toBe(tickLabels(positive).length);
      expect(new Set(tickLabels(negative)).size).toBe(tickLabels(negative).length);
      expect(negative).not.toMatch(/NaN|Infinity|undefined/);
    }
  });

  test("refunds are deducted exactly once and payouts never become income", () => {
    const rows = [
      row("payment"),
      row("refund", { date: "2026-09-02", accounting: "refund", amountMinor: -2500 }),
      row("cost", { accounting: "expense", type: "expense", amountMinor: 1000 }),
      row("transfer", { accounting: "transfer", type: "payout", amountMinor: 6500 }),
      row("foreign", { currency: "JPY", amountMinor: 999 }),
    ];
    const before = JSON.stringify(rows),
      html = render(rows),
      metrics = summarizeEarnings(rows, options).find((value) => value.currency === "USD")!;
    expect(metrics.collectedMinor).toBe(7500);
    expect(metrics.netMinor).toBe(6500);
    expect(metric(html, "collectedMinor")).toContain("$75.00");
    expect(metric(html, "netMinor")).toContain("$65.00");
    expect(metric(html, "refundsMinor")).toContain("$25.00");
    expect(html).toContain("Before $25.00 in refunds. Collected: $75.00.");
    expect(JSON.stringify(rows)).toBe(before);
  });

  test("average reference stays blue even when net cash flow is negative", () => {
    const html = render([row("cost", { accounting: "expense", amountMinor: 4900 })]);
    const net = metric(html, "netMinor");
    expect(net).toContain('class="earnings-chart-average" stroke="var(--earn-chart-average)"');
    expect(net).toContain('fill="var(--earn-chart-negative)"');
    expect(net).toContain('class="earnings-chart-gridline"');
  });

  test("exact zero net is neutral, not a green profit claim", () => {
    const emptyNet = metric(render([]), "netMinor");
    expect(emptyNet).toContain('style="color:var(--earn-chart-blue)"');
    expect(emptyNet).not.toContain("var(--earn-chart-positive)");
    expect(emptyNet).toContain("No net activity");
    const zeroTotal = metric(
      render([
        row("payment"),
        row("cost", { date: "2026-09-03", accounting: "expense", amountMinor: 10000 }),
      ]),
      "netMinor",
    );
    expect(zeroTotal).toContain('style="color:var(--earn-chart-blue)"');
    expect(zeroTotal).toContain('fill="var(--earn-chart-positive)"');
    expect(zeroTotal).toContain('fill="var(--earn-chart-negative)"');
    expect(zeroTotal).toContain('fill="var(--earn-chart-blue)"');
  });

  test("one-sided Net gradients cannot paint a phantom opposite-sign baseline", () => {
    const nonnegative = metric(render([row("payment")]), "netMinor"),
      nonpositive = metric(render([row("expense", { accounting: "expense" })]), "netMinor");
    expect(nonnegative).toContain("var(--earn-chart-positive)");
    expect(nonnegative).not.toContain("var(--earn-chart-negative)");
    expect(nonpositive).toContain("var(--earn-chart-negative)");
    expect(nonpositive).not.toContain("var(--earn-chart-positive)");
    for (const panel of [nonnegative, nonpositive]) {
      expect(panel).toContain('fill="var(--earn-chart-blue)"');
      expect(panel).toContain('stop-opacity="0.26"');
      expect(panel).toContain('stop-opacity="0"');
    }
  });

  test("incomplete source history cannot be presented as a zero or a verified graph", () => {
    const html = renderToStaticMarkup(
      <EarningsCharts
        model={buildEarningsCharts([row("payment")], { ...options, complete: false })}
        scopeLabel="QA Period"
      />,
    );
    expect(html).toContain("Charts unavailable until recorded amounts can be verified.");
    expect(html).not.toContain('data-metric="');
    expect(html).not.toContain("$0.00");
  });
});
