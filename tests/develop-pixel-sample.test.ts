import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  createDevelopPixelSampleChannel,
  developPixelCoordinate,
  developPixelSampleDescription,
  developPixelSampleText,
  readDevelopPixelSample,
} from "../src/lib/develop/pixel-sample";

describe("Isolated pixel sample channel", () => {
  const sample = { red: 10, green: 30, blue: 240, alpha: 255, x: 37, y: 81 };
  test("has stable snapshots and methods, and deduplicates every identical hover frame", () => {
    const channel = createDevelopPixelSampleChannel();
    const methods = { ...channel };
    let notifications = 0;
    const unsubscribe = channel.subscribe(() => {
      notifications++;
    });
    expect(channel.getSnapshot()).toBeNull();
    channel.publish(null);
    expect(notifications).toBe(0);
    channel.publish({ url: "blob:one", sample });
    const first = channel.getSnapshot();
    for (let index = 0; index < 100; index++)
      channel.publish({ url: "blob:one", sample: { ...sample } });
    expect(notifications).toBe(1);
    expect(channel.getSnapshot()).toBe(first);
    expect(channel.publish).toBe(methods.publish);
    expect(channel.getSnapshot).toBe(methods.getSnapshot);
    expect(channel.subscribe).toBe(methods.subscribe);
    unsubscribe();
    unsubscribe();
    channel.publish(null);
    expect(channel.getSnapshot()).toBeNull();
    expect(notifications).toBe(1);
  });
  test("every pixel field and source ownership participate in equality", () => {
    const channel = createDevelopPixelSampleChannel();
    let notifications = 0;
    channel.subscribe(() => {
      notifications++;
    });
    channel.publish({ url: "blob:one", sample });
    for (const key of ["red", "green", "blue", "alpha", "x", "y"] as const) {
      const previous = channel.getSnapshot();
      channel.publish({ url: "blob:one", sample: { ...sample, [key]: sample[key] - 1 } });
      expect(channel.getSnapshot()).not.toBe(previous);
      expect(channel.getSnapshot()?.sample[key]).toBe(sample[key] - 1);
    }
    channel.publish({ url: "blob:two", sample });
    expect(channel.getSnapshot()?.url).toBe("blob:two");
    expect(notifications).toBe(8);
    channel.publish(null);
    channel.publish(null);
    expect(notifications).toBe(9);
  });
  test("copies immutable snapshots instead of accepting silent mutations from a producer", () => {
    const channel = createDevelopPixelSampleChannel();
    const input = { url: "blob:one", sample: { ...sample } };
    channel.publish(input);
    input.url = "blob:other";
    input.sample.red = 200;
    expect(channel.getSnapshot()).toEqual({ url: "blob:one", sample });
    expect(Object.isFrozen(channel.getSnapshot())).toBe(true);
    expect(Object.isFrozen(channel.getSnapshot()?.sample)).toBe(true);
  });
  test("observer failures/removals are isolated and stores never share a source", () => {
    const channel = createDevelopPixelSampleChannel(),
      other = createDevelopPixelSampleChannel();
    let received = 0,
      removed = 0;
    const unsubscribeBroken = channel.subscribe(() => {
      throw new Error("observer failure");
    });
    channel.subscribe(() => {
      received++;
    });
    channel.subscribe(() => {
      unsubscribeRemoved();
    });
    const unsubscribeRemoved = channel.subscribe(() => {
      removed++;
    });
    expect(() => channel.publish({ url: "blob:one", sample })).not.toThrow();
    expect(received).toBe(1);
    expect(removed).toBe(0);
    expect(other.getSnapshot()).toBeNull();
    unsubscribeBroken();
    channel.publish(null);
    expect(received).toBe(2);
  });
});

