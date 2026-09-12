import type { ReactNode } from "react";
import "./finance-os.css";

export const FINANCE_DESKS = [
  "earnings",
  "spending",
  "transactions",
  "invest",
  "equity",
  "forecast",
  "tax",
] as const;
export type FinanceDesk = (typeof FINANCE_DESKS)[number];

const DESKS: { id: FinanceDesk; label: string }[] = [
  { id: "earnings", label: "Earnings" },
  { id: "spending", label: "Spending" },
  { id: "transactions", label: "Transactions" },
  { id: "invest", label: "Invest" },
  { id: "forecast", label: "Forecast" },
  { id: "equity", label: "Equity" },
  { id: "tax", label: "Tax" },
];

export function readFinanceDesk(
  search = typeof window === "undefined" ? "" : window.location.search,
) {
  const value = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("desk");
  return FINANCE_DESKS.find((desk) => desk === value) ?? "earnings";
}

export function FinanceOs({
  desk,
  onDesk,
  trailing,
  children,
}: {
  desk: FinanceDesk;
  onDesk: (desk: FinanceDesk) => void;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const current = DESKS.find((item) => item.id === desk)?.label ?? "Earnings";
  return (
    <div className="finance-os">
      <div className="finance-os__bar">
        <h1 id="earnings-title" className="finance-os__page-title" tabIndex={-1}>
          {current}
        </h1>
        <nav className="finance-os__nav" aria-label="Photographer books">
          {DESKS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={desk === item.id ? "page" : undefined}
              onClick={() => onDesk(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        {trailing ? <div className="finance-os__trailing">{trailing}</div> : null}
      </div>
      <div className="finance-os__main">{children}</div>
    </div>
  );
}
