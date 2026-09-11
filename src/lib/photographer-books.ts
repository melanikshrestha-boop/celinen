import { buildEarningsCharts } from "./earnings-charts";
import {
  isEarningsDate,
  summarizeEarnings,
  type EarningsPeriod,
  type EarningsRow,
} from "./earnings-ledger";

export type BooksSpark = {
  date: string;
  collectedMinor: number;
  netMinor: number;
  expensesMinor: number;
  galleryMinor: number;
};

export type BooksStreamItem = {
  id: string;
  who: string;
  label: string;
  amountMinor: number;
  date: string | null;
  kind: "in" | "out";
};

export type PhotographerBooks = {
  currency: string;
  collectedMinor: number;
  netMinor: number;
  expensesMinor: number;
  gallerySalesMinor: number;
  outstandingMinor: number;
  overdueMinor: number;
  previousCollectedMinor: number | null;
  previousNetMinor: number | null;
  previousExpensesMinor: number | null;
  previousGalleryMinor: number | null;
  openInvoices: number;
  paidThisPeriod: number;
  expenseCount: number;
  payoutCount: number;
  spark: BooksSpark[];
  incomeLines: { label: string; amountMinor: number }[];
  expenseLines: { label: string; amountMinor: number }[];
  stream: BooksStreamItem[];
};

function shiftDay(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function previousPeriod(period: EarningsPeriod): EarningsPeriod | null {
  if (!period.from || !period.to) return null;
  const span =
    (Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(span) || span < 0) return null;
  const to = shiftDay(period.from, -1);
  return { from: shiftDay(to, -span), to };
}

function deltaBase(
  rows: readonly EarningsRow[],
  period: EarningsPeriod | null,
  today: string,
  currency: string,
  shootId?: string | null,
) {
  if (!period) return null;
  return (
    summarizeEarnings(rows, { period, today, ...(shootId !== undefined ? { shootId } : {}) }).find(
      (row) => row.currency === currency,
    ) ?? null
  );
}

/**
 * Photographer books over the canonical ledger. No invented MRR, fees, or
 * Stripe-only SaaS metrics. Totals match summarizeEarnings for the same window.
 */
export function buildPhotographerBooks(
  rows: readonly EarningsRow[],
  options: {
    period: EarningsPeriod;
    today: string;
    currency: string;
    shootId?: string | null;
  },
): PhotographerBooks {
  if (!isEarningsDate(options.today)) throw new Error("Invalid books reporting date.");
  const metric = summarizeEarnings(rows, options).find((row) => row.currency === options.currency);
  const previous = deltaBase(
    rows,
    previousPeriod(options.period),
    options.today,
    options.currency,
    options.shootId,
  );
  const scoped = rows.filter(
    (row) =>
      row.currency === options.currency &&
      (options.shootId === undefined ||
        options.shootId === null ||
        row.shootId === options.shootId),
  );
  let openInvoices = 0;
  let paidThisPeriod = 0;
  let expenseCount = 0;
  let payoutCount = 0;
  const inPeriod = (date: string | null) => {
    if (!date) return options.period.from === null && options.period.to === null;
    if (options.period.from && date < options.period.from) return false;
    if (options.period.to && date > options.period.to) return false;
    return true;
  };
  for (const row of scoped) {
    if (row.accounting === "invoice" && row.outstandingMinor > 0 && row.date && row.date <= options.today)
      openInvoices += 1;
    if (row.eligibleForTotals && inPeriod(row.date)) {
      if (row.accounting === "collection") paidThisPeriod += 1;
      if (row.accounting === "expense") expenseCount += 1;
      if (row.type === "payout") payoutCount += 1;
    }
  }
  const charts = buildEarningsCharts(rows, {
    ...options,
    complete: true,
    granularity: "day",
  });
  const stream: BooksStreamItem[] = scoped
    .filter(
      (row) =>
        row.eligibleForTotals &&
        row.date &&
        inPeriod(row.date) &&
        (row.accounting === "collection" ||
          row.accounting === "expense" ||
          row.accounting === "refund"),
    )
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || b.id.localeCompare(a.id))
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      who: row.who?.trim() || row.description,
      label: row.description,
      amountMinor: row.amountMinor,
      date: row.date,
      kind: row.accounting === "expense" || row.accounting === "refund" ? "out" : "in",
    }));
  return {
    currency: options.currency,
    collectedMinor: metric?.collectedMinor ?? 0,
    netMinor: metric?.netMinor ?? 0,
    expensesMinor: metric?.expensesMinor ?? 0,
    gallerySalesMinor: metric?.gallerySalesMinor ?? 0,
    outstandingMinor: metric?.outstandingMinor ?? 0,
    overdueMinor: metric?.overdueMinor ?? 0,
    previousCollectedMinor: previous?.collectedMinor ?? null,
    previousNetMinor: previous?.netMinor ?? null,
    previousExpensesMinor: previous?.expensesMinor ?? null,
    previousGalleryMinor: previous?.gallerySalesMinor ?? null,
    openInvoices,
    paidThisPeriod,
    expenseCount,
    payoutCount,
    spark: charts.points.map((point) => ({
      date: point.date,
      collectedMinor: point.collectedMinor,
      netMinor: point.netMinor,
      expensesMinor: point.expensesMinor,
      galleryMinor: point.collectedMinor,
    })),
    incomeLines: charts.incomeCategories.map((item) => ({
      label: item.category,
      amountMinor: item.amountMinor,
    })),
    expenseLines: charts.expenseCategories.map((item) => ({
      label: item.category,
      amountMinor: item.amountMinor,
    })),
    stream,
  };
}


