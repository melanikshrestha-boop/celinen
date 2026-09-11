import type { ReactNode } from "react";
import "./finance-os.css";

export const FINANCE_DESKS = [
  "earnings",
  "transactions",
  "invest",
  "equity",
  "forecast",
  "tax",
] as const;
export type FinanceDesk = (typeof FINANCE_DESKS)[number];

const TRACK: { id: FinanceDesk; label: string }[] = [
  { id: "earnings", label: "Earnings" },
  { id: "transactions", label: "Transactions" },
  { id: "invest", label: "Invest" },
  { id: "forecast", label: "Forecast" },
  { id: "equity", label: "Equity" },
];
const SERVICES: { id: FinanceDesk; label: string }[] = [{ id: "tax", label: "Tax" }];

export function readFinanceDesk(search = typeof window === "undefined" ? "" : window.location.search) {
  const value = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("desk");
  return FINANCE_DESKS.find((desk) => desk === value) ?? "earnings";
}

export function FinanceOs({
  desk,
  onDesk,
  onInvoice,
  children,
}: {
  desk: FinanceDesk;
  onDesk: (desk: FinanceDesk) => void;
  onInvoice: () => void;
  children: ReactNode;
}) {
  return (
    <div className="finance-os">
      <nav className="finance-os__nav" aria-label="Photographer books">
        <p className="finance-os__mark">celinen</p>
        <p className="finance-os__kicker">Track</p>
        {TRACK.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={desk === item.id ? "page" : undefined}
            onClick={() => onDesk(item.id)}
          >
            {item.label}
          </button>
        ))}
        <p className="finance-os__kicker">Services</p>
        {SERVICES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={desk === item.id ? "page" : undefined}
            onClick={() => onDesk(item.id)}
          >
            {item.label}
          </button>
        ))}
        <button type="button" className="finance-os__cta" onClick={onInvoice}>
          New invoice
        </button>
      </nav>
      <div className="finance-os__main">{children}</div>
    </div>
  );
}
