import { useId, useState } from "react";
import type { PhotographerBooks, BooksSpark } from "@/lib/photographer-books";
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
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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
            <stop offset="0%" stopColor="var(--fos-series)" stopOpacity="0.24" />
            <stop offset="100%" stopColor="var(--fos-series)" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {[16, 97, 178].map((v) => (
          <line key={v} x1="6" x2="634" y1={v} y2={v} stroke="var(--fos-line)" />
        ))}
        <line
          x1="6"
          x2="634"
          y1={y(0)}
          y2={y(0)}
          stroke="var(--fos-muted)"
          strokeDasharray="3 5"
          opacity="0.5"
        />
        <path
          d={`${line} L${x(values.length - 1)},${y(0)} L${x(0)},${y(0)} Z`}
          fill={`url(#${id})`}
        />
        <path className="line" d={line} />
        {values.map((value, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(value)}
            r={values.length > 100 ? 1.5 : 3}
            fill="var(--fos-series)"
          >
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
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
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
  const year = Number(today.slice(0, 4)),
    month = Number(today.slice(5, 7)) - 1;
  const pad = new Date(Date.UTC(year, month, 1)).getUTCDay(),
    days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const activeDay =
    selectedDay && upcoming.some((row) => row.dueDate === selectedDay) ? selectedDay : null;
  const calendarRows = activeDay ? upcoming.filter((row) => row.dueDate === activeDay) : upcoming;
  return (
    <>
      <div className="finance-os__title">
        <div>
          <p className="finance-os__eyebrow">Your photography business</p>
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
          <div className="finance-os__grid">
            <article
              className="finance-os__card"
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
            <article className="finance-os__card">
              <h2>Category breakdown</h2>
              <p className="finance-os__vs">
                {metric === "expenses" ? "Recorded expenses" : "Gross receipts · before refunds"}
              </p>
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
              ) : (
                <>
                  <p className="finance-os__vs">
                    {new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", {
                      month: "long",
                      year: "numeric",
                      timeZone: "UTC",
                    })}{" "}
                    · expected, not collected
                  </p>
                  <div className="finance-os__cal" aria-label="Invoice due dates this month">
                    {WEEKDAYS.map((d) => (
                      <b key={d}>{d.slice(0, 2)}</b>
                    ))}
                    {Array.from({ length: pad }, (_, i) => (
                      <span key={`pad-${i}`} />
                    ))}
                    {Array.from({ length: days }, (_, i) => {
                      const date = `${today.slice(0, 7)}-${String(i + 1).padStart(2, "0")}`;
                      const has = upcoming.some((row) => row.dueDate === date);
                      return (
                        <button
                          key={date}
                          type="button"
                          aria-label={`${date}${has ? ", invoices due" : ", no invoices due"}`}
                          aria-pressed={activeDay === date}
                          disabled={!has}
                          data-today={date === today || undefined}
                          data-has={has || undefined}
                          onClick={() => setSelectedDay(activeDay === date ? null : date)}
                        >
                          {i + 1}
                          {has && <i />}
                        </button>
                      );
                    })}
                  </div>
                  {activeDay && (
                    <button
                      type="button"
                      className="finance-os__text-button"
                      onClick={() => setSelectedDay(null)}
                    >
                      Show All Upcoming
                    </button>
                  )}
                  {calendarRows.length ? (
                    <ul className="finance-os__rows">
                      {calendarRows.slice(0, 6).map((row) => (
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
                </>
              )}
            </article>
          </div>
        </>
      )}
    </>
  );
}
