import { describe, expect, test } from "bun:test";
import { hamming, isDuplicatePair } from "../src/lib/imaging";
import {
  HammingIndex64,
  indexDuplicateFrames,
  type CullCandidate,
} from "../src/lib/studio/culling-index";

function random(seed = 73) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

function hashOf(next: () => number): string {
  return next().toString(2).padStart(32, "0") + next().toString(2).padStart(32, "0");
}

function flip(hash: string, positions: number[]): string {
  const bits = [...hash];
  for (const position of positions) bits[position] = bits[position] === "1" ? "0" : "1";
  return bits.join("");
}

function bruteForce(frames: readonly CullCandidate[], tolerance = 5): Set<string> {
  const retained: CullCandidate[] = [];
  const duplicateIds = new Set<string>();
  const ranked = frames
    .map((frame, order) => ({ frame, order }))
    .sort((a, b) => b.frame.score - a.frame.score || a.order - b.order);
  for (const { frame } of ranked) {
    if (!/^[01]{64}$/.test(frame.hash)) continue;
    if (retained.some((candidate) => isDuplicatePair(candidate, frame, tolerance)))
      duplicateIds.add(frame.id);
    else retained.push(frame);
  }
  return duplicateIds;
}

describe("HammingIndex64", () => {
  test("returns precisely the brute-force matches for every supported radius", () => {
    const next = random();
    const hashes = Array.from({ length: 180 }, () => hashOf(next));
    for (const hash of hashes.slice(0, 20)) {
      for (let bits = 0; bits <= 7; bits++)
        hashes.push(
          flip(
            hash,
            Array.from({ length: bits }, (_, i) => i * 9),
          ),
        );
    }
    const index = new HammingIndex64<number>();
    hashes.forEach((hash, id) => index.add(hash, id));
    for (let radius = 0; radius <= 6; radius++) {
      for (const hash of hashes) {
        expect(index.query(hash, radius)).toEqual(
          hashes.flatMap((candidate, id) => (hamming(candidate, hash) <= radius ? [id] : [])),
        );
      }
    }
  });

  test("does not index malformed hashes and validates its radius", () => {
    const index = new HammingIndex64<string>();
    for (const hash of ["", "0".repeat(63), "0".repeat(65), "x".repeat(64)]) {
      expect(index.add(hash, "bad")).toBe(false);
      expect(index.query(hash)).toEqual([]);
    }
    expect(index.size).toBe(0);
    expect(() => new HammingIndex64(7)).toThrow(RangeError);
    expect(() => index.query("0".repeat(64), -1)).toThrow(RangeError);
    expect(() => index.query("0".repeat(64), 0.5)).toThrow(RangeError);
  });

  test("handles high-bit and sign-boundary differences", () => {
    const hash = "0".repeat(64);
    const index = new HammingIndex64<string>();
    index.add(flip(hash, [0, 31, 32, 63]), "boundary");
    expect(index.query(hash, 3)).toEqual([]);
    expect(index.query(hash, 4)).toEqual(["boundary"]);
  });
});

