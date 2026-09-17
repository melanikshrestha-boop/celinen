import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { CullController, type CullSnapshot } from "../src/lib/studio/cull/controller";
import type { CullRow } from "../src/lib/studio/cull/engine";
import type { FocusHit } from "../src/lib/studio/cull/ingest-engine";
import {
  confidentFocusMiss,
  rankKeepers,
  refineFocusRows,
  targetRow,
} from "../src/lib/studio/cull/keepers";
import {
  countFrames,
  effectiveVerdict,
  filterFrames,
  markFrame,
  matchesFilter,
  type CullFrame,
} from "../src/lib/studio/cull/session";
import { openCullStore } from "../src/lib/studio/cull/store";
import { cullFrame, cullReading, cullRow } from "./cull-review.fixture";

const hit = (verdict: FocusHit["verdict"], confidence: number): FocusHit => ({
  hit: confidence,
  afAcuity: 0.2,
  bestAcuity: 0.7,
  bestRegion: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
  verdict,
});

describe("photographer marks", () => {
  test("stars, label, tag and caption set and clear without leaving keys behind", () => {
    const frame = cullFrame("a", {});
    const marked = markFrame(frame, { rating: 4, label: "red", tagged: true, caption: "Goal" });
    expect(marked).toMatchObject({ rating: 4, label: "red", tagged: true, caption: "Goal" });
    expect(frame.rating).toBeUndefined();
    const cleared = markFrame(marked, { rating: 0, label: null, tagged: false, caption: "" });
    for (const key of ["rating", "label", "tagged", "caption"]) expect(key in cleared).toBe(false);
    // Out-of-range stars clamp; no change keeps identity so nothing re-renders.
    expect(markFrame(frame, { rating: 9 }).rating).toBe(5);
    expect(markFrame(marked, { rating: 4, label: "red" })).toBe(marked);
    expect(markFrame(frame, { verdict: "keep" })).toMatchObject({ verdict: "keep", decided: true });
  });

  test("missed focus, not-in-shoot and invalid filters follow their evidence", () => {
    const missed = cullFrame("m", {}, { focusHit: hit("front-or-back-focus", 0.3) });
    const onSubject = cullFrame("o", {}, { focusHit: hit("on-subject", 0.9) });
    const stray = cullFrame(
      "s",
      {},
      { membership: { inShoot: false, reason: "Taken 9 days earlier" } },
    );
    const art = cullFrame(
      "i",
      {},
      { validity: { status: "invalid", reason: "Illustration, not a photograph" } },
    );
    expect(matchesFilter(missed, "missed-focus")).toBe(true);
    expect(matchesFilter(onSubject, "missed-focus")).toBe(false);
    const counts = countFrames([missed, onSubject, stray, art]);
    expect(counts["missed-focus"]).toBe(1);
    expect(counts["not-in-shoot"]).toBe(1);
    expect(counts.invalid).toBe(1);
  });

  test("rating, label and tag narrow any filter", () => {
    const frames = [
      cullFrame("a", {}, { rating: 3 }),
      cullFrame("b", {}, { rating: 5, label: "green", tagged: true }),
      cullFrame("c", {}, { label: "green" }),
    ];
    const ids = (list: CullFrame[]) => list.map((frame) => frame.id);
    expect(ids(filterFrames(frames, "all", { minRating: 3, label: null, tagged: false }))).toEqual([
      "a",
      "b",
    ]);
    expect(
      ids(filterFrames(frames, "all", { minRating: 0, label: "green", tagged: false })),
    ).toEqual(["b", "c"]);
    expect(ids(filterFrames(frames, "all", { minRating: 0, label: null, tagged: true }))).toEqual([
      "b",
    ]);
  });
});

