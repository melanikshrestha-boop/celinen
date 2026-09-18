/** XMP inside a JPEG: Lightroom reads a JPEG's rating and keywords from the
 * file itself and ignores a sidecar beside it, so a JPEG-only shooter's
 * ratings must be written into the copy.
 *
 * Nothing here loads the photo into memory. The header segments are read in
 * small slices, and the result is a Blob stitched from slices of the original
 * around one new APP1 segment, so the copy still streams from disk.
 */

/** Standard XMP APP1 namespace header (XMP spec part 3, 1.1.3). */
const XMP_HEADER = "http://ns.adobe.com/xap/1.0/\0";
/** Largest packet a single APP1 can hold: 65535 − 2 length bytes − 29 header bytes. */
export const MAX_JPEG_XMP_BYTES = 65535 - 2 - XMP_HEADER.length;

export class JpegXmpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JpegXmpError";
  }
}

type Segment = { marker: number; start: number; end: number };

async function bytesAt(blob: Blob, start: number, length: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
}

/** Walks the segments before the image data. Stops at the first segment that
 * is not APPn or COM — XMP must sit among the leading metadata segments. */
async function leadingSegments(blob: Blob): Promise<{ segments: Segment[]; bodyStart: number }> {
  const soi = await bytesAt(blob, 0, 2);
  if (soi[0] !== 0xff || soi[1] !== 0xd8) throw new JpegXmpError("Not a JPEG file.");
  const segments: Segment[] = [];
  let at = 2;
  for (;;) {
    const head = await bytesAt(blob, at, 4);
    if (head.length < 4 || head[0] !== 0xff) throw new JpegXmpError("Malformed JPEG header.");
    const marker = head[1]!;
    // Fill bytes (0xFF 0xFF …) may pad before a marker.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    const isApp = marker >= 0xe0 && marker <= 0xef;
    if (!isApp && marker !== 0xfe) return { segments, bodyStart: at };
    const length = (head[2]! << 8) | head[3]!;
    if (length < 2 || at + 2 + length > blob.size)
      throw new JpegXmpError("Truncated JPEG segment.");
    segments.push({ marker, start: at, end: at + 2 + length });
    at += 2 + length;
  }
}

async function isStandardXmp(blob: Blob, segment: Segment): Promise<boolean> {
  if (segment.marker !== 0xe1 || segment.end - segment.start < 4 + XMP_HEADER.length) return false;
  const header = await bytesAt(blob, segment.start + 4, XMP_HEADER.length);
  return new TextDecoder("latin1").decode(header) === XMP_HEADER;
}

/** The embedded standard XMP packet, or null when the JPEG has none. */
export async function readJpegXmp(blob: Blob): Promise<string | null> {
  const { segments } = await leadingSegments(blob);
  for (const segment of segments) {
    if (await isStandardXmp(blob, segment)) {
      const start = segment.start + 4 + XMP_HEADER.length;
      return new TextDecoder("utf-8").decode(await bytesAt(blob, start, segment.end - start));
    }
  }
  return null;
}

/**
 * A copy of the JPEG whose standard XMP packet is `packetFor(existing)`.
 * `existing` is the packet already in the file, so the caller can merge into
 * it. The old packet is replaced in place; with none, the new one goes after
 * the leading JFIF/Exif segments, where readers look first. Extended XMP and
 * every other segment are kept as they are.
 */
export async function embedJpegXmp(
  blob: Blob,
  packetFor: (existing: string | null) => string,
): Promise<Blob> {
  const { segments } = await leadingSegments(blob);
  let old: Segment | undefined;
  for (const segment of segments) {
    if (await isStandardXmp(blob, segment)) {
      old = segment;
      break;
    }
  }
  const existing = old
    ? new TextDecoder("utf-8").decode(
        await bytesAt(
          blob,
          old.start + 4 + XMP_HEADER.length,
          old.end - old.start - 4 - XMP_HEADER.length,
        ),
      )
    : null;

  const packet = new TextEncoder().encode(packetFor(existing));
  if (packet.length > MAX_JPEG_XMP_BYTES) {
    throw new JpegXmpError("The XMP packet is too large to embed in one JPEG segment.");
  }
  const header = new TextEncoder().encode(XMP_HEADER);
  const length = 2 + header.length + packet.length;
  const segment = new Uint8Array(2 + length);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment[2] = length >> 8;
  segment[3] = length & 0xff;
  segment.set(header, 4);
  segment.set(packet, 4 + header.length);

  let cut: number;
  let resume: number;
  if (old) {
    cut = old.start;
    resume = old.end;
  } else {
    // After the leading run of APP0 (JFIF) and Exif APP1 segments.
    let after = 2;
    for (const s of segments) {
      if (s.marker === 0xe0 || s.marker === 0xe1) after = s.end;
      else break;
    }
    cut = after;
    resume = after;
  }
  return new Blob([blob.slice(0, cut), segment as BlobPart, blob.slice(resume)], {
    type: blob.type || "image/jpeg",
  });
}
