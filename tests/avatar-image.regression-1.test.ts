import { describe, expect, test } from "bun:test";
import { AVATAR_SOURCE_LIMIT, prepareAvatarImage } from "../src/lib/avatar-image";

// Regression: SETTINGS-001 — valid raster uploads failed when OS MIME was missing.
// Found by browser QA on 2026-09-07. Report: docs/SETTINGS-QA-2026-09-07.md
// Header recognition is only a preflight; browser tests also exercise real image decoding.
describe("Avatar raster preflight", () => {
  const formats = [
    ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ["image/jpeg", [0xff, 0xd8, 0xff, 0xe0]],
    ["image/webp", [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]],
  ] as const;
  for (const [format, bytes] of formats) {
    for (const mime of ["", "application/octet-stream", "image/jpeg", "image/png", "image/webp"]) {
      test(`${format} bytes work with ${mime || "missing"} label`, async () => {
        const file = new File([new Uint8Array(bytes)], "portrait.dat", { type: mime });
        const image = await prepareAvatarImage(file);
        expect(image.type).toBe(format);
        expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array(bytes));
        expect(file.type).toBe(mime);
      });
    }
  }
  test("renamed SVG HTML text empty and truncated headers cannot enter the decoder", async () => {
    for (const content of [
      "<svg onload='alert(1)'/>",
      "<html/>",
      "not an image",
      "",
      "RIFFxxxxWAVE",
      "\x89PNG",
    ])
      await expect(
        prepareAvatarImage(new File([content], "portrait.png", { type: "image/png" })),
      ).rejects.toThrow("JPEG, PNG or WebP");
  });
  test("size limit checked before any bytes are read", async () => {
    const file = new File([new Uint8Array(AVATAR_SOURCE_LIMIT + 1)], "large.png", {
      type: "image/png",
    });
    Object.defineProperty(file, "slice", {
      value: () => {
        throw new Error("Must not read oversized file");
      },
    });
    await expect(prepareAvatarImage(file)).rejects.toThrow("no larger than 50 MB");
  });
  test("exact size boundary allowed for subsequent decoder validation", async () => {
    const bytes = new Uint8Array(AVATAR_SOURCE_LIMIT);
    bytes.set(formats[0][1]);
    expect((await prepareAvatarImage(new File([bytes], "image.png"))).size).toBe(
      AVATAR_SOURCE_LIMIT,
    );
  });
  test("read failure never becomes a successful image", async () => {
    const file = new File(["x"], "image.png");
    Object.defineProperty(file, "slice", {
      value: () => ({ arrayBuffer: () => Promise.reject(new Error("File unavailable")) }),
    });
    await expect(prepareAvatarImage(file)).rejects.toThrow("File unavailable");
  });
});