describe("Exact preview pixel coordinates", () => {
  const bounds = { left: 10, top: 20, width: 200, height: 100 };
  test("uses source dimensions, floors within a pixel and clamps the exact far edges", () => {
    expect(developPixelCoordinate(10, 20, bounds, 1000, 500)).toEqual({ x: 0, y: 0 });
    expect(developPixelCoordinate(10.399, 20.399, bounds, 1000, 500)).toEqual({ x: 1, y: 1 });
    expect(developPixelCoordinate(110, 70, bounds, 1000, 500)).toEqual({ x: 500, y: 250 });
    expect(developPixelCoordinate(210, 120, bounds, 1000, 500)).toEqual({ x: 999, y: 499 });
    expect(developPixelCoordinate(210.01, 120, bounds, 1000, 500)).toBeNull();
    expect(developPixelCoordinate(10, 19.99, bounds, 1000, 500)).toBeNull();
  });
  test("centered contain excludes vertical and horizontal letterboxes without flipping axes", () => {
    expect(developPixelCoordinate(59, 70, bounds, 100, 100)).toBeNull();
    expect(developPixelCoordinate(60, 20, bounds, 100, 100)).toEqual({ x: 0, y: 0 });
    expect(developPixelCoordinate(160, 120, bounds, 100, 100)).toEqual({ x: 99, y: 99 });
    expect(developPixelCoordinate(161, 70, bounds, 100, 100)).toBeNull();
    expect(developPixelCoordinate(110, 44, bounds, 400, 100)).toBeNull();
    expect(developPixelCoordinate(10, 45, bounds, 400, 100)).toEqual({ x: 0, y: 0 });
    expect(developPixelCoordinate(110, 70, bounds, 400, 100)).toEqual({ x: 200, y: 50 });
    expect(developPixelCoordinate(210, 95, bounds, 400, 100)).toEqual({ x: 399, y: 99 });
    expect(developPixelCoordinate(110, 96, bounds, 400, 100)).toBeNull();
  });
  test("fill and fractional CSS zoom map into original pixels", () => {
    expect(developPixelCoordinate(60, 45, bounds, 100, 100, "fill")).toEqual({ x: 25, y: 25 });
    expect(
      developPixelCoordinate(
        61.75,
        40.375,
        { left: 10.5, top: 20.25, width: 102.5, height: 40.25 },
        1025,
        4025,
        "fill",
      ),
    ).toEqual({ x: 512, y: 2012 });
  });
  test("never samples invisible or invalid rectangles, dimensions or pointer coordinates", () => {
    for (const invalid of [0, -1, NaN, Infinity]) {
      expect(developPixelCoordinate(20, 30, { ...bounds, width: invalid }, 100, 100)).toBeNull();
      expect(developPixelCoordinate(20, 30, { ...bounds, height: invalid }, 100, 100)).toBeNull();
      expect(developPixelCoordinate(20, 30, bounds, invalid, 100)).toBeNull();
      expect(developPixelCoordinate(20, 30, bounds, 100, invalid)).toBeNull();
    }
    expect(developPixelCoordinate(NaN, 30, bounds, 100, 100)).toBeNull();
    expect(developPixelCoordinate(20, Infinity, bounds, 100, 100)).toBeNull();
    expect(developPixelCoordinate(20, 30, bounds, 100.5, 100)).toBeNull();
    expect(developPixelCoordinate(20, 30, { ...bounds, left: NaN }, 100, 100)).toBeNull();
  });
});

test("reads only an unsmoothed cleared 1×1 source pixel and describes transparency honestly", () => {
  const calls: unknown[][] = [];
  const image = {} as HTMLImageElement;
  const context = {
    imageSmoothingEnabled: true,
    clearRect: (...args: unknown[]) => calls.push(["clear", ...args]),
    drawImage: (...args: unknown[]) => calls.push(["draw", ...args]),
    getImageData: (...args: unknown[]) => {
      calls.push(["read", ...args]);
      return { data: new Uint8ClampedArray([10, 30, 240, 127]) };
    },
  } as unknown as CanvasRenderingContext2D;
  const sample = readDevelopPixelSample(image, context, { x: 37, y: 81 });
  expect(sample).toEqual({ red: 10, green: 30, blue: 240, alpha: 127, x: 37, y: 81 });
  expect(context.imageSmoothingEnabled).toBe(false);
  expect(calls).toEqual([
    ["clear", 0, 0, 1, 1],
    ["draw", image, 37, 81, 1, 1, 0, 0, 1, 1],
    ["read", 0, 0, 1, 1],
  ]);
  expect(developPixelSampleText(sample)).toBe("R 10 · G 30 · B 240 · A 127");
  expect(developPixelSampleText({ ...sample, alpha: 255 })).toBe("R 10 · G 30 · B 240");
  expect(developPixelSampleText({ ...sample, alpha: 0 })).toBe("Transparent pixel");
  expect(developPixelSampleDescription(sample, "Native rendered preview")).toBe(
    "Native rendered preview, sRGB pixel at 37, 81: red 10, green 30, blue 240, alpha 127 (0–255)",
  );
});

test("actual hook coalesces pointer work and cancels stale, hidden or unreadable sources", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      fileURLToPath(new URL("./develop-pixel-sample-lifecycle.fixture.ts", import.meta.url)),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [output, errors, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(errors).toBe("");
  expect(code).toBe(0);
  expect(JSON.parse(output).passed).toBeGreaterThanOrEqual(30);
});
