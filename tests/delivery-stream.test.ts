import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { jpegDimensions } from "../src/lib/delivery/media-integrity";
import { verifyJpegStream } from "../src/lib/delivery/verify-stream.server";

const bytes = new Uint8Array(
  await Bun.file(
    new URL("./fixtures/delivery/delivery-proof-usaf-pd.jpg", import.meta.url),
  ).arrayBuffer(),
);
const expected = {
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  ...jpegDimensions(bytes),
};
function chunks(data: Uint8Array, chunkSize = 16384) {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === data.length) {
        controller.close();
        return;
      }
      const end = Math.min(data.length, offset + chunkSize);
      controller.enqueue(data.slice(offset, end));
      offset = end;
    },
  });
}
test("streaming verifies real JPEG with frame and EOI markers crossing chunk boundaries", async () => {
  await verifyJpegStream(chunks(bytes, 997), expected);
  await verifyJpegStream(chunks(bytes, 1), expected);
});
test("streaming refuses wrong length, digest, dimensions and missing end marker", async () => {
  await expect(
    verifyJpegStream(chunks(bytes), { ...expected, bytes: bytes.length - 1 }),
  ).rejects.toThrow("exceeds");
  await expect(
    verifyJpegStream(chunks(bytes), { ...expected, bytes: bytes.length + 1 }),
  ).rejects.toThrow("size");
  await expect(
    verifyJpegStream(chunks(bytes), { ...expected, sha256: "0".repeat(64) }),
  ).rejects.toThrow("checksum");
  await expect(
    verifyJpegStream(chunks(bytes), { ...expected, width: expected.width + 1 }),
  ).rejects.toThrow("dimensions");
  const truncated = bytes.slice(0, -2);
  await expect(
    verifyJpegStream(chunks(truncated), {
      ...expected,
      bytes: truncated.length,
      sha256: createHash("sha256").update(truncated).digest("hex"),
    }),
  ).rejects.toThrow("Truncated");
});
test("oversize stream is cancelled without reading its remaining body", async () => {
  let reads = 0,
    cancelled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        reads++;
        controller.enqueue(new Uint8Array(1024));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  await expect(verifyJpegStream(stream, { ...expected, bytes: 1 })).rejects.toThrow("exceeds");
  expect(reads).toBe(1);
  expect(cancelled).toBe(true);
});
test("timeout cancels a stalled body and releases its reader", async () => {
  let cancelled = false;
  const controller = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const pending = verifyJpegStream(stream, expected, controller.signal);
  controller.abort(new Error("test timeout"));
  await expect(pending).rejects.toThrow("test timeout");
  expect(cancelled).toBe(true);
  expect(stream.locked).toBe(false);
});
test("SOF-only forged JPEG is rejected even when the supplied checksum matches", async () => {
  const fake = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0, 1, 0, 1, 0, 0xff, 0xd9]);
  await expect(
    verifyJpegStream(chunks(fake), {
      bytes: fake.length,
      sha256: createHash("sha256").update(fake).digest("hex"),
      width: 1,
      height: 1,
    }),
  ).rejects.toThrow("Invalid JPEG");
});
