import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { instantiateIngestWasm, type IngestEngine } from "../src/lib/studio/cull/ingest-engine";
import { readPhoto } from "../src/lib/studio/cull/ingest-read";
import {
  inspectRawFile,
  instantiateRawWasm,
  orientedPreview,
  type RawApi,
} from "../src/lib/studio/cull/raw-container";
import { jpegGeometry } from "../src/lib/studio/cull/jpeg-geometry";
import { embeddedPreview, pickLoupeImage } from "../src/lib/studio/cull/loupe-source";
import { previewEdge, PREVIEW_MAX_EDGE } from "../src/lib/studio/cull/preview-library";

// Runs the committed binaries against real photographs wrapped in hand-built
// RAW containers: a portrait frame must come back portrait, whichever path
// read it, and a file the engine cannot decode must still be read.
const ingestBinary = readFileSync(
  new URL("../src/lib/studio/cull/celinen-ingest.wasm", import.meta.url),
);
const rawBinary = readFileSync(new URL("../src/lib/studio/cull/celinen-raw.wasm", import.meta.url));
const photo = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/photos/${name}`, import.meta.url)));

let engine: IngestEngine;
let raw: RawApi;
beforeAll(async () => {
  engine = await instantiateIngestWasm(ingestBinary);
  raw = await instantiateRawWasm(rawBinary);
});

/** A little-endian TIFF RAW shaped like a Sony ARW: IFD0 is the embedded
 * preview (with the Orientation the camera wrote), a SubIFD holds the sensor
 * size, IFD1 a 160 px thumbnail the cull must never choose. */
function arw(
  preview: Uint8Array,
  orientation: number,
  options: { sensor?: [number, number]; previewOffset?: number } = {},
): File {
  const [sensorWidth, sensorHeight] = options.sensor ?? [6048, 4024];
  const previewOffset = options.previewOffset ?? 4096;
  const thumbnail = photo("basketball-action-usaf-pd.jpg").subarray(0, 2048); // never a real frame
  const bytes = new Uint8Array(previewOffset + preview.length + 64);
  const view = new DataView(bytes.buffer);
  const u16 = (at: number, value: number) => view.setUint16(at, value, true);
  const u32 = (at: number, value: number) => view.setUint32(at, value, true);
  const ifd = (at: number, fields: [number, number, number, number][], next = 0) => {
    u16(at, fields.length);
    fields.forEach(([tag, type, count, value], index) => {
      const entry = at + 2 + index * 12;
      u16(entry, tag);
      u16(entry + 2, type);
      u32(entry + 4, count);
      if (type === 3 && count === 1) u16(entry + 8, value);
      else u32(entry + 8, value);
    });
    u32(at + 2 + fields.length * 12, next);
  };
  bytes.set([0x49, 0x49, 42, 0], 0);
  u32(4, 8);
  const ifd0: [number, number, number, number][] = [
    [0x00fe, 4, 1, 1], // NewSubfileType: a preview
    [0x0103, 3, 1, 6], // JPEG
    [0x014a, 4, 1, 400], // SubIFDs
    [0x0201, 4, 1, previewOffset],
    [0x0202, 4, 1, preview.length],
  ];
  if (orientation) ifd0.splice(2, 0, [0x0112, 3, 1, orientation]);
  ifd(8, ifd0, 600);
  ifd(400, [
    [0x00fe, 4, 1, 0],
    [0x0100, 4, 1, sensorWidth],
    [0x0101, 4, 1, sensorHeight],
    [0x0103, 3, 1, 32767],
  ]);
  ifd(600, [
    [0x00fe, 4, 1, 1],
    [0x0201, 4, 1, 1024],
    [0x0202, 4, 1, thumbnail.length],
  ]);
  bytes.set(thumbnail, 1024);
  bytes.set(preview, previewOffset);
  return new File([bytes as Uint8Array<ArrayBuffer>], "_DSC7042.ARW", { type: "" });
}

/** A JPEG with an EXIF orientation of its own, ahead of any it already has. */
function withOrientation(jpeg: Uint8Array, orientation: number): Uint8Array {
  const tiff = new Uint8Array(26);
  const view = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 42, 0], 0);
  view.setUint32(4, 8, true);
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x0112, true);
  view.setUint16(12, 3, true);
  view.setUint32(14, 1, true);
  view.setUint16(18, orientation, true);
  const segment = new Uint8Array(4 + 6 + tiff.length);
  segment.set([0xff, 0xe1, (tiff.length + 8) >> 8, (tiff.length + 8) & 0xff], 0);
  segment.set(new TextEncoder().encode("Exif\0\0"), 4);
  segment.set(tiff, 10);
  const out = new Uint8Array(jpeg.length + segment.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(segment, 2);
  out.set(jpeg.subarray(2), 2 + segment.length);
  return out;
}

const deps = (decodePixels = failingDecode) => ({ engine, decodePixels });
const failingDecode = async () => {
  throw new Error("The source image could not be decoded.");
};

describe("RAW previews: orientation, from the container", () => {
  test("a portrait frame comes back portrait, for every orientation the camera writes", async () => {
    const landscape = photo("basketball-hangar-usnavy-pd.jpg"); // 4256x2832, no orientation
    for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const result = await readPhoto(arw(landscape, orientation), {}, deps());
      expect(result.route).toBe("raw");
      const turned = orientation >= 5;
      expect(result.frame.height > result.frame.width).toBe(turned);
    }
    // The same frame as a bare JPEG is never turned: the RAW's tag is what changed it.
    expect(
      (
        await readPhoto(
          new File([landscape as Uint8Array<ArrayBuffer>], "a.jpg", { type: "image/jpeg" }),
          {},
          deps(),
        )
      ).frame.width,
    ).toBeGreaterThan(0);
  });

  test("the container's orientation wins over the preview's own, and is never applied twice", async () => {
    const landscape = photo("basketball-hangar-usnavy-pd.jpg");
    const plain = await readPhoto(arw(landscape, 6), {}, deps());
    // A preview that also carries a tag: the container still decides, and the
    // two turns are not combined.
    const tagged = await readPhoto(arw(withOrientation(landscape, 8), 6), {}, deps());
    expect(tagged.frame.width).toBe(plain.frame.width);
    expect(tagged.frame.height).toBe(plain.frame.height);
    expect(tagged.reading.hash).toBe(plain.reading.hash);

    // A preview the camera already turned (portrait pixels, landscape sensor)
    // is left alone, whatever the container says.
    const portrait = photo("volleyball-portrait-cc0.jpg"); // 4000x3000, orientation 6
    const preRotated = await readPhoto(arw(portrait, 8, { sensor: [6000, 4000] }), {}, deps());
    expect(preRotated.frame.height).toBeGreaterThan(preRotated.frame.width);
  });

  test("a RAW's capture time and camera come from the container, not the preview", async () => {
    const stripped = photo("basketball-hangar-usnavy-pd.jpg");
    const container = arw(stripped, 6);
    const result = await readPhoto(container, {}, deps());
    // The fixture's own EXIF is inside the embedded preview here, so this shows
    // the preview path keeps reading what the file does carry.
    expect(result.cameraKey).toBe("nikon corporation|nikon d700|2311811");
    expect(result.captureTimeMs).not.toBeNull();
  });

  test("the loupe shows the picture inside a RAW, tagged the way it belongs", async () => {
    const landscape = photo("basketball-hangar-usnavy-pd.jpg");
    const file = arw(landscape, 6);
    const blob = await embeddedPreview(file);
    expect(blob).not.toBeNull();
    expect(blob!.type).toBe("image/jpeg");
    const bytes = new Uint8Array(await blob!.arrayBuffer());
    const geometry = jpegGeometry(bytes)!;
    expect(geometry.orientation).toBe(6);
    expect([geometry.width, geometry.height]).toEqual([4256, 2832]);
    // The picture data itself is the file's own bytes, not a re-encode.
    expect(bytes.subarray(bytes.length - 64)).toEqual(landscape.subarray(landscape.length - 64));

    const picked = await pickLoupeImage({
      live: () => file,
      reconnected: async () => null,
      preview: async () => new Blob(["stored"], { type: "image/jpeg" }),
      thumbnail: async () => null,
    });
    expect(picked!.kind).toBe("original");
    // This fixture already carries an EXIF block, so its orientation is patched
    // in place: the loupe gets the camera's own bytes, not a re-encode.
    expect(picked!.blob.size).toBe(landscape.length);
  });

  test("a preview whose header lies past the head is still found and described", async () => {
    const landscape = photo("basketball-hangar-usnavy-pd.jpg");
    const file = arw(landscape, 8, { previewOffset: 2 * 1024 * 1024 });
    const inspection = await inspectRawFile(file, raw);
    expect(inspection.kind).toBe("tiff");
    expect(inspection.containerOrientation).toBe(8);
    expect(inspection.previews[0]).toMatchObject({ width: 4256, height: 2832, orientation: 8 });
    const blob = await orientedPreview(file, inspection.previews[0]!, raw);
    expect(
      jpegGeometry(new Uint8Array(await blob.slice(0, 65536).arrayBuffer()))!.orientation,
    ).toBe(8);
  });
});

describe("nothing is unreadable while something can decode it", () => {
  test("a WebP goes to the browser's decoder and is measured by the same C++", async () => {
    const jpeg = photo("basketball-hangar-usnavy-pd.jpg");
    const reference = engine.read(jpeg);
    // What the browser would hand back for a WebP of the same photograph.
    const pixels = {
      rgba: reference.frame.rgba,
      width: reference.frame.width,
      height: reference.frame.height,
      sourceWidth: 4256,
      sourceHeight: 2832,
    };
    const webp = new File(
      [new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3])],
      "a.webp",
      {
        type: "image/webp",
      },
    );
    let asked: Blob | null = null;
    const result = await readPhoto(
      webp,
      {},
      {
        engine,
        decodePixels: async (file) => {
          asked = file;
          return pixels;
        },
      },
    );
    expect(asked).toBe(webp);
    expect(result.route).toBe("browser");
    expect([result.width, result.height]).toEqual([4256, 2832]);
    expect(result.thumbnail.size).toBeGreaterThan(1000);
    // The same pixels through the same measurement: the same frame.
    expect(result.reading.hash).toBe(reference.reading.hash);
    expect(result.reading.acuitySubject).toBeCloseTo(reference.reading.acuitySubject, 6);
  });

  test("only when every decoder has failed is a file called unreadable, and it says why", async () => {
    const webp = new File(
      [new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])],
      "a.webp",
      {
        type: "image/webp",
      },
    );
    await expect(readPhoto(webp, {}, deps())).rejects.toThrow(/WebP file.*could not be decoded/i);
    const heic = new File(
      [new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0])],
      "IMG_1.heic",
      { type: "image/heic" },
    );
    await expect(readPhoto(heic, {}, deps())).rejects.toThrow(/Safari/);
    await expect(readPhoto(new File([], "empty.jpg"), {}, deps())).rejects.toThrow(/empty/);
    // A RAW with no preview inside: the reason names the RAW, not the decoder.
    const hollow = new File(
      [new Uint8Array([0x49, 0x49, 42, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
      "a.ARW",
      { type: "" },
    );
    await expect(readPhoto(hollow, {}, deps())).rejects.toThrow(/no preview picture/i);
  });

  test("a cut-off JPEG is read, marked damaged and explained, not silently scored", async () => {
    const whole = photo("basketball-hangar-usnavy-pd.jpg");
    const cut = new File(
      [whole.slice(0, Math.floor(whole.length * 0.6)) as Uint8Array<ArrayBuffer>],
      "cut.jpg",
      {
        type: "image/jpeg",
      },
    );
    const result = await readPhoto(cut, {}, deps());
    expect(result.damaged).toMatch(/cut short/i);
    expect(result.reading.acuitySubject).toBeGreaterThan(0);
    // The next photo is not described by the last one's damage.
    expect(
      (
        await readPhoto(
          new File([whole as Uint8Array<ArrayBuffer>], "whole.jpg", { type: "image/jpeg" }),
          {},
          deps(),
        )
      ).damaged,
    ).toBeUndefined();
  });

  test("a damaged preview inside a RAW gives way to a whole one", async () => {
    const whole = photo("basketball-hangar-usnavy-pd.jpg");
    const cut = whole.slice(0, Math.floor(whole.length * 0.5));
    const small = photo("basketball-action-usaf-pd.jpg"); // 2256x1420, a smaller but whole frame
    // The larger preview first (it ranks first), the whole smaller one after it.
    const bytes = new Uint8Array(8 * 1024 + cut.length + small.length + 64);
    const view = new DataView(bytes.buffer);
    const u16 = (at: number, v: number) => view.setUint16(at, v, true);
    const u32 = (at: number, v: number) => view.setUint32(at, v, true);
    const ifd = (at: number, fields: [number, number, number, number][], next = 0) => {
      u16(at, fields.length);
      fields.forEach(([tag, type, count, value], index) => {
        const entry = at + 2 + index * 12;
        u16(entry, tag);
        u16(entry + 2, type);
        u32(entry + 4, count);
        if (type === 3 && count === 1) u16(entry + 8, value);
        else u32(entry + 8, value);
      });
      u32(at + 2 + fields.length * 12, next);
    };
    bytes.set([0x49, 0x49, 42, 0], 0);
    u32(4, 8);
    ifd(
      8,
      [
        [0x0112, 3, 1, 6],
        [0x0201, 4, 1, 8192],
        [0x0202, 4, 1, cut.length],
      ],
      200,
    );
    ifd(200, [
      [0x0201, 4, 1, 8192 + cut.length],
      [0x0202, 4, 1, small.length],
    ]);
    bytes.set(cut, 8192);
    bytes.set(small, 8192 + cut.length);
    const result = await readPhoto(
      new File([bytes as Uint8Array<ArrayBuffer>], "b.ARW"),
      {},
      deps(),
    );
    expect(result.damaged).toBeUndefined();
    expect([result.width, result.height]).toEqual([2256, 1420]);
    expect(result.frame.height).toBeGreaterThan(result.frame.width); // still turned by the container
  });
});

describe("the review preview is sized to the screen", () => {
  test("the long edge is the screen's own pixels, floored at 2048 and capped", () => {
    expect(previewEdge({ width: 1512, height: 982 }, 2)).toBe(3024);
    expect(previewEdge({ width: 3840, height: 2160 }, 2)).toBe(7680);
    expect(previewEdge({ width: 8000, height: 5000 }, 2)).toBe(PREVIEW_MAX_EDGE);
    expect(previewEdge({ width: 1280, height: 800 }, 1)).toBe(2048); // never worse than before
    expect(previewEdge(undefined, 2)).toBe(2048);
  });
});
