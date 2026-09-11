import { parseFinanceAmount } from "./finance-money";
import { workspaceStorageKey } from "./workspace-storage";

/** Dollar chips a working photographer can tap. Stored as integer minor units. */
export const REVENUE_GOAL_CHIPS_USD = [20_000, 40_000, 60_000, 80_000, 100_000] as const;

const storageBase = "celinen.revenue-goal.v1";

function key(scope: string) {
  return workspaceStorageKey(storageBase, scope);
}

export function dollarsToMinor(dollars: number) {
  return Math.round(dollars * 100);
}

export function parseGoalInput(text: string, currency = "USD"): number | null {
  const trimmed = text.trim().toLowerCase().replace(/,/g, "").replace(/^\$/, "");
  const kilo = /^(\d+(?:\.\d+)?)k$/.exec(trimmed);
  if (kilo) return parseFinanceAmount(String(Number(kilo[1]) * 1000), currency);
  return parseFinanceAmount(trimmed, currency);
}

export function readRevenueGoal(
  scope: string,
  year: number,
  storage: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined"
    ? null
    : localStorage,
): number | null {
  if (!storage || !Number.isInteger(year) || year < 2000 || year > 2100) return null;
  try {
    const parsed = JSON.parse(storage.getItem(key(scope)) ?? "null") as Record<string, unknown>;
    const value = parsed?.[String(year)];
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeRevenueGoal(
  scope: string,
  year: number,
  minor: number,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return;
  if (!Number.isInteger(minor) || minor <= 0) return;
  let current: Record<string, number> = {};
  try {
    const parsed = JSON.parse(storage.getItem(key(scope)) ?? "{}") as Record<string, unknown>;
    if (parsed && typeof parsed === "object")
      for (const [stamp, value] of Object.entries(parsed))
        if (typeof value === "number" && Number.isInteger(value) && value > 0)
          current[stamp] = value;
  } catch {
    current = {};
  }
  current[String(year)] = minor;
  storage.setItem(key(scope), JSON.stringify(current));
}

/** Round annualized YTD pace up to a chip, or 40k when nothing is in yet. */
export function suggestGoalMinor(collectedMinor: number, today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return dollarsToMinor(40_000);
  const year = Number(today.slice(0, 4));
  const start = Date.parse(`${year}-01-01T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  const day = Math.floor((now - start) / 86_400_000) + 1;
  const days = Number.isInteger(year) && year % 4 === 0 ? 366 : 365;
  if (!Number.isFinite(day) || day < 1) return dollarsToMinor(40_000);
  const annualized = day < 14 ? dollarsToMinor(40_000) : Math.round((collectedMinor / day) * days);
  const rounded = Math.ceil(Math.max(annualized, dollarsToMinor(20_000)) / dollarsToMinor(10_000)) *
    dollarsToMinor(10_000);
  return Math.min(rounded, dollarsToMinor(500_000));
}

export function remainingPerMonth(goalMinor: number, collectedMinor: number, today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return 0;
  const month = Number(today.slice(5, 7));
  const monthsLeft = Math.max(1, 13 - month);
  return Math.max(0, Math.ceil((goalMinor - collectedMinor) / monthsLeft));
}
