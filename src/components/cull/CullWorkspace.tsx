import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Tag, X } from "lucide-react";
import type { CullExportRequest, CullSnapshot } from "@/lib/studio/cull/controller";
import { directoryTarget } from "@/lib/studio/cull/handoff/target";
import type { HandoffReport } from "@/lib/studio/cull/handoff/types";
import type { CullVerdict } from "@/lib/studio/cull/engine";
import type { PortraitFace } from "@/lib/studio/cull/portrait-face";
import {
  CULL_FILTER_LABELS,
  CULL_FILTERS,
  CULL_LABELS,
  CULL_OPTIONAL_FILTERS,
  countFrames,
  formatRemaining,
  groupFrames,
  matchesFilter,
  matchesRefine,
  NO_REFINE,
  type CullFilter,
  type CullFrame,
  type CullMarks,
  type CullRefine,
} from "@/lib/studio/cull/session";
import type { CullSessionSummary } from "@/lib/studio/cull/store";
import { collectDroppedFiles } from "@/lib/studio/drop-import";
import {
  captureDropHandles,
  filePickerSupported,
  folderPickerSupported,
  pickFiles,
  pickFolder,
  type CullSourceRoot,
} from "@/lib/studio/cull/sources";
import { isTypingTarget, registerAppKeys } from "@/lib/app-keys";
import {
  CULL_SHORTCUT_LEGEND,
  bulkCounts,
  bulkTargets,
  compareIds,
  cullCells,
  cullKeyAction,
  formatRate,
  importName,
  keyMarks,
  rangeIds,
  staysInView,
  toggledVerdict,
  type CullKeyMark,
} from "./cull-review";
import { CullCaption, type CullCodesInput } from "./CullCaption";
import { CullCompare } from "./CullCompare";
import { CullBackupControl, CullExportPanel, type CullExportScope } from "./CullExport";
import { useDestination } from "./use-destination";
import {
  CullGrid,
  type CullSelectMode,
  type CullThumbnailSource,
  type CullViewport,
} from "./CullGrid";
import { CullLoupe } from "./CullLoupe";
import type { CullLoupeSource } from "./CullLoupePicture";
import { createPictureView } from "./picture-view";
import "./cull.css";

export type CullWorkspaceProps = {
  snapshot: CullSnapshot;
  /** Starts a new session from a card, named for its folder. `roots` are the
   * folder and file handles it came through, where the browser offers them;
   * `backup` copies the card to one or two folders while it is read. */
  onImport: (
    name: string,
    files: readonly File[],
    roots?: readonly CullSourceRoot[],
    backup?: CullBackupTargets | undefined,
  ) => void;
  onCancelImport: () => void;
  /** Copies the chosen frames to a folder or zip. */
  onExport?: ((request: CullExportRequest) => Promise<HandoffReport>) | undefined;
  onCancelBackup?: (() => void) | undefined;
  /** Records verdict, stars, label, tag or caption on these frames as one undo step. */
  onMark: (ids: readonly string[], marks: CullMarks) => void;
  onUndo: () => void;
  /** Moves the "Keep ~N" line; null returns to the engine's verdicts. */
  onKeepTarget?: ((target: number | null) => void) | undefined;
  /** Erases what the culler learned from this photographer's overrides. */
  onForgetTaste?: (() => void) | undefined;
  onAddCodes?: ((input: CullCodesInput) => Promise<unknown>) | undefined;
  onRemoveCodes?: ((id: string) => void) | undefined;
  /** Must keep its identity across renders; cards read thumbnails as they scroll into view. */
  thumbnail: CullThumbnailSource;
  /** The loupe's picture, best source first. Same identity rule. Without it, the thumbnail. */
  preview?: CullLoupeSource | undefined;
  /** Reconnects or locates the session's originals; runs inside the photographer's click. */
  onReconnect?: (() => void) | undefined;
  sessions?: readonly CullSessionSummary[] | undefined;
  onOpenSession?: ((sessionId: string) => void) | undefined;
  viewport?: CullViewport | undefined;
  onFace?: ((frameId: string, box: PortraitFace) => void) | undefined;
  /** Opens Develop with this session's keepers. */
  onDevelop?: (() => void) | undefined;
  /** Opens the Instagram composer on the keepers, in grid order, with the frame in hand. */
  onInstagram?: ((keeperIds: readonly string[], currentId: string | null) => void) | undefined;
};

const number = (value: number) => value.toLocaleString("en-US");
const NONE: ReadonlySet<string> = new Set();

