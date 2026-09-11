/** Protected local-only C++ crop suggestions. Nothing is persisted or uploaded. */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import {
  AUTO_CROP_EDGE,
  AUTO_CROP_MAX_BYTES,
  autoCropResultSchema,
  type AutoCropResult,
} from "../lib/develop/auto-crop";
import { authorizeNativeRequest, NativeBridgeError } from "./native-studio-plugin";

export function parseCropRequest(bytes: Buffer) {
  if (
    bytes.length < 16 ||
    bytes.length > AUTO_CROP_MAX_BYTES ||
    bytes.readUInt32BE(0) !== 0x46433031
  )
    throw new NativeBridgeError(400, "Invalid crop packet.");
  const width = bytes.readUInt32BE(4),
    height = bytes.readUInt32BE(8),
    aspect = bytes.readFloatBE(12);
  if (
    width < 16 ||
    height < 16 ||
    width > AUTO_CROP_EDGE ||
    height > AUTO_CROP_EDGE ||
    bytes.length !== 16 + width * height * 4 ||
    !Number.isFinite(aspect) ||
    (aspect !== 0 && (aspect < 0.25 || aspect > 4))
  )
    throw new NativeBridgeError(400, "Invalid crop preview bounds.");
  return { width, height, aspect };
}

export function runNativeCrop(
  binary: string,
  packet: Buffer,
  signal: AbortSignal,
): Promise<AutoCropResult> {
  const request = parseCropRequest(packet);
  return new Promise((resolveResult, reject) => {
    if (signal.aborted) return reject(new NativeBridgeError(499, "Crop analysis cancelled."));
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    let size = 0,
      settled = false;
    const chunks: Buffer[] = [];
    const finish = (error?: Error, result?: AutoCropResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error || !result) {
        child.kill("SIGKILL");
        reject(error ?? new Error("Invalid crop result."));
      } else resolveResult(result);
    };
    const abort = () => finish(new NativeBridgeError(499, "Crop analysis cancelled."));
    const timer = setTimeout(
      () => finish(new NativeBridgeError(504, "Crop analysis timed out.")),
      10_000,
    );
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 16 * 1024) finish(new Error("Crop result exceeds bounds."));
      else chunks.push(chunk);
    });
    child.stderr.on("data", () => {});
    child.stdin.on("error", () => finish(new Error("Crop input stream closed.")));
    child.once("error", () => finish(new Error("The local C++ crop engine could not start.")));
    child.once("close", (code) => {
      try {
        if (code !== 0) throw new Error("Crop analysis failed.");
        const result = autoCropResultSchema.parse(
          JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(Buffer.concat(chunks))),
        );
        if (result.analysis.width !== request.width || result.analysis.height !== request.height)
          throw new Error("Crop preview mismatch.");
        finish(undefined, result);
      } catch {
        finish(new Error("Invalid crop analysis result."));
      }
    });
    child.stdin.end(packet);
  });
}

async function readCropBody(req: IncomingMessage, signal: AbortSignal): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    signal.throwIfAborted();
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > AUTO_CROP_MAX_BYTES)
      throw new NativeBridgeError(413, "Crop preview exceeds bounds.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

export function nativeCropPlugin(): Plugin {
  const token = randomBytes(32).toString("hex");
  let root = process.cwd(),
    active = 0;
  return {
    name: "foto-local-native-crop",
    apply: "serve",
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      const binary = resolve(root, "native/build/lenslabs-crop-suggest");
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0];
        if (path !== "/__crop/status" && path !== "/__crop/suggest") return next();
        const controller = new AbortController(),
          abort = () => controller.abort();
        req.once("aborted", abort);
        res.once("close", abort);
        const deadline = setTimeout(() => {
          controller.abort();
          if (!req.complete) req.destroy();
        }, 25_000);
        let claimed = false;
        try {
          const address = server.httpServer?.address();
          if (!address || typeof address === "string")
            throw new NativeBridgeError(503, "Local server is not ready.");
          authorizeNativeRequest(req, address.port, token);
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("X-Content-Type-Options", "nosniff");
          if (path === "/__crop/status" && req.method === "GET") {
            const ready = await access(binary, constants.X_OK).then(
              () => true,
              () => false,
            );
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                ready,
                token: ready ? token : null,
                engine: "cpp-crop-1",
                maxEdge: AUTO_CROP_EDGE,
              }),
            );
            return;
          }
          if (path !== "/__crop/suggest" || req.method !== "POST")
            throw new NativeBridgeError(405, "Use a crop suggestion request.");
          if (req.headers["content-type"] !== "application/x-foto-crop")
            throw new NativeBridgeError(415, "Invalid crop request type.");
          if (Number(req.headers["content-length"]) > AUTO_CROP_MAX_BYTES)
            throw new NativeBridgeError(413, "Crop preview exceeds bounds.");
          if (active >= 1)
            throw new NativeBridgeError(429, "A crop preview is already processing.");
          active++;
          claimed = true;
          const result = await runNativeCrop(
            binary,
            await readCropBody(req, controller.signal),
            controller.signal,
          );
          if (controller.signal.aborted) return;
          const receipt = Buffer.from(JSON.stringify(result));
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Content-Length", String(receipt.length));
          res.setHeader("X-Foto-Engine", "cpp-crop-1");
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
                    : "Crop analysis failed. Original and edits are unchanged.",
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
