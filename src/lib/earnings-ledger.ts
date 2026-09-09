import type { LocalFinanceState } from "./local-finance-store";
import type { ConnectedInvoiceReceipt, ConnectedPaymentReceipt } from "./earnings/stripe-receipts";
import { bookkeepingCsv } from "./bookkeeping-export";
import { currencyExponent, decimalToMinorUnits, minorUnitsDecimal } from "./finance-money";

export type EarningsType = "invoice" | "payment" | "gallery" | "expense" | "payout";
export type EarningsFilter = "all" | "invoices" | "gallery" | "expenses" | "payouts";
export type EarningsPeriod = { from: string | null; to: string | null };
export type EarningsRow = {
  id: string;
  sourceId: string;
  date: string | null;
  shootId: string | null;
  who: string | null;
  clientId: string | null;
  description: string;
  category: string;
  paymentMethod?: string | null;
  type: EarningsType;
  status: string;
  amountMinor: number;
  currency: string | null;
  source: "manual" | "local-draft" | "invoice" | "stripe" | "legacy";
  accounting: "collection" | "refund" | "expense" | "invoice" | "transfer" | "unreconciled";
  outstandingMinor: number;
  dueDate: string | null;
  eligibleForTotals: boolean;
  linked: boolean;
  warnings: string[];
};
export interface LegacyFinanceTransaction {
  id: string;
  occurred_on: string;
  description: string;
  kind: "income" | "expense";
  category: string;
  amount: string | number;
  shoot_id: string | null;
  source: string;
  currency?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  stripe_object_id?: string | null;
}
export interface EarningsInvoice {
  id: string;
  createdAt: string;
  dueDate: string | null;
  amountMinor: number;
  outstandingMinor: number;
  currency: string;
  status: "draft" | "open" | "paid" | "void" | "uncollectible";
  shootId: string | null;
  clientId: string | null;
  clientName: string | null;
}
export interface CurrencyMetrics {
  currency: string;
  collectedMinor: number;
  refundsMinor: number;
  outstandingMinor: number;
  overdueMinor: number;
  gallerySalesMinor: number;
  expensesMinor: number;
  netMinor: number;
  unlinkedMinor: number;
}

export function isEarningsDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function dateOnly(value: string): string {
  if (!isEarningsDate(value)) throw new Error("A ledger date could not be read safely.");
  return value;
}
function integer(value: number): number {
  if (!Number.isSafeInteger(value))
    throw new Error("A ledger amount exceeds safe integer precision.");
  return value;
}
function nonnegative(value: number): number {
  if (integer(value) < 0) throw new Error("A provider amount cannot be negative.");
  return value;
}
function currencyCode(value: string): string {
  const currency = value.toUpperCase();
  currencyExponent(currency);
  return currency;
}
export function earningsDateInZone(timestamp: string, timeZone: string): string {
  if (
    !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(timestamp) ||
    !Number.isFinite(Date.parse(timestamp))
  )
    throw new Error("A payment timestamp could not be read safely.");
  dateOnly(timestamp.slice(0, 10));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const get = (key: string) => parts.find((part) => part.type === key)?.value;
  return dateOnly(`${get("year")}-${get("month")}-${get("day")}`);
}
function validatePeriod(period: EarningsPeriod) {
  if (period.from) dateOnly(period.from);
  if (period.to) dateOnly(period.to);
  if (period.from && period.to && period.from > period.to)
    throw new Error("The period ends before it starts.");
}
function inPeriod(date: string | null, period: EarningsPeriod) {
  return (
    date !== null && (!period.from || date >= period.from) && (!period.to || date <= period.to)
  );
}

