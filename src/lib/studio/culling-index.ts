import { isDuplicatePair, type FaceReading } from "../imaging";

const HASH_LENGTH = 64;
const MAX_RADIUS = 6;

type PackedHash = { high: number; low: number };

function packHash(hash: string): PackedHash | null {
  if (!/^[01]{64}$/.test(hash)) return null;
  return {
    high: Number.parseInt(hash.slice(0, 32), 2),
    low: Number.parseInt(hash.slice(32), 2),
  };
}

function popcount(value: number): number {
  value -= (value >>> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function distance(a: PackedHash, b: PackedHash): number {
  return popcount(a.high ^ b.high) + popcount(a.low ^ b.low);
}

/**
 * Exact 64-bit Hamming search, not an approximate nearest-neighbour search.
 * With radius + 1 disjoint slices, any hash within the configured radius
 * must share at least one slice. We only compare that union of candidates,
 * then verify every candidate against the complete 64 bits.
 */
export class HammingIndex64<T> {
  private readonly slices: Array<{ start: number; end: number }>;
  private readonly buckets: Array<Map<string, number[]>>;
  private readonly entries: Array<{ packed: PackedHash; value: T }> = [];
  comparisons = 0;

  constructor(readonly maxRadius = MAX_RADIUS) {
    if (!Number.isInteger(maxRadius) || maxRadius < 0 || maxRadius > MAX_RADIUS) {
      throw new RangeError(`Hamming radius must be an integer from 0 to ${MAX_RADIUS}.`);
    }
    this.slices = Array.from({ length: maxRadius + 1 }, (_, index) => ({
      start: Math.floor((index * HASH_LENGTH) / (maxRadius + 1)),
      end: Math.floor(((index + 1) * HASH_LENGTH) / (maxRadius + 1)),
    }));
    this.buckets = this.slices.map(() => new Map());
  }

  get size(): number {
    return this.entries.length;
  }

  /** Malformed or unavailable hashes are never treated as duplicates. */
  add(hash: string, value: T): boolean {
    const packed = packHash(hash);
    if (!packed) return false;
    const id = this.entries.length;
    this.entries.push({ packed, value });
    this.slices.forEach(({ start, end }, index) => {
      const key = hash.slice(start, end);
      const bucket = this.buckets[index]!;
      const candidates = bucket.get(key);
      if (candidates) candidates.push(id);
      else bucket.set(key, [id]);
    });
    return true;
  }

  /** Matches are returned in insertion order, including equal-hash entries. */
  query(hash: string, radius = this.maxRadius): T[] {
    if (!Number.isInteger(radius) || radius < 0 || radius > this.maxRadius) {
      throw new RangeError(`Query radius must be an integer from 0 to ${this.maxRadius}.`);
    }
    const packed = packHash(hash);
    if (!packed) return [];
    const candidates = new Set<number>();
    this.slices.forEach(({ start, end }, index) => {
      for (const id of this.buckets[index]!.get(hash.slice(start, end)) ?? []) {
        candidates.add(id);
      }
    });
    const matches: number[] = [];
    for (const id of candidates) {
      this.comparisons++;
      if (distance(packed, this.entries[id]!.packed) <= radius) matches.push(id);
    }
    matches.sort((a, b) => a - b);
    return matches.map((id) => this.entries[id]!.value);
  }
}

export interface CullCandidate {
  id: string;
  hash: string;
  score: number;
  faces?: FaceReading | null | undefined;
  analysisBackend?: "native-cpp" | "worker" | "main-thread" | undefined;
}

export interface DuplicateGroup {
  keeperId: string;
  duplicateIds: string[];
}

export interface DuplicateIndexResult {
  duplicateIds: Set<string>;
  /** Only groups containing at least one duplicate are included. */
  groups: DuplicateGroup[];
  comparisons: number;
  unindexedFrames: number;
}

/**
 * Rank-first, direct-match duplicate suggestions. Each group's representative
 * has the highest score; equal scores keep the earlier input frame. A-B and
 * B-C similarity never suppresses C unless C also matches the retained frame.
 * That matters in sports bursts, where a pose can change across a sequence.
 * Existing subject/eye safeguards still apply. No files, flags, edits, or
 * verdicts are mutated: callers decide how to present these suggestions.
 * IDs must be unique within a shoot.
 */
export function indexDuplicateFrames(
  frames: readonly CullCandidate[],
  options: { tolerance?: number } = {},
): DuplicateIndexResult {
  const tolerance = options.tolerance ?? 5;
  const indexes = new Map<string, HammingIndex64<CullCandidate>>();
  const groups = new Map<string, DuplicateGroup>();
  const duplicateIds = new Set<string>();
  let unindexedFrames = 0;
  const ranked = frames
    .map((frame, order) => ({ frame, order }))
    .sort((a, b) => {
      const aScore = Number.isFinite(a.frame.score) ? a.frame.score : -Infinity;
      const bScore = Number.isFinite(b.frame.score) ? b.frame.score : -Infinity;
      return aScore === bScore ? a.order - b.order : bScore - aScore;
    });

  for (const { frame } of ranked) {
    // Native and browser resampling produce different hash spaces. Never mix them.
    const engine = frame.analysisBackend === "native-cpp" ? "native" : "browser";
    let index = indexes.get(engine);
    if (!index) {
      index = new HammingIndex64<CullCandidate>(tolerance);
      indexes.set(engine, index);
    }
    const representative = index
      .query(frame.hash)
      .find((candidate) => isDuplicatePair(candidate, frame, tolerance));
    if (representative) {
      duplicateIds.add(frame.id);
      const group = groups.get(representative.id) ?? {
        keeperId: representative.id,
        duplicateIds: [],
      };
      group.duplicateIds.push(frame.id);
      groups.set(representative.id, group);
    } else if (!index.add(frame.hash, frame)) {
      unindexedFrames++;
    }
  }

  return {
    duplicateIds,
    groups: [...groups.values()],
    comparisons: [...indexes.values()].reduce((total, index) => total + index.comparisons, 0),
    unindexedFrames,
  };
}
