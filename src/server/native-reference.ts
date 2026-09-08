/** Bounded localhost RGB-pair transport. No client paths, temporary files, or image persistence. */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import type { IncomingMessage } from "node:http";
import type { Plugin } from "vite";
import {
  REFERENCE_LIMITS,
  referenceResult,
  type ReferenceFitResult,
} from "../lib/develop/reference-contract";
import { authorizeNativeRequest, NativeBridgeError } from "./native-studio-plugin";

export function parseReferencePair(bytes: Buffer): Buffer {
  if (bytes.length < 8 || bytes.length > REFERENCE_LIMITS.maxPacketBytes)
    throw new NativeBridgeError(400, "Invalid reference preview size.");
  const width = bytes.readUInt32BE(0),
    height = bytes.readUInt32BE(4);
  if ([width, height].some((v) => v < 16 || v > 128) || bytes.length !== 8 + width * height * 8)
    throw new NativeBridgeError(400, "Invalid aligned reference pair.");
  for (let offset = 11; offset < bytes.length; offset += 4)
    if (bytes[offset] !== 255)
      throw new NativeBridgeError(400, "Use opaque photos without transparent borders.");
  return bytes;
}
export function runNativeReference(
  binary: string,
  bytes: Buffer,
  signal: AbortSignal,
): Promise<ReferenceFitResult> {
  const input = parseReferencePair(bytes);
  return new Promise((resolveResult, reject) => {
    if (signal.aborted) {
      reject(new NativeBridgeError(499, "Reference fit cancelled."));
      return;
    }
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let size = 0,
      settled = false;
    const finish = (error?: Error, result?: ReferenceFitResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) {
        child.kill("SIGKILL");
        reject(error);
      } else if (result) resolveResult(result);
    };
    const abort = () => finish(new NativeBridgeError(499, "Reference fit cancelled."));
    const timer = setTimeout(
      () => finish(new NativeBridgeError(504, "Reference fit timed out. Originals are unchanged.")),
      15_000,
    );
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 16 * 1024) finish(new Error("Invalid reference-fit receipt."));
      else chunks.push(chunk);
    });
    child.stderr.on("data", () => {});
    child.once("error", () => finish(new Error("The C++ reference fitter could not start.")));
    child.stdin.on("error", () => finish(new Error("The reference-fit stream closed.")));
    child.once("close", (code) => {
      if (settled) return;
      if (code === 2) {
        finish(
          new NativeBridgeError(
            422,
            "The pair has insufficient matching detail. Choose the same frame, crop and orientation without borders or watermarks.",
          ),
        );
        return;
      }
      if (code !== 0) {
        finish(new Error("Reference fit failed. Originals are unchanged."));
        return;
      }
      try {
        finish(undefined, referenceResult(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
      } catch {
        finish(new Error("Invalid reference-fit receipt."));
      }
    });
    child.stdin.end(input);
  });
}
async function readPair(req: IncomingMessage, signal: AbortSignal) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const raw of req) {
    signal.throwIfAborted();
    const chunk: Buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    size += chunk.length;
    if (size > REFERENCE_LIMITS.maxPacketBytes)
      throw new NativeBridgeError(413, "Reference previews exceed their bound.");
    chunks.push(chunk);
  }
  return parseReferencePair(Buffer.concat(chunks));
}
export function nativeReferencePlugin(): Plugin {
  const token = randomBytes(32).toString("hex");
  let root = process.cwd(),
    active = false;
  return {
    name: "foto-local-native-reference",
    apply: "serve",
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      const binary = resolve(root, "native/build/lenslabs-reference");
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0];
        if (path !== "/__reference/status" && path !== "/__reference/fit") return next();
        const controller = new AbortController(),
          abort = () => controller.abort();
        let claimed = false;
        req.once("aborted", abort);
        res.once("close", abort);
        const deadline = setTimeout(() => {
          controller.abort();
          if (!req.complete) req.destroy();
        }, 20_000);
        try {
          const address = server.httpServer?.address();
          if (!address || typeof address === "string")
            throw new NativeBridgeError(503, "Local server unavailable.");
          authorizeNativeRequest(req, address.port, token);
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("X-Content-Type-Options", "nosniff");
          if (path === "/__reference/status" && req.method === "GET") {
            let ready = true;
            try {
              await access(binary, constants.X_OK);
            } catch {
              ready = false;
            }
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ready, token: ready ? token : null }));
            return;
          }
          if (path !== "/__reference/fit" || req.method !== "POST")
            throw new NativeBridgeError(405, "Use a reference fit request.");
          if (req.headers["content-type"] !== "application/x-foto-reference")
            throw new NativeBridgeError(415, "Invalid reference request type.");
          if (Number(req.headers["content-length"]) > REFERENCE_LIMITS.maxPacketBytes)
            throw new NativeBridgeError(413, "Reference previews exceed their bound.");
          if (active)
            throw new NativeBridgeError(
              429,
              "Another reference fit is running. Retry when it finishes.",
            );
          active = claimed = true;
          const result = await runNativeReference(
            binary,
            await readPair(req, controller.signal),
            controller.signal,
          );
          if (controller.signal.aborted) return;
          const receipt = JSON.stringify(result);
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Content-Length", Buffer.byteLength(receipt));
          res.end(receipt);
        } catch (error) {
          if (!res.destroyed && !res.writableEnded) {
            res.statusCode = error instanceof NativeBridgeError ? error.status : 500;
            res.setHeader("Connection", "close");
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                error:
                  error instanceof NativeBridgeError
                    ? error.message
                    : "Reference fit failed. Originals are unchanged.",
              }),
            );
          }
        } finally {
          clearTimeout(deadline);
          if (claimed) active = false;
          req.removeListener("aborted", abort);
          res.removeListener("close", abort);
        }
      });
    },
  };
}
