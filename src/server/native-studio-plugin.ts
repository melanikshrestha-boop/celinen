/** Local development transport only. Image analysis and burst grouping run in C++.
 * There is intentionally no client-supplied filesystem path or network listener.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { access, mkdtemp, open, rmdir, stat, unlink } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { socialFrameSchema } from "../lib/social-frame";
import { runNativeSocial } from "./native-social";

export const MAX_NATIVE_FILE_BYTES = 128 * 1024 * 1024;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_BURST_BYTES = 24 * 1024 * 1024;
const MAX_PEOPLE_BYTES = 64 * 1024 * 1024;
const CACHE_BYTES = 64 * 1024 * 1024;
const PREFIX = "/__native/";

export class NativeBridgeError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const abortError = () => new NativeBridgeError(499, "Native job cancelled.");
const isLoopback = (value: string | undefined) =>
  value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1";
const containsControl = (value: string) =>
  [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

/** Reject LAN access, DNS rebinding, cross-site forms, and unauthenticated jobs. */
export function authorizeNativeRequest(req: IncomingMessage, port: number, token: string) {
  if (!isLoopback(req.socket.remoteAddress)) throw new NativeBridgeError(403, "Local access only.");
  const host = req.headers.host;
  const permitted = [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`];
  if (!host || !permitted.includes(host)) throw new NativeBridgeError(403, "Invalid local host.");
  if (req.headers["x-lenslabs-request"] !== "studio")
    throw new NativeBridgeError(403, "Studio request required.");
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none")
    throw new NativeBridgeError(403, "Same-origin request required.");
  if (req.method !== "GET") {
    if (req.method !== "POST" || req.headers.origin !== `http://${host}`)
      throw new NativeBridgeError(403, "Same-origin POST required.");
    const provided = req.headers["x-lenslabs-token"];
    if (
      typeof provided !== "string" ||
      !/^[a-f0-9]{64}$/.test(provided) ||
      provided.length !== token.length ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(token))
    )
      throw new NativeBridgeError(403, "Native session expired. Retry from Studio.");
  }
}

type Frame = { metadata: Record<string, unknown>; jpeg: Buffer };

