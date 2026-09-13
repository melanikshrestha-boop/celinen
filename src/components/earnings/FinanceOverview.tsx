import { useId, useState } from "react";
import type { PhotographerBooks, BooksSpark } from "@/lib/photographer-books";
import type { EarningsRow } from "@/lib/earnings-ledger";
import { RevenueGoal } from "./RevenueGoal";
import { SpendSankey } from "./SpendSankey";
import "./spend-sankey.css";

type Metric = "earnings" | "expenses" | "net";

function Area({
  points,
  metric,
  money,
  compact = false,
}: {
  points: BooksSpark[];
  metric: Metric;
  money: (minor: number) => string;
  compact?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const [active, setActive] = useState<number | null>(null);
  const values = points.length
    ? points.map((p) =>
        metric === "net" ? p.netMinor : metric === "expenses" ? p.expensesMinor : p.collectedMinor,
      )
    : [0, 0];
  const series = points.length ? points : [{ date: "" }, { date: "" }];
  const min = Math.min(0, ...values),
    max = Math.max(1, ...values);
  const x = (i: number) => (values.length === 1 ? 350 : 76 + (i / (values.length - 1)) * 552);
  const y = (value: number) => 178 - ((value - min) / (max - min)) * 162;
  // Axis guides may divide an odd number of minor units. Only round the guides;
  // recorded point values and the accessible data table remain exact.
  const ticks = [...new Set([max, (min + max) / 2, min].map(Math.round))];
  const line = values.map((value, i) => `${i ? "L" : "M"}${x(i)},${y(value)}`).join(" ");
  const indices = [...new Set([0, Math.floor((values.length - 1) / 2), values.length - 1])];
  const hot = active === null ? null : Math.min(active, points.length - 1);
  const label =
    metric === "net" ? "Net cash flow" : metric === "expenses" ? "Expenses" : "Collected";
  if (!points.length)
    return (
      <p className="finance-os__chart-empty">
        No recorded activity in this period. Your chart starts with your first payment or expense.
      </p>
    );
  return (
    <>
      <div className="finance-os__chart-readout" id={`${id}-readout`} aria-live="polite">
        {hot !== null ? (
          <>
            <time>{points[hot]?.date}</time>
            <strong>{money(values[hot] ?? 0)}</strong>
            <span>{label}</span>
          </>
        ) : (
          <span>
            Daily activity · {points.length} {points.length === 1 ? "date" : "dates"}
          </span>
        )}
      </div>
      <svg
        className="finance-os__plot"
        viewBox="0 0 640 210"
        role="img"
        aria-label={`${label} by date${compact ? "" : ". Exact amounts in chart data below."}`}
        aria-describedby={`${id}-readout ${id}-help`}
        tabIndex={0}
        onPointerMove={(event) => {
          const matrix = event.currentTarget.getScreenCTM();
          if (!matrix) return;
          const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
            matrix.inverse(),
          );
          setActive(
            Math.max(
              0,
              Math.min(points.length - 1, Math.round(((point.x - 76) / 552) * (points.length - 1))),
            ),
          );
        }}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive(0)}
        onBlur={() => setActive(null)}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
          event.preventDefault();
          setActive(
            event.key === "Escape"
              ? null
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? points.length - 1
                  : Math.max(
                      0,
                      Math.min(
                        points.length - 1,
                        (active ?? 0) + (event.key === "ArrowRight" ? 1 : -1),
                      ),
                    ),
          );
        }}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--fos-series)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--fos-series)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((value) => (
          <g key={value}>
            <text x="64" y={y(value) + 4} textAnchor="end">
              {money(value)}
            </text>
            <line
              x1="76"
              x2="628"
              y1={y(value)}
              y2={y(value)}
              stroke="var(--fos-line)"
              strokeDasharray="1.5 7"
              opacity="0.7"
            />
          </g>
        ))}
        <line x1="76" x2="628" y1={y(0)} y2={y(0)} stroke="var(--fos-line)" opacity="0.45" />
        <path
          d={`${line} L${x(values.length - 1)},${y(0)} L${x(0)},${y(0)} Z`}
          fill={`url(#${id})`}
        />
        <path className="line" d={line} />
        {hot !== null && (
          <g aria-hidden="true">
            <line
              x1={x(hot)}
              x2={x(hot)}
              y1="16"
              y2="178"
              stroke="var(--fos-series)"
              strokeDasharray="3 5"
              opacity="0.45"
            />
            <circle
              cx={x(hot)}
              cy={y(values[hot] ?? 0)}
              r="5"
              stroke="var(--fos-bg)"
              strokeWidth="2"
              fill="var(--fos-series)"
            />
          </g>
        )}
        {!compact &&
          values.length <= 14 &&
          values.map((value, i) => (
            <circle key={i} cx={x(i)} cy={y(value)} r="3" fill="var(--fos-series)">
              <title>{`${series[i]?.date}: ${money(value)}`}</title>
            </circle>
          ))}
        {indices.map((i) => (
          <text
            key={i}
            x={x(i)}
            y="204"
            textAnchor={i === 0 ? "start" : i === values.length - 1 ? "end" : "middle"}
          >
            {series[i]?.date.slice(5)}
          </text>
        ))}
      </svg>
      <span className="sr-only" id={`${id}-help`}>
        Use Left and Right arrows to inspect dates, Home and End to jump, or Escape to clear.
      </span>
      {compact || !points.length ? null : (
        <details className="finance-os__chart-data">
          <summary>Chart Data · {points.length} dates</summary>
          <div className="finance-os__table-scroll">
            <table>
              <caption>Recorded activity, not account balance</caption>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p, i) => (
                  <tr key={p.date}>
                    <td>{p.date}</td>
                    <td>{money(values[i] ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </>
  );
}

export function FinanceOverview({
  books,
  rows,
  today,
  money,
  onOpen,
  onRange,
  range = "1M",
  spending = false,
  balancesAvailable = true,
  yearCollectedMinor = 0,
  goalMinor = null,
  onGoal,
  onAsk,
  askBusy = false,
}: {
  books: PhotographerBooks | null;
  rows: readonly EarningsRow[];
  today: string;
  money: (minor: number) => string;
  onOpen: (id: string) => void;
  onRange?: (range: "1W" | "1M" | "YTD" | "ALL") => void;
  range?: "1M" | "YTD" | "ALL";
  spending?: boolean;
  balancesAvailable?: boolean;
  yearCollectedMinor?: number;
  goalMinor?: number | null;
  onGoal?: (minor: number) => void;
  onAsk?: (amount: string) => void;
  askBusy?: boolean;
}) {
  const [selection, setSelection] = useState<Metric>("earnings");
  const metric = spending ? "expenses" : selection;
  const amount =
    metric === "net"
      ? books?.netMinor
      : metric === "expenses"
        ? books?.expensesMinor
        : books?.collectedMinor;
  const prior =
    metric === "net"
      ? books?.previousNetMinor
      : metric === "expenses"
        ? books?.previousExpensesMinor
        : books?.previousCollectedMinor;
  const change = amount !== undefined && prior != null ? amount - prior : null;
  const favorable = change !== null && (metric === "expenses" ? change < 0 : change > 0);
  const slices = metric === "expenses" ? (books?.expenseLines ?? []) : (books?.incomeLines ?? []);
  const upcoming =
    books && balancesAvailable
      ? rows
          .filter(
            (row) =>
              row.currency === books.currency &&
              row.accounting === "invoice" &&
              // EarningsWorkspace projects verified open balances into due-status labels.
              ["open", "upcoming", "overdue"].includes(row.status) &&
              row.eligibleForTotals &&
              row.date &&
              row.date <= today &&
              row.outstandingMinor > 0 &&
              row.dueDate &&
              row.dueDate >= today,
          )
          .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
      : [];
  const openInvoiceCount = books && balancesAvailable ? books.openInvoices : null;
  return (
    <>
      {!books ? (
        <div className="finance-os__card" role="status">
          <h2>Financial data unavailable</h2>
          <p className="finance-os__empty">
            Totals will appear when the selected records have loaded and can be verified.
          </p>
        </div>
      ) : (
        <>
          <div className="finance-os__overview-grid">
            <section
              className="finance-os__stage"
              data-series={
                metric === "net" ? (books.netMinor < 0 ? "negative" : "positive") : "activity"
              }
            >
              {!spending && (
                <div className="finance-os__metric" role="group" aria-label="Shown total">
                  {(["earnings", "expenses", "net"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={metric === value}
                      onClick={() => setSelection(value)}
                    >
                      {value === "earnings"
                        ? "Collected"
                        : value === "expenses"
                          ? "Expenses"
                          : "Net cash flow"}
                    </button>
                  ))}
                </div>
              )}
              <p className="finance-os__hero-figure">{money(amount ?? 0)}</p>
              {change !== null && change !== 0 ? (
                <p className="finance-os__hero-delta" data-tone={favorable ? "up" : "down"}>
                  {`${change > 0 ? "+" : "−"}${money(Math.abs(change))}`}{" "}
                  <span>vs previous equal-length period</span>
                </p>
              ) : (
                <p className="finance-os__hero-delta" data-tone="flat">
                  {change === 0
                    ? "Unchanged from the previous period"
                    : "No prior-period comparison"}
                </p>
              )}
              <Area points={books.spark} metric={metric} money={money} />
              {onRange && (
                <div className="finance-os__range" role="group" aria-label="Reporting period">
                  {(["1M", "YTD", "ALL"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={range === value}
                      onClick={() => onRange(value)}
                    >
                      {value === "1M" ? "1M" : value === "YTD" ? "YTD" : "ALL"}
                    </button>
                  ))}
                </div>
              )}
            </section>
            <article className="finance-os__card finance-os__allocation">
              <h2>{metric === "expenses" ? "Expense breakdown" : "Collected breakdown"}</h2>
              <SpendSankey
                sourceLabel={metric === "expenses" ? "Expenses" : "Collected"}
                sourceMinor={metric === "expenses" ? books.expensesMinor : books.collectedMinor}
                slices={slices}
                money={money}
                donut
              />
            </article>
          </div>
          <dl className="finance-os__pulse">
            <div>
              <dt>Outstanding</dt>
              <dd>{balancesAvailable ? money(books.outstandingMinor) : "—"}</dd>
            </div>
            <div>
              <dt>Overdue</dt>
              <dd data-tone={books.overdueMinor > 0 ? "down" : undefined}>
                {balancesAvailable ? money(books.overdueMinor) : "—"}
              </dd>
            </div>
            <div>
              <dt>Expenses</dt>
              <dd>{money(books.expensesMinor)}</dd>
            </div>
            <div>
              <dt>Net cash flow</dt>
              <dd data-tone={books.netMinor < 0 ? "down" : "up"}>{money(books.netMinor)}</dd>
            </div>
            <div>
              <dt>Collection entries</dt>
              <dd>{books.paidThisPeriod}</dd>
            </div>
            <div>
              <dt>Open invoices</dt>
              <dd>{openInvoiceCount ?? "—"}</dd>
            </div>
          </dl>
          {!spending && onGoal && (
            <RevenueGoal
              year={Number(today.slice(0, 4))}
              today={today}
              collectedMinor={yearCollectedMinor}
              goalMinor={goalMinor}
              money={money}
              onGoal={onGoal}
              onAsk={onAsk}
              askBusy={askBusy}
            />
          )}
          <div className="finance-os__lower">
            <article className="finance-os__card">
              <h2>Latest transactions</h2>
              {books.stream.length ? (
                <ul className="finance-os__rows">
                  {books.stream.map((item) => {
                    const source = rows.find((row) => row.id === item.id);
                    const signed = source
                      ? source.accounting === "expense"
                        ? -source.amountMinor
                        : source.amountMinor
                      : item.kind === "out"
                        ? -Math.abs(item.amountMinor)
                        : item.amountMinor;
                    return (
                      <li key={item.id}>
                        <button type="button" onClick={() => onOpen(item.id)}>
                          <span>
                            <strong>{item.who}</strong>
                            <small>
                              {item.date} · {item.label}
                            </small>
                          </span>
                          <em data-kind={signed < 0 ? "out" : "in"}>
                            {signed > 0 ? "+" : ""}
                            {money(signed)}
                          </em>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="finance-os__empty">
                  No recorded cash in this period. Add an entry or invoice to get started.
                </p>
              )}
            </article>
            <article className="finance-os__card">
              <h2>Upcoming invoice payments</h2>
              {!balancesAvailable ? (
                <p className="finance-os__empty">
                  Verified invoice balances are unavailable. Connect and reconcile your payment
                  history to see what is due.
                </p>
              ) : upcoming.length ? (
                <ul className="finance-os__rows">
                  {upcoming.slice(0, 6).map((row) => (
                    <li key={row.id}>
                      <button type="button" onClick={() => onOpen(row.id)}>
                        <span>
                          <strong>{row.who ?? row.description}</strong>
                          <small>Due {row.dueDate}</small>
                        </span>
                        <em>{money(row.outstandingMinor)}</em>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="finance-os__empty">No open invoices due on or after today.</p>
              )}
            </article>
          </div>
        </>
      )}
    </>
  );
}
