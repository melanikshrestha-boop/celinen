import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, writeFile, unlink, rmdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import {
  defaultDevelopSettings,
  developSettingsSchema,
  cloneDevelopSettings,
} from "../src/lib/develop/contract";
import { encodeDevelopRequest } from "../src/lib/develop/client";
import {
  developProtocol,
  parseDevelopRequest,
  runNativeDevelop,
  nativeDevelopPlugin,
} from "../src/server/native-develop";
import { jpegDimensions } from "../src/lib/delivery/media-integrity";
import { generatedBayerDng } from "./fixtures/generated-bayer";

describe("Develop image contract", () => {
  test("defaults are independent, strict and byte-stable through serialization", () => {
    const first = defaultDevelopSettings(),
      second = defaultDevelopSettings();
    first.hsl[0]!.hue = 30;
    expect(second.hsl[0]!.hue).toBe(0);
    expect(cloneDevelopSettings(second)).toEqual(second);
    expect(developSettingsSchema.parse(JSON.parse(JSON.stringify(second)))).toEqual(second);
    expect(developProtocol(second).startsWith("FOTO_DEVELOP_1\n")).toBe(true);
  });
  test("rejects ranges, unknown data, NaN, bad crop and malformed curves", () => {
    const defaults = defaultDevelopSettings();
    for (const patch of [
      { exposure: Infinity },
      { exposure: 6 },
      { grain: -1 },
      { grainSize: 5 },
      { temperature: NaN },
      { hsl: [] },
      { arbitrary: "command" },
      {
        curve: [
          { x: 0, y: 0 },
          { x: 0, y: 0.5 },
          { x: 1, y: 1 },
        ],
      },
      {
        curve: [
          { x: 0.1, y: 0 },
          { x: 1, y: 1 },
        ],
      },
      {
        curve: [
          { x: 0, y: 0 },
          { x: 1, y: 2 },
        ],
      },
      { crop: { ...defaults.crop, x: 0.9, width: 0.5 } },
      { crop: { ...defaults.crop, rotate: 45 } },
    ])
      expect(developSettingsSchema.safeParse({ ...defaults, ...patch }).success).toBe(false);
  });
  test("binary envelope round trips source bytes without paths or base64", async () => {
    const source = new Blob([new Uint8Array([255, 216, 1, 2, 3, 255, 217])], {
      type: "image/jpeg",
    });
    const settings = defaultDevelopSettings();
    settings.exposure = 1.25;
    const envelope = encodeDevelopRequest(source, settings, 1280, 0.95);
    const parsed = parseDevelopRequest(Buffer.from(await envelope.arrayBuffer()));
    expect(parsed.settings).toEqual(settings);
    expect(parsed.edge).toBe(1280);
    expect(parsed.quality).toBe(0.95);
    expect(parsed.source).toEqual(Buffer.from(await source.arrayBuffer()));
  });
  test("rejects incomplete, oversize header and missing source", async () => {
    for (const bytes of [Buffer.alloc(0), Buffer.alloc(8), Buffer.from([0, 2, 0, 0, 1, 2, 3, 4])])
      expect(() => parseDevelopRequest(bytes)).toThrow();
    expect(() => encodeDevelopRequest(new Blob([]), defaultDevelopSettings())).toThrow();
    expect(() => encodeDevelopRequest(new Blob(["x"]), defaultDevelopSettings(), 99999)).toThrow();
    const head = Buffer.from(
      JSON.stringify({
        settings: defaultDevelopSettings(),
        edge: 1280,
        quality: 0.9,
        source: "/etc/passwd",
      }),
    );
    const length = Buffer.alloc(4);
    length.writeUInt32BE(head.length);
    expect(() => parseDevelopRequest(Buffer.concat([length, head, Buffer.from("x")]))).toThrow();
  });
  test("1000 setting combinations survive strict transport round-trip", async () => {
    for (let i = 0; i < 1000; i++) {
      const s = defaultDevelopSettings();
      s.exposure = ((i % 101) - 50) / 10;
      s.contrast = (i % 201) - 100;
      s.grain = i % 101;
      const packet = encodeDevelopRequest(new Blob(["photo"]), s);
      expect(parseDevelopRequest(Buffer.from(await packet.arrayBuffer())).settings).toEqual(s);
    }
  });
});
const binary = resolve(process.env["FOTO_TEST_DEVELOP_BINARY"] ?? "native/build/lenslabs-develop"),
  source = resolve("tests/fixtures/photos/basketball-action-usaf-pd.jpg");
