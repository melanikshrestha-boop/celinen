import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  developPixelSampleDescription,
  developPixelSampleText,
  type DevelopPixelSample,
  type DevelopPixelSampleChannel,
} from "@/lib/develop/pixel-sample";
import {
  histogramChannelLabels,
  histogramDisplayPaths,
  type HistogramChannel,
  type HistogramScale,
} from "@/lib/develop/histogram-display";

const emptyPixelSnapshot = () => null;
const subscribeNoPixelSamples = () => () => {};

export function DevelopHistogram({
  histogram,
  value,
  change,
  disabled,
  clipping,
  onClipping,
  pending = false,
  sourceLabel = "Rendered preview",
  sample: suppliedSample = null,
  sampleChannel,
  sampleUrl = null,
}: {
  histogram: DevelopHistogramData | null;
  value: DevelopSettings;
  change: DevelopChange;
  disabled: boolean;
  clipping: { shadows: boolean; highlights: boolean };
  onClipping: (next: { shadows: boolean; highlights: boolean }) => void;
  /** The graph still describes the last measured preview; pending alone does not interrupt edits. */
  pending?: boolean;
  sourceLabel?: string;
  sample?: DevelopPixelSample | null;
  sampleChannel?: DevelopPixelSampleChannel;
  sampleUrl?: string | null;
}) {
  const pixelSnapshot = useSyncExternalStore(
    sampleChannel?.subscribe ?? subscribeNoPixelSamples,
    sampleChannel?.getSnapshot ?? emptyPixelSnapshot,
    emptyPixelSnapshot,
  );
  const sample = sampleChannel
    ? pixelSnapshot?.url === sampleUrl
      ? pixelSnapshot.sample
      : null
    : suppliedSample;
  const latest = useRef(value);
  latest.current = value;
  const gesture = useRef<{
    start: number;
    width: number;
    zone: ToneZone;
    base: DevelopSettings;
    expected: string;
    baseKey: string;
    pointer: number;
    delta: number | null;
  } | null>(null);
  const keyboard = useRef<{ base: DevelopSettings; expected: string; zone: ToneZone } | null>(null);
  const [hover, setHover] = useState<ToneZone | null>(null);
  const [channel, setChannel] = useState<HistogramChannel>("rgb");
  const [scale, setScale] = useState<HistogramScale>("linear");
  const paths = useMemo(
    () => histogramDisplayPaths(histogram, channel, scale),
    [histogram, channel, scale],
  );
  const frame = useRef<number | null>(null);
  const locked = disabled || !histogram?.pixels;
  const live = useRef({ change, locked });
  live.current = { change, locked };
  // A preset, undo, source change or recovery wins over an in-flight gesture.
  const recipeKey = useMemo(() => JSON.stringify(value), [value]);
  if (gesture.current && gesture.current.expected !== recipeKey) gesture.current = null;
  if (keyboard.current && keyboard.current.expected !== recipeKey) keyboard.current = null;
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      gesture.current = null;
      keyboard.current = null;
    },
    [],
  );
  function clearFrame() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }
  function flushPointer() {
    clearFrame();
    const g = gesture.current;
    if (!g || g.delta === null || live.current.locked) return;
    const next = adjustHistogramTone(g.base, g.zone, g.delta);
    g.delta = null;
    const expected = JSON.stringify(next);
    if (expected === g.expected) return;
    latest.current = next;
    g.expected = expected;
    live.current.change(next, `Histogram: ${toneLabels[g.zone]}`, false);
  }
  function queuePointer(clientX: number) {
    const g = gesture.current;
    if (!g || live.current.locked || !Number.isFinite(clientX)) return;
    g.delta = (clientX - g.start) / g.width;
    if (frame.current === null) frame.current = requestAnimationFrame(flushPointer);
  }
  function finish(cancel = false) {
    if (cancel) clearFrame();
    else flushPointer();
    const g = gesture.current;
    gesture.current = null;
    if (g && !live.current.locked && g.expected !== g.baseKey) {
      if (cancel) latest.current = g.base;
      live.current.change(latest.current, `Histogram: ${toneLabels[g.zone]}`, !cancel);
    }
  }
  function finishKeyboard(cancel = false) {
    const k = keyboard.current;
    keyboard.current = null;
    if (k && !live.current.locked) {
      if (cancel) latest.current = k.base;
      live.current.change(latest.current, `Histogram: ${toneLabels[k.zone]}`, !cancel);
    }
  }
  const percent = (count: number) =>
    histogram?.pixels ? `${((count / histogram.pixels) * 100).toFixed(2)}%` : "—";
  const palette = [
    ["#db6877", "#ee8290"],
    ["#70b487", "#85c79b"],
    ["#7297d3", "#8eb0e7"],
  ];
  const color = (index: number) =>
    channel === "luminance"
      ? ["#bcbcbc", "#e0e0e0"]
      : palette[channel === "rgb" ? index : { red: 0, green: 1, blue: 2 }[channel]]!;
  return (
    <div className="develop-histogram-control" aria-busy={pending}>
      <div className="develop-histogram-display">
        <select
          aria-label="Histogram channel"
          value={channel}
          onChange={(event) => setChannel(event.target.value as HistogramChannel)}
        >
          <option value="rgb">RGB</option>
          <option value="luminance">Luminance</option>
          <option value="red">Red</option>
          <option value="green">Green</option>
          <option value="blue">Blue</option>
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
          title={`Clipped RGB shadows: ${percent(histogram?.shadowClipped ?? 0)}. Fully black: ${percent(histogram?.shadows ?? 0)}. Blue overlay.`}
          onClick={() => onClipping({ ...clipping, shadows: !clipping.shadows })}
        >
          △
        </button>
        <span>
          {!histogram?.pixels ? (
            pending ? (
              "Updating preview"
            ) : (
              "No preview pixels"
            )
          ) : (
            <>
              {pending && (hover ? "Updating · " : "Updating preview")}
              {hover
                ? `${toneLabels[hover]} ${value[hover] > 0 ? "+" : ""}${value[hover]}${hover === "exposure" ? " EV" : ""}`
                : !pending &&
                  (sample ? (
                    <span
                      aria-label={developPixelSampleDescription(sample, sourceLabel)}
                      title={developPixelSampleDescription(sample, sourceLabel)}
                    >
                      {developPixelSampleText(sample)}
                    </span>
                  ) : (
                    "Drag to adjust tone"
                  ))}
            </>
          )}
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
          if (!Number.isFinite(rect.width) || rect.width <= 0) return;
          const zone = toneZoneAt((e.clientX - rect.left) / rect.width);
          const base = structuredClone(latest.current);
          const baseKey = JSON.stringify(base);
          gesture.current = {
            start: e.clientX,
            width: rect.width,
            zone,
            base,
            expected: baseKey,
            baseKey,
            pointer: e.pointerId,
            delta: null,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
          setHover(zone);
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (!g) {
            if (locked) return;
            const r = e.currentTarget.getBoundingClientRect();
            if (!Number.isFinite(r.width) || r.width <= 0) return;
            setHover(toneZoneAt((e.clientX - r.left) / r.width));
            return;
          }
          if (locked || g.pointer !== e.pointerId) return;
          queuePointer(e.clientX);
        }}
        onPointerUp={(e) => {
          if (gesture.current?.pointer === e.pointerId) {
            queuePointer(e.clientX);
            finish();
          }
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
          aria-label={`${sourceLabel} ${histogramChannelLabels[channel]} histogram, ${scale} scale${pending ? ", updating preview" : !histogram?.pixels ? ", no pixels available" : ""}`}
        >
          {paths.map((path, i) => (
            <path
              key={i}
              d={path}
              fill={color(i)[0]}
              stroke={color(i)[1]}
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
              aria-valuetext={`${value[zone]}${zone === "exposure" ? " EV" : ""}`}
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
        <span title="All RGB channels are zero">Black {percent(histogram?.shadows ?? 0)}</span>
        <span title="At least one RGB channel is zero">
          RGB shadows {percent(histogram?.shadowClipped ?? 0)}
        </span>
        <span title="At least one RGB channel is 255">
          RGB clip {percent(histogram?.highlights ?? 0)}
        </span>
      </div>
    </div>
  );
}
