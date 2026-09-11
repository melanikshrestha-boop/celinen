import { describe, expect, test } from "bun:test";
import {
  archiveEligible,
  assertArchiveFiles,
  buildKeeperManifest,
  formatStorageBytes,
} from "../src/lib/archive/keeper-manifest";
import { describeShoot } from "../src/lib/studio/shoot-brief";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";

function shot(
  id: string,
  verdict: Shot["verdict"],
  bytes: number,
  extra: Partial<Shot> = {},
): Shot {
  return {
    id,
    name: `${id}.cr3`,
    relativePath: `usc-ucla/${id}.cr3`,
    file: { name: `${id}.cr3`, size: bytes } as File,
    isRaw: true,
    previewUrl: null,
    width: 4000,
    height: 3000,
    sizeMb: bytes / 1_048_576,
    sharpness: 1,
    brightness: 1,
    clippedHighlights: 0,
    clippedShadows: 0,
    hash: id.padEnd(64, "0"),
    score: 50,
    flags: [],
    verdict,
    edits: { ...DEFAULT_EDITS },
    sourceDigest: `digest-${id}`,
    ...extra,
  };
}

describe("keeper manifest", () => {
  test("counts ingest vs keepers and never lists rejects", () => {
    const keep = shot("k", "keep", 40_000_000);
    const dump = shot("r", "reject", 40_000_000);
    const later = shot("u", "undecided", 40_000_000);
    const manifest = buildKeeperManifest([keep, dump, later], "2026-09-10T00:00:00.000Z");
    expect(manifest.ingestCount).toBe(3);
    expect(manifest.ingestBytes).toBe(120_000_000);
    expect(manifest.keeperCount).toBe(1);
    expect(manifest.keeperBytes).toBe(40_000_000);
    expect(manifest.rejectCount).toBe(1);
    expect(manifest.undecidedCount).toBe(1);
    expect(manifest.keepers.map((file) => file.id)).toEqual(["k"]);
    expect(manifest.keepers.some((file) => file.id === "r")).toBe(false);
    expect(archiveEligible(manifest)).toBe(true);
    expect(() => assertArchiveFiles(manifest, [{ name: "r.cr3", size: 40_000_000 }])).toThrow(
      /not a keeper/,
    );
    expect(() => assertArchiveFiles(manifest, [{ id: "k", name: "k.cr3", size: 1 }])).toThrow(
      /changed size/,
    );
  });

  test("empty pick cannot be archived", () => {
    const manifest = buildKeeperManifest([shot("r", "reject", 1000)]);
    expect(archiveEligible(manifest)).toBe(false);
    expect(() => assertArchiveFiles(manifest, [])).toThrow(/Pick keepers first/);
  });

  test("shoot brief surfaces ingest vs keeper bytes", () => {
    const keep = shot("k", "keep", 10 * 1_048_576);
    const brief = describeShoot([keep], "k");
    expect(brief.ingestBytes).toBe(10 * 1_048_576);
    expect(brief.keeperBytes).toBe(10 * 1_048_576);
    expect(formatStorageBytes(brief.ingestBytes)).toBe("10 MB");
  });
});
