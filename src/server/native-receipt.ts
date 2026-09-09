/** Local development bridge: no receipt persistence, network calls, or customer-data logging. */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import {
  RECEIPT_MAX_INPUT_BYTES,
  RECEIPT_MAX_OUTPUT_BYTES,
  decodeCustomerReceiptRequest,
  decodeCustomerReceiptResult,
  type CustomerReceipt,
} from "../lib/receipts/protocol";
import { authorizeNativeRequest, NativeBridgeError } from "./native-studio-plugin";

export function parseReceiptRequest(bytes: Buffer) {
  try {
    return decodeCustomerReceiptRequest(bytes);
  } catch {
    throw new NativeBridgeError(400, "Invalid receipt fields or exact-money protocol.");
  }
}
export function runNativeReceipt(
  binary: string,
  packet: Buffer,
  signal: AbortSignal,
): Promise<CustomerReceipt> {
  parseReceiptRequest(packet);
  return new Promise((resolveResult, reject) => {
    if (signal.aborted) return reject(new NativeBridgeError(499, "Receipt cancelled."));
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"], shell: false });
    const chunks: Buffer[] = [];
    let size = 0,
      errorSize = 0,
      settled = false;
    const finish = (error?: Error, result?: CustomerReceipt) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error || !result) {
        child.kill("SIGKILL");
        reject(error ?? new Error("Invalid receipt result."));
      } else resolveResult(result);
    };
    const abort = () => finish(new NativeBridgeError(499, "Receipt cancelled."));
    const timer = setTimeout(
      () => finish(new NativeBridgeError(504, "Local receipt rendering timed out.")),
      3000,
    );
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > RECEIPT_MAX_OUTPUT_BYTES)
        finish(new NativeBridgeError(502, "Receipt result exceeds limits."));
      else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errorSize += chunk.length;
      if (errorSize > 8192)
        finish(new NativeBridgeError(502, "Receipt engine returned an invalid result."));
    });
    child.stdin.on("error", () =>
      finish(new NativeBridgeError(502, "Receipt input closed unexpectedly.")),
    );
    child.once("error", () =>
      finish(
        new NativeBridgeError(
          503,
          "Local C++ receipt engine is unavailable. Build native/build/lenslabs-receipt first.",
        ),
      ),
    );
    child.once("close", (code) => {
      if (settled) return;
      try {
        if (code !== 0)
          throw new NativeBridgeError(
            422,
            "The C++ engine rejected this receipt. Nothing was saved or sent.",
          );
        finish(undefined, decodeCustomerReceiptResult(Buffer.concat(chunks)));
      } catch (error) {
        finish(
          error instanceof NativeBridgeError
            ? error
            : new NativeBridgeError(502, "Receipt engine returned an invalid result."),
        );
      }
    });
    child.stdin.end(packet);
  });
}
export function nativeReceiptPlugin(): Plugin {
  const token = randomBytes(32).toString("hex");
  let root = process.cwd(),
    active = 0;
  return {
    name: "foto-local-cpp-receipt",
    apply: "serve",
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      const binary = resolve(root, "native/build/lenslabs-receipt");
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0];
        if (path !== "/__receipt/status" && path !== "/__receipt/render") return next();
        const controller = new AbortController(),
          abort = () => controller.abort();
        let claimed = false;
        req.once("aborted", abort);
        res.once("close", abort);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        const deadline = setTimeout(() => {
          controller.abort();
          if (!req.complete) req.destroy();
        }, 10_000);
        try {
          const address = server.httpServer?.address();
          if (!address || typeof address === "string")
            throw new NativeBridgeError(503, "Local server is not ready.");
          authorizeNativeRequest(req, address.port, token);
          if (path === "/__receipt/status" && req.method === "GET") {
            const ready = await access(binary, constants.X_OK).then(
              () => true,
              () => false,
            );
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({ ready, token: ready ? token : null, engine: "cpp-receipt-1" }),
            );
            return;
          }
          if (path !== "/__receipt/render" || req.method !== "POST")
            throw new NativeBridgeError(405, "Use a receipt render request.");
          if (req.headers["content-type"] !== "application/x-foto-receipt")
            throw new NativeBridgeError(415, "Invalid receipt request type.");
          const length = req.headers["content-length"];
          if (
            length !== undefined &&
            (!/^\d+$/.test(length) || Number(length) > RECEIPT_MAX_INPUT_BYTES)
          )
            throw new NativeBridgeError(413, "Receipt input exceeds limits.");
          if (active >= 1)
            throw new NativeBridgeError(429, "Another receipt is preparing. Try again shortly.");
          active++;
          claimed = true;
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            controller.signal.throwIfAborted();
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += bytes.length;
            if (size > RECEIPT_MAX_INPUT_BYTES)
              throw new NativeBridgeError(413, "Receipt input exceeds limits.");
            chunks.push(bytes);
          }
          const result = await runNativeReceipt(binary, Buffer.concat(chunks), controller.signal);
          controller.signal.throwIfAborted();
          const json = JSON.stringify(result);
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Content-Length", Buffer.byteLength(json));
          res.end(json);
        } catch (error) {
          if (!res.destroyed && !res.writableEnded) {
            res.statusCode = error instanceof NativeBridgeError ? error.status : 500;
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Connection", "close");
            res.end(
              JSON.stringify({
                error:
                  error instanceof NativeBridgeError
                    ? error.message
                    : "Receipt could not finish. Nothing was saved or sent.",
              }),
            );
          }
        } finally {
          clearTimeout(deadline);
          if (claimed) active--;
          req.removeListener("aborted", abort);
          res.removeListener("close", abort);
        }
      });
    },
  };
}
