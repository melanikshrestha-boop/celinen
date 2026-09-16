import { describe, expect, test } from "bun:test";
import {
  frameAvailability,
  frameAvailabilityLabel,
  studioFrameHasVisiblePhoto,
  studioThumbPaint,
} from "../src/lib/studio/frame-availability";

describe("culling frame availability", () => {
  test("keeps decode failure distinct from ready, pending, and disconnected previews", () => {
    expect(frameAvailability({ error: "decode failed", previewUrl: null })).toBe("unreadable");
    expect(frameAvailability({ error: "", previewUrl: "blob:saved" })).toBe("unreadable");
    expect(frameAvailability({ previewUrl: "blob:ready", sourceAvailable: false })).toBe("ready");
    expect(frameAvailability({ previewUrl: null, sourceAvailable: false })).toBe("source-offline");
    expect(frameAvailability({ previewUrl: null })).toBe("preview-pending");
  });

  test("labels describe recovery state without inventing a culling verdict", () => {
    expect(frameAvailabilityLabel("unreadable")).toBe("unreadable; manual review required");
    expect(frameAvailabilityLabel("source-offline")).toBe("source offline; reconnect the original");
    expect(frameAvailabilityLabel("preview-pending")).toBe("preview pending");
    expect(frameAvailabilityLabel("ready")).toBe("preview ready");
  });

  test("classification does not mutate the source frame", () => {
    const frame = Object.freeze({
      error: "unsupported camera preview",
      previewUrl: null,
      sourceAvailable: false,
    });
    const before = structuredClone(frame);
    expect(frameAvailability(frame)).toBe("unreadable");
    expect(frame).toEqual(before);
  });

  test("filmstrip never paints a broken-image question mark", () => {
    expect(
      studioThumbPaint({ availability: "ready", previewUrl: "blob:ok", mime: "image/jpeg" }),
    ).toBe("image");
    expect(
      studioThumbPaint({ availability: "ready", previewUrl: "blob:untyped", mime: "" }),
    ).toBe("placeholder");
    expect(
      studioThumbPaint({
        availability: "ready",
        previewUrl: "blob:dead",
        mime: "image/jpeg",
        broken: true,
      }),
    ).toBe("placeholder");
    expect(studioThumbPaint({ availability: "preview-pending", previewUrl: null })).toBe(
      "placeholder",
    );
  });

  test("ghost frames without image bytes are not visible photos", () => {
    expect(studioFrameHasVisiblePhoto({ previewUrl: "blob:stale", file: new File([], "empty.jpg") })).toBe(
      false,
    );
    expect(
      studioFrameHasVisiblePhoto({
        previewUrl: null,
        previewBlob: new Blob(["x"]),
        file: new File([], "x.jpg"),
      }),
    ).toBe(false);
    expect(
      studioFrameHasVisiblePhoto({
        previewUrl: null,
        previewBlob: new Blob(["0123456789abcdef0123456789abcdef"]),
        file: new File([], "ok.jpg"),
      }),
    ).toBe(true);
    expect(studioFrameHasVisiblePhoto({ error: "decode failed", file: new File(["bytes-bytes-bytes-bytes"], "a.jpg") })).toBe(
      false,
    );
  });
});
