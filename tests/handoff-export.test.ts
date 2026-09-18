import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportKeepers, planExportUnits } from "../src/lib/studio/cull/handoff/export-keepers";
import { readJpegXmp } from "../src/lib/studio/cull/handoff/jpeg-xmp";
import { directoryTarget, zipTarget } from "../src/lib/studio/cull/handoff/target";
import type { HandoffFrame, HandoffProgress } from "../src/lib/studio/cull/handoff/types";
import { buildXmp, readXmp } from "../src/lib/studio/cull/handoff/xmp";
import { ZipStreamWriter } from "../src/lib/studio/cull/handoff/zip-stream";
import { bytes, FakeDirectory, file } from "./handoff-fs.fixture";

const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff,
  0xdb, 0x00, 0x04, 0x00, 0x01, 0xff, 0xda, 0x00, 0x04, 0x01, 0x00, 0x12, 0x34, 0xff, 0xd9,
]);

// Camera-clock capture times: 18:00:00, 18:00:01, ... on 2026-09-17.
const at = (second: number) => Date.UTC(2026, 8, 17, 18, 0, second);

function frame(
  id: string,
  name: string,
  second: number,
  overrides: Partial<HandoffFrame> = {},
): HandoffFrame {
  return {
    id,
    name,
    relativePath: `DCIM/100MSDCF/${name}`,
    captureTimeMs: at(second),
    captureTimeBasis: "camera_clock",
    cameraKey: "SONY|ILCE-1|123",
    verdict: "undecided",
    decided: false,
    suggestion: {
      verdict: "keep",
      reason: "strong-frame",
      score: 92,
      group: null,
      bestOfGroup: false,
      duplicate: false,
    },
    ...overrides,
  };
}

/** A card: two RAW+JPEG pairs, one JPEG-only frame, one reject. */
function card() {
  const files = {
    a: file("DCIM/100MSDCF/_DSC0001.ARW", bytes(50_000, 1)),
    aJpg: file("DCIM/100MSDCF/_DSC0001.JPG", JPEG),
    b: file("DCIM/100MSDCF/_DSC0002.ARW", bytes(40_000, 2)),
    bJpg: file("DCIM/100MSDCF/_DSC0002.JPG", JPEG),
    c: file("DCIM/100MSDCF/_DSC0003.JPG", JPEG),
    d: file("DCIM/100MSDCF/_DSC0004.ARW", bytes(30_000, 4)),
  };
  const frames = [
    frame("a", "_DSC0001.ARW", 1),
    frame("b", "_DSC0002.ARW", 2, { decided: true, verdict: "keep", rating: 2 }),
    frame("c", "_DSC0003.JPG", 3),
    frame("d", "_DSC0004.ARW", 4, { decided: true, verdict: "reject" }),
  ];
  const originals = new Map<string, File>([
    ["a", files.a],
    ["b", files.b],
    ["c", files.c],
    ["d", files.d],
  ]);
  return { files, frames, originals, library: Object.values(files) };
}

function accounted(report: Awaited<ReturnType<typeof exportKeepers>>) {
  return report.copied.length + report.skipped.length + report.failed.length;
}

describe("planExportUnits", () => {
  test("groups RAW+JPEG by folder and base name, keepers only, in capture order", () => {
    const { frames, originals, library } = card();
    const { units, issues } = planExportUnits({ frames, files: originals, library });
    expect(issues).toEqual([]);
    expect(units.map((u) => u.members.map((m) => m.file.name))).toEqual([
      ["_DSC0001.ARW", "_DSC0001.JPG"],
      ["_DSC0002.ARW", "_DSC0002.JPG"],
      ["_DSC0003.JPG"],
    ]);
  });

  test("a frame whose original is not open is reported, not dropped", () => {
    const { frames, library } = card();
    const { issues } = planExportUnits({ frames, files: new Map(), library });
    expect(issues.map((i) => i.frameId)).toEqual(["a", "b", "c"]);
  });
});

