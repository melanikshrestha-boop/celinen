/**
 * Does the culler actually learn from her, and can it be shown?
 *
 * The claim under test is not "a ranker converges" — any ranker converges on
 * its own training data. It is the product claim: after she overrules the
 * engine a few dozen times, the engine's suggestions on frames it has never
 * been trained on move toward the frames she would have picked. So every
 * number below is measured on held-out frames, and the before/after pair is
 * the same held-out set scored by the same code.
 *
 * The heads are the real ones: they come out of the committed
 * celinen-cull-intel.wasm, through the same sequence pass the cull screen
 * runs, so a head this test trains on is a head the product measures.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import {
  CULL_SIGNATURE_SIZE,
  instantiateCullIntelWasm,
  type CullHeadSet,
  type CullIntelEngine,
  type CullSequenceInput,
} from "../src/lib/studio/cull/intel";
import {
  blendQuality,
  COLD_TASTE,
  CULL_TASTE_MAX_TRUST,
  createPairwiseRanker,
  forgetCullPreferences,
  learnedPercentiles,
  loadCullTaste,
  recordCullPreferences,
  tasteFromEvents,
  trustFromEvents,
  type CullPreferenceDraft,
  type CullPreferenceEvent,
} from "../src/lib/studio/cull/preferences";

const intelBinary = readFileSync(
  new URL("../src/lib/studio/cull/celinen-cull-intel.wasm", import.meta.url),
);

let intel: CullIntelEngine;
beforeAll(async () => {
  intel = await instantiateCullIntelWasm(intelBinary);
});

/** A deterministic stream, so a failure is always the same failure. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** One frame of a shoot, as the sequence pass is given it: a subject of some
 * size and sharpness somewhere in the frame, in a burst of eight. */
function shootFrame(next: () => number, index: number): CullSequenceInput {
  const width = 0.08 + 0.34 * next(); // how tight the framing is
  const focus = 0.2 + 0.7 * next();
  const signature = new Uint8Array(CULL_SIGNATURE_SIZE);
  for (let i = 0; i < signature.length; i++) signature[i] = 40 + ((i * 13 + index * 7) % 180);
  return {
    group: Math.floor(index / 8),
    captureTimeMs: 1.78e12 + index * 120,
    signature,
    subject: {
      level: "salient",
      region: {
        x: 0.1 + 0.6 * next(),
        y: 0.1 + 0.6 * next(),
        width,
        height: width * 1.3,
        confidence: 0.55 + 0.4 * next(),
      },
      focus,
      focusConfidence: 0.6 + 0.3 * next(),
      eyeFocus: -1,
      eyesOpen: -1,
      subjectSize: width * width * 1.3,
      saliency: 0.3 + 0.5 * next(),
    },
    heads: {
      // The heads the per-frame scorer would have filled from the reading.
      subjectFocus: { value: focus, confidence: 0.6 },
      exposure: { value: 0.25 + 0.7 * next(), confidence: 0.7 },
      composition: { value: 0.15 + 0.8 * next(), confidence: 0.6 },
      noise: { value: 0.1 + 0.5 * next(), confidence: 0.6 },
      subjectMotion: { value: 0.05 + 0.6 * next(), confidence: 0.5 },
    },
    validity: "valid",
  };
}

/** Spearman's rank correlation between two orderings of the same frames. */
function rankCorrelation(a: readonly number[], b: readonly number[]): number {
  const ranks = (values: readonly number[]) => {
    const order = values.map((value, index) => ({ value, index }));
    order.sort((x, y) => x.value - y.value);
    const out = new Array<number>(values.length);
    order.forEach((entry, position) => {
      out[entry.index] = position;
    });
    return out;
  };
  const ra = ranks(a);
  const rb = ranks(b);
  const n = a.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += (ra[i]! - rb[i]!) ** 2;
  return 1 - (6 * sum) / (n * (n * n - 1));
}