describe.skipIf(process.platform !== "darwin" || !existsSync(binary))(
  "real C++ Develop renderer",
  () => {
    test("sensor RAW demosaic reads a no-thumbnail Bayer DNG, camera WB, exposure and orientation", async () => {
      const directory = await mkdtemp(join(tmpdir(), "foto-raw-test-"));
      const file = join(directory, "generated.dng"),
        rotatedFile = join(directory, "rotated.dng"),
        link = join(directory, "link.dng"),
        truncated = join(directory, "truncated.dng");
      try {
        const bytes = generatedBayerDng();
        await writeFile(file, bytes);
        await writeFile(rotatedFile, generatedBayerDng({ orientation: 6 }));
        const settings = defaultDevelopSettings(),
          signal = new AbortController().signal;
        const neutral = await runNativeDevelop(binary, file, settings, 256, 0.95, signal, "raw");
        expect(jpegDimensions(neutral)).toEqual({ width: 128, height: 96 });
        const repeated = await runNativeDevelop(binary, file, settings, 256, 0.95, signal, "raw");
        expect(repeated.equals(neutral)).toBe(true);
        settings.exposure = 1.25;
        const exposed = await runNativeDevelop(binary, file, settings, 256, 0.95, signal, "raw");
        expect(exposed.equals(neutral)).toBe(false);
        settings.exposure = 0;
        settings.temperature = 50;
        settings.tint = -25;
        const balanced = await runNativeDevelop(binary, file, settings, 256, 0.95, signal, "raw");
        expect(balanced.equals(neutral)).toBe(false);
        const rotated = await runNativeDevelop(
          binary,
          rotatedFile,
          defaultDevelopSettings(),
          256,
          0.95,
          signal,
          "raw",
        );
        expect(jpegDimensions(rotated)).toEqual({ width: 96, height: 128 });
        const scaled = await runNativeDevelop(
          binary,
          file,
          defaultDevelopSettings(),
          64,
          0.95,
          signal,
          "raw",
        );
        expect(jpegDimensions(scaled)).toEqual({ width: 64, height: 48 });
        expect(readFileSync(file)).toEqual(bytes);
        await expect(
          runNativeDevelop(binary, source, defaultDevelopSettings(), 256, 0.95, signal, "raw"),
        ).rejects.toThrow();
        await expect(
          runNativeDevelop(binary, file, defaultDevelopSettings(), 256, 0.95, signal, "preview"),
        ).rejects.toThrow();
        await symlink(file, link);
        await expect(
          runNativeDevelop(binary, link, defaultDevelopSettings(), 256, 0.95, signal, "raw"),
        ).rejects.toThrow();
        await writeFile(truncated, bytes.subarray(0, bytes.length / 2));
        await expect(
          runNativeDevelop(binary, truncated, defaultDevelopSettings(), 256, 0.95, signal, "raw"),
        ).rejects.toThrow();
      } finally {
        await unlink(file).catch(() => {});
        await unlink(rotatedFile).catch(() => {});
        await unlink(link).catch(() => {});
        await unlink(truncated).catch(() => {});
        await rmdir(directory);
      }
    }, 30_000);
    test("renders edited pixels, deterministic output, rotated export and preserves source hash", async () => {
      const before = createHash("sha256").update(readFileSync(source)).digest("hex");
      const signal = new AbortController().signal,
        neutral = defaultDevelopSettings();
      const original = await runNativeDevelop(binary, source, neutral, 800, 0.9, signal);
      const settings = defaultDevelopSettings();
      settings.exposure = 0.75;
      settings.temperature = 35;
      settings.grain = 30;
      const edited = await runNativeDevelop(binary, source, settings, 800, 0.9, signal);
      const repeat = await runNativeDevelop(binary, source, settings, 800, 0.9, signal);
      expect(edited.equals(original)).toBe(false);
      expect(repeat.equals(edited)).toBe(true);
      const dimensions = jpegDimensions(edited);
      expect(Math.max(dimensions.width, dimensions.height)).toBe(800);
      settings.crop.rotate = 90;
      const rotated = jpegDimensions(
        await runNativeDevelop(binary, source, settings, 800, 0.9, signal),
      );
      expect(rotated).toEqual({ width: dimensions.height, height: dimensions.width });
      expect(createHash("sha256").update(readFileSync(source)).digest("hex")).toBe(before);
    });
    test("fails closed on corrupt input or cancelled job", async () => {
      await expect(
        runNativeDevelop(
          binary,
          resolve("package.json"),
          defaultDevelopSettings(),
          256,
          0.9,
          new AbortController().signal,
        ),
      ).rejects.toThrow();
      const controller = new AbortController();
      controller.abort();
      await expect(
        runNativeDevelop(binary, source, defaultDevelopSettings(), 256, 0.9, controller.signal),
      ).rejects.toThrow("cancelled");
    });
    test("local HTTP transport gates session, origin and content before processing", async () => {
      let handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>;
      const server = createServer((req, res) => {
        void handler(req, res, () => {
          res.statusCode = 404;
          res.end();
        });
      });
      const plugin = nativeDevelopPlugin();
      const configure = plugin.configureServer as (value: unknown) => void;
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
      if (!address || typeof address === "string") throw new Error("Test server unavailable.");
      const origin = `http://127.0.0.1:${address.port}`;
      try {
        const denied = await fetch(`${origin}/__develop/status`);
        expect(denied.status).toBe(403);
        const response = await fetch(`${origin}/__develop/status`, {
          headers: { "x-lenslabs-request": "studio" },
        });
        expect(response.status).toBe(200);
        const status = (await response.json()) as { ready: boolean; token: string };
        expect(status.ready).toBe(true);
        const requestHeaders = {
          "x-lenslabs-request": "studio",
          "x-lenslabs-token": status.token,
          "content-type": "application/x-foto-develop",
          origin,
        };
        const body = encodeDevelopRequest(
          new Blob([readFileSync(source)]),
          defaultDevelopSettings(),
          256,
        );
        for (const patch of [
          { "x-lenslabs-token": "0".repeat(64) },
          { origin: "https://evil.example" },
          { "sec-fetch-site": "cross-site" },
        ]) {
          const denied = await fetch(`${origin}/__develop/render`, {
            method: "POST",
            headers: { ...requestHeaders, ...patch },
            body: "unauthorized",
          });
          const reason = await denied.text();
          if (denied.status !== 403)
            throw new Error(
              `Expected forbidden for ${Object.keys(patch).join(",")}, got ${denied.status}: ${reason}`,
            );
          expect(denied.status).toBe(403);
        }
        const wrongType = await fetch(`${origin}/__develop/render`, {
          method: "POST",
          headers: { ...requestHeaders, "content-type": "text/plain" },
          body: "x",
        });
        expect(wrongType.status).toBe(415);
        const malformed = await fetch(`${origin}/__develop/render`, {
          method: "POST",
          headers: requestHeaders,
          body: "x",
        });
        expect(malformed.status).toBe(400);
        const rendered = await fetch(`${origin}/__develop/render`, {
          method: "POST",
          headers: requestHeaders,
          body,
        });
        expect(rendered.status).toBe(200);
        expect(rendered.headers.get("cache-control")).toBe("no-store");
        expect(rendered.headers.get("x-foto-engine")).toBe("cpp-develop-1");
        const dimensions = jpegDimensions(new Uint8Array(await rendered.arrayBuffer()));
        expect(Math.max(dimensions.width, dimensions.height)).toBe(256);
        expect(rendered.headers.get("x-foto-source")).toBe("preview");
        const rawBody = encodeDevelopRequest(
          new Blob([generatedBayerDng()]),
          defaultDevelopSettings(),
          64,
          0.9,
          "raw",
        );
        const rawResponse = await fetch(`${origin}/__develop/render`, {
          method: "POST",
          headers: requestHeaders,
          body: rawBody,
        });
        expect(rawResponse.status).toBe(200);
        expect(rawResponse.headers.get("x-foto-source")).toBe("raw-demosaic");
        expect(jpegDimensions(new Uint8Array(await rawResponse.arrayBuffer()))).toEqual({
          width: 64,
          height: 48,
        });
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      }
    });
  },
);

