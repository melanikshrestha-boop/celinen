import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { connect } from "node:net";
import { inflateSync } from "node:zlib";
import {
  REMOVE_MAX_BYTES,
  decodeObjectInstances,
  encodeRemovePixels,
  findPhotoObjects,
  objectAtPoint,
  objectSelectionMask,
  removePhotoObjects,
  type ObjectInstances,
} from "../src/lib/develop/object-remove";
import {
  nativeObjectRemovePlugin,
  parseRemoveRequest,
  runNativeRemove,
} from "../src/server/native-object-remove";

const binary = resolve("native/build/lenslabs-object-remove");
const nativeAvailable = process.platform === "darwin" && existsSync(binary);
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function fixture(width = 64, height = 48) {
  const data = new Uint8ClampedArray(width * height * 4);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = y * width + x,
        offset = p * 4;
      data.set([32 + (x % 8) * 20, 48 + (y % 8) * 18, 40 + ((x + y) % 8) * 12, 255], offset);
      if (
        x >= Math.floor(width / 2) - 3 &&
        x < Math.floor(width / 2) + 3 &&
        y >= Math.floor(height / 2) - 3 &&
        y < Math.floor(height / 2) + 3
      ) {
        mask[p] = 255;
        data.set([255, 0, 255, 255], offset);
      }
    }
  data[3] = 173;
  data[(Math.floor(height / 2) * width + Math.floor(width / 2)) * 4 + 3] = 91;
  return { image: { width, height, data } as ImageData, mask };
}
function packet() {
  const { image, mask } = fixture();
  return Buffer.from(encodeRemovePixels(image, mask));
}
function instancesPacket(width = 2, height = 2, values = [1, 2, 3, 0]) {
  const bytes = Buffer.alloc(12 + values.length);
  bytes.writeUInt32BE(0x464f4d31, 0);
  bytes.writeUInt32BE(width, 4);
  bytes.writeUInt32BE(height, 8);
  bytes.set(values, 12);
  return bytes;
}

/** Independent lossless PNG reader for the real native RGBA8 output, not an image mock. */
function pngPixels(bytes: Buffer) {
  expect(bytes.subarray(0, 8)).toEqual(pngSignature);
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  expect(bytes.subarray(12, 16).toString()).toBe("IHDR");
  expect(bytes[24]).toBe(8);
  expect([2, 6]).toContain(bytes[25]);
  expect(bytes[28]).toBe(0); // no interlacing; ImageIO's default lossless output
  const channels = bytes[25] === 6 ? 4 : 3,
    rowBytes = width * channels;
  const compressed: Buffer[] = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    expect(offset + 12 + length).toBeLessThanOrEqual(bytes.length);
    const type = bytes.subarray(offset + 4, offset + 8).toString();
    if (type === "IDAT") compressed.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
    if (type === "IEND") break;
  }
  const scanlines = inflateSync(Buffer.concat(compressed));
  expect(scanlines.length).toBe((rowBytes + 1) * height);
  const raw = Buffer.alloc(rowBytes * height),
    rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = scanlines[y * (rowBytes + 1)]!;
    expect(filter).toBeLessThanOrEqual(4);
    for (let x = 0; x < rowBytes; x++) {
      const p = y * rowBytes + x;
      const left = x >= channels ? raw[p - channels]! : 0;
      const above = y ? raw[p - rowBytes]! : 0;
      const upperLeft = y && x >= channels ? raw[p - rowBytes - channels]! : 0;
      const estimate = left + above - upperLeft;
      const dl = Math.abs(estimate - left),
        da = Math.abs(estimate - above),
        du = Math.abs(estimate - upperLeft);
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? above
              : filter === 3
                ? Math.floor((left + above) / 2)
                : dl <= da && dl <= du
                  ? left
                  : da <= du
                    ? above
                    : upperLeft;
      raw[p] = (scanlines[y * (rowBytes + 1) + 1 + x]! + predictor) & 255;
    }
  }
  for (let p = 0; p < width * height; p++) {
    rgba.set(raw.subarray(p * channels, p * channels + 3), p * 4);
    rgba[p * 4 + 3] = channels === 4 ? raw[p * 4 + 3]! : 255;
  }
  return { width, height, rgba };
}

