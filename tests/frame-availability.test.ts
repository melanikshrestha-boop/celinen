import { describe, expect, test } from "bun:test";
import { frameAvailability, frameAvailabilityLabel } from "../src/lib/studio/frame-availability";

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
});
