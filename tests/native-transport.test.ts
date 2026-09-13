import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import {
  authorizeNativeRequest,
  burstProtocol,
  peopleProtocol,
  MAX_NATIVE_FILE_BYTES,
  NativeBridgeError,
  NativeFrameCache,
  NativeWorkerProcess,
  nativeStudioPlugin,
} from "../src/server/native-studio-plugin";
import { decodeNativeFrame } from "../src/lib/studio/native-client";
import { DEFAULT_SOCIAL_FRAME } from "../src/lib/social-frame";
import { jpegDimensions } from "../src/lib/delivery/media-integrity";

const token = "a".repeat(64);
const binary = resolve("native/build/lenslabs-native");
const good = resolve("tests/fixtures/photos/volleyball-portrait-cc0.jpg");
const hasNative = process.platform === "darwin" && existsSync(binary) && existsSync(good);

function mockRequest(
  headers: Record<string, string | string[] | undefined> = {},
  method = "POST",
  remote = "127.0.0.1",
) {
  return {
    method,
    headers: {
      host: "localhost:8080",
      origin: "http://localhost:8080",
      "x-lenslabs-request": "studio",
      "x-lenslabs-token": token,
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    socket: { remoteAddress: remote },
  } as IncomingMessage;
}
function rejectsWithStatus(operation: () => unknown, status: number) {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(NativeBridgeError);
  expect((caught as NativeBridgeError).status).toBe(status);
}

describe("native transport authorization", () => {
  test("exact loopback hosts and same-origin requests are allowed", () => {
    for (const [host, remote] of [
      ["localhost:8080", "127.0.0.1"],
      ["127.0.0.1:8080", "::ffff:127.0.0.1"],
      ["[::1]:8080", "::1"],
    ])
      expect(() =>
        authorizeNativeRequest(
          mockRequest({ host, origin: "http://" + host }, "POST", remote),
          8080,
          token,
        ),
      ).not.toThrow();
    expect(() =>
      authorizeNativeRequest(mockRequest({ "x-lenslabs-token": undefined }, "GET"), 8080, token),
    ).not.toThrow();
  });
  test("LAN, rebinding, cross-site requests, missing headers and disallowed methods fail closed", () => {
    for (const remote of ["192.168.1.2", "10.0.0.1", "8.8.8.8", "::ffff:192.168.1.2"])
      rejectsWithStatus(
        () => authorizeNativeRequest(mockRequest({}, "POST", remote), 8080, token),
        403,
      );
    for (const host of [
      "evil.example:8080",
      "localhost.evil.example:8080",
      "localhost:8081",
      "localhost",
      "127.1:8080",
    ])
      rejectsWithStatus(
        () => authorizeNativeRequest(mockRequest({ host, origin: "http://" + host }), 8080, token),
        403,
      );
    for (const headers of [
      { origin: "https://evil.example" },
      { origin: "null" },
      { origin: undefined },
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
      { "x-lenslabs-request": undefined },
      { "x-lenslabs-request": "other" },
      { "x-lenslabs-token": undefined },
      { "x-lenslabs-token": "b".repeat(64) },
      { "x-lenslabs-token": [token, token] },
    ])
      rejectsWithStatus(() => authorizeNativeRequest(mockRequest(headers), 8080, token), 403);
    for (const method of ["OPTIONS", "PUT", "DELETE", "PATCH"])
      rejectsWithStatus(() => authorizeNativeRequest(mockRequest({}, method), 8080, token), 403);
  });
  test("non-ASCII tokens reject as 403 rather than throwing timingSafeEqual RangeError", () => {
    rejectsWithStatus(
      () =>
        authorizeNativeRequest(mockRequest({ "x-lenslabs-token": "é".repeat(64) }), 8080, token),
      403,
    );
  });
});

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    id: "frame-1",
    name: "one.jpg",
    relativePath: "Match A/one.jpg",
    hash: "0101".repeat(16),
    score: 78,
    sharpness: 234,
    brightness: 125,
    verdict: "undecided",
    ...overrides,
  };
}
describe("native burst framing", () => {
  test("hex-encodes identifiers and binary hashes without using filesystem timestamps", () => {
    const output = burstProtocol({
      frames: [
        receipt({ id: "photo α", relativePath: "Match α/one.jpg", lastModified: 1780000000000 }),
      ],
    });
    expect(output).toStartWith("LENSBURST1 1\n");
    const columns = output.trim().split("\n")[1]!.split(" ");
    expect(Buffer.from(columns[0]!, "hex").toString()).toBe("photo α");
    expect(columns[1]).toBe("5555555555555555");
    expect(columns[5]).toBe("0");
    expect(columns[6]).toBe("-");
    expect(Buffer.from(columns[7]!, "hex").toString()).toBe("Match α");
    expect(columns[8]).toBe("undecided");
    expect(burstProtocol({ frames: [] })).toBe("LENSBURST1 0\n");
  });
  test("people protocol never names anyone and requires 512-d embeddings", () => {
    const embedding = Array.from({ length: 512 }, (_, i) => (i === 0 ? 1 : 0));
    const output = peopleProtocol({
      faces: [
        { id: "obs-a", frameId: "frame-a", source: "local-descriptor", detScore: 0.5, embedding },
      ],
    });
    expect(output).toStartWith("LENSPPL1 1\n");
    expect(output).toContain("local-descriptor");
    expect(output).not.toContain("Jane");
    expect(() =>
      peopleProtocol({
        faces: [{ id: "obs-a", frameId: "frame-a", source: "buffalo", detScore: 0.5, embedding }],
      }),
    ).toThrow();
    expect(() =>
      peopleProtocol({
        faces: [
          {
            id: "obs-a",
            frameId: "frame-a",
            source: "insightface",
            detScore: 0.5,
            embedding: [1, 0],
          },
        ],
      }),
    ).toThrow();
  });
  test("keeps timestamps, camera identity and decisions in separate fields", () => {
    const output = burstProtocol({
      frames: [
        receipt({
          hash: "0123456789abcdef",
          captureTimeMs: 1780000000123,
          cameraKey: "actual-body-serial",
          captureTimeBasis: "camera_clock",
          verdict: "keep",
        }),
      ],
    });
    const columns = output.trim().split("\n")[1]!.split(" ");
    expect(columns[1]).toBe("0123456789abcdef");
    expect(columns[5]).toBe("1780000000123");
    expect(Buffer.from(columns[6]!, "hex").toString()).toContain("actual-body-serial");
    expect(columns[8]).toBe("keep");
  });
  test("rejects oversized, repeated, malformed and nonfinite receipts", () => {
    for (const value of [
      null,
      [],
      {},
      { frames: "no" },
      { frames: new Array(100001).fill(receipt()) },
      { frames: [receipt(), receipt()] },
    ])
      rejectsWithStatus(() => burstProtocol(value), 400);
    for (const invalid of [
      { id: "" },
      { id: "bad\nframe" },
      { id: "x".repeat(513) },
      { hash: "z".repeat(16) },
      { hash: "0".repeat(63) },
      { score: NaN },
      { score: 101 },
      { sharpness: -1 },
      { brightness: Infinity },
      { verdict: "delete" },
      { captureTimeMs: -1 },
      { captureTimeMs: 1.5 },
      { cameraKey: "bad\0serial" },
      { relativePath: "bad\nfolder/image.jpg" },
      { relativePath: "x".repeat(4097) },
    ])
      rejectsWithStatus(() => burstProtocol({ frames: [receipt(invalid)] }), 400);
  });
  test("UTF-8 byte limits match native identifier and folder bounds", () => {
    rejectsWithStatus(() => burstProtocol({ frames: [receipt({ id: "é".repeat(257) })] }), 400);
    rejectsWithStatus(
      () => burstProtocol({ frames: [receipt({ relativePath: "é".repeat(2050) + "/x.jpg" })] }),
      400,
    );
  });
  test("mixed camera-clock and UTC receipts are rejected and unknown bases cannot establish bursts", () => {
    rejectsWithStatus(
      () =>
        burstProtocol({
          frames: [
            receipt({
              id: "a",
              cameraKey: "body-1",
              captureTimeMs: 1780000000123,
              captureTimeBasis: "utc",
            }),
            receipt({
              id: "b",
              cameraKey: "body-1",
              captureTimeMs: 1780000000124,
              captureTimeBasis: "camera_clock",
            }),
          ],
        }),
      400,
    );
    const row = burstProtocol({
      frames: [receipt({ cameraKey: "body-1", captureTimeMs: 1780000000123 })],
    })
      .trim()
      .split("\n")[1]!
      .split(" ");
    expect(row[5]).toBe("0");
  });
});