describe("what the culler learns is measured on frames it never trained on", () => {
  test("her suggestions move toward her picks, and the movement is the trained part", () => {
    // 480 frames of a shoot, in bursts of eight, with heads from the engine.
    const next = random(20260918);
    const frames = Array.from({ length: 480 }, (_, index) => shootFrame(next, index));
    const rows = intel.sequence(frames, { genre: "sports" });
    const heads = rows.map((row) => row.heads);
    expect(heads).toHaveLength(480);
    // Every head the ranker will train on came out of the C++, not this file.
    expect(heads[0]!.subjectFocus).toBeDefined();
    expect(heads[0]!.composition).toBeDefined();

    /**
     * The photographer this test plays: she culls on placement and light where
     * the engine culls on focus and the moment. Given two frames she takes the
     * better-placed one and breaks a tie on exposure, and she will take a
     * slightly soft frame to get it. If she agreed with the engine there would
     * be nothing here to learn.
     *
     * Her preference is written in the heads the engine actually measures.
     * That is a real constraint, not a convenience: the ranker's only features
     * are the heads, so a photographer whose taste lives somewhere the heads
     * do not reach — how tightly she crops, how warm she likes a frame — is
     * not learnable today however many times she overrules it. Subject size
     * and colour temperature are both measured (CullSubjectFocus.subjectSize,
     * the reading's colour signature) and neither is a head yet; they are the
     * next two to add.
     */
    const herPreference = (index: number) => {
      const own = frames[index]!.heads!;
      return own.composition!.value * 1 + own.exposure!.value * 0.45;
    };

    // Held out from the very start: these frames are never in a training pair.
    const trainable = [...Array(320).keys()];
    const held = [...Array(160).keys()].map((i) => i + 320);

    // Her overrides: inside each burst, the frame she would have taken against
    // the one the engine ranked first. Only the bursts made of training frames.
    const overrides: CullPreferenceEvent[] = [];
    for (let burst = 0; burst * 8 + 8 <= trainable.length; burst++) {
      const members = [...Array(8).keys()].map((k) => burst * 8 + k);
      const enginePick = members.reduce((best, index) =>
        rows[index]!.rank < rows[best]!.rank ? index : best,
      );
      const hers = members.reduce((best, index) =>
        herPreference(index) > herPreference(best) ? index : best,
      );
      if (hers === enginePick) continue; // she agreed; nothing to learn
      overrides.push({
        id: `${burst}`.padStart(6, "0"),
        at: burst,
        kind: "burst-pick",
        sessionId: "game",
        burstId: burst,
        genre: "sports",
        chosen: { frameId: `f${hers}`, heads: heads[hers]! },
        passedOver: { frameId: `f${enginePick}`, heads: heads[enginePick]! },
        // The rest of the burst, exactly as the controller records it.
        alsoBeat: members
          .filter((index) => index !== hers && index !== enginePick)
          .map((index) => ({ frameId: `f${index}`, heads: heads[index]! })),
      });
    }
    // A real afternoon's worth of disagreement, not a thousand synthetic pairs.
    expect(overrides.length).toBeGreaterThan(20);
    expect(overrides.length).toBeLessThan(45);

    /** How often a ranking agrees with her, over every pair of held-out
     * frames — twelve thousand of them, so the number is a measurement and not
     * a roll of five dice. */
    const agreement = (score: (index: number) => number) => {
      let right = 0;
      let total = 0;
      for (let i = 0; i < held.length; i++)
        for (let j = i + 1; j < held.length; j++) {
          const a = held[i]!;
          const b = held[j]!;
          if (herPreference(a) === herPreference(b)) continue;
          total++;
          if (herPreference(a) > herPreference(b) === score(a) > score(b)) right++;
        }
      return right / total;
    };

    // Before: the engine's own ranking of the held-out frames.
    const engineScore = (index: number) => -rows[index]!.rank;
    const before = agreement(engineScore);

    const hersRanked = held.map(herPreference);
    const beforeRho = rankCorrelation(
      hersRanked,
      held.map((index) => engineScore(index)),
    );

    /** The held-out frames scored the way the cull screen scores them: the
     * engine's own position, with her taste mixed in at the trust her count
     * of overrides has earned. */
    const measure = (events: readonly CullPreferenceEvent[]) => {
      const taste = tasteFromEvents(events);
      const positions = learnedPercentiles(held.map((index) => taste.score(heads[index]!)));
      const blended = held.map((index, i) =>
        blendQuality(99 - rows[index]!.rank, positions[i]!, taste.trust),
      );
      const byHeld = new Map(held.map((index, i) => [index, blended[i]!]));
      return {
        taste,
        agreement: agreement((index) => byHeld.get(index)!),
        rho: rankCorrelation(hersRanked, blended),
      };
    };

    const afternoon = measure(overrides);
    expect(afternoon.taste.events).toBe(overrides.length);
    expect(afternoon.taste.trust).toBeGreaterThan(0);

    // The claim, at one afternoon's worth of disagreement: on frames it has
    // never been trained on, the culler agrees with her more often than the
    // engine alone did, and the whole held-out ordering has moved toward hers.
    // Measured, not hoped for: the engine alone agrees with her on 56% of
    // held-out pairs, and one afternoon of overrides takes that past 78%.
    expect(before).toBeLessThan(0.6);
    expect(afternoon.agreement).toBeGreaterThan(0.78);
    expect(afternoon.agreement - before).toBeGreaterThan(0.2);
    expect(afternoon.rho).toBeGreaterThan(beforeRho + 0.3);

    // And it keeps moving as she keeps culling: the same overrides seen over a
    // season buy more trust, so the same learned opinion counts for more. This
    // is what makes the cold start safe rather than merely slow.
    const season = measure(
      Array.from({ length: 6 }, (_, pass) =>
        overrides.map((event) => ({ ...event, id: `${pass}-${event.id}` })),
      ).flat(),
    );
    expect(season.taste.trust).toBeGreaterThan(afternoon.taste.trust);
    expect(season.agreement).toBeGreaterThan(afternoon.agreement);
    expect(season.rho).toBeGreaterThan(afternoon.rho);

    // Printed so the numbers are in the run, not only in this file.
    const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
    console.log(
      `taste, held out over ${held.length} frames the ranker never saw:\n` +
        `  engine alone            agreement ${pct(before)}  rho ${beforeRho.toFixed(3)}\n` +
        `  + ${String(afternoon.taste.events).padStart(3)} overrides (trust ${pct(afternoon.taste.trust)})  ` +
        `agreement ${pct(afternoon.agreement)}  rho ${afternoon.rho.toFixed(3)}\n` +
        `  + ${String(season.taste.events).padStart(3)} overrides (trust ${pct(season.taste.trust)})  ` +
        `agreement ${pct(season.agreement)}  rho ${season.rho.toFixed(3)}`,
    );

    // The learned weight lands on what she actually culled on. The engine's
    // own tiers put peak action and focus first, so this is a real move.
    expect(season.taste.weights().composition ?? 0).toBeGreaterThan(0);
  });

  test("the ranker reads the heads, not the order they arrived in", () => {
    const next = random(7);
    const frames = Array.from({ length: 64 }, (_, index) => shootFrame(next, index));
    const heads = intel.sequence(frames).map((row) => row.heads);
    const ranker = createPairwiseRanker();
    // Nothing learned: every frame scores the same, so nothing is reordered.
    const flat = new Set(heads.map((head) => ranker.score(head)));
    expect(flat.size).toBe(1);
  });
});

