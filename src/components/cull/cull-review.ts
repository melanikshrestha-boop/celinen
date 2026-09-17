/** The review screen's own view model: the cells the grid lays out, the keys the
 * photographer presses, the decisions those keys record, and the engine's
 * measurements said in plain language.
 *
 * Pure functions over the session model in `@/lib/studio/cull/session`, so the
 * screen can be driven from a keyboard, a test, or ten thousand frames without
 * any of this changing.
 */
import type { CullReading, CullVerdict } from "@/lib/studio/cull/engine";
import type { CullFilter, CullFrame } from "@/lib/studio/cull/session";
import {
  effectiveVerdict,
  filterFrames,
  groupFrames,
  matchesFilter,
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
};

/**
 * The frames the grid lays out, in order. Collapsing bursts is what turns ten
 * thousand frames into a few hundred decisions, so a burst contributes its best
 * frame alone until the photographer opens it, and then all of its frames
 * together where they can be compared side by side.
 */
export function cullCells(frames: readonly CullFrame[], options: CullCellOptions): CullCell[] {
  const visible = filterFrames(frames, options.filter);
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
export type CullKeyAction =
  | { kind: "move"; axis: "cell" | "row"; step: 1 | -1 }
  | { kind: "decide"; verdict: CullVerdict }
  | { kind: "toggle" }
  | { kind: "stack" }
  | { kind: "open" }
  | { kind: "close" }
  | null;

export type CullKeyEvent = {
  key: string;
  metaKey?: boolean | undefined;
  ctrlKey?: boolean | undefined;
  shiftKey?: boolean | undefined;
  altKey?: boolean | undefined;
};

/**
 * Review is one hand on the keyboard: J and L walk the card, K keeps, X
 * rejects. K is keep everywhere else in Celinen and stays keep here, so the
 * frame under it moves with J and L rather than J and K. ⌘Z is not here: undo
 * goes through the app's own edit keys (`registerAppKeys`), like every screen.
 */
export function cullKeyAction(event: CullKeyEvent): CullKeyAction {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
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
    case "k":
      return { kind: "decide", verdict: "keep" };
    case "x":
      return { kind: "decide", verdict: "reject" };
    case "u":
      return { kind: "decide", verdict: "undecided" };
    case " ":
      return { kind: "toggle" };
    case "s":
      return { kind: "stack" };
    case "Enter":
      return { kind: "open" };
    case "Escape":
      return { kind: "close" };
    default:
      return null;
  }
}

export const CULL_SHORTCUT_LEGEND =
  "← → J L move · K keep · X reject · U clear · Space toggle · S stack · Enter loupe · Esc close · ⌘Z undo";

/** What Space does to the frame in hand: keep it, or take that keep back. */
export function toggledVerdict(frame: CullFrame): CullVerdict {
  return effectiveVerdict(frame) === "keep" ? "undecided" : "keep";
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
): string[] {
  const ids: string[] = [];
  for (const frame of frames)
    if (matchesFilter(frame, filter) && bulkReaches(frame, verdict)) ids.push(frame.id);
  return ids;
}

/** How many frames keep/reject (`open`) and clear (`decided`) would change —
 * the numbers on the bulk buttons, counted in one pass without building the
 * id sets, which only a click needs. */
export function bulkCounts(
  frames: readonly CullFrame[],
  filter: CullFilter,
): { open: number; decided: number } {
  let open = 0;
  let decided = 0;
  for (const frame of frames) {
    if (!matchesFilter(frame, filter)) continue;
    if (bulkReaches(frame, "keep")) open++;
    if (bulkReaches(frame, "undecided")) decided++;
  }
  return { open, decided };
}

export type CullMeasurement = { label: string; value: string };

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
  const exposure =
    reading.subjectLuma < 26
      ? "Too dark"
      : reading.subjectLuma < 42
        ? "Dark"
        : reading.subjectLuma > 242
          ? "Blown"
          : reading.subjectLuma > 225
            ? "Bright"
            : "Good";
  const subject = !reading.hasFace
    ? "No face found"
    : reading.eyesClosed
      ? "Eyes closed"
      : reading.faceSoft
        ? "Face soft"
        : "Face sharp";
  return [
    { label: "Focus", value: missedFocus ? `${focus}, focus missed the subject` : focus },
    { label: "Motion", value: motion },
    {
      label: "Exposure",
      value:
        reading.subjectClipped > 45 ? `${exposure}, highlights clipped on the subject` : exposure,
    },
    { label: "Subject", value: subject },
  ];
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
