import { isEarningsDate, earningsDateInZone, type EarningsRow } from "../earnings-ledger";
import { currencyExponent } from "../finance-money";
import type { ConnectedEarningsSnapshot } from "../earnings/stripe-receipts";
import type { CustomerReceiptModel } from "./protocol";

export const RECEIPT_VERIFICATION_MAX_AGE_MS = 5 * 60 * 1000;

/** Only a recorded collection can become a receipt. Drafts and sales promises are not payments. */
export function receiptUnavailable(
  row: EarningsRow,
  snapshot: ConnectedEarningsSnapshot | null,
  today: string,
  timeZone = "UTC",
  nowMs = Date.now(),
) {
  if (row.accounting !== "collection" || !["payment", "gallery"].includes(row.type))
    return "Receipts are available for received payments, not invoices, expenses, or payouts.";
  if (!row.eligibleForTotals || !Number.isSafeInteger(row.amountMinor) || row.amountMinor <= 0)
    return "This payment has not been confirmed as a positive collection.";
  if (!row.shootId || !row.linked)
    return "Link this payment to its shoot before creating a receipt.";
  if (!row.date || !isEarningsDate(row.date) || !isEarningsDate(today) || row.date > today)
    return "A valid payment date on or before today is required.";
  try {
    if (!row.currency) throw new Error();
    currencyExponent(row.currency);
  } catch {
    return "The payment needs a verified currency before creating a receipt.";
  }
  if (row.source === "manual" && row.status === "recorded") return null;
  if (row.source !== "stripe")
    return "Imported payment records need verification before receipt generation.";
  const fetchedAt = Date.parse(snapshot?.fetchedAt ?? "");
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(fetchedAt) ||
    fetchedAt > nowMs + 30_000 ||
    nowMs - fetchedAt > RECEIPT_VERIFICATION_MAX_AGE_MS
  )
    return "Refresh Earnings to verify this payment again. Receipt verification expires after five minutes.";
  const proof = snapshot?.receipts.find((item) => item.chargeId === row.sourceId);
  if (
    !snapshot?.complete ||
    snapshot.connection !== "connected" ||
    !proof ||
    proof.accountId !== snapshot.accountId ||
    !proof.livemode ||
    proof.status !== "paid" ||
    proof.disputed ||
    !proof.refundHistoryComplete ||
    proof.refundedMinor !== 0 ||
    proof.refunds.length !== 0 ||
    proof.linkStatus !== "linked" ||
    !proof.paidAt ||
    proof.shootId !== row.shootId ||
    proof.clientId !== row.clientId ||
    proof.collectedMinor !== row.amountMinor ||
    proof.netMinor !== row.amountMinor ||
    proof.currency.toUpperCase() !== row.currency ||
    row.status !== "paid"
  )
    return "Refresh the verified payment first. Refunded, disputed, incomplete, or mismatched payments need their provider record.";
  try {
    if (earningsDateInZone(proof.paidAt, timeZone) !== row.date)
      return "Payment date does not match the verified provider record.";
  } catch {
    return "Payment date could not be verified.";
  }
  return null;
}

export function customerReceiptFromEarnings(
  row: EarningsRow,
  input: {
    today: string;
    studioName: string;
    customerName: string;
    shootName: string;
    snapshot: ConnectedEarningsSnapshot | null;
    timeZone?: string;
    nowMs?: number;
  },
): CustomerReceiptModel {
  const reason = receiptUnavailable(row, input.snapshot, input.today, input.timeZone, input.nowMs);
  if (reason) throw new Error(reason);
  if (!input.studioName.trim()) throw new Error("Add the name customers know your business by.");
  if (!input.customerName.trim()) throw new Error("Add the customer's name for this receipt.");
  if (!input.shootName.trim())
    throw new Error("The linked shoot must be available before creating a receipt.");
  const exponent = currencyExponent(row.currency!);
  if (exponent !== 0 && exponent !== 2 && exponent !== 3)
    throw new Error("Unsupported currency precision.");
  return {
    receiptId: `FOTO-${row.sourceId}`,
    issuedOn: input.today,
    paidOn: row.date!,
    studioName: input.studioName.trim(),
    customerName: input.customerName.trim(),
    shootName: input.shootName.trim(),
    description: row.description,
    amountMinor: row.amountMinor,
    currency: row.currency!,
    exponent,
    paymentMethod: row.paymentMethod ?? "",
    sourceLabel: row.source === "stripe" ? "Provider verified" : "Manually recorded",
  };
}
