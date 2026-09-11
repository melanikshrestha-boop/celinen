import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  requestBurstGroups,
  type BurstFrame,
  type BurstGroup,
  type BurstReviewResult,
} from "@/lib/studio/bursts";

interface View {
  zoom: number;
  x: number;
  y: number;
}
const initialView: View = { zoom: 1, x: 0.5, y: 0.5 };
const clamp = (value: number) => Math.max(0, Math.min(1, value));

function Candidate({
  frame,
  recommended,
  view,
  onView,
  onCull,
}: {
  frame: BurstFrame;
  recommended: boolean;
  view: View;
  onView: (next: View) => void;
  onCull: (id: string) => void;
}) {
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ clientX: number; clientY: number; x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => setSize(null), [frame.previewUrl]);
  return (
    <section className="min-w-0" aria-label={`Compare ${frame.name}`}>
      <div
        className="relative flex h-[32vh] min-h-40 items-center justify-center overflow-hidden bg-paper2 sm:h-[42vh]"
        style={{
          touchAction: view.zoom > 1 ? "none" : "auto",
          cursor: view.zoom > 1 ? "grab" : "default",
        }}
        onPointerDown={(event) => {
          if (view.zoom <= 1 || !image.current) return;
          drag.current = { clientX: event.clientX, clientY: event.clientY, x: view.x, y: view.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const origin = drag.current;
          if (!origin || !image.current || view.zoom <= 1) return;
          const width = image.current.clientWidth;
          const height = image.current.clientHeight;
          if (!width || !height) return;
          onView({
            ...view,
            x: clamp(origin.x - (event.clientX - origin.clientX) / (width * (view.zoom - 1))),
            y: clamp(origin.y - (event.clientY - origin.clientY) / (height * (view.zoom - 1))),
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        {frame.previewUrl ? (
          <img
            ref={image}
            src={frame.previewUrl}
            alt={frame.name}
            draggable={false}
            onLoad={(event) =>
              setSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            className="block max-h-full max-w-full select-none object-contain"
            style={{
              transform: `scale(${view.zoom})`,
              transformOrigin: `${view.x * 100}% ${view.y * 100}%`,
            }}
          />
        ) : (
          <p className="p-4 text-sm text-moss">
            Preview unavailable. Reconnect the original folder.
          </p>
        )}
      </div>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm" title={frame.relativePath ?? frame.name}>
            {frame.name}
          </p>
          <p className="mt-1 text-[11px] text-moss">
            {recommended ? "Quality suggestion · " : ""}
            {frame.verdict === "keep"
              ? "Already kept"
              : frame.verdict === "reject"
                ? "Already rejected"
                : "Unreviewed"}
          </p>
          {size && (
            <p className="mt-1 font-mono text-[10px] text-moss">
              {size.width} × {size.height} preview · not original-resolution focus
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={frame.verdict !== "undecided" || !!frame.error}
          onClick={() => {
            if (frame.verdict === "undecided" && !frame.error) onCull(frame.id);
          }}
          className="shrink-0 rounded-md bg-ink px-3 py-1.5 text-xs text-paper disabled:cursor-default disabled:bg-transparent disabled:text-moss"
        >
          {frame.verdict === "keep"
            ? "Kept"
            : frame.verdict === "reject"
              ? "Pick protected"
              : "Keep this, reject the rest"}
        </button>
      </div>
    </section>
  );
}

function GroupComparison({
  group,
  frames,
  onCull,
}: {
  group: BurstGroup;
  frames: ReadonlyMap<string, BurstFrame>;
  onCull: (id: string) => void;
}) {
  const available = group.frameIds.flatMap((id) => (frames.get(id) ? [frames.get(id)!] : []));
  const first = group.recommendedId || group.frameIds[0] || "";
  const second = group.frameIds.find((id) => id !== first) ?? "";
  const [leftId, setLeftId] = useState(first);
  const [rightId, setRightId] = useState(second);
  const [view, setView] = useState<View>(initialView);
  const left = frames.get(leftId);
  const right = frames.get(rightId);
  const changeCandidate = (side: "left" | "right", id: string) => {
    if (side === "left") {
      if (id === rightId) setRightId(leftId);
      setLeftId(id);
    } else {
      if (id === leftId) setLeftId(rightId);
      setRightId(id);
    }
    setView(initialView);
  };
  return (
    <>
      <p className="text-xs leading-relaxed text-moss">{group.reason}</p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <label className="flex items-center gap-2">
          Linked preview zoom
          <select
            aria-label="Linked preview zoom"
            value={view.zoom}
            onChange={(event) => setView({ ...view, zoom: Number(event.target.value) })}
            className="bg-transparent px-1 py-1"
          >
            <option value={1}>Fit</option>
            <option value={2}>2× preview</option>
            <option value={4}>4× preview</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => setView(initialView)}
          className="flex items-center gap-1.5 text-moss hover:text-ink"
        >
          <RotateCcw size={12} /> Reset view
        </button>
        {view.zoom > 1 && <span className="text-moss">Drag either image to pan both.</span>}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-5">
        {(["left", "right"] as const).map((side) => {
          const selected = side === "left" ? left : right;
          return (
            <div key={side} className="min-w-0">
              <label className="mb-2 flex items-center gap-2 text-xs text-moss">
                <span className="sr-only">{side === "left" ? "Left" : "Right"} candidate</span>
                <select
                  aria-label={`${side === "left" ? "Left" : "Right"} candidate`}
                  value={side === "left" ? leftId : rightId}
                  onChange={(event) => changeCandidate(side, event.target.value)}
                  className="w-full min-w-0 bg-transparent py-1 text-ink"
                >
                  {available.map((frame) => (
                    <option key={frame.id} value={frame.id}>
                      {frame.name}
                      {frame.verdict === "keep"
                        ? " · kept"
                        : frame.verdict === "reject"
                          ? " · rejected"
                          : ""}
                    </option>
                  ))}
                </select>
              </label>
              {selected && (
                <Candidate
                  key={selected.id}
                  frame={selected}
                  recommended={selected.id === group.recommendedId}
                  view={view}
                  onView={setView}
                  onCull={onCull}
                />
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-moss">
        Culling this burst keeps one frame and rejects the other unreviewed frames. Existing
        keep/reject picks stay.
      </p>
    </>
  );
}

export function BurstReview({
  open,
  onOpenChange,
  shots,
  onCull,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shots: readonly BurstFrame[];
  onCull: (keepId: string, groupIds: readonly string[]) => void;
}) {
  const [result, setResult] = useState<BurstReviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const frames = useMemo(() => new Map(shots.map((frame) => [frame.id, frame])), [shots]);
  // A keep action updates visible verdicts immediately, without resetting the
  // comparison or reranking the user's group halfway through a decision.
  const latestShots = useRef(shots);
  latestShots.current = shots;
  const membership = useMemo(
    () =>
      JSON.stringify(
        shots.map((frame) => [
          frame.id,
          frame.error,
          frame.hash,
          frame.captureTimeMs,
          frame.captureTimeBasis,
          frame.cameraKey,
          frame.analysisBackend,
          frame.relativePath,
          frame.score,
          frame.sharpness,
          frame.brightness,
        ]),
      ),
    [shots],
  );
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setResult(null);
    setPage(0);
    requestBurstGroups(latestShots.current, { signal: controller.signal })
      .then((next) => {
        if (!controller.signal.aborted) setResult(next);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Burst review could not finish. No selections were changed.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, membership, retry]);
  const group = result?.groups[Math.min(page, result.groups.length - 1)];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94dvh] w-[calc(100%-2rem)] max-w-5xl overflow-y-auto border-0 bg-paper p-5 text-ink shadow-none sm:p-7">
        <DialogHeader className="pr-8">
          <DialogTitle className="font-display text-xl font-normal">Review bursts</DialogTitle>
          <DialogDescription className="text-xs text-moss">
            Cull the burst: keep one frame, reject the other unreviewed frames. Existing picks stay.
          </DialogDescription>
        </DialogHeader>
        {loading && (
          <p role="status" className="flex items-center gap-2 py-12 text-sm text-moss">
            <Loader2 size={15} className="animate-spin" /> Grouping native analysis receipts…
          </p>
        )}
        {error && (
          <div role="alert" className="py-8">
            <p className="text-sm text-moss">{error}</p>
            <button
              type="button"
              className="mt-3 text-sm underline underline-offset-4"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry
            </button>
          </div>
        )}
        {result && !group && (
          <p className="py-12 text-sm leading-relaxed text-moss">
            No conservative groups found. {result.stats.eligibleFrames.toLocaleString()} readable
            analysis receipts checked. Missing camera metadata is never treated as capture time; you
            can still review every frame in the contact sheet.
          </p>
        )}
        {group && (
          <>
            <div className="flex items-center justify-between gap-3 text-xs">
              <p>
                {group.kind === "burst"
                  ? "Capture-time group"
                  : "Similar frames · not a confirmed burst"}{" "}
                · {group.frameIds.length} frames
              </p>
              <div className="flex items-center gap-3">
                <button
                  aria-label="Previous group"
                  type="button"
                  disabled={page === 0}
                  className="p-1 disabled:opacity-25"
                  onClick={() => setPage((value) => value - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="font-mono text-[10px]">
                  {page + 1} / {result?.groups.length}
                </span>
                <button
                  aria-label="Next group"
                  type="button"
                  disabled={page >= (result?.groups.length ?? 0) - 1}
                  className="p-1 disabled:opacity-25"
                  onClick={() => setPage((value) => value + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
            <GroupComparison
              key={group.id}
              group={group}
              frames={frames}
              onCull={(id) => {
                if (frames.get(id)?.verdict === "undecided") onCull(id, group.frameIds);
              }}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
