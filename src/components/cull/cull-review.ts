/** The review screen's own view model: the cells the grid lays out, the keys the
 * photographer presses, the decisions those keys record, and the engine's
 * measurements said in plain language.
 *
 * Pure functions over the session model in `@/lib/studio/cull/session`, so the
 * screen can be driven from a keyboard, a test, or ten thousand frames without
 * any of this changing.
 */
import { expandCaption, type CodeTable } from "@/lib/studio/cull/captions";
import type { CullReading, CullVerdict } from "@/lib/studio/cull/engine";
import { readingHasFace } from "@/lib/studio/cull/portrait-face";
import type { FocusHitVerdict } from "@/lib/studio/cull/ingest-engine";
import type {
  CullBurstRoleName,
  CullFilter,
  CullFrame,
  CullLabel,
  CullMarks,
  CullRefine,
} from "@/lib/studio/cull/session";
import {
  effectiveVerdict,
  filterFrames,
  groupFrames,
  matchesFilter,
  matchesRefine,
  NO_REFINE,
} from "@/lib/studio/cull/session";

/** Who the verdict on screen belongs to. The photographer's always wins, and the
 * screen has to show which is which or the review is a guess. */
export type CullDecisionSource = "photographer" | "engine" | "none";

export function decisionSource(frame: CullFrame): CullDecisionSource {
  if (frame.decided) return "photographer";
  return frame.suggestion && frame.suggestion.verdict !== "undecided" ? "engine" : "none";
}

/** One cell of the grid: a frame, and what its burst makes of it. */
export type CullCell = {
  frame: CullFrame;
  /** The burst this frame belongs to, or null when it stands alone here. */
  stackId: string | null;
  /** Frames in that burst; 1 when the frame stands alone. */
  stackCount: number;
  /** The engine's best frame of the burst — the one a collapsed stack shows. */
  lead: boolean;
  /** True while the burst is open and all of its frames are laid out. */
  expanded: boolean;
};

export type CullCellOptions = {
  filter: CullFilter;
  /** Off shows every frame in capture order; on collapses bursts to their best. */
  stacked: boolean;
  expanded: ReadonlySet<string>;
  /** Stars, label and tag narrowing; none by default. */
  refine?: CullRefine | undefined;
};

/**
 * The frames the grid lays out, in order. Collapsing bursts is what turns ten
 * thousand frames into a few hundred decisions, so a burst contributes its best
 * frame alone until the photographer opens it, and then all of its frames
 * together where they can be compared side by side.
 */
export function cullCells(frames: readonly CullFrame[], options: CullCellOptions): CullCell[] {
  const visible = filterFrames(frames, options.filter, options.refine ?? NO_REFINE);
  if (!options.stacked)
    return visible.map((frame) => ({
      frame,
      stackId: null,
      stackCount: 1,
      lead: true,
      expanded: false,
    }));
  const cells: CullCell[] = [];
  for (const group of groupFrames(visible)) {
    const burst = group.frames.length > 1;
    const open = burst && options.expanded.has(group.id);
    for (let index = 0; index < group.frames.length; index++) {
      if (index && !open) break;
      cells.push({
        frame: group.frames[index]!,
        stackId: burst ? group.id : null,
        stackCount: group.frames.length,
        lead: index === 0,
        expanded: open,
      });
    }
  }
  return cells;
}

/** What a keypress means during review. Null is a key the screen leaves alone. */
/** A mark from the keyboard. `stay` is Shift: apply without moving on. */
export type CullKeyMark =
  | { kind: "decide"; verdict: CullVerdict; stay?: true }
  | { kind: "rate"; stars: number; stay?: true }
  | { kind: "label"; label: CullLabel; stay?: true }
  | { kind: "tag"; stay?: true };

export type CullKeyAction =
  | { kind: "move"; axis: "cell" | "row"; step: 1 | -1 }
  | CullKeyMark
  | { kind: "toggle" }
  | { kind: "stack" }
  | { kind: "open" }
  | { kind: "close" }
  | { kind: "af" }
  | { kind: "compare" }
  | { kind: "zoom" }
  | { kind: "pane"; index: number }
  | null;

export type CullKeyEvent = {
  key: string;
  /** The physical key, which Shift and Option do not change ("Digit3"). */
  code?: string | undefined;
  metaKey?: boolean | undefined;
  ctrlKey?: boolean | undefined;
  shiftKey?: boolean | undefined;
  altKey?: boolean | undefined;
};

