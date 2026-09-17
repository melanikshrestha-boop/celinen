import { describe, expect, test } from "bun:test";
import {
  formatName,
  ingestRoute,
  isRawContainer,
  unreadableReason,
} from "../src/lib/studio/cull/ingest-route";

const bytes = (...values: (number | string)[]) => {
  const out: number[] = [];
  for (const value of values) {
    if (typeof value === "number") out.push(value);
    else for (const character of value) out.push(character.charCodeAt(0));
  }
  return new Uint8Array(out);
};
const pad = (head: Uint8Array, size = 32) => {
  const out = new Uint8Array(size);
  out.set(head.subarray(0, size));
  return out;
};

describe("which decoder reads which file", () => {
  test("camera JPEGs go to the engine, RAW containers to their previews, the rest to the browser", () => {
    expect(ingestRoute(bytes(0xff, 0xd8, 0xff, 0xe1))).toBe("jpeg");
    // TIFF-based RAWs, in both byte orders, plus Olympus and Panasonic magics.
    expect(ingestRoute(bytes("II", 42, 0))).toBe("raw");
    expect(ingestRoute(bytes("MM", 0, 42))).toBe("raw");
    expect(ingestRoute(bytes("IIRO"))).toBe("raw");
    expect(ingestRoute(bytes("IIU", 0))).toBe("raw");
    expect(ingestRoute(pad(bytes(0, 0, 0, 24, "ftypcrx ")))).toBe("raw");
    expect(ingestRoute(pad(bytes("FUJIFILMCCD-RAW ")))).toBe("raw");
    expect(ingestRoute(bytes(0x89, "PNG"))).toBe("browser");
    expect(ingestRoute(pad(bytes("RIFF", 0, 0, 0, 0, "WEBP")))).toBe("browser");
    expect(ingestRoute(pad(bytes(0, 0, 0, 24, "ftypheic")))).toBe("browser");
    expect(ingestRoute(new Uint8Array(0))).toBe("browser");
    expect(isRawContainer(bytes("II", 43, 0))).toBe(false); // not a TIFF magic
  });

  test("a file's format is named from its bytes, then its name", () => {
    expect(formatName(bytes(0x89, "PNG"), "a.png")).toBe("PNG");
    expect(formatName(pad(bytes("RIFF", 0, 0, 0, 0, "WEBP")), "a.webp")).toBe("WebP");
    expect(formatName(pad(bytes(0, 0, 0, 24, "ftypavif")), "a.avif")).toBe("AVIF");
    expect(formatName(pad(bytes(0, 0, 0, 24, "ftypmif1")), "a.heic")).toBe("HEIC");
    expect(formatName(new Uint8Array(12), "IMG_1.HEIF")).toBe("HEIC");
    expect(formatName(bytes("II", 42, 0), "_DSC7042.arw")).toBe("ARW");
    expect(formatName(new Uint8Array(4), "notes.txt")).toBeNull();
  });
});

describe("why a file could not be read", () => {
  const base = { rawPreviews: 0, failures: [], browserDecode: true } as const;

  test("a RAW says what is inside it, not what libjpeg said", () => {
    expect(unreadableReason({ ...base, route: "raw", format: "ARW" })).toMatch(
      /ARW file holds no preview picture a browser can show.*Export a JPEG/s,
    );
    const damaged = unreadableReason({
      ...base,
      route: "raw",
      format: "NEF",
      rawPreviews: 2,
      failures: [{ stage: "raw-preview", error: "Unsupported marker type 0xc3." }],
    });
    expect(damaged).toMatch(/preview picture inside this NEF file is damaged \(Unsupported marker/);
  });

  test("HEIC names Safari; a format the browser refused names the format", () => {
    expect(unreadableReason({ ...base, route: "browser", format: "HEIC" })).toMatch(/Safari/);
    expect(
      unreadableReason({
        ...base,
        route: "browser",
        format: "WebP",
        failures: [{ stage: "browser", error: "The source image could not be decoded." }],
      }),
    ).toMatch(/cannot decode this WebP file \(The source image could not be decoded\)/);
    expect(
      unreadableReason({ ...base, route: "browser", format: "PNG", browserDecode: false }),
    ).toMatch(/cannot decode PNG files in the background/);
    expect(unreadableReason({ ...base, route: "browser", format: null })).toMatch(
      /not a photo this browser can open/,
    );
  });

  test("a JPEG that beat both decoders says both failed", () => {
    expect(
      unreadableReason({
        ...base,
        route: "jpeg",
        format: "JPEG",
        failures: [
          { stage: "engine", error: "Not a JPEG file: starts with 0x00 0x00." },
          { stage: "browser", error: "The source image could not be decoded." },
        ],
      }),
    ).toMatch(/too damaged to read \(Not a JPEG file.*browser's own decoder failed too/s);
  });
});
