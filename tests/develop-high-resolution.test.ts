import { describe, expect, test } from "bun:test";
import { DEVELOP_ENGINE_LIMITS, defaultDevelopSettings } from "../src/lib/develop/contract";
import { encodeDevelopRequest } from "../src/lib/develop/client";
import {
  createDevelopProcessingLanes,
  parseDevelopRequest,
  validateDevelopResult,
} from "../src/server/native-develop";

// Header/receipt fixtures only. These dimensions are inspected without pixel decoding.
function jpegHeader(width: number, height: number): Buffer {
  return Buffer.from([
    255,
    216,
    255,
    192,
    0,
    11,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    1,
    1,
    17,
    0,
    255,
    218,
    0,
    8,
    1,
    1,
    0,
    0,
    63,
    0,
    1,
    255,
    217,
  ]);
}
function packet(edge: number) {
  const header = Buffer.from(
    JSON.stringify({ settings: defaultDevelopSettings(), edge, quality: 0.9 }),
  );
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  return Buffer.concat([length, header, Buffer.from("synthetic original")]);
}
const emptyLanes = { requests: 0, processing: 0, rawProcessing: 0, highResolution: false };

describe("Opt-in high-resolution Develop transport bounds", () => {
  test("shared bounds retain preview/default export and source limits", () => {
    expect(DEVELOP_ENGINE_LIMITS).toMatchObject({
      maxEdge: 8192,
      maxOutputPixels: 36_000_000,
      defaultExportEdge: 4096,
      previewEdge: 1600,
      maxFileBytes: 128 * 1024 * 1024,
      maxRawSensorPixels: 60_000_000,
    });
  });
  test("client and server accept bounded larger requests without changing the original or recipe", async () => {
    const source = new Blob(["synthetic original"]),
      settings = defaultDevelopSettings();
    settings.exposure = 0.75;
    for (const edge of [32, 1600, 4096, 4097, 6024, 8192]) {
      const body = encodeDevelopRequest(source, settings, edge, 0.95, "raw");
      const decoded = parseDevelopRequest(Buffer.from(await body.arrayBuffer()));
      expect(decoded.edge).toBe(edge);
      expect(decoded.sourceMode).toBe("raw");
      expect(decoded.source.toString()).toBe("synthetic original");
      expect(decoded.settings).toEqual(settings);
    }
    const defaultPreview = parseDevelopRequest(
      Buffer.from(await encodeDevelopRequest(source, settings).arrayBuffer()),
    );
    expect(defaultPreview.edge).toBe(1600);
  });
  test("encoder and parser reject above-cap, noninteger and nonfinite edge values", () => {
    for (const edge of [0, 31, 4096.1, 8192.1, 8193, 16384, NaN, Infinity, -Infinity]) {
      expect(() => encodeDevelopRequest(new Blob(["x"]), defaultDevelopSettings(), edge)).toThrow();
      expect(() => parseDevelopRequest(packet(edge))).toThrow();
    }
  });
  test("returned JPEG receipts enforce actual pixel cap and requested edge independently", () => {
    expect(validateDevelopResult(jpegHeader(6024, 4024), 8192)).toEqual({
      width: 6024,
      height: 4024,
    });
    expect(validateDevelopResult(jpegHeader(6000, 6000), 8192)).toEqual({
      width: 6000,
      height: 6000,
    });
    expect(validateDevelopResult(jpegHeader(8192, 4394), 8192)).toEqual({
      width: 8192,
      height: 4394,
    });
    expect(validateDevelopResult(jpegHeader(4096, 4096), 4096)).toEqual({
      width: 4096,
      height: 4096,
    });
    for (const [width, height, edge] of [
      [6001, 6000, 8192],
      [8192, 4395, 8192],
      [8193, 1, 8192],
      [4097, 1, 4096],
    ])
      expect(() => validateDevelopResult(jpegHeader(width!, height!), edge!)).toThrow("dimensions");
    expect(() => validateDevelopResult(Buffer.from([255, 216, 255, 217]), 8192)).toThrow();
    expect(() => validateDevelopResult(Buffer.alloc(32 * 1024 * 1024 + 1), 8192)).toThrow("32 MiB");
  });
});

