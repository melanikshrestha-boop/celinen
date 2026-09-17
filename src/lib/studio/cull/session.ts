/** The cull session's model: what a shoot looks like once the engine has read
 * it, and every question the review screen asks of it. Pure functions over
 * plain data — no React, no storage, no engine — so the screen can be driven
 * from a keyboard, a test, or ten thousand frames without changing any of it.
 */
import type { CullReason, CullRow, CullVerdict } from "./engine";
import type { CullReading } from "./engine";

export type CullFrame = {
  id: string;
  name: string;
  /** Where the file sat on the card, for reconnecting it later. */
  relativePath?: string | undefined;
  /** The original's own pixel size. */
  width: number;
  height: number;
  bytes: number;
  captureTimeMs: number | null;
  captureTimeBasis?: "utc" | "camera_clock" | undefined;
  cameraKey?: string | undefined;
  /** The engine's measurements. Absent while the frame is still being read. */
  reading?: CullReading | undefined;
  /** What the engine suggested. Absent until the shoot-level pass has run. */
  suggestion?: CullRow | undefined;
  /** What the photographer chose. This always wins. */
  verdict: CullVerdict;
  /** Set when the photographer has decided this frame themselves. */
  decided: boolean;
  /** Why the file could not be read, when it could not. */
  error?: string | undefined;
};

/** The filters the review screen offers, in the order it shows them. */
export type CullFilter =
  | "all"
  | "keepers"
  | "rejects"
  | "undecided"
  | "out-of-focus"
  | "motion-blur"
  | "eyes-closed"
  | "exposure"
  | "duplicates";

export const CULL_FILTERS: readonly CullFilter[] = [
  "all",
  "keepers",
  "rejects",
  "undecided",
  "out-of-focus",
  "motion-blur",
  "eyes-closed",
  "exposure",
  "duplicates",
];

export const CULL_FILTER_LABELS: Record<CullFilter, string> = {
  all: "All",
  keepers: "Keepers",
  rejects: "Rejects",
  undecided: "Undecided",
  "out-of-focus": "Out of focus",
  "motion-blur": "Motion blur",
  "eyes-closed": "Eyes closed",
  exposure: "Exposure",
  duplicates: "Duplicates",
};

/** What a frame is called in the review screen when the engine explains itself. */
export const CULL_REASON_LABELS: Record<CullReason, string> = {
  none: "",
  "out-of-focus": "Out of focus",
  "motion-blur": "Motion blur",
  "missed-focus": "Focus missed the subject",
  "eyes-closed": "Eyes closed",
  exposure: "Exposure",
  duplicate: "Near-identical frame scored better",
  "best-of-burst": "Best of burst",
  "strong-frame": "Sharp and well exposed",
};

/** The verdict a frame currently carries: the photographer's if they decided,
 * otherwise the engine's suggestion, otherwise undecided. */
export function effectiveVerdict(frame: CullFrame): CullVerdict {
  if (frame.decided) return frame.verdict;
  return frame.suggestion?.verdict ?? "undecided";
}

export function matchesFilter(frame: CullFrame, filter: CullFilter): boolean {
  const verdict = effectiveVerdict(frame);
  const reason = frame.suggestion?.reason;
  switch (filter) {
    case "all":
      return true;
    case "keepers":
      return verdict === "keep";
    case "rejects":
      return verdict === "reject";
    case "undecided":
      return verdict === "undecided";
    case "out-of-focus":
      // Missed focus is a focus problem the photographer wants in this list.
      return reason === "out-of-focus" || reason === "missed-focus";
    case "motion-blur":
      return reason === "motion-blur";
    case "eyes-closed":
      return reason === "eyes-closed";
    case "exposure":
      return reason === "exposure";
    case "duplicates":
      return Boolean(frame.suggestion?.duplicate || frame.suggestion?.bestOfGroup);
  }
}

export function filterFrames(frames: readonly CullFrame[], filter: CullFilter): CullFrame[] {
  return frames.filter((frame) => matchesFilter(frame, filter));
}

export type CullCounts = Record<CullFilter, number> & { measured: number; unreadable: number };