describe("object-removal binary envelope and reviewed selections", () => {
  test("snapshots pixels and mask, big-endian operations and exact lengths", () => {
    const { image, mask } = fixture(16, 16),
      original = Buffer.from(image.data);
    const bytes = encodeRemovePixels(image, mask);
    expect(parseRemoveRequest(Buffer.from(bytes))).toEqual({ operation: 1, width: 16, height: 16 });
    expect(bytes.slice(0, 8)).toEqual(new Uint8Array([70, 79, 82, 49, 0, 0, 0, 1]));
    image.data.fill(0);
    mask.fill(0);
    expect(Buffer.from(bytes.subarray(16, 16 + original.length))).toEqual(original);
    expect(bytes.subarray(16 + original.length).some(Boolean)).toBe(true);
    expect(parseRemoveRequest(Buffer.from(encodeRemovePixels(image)))).toEqual({
      operation: 0,
      width: 16,
      height: 16,
    });
  });
  test("rejects malformed dimensions, operation, bytes, mask values and mask coverage", () => {
    const { image, mask } = fixture(16, 16);
    for (const [width, height] of [
      [15, 16],
      [16, 15],
      [NaN, 16],
      [16.5, 16],
      [1601, 16],
      [16, 4097],
    ])
      expect(() => encodeRemovePixels({ ...image, width: width!, height: height! })).toThrow();
    expect(() => encodeRemovePixels({ ...image, width: 4097 }, mask)).toThrow();
    expect(() => encodeRemovePixels({ ...image, data: image.data.slice(1) }, mask)).toThrow();
    expect(() => encodeRemovePixels(image, mask.slice(1))).toThrow();
    const valid = Buffer.from(encodeRemovePixels(image, mask));
    for (const malformed of [
      Buffer.alloc(0),
      Buffer.alloc(15),
      valid.subarray(1),
      Buffer.concat([valid, Buffer.from([0])]),
    ])
      expect(() => parseRemoveRequest(malformed)).toThrow();
    for (const [offset, value] of [
      [0, 0],
      [4, 2],
      [8, 0],
      [12, 4097],
    ]) {
      const changed = Buffer.from(valid);
      changed.writeUInt32BE(value!, offset!);
      expect(() => parseRemoveRequest(changed)).toThrow();
    }
    for (const value of [0, 1, 128, 255]) {
      const invalidMask = new Uint8Array(16 * 16).fill(value);
      expect(() =>
        parseRemoveRequest(Buffer.from(encodeRemovePixels(image, invalidMask))),
      ).toThrow();
    }
    // The current backend permits exactly half; anything larger must fail closed.
    const half = new Uint8Array(256);
    half.fill(255, 0, 128);
    expect(parseRemoveRequest(Buffer.from(encodeRemovePixels(image, half))).operation).toBe(1);
    half[128] = 255;
    expect(() => parseRemoveRequest(Buffer.from(encodeRemovePixels(image, half)))).toThrow();
  });
  test("analysis and fill use distinct upper bounds without allowing oversized allocation", () => {
    const analysis = { width: 1600, height: 16, data: new Uint8Array(1600 * 16 * 4) };
    expect(parseRemoveRequest(Buffer.from(encodeRemovePixels(analysis))).width).toBe(1600);
    const fill = { width: 4096, height: 16, data: new Uint8Array(4096 * 16 * 4) };
    const mask = new Uint8Array(4096 * 16);
    mask[0] = 255;
    expect(parseRemoveRequest(Buffer.from(encodeRemovePixels(fill, mask))).width).toBe(4096);
    expect(() => encodeRemovePixels(fill)).toThrow();
    const impossible = Buffer.alloc(16);
    impossible.writeUInt32BE(0x464f5231, 0);
    impossible.writeUInt32BE(1, 4);
    impossible.writeUInt32BE(0xffffffff, 8);
    impossible.writeUInt32BE(0xffffffff, 12);
    expect(() => parseRemoveRequest(impossible)).toThrow();
    expect(REMOVE_MAX_BYTES).toBe(16 + 4096 * 4096 * 5);
  });
  test("instance output validates magic, bounds, length and buffer offsets without retaining mutable bytes", () => {
    const bytes = instancesPacket(),
      wrapped = Buffer.concat([Buffer.alloc(5), bytes, Buffer.alloc(3)]);
    const result = decodeObjectInstances(wrapped.subarray(5, 5 + bytes.length));
    expect(result).toEqual({ width: 2, height: 2, labels: new Uint8Array([1, 2, 3, 0]) });
    wrapped.fill(255);
    expect(result.labels).toEqual(new Uint8Array([1, 2, 3, 0]));
    for (const invalid of [
      Buffer.alloc(0),
      bytes.subarray(0, 11),
      instancesPacket(0, 2),
      instancesPacket(2049, 1),
      bytes.subarray(0, bytes.length - 1),
      Buffer.concat([bytes, Buffer.from([0])]),
    ])
      expect(() => decodeObjectInstances(invalid)).toThrow();
    const badMagic = Buffer.from(bytes);
    badMagic.writeUInt32BE(0, 0);
    expect(() => decodeObjectInstances(badMagic)).toThrow();
  });
  test("coordinates remain top-left image-relative with no vertical flip or stage offset", () => {
    const instances = decodeObjectInstances(instancesPacket(2, 2, [1, 2, 3, 4]));
    for (const [x, y, expected] of [
      [0, 0, 1],
      [0.99, 0, 2],
      [0, 0.99, 3],
      [1, 1, 4],
      [0.5, 0.5, 4],
    ])
      expect(objectAtPoint(instances, x!, y!)).toBe(expected!);
    for (const [x, y] of [
      [-0.001, 0],
      [0, -0.001],
      [1.001, 0],
      [0, 1.001],
      [NaN, 0],
      [0, Infinity],
    ])
      expect(objectAtPoint(instances, x!, y!)).toBe(0);
  });
  test("mask IDs exclude background and invalid labels; dilation matches a bounded square oracle", () => {
    const labels = new Uint8Array(16 * 16);
    labels[0] = 1;
    labels[7 * 16 + 8] = 2;
    labels[255] = 3;
    const instances: ObjectInstances = { width: 16, height: 16, labels };
    const snapshot = labels.slice();
    expect(objectSelectionMask(instances, [0, -1, NaN, 256, 2.5], 16, 16).some(Boolean)).toBe(
      false,
    );
    for (const padding of [0, 1, 2, 8]) {
      const mask = objectSelectionMask(instances, [1, 2, 2, 0, 256], 16, 16, padding);
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          const expected =
            (x <= padding && y <= padding) ||
            (Math.abs(x - 8) <= padding && Math.abs(y - 7) <= padding);
          expect(mask[y * 16 + x]).toBe(expected ? 255 : 0);
        }
    }
    const upscaled = objectSelectionMask(decodeObjectInstances(instancesPacket()), [1], 16, 16, 0);
    expect(upscaled.reduce((sum, value) => sum + Number(value > 0), 0)).toBe(64);
    expect(upscaled[0]).toBe(255);
    expect(upscaled[8]).toBe(0);
    expect(upscaled[8 * 16]).toBe(0);
    expect(labels).toEqual(snapshot);
    for (const padding of [-1, 9, NaN, 0.5])
      expect(() => objectSelectionMask(instances, [1], 16, 16, padding)).toThrow();
    for (const [width, height] of [
      [15, 16],
      [4097, 16],
      [16, 0],
      [16, 16.5],
    ])
      expect(() => objectSelectionMask(instances, [1], width!, height!)).toThrow();
  });
});

