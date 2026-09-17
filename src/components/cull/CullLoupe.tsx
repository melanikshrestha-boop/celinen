import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { CullVerdict } from "@/lib/studio/cull/engine";
import type { CullFrame } from "@/lib/studio/cull/session";
import { CULL_REASON_LABELS } from "@/lib/studio/cull/session";
import { plainReading } from "./cull-review";
import { CullMark, CullThumb, type CullThumbnailSource } from "./CullGrid";

export type CullLoupeProps = {
  frame: CullFrame;
  /** Position of the frame among the cells on screen, and how many there are. */
  position: number;
  total: number;
  thumbnail: CullThumbnailSource;
  /** The large picture. Burst members below stay thumbnails. */
  preview: CullThumbnailSource;
  /** The frame's whole burst, best first; empty when it stands alone. */
  burst: readonly CullFrame[];
  onDecide: (verdict: CullVerdict) => void;
  onStep: (step: 1 | -1) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
};

const DECISIONS: readonly [CullVerdict, string][] = [
  ["keep", "Keep · K"],
  ["reject", "Reject · X"],
  ["undecided", "Clear · U"],
];

export function CullLoupe({
  frame,
  position,
  total,
  thumbnail,
  preview,
  burst,
  onDecide,
  onStep,
  onSelect,
  onClose,
}: CullLoupeProps) {
  const dialog = useRef<HTMLDivElement>(null);
  // Focus follows the loupe in, so Tab stays inside it and not on the grid behind.
  useEffect(() => dialog.current?.focus({ preventScroll: true }), []);
  const suggestion = frame.suggestion;
  const reason = suggestion?.reason ?? "none";

  return (
    <div
      ref={dialog}
      className="cull-loupe"
      role="dialog"
      aria-modal="true"
      aria-label={frame.name}
      tabIndex={-1}
    >
      <div className="col-span-full flex items-center justify-between gap-3 px-6 py-3">
        <span className="min-w-0 truncate font-mono text-[11px] text-moss">
          <span className="text-ink">{frame.name}</span>
          {` · ${position + 1} of ${total}${frame.width && frame.height ? ` · ${frame.width}×${frame.height}` : ""}`}
        </span>
        <span className="flex shrink-0 items-center gap-1 font-mono text-[11px]">
          <button
            type="button"
            className="grid size-8 place-items-center rounded-md hover:bg-ink/5 disabled:opacity-35"
            aria-label="Previous"
            disabled={position <= 0}
            onClick={() => onStep(-1)}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="grid size-8 place-items-center rounded-md hover:bg-ink/5 disabled:opacity-35"
            aria-label="Next"
            disabled={position >= total - 1}
            onClick={() => onStep(1)}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="ml-2 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 hover:bg-ink/5"
            onClick={onClose}
          >
            <X size={14} aria-hidden="true" />
            Esc
          </button>
        </span>
      </div>

      <div className="cull-loupe-stage">
        {frame.error ? (
          <p className="font-mono text-[12px] text-rust">{frame.error}</p>
        ) : (
          <CullThumb frame={frame} thumbnail={preview} />
        )}
      </div>

      {burst.length > 1 && (
        <div className="cull-compare" role="group" aria-label={`Burst of ${burst.length}`}>
          {burst.map((member) => (
            <button
              key={member.id}
              type="button"
              aria-label={member.name}
              aria-current={member.id === frame.id ? "true" : undefined}
              onClick={() => onSelect(member.id)}
            >
              <span className="cull-thumb">
                <CullThumb frame={member} thumbnail={thumbnail} />
                <CullMark frame={member} size={10} />
              </span>
              <span className="cull-card-meta font-mono text-[10px]">
                <span>{member.suggestion?.bestOfGroup ? "Best" : member.name}</span>
                {member.suggestion && <span className="text-ink">{member.suggestion.score}</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      <aside className="cull-loupe-side">
        <div className="flex items-center gap-2">
          <CullMark frame={frame} />
          {suggestion && (
            <span className="font-display text-[28px] font-semibold leading-none tracking-[-0.03em]">
              {suggestion.score}
            </span>
          )}
          {reason !== "none" && (
            <span className="rounded-full border border-input px-2 py-0.5 font-mono text-[10px]">
              {CULL_REASON_LABELS[reason]}
            </span>
          )}
        </div>

        {frame.reading ? (
          <dl className="mt-6 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-[13px]">
            {plainReading(frame.reading).map((row) => (
              <div key={row.label} className="contents">
                <dt className="font-mono text-[10px] uppercase leading-[19.5px] tracking-wider text-moss">
                  {row.label}
                </dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          !frame.error && <p className="mt-6 font-mono text-[11px] text-moss">Not measured</p>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          {DECISIONS.map(([verdict, label]) => (
            <button
              key={verdict}
              type="button"
              className="cull-decide font-mono text-[11px] uppercase tracking-[0.12em]"
              data-verdict={verdict}
              aria-pressed={
                verdict === "undecided" ? undefined : frame.decided && frame.verdict === verdict
              }
              disabled={verdict === "undecided" && !frame.decided}
              onClick={() => onDecide(verdict)}
            >
              {label}
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
