import { describe, expect, test } from "bun:test";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";
import {
  decideGallery,
  groupMoments,
  pairwiseLoss,
  proposeGallery,
  recordCorrection,
} from "../src/lib/studio/gallery-select";
import type { EventPerson } from "../src/lib/studio/people";

function shot(partial: Partial<Shot> & { id: string; name: string }): Shot {
  return {
    file: new File([], partial.name),
    isRaw: false,
    previewUrl: null,
    width: 100,
    height: 100,
    sizeMb: 1,
    sharpness: 80,
    brightness: 120,
    clippedHighlights: 0,
    clippedShadows: 0,
    hash: "aaaaaaaaaaaaaaaa",
    score: 70,
    flags: [],
    verdict: "undecided",
    edits: { ...DEFAULT_EDITS },
    ...partial,
  };
}

describe("gallery selection is a collection problem", () => {
  test("nearly identical portraits do not both become recommended", () => {
    const portraits = [
      shot({
        id: "a",
        name: "a.jpg",
        relativePath: "portraits/a.jpg",
        captureTimeMs: 10_000,
        cameraKey: "body-1",
        score: 92,
        sharpness: 400,
      }),
      shot({
        id: "b",
        name: "b.jpg",
        relativePath: "portraits/b.jpg",
        captureTimeMs: 10_400,
        cameraKey: "body-1",
        score: 90,
        sharpness: 380,
      }),
    ];
    const embrace = shot({
      id: "c",
      name: "c.jpg",
      relativePath: "ceremony/c.jpg",
      captureTimeMs: 80_000,
      cameraKey: "body-1",
      score: 55,
      flags: ["soft"],
      sharpness: 20,
      faces: { count: 2, faceSharpness: 10, eyesOpen: null },
    });
    const plan = proposeGallery([...portraits, embrace], { targetCount: 3 });
    expect(plan.recommendedIds).toContain("a");
    expect(plan.recommendedIds).toContain("c");
    expect(plan.recommendedIds).not.toContain("b");
    expect(plan.alternativeIds).toContain("b");
    expect(decideGallery(portraits[1]!, plan)).toBe("undecided");
    expect(decideGallery(embrace, plan)).toBe("keep");
  });

  test("existing keepers and rejects are never overwritten", () => {
    const keep = shot({ id: "k", name: "k.jpg", verdict: "keep", score: 10 });
    const reject = shot({ id: "r", name: "r.jpg", verdict: "reject", score: 99 });
    const plan = proposeGallery([keep, reject]);
    expect(decideGallery(keep, plan)).toBe("keep");
    expect(decideGallery(reject, plan)).toBe("reject");
    expect(plan.recommendedIds).toContain("k");
    expect(plan.recommendedIds).not.toContain("r");
  });

  test("a confirmed person with no recommended frames is flagged, not silently dropped", () => {
    const parent = shot({ id: "p", name: "p.jpg", score: 40, flags: ["soft"] });
    const people: EventPerson[] = [
      {
        id: "person-1",
        label: "Parent",
        role: "parent",
        confirmed: true,
        frameIds: ["p"],
        observationIds: ["p:face:0"],
        source: "local-descriptor",
        minSimilarity: 1,
      },
    ];
    const plan = proposeGallery([parent], { people, targetCount: 1 });
    expect(plan.coverage.some((gap) => gap.personId === "person-1")).toBe(true);
    expect(plan.limitations.join(" ")).toContain("Parent");
  });

  test("moments stay conservative and corrections record a pairwise preference", () => {
    const moments = groupMoments([
      shot({ id: "1", name: "1.jpg", captureTimeMs: 1000, cameraKey: "a" }),
      shot({ id: "2", name: "2.jpg", captureTimeMs: 2000, cameraKey: "a" }),
      shot({ id: "3", name: "3.jpg", captureTimeMs: 90_000, cameraKey: "a" }),
    ]);
    expect(moments).toHaveLength(2);
    const corrections = recordCorrection([], {
      preferredId: "219",
      replacedId: "214",
      reason: "expression",
    });
    expect(corrections).toHaveLength(1);
    expect(pairwiseLoss(0.8, 0.2)).toBeLessThan(pairwiseLoss(0.2, 0.8));
  });
});
