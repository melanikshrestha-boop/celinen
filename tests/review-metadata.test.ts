import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildXmpSidecar, DEFAULT_EDITS, parseXmpSidecar, type Shot } from "../src/lib/imaging";
import {
  exportedReviewMetadata,
  importedReviewVerdict,
  validReviewRating,
} from "../src/lib/studio/review-metadata";
import { firstPassVerdict } from "../src/lib/studio/first-pass";
import { mergeIngestedShots } from "../src/lib/studio/ingest";
import { applyProposal, proposeCull } from "../src/lib/studio/proposals";

const frame = (verdict: Shot["verdict"], rating?: number, label?: string | null): Shot => ({
  id: "card-a/IMG_0001.jpg",
  name: "IMG_0001.jpg",
  relativePath: "card-a/IMG_0001.jpg",
  file: new File(["original"], "IMG_0001.jpg"),
  isRaw: false,
  previewUrl: null,
  width: 100,
  height: 100,
  sizeMb: 1,
  sharpness: 99,
  brightness: 100,
  clippedHighlights: 0,
  clippedShadows: 0,
  score: 99,
  flags: [],
  hash: "a".repeat(64),
  verdict,
  edits: { ...DEFAULT_EDITS },
  develop: { origin: "sidecar", at: 1, rating, label },
});