describe("native frame LRU cache", () => {
  const frame = (bytes: number) => ({
    metadata: { ok: true, preview_bytes: bytes },
    jpeg: Buffer.alloc(bytes),
  });
  test("evicts least-recently-used entries and accounts for replacement bytes", () => {
    const cache = new NativeFrameCache(10);
    cache.set("a", frame(4));
    cache.set("b", frame(4));
    expect(cache.get("a")).toBeDefined();
    cache.set("c", frame(4));
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBeDefined();
    expect(cache.get("c")).toBeDefined();
    cache.set("a", frame(8));
    expect(cache.get("c")).toBeUndefined();
    expect(cache.get("a")?.jpeg.length).toBe(8);
    cache.set("oversized", frame(11));
    expect(cache.get("oversized")).toBeUndefined();
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
  });
  test("also bounds tiny receipts by entry count", () => {
    const cache = new NativeFrameCache(10000);
    for (let i = 0; i < 300; ++i) cache.set(String(i), frame(1));
    expect(cache.get("43")).toBeUndefined();
    expect(cache.get("44")).toBeDefined();
    expect(cache.get("299")).toBeDefined();
  });
});

describe.skipIf(!hasNative)("actual C++ worker pipe", () => {
  test("real frames pass browser validation; repeated requests preserve source bytes", async () => {
    const worker = new NativeWorkerProcess(binary);
    try {
      const before = createHash("sha256")
        .update(await readFile(good))
        .digest("hex");
      for (let i = 0; i < 2; ++i) {
        const frame = await worker.run(good, new AbortController().signal);
        expect(frame.metadata["ok"]).toBe(true);
        expect(frame.metadata["preview_bytes"]).toBe(frame.jpeg.length);
        const bytes = Buffer.concat([
          Buffer.from(JSON.stringify(frame.metadata) + "\n"),
          frame.jpeg,
        ]);
        const decoded = decodeNativeFrame(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        );
        expect(decoded.backend).toBe("native-cpp");
        expect(decoded.width).toBe(960);
        expect(decoded.height).toBe(1280);
        expect(decoded.analysis.hash).toMatch(/^[01]{64}$/);
        expect(decoded.analysis.tone.rMean).toBeGreaterThan(0);
        expect(decoded.previewBlob.type).toBe("image/jpeg");
      }
      expect(
        createHash("sha256")
          .update(await readFile(good))
          .digest("hex"),
      ).toBe(before);
    } finally {
      worker.close();
    }
  });
  test("missing/corrupt paths do not poison the next valid request", async () => {
    const worker = new NativeWorkerProcess(binary);
    try {
      for (const path of [
        resolve("tests/fixtures/photos/does-not-exist.jpg"),
        resolve("tests/fixtures/photos/README.md"),
      ]) {
        const frame = await worker.run(path, new AbortController().signal);
        expect(frame.metadata["ok"]).toBe(false);
        expect(frame.jpeg.length).toBe(0);
      }
      expect((await worker.run(good, new AbortController().signal)).metadata["ok"]).toBe(true);
    } finally {
      worker.close();
    }
  });
  test("abort retires the process and reuse starts a fresh stream", async () => {
    const worker = new NativeWorkerProcess(binary);
    try {
      const controller = new AbortController();
      const running = worker.run(good, controller.signal);
      controller.abort();
      await expect(running).rejects.toThrow("cancelled");
      expect((await worker.run(good, new AbortController().signal)).metadata["ok"]).toBe(true);
      const already = new AbortController();
      already.abort();
      await expect(worker.run(good, already.signal)).rejects.toThrow("cancelled");
    } finally {
      worker.close();
    }
  });
  test("an occupied lane rejects concurrent use without corrupting the first job", async () => {
    const worker = new NativeWorkerProcess(binary);
    try {
      const running = worker.run(good, new AbortController().signal);
      await expect(worker.run(good, new AbortController().signal)).rejects.toThrow("occupied");
      expect((await running).metadata["ok"]).toBe(true);
    } finally {
      worker.close();
    }
  });
  test("failed spawn rejects promptly", async () => {
    const worker = new NativeWorkerProcess(resolve("native/build/nonexistent-worker"));
    try {
      await expect(worker.run(good, new AbortController().signal)).rejects.toThrow();
    } finally {
      worker.close();
    }
  });
});