describe.skipIf(!nativeAvailable)(
  "real C++ texture fill, independent of Vision object detection",
  () => {
    test("actual PNG has deterministic reconstructed pixels; every unselected RGBA byte is unchanged", async () => {
      const { image, mask } = fixture(),
        bytes = Buffer.from(encodeRemovePixels(image, mask));
      const before = Buffer.from(bytes),
        signal = new AbortController().signal;
      const first = pngPixels(await runNativeRemove(binary, bytes, signal));
      const second = pngPixels(await runNativeRemove(binary, bytes, signal));
      expect([first.width, first.height]).toEqual([image.width, image.height]);
      expect(second.rgba).toEqual(first.rgba);
      expect(bytes).toEqual(before);
      let changed = 0;
      for (let p = 0; p < mask.length; p++) {
        if (mask[p]) {
          if (
            !first.rgba
              .subarray(p * 4, p * 4 + 3)
              .equals(Buffer.from(image.data.subarray(p * 4, p * 4 + 3)))
          )
            changed++;
          expect(first.rgba[p * 4 + 3]).toBe(image.data[p * 4 + 3]);
          expect(first.rgba[p * 4]).toBeLessThan(255); // no magenta-object donor leaked into fill
        } else
          for (let c = 0; c < 4; c++) expect(first.rgba[p * 4 + c]).toBe(image.data[p * 4 + c]);
      }
      expect(changed).toBe(mask.filter(Boolean).length);
    });
    test("pre-abort and in-flight cancellation reject; missing engine and malformed engine output fail closed", async () => {
      const pre = new AbortController();
      pre.abort();
      await expect(runNativeRemove(binary, packet(), pre.signal)).rejects.toThrow("cancelled");
      const running = new AbortController(),
        job = runNativeRemove(binary, packet(), running.signal);
      running.abort();
      await expect(job).rejects.toThrow("cancelled");
      await expect(
        runNativeRemove("/nonexistent-foto-object-removal", packet(), new AbortController().signal),
      ).rejects.toThrow();
      await expect(
        runNativeRemove("/bin/cat", packet(), new AbortController().signal),
      ).rejects.toThrow("preview");
      await expect(
        runNativeRemove("/usr/bin/false", packet(), new AbortController().signal),
      ).rejects.toThrow();
    });
  },
);

