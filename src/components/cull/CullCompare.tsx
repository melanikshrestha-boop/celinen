import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { CullOriginals } from "@/lib/studio/cull/controller";
import type { CullFrame } from "@/lib/studio/cull/session";
import { CULL_REASON_LABELS } from "@/lib/studio/cull/session";
import { focusSummary, sharpnessReadout } from "./cull-review";
import { CullAfBox } from "./CullAfBox";
import { CullMark, CullMarks, CullName, CullThumb, type CullThumbnailSource } from "./CullGrid";
import { CullLoupePicture, type CullLoupeSource } from "./CullLoupePicture";
import type { PictureView } from "./picture-view";

const NO_NEIGHBORS: readonly string[] = [];

/**
 * Two to four frames side by side at the loupe's full quality, zoomed and
 * panned together so the same eye or the same jersey number is compared in
 * every frame. The focused pane is the one the keys decide.
 */
export function CullCompare({
  frames,
  focus,
  thumbnail,
  preview,
  originals,
  showAf,
  view,
  onFocus,
  onClose,
}: {
  frames: readonly CullFrame[];
  focus: number;
  thumbnail: CullThumbnailSource;
  preview?: CullLoupeSource | undefined;
  originals?: CullOriginals | undefined;
  showAf: boolean;
  view: PictureView;
  onFocus: (index: number) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => dialog.current?.focus({ preventScroll: true }), []);
  return (
    <div
      ref={dialog}
      className="cull-loupe cull-compare-view"
      role="dialog"
      aria-modal="true"
      aria-label={`Compare ${frames.length}`}
      tabIndex={-1}
    >
      <div className="col-span-full flex items-center justify-between gap-3 px-6 py-3">
        <span className="font-mono text-[11px] text-moss">{`Compare ${frames.length}`}</span>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-mono text-[11px] hover:bg-ink/5"
          onClick={onClose}
        >
          <X size={14} aria-hidden="true" />
          Esc
        </button>
      </div>
      <div className="cull-compare-panes" data-count={frames.length}>
        {frames.map((frame, index) => {
          const reason = frame.suggestion?.reason ?? "none";
          const sharp = sharpnessReadout(frame);
          const focusText = focusSummary(frame);
          return (
            <section
              key={frame.id}
              className="cull-compare-pane"
              aria-current={index === focus ? "true" : undefined}
              aria-label={`${index + 1}. ${frame.name}`}
              data-frame-id={frame.id}
            >
              <div className="cull-compare-stage">
                {frame.error ? (
                  <p className="font-mono text-[12px] text-rust">{frame.error}</p>
                ) : preview ? (
                  <CullLoupePicture
                    frame={frame}
                    thumbnail={thumbnail}
                    source={preview}
                    neighbors={NO_NEIGHBORS}
                    epoch={originals ?? ""}
                    view={view}
                    onPointerDown={() => onFocus(index)}
                  >
                    {showAf && <CullAfBox frame={frame} />}
                  </CullLoupePicture>
                ) : (
                  <button type="button" className="contents" onClick={() => onFocus(index)}>
                    <CullThumb frame={frame} thumbnail={thumbnail} />
                  </button>
                )}
              </div>
              <div className="cull-compare-meta font-mono text-[10px]">
                <span className="cull-compare-key">{`⌥${index + 1}`}</span>
                <CullMark frame={frame} size={10} />
                <CullName name={frame.name} />
                <CullMarks frame={frame} />
                {frame.suggestion && <span className="text-ink">{frame.suggestion.score}</span>}
                {sharp && <span>{sharp}</span>}
                {focusText && <span>{focusText}</span>}
                {reason !== "none" && <span>{CULL_REASON_LABELS[reason]}</span>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