/** One sequential protocol stream per process; a cancelled stream is never reused. */
export class NativeWorkerProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending: { resolve: (value: Frame) => void; reject: (error: Error) => void } | null =
    null;
  private buffer: Buffer = Buffer.alloc(0);
  private metadata: Record<string, unknown> | null = null;
  constructor(private binary: string) {}
  private fail(error: Error) {
    const pending = this.pending;
    this.pending = null;
    this.buffer = Buffer.alloc(0);
    this.metadata = null;
    const child = this.child;
    this.child = null;
    if (child) {
      child.kill("SIGTERM");
      const force = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 1000);
      force.unref();
      child.once("exit", () => clearTimeout(force));
    }
    pending?.reject(error);
  }
  close() {
    this.fail(abortError());
  }
  private start() {
    if (this.child) return this.child;
    const child = spawn(this.binary, ["worker"], { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    child.stderr.on("data", () => {
      /* Drain without logging private paths or image metadata. */
    });
    child.on("error", () => {
      if (this.child === child) this.fail(new Error("C++ worker could not start."));
    });
    child.on("exit", () => {
      if (this.child === child)
        this.fail(new Error("C++ worker stopped before completing the job."));
    });
    child.stdin.on("error", () => {
      if (this.child === child) this.fail(new Error("C++ input stream closed."));
    });
    child.stdout.on("data", (chunk: Buffer) => {
      if (this.child !== child) return;
      try {
        if (!this.pending) throw new Error("Unexpected C++ response.");
        if (this.buffer.length + chunk.length > MAX_FRAME_BYTES + MAX_HEADER_BYTES)
          throw new Error("C++ response exceeded its bound.");
        this.buffer = Buffer.concat([this.buffer, chunk]);
        if (!this.metadata) {
          const newline = this.buffer.indexOf(10);
          if (newline < 0) {
            if (this.buffer.length > MAX_HEADER_BYTES) throw new Error("C++ header is too large.");
            return;
          }
          if (newline > MAX_HEADER_BYTES) throw new Error("C++ header is too large.");
          const parsed: unknown = JSON.parse(this.buffer.subarray(0, newline).toString("utf8"));
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            throw new Error("Invalid C++ receipt.");
          this.metadata = parsed as Record<string, unknown>;
          this.buffer = this.buffer.subarray(newline + 1);
          const size = this.metadata["preview_bytes"];
          if (
            !Number.isSafeInteger(size) ||
            (size as number) < 0 ||
            (size as number) > MAX_FRAME_BYTES
          )
            throw new Error("Invalid C++ image size.");
        }
        const size = this.metadata["preview_bytes"] as number;
        if (this.buffer.length < size) return;
        if (this.buffer.length !== size) throw new Error("Extra C++ protocol bytes.");
        const pending = this.pending;
        const result = { metadata: this.metadata, jpeg: this.buffer };
        this.pending = null;
        this.metadata = null;
        this.buffer = Buffer.alloc(0);
        pending.resolve(result);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error("C++ protocol failure."));
      }
    });
    return child;
  }
  async run(path: string, signal: AbortSignal): Promise<Frame> {
    if (signal.aborted) throw abortError();
    if (this.pending) throw new Error("C++ worker is already occupied.");
    const child = this.start();
    const abort = () => this.fail(abortError());
    const timer = setTimeout(() => this.fail(new Error("C++ analysis timed out.")), 90_000);
    signal.addEventListener("abort", abort, { once: true });
    try {
      return await new Promise<Frame>((resolveFrame, reject) => {
        this.pending = { resolve: resolveFrame, reject };
        child.stdin.write(`LENS1 1280 ${Buffer.from(path).toString("hex")}\n`);
      });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }
}

export class NativeFrameCache {
  private values = new Map<string, Frame>();
  private bytes = 0;
  constructor(private limit = CACHE_BYTES) {}
  get(key: string) {
    const value = this.values.get(key);
    if (value) {
      this.values.delete(key);
      this.values.set(key, value);
    }
    return value;
  }
  set(key: string, frame: Frame) {
    const previous = this.values.get(key);
    if (previous) {
      this.bytes -= previous.jpeg.length;
      this.values.delete(key);
    }
    if (frame.jpeg.length > this.limit) return;
    this.values.set(key, frame);
    this.bytes += frame.jpeg.length;
    while (this.bytes > this.limit || this.values.size > 256) {
      const oldest = this.values.keys().next().value;
      if (oldest === undefined) break;
      this.bytes -= this.values.get(oldest)!.jpeg.length;
      this.values.delete(oldest);
    }
  }
  clear() {
    this.values.clear();
    this.bytes = 0;
  }
}

async function readBounded(req: IncomingMessage, limit: number, signal: AbortSignal) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of req) {
    if (signal.aborted) throw abortError();
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > limit) throw new NativeBridgeError(413, "Request exceeds the local job limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Validate and frame transport data only; all grouping/ranking is native C++. */
export function burstProtocol(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new NativeBridgeError(400, "Invalid burst request.");
  const frames = (value as Record<string, unknown>)["frames"];
  if (!Array.isArray(frames) || frames.length > 100_000)
    throw new NativeBridgeError(400, "Burst review accepts up to 100,000 receipts.");
  const ids = new Set<string>();
  let clockPartition: string | undefined;
  const hex = (text: string) => (text ? Buffer.from(text).toString("hex") : "-");
  const lines = frames.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new NativeBridgeError(400, "Invalid frame receipt.");
    const frame = item as Record<string, unknown>;
    const id = frame["id"],
      hash = frame["hash"],
      verdict = frame["verdict"];
    if (
      typeof id !== "string" ||
      !id ||
      Buffer.byteLength(id) > 512 ||
      containsControl(id) ||
      ids.has(id)
    )
      throw new NativeBridgeError(400, "Invalid or repeated frame identifier.");
    ids.add(id);
    if (typeof hash !== "string" || !/^(?:[01]{64}|[a-fA-F0-9]{16})$/.test(hash))
      throw new NativeBridgeError(400, "Invalid frame hash.");
    const hashHex = hash.length === 64 ? BigInt(`0b${hash}`).toString(16).padStart(16, "0") : hash;
    for (const [key, low, high] of [
      ["score", 0, 100],
      ["sharpness", 0, 1e9],
      ["brightness", 0, 255],
    ] as const) {
      const number = frame[key];
      if (typeof number !== "number" || !Number.isFinite(number) || number < low || number > high)
        throw new NativeBridgeError(400, `Invalid ${key}.`);
    }
    if (!["keep", "reject", "undecided"].includes(String(verdict)))
      throw new NativeBridgeError(400, "Invalid verdict.");
    const suppliedTime = frame["captureTimeMs"] ?? 0;
    if (
      typeof suppliedTime !== "number" ||
      !Number.isSafeInteger(suppliedTime) ||
      suppliedTime < 0 ||
      suppliedTime > 8.64e15
    )
      throw new NativeBridgeError(400, "Invalid camera capture time.");
    const basis = frame["captureTimeBasis"] ?? "unknown";
    if (!["utc", "camera_clock", "unknown"].includes(String(basis)))
      throw new NativeBridgeError(400, "Invalid camera clock basis.");
    if (clockPartition !== undefined && clockPartition !== basis)
      throw new NativeBridgeError(400, "Review different camera clock bases separately.");
    clockPartition = String(basis);
    // An unqualified timestamp is not evidence of a camera-timed burst.
    const captured = basis === "unknown" ? 0 : suppliedTime;
    const camera = frame["cameraKey"] ?? "";
    const relative = frame["relativePath"] ?? frame["name"] ?? "";
    if (
      typeof camera !== "string" ||
      Buffer.byteLength(camera) > 512 ||
      typeof relative !== "string" ||
      Buffer.byteLength(relative) > 4096 ||
      containsControl(camera + relative)
    )
      throw new NativeBridgeError(400, "Invalid camera or folder identity.");
    const folder = relative.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
    return `${hex(id)} ${hashHex} ${frame["score"]} ${frame["sharpness"]} ${frame["brightness"]} ${captured} ${hex(camera)} ${hex(folder)} ${verdict}`;
  });
  return `LENSBURST1 ${frames.length}\n${lines.join("\n")}${lines.length ? "\n" : ""}`;
}