/** Lightroom's 6-9. */
const DIGIT_LABELS: Record<number, CullLabel> = { 6: "red", 7: "yellow", 8: "green", 9: "blue" };

/** The digit a key press means, whatever Shift or Option turned its character into. */
function digitOf(event: CullKeyEvent): number | null {
  const match = /^(?:Digit|Numpad)([0-9])$/.exec(event.code ?? "");
  if (match) return Number(match[1]);
  return /^[0-9]$/.test(event.key) ? Number(event.key) : null;
}

/**
 * Review is one hand on the keyboard: J and L walk the card, K keeps, X
 * rejects. K is keep everywhere else in Celinen and stays keep here, so the
 * frame under it moves with J and L rather than J and K. Photo Mechanic and
 * Lightroom hands work too: P pick, X reject, U unflag, 0-5 stars, 6-9 color
 * labels, T tag. Shift with any mark applies it and stays on the frame.
 * Option-1..4 focuses a compare pane (plain digits are stars everywhere).
 * ⌘Z is not here: undo goes through the app's own edit keys
 * (`registerAppKeys`), like every screen.
 */
export function cullKeyAction(event: CullKeyEvent): CullKeyAction {
  if (event.metaKey || event.ctrlKey) return null;
  const digit = digitOf(event);
  if (event.altKey) {
    if (!event.shiftKey && digit !== null && digit >= 1 && digit <= 4)
      return { kind: "pane", index: digit - 1 };
    return null;
  }
  const stay = event.shiftKey ? ({ stay: true } as const) : {};
  if (digit !== null) {
    if (digit <= 5) return { kind: "rate", stars: digit, ...stay };
    return { kind: "label", label: DIGIT_LABELS[digit]!, ...stay };
  }
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  switch (key) {
    case "k":
    case "p":
      return { kind: "decide", verdict: "keep", ...stay };
    case "x":
      return { kind: "decide", verdict: "reject", ...stay };
    case "u":
      return { kind: "decide", verdict: "undecided", ...stay };
    case "t":
      return { kind: "tag", ...stay };
  }
  // Everything else is unshifted only; Shift+arrows stays with the browser.
  if (event.shiftKey && key !== " ") return null;
  switch (key) {
    case "ArrowRight":
      return { kind: "move", axis: "cell", step: 1 };
    case "ArrowLeft":
      return { kind: "move", axis: "cell", step: -1 };
    case "ArrowDown":
      return { kind: "move", axis: "row", step: 1 };
    case "ArrowUp":
      return { kind: "move", axis: "row", step: -1 };
    case "l":
      return { kind: "move", axis: "cell", step: 1 };
    case "j":
      return { kind: "move", axis: "cell", step: -1 };
    case " ":
      return { kind: "toggle" };
    case "s":
      return { kind: "stack" };
    case "f":
      return { kind: "af" };
    case "c":
      return { kind: "compare" };
    case "z":
      return { kind: "zoom" };
    case "Enter":
      return { kind: "open" };
    case "Escape":
      return { kind: "close" };
    default:
      return null;
  }
}

export const CULL_SHORTCUT_LEGEND =
  "← → J L move · K P keep · X reject · U clear · 0–5 stars · 6–9 label · T tag · ⇧ stay · Space toggle · S stack · C compare · F AF · Z zoom · Enter loupe · ⌘Z undo";

/** What Space does to the frame in hand: keep it, or take that keep back. */
export function toggledVerdict(frame: CullFrame): CullVerdict {
  return effectiveVerdict(frame) === "keep" ? "undecided" : "keep";
}

/**
 * The marks a key applies to these frames. Stars and verdicts set; a label or
 * tag already on every frame comes off (Lightroom's toggle), otherwise goes on
 * all of them, so a mixed selection ends up uniform.
 */
export function keyMarks(mark: CullKeyMark, frames: readonly CullFrame[]): CullMarks {
  switch (mark.kind) {
    case "decide":
      return { verdict: mark.verdict };
    case "rate":
      return { rating: mark.stars };
    case "label":
      return {
        label:
          frames.length && frames.every((frame) => frame.label === mark.label) ? null : mark.label,
      };
    case "tag":
      return { tagged: !(frames.length && frames.every((frame) => frame.tagged)) };
  }
}

