import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { cullDatabaseName } from "../src/lib/studio/cull/store";
import type { CullHeadSet } from "../src/lib/studio/cull/intel";
import {
  createPairwiseRanker,
  cullPreferencesDatabaseName,
  headFeature,
  openCullPreferenceLog,
  preferenceFromDecision,
  type CullPreferenceDraft,
  type CullPreferenceEvent,
} from "../src/lib/studio/cull/preferences";

const heads = (values: Partial<Record<string, number>>, confidence = 0.8): CullHeadSet =>
  Object.fromEntries(
    Object.entries(values).map(([head, value]) => [head, { value: value!, confidence }]),
  ) as CullHeadSet;

function draft(index: number, chosenFocus: number, passedFocus: number): CullPreferenceDraft {
  return {
    kind: "burst-pick",
    sessionId: "session-a",
    burstId: index,
    genre: "sports",
    chosen: { frameId: `chosen-${index}`, heads: heads({ subjectFocus: chosenFocus }) },
    passedOver: { frameId: `passed-${index}`, heads: heads({ subjectFocus: passedFocus }) },
  };
}

describe("the preference log", () => {
  test("appends in order, reads back what it stored, and lives in its own database", async () => {
    const factory = new IDBFactory();
    const log = await openCullPreferenceLog("account-a", factory);
    const written = await log.append([draft(1, 0.8, 0.4), draft(2, 0.7, 0.5)]);
    expect(written).toHaveLength(2);
    expect(written[0]!.id < written[1]!.id).toBe(true);
    expect(written[0]!.at).toBeGreaterThan(0);

    const events = await log.read();
    expect(events.map((event) => event.chosen.frameId)).toEqual(["chosen-1", "chosen-2"]);
    expect(events[0]!.chosen.heads.subjectFocus).toEqual({ value: 0.8, confidence: 0.8 });
    expect(await log.count()).toBe(2);

    // Never the cull session store: deleting a shoot must not delete what it taught.
    expect(cullPreferencesDatabaseName("account-a")).not.toBe(cullDatabaseName("account-a"));
    expect(cullPreferencesDatabaseName("account a/b")).toBe("celinen-cull-preferences:account_a_b");
    log.close();
  });

  test("is append-only: a replayed id never rewrites what was recorded", async () => {
    const factory = new IDBFactory();
    const log = await openCullPreferenceLog("account-b", factory);
    const [first] = await log.append([{ ...draft(1, 0.9, 0.2), id: "fixed-id", at: 1000 }]);
    await log.append([
      { ...draft(1, 0.1, 0.9), id: "fixed-id", at: 2000 },
      { ...draft(3, 0.6, 0.3), id: "later-id", at: 3000 },
    ]);
    const events = await log.read();
    expect(events).toHaveLength(2);
    expect(events.find((event) => event.id === "fixed-id")!.chosen.heads.subjectFocus!.value).toBe(
      0.9,
    );
    expect(first!.at).toBe(1000);
    log.close();
  });

  test("survives a reopen, continues from an id already seen, and can be erased on request", async () => {
    const factory = new IDBFactory();
    const first = await openCullPreferenceLog("account-c", factory);
    const written = await first.append([
      draft(1, 0.8, 0.3),
      draft(2, 0.8, 0.3),
      draft(3, 0.8, 0.3),
    ]);
    first.close();

    const again = await openCullPreferenceLog("account-c", factory);
    expect(await again.count()).toBe(3);
    const rest = await again.read({ after: written[0]!.id });
    expect(rest.map((event) => event.id)).toEqual([written[1]!.id, written[2]!.id]);
    expect(await again.read({ limit: 2 })).toHaveLength(2);

    await again.erase();
    expect(await again.count()).toBe(0);
    again.close();
  });

  test("a decision the engine already agreed with teaches nothing", () => {
    const chosen = { frameId: "a", heads: heads({ subjectFocus: 0.8 }) };
    expect(
      preferenceFromDecision({ kind: "burst-pick", sessionId: "s", genre: "sports", chosen }),
    ).toBeNull();
    expect(
      preferenceFromDecision({
        kind: "burst-pick",
        sessionId: "s",
        genre: "sports",
        chosen,
        passedOver: chosen,
      }),
    ).toBeNull();
    const event = preferenceFromDecision({
      kind: "restored-reject",
      sessionId: "s",
      burstId: 4,
      genre: "wedding",
      chosen,
      passedOver: { frameId: "b", heads: heads({ subjectFocus: 0.9 }) },
    });
    expect(event).not.toBeNull();
    expect(event!.aiPickId).toBe("b");
    expect(event!.photographerPickId).toBe("a");
    expect(event!.burstId).toBe(4);
  });
});

