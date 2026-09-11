import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { EarningsCharts } from "../src/components/earnings/EarningsCharts";
import type { EarningsCharts as Model } from "../src/lib/earnings-charts";

function model(): Model {
  return {
    currency: "USD",
    complete: true,
    granularity: "day",
    months: [],
    points: [
      {
        date: "2026-09-01",
        collectedMinor: 10000,
        expensesMinor: 2000,
        netMinor: 8000,
        refundsMinor: 0,
      },
      {
        date: "2026-09-02",
        collectedMinor: -4000,
        expensesMinor: 1000,
        netMinor: -5000,
        refundsMinor: 4000,
      },
    ],
    totals: {
      collectedMinor: 6000,
      expensesMinor: 3000,
      netMinor: 3000,
      refundsMinor: 4000,
      positiveCollectionsMinor: 10000,
      positiveExpensesMinor: 3000,
      collectionAdjustmentsMinor: 0,
      expenseAdjustmentsMinor: 0,
    },
    incomeCategories: [{ category: "Portrait", amountMinor: 10000 }],
    expenseCategories: [{ category: "Studio", amountMinor: 3000 }],
    hasActivity: true,
    omittedEmptyMonths: 0,
    omittedEmptyPoints: 0,
  };
}
const render = (value: Model) =>
  renderToStaticMarkup(<EarningsCharts model={value} scopeLabel="Test period" />);
const panels = (html: string) =>
  [...html.matchAll(/<figure class="earnings-metric-chart"[\s\S]*?<\/figure>/g)].map(
    (match) => match[0],
  );

describe("three primary cash-flow charts and secondary Refunds", () => {
  test("three primary series retain canonical totals; Refunds and Breakdown start collapsed", () => {
    const value = model(),
      before = JSON.stringify(value),
      html = render(value);
    expect(panels(html)).toHaveLength(4);
    const primary = html.slice(0, html.indexOf('<details class="earnings-refunds-detail"'));
    expect(panels(primary)).toHaveLength(3);
    expect(panels(primary).map((panel) => panel.match(/<h3[^>]*>([^<]+)<\/h3>/)![1])).toEqual([
      "Collected",
      "Expenses",
      "Net Cash Flow",
    ]);
    expect(html).toContain(
      '<details class="earnings-refunds-detail"><summary>Refunds <span>$40.00</span></summary>',
    );
    expect(html).not.toContain('<details class="earnings-refunds-detail" open');
    expect(panels(html).map((panel) => panel.match(/data-metric="([^"]+)"/)![1])).toEqual([
      "collectedMinor",
      "expensesMinor",
      "netMinor",
      "refundsMinor",
    ]);
    expect(panels(html).map((panel) => panel.match(/<strong[^>]*>([^<]+)<\/strong>/)![1])).toEqual([
      "$60.00",
      "$30.00",
      "$30.00",
      "$40.00",
    ]);
    expect(html).toContain(
      '<details class="earnings-chart-breakdown"><summary>Breakdown</summary>',
    );
    expect(html).not.toContain('<details class="earnings-chart-breakdown" open');
    expect(html).toContain("Recorded refunds, already deducted from Collected.");
    expect(html).toContain("Not profit, taxable income or a bank balance.");
    expect(JSON.stringify(value)).toBe(before);
  });

  test("fading areas and averages accompany dots; only Net changes sign color", () => {
    const output = panels(render(model()));
    for (const panel of output) {
      expect(panel).toContain('stop-opacity="0.26"');
      expect(panel).toContain('stop-opacity="0"');
      expect(panel).toContain('class="earnings-chart-average"');
      expect(panel.match(/<circle /g)).toHaveLength(2);
      expect(panel).not.toContain("<rect");
      expect(panel).toContain('aria-live="polite" aria-atomic="true"');
    }
    for (const index of [0, 1, 3]) {
      expect(output[index]).toContain("var(--earn-chart-blue)");
      expect(output[index]).not.toContain("var(--earn-chart-negative)");
    }
    expect(output[2]).toContain('fill="var(--earn-chart-negative)"');
    expect(output[2]).toContain('fill="var(--earn-chart-positive)"');
  });

  test("calendar average includes omitted zero intervals without changing exact totals", () => {
    const value = model();
    value.omittedEmptyPoints = 2;
    const output = panels(render(value));
    expect(output[0]).toContain("Daily average <span>$15.00</span>");
    expect(output[0]).toContain("$60.00");
    value.totals.collectedMinor = 6001;
    expect(panels(render(value))[0]).toContain("≈ $15.00");
  });

  test("one nonzero point stays visible without inventing an area or second observation", () => {
    const value = model();
    value.points = [value.points[0]!];
    value.totals = { ...value.totals, ...value.points[0]! };
    for (const panel of panels(render(value)).slice(0, 3)) {
      expect(panel.match(/<circle /g)).toHaveLength(1);
      expect(panel).toContain('cx="294"');
      expect(panel).not.toMatch(/<path[^>]* Z/);
      expect(panel).not.toMatch(/NaN|Infinity|undefined/);
    }
    expect(panels(render(value))[3]).not.toContain("<svg");
    expect(panels(render(value))[3]).toContain("No refunds recorded");
  });

  test("zero-only Refunds has a compact truthful empty state, not an invented flat plot", () => {
    const value = model();
    value.points = value.points.map((point) => ({ ...point, refundsMinor: 0 }));
    value.totals.refundsMinor = 0;
    const output = panels(render(value))[3]!;
    expect(output).toContain('data-empty="true"');
    expect(output).toContain("No refunds recorded");
    expect(output).toContain("$0.00");
    expect(output).not.toContain("<svg");
    expect(output).not.toContain("Daily average");
    expect(output).not.toContain("No recorded cash flow");
  });

  test("zero net movement is distinct from no activity, while offsetting movements remain plotted", () => {
    const value = model();
    value.points = value.points.map((point) => ({ ...point, netMinor: 0 }));
    value.totals.netMinor = 0;
    let output = panels(render(value))[2]!;
    expect(output).toContain("No net activity");
    expect(output).not.toContain("<svg");
    // A zero total is not an empty series when recorded intervals offset.
    value.points[0]!.netMinor = 5000;
    value.points[1]!.netMinor = -5000;
    output = panels(render(value))[2]!;
    expect(output).toContain("<svg");
    expect(output.match(/<circle /g)).toHaveLength(2);
    expect(output).not.toContain('data-empty="true"');
    expect(output).toContain("$0.00");
  });

  test("actual keyboard/pointer handlers retain exact readout, scale mapping and observer cleanup", () => {
    const result = Bun.spawnSync(
      [
        process.execPath,
        fileURLToPath(new URL("./earnings-chart-panels.fixture.ts", import.meta.url)),
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
    expect(new TextDecoder().decode(result.stdout)).toContain("EARNINGS_PANEL_HANDLERS_OK");
  });
});