export function insightfacePackFromEnv(): {
  dir: string;
  detector: boolean;
  recognizer: boolean;
  complete: boolean;
} {
  const dir = (process.env.FOTO_INSIGHTFACE_DIR ?? "").trim() || join(homedir(), ".foto/insightface");
  const detector = existsSync(join(dir, "det_10g.onnx"));
  const recognizer = existsSync(join(dir, "w600k_r50.onnx"));
  return { dir, detector, recognizer, complete: detector && recognizer };
}

/** Validate embeddings only; clustering executes in C++. Never downloads buffalo weights. */
export function peopleProtocol(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new NativeBridgeError(400, "Invalid people request.");
  const faces = (value as Record<string, unknown>)["faces"];
  if (!Array.isArray(faces) || faces.length > 20_000)
    throw new NativeBridgeError(400, "People matching accepts up to 20,000 observations.");
  const ids = new Set<string>();
  const hex = (text: string) => {
    if (!text || Buffer.byteLength(text) > 512 || containsControl(text))
      throw new NativeBridgeError(400, "Invalid face observation identity.");
    return Buffer.from(text).toString("hex");
  };
  const embedHex = (values: unknown) => {
    if (!Array.isArray(values) || values.length !== 512)
      throw new NativeBridgeError(400, "InsightFace embeddings are 512-d.");
    const buf = Buffer.alloc(2048);
    for (let i = 0; i < 512; i++) {
      const n = values[i];
      if (typeof n !== "number" || !Number.isFinite(n))
        throw new NativeBridgeError(400, "Invalid embedding component.");
      buf.writeFloatLE(n, i * 4);
    }
    return buf.toString("hex");
  };
  const lines = faces.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new NativeBridgeError(400, "Invalid face observation.");
    const face = item as Record<string, unknown>;
    const id = face["id"];
    const frameId = face["frameId"];
    const source = face["source"];
    const detScore = face["detScore"];
    if (typeof id !== "string" || ids.has(id))
      throw new NativeBridgeError(400, "Invalid or repeated face observation.");
    ids.add(id);
    if (typeof frameId !== "string" || !frameId)
      throw new NativeBridgeError(400, "Invalid frame identifier.");
    if (source !== "insightface" && source !== "local-descriptor")
      throw new NativeBridgeError(400, "Unknown embedding source.");
    if (typeof detScore !== "number" || !Number.isFinite(detScore) || detScore < 0 || detScore > 1)
      throw new NativeBridgeError(400, "Invalid detection score.");
    return `${hex(id)} ${hex(frameId)} ${source} ${detScore} ${embedHex(face["embedding"])}`;
  });
  return `LENSPPL1 ${faces.length}\n${lines.join("\n")}${lines.length ? "\n" : ""}`;
}

