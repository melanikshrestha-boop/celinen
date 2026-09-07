import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { decodeFile, readExifOrientation } from "../src/lib/imaging";

// These small headers test metadata parsing, not photographic image quality.
function tiff(orientation: number, little = true): Uint8Array {
  const bytes = new Uint8Array(26);
  const view = new DataView(bytes.buffer);
  bytes.set(little ? [0x49, 0x49] : [0x4d, 0x4d]);
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  view.setUint16(8, 1, little);
  view.setUint16(10, 0x0112, little);
  view.setUint16(12, 3, little);
  view.setUint32(14, 1, little);
  view.setUint16(18, orientation, little);
  return bytes;
}

function segment(marker: number, data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(data.length + 4);
  bytes.set([0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 255]);
  bytes.set(data, 4);
  return bytes;
}

function jpeg(orientation: number | null, little = true, prefix: Uint8Array[] = []): File {
  const exif =
    orientation === null
      ? []
      : [
          segment(
            0xe1,
            new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff(orientation, little)]),
          ),
        ];
  return new File(
    [
      new Uint8Array([0xff, 0xd8]),
      ...prefix,
      ...exif,
      new Uint8Array([0xff, 0xda, 0, 2]),
      new Uint8Array(5000),
      new Uint8Array([0xff, 0xd9]),
    ],
    "orientation.jpg",
    { type: "image/jpeg" },
  );
}

type Point = [number, number];
type Bitmap = { width: number; height: number; points: Point[]; close: () => void };
type Matrix = [number, number, number, number, number, number];
const originalBitmap = globalThis.createImageBitmap;
const originalDocument = globalThis.document;
afterEach(() => {
  globalThis.createImageBitmap = originalBitmap;
  globalThis.document = originalDocument;
});

const matrices = (width: number, height: number): Matrix[] => [
  [1, 0, 0, 1, 0, 0],
  [1, 0, 0, 1, 0, 0],
  [-1, 0, 0, 1, width, 0],
  [-1, 0, 0, -1, width, height],
  [1, 0, 0, -1, 0, height],
  [0, 1, 1, 0, 0, 0],
  [0, 1, -1, 0, height, 0],
  [0, -1, -1, 0, height, width],
  [0, -1, 1, 0, 0, width],
];
function transform(points: Point[], [a, b, c, d, e, f]: Matrix): Point[] {
  return points.map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
}

/** Simulates a browser that auto-orients even when "none" was requested. */
function installDecoder(width = 4000, height = 3000) {
  const decoded: { orientation: number; blob: Blob }[] = [];
  const points: Point[] = [
    [0.5, 0.5],
    [width - 0.5, 0.5],
    [0.5, height - 0.5],
  ];
  globalThis.createImageBitmap = (async (source: Blob | Bitmap, options?: ImageBitmapOptions) => {
    if (source instanceof Blob) {
      const orientation = readExifOrientation(new Uint8Array(await source.arrayBuffer()));
      decoded.push({ orientation, blob: source });
      return {
        width: orientation >= 5 ? height : width,
        height: orientation >= 5 ? width : height,
        points: transform(points, matrices(width, height)[orientation]!),
        close() {},
      };
    }
    if (options?.resizeWidth && options.resizeHeight) {
      return {
        width: options.resizeWidth,
        height: options.resizeHeight,
        points: source.points.map(([x, y]) => [
          (x * options.resizeWidth!) / source.width,
          (y * options.resizeHeight!) / source.height,
        ]),
        close() {},
      };
    }
    return { ...source, close() {} };
  }) as typeof createImageBitmap;
  globalThis.document = {
    createElement: () => {
      const canvas = {
        width: 0,
        height: 0,
        points: [] as Point[],
        getContext: () => ({
          transform: (...values: Matrix) => {
            matrix = values;
          },
          drawImage: (bitmap: Bitmap) => {
            canvas.points = transform(bitmap.points, matrix);
          },
        }),
      };
      let matrix: Matrix = [1, 0, 0, 1, 0, 0];
      return canvas;
    },
  } as unknown as Document;
  return { decoded, points };
}

