import { describe, expect, test } from "bun:test";
import { decodeNativeFrame } from "../src/lib/studio/native-client";

// Transport-only fixture: envelope boundaries are tested here. Actual JPEG
// decoding/orientation is covered by the native decoder's real-photo tests.
const preview = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9);
function metadata(): Record<string, unknown> {
  return {
    ok: true,
    engine: "lenslabs-cpp-test",
    width: 256,
    height: 192,
    source_width: 4000,
    source_height: 3000,
    preview_bytes: preview.length,
    sharpness: 152.75,
    brightness: 123.5,
    clipped_highlights: 2.5,
    clipped_shadows: 1.25,
    hash: "8000000000000001",
    tone: {
      black: 8,
      white: 244,
      median: 119,
      rMean: 120.5,
      gMean: 123.75,
      bMean: 131,
      satMean: 0.42,
    },
    captured_at_ms: 1756713600123,
    camera_key: "camera-body-serial",
    capture_time_basis: "utc",
    cached: true,
  };
}
function envelope(frame = metadata(), jpeg = preview): ArrayBuffer {
  return rawEnvelope(JSON.stringify(frame), jpeg);
}
function rawEnvelope(header: string, jpeg = preview): ArrayBuffer {
  const encoded = new TextEncoder().encode(`${header}\n`);
  const bytes = new Uint8Array(encoded.length + jpeg.length);
  bytes.set(encoded);
  bytes.set(jpeg, encoded.length);
  return bytes.buffer;
}

