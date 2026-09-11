import { useId, useState } from "react";
import type { PhotographerBooks, BooksSpark } from "@/lib/photographer-books";
import type { BooksDay, BooksMonth } from "@/lib/finance-graphs";
import { activityHeat, compactChartAmount } from "@/lib/finance-graphs";
import type { EarningsRow } from "@/lib/earnings-ledger";
import { RevenueGoal } from "./RevenueGoal";

const PALETTE = [
  "#438ad1",
  "#36a994",
  "#9674d7",
  "#d36ba6",
  "#da874e",
  "#b69532",
  "#cc6464",
  "#7d8da3",
];
type Metric = "earnings" | "expenses" | "net";

function Area({
  points,
  metric,
  money,
}: {
  points: BooksSpark[];
  metric: Metric;
  money: (minor: number) => string;
}) {
  const id = useId().replace(/:/g, "");
  const values = points.map((p) =>
    metric === "net" ? p.netMinor : metric === "expenses" ? p.expensesMinor : p.collectedMinor,
  );
  if (!values.length)
    return <div className="finance-os__chart-empty">No recorded activity in this period.</div>;
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
        aria-label={`${metric === "net" ? "Net cash flow" : metric === "expenses" ? "Expenses" : "Collected"} by date. Exact amounts in chart data below.`}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--fos-series)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--fos-series)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line
          x1="6"
          x2="634"
          y1={y(0)}
          y2={y(0)}
          stroke="var(--fos-line)"
          opacity="0.7"
        />
        <path
          d={`${line} L${x(values.length - 1)},${y(0)} L${x(0)},${y(0)} Z`}
          fill={`url(#${id})`}
        />
        <path className="line" d={line} />
        {values.length <= 14 &&
          values.map((value, i) => (
            <circle key={i} cx={x(i)} cy={y(value)} r="3" fill="var(--fos-series)">
              <title>{`${points[i]?.date}: ${money(value)}`}</title>
            </circle>
          ))}
        {indices.map((i) => (
          <text
            key={i}
            x={x(i)}
            y="204"
            textAnchor={i === 0 ? "start" : i === values.length - 1 ? "end" : "middle"}
          >
            {points[i]?.date.slice(5)}
          </text>
        ))}
      </svg>
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
    </>
  );
}

function Donut({
  slices,
  money,
}: {
  slices: { label: string; amountMinor: number }[];
  money: (minor: number) => string;
}) {
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.amountMinor), 0);
  const circumference = 2 * Math.PI * 46;
  let offset = 0;
  return (
    <div className="finance-os__donut">
      <svg viewBox="0 0 140 140" role="img" aria-label={`Category total ${money(total)}`}>
        <circle cx="70" cy="70" r="46" fill="none" stroke="var(--fos-line)" strokeWidth="10" />
        {total > 0 &&
          slices.map((slice, i) => {
            const amount = Math.max(0, slice.amountMinor),
              dash = (amount / total) * circumference,
              rotation = (offset / total) * 360 - 90;
            offset += amount;
            return (
              <circle
                key={slice.label}
                cx="70"
                cy="70"
                r="46"
                fill="none"
                stroke={PALETTE[i % PALETTE.length]}
                strokeWidth="10"
                strokeDasharray={`${dash} ${circumference - dash}`}
                transform={`rotate(${rotation} 70 70)`}
              >
                <title>{`${slice.label}: ${money(amount)}`}</title>
              </circle>
            );
          })}
        <text x="70" y="70" textAnchor="middle" className="finance-os__donut-total">
          {money(total)}
        </text>
        <text x="70" y="85" textAnchor="middle" fontSize="8">
          Recorded total
        </text>
      </svg>
      <ul
        className="finance-os__legend"
        tabIndex={slices.length > 5 ? 0 : undefined}
        aria-label={`All ${slices.length} categories${slices.length > 5 ? ". Scroll to see every category." : ""}`}
      >
        {slices.length ? (
          slices.map((slice, i) => (
            <li key={slice.label} aria-label={`${slice.label}: ${money(slice.amountMinor)}`}>
              <i style={{ background: PALETTE[i % PALETTE.length] }} />
              <span>
                {slice.label}
                <small>
                  {Math.round((Math.max(0, slice.amountMinor) / Math.max(1, total)) * 100)}% of
                  total
                </small>
              </span>
              <strong>{money(slice.amountMinor)}</strong>
            </li>
          ))
        ) : (
          <li>
            <span>No categories recorded</span>
          </li>
        )}
      </ul>
    </div>
  );
}

function monthStamp(month: string) {
  return new Date(`${month}-01T12:00:00Z`)
    .toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })
    .toUpperCase();
}

function MonthCalendar({
  days,
  today,
  spending,
  currency,
  money,
}: {
  days: BooksDay[];
  today: string;
  spending: boolean;
  currency: string;
  money: (minor: number) => string;
}) {
  const amounts = days.map((day) => (spending ? day.expensesMinor : day.collectedMinor));
  const peak = Math.max(0, ...amounts);
  return (
    <div className="finance-os__monthcal" role="grid" aria-label={spending ? "Spend by day" : "Collected by day"}>
      {days.map((day, i) => {
        const amount = amounts[i] ?? 0;
        const heat = activityHeat(amount, peak);
        return (
          <div
            key={day.date}
            role="gridcell"
            className="finance-os__monthcal-day"
            data-today={day.date === today || undefined}
            data-heat={heat}
            title={`${day.date}: ${money(amount)}`}
          >
            <span>{Number(day.date.slice(8, 10))}</span>
            <small>{compactChartAmount(amount, currency)}</small>
          </div>
        );
      })}
    </div>
  );
}