/** Whether a frame, once marked, still belongs in the current view. */
export function staysInView(
  frame: CullFrame,
  marks: CullMarks,
  filter: CullFilter,
  refine: CullRefine,
): boolean {
  const verdict = marks.verdict;
  const next: CullFrame = {
    ...frame,
    ...(verdict === undefined ? {} : { verdict, decided: verdict !== "undecided" }),
    ...(marks.rating === undefined ? {} : { rating: marks.rating }),
    ...(marks.label === undefined ? {} : { label: marks.label ?? undefined }),
    ...(marks.tagged === undefined ? {} : { tagged: marks.tagged }),
  };
  return matchesFilter(next, filter) && matchesRefine(next, refine);
}

/** The ids in `cells` from one index to another, inclusive, in grid order. */
export function rangeIds(cells: readonly CullCell[], from: number, to: number): string[] {
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(cells.length - 1, Math.max(from, to));
  const ids: string[] = [];
  for (let index = start; index <= end; index++) ids.push(cells[index]!.frame.id);
  return ids;
}

/** The frames Compare opens with: an explicit selection of two to four, or the
 * burst in hand's four best. Null when there is nothing to compare. */
export function compareIds(
  selection: readonly string[],
  burst: readonly CullFrame[],
): string[] | null {
  if (selection.length >= 2) return selection.slice(0, 4);
  if (burst.length < 2) return null;
  return [...burst]
    .sort((a, b) => (b.suggestion?.score ?? 0) - (a.suggestion?.score ?? 0))
    .slice(0, 4)
    .map((frame) => frame.id);
}

/** Keep and reject only ever reach frames the photographer has not decided;
 * clear only ever reaches the ones they have. No bulk action can overwrite a
 * decision without being asked for it by name. */
function bulkReaches(frame: CullFrame, verdict: CullVerdict): boolean {
  return verdict === "undecided" ? frame.decided : !frame.decided;
}

/** The frames a bulk action on this filter would change. */
export function bulkTargets(
  frames: readonly CullFrame[],
  filter: CullFilter,
  verdict: CullVerdict,
  refine: CullRefine = NO_REFINE,
): string[] {
  const ids: string[] = [];
  for (const frame of frames)
    if (matchesFilter(frame, filter) && matchesRefine(frame, refine) && bulkReaches(frame, verdict))
      ids.push(frame.id);
  return ids;
}

/** How many frames keep/reject (`open`) and clear (`decided`) would change —
 * the numbers on the bulk buttons, counted in one pass without building the
 * id sets, which only a click needs. */
export function bulkCounts(
  frames: readonly CullFrame[],
  filter: CullFilter,
  refine: CullRefine = NO_REFINE,
): { open: number; decided: number } {
  let open = 0;
  let decided = 0;
  for (const frame of frames) {
    if (!matchesFilter(frame, filter) || !matchesRefine(frame, refine)) continue;
    if (bulkReaches(frame, "keep")) open++;
    if (bulkReaches(frame, "undecided")) decided++;
  }
  return { open, decided };
}

export type CullMeasurement = { label: string; value: string };

export const CULL_BURST_ROLE_LABELS: Record<CullBurstRoleName, string> = {
  pick: "Pick",
  alternate: "Alternate",
  review: "Review",
  "build-up": "Build-up",
  "follow-through": "Follow-through",
  duplicate: "Duplicate",
};

/** The engine's numbers as a photographer reads them. Thresholds are the
 * engine's own (native/src/cull.cpp): .22 of acuity between the subject and the
 * sharpest thing in frame is a missed focus, a global smear above .3 is shake,
 * and subject luma runs 0..255. */
export function plainReading(reading: CullReading): CullMeasurement[] {
  const missedFocus = reading.acuityBest > reading.acuitySubject + 0.22;
  const focus =
    reading.acuitySubject >= 0.5
      ? "Sharp"
      : reading.acuitySubject >= 0.35
        ? "Slightly soft"
        : "Soft";
  const motion = reading.globalSmear
    ? "Camera shake"
    : reading.motion >= 0.3
      ? "Subject motion"
      : "Frozen";
  const faced = readingHasFace(reading);
  const exposure = faced
    ? reading.subjectLuma < 26
      ? "Night"
      : reading.subjectLuma < 48
        ? "Low light"
        : reading.subjectLuma > 242
          ? "Blown"
          : reading.subjectLuma > 225
            ? "Bright"
            : "Good"
    : reading.subjectLuma < 26
      ? "Too dark"
      : reading.subjectLuma < 42
        ? "Dark"
        : reading.subjectLuma > 242
          ? "Blown"
          : reading.subjectLuma > 225
            ? "Bright"
            : "Good";
  // A frame without a face is not worse for it, so no face means no row.
  const subject = !faced
    ? null
    : reading.eyesClosed
      ? "Eyes closed"
      : reading.faceSoft
        ? "Face soft"
        : "Face sharp";
  const rows: CullMeasurement[] = [
    { label: "Focus", value: missedFocus ? `${focus}, focus missed the subject` : focus },
    { label: "Motion", value: motion },
    {
      label: "Exposure",
      value:
        reading.subjectClipped > 45 ? `${exposure}, highlights clipped on the subject` : exposure,
    },
  ];
  if (subject) rows.push({ label: "Subject", value: subject });
  return rows;
}