describe("removal client cancellation and untrusted receipts", () => {
  async function browser(
    respond: (url: string, init: RequestInit, count: number) => Response | Promise<Response>,
    run: (calls: { url: string; init: RequestInit }[]) => Promise<void>,
    hostname = "127.0.0.1",
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window"),
      savedFetch = globalThis.fetch;
    const calls: { url: string; init: RequestInit }[] = [];
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { hostname } },
    });
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return respond(url, init, calls.length);
    }) as typeof fetch;
    try {
      await run(calls);
    } finally {
      globalThis.fetch = savedFetch;
      if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
      else Reflect.deleteProperty(globalThis, "window");
    }
  }
  const ready = () => Response.json({ ready: true, token: "a".repeat(64) });
  test("aborted, hosted and empty-mask calls never upload pixels", async () => {
    const { image, mask } = fixture(16, 16),
      controller = new AbortController();
    controller.abort();
    await browser(ready, async (calls) => {
      await expect(findPhotoObjects(image, controller.signal)).rejects.toThrow();
      await expect(
        removePhotoObjects(image, new Uint8Array(mask.length), new AbortController().signal),
      ).rejects.toThrow("select");
      expect(calls).toHaveLength(0);
    });
    await browser(
      ready,
      async (calls) => {
        await expect(findPhotoObjects(image, new AbortController().signal)).rejects.toThrow(
          "local C++",
        );
        expect(calls).toHaveLength(0);
      },
      "photos.example",
    );
  });
  test("status capabilities, same-origin credentials and exact headers are required before processing", async () => {
    const { image } = fixture(16, 16);
    for (const status of [
      new Response("no", { status: 503 }),
      Response.json({ ready: false, token: "a".repeat(64) }),
      Response.json({ ready: true, token: "bad" }),
      Response.json({ ready: "true", token: "a".repeat(64) }),
    ])
      await browser(
        () => status,
        async (calls) => {
          await expect(findPhotoObjects(image, new AbortController().signal)).rejects.toThrow();
          expect(calls).toHaveLength(1);
        },
      );
    await browser(
      (_url, _init, count) => (count === 1 ? ready() : new Response(instancesPacket())),
      async (calls) => {
        expect((await findPhotoObjects(image, new AbortController().signal)).labels).toEqual(
          new Uint8Array([1, 2, 3, 0]),
        );
        expect(calls.map((call) => call.url)).toEqual(["/__remove/status", "/__remove/process"]);
        expect(calls[0]!.init.cache).toBe("no-store");
        expect(calls[0]!.init.headers).toEqual({ "x-lenslabs-request": "studio" });
        expect(calls[1]!.init.credentials).toBe("same-origin");
        expect(calls[1]!.init.headers).toEqual({
          "Content-Type": "application/x-foto-remove",
          "x-lenslabs-token": "a".repeat(64),
          "x-lenslabs-request": "studio",
        });
        expect(
          parseRemoveRequest(Buffer.from(await (calls[1]!.init.body as Blob).arrayBuffer()))
            .operation,
        ).toBe(0);
      },
    );
  });
  test("malformed, oversized and cancelled receipts never become a usable result", async () => {
    const { image, mask } = fixture(16, 16);
    for (const receipt of [
      Response.json({ error: "Select a smaller object." }, { status: 422 }),
      new Response("not a PNG"),
      new Response(pngSignature, { headers: { "Content-Length": String(96 * 1024 * 1024 + 1) } }),
    ])
      await browser(
        (_url, _init, count) => (count === 1 ? ready() : receipt),
        async () => {
          await expect(
            removePhotoObjects(image, mask, new AbortController().signal),
          ).rejects.toThrow();
        },
      );
    for (const receipt of [
      new Response("invalid labels"),
      new Response(instancesPacket(), {
        headers: { "Content-Length": String(12 + 2048 * 2048 + 1) },
      }),
      new Response(new Uint8Array(12 + 2048 * 2048 + 1)),
    ])
      await browser(
        (_url, _init, count) => (count === 1 ? ready() : receipt),
        async () => {
          await expect(findPhotoObjects(image, new AbortController().signal)).rejects.toThrow();
        },
      );
    const controller = new AbortController();
    await browser(
      (_url, _init, count) => {
        if (count === 1) return ready();
        controller.abort();
        return new Response(pngSignature);
      },
      async () => {
        await expect(removePhotoObjects(image, mask, controller.signal)).rejects.toThrow();
      },
    );
  });
});

