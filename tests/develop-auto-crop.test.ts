import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  encodeCropPixels,
  autoCropResultSchema,
  AUTO_CROP_MAX_BYTES,
  suggestAutoCrop,
} from "../src/lib/develop/auto-crop";
import { nativeCropPlugin, parseCropRequest, runNativeCrop } from "../src/server/native-crop";

const binary = resolve("native/build/lenslabs-crop-suggest");
function packet(angle = 0) {
  const width = 96,
    height = 64,
    pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const value =
        y > height * 0.45 + Math.tan((angle * Math.PI) / 180) * (x - width / 2) ? 230 : 30;
      const i = (y * width + x) * 4;
      pixels[i] = value;
      pixels[i + 1] = value;
      pixels[i + 2] = value;
      pixels[i + 3] = 255;
    }
  return Buffer.from(encodeCropPixels(pixels, width, height));
}
const identity = {
  crop: { x: 0, y: 0, width: 1, height: 1, angle: 0, rotate: 0, flipX: false, flipY: false },
  confidence: "low",
  reasons: ["Manual review needed."],
  analysis: {
    width: 96,
    height: 64,
    horizonAngle: 0,
    horizonCoverage: 0,
    saliencyRetained: 1,
    retainedArea: 1,
  },
};

describe("bounded C++ crop contract", () => {
  test("pixel envelope snapshots input and rejects malformed bounds", () => {
    const pixels = new Uint8Array(16 * 16 * 4),
      encoded = encodeCropPixels(pixels, 16, 16, 1.25);
    pixels.fill(255);
    expect(encoded.at(-1)).toBe(0);
    expect(parseCropRequest(Buffer.from(encoded))).toEqual({ width: 16, height: 16, aspect: 1.25 });
    for (const [width, height] of [
      [15, 16],
      [16, 385],
      [NaN, 32],
      [16.5, 16],
    ])
      expect(() => encodeCropPixels(pixels, width!, height!)).toThrow();
    for (const aspect of [-1, 0, 5, NaN, Infinity])
      expect(() => encodeCropPixels(pixels, 16, 16, aspect)).toThrow();
    for (const bytes of [
      Buffer.alloc(0),
      Buffer.alloc(15),
      Buffer.alloc(AUTO_CROP_MAX_BYTES + 1),
      Buffer.from(encoded).subarray(1),
    ])
      expect(() => parseCropRequest(bytes)).toThrow();
    const malformed = Buffer.from(encoded);
    malformed.writeFloatBE(NaN, 12);
    expect(() => parseCropRequest(malformed)).toThrow();
  });
  test("result validation rejects invented geometry and oversized crops", () => {
    expect(autoCropResultSchema.parse(identity)).toEqual(identity);
    for (const patch of [
      { width: 0.5 },
      { angle: 15 },
      { rotate: 90 },
      { flipX: true },
      { x: 0.5 },
    ])
      expect(() =>
        autoCropResultSchema.parse({ ...identity, crop: { ...identity.crop, ...patch } }),
      ).toThrow();
    expect(() => autoCropResultSchema.parse({ ...identity, confidence: "99%" })).toThrow();
  });
});

