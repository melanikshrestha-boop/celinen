/** The cull session's model: what a shoot looks like once the engine has read
 * it, and every question the review screen asks of it. Pure functions over
 * plain data — no React, no storage, no engine — so the screen can be driven
 * from a keyboard, a test, or ten thousand frames without changing any of it.
 */
import type { CullReason, CullRow, CullVerdict } from "./engine";
import type { CullReading } from "./engine";
import type { FocusHit, NormalizedRect } from "./ingest-engine";

/** Lightroom's color labels. 6-9 set the first four, in Lightroom's order. */
export type CullLabel = "red" | "yellow" | "green" | "blue" | "purple";
export const CULL_LABELS: readonly CullLabel[] = ["red", "yellow", "green", "blue", "purple"];

/** Whether a file is a photograph this cull should judge at all. Written by a
 * validity engine; absent means nothing has said otherwise. */
export type CullValidity = {
  status: "valid" | "suspect" | "invalid";
  /** One line, e.g. "Illustration, not a photograph". */
  reason: string;
};

/** Whether a frame belongs to the shoot it came in with (last week's game left
 * on the card, a phone screenshot). Absent means it does. */
export type CullMembership = { inShoot: boolean; reason: string };

export type CullBurstRoleName =
  "pick" | "alternate" | "review" | "build-up" | "follow-through" | "duplicate";

/** A frame's part in its burst, with a one-line reason. */
export type CullBurstRole = { role: CullBurstRoleName; reason: string };

export type CullFrame = {
  id: string;
  name: string;
  /** Where the file sat on the card, for reconnecting it later. */
  relativePath?: string | undefined;
  /** The original's own pixel size. */
  width: number;
  height: number;
  bytes: number;
  /** The file's modification time at import; with `bytes`, how a reconnected
   * original proves it is still the same file. */
  lastModified?: number | undefined;
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
  /** The file was read, but something in it is broken — a truncated preview, a
   * corrupt scan. Said in the ingest's own words. A frame like this has a
   * measurement of whatever survived, so it is never judged on sharpness. */
  damaged?: string | undefined;
  /** 1..5 stars; absent is unrated. */
  rating?: number | undefined;
  label?: CullLabel | undefined;
  /** Photo Mechanic's tag. */
  tagged?: boolean | undefined;
  /** The caption, codes already expanded. */
  caption?: string | undefined;
  /** The camera's AF area from its maker note, normalized to the upright frame. */
  afPoint?: NormalizedRect | undefined;
  /** Whether the camera reported focus lock there; undefined when it did not say. */
  afConfirmed?: boolean | undefined;
  /** Sharpness at the AF area against the frame's sharpest detail. */
  focusHit?: FocusHit | undefined;
  validity?: CullValidity | undefined;
  membership?: CullMembership | undefined;
  burstRole?: CullBurstRole | undefined;
};

/** What the photographer sets on frames. Absent fields are left alone; a null
 * label, a 0 rating, false tag or empty caption clears. */
export type CullMarks = {
  verdict?: CullVerdict | undefined;
  rating?: number | undefined;
  label?: CullLabel | null | undefined;
  tagged?: boolean | undefined;
  caption?: string | undefined;
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
  | "duplicates"
  | "missed-focus"
  | "not-in-shoot"
  | "invalid";

export const CULL_FILTERS: readonly CullFilter[] = [
  "all",
  "keepers",
  "rejects",
  "undecided",
  "out-of-focus",
  "missed-focus",
  "motion-blur",
  "eyes-closed",
  "exposure",
  "duplicates",
  "not-in-shoot",
  "invalid",
];

/** Filters for evidence not every shoot has; their chips show only when something matches. */
export const CULL_OPTIONAL_FILTERS: ReadonlySet<CullFilter> = new Set<CullFilter>([
  "missed-focus",
  "not-in-shoot",
  "invalid",
]);

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
  "missed-focus": "Missed focus",
  "not-in-shoot": "Not from this shoot",
  invalid: "Invalid",
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
    case "missed-focus":
      return missedFocus(frame);
    case "not-in-shoot":
      return frame.membership?.inShoot === false;
    case "invalid":
      return (
        frame.damaged !== undefined ||
        (frame.validity !== undefined && frame.validity.status !== "valid")
      );
  }
}

/** Focus did not land on the camera's AF area: nothing is sharp, or something
 * in front of or behind it is. */
export function missedFocus(frame: CullFrame): boolean {
  const verdict = frame.focusHit?.verdict;
  return (
    verdict === "missed" ||
    verdict === "front-or-back-focus" ||
    frame.suggestion?.reason === "missed-focus"
  );
}

/** Narrowing on top of a filter by the photographer's own marks. */
export type CullRefine = {
  /** 0 is any rating. */
  minRating: number;
  label: CullLabel | null;
  tagged: boolean;
};

export const NO_REFINE: CullRefine = { minRating: 0, label: null, tagged: false };

export function refining(refine: CullRefine): boolean {
  return refine.minRating > 0 || refine.label !== null || refine.tagged;
}