describe("exportKeepers to a folder", () => {
  test("copies keepers and partners, renames by template, writes sidecars and embeds JPEG ratings", async () => {
    const { frames, originals, library, files } = card();
    const root = FakeDirectory.root();
    const progress: HandoffProgress[] = [];
    const report = await exportKeepers({
      target: directoryTarget(root),
      frames,
      files: originals,
      library,
      renameTemplate: "{date}_{seq:4}",
      folderTemplate: "{shootName}",
      shootName: "Finals",
      sidecars: { metadataDate: "2026-09-17T19:00:00.000Z", keywords: ["volleyball"] },
      onProgress: (p) => progress.push(p),
    });

    expect(report.failed).toEqual([]);
    expect(report.cancelled).toBe(false);
    expect(root.list()).toEqual([
      "Finals/2026-09-17_0001.ARW",
      "Finals/2026-09-17_0001.JPG",
      "Finals/2026-09-17_0001.xmp",
      "Finals/2026-09-17_0002.ARW",
      "Finals/2026-09-17_0002.JPG",
      "Finals/2026-09-17_0002.xmp",
      "Finals/2026-09-17_0003.JPG",
    ]);
    // Originals are byte-identical; RAW partners' JPEGs are not modified.
    expect([...root.read("Finals/2026-09-17_0001.ARW")!]).toEqual([
      ...new Uint8Array(await files.a.arrayBuffer()),
    ]);
    expect([...root.read("Finals/2026-09-17_0001.JPG")!]).toEqual([...JPEG]);

    const first = readXmp(root.text("Finals/2026-09-17_0001.xmp")!);
    expect(first.rating).toBe(5); // score 92
    expect(first.keywords).toEqual(["volleyball"]);
    expect(readXmp(root.text("Finals/2026-09-17_0002.xmp")!).rating).toBe(2); // photographer's stars

    const embedded = await readJpegXmp(
      new Blob([root.read("Finals/2026-09-17_0003.JPG")! as BlobPart]),
    );
    expect(readXmp(embedded!).rating).toBe(5);

    expect(report.copied).toHaveLength(7);
    expect(report.bytes).toBe(report.copied.reduce((sum, entry) => sum + entry.bytes, 0));
    const last = progress[progress.length - 1]!;
    expect(last.files).toBe(last.totalFiles);
    expect(last.totalFiles).toBe(5);
    expect(last.bytes).toBe(last.totalBytes);
  });

  test("renames on collision and keeps pairs and sidecar on the same suffix", async () => {
    const { frames, originals, library } = card();
    const root = FakeDirectory.root();
    root.put("_DSC0001.jpg", "someone else's photo"); // differs only by case
    const report = await exportKeepers({
      target: directoryTarget(root),
      frames,
      files: originals,
      library,
    });
    expect(report.failed).toEqual([]);
    expect(root.text("_DSC0001.jpg")).toBe("someone else's photo");
    expect(root.list()).toContain("_DSC0001-1.ARW");
    expect(root.list()).toContain("_DSC0001-1.JPG");
    expect(root.list()).toContain("_DSC0001-1.xmp");
    expect(root.list()).not.toContain("_DSC0001.ARW");
  });

  test("skip never touches existing files and still accounts for them", async () => {
    const { frames, originals, library } = card();
    const root = FakeDirectory.root();
    root.put("_DSC0002.ARW", "existing raw");
    const report = await exportKeepers({
      target: directoryTarget(root),
      frames,
      files: originals,
      library,
      collision: "skip",
    });
    expect(root.text("_DSC0002.ARW")).toBe("existing raw");
    expect(report.skipped).toEqual([
      expect.objectContaining({ destination: "_DSC0002.ARW", reason: "exists" }),
    ]);
    expect(accounted(report)).toBe(7);
  });

  test("overwrite merges into the destination's sidecar, keeping develop settings", async () => {
    const { frames, originals, library } = card();
    const root = FakeDirectory.root();
    const develop = buildXmp({ rating: 1 }).replace(
      'xmlns:celinen="https://lenslab.dev/ns/celinen/1.0/"',
      'xmlns:celinen="https://lenslab.dev/ns/celinen/1.0/" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" crs:Exposure2012="+1.00"',
    );
    root.put("_DSC0001.xmp", develop);
    const report = await exportKeepers({
      target: directoryTarget(root),
      frames,
      files: originals,
      library,
      collision: "overwrite",
    });
    expect(report.failed).toEqual([]);
    const sidecar = root.text("_DSC0001.xmp")!;
    expect(sidecar).toContain('crs:Exposure2012="+1.00"');
    expect(readXmp(sidecar).rating).toBe(5);
  });

  test("a sidecar that came off the card is merged, not replaced", async () => {
    const { frames, originals, library } = card();
    const pm = file(
      "DCIM/100MSDCF/_DSC0002.xmp",
      buildXmp({ keywords: ["from photo mechanic"], headline: "PM headline" }),
    );
    const root = FakeDirectory.root();
    await exportKeepers({
      target: directoryTarget(root),
      frames,
      files: originals,
      library: [...library, pm],
    });
    const read = readXmp(root.text("_DSC0002.xmp")!);
    expect(read.headline).toBe("PM headline");
    expect(read.keywords).toContain("from photo mechanic");
    expect(read.rating).toBe(2);
  });

  test("a failed write leaves no file behind, and its sidecar is not orphaned", async () => {
    const { frames, originals, library } = card();
    const root = FakeDirectory.root({ failWrites: /_DSC0001\.ARW$/ });
    const report = await exportKeepers({
      target: directoryTarget(root),
      frames,
      files: originals,
      library,
    });
    expect(report.failed).toEqual([
      expect.objectContaining({ source: "DCIM/100MSDCF/_DSC0001.ARW", reason: "Disk full" }),
    ]);
    expect(root.list()).not.toContain("_DSC0001.ARW");
    expect(root.list()).not.toContain("_DSC0001.xmp");
    expect(report.skipped).toEqual([
      expect.objectContaining({ destination: "_DSC0001.xmp", reason: "no-sidecar-target" }),
    ]);
    expect(root.list()).toContain("_DSC0002.ARW");
  });

  test("a short write fails the size check and is removed", async () => {
    const { frames, originals, library } = card();
    const root = FakeDirectory.root({ truncateWrites: /_DSC0002\.ARW$/ });
    const report = await exportKeepers({
      target: directoryTarget(root),
      frames,
      files: originals,
      library,
    });
    expect(report.failed).toEqual([
      expect.objectContaining({
        destination: "_DSC0002.ARW",
        reason: "Size check failed: the destination has 39999 bytes, expected 40000.",
      }),
    ]);
    expect(root.list()).not.toContain("_DSC0002.ARW");
  });

  test("never runs more than four copies at once", async () => {
    const files: File[] = [];
    const frames: HandoffFrame[] = [];
    for (let i = 0; i < 12; i++) {
      const name = `IMG_${String(i).padStart(4, "0")}.CR3`;
      files.push(file(`card/${name}`, bytes(20_000, i)));
      frames.push({ ...frame(String(i), name, i), relativePath: `card/${name}` });
    }
    const root = FakeDirectory.root({ chunkDelayMs: 2 });
    const report = await exportKeepers({
      target: directoryTarget(root),
      frames,
      files: new Map(frames.map((f, i) => [f.id, files[i]!])),
      sidecars: { enabled: false },
    });
    expect(report.copied).toHaveLength(12);
    expect(root.stats.maxWritesInFlight).toBeLessThanOrEqual(4);
    expect(root.stats.maxWritesInFlight).toBeGreaterThan(1);
  });

  test("cancel stops cleanly: no partial files, every file accounted for", async () => {
    const files: File[] = [];
    const frames: HandoffFrame[] = [];
    for (let i = 0; i < 20; i++) {
      const name = `IMG_${String(i).padStart(4, "0")}.CR3`;
      files.push(file(`card/${name}`, bytes(200_000, i)));
      frames.push({ ...frame(String(i), name, i), relativePath: `card/${name}` });
    }
    const root = FakeDirectory.root({ chunkDelayMs: 15 });
    const controller = new AbortController();
    const running = exportKeepers({
      target: directoryTarget(root),
      frames,
      files: new Map(frames.map((f, i) => [f.id, files[i]!])),
      signal: controller.signal,
    });
    // Mid-run: after some commits, with writes still in flight.
    while (root.stats.commits.length < 3) await new Promise((r) => setTimeout(r, 1));
    controller.abort();
    const report = await running;
    expect(root.stats.writesInFlight).toBe(0);
    expect(report.cancelled).toBe(true);
    expect(report.skipped.some((s) => s.reason === "cancelled")).toBe(true);
    // Every original appears exactly once across copied / skipped / failed.
    const copiedOriginals = report.copied.filter((c) => c.destination.endsWith(".CR3")).length;
    const originalSources = [...report.copied, ...report.skipped, ...report.failed]
      .map((entry) => entry.source)
      .filter((source) => source.endsWith(".CR3"));
    expect(originalSources).toHaveLength(20);
    expect(new Set(originalSources).size).toBe(20);
    expect(copiedOriginals).toBeGreaterThan(0);
    expect(copiedOriginals).toBeLessThan(20);
    // Only committed files exist, each whole.
    for (const path of root.list()) {
      if (path.endsWith(".CR3")) expect(root.read(path)!.length).toBe(200_000);
    }
    expect(root.list().filter((p) => p.endsWith(".CR3"))).toHaveLength(copiedOriginals);
  });

  test("JPEG sidecar mode, and DNG ratings reported rather than silently lost", async () => {
    const jpg = file("card/IMG_1.JPG", JPEG);
    const dng = file("card/IMG_2.DNG", bytes(5000, 9));
    const frames = [
      { ...frame("j", "IMG_1.JPG", 1), relativePath: "card/IMG_1.JPG" },
      { ...frame("d", "IMG_2.DNG", 2), relativePath: "card/IMG_2.DNG" },
    ];
    const root = FakeDirectory.root();
    const report = await exportKeepers({
      target: directoryTarget(root),
      frames,
      files: new Map([
        ["j", jpg],
        ["d", dng],
      ]),
      sidecars: { jpeg: "sidecar" },
    });
    expect(root.list()).toEqual(["IMG_1.JPG", "IMG_1.xmp", "IMG_2.DNG"]);
    expect([...root.read("IMG_1.JPG")!]).toEqual([...JPEG]);
    expect(readXmp(root.text("IMG_1.xmp")!).rating).toBe(5);
    expect(report.skipped).toEqual([
      expect.objectContaining({ frameId: "d", reason: "no-sidecar-target" }),
    ]);
  });

  test("an invalid template fails before anything is written", async () => {
    const { frames, originals, library } = card();
    const root = FakeDirectory.root();
    const report = await exportKeepers({
      target: directoryTarget(root),
      frames,
      files: originals,
      library,
      renameTemplate: "{nope}",
    });
    expect(root.list()).toEqual([]);
    expect(report.failed).toHaveLength(5);
    expect(report.failed[0]!.reason).toContain("Unknown token");
  });
});

