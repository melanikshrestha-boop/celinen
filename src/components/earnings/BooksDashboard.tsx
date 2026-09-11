import type { PhotographerBooks } from "@/lib/photographer-books";
import { formatEarningsMoney } from "./earnings-ui";
import "./books-dashboard.css";

function pct(current: number, previous: number | null): { text: string; tone: "up" | "down" | "flat" } | null {
  if (previous === null || previous === 0) return null;
  const change = ((current - previous) / Math.abs(previous)) * 100;
  if (!Number.isFinite(change) || Math.abs(change) < 0.05) return { text: "0%", tone: "flat" };
  const text = `${change > 0 ? "↑" : "↓"} ${Math.abs(change).toFixed(1)}%`;
  return { text, tone: change > 0 ? "up" : "down" };
}

function Spark({ values, tone }: { values: number[]; tone: "blue" | "green" | "red" }) {
  if (values.length < 2) return <div className="books-spark" aria-hidden="true" />;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = Math.max(1, max - min);
  const w = 240;
  const h = 64;
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / span) * h;
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  return (
    <svg className={`books-spark books-spark--${tone}`} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function Card({
  title,
  amount,
  prior,
  values,
  tone,
  currency,
}: {
  title: string;
  amount: number;
  prior: number | null;
  values: number[];
  tone: "blue" | "green" | "red";
  currency: string;
}) {
  const change = pct(amount, prior);
  return (
    <article className="books-card">
      <h3>{title}</h3>
      <p className="books-card__figure">
        <strong>{formatEarningsMoney(amount, currency)}</strong>
        {prior !== null ? (
          <span className="books-card__from">from {formatEarningsMoney(prior, currency)}</span>
        ) : null}
        {change ? <em data-tone={change.tone}>{change.text}</em> : null}
      </p>
      <Spark values={values} tone={tone} />
    </article>
  );
}

export function BooksDashboard({
  books,
  stripeLabel,
}: {
  books: PhotographerBooks;
  stripeLabel: string;
}) {
  const spark = books.spark;
  return (
    <section className="books-dashboard" aria-label="Photographer books">
      <div className="books-dashboard__grid">
        <div className="books-dashboard__charts">
          <Card
            title="Collected"
            amount={books.collectedMinor}
            prior={books.previousCollectedMinor}
            values={spark.map((point) => point.collectedMinor)}
            tone="blue"
            currency={books.currency}
          />
          <Card
            title="Net"
            amount={books.netMinor}
            prior={books.previousNetMinor}
            values={spark.map((point) => point.netMinor)}
            tone="green"
            currency={books.currency}
          />
          <Card
            title="Expenses"
            amount={books.expensesMinor}
            prior={books.previousExpensesMinor}
            values={spark.map((point) => point.expensesMinor)}
            tone="red"
            currency={books.currency}
          />
          <Card
            title="Outstanding"
            amount={books.outstandingMinor}
            prior={null}
            values={spark.map((point) => point.netMinor)}
            tone="blue"
            currency={books.currency}
          />
        </div>
        <aside className="books-side">
          <div className="books-panel">
            <h3>Breakdown</h3>
            <ul>
              <li>
                <span>{books.paidThisPeriod} collections</span>
                <strong>{formatEarningsMoney(books.collectedMinor, books.currency)}</strong>
              </li>
              <li>
                <span>{books.openInvoices} open invoices</span>
                <strong>{formatEarningsMoney(books.outstandingMinor, books.currency)}</strong>
              </li>
              <li>
                <span>Overdue</span>
                <strong data-tone={books.overdueMinor > 0 ? "down" : undefined}>
                  {formatEarningsMoney(books.overdueMinor, books.currency)}
                </strong>
              </li>
              <li>
                <span>{books.expenseCount} expenses</span>
                <strong>{formatEarningsMoney(books.expensesMinor, books.currency)}</strong>
              </li>
              <li>
                <span>Gallery</span>
                <strong>{formatEarningsMoney(books.gallerySalesMinor, books.currency)}</strong>
              </li>
            </ul>
          </div>
          <div className="books-panel">
            <h3>Activity</h3>
            <p className="books-panel__note">{stripeLabel}</p>
            {books.stream.length ? (
              <ul className="books-stream">
                {books.stream.map((item) => (
                  <li key={item.id}>
                    <span>
                      {item.kind === "in" ? "In" : "Out"} · {item.who}
                    </span>
                    <strong data-tone={item.kind === "out" ? "down" : "up"}>
                      {item.kind === "out" ? "−" : ""}
                      {formatEarningsMoney(Math.abs(item.amountMinor), books.currency)}
                    </strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="books-panel__empty">No recorded activity in this period.</p>
            )}
          </div>
          <div className="books-panel">
            <h3>Period statement</h3>
            <p className="books-panel__note">Bookkeeping totals, not a tax filing.</p>
            <ul>
              {books.incomeLines.map((line) => (
                <li key={line.label}>
                  <span>{line.label}</span>
                  <strong>{formatEarningsMoney(line.amountMinor, books.currency)}</strong>
                </li>
              ))}
              {books.expenseLines.map((line) => (
                <li key={`e-${line.label}`}>
                  <span>{line.label}</span>
                  <strong data-tone="down">
                    −{formatEarningsMoney(line.amountMinor, books.currency)}
                  </strong>
                </li>
              ))}
              <li>
                <span>Net</span>
                <strong>{formatEarningsMoney(books.netMinor, books.currency)}</strong>
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </section>
  );
}