describe("focus demotion", () => {
  const burst = () => [
    cullFrame("pick", null, { focusHit: hit("missed", 0.1) }),
    cullFrame("mate", null, { focusHit: hit("on-subject", 0.8) }),
    cullFrame("soft", null, { reading: cullReading({ acuitySubject: 0.2 }) }),
  ];
  const rows = () =>
    new Map<string, CullRow>([
      ["pick", cullRow({ group: 1, bestOfGroup: true, reason: "best-of-burst", score: 90 })],
      [
        "mate",
        cullRow({ group: 1, verdict: "reject", duplicate: true, reason: "duplicate", score: 84 }),
      ],
      [
        "soft",
        cullRow({ group: 1, verdict: "reject", duplicate: true, reason: "duplicate", score: 40 }),
      ],
    ]);

  test("a confidently missed pick hands the burst to its sharp mate", () => {
    const refined = refineFocusRows(burst(), rows());
    expect(refined.get("pick")).toMatchObject({
      verdict: "reject",
      reason: "missed-focus",
      bestOfGroup: false,
      score: 83,
    });
    expect(refined.get("mate")).toMatchObject({
      verdict: "keep",
      reason: "best-of-burst",
      bestOfGroup: true,
      duplicate: false,
    });
    expect(refined.get("soft")!.verdict).toBe("reject");
  });

  test("a doubtful miss, a lone frame, or no sharp mate changes nothing", () => {
    const doubtful = burst();
    doubtful[0] = { ...doubtful[0]!, focusHit: hit("missed", 0.4) };
    expect(confidentFocusMiss(doubtful[0]!)).toBe(false);
    const input = rows();
    expect(refineFocusRows(doubtful, input).get("pick")).toBe(input.get("pick"));

    const noMate = burst().filter((frame) => frame.id !== "mate");
    expect(refineFocusRows(noMate, input).get("pick")!.verdict).toBe("keep");

    const decided = burst();
    decided[0] = { ...decided[0]!, verdict: "keep", decided: true };
    expect(refineFocusRows(decided, input).get("pick")).toBe(input.get("pick"));
  });

  test("ranking puts confident misses below every other frame", () => {
    const frames = burst();
    const ranked = rankKeepers(frames, rows());
    expect(ranked).toEqual(["mate", "soft", "pick"]);
  });

  test("a target row only loses praise it no longer earns", () => {
    const praised = cullRow({ reason: "best-of-burst" });
    expect(targetRow(praised, true)).toBe(praised);
    expect(targetRow(praised, false)).toMatchObject({ verdict: "reject", reason: "none" });
    expect(targetRow(cullRow({ verdict: "reject", reason: "motion-blur" }), true)).toMatchObject({
      verdict: "keep",
      reason: "motion-blur",
    });
  });
});

function settle(controller: CullController): Promise<CullSnapshot> {
  return new Promise((resolve) => {
    const stop = controller.subscribe((snapshot) =>
      queueMicrotask(() => {
        stop();
        resolve(snapshot);
      }),
    );
  });
}

/** A controller over stored frames, ranked by the real engine on open. */
async function controllerWith(frames: CullFrame[]) {
  const factory = new IDBFactory();
  const store = await openCullStore("account", factory);
  const session = await store.create("Game");
  await store.append(
    session.id,
    frames.map((frame) => ({ frame, thumbnail: new Blob() })),
  );
  const controller = new CullController(store);
  await controller.open(session.id);
  return { controller, store, factory, session };
}

