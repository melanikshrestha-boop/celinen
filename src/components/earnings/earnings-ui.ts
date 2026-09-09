import { bookkeepingCsv } from "@/lib/bookkeeping-export";
import { formatFinanceMoney } from "@/lib/finance-money";

export type EarningsPeriod = "month" | "year" | "all";
export function earningsPeriodRange(period: EarningsPeriod, today: string) {
  return {
    from:
      period === "all"
        ? null
        : period === "year"
          ? `${today.slice(0, 4)}-01-01`
          : `${today.slice(0, 7)}-01`,
    to: period === "all" ? null : today,
  };
}

export function formatEarningsMoney(minor: number, currency = "USD") {
  return formatFinanceMoney(minor, currency);
}

/** Only verified HTTPS Stripe receipts/invoices may become external actions. */
export function safePaymentUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return [
      "invoice.stripe.com",
      "pay.stripe.com",
      "dashboard.stripe.com",
      "payments.stripe.com",
      "receipt.stripe.com",
    ].includes(url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function downloadEarningsFile(
  content: string,
  filename: string,
  type = "text/csv;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function invoiceDraftCsv(draft: {
  id: string;
  clientName: string;
  clientEmail: string | null;
  description: string;
  amountCents: number;
  dueDate: string | null;
  shootId?: string | null;
  currency?: string;
}) {
  return bookkeepingCsv([
    [
      "Draft ID",
      "Status",
      "Shoot ID",
      "Client",
      "Email",
      "Description",
      "Amount in minor units",
      "Currency",
      "Due date",
    ],
    [
      draft.id,
      "Draft — not sent",
      draft.shootId ?? "",
      draft.clientName,
      draft.clientEmail ?? "",
      draft.description,
      draft.amountCents,
      draft.currency ?? "USD",
      draft.dueDate ?? "",
    ],
  ]);
}