describe("indexDuplicateFrames", () => {
  test("matches brute-force rank-first culling across synthetic bursts", () => {
    const next = random(42);
    const frames: CullCandidate[] = [];
    for (let burst = 0; burst < 80; burst++) {
      const base = hashOf(next);
      for (let moment = 0; moment < 8; moment++)
        frames.push({
          id: `${burst}-${moment}`,
          hash: flip(
            base,
            Array.from({ length: moment }, (_, i) => i * 8),
          ),
          score: next() % 100,
        });
    }
    for (let tolerance = 0; tolerance <= 6; tolerance++) {
      expect([...indexDuplicateFrames(frames, { tolerance }).duplicateIds].sort()).toEqual(
        [...bruteForce(frames, tolerance)].sort(),
      );
    }
  });

  test("keeps the highest score, uses stable ties, and never mutates inputs", () => {
    const frames = Object.freeze([
      Object.freeze({ id: "low", hash: "0".repeat(64), score: 20 }),
      Object.freeze({ id: "first-best", hash: "0".repeat(64), score: 90 }),
      Object.freeze({ id: "tied-best", hash: "0".repeat(64), score: 90 }),
    ]);
    const result = indexDuplicateFrames(frames);
    expect(result.groups).toEqual([{ keeperId: "first-best", duplicateIds: ["tied-best", "low"] }]);
    expect(result.duplicateIds.has("first-best")).toBe(false);
    expect(frames.map((frame) => frame.id)).toEqual(["low", "first-best", "tied-best"]);
  });

  test("retains distinct endpoints of a changing sports burst", () => {
    const base = "0".repeat(64);
    const result = indexDuplicateFrames([
      { id: "takeoff", hash: base, score: 95 },
      { id: "transition", hash: flip(base, [0, 1, 2, 3]), score: 85 },
      { id: "peak-action", hash: flip(base, [0, 1, 2, 3, 4, 5, 6, 7]), score: 75 },
    ]);
    expect([...result.duplicateIds]).toEqual(["transition"]);
    expect(result.duplicateIds.has("peak-action")).toBe(false);
  });

  test("preserves eye-state and face-sharpness differences even with the same image hash", () => {
    const base = { hash: "1".repeat(64), faces: { count: 1, faceSharpness: 100, eyesOpen: true } };
    const result = indexDuplicateFrames([
      { ...base, id: "sharp-open", score: 95 },
      { ...base, id: "eyes-closed", score: 80, faces: { ...base.faces, eyesOpen: false } },
      { ...base, id: "softer-face", score: 70, faces: { ...base.faces, faceSharpness: 40 } },
      { ...base, id: "matching-pose", score: 60 },
    ]);
    expect([...result.duplicateIds]).toEqual(["matching-pose"]);
  });

  test("empty, unreadable, and invalid-score frames remain available", () => {
    expect(indexDuplicateFrames([]).groups).toEqual([]);
    const result = indexDuplicateFrames([
      { id: "undecoded", hash: "", score: 0 },
      { id: "malformed", hash: "0", score: 100 },
      { id: "normal", hash: "0".repeat(64), score: 20 },
      { id: "invalid-score", hash: "0".repeat(64), score: Number.NaN },
    ]);
    expect(result.unindexedFrames).toBe(2);
    expect([...result.duplicateIds]).toEqual(["invalid-score"]);
    expect(result.duplicateIds.has("undecoded")).toBe(false);
    expect(result.duplicateIds.has("malformed")).toBe(false);
  });

  test("identical native and browser hashes never suppress one another", () => {
    const hash = "10".repeat(32);
    const result = indexDuplicateFrames([
      { id: "native", hash, score: 100, analysisBackend: "native-cpp" },
      { id: "browser", hash, score: 90, analysisBackend: "worker" },
    ]);
    expect(result.groups).toEqual([]);
    expect([...result.duplicateIds]).toEqual([]);
    expect(result.comparisons).toBe(0);
    expect(result.unindexedFrames).toBe(0);
  });

  test("deduplicates within each hash domain while preserving independent representatives", () => {
    const hash = "10".repeat(32);
    const frames: CullCandidate[] = [
      { id: "native-best", hash, score: 100, analysisBackend: "native-cpp" },
      { id: "legacy-browser-best", hash, score: 95 },
      { id: "native-near", hash: flip(hash, [5, 31]), score: 90, analysisBackend: "native-cpp" },
      { id: "worker-near", hash: flip(hash, [5, 31]), score: 85, analysisBackend: "worker" },
      { id: "main-thread-near", hash: flip(hash, [5, 31]), score: 80, analysisBackend: "main-thread" },
    ];
    const before = JSON.stringify(frames);
    const result = indexDuplicateFrames(frames);
    expect(result.groups).toEqual([
      { keeperId: "native-best", duplicateIds: ["native-near"] },
      { keeperId: "legacy-browser-best", duplicateIds: ["worker-near", "main-thread-near"] },
    ]);
    expect(result.duplicateIds.has("native-best")).toBe(false);
    expect(result.duplicateIds.has("legacy-browser-best")).toBe(false);
    expect(result.comparisons).toBe(3);
    expect(JSON.stringify(frames)).toBe(before);
  });
});
