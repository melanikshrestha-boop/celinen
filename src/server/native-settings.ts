/** Local C++ settings usage tally. No persistence, no network. */
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import {
  decodeSettingsUsage,
  tallySettingsUsageLocal,
  type SettingsUsagePhoto,
} from "../lib/settings-usage";
import { NativeBridgeError } from "./native-studio-plugin";

const MAX_INPUT = 2 * 1024 * 1024;
const MAX_OUTPUT = 64;
const RESULT_MAGIC = 0x53524553;
const VERSION = 1;

function isLoopback(address?: string | null) {
  return address === "127.0.0.1" || address === "::1" || address === ":ffff:127.0.0.1";
}

function readBody(req: IncomingMessage, signal: AbortSignal) {
  return new Promise<Buffer>((done, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_INPUT) fail(new NativeBridgeError(413, "Settings tally is too large."));
      else chunks.push(chunk);
    });
    req.once("end", () => done(Buffer.concat(chunks)));
    req.once("error", fail);
    signal.addEventListener("abort", () => fail(new NativeBridgeError(499, "Settings tally cancelled.")), {
      once: true,
    });
  });
}

export function runNativeSettings(binary: string, packet: Buffer, signal: AbortSignal) {
  return new Promise<Buffer>((resolveResult, reject) => {
    if (signal.aborted) return reject(new NativeBridgeError(499, "Settings tally cancelled."));
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"], shell: false });
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
        reject(error ?? new NativeBridgeError(502, "Settings engine returned an invalid result."));
      } else resolveResult(result);
    };
    const abort = () => finish(new NativeBridgeError(499, "Settings tally cancelled."));
    const timer = setTimeout(() => finish(new NativeBridgeError(504, "Settings tally timed out.")), 4000);
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT) finish(new NativeBridgeError(502, "Settings result exceeds limits."));
      else chunks.push(chunk);
    });
    child.stderr.on("data", () => {});
    child.once("error", () =>
      finish(
        new NativeBridgeError(
          503,
          "Local C++ settings engine is unavailable. Build native/build/lenslabs-settings first.",
        ),
      ),
    );
    child.once("close", (code) => {
      if (settled) return;
      if (code !== 0) finish(new NativeBridgeError(422, "The C++ settings engine rejected this tally."));
      else finish(undefined, Buffer.concat(chunks));
    });
    child.stdin.end(packet);
  });
}

function decodeSettingsRequest(packet: Buffer): SettingsUsagePhoto[] {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (packet.length < 12 || view.getUint32(0) !== 0x53455454 || view.getUint32(4) !== 1)
    throw new NativeBridgeError(400, "Invalid settings packet.");
  let offset = 8;
  const count = view.getUint32(offset);
  offset += 4;
  if (count > 200_000 || packet.length !== 12 + count * 9)
    throw new NativeBridgeError(400, "Invalid settings packet.");
  const photos: SettingsUsagePhoto[] = [];
  for (let i = 0; i < count; i++) {
    const high = view.getUint32(offset);
    const low = view.getUint32(offset + 4);
    offset += 8;
    const flag = packet[offset++];
    if (flag !== 0 && flag !== 1) throw new NativeBridgeError(400, "Invalid settings kept flag.");
    photos.push({ bytes: high * 0x1_0000_0000 + low, kept: flag === 1 });
  }
  return photos;
}

export function nativeSettingsPlugin(): Plugin {
  let root = process.cwd();
  return {
    name: "celinen-local-cpp-settings",
    apply: "serve",
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      const binary = resolve(root, "native/build/lenslabs-settings");
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0];
        if (path !== "/__settings/usage" && path !== "/__settings/usage/status") return next();
        const controller = new AbortController();
        req.once("aborted", () => controller.abort());
        res.once("close", () => controller.abort());
        res.setHeader("Cache-Control", "no-store");
        try {
          if (!isLoopback(req.socket.remoteAddress)) throw new NativeBridgeError(403, "Local access only.");
          let ready = process.platform === "darwin";
          try {
            await access(binary, constants.X_OK);
          } catch {
            ready = false;
          }
          if (path === "/__settings/usage/status") {
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ready, engine: "lenslabs-settings-1" }));
            return;
          }
          if (req.method !== "POST") throw new NativeBridgeError(405, "POST required.");
          const packet = await readBody(req, controller.signal);
          const out = ready
            ? await runNativeSettings(binary, packet, controller.signal)
            : Buffer.from(encodeResult(tallySettingsUsageLocal(decodeSettingsRequest(packet))));
          decodeSettingsUsage(out);
          res.statusCode = 200;
          res.setHeader("content-type", "application/octet-stream");
          res.end(out);
        } catch (error) {
          res.statusCode = error instanceof NativeBridgeError ? error.status : 500;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : "Settings tally failed.",
            }),
          );
        }
      });
    },
  };
}

function encodeResult(result: ReturnType<typeof tallySettingsUsageLocal>) {
  const packet = new Uint8Array(32);
  const view = new DataView(packet.buffer);
  view.setUint32(0, RESULT_MAGIC);
  view.setUint32(4, VERSION);
  view.setUint32(8, result.photos);
  view.setUint32(12, result.kept);
  const put64 = (offset: number, value: number) => {
    view.setUint32(offset, Math.floor(value / 0x1_0000_0000));
    view.setUint32(offset + 4, value >>> 0);
  };
  put64(16, result.totalBytes);
  put64(24, result.averageBytes);
  return packet;
}
