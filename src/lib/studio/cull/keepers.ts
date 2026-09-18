/** The keep line, on top of the engine's rows.
 *
 * Two things live here, both pure and both additive to what native/src/cull.cpp
 * decides (that file is owned elsewhere and is not changed by either):
 *
 * 1. Focus demotion. The engine picks a burst's best frame from its own
 *    measurements. The ingest engine separately knows where the camera tried to
 *    focus and whether the frame is sharp there. A burst's pick whose AF area is
 *    confidently missed must not be suggested over a burst-mate that is sharp,
 *    so the two swap: the sharp mate becomes the pick and the missed frame a
 *    missed-focus reject.
 *
 * 2. The keeper target ("Keep ~N"). The shoot is ranked once by calibrated
 *    score; a target is then just a position in that ranking. Moving it only
 *    touches the frames between the old and new position, so dragging it across
 *    a 10,000-frame shoot never reruns the engine and never rebuilds every row.
 *    Photographer decisions are never touched: their rows may change but their
 *    verdicts are theirs (see effectiveVerdict).
 */
import type { CullReason, CullRow } from "./engine";
import type { CullFrame } from "./session";

/** At or below this AF-area hit confidence a miss is treated as certain. The
 * engine calls anything under .5 a miss; a quarter leaves the doubtful middle alone. */
export const CONFIDENT_MISS_HIT = 0.25;
/** Acuity the engine's own plain reading calls sharp (cull-review plainReading). */
const SHARP_ACUITY = 0.5;

/** The camera's AF area is confidently not where the frame is sharp. */
export function confidentFocusMiss(frame: CullFrame): boolean {
  const hit = frame.focusHit;
  if (!hit) return false;
  return (
    (hit.verdict === "missed" || hit.verdict === "front-or-back-focus") &&
    hit.hit <= CONFIDENT_MISS_HIT
  );
}

/** Sharp enough to take a missed frame's place: focus landed on its AF area,
 * or, with no AF evidence, the subject itself measures sharp. */
function sharpStandIn(frame: CullFrame): boolean {
  if (frame.error || !frame.reading) return false;
  if (frame.decided && frame.verdict === "reject") return false;
  if (frame.focusHit && frame.focusHit.verdict !== "unjudged")
    return frame.focusHit.verdict === "on-subject";
  return frame.reading.acuitySubject >= SHARP_ACUITY;
}

/**
 * Returns rows where no burst's suggested keep is a confident focus miss while
 * a sharp burst-mate exists. Rows of photographer-decided frames are left as
 * the engine wrote them. The input map is not modified; unchanged rows keep
 * their identity.
 */
export function refineFocusRows(
  frames: readonly CullFrame[],
  rows: ReadonlyMap<string, CullRow>,
): Map<string, CullRow> {
  const out = new Map(rows);
  const groups = new Map<number, CullFrame[]>();
  for (const frame of frames) {
    const group = rows.get(frame.id)?.group;
    if (group === null || group === undefined) continue;
    const members = groups.get(group);
    if (members) members.push(frame);
    else groups.set(group, [frame]);
  }
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const missed = members.filter(
      (frame) =>
        !frame.decided && out.get(frame.id)?.verdict === "keep" && confidentFocusMiss(frame),
    );
    if (!missed.length) continue;
    // The best sharp mate by the engine's own score takes the pick.
    let standIn: CullFrame | null = null;
    for (const frame of members) {
      if (confidentFocusMiss(frame) || !sharpStandIn(frame)) continue;
      if (!standIn || out.get(frame.id)!.score > out.get(standIn.id)!.score) standIn = frame;
    }
    if (!standIn) continue;
    const standInRow = out.get(standIn.id)!;
    let tookPick = false;
    for (const frame of missed) {
      const row = out.get(frame.id)!;
      tookPick ||= row.bestOfGroup;
      out.set(frame.id, {
        ...row,
        verdict: "reject",
        reason: "missed-focus",
        bestOfGroup: false,
        duplicate: true,
        // Ranked below the frame that replaced it, so a keeper target agrees.
        score: Math.max(1, Math.min(row.score, standInRow.score - 1)),
      });
    }
    if (standIn.decided) continue;
    out.set(standIn.id, {
      ...standInRow,
      verdict: "keep",
      reason: tookPick || standInRow.bestOfGroup ? "best-of-burst" : standInRow.reason,
      bestOfGroup: tookPick || standInRow.bestOfGroup,
      duplicate: false,
    });
  }
  return out;
}

/**
 * Frame ids in keeper order: calibrated score, highest first; a confident focus
 * miss ranks below every frame that is not one; ties keep capture order.
 * Unreadable and unmeasured frames have no rows and are not ranked.
 */
export function rankKeepers(frames: readonly CullFrame[], rows: ReadonlyMap<string, CullRow>) {
  const ranked: { id: string; score: number; index: number }[] = [];
  frames.forEach((frame, index) => {
    const row = rows.get(frame.id);
    if (!row || frame.error) return;
    ranked.push({
      id: frame.id,
      score: confidentFocusMiss(frame) ? row.score - 100 : row.score,
      index,
    });
  });
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked.map((entry) => entry.id);
}

const POSITIVE: ReadonlySet<CullReason> = new Set<CullReason>(["best-of-burst", "strong-frame"]);

/** A row as the keeper target sees it: keep above the line, reject below. A
 * reject that the engine had praised loses the praise; a keep keeps its defect
 * reason, because the defect is still true. Unchanged rows keep their identity. */
export function targetRow(row: CullRow, keep: boolean): CullRow {
  const verdict = keep ? "keep" : "reject";
  if (row.verdict === verdict) return row;
  return {
    ...row,
    verdict,
    reason: !keep && POSITIVE.has(row.reason) ? "none" : row.reason,
  };
}