describe("controller marks, keep line and codes", () => {
  test("marks are one undo step each and persist", async () => {
    const { controller, factory, session } = await controllerWith([
      cullFrame("a", null, { captureTimeMs: 1 }),
      cullFrame("b", null, { captureTimeMs: 2 }),
    ]);
    await controller.mark(["a", "b"], { rating: 3, label: "blue" });
    await controller.mark(["a"], { tagged: true, caption: "Ja'Kobi Lane" });
    let snapshot = await settle(controller);
    expect(snapshot.frames.map((f) => [f.rating, f.label, f.tagged, f.caption])).toEqual([
      [3, "blue", true, "Ja'Kobi Lane"],
      [3, "blue", undefined, undefined],
    ]);
    await controller.undo();
    snapshot = await settle(controller);
    expect(snapshot.frames[0]!.tagged).toBeUndefined();
    expect(snapshot.frames[0]!.rating).toBe(3);

    const reopened = new CullController(await openCullStore("account", factory));
    await reopened.open(session.id);
    snapshot = await settle(reopened);
    expect(snapshot.frames.map((f) => f.rating)).toEqual([3, 3]);
    expect(snapshot.frames[0]!.tagged).toBeUndefined();
  });

  test("the keep line moves across undecided frames by score and never over a decision", async () => {
    // Acuity drives the engine's score; distinct hashes and minutes apart keep them out of one burst.
    const frames = [0.9, 0.8, 0.7, 0.6, 0.5].map((acuity, index) =>
      cullFrame(`f${index}`, null, {
        captureTimeMs: index * 600_000,
        reading: cullReading({
          acuitySubject: acuity,
          acuityBest: acuity,
          quality: acuity * 100,
          hash: [
            "0000000000000000",
            "ffffffffffffffff",
            "00000000ffffffff",
            "ffffffff00000000",
            "0f0f0f0f0f0f0f0f",
          ][index]!,
        }),
      }),
    );
    frames[1] = { ...frames[1]!, verdict: "reject", decided: true };
    const { controller, factory, session } = await controllerWith(frames);
    let snapshot = await settle(controller);
    expect(snapshot.ranked).toBe(5);
    const keeps = (s: CullSnapshot) =>
      s.frames.filter((frame) => effectiveVerdict(frame) === "keep").map((frame) => frame.id);

    controller.setKeepTarget(3);
    snapshot = await settle(controller);
    expect(snapshot.keepTarget).toBe(3);
    // f1 holds a rank slot but stays the photographer's reject.
    expect(keeps(snapshot)).toEqual(["f0", "f2"]);
    const untouched = snapshot.frames[4]!;

    controller.setKeepTarget(4);
    snapshot = await settle(controller);
    expect(keeps(snapshot)).toEqual(["f0", "f2", "f3"]);
    // Frames outside the moved band keep their identity: nothing else re-renders.
    expect(snapshot.frames[4]).toBe(untouched);

    controller.setKeepTarget(99);
    expect((await settle(controller)).keepTarget).toBe(5);
    controller.setKeepTarget(1);
    controller.dispose();
    const reopened = new CullController(await openCullStore("account", factory));
    await reopened.open(session.id);
    snapshot = await settle(reopened);
    expect(snapshot.keepTarget).toBe(1);
    expect(keeps(snapshot)).toEqual(["f0"]);
  });

  test("codes load per account, merge later-wins, and reject empty files", async () => {
    const { controller, factory } = await controllerWith([]);
    await controller.loadCodes();
    await controller.addCodes({
      name: "game.txt",
      kind: "codes",
      text: "u23\tJa'Kobi Lane\nref\tReferee",
    });
    await controller.addCodes({
      name: "roster.csv",
      kind: "roster",
      prefix: "o",
      text: "number,name\n7,Sam Ortiz",
    });
    await expect(
      controller.addCodes({ name: "bad.txt", kind: "codes", text: "no tabs here" }),
    ).rejects.toThrow("Line 1");
    const snapshot = await settle(controller);
    expect(snapshot.codes.sources.map((s) => [s.name, s.count])).toEqual([
      ["game.txt", 2],
      ["roster.csv", 1],
    ]);
    expect(snapshot.codes.table.codes.get("o7")?.[0]).toBe("Sam Ortiz");

    const other = new CullController(await openCullStore("account", factory));
    await other.loadCodes();
    const again = await settle(other);
    expect(again.codes.table.codes.get("u23")?.[0]).toBe("Ja'Kobi Lane");
    await other.removeCodes(again.codes.sources[0]!.id);
    expect((await settle(other)).codes.table.codes.has("u23")).toBe(false);
  });
});
