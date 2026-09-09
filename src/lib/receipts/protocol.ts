/** FRCP v1: big-endian integers, followed by ten byte-length-prefixed UTF-8 fields. */
export const RECEIPT_MAX_INPUT_BYTES = 8192;
export const RECEIPT_MAX_OUTPUT_BYTES = 65536;
export type CustomerReceiptModel = {
  receiptId: string;
  issuedOn: string;
  paidOn: string;
  studioName: string;
  customerName: string;
  shootName: string;
  description: string;
  amountMinor: number;
  currency: string;
  exponent: 0 | 2 | 3;
  paymentMethod?: string;
  /** A label from the caller's validated ledger, not a verification performed by this renderer. */
  sourceLabel: "Manually recorded" | "Provider verified";
};
export type CustomerReceipt = { html: string; text: string };
const fields = [
  ["receiptId", 128, false],
  ["issuedOn", 10, false],
  ["paidOn", 10, false],
  ["studioName", 160, false],
  ["customerName", 160, true],
  ["shootName", 200, true],
  ["description", 2000, false],
  ["currency", 3, false],
  ["paymentMethod", 80, true],
  ["sourceLabel", 32, false],
] as const;
const encoder = new TextEncoder();
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!
  );
}
function fieldBytes(value: unknown, max: number, optional: boolean) {
  if (typeof value !== "string" || (!optional && !value.trim()))
    throw new Error("A required receipt field is missing.");
  for (const char of value) {
    const point = char.codePointAt(0)!;
    if (
      point < 32 ||
      (point >= 127 && point <= 159) ||
      (point >= 0xd800 && point <= 0xdfff) ||
      (point >= 0x2028 && point <= 0x202e) ||
      (point >= 0x2066 && point <= 0x2069) ||
      point === 0x200e ||
      point === 0x200f
    )
      throw new Error("Receipt fields cannot contain control characters.");
  }
  const bytes = encoder.encode(value);
  if (bytes.length > max) throw new Error("A receipt field exceeds its size limit.");
  return bytes;
}
export function encodeCustomerReceipt(model: CustomerReceiptModel): Uint8Array<ArrayBuffer> {
  if (
    !model ||
    !Number.isSafeInteger(model.amountMinor) ||
    model.amountMinor <= 0 ||
    ![0, 2, 3].includes(model.exponent)
  )
    throw new Error("Receipt amount must be a positive, exact integer in supported minor units.");
  if (!/^[A-Z]{3}$/.test(model.currency) || !validDate(model.issuedOn) || !validDate(model.paidOn))
    throw new Error("Receipt currency or calendar date is invalid.");
  if (!["Manually recorded", "Provider verified"].includes(model.sourceLabel))
    throw new Error("Receipt payment provenance is required.");
  const encoded = fields.map(([key, max, optional]) => fieldBytes(model[key] ?? "", max, optional));
  const size = 20 + encoded.reduce((total, bytes) => total + 4 + bytes.length, 0);
  if (size > RECEIPT_MAX_INPUT_BYTES) throw new Error("Receipt input exceeds its size limit.");
  const packet = new Uint8Array(size),
    view = new DataView(packet.buffer);
  view.setUint32(0, 0x46524350);
  view.setUint32(4, 1);
  view.setUint32(8, model.exponent);
  view.setBigUint64(12, BigInt(model.amountMinor));
  let offset = 20;
  for (const bytes of encoded) {
    view.setUint32(offset, bytes.length);
    packet.set(bytes, offset + 4);
    offset += 4 + bytes.length;
  }
  return packet;
}
export function decodeCustomerReceiptRequest(bytes: Uint8Array): CustomerReceiptModel {
  if (bytes.length < 60 || bytes.length > RECEIPT_MAX_INPUT_BYTES)
    throw new Error("Invalid receipt input size.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x46524350 || view.getUint32(4) !== 1)
    throw new Error("Invalid receipt protocol.");
  const amount = view.getBigUint64(12);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Receipt amount exceeds exact integer limits.");
  const values: string[] = [];
  let offset = 20;
  for (const [, max] of fields) {
    if (offset + 4 > bytes.length) throw new Error("Incomplete receipt field.");
    const length = view.getUint32(offset);
    offset += 4;
    if (length > max || offset + length > bytes.length)
      throw new Error("Invalid receipt field size.");
    values.push(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        bytes.subarray(offset, offset + length),
      ),
    );
    offset += length;
  }
  if (offset !== bytes.length) throw new Error("Unexpected receipt bytes.");
  const model: CustomerReceiptModel = {
    receiptId: values[0]!,
    issuedOn: values[1]!,
    paidOn: values[2]!,
    studioName: values[3]!,
    customerName: values[4]!,
    shootName: values[5]!,
    description: values[6]!,
    currency: values[7]!,
    paymentMethod: values[8]!,
    sourceLabel: values[9]! as CustomerReceiptModel["sourceLabel"],
    exponent: view.getUint32(8) as CustomerReceiptModel["exponent"],
    amountMinor: Number(amount),
  };
  encodeCustomerReceipt(model); // identical bounds and field validation in both directions
  return model;
}
export function decodeCustomerReceiptResult(bytes: Uint8Array): CustomerReceipt {
  if (!bytes.length || bytes.length > RECEIPT_MAX_OUTPUT_BYTES)
    throw new Error("Invalid receipt result size.");
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid receipt result.");
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).sort().join(",") !== "html,text" ||
    typeof result["html"] !== "string" ||
    typeof result["text"] !== "string" ||
    !result["html"].startsWith("<!doctype html>") ||
    !result["text"].startsWith("PAYMENT RECEIPT\n")
  )
    throw new Error("Invalid receipt result.");
  return { html: result["html"], text: result["text"] };
}