const realRawFixtures = process.env["LENSLABS_RAW_FIXTURES"];
describe.skipIf(process.platform !== "darwin" || !existsSync(binary) || !realRawFixtures)(
  "optional checksum-verified Sony sensor RAW fixtures",
  () => {
    test("A6000 and A7 IV demosaic neutral and edited JPEGs without changing originals", async () => {
      const directory = await mkdtemp(join(tmpdir(), "foto-develop-real-raw-"));
      const preserve = process.env["FOTO_DEVELOP_SAVE_RAW_OUTPUT"] === "1";
      const outputs: string[] = [];
      const fixtures = [
        {
          name: "sony-a6000.ARW",
          digest: "ce8b4957281a817d52a07a691e2468567b6c78223bd0b514ffc1c65b002b8d89",
        },
        {
          name: "sony-a7iv-small.ARW",
          digest: "cbbd0930c7d8706dff84c68a2004454266e6fd0d8354f5f76a106b5d776e0223",
        },
      ];
      try {
        for (const fixture of fixtures) {
          const path = join(realRawFixtures!, fixture.name);
          const hash = () => createHash("sha256").update(readFileSync(path)).digest("hex");
          expect(hash()).toBe(fixture.digest);
          const neutral = defaultDevelopSettings(),
            edited = defaultDevelopSettings();
          edited.exposure = 0.65;
          edited.temperature = 22;
          edited.tint = -8;
          edited.contrast = 12;
          edited.highlights = -25;
          edited.shadows = 18;
          const started = performance.now();
          const before = await runNativeDevelop(
            binary,
            path,
            neutral,
            1600,
            0.95,
            new AbortController().signal,
            "raw",
          );
          const after = await runNativeDevelop(
            binary,
            path,
            edited,
            1600,
            0.95,
            new AbortController().signal,
            "raw",
          );
          expect(after.equals(before)).toBe(false);
          const dimensions = jpegDimensions(after);
          expect(Math.max(dimensions.width, dimensions.height)).toBe(1600);
          expect(jpegDimensions(before)).toEqual(dimensions);
          const stem = fixture.name.replace(/\.ARW$/i, "");
          const neutralFile = join(directory, `${stem}-neutral.jpg`),
            editedFile = join(directory, `${stem}-edited.jpg`);
          outputs.push(neutralFile, editedFile);
          await writeFile(neutralFile, before, { flag: "wx" });
          await writeFile(editedFile, after, { flag: "wx" });
          const reopened = await runNativeDevelop(
            binary,
            editedFile,
            neutral,
            256,
            0.9,
            new AbortController().signal,
            "preview",
          );
          expect(Math.max(...Object.values(jpegDimensions(reopened)))).toBe(256);
          expect(hash()).toBe(fixture.digest);
          console.info(
            `Sony RAW ${fixture.name}: ${dimensions.width}x${dimensions.height}, neutral ${before.length} bytes, edited ${after.length} bytes; pair ${Math.round(performance.now() - started)} ms; SHA-256 unchanged.`,
          );
        }
        if (preserve) console.info(`Preserved RAW-quality verification JPEGs: ${directory}`);
      } finally {
        if (!preserve) {
          for (const path of outputs) await unlink(path).catch(() => {});
          await rmdir(directory);
        }
      }
    }, 120_000);
  },
);
