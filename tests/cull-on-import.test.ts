import { describe, expect, test } from "bun:test";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";
import {
  applyImportCull,
  attachImportAnalysis,
  flagImportDuplicates,
  isImportAnalyzed,
  mergePreservedImportAnalysis,
} from "../src/lib/studio/cull-on-import";
import { smartCullPass } from "../src/lib/studio/smart-cull";

const file = (id: string) => new File([id], `${id}.jpg`, { type: "image/jpeg" });

function shot(id: string, overrides: Partial<Shot> = {}): Shot {
  return {
    id,
    name: `${id}.jpg`,
    file: file(id),
    isRaw: false,
    previewUrl: null,
    width: 4000,
    height: 3000,
    sizeMb: 1,
    sharpness: 200,
    brightness: 120,
    clippedHighlights: 0,
    clippedShadows: 0,
    hash: "1".repeat(64),
    score: 80,
    flags: [],
    verdict: "undecided",
    edits: { ...DEFAULT_EDITS },
    ...overrides,
  };
}

describe("cull on import", () => {
  test.each(["red", "Red"])(
    "a saved %s review label survives smart cull and repeated import passes until Keep or Reject",
    (label) => {
      const marked = shot("marked", {
        score: 90,
        hash: "0".repeat(64),
        develop: { origin: "lightroom", at: 0, label },
      });
      const clean = shot("clean", { score: 90, hash: "1".repeat(64) });
      const input = [marked, clean];
      const bursts = [{ frameIds: input.map((frame) => frame.id), recommendedId: marked.id }];
      expect([...smartCullPass(input, bursts).values()]).toEqual(["undecided", "keep"]);

      const first = applyImportCull(input, { bursts });
      const second = applyImportCull(first.shots, { bursts, onlyIds: new Set([marked.id]) });
      for (const result of [first, second]) {
        expect(result.shots.map((frame) => frame.verdict)).toEqual(["undecided", "keep"]);
        expect(result.shots[0]!.develop?.label).toBe(label);
        expect(result.shots[0]!.file).toBe(marked.file);
      }
      expect(marked.verdict).toBe("undecided");
      expect(marked.flags).toEqual([]);

      for (const verdict of ["keep", "reject"] as const) {
        const decided = { ...marked, verdict };
        expect(smartCullPass([decided], bursts).get(marked.id)).toBe(verdict);
        expect(applyImportCull([decided], { bursts }).shots[0]!.verdict).toBe(verdict);
      }
    },
  );

  test("routes blur and near-dupes to review while preserving existing decisions", () => {
    const keeper = shot("keep-me", { score: 90, hash: "1".repeat(64) });
    const blur = shot("blur", { score: 92, flags: ["blur"], hash: "0".repeat(64) });
    const dupe = shot("dupe", { score: 70, hash: "1".repeat(62) + "00" });
    const protectedKeep = shot("already", { verdict: "keep", flags: ["blur"], score: 10 });
    const original = keeper.file;
    const { shots, changed } = applyImportCull([keeper, blur, dupe, protectedKeep]);
    expect(shots.map((frame) => frame.verdict)).toEqual(["keep", "undecided", "undecided", "keep"]);
    expect(shots[2]!.flags).toContain("duplicate");
    expect(shots[0]!.file).toBe(original);
    expect(changed).toBeGreaterThan(0);
  });

  test("does not invent a verdict for unanalyzed or unreadable frames", () => {
    const pending = shot("pending", { hash: "", score: 0 });
    const broken = shot("broken", { error: "unreadable", hash: "", score: 0 });
    const { shots, skipped } = applyImportCull([pending, broken]);
    expect(shots.map((frame) => frame.verdict)).toEqual(["undecided", "undecided"]);
    expect(skipped).toBe(2);
    expect(isImportAnalyzed(pending)).toBe(false);
  });

  test("onlyIds limits new verdicts after the first import pass", () => {
    const oldOpen = shot("old", { score: 88, hash: "0".repeat(64) });
    const incoming = shot("new", { flags: ["blur"], score: 90, hash: "1".repeat(64) });
    const { shots } = applyImportCull([oldOpen, incoming], { onlyIds: new Set(["new"]) });
    expect(shots[0]!.verdict).toBe("undecided");
    expect(shots[1]!.verdict).toBe("undecided");
  });

  test("attachImportAnalysis writes blur from sharpness and never flips a keep", () => {
    const kept = shot("kept", { verdict: "keep", hash: "", score: 0, flags: [] });
    const next = attachImportAnalysis(kept, {
      width: 2000,
      height: 1500,
      backend: "worker",
      analysis: {
        sharpness: 10,
        brightness: 120,
        clippedHighlights: 0,
        clippedShadows: 0,
        hash: "1".repeat(64),
        tone: { black: 0, white: 255, median: 120, rMean: 1, gMean: 1, bMean: 1, satMean: 0.2 },
      },
    });
    expect(next.verdict).toBe("keep");
    expect(next.flags).toContain("blur");
    expect(next.file).toBe(kept.file);
    expect(next.hash).toHaveLength(64);
  });

  test("catalog reload keeps in-session analysis", () => {
    const prior = shot("a", { hash: "1".repeat(64), score: 77, flags: ["blur"] });
    const projected = shot("a", { hash: "", score: 0, flags: [], verdict: "reject" });
    const merged = mergePreservedImportAnalysis(projected, prior);
    expect(merged.hash).toBe(prior.hash);
    expect(merged.score).toBe(77);
    expect(merged.flags).toEqual(["blur"]);
    expect(merged.verdict).toBe("reject");
  });

  test("catalog reload never rebinds old analysis after reconnect or across photos and namespaces", () => {
    const canonical = { namespace: "synthetic-owner/shoot", photoId: "a" };
    const prior = shot("a", {
      sourceDigest: undefined,
      develop: { origin: "lens os", at: 0, canonical },
    });
    const projected = shot("a", {
      hash: "",
      score: 0,
      sourceDigest: "verified-source",
      develop: prior.develop,
    });
    expect(mergePreservedImportAnalysis(projected, prior)).toBe(projected);
    const bound = { ...prior, sourceDigest: "verified-source" };
    for (const wrong of [
      { ...bound, id: "b" },
      { ...bound, sourceDigest: "different-source" },
      {
        ...bound,
        develop: {
          ...bound.develop!,
          canonical: { ...canonical, namespace: "another-owner/shoot" },
        },
      },
      {
        ...bound,
        develop: { ...bound.develop!, canonical: { ...canonical, photoId: "another-copy" } },
      },
      { ...bound, develop: undefined },
    ])
      expect(mergePreservedImportAnalysis(projected, wrong)).toBe(projected);
    expect(mergePreservedImportAnalysis(projected, bound).hash).toBe(bound.hash);
  });

  test("flagImportDuplicates does not mutate the input array or files", () => {
    const a = shot("a", { score: 90, hash: "1".repeat(64) });
    const b = shot("b", { score: 40, hash: "1".repeat(62) + "00" });
    const input = [a, b];
    const out = flagImportDuplicates(input);
    expect(input[0]!.flags).toEqual([]);
    expect(out[1]!.flags).toContain("duplicate");
    expect(out[0]!.file).toBe(a.file);
    expect(out[1]!.file).toBe(b.file);
  });
});
