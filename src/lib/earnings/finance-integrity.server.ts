export type InvoiceMirrorStatus = "draft" | "sent" | "paid" | "void";

/** Applied in the UPDATE predicate, not a stale read-before-write check.
 * A delayed send/finalize must never overwrite a terminal payment or void. */
export function allowedInvoicePreviousStatuses(next: InvoiceMirrorStatus): InvoiceMirrorStatus[] {
  if (next === "draft") return ["draft"];
  if (next === "sent") return ["draft", "sent"];
  return ["draft", "sent", next];
}

export function assertSupportedInvoiceCurrency(currency: string): void {
  if (currency !== "usd")
    throw new Error(
      "This invoice's original currency is preserved. Editing and sending currently support USD drafts only.",
    );
}

/** Bounded complete reads. Never return a partial collection as an all-time
 * ledger. Exact counts, stable unique-ID ordering and duplicate checks catch
 * truncation and common concurrent-read shifts; this is not a DB snapshot. */
export async function readCompleteFinanceRows<T extends { id: string }>(
  readPage: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: unknown;
    count: number | null;
  }>,
  label: string,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? 500,
    maxPages = options.maxPages ?? 50;
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 1000 ||
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > 100
  )
    throw new Error("Invalid finance read bounds.");
  const rows: T[] = [],
    ids = new Set<string>();
  let expected: number | null = null;
  for (let page = 0; page < maxPages; page++) {
    const result = await readPage(page * pageSize, (page + 1) * pageSize - 1);
    if (
      result.error ||
      !result.data ||
      result.count === null ||
      !Number.isSafeInteger(result.count) ||
      result.count < 0
    )
      throw new Error(`${label} could not be read completely. Saved data is unchanged.`);
    if (expected !== null && result.count !== expected)
      throw new Error(`${label} changed during loading. Refresh before using totals or exports.`);
    expected = result.count;
    if (expected > pageSize * maxPages)
      throw new Error(`${label} exceed the verified read limit. No partial totals are shown.`);
    for (const row of result.data) {
      if (!row.id || ids.has(row.id))
        throw new Error(`${label} changed during loading. Refresh before using totals or exports.`);
      ids.add(row.id);
      rows.push(row);
    }
    if (rows.length === expected) return rows;
    if (rows.length > expected || result.data.length !== pageSize)
      throw new Error(`${label} were truncated. No partial totals are shown.`);
  }
  throw new Error(`${label} exceed the verified read limit. No partial totals are shown.`);
}
