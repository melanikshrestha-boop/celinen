import {
  RECEIPT_MAX_OUTPUT_BYTES,
  encodeCustomerReceipt,
  decodeCustomerReceiptResult,
  type CustomerReceipt,
  type CustomerReceiptModel,
} from "./protocol";
export type { CustomerReceipt, CustomerReceiptModel } from "./protocol";
async function boundedBytes(response: Response, limit: number, signal: AbortSignal) {
  if (Number(response.headers.get("Content-Length")) > limit)
    throw new Error("Receipt response exceeds limits.");
  if (!response.body) throw new Error("The local receipt engine returned no response.");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("Receipt response exceeds limits.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  signal.throwIfAborted();
  return result;
}
export async function renderCustomerReceipt(
  model: CustomerReceiptModel,
  signal: AbortSignal,
): Promise<CustomerReceipt> {
  signal.throwIfAborted();
  const packet = encodeCustomerReceipt(model);
  if (
    typeof window === "undefined" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)
  )
    throw new Error(
      "Receipt generation requires the local C++ engine. It is not available on the hosted website.",
    );
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  let statusResponse: Response;
  try {
    statusResponse = await fetch("/__receipt/status", {
      signal: requestSignal,
      credentials: "same-origin",
      cache: "no-store",
      headers: { "x-lenslabs-request": "studio" },
    });
  } catch (error) {
    requestSignal.throwIfAborted();
    throw new Error("The local C++ receipt engine is unavailable.", { cause: error });
  }
  if (!statusResponse.ok) throw new Error("The local C++ receipt engine is unavailable.");
  let status: unknown;
  try {
    status = JSON.parse(
      new TextDecoder().decode(await boundedBytes(statusResponse, 512, requestSignal)),
    );
  } catch {
    requestSignal.throwIfAborted();
    throw new Error("The local C++ receipt bridge is unavailable.");
  }
  const capability =
    status && typeof status === "object" ? (status as Record<string, unknown>) : {};
  if (
    capability["ready"] !== true ||
    capability["engine"] !== "cpp-receipt-1" ||
    typeof capability["token"] !== "string" ||
    !/^[a-f0-9]{64}$/.test(capability["token"])
  )
    throw new Error(
      "The local C++ receipt engine is not built. Run the native receipt build first.",
    );
  const response = await fetch("/__receipt/render", {
    method: "POST",
    signal: requestSignal,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/x-foto-receipt",
      "x-lenslabs-request": "studio",
      "x-lenslabs-token": capability["token"],
    },
    body: new Blob([packet]),
  });
  if (!response.ok) {
    let message = "Receipt generation failed. Nothing was saved or sent.";
    try {
      const error = JSON.parse(
        new TextDecoder().decode(await boundedBytes(response, 2048, requestSignal)),
      ) as { error?: unknown };
      if (typeof error.error === "string" && error.error.length <= 500) message = error.error;
    } catch {
      requestSignal.throwIfAborted();
    }
    throw new Error(message);
  }
  if (!response.headers.get("content-type")?.startsWith("application/json"))
    throw new Error("Invalid local receipt response.");
  return decodeCustomerReceiptResult(
    await boundedBytes(response, RECEIPT_MAX_OUTPUT_BYTES, requestSignal),
  );
}