describe("Develop request and processing leases", () => {
  test("two body uploads may coexist but exactly one high-resolution parse wins", async () => {
    const lanes = createDevelopProcessingLanes();
    const leases = [lanes.acquireRequest(), lanes.acquireRequest()];
    expect(lanes.snapshot()).toEqual({ ...emptyLanes, requests: 2 });
    expect(() => lanes.acquireRequest()).toThrow("Two Develop requests");
    const outcomes = await Promise.all(
      leases.map(async (lease) => {
        await Promise.resolve();
        try {
          lease.start({ edge: 8192, sourceMode: "preview" });
          return "started";
        } catch (error) {
          return (error as { status: number }).status;
        }
      }),
    );
    expect(outcomes).toEqual(["started", 429]);
    expect(lanes.snapshot()).toEqual({
      requests: 2,
      processing: 1,
      rawProcessing: 0,
      highResolution: true,
    });
    leases[0]!.release();
    leases[1]!.start({ edge: 8192, sourceMode: "preview" });
    expect(lanes.snapshot()).toEqual({
      requests: 1,
      processing: 1,
      rawProcessing: 0,
      highResolution: true,
    });
    leases[1]!.release();
    expect(lanes.snapshot()).toEqual(emptyLanes);
  });
  test("a waiting unparsed body does not prevent high-resolution processing", () => {
    const lanes = createDevelopProcessingLanes(),
      upload = lanes.acquireRequest(),
      large = lanes.acquireRequest();
    large.start({ edge: 8192, sourceMode: "raw" });
    expect(lanes.snapshot()).toEqual({
      requests: 2,
      processing: 1,
      rawProcessing: 1,
      highResolution: true,
    });
    expect(() => upload.start({ edge: 1600, sourceMode: "preview" })).toThrow("itself");
    large.release();
    upload.start({ edge: 1600, sourceMode: "preview" });
    upload.release();
    expect(lanes.snapshot()).toEqual(emptyLanes);
  });
  test("normal jobs keep two raster lanes and at most one sensor RAW lane", () => {
    for (const sourceMode of ["preview", "raw"] as const) {
      const lanes = createDevelopProcessingLanes(),
        first = lanes.acquireRequest(),
        second = lanes.acquireRequest();
      first.start({ edge: 4096, sourceMode });
      if (sourceMode === "raw")
        expect(() => second.start({ edge: 4096, sourceMode: "raw" })).toThrow("sensor RAW");
      second.start({ edge: 4096, sourceMode: "preview" });
      expect(lanes.snapshot().processing).toBe(2);
      expect(lanes.snapshot().highResolution).toBe(false);
      first.release();
      second.release();
      expect(lanes.snapshot()).toEqual(emptyLanes);
    }
  });
  test("cancelled, invalid, duplicate and released claims cannot leak or underflow counters", () => {
    const lanes = createDevelopProcessingLanes(),
      cancelled = lanes.acquireRequest();
    cancelled.release();
    cancelled.release();
    expect(lanes.snapshot()).toEqual(emptyLanes);
    expect(() => cancelled.start({ edge: 8192, sourceMode: "raw" })).toThrow("not available");
    const lease = lanes.acquireRequest();
    expect(() => lease.start({ edge: 8193, sourceMode: "preview" })).toThrow("bounds");
    expect(lanes.snapshot()).toEqual({ ...emptyLanes, requests: 1 });
    lease.start({ edge: 4096, sourceMode: "raw" });
    expect(() => lease.start({ edge: 4096, sourceMode: "raw" })).toThrow("not available");
    lease.release();
    lease.release();
    expect(lanes.snapshot()).toEqual(emptyLanes);
  });
  test("1,000 varied parsed-arrival/release sequences match an independent exclusivity model", () => {
    for (let i = 0; i < 1000; i++) {
      const lanes = createDevelopProcessingLanes(),
        first = lanes.acquireRequest(),
        second = lanes.acquireRequest();
      const a = {
        edge: i % 3 === 0 ? 8192 : 4096,
        sourceMode: i % 5 === 0 ? ("raw" as const) : ("preview" as const),
      };
      const b = {
        edge: i % 7 === 0 ? 6024 : 1600,
        sourceMode: i % 2 === 0 ? ("raw" as const) : ("preview" as const),
      };
      first.start(a);
      const allowed =
        a.edge <= 4096 && b.edge <= 4096 && !(a.sourceMode === "raw" && b.sourceMode === "raw");
      if (allowed) second.start(b);
      else expect(() => second.start(b)).toThrow();
      expect(lanes.snapshot().processing).toBe(allowed ? 2 : 1);
      expect(lanes.snapshot().requests).toBe(2);
      first.release();
      if (!allowed) second.start(b);
      expect(lanes.snapshot()).toEqual({
        requests: 1,
        processing: 1,
        rawProcessing: Number(b.sourceMode === "raw"),
        highResolution: b.edge > 4096,
      });
      second.release();
      expect(lanes.snapshot()).toEqual(emptyLanes);
    }
  });
});
