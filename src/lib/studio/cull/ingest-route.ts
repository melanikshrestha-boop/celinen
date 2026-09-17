/** How the ingest worker reads a file, and what it says when nothing could.
 *
 * The rule: a photo is never called unreadable while some decoder on this
 * device can open it. Camera JPEGs go to the C++ engine (libjpeg, scaled in the
 * DCT); RAW files to their best embedded preview, then the next one; everything
 * else (WebP, PNG, GIF, AVIF, HEIC in Safari) to the browser's own decoder,
 * whose pixels the same C++ then measures. Only when every path has failed is
 * the frame marked unreadable, with the reason in plain words.
 */

export type IngestRoute = "jpeg" | "raw" | "browser";

/** Leading bytes that settle the route and name the format. */
export const SNIFF_BYTES = 32;

const ascii = (bytes: Uint8Array, at: number, text: string) => {
  if (bytes.length < at + text.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
};

/** TIFF-based RAWs (ARW, NEF, CR2, DNG, PEF, ORF, RW2), Canon CR3 and Fujifilm RAF. */
export function isRawContainer(head: Uint8Array): boolean {
  if (head.length >= 4) {
    const ii = head[0] === 0x49 && head[1] === 0x49;
    const mm = head[0] === 0x4d && head[1] === 0x4d;
    const magic = ii ? head[2]! | (head[3]! << 8) : (head[2]! << 8) | head[3]!;
    // 42 TIFF; 0x4f52 / 0x5352 Olympus ORF; 0x55 Panasonic RW2.
    if ((ii || mm) && (magic === 42 || magic === 0x4f52 || magic === 0x5352 || magic === 0x55))
      return true;
  }
  return ascii(head, 4, "ftypcrx ") || ascii(head, 0, "FUJIFILMCCD-RAW ");
}

export function ingestRoute(head: Uint8Array): IngestRoute {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (isRawContainer(head)) return "raw";
  return "browser";
}

/** A name for the file's format, from its bytes first and its name second. */
export function formatName(head: Uint8Array, fileName: string): string | null {
  if (ascii(head, 0, "\x89PNG")) return "PNG";
  if (ascii(head, 0, "RIFF") && ascii(head, 8, "WEBP")) return "WebP";
  if (ascii(head, 0, "GIF8")) return "GIF";
  if (ascii(head, 0, "BM")) return "BMP";
  if (ascii(head, 4, "ftyp")) {
    const brand = String.fromCharCode(...head.subarray(8, 12));
    if (brand === "avif" || brand === "avis") return "AVIF";
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heim", "heis"].includes(brand))
      return "HEIC";
    if (brand === "crx ") return "CR3";
  }
  const extension = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  if (extension === "heic" || extension === "heif") return "HEIC";
  if (extension === "tif" || extension === "tiff") return "TIFF";
  if (isRawContainer(head)) return extension ? extension.toUpperCase() : "RAW";
  if (extension === "jpg" || extension === "jpeg") return "JPEG";
  return null;
}

export type ReadFailure = {
  /** Which decoder said so. */
  stage: "engine" | "raw-preview" | "browser";
  error: string;
};

/** The browser has no ImageBitmap / OffscreenCanvas in workers. */
export class BrowserDecodeUnavailable extends Error {
  constructor() {
    super("This browser cannot decode images in a background worker.");
    this.name = "BrowserDecodeUnavailable";
  }
}

export type UnreadableInput = {
  route: IngestRoute;
  format: string | null;
  /** Previews the RAW container holds that a browser could show. */
  rawPreviews: number;
  failures: readonly ReadFailure[];
  /** False when the browser path could not even be tried. */
  browserDecode: boolean;
};

const detail = (failure: ReadFailure | undefined) =>
  failure?.error ? ` (${failure.error.replace(/\.$/, "")})` : "";

/** Why a file could not be read, once every path has failed. */
export function unreadableReason(input: UnreadableInput): string {
  const engine = input.failures.find((f) => f.stage === "engine");
  const preview = input.failures.find((f) => f.stage === "raw-preview");
  const browser = input.failures.find((f) => f.stage === "browser");
  const format = input.format;

  if (input.route === "raw") {
    const inside =
      input.rawPreviews > 0
        ? `The preview picture inside this ${format ?? "RAW"} file is damaged${detail(preview)}`
        : `This ${format ?? "RAW"} file holds no preview picture a browser can show`;
    return `${inside}, and this browser cannot develop RAW sensor data. Export a JPEG from the camera or your editor and import that.`;
  }
  if (input.route === "jpeg") {
    return input.browserDecode
      ? `This JPEG is too damaged to read${detail(engine)}; the browser's own decoder failed too${detail(browser)}.`
      : `This JPEG is too damaged to read${detail(engine)}.`;
  }
  if (format === "HEIC")
    return "This browser cannot open HEIC photos; Safari can. Open Celinen in Safari, or export the photo as JPEG.";
  if (!input.browserDecode)
    return `This browser cannot decode ${format ?? "these"} files in the background, so they cannot be read here. Import JPEG or RAW files, or use a current Chrome, Edge, Firefox or Safari.`;
  if (format)
    return `This browser cannot decode this ${format} file${detail(browser)}. It may be damaged, or use a variant this browser does not support.`;
  return `This file is not a photo this browser can open${detail(browser)}.`;
}