/** Where a card's second (and third) copy goes while it is read. */
export type CullBackupTargets = {
  primary: ReturnType<typeof directoryTarget>;
  secondary?: ReturnType<typeof directoryTarget> | undefined;
};

/** A per-device screen preference; storage can be missing or refuse. */
function usePreference(key: string, fallback: boolean) {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === "1" || stored === "0") setValue(stored === "1");
    } catch {
      // Private windows and blocked storage keep the default.
    }
  }, [key]);
  const set = useCallback(
    (update: (previous: boolean) => boolean) =>
      setValue((previous) => {
        const next = update(previous);
        try {
          window.localStorage.setItem(key, next ? "1" : "0");
        } catch {
          // Still applies for this visit.
        }
        return next;
      }),
    [key],
  );
  return [value, set] as const;
}

const LABEL_NAMES = {
  red: "Red",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
};

export function CullWorkspace({
  snapshot,
  onImport,
  onCancelImport,
  onExport,
  onCancelBackup,
  onMark,
  onUndo,
  onKeepTarget,
  onForgetTaste,
  onAddCodes,
  onRemoveCodes,
  thumbnail,
  preview,
  onReconnect,
  sessions = [],
  onOpenSession,
  viewport,
  onFace,
  onDevelop,
  onInstagram,
}: CullWorkspaceProps) {
  const { frames, progress, notice, canUndo } = snapshot;
  const [filter, setFilter] = useState<CullFilter>("all");
  const [refine, setRefine] = useState<CullRefine>(NO_REFINE);
  const [stacked, setStacked] = useState(true);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Frames picked together (⌘-click, ⇧-click, ⌘A). Empty means the frame in hand alone.
  const [picked, setPicked] = useState<ReadonlySet<string>>(NONE);
  const anchor = useRef<string | null>(null);
  const [loupe, setLoupe] = useState(false);
  const [compare, setCompare] = useState<readonly string[] | null>(null);
  const [comparePane, setComparePane] = useState(0);
  const [columns, setColumns] = useState(1);
  const [dropping, setDropping] = useState(false);
  const [dropNote, setDropNote] = useState<string | null>(null);
  // A picked folder is walked before its import starts; a second click must not start another.
  const [choosing, setChoosing] = useState(false);
  const [autoAdvance, setAutoAdvance] = usePreference("celinen:cull:advance", true);
  const [showAf, setShowAf] = usePreference("celinen:cull:af", true);
  const [backupOn, setBackupOn] = usePreference("celinen:cull:backup", false);
  const backupPrimary = useDestination("celinen-backup");
  const backupSecondary = useDestination("celinen-backup-2");
  const loupeView = useMemo(() => createPictureView(), []);
  const compareView = useMemo(() => createPictureView(), []);
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // A different session is a different card: nothing chosen on the last one applies.
  const [viewedSession, setViewedSession] = useState(snapshot.sessionId);
  if (viewedSession !== snapshot.sessionId) {
    setViewedSession(snapshot.sessionId);
    setExpanded(new Set());
    setSelectedId(null);
    setPicked(NONE);
    setLoupe(false);
    setCompare(null);
  }

  const counts = useMemo(() => countFrames(frames), [frames]);
  const cells = useMemo(
    () => cullCells(frames, { filter, stacked, expanded, refine }),
    [frames, filter, stacked, expanded, refine],
  );
  const indexes = useMemo(
    () => new Map(cells.map((cell, index) => [cell.frame.id, index])),
    [cells],
  );
  // The frame in hand. When it leaves the view (a filter change), the first
  // cell stands in rather than nothing, so the keys always have a target.
  const selectedIndex =
    (selectedId === null ? undefined : indexes.get(selectedId)) ?? (cells.length ? 0 : null);
  const current = selectedIndex === null ? null : (cells[selectedIndex] ?? null);
  const bulk = useMemo(() => bulkCounts(frames, filter, refine), [frames, filter, refine]);
  // The loupe compares the burst as the current filter sees it, so every
  // member it offers is one the grid can hold in hand.
  const burstGroup = loupe ? (current?.frame.suggestion?.group ?? null) : null;
  const burst = useMemo(
    () =>
      burstGroup === null
        ? []
        : (groupFrames(
            frames.filter(
              (frame) =>
                frame.suggestion?.group === burstGroup &&
                matchesFilter(frame, filter) &&
                matchesRefine(frame, refine),
            ),
          )[0]?.frames ?? []),
    [frames, filter, refine, burstGroup],
  );
  // Compare looks frames up by id; only while it is open, and only its few.
  const compareFrames = useMemo(() => {
    if (!compare) return [];
    const wanted = new Set(compare);
    const found = new Map<string, CullFrame>();
    for (const frame of frames) if (wanted.has(frame.id)) found.set(frame.id, frame);
    return compare.map((id) => found.get(id)).filter((frame): frame is CullFrame => !!frame);
  }, [compare, frames]);
  const reading = progress !== null && !progress.done;
  const neighbors = useMemo(
    () =>
      selectedIndex === null
        ? []
        : [cells[selectedIndex + 1]?.frame.id, cells[selectedIndex - 1]?.frame.id].filter(
            (id): id is string => id !== undefined,
          ),
    [cells, selectedIndex],
  );
  const sessionName = sessions.find((session) => session.id === snapshot.sessionId)?.name;

  // A filter is a different view: a selection made in the last one does not carry over.
  const [viewKey, setViewKey] = useState({ filter, refine });
  if (viewKey.filter !== filter || viewKey.refine !== refine) {
    setViewKey({ filter, refine });
    setPicked(NONE);
  }

  const selectAll = useCallback(() => {
    if (!cells.length) return false;
    setPicked(new Set(cells.map((cell) => cell.frame.id)));
    return true;
  }, [cells]);

  // ⌘Z and ⌘A belong to the app's edit keys; the screen claims undo only with something to undo.
  useEffect(
    () =>
      frames.length || canUndo
        ? registerAppKeys({ ...(canUndo ? { undo: onUndo } : {}), selectAll })
        : undefined,
    [canUndo, onUndo, selectAll, frames.length],
  );

  const onSelect = useCallback(
    (id: string, mode: CullSelectMode) => {
      if (mode === "replace") {
        anchor.current = id;
        setPicked(NONE);
      } else if (mode === "toggle") {
        setPicked((previous) => {
          const next = new Set(previous);
          // The frame in hand joins a selection that starts from it.
          if (!next.size && current && current.frame.id !== id) next.add(current.frame.id);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        anchor.current = id;
      } else {
        const from = indexes.get(anchor.current ?? "") ?? selectedIndex ?? 0;
        const to = indexes.get(id);
        if (to !== undefined) setPicked(new Set(rangeIds(cells, from, to)));
      }
      setSelectedId(id);
    },
    [cells, indexes, current, selectedIndex],
  );

  /** The frames a mark reaches: the focused compare pane, else the selection, else the frame in hand. */
  const markTargets = useCallback((): CullFrame[] => {
    if (compare) {
      const frame = compareFrames[comparePane];
      return frame ? [frame] : [];
    }
    if (picked.size > 1) return frames.filter((frame) => picked.has(frame.id));
    return current ? [current.frame] : [];
  }, [compare, compareFrames, comparePane, picked, frames, current]);

  const applyMark = useCallback(
    (mark: CullKeyMark | { kind: "toggle" }) => {
      const targets = markTargets();
      if (!targets.length) return;
      const marks =
        mark.kind === "toggle" ? { verdict: toggledVerdict(targets[0]!) } : keyMarks(mark, targets);
      const single = targets.length === 1 && !compare;
      const frame = targets[0]!;
      // A verdict the frame already carries is not a step: nothing to undo, nowhere to go.
      if (
        single &&
        marks.verdict !== undefined &&
        (marks.verdict === "undecided"
          ? !frame.decided
          : frame.decided && frame.verdict === marks.verdict)
      )
        return;
      onMark(
        targets.map((target) => target.id),
        marks,
      );
      if (!single || selectedIndex === null || !current) return;
      if (("stay" in mark && mark.stay) || !autoAdvance) return;
      // Reviewing is a stream: after a mark the next frame is already in hand.
      // If the mark takes this frame out of the view, the cell that slides into
      // its place is the next one; at the end, step back instead.
      const leaves = !staysInView(frame, marks, filter, refine);
      const next = cells[selectedIndex + 1] ?? (leaves ? cells[selectedIndex - 1] : current);
      setSelectedId(next?.frame.id ?? null);
    },
    [markTargets, compare, onMark, selectedIndex, current, autoAdvance, filter, refine, cells],
  );

  const decideCurrent = useCallback(
    (verdict: CullVerdict) => applyMark({ kind: "decide", verdict }),
    [applyMark],
  );

  const toggleStack = useCallback(
    (stackId: string) => {
      const open = expanded.has(stackId);
      setExpanded((previous) => {
        const next = new Set(previous);
        if (open) next.delete(stackId);
        else next.add(stackId);
        return next;
      });
      // Closing a burst hides its members; the one in hand becomes the lead.
      if (open) {
        const lead = cells.find((cell) => cell.stackId === stackId && cell.lead);
        if (lead) setSelectedId(lead.frame.id);
      }
    },
    [expanded, cells],
  );

  const move = useCallback(
    (step: number) => {
      if (selectedIndex === null) return;
      const target = Math.max(0, Math.min(cells.length - 1, selectedIndex + step));
      setSelectedId(cells[target]?.frame.id ?? null);
    },
    [cells, selectedIndex],
  );

  // A burst member picked in the loupe has to be on the grid too, or the
  // selection would fall back to the first cell.
  const selectMember = useCallback(
    (id: string) => {
      const stackId = current?.stackId;
      if (stackId && !expanded.has(stackId))
        setExpanded((previous) => new Set(previous).add(stackId));
      setSelectedId(id);
    },
    [current, expanded],
  );

  const open = useCallback((id: string) => {
    setSelectedId(id);
    setPicked(NONE);
    setLoupe(true);
  }, []);

  const openCompare = useCallback(() => {
    // An explicit selection in grid order, else the burst in hand's best four.
    const selection = cells.filter((cell) => picked.has(cell.frame.id)).map((c) => c.frame.id);
    const group = current?.frame.suggestion?.group;
    const members =
      selection.length >= 2 || group === null || group === undefined
        ? []
        : frames.filter(
            (frame) =>
              frame.suggestion?.group === group && !frame.error && matchesFilter(frame, filter),
          );
    const ids = compareIds(selection, members);
    if (!ids) return;
    compareView.set({ zoomed: false, cx: 0.5, cy: 0.5 });
    setComparePane(0);
    setCompare(ids);
  }, [cells, picked, current, frames, filter, compareView]);

  // One listener for the whole screen, reading the latest state through a ref
  // so it is attached once rather than on every keystroke.
  const keys = useRef({
    current,
    columns,
    loupe,
    compare,
    picked,
    move,
    applyMark,
    toggleStack,
    openCompare,
  });
  keys.current = {
    current,
    columns,
    loupe,
    compare,
    picked,
    move,
    applyMark,
    toggleStack,
    openCompare,
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isTypingTarget(event.target)) return;
      const action = cullKeyAction(event);
      const state = keys.current;
      if (!action || !state.current) return;
      if (action.kind === "close" && !state.loupe && !state.compare && !state.picked.size) return;
      // Enter and Space still press whichever toolbar button has focus.
      const control =
        event.target instanceof Element ? event.target.closest("button, a, summary") : null;
      if (
        control &&
        !control.classList.contains("cull-card-hit") &&
        (action.kind === "open" || action.kind === "toggle")
      )
        return;
      // Holding an arrow walks the card; holding K must not keep a whole burst.
      if (event.repeat && action.kind !== "move") return;
      event.preventDefault();
      switch (action.kind) {
        case "move":
          if (state.compare) {
            if (action.axis === "cell")
              setComparePane(
                (pane) => (pane + action.step + state.compare!.length) % state.compare!.length,
              );
            return;
          }
          state.move(
            action.axis === "row" && !state.loupe ? action.step * state.columns : action.step,
          );
          return;
        case "decide":
        case "rate":
        case "label":
        case "tag":
        case "toggle":
          state.applyMark(action);
          return;
        case "stack":
          if (!state.compare && state.current.stackId) state.toggleStack(state.current.stackId);
          return;
        case "open":
          if (!state.compare) setLoupe(true);
          return;
        case "close":
          if (state.compare) setCompare(null);
          else if (state.loupe) setLoupe(false);
          else setPicked(NONE);
          return;
        case "af":
          setShowAf((value) => !value);
          return;
        case "compare":
          if (state.compare) setCompare(null);
          else state.openCompare();
          return;
        case "zoom": {
          const view = state.compare ? compareView : state.loupe ? loupeView : null;
          if (view) view.set({ zoomed: !view.get().zoomed });
          return;
        }
        case "pane":
          if (state.compare && action.index < state.compare.length) setComparePane(action.index);
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [compareView, loupeView, setShowAf]);

  // A new frame in the loupe starts fitted.
  const loupeFrameId = loupe ? (current?.frame.id ?? null) : null;
  useEffect(() => loupeView.set({ zoomed: false, cx: 0.5, cy: 0.5 }), [loupeFrameId, loupeView]);

  const bulkAction = (verdict: CullVerdict) => {
    const ids = bulkTargets(frames, filter, verdict, refine);
    if (ids.length) onMark(ids, { verdict });
  };

  const startImport = (files: readonly File[], roots: readonly CullSourceRoot[] = []) => {
    setDropNote(null);
    // A backup destination that is not ready is simply not used; the card still reads.
    const primary = backupOn && !backupPrimary.locked ? backupPrimary.handle : null;
    const second = backupOn && !backupSecondary.locked ? backupSecondary.handle : null;
    onImport(
      importName(files),
      files,
      roots,
      primary
        ? {
            primary: directoryTarget(primary),
            ...(second ? { secondary: directoryTarget(second) } : {}),
          }
        : undefined,
    );
  };
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (reading || !Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropping(true);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (reading) return;
    event.preventDefault();
    setDropping(false);
    // The folder tree and its handles have to be captured before the event returns.
    const collected = collectDroppedFiles(event.dataTransfer);
    const handles = captureDropHandles(event.dataTransfer);
    void collected.then(
      async (result) => {
        if (result.files.length) startImport(result.files, await handles);
        else setDropNote(result.warnings[0]?.message ?? "No photos in that drop.");
      },
      (reason: unknown) =>
        setDropNote(reason instanceof Error ? reason.message : "That drop could not be read."),
    );
  };
  const pick = (list: FileList | null) => {
    if (list?.length) startImport(Array.from(list));
  };
  // Where the browser has pickers that return handles, the card can be found
  // again after a reload; elsewhere the plain file inputs stay.
  const choose = (kind: "folder" | "files") => {
    const native = kind === "folder" ? folderPickerSupported() : filePickerSupported();
    if (!native) return (kind === "folder" ? folderInput : fileInput).current?.click();
    setDropNote(null);
    setChoosing(true);
    (kind === "folder" ? pickFolder() : pickFiles())
      .then(
        (card) => {
          if (!card) return;
          if (card.files.length) startImport(card.files, card.roots);
          else setDropNote("No photos in that folder.");
        },
        (reason: unknown) =>
          setDropNote(reason instanceof Error ? reason.message : "That folder could not be read."),
      )
      .finally(() => setChoosing(false));
  };

  // The keep line's position: the target when set, otherwise where the engine drew it.
  const ranked = snapshot.ranked;
  const keepLine = Math.min(ranked, snapshot.keepTarget ?? counts.keepers);
  const overlay = loupe || compare !== null;
  const pickedCount = picked.size > 1 ? picked.size : 0;
  const pickedCaption = useMemo(() => {
    if (!pickedCount) return "";
    let shared: string | null = null;
    for (const frame of frames) {
      if (!picked.has(frame.id)) continue;
      const caption = frame.caption ?? "";
      if (shared === null) shared = caption;
      else if (shared !== caption) return "";
    }
    return shared ?? "";
  }, [pickedCount, picked, frames]);

  // Keepers as the grid shows them, then any the current filter or stacks hide.
  const keeperOrder = () => {
    const seen = new Set<string>();
    for (const frame of [...cells.map((cell) => cell.frame), ...frames])
      if (matchesFilter(frame, "keepers")) seen.add(frame.id);
    return [...seen];
  };

  const alert = notice ?? dropNote;
  const backupControl = (
    <CullBackupControl
      on={backupOn}
      onToggle={() => setBackupOn((value) => !value)}
      primary={backupPrimary}
      secondary={backupSecondary}
      disabled={reading}
    />
  );
  const exportCounts = {
    keepers: counts.keepers,
    selection: picked.size,
    filter: cells.length,
  };
  const exportIds = useCallback(
    (scope: CullExportScope) =>
      scope === "selection"
        ? cells.filter((cell) => picked.has(cell.frame.id)).map((cell) => cell.frame.id)
        : scope === "filter"
          ? cells.map((cell) => cell.frame.id)
          : undefined,
    [cells, picked],
  );
  const importButtons = (
    <>
      <button
        type="button"
        className="rounded-md px-2.5 py-1.5 hover:bg-ink/5 disabled:opacity-50"
        disabled={reading || choosing}
        onClick={() => choose("files")}
      >
        Import files
      </button>
      <button
        type="button"
        className="rounded-md px-2.5 py-1.5 hover:bg-ink/5 disabled:opacity-50"
        disabled={reading || choosing}
        onClick={() => choose("folder")}
      >
        Import folder
      </button>
    </>
  );
  const sessionList =
    onOpenSession && sessions.length ? (
      <ul className="font-mono text-[11px]">
        {sessions.map((session) => (
          <li key={session.id}>
            <button
              type="button"
              aria-current={session.id === snapshot.sessionId ? "true" : undefined}
              className="flex w-full items-center justify-between gap-4 rounded-md px-2.5 py-1.5 text-left hover:bg-ink/5 aria-[current=true]:text-ink"
              onClick={() => onOpenSession(session.id)}
            >
              <span className="truncate">{session.name}</span>
              <span className="shrink-0 text-moss">{number(session.frameCount)}</span>
            </button>
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <div
      className={`cull-workspace${dropping ? " is-dropping" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        )
          return;
        setDropping(false);
      }}
      onDrop={onDrop}
    >
      <header className="border-b border-border/70" inert={overlay}>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            {frames.length > 0 && (
              <span className="truncate font-mono text-[11px] text-moss">
                {sessionName && <span className="text-ink">{`${sessionName} · `}</span>}
                {`${number(counts.all)} frames · ${number(counts.keepers)} keepers · ${number(counts.rejects)} rejects · ${number(counts.undecided)} undecided`}
                {counts.unreadable > 0 && (
                  <span className="text-rust">{` · ${number(counts.unreadable)} unreadable`}</span>
                )}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5 font-mono text-[11px]">
            {canUndo && (
              <button
                type="button"
                data-app-key="undo"
                className="rounded-md px-2.5 py-1.5 hover:bg-ink/5"
                onClick={onUndo}
              >
                Undo
              </button>
            )}
            {frames.length > 0 && sessionList && (
              <details className="relative">
                <summary className="cursor-pointer list-none rounded-md px-2.5 py-1.5 text-moss transition-colors hover:bg-ink/5 hover:text-ink [&::-webkit-details-marker]:hidden">
                  Sessions
                </summary>
                <div className="absolute right-0 z-40 mt-1.5 max-h-[60vh] w-72 overflow-y-auto rounded-lg border border-border bg-paper2 p-1 shadow-xl">
                  {sessionList}
                </div>
              </details>
            )}
            {onDevelop && counts.keepers > 0 && (
              <button
                type="button"
                className="rounded-md bg-ink px-3 py-1.5 text-paper2 transition-colors hover:bg-rust disabled:opacity-50"
                disabled={reading}
                onClick={onDevelop}
              >
                Go to Develop
              </button>
            )}
            {frames.length > 0 && onExport && (
              <CullExportPanel
                counts={exportCounts}
                shootName={sessionName ?? "Keepers"}
                ids={exportIds}
                onExport={onExport}
              />
            )}
            {onInstagram && counts.keepers > 0 && !reading && (
              <button
                type="button"
                className="rounded-md px-2.5 py-1.5 hover:bg-ink/5"
                onClick={() => onInstagram(keeperOrder(), current?.frame.id ?? null)}
              >
                Instagram
              </button>
            )}
            {frames.length > 0 && backupControl}
            {frames.length > 0 && importButtons}
          </div>
        </div>
        <input
          ref={(element) => {
            folderInput.current = element;
            element?.setAttribute("webkitdirectory", "");
          }}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            pick(event.target.files);
            event.target.value = "";
          }}
        />
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept="image/*,.nef,.cr2,.cr3,.arw,.dng,.raf,.orf,.rw2,.pef,.srw"
          onChange={(event) => {
            pick(event.target.files);
            event.target.value = "";
          }}
        />
        {reading && (
          <>
            <div className="flex items-center gap-3 px-5 pb-2 font-mono text-[11px] text-moss">
              <p role="status" className="min-w-0 truncate">
                <span className="text-ink">
                  {`${number(progress.read + progress.failed)} of ${number(progress.total)}`}
                </span>
                {formatRate(progress.rate) && ` · ${formatRate(progress.rate)}`}
                {formatRemaining(progress.remainingMs) &&
                  ` · ${formatRemaining(progress.remainingMs)}`}
                {progress.failed > 0 && (
                  <span className="text-rust">{` · ${number(progress.failed)} unreadable`}</span>
                )}
              </p>
              <button
                type="button"
                className="ml-auto shrink-0 rounded-md px-2.5 py-1 hover:bg-ink/5 hover:text-ink"
                onClick={onCancelImport}
              >
                Cancel
              </button>
            </div>
            <div className="cull-progress-bar" aria-hidden="true">
              <span
                style={{
                  width: `${progress.total ? ((progress.read + progress.failed) / progress.total) * 100 : 0}%`,
                }}
              />
            </div>
          </>
        )}
        {snapshot.backup && !snapshot.backup.done && (
          <div className="flex items-center gap-3 px-5 pb-2 font-mono text-[11px] text-moss">
            <p role="status">
              <span className="text-ink">Backup</span>
              {` ${number(snapshot.backup.files)} of ${number(snapshot.backup.totalFiles)}`}
            </p>
            {onCancelBackup && (
              <button
                type="button"
                className="ml-auto shrink-0 rounded-md px-2.5 py-1 hover:bg-ink/5 hover:text-ink"
                onClick={onCancelBackup}
              >
                Stop backup
              </button>
            )}
          </div>
        )}
        {alert && (
          <p role="alert" className="px-5 pb-2 font-mono text-[11px] text-rust">
            {alert}
          </p>
        )}
      </header>

      {frames.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-5 py-3" inert={overlay}>
          {CULL_FILTERS.map((key) =>
            CULL_OPTIONAL_FILTERS.has(key) && counts[key] === 0 && filter !== key ? null : (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                disabled={key !== "all" && key !== filter && counts[key] === 0}
                onClick={() => setFilter(key)}
                className={`rounded-full px-3 py-1 font-mono text-[11px] transition-colors disabled:opacity-40 ${
                  filter === key
                    ? "bg-ink text-paper2"
                    : "border border-input enabled:hover:bg-ink enabled:hover:text-paper2"
                }`}
              >
                {`${CULL_FILTER_LABELS[key]} ${number(counts[key])}`}
              </button>
            ),
          )}
          <span className="cull-refine" role="group" aria-label="Narrow">
            {[1, 2, 3, 4, 5].map((stars) => (
              <button
                key={stars}
                type="button"
                className="cull-refine-star"
                aria-label={`${stars} stars or more`}
                aria-pressed={refine.minRating === stars}
                data-lit={refine.minRating >= stars || undefined}
                onClick={() =>
                  setRefine((previous) => ({
                    ...previous,
                    minRating: previous.minRating === stars ? 0 : stars,
                  }))
                }
              >
                ★
              </button>
            ))}
            {CULL_LABELS.slice(0, 4).map((label) => (
              <button
                key={label}
                type="button"
                className="cull-refine-label"
                data-label={label}
                aria-label={`${LABEL_NAMES[label]} label`}
                aria-pressed={refine.label === label}
                onClick={() =>
                  setRefine((previous) => ({
                    ...previous,
                    label: previous.label === label ? null : label,
                  }))
                }
              />
            ))}
            <button
              type="button"
              className="cull-refine-tag"
              aria-label="Tagged"
              aria-pressed={refine.tagged}
              onClick={() => setRefine((previous) => ({ ...previous, tagged: !previous.tagged }))}
            >
              <Tag size={12} aria-hidden="true" />
            </button>
          </span>
          <span className="ml-auto flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
            {/* The culler says when it is following her rather than only its
                own measurements, and how much of her it has seen. */}
            {snapshot.taste.decisions > 0 && (
              <span className="flex items-center gap-1 text-moss">
                {`Learned from ${number(snapshot.taste.decisions)} of your decisions`}
                {onForgetTaste && (
                  <button
                    type="button"
                    className="grid size-6 place-items-center rounded-md hover:bg-ink/5"
                    aria-label="Forget what the cull learned"
                    onClick={onForgetTaste}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                )}
              </span>
            )}
            {onKeepTarget && ranked > 0 && (
              <span className="cull-target" data-set={snapshot.keepTarget !== null || undefined}>
                <label htmlFor="cull-keep-target">{`Keep ~${number(keepLine)}`}</label>
                <input
                  id="cull-keep-target"
                  type="range"
                  min={0}
                  max={ranked}
                  step={1}
                  value={keepLine}
                  onChange={(event) => onKeepTarget(Number(event.target.value))}
                />
                {snapshot.keepTarget !== null && (
                  <button
                    type="button"
                    className="grid size-6 place-items-center rounded-md hover:bg-ink/5"
                    aria-label="Engine keep line"
                    onClick={() => onKeepTarget(null)}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                )}
              </span>
            )}
            <button
              type="button"
              aria-pressed={autoAdvance}
              onClick={() => setAutoAdvance((value) => !value)}
              className={`rounded-md px-2.5 py-1.5 ${autoAdvance ? "bg-ink/10 text-ink" : "text-moss hover:bg-ink/5"}`}
            >
              Advance
            </button>
            <button
              type="button"
              aria-pressed={stacked}
              onClick={() => setStacked((value) => !value)}
              className={`rounded-md px-2.5 py-1.5 ${stacked ? "bg-ink/10 text-ink" : "text-moss hover:bg-ink/5"}`}
            >
              Stacks
            </button>
            <button
              type="button"
              disabled={!bulk.open}
              onClick={() => bulkAction("keep")}
              className="rounded-md px-2.5 py-1.5 text-[var(--cull-keep)] enabled:hover:bg-ink/5 disabled:opacity-40"
            >
              {`Keep ${number(bulk.open)}`}
            </button>
            <button
              type="button"
              disabled={!bulk.open}
              onClick={() => bulkAction("reject")}
              className="rounded-md px-2.5 py-1.5 text-[var(--cull-reject)] enabled:hover:bg-ink/5 disabled:opacity-40"
            >
              {`Reject ${number(bulk.open)}`}
            </button>
            <button
              type="button"
              disabled={!bulk.decided}
              onClick={() => bulkAction("undecided")}
              className="rounded-md px-2.5 py-1.5 enabled:hover:bg-ink/5 disabled:opacity-40"
            >
              {`Clear ${number(bulk.decided)}`}
            </button>
          </span>
        </div>
      )}

      {pickedCount > 0 && (
        <div className="cull-selection font-mono text-[11px]" inert={overlay}>
          <span className="text-ink">{`${number(pickedCount)} selected`}</span>
          <CullCaption
            value={pickedCaption}
            count={pickedCount}
            codes={snapshot.codes}
            inline
            onCommit={(caption) => onMark([...picked], { caption })}
          />
          {pickedCount <= 4 && (
            <button
              type="button"
              className="rounded-md px-2.5 py-1.5 hover:bg-ink/5"
              onClick={openCompare}
            >
              Compare
            </button>
          )}
          <button
            type="button"
            className="rounded-md px-2.5 py-1.5 text-moss hover:bg-ink/5 hover:text-ink"
            onClick={() => setPicked(NONE)}
          >
            Deselect
          </button>
        </div>
      )}

      <main className="flex min-h-0 flex-1 flex-col" inert={overlay}>
        {cells.length > 0 ? (
          <CullGrid
            cells={cells}
            thumbnail={thumbnail}
            selectedIndex={selectedIndex}
            picked={picked}
            onSelect={onSelect}
            onOpen={open}
            onToggleStack={toggleStack}
            onColumns={setColumns}
            viewport={viewport}
          />
        ) : frames.length > 0 ? (
          <p className="grid flex-1 place-items-center font-mono text-[11px] text-moss">
            {`No ${CULL_FILTER_LABELS[filter].toLowerCase()}`}
          </p>
        ) : (
          <div className="grid flex-1 place-content-center justify-items-center gap-6 px-5">
            <h1 className="font-display text-[clamp(32px,4.5vw,48px)] font-medium leading-[1.1] tracking-[-0.045em]">
              {reading ? "Reading the card" : "Drop a folder"}
            </h1>
            {!reading && (
              <div className="flex flex-wrap items-center justify-center gap-2 font-mono text-[11px]">
                {backupControl}
                {importButtons}
              </div>
            )}
            {!reading && sessionList && <div className="w-72">{sessionList}</div>}
          </div>
        )}
      </main>

      {frames.length > 0 && (
        <p className="px-5 py-2 font-mono text-[10px] text-moss" inert={overlay}>
          {CULL_SHORTCUT_LEGEND}
        </p>
      )}

      {loupe && !compare && current && selectedIndex !== null && (
        <CullLoupe
          frame={current.frame}
          position={selectedIndex}
          total={cells.length}
          thumbnail={thumbnail}
          preview={preview}
          neighbors={neighbors}
          originals={snapshot.originals}
          onReconnect={onReconnect}
          burst={burst}
          onDecide={decideCurrent}
          onStep={move}
          onSelect={selectMember}
          onClose={() => setLoupe(false)}
          onFace={onFace ? (box) => onFace(current.frame.id, box) : undefined}
          showAf={showAf}
          view={loupeView}
          codes={snapshot.codes}
          onCaption={(caption) => onMark([current.frame.id], { caption })}
          onAddCodes={onAddCodes}
          onRemoveCodes={onRemoveCodes}
        />
      )}

      {compare && compareFrames.length > 0 && (
        <CullCompare
          frames={compareFrames}
          focus={Math.min(comparePane, compareFrames.length - 1)}
          thumbnail={thumbnail}
          preview={preview}
          originals={snapshot.originals}
          showAf={showAf}
          view={compareView}
          onFocus={setComparePane}
          onClose={() => setCompare(null)}
        />
      )}
    </div>
  );
}
