import { useRef, useState } from "react";
import type { DevelopSettings } from "@/lib/develop/contract";
import {
  adjustHistogramTone,
  toneLabels,
  toneZoneAt,
  toneZones,
  type ToneZone,
  type DevelopHistogramData,
} from "@/lib/develop/histogram";
import type { DevelopChange } from "./DevelopControls";
import {
  histogramDisplayBins,
  histogramHeight,
  type HistogramChannel,
  type HistogramScale,
} from "@/lib/develop/histogram-display";

export function DevelopHistogram({
  histogram,
  value,
  change,
  disabled,
  clipping,
  onClipping,
}: {
  histogram: DevelopHistogramData | null;
  value: DevelopSettings;
  change: DevelopChange;
  disabled: boolean;
  clipping: { shadows: boolean; highlights: boolean };
  onClipping: (next: { shadows: boolean; highlights: boolean }) => void;
}) {
  const latest = useRef(value);
  latest.current = value;
  const gesture = useRef<{
    start: number;
    width: number;
    zone: ToneZone;
    base: DevelopSettings;
    expected: string;
    pointer: number;
  } | null>(null);
  const keyboard = useRef<{ base: DevelopSettings; expected: string; zone: ToneZone } | null>(null);
  const [hover, setHover] = useState<ToneZone | null>(null);
  const [channel, setChannel] = useState<HistogramChannel>("rgb");
  const [scale, setScale] = useState<HistogramScale>("linear");
  const bins = histogramDisplayBins(histogram, channel),
    max = Math.max(1, ...bins.flat());
  const locked = disabled || !histogram?.pixels;
  // A preset, undo, source change or recovery wins over an in-flight gesture.
  const recipeKey = JSON.stringify(value);
  if (gesture.current && gesture.current.expected !== recipeKey) gesture.current = null;
  if (keyboard.current && keyboard.current.expected !== recipeKey) keyboard.current = null;
  function finish(cancel = false) {
    const g = gesture.current;
    gesture.current = null;
    if (g && !locked)
      change(cancel ? g.base : latest.current, `Histogram: ${toneLabels[g.zone]}`, !cancel);
  }
  function finishKeyboard(cancel = false) {
    const k = keyboard.current;
    keyboard.current = null;
    if (k && !locked)
      change(cancel ? k.base : latest.current, `Histogram: ${toneLabels[k.zone]}`, !cancel);
  }
  const percent = (count: number) =>
    `${((count / Math.max(1, histogram?.pixels ?? 0)) * 100).toFixed(2)}%`;
  return (
    <div className="develop-histogram-control">
      <div className="develop-histogram-display">
        <select
          aria-label="Histogram channel"
          value={channel}
          onChange={(event) => setChannel(event.target.value as HistogramChannel)}
        >
          <option value="rgb">RGB</option>
          <option value="luminance">Luminance</option>
        </select>
        <select
          aria-label="Histogram scale"
          value={scale}
          onChange={(event) => setScale(event.target.value as HistogramScale)}
        >
          <option value="linear">Linear</option>
          <option value="log">Log</option>
        </select>
      </div>
      <div className="develop-histogram-clipping">
        <button
          type="button"
          disabled={!histogram?.pixels}
          aria-label="Show shadow clipping"
          aria-pressed={clipping.shadows}
          title={`Clipped black pixels: ${percent(histogram?.shadows ?? 0)}. Blue overlay.`}
          onClick={() => onClipping({ ...clipping, shadows: !clipping.shadows })}
        >
          △
        </button>
        <span>
          {hover
            ? `${toneLabels[hover]} ${value[hover] > 0 ? "+" : ""}${value[hover]}${hover === "exposure" ? " EV" : ""}`
            : "Drag to adjust tone"}
        </span>
        <button
          type="button"
          disabled={!histogram?.pixels}
          aria-label="Show highlight clipping"
          aria-pressed={clipping.highlights}
          title={`Clipped RGB highlights: ${percent(histogram?.highlights ?? 0)}. Red overlay.`}
          onClick={() => onClipping({ ...clipping, highlights: !clipping.highlights })}
        >
          △
        </button>
      </div>
      <div
        className={`develop-histogram ${locked ? "is-disabled" : ""}`}
        onPointerDown={(e) => {
          if (locked || e.button !== 0 || gesture.current) return;
          finishKeyboard();
          const rect = e.currentTarget.getBoundingClientRect();
          const zone = toneZoneAt((e.clientX - rect.left) / rect.width);
          gesture.current = {
            start: e.clientX,
            width: rect.width,
            zone,
            base: structuredClone(value),
            expected: recipeKey,
            pointer: e.pointerId,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
          setHover(zone);
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (!g) {
            const r = e.currentTarget.getBoundingClientRect();
            setHover(toneZoneAt((e.clientX - r.left) / r.width));
            return;
          }
          if (locked || g.pointer !== e.pointerId) return;
          latest.current = adjustHistogramTone(g.base, g.zone, (e.clientX - g.start) / g.width);
          g.expected = JSON.stringify(latest.current);
          change(latest.current, `Histogram: ${toneLabels[g.zone]}`, false);
        }}
        onPointerUp={(e) => {
          if (gesture.current?.pointer === e.pointerId) finish();
        }}
        onPointerCancel={(e) => {
          if (gesture.current?.pointer === e.pointerId) finish(true);
        }}
        onLostPointerCapture={(e) => {
          if (gesture.current?.pointer === e.pointerId) finish(true);
        }}
        onPointerLeave={() => {
          if (!gesture.current) setHover(null);
        }}
      >
        <svg
          viewBox="0 0 256 74"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Rendered preview ${channel === "rgb" ? "RGB" : "luminance"} histogram, ${scale} scale`}
        >
          {bins.map((bin, i) => (
            <path
              key={i}
              d={`M0 74 ${bin.map((n, j) => `L${(j * 256) / 255} ${74 - histogramHeight(n, max, scale) * 70}`).join(" ")} L256 74Z`}
              fill={channel === "luminance" ? "#bcbcbc" : ["#db6877", "#70b487", "#7297d3"][i]}
              stroke={channel === "luminance" ? "#e0e0e0" : ["#ee8290", "#85c79b", "#8eb0e7"][i]}
              strokeWidth="0.5"
              style={{ mixBlendMode: "screen" }}
              opacity=".65"
            />
          ))}
        </svg>
        <div className="develop-histogram-zones">
          {toneZones.map((zone) => (
            <div
              key={zone}
              role="slider"
              tabIndex={locked ? -1 : 0}
              aria-label={`Histogram ${toneLabels[zone]}`}
              aria-disabled={locked}
              aria-valuemin={zone === "exposure" ? -5 : -100}
              aria-valuemax={zone === "exposure" ? 5 : 100}
              aria-valuenow={value[zone]}
              className={hover === zone ? "is-hovered" : ""}
              onFocus={() => setHover(zone)}
              onBlur={() => {
                finishKeyboard();
                setHover(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape" && (gesture.current || keyboard.current)) {
                  e.preventDefault();
                  e.stopPropagation();
                  finish(true);
                  finishKeyboard(true);
                  return;
                }
                if (
                  locked ||
                  !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(
                    e.key,
                  )
                )
                  return;
                e.preventDefault();
                e.stopPropagation();
                const sign = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 1;
                const delta = sign * (e.shiftKey ? 10 : 1) * (zone === "exposure" ? 0.025 : 0.005);
                if (gesture.current) return;
                keyboard.current ??= {
                  base: structuredClone(latest.current),
                  expected: recipeKey,
                  zone,
                };
                const next =
                  e.key === "Home" || e.key === "End"
                    ? {
                        ...latest.current,
                        [zone]: (e.key === "Home" ? -1 : 1) * (zone === "exposure" ? 5 : 100),
                      }
                    : adjustHistogramTone(latest.current, zone, delta);
                latest.current = next;
                keyboard.current.expected = JSON.stringify(next);
                change(next, `Histogram: ${toneLabels[zone]}`, false);
              }}
              onKeyUp={(e) => {
                if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") {
                  e.stopPropagation();
                  finishKeyboard();
                }
              }}
            />
          ))}
        </div>
      </div>
      <div className="develop-histogram-stats">
        <span>Black {percent(histogram?.shadows ?? 0)}</span>
        <span>RGB clip {percent(histogram?.highlights ?? 0)}</span>
      </div>
    </div>
  );
}