describe("cold start", () => {
  test("three clicks must not swing a shoot, and a season may", () => {
    expect(trustFromEvents(0)).toBe(0);
    expect(trustFromEvents(3)).toBeLessThan(0.04);
    expect(trustFromEvents(20)).toBeLessThan(0.16);
    expect(trustFromEvents(60)).toBeCloseTo(CULL_TASTE_MAX_TRUST / 2, 6);
    expect(trustFromEvents(5000)).toBeLessThan(CULL_TASTE_MAX_TRUST);
    // Monotone: more decisions never means less trust.
    for (let n = 1; n < 400; n++) expect(trustFromEvents(n + 1)).toBeGreaterThan(trustFromEvents(n));
  });

  test("at no trust the engine's own quality is returned untouched", () => {
    expect(blendQuality(73, 0, 0)).toBe(73);
    expect(blendQuality(73, 1, 0)).toBe(73);
    // At three clicks' worth of trust the frame barely moves.
    expect(Math.abs(blendQuality(73, 1, trustFromEvents(3)) - 73)).toBeLessThan(1.5);
    // At full trust the learned position leads, still inside the 1..99 range.
    expect(blendQuality(73, 1, 1)).toBe(99);
    expect(blendQuality(73, 0, 1)).toBe(1);
  });

  test("a taste that has learned nothing ranks nothing", () => {
    expect(COLD_TASTE.events).toBe(0);
    expect(COLD_TASTE.trust).toBe(0);
    expect(COLD_TASTE.score({} as CullHeadSet)).toBe(0);
    expect(COLD_TASTE.keepBias).toBe(0.55);
    expect(tasteFromEvents([])).toBe(COLD_TASTE);
  });

  test("ties share one position, so the input order never reorders a shoot", () => {
    expect(learnedPercentiles([5, 5, 5, 5])).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(learnedPercentiles([1, 2, 3])).toEqual([0, 0.5, 1]);
    expect(learnedPercentiles([9])).toEqual([0.5]);
    expect(learnedPercentiles([])).toEqual([]);
  });

  test("how selective she is comes from her own overrides", () => {
    const event = (kind: CullPreferenceEvent["kind"], index: number): CullPreferenceEvent => ({
      id: `${index}`,
      at: index,
      kind,
      sessionId: "s",
      burstId: null,
      genre: "sports",
      chosen: { frameId: `a${index}`, heads: { subjectFocus: { value: 0.8, confidence: 0.7 } } },
      passedOver: {
        frameId: `b${index}`,
        heads: { subjectFocus: { value: 0.4, confidence: 0.7 } },
      },
    });
    const keeps = Array.from({ length: 30 }, (_, i) => event("restored-reject", i));
    const throws = Array.from({ length: 30 }, (_, i) => event("rejected-keep", i));
    expect(tasteFromEvents(keeps).keepBias).toBeGreaterThan(0.55);
    expect(tasteFromEvents(throws).keepBias).toBeLessThan(0.55);
    // A handful either way stays near neutral: the ratio is noise until it is not.
    expect(tasteFromEvents(keeps.slice(0, 2)).keepBias).toBeLessThan(0.65);
    // Never past the range the keep line can take.
    expect(tasteFromEvents(keeps).keepBias).toBeLessThanOrEqual(0.78);
    expect(tasteFromEvents(throws).keepBias).toBeGreaterThanOrEqual(0.28);
  });
});

