import { createHash } from "node:crypto";
import { jpegHeaderDimensions } from "./media-integrity";

// Browser-rendered deliveries have a short header. Never retain the full image in the Worker.
export const JPEG_HEADER_BUDGET = 256 * 1024;
export async function verifyJpegStream(
  stream: ReadableStream<Uint8Array>,
  expected: { bytes: number; sha256: string; width: number; height: number },
  signal?: AbortSignal,
) {
  const reader = stream.getReader();
  const hash = createHash("sha256");
  const header = new Uint8Array(JPEG_HEADER_BUDGET);
  let total = 0,
    headerSize = 0,
    penultimate = -1,
    last = -1;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > expected.bytes) throw new Error("Uploaded file size exceeds its reservation.");
      hash.update(value);
      const take = Math.min(value.byteLength, header.length - headerSize);
      header.set(value.subarray(0, take), headerSize);
      headerSize += take;
      if (value.length > 1) penultimate = value[value.length - 2]!;
      else if (value.length) penultimate = last;
      if (value.length) last = value[value.length - 1]!;
    }
    if (total !== expected.bytes)
      throw new Error("Uploaded file size does not match its reservation.");
    if (hash.digest("hex") !== expected.sha256)
      throw new Error("Upload checksum mismatch. This version was not accepted.");
    if (total < 14 || penultimate !== 0xff || last !== 0xd9)
      throw new Error("Truncated JPEG image.");
    const dimensions = jpegHeaderDimensions(header.subarray(0, headerSize));
    if (dimensions.width !== expected.width || dimensions.height !== expected.height)
      throw new Error("Uploaded dimensions do not match the reserved rendition.");
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
