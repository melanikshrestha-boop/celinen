// Use Node, as Vite does. Bun's HTTP server does not reproduce the same
// response-close notification when its fetch client aborts an uploaded body.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import {
  developEngineStatus,
  encodeDevelopRequest,
  renderDevelop,
} from "../src/lib/develop/client";
import { defaultDevelopSettings } from "../src/lib/develop/contract";
import { jpegDimensions } from "../src/lib/delivery/media-integrity";
import { nativeDevelopPlugin } from "../src/server/native-develop";
import { generatedBayerDng } from "./fixtures/generated-bayer";

const rawDirectory = process.env["LENSLABS_RAW_FIXTURES"];
const binary = resolve("native/build/lenslabs-develop");
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function run() {
  assert(
    process.platform === "darwin" && existsSync(binary) && rawDirectory,
    "Public RAW/native fixture unavailable",
  );
  const rawPath = join(rawDirectory!, "sony-a6000.ARW");
  const jpegPath = resolve("tests/fixtures/photos/volleyball-portrait-cc0.jpg");
  const raw = readFileSync(rawPath),
    photo = readFileSync(jpegPath);
  assert.equal(digest(raw), "ce8b4957281a817d52a07a691e2468567b6c78223bd0b514ffc1c65b002b8d89");
  assert.equal(digest(photo), "5685e8468969ca05da9de250f5848df5318e6b47b1a14d4aebd5c19675224fce");

  let handler!: (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>;
  let markBlockerUploaded: (() => void) | undefined;
  let blockerClosedAt = 0,
    blockerSettledAt = 0;
  const server = createServer((req, res) => {
    const isBlocker = req.headers["x-foto-qa-blocker"] === "1";
    if (isBlocker) {
      req.once("end", () => markBlockerUploaded?.());
      res.once("close", () => {
        blockerClosedAt = performance.now();
      });
    }
    void handler(req, res, () => {
      res.statusCode = 404;
      res.end();
    }).finally(() => {
      if (isBlocker) blockerSettledAt = performance.now();
    });
  });
  (nativeDevelopPlugin().configureServer as (value: unknown) => void)({
    httpServer: server,
    middlewares: {
      use(fn: typeof handler) {
        handler = fn;
      },
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("QA server unavailable.");
  const origin = `http://127.0.0.1:${address.port}`;
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const blockers: AbortController[] = [];
  const deadline = new AbortController();
  let rejectPhase: ((error: Error) => void) | undefined;
  const watchdog = setTimeout(() => {
    const error = new Error("Native handoff fixture exceeded 15 seconds.");
    deadline.abort(error);
    for (const controller of blockers) controller.abort();
    rejectPhase?.(error);
    server.closeAllConnections();
  }, 15000);
  let onRender: ((init: RequestInit, startedAt: number, response: Response) => void) | undefined;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { hostname: "127.0.0.1" } },
  });
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (typeof input !== "string" || !["/__develop/status", "/__develop/render"].includes(input))
      throw new Error("QA client attempted an unexpected endpoint.");
    const startedAt = performance.now();
    const headers = new Headers(init?.headers);
    if (input === "/__develop/render") headers.set("origin", origin);
    const response = await originalFetch(`${origin}${input}`, { ...init, headers });
    if (input === "/__develop/render") onRender?.(init!, startedAt, response);
    return response;
  }) as typeof fetch;
  try {
    const status = await developEngineStatus(true);
    assert.equal(status?.ready, true);
    assert(status && status.maxEdge >= 4096);
    // Run independently of the opt-in larger-export feature. Older engines
    // expose one RAW lane; newer engines can also hold the high-resolution lane.
    const largeExport = status.maxEdge >= 8192;
    const options = {
      edge: 1600,
      sourceMode: largeExport ? ("preview" as const) : ("raw" as const),
      signal: deadline.signal,
    };
    const source = largeExport
      ? new Blob([photo], { type: "image/jpeg" })
      : new Blob([generatedBayerDng()], { type: "image/x-adobe-dng" });
    const expected = new Uint8Array(
      await (await renderDevelop(source, undefined, options)).arrayBuffer(),
    );
    const results: Array<Record<string, unknown>> = [];
    for (let trial = 0; trial < 3; trial++) {
      blockerClosedAt = 0;
      blockerSettledAt = 0;
      const blocker = new AbortController();
      blockers.push(blocker);
      let uploadFinished = false;
      const uploaded = new Promise<void>((done, reject) => {
        rejectPhase = reject;
        markBlockerUploaded = () => {
          uploadFinished = true;
          done();
        };
      });
      const pendingBlocker = originalFetch(`${origin}/__develop/render`, {
        method: "POST",
        headers: {
          "content-type": "application/x-foto-develop",
          "x-lenslabs-request": "studio",
          "x-lenslabs-token": status!.token!,
          "x-foto-qa-blocker": "1",
          origin,
        },
        body: encodeDevelopRequest(
          new Blob([raw]),
          defaultDevelopSettings(),
          largeExport ? 8192 : 4096,
          0.9,
          "raw",
        ),
        signal: blocker.signal,
      })
        .then(async (response) => {
          await response.arrayBuffer();
          if (!uploadFinished)
            rejectPhase?.(new Error("Blocker rejected before its upload completed."));
          return response.status;
        })
        .catch((error: unknown) => {
          if (!uploadFinished)
            rejectPhase?.(new Error("Blocker failed before its upload completed."));
          return blocker.signal.aborted ? "aborted" : error;
        });
      await uploaded;
      // Let the parsed request claim its native lane. The assertion below
      // requires an actual server 429; no mocked busy response is accepted.
      await new Promise((done) => setTimeout(done, 30));
      const attempts: Array<{
        startedAt: number;
        status: number;
        body: BodyInit | null | undefined;
      }> = [];
      let busyAt = 0;
      onRender = (init, startedAt, response) => {
        attempts.push({ startedAt, status: response.status, body: init.body });
        if (response.status === 429 && !busyAt) {
          busyAt = performance.now();
          blocker.abort();
        }
      };
      const started = performance.now();
      const rendered = new Uint8Array(
        await (await renderDevelop(source, undefined, options)).arrayBuffer(),
      );
      const elapsedMs = performance.now() - started;
      onRender = undefined;
      blocker.abort();
      assert.equal(await pendingBlocker, "aborted");
      assert.equal(attempts[0]!.status, 429);
      assert.equal(attempts.at(-1)!.status, 200);
      assert(attempts.length <= 9);
      assert(busyAt > 0);
      assert(blockerClosedAt >= busyAt, "The HTTP connection never reported cancellation");
      assert(
        blockerSettledAt >= blockerClosedAt,
        "The native lane was not released after connection close",
      );
      for (const attempt of attempts) assert.equal(attempt.body, attempts[0]!.body);
      assert.equal(digest(rendered), digest(expected));
      assert.deepEqual(jpegDimensions(rendered), jpegDimensions(expected));
      results.push({
        trial: trial + 1,
        lane: largeExport ? "high-resolution" : "raw",
        statuses: attempts.map((item) => item.status),
        retryStartMs: +(attempts[1]!.startedAt - busyAt).toFixed(1),
        imageReadyMs: +elapsedMs.toFixed(1),
        serverCloseAfterCancelMs: +(blockerClosedAt - busyAt).toFixed(1),
        // Handler completion includes temp-file cleanup, so this is an upper
        // bound on lane release, not a timestamp instrumented inside the lane.
        handlerSettledAfterCancelMs: +(blockerSettledAt - busyAt).toFixed(1),
        jpegSha256: digest(rendered),
        submittedBytes: attempts.length * (attempts[0]!.body as Blob).size,
      });
    }
    assert.equal(digest(readFileSync(rawPath)), digest(raw));
    assert.equal(digest(readFileSync(jpegPath)), digest(photo));
    console.info("FOTO_RETRY_HANDOFF", JSON.stringify(results));
  } finally {
    clearTimeout(watchdog);
    deadline.abort();
    rejectPhase = undefined;
    onRender = undefined;
    for (const controller of blockers) controller.abort();
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
}
await run();
