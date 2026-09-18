import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { instantiateSocialWasm, type SocialWasmEngine } from "../src/lib/social/wasm/engine";
import { instagramPostItem, jpegDimensions, sha256Hex } from "../src/lib/social/instagram-post";
import { storyItem } from "../src/lib/social/story-broadcast";

// The committed binary: the exact bytes lenslab.dev serves.
const binary = readFileSync(new URL("../src/lib/social/wasm/celinen-social.wasm", import.meta.url));

function gradient(width: number, height: number) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = (x * 255) / width;
      rgba[i + 1] = (y * 255) / height;
      rgba[i + 2] = 90;
      rgba[i + 3] = 255;
    }
  return rgba;
}

describe("C++ social framing compiled to wasm", () => {
  let engine: SocialWasmEngine;
  beforeAll(async () => {
    engine = await instantiateSocialWasm(binary);
  });

  test("frames a landscape photo to a 4:5 feed JPEG Instagram accepts", async () => {
    const jpeg = engine.frame(gradient(3000, 2000), 3000, 2000, {
      format: "portrait",
      x: 0.5,
      y: 0.5,
      zoom: 1,
    });
    expect(jpeg[0]).toBe(0xff);
    expect(jpeg[1]).toBe(0xd8);
    expect(jpegDimensions(jpeg)).toEqual({ width: 1080, height: 1350 });
    const item = {
      sha256: await sha256Hex(jpeg),
      bytes: jpeg.byteLength,
      width: 1080,
      height: 1350,
    };
    expect(instagramPostItem.safeParse(item).success).toBe(true);
  });

  test("square format, and the same input always encodes the same bytes", async () => {
    const run = () =>
      engine.frame(gradient(1200, 1800), 1200, 1800, {
        format: "square",
        x: 0.2,
        y: 0.8,
        zoom: 1.5,
      });
    const a = run(),
      b = run();
    expect(jpegDimensions(a)).toEqual({ width: 1080, height: 1080 });
    expect(await sha256Hex(a)).toBe(await sha256Hex(b));
  });

  test("frames a landscape photo to the 9:16 story JPEG both platforms want", async () => {
    const jpeg = engine.frame(gradient(3000, 2000), 3000, 2000, {
      format: "story",
      x: 0.5,
      y: 0.5,
      zoom: 1,
    });
    expect(jpegDimensions(jpeg)).toEqual({ width: 1080, height: 1920 });
    const item = {
      sha256: await sha256Hex(jpeg),
      bytes: jpeg.byteLength,
      width: 1080,
      height: 1920,
    };
    expect(storyItem.safeParse(item).success).toBe(true);
    // A story is not a feed photo: the feed shape must reject it.
    expect(instagramPostItem.safeParse(item).success).toBe(false);
  });

  test("the story crop follows the placement, and the same input encodes the same bytes", async () => {
    const at = (x: number) =>
      engine.frame(gradient(3000, 2000), 3000, 2000, { format: "story", x, y: 0.5, zoom: 1 });
    const left = at(0.1),
      right = at(0.9);
    expect(jpegDimensions(left)).toEqual({ width: 1080, height: 1920 });
    expect(await sha256Hex(left)).not.toBe(await sha256Hex(right));
    expect(await sha256Hex(at(0.1))).toBe(await sha256Hex(left));
  });

  test("rejects out-of-range framing and oversize sources without poisoning the instance", () => {
    expect(() =>
      engine.frame(gradient(40, 40), 40, 40, { format: "portrait", x: 2, y: 0.5, zoom: 1 }),
    ).toThrow("Invalid framing controls");
    expect(() =>
      engine.frame(new Uint8ClampedArray(4), 9000, 1, {
        format: "square",
        x: 0.5,
        y: 0.5,
        zoom: 1,
      }),
    ).toThrow();
    const jpeg = engine.frame(gradient(64, 64), 64, 64, {
      format: "square",
      x: 0.5,
      y: 0.5,
      zoom: 1,
    });
    expect(jpegDimensions(jpeg)).toEqual({ width: 1080, height: 1080 });
  });
});
