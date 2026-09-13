import { describe, expect, test } from "bun:test";
import { decodeNativeFrame } from "../src/lib/studio/native-client";

function frame(patch: Record<string, unknown> = {}): ArrayBuffer {
  const metadata = {
    ok: true,
    engine: "lenslabs-cpp-0.1",
    width: 960,
    height: 640,
    source_width: 6000,
    source_height: 4000,
    analysis_width: 256,
    analysis_height: 171,
    preview_bytes: 4,
    preview_origin: "embedded_raw_jpeg",
    sharpness: 150,
    brightness: 120,
    clipped_highlights: 0,
    clipped_shadows: 0,
    hash: "0123456789abcdef",
    tone: { black: 0, white: 255, median: 120, rMean: 120, gMean: 120, bMean: 120, satMean: 0.2 },
    ...patch,
  };
  const header = new TextEncoder().encode(JSON.stringify(metadata) + "\n");
  const bytes = new Uint8Array(header.length + 4);
  bytes.set(header);
  bytes.set([0xff, 0xd8, 0xff, 0xd9], header.length);
  return bytes.buffer;
}

describe("native preview provenance", () => {
  test("retains the actual worker version, decoded representation and source dimensions", () => {
    const receipt = decodeNativeFrame(frame());
    expect(receipt.nativeEngineVersion).toBe("lenslabs-cpp-0.1");
    expect(receipt.previewOrigin).toBe("embedded_raw_jpeg");
    expect([receipt.sourceWidth, receipt.sourceHeight]).toEqual([6000, 4000]);
    expect([receipt.width, receipt.height]).toEqual([960, 640]);
    expect([receipt.analysisWidth, receipt.analysisHeight]).toEqual([256, 171]);
    expect(receipt.analysis.hash).toHaveLength(64);
  });

  test("old frames remain readable without inventing embedded-preview evidence", () => {
    expect(decodeNativeFrame(frame({ preview_origin: undefined })).previewOrigin).toBe("unknown");
    expect(decodeNativeFrame(frame({ preview_origin: "raster_decode" })).previewOrigin).toBe(
      "raster_decode",
    );
    expect(() => decodeNativeFrame(frame({ preview_origin: "sensor-ai" }))).toThrow();
  });

  test("timings are optional measured durations and malformed measurements fail closed", () => {
    const timings = {
      decode_total: 4,
      source_open: 0.3,
      raw_extract: 0.4,
      imageio_decode_resize: 1,
      rgba: 0.2,
      analysis_resize: 0.5,
      analysis: 0.6,
      metadata: 0.1,
      jpeg_encode: 0.9,
    };
    expect(decodeNativeFrame(frame()).nativeTimingsMs).toBeUndefined();
    expect(decodeNativeFrame(frame({ timings_ms: timings })).nativeTimingsMs).toEqual(timings);
    expect(() =>
      decodeNativeFrame(frame({ timings_ms: { ...timings, raw_extract: -1 } })),
    ).toThrow();
  });
});
