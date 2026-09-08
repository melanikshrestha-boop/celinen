/** Local-only transport. All image processing happens in the C++ executable. */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdtemp, open, rmdir, unlink } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { z } from "zod";
import {
  DEVELOP_ENGINE_LIMITS,
  developSettingsSchema,
  developSourceModeSchema,
  type DevelopSourceMode,
  type DevelopSettings,
} from "../lib/develop/contract";
import { authorizeNativeRequest, NativeBridgeError } from "./native-studio-plugin";

const MAX_HEADER = 64 * 1024;
const MAX_RESULT = 32 * 1024 * 1024;
const requestSchema = z
  .object({
    settings: developSettingsSchema,
    edge: z.number().int().min(32).max(4096),
    quality: z.number().finite().min(0.5).max(1),
    sourceMode: developSourceModeSchema.default("preview"),
  })
  .strict();
export function developProtocol(input: DevelopSettings): string {
  const s = developSettingsSchema.parse(input),
    c = s.crop;
  const lines: Array<string | number[]> = [
    "FOTO_DEVELOP_1",
    [
      s.exposure,
      s.contrast,
      s.highlights,
      s.shadows,
      s.whites,
      s.blacks,
      s.temperature,
      s.tint,
      s.saturation,
      s.vibrance,
      s.texture,
      s.clarity,
      s.dehaze,
    ],
    [s.curve.length],
    ...s.curve.map((p) => [p.x, p.y]),
    ...s.hsl.map((h) => [h.hue, h.saturation, h.luminance]),
    ...[s.grading.shadows, s.grading.midtones, s.grading.highlights].map((g) => [
      g.hue,
      g.saturation,
      g.luminance,
    ]),
    [
      s.grading.balance,
      s.grading.blending,
      s.grain,
      s.grainSize,
      s.fade,
      s.vignette,
      s.bloom,
      s.halation,
      s.sharpening,
      s.noiseReduction,
      s.colorNoiseReduction,
    ],
    [c.x, c.y, c.width, c.height, c.angle, c.rotate, Number(c.flipX), Number(c.flipY)],
    [s.masks.length],
    ...s.masks.map((m) => [
      Number(m.type === "radial"),
      Number(m.enabled),
      m.x,
      m.y,
      m.radius,
      m.aspect,
      m.angle,
      m.feather,
      Number(m.invert),
      m.exposure,
      m.temperature,
      m.saturation,
    ]),
  ];
  return lines.map((l) => (typeof l === "string" ? l : l.join(" "))).join("\n") + "\n";
}
export function parseDevelopRequest(bytes: Buffer) {
  if (bytes.length < 8) throw new NativeBridgeError(400, "Develop request is incomplete.");
  const size = bytes.readUInt32BE(0);
  if (!size || size > MAX_HEADER || size + 4 >= bytes.length)
    throw new NativeBridgeError(400, "Invalid Develop settings size.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf8", { fatal: true }).decode(bytes.subarray(4, 4 + size)),
    );
  } catch {
    throw new NativeBridgeError(400, "Develop settings are invalid.");
  }
  const request = requestSchema.safeParse(parsed);
  if (!request.success)
    throw new NativeBridgeError(400, "Develop settings are outside their allowed ranges.");
  const source = bytes.subarray(4 + size);
  if (source.length > DEVELOP_ENGINE_LIMITS.maxFileBytes)
    throw new NativeBridgeError(413, "Choose a photo under 128 MiB.");
  return { ...request.data, source };
}
export function runNativeDevelop(
  binary: string,
  source: string,
  settings: DevelopSettings,
  edge: number,
  quality: number,
  signal: AbortSignal,
  sourceMode: DevelopSourceMode = "preview",
): Promise<Buffer> {
  const request = requestSchema.parse({ settings, edge, quality, sourceMode });
  return new Promise((resolveResult, reject) => {
    if (signal.aborted) return reject(new NativeBridgeError(499, "Develop cancelled."));
    const child = spawn(
      binary,
      [source, String(request.edge), String(request.quality), request.sourceMode],
      {
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const chunks: Buffer[] = [];
    let size = 0,
      settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) {
        child.kill("SIGKILL");
        reject(error);
      } else resolveResult(Buffer.concat(chunks));
    };
    const abort = () => finish(new NativeBridgeError(499, "Develop cancelled."));
    const timer = setTimeout(
      () =>
        finish(
          new NativeBridgeError(504, "Develop processing took too long. Try a smaller export."),
        ),
      60000,
    );
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_RESULT) finish(new NativeBridgeError(413, "Develop export exceeds 32 MiB."));
      else chunks.push(chunk);
    });
    child.stderr.on("data", () => {});
    child.stdin.on("error", () => finish(new Error("Develop input stream closed.")));
    child.once("error", () => finish(new Error("The local C++ Develop engine could not start.")));
    child.once("close", (code) => {
      const jpeg = Buffer.concat(chunks);
      finish(
        code === 0 &&
          size > 4 &&
          jpeg[0] === 255 &&
          jpeg[1] === 216 &&
          jpeg.at(-2) === 255 &&
          jpeg.at(-1) === 217
          ? undefined
          : new Error("This photo could not be developed. Its source is unchanged."),
      );
    });
    child.stdin.end(developProtocol(request.settings));
  });
}
async function readBody(req: IncomingMessage, signal: AbortSignal): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    if (signal.aborted) throw new NativeBridgeError(499, "Develop cancelled.");
    const bytes: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > DEVELOP_ENGINE_LIMITS.maxFileBytes + MAX_HEADER + 4)
      throw new NativeBridgeError(413, "Choose a photo under 128 MiB.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
export function nativeDevelopPlugin(): Plugin {
  const token = randomBytes(32).toString("hex");
  let root = process.cwd(),
    active = 0,
    rawActive = 0;
  return {
    name: "foto-local-native-develop",
    apply: "serve",
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      const binary = resolve(root, "native/build/lenslabs-develop");
      server.middlewares.use(async (req, res, next) => {
        const pathname = req.url?.split("?")[0];
        if (pathname !== "/__develop/status" && pathname !== "/__develop/render") return next();
        const controller = new AbortController();
        const abort = () => controller.abort();
        req.once("aborted", abort);
        res.once("close", abort);
        const deadline = setTimeout(() => {
          controller.abort();
          // Bound a stalled upload as well as native execution. No request can reserve a lane forever.
          if (!req.complete) req.destroy();
        }, 90_000);
        let directory: string | null = null,
          file: string | null = null,
          claimed = false,
          claimedRaw = false;
        try {
          const address = server.httpServer?.address();
          if (!address || typeof address === "string")
            throw new NativeBridgeError(503, "Local server is not ready.");
          authorizeNativeRequest(req, address.port, token);
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("X-Content-Type-Options", "nosniff");
          if (pathname === "/__develop/status" && req.method === "GET") {
            let ready = true;
            try {
              await access(binary, constants.X_OK);
            } catch {
              ready = false;
            }
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                ready,
                token: ready ? token : null,
                engine: "foto-develop-cpp-1",
                maxEdge: 4096,
                maxFileBytes: DEVELOP_ENGINE_LIMITS.maxFileBytes,
                workingSpace: "sRGB preview",
                rawSupported: true,
                maxRawSensorPixels: DEVELOP_ENGINE_LIMITS.maxRawSensorPixels,
              }),
            );
            return;
          }
          if (pathname !== "/__develop/render" || req.method !== "POST")
            throw new NativeBridgeError(405, "Use a Develop render request.");
          if (req.headers["content-type"] !== "application/x-foto-develop")
            throw new NativeBridgeError(415, "Invalid Develop request type.");
          const declared = Number(req.headers["content-length"]);
          if (
            Number.isFinite(declared) &&
            declared > DEVELOP_ENGINE_LIMITS.maxFileBytes + MAX_HEADER + 4
          )
            throw new NativeBridgeError(413, "Choose a photo under 128 MiB.");
          if (active >= 2)
            throw new NativeBridgeError(
              429,
              "Two Develop images are processing. Please retry shortly.",
            );
          active++;
          claimed = true;
          const request = parseDevelopRequest(await readBody(req, controller.signal));
          if (request.sourceMode === "raw") {
            if (rawActive >= 1)
              throw new NativeBridgeError(
                429,
                "A sensor RAW image is processing. Please retry when it finishes.",
              );
            rawActive++;
            claimedRaw = true;
          }
          directory = await mkdtemp(join(tmpdir(), "foto-develop-"));
          file = join(directory, "source.photo");
          const handle = await open(file, "wx", 0o600);
          try {
            await handle.writeFile(request.source);
          } finally {
            await handle.close();
          }
          const result = await runNativeDevelop(
            binary,
            file,
            request.settings,
            request.edge,
            request.quality,
            controller.signal,
            request.sourceMode,
          );
          if (controller.signal.aborted) return;
          res.setHeader("Content-Type", "image/jpeg");
          res.setHeader("Content-Length", String(result.length));
          res.setHeader("X-Foto-Engine", "cpp-develop-1");
          res.setHeader("X-Foto-Source", request.sourceMode === "raw" ? "raw-demosaic" : "preview");
          res.end(result);
        } catch (error) {
          if (!res.destroyed && !res.writableEnded) {
            res.statusCode = error instanceof NativeBridgeError ? error.status : 500;
            // A rejected POST may still have unread bytes. Do not reuse that HTTP stream.
            res.setHeader("Connection", "close");
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                error:
                  error instanceof NativeBridgeError
                    ? error.message
                    : "This photo could not be developed. Its source is unchanged.",
              }),
            );
          }
        } finally {
          clearTimeout(deadline);
          if (claimed) active--;
          if (claimedRaw) rawActive--;
          req.removeListener("aborted", abort);
          res.removeListener("close", abort);
          if (file) await unlink(file).catch(() => {});
          if (directory) await rmdir(directory).catch(() => {});
        }
      });
    },
  };
}
