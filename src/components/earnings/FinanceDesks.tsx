import type { PhotographerBooks } from "@/lib/photographer-books";
import type { EarningsRow } from "@/lib/earnings-ledger";

const GEAR = /equipment|lens|camera|studio|computer|lighting|gear/i;

export function FinanceInvest({
  books,
  rows,
  money,
}: {
  books: PhotographerBooks | null;
  rows: readonly EarningsRow[];
  money: (minor: number) => string;
}) {
  const gear = rows.filter(
    (row) => row.accounting === "expense" && row.eligibleForTotals && GEAR.test(row.category || row.description),
  );
  const gearMinor = gear.reduce((sum, row) => sum + row.amountMinor, 0);
  return (
    <div className="finance-os__stack">
      <div className="finance-os__title">
        <h1 id="earnings-title" tabIndex={-1}>
          Invest
        </h1>
      </div>
      <article className="finance-os__card">
        <h2>Studio capital</h2>
        <p className="finance-os__figure">{books ? money(gearMinor) : "—"}</p>
        <p className="finance-os__vs">
          Recorded gear, studio, and equipment expenses. This is not a brokerage balance.
        </p>
        <dl>
          <div className="finance-os__stat">
            <dt>All expenses this period</dt>
            <dd>{books ? money(books.expensesMinor) : "—"}</dd>
          </div>
          <div className="finance-os__stat">
            <dt>Equipment-tagged entries</dt>
            <dd>{gear.length}</dd>
          </div>
        </dl>
      </article>
      <article className="finance-os__card">
        <h2>Gear log</h2>
        {gear.length ? (
          <ul className="finance-os__rows">
            {gear.slice(0, 12).map((row) => (
              <li key={row.id}>
                <span>
                  <strong>{row.description}</strong>
                  <span> {row.date}</span>
                </span>
                <em data-kind="out">−{money(row.amountMinor)}</em>
              </li>
            ))}
          </ul>
        ) : (
          <p className="finance-os__empty">
            Tag expenses as Equipment, Studio, Camera, or Lens to see them here.
          </p>
        )}
      </article>
    </div>
  );
}

export function FinanceEquity({
  books,
  money,
}: {
  books: PhotographerBooks | null;
  money: (minor: number) => string;
}) {
  return (
    <div className="finance-os__stack">
      <div className="finance-os__title">
        <h1 id="earnings-title" tabIndex={-1}>
          Equity
        </h1>
      </div>
      <article className="finance-os__card">
        <h2>Books position</h2>
        <p className="finance-os__figure">{books ? money(books.netMinor) : "—"}</p>
        <p className="finance-os__vs">
          Recorded collections minus recorded expenses. Not a bank balance and not a valuation.
        </p>
        <dl>
          <div className="finance-os__stat">
            <dt>Collected</dt>
            <dd>{books ? money(books.collectedMinor) : "—"}</dd>
          </div>
          <div className="finance-os__stat">
            <dt>Receivables</dt>
            <dd>{books ? money(books.outstandingMinor) : "—"}</dd>
          </div>
          <div className="finance-os__stat">
            <dt>Overdue</dt>
            <dd>{books ? money(books.overdueMinor) : "—"}</dd>
          </div>
          <div className="finance-os__stat">
            <dt>Expenses</dt>
            <dd>{books ? money(books.expensesMinor) : "—"}</dd>
          </div>
        </dl>
      </article>
    </div>
  );
}

export function FinanceForecast({
  rows,
  today,
  money,
  onOpen,
}: {
  rows: readonly EarningsRow[];
  today: string;
  money: (minor: number) => string;
  onOpen: (id: string) => void;
}) {
  const upcoming = rows
    .filter(
      (row) =>
        row.accounting === "invoice" &&
        row.outstandingMinor > 0 &&
        row.dueDate &&
        row.dueDate >= today,
    )
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  const due = upcoming.reduce((sum, row) => sum + row.outstandingMinor, 0);
  return (
    <div className="finance-os__stack">
      <div className="finance-os__title">
        <h1 id="earnings-title" tabIndex={-1}>
          Forecast
        </h1>
      </div>
      <article className="finance-os__card">
        <h2>Open invoices still due</h2>
        <p className="finance-os__figure">{money(due)}</p>
        <p className="finance-os__vs">{upcoming.length} invoices with a due date on or after today.</p>
        {upcoming.length ? (
          <ul className="finance-os__rows">
            {upcoming.map((row) => (
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
          <p className="finance-os__empty">Nothing scheduled. New invoices appear here when they have a due date.</p>
        )}
      </article>
    </div>
  );
}

export function FinanceTax({
  books,
  money,
}: {
  books: PhotographerBooks | null;
  money: (minor: number) => string;
}) {
  return (
    <div className="finance-os__stack">
      <div className="finance-os__title">
        <h1 id="earnings-title" tabIndex={-1}>
          Tax
        </h1>
      </div>
      <article className="finance-os__card">
        <h2>Recorded expense split</h2>
        <p className="finance-os__vs">
          Categories you logged. This is a bookkeeping view, not a filing and not tax advice.
        </p>
        {books?.expenseLines.length ? (
          <dl>
            {books.expenseLines.map((line) => (
              <div className="finance-os__stat" key={line.label}>
                <dt>{line.label}</dt>
                <dd>{money(line.amountMinor)}</dd>
              </div>
            ))}
            <div className="finance-os__stat">
              <dt>Total expenses</dt>
              <dd>{money(books.expensesMinor)}</dd>
            </div>
          </dl>
        ) : (
          <p className="finance-os__empty">No expenses recorded in this period.</p>
        )}
      </article>
    </div>
  );
}
