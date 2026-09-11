import { useMemo, useState } from "react";
import type { PhotographerBooks } from "@/lib/photographer-books";
import type { EarningsRow } from "@/lib/earnings-ledger";
import { formatEarningsMoney } from "./earnings-ui";

const PALETTE = ["#5b9fff", "#3ecfb2", "#c084fc", "#f472b6", "#fb923c", "#facc15", "#f87171", "#94a3b8"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function tone(current: number, previous: number | null): "up" | "down" | "flat" {
  if (previous === null || previous === 0) return "flat";
  if (current > previous) return "up";
  if (current < previous) return "down";
  return "flat";
}

function monthGrid(today: string) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  const first = new Date(Date.UTC(year, month, 1));
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const pad = first.getUTCDay();
  return { pad, days, year, month };
}

function Area({ values }: { values: number[] }) {
  if (values.length < 2) return <svg className="finance-os__plot" aria-hidden="true" />;
  const w = 640;
  const h = 180;
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / (max - min)) * (h - 8) - 4;
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <svg className="finance-os__plot" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Period activity">
      <defs>
        <linearGradient id="fos-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5b9fff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#5b9fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="area" d={area} />
      <path className="line" d={line} />
    </svg>
  );
}

function Donut({
  slices,
  center,
}: {
  slices: { label: string; amountMinor: number }[];
  center: string;
}) {
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.amountMinor), 0);
  const r = 46;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="finance-os__donut">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#ffffff12" strokeWidth="14" />
        {total > 0
          ? slices.map((slice, i) => {
              const frac = Math.max(0, slice.amountMinor) / total;
              const dash = frac * c;
              const rot = (acc / total) * 360 - 90;
              acc += Math.max(0, slice.amountMinor);
              return (
                <circle
                  key={slice.label}
                  cx="60"
                  cy="60"
                  r={r}
                  fill="none"
                  stroke={PALETTE[i % PALETTE.length]}
                  strokeWidth="14"
                  strokeDasharray={`${dash} ${c - dash}`}
                  transform={`rotate(${rot} 60 60)`}
                />
              );
            })
          : null}
        <text x="60" y="64" textAnchor="middle" fill="#f4f4f5" fontSize="11" fontFamily="inherit">
          {center}
        </text>
      </svg>
      <ul className="finance-os__legend">
        {slices.length ? (
          slices.map((slice, i) => (
            <li key={slice.label}>
              <i style={{ background: PALETTE[i % PALETTE.length] }} />
              <span>{slice.label}</span>
              <strong>{Math.round((Math.max(0, slice.amountMinor) / Math.max(1, total)) * 100)}%</strong>
            </li>
          ))
        ) : (
          <li>
            <i style={{ background: "#ffffff22" }} />
            <span>No split in this period</span>
            <strong>—</strong>
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
}: {
  books: PhotographerBooks | null;
  rows: readonly EarningsRow[];
  today: string;
  money: (minor: number) => string;
  onOpen: (id: string) => void;
  onRange?: (range: "1W" | "1M" | "YTD" | "ALL") => void;
}) {
  const [metric, setMetric] = useState<"earnings" | "expenses">("earnings");
  const [range, setRange] = useState<"1W" | "1M" | "YTD" | "ALL">("1M");
  const pickRange = (next: "1W" | "1M" | "YTD" | "ALL") => {
    setRange(next);
    onRange?.(next);
  };
  const earned = books?.collectedMinor ?? 0;
  const spent = books?.expensesMinor ?? 0;
  const amount = metric === "earnings" ? earned : spent;
  const prior =
    metric === "earnings" ? (books?.previousCollectedMinor ?? null) : (books?.previousExpensesMinor ?? null);
  const spark = books?.spark ?? [];
  const values = useMemo(() => {
    const series = spark.map((point) =>
      metric === "earnings" ? point.collectedMinor : point.expensesMinor,
    );
    if (range === "1W") return series.slice(-7);
    return series;
  }, [spark, metric, range]);
  const slices = metric === "earnings" ? (books?.incomeLines ?? []) : (books?.expenseLines ?? []);
  const upcoming = rows
    .filter(
      (row) =>
        row.accounting === "invoice" &&
        row.outstandingMinor > 0 &&
        row.dueDate &&
        row.dueDate >= today,
    )
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  const dueOn = new Set(upcoming.map((row) => row.dueDate));
  const grid = monthGrid(today);
  const change = tone(amount, prior);
  return (
    <>
      <div className="finance-os__title">
        <h1 id="earnings-title" tabIndex={-1}>
          Earnings
        </h1>
        <div className="finance-os__range" role="group" aria-label="Chart range">
          {(["1W", "1M", "YTD", "ALL"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={range === item}
              onClick={() => pickRange(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="finance-os__grid">
        <article className="finance-os__card">
          <div className="finance-os__metric" role="group" aria-label="Shown total">
            <button type="button" aria-pressed={metric === "earnings"} onClick={() => setMetric("earnings")}>
              Earnings
            </button>
            <button type="button" aria-pressed={metric === "expenses"} onClick={() => setMetric("expenses")}>
              Expenses
            </button>
          </div>
          <h2>{metric === "earnings" ? "Earned this period" : "Spent this period"}</h2>
          <p className="finance-os__figure">{books ? money(amount) : "—"}</p>
          <p className="finance-os__vs" data-tone={change}>
            {prior === null
              ? "No prior window to compare"
              : `${change === "up" ? "↑" : change === "down" ? "↓" : "→"} vs ${formatEarningsMoney(prior, books?.currency ?? "USD")}`}
          </p>
          <Area values={values} />
        </article>
        <article className="finance-os__card">
          <h2>Category breakdown</h2>
          <Donut slices={slices.slice(0, 8)} center={books ? money(amount) : "—"} />
        </article>
      </div>
      <div className="finance-os__lower">
        <article className="finance-os__card">
          <h2>Latest transactions</h2>
          {books?.stream.length ? (
            <ul className="finance-os__rows">
              {books.stream.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => onOpen(item.id)}>
                    <span>
                      <strong>{item.who}</strong>
                      <span> {item.date}</span>
                    </span>
                    <em data-kind={item.kind}>
                      {item.kind === "out" ? "−" : "+"}
                      {money(item.amountMinor)}
                    </em>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="finance-os__empty">No recorded cash in this period.</p>
          )}
        </article>
        <article className="finance-os__card">
          <h2>Upcoming</h2>
          <div className="finance-os__cal" aria-label="Due dates this month">
            {WEEKDAYS.map((day) => (
              <b key={day}>{day.slice(0, 2)}</b>
            ))}
            {Array.from({ length: grid.pad }, (_, i) => (
              <span key={`pad-${i}`} />
            ))}
            {Array.from({ length: grid.days }, (_, i) => {
              const day = String(i + 1).padStart(2, "0");
              const date = `${String(grid.year).padStart(4, "0")}-${String(grid.month + 1).padStart(2, "0")}-${day}`;
              return (
                <button
                  key={date}
                  type="button"
                  data-today={date === today ? "true" : undefined}
                  data-has={dueOn.has(date) ? "true" : undefined}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          {upcoming.length ? (
            <ul className="finance-os__rows">
              {upcoming.slice(0, 6).map((row) => (
                <li key={row.id}>
                  <button type="button" onClick={() => onOpen(row.id)}>
                    <span>
                      <strong>{row.who ?? row.description}</strong>
                      <span> due {row.dueDate}</span>
                    </span>
                    <em>{money(row.outstandingMinor)}</em>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="finance-os__empty">No open invoices due after today.</p>
          )}
        </article>
      </div>
    </>
  );
}
