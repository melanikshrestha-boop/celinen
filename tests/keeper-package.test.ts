import { describe, expect, test } from "bun:test";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";
import {
  createKeeperPackage,
  createOriginalKeeperZip,
  jobFolderName,
} from "../src/lib/studio/keeper-package";
import type { DeadlineRenderer } from "../src/lib/studio/deadline-export";

const shot = (id: string, verdict: Shot["verdict"] = "keep"): Shot => ({
  id,
  name: `${id}.jpg`,
  relativePath: `card/${id}.jpg`,
  file: new File([id], `${id}.jpg`, { type: "image/jpeg", lastModified: 1234 }),
  isRaw: false,
  previewUrl: null,
  width: 4000,
  height: 3000,
  sizeMb: 1,
  sharpness: 200,
  brightness: 100,
  clippedHighlights: 0,
  clippedShadows: 0,
  hash: "1".repeat(64),
  score: 90,
  flags: [],
  verdict,
  edits: { ...DEFAULT_EDITS },
});
const jpeg = (id: string) =>
  new Blob([new Uint8Array([0xff, 0xd8, 0xff]), id, new Uint8Array([0xff, 0xd9])], {
    type: "image/jpeg",
  });
const render: DeadlineRenderer = async (frame, config) => ({
  blob: jpeg(frame.id),
  width: config.longestEdge,
  height: 1200,
});

describe("keepers package", () => {
  test("names the archive from the job date and title", () => {
    expect(jobFolderName("Chen Wedding", new Date("2026-09-07T12:00:00Z"))).toBe(
      "2026-09-07_Chen-Wedding",
    );
  });

  test("zips cull.csv, job.json and proof JPEGs of keepers only", async () => {
    const shots = [shot("skip", "reject"), shot("a"), shot("later", "undecided"), shot("b")];
    const pack = await createKeeperPackage(shots, "Chen Wedding", "/Volumes/CARD", {
      render,
      now: "2026-09-07T12:00:00.000Z",
    });
    expect(pack.keepers).toBe(2);
    expect(pack.filename).toBe("2026-09-07_Chen-Wedding-keepers.zip");
    expect(pack.files).toEqual([
      "cull.csv",
      "job.json",
      "proof/proof-001.jpg",
      "proof/proof-002.jpg",
    ]);
    expect(pack.blob.size).toBeGreaterThan(100);
    expect(shots.map((frame) => frame.verdict)).toEqual(["reject", "keep", "undecided", "keep"]);
  });

  test("refuses a card dump with no keepers", async () => {
    await expect(createKeeperPackage([shot("a", "undecided")], "Chen", "studio", { render })).rejects.toThrow(
      /Cull first/,
    );
  });

  test("zips original keeper files from this session, not rejects", async () => {
    const shots = [shot("skip", "reject"), shot("a"), shot("later", "undecided"), shot("b")];
    const pack = await createOriginalKeeperZip(shots, "Chen Wedding");
    expect(pack.keepers).toBe(2);
    expect(pack.filename).toContain("Chen-Wedding-keepers.zip");
    expect(pack.blob.size).toBeGreaterThan(40);
  });

  test("original ZIP refuses empty keepers", async () => {
    await expect(createOriginalKeeperZip([shot("a", "undecided")], "Chen")).rejects.toThrow(
      /Mark keepers/,
    );
  });
});
