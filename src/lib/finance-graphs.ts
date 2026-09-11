import { currencyExponent } from "./finance-money";

export type BooksDay = {
  date: string;
  collectedMinor: number;
  expensesMinor: number;
  netMinor: number;
};
export type BooksMonth = {
  month: string;
  collectedMinor: number;
  expensesMinor: number;
  netMinor: number;
};

const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
const monthAt = (value: number) =>
  `${Math.floor(value / 12)
    .toString()
    .padStart(4, "0")}-${((value % 12) + 1).toString().padStart(2, "0")}`;

/** Last calendar day of YYYY-MM, UTC labels only. */
export function monthEndDate(month: string): string {
  const year = Number(month.slice(0, 4)),
    index = Number(month.slice(5, 7));
  return new Date(Date.UTC(year, index, 0)).toISOString().slice(0, 10);
}

export function daysInMonth(month: string): string[] {
  const last = Number(monthEndDate(month).slice(8, 10));
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** Inclusive window of calendar months ending on `today`'s month. */
export function recentMonthKeys(today: string, count: number): string[] {
  const last = monthIndex(today.slice(0, 7));
  return Array.from({ length: count }, (_, offset) => monthAt(last - count + 1 + offset));
}

/**
 * Compact in-app chart labels. Zero is a dash, never a fake $0.00 trend.
 * USD uses Origin-style $80 / $1.3K on calendar cells; full figures stay on the card total.
 */
export function compactChartAmount(minor: number, currency: string): string {
  if (!Number.isSafeInteger(minor) || minor === 0) return "–";
  const major = minor / 10 ** currencyExponent(currency);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: Math.abs(major) >= 1000 ? 1 : 0,
  }).format(major);
}

export function activityHeat(value: number, peak: number): 0 | 1 | 2 | 3 {
  if (value <= 0 || peak <= 0) return 0;
  const t = value / peak;
  if (t >= 0.66) return 3;
  if (t >= 0.33) return 2;
  return 1;
}
