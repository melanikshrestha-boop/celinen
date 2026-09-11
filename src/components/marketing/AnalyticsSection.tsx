import { Link } from "@tanstack/react-router";
import { SpendSankey } from "@/components/earnings/SpendSankey";
import { PRODUCT_NAME } from "@/lib/product";
import "@/components/earnings/spend-sankey.css";
import "./analytics-section.css";

const DEMO_SLICES = [
  { label: "Galleries", amountMinor: 210000 },
  { label: "Invoices", amountMinor: 128000 },
  { label: "Equipment", amountMinor: 54000 },
  { label: "Software", amountMinor: 36000 },
];
const DEMO_ROWS = [
  { who: "Friday night gallery", label: "Gallery sale", amount: 128000, date: "Sep 8" },
  { who: "Wedding recap", label: "Invoice", amount: 82000, date: "Sep 6" },
  { who: "Adobe", label: "Software", amount: -36000, date: "Sep 1" },
];

function usd(minor: number) {
  const n = Math.abs(minor) / 100;
  const body = n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return `${minor < 0 ? "−" : ""}USD ${body}`;
}

export function AnalyticsSection() {
  return (
    <section className="foto-analytics" id="analytics" aria-labelledby="analytics-heading" data-reveal>
      <p className="marketing-value__eyebrow">Analytics</p>
      <h2 id="analytics-heading">Track the books</h2>
      <div className="foto-analytics__tiles">
        <article>
          <h3>Every payment</h3>
        </article>
        <article>
          <h3>The allocation</h3>
        </article>
        <article>
          <h3>Recurring costs</h3>
        </article>
      </div>
      <div className="foto-analytics__stage" aria-hidden="false">
        <header>
          <span>This month</span>
          <span>USD</span>
          <span>All shoots</span>
        </header>
        <p className="foto-analytics__total">USD 4,280</p>
        <SpendSankey
          sourceLabel="Collected"
          sourceMinor={428000}
          slices={DEMO_SLICES}
          money={usd}
        />
        <ul className="foto-analytics__rows">
          {DEMO_ROWS.map((row) => (
            <li key={row.who}>
              <span>
                <strong>{row.who}</strong>
                <small>
                  {row.date} · {row.label}
                </small>
              </span>
              <em data-kind={row.amount < 0 ? "out" : "in"}>
                {row.amount > 0 ? "+" : ""}
                {usd(row.amount)}
              </em>
            </li>
          ))}
        </ul>
      </div>
      <Link to="/earnings" className="foto-analytics__go">
        Open Analytics
      </Link>
      <p className="foto-analytics__note">
        Sample {PRODUCT_NAME} books. Live totals come from your ledger, not this preview.
      </p>
    </section>
  );
}
