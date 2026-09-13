// Deliberately storage-free. This mounts real financial presentation components
// with synthetic in-memory rows; it never imports auth, repository or save APIs.
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";
import "../src/components/workbench/workbench.css";
import "../src/components/workbench/workbench-color.css";
import "../src/components/earnings/earnings-workspace.css";
import { FinanceOs, type FinanceDesk } from "../src/components/earnings/FinanceOs";
import { FinanceOverview } from "../src/components/earnings/FinanceOverview";
import {
  FinanceEquity,
  FinanceForecast,
  FinanceInvest,
  FinanceTax,
} from "../src/components/earnings/FinanceDesks";
import { buildPhotographerBooks } from "../src/lib/photographer-books";
import { formatFinanceMoney } from "../src/lib/finance-money";
import type { EarningsRow } from "../src/lib/earnings-ledger";

const today = "2026-09-10";
const categories = [
  "Portraits",
  "Weddings",
  "Editorial",
  "Sports",
  "Licensing",
  "Team Days",
  "Products",
  "Events",
  "Prints",
  "Commercial",
  "Retouching",
  "Workshops",
];
function row(id: string, patch: Partial<EarningsRow>): EarningsRow {
  return {
    id,
    sourceId: id,
    date: "2026-09-08",
    shootId: "eeaf0000-1111-4222-8333-000000000091",
    who: "QA Client",
    clientId: null,
    description: id,
    category: "Portraits",
    type: "payment",
    status: "recorded",
    amountMinor: 10000,
    currency: "USD",
    source: "manual",
    accounting: "collection",
    outstandingMinor: 0,
    dueDate: null,
    eligibleForTotals: true,
    linked: true,
    warnings: [],
    ...patch,
  };
}
const fixtureRows = [
  ...categories.map((category, index) =>
    row(`qa-collection-${index}`, {
      date: `2026-09-${String(1 + (index % 10)).padStart(2, "0")}`,
      category,
      who: `QA ${category} Client`,
      description: `${category} coverage`,
      amountMinor: 17500 + index * 2100,
    }),
  ),
  ...["Equipment", "Travel", "Software", "Studio rental"].map((category, index) =>
    row(`qa-expense-${index}`, {
      date: `2026-09-0${index + 2}`,
      category,
      description: `QA ${category}`,
      accounting: "expense",
      type: "expense",
      amountMinor: [85000, 18200, 4900, 27500][index]!,
    }),
  ),
  row("qa-prior", { date: "2026-08-20", category: "Portraits", amountMinor: 180000 }),
  row("qa-refund", {
    date: "2026-09-09",
    accounting: "refund",
    type: "refund",
    category: "Portraits",
    amountMinor: -4500,
  }),
  row("qa-upcoming", {
    date: "2026-09-06",
    accounting: "invoice",
    type: "balance",
    status: "open",
    eligibleForTotals: true,
    amountMinor: 45000,
    outstandingMinor: 45000,
    dueDate: "2026-09-18",
    description: "QA Team day balance",
  }),
  row("qa-yen", { category: "Editorial", amountMinor: 17500, currency: "JPY" }),
  row("qa-dinar", { category: "Licensing", amountMinor: 175005, currency: "KWD" }),
];

export function VisualFixture() {
  const [dark, setDark] = useState(false);
  const [desk, setDesk] = useState<FinanceDesk>("earnings");
  const [scenario, setScenario] = useState("recorded");
  const [currency, setCurrency] = useState("USD");
  const [periodKey, setPeriodKey] = useState("month");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  const period = useMemo(
    () =>
      periodKey === "all"
        ? { from: null, to: null }
        : { from: periodKey === "year" ? "2026-01-01" : "2026-09-01", to: today },
    [periodKey],
  );
  const rows = useMemo(() => (scenario === "empty" ? [] : fixtureRows), [scenario]);
  const complete = scenario !== "pending";
  const balancesAvailable = complete && scenario !== "unverified-invoices";
  const scope = { currency, period, complete, invoiceBalancesAvailable: balancesAvailable };
  const books = useMemo(
    () => (complete ? buildPhotographerBooks(rows, { currency, period, today }) : null),
    [rows, currency, period, complete],
  );
  const money = (minor: number) => formatFinanceMoney(minor, currency);
  const onOpen = (id: string) => setNotice(`QA selected row: ${id}. No real receipt was opened.`);
  return (
    <>
      <div
        data-qa="fixture-controls"
        style={{
          padding: "8px 12px",
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
          background: dark ? "#151515" : "#eef2f5",
          color: dark ? "#fff" : "#1a1c22",
          font: "12px system-ui",
        }}
      >
        <strong>ISOLATED FINANCE QA · Synthetic data only</strong>
        <button type="button" aria-pressed={dark} onClick={() => setDark(!dark)}>
          {dark ? "Use light theme" : "Use dark theme"}
        </button>
        <label>
          Data{" "}
          <select
            aria-label="QA data scenario"
            value={scenario}
            onChange={(event) => setScenario(event.target.value)}
          >
            <option value="recorded">Recorded · 12 categories</option>
            <option value="empty">Complete and empty</option>
            <option value="pending">Unavailable</option>
            <option value="unverified-invoices">Cash ready · Invoices unavailable</option>
          </select>
        </label>
        <label>
          Currency{" "}
          <select
            aria-label="QA currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
          >
            <option>USD</option>
            <option>JPY</option>
            <option>KWD</option>
          </select>
        </label>
        <label>
          Period{" "}
          <select
            aria-label="QA period"
            value={periodKey}
            onChange={(event) => setPeriodKey(event.target.value)}
          >
            <option value="month">This month</option>
            <option value="year">This year</option>
            <option value="all">All dates</option>
          </select>
        </label>
        {notice && <span role="status">{notice}</span>}
      </div>
      <div className="workbench-tool-content">
        <section
          className="earnings-workspace finance-os-host"
          aria-label="Isolated finance component preview"
        >
          <FinanceOs desk={desk} onDesk={setDesk}>
            {desk === "earnings" || desk === "spending" ? (
              <FinanceOverview
                books={books}
                rows={rows}
                today={today}
                money={money}
                onOpen={onOpen}
                range={periodKey === "all" ? "ALL" : periodKey === "year" ? "YTD" : "1M"}
                spending={desk === "spending"}
                balancesAvailable={balancesAvailable}
                onRange={(range) =>
                  setPeriodKey(range === "ALL" ? "all" : range === "YTD" ? "year" : "month")
                }
              />
            ) : desk === "invest" ? (
              <FinanceInvest books={books} rows={rows} money={money} scope={scope} />
            ) : desk === "equity" ? (
              <FinanceEquity books={books} money={money} balancesAvailable={balancesAvailable} />
            ) : desk === "forecast" ? (
              <FinanceForecast
                rows={rows}
                today={today}
                money={money}
                onOpen={onOpen}
                scope={scope}
              />
            ) : desk === "tax" ? (
              <FinanceTax books={books} money={money} />
            ) : (
              <div className="finance-os__stack">
                <h1>Transactions</h1>
                <p role="status">
                  QA navigation works. The authenticated ledger remains outside this static fixture.
                </p>
              </div>
            )}
          </FinanceOs>
        </section>
      </div>
    </>
  );
}

const mount = document.getElementById("finance-visual-root");
if (!mount) throw new Error("The isolated finance fixture requires its own mount point");
const root = createRoot(mount);
root.render(<VisualFixture />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
