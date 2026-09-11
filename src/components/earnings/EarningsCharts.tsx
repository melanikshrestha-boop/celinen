import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import type { EarningsCharts as ChartModel, EarningsChartCategory } from "@/lib/earnings-charts";
import { currencyExponent } from "@/lib/finance-money";
import { formatEarningsMoney } from "./earnings-ui";
import "./earnings-charts.css";

const SERIES = [
  {
    key: "collectedMinor",
    label: "Collected",
    description: "Recorded collections after refunds and corrections.",
  },
  {
    key: "expensesMinor",
    label: "Expenses",
    description: "Recorded expenses including corrections.",
  },
  {
    key: "netMinor",
    label: "Net Cash Flow",
    description:
      "Recorded collections minus recorded expenses. Not profit, taxable income or a bank balance.",
  },
  {
    key: "refundsMinor",
    label: "Refunds",
    description: "Recorded refunds, already deducted from Collected.",
  },
] as const;
const swatch = (index: number) => `var(--earn-chart-${(index % 6) + 1})`;
const dateLabel = (date: string, full = false) =>
  new Date(`${date.length === 7 ? `${date}-01` : date}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    ...(date.length === 10 ? { day: "numeric" as const } : {}),
    ...(full ? { year: "numeric" as const } : {}),
  });

function MetricChart({ model, series }: { model: ChartModel; series: (typeof SERIES)[number] }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const id = useId();
  useEffect(() => {
    if (!host.current) return;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0)
        setWidth(Math.max(250, Math.round(entry.contentRect.width)));
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const points = model.points;
  const activeIndex = points.findIndex((point) => point.date === activeDate);
  const active = activeIndex < 0 ? null : activeIndex;
  const setActive = (index: number | null) =>
    setActiveDate(index === null ? null : (points[index]?.date ?? null));
  const selected = active === null ? null : points[active];
  const values = points.map((point) => point[series.key]);
  const hasSeriesActivity = values.some((value) => value !== 0);
  const min = Math.min(0, ...values),
    max = Math.max(0, ...values);
  // Axis observations remain representable in the currency's smallest unit.
  // One-cent ranges need two ticks, not a fabricated half-cent or duplicate zero.
  const ticks = [...new Set([max, Math.round((max + min) / 2), min])];
  const left = 44,
    right = width - 16,
    top = 18,
    bottom = 152;
  const y = (value: number) => bottom - ((value - min) / Math.max(1, max - min)) * (bottom - top);
  const step = (right - left) / Math.max(1, points.length - 1);
  const x = (index: number) => (points.length === 1 ? (left + right) / 2 : left + step * index);
  const money = (value: number) => formatEarningsMoney(value, model.currency);
  const interval = model.granularity === "day" ? "Daily" : "Monthly";
  // Omitted intervals contain zero activity. Include them in the display-only
  // calendar average; never recompute or replace the canonical ledger totals.
  const average = model.totals[series.key] / Math.max(1, points.length + model.omittedEmptyPoints);
  const averageLabel = `${Number.isInteger(average) ? "" : "≈ "}${money(Math.round(average))}`;
  const isNet = series.key === "netMinor";
  const color = (value: number) =>
    isNet
      ? value < 0
        ? "var(--earn-chart-negative)"
        : value > 0
          ? "var(--earn-chart-positive)"
          : "var(--earn-chart-blue)"
      : "var(--earn-chart-blue)";
  const zeroOffset = (y(0) - top) / (bottom - top);
  const crossesZero = min < 0 && max > 0;
  const upperColor = max > 0 ? color(1) : color(-1);
  const lowerColor = min < 0 ? color(-1) : color(1);
  const line = points
    .map((point, index) => `${index ? "L" : "M"}${x(index)},${y(point[series.key])}`)
    .join(" ");
  const area =
    points.length > 1 ? `${line} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z` : "";
  const compact = (value: number) =>
    new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: currencyExponent(model.currency),
    }).format(value / 10 ** currencyExponent(model.currency));
  const indices = [
    ...new Set(
      width < 420
        ? [0, points.length - 1]
        : [0, Math.floor((points.length - 1) / 2), points.length - 1],
    ),
  ];
  const selectAt = (clientX: number, svg: SVGSVGElement) => {
    const rect = svg.getBoundingClientRect();
    if (rect.width > 0 && Number.isFinite(clientX) && points.length)
      setActive(
        Math.max(
          0,
          Math.min(
            points.length - 1,
            Math.round((((clientX - rect.left) * width) / rect.width - left) / step),
          ),
        ),
      );
  };
  return (
    <figure
      className="earnings-metric-chart"
      data-metric={series.key}
      data-empty={!hasSeriesActivity || undefined}
      aria-labelledby={`${id}-title`}
    >
      <figcaption className="earnings-chart-title">
        <h3 id={`${id}-title`} title={series.description}>
          {series.label}
        </h3>
        <span>
          {interval} · {model.currency}
        </span>
      </figcaption>
      <div className="earnings-chart-legend" aria-live="polite" aria-atomic="true">
        <strong
          style={isNet ? { color: color((selected ?? model.totals)[series.key]) } : undefined}
        >
          {money((selected ?? model.totals)[series.key])}
        </strong>
        <span className="earnings-chart-readout">
          {selected ? dateLabel(selected.date, true) : "Selected period"}
        </span>
      </div>
      <div ref={host} className="earnings-plot-wrap">
        {hasSeriesActivity && points.length > 0 ? (
          <>
            <svg
              className="earnings-plot"
              viewBox={`0 0 ${width} 180`}
              preserveAspectRatio="none"
              role="img"
              tabIndex={0}
              aria-labelledby={`${id}-title ${id}-description`}
              onPointerMove={(event) => selectAt(event.clientX, event.currentTarget)}
              onPointerDown={(event) => selectAt(event.clientX, event.currentTarget)}
              onPointerLeave={() => {
                if (document.activeElement !== host.current?.querySelector("svg")) setActive(null);
              }}
              onBlur={() => setActive(null)}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key))
                  return;
                event.preventDefault();
                if (event.key === "Escape") setActive(null);
                else if (event.key === "Home") setActive(0);
                else if (event.key === "End") setActive(points.length - 1);
                else
                  setActive(
                    Math.max(
                      0,
                      Math.min(
                        points.length - 1,
                        (active ?? (event.key === "ArrowRight" ? -1 : points.length)) +
                          (event.key === "ArrowRight" ? 1 : -1),
                      ),
                    ),
                  );
              }}
            >
              <desc id={`${id}-description`}>
                {series.description} Use left and right arrows to inspect dates. Home and End select
                the first and last date. Escape restores the period total. Exact values are also in
                Chart Data. The dotted line is the {interval.toLowerCase()} average, including
                zero-activity intervals.
              </desc>
              <defs>
                <linearGradient
                  id={`${id}-line`}
                  gradientUnits="userSpaceOnUse"
                  x1="0"
                  x2="0"
                  y1={top}
                  y2={bottom}
                >
                  <stop offset={crossesZero ? zeroOffset : 0} stopColor={upperColor} />
                  <stop offset={crossesZero ? zeroOffset : 1} stopColor={lowerColor} />
                </linearGradient>
                <linearGradient
                  id={`${id}-area`}
                  gradientUnits="userSpaceOnUse"
                  x1="0"
                  x2="0"
                  y1={top}
                  y2={bottom}
                >
                  <stop offset="0" stopColor={upperColor} stopOpacity={max > 0 ? "0.26" : "0"} />
                  {crossesZero && (
                    <>
                      <stop offset={zeroOffset} stopColor={upperColor} stopOpacity="0" />
                      <stop offset={zeroOffset} stopColor={lowerColor} stopOpacity="0" />
                    </>
                  )}
                  <stop offset="1" stopColor={lowerColor} stopOpacity={min < 0 ? "0.26" : "0"} />
                </linearGradient>
              </defs>
              {ticks.map((value, index) => (
                <g key={index} aria-hidden="true">
                  <line
                    x1={left}
                    x2={right}
                    y1={y(value)}
                    y2={y(value)}
                    className="earnings-chart-gridline"
                  />
                  <text x={left - 8} y={y(value) + 4} textAnchor="end">
                    {compact(value)}
                  </text>
                </g>
              ))}
              <line x1={left} x2={right} y1={y(0)} y2={y(0)} className="earnings-chart-zero" />
              {area && <path d={area} fill={`url(#${id}-area)`} aria-hidden="true" />}
              <line
                x1={left}
                x2={right}
                y1={y(average)}
                y2={y(average)}
                className="earnings-chart-average"
                stroke="var(--earn-chart-average)"
                aria-hidden="true"
              />
              {selected && (
                <line
                  x1={x(active!)}
                  x2={x(active!)}
                  y1={top}
                  y2={bottom}
                  className="earnings-chart-guide"
                  aria-hidden="true"
                />
              )}
              <path
                d={line}
                fill="none"
                stroke={`url(#${id}-line)`}
                strokeWidth="2.25"
                strokeLinejoin="round"
                strokeLinecap="round"
                aria-hidden="true"
              />
              {points.map((point, index) => (
                <circle
                  key={point.date}
                  cx={x(index)}
                  cy={y(point[series.key])}
                  r={active === index ? 4.5 : 2.5}
                  fill={color(point[series.key])}
                  stroke={active === index ? "var(--earn-bg)" : "none"}
                  strokeWidth="1.5"
                  aria-hidden="true"
                />
              ))}
              {indices.map((index) => (
                <text
                  key={index}
                  x={x(index)}
                  y="176"
                  textAnchor={
                    index === 0 && points.length > 1
                      ? "start"
                      : index === points.length - 1 && points.length > 1
                        ? "end"
                        : "middle"
                  }
                >
                  {dateLabel(points[index]!.date, model.granularity === "month")}
                </text>
              ))}
            </svg>
            {selected && (
              <div
                className="earnings-chart-tooltip"
                aria-hidden="true"
                style={{
                  left: `${(x(active!) / width) * 100}%`,
                  transform: active! > (points.length - 1) / 2 ? "translateX(-100%)" : undefined,
                }}
              >
                <span>{dateLabel(selected.date, true)}</span>
                <strong>{money(selected[series.key])}</strong>
              </div>
            )}
            <div
              className="earnings-chart-average-label"
              title="Calendar average, including zero-activity intervals. Approximate values are rounded to this currency’s precision."
            >
              <i style={{ borderColor: "var(--earn-chart-average)" }} />
              {interval} average <span>{averageLabel}</span>
            </div>
          </>
        ) : (
          <div className="earnings-chart-empty">
            {series.key === "netMinor"
              ? "No net activity"
              : series.key === "collectedMinor"
                ? "No net collections in this period"
                : series.key === "expensesMinor"
                  ? "No net expenses in this period"
                  : "No refunds recorded"}
          </div>
        )}
      </div>
    </figure>
  );
}

