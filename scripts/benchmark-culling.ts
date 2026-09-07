/** Run with: bun scripts/benchmark-culling.ts. Synthetic hash-stage benchmark only. */
import { isDuplicatePair } from "../src/lib/imaging";
import { indexDuplicateFrames, type CullCandidate } from "../src/lib/studio/culling-index";

function fixture(count: number, mode: "diverse" | "bursts"): CullCandidate[] {
  let state = 951;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  const frames: CullCandidate[] = [];
  let base = "";
  for (let i = 0; i < count; i++) {
    if (mode === "diverse" || i % 8 === 0) {
      base = random().toString(2).padStart(32, "0") + random().toString(2).padStart(32, "0");
    }
    const bits = [...base];
    if (mode === "bursts") {
      for (let bit = 0; bit < (i % 8) * 2; bit++) {
        const position = (bit * 7) % 64;
        bits[position] = bits[position] === "1" ? "0" : "1";
      }
    }
    frames.push({ id: `frame-${i}`, hash: bits.join(""), score: random() % 100 });
  }
  return frames;
}

function bruteForce(frames: CullCandidate[]) {
  const ranked = frames
    .map((frame, order) => ({ frame, order }))
    .sort((a, b) => b.frame.score - a.frame.score || a.order - b.order);
  const retained: CullCandidate[] = [];
  const duplicateIds = new Set<string>();
  let comparisons = 0;
  for (const { frame } of ranked) {
    const representative = retained.find((candidate) => {
      comparisons++;
      return isDuplicatePair(candidate, frame);
    });
    if (representative) duplicateIds.add(frame.id);
    else retained.push(frame);
  }
  return { comparisons, duplicateIds };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

// Warm both paths before timing. Alternating their execution keeps the trial
// conditions comparable. No file reads, image decode, face detection or UI work
// are included, and these numbers must not be represented as ingest throughput.
const warmup = fixture(300, "bursts");
for (let i = 0; i < 5; i++) {
  bruteForce(warmup);
  indexDuplicateFrames(warmup);
}

for (const mode of ["diverse", "bursts"] as const) {
  for (const count of [300, 1000, 5000]) {
    const frames = fixture(count, mode);
    const bruteTimes: number[] = [];
    const indexedTimes: number[] = [];
    let bruteComparisons = 0;
    let indexComparisons = 0;
    let duplicates = 0;
    for (let run = 0; run < 5; run++) {
      const bruteStart = performance.now();
      const brute = bruteForce(frames);
      bruteTimes.push(performance.now() - bruteStart);
      const indexStart = performance.now();
      const indexed = indexDuplicateFrames(frames);
      indexedTimes.push(performance.now() - indexStart);
      if (
        brute.duplicateIds.size !== indexed.duplicateIds.size ||
        [...brute.duplicateIds].some((id) => !indexed.duplicateIds.has(id))
      ) {
        throw new Error(`Output mismatch for ${mode}/${count}.`);
      }
      bruteComparisons = brute.comparisons;
      indexComparisons = indexed.comparisons;
      duplicates = indexed.duplicateIds.size;
    }
    const bruteMs = median(bruteTimes);
    const indexedMs = median(indexedTimes);
    console.log(
      JSON.stringify({
        fixture: mode,
        frames: count,
        trials: 5,
        medianBruteMs: Number(bruteMs.toFixed(2)),
        medianIndexedMs: Number(indexedMs.toFixed(2)),
        speedup: Number((bruteMs / indexedMs).toFixed(1)),
        bruteComparisons,
        indexComparisons,
        duplicates,
      }),
    );
  }
}
