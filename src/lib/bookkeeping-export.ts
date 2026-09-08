/** Bookkeeping only. No deduction, tax-rate, filing, or currency conversion assumptions. */
export interface BookkeepingEntry {
  id: string;
  date: string;
  label: string;
  kind: "income" | "expense";
  category: string;
  amount: number;
  eventId: string | null;
  source: string;
}

export function entriesForYear<T extends BookkeepingEntry>(
  entries: readonly T[],
  year: string,
): T[] {
  if (year !== "all" && !/^\d{4}$/.test(year)) throw new Error("Choose a valid calendar year.");
  return entries.filter((entry) => year === "all" || entry.date.slice(0, 4) === year);
}

export function bookkeepingTotals(entries: readonly BookkeepingEntry[]) {
  let incomeCents = 0;
  let expenseCents = 0;
  for (const entry of entries) {
    if (!Number.isFinite(entry.amount) || !Number.isSafeInteger(Math.round(entry.amount * 100)))
      throw new Error("A ledger amount could not be read safely.");
    const cents = Math.round(entry.amount * 100);
    if (entry.kind === "income") incomeCents += cents;
    else expenseCents += cents;
    if (
      !Number.isSafeInteger(incomeCents) ||
      !Number.isSafeInteger(expenseCents) ||
      !Number.isSafeInteger(incomeCents - expenseCents)
    )
      throw new Error("Ledger totals exceed the supported range.");
  }
  return {
    income: incomeCents / 100,
    expense: expenseCents / 100,
    net: (incomeCents - expenseCents) / 100,
  };
}

/** Quote every cell, preserve punctuation/newlines, and neutralize spreadsheet formulas. */
export function bookkeepingCsv(rows: readonly (readonly (string | number)[])[]) {
  return (
    rows
      .map((row) =>
        row
          .map((value) => {
            const text = String(value);
            const safe =
              typeof value === "string" &&
              /^[=+@-]/.test(text.replace(/^[\s\p{Cc}]*/u, "")) &&
              !/^-?\d+(?:\.\d+)?$/.test(text)
                ? `'${text}`
                : text;
            return `"${safe.replace(/"/g, '""')}"`;
          })
          .join(","),
      )
      .join("\r\n") + "\r\n"
  );
}

export function ledgerExport(
  entries: readonly BookkeepingEntry[],
  year: string,
  eventName: (id: string | null) => string = () => "",
) {
  const selected = entriesForYear(entries, year);
  bookkeepingTotals(selected); // Fail closed on invalid values, never export a misleading zero.
  return bookkeepingCsv([
    [
      "entry_id",
      "date",
      "type",
      "category",
      "description",
      "project_id",
      "project_name",
      "amount",
      "currency",
      "source",
    ],
    ...selected.map((e) => [
      e.id,
      e.date,
      e.kind,
      e.category,
      e.label,
      e.eventId ?? "",
      eventName(e.eventId),
      e.amount.toFixed(2),
      "USD",
      e.source,
    ]),
  ]);
}

export function categoryExport(entries: readonly BookkeepingEntry[], year: string) {
  const selected = entriesForYear(entries, year);
  const totals = bookkeepingTotals(selected);
  const categories = new Map<string, { kind: string; category: string; cents: number }>();
  for (const e of selected) {
    const key = JSON.stringify([e.kind, e.category]);
    const group = categories.get(key) ?? { kind: e.kind, category: e.category, cents: 0 };
    group.cents += Math.round(e.amount * 100);
    categories.set(key, group);
  }
  return bookkeepingCsv([
    ["period", "type", "category", "amount", "currency", "basis"],
    ...[...categories.values()]
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.category.localeCompare(b.category))
      .map((g) => [
        year,
        g.kind,
        g.category,
        (g.cents / 100).toFixed(2),
        "USD",
        "Recorded amount; not a deduction determination",
      ]),
    [year, "total", "Income", totals.income.toFixed(2), "USD", "Recorded income"],
    [year, "total", "Expenses", totals.expense.toFixed(2), "USD", "Recorded expenses"],
    [
      year,
      "total",
      "Net before tax",
      totals.net.toFixed(2),
      "USD",
      "Income minus expenses; not taxable income",
    ],
  ]);
}