/** Read-only projection. Source arrays/records are never rewritten or assigned invented shoot links. */
export function buildEarningsLedger(input: {
  local?: LocalFinanceState;
  payments?: readonly ConnectedPaymentReceipt[];
  invoices?: readonly (EarningsInvoice | ConnectedInvoiceReceipt)[];
  legacyTransactions?: readonly LegacyFinanceTransaction[];
  period: EarningsPeriod;
  today: string;
  /** Explicit reporting timezone. UTC is the deterministic fallback, not the user's inferred location. */
  timeZone?: string;
  shootId?: string | null;
  providerComplete?: boolean;
}) {
  const timeZone = input.timeZone ?? "UTC";
  new Intl.DateTimeFormat("en-US", { timeZone });
  const rows: EarningsRow[] = [],
    warnings: string[] = [],
    seen = new Set<string>();
  const add = (row: EarningsRow) => {
    if (seen.has(row.id)) throw new Error(`Duplicate ledger identity: ${row.id}`);
    seen.add(row.id);
    integer(row.amountMinor);
    nonnegative(row.outstandingMinor);
    if (row.date) dateOnly(row.date);
    if (row.dueDate) dateOnly(row.dueDate);
    rows.push({ ...row, warnings: [...row.warnings] });
  };
  const defaults = {
    clientId: null,
    who: null,
    shootId: null,
    category: "",
    outstandingMinor: 0,
    dueDate: null,
    eligibleForTotals: true,
    linked: false,
    warnings: [] as string[],
  };
  for (const entry of input.local?.entries ?? [])
    add({
      ...defaults,
      id: `manual:${entry.id}`,
      sourceId: entry.id,
      date: entry.occurredOn,
      shootId: entry.shootId,
      linked: !!entry.shootId,
      who: entry.clientName ?? null,
      clientId: entry.clientId ?? null,
      paymentMethod: entry.paymentMethod ?? null,
      description: entry.description,
      category: entry.category,
      amountMinor: integer(entry.amountCents),
      currency: currencyCode(entry.currency ?? "USD"),
      type: entry.kind === "expense" ? "expense" : "payment",
      status: "recorded",
      source: "manual",
      accounting: entry.kind === "expense" ? "expense" : "collection",
    });
  for (const draft of input.local?.invoices ?? [])
    add({
      ...defaults,
      id: `local-draft:${draft.id}`,
      sourceId: draft.id,
      date: earningsDateInZone(draft.createdAt, timeZone),
      shootId: draft.shootId ?? null,
      linked: !!draft.shootId,
      who: draft.clientName,
      clientId: draft.clientId ?? null,
      description: draft.description,
      amountMinor: nonnegative(draft.amountCents),
      currency: currencyCode(draft.currency ?? "USD"),
      type: "invoice",
      status: "draft",
      source: "local-draft",
      accounting: "invoice",
      dueDate: draft.dueDate,
    });

  const payments = input.payments ?? [],
    canonicalLegacyIds = new Set<string>();
  for (const payment of payments) {
    const currency = currencyCode(payment.currency);
    nonnegative(payment.amountMinor);
    nonnegative(payment.collectedMinor);
    nonnegative(payment.refundedMinor);
    if (
      payment.refundedMinor > payment.collectedMinor ||
      payment.collectedMinor > payment.amountMinor ||
      payment.netMinor !== payment.collectedMinor - payment.refundedMinor
    )
      throw new Error("A payment receipt has inconsistent captured/refunded amounts.");
    // Even unlinked/test receipts suppress their matching stale import; the canonical row remains visible.
    for (const id of payment.legacyObjectIds) canonicalLegacyIds.add(id);
    const isPaid = payment.status === "paid" || payment.status === "refunded";
    const eligible = isPaid && payment.livemode && payment.linkStatus === "linked";
    const paymentWarnings = [...payment.warnings];
    if (!payment.livemode) paymentWarnings.push("Test-mode receipt; excluded from real earnings.");
    if (!payment.refundHistoryComplete)
      paymentWarnings.push("Refund history is incomplete; period net is provisional.");
    if (isPaid && !payment.paidAt)
      paymentWarnings.push("Posting date missing; excluded from period totals.");
    if (!payment.shootId)
      paymentWarnings.push(
        "Unlinked Stripe payment; shown separately from confirmed shoot earnings.",
      );
    add({
      ...defaults,
      id: `payment:${payment.id}`,
      sourceId: payment.chargeId,
      date: isPaid
        ? payment.paidAt
          ? earningsDateInZone(payment.paidAt, timeZone)
          : null
        : earningsDateInZone(payment.createdAt, timeZone),
      shootId: payment.shootId,
      clientId: payment.clientId,
      linked: !!payment.shootId,
      description: payment.description,
      type: payment.sourceKind === "gallery" ? "gallery" : "payment",
      amountMinor: isPaid ? payment.collectedMinor : payment.amountMinor,
      currency,
      source: "stripe",
      status: payment.livemode ? payment.status : `test-${payment.status}`,
      accounting: isPaid ? "collection" : "unreconciled",
      eligibleForTotals: eligible && !!payment.paidAt,
      warnings: paymentWarnings,
    });
    let refundSum = 0;
    for (const refund of payment.refunds) {
      nonnegative(refund.amountMinor);
      if (refund.status === "succeeded") refundSum = integer(refundSum + refund.amountMinor);
      add({
        ...defaults,
        id: `refund:${payment.accountId}:${refund.id}`,
        sourceId: refund.id,
        date: earningsDateInZone(refund.createdAt, timeZone),
        shootId: payment.shootId,
        linked: !!payment.shootId,
        clientId: payment.clientId,
        description: `Refund · ${payment.description}`,
        type: payment.sourceKind === "gallery" ? "gallery" : "payment",
        amountMinor: -refund.amountMinor,
        currency,
        source: "stripe",
        status: payment.livemode ? refund.status : `test-${refund.status}`,
        accounting: "refund",
        eligibleForTotals: eligible && refund.status === "succeeded",
      });
    }
    if (
      refundSum > payment.refundedMinor ||
      (payment.refundHistoryComplete && refundSum !== payment.refundedMinor)
    )
      throw new Error("A payment's dated refunds do not match its provider total.");
  }

  for (const transaction of input.legacyTransactions ?? []) {
    const replaced =
      !!transaction.stripe_object_id && canonicalLegacyIds.has(transaction.stripe_object_id);
    const isManual = transaction.source === "manual",
      isPayout = transaction.source === "stripe-payout";
    const currency = transaction.currency
      ? currencyCode(transaction.currency)
      : isManual
        ? "USD"
        : null;
    const rowWarnings: string[] = [];
    if (replaced)
      rowWarnings.push(
        "Matched to a current Stripe receipt; retained for audit, not counted twice.",
      );
    if (!currency)
      rowWarnings.push(
        "Legacy imported row has no recorded currency; amount retained, excluded from currency totals.",
      );
    add({
      ...defaults,
      id: `legacy:${transaction.id}`,
      sourceId: transaction.id,
      date: transaction.occurred_on,
      shootId: transaction.shoot_id,
      linked: !!transaction.shoot_id,
      who: transaction.client_name ?? null,
      clientId: transaction.client_id ?? null,
      description: transaction.description,
      category: transaction.category,
      amountMinor: decimalToMinorUnits(transaction.amount, currency ?? "USD"),
      currency,
      type: isPayout ? "payout" : transaction.kind === "expense" ? "expense" : "payment",
      source: isManual ? "manual" : "legacy",
      status: replaced ? "reconciled" : isPayout ? "informational" : "recorded",
      accounting: isPayout
        ? "transfer"
        : replaced
          ? "unreconciled"
          : transaction.kind === "expense"
            ? "expense"
            : "collection",
      eligibleForTotals: !isPayout && !replaced && !!currency,
      warnings: rowWarnings,
    });
  }

  for (const invoice of input.invoices ?? []) {
    const live = !("livemode" in invoice) || invoice.livemode;
    const outstanding = invoice.status === "open" ? nonnegative(invoice.outstandingMinor) : 0;
    if (outstanding > nonnegative(invoice.amountMinor))
      throw new Error("Invoice balance exceeds its total.");
    add({
      ...defaults,
      id: `invoice:${invoice.id}`,
      sourceId: invoice.id,
      date: earningsDateInZone(invoice.createdAt, timeZone),
      shootId: invoice.shootId,
      linked: !!invoice.shootId,
      who: invoice.clientName,
      clientId: invoice.clientId,
      description:
        "description" in invoice && typeof invoice.description === "string"
          ? invoice.description
          : "Invoice",
      amountMinor: invoice.amountMinor,
      currency: currencyCode(invoice.currency),
      type: "invoice",
      status: live ? invoice.status : `test-${invoice.status}`,
      source: "invoice",
      accounting: "invoice",
      outstandingMinor: outstanding,
      dueDate: invoice.dueDate,
      eligibleForTotals: live,
      warnings:
        invoice.status === "uncollectible"
          ? ["Uncollectible invoice is listed but not included in collectible outstanding."]
          : [],
    });
  }
  rows.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id));
  warnings.push(...rows.flatMap((row) => row.warnings));
  const incompletePayment = payments.some(
    (payment) =>
      payment.livemode &&
      payment.linkStatus === "linked" &&
      (input.shootId === undefined || payment.shootId === input.shootId) &&
      (payment.status === "paid" || payment.status === "refunded") &&
      (!payment.paidAt || !payment.refundHistoryComplete || payment.disputed),
  );
  const incompleteLegacy = rows.some(
    (row) =>
      row.currency === null &&
      row.accounting !== "transfer" &&
      row.status !== "reconciled" &&
      (input.shootId === undefined || row.shootId === input.shootId) &&
      inPeriod(row.date, input.period),
  );
  if (input.providerComplete === false)
    warnings.push("Provider history is incomplete; displayed subtotals are provisional.");
  const metrics = summarizeEarnings(rows, input);
  return {
    rows,
    metrics,
    warnings: [...new Set(warnings)],
    complete: input.providerComplete !== false && !incompletePayment && !incompleteLegacy,
  };
}

