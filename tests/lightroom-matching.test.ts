import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";
import {
  checkedLightroomFrames,
  checkedLightroomVerdicts,
  createLightroomVerdicts,
  matchesLightroomPath,
  mergeLightroomFrames,
  relativeLightroomPath,
} from "../src/lib/lightroom-matching";

const shot = (relativePath: string, patch: Partial<Shot> = {}): Shot => ({
  id: relativePath,
  name: relativePath.split("/").at(-1)!,
  relativePath,
  file: new File(["QA original"], relativePath.split("/").at(-1)!),
  isRaw: true,
  previewUrl: null,
  width: 100,
  height: 100,
  sizeMb: 1,
  sharpness: 0,
  brightness: 100,
  clippedHighlights: 0,
  clippedShadows: 0,
  hash: "qa",
  score: 55,
  flags: [],
  verdict: "undecided",
  edits: { ...DEFAULT_EDITS },
  develop: {
    origin: "sidecar",
    at: 1,
    rating: 2,
    label: "Existing label",
    caption: "Original caption",
  },
  ...patch,
});
const frame = (path: string, patch = {}) => ({
  file: path.replace(/\\/g, "/").split("/").at(-1)!,
  path,
  rating: 5,
  pick: -1,
  ...patch,
});

describe("folder-matched Lightroom handoff", () => {
  test("same camera filenames, nested folders and extensions match independently", () => {
    const shots = [shot("Card A/IMG.ARW"), shot("Card B/IMG.ARW"), shot("Card A/IMG.JPG")];
    const result = mergeLightroomFrames(
      shots,
      [frame("/Photos/Card B/IMG.ARW"), frame("/Photos/Card A/IMG.ARW", { pick: 1 })],
      10,
    );
    expect(result.matched).toBe(2);
    expect(result.unmatched).toBe(1);
    expect(result.shots.map((item) => item.verdict)).toEqual(["keep", "reject", "undecided"]);
    expect(result.shots[2]).toBe(shots[2]);
    expect(shots[0]!.verdict).toBe("undecided");
  });
  test("suffix matching requires full path segments, not Contains or basename", () => {
    for (const path of [
      "/Photos/OtherCard/IMG.ARW",
      "/Photos/NotCard A/IMG.ARW",
      "/Photos/Card A/IMG.JPG",
      "/Photos/Card A/IMG_10.ARW",
      "Card A/IMG.ARW",
    ])
      expect(matchesLightroomPath("Card A/IMG.ARW", path)).toBe(false);
    expect(matchesLightroomPath("Card A/IMG.ARW", "/Photos/Card A/IMG.ARW")).toBe(true);
  });
  test("Windows and UNC separators are understood without case guessing", () => {
    expect(relativeLightroomPath("IMG.ARW", "Card A\\IMG.ARW")).toBe("Card A/IMG.ARW");
    expect(matchesLightroomPath("Card A/IMG.ARW", "C:\\Photos\\Card A\\IMG.ARW")).toBe(true);
    expect(matchesLightroomPath("Card A/IMG.ARW", "\\\\server\\Photos\\Card A\\IMG.ARW")).toBe(
      true,
    );
    expect(matchesLightroomPath("Card A/IMG.ARW", "C:\\Photos\\card a\\IMG.ARW")).toBe(false);
  });
  test("exact international names match; different normalization is not silently aliased", () => {
    expect(matchesLightroomPath("Café 📷/IMG.ARW", "/Photos/Café 📷/IMG.ARW")).toBe(true);
    expect(matchesLightroomPath("Café 📷/IMG.ARW", "/Photos/Cafe\u0301 📷/IMG.ARW")).toBe(false);
  });
  test("loose, mismatched and traversal paths never enable filename fallback", () => {
    for (const path of [
      undefined,
      "IMG.ARW",
      "/Card/IMG.ARW",
      "C:/Card/IMG.ARW",
      "../IMG.ARW",
      "Card/../IMG.ARW",
      "Card//IMG.ARW",
      "Card/other.ARW",
      "Card\n/IMG.ARW",
    ])
      expect(() => relativeLightroomPath("IMG.ARW", path)).toThrow("matching source folder");
    expect(() =>
      mergeLightroomFrames([shot("IMG.ARW")], [frame("/Photos/Card A/IMG.ARW")], 10),
    ).toThrow("matching source folder");
    expect(
      mergeLightroomFrames([shot("Card A/IMG.ARW")], [{ file: "IMG.ARW", pick: 1 }], 10).matched,
    ).toBe(0);
  });
  test("duplicate native paths and virtual copies abort without touching a safe preceding photo", () => {
    const shots = [shot("Card/SAFE.ARW"), shot("Card/IMG.ARW")];
    const before = JSON.stringify(shots);
    expect(() =>
      mergeLightroomFrames(
        shots,
        [
          frame("/Photos/Card/SAFE.ARW"),
          frame("/Photos/Card/IMG.ARW"),
          frame("/Photos/Card/IMG.ARW", { uuid: "virtual-copy", pick: 1 }),
        ],
        10,
      ),
    ).toThrow("ambiguous");
    expect(JSON.stringify(shots)).toBe(before);
  });
  test("one remote frame cannot mutate two local source records", () => {
    expect(() =>
      mergeLightroomFrames(
        [shot("Card/IMG.ARW"), shot("Card/IMG.ARW", { id: "second" })],
        [frame("/Photos/Card/IMG.ARW")],
        10,
      ),
    ).toThrow("ambiguous");
  });
  test("a unique match preserves unprovided metadata and unrelated edits", () => {
    const source = shot("Card/IMG.ARW", { edits: { ...DEFAULT_EDITS, crop: "4:5", temp: 20 } });
    const result = mergeLightroomFrames(
      [source],
      [frame("/Photos/Card/IMG.ARW", { develop: { exposure: 2 }, label: undefined })],
      20,
    );
    expect(result.shots[0]).toMatchObject({
      verdict: "reject",
      edits: { exposure: 40, crop: "4:5", temp: 20 },
      develop: { rating: 5, label: "Existing label", caption: "Original caption", at: 20 },
    });
    expect(source.edits.exposure).toBe(0);
  });
  test("invalid batch fields and excessive counts fail before application", () => {
    for (const invalid of [
      null,
      {},
      "frames",
      [null],
      [{ file: 2 }],
      [{ file: "a/b.ARW" }],
      [{ file: "IMG\n.ARW" }],
      [frame("/Photos/Card/IMG.ARW", { rating: NaN })],
      [frame("/Photos/Card/IMG.ARW", { rating: -0.5 })],
      [frame("/Photos/Card/IMG.ARW", { rating: 2.5 })],
      [frame("/Photos/Card/IMG.ARW", { path: {} })],
      [frame("/Photos/Card/IMG.ARW", { uuid: [] })],
      [frame("/Photos/Card/IMG.ARW", { iptc: [] })],
      [frame("/Photos/Card/IMG.ARW", { package: 123 })],
      [frame("/Photos/Card/IMG.ARW", { pick: 2 })],
      [frame("/Photos/Card/IMG.ARW", { develop: { exposure: "2" } })],
      [frame("/Photos/Card/IMG.ARW", { develop: { cropped: "true" } })],
      [frame("/Photos/Card/IMG.ARW", { label: {} })],
      Array.from({ length: 5001 }, () => frame("/Photos/Card/IMG.ARW")),
    ])
      expect(() => checkedLightroomFrames(invalid)).toThrow();
  });
  test("outgoing verdicts retain folder paths, original stars and separate picks", () => {
    const data = createLightroomVerdicts([
      shot("Card A/IMG.ARW", { verdict: "reject", score: 99 }),
      shot("Card B/IMG.ARW", { verdict: "undecided" }),
    ]);
    expect(data.map((item) => item.relativePath)).toEqual(["Card A/IMG.ARW", "Card B/IMG.ARW"]);
    expect(data[0]).toMatchObject({
      file: "IMG.ARW",
      verdict: "reject",
      rating: 2,
      score: 99,
      label: "Existing label",
    });
    expect(data[1]!.verdict).toBe("undecided");
  });
  test("outgoing malformed, duplicate and oversized batches are rejected, not truncated", () => {
    expect(() => createLightroomVerdicts([shot("IMG.ARW")])).toThrow();
    expect(() => createLightroomVerdicts([shot("Card/IMG.ARW"), shot("Card/IMG.ARW")])).toThrow(
      "duplicate",
    );
    expect(() =>
      checkedLightroomVerdicts([
        { file: "IMG.ARW", relativePath: "Card/IMG.ARW", verdict: "keep", rating: 2.5 },
      ]),
    ).toThrow("stars");
    expect(() =>
      checkedLightroomVerdicts([
        { file: "IMG.ARW", relativePath: "Card/IMG.ARW", verdict: "oops" },
      ]),
    ).toThrow();
    expect(() => createLightroomVerdicts([])).toThrow("No photos");
  });
  test("5,000 uniquely pathed metadata fixtures remain independent and source data is unchanged", () => {
    const shots = Array.from({ length: 5000 }, (_, i) => shot(`Shoot/Card ${i}/IMG.ARW`));
    const frames = shots.map((item) =>
      frame(`/Photos/${item.relativePath}`, { pick: item.id.endsWith("0/IMG.ARW") ? 1 : -1 }),
    );
    const result = mergeLightroomFrames(shots, frames, 20);
    expect(result.matched).toBe(5000);
    expect(result.shots[0]!.verdict).toBe("keep");
    expect(result.shots[1]!.verdict).toBe("reject");
    expect(shots.every((item) => item.verdict === "undecided")).toBe(true);
  });
  test("live wiring protects pending previews, races, and older filename-only clients", () => {
    const studio = readFileSync(new URL("../src/routes/studio.tsx", import.meta.url), "utf8");
    const api = readFileSync(
      new URL("../src/routes/api/public/lightroom.ts", import.meta.url),
      "utf8",
    );
    expect(studio).not.toContain("baseName(f.file");
    expect(studio).toContain("snapshot !== latestShotsRef.current");
    expect(studio).toContain(
      "Apply or discard the preview before publishing changes to Lightroom.",
    );
    expect(studio).toContain("queued, not yet applied");
    expect(api).toContain('url.searchParams.get("matching") !== LIGHTROOM_MATCHING');
    expect(api).toContain('kind: "upgrade-required"');
    expect(api).not.toContain(".slice(0, 5000)");
  });
});