function MonthBars({
  months,
  spending,
  money,
}: {
  months: BooksMonth[];
  spending: boolean;
  money: (minor: number) => string;
}) {
  const id = useId().replace(/:/g, "");
  const values = months.map((row) => (spending ? row.expensesMinor : row.collectedMinor));
  const peak = Math.max(1, ...values);
  const width = 360;
  const height = 148;
  const gap = 10;
  const bar = (width - gap * (values.length + 1)) / Math.max(1, values.length);
  return (
    <svg
      className="finance-os__bars"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={spending ? "Monthly spend" : "Monthly collected"}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="var(--fos-bar-from)" />
          <stop offset="100%" stopColor="var(--fos-bar-to)" />
        </linearGradient>
      </defs>
      {values.map((value, i) => {
        const x = gap + i * (bar + gap);
        const h = value > 0 ? Math.max(8, (value / peak) * 108) : 4;
        const y = 118 - h;
        const current = i === values.length - 1;
        return (
          <g key={months[i]!.month}>
            <rect
              x={x}
              y={y}
              width={bar}
              height={h}
              rx="7"
              fill={current ? `url(#${id})` : "var(--fos-bar-mute)"}
            >
              <title>{`${months[i]!.month}: ${money(value)}`}</title>
            </rect>
            <text x={x + bar / 2} y="138" textAnchor="middle">
              {monthStamp(months[i]!.month)}
            </text>
          </g>
        );
      })}
    </svg>
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
  const categoryTotal = slices.reduce((sum, slice) => sum + Math.max(0, slice.amountMinor), 0);
  const categoryAdjustments =
    (metric === "expenses" ? books?.expensesMinor : books?.collectedMinor) ?? 0;
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
  const monthTotal = books
    ? books.monthDays.reduce(
        (sum, day) => sum + (spending ? day.expensesMinor : day.collectedMinor),
        0,
      )
    : 0;
  const latestMonth = books?.recentMonths.at(-1);
  const latestMonthTotal = latestMonth
    ? spending
      ? latestMonth.expensesMinor
      : latestMonth.collectedMinor
    : 0;
  return (
    <>
      <div className="finance-os__title">
        <div>
          <h1 id="earnings-title" tabIndex={-1}>
            {spending ? "Spending" : "Earnings"}
          </h1>
        </div>
        {onRange && (
          <div className="finance-os__range" role="group" aria-label="Reporting period">
            {(["1M", "YTD", "ALL"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={range === value}
                onClick={() => onRange(value)}
              >
                {value === "1M" ? "Month" : value === "YTD" ? "Year" : "All Time"}
              </button>
            ))}
          </div>
        )}
      </div>
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
      {!books ? (
        <div className="finance-os__card" role="status">
          <h2>Financial data unavailable</h2>
          <p className="finance-os__empty">
            Totals will appear when the selected records have loaded and can be verified.
          </p>
        </div>
      ) : (
        <>
          <dl className="finance-os__pulse">
            <div>
              <dt>Collected</dt>
              <dd>{money(books.collectedMinor)}</dd>
              <small>After refunds</small>
            </div>
            <div>
              <dt>Expenses</dt>
              <dd>{money(books.expensesMinor)}</dd>
              <small>Recorded cash out</small>
            </div>
            <div>
              <dt>Net Cash Flow</dt>
              <dd data-tone={books.netMinor < 0 ? "down" : "up"}>{money(books.netMinor)}</dd>
              <small>Before tax · not equity</small>
            </div>
            <div>
              <dt>Outstanding</dt>
              <dd>{balancesAvailable ? money(books.outstandingMinor) : "—"}</dd>
              <small>
                {balancesAvailable
                  ? `${money(books.overdueMinor)} overdue`
                  : "Verified balances unavailable"}
              </small>
            </div>
          </dl>
          <div className="finance-os__boards">
            <article className="finance-os__board">
              <h2>{spending ? "Spent this month" : "Collected this month"}</h2>
              <p className="finance-os__figure">{money(monthTotal)}</p>
              <MonthCalendar
                days={books.monthDays}
                today={today}
                spending={spending}
                currency={books.currency}
                money={money}
              />
            </article>
            <article className="finance-os__board">
              <h2>{spending ? "Monthly spend" : "Monthly collected"}</h2>
              <p className="finance-os__figure">{money(latestMonthTotal)}</p>
              <MonthBars months={books.recentMonths} spending={spending} money={money} />
            </article>
            <article
              className="finance-os__board"
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
                          : "Net"}
                    </button>
                  ))}
                </div>
              )}
              <h2>
                {metric === "earnings"
                  ? "Earned this period"
                  : metric === "expenses"
                    ? "Spent this period"
                    : "Net cash flow this period"}
              </h2>
              <p className="finance-os__figure">{money(amount ?? 0)}</p>
              <p
                className="finance-os__vs"
                data-tone={change === null || change === 0 ? "flat" : favorable ? "up" : "down"}
              >
                {change === null
                  ? "No prior window to compare"
                  : `${change > 0 ? "+" : change < 0 ? "−" : ""}${money(Math.abs(change))} vs prior period`}
              </p>
              <Area points={books.spark} metric={metric} money={money} />
            </article>
          </div>
          <div className="finance-os__grid">
            <article className="finance-os__card">
              <h2>Category breakdown</h2>
              <Donut slices={slices} money={money} />
              {slices.length > 5 && (
                <p className="finance-os__category-note">
                  {slices.length} categories · Scroll the list for all amounts
                </p>
              )}
              {categoryAdjustments !== categoryTotal && (
                <p className="finance-os__category-note">
                  {metric === "expenses"
                    ? "Expense credits and corrections"
                    : "Refunds and receipt adjustments"}
                  : {money(categoryAdjustments - categoryTotal)}. Included in the period total, not
                  positive pie slices.
                </p>
              )}
            </article>
          </div>
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