export function matchesRefine(frame: CullFrame, refine: CullRefine): boolean {
  if (refine.minRating > 0 && (frame.rating ?? 0) < refine.minRating) return false;
  if (refine.label !== null && frame.label !== refine.label) return false;
  return !refine.tagged || frame.tagged === true;
}

export function filterFrames(
  frames: readonly CullFrame[],
  filter: CullFilter,
  refine: CullRefine = NO_REFINE,
): CullFrame[] {
  if (!refining(refine)) return frames.filter((frame) => matchesFilter(frame, filter));
  return frames.filter((frame) => matchesFilter(frame, filter) && matchesRefine(frame, refine));
}

export type CullCounts = Record<CullFilter, number> & { measured: number; unreadable: number };

/** Every count the review screen shows, in one pass over the shoot. */
export function countFrames(frames: readonly CullFrame[]): CullCounts {
  const counts = Object.fromEntries(CULL_FILTERS.map((filter) => [filter, 0])) as CullCounts;
  counts.measured = 0;
  counts.unreadable = 0;
  // Every chip counted in one pass, reading each frame's verdict and reason
  // once: asking matchesFilter twelve times per frame costs several
  // milliseconds on a ten-thousand frame card, on every keypress.
  // cull-review's tests hold this in step with matchesFilter.
  for (const frame of frames) {
    const suggestion = frame.suggestion;
    const verdict = frame.decided ? frame.verdict : (suggestion?.verdict ?? "undecided");
    const reason = suggestion?.reason;
    counts.all += 1;
    if (verdict === "keep") counts.keepers += 1;
    else if (verdict === "reject") counts.rejects += 1;
    else counts.undecided += 1;
    if (reason !== undefined && reason !== "none") {
      if (reason === "out-of-focus" || reason === "missed-focus") counts["out-of-focus"] += 1;
      else if (reason === "motion-blur") counts["motion-blur"] += 1;
      else if (reason === "eyes-closed") counts["eyes-closed"] += 1;
      else if (reason === "exposure") counts.exposure += 1;
    }
    if (suggestion && (suggestion.duplicate || suggestion.bestOfGroup)) counts.duplicates += 1;
    if (missedFocus(frame)) counts["missed-focus"] += 1;
    if (frame.membership?.inShoot === false) counts["not-in-shoot"] += 1;
    if (frame.damaged !== undefined || (frame.validity && frame.validity.status !== "valid"))
      counts.invalid += 1;
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
  // Built in place: on a ten-thousand frame card this runs on every keypress,
  // so a frame that stands alone costs one group and nothing else, and a burst
  // is ordered by moving its best frame to the front rather than by sorting and
  // copying the whole burst.
  const bursts = new Map<number, CullGroup>();
  const out: CullGroup[] = [];
  for (const frame of frames) {
    const group = frame.suggestion?.group;
    if (group === undefined || group === null) {
      out.push({ id: `solo:${frame.id}`, frames: [frame], bestId: frame.id });
      continue;
    }
    const existing = bursts.get(group);
    if (existing) existing.frames.push(frame);
    else {
      const started: CullGroup = { id: `burst:${group}`, frames: [frame], bestId: frame.id };
      bursts.set(group, started);
      out.push(started);
    }
  }
  for (const burst of bursts.values()) {
    const members = burst.frames;
    if (members.length < 2) continue;
    // The engine's own pick, else the highest score; first one wins a tie.
    let flagged = -1;
    let top = 0;
    let topScore = members[0]!.suggestion?.score ?? 0;
    for (let index = 0; index < members.length; index++) {
      const suggestion = members[index]!.suggestion;
      if (flagged < 0 && suggestion?.bestOfGroup) flagged = index;
      const score = suggestion?.score ?? 0;
      if (score > topScore) {
        top = index;
        topScore = score;
      }
    }
    const best = flagged < 0 ? top : flagged;
    if (best > 0) members.unshift(members.splice(best, 1)[0]!);
    burst.bestId = members[0]!.id;
  }
  return out;
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

/** Applies verdict, stars, label, tag and caption in one step. Returns the same
 * object when nothing changes, so an unchanged frame never re-renders. */
export function markFrame(frame: CullFrame, marks: CullMarks): CullFrame {
  let next = marks.verdict === undefined ? frame : decide(frame, marks.verdict);
  const set = <K extends "rating" | "label" | "tagged" | "caption">(
    key: K,
    value: CullFrame[K],
  ) => {
    if (next[key] === value) return;
    const copy: CullFrame = next === frame ? { ...frame } : next;
    // Cleared marks leave no key behind, so a stored row stays as small as before.
    if (value === undefined) delete copy[key];
    else copy[key] = value;
    next = copy;
  };
  if (marks.rating !== undefined) {
    const stars = Number.isFinite(marks.rating)
      ? Math.max(0, Math.min(5, Math.round(marks.rating)))
      : 0;
    set("rating", stars || undefined);
  }
  if (marks.label !== undefined) set("label", marks.label ?? undefined);
  if (marks.tagged !== undefined) set("tagged", marks.tagged || undefined);
  if (marks.caption !== undefined) set("caption", marks.caption || undefined);
  return next;
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