describe("the log this account keeps", () => {
  const draft = (index: number, chosenFocus: number): CullPreferenceDraft => ({
    kind: "burst-pick",
    sessionId: "game",
    burstId: index,
    genre: "sports",
    chosen: {
      frameId: `chosen-${index}`,
      heads: { subjectFocus: { value: chosenFocus, confidence: 0.8 } },
    },
    passedOver: {
      frameId: `passed-${index}`,
      heads: { subjectFocus: { value: 1 - chosenFocus, confidence: 0.8 } },
    },
  });

  test("records, trains from what it recorded, and forgets when asked", async () => {
    const factory = new IDBFactory();
    const scope = "device-local";
    expect((await loadCullTaste(scope, factory)).events).toBe(0);

    const drafts = Array.from({ length: 24 }, (_, i) => draft(i, 0.85));
    expect(await recordCullPreferences(scope, drafts, factory)).toBe(24);

    const taste = await loadCullTaste(scope, factory);
    expect(taste.events).toBe(24);
    expect(taste.trust).toBeGreaterThan(0);
    // It learned the direction it was shown.
    expect(
      taste.score({ subjectFocus: { value: 0.85, confidence: 0.8 } }),
    ).toBeGreaterThan(taste.score({ subjectFocus: { value: 0.15, confidence: 0.8 } }));

    await forgetCullPreferences(scope, factory);
    const forgotten = await loadCullTaste(scope, factory);
    expect(forgotten.events).toBe(0);
    expect(forgotten.trust).toBe(0);
  });

  test("a browser that cannot keep a log still culls", async () => {
    // No IndexedDB at all: the cull falls back to the engine's own eye rather
    // than failing, because losing a preference is worse for the model than
    // for the photographer.
    expect((await loadCullTaste("device-local", undefined)).events).toBe(0);
    expect(await recordCullPreferences("device-local", [draft(1, 0.9)], undefined)).toBe(0);
  });

  test("nothing recorded leaves no trace", async () => {
    const factory = new IDBFactory();
    expect(await recordCullPreferences("device-local", [], factory)).toBe(0);
  });
});