function CategoryPie({
  title,
  categories,
  total,
  currency,
  note,
}: {
  title: string;
  categories: EarningsChartCategory[];
  total: number;
  currency: string;
  note: string | null;
}) {
  const id = useId();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const activeIndex = categories.findIndex((item) => item.category === activeCategory);
  const active = activeIndex < 0 ? null : activeIndex;
  const setActive = (index: number | null) =>
    setActiveCategory(index === null ? null : (categories[index]?.category ?? null));
  // Show every category in the legend; no hidden "Other" bucket or inferred values.
  let position = 0;
  const selected = active === null ? null : categories[active];
  return (
    <figure className="earnings-category-pie" aria-labelledby={`${id}-title`}>
      <figcaption className="earnings-chart-title">
        <h3 id={`${id}-title`}>{title}</h3>
        <span>{formatEarningsMoney(total, currency)}</span>
      </figcaption>
      {categories.length ? (
        <div className="earnings-pie-content">
          <div className="earnings-pie-visual">
            <svg viewBox="0 0 120 120" role="img" aria-labelledby={`${id}-title ${id}-description`}>
              <desc id={`${id}-description`}>
                {categories
                  .map(
                    (item) =>
                      `${item.category}: ${formatEarningsMoney(item.amountMinor, currency)}`,
                  )
                  .join("; ")}
                . Positive recorded amounts only.
              </desc>
              {categories.map((item, index) => {
                const fraction = item.amountMinor / total;
                const offset = position;
                position += fraction;
                return (
                  <circle
                    key={item.category}
                    cx="60"
                    cy="60"
                    r="44"
                    fill="none"
                    stroke={swatch(index)}
                    strokeWidth={active === index ? "21" : "17"}
                    pathLength="1"
                    strokeDasharray={`${fraction} ${1 - fraction}`}
                    strokeDashoffset={-offset}
                    transform="rotate(-90 60 60)"
                    opacity={active === null || active === index ? 1 : 0.35}
                    onPointerEnter={() => setActive(index)}
                    onPointerLeave={() => setActive(null)}
                  />
                );
              })}
              <text x="60" y="59" className="earnings-pie-percent" textAnchor="middle">
                {selected
                  ? `${Math.round((selected.amountMinor / total) * 100)}%`
                  : categories.length}
              </text>
              <text x="60" y="74" textAnchor="middle">
                {selected ? "of total" : categories.length === 1 ? "category" : "categories"}
              </text>
            </svg>
          </div>
          <ul className="earnings-pie-legend" aria-label={`${title} breakdown`}>
            {categories.map((item, index) => (
              <li key={item.category} data-active={active === index || undefined}>
                <button
                  type="button"
                  aria-label={`${item.category}: ${formatEarningsMoney(item.amountMinor, currency)}, ${((item.amountMinor / total) * 100).toFixed(1)} percent`}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                  onPointerEnter={() => setActive(index)}
                  onPointerLeave={() => setActive(null)}
                  onClick={() => setActive(index)}
                >
                  <i style={{ "--slice-color": swatch(index) } as CSSProperties} />
                  <span>{item.category}</span>
                  <strong>{formatEarningsMoney(item.amountMinor, currency)}</strong>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="earnings-pie-empty">
          No positive {title === "Collection Mix" ? "collections" : "expenses"} recorded in this
          period.
        </p>
      )}
      {note && <p className="earnings-chart-note">{note}</p>}
    </figure>
  );
}

export function EarningsCharts({
  model,
  loading = false,
  scopeLabel,
}: {
  model: ChartModel | null;
  loading?: boolean;
  scopeLabel: string;
}) {
  const money = (value: number) => formatEarningsMoney(value, model!.currency);
  const totals = model?.totals;
  const incomeNote =
    totals && (totals.refundsMinor || totals.collectionAdjustmentsMinor)
      ? `Before ${money(totals.refundsMinor)} in refunds${totals.collectionAdjustmentsMinor ? ` and ${money(totals.collectionAdjustmentsMinor)} in corrections` : ""}. Collected: ${money(totals.collectedMinor)}.`
      : null;
  const expenseNote = totals?.expenseAdjustmentsMinor
    ? `${money(totals.expenseAdjustmentsMinor)} in corrections. Recorded expenses: ${money(totals.expensesMinor)}.`
    : null;
  return (
    <section className="earnings-insights" aria-label="Earnings charts">
      <div className="earnings-insights-heading">
        <h2>Insights</h2>
        <span>{scopeLabel}</span>
      </div>
      {loading || !model || !model.complete ? (
        <p className="earnings-chart-unavailable" role="status">
          {loading
            ? "Loading charts…"
            : "Charts unavailable until recorded amounts can be verified."}
        </p>
      ) : (
        <>
          <div className="earnings-charts-grid">
            {SERIES.slice(0, 3).map((series) => (
              <MetricChart
                key={`${series.key}-${scopeLabel}-${model.currency}-${model.granularity}`}
                model={model}
                series={series}
              />
            ))}
            <details className="earnings-refunds-detail">
              <summary>
                Refunds <span>{money(model.totals.refundsMinor)}</span>
              </summary>
              <MetricChart
                key={`refunds-${scopeLabel}-${model.currency}-${model.granularity}`}
                model={model}
                series={SERIES[3]}
              />
            </details>
          </div>
          <details className="earnings-chart-breakdown">
            <summary>Breakdown</summary>
            <div className="earnings-pies">
              <CategoryPie
                key={`income-${scopeLabel}-${model.currency}`}
                title="Collection Mix"
                categories={model.incomeCategories}
                total={model.totals.positiveCollectionsMinor}
                currency={model.currency}
                note={incomeNote}
              />
              <CategoryPie
                key={`expense-${scopeLabel}-${model.currency}`}
                title="Expense Mix"
                categories={model.expenseCategories}
                total={model.totals.positiveExpensesMinor}
                currency={model.currency}
                note={expenseNote}
              />
            </div>
          </details>
          {model.omittedEmptyPoints > 0 && (
            <p className="earnings-chart-note">
              {model.omittedEmptyPoints} empty intervals omitted from this long history. All
              recorded amounts are included.
            </p>
          )}
          {model.hasActivity && (
            <details className="earnings-chart-data">
              <summary>Chart Data</summary>
              <div className="earnings-table-scroll">
                <table>
                  <caption>
                    {scopeLabel} · {model.currency} · recorded amounts
                  </caption>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Collected</th>
                      <th>Refunds</th>
                      <th>Expenses</th>
                      <th>Net Cash Flow</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.points.map((point) => (
                      <tr key={point.date}>
                        <th>{dateLabel(point.date, true)}</th>
                        <td>{money(point.collectedMinor)}</td>
                        <td>{money(point.refundsMinor)}</td>
                        <td>{money(point.expensesMinor)}</td>
                        <td>{money(point.netMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}
