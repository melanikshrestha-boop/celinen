import {
  filterEarningsRows,
  isEarningsDate,
  summarizeEarnings,
  type EarningsPeriod,
  type EarningsRow,
} from "./earnings-ledger";
import { currencyExponent } from "./finance-money";

export type EarningsChartMonth = {
  /** Calendar month of the ledger's already timezone-resolved YYYY-MM-DD date. */
  month: string;
  collectedMinor: number;
  refundsMinor: number;
  expensesMinor: number;
  netMinor: number;
};
export type EarningsChartCategory = { category: string; amountMinor: number };
export type EarningsChartPoint = Omit<EarningsChartMonth, "month"> & { date: string };
export type EarningsChartTotals = Omit<EarningsChartMonth, "month"> & {
  positiveCollectionsMinor: number;
  /** Signed, nonpositive historical corrections; never negative pie slices. */
  collectionAdjustmentsMinor: number;
  positiveExpensesMinor: number;
  expenseAdjustmentsMinor: number;
};
export type EarningsCharts = {
  currency: string;
  /** Caller-supplied ledger completeness; partial data must not be presented as verified totals. */
  complete: boolean;
  months: EarningsChartMonth[];
  granularity: "day" | "month";
  points: EarningsChartPoint[];
  incomeCategories: EarningsChartCategory[];
  expenseCategories: EarningsChartCategory[];
  totals: EarningsChartTotals;
  hasActivity: boolean;
  /** Only empty months can be omitted in unusually long (>100-year) histories. No money is dropped. */
  omittedEmptyMonths: number;
  omittedEmptyPoints: number;
};

const checked = (value: number) => {
  if (!Number.isSafeInteger(value))
    throw new Error("A chart amount exceeds safe integer precision.");
  return value;
};
const index = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
const monthAt = (value: number) =>
  `${Math.floor(value / 12)
    .toString()
    .padStart(4, "0")}-${((value % 12) + 1).toString().padStart(2, "0")}`;
const emptyMonth = (month: string): EarningsChartMonth => ({
  month,
  collectedMinor: 0,
  refundsMinor: 0,
  expensesMinor: 0,
  netMinor: 0,
});

/**
 * Read-only charts over canonical ledger rows, not new financial calculations.
 * Matching period/currency/shoot options reconcile to summarizeEarnings exactly.
 * Table search and type tabs are deliberately not chart filters.
 *
 * A bounded period fills its own calendar months; a missing endpoint uses the
 * earliest/latest contributing dated row, never the clock or an invented trend.
 * Zero contributing amounts return empty charts even for a bounded period.
 */
