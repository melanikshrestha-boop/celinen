import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { CullSnapshot } from "@/lib/studio/cull/controller";
import type { CullVerdict } from "@/lib/studio/cull/engine";
import {
  CULL_FILTER_LABELS,
  CULL_FILTERS,
  countFrames,
  formatRemaining,
  groupFrames,
  matchesFilter,
  type CullFilter,
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
  cullCells,
  cullKeyAction,
  formatRate,
  importName,
  toggledVerdict,
} from "./cull-review";
import { CullGrid, type CullThumbnailSource, type CullViewport } from "./CullGrid";
import { CullLoupe } from "./CullLoupe";
import type { CullLoupeSource } from "./CullLoupePicture";
import "./cull.css";

export type CullWorkspaceProps = {
  snapshot: CullSnapshot;
  /** Starts a new session from a card, named for its folder. `roots` are the
   * folder and file handles it came through, where the browser offers them. */
  onImport: (name: string, files: readonly File[], roots?: readonly CullSourceRoot[]) => void;
  onCancelImport: () => void;
  /** Records the photographer's decision on these frames as one undo step. */
  onDecide: (ids: readonly string[], verdict: CullVerdict) => void;
  onUndo: () => void;
  /** Must keep its identity across renders; cards read thumbnails as they scroll into view. */
  thumbnail: CullThumbnailSource;
  /** The loupe's picture, best source first. Same identity rule. Without it, the thumbnail. */
  preview?: CullLoupeSource | undefined;
  /** Reconnects or locates the session's originals; runs inside the photographer's click. */
  onReconnect?: (() => void) | undefined;
  sessions?: readonly CullSessionSummary[] | undefined;
  onOpenSession?: ((sessionId: string) => void) | undefined;
  viewport?: CullViewport | undefined;
};

const number = (value: number) => value.toLocaleString("en-US");

export function CullWorkspace({
  snapshot,
  onImport,
  onCancelImport,
  onDecide,
  onUndo,
  thumbnail,
  preview,
  onReconnect,
  sessions = [],
  onOpenSession,
  viewport,
}: CullWorkspaceProps) {
  const { frames, progress, notice, canUndo } = snapshot;
  const [filter, setFilter] = useState<CullFilter>("all");
  const [stacked, setStacked] = useState(true);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loupe, setLoupe] = useState(false);
  const [columns, setColumns] = useState(1);
  const [dropping, setDropping] = useState(false);
  const [dropNote, setDropNote] = useState<string | null>(null);
  // A picked folder is walked before its import starts; a second click must not start another.
  const [choosing, setChoosing] = useState(false);
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // A different session is a different card: nothing chosen on the last one applies.
  const [viewedSession, setViewedSession] = useState(snapshot.sessionId);
  if (viewedSession !== snapshot.sessionId) {
    setViewedSession(snapshot.sessionId);
    setExpanded(new Set());
    setSelectedId(null);
    setLoupe(false);
  }

  const counts = useMemo(() => countFrames(frames), [frames]);
  const cells = useMemo(
    () => cullCells(frames, { filter, stacked, expanded }),
    [frames, filter, stacked, expanded],
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
  const bulk = useMemo(() => bulkCounts(frames, filter), [frames, filter]);
  // The loupe compares the burst as the current filter sees it, so every
  // member it offers is one the grid can hold in hand.
  const burstGroup = loupe ? (current?.frame.suggestion?.group ?? null) : null;
  const burst = useMemo(
    () =>
      burstGroup === null
        ? []
        : (groupFrames(
            frames.filter(
              (frame) => frame.suggestion?.group === burstGroup && matchesFilter(frame, filter),
            ),
          )[0]?.frames ?? []),
    [frames, filter, burstGroup],
  );
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

  // ⌘Z belongs to the app's edit keys; the screen claims it only with something to undo.
  useEffect(() => (canUndo ? registerAppKeys({ undo: onUndo }) : undefined), [canUndo, onUndo]);

  const decideCurrent = useCallback(
    (verdict: CullVerdict) => {
      if (!current || selectedIndex === null) return;
      const { frame } = current;
      if (verdict === "undecided" ? !frame.decided : frame.decided && frame.verdict === verdict)
        return;
      onDecide([frame.id], verdict);
      // Reviewing is a stream: after a decision the next frame is already in
      // hand. If the decision takes this frame out of the view, the cell that
      // slides into its place is the next one; at the end, step back instead.
      const leaves = !matchesFilter(
        { ...frame, verdict, decided: verdict !== "undecided" },
        filter,
      );
      const next = cells[selectedIndex + 1] ?? (leaves ? cells[selectedIndex - 1] : current);
      setSelectedId(next?.frame.id ?? null);
    },
    [current, selectedIndex, cells, filter, onDecide],
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
    setLoupe(true);
  }, []);

  // One listener for the whole screen, reading the latest state through a ref
  // so it is attached once rather than on every keystroke.
  const keys = useRef({ current, columns, loupe, move, decideCurrent, toggleStack });
  keys.current = { current, columns, loupe, move, decideCurrent, toggleStack };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isTypingTarget(event.target)) return;
      const action = cullKeyAction(event);
      const state = keys.current;
      if (!action || !state.current) return;
      if (action.kind === "close" && !state.loupe) return;
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
          state.move(
            action.axis === "row" && !state.loupe ? action.step * state.columns : action.step,
          );
          return;
        case "decide":
          state.decideCurrent(action.verdict);
          return;
        case "toggle":
          state.decideCurrent(toggledVerdict(state.current.frame));
          return;
        case "stack":
          if (state.current.stackId) state.toggleStack(state.current.stackId);
          return;
        case "open":
          setLoupe(true);
          return;
        case "close":
          setLoupe(false);
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const bulkAction = (verdict: CullVerdict) => {
    const ids = bulkTargets(frames, filter, verdict);
    if (ids.length) onDecide(ids, verdict);
  };

  const startImport = (files: readonly File[], roots: readonly CullSourceRoot[] = []) => {
    setDropNote(null);
    onImport(importName(files), files, roots);
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

  const alert = notice ?? dropNote;
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
        className="rounded-md bg-ink px-3 py-1.5 text-paper2 transition-colors hover:bg-rust disabled:opacity-50"
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
      <header className="border-b border-border/70" inert={loupe}>
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
        {alert && (
          <p role="alert" className="px-5 pb-2 font-mono text-[11px] text-rust">
            {alert}
          </p>
        )}
      </header>

      {frames.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-5 py-3" inert={loupe}>
          {CULL_FILTERS.map((key) => (
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
          ))}
          <span className="ml-auto flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
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

      <main className="flex min-h-0 flex-1 flex-col" inert={loupe}>
        {cells.length > 0 ? (
          <CullGrid
            cells={cells}
            thumbnail={thumbnail}
            selectedIndex={selectedIndex}
            onSelect={setSelectedId}
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
              <div className="flex items-center gap-2 font-mono text-[11px]">{importButtons}</div>
            )}
            {!reading && sessionList && <div className="w-72">{sessionList}</div>}
          </div>
        )}
      </main>

      {frames.length > 0 && (
        <p className="px-5 py-2 font-mono text-[10px] text-moss" inert={loupe}>
          {CULL_SHORTCUT_LEGEND}
        </p>
      )}

      {loupe && current && selectedIndex !== null && (
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
        />
      )}
    </div>
  );
}