describe.skipIf(!existsSync(binary))("real native crop process and transport", () => {
  test("C++ proposes a signed edge correction and never changes the packet", async () => {
    const bytes = packet(4),
      before = Buffer.from(bytes),
      signal = new AbortController().signal;
    const result = await runNativeCrop(binary, bytes, signal);
    expect(result.crop.angle).toBeGreaterThan(2.5);
    expect(result.crop.angle).toBeLessThan(5.5);
    expect(result.confidence).not.toBe("low");
    expect(bytes).toEqual(before);
    expect(await runNativeCrop(binary, bytes, signal)).toEqual(result);
  });
  test("cancelled work does not spawn or return stale analysis", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runNativeCrop(binary, packet(), controller.signal)).rejects.toThrow("cancelled");
    await expect(
      runNativeCrop("/does/not/exist", packet(), new AbortController().signal),
    ).rejects.toThrow();
  });
  test("HTTP protects origin/token/content, performs actual C++ analysis, and releases its lane", async () => {
    let handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>;
    const server = createServer((req, res) => {
      void handler(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
    });
    const configure = nativeCropPlugin().configureServer as (value: unknown) => void;
    configure({
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
    if (!address || typeof address === "string") throw new Error("No local server.");
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      expect((await fetch(`${origin}/__crop/status`)).status).toBe(403);
      const status = await fetch(`${origin}/__crop/status`, {
        headers: { "x-lenslabs-request": "studio" },
      });
      const capability = (await status.json()) as { ready: boolean; token: string };
      expect(capability.ready).toBe(true);
      const headers = {
        "x-lenslabs-request": "studio",
        "x-lenslabs-token": capability.token,
        "content-type": "application/x-foto-crop",
        origin,
      };
      for (const patch of [
        { origin: "https://evil.example" },
        { "x-lenslabs-token": "0".repeat(64) },
        { "sec-fetch-site": "cross-site" },
      ])
        expect(
          (
            await fetch(`${origin}/__crop/suggest`, {
              method: "POST",
              headers: { ...headers, ...patch },
              body: "bad",
            })
          ).status,
        ).toBe(403);
      expect(
        (
          await fetch(`${origin}/__crop/suggest`, {
            method: "POST",
            headers: { ...headers, "content-type": "text/plain" },
            body: "bad",
          })
        ).status,
      ).toBe(415);
      expect(
        (await fetch(`${origin}/__crop/suggest`, { method: "POST", headers, body: "bad" })).status,
      ).toBe(400);
      const response = await fetch(`${origin}/__crop/suggest`, {
        method: "POST",
        headers,
        body: packet(-4),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-foto-engine")).toBe("cpp-crop-1");
      const result = autoCropResultSchema.parse(await response.json());
      expect(result.crop.angle).toBeLessThan(-2.5);
      expect(
        (await fetch(`${origin}/__crop/suggest`, { method: "POST", headers, body: packet() }))
          .status,
      ).toBe(200);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("crop client cancellation and receipts", () => {
  async function withBrowser(
    run: (posts: RequestInit[], controller: AbortController) => Promise<void>,
    respond: (index: number, controller: AbortController) => Response,
  ) {
    const properties = ["window", "document", "createImageBitmap"].map(
      (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
    );
    const savedFetch = globalThis.fetch,
      posts: RequestInit[] = [],
      controller = new AbortController();
    let closed = 0;
    Object.defineProperty(globalThis, "window", {
      value: { location: { hostname: "127.0.0.1" } },
      configurable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: {
        createElement: () => ({
          getContext: () => ({
            drawImage() {},
            getImageData: () => ({ data: new Uint8ClampedArray(packet().subarray(16)) }),
          }),
        }),
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, "createImageBitmap", {
      value: async () => ({
        width: 96,
        height: 64,
        close() {
          closed++;
        },
      }),
      configurable: true,
    });
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      if (url.endsWith("/status")) return Response.json({ ready: true, token: "a".repeat(64) });
      posts.push(init);
      return respond(posts.length, controller);
    }) as typeof fetch;
    try {
      await run(posts, controller);
      expect(closed).toBe(1);
    } finally {
      globalThis.fetch = savedFetch;
      for (const [key, descriptor] of properties) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  }
  function receipt(result = identity) {
    const text = JSON.stringify(result);
    return new Response(text, {
      headers: {
        "content-type": "application/json",
        "content-length": String(text.length),
        "x-foto-engine": "cpp-crop-1",
      },
    });
  }
  test("one expired token retry keeps the exact packet and aspect snapshot", async () => {
    await withBrowser(
      async (posts) => {
        expect(await suggestAutoCrop(new Blob(["neutral"]))).toEqual(identity);
        expect(posts).toHaveLength(2);
        expect(posts[0]!.body).toBe(posts[1]!.body);
      },
      (index) => (index === 1 ? new Response(null, { status: 403 }) : receipt()),
    );
  });
  test("busy response is bounded without replaying work", async () => {
    await withBrowser(
      async (posts) => {
        await expect(suggestAutoCrop(new Blob(["neutral"]))).rejects.toThrow("already processing");
        expect(posts).toHaveLength(1);
      },
      () => new Response(null, { status: 429 }),
    );
  });
  test("aborted response never returns stale analysis", async () => {
    await withBrowser(
      async (_, controller) => {
        await expect(
          suggestAutoCrop(new Blob(["neutral"]), { aspect: null }, controller.signal),
        ).rejects.toThrow();
      },
      (_, controller) => {
        controller.abort();
        return receipt();
      },
    );
  });
  test("different preview dimensions are rejected", async () => {
    await withBrowser(
      async () => {
        await expect(suggestAutoCrop(new Blob(["neutral"]))).rejects.toThrow("different preview");
      },
      () => receipt({ ...identity, analysis: { ...identity.analysis, width: 32 } }),
    );
  });
});