function runBursts(binary: string, input: string, signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolveOutput, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) {
        child.kill("SIGKILL");
        reject(error);
      } else resolveOutput(Buffer.concat(chunks));
    };
    const abort = () => finish(abortError());
    const timer = setTimeout(() => finish(new Error("C++ grouping timed out.")), 30_000);
    signal.addEventListener("abort", abort, { once: true });
    child.stderr.on("data", () => {});
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BURST_BYTES) finish(new Error("C++ grouping receipt is too large."));
      else chunks.push(chunk);
    });
    child.on("error", () => finish(new Error("C++ grouping could not start.")));
    child.stdin.on("error", () => finish(new Error("C++ grouping input was rejected.")));
    child.on("close", (code) =>
      finish(
        code === 0
          ? undefined
          : new NativeBridgeError(400, "C++ grouping rejected these receipts."),
      ),
    );
    child.stdin.end(input);
  });
}

function runPeople(binary: string, input: string, signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolveOutput, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) {
        child.kill("SIGKILL");
        reject(error);
      } else resolveOutput(Buffer.concat(chunks));
    };
    const abort = () => finish(abortError());
    const timer = setTimeout(() => finish(new Error("C++ people matching timed out.")), 60_000);
    signal.addEventListener("abort", abort, { once: true });
    child.stderr.on("data", () => {});
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_PEOPLE_BYTES) finish(new Error("C++ people receipt is too large."));
      else chunks.push(chunk);
    });
    child.on("error", () => finish(new Error("C++ people matching could not start.")));
    child.stdin.on("error", () => finish(new Error("C++ people matching input was rejected.")));
    child.on("close", (code) =>
      finish(
        code === 0
          ? undefined
          : new NativeBridgeError(400, "C++ people matching rejected these observations."),
      ),
    );
    child.stdin.end(input);
  });
}

const sendJson = (res: ServerResponse, status: number, value: unknown) => {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
};