describe("exportKeepers to a zip", () => {
  test("produces a valid archive with the same layout", async () => {
    const { frames, originals, library } = card();
    const chunks: Uint8Array[] = [];
    const writer = new ZipStreamWriter({
      write: async (c) => {
        chunks.push(c.slice());
      },
      close: async () => {},
    });
    const report = await exportKeepers({
      target: zipTarget(writer),
      frames,
      files: originals,
      library,
      folderTemplate: "Finals",
      collision: "overwrite",
    });
    await writer.finish();
    expect(report.failed).toEqual([]);
    expect(report.copied.map((c) => c.destination).sort()).toEqual([
      "Finals/_DSC0001.ARW",
      "Finals/_DSC0001.JPG",
      "Finals/_DSC0001.xmp",
      "Finals/_DSC0002.ARW",
      "Finals/_DSC0002.JPG",
      "Finals/_DSC0002.xmp",
      "Finals/_DSC0003.JPG",
    ]);
    if (spawnSync("unzip", ["-v"]).error) return;
    const archive = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
    let offset = 0;
    for (const c of chunks) {
      archive.set(c, offset);
      offset += c.length;
    }
    const dir = mkdtempSync(join(tmpdir(), "celinen-export-zip-"));
    writeFileSync(join(dir, "keepers.zip"), archive);
    const result = spawnSync("unzip", ["-t", join(dir, "keepers.zip")], { encoding: "utf8" });
    expect(result.stdout).toContain("No errors detected");
  });
});
