/** Local-only object selection + C++ texture fill. No image or mask is persisted here. */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { REMOVE_MAX_BYTES, decodeObjectInstances } from "../lib/develop/object-remove";
import { authorizeNativeRequest, NativeBridgeError } from "./native-studio-plugin";
export function parseRemoveRequest(bytes: Buffer) {
  if (bytes.length < 16 || bytes.length > REMOVE_MAX_BYTES || bytes.readUInt32BE(0) !== 0x464f5231)
    throw new NativeBridgeError(400, "Invalid removal packet.");
  const operation = bytes.readUInt32BE(4),
    width = bytes.readUInt32BE(8),
    height = bytes.readUInt32BE(12);
  const edge = operation === 0 ? 1600 : 4096;
  if (
    operation > 1 ||
    width < 16 ||
    height < 16 ||
    width > edge ||
    height > edge ||
    bytes.length !== 16 + width * height * (operation ? 5 : 4)
  )
    throw new NativeBridgeError(400, "Invalid removal image bounds.");
  if (operation === 1) {
    const mask = bytes.subarray(16 + width * height * 4);
    let selected = 0;
    for (const value of mask) {
      if (value !== 0 && value !== 255)
        throw new NativeBridgeError(400, "Invalid object selection.");
      if (value) selected++;
    }
    if (!selected || selected > (width * height) / 2)
      throw new NativeBridgeError(
        400,
        "Select an object covering no more than half the photo. Large scenes need a different reconstruction tool.",
      );
  }
  return { operation, width, height };
}
export function runNativeRemove(
  binary: string,
  packet: Buffer,
  signal: AbortSignal,
): Promise<Buffer> {
  const request = parseRemoveRequest(packet);
  return new Promise((resolveResult, reject) => {
    if (signal.aborted) return reject(new NativeBridgeError(499, "Removal cancelled."));
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let size = 0,
      settled = false;
    const finish = (error?: Error, result?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error || !result) {
        child.kill("SIGKILL");
        reject(error ?? new Error("Invalid removal result."));
      } else resolveResult(result);
    };
    const abort = () => finish(new NativeBridgeError(499, "Removal cancelled."));
    const timer = setTimeout(
      () => finish(new NativeBridgeError(504, "Removal timed out. Nothing changed.")),
      60_000,
    );
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > (request.operation ? 96 * 1024 * 1024 : 12 + 2048 * 2048))
        finish(new Error("Removal result exceeds limits."));
      else chunks.push(chunk);
    });
    child.stderr.on("data", () => {});
    child.stdin.on("error", () => finish(new Error("Removal input closed.")));
    child.once("error", () =>
      finish(new NativeBridgeError(503, "The local C++ removal engine could not start.")),
    );
    child.once("close", (code) => {
      try {
        if (code !== 0)
          throw new NativeBridgeError(
            422,
            request.operation
              ? "This selection could not be reconstructed. Try a smaller object. Nothing changed."
              : "No usable objects were detected, or local selection is unavailable on this device.",
          );
        const result = Buffer.concat(chunks);
        if (request.operation === 0) decodeObjectInstances(result);
        else if (
          result.length < 24 ||
          !result.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
          result.readUInt32BE(16) !== request.width ||
          result.readUInt32BE(20) !== request.height
        )
          throw new Error("Invalid removal preview dimensions.");
        finish(undefined, result);
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Invalid removal result."));
      }
    });
    child.stdin.end(packet);
  });
}
export function nativeObjectRemovePlugin(): Plugin {
  const token = randomBytes(32).toString("hex");
  let root = process.cwd(),
    active = 0;
  return {
    name: "foto-local-object-removal",
    apply: "serve",
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      const binary = resolve(root, "native/build/lenslabs-object-remove");
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0];
        if (path !== "/__remove/status" && path !== "/__remove/process") return next();
        const controller = new AbortController(),
          abort = () => controller.abort();
        let claimed = false;
        req.once("aborted", abort);
        res.once("close", abort);
        const deadline = setTimeout(() => {
          controller.abort();
          if (!req.complete) req.destroy();
        }, 70_000);
        try {
          const address = server.httpServer?.address();
          if (!address || typeof address === "string")
            throw new NativeBridgeError(503, "Local server is not ready.");
          authorizeNativeRequest(req, address.port, token);
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("X-Content-Type-Options", "nosniff");
          if (path === "/__remove/status" && req.method === "GET") {
            const ready =
              process.platform === "darwin" &&
              (await access(binary, constants.X_OK).then(
                () => true,
                () => false,
              ));
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                ready,
                token: ready ? token : null,
                engine: "cpp-vision-texture-1",
              }),
            );
            return;
          }
          if (path !== "/__remove/process" || req.method !== "POST")
            throw new NativeBridgeError(405, "Use a removal request.");
          if (req.headers["content-type"] !== "application/x-foto-remove")
            throw new NativeBridgeError(415, "Invalid removal request type.");
          if (Number(req.headers["content-length"]) > REMOVE_MAX_BYTES)
            throw new NativeBridgeError(413, "Removal image exceeds limits.");
          if (active >= 1)
            throw new NativeBridgeError(429, "Another removal is running. Try again shortly.");
          active++;
          claimed = true;
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            controller.signal.throwIfAborted();
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += bytes.length;
            if (size > REMOVE_MAX_BYTES)
              throw new NativeBridgeError(413, "Removal image exceeds limits.");
            chunks.push(bytes);
          }
          const packet = Buffer.concat(chunks),
            request = parseRemoveRequest(packet);
          const result = await runNativeRemove(binary, packet, controller.signal);
          controller.signal.throwIfAborted();
          res.setHeader(
            "Content-Type",
            request.operation ? "image/png" : "application/x-foto-instances",
          );
          res.setHeader("Content-Length", result.length);
          res.end(result);
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
                    : "Removal could not finish. Original and edits are unchanged.",
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
