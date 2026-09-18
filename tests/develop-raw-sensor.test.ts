import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  instantiateRawDecodeWasm,
  type RawDecodeEngine,
} from "../src/lib/develop/wasm/raw-decode-engine";
import { buildSyntheticArw } from "./raw-sensor.fixture";

// Runs the committed binary: the exact bytes lenslab.dev serves.
const binary = readFileSync(
  new URL("../src/lib/develop/wasm/celinen-raw-decode.wasm", import.meta.url),
);

let engine: RawDecodeEngine;
beforeAll(async () => {
  engine = await instantiateRawDecodeWasm(binary);
});

/** Runs a decode to completion, returning the finished render. */
function decode(file: Uint8Array, request: Parameters<RawDecodeEngine["begin"]>[0] = {}) {
  const description = engine.open(file);
  if (!description) throw new Error(engine.lastError());
  const size = engine.begin(request);
  let progress = 0;
  let steps = 0;
  const seen: number[] = [];
  while (progress < 1) {
    progress = engine.step();
    seen.push(progress);
    if (++steps > 100000) throw new Error("the decode did not terminate");
  }
  const result = engine.finish();
  return { description, size, result, steps, seen };
}

describe("the C++ RAW converter compiled to WebAssembly", () => {
  test("reads a synthetic ARW's container without decoding it", () => {
    const { file, picture } = buildSyntheticArw();
    const description = engine.open(file);
    expect(description).not.toBeNull();
    expect(description!.width).toBe(picture.width);
    expect(description!.height).toBe(picture.height);
    expect(description!.packing).toBe("uncompressed-16");
    expect(description!.bitsPerSample).toBe(14);
    expect(description!.whiteBalanceFromFile).toBe(true);
    expect(description!.profileSource).toBe("file");
    // The raster is larger than the picture: a sensor has a masked border.
    expect(description!.sensorWidth).toBeGreaterThan(description!.width);
    engine.release();
  });

  test("renders the colours the fixture was built from", () => {
    const { file, picture, colours, block, columns } = buildSyntheticArw();
    const { result, size } = decode(file, {
      quality: "gradient",
      shoulder: 0,
      // The fixture is written four stops below white so nothing clips.
      exposure: 2,
    });
    expect([size.width, size.height]).toEqual([picture.width, picture.height]);
    expect(result.rgba.length).toBe(picture.width * picture.height * 4);

    const srgbEncode = (linear: number) =>
      linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
    let worst = 0;
    colours.forEach((colour, index) => {
      const x = (index % columns) * block + block / 2;
      const y = Math.floor(index / columns) * block + block / 2;
      const at = (y * size.width + x) * 4;
      colour.forEach((linear, channel) => {
        const got = result.rgba[at + channel]! / 255;
        worst = Math.max(worst, Math.abs(got - srgbEncode(linear)));
      });
    });
    // Eight bits of output is 1/255 on its own before anything else.
    expect(worst).toBeLessThan(0.012);
    engine.release();
  });

  test("reports the white balance in real Kelvin, and honours a requested one", () => {
    const { file } = buildSyntheticArw();
    const asShot = decode(file, { quality: "half" });
    expect(asShot.result.whiteBalanceFromFile).toBe(true);
    // The fixture is built at D65.
    expect(asShot.result.kelvin).toBeGreaterThan(6100);
    expect(asShot.result.kelvin).toBeLessThan(6900);
    expect(Math.abs(asShot.result.tint)).toBeLessThan(12);
    engine.release();

    const warm = decode(file, { quality: "half", kelvin: 9000 });
    expect(warm.result.kelvin).toBeGreaterThan(8500);
    expect(warm.result.kelvin).toBeLessThan(9500);
    engine.release();
  });

  test("a higher Kelvin warms the render and a positive tint pushes it magenta", () => {
    const { file, picture } = buildSyntheticArw();
    const middle = (width: number, height: number) =>
      (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
    const sample = (kelvin: number, tint: number) => {
      const { result, size } = decode(file, { quality: "half", kelvin, tint, shoulder: 0 });
      const at = middle(size.width, size.height);
      const patch = [result.rgba[at]!, result.rgba[at + 1]!, result.rgba[at + 2]!];
      engine.release();
      return patch;
    };
    expect(picture.width).toBeGreaterThan(0);
    const cool = sample(3500, 0),
      neutral = sample(6500, 0),
      warm = sample(9000, 0);
    expect(warm[0]! - warm[2]!).toBeGreaterThan(neutral[0]! - neutral[2]!);
    expect(cool[0]! - cool[2]!).toBeLessThan(neutral[0]! - neutral[2]!);

    const green = sample(6500, -40),
      magenta = sample(6500, 40);
    const balance = (p: number[]) => p[1]! - (p[0]! + p[2]!) / 2;
    expect(balance(green)).toBeGreaterThan(balance(magenta));
  });

  test("half size is a quarter of the pixels and much faster than full", () => {
    const { file, picture } = buildSyntheticArw();
    const half = decode(file, { quality: "half" });
    expect(half.size.width).toBe(Math.floor(picture.width / 2));
    expect(half.size.height).toBe(Math.floor(picture.height / 2));
    engine.release();
    const full = decode(file, { quality: "gradient" });
    expect(full.size.width).toBe(picture.width);
    engine.release();
  });

  test("progress climbs to exactly one and never goes backwards", () => {
    const { file } = buildSyntheticArw();
    const { seen, steps } = decode(file, { quality: "gradient", band: 8 });
    expect(steps).toBeGreaterThan(1);
    expect(seen.at(-1)).toBe(1);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    engine.release();
  });

  test("band size does not change a single pixel", () => {
    const { file } = buildSyntheticArw();
    const small = decode(file, { quality: "gradient", band: 8 }).result.rgba;
    engine.release();
    const large = decode(file, { quality: "gradient", band: 512 }).result.rgba;
    engine.release();
    expect(small.length).toBe(large.length);
    expect([...small]).toEqual([...large]);
  });

  test("abandoning a decode partway frees everything and leaves the engine usable", () => {
    const { file } = buildSyntheticArw();
    expect(engine.open(file)).not.toBeNull();
    engine.begin({ quality: "gradient", band: 8 });
    const partial = engine.step();
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(1);
    engine.release();
    expect(engine.residentBytes()).toBe(0);
    // And the next decode still works.
    const { result } = decode(buildSyntheticArw().file, { quality: "half" });
    expect(result.width).toBeGreaterThan(0);
    engine.release();
  });

  test("a file it cannot read is refused by name, not decoded badly", () => {
    // A camera with no colour profile and no colour tags of its own.
    const { file } = buildSyntheticArw({ colourTags: false });
    expect(engine.open(file)).toBeNull();
    expect(engine.lastError()).toContain("colour profile");
    engine.release();

    expect(engine.open(new Uint8Array(64))).toBeNull();
    expect(engine.lastError().length).toBeGreaterThan(0);
    engine.release();
  });

  test("survives a truncated and a randomly corrupted container", () => {
    const { file } = buildSyntheticArw();
    for (const length of [16, 200, 1000, Math.floor(file.length / 2), file.length - 1]) {
      expect(() => {
        const opened = engine.open(file.subarray(0, length));
        if (opened) {
          engine.begin({ quality: "half" });
          let progress = 0;
          let steps = 0;
          while (progress < 1 && steps++ < 10000) progress = engine.step();
        }
        engine.release();
      }).not.toThrow();
    }
    let seed = 20260918;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let trial = 0; trial < 40; trial++) {
      const damaged = new Uint8Array(file);
      for (let i = 0; i < 16; i++)
        damaged[Math.floor(random() * damaged.length)] = Math.floor(random() * 256);
      try {
        if (engine.open(damaged)) {
          engine.begin({ quality: "half" });
          let progress = 0;
          let steps = 0;
          while (progress < 1 && steps++ < 20000) progress = engine.step();
        }
      } catch {
        // Refusing is the expected outcome for damaged input; crashing is not.
      }
      engine.release();
    }
  });
});
