import type { PhotographerBooks } from "@/lib/photographer-books";
import { isEarningsDate, type EarningsPeriod, type EarningsRow } from "@/lib/earnings-ledger";
import { FinanceTaxHub, RetirementPathways } from "./FinanceTaxHub";

const GEAR = /equipment|lens|camera|studio|computer|lighting|gear/i;

export type FinanceDeskScope = {
  currency: string;
  period: EarningsPeriod;
  shootId?: string;
  complete: boolean;
  invoiceBalancesAvailable?: boolean;
};

export function FinanceInvest({
  books,
  rows,
  money,
  scope,
}: {
  books: PhotographerBooks | null;
  rows: readonly EarningsRow[];
  money: (minor: number) => string;
  scope?: FinanceDeskScope;
}) {
  const currency = scope?.currency ?? books?.currency;
  const available = books !== null && scope?.complete !== false;
  const gear = rows.filter(
    (row) =>
      currency &&
      row.currency === currency &&
      (!scope?.shootId || row.shootId === scope.shootId) &&
      (!scope?.period.from || (row.date !== null && row.date >= scope.period.from)) &&
      (!scope?.period.to || (row.date !== null && row.date <= scope.period.to)) &&
      row.accounting === "expense" &&
      row.eligibleForTotals &&
      GEAR.test(row.category || row.description),
  );
  const gearMinor = gear.reduce((sum, row) => sum + row.amountMinor, 0);
  return (
    <div className="finance-os__stack">
      <RetirementPathways />
      <article className="finance-os__card">
        <h2>Recorded equipment spending</h2>
        <p className="finance-os__figure">{available ? money(gearMinor) : "—"}</p>
        <p className="finance-os__vs">
          Gear, studio and equipment-tagged expenses in the selected period and currency. This is
          not a brokerage balance, investment return or current equipment value.
        </p>
        <dl>
          <div className="finance-os__stat">
            <dt>All expenses this period</dt>
            <dd>{available ? money(books.expensesMinor) : "—"}</dd>
          </div>
          <div className="finance-os__stat">
            <dt>Equipment-tagged entries</dt>
            <dd>{available ? gear.length : "—"}</dd>
          </div>
        </dl>
      </article>
      <article className="finance-os__card">
        <h2>Gear log</h2>
        {!available ? (
          <p className="finance-os__empty">
            Equipment records are unavailable until the books can be verified.
          </p>
        ) : gear.length ? (
          <ul className="finance-os__rows">
            {gear.slice(0, 12).map((row) => (
              <li key={row.id}>
                <span>
                  <strong>{row.description}</strong>
                  <span> {row.date}</span>
                </span>
                <em data-kind={row.amountMinor < 0 ? "in" : "out"}>{money(-row.amountMinor)}</em>
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
  balancesAvailable = true,
}: {
  books: PhotographerBooks | null;
  money: (minor: number) => string;
  balancesAvailable?: boolean;
}) {
  return (
    <div className="finance-os__stack">
      <article className="finance-os__card">
        <h2>Equity snapshot</h2>
        <p className="finance-os__figure">Unavailable</p>
        <p className="finance-os__vs">
          Equity is assets minus liabilities at a point in time. Asset and liability balances have
          not been entered here; recorded income cannot stand in for them.
        </p>
        <ul className="finance-os__resource-list">
          <li>Assets: cash balances, receivables and equipment carrying values.</li>
          <li>Liabilities: loans, credit balances and other amounts owed.</li>
          <li>Use the same date and currency, and reconcile owner contributions and draws.</li>
        </ul>
      </article>
      <article className="finance-os__card">
        <h2>Recorded cash flow</h2>
        <p className="finance-os__figure">{books ? money(books.netMinor) : "—"}</p>
        <p className="finance-os__vs">
          Collections after refunds minus recorded expenses for the selected period. This is cash
          flow, not equity, a bank balance or a valuation. Receivables below are separate unpaid
          balances.
        </p>
        <dl>
          <div className="finance-os__stat">
            <dt>Collected</dt>
            <dd>{books ? money(books.collectedMinor) : "—"}</dd>
          </div>
          <div className="finance-os__stat">
            <dt>Receivables</dt>
            <dd>{books && balancesAvailable ? money(books.outstandingMinor) : "—"}</dd>
          </div>
          <div className="finance-os__stat">
            <dt>Overdue</dt>
            <dd>{books && balancesAvailable ? money(books.overdueMinor) : "—"}</dd>
          </div>
          <div className="finance-os__stat">
            <dt>Expenses</dt>
            <dd>{books ? money(books.expensesMinor) : "—"}</dd>
          </div>
        </dl>
        {!balancesAvailable && (
          <p className="finance-os__vs">
            Invoice balances are unavailable until verified invoice history is connected. Cash
            records do not establish what clients currently owe.
          </p>
        )}
      </article>
    </div>
  );
}

export function FinanceForecast({
  rows,
  today,
  money,
  onOpen,
  scope,
}: {
  rows: readonly EarningsRow[];
  today: string;
  money: (minor: number) => string;
  onOpen: (id: string) => void;
  scope?: FinanceDeskScope;
}) {
  const validToday = isEarningsDate(today);
  const available =
    scope?.complete !== false && scope?.invoiceBalancesAvailable !== false && validToday;
  const open = rows.filter(
    (row) =>
      validToday &&
      (!scope || row.currency === scope.currency) &&
      (!scope?.shootId || row.shootId === scope.shootId) &&
      row.accounting === "invoice" &&
      // The workspace projects canonical open invoices into due-date display statuses.
      (row.status === "open" || row.status === "upcoming" || row.status === "overdue") &&
      row.eligibleForTotals &&
      row.outstandingMinor > 0 &&
      row.date &&
      row.date <= today,
  );
  const upcoming = open
    .filter((row) => row.dueDate && row.dueDate >= today)
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  const overdue = open.filter((row) => row.dueDate && row.dueDate < today);
  const undated = open.filter((row) => !row.dueDate);
  const due = upcoming.reduce((sum, row) => sum + row.outstandingMinor, 0);
  return (
    <div className="finance-os__stack">
      <article className="finance-os__card">
        <h2>Scheduled invoice balances</h2>
        <p className="finance-os__figure">{available ? money(due) : "—"}</p>
        <p className="finance-os__vs">
          {validToday ? (
            <>
              As of <time dateTime={today}>{today}</time>.{" "}
            </>
          ) : (
            "Reporting date unavailable. "
          )}
          Open invoices due today or later, across issue dates. Due dates are requests for
          payment—not guaranteed cash, income or an investment forecast.
        </p>
        {!available && (
          <p className="finance-os__empty">
            Forecast totals are unavailable until the invoice history and reporting date can be
            verified. Any listed records are provisional.
          </p>
        )}
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
        ) : available ? (
          <p className="finance-os__empty">
            Nothing scheduled. New invoices appear here when they have a due date.
          </p>
        ) : null}
      </article>
      <article className="finance-os__card">
        <h2>Outside the scheduled total</h2>
        <dl>
          <div className="finance-os__stat">
            <dt>Overdue open invoices</dt>
            <dd>{available ? overdue.length : "—"}</dd>
          </div>
          <div className="finance-os__stat">
            <dt>Open invoices without a due date</dt>
            <dd>{available ? undated.length : "—"}</dd>
          </div>
        </dl>
        <p className="finance-os__vs">
          Drafts, test records, already-paid or void invoices, and records without a confirmed issue
          date are excluded. This view does not estimate unbooked shoots, expenses, taxes, bank
          balances or collection probability.
        </p>
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
      <FinanceTaxHub />
      <article className="finance-os__card">
        <h2>Recorded expense split</h2>
        <p className="finance-os__vs">
          Categories in the selected ledger period and currency—not necessarily the full 2026 tax
          year or deductible amounts. This is a bookkeeping view, not a filing and not tax advice.
        </p>
        {!books ? (
          <p className="finance-os__empty">
            Expense records are unavailable until the books can be verified.
          </p>
        ) : (
          <>
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
            {!books.expenseLines.length && (
              <p className="finance-os__empty">
                {books.expenseCount === 0
                  ? "No expenses recorded in this period."
                  : "No positive expense-category breakdown. The total retains recorded corrections."}
              </p>
            )}
          </>
        )}
      </article>
    </div>
  );
}