export function nativeStudioPlugin(): Plugin {
  let cleanup = () => {};
  return {
    name: "lenslabs-local-native-transport",
    apply: "serve",
    configureServer(server) {
      const binary = resolve(server.config.root, "native/build/lenslabs-native");
      const burstBinary = resolve(server.config.root, "native/build/lenslabs-bursts");
      const peopleBinary = resolve(server.config.root, "native/build/lenslabs-people");
      const socialBinary = resolve(server.config.root, "native/build/lenslabs-social");
      const token = randomBytes(32).toString("hex");
      const workers = Array.from({ length: 4 }, () => ({
        process: new NativeWorkerProcess(binary),
        busy: false,
        binaryIdentity: "",
      }));
      const cache = new NativeFrameCache();
      let burstBusy = false;
      let peopleBusy = false;
      let socialBusy = false;
      cleanup = () => {
        for (const worker of workers) worker.process.close();
        cache.clear();
      };
      server.httpServer?.once("close", cleanup);
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(PREFIX)) {
          next();
          return;
        }
        const controller = new AbortController();
        req.once("aborted", () => controller.abort());
        res.once("close", () => {
          if (!res.writableEnded) controller.abort();
        });
        const signal = controller.signal;
        void (async () => {
          const address = server.httpServer?.address();
          const port = address && typeof address !== "string" ? address.port : 0;
          authorizeNativeRequest(req, port, token);
          const route = req.url?.split("?")[0];
          let ready = process.platform === "darwin";
          try {
            await access(binary, constants.X_OK);
          } catch {
            ready = false;
          }
          if (route === "/__native/status" && req.method === "GET") {
            const socialReady =
              ready &&
              (await access(socialBinary, constants.X_OK).then(
                () => true,
                () => false,
              ));
            const peopleReady =
              ready &&
              (await access(peopleBinary, constants.X_OK).then(
                () => true,
                () => false,
              ));
            sendJson(res, 200, {
              ready,
              socialReady,
              peopleReady,
              insightfacePack: insightfacePackFromEnv(),
              token: ready ? token : null,
              engine: "lenslabs-cpp-0.1",
              maxFileBytes: MAX_NATIVE_FILE_BYTES,
            });
            return;
          }
          if (!ready)
            throw new NativeBridgeError(
              503,
              "Build the local C++ engine with make -C native first.",
            );
          if (req.method !== "POST") throw new NativeBridgeError(405, "POST required.");
          if (route === "/__native/social-frame") {
            if (req.headers["content-type"] !== "application/octet-stream")
              throw new NativeBridgeError(415, "Photo bytes required.");
            const raw = req.headers["x-lenslabs-frame"];
            let input;
            try {
              input = socialFrameSchema.parse(
                JSON.parse(typeof raw === "string" && raw.length < 1024 ? raw : "null"),
              );
            } catch {
              throw new NativeBridgeError(400, "Invalid social frame settings.");
            }
            if (socialBusy)
              throw new NativeBridgeError(429, "Another social photo is preparing. Retry shortly.");
            socialBusy = true;
            let directory: string | null = null;
            let path: string | null = null;
            try {
              const bytes = await readBounded(req, 16 * 1024 * 1024, signal);
              if (!bytes.length) throw new NativeBridgeError(400, "The photo is empty.");
              directory = await mkdtemp(join(tmpdir(), "lenslabs-social-"));
              path = join(directory, "source");
              const file = await open(path, "wx", 0o600);
              try {
                await file.writeFile(bytes);
              } finally {
                await file.close();
              }
              const jpeg = await runNativeSocial(socialBinary, path, input, signal);
              if (signal.aborted) throw abortError();
              res.writeHead(200, {
                "Content-Type": "image/jpeg",
                "Content-Length": jpeg.length,
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "X-Celinen-Engine": "cpp",
              });
              res.end(jpeg);
            } finally {
              if (path) await unlink(path).catch(() => {});
              if (directory) await rmdir(directory).catch(() => {});
              socialBusy = false;
            }
            return;
          }
          if (route === "/__native/bursts") {
            if (req.headers["content-type"] !== "application/json")
              throw new NativeBridgeError(415, "JSON receipts required.");
            if (burstBusy)
              throw new NativeBridgeError(
                429,
                "Another burst review is running. Try again shortly.",
              );
            burstBusy = true;
            try {
              const body = await readBounded(req, MAX_BURST_BYTES, signal);
              let parsed: unknown;
              try {
                parsed = JSON.parse(body.toString("utf8"));
              } catch {
                throw new NativeBridgeError(400, "Invalid JSON receipts.");
              }
              const output = await runBursts(burstBinary, burstProtocol(parsed), signal);
              if (signal.aborted) throw abortError();
              res.writeHead(200, {
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
                "X-Celinen-Engine": "cpp",
              });
              res.end(output);
            } finally {
              burstBusy = false;
            }
            return;
          }
          if (route === "/__native/people") {
            if (req.headers["content-type"] !== "application/json")
              throw new NativeBridgeError(415, "JSON observations required.");
            const peopleOk = await access(peopleBinary, constants.X_OK).then(
              () => true,
              () => false,
            );
            if (!peopleOk)
              throw new NativeBridgeError(
                503,
                "Build the local C++ people engine with make -C native first.",
              );
            if (peopleBusy)
              throw new NativeBridgeError(
                429,
                "Another people-matching job is running. Try again shortly.",
              );
            peopleBusy = true;
            try {
              const body = await readBounded(req, MAX_PEOPLE_BYTES, signal);
              let parsed: unknown;
              try {
                parsed = JSON.parse(body.toString("utf8"));
              } catch {
                throw new NativeBridgeError(400, "Invalid JSON observations.");
              }
              const output = await runPeople(peopleBinary, peopleProtocol(parsed), signal);
              if (signal.aborted) throw abortError();
              res.writeHead(200, {
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
                "X-Celinen-Engine": "cpp",
              });
              res.end(output);
            } finally {
              peopleBusy = false;
            }
            return;
          }
          if (route !== "/__native/analyze")
            throw new NativeBridgeError(404, "Native operation not found.");
          if (req.headers["content-type"] !== "application/octet-stream")
            throw new NativeBridgeError(415, "Photo bytes required.");
          const declared = Number(req.headers["content-length"]);
          if (Number.isFinite(declared) && declared > MAX_NATIVE_FILE_BYTES)
            throw new NativeBridgeError(413, "Native source limit is 128 MiB per photo.");
          const lane = workers.find((worker) => !worker.busy);
          if (!lane)
            throw new NativeBridgeError(429, "Native workers are busy. Try again shortly.");
          lane.busy = true;
          let directory: string | null = null;
          let path: string | null = null;
          try {
            directory = await mkdtemp(join(tmpdir(), "lenslabs-native-upload-"));
            path = join(directory, "source");
            const file = await open(path, "wx", 0o600);
            const hash = createHash("sha256");
            let bytes = 0;
            try {
              for await (const value of req) {
                if (signal.aborted) throw abortError();
                const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
                bytes += chunk.length;
                if (bytes > MAX_NATIVE_FILE_BYTES)
                  throw new NativeBridgeError(413, "Native source limit is 128 MiB per photo.");
                hash.update(chunk);
                let offset = 0;
                while (offset < chunk.length) {
                  const written = await file.write(chunk, offset, chunk.length - offset);
                  if (!written.bytesWritten) throw new Error("Could not spool the local photo.");
                  offset += written.bytesWritten;
                }
              }
            } finally {
              await file.close();
            }
            if (signal.aborted) throw abortError();
            if (!bytes) throw new NativeBridgeError(400, "The photo is empty.");
            const executable = await stat(binary, { bigint: true });
            const identity = `${executable.ino}:${executable.size}:${executable.mtimeNs}:${executable.ctimeNs}`;
            if (lane.binaryIdentity !== identity) {
              lane.process.close();
              lane.binaryIdentity = identity;
            }
            const key = `cpp-0.1:${identity}:1280:${hash.digest("hex")}`;
            const cached = cache.get(key);
            const frame = cached ?? (await lane.process.run(path, signal));
            if (signal.aborted) throw abortError();
            if (frame.metadata["ok"] !== true)
              throw new NativeBridgeError(
                422,
                "The C++ decoder could not read this photo. Its source was not changed.",
              );
            if (!cached) cache.set(key, frame);
            const header = Buffer.from(
              JSON.stringify({ ...frame.metadata, cached: Boolean(cached) }) + "\n",
            );
            res.writeHead(200, {
              "Content-Type": "application/x-lenslabs-frame",
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
              "X-Celinen-Engine": "cpp",
              "Content-Length": header.length + frame.jpeg.length,
            });
            res.write(header);
            res.end(frame.jpeg);
          } finally {
            // Remove only the two exact disposable paths created by this request.
            if (path) await unlink(path).catch(() => {});
            if (directory) await rmdir(directory).catch(() => {});
            lane.busy = false;
          }
        })().catch((error: unknown) => {
          sendJson(res, error instanceof NativeBridgeError ? error.status : 500, {
            error:
              error instanceof NativeBridgeError
                ? error.message
                : "Native processing failed; retry the job. Originals remain unchanged.",
          });
        });
      });
    },
    closeBundle() {
      cleanup();
    },
  };
}
