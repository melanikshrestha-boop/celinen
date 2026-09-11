import type { ReactNode } from "react";
import {
  ArrowLeftRight,
  BarChart3,
  Coins,
  Landmark,
  ReceiptText,
  TrendingUp,
  Wallet,
} from "lucide-react";
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

const TRACK: { id: FinanceDesk; label: string }[] = [
  { id: "earnings", label: "Earnings" },
  { id: "spending", label: "Spending" },
  { id: "transactions", label: "Transactions" },
  { id: "invest", label: "Invest" },
  { id: "forecast", label: "Forecast" },
  { id: "equity", label: "Equity" },
];
const SERVICES: { id: FinanceDesk; label: string }[] = [{ id: "tax", label: "Tax" }];
const ICONS = {
  earnings: BarChart3,
  spending: Wallet,
  transactions: ArrowLeftRight,
  invest: TrendingUp,
  forecast: Coins,
  equity: Landmark,
  tax: ReceiptText,
};

export function readFinanceDesk(
  search = typeof window === "undefined" ? "" : window.location.search,
) {
  const value = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("desk");
  return FINANCE_DESKS.find((desk) => desk === value) ?? "earnings";
}

export function FinanceOs({
  desk,
  onDesk,
  onInvoice,
  invoiceDisabled = false,
  children,
}: {
  desk: FinanceDesk;
  onDesk: (desk: FinanceDesk) => void;
  onInvoice: () => void;
  invoiceDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="finance-os">
      <nav className="finance-os__nav" aria-label="Photographer books">
        <p className="finance-os__mark">celinen</p>
        <p className="finance-os__kicker">Track</p>
        {TRACK.map((item) => {
          const Icon = ICONS[item.id];
          return (
            <button
              key={item.id}
              type="button"
              aria-current={desk === item.id ? "page" : undefined}
              onClick={() => onDesk(item.id)}
            >
              <Icon size={17} aria-hidden="true" />
              {item.label}
            </button>
          );
        })}
        <p className="finance-os__kicker">Services</p>
        {SERVICES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={desk === item.id ? "page" : undefined}
            onClick={() => onDesk(item.id)}
          >
            <ReceiptText size={17} aria-hidden="true" />
            {item.label}
          </button>
        ))}
        <button
          type="button"
          className="finance-os__cta"
          onClick={onInvoice}
          disabled={invoiceDisabled}
        >
          New invoice
        </button>
      </nav>
      <div className="finance-os__main">{children}</div>
    </div>
  );
}
