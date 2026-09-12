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
  const values = points.length
    ? points.map((p) =>
        metric === "net" ? p.netMinor : metric === "expenses" ? p.expensesMinor : p.collectedMinor,
      )
    : [0, 0];
  const series = points.length ? points : [{ date: "" }, { date: "" }];
  const min = Math.min(0, ...values),
    max = Math.max(1, ...values);
  const x = (i: number) => (values.length === 1 ? 320 : 6 + (i / (values.length - 1)) * 628);
  const y = (value: number) => 178 - ((value - min) / (max - min)) * 162;
  const line = values.map((value, i) => `${i ? "L" : "M"}${x(i)},${y(value)}`).join(" ");
  const indices = [...new Set([0, Math.floor((values.length - 1) / 2), values.length - 1])];
  return (
    <>
      <svg
        className="finance-os__plot"
        viewBox="0 0 640 210"
        role="img"
        aria-label={`${metric === "net" ? "Net cash flow" : metric === "expenses" ? "Expenses" : "Collected"} by date${compact ? "" : ". Exact amounts in chart data below."}`}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--fos-series)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--fos-series)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.2, 0.4, 0.6, 0.8].map((t) => (
          <line
            key={t}
            x1="6"
            x2="634"
            y1={16 + t * 162}
            y2={16 + t * 162}
            stroke="var(--fos-line)"
            strokeDasharray="1.5 7"
            opacity="0.7"
          />
        ))}
        <line
          x1="6"
          x2="634"
          y1={y(0)}
          y2={y(0)}
          stroke="var(--fos-line)"
          opacity="0.45"
        />
        <path
          d={`${line} L${x(values.length - 1)},${y(0)} L${x(0)},${y(0)} Z`}
          fill={`url(#${id})`}
        />
        <path className="line" d={line} />
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
  return (
    <>
      <div className="finance-os__title">
        <h1 id="earnings-title" tabIndex={-1}>
          {spending ? "Spending" : "Earnings"}
        </h1>
      </div>
      {!books ? (
        <div className="finance-os__card" role="status">
          <h2>Financial data unavailable</h2>
          <p className="finance-os__empty">
            Totals will appear when the selected records have loaded and can be verified.
          </p>
        </div>
      ) : (
        <>
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
                    {value === "earnings" ? "Collected" : value === "expenses" ? "Expenses" : "Net"}
                  </button>
                ))}
              </div>
            )}
            <p className="finance-os__hero-figure">{money(amount ?? 0)}</p>
            {change !== null && change !== 0 ? (
              <p className="finance-os__hero-delta" data-tone={favorable ? "up" : "down"}>
                {`${change > 0 ? "+" : "−"}${money(Math.abs(change))}`}
              </p>
            ) : (
              <p className="finance-os__hero-delta" data-tone="flat">
                {"\u00a0"}
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
              <dt>Net</dt>
              <dd data-tone={books.netMinor < 0 ? "down" : "up"}>{money(books.netMinor)}</dd>
            </div>
            <div>
              <dt>Paid jobs</dt>
              <dd>{books.paidThisPeriod}</dd>
            </div>
            <div>
              <dt>Open invoices</dt>
              <dd>{books.openInvoices}</dd>
            </div>
            <div>
              <dt>Avg job</dt>
              <dd>
                {books.paidThisPeriod > 0
                  ? money(Math.round(books.collectedMinor / books.paidThisPeriod))
                  : "—"}
              </dd>
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
          <article className="finance-os__card finance-os__sankey">
            <h2>Allocation</h2>
            <SpendSankey
              sourceLabel={spending ? "Spent" : "Collected"}
              sourceMinor={spending ? books.expensesMinor : books.collectedMinor}
              slices={slices}
              money={money}
            />
          </article>
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