export function buildEarningsCharts(
  rows: readonly EarningsRow[],
  options: {
    period: EarningsPeriod;
    today: string;
    currency: string;
    shootId?: string | null;
    complete?: boolean;
    granularity?: "day" | "month";
  },
): EarningsCharts {
  currencyExponent(options.currency);
  const granularity = options.granularity ?? "month";
  if (granularity !== "day" && granularity !== "month")
    throw new Error("Invalid chart granularity.");
  if (!isEarningsDate(options.today)) throw new Error("Invalid chart reporting date.");
  for (const date of [options.period.from, options.period.to])
    if (date !== null && !isEarningsDate(date)) throw new Error("Invalid chart period date.");
  const identities = new Set<string>();
  for (const row of rows) {
    checked(row.amountMinor);
    if (row.date !== null && !isEarningsDate(row.date))
      throw new Error("Invalid chart ledger date.");
    if (identities.has(row.id)) throw new Error("Duplicate chart ledger identity.");
    identities.add(row.id);
  }
  const selected = filterEarningsRows(rows, {
    period: options.period,
    currency: options.currency,
    ...(options.shootId !== undefined ? { shootId: options.shootId } : {}),
  });
  const metric = summarizeEarnings(selected, options).find(
    (value) => value.currency === options.currency,
  );
  const totals: EarningsChartTotals = {
    collectedMinor: metric?.collectedMinor ?? 0,
    refundsMinor: metric?.refundsMinor ?? 0,
    expensesMinor: metric?.expensesMinor ?? 0,
    netMinor: metric?.netMinor ?? 0,
    positiveCollectionsMinor: 0,
    collectionAdjustmentsMinor: 0,
    positiveExpensesMinor: 0,
    expenseAdjustmentsMinor: 0,
  };
  const income = new Map<string, number>(),
    expenses = new Map<string, number>(),
    grouped = new Map<string, EarningsRow[]>(),
    daily = new Map<string, EarningsRow[]>();
  for (const row of selected) {
    if (
      !row.eligibleForTotals ||
      !row.date ||
      row.amountMinor === 0 ||
      !["collection", "refund", "expense"].includes(row.accounting)
    )
      continue;
    const month = row.date.slice(0, 7);
    const bucket = grouped.get(month) ?? [];
    bucket.push(row);
    grouped.set(month, bucket);
    if (granularity === "day") {
      const day = daily.get(row.date) ?? [];
      day.push(row);
      daily.set(row.date, day);
    }
    if (row.accounting === "refund") continue;
    const collection = row.accounting === "collection";
    if (row.amountMinor < 0) {
      const key = collection ? "collectionAdjustmentsMinor" : "expenseAdjustmentsMinor";
      totals[key] = checked(totals[key] + row.amountMinor);
      continue;
    }
    const key = collection ? "positiveCollectionsMinor" : "positiveExpensesMinor";
    totals[key] = checked(totals[key] + row.amountMinor);
    const categories = collection ? income : expenses;
    const category =
      row.category.trim() ||
      (collection
        ? row.type === "gallery"
          ? "Gallery sales"
          : "Uncategorized income"
        : "Uncategorized expenses");
    categories.set(category, checked((categories.get(category) ?? 0) + row.amountMinor));
  }
  const actualMonths = [...grouped.keys()].sort();
  let months: EarningsChartMonth[] = [];
  let omittedEmptyMonths = 0;
  if (actualMonths.length) {
    const first = index(options.period.from?.slice(0, 7) ?? actualMonths[0]!);
    const last = index(options.period.to?.slice(0, 7) ?? actualMonths.at(-1)!);
    const count = last - first + 1;
    const keys =
      count <= 1_200
        ? Array.from({ length: count }, (_, offset) => monthAt(first + offset))
        : actualMonths;
    omittedEmptyMonths = count - keys.length;
    months = keys.map((month) => {
      const values = grouped.get(month);
      if (!values) return emptyMonth(month);
      const summary = summarizeEarnings(values, options).find(
        (value) => value.currency === options.currency,
      )!;
      return {
        month,
        collectedMinor: summary.collectedMinor,
        refundsMinor: summary.refundsMinor,
        expensesMinor: summary.expensesMinor,
        netMinor: summary.netMinor,
      };
    });
  }
  let points: EarningsChartPoint[] = months.map(({ month, ...values }) => ({
    date: month,
    ...values,
  }));
  let omittedEmptyPoints = omittedEmptyMonths;
  if (granularity === "day") {
    const dates = [...daily.keys()].sort();
    points = [];
    omittedEmptyPoints = 0;
    if (dates.length) {
      // UTC arithmetic advances calendar labels; ledger dates were already resolved in its
      // reporting timezone. Never parse them as local instants or shift a payment across midnight.
      const dayIndex = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
      const first = dayIndex(options.period.from ?? dates[0]!);
      const last = dayIndex(options.period.to ?? dates.at(-1)!);
      const count = last - first + 1;
      const keys =
        count <= 3_660
          ? Array.from({ length: count }, (_, offset) =>
              new Date((first + offset) * 86_400_000).toISOString().slice(0, 10),
            )
          : dates;
      omittedEmptyPoints = count - keys.length;
      points = keys.map((date) => {
        const values = daily.get(date);
        const summary = values
          ? summarizeEarnings(values, options).find((value) => value.currency === options.currency)
          : undefined;
        return {
          date,
          collectedMinor: summary?.collectedMinor ?? 0,
          refundsMinor: summary?.refundsMinor ?? 0,
          expensesMinor: summary?.expensesMinor ?? 0,
          netMinor: summary?.netMinor ?? 0,
        };
      });
    }
  }
  const categories = (values: Map<string, number>): EarningsChartCategory[] =>
    [...values]
      .map(([category, amountMinor]) => ({ category, amountMinor }))
      .sort((a, b) => b.amountMinor - a.amountMinor || a.category.localeCompare(b.category));
  return {
    currency: options.currency,
    complete: options.complete !== false,
    months,
    granularity,
    points,
    incomeCategories: categories(income),
    expenseCategories: categories(expenses),
    totals,
    hasActivity: actualMonths.length > 0,
    omittedEmptyMonths,
    omittedEmptyPoints,
  };
}
