import { describe, expect, test } from "bun:test";
import { DEFAULT_EDITS, parseXmpSidecar } from "../src/lib/imaging";
import {
  createSidecarArchive,
  planSidecarExport,
  SIDECAR_EXPORT_LIMITS,
} from "../src/lib/studio/sidecar-export";
import { crc32, makeZip } from "../src/lib/zip";

type Frame = Parameters<typeof planSidecarExport>[0][number];
function frame(relativePath = "card-a/IMG_0001.ARW", patch: Partial<Frame> = {}): Frame {
  return {
    name: relativePath.split("/").at(-1)!,
    relativePath,
    verdict: "keep",
    edits: { ...DEFAULT_EDITS },
    develop: { origin: "sidecar", at: 1, rating: 2, label: "For print" },
    ...patch,
  };
}

describe("collision-safe sidecar handoff", () => {
  test("repeated camera filenames keep their original directories and individual decisions", () => {
    const plan = planSidecarExport([frame(), frame("card-b/IMG_0001.ARW", { verdict: "reject" })]);
    expect(plan.photoCount).toBe(2);
    expect(plan.entries.map((entry) => entry.path)).toEqual([
      "card-a/IMG_0001.xmp",
      "card-b/IMG_0001.xmp",
    ]);
    expect(plan.entries.map((entry) => parseXmpSidecar(entry.text!).pick)).toEqual([1, -1]);
    expect(plan.entries.map((entry) => parseXmpSidecar(entry.text!).rating)).toEqual([2, 2]);
  });
  test("legacy flat imports and names with multiple periods stay matchable", () => {
    expect(
      planSidecarExport([frame("IMG.0001.ARW", { relativePath: undefined })]).entries[0]?.path,
    ).toBe("IMG.0001.xmp");
    expect(planSidecarExport([frame("IMG_0001")]).entries[0]?.path).toBe("IMG_0001.xmp");
  });
  test("an identical RAW + JPEG pair shares one sidecar, not two conflicting downloads", () => {
    const plan = planSidecarExport([frame(), frame("card-a/IMG_0001.JPG")]);
    expect(plan.photoCount).toBe(2);
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]?.path).toBe("card-a/IMG_0001.xmp");
  });
  test("different picks, edits, stars or labels in a RAW + JPEG pair stop the whole batch", () => {
    for (const patch of [
      { verdict: "reject" as const },
      { edits: { ...DEFAULT_EDITS, exposure: 10 } },
      { develop: { origin: "sidecar" as const, at: 1, rating: 4, label: "For print" } },
      { develop: { origin: "sidecar" as const, at: 1, rating: 2, label: "Client final" } },
    ]) {
      expect(() =>
        createSidecarArchive([
          frame("safe/first.ARW"),
          frame(),
          frame("card-a/IMG_0001.JPG", patch),
        ]),
      ).toThrow("different picks or settings");
    }
  });
  test("an unreviewed or unreadable companion cannot accidentally inherit the exported pick", () => {
    for (const patch of [{ verdict: "undecided" as const }, { error: "Unreadable" }]) {
      expect(() => planSidecarExport([frame(), frame("card-a/IMG_0001.JPG", patch)])).toThrow(
        "unreviewed or unreadable",
      );
    }
  });
  test("unrelated undecided and unreadable photos do not become sidecars", () => {
    expect(
      planSidecarExport([
        frame(),
        frame("other/IMG.ARW", { verdict: "undecided" }),
        frame("broken.ARW", { error: "Unreadable" }),
      ]).entries,
    ).toHaveLength(1);
    expect(() => planSidecarExport([])).toThrow("Nothing decided yet");
    expect(() => planSidecarExport([frame("other.ARW", { verdict: "undecided" })])).toThrow(
      "Nothing decided yet",
    );
  });
  test("case and composed Unicode aliases stop instead of overwriting or renaming", () => {
    for (const [a, b] of [
      ["card-a/IMG.ARW", "card-a/img.ARW"],
      ["card-a/IMG.ARW", "CARD-A/IMG.ARW"],
      ["Café/IMG.ARW", "Cafe\u0301/IMG.ARW"],
      ["Straße/IMG.ARW", "STRASSE/IMG.ARW"],
    ])
      expect(() => planSidecarExport([frame(a), frame(b)])).toThrow("collision");
  });
  test("a generated sidecar cannot also be a directory in the archive", () => {
    expect(() => planSidecarExport([frame("trip.ARW"), frame("trip.xmp/IMG.ARW")])).toThrow(
      "folder name",
    );
    expect(() => planSidecarExport([frame("TRIP.ARW"), frame("trip.xmp/IMG.ARW")])).toThrow(
      "folder name",
    );
  });
  test("distinct photos cannot silently merge case or Unicode aliased folders", () => {
    for (const [a, b] of [
      ["Card-a/IMG.ARW", "CARD-A/Other.ARW"],
      ["Café/IMG.ARW", "Cafe\u0301/Other.ARW"],
    ])
      expect(() => planSidecarExport([frame(a), frame(b)])).toThrow("Folder names");
  });
  test("unsafe paths are rejected before archive generation, never sanitized into another photo", () => {
    for (const path of [
      "/IMG.ARW",
      "../IMG.ARW",
      "a/../IMG.ARW",
      "./IMG.ARW",
      "a//IMG.ARW",
      "a/",
      "C:/IMG.ARW",
      "C:\\IMG.ARW",
      "\\\\server\\IMG.ARW",
      "a\u0000/IMG.ARW",
      "a\n/IMG.ARW",
      "a?b/IMG.ARW",
      "a*/IMG.ARW",
      "a|b/IMG.ARW",
      "a<b/IMG.ARW",
      'a"b/IMG.ARW',
      "a /IMG.ARW",
      "a./IMG.ARW",
      "CON/IMG.ARW",
      "LPT1/IMG.ARW",
      "COM¹/IMG.ARW",
      "NUL.ARW",
      "\u202eIMG.ARW",
      "\ud800/IMG.ARW",
      ".ARW",
      "IMG..ARW",
      "IMG .ARW",
    ])
      expect(() => createSidecarArchive([frame(path)])).toThrow("not exported");
  });
  test("a stale name/path mismatch is reported instead of guessing which one to use", () => {
    expect(() => planSidecarExport([frame("card-a/IMG.ARW", { name: "other.ARW" })])).toThrow(
      "relative filenames",
    );
  });
  test("portable Unicode, emoji, spaces, punctuation and nested paths remain unchanged", () => {
    const path = "旅行/Café 📷/Pablo's & Celine's.0001.ARW";
    const plan = planSidecarExport([frame(path)]);
    expect(plan.entries[0]?.path).toBe("旅行/Café 📷/Pablo's & Celine's.0001.xmp");
  });
  test("UTF-8 filename byte limits account for the new extension", () => {
    expect(() => planSidecarExport([frame(`${"é".repeat(126)}.ARW`)])).toThrow("not exported");
    expect(() => planSidecarExport([frame(`${"a".repeat(253)}.a`)])).toThrow("portable filename");
    expect(() => planSidecarExport([frame(`${"abc/".repeat(300)}IMG.ARW`)])).toThrow(
      "relative filenames",
    );
  });
  test("count and archive byte limits fail explicitly", () => {
    expect(() =>
      planSidecarExport(Array.from({ length: SIDECAR_EXPORT_LIMITS.photos + 1 }, () => frame())),
    ).toThrow("20,000");
    const oversized = frame("large.ARW", {
      develop: { origin: "sidecar", at: 1, label: "x".repeat(SIDECAR_EXPORT_LIMITS.bytes) },
    });
    expect(() => createSidecarArchive([oversized])).toThrow("32 MiB");
  });
  test("planning neither reads originals nor mutates saved photos or edits", () => {
    const shot = frame();
    Object.defineProperty(shot, "file", {
      get: () => {
        throw new Error("Original read");
      },
    });
    const before = JSON.stringify(shot);
    Object.freeze(shot.edits);
    Object.freeze(shot.develop);
    Object.freeze(shot);
    planSidecarExport([shot]);
    expect(JSON.stringify(shot)).toBe(before);
  });
  test("archive payload, CRC, filenames and central directory agree", async () => {
    const shots = [frame("Café 📷/IMG.ARW"), frame("別/IMG.ARW", { verdict: "reject" })];
    const expected = planSidecarExport(shots).entries;
    const archive = createSidecarArchive(shots);
    expect(archive.sidecarCount).toBe(2);
    expect(archive.photoCount).toBe(2);
    expect(archive.blob.type).toBe("application/zip");
    const bytes = new Uint8Array(await archive.blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const offsets: number[] = [];
    let at = 0;
    for (const entry of expected) {
      offsets.push(at);
      expect(view.getUint32(at, true)).toBe(0x04034b50);
      expect(view.getUint16(at + 6, true)).toBe(0x0800);
      expect(view.getUint16(at + 8, true)).toBe(0);
      const size = view.getUint32(at + 18, true);
      const nameLength = view.getUint16(at + 26, true);
      expect(decoder.decode(bytes.slice(at + 30, at + 30 + nameLength))).toBe(entry.path);
      const data = bytes.slice(at + 30 + nameLength, at + 30 + nameLength + size);
      expect(crc32(data)).toBe(view.getUint32(at + 14, true));
      expect(decoder.decode(data)).toBe(entry.text!);
      at += 30 + nameLength + size;
    }
    const centralOffset = at;
    for (const [index, entry] of expected.entries()) {
      expect(view.getUint32(at, true)).toBe(0x02014b50);
      expect(view.getUint16(at + 8, true)).toBe(0x0800);
      expect(view.getUint32(at + 42, true)).toBe(offsets[index]!);
      const nameLength = view.getUint16(at + 28, true);
      expect(decoder.decode(bytes.slice(at + 46, at + 46 + nameLength))).toBe(entry.path);
      at += 46 + nameLength;
    }
    expect(view.getUint32(at, true)).toBe(0x06054b50);
    expect(view.getUint16(at + 10, true)).toBe(2);
    expect(view.getUint32(at + 12, true)).toBe(at - centralOffset);
    expect(view.getUint32(at + 16, true)).toBe(centralOffset);
    expect(bytes.length).toBe(at + 22);
  });
  test("the shared ZIP writer still preserves binary bytes", async () => {
    const payload = new Uint8Array([0, 255, 128, 1]);
    const bytes = new Uint8Array(
      await makeZip([{ path: "test.bin", bytes: payload }]).arrayBuffer(),
    );
    expect(bytes.slice(38, 42)).toEqual(payload);
  });
});