describe.skipIf(!nativeAvailable)(
  "loopback object-removal HTTP authorization and real fill",
  () => {
    test("host/origin/header/token/type/size fail closed; valid work uses C++ and releases the lane", async () => {
      type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void>;
      let handler: Handler;
      const server = createServer(
        (req, res) =>
          void handler(req, res, () => {
            res.statusCode = 404;
            res.end();
          }),
      );
      (nativeObjectRemovePlugin().configureServer as (server: unknown) => void)({
        httpServer: server,
        middlewares: {
          use(value: Handler) {
            handler = value;
          },
        },
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No loopback address.");
      const origin = `http://127.0.0.1:${address.port}`;
      try {
        expect((await fetch(`${origin}/outside-remove`)).status).toBe(404);
        expect((await fetch(`${origin}/__remove/status`)).status).toBe(403);
        const status = await fetch(`${origin}/__remove/status`, {
          headers: { "x-lenslabs-request": "studio" },
        });
        const capability = (await status.json()) as { ready: boolean; token: string };
        expect(capability.ready).toBe(true);
        expect(capability.token).toMatch(/^[a-f0-9]{64}$/);
        expect(status.headers.get("cache-control")).toBe("no-store");
        const headers = {
          "x-lenslabs-request": "studio",
          "x-lenslabs-token": capability.token,
          "content-type": "application/x-foto-remove",
          origin,
        };
        for (const patch of [
          { origin: "https://evil.example" },
          { origin: "" },
          { host: `evil.example:${address.port}` },
          { "x-lenslabs-request": "" },
          { "x-lenslabs-token": "0".repeat(64) },
          { "x-lenslabs-token": "" },
          { "sec-fetch-site": "cross-site" },
          { "sec-fetch-site": "same-site" },
        ])
          expect(
            (
              await fetch(`${origin}/__remove/process`, {
                method: "POST",
                headers: { ...headers, ...patch },
                body: "invalid",
              })
            ).status,
          ).toBe(403);
        expect(
          (
            await fetch(`${origin}/__remove/process`, {
              headers: { "x-lenslabs-request": "studio" },
            })
          ).status,
        ).toBe(405);
        expect(
          (
            await fetch(`${origin}/__remove/process`, {
              method: "POST",
              headers: { ...headers, "content-type": "text/plain" },
              body: "invalid",
            })
          ).status,
        ).toBe(415);
        // Raw loopback headers avoid Bun's HTTP client replacing Content-Length with
        // zero for an empty request. The server must reject before reading 80 MiB.
        const oversizedStatus = await new Promise<number>((resolveStatus, reject) => {
          let response = "";
          const socket = connect(address.port, "127.0.0.1", () => {
            socket.write(
              [
                "POST /__remove/process HTTP/1.1",
                `Host: 127.0.0.1:${address.port}`,
                ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
                `Content-Length: ${REMOVE_MAX_BYTES + 1}`,
                "Connection: close",
                "",
                "",
              ].join("\r\n"),
            );
          });
          socket.setEncoding("utf8");
          socket.setTimeout(2000, () => socket.destroy(new Error("Oversized header timed out.")));
          socket.on("data", (chunk) => {
            response += chunk;
          });
          socket.once("error", reject);
          socket.once("end", () => resolveStatus(Number(response.split(" ")[1])));
        });
        expect(oversizedStatus).toBe(413);
        expect(
          (await fetch(`${origin}/__remove/process`, { method: "POST", headers, body: "invalid" }))
            .status,
        ).toBe(400);
        // Hold a real, incomplete upload open. A second request cannot occupy its
        // lane; disconnecting the first must release it without needing a restart.
        const pending = connect(address.port, "127.0.0.1");
        pending.on("error", () => {}); // deliberate local disconnect below
        try {
          await once(pending, "connect");
          const bytes = packet();
          pending.write(
            [
              "POST /__remove/process HTTP/1.1",
              `Host: 127.0.0.1:${address.port}`,
              ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
              `Content-Length: ${bytes.length}`,
              "Connection: close",
              "",
              "",
            ].join("\r\n"),
          );
          pending.write(bytes.subarray(0, 16));
          await new Promise((resolveTurn) => setTimeout(resolveTurn, 5));
          const busy = await fetch(`${origin}/__remove/process`, {
            method: "POST",
            headers,
            body: bytes,
          });
          expect(busy.status).toBe(429);
          await busy.arrayBuffer();
        } finally {
          pending.destroy();
          await new Promise((resolveTurn) => setTimeout(resolveTurn, 5));
        }
        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await fetch(`${origin}/__remove/process`, {
            method: "POST",
            headers,
            body: packet(),
          });
          expect(response.status).toBe(200);
          expect(response.headers.get("content-type")).toBe("image/png");
          expect(response.headers.get("cache-control")).toBe("no-store");
          expect(response.headers.get("x-content-type-options")).toBe("nosniff");
          const pixels = pngPixels(Buffer.from(await response.arrayBuffer()));
          expect([pixels.width, pixels.height]).toEqual([64, 48]);
        }
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      }
    });
  },
);
