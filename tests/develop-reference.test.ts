import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { defaultDevelopSettings } from "../src/lib/develop/contract";
import {
  assertReferenceAspect,
  encodeReferencePair,
  referencePreviewSize,
  referenceResult,
  referenceNativeReceiptSchema,
} from "../src/lib/develop/reference-contract";
import {
  nativeReferencePlugin,
  parseReferencePair,
  runNativeReference,
} from "../src/server/native-reference";

function pair(edited = true) {
  const width = 64,
    height = 48,
    source = new Uint8Array(width * height * 4),
    target = new Uint8Array(source.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v =
        0.1 +
        0.7 *
          ((0.45 * x) / 63 +
            (0.3 * y) / 47 +
            (0.25 * (Math.sin(x * 0.36) * Math.cos(y * 0.27) + 1)) / 2);
      const p = (y * width + x) * 4;
      source[p] = (v + 0.1 * Math.sin(y * 0.18)) * 255;
      source[p + 1] = v * 255;
      source[p + 2] = (v + 0.1 * Math.cos(x * 0.21)) * 255;
      source[p + 3] = 255;
      target[p] = edited ? source[p]! * 1.1 + 5 : source[p]!;
      target[p + 1] = edited ? source[p + 1]! * 0.95 + 5 : source[p + 1]!;
      target[p + 2] = edited ? source[p + 2]! * 0.9 + 5 : source[p + 2]!;
      target[p + 3] = 255;
    }
  return { width, height, source, target };
}
async function packet(edited = true) {
  const p = pair(edited);
  return Buffer.from(
    await encodeReferencePair(p.width, p.height, p.source, p.target).arrayBuffer(),
  );
}
const binary = resolve("native/build/lenslabs-reference");
describe("bounded paired look contract", () => {
  test("preview sizing is bounded and crop/aspect mismatches cannot silently stretch", () => {
    expect(referencePreviewSize(3000, 2000)).toEqual({ width: 128, height: 85 });
    expect(() => referencePreviewSize(0, 500)).toThrow();
    expect(() => referencePreviewSize(5000, 1000)).toThrow();
    expect(() => referencePreviewSize(4096, 20)).toThrow();
    expect(() =>
      assertReferenceAspect({ width: 256, height: 171 }, { width: 512, height: 342 }),
    ).not.toThrow();
    expect(() =>
      assertReferenceAspect({ width: 256, height: 171 }, { width: 256, height: 256 }),
    ).toThrow("different proportions");
    expect(() =>
      assertReferenceAspect({ width: 256, height: 171 }, { width: 171, height: 256 }),
    ).toThrow();
  });
  test("binary packet preserves both arrays and rejects size, alpha and trailing data", async () => {
    const p = pair(),
      original = p.source.slice(),
      edited = p.target.slice();
    const bytes = await packet();
    expect(parseReferencePair(bytes)).toBe(bytes);
    expect(bytes.subarray(8, 8 + p.source.length)).toEqual(Buffer.from(original));
    expect(bytes.subarray(8 + p.source.length)).toEqual(Buffer.from(edited));
    for (const bad of [
      bytes.subarray(0, 7),
      bytes.subarray(0, -1),
      Buffer.concat([bytes, Buffer.from([0])]),
      Buffer.alloc(200000),
    ])
      expect(() => parseReferencePair(bad)).toThrow();
    const transparent = Buffer.from(bytes);
    transparent[11] = 0;
    expect(() => parseReferencePair(transparent)).toThrow("opaque");
    const oversized = Buffer.from(bytes);
    oversized.writeUInt32BE(129, 0);
    expect(() => parseReferencePair(oversized)).toThrow();
    p.target[3] = 0;
    expect(() => encodeReferencePair(p.width, p.height, p.source, p.target)).toThrow("opaque");
    expect(p.source).toEqual(original);
  });
  test("numeric receipt cannot inject masks, crop or RAW WB and warnings remain explicit", () => {
    const s = defaultDevelopSettings();
    const patch = {
      contrast: s.contrast,
      highlights: s.highlights,
      shadows: s.shadows,
      whites: s.whites,
      blacks: s.blacks,
      saturation: s.saturation,
      curve: s.curve,
      channelCurves: s.channelCurves,
      grading: s.grading,
    };
    const diagnostics = {
      beforeRmse: 0.1,
      afterRmse: 0.05,
      improvement: 0.5,
      alignment: 0.6,
      gradientAlignment: 0.5,
      clippedFraction: 0.2,
      evaluations: 10,
      fitPixels: 1024,
      validationPixels: 1024,
      weakAlignment: true,
      poorFit: true,
    };
    const fitted = referenceResult({ patch, diagnostics });
    expect(fitted.settings).toEqual(s);
    expect(fitted.warnings).toHaveLength(4);
    expect(fitted.warnings[0]).toContain("not recovered");
    expect(
      referenceNativeReceiptSchema.safeParse({ patch: { ...patch, exposure: 1 }, diagnostics })
        .success,
    ).toBe(false);
    expect(
      referenceNativeReceiptSchema.safeParse({ patch: { ...patch, crop: s.crop }, diagnostics })
        .success,
    ).toBe(false);
    expect(
      referenceNativeReceiptSchema.safeParse({
        patch,
        diagnostics: { ...diagnostics, afterRmse: 0.2 },
      }).success,
    ).toBe(false);
    expect(
      referenceNativeReceiptSchema.safeParse({
        patch,
        diagnostics: { ...diagnostics, evaluations: 1001 },
      }).success,
    ).toBe(false);
    expect(
      referenceNativeReceiptSchema.safeParse({
        patch,
        diagnostics: { ...diagnostics, alignment: NaN },
      }).success,
    ).toBe(false);
  });
  test("client neutralizes both preview decodes, closes bitmap resources, and never persists a fit", () => {
    const client = readFileSync(resolve("src/lib/develop/reference.ts"), "utf8");
    expect(client).toContain("renderDevelop(neutralOriginal, defaultDevelopSettings()");
    expect(client).toContain("renderDevelop(editedReference, defaultDevelopSettings()");
    expect(client).toContain("assertReferenceAspect(source, target)");
    expect(client).toContain("source.close()");
    expect(client).toContain("target?.close()");
    expect(client).not.toMatch(/localStorage|indexedDB|saveDocument|addPhotos/);
  });
});
describe.skipIf(!existsSync(binary))("real local C++ reference fitter", () => {
  test("same-frame fit materially improves held-out pixels with portable neutral-source settings", async () => {
    const bytes = await packet(),
      before = Buffer.from(bytes);
    const fit = await runNativeReference(binary, bytes, new AbortController().signal);
    expect(fit.diagnostics.improvement).toBeGreaterThan(0.65);
    expect(fit.diagnostics.afterRmse).toBeLessThan(0.025);
    expect(fit.settings.exposure).toBe(0);
    expect(fit.settings.temperature).toBe(0);
    expect(fit.settings.tint).toBe(0);
    expect(fit.settings.crop).toEqual(defaultDevelopSettings().crop);
    expect(fit.settings.masks).toEqual([]);
    expect(bytes).toEqual(before);
    expect(await runNativeReference(binary, bytes, new AbortController().signal)).toEqual(fit);
  }, 15000);
  test("flat/unrelated content rejects instead of inventing a confident preset; cancel aborts native work", async () => {
    const bytes = await packet();
    bytes.fill(255, 8);
    await expect(runNativeReference(binary, bytes, new AbortController().signal)).rejects.toThrow(
      "matching detail",
    );
    const controller = new AbortController();
    controller.abort();
    await expect(runNativeReference(binary, await packet(), controller.signal)).rejects.toThrow(
      "cancelled",
    );
    const active = new AbortController(),
      running = runNativeReference(binary, await packet(), active.signal);
    active.abort();
    await expect(running).rejects.toThrow("cancelled");
  });
  test("HTTP gate requires loopback, same-origin session token, bounded MIME and complete bytes", async () => {
    let middleware: (
      req: IncomingMessage,
      res: ServerResponse,
      next: () => void,
    ) => unknown = () => {};
    const server = createServer((req, res) => {
      void middleware(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server unavailable");
    const port = address.port,
      url = `http://127.0.0.1:${port}`,
      plugin = nativeReferencePlugin();
    const config = plugin.configResolved as (config: unknown) => void;
    const configure = plugin.configureServer as (server: unknown) => void;
    config({ root: process.cwd() });
    configure({
      httpServer: server,
      middlewares: {
        use(fn: typeof middleware) {
          middleware = fn;
        },
      },
    });
    try {
      expect((await fetch(`${url}/__reference/status`)).status).toBe(403);
      const status = await fetch(`${url}/__reference/status`, {
        headers: { "x-lenslabs-request": "studio" },
      });
      const session = (await status.json()) as { ready: boolean; token: string };
      expect(session.ready).toBe(true);
      const body = new Uint8Array(await packet()),
        headers = {
          "x-lenslabs-request": "studio",
          "x-lenslabs-token": session.token,
          origin: url,
          "content-type": "application/x-foto-reference",
        };
      expect(
        (
          await fetch(`${url}/__reference/fit`, {
            method: "POST",
            headers: { ...headers, origin: "https://evil.example" },
            body,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(`${url}/__reference/fit`, {
            method: "POST",
            headers: { ...headers, "x-lenslabs-token": "0".repeat(64) },
            body,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(`${url}/__reference/fit`, {
            method: "POST",
            headers: { ...headers, "content-type": "image/png" },
            body,
          })
        ).status,
      ).toBe(415);
      expect(
        (
          await fetch(`${url}/__reference/fit`, {
            method: "POST",
            headers,
            body: body.subarray(0, 8),
          })
        ).status,
      ).toBe(400);
      const good = await fetch(`${url}/__reference/fit`, { method: "POST", headers, body });
      expect(good.status).toBe(200);
      const receipt = (await good.json()) as { diagnostics: { improvement: number } };
      expect(receipt.diagnostics.improvement).toBeGreaterThan(0.65);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  }, 15000);
});