/** Every count the review screen shows, in one pass over the shoot. */
export function countFrames(frames: readonly CullFrame[]): CullCounts {
  const counts = Object.fromEntries(CULL_FILTERS.map((filter) => [filter, 0])) as CullCounts;
  counts.measured = 0;
  counts.unreadable = 0;
  for (const frame of frames) {
    for (const filter of CULL_FILTERS) if (matchesFilter(frame, filter)) counts[filter] += 1;
    if (frame.reading) counts.measured += 1;
    if (frame.error) counts.unreadable += 1;
  }
  return counts;
}

export type CullGroup = {
  /** The engine's group number, or the frame's own id when it stands alone. */
  id: string;
  frames: CullFrame[];
  /** The frame the engine picked, or the only one there is. */
  bestId: string;
};

/**
 * Bursts, in capture order, each with its best frame first. A sports card is
 * mostly bursts: reviewing one stack at a time is the difference between
 * looking at ten thousand frames and looking at eight hundred decisions.
 */
export function groupFrames(frames: readonly CullFrame[]): CullGroup[] {
  const groups = new Map<string, CullFrame[]>();
  const order: string[] = [];
  for (const frame of frames) {
    const group = frame.suggestion?.group;
    const key = group === undefined || group === null ? `solo:${frame.id}` : `burst:${group}`;
    const existing = groups.get(key);
    if (existing) existing.push(frame);
    else {
      groups.set(key, [frame]);
      order.push(key);
    }
  }
  return order.map((key) => {
    const members = groups.get(key)!;
    const best =
      members.find((frame) => frame.suggestion?.bestOfGroup) ??
      [...members].sort((a, b) => (b.suggestion?.score ?? 0) - (a.suggestion?.score ?? 0))[0]!;
    return {
      id: key,
      frames: [best, ...members.filter((frame) => frame.id !== best.id)],
      bestId: best.id,
    };
  });
}

/** How far along a card is, and how much longer it has. */
export type CullProgress = {
  total: number;
  read: number;
  failed: number;
  /** Frames per second over the recent window, or null before there is a rate. */
  rate: number | null;
  /** Milliseconds left at that rate, or null when it cannot be known yet. */
  remainingMs: number | null;
  done: boolean;
};

export function ingestProgress(
  total: number,
  read: number,
  failed: number,
  elapsedMs: number,
): CullProgress {
  const finished = read + failed;
  // A rate needs both a few frames and a little time; anything less reads as a
  // wild guess on the screen and then jumps.
  const rate = finished >= 8 && elapsedMs > 500 ? (finished / elapsedMs) * 1000 : null;
  return {
    total,
    read,
    failed,
    rate,
    remainingMs: rate && finished < total ? ((total - finished) / rate) * 1000 : null,
    done: finished >= total,
  };
}

/** "2 min 10 sec left" — a photographer's phrasing, not a progress bar's. */
export function formatRemaining(remainingMs: number | null): string {
  if (remainingMs === null) return "";
  const seconds = Math.max(0, Math.round(remainingMs / 1000));
  if (seconds < 10) return "a few seconds left";
  if (seconds < 60) return `${seconds} seconds left`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes >= 10) return `${minutes} minutes left`;
  return rest ? `${minutes} min ${rest} sec left` : `${minutes} min left`;
}

/** Applies a decision. The photographer's choice is recorded as theirs, so no
 * later pass can quietly replace it. */
export function decide(frame: CullFrame, verdict: CullVerdict): CullFrame {
  if (frame.decided && frame.verdict === verdict) return frame;
  return { ...frame, verdict, decided: verdict !== "undecided" };
}

/** Takes the engine's suggestions for a whole shoot without touching any frame
 * the photographer has already decided. */
export function applySuggestions(
  frames: readonly CullFrame[],
  rows: ReadonlyMap<string, CullRow>,
): CullFrame[] {
  return frames.map((frame) => {
    const suggestion = rows.get(frame.id);
    if (!suggestion || frame.suggestion === suggestion) return frame;
    return { ...frame, suggestion };
  });
}

/** The next frame to look at after acting on this one. Reviewing is a stream:
 * the screen should never make the photographer aim at the next thumbnail. */
export function nextFrameId(
  frames: readonly CullFrame[],
  currentId: string | null,
  step: 1 | -1 = 1,
): string | null {
  if (!frames.length) return null;
  const index = frames.findIndex((frame) => frame.id === currentId);
  if (index < 0) return frames[0]!.id;
  const next = index + step;
  if (next < 0 || next >= frames.length) return frames[index]!.id;
  return frames[next]!.id;
}
