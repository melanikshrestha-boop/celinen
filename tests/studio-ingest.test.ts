import { describe, expect, test } from "bun:test";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";
import { mergeIngestedShots, sidecarKey, uniquePhotos } from "../src/lib/studio/ingest";

const shot = (id: string, patch: Partial<Shot> = {}): Shot => ({
  id,
  file: new File([id], `${id}.jpg`),
  name: `${id}.jpg`,
  isRaw: false,
  previewUrl: null,
  width: 100,
  height: 100,
  sizeMb: 1,
  sharpness: 100,
  brightness: 100,
  clippedHighlights: 0,
  clippedShadows: 0,
  hash: "1".repeat(64),
  score: 75,
  flags: [],
  verdict: "undecided",
  edits: { ...DEFAULT_EDITS },
  ...patch,
});

describe("progressive ingest", () => {
  test("XMP matching isolates cards with repeated camera filenames", () => {
    const file = (path: string) => {
      const result = new File([""], path.split("/").pop()!);
      Object.defineProperty(result, "webkitRelativePath", { value: path });
      return result;
    };
    expect(sidecarKey(file("card-A/IMG_0001.JPG"))).toBe(sidecarKey(file("card-A/IMG_0001.xmp")));
    expect(sidecarKey(file("card-A/IMG_0001.JPG"))).not.toBe(
      sidecarKey(file("card-B/IMG_0001.xmp")),
    );
  });
  test("a failed reconnect cannot degrade a saved preview or decision", () => {
    const saved = shot("a", { previewUrl: "blob:saved", verdict: "keep", sourceAvailable: false });
    const next = mergeIngestedShots([saved], [shot("a", { error: "Decode failed", hash: "" })]);
    expect(next[0]).toBe(saved);
    expect(next[0]?.hash).toBe("1".repeat(64));
  });
  test("late previews preserve decisions and order from live review", () => {
    const picked = shot("a", { verdict: "keep", edits: { ...DEFAULT_EDITS, exposure: 22 } });
    const next = mergeIngestedShots(
      [picked, shot("b")],
      [shot("a", { sourceAvailable: true }), shot("c")],
    );
    expect(next.map((frame) => frame.id)).toEqual(["a", "b", "c"]);
    expect(next[0]?.verdict).toBe("keep");
    expect(next[0]?.edits.exposure).toBe(22);
    expect(next[0]?.sourceAvailable).toBe(true);
    expect(picked.edits.exposure).toBe(22);
  });

  test("directory extras and duplicate file entries do not become broken frames", () => {
    const jpeg = new File(["photo"], "frame.jpg", { lastModified: 123 });
    const raw = new File(["raw"], "frame.NEF", { lastModified: 123 });
    expect(
      uniquePhotos([jpeg, jpeg, raw, new File([""], ".DS_Store"), new File([""], "frame.xmp")]),
    ).toEqual([jpeg, raw]);
  });
});
