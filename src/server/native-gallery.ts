/** Local C++ gallery hearts index. No persistence, no network. */
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { decodeGalleryIndex, indexGalleryHeartsLocal } from "../lib/gallery-index";
import { NativeBridgeError } from "./native-studio-plugin";

const MAX_INPUT = 32 * 1024 * 1024;
const MAX_OUTPUT = 16 * 1024 * 1024;

function isLoopback(address?: string | null) {
  return address === "127.0.0.1" || address === "::1" || address === ":ffff:127.0.0.1";
}

function readBody(req: IncomingMessage, signal: AbortSignal) {
  return new Promise<Buffer>((done, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_INPUT) fail(new NativeBridgeError(413, "Gallery index is too large."));
      else chunks.push(chunk);
    });
    req.once("end", () => done(Buffer.concat(chunks)));
    req.once("error", fail);
    signal.addEventListener("abort", () => fail(new NativeBridgeError(499, "Gallery index cancelled.")), {
      once: true,
    });
  });
}

export function runNativeGallery(binary: string, packet: Buffer, signal: AbortSignal) {
  return new Promise<Buffer>((resolveResult, reject) => {
    if (signal.aborted) return reject(new NativeBridgeError(499, "Gallery index cancelled."));
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
        reject(error ?? new NativeBridgeError(502, "Gallery engine returned an invalid result."));
      } else resolveResult(result);
    };
    const abort = () => finish(new NativeBridgeError(499, "Gallery index cancelled."));
    const timer = setTimeout(() => finish(new NativeBridgeError(504, "Gallery index timed out.")), 8000);
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT) finish(new NativeBridgeError(502, "Gallery result exceeds limits."));
      else chunks.push(chunk);
    });
    child.stderr.on("data", () => {});
    child.once("error", () =>
      finish(
        new NativeBridgeError(
          503,
          "Local C++ gallery engine is unavailable. Build native/build/lenslabs-gallery first.",
        ),
      ),
    );
    child.once("close", (code) => {
      if (settled) return;
      if (code !== 0) finish(new NativeBridgeError(422, "The C++ gallery engine rejected this index."));
      else finish(undefined, Buffer.concat(chunks));
    });
    child.stdin.end(packet);
  });
}

export function nativeGalleryPlugin(): Plugin {
  let root = process.cwd();
  return {
    name: "celinen-local-cpp-gallery",
    apply: "serve",
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      const binary = resolve(root, "native/build/lenslabs-gallery");
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0];
        if (path !== "/__native/gallery-index" && path !== "/__native/gallery-index/status")
          return next();
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
          if (path === "/__native/gallery-index/status") {
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ready, engine: "lenslabs-gallery-1" }));
            return;
          }
          if (req.method !== "POST") throw new NativeBridgeError(405, "POST required.");
          const packet = await readBody(req, controller.signal);
          const out = ready
            ? await runNativeGallery(binary, packet, controller.signal)
            : encodeResult(indexGalleryHeartsLocal(decodeGalleryIndexRequest(packet)));
          decodeGalleryIndex(out);
          res.statusCode = 200;
          res.setHeader("content-type", "application/octet-stream");
          res.end(out);
        } catch (error) {
          res.statusCode = error instanceof NativeBridgeError ? error.status : 500;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : "Gallery index failed.",
            }),
          );
        }
      });
    },
  };
}

function decodeGalleryIndexRequest(packet: Buffer) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (packet.length < 20 || view.getUint32(0) !== 0x47494458 || view.getUint32(4) !== 1)
    throw new NativeBridgeError(400, "Invalid gallery packet.");
  let offset = 8;
  const readText = (max: number) => {
    const length = view.getUint16(offset);
    offset += 2;
    if (!length || offset + length > packet.length)
      throw new NativeBridgeError(400, "Invalid gallery field.");
    const text = new TextDecoder().decode(packet.subarray(offset, offset + length));
    offset += length;
    if (text.length > max) throw new NativeBridgeError(400, "Invalid gallery field.");
    return text;
  };
  const photos: { id: string; name: string }[] = [];
  const photoCount = view.getUint32(offset);
  offset += 4;
  for (let i = 0; i < photoCount; i++) photos.push({ id: readText(80), name: readText(255) });
  const hearts: string[] = [];
  const heartCount = view.getUint32(offset);
  offset += 4;
  for (let i = 0; i < heartCount; i++) hearts.push(readText(80));
  const edited: string[] = [];
  const editedCount = view.getUint32(offset);
  offset += 4;
  for (let i = 0; i < editedCount; i++) edited.push(readText(255));
  return { photos, hearts, edited };
}

function encodeResult(result: ReturnType<typeof indexGalleryHeartsLocal>) {
  const encoder = new TextEncoder();
  const texts: Uint8Array[] = [];
  let size = 20;
  const push = (value: string) => {
    const bytes = encoder.encode(value);
    texts.push(bytes);
    size += 2 + bytes.length;
  };
  for (const id of result.favorites) push(id);
  for (const match of result.matches) {
    push(match.photoId);
    push(match.editedName);
  }
  for (const id of result.missing) push(id);
  const packet = new Uint8Array(size);
  const view = new DataView(packet.buffer);
  let offset = 0;
  view.setUint32(offset, 0x474f5554);
  offset += 4;
  view.setUint32(offset, 1);
  offset += 4;
  view.setUint32(offset, result.favorites.length);
  offset += 4;
  let i = 0;
  const write = () => {
    const bytes = texts[i++]!;
    view.setUint16(offset, bytes.length);
    offset += 2;
    packet.set(bytes, offset);
    offset += bytes.length;
  };
  for (const id of result.favorites) {
    void id;
    write();
  }
  view.setUint32(offset, result.matches.length);
  offset += 4;
  for (const match of result.matches) {
    void match;
    write();
    write();
  }
  view.setUint32(offset, result.missing.length);
  offset += 4;
  for (const id of result.missing) {
    void id;
    write();
  }
  return Buffer.from(packet);
}
