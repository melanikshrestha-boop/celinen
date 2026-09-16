import { afterEach, describe, expect, test } from "bun:test";
import {
  asDevelopPreviewBlob,
  cullBitmapStillCurrent,
  decodeDevelopPreview,
  sniffDevelopPreviewType,
} from "../src/lib/develop/decode-preview";

const originalBitmap = globalThis.createImageBitmap;
const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9, 0x00);
const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

afterEach(() => {
  globalThis.createImageBitmap = originalBitmap;
});

describe("Develop preview MIME", () => {
  test("sniffs JPEG PNG and WebP and never treats raw bytes as an image type", () => {
    expect(sniffDevelopPreviewType(jpeg)).toBe("image/jpeg");
    expect(sniffDevelopPreviewType(png)).toBe("image/png");
    expect(
      sniffDevelopPreviewType(
        Uint8Array.of(
          0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0,
        ),
      ),
    ).toBe("image/webp");
    expect(sniffDevelopPreviewType(Uint8Array.of(0, 1, 2, 3))).toBeNull();
  });

  test("retags untyped JPEG bytes and leaves a typed JPEG identity alone", async () => {
    const typed = new Blob([jpeg], { type: "image/jpeg" });
    expect(await asDevelopPreviewBlob(typed)).toBe(typed);
    const stripped = new Blob([jpeg]);
    const recovered = await asDevelopPreviewBlob(stripped);
    expect(recovered).not.toBe(stripped);
    expect(recovered.type).toBe("image/jpeg");
    const rgba = new Blob([new Uint8Array(16)]);
    expect(await asDevelopPreviewBlob(rgba)).toBe(rgba);
    expect(rgba.type).toBe("");
  });

  test("loupe keeps a reminted preview of the same frame", () => {
    const blob = new Blob([jpeg], { type: "image/jpeg" });
    const file = new File([jpeg], "a.jpg", { type: "image/jpeg" });
    expect(cullBitmapStillCurrent({ previewBlob: blob, file }, { previewBlob: blob, file })).toBe(
      true,
    );
    expect(
      cullBitmapStillCurrent(
        { previewBlob: new Blob([jpeg, jpeg], { type: "image/jpeg" }), file },
        { previewBlob: blob, file },
      ),
    ).toBe(false);
    expect(cullBitmapStillCurrent(undefined, { previewBlob: blob, file })).toBe(false);
  });

  test("decode passes a JPEG MIME to createImageBitmap", async () => {
    const seen: Blob[] = [];
    globalThis.createImageBitmap = (async (source: ImageBitmapSource) => {
      seen.push(source as Blob);
      return { width: 8, height: 6, close() {} } as ImageBitmap;
    }) as typeof createImageBitmap;
    const bitmap = await decodeDevelopPreview(new Blob([jpeg]));
    expect(bitmap.width).toBe(8);
    expect(seen[0]?.type).toBe("image/jpeg");
  });
});