describe.skipIf(!hasNative)("local HTTP bridge", () => {
  type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
  let middleware: Middleware;
  const server = createServer((req, res) =>
    middleware(req, res, () => {
      res.writeHead(404);
      res.end();
    }),
  );
  const sockets = new Set<import("node:net").Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  let origin = "";
  let auth: Record<string, string>;
  let disposeNative = () => {};
  beforeAll(async () => {
    const plugin = nativeStudioPlugin();
    const hook = plugin.configureServer;
    disposeNative = () => {
      if (typeof plugin.closeBundle === "function") plugin.closeBundle.call({} as never);
    };
    if (typeof hook !== "function") throw new Error("Missing native configure hook");
    hook.call(
      {} as never,
      {
        config: { root: process.cwd() },
        httpServer: server,
        middlewares: {
          use(value: Middleware) {
            middleware = value;
          },
        },
      } as never,
    );
    await new Promise<void>((done, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", done);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing loopback address");
    origin = "http://127.0.0.1:" + address.port;
    const status = await fetch(origin + "/__native/status", {
      headers: { "x-lenslabs-request": "studio" },
    });
    const body = (await status.json()) as { token: string; ready: boolean };
    expect(status.status).toBe(200);
    expect(body.ready).toBe(true);
    auth = { origin, "x-lenslabs-request": "studio", "x-lenslabs-token": body.token };
  });
  afterAll(() => {
    // Bun's emulated Server.close callback can stall after a deliberately
    // incomplete oversized request. Explicitly dispose every test-owned resource.
    disposeNative();
    server.close();
    for (const socket of sockets) socket.destroy();
    server.closeAllConnections();
    server.unref();
  });
  test("rejects missing credentials, foreign origins, wrong types and empty uploads", async () => {
    expect((await fetch(origin + "/__native/analyze", { method: "POST", body: "x" })).status).toBe(
      403,
    );
    expect(
      (
        await fetch(origin + "/__native/analyze", {
          method: "POST",
          headers: { ...auth, origin: "https://evil.example" },
          body: "x",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(origin + "/__native/analyze", {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await fetch(origin + "/__native/analyze", {
          method: "POST",
          headers: { ...auth, "content-type": "application/octet-stream" },
          body: "",
        })
      ).status,
    ).toBe(400);
  });
  test("social export requires the same local authorization and a bounded recipe", async () => {
    const endpoint = origin + "/__native/social-frame";
    const headers = {
      ...auth,
      "content-type": "application/octet-stream",
      "x-lenslabs-frame": JSON.stringify(DEFAULT_SOCIAL_FRAME),
    };
    for (const patch of [{ origin: "https://evil.example" }, { "x-lenslabs-token": "invalid" }]) {
      expect(
        (await fetch(endpoint, { method: "POST", headers: { ...headers, ...patch }, body: "x" }))
          .status,
      ).toBe(403);
    }
    expect(
      (
        await fetch(endpoint, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(415);
    for (const frame of [
      "not-json",
      JSON.stringify({ ...DEFAULT_SOCIAL_FRAME, source: good }),
      JSON.stringify({ ...DEFAULT_SOCIAL_FRAME, zoom: 100 }),
    ]) {
      expect(
        (
          await fetch(endpoint, {
            method: "POST",
            headers: { ...headers, "x-lenslabs-frame": frame },
            body: "x",
          })
        ).status,
      ).toBe(400);
    }
    expect((await fetch(endpoint, { method: "POST", headers, body: "" })).status).toBe(400);
  });
  test("social HTTP output is a C++ JPEG, excludes paths, and preserves original bytes", async () => {
    const before = await readFile(good);
    for (const [format, height] of [
      ["portrait", 1350],
      ["square", 1080],
      ["story", 1920],
    ] as const) {
      const result = await fetch(origin + "/__native/social-frame?path=/etc/passwd", {
        method: "POST",
        headers: {
          ...auth,
          "content-type": "application/octet-stream",
          "x-lenslabs-frame": JSON.stringify({ ...DEFAULT_SOCIAL_FRAME, format }),
        },
        body: before,
        signal: AbortSignal.timeout(5000),
      });
      expect(result.status).toBe(200);
      expect(result.headers.get("x-lenslabs-engine")).toBe("cpp");
      expect(result.headers.get("content-type")).toBe("image/jpeg");
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect(jpegDimensions(new Uint8Array(await result.arrayBuffer()))).toEqual({
        width: 1080,
        height,
      });
    }
    expect(await readFile(good)).toEqual(before);
  });
  test("oversized Content-Length fails before the body is received", async () => {
    const status = await new Promise<number>((done, reject) => {
      const address = new URL(origin);
      const socket = createConnection({ host: "127.0.0.1", port: Number(address.port) });
      let response = "";
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("Oversized header was not rejected promptly"));
      }, 2000);
      socket.once("connect", () => {
        const headers = {
          ...auth,
          host: address.host,
          connection: "close",
          "content-type": "application/octet-stream",
          "content-length": String(MAX_NATIVE_FILE_BYTES + 1),
        };
        socket.write(
          "POST /__native/analyze HTTP/1.1\r\n" +
            Object.entries(headers)
              .map(([key, value]) => key + ": " + value)
              .join("\r\n") +
            "\r\n\r\n",
        );
      });
      socket.on("data", (chunk) => {
        response += chunk.toString();
        if (response.includes("\r\n\r\n")) {
          clearTimeout(timeout);
          socket.destroy();
          done(Number(response.split(" ")[1]));
        }
      });
      socket.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    expect(status).toBe(413);
  });
  test("reserves before upload, consumes the token once, and enforces admission authorization", async () => {
    const reserve = () =>
      fetch(origin + "/__native/admission", {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: "{}",
      });
    expect(
      (await fetch(origin + "/__native/admission", { method: "POST", body: "{}" })).status,
    ).toBe(403);
    expect(
      (
        await fetch(origin + "/__native/admission", {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: '{"path":"/etc/passwd"}',
        })
      ).status,
    ).toBe(400);
    const response = await reserve();
    expect(response.status).toBe(200);
    const { admission } = (await response.json()) as { admission: string };
    expect(admission).toMatch(/^[a-f0-9]{48}$/);
    const bytes = await readFile(resolve("tests/fixtures/photos/basketball-action-usaf-pd.jpg"));
    const upload = () =>
      fetch(origin + "/__native/analyze", {
        method: "POST",
        headers: {
          ...auth,
          "content-type": "application/octet-stream",
          "x-lenslabs-admission": admission,
        },
        body: bytes,
      });
    expect((await upload()).status).toBe(200);
    expect((await upload()).status).toBe(410);
    // An invalid image still releases its claimed lane for the next reservation.
    const invalid = (await (await reserve()).json()) as { admission: string };
    expect(
      (
        await fetch(origin + "/__native/analyze", {
          method: "POST",
          headers: {
            ...auth,
            "content-type": "application/octet-stream",
            "x-lenslabs-admission": invalid.admission,
          },
          body: "not an image",
        })
      ).status,
    ).toBe(422);
  });
  test("only uploaded bytes are processed, client paths ignored, repeated content is cached", async () => {
    const bytes = await readFile(good);
    const originalHash = createHash("sha256").update(bytes).digest("hex");
    for (let pass = 0; pass < 2; ++pass) {
      const result = await fetch(origin + "/__native/analyze?path=/etc/passwd", {
        method: "POST",
        headers: {
          ...auth,
          "content-type": "application/octet-stream",
          "content-length": String(bytes.length),
          connection: "close",
          "x-lenslabs-path": "/etc/passwd",
        },
        body: bytes,
        signal: AbortSignal.timeout(4000),
      });
      expect(result.status).toBe(200);
      expect(result.headers.get("x-lenslabs-engine")).toBe("cpp");
      const body = await result.arrayBuffer();
      expect(Number(result.headers.get("content-length"))).toBe(body.byteLength);
      const frame = decodeNativeFrame(body);
      expect(frame.width).toBe(960);
      expect(frame.height).toBe(1280);
      expect(frame.nativeCached).toBe(pass > 0);
    }
    expect(
      createHash("sha256")
        .update(await readFile(good))
        .digest("hex"),
    ).toBe(originalHash);
    const pathOnly = await fetch(origin + "/__native/analyze", {
      method: "POST",
      headers: {
        ...auth,
        "content-type": "application/octet-stream",
      },
      body: JSON.stringify({ path: good }),
    });
    expect(pathOnly.status).toBe(422);
  });
});
