import { describe, expect, test, mock } from "bun:test";
import {
  avatarSourceDimensions,
  decodeAvatarSource,
  AVATAR_SOURCE_LIMIT,
  AVATAR_PREVIEW_EDGE,
} from "../src/lib/avatar-image";

function png(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
function jpeg(width: number, height: number, marker = 0xc0) {
  const bytes = new Uint8Array([255, 216, 255, marker, 0, 8, 8, 0, 0, 0, 0, 0]);
  const view = new DataView(bytes.buffer);
  view.setUint16(7, height);
  view.setUint16(9, width);
  return bytes;
}
describe("Large avatar source safeguards", () => {
  test("accepts common 24, 45, 61 and 100 megapixel headers", () => {
    expect(AVATAR_SOURCE_LIMIT).toBe(50 * 1024 * 1024);
    for (const [width, height] of [
      [6000, 4000],
      [8192, 5464],
      [9504, 6336],
      [10000, 10000],
    ]) {
      expect(avatarSourceDimensions(png(width!, height!), "image/png")).toEqual({ width, height });
      expect(avatarSourceDimensions(jpeg(width!, height!, 0xc2), "image/jpeg")).toEqual({
        width,
        height,
      });
    }
  });
  test("blocks tiny files declaring excessive pixels, invalid headers, and excessive edges", () => {
    for (const [width, height] of [
      [10001, 10000],
      [30001, 2],
      [0, 2000],
      [0xffffffff, 0xffffffff],
    ])
      expect(() => avatarSourceDimensions(png(width!, height!), "image/png")).toThrow();
    expect(() =>
      avatarSourceDimensions(new Uint8Array([255, 216, 255, 224, 255, 255]), "image/jpeg"),
    ).toThrow();
    expect(() => avatarSourceDimensions(new Uint8Array(30), "image/webp")).toThrow();
  });
  test("all three WebP header variants preserve exact dimensions", () => {
    for (const chunk of ["VP8X", "VP8L", "VP8 "]) {
      const bytes = new Uint8Array(30);
      bytes.set(new TextEncoder().encode(chunk), 12);
      const view = new DataView(bytes.buffer);
      if (chunk === "VP8X") {
        view.setUint16(24, 5999, true);
        view.setUint16(27, 3999, true);
      }
      if (chunk === "VP8L") {
        bytes[20] = 47;
        view.setUint32(21, 5999 | (3999 << 14), true);
      }
      if (chunk === "VP8 ") {
        bytes.set([157, 1, 42], 23);
        view.setUint16(26, 6000, true);
        view.setUint16(28, 4000, true);
      }
      expect(avatarSourceDimensions(bytes, "image/webp")).toEqual({ width: 6000, height: 4000 });
    }
  });
  test("large source uses oriented dimensions for bounded preview and closes full bitmap", async () => {
    const previous = globalThis.createImageBitmap;
    const full = { width: 4000, height: 6000, close: mock(() => {}) };
    const preview = { width: 1365, height: AVATAR_PREVIEW_EDGE, close: mock(() => {}) };
    const decode = mock(async (...args: unknown[]) => (args[0] === full ? preview : full));
    globalThis.createImageBitmap = decode as unknown as typeof createImageBitmap;
    try {
      const file = new File([jpeg(6000, 4000), new Uint8Array(5 * 1024 * 1024)], "rotated.jpg");
      expect(await decodeAvatarSource(file)).toBe(preview);
      expect(decode.mock.calls[1]?.[1]).toEqual({
        resizeWidth: 1365,
        resizeHeight: 2048,
        resizeQuality: "high",
      });
      expect(full.close).toHaveBeenCalledTimes(1);
      expect(file.size).toBe(5 * 1024 * 1024 + 12);
    } finally {
      globalThis.createImageBitmap = previous;
    }
  });
  test("preflight stops invalid dimensions before any decoder runs", async () => {
    const previous = globalThis.createImageBitmap;
    const decode = mock(() => Promise.reject(new Error("Must not decode")));
    globalThis.createImageBitmap = decode as unknown as typeof createImageBitmap;
    try {
      await expect(decodeAvatarSource(new File([png(30000, 30000)], "giant.png"))).rejects.toThrow(
        "100 megapixels",
      );
      expect(decode).not.toHaveBeenCalled();
    } finally {
      globalThis.createImageBitmap = previous;
    }
  });
  test("releases full pixels when resizing fails", async () => {
    const previous = globalThis.createImageBitmap;
    const full = { width: 6000, height: 4000, close: mock(() => {}) };
    globalThis.createImageBitmap = (async (input: unknown) => {
      if (input === full) throw new Error("Out of memory");
      return full;
    }) as unknown as typeof createImageBitmap;
    try {
      await expect(decodeAvatarSource(new File([jpeg(6000, 4000)], "image.jpg"))).rejects.toThrow(
        "Out of memory",
      );
      expect(full.close).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.createImageBitmap = previous;
    }
  });
});