describe("decodeNativeFrame", () => {
  test("maps native analysis, tone, cache, metadata and exact 64-bit hash", async () => {
    const decoded = decodeNativeFrame(envelope());
    expect(decoded.width).toBe(256);
    expect(decoded.height).toBe(192);
    expect(decoded.backend).toBe("native-cpp");
    expect(decoded.nativeCached).toBe(true);
    expect(decoded.faceDetectionAvailable).toBe(false);
    expect(decoded.captureTimeMs).toBe(1756713600123);
    expect(decoded.captureTimeBasis).toBe("utc");
    expect(decoded.cameraKey).toBe("camera-body-serial");
    expect(decoded.analysis).toEqual({
      sharpness: 152.75,
      brightness: 123.5,
      clippedHighlights: 2.5,
      clippedShadows: 1.25,
      hash: `1${"0".repeat(62)}1`,
      tone: metadata()["tone"],
    });
    expect(decoded.previewBlob.type).toBe("image/jpeg");
    expect(new Uint8Array(await decoded.previewBlob.arrayBuffer())).toEqual(preview);
  });

  test("preserves unzoned camera-clock basis without normalizing it to UTC", () => {
    const decoded = decodeNativeFrame(
      envelope({ ...metadata(), capture_time_basis: "camera_clock" }),
    );
    expect(decoded.captureTimeBasis).toBe("camera_clock");
    expect(decoded.captureTimeMs).toBe(1756713600123);
  });

  test("absent/null metadata does not fabricate a camera, date or cached result", () => {
    const absent = metadata();
    for (const key of ["captured_at_ms", "camera_key", "capture_time_basis", "cached"])
      delete absent[key];
    const decoded = decodeNativeFrame(envelope(absent));
    expect(decoded.nativeCached).toBe(false);
    expect(decoded.captureTimeMs).toBeUndefined();
    expect(decoded.cameraKey).toBeUndefined();
    expect(decoded.captureTimeBasis).toBeUndefined();
    const nullable = decodeNativeFrame(
      envelope({ ...absent, captured_at_ms: null, camera_key: null, capture_time_basis: null }),
    );
    expect(nullable.captureTimeMs).toBeUndefined();
    expect(nullable.cameraKey).toBeUndefined();
    expect(nullable.captureTimeBasis).toBeUndefined();
    expect(decodeNativeFrame(envelope({ ...absent, camera_key: "" })).cameraKey).toBeUndefined();
  });

  test("hex hashes preserve leading zeros, high bits and case without Number precision loss", () => {
    for (const [hash, expected] of [
      ["0000000000000000", "0".repeat(64)],
      ["0000000000000001", `${"0".repeat(63)}1`],
      ["FFFFFFFFFFFFFFFF", "1".repeat(64)],
      ["AAAAAAAAAAAAAAAA", "10".repeat(32)],
    ])
      expect(decodeNativeFrame(envelope({ ...metadata(), hash })).analysis.hash).toBe(expected);
  });

  test("requires every native receipt field and every tone channel", () => {
    for (const key of [
      "ok",
      "engine",
      "width",
      "height",
      "source_width",
      "source_height",
      "preview_bytes",
      "sharpness",
      "brightness",
      "clipped_highlights",
      "clipped_shadows",
      "hash",
      "tone",
    ]) {
      const frame = metadata();
      delete frame[key];
      expect(() => decodeNativeFrame(envelope(frame))).toThrow();
    }
    for (const channel of ["black", "white", "median", "rMean", "gMean", "bMean", "satMean"]) {
      const frame = metadata();
      delete (frame["tone"] as Record<string, unknown>)[channel];
      expect(() => decodeNativeFrame(envelope(frame))).toThrow();
    }
  });

  test("rejects malformed dimensions, bounds, flags and camera metadata", () => {
    const invalid: Array<[string, unknown]> = [
      ["ok", false],
      ["engine", 4],
      ["width", 0],
      ["height", 2049],
      ["width", 256.5],
      ["source_width", 0],
      ["source_height", -1],
      ["preview_bytes", 3],
      ["preview_bytes", 16 * 1024 * 1024 + 1],
      ["sharpness", -1],
      ["sharpness", 1e9 + 1],
      ["brightness", 255.01],
      ["clipped_highlights", 100.01],
      ["clipped_shadows", -0.01],
      ["hash", "0".repeat(15)],
      ["hash", "0".repeat(17)],
      ["hash", "x".repeat(16)],
      ["cached", "true"],
      ["captured_at_ms", 0],
      ["captured_at_ms", 3.5],
      ["camera_key", "x".repeat(513)],
      ["capture_time_basis", "local"],
    ];
    for (const [key, value] of invalid)
      expect(() => decodeNativeFrame(envelope({ ...metadata(), [key]: value }))).toThrow();
  });

  test("rejects out-of-range and nonfinite tone or analysis signals", () => {
    for (const channel of ["black", "white", "median", "rMean", "gMean", "bMean"]) {
      const frame = metadata();
      (frame["tone"] as Record<string, unknown>)[channel] = 256;
      expect(() => decodeNativeFrame(envelope(frame))).toThrow();
    }
    for (const [channel, value] of [
      ["median", 0],
      ["satMean", -0.1],
      ["satMean", 1.1],
    ] as const) {
      const frame = metadata();
      (frame["tone"] as Record<string, unknown>)[channel] = value;
      expect(() => decodeNativeFrame(envelope(frame))).toThrow();
    }
    for (const key of ["sharpness", "brightness", "clipped_highlights", "clipped_shadows"]) {
      const header = JSON.stringify({ ...metadata(), [key]: "NONFINITE" }).replace(
        '"NONFINITE"',
        "1e999",
      );
      expect(() => decodeNativeFrame(rawEnvelope(header))).toThrow();
    }
    const frame = metadata();
    (frame["tone"] as Record<string, unknown>)["rMean"] = "NONFINITE";
    expect(() =>
      decodeNativeFrame(rawEnvelope(JSON.stringify(frame).replace('"NONFINITE"', "-1e999"))),
    ).toThrow();
  });

  test("rejects missing/oversize headers, invalid UTF-8, JSON and oversized envelopes", () => {
    expect(() => decodeNativeFrame(new ArrayBuffer(0))).toThrow("incomplete");
    expect(() =>
      decodeNativeFrame(new TextEncoder().encode(JSON.stringify(metadata())).buffer),
    ).toThrow("incomplete");
    expect(() => decodeNativeFrame(rawEnvelope(" ".repeat(65537)))).toThrow("incomplete");
    expect(() => decodeNativeFrame(Uint8Array.of(0xff, 10, ...preview).buffer)).toThrow();
    for (const header of ["{", "null", "[]", "true", "{}"])
      expect(() => decodeNativeFrame(rawEnvelope(header))).toThrow();
    expect(() => decodeNativeFrame(new ArrayBuffer(16 * 1024 * 1024 + 65537))).toThrow("exceeds");
  });

  test("rejects length mismatches, missing JPEG markers and appended garbage", () => {
    expect(() =>
      decodeNativeFrame(envelope({ ...metadata(), preview_bytes: preview.length + 1 })),
    ).toThrow("truncated or malformed");
    expect(() => decodeNativeFrame(envelope(metadata(), preview.slice(0, -1)))).toThrow(
      "truncated or malformed",
    );
    const wrongStart = preview.slice();
    wrongStart[0] = 0;
    const wrongEnd = preview.slice();
    wrongEnd[wrongEnd.length - 1] = 0;
    expect(() => decodeNativeFrame(envelope(metadata(), wrongStart))).toThrow(
      "truncated or malformed",
    );
    expect(() => decodeNativeFrame(envelope(metadata(), wrongEnd))).toThrow(
      "truncated or malformed",
    );
    expect(() => decodeNativeFrame(envelope(metadata(), Uint8Array.of(...preview, 1)))).toThrow(
      "truncated or malformed",
    );
  });

  test("does not mutate or alias the caller's native buffer after receipt parsing", async () => {
    const input = envelope();
    const before = new Uint8Array(input).slice();
    const decoded = decodeNativeFrame(input);
    expect(new Uint8Array(input)).toEqual(before);
    new Uint8Array(input).fill(0);
    expect(new Uint8Array(await decoded.previewBlob.arrayBuffer())).toEqual(preview);
  });
});