describe("the online pairwise ranker", () => {
  test("a head that is absent is neutral, not bad", () => {
    expect(headFeature({}, "subjectFocus")).toBe(0.5);
    expect(headFeature(heads({ subjectFocus: 1 }, 1), "subjectFocus")).toBe(1);
    // Lower is better for noise, and confidence pulls a value toward neutral.
    expect(headFeature(heads({ noise: 1 }, 1), "noise")).toBe(0);
    expect(headFeature(heads({ noise: 1 }, 0.5), "noise")).toBe(0.25);
  });

  test("learns which head this photographer actually culls on", () => {
    const ranker = createPairwiseRanker({ learningRate: 0.3 });
    // This photographer always takes the frame with the better expression, even
    // when the other is sharper: the engine's own order would get these wrong.
    const events: CullPreferenceEvent[] = [];
    let state = 3;
    const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0xffffffff;
    for (let i = 0; i < 400; i++) {
      const chosen = heads({
        expression: 0.55 + 0.45 * random(),
        subjectFocus: 0.2 + 0.4 * random(),
      });
      const passedOver = heads({
        expression: 0.1 + 0.3 * random(),
        subjectFocus: 0.6 + 0.4 * random(),
      });
      events.push({
        id: `${i}`,
        at: i,
        kind: "burst-pick",
        sessionId: "s",
        burstId: i,
        genre: "wedding",
        chosen: { frameId: `a${i}`, heads: chosen },
        passedOver: { frameId: `b${i}`, heads: passedOver },
      });
    }
    const train = events.slice(0, 320);
    const held = events.slice(320);
    expect(ranker.accuracy(held)).toBeLessThan(0.6); // an untrained ranker is a coin flip
    const loss = ranker.learnFromEvents(train, { passes: 3 });
    expect(loss).toBeGreaterThan(0);
    expect(ranker.accuracy(held)).toBeGreaterThan(0.9);
    const weights = ranker.weights();
    expect(weights.expression!).toBeGreaterThan(0);
    expect(weights.expression!).toBeGreaterThan(weights.subjectFocus ?? 0);
    expect(
      ranker.probability(events[0]!.chosen.heads, events[0]!.passedOver!.heads),
    ).toBeGreaterThan(0.5);
  });

  test("regularization keeps a rarely-seen head from running away", () => {
    const ranker = createPairwiseRanker({ learningRate: 0.5, regularization: 0.05 });
    for (let i = 0; i < 2000; i++) ranker.learn(heads({ pose: 1 }, 1), heads({ pose: 0 }, 1));
    expect(Math.abs(ranker.weights().pose!)).toBeLessThan(25);
    expect(ranker.probability(heads({ pose: 1 }, 1), heads({ pose: 0 }, 1))).toBeGreaterThan(0.85);
  });

  test("carries its weights across sessions, and refuses a nonsense setup", () => {
    const trained = createPairwiseRanker();
    for (let i = 0; i < 50; i++) trained.learn(heads({ eyeFocus: 0.9 }), heads({ eyeFocus: 0.2 }));
    const saved = JSON.parse(JSON.stringify(trained.toJSON()));
    const restored = createPairwiseRanker({
      weights: saved.weights,
      learningRate: saved.learningRate,
    });
    expect(restored.score(heads({ eyeFocus: 0.9 }))).toBeCloseTo(
      trained.score(heads({ eyeFocus: 0.9 })),
      10,
    );
    expect(() => createPairwiseRanker({ learningRate: 0 })).toThrow();
    expect(() => createPairwiseRanker({ regularization: -1 })).toThrow();
  });

  test("events with no alternative are skipped, so a log of agreements is harmless", () => {
    const ranker = createPairwiseRanker();
    const events: CullPreferenceEvent[] = [
      {
        id: "1",
        at: 1,
        kind: "confirmed-pick",
        sessionId: "s",
        burstId: 1,
        genre: "sports",
        chosen: { frameId: "a", heads: heads({ subjectFocus: 0.9 }) },
      },
    ];
    expect(ranker.learnFromEvents(events)).toBe(0);
    expect(ranker.accuracy(events)).toBe(0);
    expect(Object.keys(ranker.weights())).toHaveLength(0);
  });
});