describe("deterministic EXIF orientation decoding", () => {
  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
    test(`applies orientation ${orientation} once, including mirrored coordinates`, async () => {
      const { decoded, points } = installDecoder();
      const file = jpeg(orientation, orientation % 2 === 0);
      const before = new Uint8Array(await file.arrayBuffer());
      const result = (await decodeFile(file)) as unknown as Bitmap;
      expect(decoded[0]!.orientation).toBe(1);
      expect(result.width).toBe(orientation >= 5 ? 3000 : 4000);
      expect(result.height).toBe(orientation >= 5 ? 4000 : 3000);
      expect(result.points).toEqual(transform(points, matrices(4000, 3000)[orientation]!));
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(before);
    });
  }

  test("does not infer orientation from aspect ratio, including square images", async () => {
    const { points } = installDecoder(3000, 3000);
    const result = (await decodeFile(jpeg(6))) as unknown as Bitmap;
    expect(result.points).toEqual(transform(points, matrices(3000, 3000)[6]!));
  });

  test("finds EXIF after non-EXIF APP1 and more than 256 KiB of other metadata", async () => {
    const { decoded } = installDecoder();
    const file = jpeg(6, true, [
      segment(0xe1, new Uint8Array([88, 77, 80, 0])),
      ...Array.from({ length: 5 }, () => segment(0xe2, new Uint8Array(60000))),
    ]);
    expect(readExifOrientation(new Uint8Array(await file.arrayBuffer()))).toBe(6);
    expect((await decodeFile(file)).width).toBe(3000);
    expect(decoded[0]!.orientation).toBe(1);
  });

  test("preserves an explicitly upright embedded RAW preview instead of inheriting its container rotation", async () => {
    installDecoder();
    const raw = new File([tiff(6), await jpeg(1).arrayBuffer()], "preview.nef");
    const result = await decodeFile(raw);
    expect([result.width, result.height]).toEqual([4000, 3000]);
  });

  test("uses container orientation only when an embedded RAW preview has no orientation", async () => {
    installDecoder();
    const raw = new File([tiff(6), await jpeg(null).arrayBuffer()], "preview.nef");
    const result = await decodeFile(raw);
    expect([result.width, result.height]).toEqual([3000, 4000]);
  });

  test("reads and neutralizes TIFF orientation without modifying the original", async () => {
    const { decoded } = installDecoder();
    const file = new File([tiff(8, false)], "photo.tiff", { type: "image/tiff" });
    expect((await decodeFile(file)).width).toBe(3000);
    expect(decoded[0]!.orientation).toBe(1);
    expect(readExifOrientation(new Uint8Array(await file.arrayBuffer()))).toBe(8);
  });

  test("reads a TIFF/RAW orientation directory beyond the initial header window", async () => {
    const { decoded } = installDecoder();
    const original = tiff(6);
    const bytes = new Uint8Array(300000 + original.length - 8);
    bytes.set(original.subarray(0, 8));
    new DataView(bytes.buffer).setUint32(4, 300000, true);
    bytes.set(original.subarray(8), 300000);
    const file = new File([bytes], "late-directory.tiff", { type: "image/tiff" });
    const result = await decodeFile(file);
    expect([result.width, result.height]).toEqual([3000, 4000]);
    expect(decoded[0]!.orientation).toBe(1);
    expect(readExifOrientation(new Uint8Array(await file.arrayBuffer()))).toBe(6);
  });

  test("rejects invalid TIFF type/count/offset as orientation metadata without throwing", () => {
    for (const [offset, value] of [
      [12, 4],
      [14, 2],
      [4, 255],
    ]) {
      const bytes = tiff(6);
      bytes[offset!] = value!;
      expect(readExifOrientation(bytes)).toBe(1);
    }
    expect(readExifOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).toBe(1);
  });

  test("real volleyball EXIF6 source decodes upright, including the 1280px culling preview", async () => {
    const bytes = await readFile(
      new URL("./fixtures/photos/volleyball-portrait-cc0.jpg", import.meta.url),
    );
    expect(readExifOrientation(bytes)).toBe(6);
    installDecoder();
    const file = new File([bytes], "volleyball.jpg", { type: "image/jpeg" });
    const full = await decodeFile(file);
    expect([full.width, full.height]).toEqual([3000, 4000]);
    const small = await decodeFile(file, 1280);
    expect([small.width, small.height]).toEqual([960, 1280]);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array(bytes));
  });
});