describe("photographer review metadata", () => {
  for (const rating of [-1, 0, 1, 2, 2.5, 3, 4, 5]) {
    test(`explicit reject wins over rating ${rating}, survives export and first pass`, () => {
      const parsed = parseXmpSidecar(`<rdf:Description xmp:Rating="${rating}" crs:Pick="-1"/>`);
      const shot = frame(importedReviewVerdict(parsed), parsed.rating ?? undefined);
      expect(shot.verdict).toBe("reject");
      expect(firstPassVerdict(shot)).toBe("reject");
      const output = exportedReviewMetadata(shot);
      expect(output.rating).toBe(Math.max(0, rating));
      expect(
        importedReviewVerdict(
          parseXmpSidecar(buildXmpSidecar(shot.edits, shot.verdict, output.rating)),
        ),
      ).toBe("reject");
    });
  }
  test("explicit rescue wins over old XMP rejection and does not re-reject on export", () => {
    expect(importedReviewVerdict({ rating: -1, pick: 1 })).toBe("keep");
    const shot = frame("keep", -1);
    const output = exportedReviewMetadata(shot);
    expect(output.rating).toBe(0);
    expect(
      importedReviewVerdict(parseXmpSidecar(buildXmpSidecar(shot.edits, "keep", output.rating))),
    ).toBe("keep");
  });
  test("XMP rejection without a pick is honored; legacy star-only import remains compatible", () => {
    expect(importedReviewVerdict({ rating: -1 })).toBe("reject");
    expect(importedReviewVerdict({ rating: 4 })).toBe("keep");
    expect(importedReviewVerdict({ rating: 2 })).toBe("undecided");
    expect(importedReviewVerdict({}, "reject")).toBe("reject");
  });
  test("export preserves unrated, low and high stars rather than inventing them from quality scores", () => {
    for (const verdict of ["keep", "reject", "undecided"] as const) {
      for (const rating of [undefined, 0, 1, 2, 2.5, 3, 4, 5]) {
        const shot = frame(verdict, rating);
        for (const score of [0, 10, 80, 100, NaN]) {
          shot.score = score;
          expect(exportedReviewMetadata(shot).rating).toBe(rating ?? 0);
        }
      }
    }
  });
  test("canonical scalar attributes and elements, single quotes and whitespace import consistently", () => {
    expect(
      parseXmpSidecar(`<rdf:Description xmp:Rating = ' 2.5 ' crs:Pick = '-1'/>`),
    ).toMatchObject({ rating: 2.5, pick: -1 });
    expect(parseXmpSidecar(`<xmp:Rating> 5 </xmp:Rating><crs:Pick> -1 </crs:Pick>`)).toMatchObject({
      rating: 5,
      pick: -1,
    });
    expect(
      parseXmpSidecar(`<!-- xmp:Rating="5" crs:Pick="1" --><rdf:Description xmp:Rating="2"/>`),
    ).toMatchObject({ rating: 2, pick: null });
  });
  test("invalid ratings and flags cannot become imported picks or exported stars", () => {
    for (const value of [NaN, Infinity, -2, -0.5, 5.1, 100, "5", null, undefined]) {
      expect(validReviewRating(value)).toBe(false);
      expect(importedReviewVerdict({ rating: value as number })).toBe("undecided");
      expect(exportedReviewMetadata(frame("keep", value as number)).rating).toBe(0);
    }
    for (const raw of ["NaN", "Infinity", "1.2.3", "5stars", "", "6", "-2"]) {
      expect(
        parseXmpSidecar(`<rdf:Description xmp:Rating="${raw}" crs:Pick="${raw}"/>`),
      ).toMatchObject({ rating: null, pick: null });
    }
  });
  test("custom labels remain independent of picks and are escaped on XMP export", () => {
    const label = `Client's “album” & print <select> "A"\n✓`;
    const shot = frame("reject", 5, label);
    expect(exportedReviewMetadata(shot)).toEqual({ rating: 5, label });
    const xml = buildXmpSidecar(shot.edits, shot.verdict, 5, label);
    expect(xml).toContain("&amp;");
    expect(xml).toContain("&lt;select&gt;");
    expect(parseXmpSidecar(xml).label).toBe(label);
    expect(parseXmpSidecar(`<xmp:Label>Print &#38; album &#x2713;</xmp:Label>`).label).toBe(
      "Print & album ✓",
    );
    expect(exportedReviewMetadata(frame("keep", 3, "")).label).toBe("");
    expect(exportedReviewMetadata(frame("keep", 3, null)).label).toBeNull();
  });
  test("cull proposals and reconnected originals preserve imported review metadata", () => {
    const protectedShot = frame("reject", 5, "Client A");
    const undecided = { ...frame("undecided", 2), id: "other" };
    const originals = [protectedShot, undecided];
    const proposal = proposeCull(originals, firstPassVerdict, {
      title: "First pass",
      description: "QA",
    });
    const applied = applyProposal(originals, proposal);
    expect(applied[0]).toBe(protectedShot);
    expect(applied[1]!.develop).toEqual(undecided.develop);
    const reconnect = mergeIngestedShots(applied, [frame("keep", 1, "Incoming")]);
    expect(reconnect[0]!.develop).toEqual(protectedShot.develop);
    expect(reconnect[0]!.verdict).toBe("reject");
    expect(protectedShot.develop!.rating).toBe(5);
  });
  test("active Cull handoffs preserve review metadata without exporting archived edits as native treatment", () => {
    const source = readFileSync(new URL("../src/routes/studio.tsx", import.meta.url), "utf8");
    expect(source).toContain(
      "mergeCullLightroomReviews(latestShotsRef.current, state.frames, Date.now())",
    );
    expect(source).toContain("createCullLightroomVerdicts(latestShotsRef.current)");
    expect(source).toContain('requestDevelopOutput("sidecars and native editing settings")');
    expect(source).not.toContain("createSidecarArchive(latestShotsRef.current)");
    expect(source).not.toContain("createKeeperPackage(");
    expect(source).not.toContain("<DeadlineExport");
    expect(source).not.toContain("<SocialExport");
    const bridgeSource = readFileSync(
      new URL("../src/lib/lightroom-matching.ts", import.meta.url),
      "utf8",
    );
    expect(bridgeSource).toContain("importedReviewVerdict(frame, shot.verdict)");
    expect(bridgeSource).toContain("...exportedReviewMetadata(shot)");
    const exportSource = readFileSync(
      new URL("../src/lib/studio/sidecar-export.ts", import.meta.url),
      "utf8",
    );
    expect(exportSource).toContain("exportedReviewMetadata(shot)");
    expect(source).not.toContain("Math.round(s.score / 20)");
    expect(source).not.toContain("Math.round(shot.score / 20)");
  });
});