/** "118/sec" — the rate a card is being read at, or nothing before there is one. */
export function formatRate(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate) || rate <= 0) return "";
  return `${rate >= 10 ? Math.round(rate) : rate.toFixed(1)}/sec`;
}

/** What a new session is called: the card's top folder when a folder was read,
 * otherwise the moment the files were picked. */
export function importName(files: readonly File[], now: Date = new Date()): string {
  for (const file of files) {
    // Absent, not empty, on Files built outside a browser file picker.
    const [folder, ...rest] = (file.webkitRelativePath || "").split("/");
    if (folder && rest.length) return folder;
  }
  // Date and time are formatted apart: how ICU joins them ("," or " at ") varies by runtime.
  const day = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day}, ${time}`;
}

export const FOCUS_VERDICT_LABELS: Record<FocusHitVerdict, string> = {
  "on-subject": "On the AF point",
  "front-or-back-focus": "Front or back focus",
  missed: "Missed",
  unjudged: "Not judged",
};

/** "On the AF point · 82%", or null when the camera named no AF area. */
export function focusSummary(frame: CullFrame): string | null {
  if (!frame.afPoint) return null;
  const hit = frame.focusHit;
  if (!hit) return frame.afConfirmed === false ? "AF area, no lock" : "AF area, not judged";
  const label = FOCUS_VERDICT_LABELS[hit.verdict];
  const lock = frame.afConfirmed === false ? " · no lock" : "";
  return hit.verdict === "unjudged"
    ? `${label}${lock}`
    : `${label} · ${Math.round(hit.hit * 100)}%${lock}`;
}

/** "Sharp 72": the subject's acuity on the engine's 0..1 scale, as a percentage. */
export function sharpnessReadout(frame: CullFrame): string | null {
  const acuity = frame.reading?.acuitySubject;
  if (acuity === undefined || !Number.isFinite(acuity)) return null;
  return `Sharp ${Math.round(Math.max(0, Math.min(1, acuity)) * 100)}`;
}

/** The loupe's detail list: the engine's reading in plain words, where focus
 * landed against the AF area, and any validity, shoot or burst judgment. */
export function detailRows(frame: CullFrame): CullMeasurement[] {
  const rows = frame.reading ? plainReading(frame.reading) : [];
  const focus = focusSummary(frame);
  if (focus) rows.splice(1, 0, { label: "AF", value: focus });
  if (frame.validity && frame.validity.status !== "valid")
    rows.push({
      label: frame.validity.status === "invalid" ? "Invalid" : "Suspect",
      value: frame.validity.reason,
    });
  if (frame.membership?.inShoot === false)
    rows.push({ label: "Shoot", value: frame.membership.reason || "Not from this shoot" });
  if (frame.burstRole)
    rows.push({
      label: CULL_BURST_ROLE_LABELS[frame.burstRole.role],
      value: frame.burstRole.reason,
    });
  return rows;
}

/**
 * Expands every complete code in what was typed and says where the caret goes,
 * so `\u23\` turns into the name the moment its closing delimiter lands, the
 * way Photo Mechanic does it. Unknown codes stay exactly as typed.
 */
export function expandTyped(
  text: string,
  caret: number,
  table: CodeTable,
): { text: string; caret: number; unknown: string[] } {
  if (!table.codes.size) return { text, caret, unknown: [] };
  const before = expandCaption(text.slice(0, caret), table);
  const after = expandCaption(text.slice(caret), table);
  const whole = expandCaption(text, table);
  // A code straddling the caret is expanded as a whole; the caret then goes to the end.
  if (before.text + after.text !== whole.text)
    return { text: whole.text, caret: whole.text.length, unknown: whole.unknown };
  return { text: whole.text, caret: before.text.length, unknown: whole.unknown };
}