/** Collected/net are period cash flow; open balances are current as-of today, not draft revenue. */
export function summarizeEarnings(
  rows: readonly EarningsRow[],
  options: {
    period: EarningsPeriod;
    today: string;
    shootId?: string | null;
  },
): CurrencyMetrics[] {
  validatePeriod(options.period);
  dateOnly(options.today);
  const groups = new Map<string, CurrencyMetrics>();
  for (const row of rows) {
    if (!row.currency || (options.shootId !== undefined && row.shootId !== options.shootId))
      continue;
    const metric = groups.get(row.currency) ?? {
      currency: row.currency,
      collectedMinor: 0,
      refundsMinor: 0,
      outstandingMinor: 0,
      overdueMinor: 0,
      gallerySalesMinor: 0,
      expensesMinor: 0,
      netMinor: 0,
      unlinkedMinor: 0,
    };
    groups.set(row.currency, metric);
    if (!row.eligibleForTotals) {
      if (
        row.source === "stripe" &&
        !row.linked &&
        !row.status.startsWith("test-") &&
        inPeriod(row.date, options.period) &&
        row.status !== "pending" &&
        row.status !== "failed"
      )
        metric.unlinkedMinor = integer(metric.unlinkedMinor + row.amountMinor);
      continue;
    }
    if (row.accounting === "invoice" && row.date && row.date <= options.today) {
      metric.outstandingMinor = integer(metric.outstandingMinor + row.outstandingMinor);
      if (row.dueDate && row.dueDate < options.today)
        metric.overdueMinor = integer(metric.overdueMinor + row.outstandingMinor);
    }
    if (!inPeriod(row.date, options.period)) continue;
    if (row.accounting === "collection" || row.accounting === "refund") {
      metric.collectedMinor = integer(metric.collectedMinor + row.amountMinor);
      if (row.accounting === "refund")
        metric.refundsMinor = integer(metric.refundsMinor - row.amountMinor);
      if (row.type === "gallery")
        metric.gallerySalesMinor = integer(metric.gallerySalesMinor + row.amountMinor);
    } else if (row.accounting === "expense")
      metric.expensesMinor = integer(metric.expensesMinor + row.amountMinor);
    metric.netMinor = integer(metric.collectedMinor - metric.expensesMinor);
  }
  return [...groups.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

export function filterEarningsRows(
  rows: readonly EarningsRow[],
  options: {
    period: EarningsPeriod;
    filter?: EarningsFilter;
    shootId?: string | null;
    currency?: string;
  },
): EarningsRow[] {
  validatePeriod(options.period);
  const expected = {
    invoices: "invoice",
    gallery: "gallery",
    expenses: "expense",
    payouts: "payout",
  } as const;
  return rows.filter(
    (row) =>
      (row.date === null
        ? !options.period.from && !options.period.to
        : inPeriod(row.date, options.period)) &&
      (!options.filter || options.filter === "all" || row.type === expected[options.filter]) &&
      (options.shootId === undefined || row.shootId === options.shootId) &&
      (!options.currency || row.currency === options.currency),
  );
}

export function earningsCsv(
  rows: readonly EarningsRow[],
  shootName: (id: string | null) => string = () => "",
): string {
  return bookkeepingCsv([
    [
      "record_id",
      "date",
      "shoot_id",
      "shoot",
      "who",
      "payment_method",
      "type",
      "status",
      "description",
      "category",
      "amount",
      "currency",
      "source",
      "source_id",
      "accounting_role",
      "metric_eligible",
      "notes",
    ],
    ...rows.map((row) => [
      row.id,
      row.date ?? "",
      row.shootId ?? "",
      shootName(row.shootId),
      row.who ?? "",
      row.paymentMethod ?? "",
      row.type,
      row.status,
      row.description,
      row.category,
      minorUnitsDecimal(row.amountMinor, row.currency ?? "USD"),
      row.currency ?? "UNKNOWN",
      row.source,
      row.sourceId,
      row.accounting,
      row.eligibleForTotals ? "yes" : "no",
      row.warnings.join("; "),
    ]),
  ]);
}
