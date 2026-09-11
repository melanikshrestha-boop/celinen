import { describe, expect, test, afterEach } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { IncomingMessage } from "node:http";
import {
  encodeCustomerReceipt,
  decodeCustomerReceiptRequest,
  decodeCustomerReceiptResult,
  RECEIPT_MAX_INPUT_BYTES,
  RECEIPT_MAX_OUTPUT_BYTES,
  type CustomerReceiptModel,
} from "../src/lib/receipts/protocol";
import { renderCustomerReceipt } from "../src/lib/receipts/native-client";
import { parseReceiptRequest, runNativeReceipt } from "../src/server/native-receipt";
import { authorizeNativeRequest } from "../src/server/native-studio-plugin";

const sample: CustomerReceiptModel = {
  receiptId: "R-0001",
  issuedOn: "2026-09-08",
  paidOn: "2026-09-07",
  studioName: "FOTO",
  customerName: "Zoë & 李",
  shootName: "Friday Game",
  description: "Sideline photography",
  amountMinor: 12345,
  currency: "USD",
  exponent: 2,
  paymentMethod: "Cash",
  sourceLabel: "Manually recorded",
};
const binary = resolve("native/build/lenslabs-receipt");
const originalFetch = globalThis.fetch,
  originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});
describe("exact-money bounded native receipt protocol", () => {
  test("round-trips Unicode, optional blank fields, full safe integer amounts and snapshots input", () => {
    const model = { ...sample },
      bytes = encodeCustomerReceipt(model);
    model.description = "Changed";
    expect(decodeCustomerReceiptRequest(bytes)).toEqual(sample);
    expect([...bytes.slice(0, 12)]).toEqual([70, 82, 67, 80, 0, 0, 0, 1, 0, 0, 0, 2]);
    for (const exponent of [0, 2, 3] as const) {
      const receipt = { ...sample, amountMinor: Number.MAX_SAFE_INTEGER, exponent };
      expect(decodeCustomerReceiptRequest(encodeCustomerReceipt(receipt))).toEqual(receipt);
    }
    const { paymentMethod: _, ...withoutMethod } = sample;
    expect(decodeCustomerReceiptRequest(encodeCustomerReceipt(withoutMethod)).paymentMethod).toBe(
      "",
    );
  });
  test("rejects fractional/negative/unsafe money, unsupported exponents, dates, labels and control characters", () => {
    for (const amountMinor of [0, -1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => encodeCustomerReceipt({ ...sample, amountMinor })).toThrow();
    for (const patch of [
      { exponent: 1 },
      { exponent: 4 },
      { currency: "usd" },
      { currency: "USDD" },
      { issuedOn: "0000-01-01" },
      { paidOn: "2026-02-29" },
      { paidOn: "2026-1-01" },
      { sourceLabel: "Paid" },
      { studioName: " " },
      { description: "" },
    ])
      expect(() =>
        encodeCustomerReceipt({ ...sample, ...patch } as CustomerReceiptModel),
      ).toThrow();
    for (const description of [
      "a\nb",
      "a\tb",
      "a\0b",
      "\u007f",
      "\u0085",
      "\u202e",
      "\u2066",
      "\ud800",
      "🧡".repeat(501),
    ])
      expect(() => encodeCustomerReceipt({ ...sample, description })).toThrow();
    expect(() => encodeCustomerReceipt({ ...sample, paidOn: "2024-02-29" })).not.toThrow();
    expect(() => encodeCustomerReceipt({ ...sample, description: "x".repeat(2000) })).not.toThrow();
  });
  test("rejects truncated, extra, malformed UTF-8 and oversized binary fields on server before native work", () => {
    const valid = Buffer.from(encodeCustomerReceipt(sample));
    for (let size = 0; size < valid.length; size++)
      expect(() => parseReceiptRequest(valid.subarray(0, size))).toThrow();
    for (const invalid of [
      Buffer.concat([valid, Buffer.from([0])]),
      Buffer.alloc(RECEIPT_MAX_INPUT_BYTES + 1),
    ])
      expect(() => parseReceiptRequest(invalid)).toThrow();
    for (const offset of [0, 4, 8, 20]) {
      const invalid = Buffer.from(valid);
      invalid[offset] = 255;
      expect(() => parseReceiptRequest(invalid)).toThrow();
    }
    const invalid = Buffer.from(valid);
    invalid[24] = 0xc0;
    invalid[25] = 0xaf;
    expect(() => parseReceiptRequest(invalid)).toThrow();
  });
  test("result parser rejects non-receipts, extra fields, invalid UTF-8 and excessive output", () => {
    for (const value of [
      null,
      [],
      { html: "x", text: "x" },
      { html: "<!doctype html>", text: "PAYMENT RECEIPT\n", secret: "x" },
    ])
      expect(() =>
        decodeCustomerReceiptResult(new TextEncoder().encode(JSON.stringify(value))),
      ).toThrow();
    expect(() =>
      decodeCustomerReceiptResult(new Uint8Array(RECEIPT_MAX_OUTPUT_BYTES + 1)),
    ).toThrow();
    expect(() => decodeCustomerReceiptResult(new Uint8Array([0xc0, 0xaf]))).toThrow();
  });
  test("existing local host/origin/token guards reject LAN, rebinding and cross-origin posts", () => {
    const token = "a".repeat(64),
      port = 8085;
    const req = {
      method: "POST",
      socket: { remoteAddress: "127.0.0.1" },
      headers: {
        host: `127.0.0.1:${port}`,
        origin: `http://127.0.0.1:${port}`,
        "x-lenslabs-request": "studio",
        "x-lenslabs-token": token,
      },
    };
    expect(() => authorizeNativeRequest(req as IncomingMessage, port, token)).not.toThrow();
    for (const headers of [
      { origin: "https://evil.example" },
      { host: `evil.example:${port}` },
      { "x-lenslabs-token": "b".repeat(64) },
      { "x-lenslabs-request": "" },
      { "sec-fetch-site": "cross-site" },
    ])
      expect(() =>
        authorizeNativeRequest(
          { ...req, headers: { ...req.headers, ...headers } } as IncomingMessage,
          port,
          token,
        ),
      ).toThrow();
    expect(() =>
      authorizeNativeRequest(
        { ...req, socket: { remoteAddress: "192.168.0.1" } } as IncomingMessage,
        port,
        token,
      ),
    ).toThrow();
  });
});
describe.skipIf(!existsSync(binary))("real portable C++ receipt process", () => {
  test("renders deterministic exact-money HTML and plain text without HTML injection or invented payment details", async () => {
    const model = { ...sample, description: "</p><script>alert(\"x\")</script> & 'quoted' \\" };
    delete (model as Partial<CustomerReceiptModel>).paymentMethod;
    const packet = Buffer.from(encodeCustomerReceipt(model)),
      before = Buffer.from(packet);
    const result = await runNativeReceipt(binary, packet, new AbortController().signal);
    expect(result).toEqual(await runNativeReceipt(binary, packet, new AbortController().signal));
    expect(packet).toEqual(before);
    expect(result.html).toContain("Zoë &amp; 李");
    expect(result.html).toContain(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quoted&#39;",
    );
    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("@media print");
    expect(result.html).toContain("default-src 'none'");
    expect(result.text).toContain(model.description);
    expect(result.text).toContain("Amount paid: USD 123.45");
    expect(result.text).toContain("Payment source: Manually recorded");
    expect(result.text).not.toContain("Payment method:");
    expect(result.text).not.toContain("Tax:");
    expect(result.text).not.toContain("Balance:");
  });
  test("native executable independently rejects hostile protocol and financial overflow without leaking fields", () => {
    const valid = Buffer.from(encodeCustomerReceipt(sample));
    const overflow = Buffer.from(valid);
    overflow.writeBigUInt64BE(9007199254740992n, 12);
    const invalidUTF = Buffer.from(valid);
    invalidUTF[24] = 0xc0;
    invalidUTF[25] = 0xaf;
    for (const packet of [
      Buffer.alloc(0),
      valid.subarray(0, 20),
      Buffer.concat([valid, Buffer.from([0])]),
      Buffer.alloc(RECEIPT_MAX_INPUT_BYTES + 1),
      overflow,
      invalidUTF,
    ]) {
      const result = spawnSync(binary, [], {
        input: packet,
        timeout: 3000,
        maxBuffer: RECEIPT_MAX_OUTPUT_BYTES,
      });
      expect(result.status).not.toBe(0);
      expect(result.stdout.length).toBe(0);
      expect(result.stderr.toString()).toBe("Receipt request rejected.\n");
      expect(result.stderr.toString()).not.toContain(sample.customerName);
    }
  });
  test("formats zero/two/three decimal currencies exactly; provenance is supplied metadata, not cryptographic verification", async () => {
    for (const [currency, exponent, amountMinor, expected] of [
      ["JPY", 0, 1, "JPY 1"],
      ["USD", 2, 1, "USD 0.01"],
      ["KWD", 3, 1, "KWD 0.001"],
      ["USD", 2, Number.MAX_SAFE_INTEGER, "USD 90071992547409.91"],
      ["KWD", 3, Number.MAX_SAFE_INTEGER, "KWD 9007199254740.991"],
    ] as const) {
      const result = await runNativeReceipt(
        binary,
        Buffer.from(
          encodeCustomerReceipt({
            ...sample,
            currency,
            exponent,
            amountMinor,
            sourceLabel: "Provider verified",
          }),
        ),
        new AbortController().signal,
      );
      expect(result.html).toContain(expected);
      expect(result.text).toContain(expected);
      expect(result.text).toContain("Provider verified");
    }
  });
  test("aborted and unavailable engines fail explicitly, never fabricate a fallback receipt", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runNativeReceipt(binary, Buffer.from(encodeCustomerReceipt(sample)), controller.signal),
    ).rejects.toThrow("cancelled");
    await expect(
      runNativeReceipt(
        `${binary}-not-built`,
        Buffer.from(encodeCustomerReceipt(sample)),
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });
});
describe("local-only receipt browser client", () => {
  test("hosted pages fail before any fetch; cancellation is honored", async () => {
    let calls = 0;
    globalThis.fetch = (() => {
      calls++;
      throw new Error("Unexpected network");
    }) as typeof fetch;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { hostname: "foto.example" } },
    });
    await expect(renderCustomerReceipt(sample, new AbortController().signal)).rejects.toThrow(
      "local C++ engine",
    );
    expect(calls).toBe(0);
    const controller = new AbortController();
    controller.abort();
    await expect(renderCustomerReceipt(sample, controller.signal)).rejects.toThrow();
    expect(calls).toBe(0);
  });
  test("uses bounded capability handshake and exact binary render, returns native result only", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { hostname: "127.0.0.1" } },
    });
    const receipt = {
      html: "<!doctype html><p>Fixture native result</p>",
      text: "PAYMENT RECEIPT\nFixture",
    };
    const requests: Array<{ url: unknown; init: RequestInit | undefined }> = [];
    globalThis.fetch = (async (url, init) => {
      requests.push({ url, init });
      if (url === "/__receipt/status")
        return Response.json({ ready: true, token: "a".repeat(64), engine: "cpp-receipt-1" });
      expect(init?.credentials).toBe("same-origin");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("x-lenslabs-token")).toBe("a".repeat(64));
      expect(
        decodeCustomerReceiptRequest(new Uint8Array(await (init?.body as Blob).arrayBuffer())),
      ).toEqual(sample);
      return Response.json(receipt);
    }) as typeof fetch;
    expect(await renderCustomerReceipt(sample, new AbortController().signal)).toEqual(receipt);
    expect(requests).toHaveLength(2);
    globalThis.fetch = (async () =>
      Response.json({ ready: false, token: null, engine: "cpp-receipt-1" })) as typeof fetch;
    await expect(renderCustomerReceipt(sample, new AbortController().signal)).rejects.toThrow(
      "not built",
    );
    globalThis.fetch = (async () => new Response("x".repeat(513))) as typeof fetch;
    await expect(renderCustomerReceipt(sample, new AbortController().signal)).rejects.toThrow(
      "unavailable",
    );
  });
});
