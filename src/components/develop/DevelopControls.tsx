import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  RotateCcw,
  RotateCw,
  FlipHorizontal2,
  FlipVertical2,
  Plus,
  Trash2,
} from "lucide-react";
import {
  defaultDevelopSettings,
  DEVELOP_HSL_CHANNELS,
  type DevelopSettings,
  type DevelopMask,
} from "@/lib/develop/contract";
import { ColorGrading } from "./ColorGrading";
import { curveDisplayPath } from "@/lib/develop/curve-interpolation";
import {
  currentUprightSolution,
  defaultDevelopGeometry,
  UPRIGHT_MAX_GUIDES,
  type DevelopGeometry,
  type UprightMode,
} from "@/lib/develop/upright";

export type DevelopChange = (settings: DevelopSettings, label: string, commit?: boolean) => void;
export type DevelopTool = "edit" | "crop" | "mask" | "guided";
export function Panel({
  title,
  children,
  open = false,
  disabled = false,
  id,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <details className="develop-panel" id={id} open={open || undefined}>
      <summary>
        {title}
        <ChevronDown size={12} />
      </summary>
      <div className="develop-panel-body">
        {disabled ? (
          <>
            <p className="develop-hint">Requires the local C++ Develop engine.</p>
            <fieldset disabled>{children}</fieldset>
          </>
        ) : (
          children
        )}
      </div>
    </details>
  );
}

export function DevelopSlider({
  label,
  displayLabel,
  help,
  value,
  min = -100,
  max = 100,
  step = 1,
  reset = 0,
  disabled = false,
  id,
  onChange,
}: {
  label: string;
  displayLabel?: string;
  help?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  reset?: number;
  disabled?: boolean;
  id?: string;
  onChange: (value: number, commit: boolean) => void;
}) {
  const last = useRef(value);
  // True while a live preview from this slider still awaits its commit. Gate on that, never on
  // the last committed number: undo, presets and photo/channel/mask switches put a different
  // value under this same instance, so an equal number can still be an unsaved edit.
  const uncommitted = useRef(false);
  last.current = value;

  const handleCommit = useCallback(() => {
    if (disabled || !uncommitted.current) return;
    uncommitted.current = false;
    onChange(last.current, true);
  }, [disabled, onChange]);

  return (
    <div className="develop-slider" id={id}>
      <label
        onDoubleClick={(event) => {
          if (!disabled && !event.currentTarget.closest("fieldset:disabled")) {
            last.current = reset;
            uncommitted.current = false;
            onChange(reset, true);
          }
        }}
        title={help ? `${help} Double-click to reset.` : "Double-click to reset"}
      >
        {displayLabel ?? label}
      </label>
      <input
        type="range"
        disabled={disabled}
        aria-label={label}
        title={help}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          if (disabled) return;
          const newValue = Number(e.target.value);
          if (newValue !== last.current) {
            last.current = newValue;
            uncommitted.current = true;
            onChange(newValue, false);
          }
        }}
        onPointerUp={handleCommit}
        onKeyUp={handleCommit}
        onBlur={handleCommit}
      />
      <input
        type="number"
        disabled={disabled}
        aria-label={`${label} value`}
        title={help}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          if (disabled) return;
          const v = Number(e.target.value);
          if (Number.isFinite(v)) {
            const newValue = Math.min(max, Math.max(min, v));
            if (newValue !== last.current) {
              last.current = newValue;
              uncommitted.current = true;
              onChange(newValue, false);
            }
          }
        }}
        onBlur={handleCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

type CurveChannel = "master" | "red" | "green" | "blue";
const curveChannels: { id: CurveChannel; label: string; short: string; color: string }[] = [
  { id: "master", label: "Master", short: "Master", color: "#d4d4d4" },
  { id: "red", label: "Red", short: "R", color: "#e28686" },
  { id: "green", label: "Green", short: "G", color: "#98c293" },
  { id: "blue", label: "Blue", short: "B", color: "#8caee1" },
];

export function ToneCurve({ value, change }: { value: DevelopSettings; change: DevelopChange }) {
  const [channel, setChannel] = useState<CurveChannel>("master");
  type CurveDrag = {
    index: number;
    channel: CurveChannel;
    pointer: number;
    target: SVGSVGElement;
    base: DevelopSettings;
    baseKey: string;
    expected: string;
    startX: number;
    startY: number;
    moved: boolean;
  };
  const drag = useRef<CurveDrag | null>(null);
  const current = useRef(value);
  const publish = useRef(change);
  const mounted = useRef(true);
  current.current = value;
  publish.current = change;
  const recipeKey = useMemo(() => JSON.stringify(value), [value]);
  const discardDrag = useCallback(() => {
    const gesture = drag.current;
    drag.current = null;
    if (gesture) {
      try {
        if (gesture.target.hasPointerCapture(gesture.pointer))
          gesture.target.releasePointerCapture(gesture.pointer);
      } catch {
        // The photo or SVG may already have unmounted; its recipe must stay untouched.
      }
    }
  }, []);
  useLayoutEffect(() => {
    if (drag.current && drag.current.expected !== recipeKey) discardDrag();
  }, [recipeKey, discardDrag]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      discardDrag();
    };
  }, [discardDrag]);
  const selectedChannel = curveChannels.find((c) => c.id === channel)!;
  const points = getCurve(value, channel);
  const displayPath = useMemo(
    () => curveDisplayPath(points, value.curveInterpolation),
    [points, value.curveInterpolation],
  );
  const curveLabel = channel === "master" ? "Tone curve" : `${selectedChannel.label} tone curve`;
  const pointLabel = channel === "master" ? "Curve" : `${selectedChannel.label} curve`;
  function getCurve(settings: DevelopSettings, active: CurveChannel) {
    return active === "master"
      ? settings.curve
      : (settings.channelCurves?.[active] ?? defaultDevelopSettings().curve);
  }
  function editCurve(
    curve: DevelopSettings["curve"],
    label: string,
    commit = true,
    active = channel,
    owner?: CurveDrag,
  ) {
    if (!mounted.current) return;
    if (owner) {
      if (!ownsDrag(owner)) return;
    } else discardDrag(); // Explicit point edits/reset supersede a pointer transaction.
    const settings = current.current;
    current.current =
      active === "master"
        ? { ...settings, curve }
        : {
            ...settings,
            channelCurves: {
              ...defaultDevelopSettings().channelCurves,
              ...settings.channelCurves,
              [active]: curve,
            },
          };
    if (owner) owner.expected = JSON.stringify(current.current);
    publish.current(current.current, label, commit);
  }
  function ownsDrag(gesture: CurveDrag) {
    if (
      mounted.current &&
      drag.current === gesture &&
      !gesture.target.closest("fieldset:disabled") &&
      gesture.expected === JSON.stringify(current.current)
    )
      return true;
    discardDrag();
    return false;
  }
  function finishDrag(cancel = false, event?: React.PointerEvent<SVGSVGElement>) {
    const gesture = drag.current;
    if (!gesture || (event && gesture.pointer !== event.pointerId) || !ownsDrag(gesture)) return;
    if (!cancel && event) moveDrag(event); // Preserve the exact release point, even without a final move.
    if (!ownsDrag(gesture)) return;
    discardDrag();
    if (gesture.expected === gesture.baseKey) return;
    if (cancel) current.current = gesture.base;
    publish.current(
      current.current,
      gesture.channel === "master"
        ? "Tone curve"
        : `${curveChannels.find((c) => c.id === gesture.channel)!.label} tone curve`,
      !cancel,
    );
  }
  function point(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (
      ![e.clientX, e.clientY, rect.left, rect.top, rect.width, rect.height].every(
        Number.isFinite,
      ) ||
      rect.width <= 0 ||
      rect.height <= 0
    )
      return null;
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)),
    };
  }
  function moveDrag(e: React.PointerEvent<SVGSVGElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.pointer !== e.pointerId || !ownsDrag(gesture)) return;
    const p = point(e);
    if (!p) return;
    if (!gesture.moved && e.clientX === gesture.startX && e.clientY === gesture.startY) return;
    gesture.moved = true;
    const { index: i, channel: active } = gesture;
    const curve = getCurve(current.current, active).map((v) => ({ ...v }));
    if (!curve[i]) {
      discardDrag();
      return;
    }
    p.x =
      i === 0
        ? 0
        : i === curve.length - 1
          ? 1
          : Math.max(curve[i - 1]!.x + 0.005, Math.min(curve[i + 1]!.x - 0.005, p.x));
    if (curve[i]!.x === p.x && curve[i]!.y === p.y) return;
    curve[i] = p;
    editCurve(
      curve,
      active === "master"
        ? "Tone curve"
        : `${curveChannels.find((c) => c.id === active)!.label} tone curve`,
      false,
      active,
      gesture,
    );
  }
  return (
    <>
      <div className="develop-curve-channels" role="group" aria-label="Tone curve channel">
        {curveChannels.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-label={`${c.label} tone curve`}
            aria-pressed={channel === c.id}
            title={
              c.id === "master" ? "Master curve · all RGB channels" : `${c.label} channel curve`
            }
            style={{ color: c.color }}
            onClick={() => {
              finishDrag(false);
              setChannel(c.id);
            }}
          >
            {c.short}
          </button>
        ))}
      </div>
      <label className="develop-inline">
        <span>Interpolation</span>
        <select
          aria-label="Curve interpolation"
          title="Linear segments or a smooth shape-preserving curve. Applies to Master and RGB."
          value={value.curveInterpolation}
          onChange={(event) => {
            const mode = event.target.value;
            if (
              !mounted.current ||
              event.currentTarget.closest("fieldset:disabled") ||
              (mode !== "linear" && mode !== "smooth") ||
              mode === current.current.curveInterpolation
            )
              return;
            finishDrag(true);
            current.current = { ...current.current, curveInterpolation: mode };
            publish.current(
              current.current,
              `Curve interpolation · ${mode === "smooth" ? "Smooth" : "Linear"}`,
              true,
            );
          }}
        >
          <option value="linear">Linear</option>
          <option value="smooth">Smooth</option>
        </select>
      </label>
      <svg
        id="tone-curve"
        className="develop-curve"
        data-channel={channel}
        data-interpolation={value.curveInterpolation}
        style={{ color: selectedChannel.color }}
        viewBox="0 0 200 200"
        role="img"
        aria-label={`${selectedChannel.label} tone curve. Drag points or use the point controls below.`}
        onPointerDown={(e) => {
          if (
            !mounted.current ||
            drag.current ||
            e.button !== 0 ||
            e.currentTarget.closest("fieldset:disabled")
          )
            return;
          e.preventDefault();
          const p = point(e);
          if (!p) return;
          const curve = getCurve(current.current, channel);
          const near = curve.findIndex((v) => Math.hypot(v.x - p.x, v.y - p.y) < 0.065);
          const base = structuredClone(current.current);
          const baseKey = JSON.stringify(base);
          const gesture: CurveDrag = {
            index: near,
            channel,
            pointer: e.pointerId,
            target: e.currentTarget,
            base,
            baseKey,
            expected: baseKey,
            startX: e.clientX,
            startY: e.clientY,
            moved: false,
          };
          if (near >= 0) drag.current = gesture;
          else if (
            curve.length < 16 &&
            p.x > 0.015 &&
            p.x < 0.985 &&
            !curve.some((v) => Math.abs(v.x - p.x) < 0.015)
          ) {
            const next = [...curve, p].sort((a, b) => a.x - b.x);
            gesture.index = next.indexOf(p);
            drag.current = gesture;
            editCurve(next, curveLabel, false, channel, gesture);
          }
          if (drag.current) {
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // Untrusted pointers still receive moves on this SVG.
            }
          }
        }}
        onPointerMove={moveDrag}
        onPointerUp={(event) => finishDrag(false, event)}
        onPointerCancel={(event) => finishDrag(true, event)}
        onLostPointerCapture={(event) => finishDrag(true, event)}
      >
        {[50, 100, 150].map((n) => (
          <path key={n} d={`M${n} 0V200 M0 ${n}H200`} className="curve-grid" />
        ))}
        <path d="M0 200L200 0" className="curve-diagonal" />
        <path
          className="curve-function"
          d={displayPath}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        {points.map((p, i) => (
          <circle
            key={i}
            id={`curve-point-${i}`}
            cx={p.x * 200}
            cy={(1 - p.y) * 200}
            r="3.3"
          />
        ))}
      </svg>
      <div className="develop-inline">
        <span>Point curve · {channel === "master" ? "RGB" : selectedChannel.label}</span>
        <button
          aria-label={`Add ${channel === "master" ? "master" : channel} curve point`}
          disabled={points.length >= 16}
          onClick={() => {
            const curve = getCurve(current.current, channel);
            let widest = 0;
            for (let i = 1; i < curve.length - 1; i++)
              if (curve[i + 1]!.x - curve[i]!.x > curve[widest + 1]!.x - curve[widest]!.x)
                widest = i;
            const left = curve[widest]!,
              right = curve[widest + 1]!;
            editCurve(
              [
                ...curve.slice(0, widest + 1),
                { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 },
                ...curve.slice(widest + 1),
              ],
              `Add ${channel === "master" ? "master" : channel} curve point`,
            );
          }}
        >
          Add point
        </button>
        <button
          aria-label={`Reset ${channel} curve to linear`}
          onClick={() =>
            editCurve(
              defaultDevelopSettings().curve,
              channel === "master" ? "Reset curve" : `Reset ${channel} curve`,
            )
          }
        >
          Linear
        </button>
      </div>
      <div className="develop-curve-points">
        {points.map((p, i) => (
          <div key={i}>
            <label>
              Point {i + 1}
              <input
                aria-label={`${pointLabel} point ${i + 1} output`}
                type="number"
                min="0"
                max="100"
                value={Math.round(p.y * 100)}
                onChange={(e) => {
                  const output = Number(e.target.value);
                  if (!Number.isFinite(output)) return;
                  editCurve(
                    getCurve(current.current, channel).map((v, j) =>
                      j === i ? { ...v, y: Math.max(0, Math.min(100, output)) / 100 } : v,
                    ),
                    curveLabel,
                    false,
                  );
                }}
                onBlur={() => {
                  if (mounted.current) publish.current(current.current, curveLabel, true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </label>
            {i > 0 && i < points.length - 1 && (
              <button
                aria-label={`Remove ${channel === "master" ? "curve" : `${channel} curve`} point ${i + 1}`}
                onClick={() =>
                  editCurve(
                    getCurve(current.current, channel).filter((_, j) => i !== j),
                    channel === "master" ? "Remove curve point" : `Remove ${channel} curve point`,
                  )
                }
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

export function DevelopControls({
  value,
  change,
  photoId,
  tool,
  onTool,
  maskId,
  onMask,
  sourceAspect = 1.5,
  onSuggestCrop,
  browserOnly = false,
  uprightSolving = false,
}: {
  value: DevelopSettings;
  change: DevelopChange;
  photoId?: string;
  tool: DevelopTool;
  onTool: (tool: DevelopTool) => void;
  maskId: string | null;
  onMask: (id: string | null) => void;
  sourceAspect?: number;
  onSuggestCrop?: () => void;
  browserOnly?: boolean;
  /** True while the C++ engine is measuring this photo's lines. */
  uprightSolving?: boolean;
}) {
  const [hslIndex, setHslIndex] = useState(0);
  
  // Reset HSL index when photo changes to avoid state sync issues
  useEffect(() => {
    setHslIndex(0);
  }, [photoId]);
  
  // Validate mask selection - clear if mask no longer exists
  useEffect(() => {
    if (maskId && !value.masks.find(m => m.id === maskId)) {
      onMask(null);
    }
  }, [maskId, value.masks, onMask]);
  
  const defaults = defaultDevelopSettings();
  const scalar = (
    key: keyof DevelopSettings,
    label: string,
    min = -100,
    max = 100,
    step = 1,
    options: { displayLabel?: string; help?: string; disabled?: boolean } = {},
  ) => (
    <DevelopSlider
      key={key}
      id={`slider-${key === "temperature" ? "temp" : String(key)}`}
      label={label}
      {...options}
      value={(value[key] ?? defaults[key]) as number}
      min={min}
      max={max}
      step={step}
      reset={defaults[key] as number}
      onChange={(n, c) => change({ ...value, [key]: n }, label, c)}
    />
  );
  
  const parametric = value.parametricCurve ?? defaults.parametricCurve;
  const parametricScalar = (
    childKey: "highlights" | "lights" | "darks" | "shadows",
    label: string,
    min = -100,
    max = 100,
    step = 1,
    options: { displayLabel?: string; help?: string; disabled?: boolean } = {},
  ) => (
    <DevelopSlider
      key={`parametric.${childKey}`}
      id={`slider-parametric-${childKey}`}
      label={label}
      {...options}
      value={parametric[childKey]}
      min={min}
      max={max}
      step={step}
      reset={0}
      onChange={(n, c) => {
        change(
          {
            ...value,
            parametricCurve: { ...parametric, [childKey]: n },
          },
          label,
          c,
        );
      }}
    />
  );

  const lensScalar = (
    section: "chromaticAberration" | "vignetteCorrection" | "transform",
    childKey: string,
    label: string,
    min = -100,
    max = 100,
    step = 1,
    options: { displayLabel?: string; help?: string; disabled?: boolean; reset?: number } = {},
  ) => {
    const sectionValue = value.lensCorrection[section] as Record<string, unknown>;
    const currentValue = typeof sectionValue?.[childKey] === "number" ? sectionValue[childKey] : 0;
    return (
      <DevelopSlider
        key={`lens.${section}.${childKey}`}
        id={`slider-lens-${section}-${childKey}`}
        label={label}
        {...options}
        value={currentValue as number}
        min={min}
        max={max}
        step={step}
        reset={options.reset ?? 0}
        onChange={(n, c) => {
          change(
            {
              ...value,
              lensCorrection: {
                ...value.lensCorrection,
                [section]: { ...value.lensCorrection[section], [childKey]: n },
              },
            },
            label,
            c,
          );
        }}
      />
    );
  };
  const geometry = value.geometry ?? defaultDevelopGeometry();
  const setGeometry = (patch: Partial<DevelopGeometry>, label: string, commit = true) =>
    change({ ...value, geometry: { ...geometry, ...patch } }, label, commit);
  const geometryScalar = (
    key: "vertical" | "horizontal" | "rotate" | "aspect" | "scale" | "xOffset" | "yOffset",
    label: string,
    min: number,
    max: number,
    step: number,
    reset = 0,
  ) => (
    <DevelopSlider
      key={key}
      id={`slider-geometry-${key}`}
      label={label}
      value={geometry[key]}
      min={min}
      max={max}
      step={step}
      reset={reset}
      onChange={(n, c) => setGeometry({ [key]: n }, label, c)}
    />
  );
  // Said only when the answer differs from what was asked for, so the
  // photographer is not left wondering why Full looks like Level.
  const uprightStatus = (() => {
    if (geometry.upright === "off") return "";
    if (uprightSolving) return "Measuring…";
    const solution = currentUprightSolution(geometry);
    if (!solution) return "";
    const named: Record<UprightMode, string> = {
      off: "no correction",
      auto: "Auto",
      level: "Level",
      vertical: "Vertical",
      full: "Full",
      guided: "Guided",
    };
    if (solution.applied === "off") return "Not enough straight lines to measure.";
    if (solution.fallback) return `Too few straight lines: applied ${named[solution.applied]}.`;
    if (solution.confidence < 0.5) return `${named[solution.applied]}, from weak evidence.`;
    return "";
  })();
  const crop = value.crop;
  const cropAspect = (sourceAspect * crop.width) / crop.height;
  const aspects = [
    { id: "original", label: "Original", ratio: sourceAspect },
    { id: "1:1", label: "1 × 1", ratio: 1 },
    { id: "4:5", label: "4 × 5", ratio: 4 / 5 },
    { id: "3:2", label: "3 × 2", ratio: 3 / 2 },
    { id: "16:9", label: "16 × 9", ratio: 16 / 9 },
  ];
  const currentAspect = aspects.find((a) => Math.abs(a.ratio - cropAspect) < 0.001)?.id ?? "custom";
  const setCrop = (patch: Partial<typeof crop>, label: string, c = true) =>
    change({ ...value, crop: { ...crop, ...patch } }, label, c);
  const mask = value.masks.find((m) => m.id === maskId) ?? value.masks[0];
  function updateMask(patch: Partial<DevelopMask>, label: string, commit = true) {
    if (mask)
      change(
        { ...value, masks: value.masks.map((m) => (m.id === mask.id ? { ...m, ...patch } : m)) },
        label,
        commit,
      );
  }
  function addMask(type: "linear" | "radial") {
    const m: DevelopMask = {
      id: crypto.randomUUID(),
      name: type === "linear" ? "Linear gradient" : "Radial gradient",
      type,
      enabled: true,
      x: 0.5,
      y: 0.5,
      radius: 0.3,
      aspect: 1,
      angle: 0,
      feather: 0.75,
      invert: false,
      exposure: 0,
      temperature: 0,
      saturation: 0,
    };
    change({ ...value, masks: [...value.masks, m] }, "Add mask");
    onMask(m.id);
    onTool("mask");
  }
  return (
    <div className="develop-adjustments">
      <Panel title="Basic" id="panel-basic" open>
        <div className="develop-inline">
          <span>Treatment</span>
          <button
            aria-pressed={value.saturation === -100}
            onClick={() =>
              change(
                { ...value, saturation: value.saturation === -100 ? 0 : -100 },
                "Black & white",
              )
            }
          >
            {value.saturation === -100 ? "Black & white" : "Color"}
          </button>
        </div>
        <p className="develop-control-heading">White balance</p>
        {scalar("temperature", "Temp")}
        {scalar("tint", "Tint")}
        <p className="develop-control-heading">Tone</p>
        {scalar("exposure", "Exposure", -5, 5, 0.05)}
        {scalar("contrast", "Contrast")}
        {scalar("highlights", "Highlights")}
        {scalar("shadows", "Shadows")}
        {scalar("whites", "Whites")}
        {scalar("blacks", "Blacks")}
        <p className="develop-control-heading">Presence</p>
        {scalar("texture", "Texture", -100, 100, 1, {
          disabled: browserOnly,
          ...(browserOnly ? { help: "Requires the local C++ Develop engine." } : {}),
        })}
        {scalar("clarity", "Clarity", -100, 100, 1, {
          disabled: browserOnly,
          ...(browserOnly ? { help: "Requires the local C++ Develop engine." } : {}),
        })}
        {scalar("dehaze", "Dehaze")}
        {scalar("vibrance", "Vibrance")}
        {scalar("saturation", "Saturation")}
      </Panel>
      <Panel title="Tone Curve" id="panel-curve" disabled={browserOnly}>
        <div className="develop-parametric-controls">
          <p className="develop-control-heading">Parametric</p>
          {parametricScalar("highlights", "Parametric Highlights")}
          {parametricScalar("lights", "Parametric Lights")}
          {parametricScalar("darks", "Parametric Darks")}
          {parametricScalar("shadows", "Parametric Shadows")}
        </div>
        <ToneCurve key={photoId} value={value} change={change} />
      </Panel>
      <Panel title="Color Mixer" id="panel-mixer" disabled={browserOnly}>
        <div className="develop-colors" role="group" aria-label="Color range">
          {DEVELOP_HSL_CHANNELS.map((name, i) => (
            <button
              key={name}
              id={`hsl-${name.toLowerCase()}`}
              aria-label={name}
              aria-pressed={i === hslIndex}
              title={name}
              style={{
                background: [
                  "#df6464",
                  "#d68e58",
                  "#d3bd65",
                  "#75a76b",
                  "#67b4b6",
                  "#6287cb",
                  "#9b7ac7",
                  "#bc7bb2",
                ][i],
              }}
              onClick={() => setHslIndex(i)}
            />
          ))}
        </div>
        <p className="develop-control-heading">{DEVELOP_HSL_CHANNELS[hslIndex]}</p>
        {(["hue", "saturation", "luminance"] as const).map((key) => (
          <DevelopSlider
            key={key}
            id={`hsl-${DEVELOP_HSL_CHANNELS[hslIndex]!.toLowerCase()}-${key === "saturation" ? "sat" : key}`}
            label={key[0]!.toUpperCase() + key.slice(1)}
            value={value.hsl[hslIndex]![key]}
            onChange={(n, c) =>
              change(
                {
                  ...value,
                  hsl: value.hsl.map((v, i) => (i === hslIndex ? { ...v, [key]: n } : v)),
                },
                `${DEVELOP_HSL_CHANNELS[hslIndex]} ${key}`,
                c,
              )
            }
          />
        ))}
      </Panel>
      <Panel title="Color Grading" id="panel-grading" disabled={browserOnly}>
        <ColorGrading key={photoId} value={value} change={change} Slider={DevelopSlider} />
      </Panel>
      <Panel title="Effects" id="panel-effects" disabled={browserOnly}>
        {scalar("grain", "Grain", 0)}
        {scalar("grainSize", "Grain size", 0.5, 4, 0.1)}
        {scalar("grainLuminance", "Grain luminance", 0)}
        {scalar("halation", "Halation", 0)}
        {scalar("bloom", "Bloom", 0)}
        {scalar("fade", "Fade", 0)}
        {scalar("vignette", "Vignette")}
        {scalar("filmFalloff", "Film falloff", 0)}
      </Panel>
      <Panel title="Detail" id="panel-detail" disabled={browserOnly}>
        {scalar("sharpening", "Sharpening", 0)}
        {scalar("sharpeningRadius", "Sharpening radius", 0.5, 3, 0.1, {
          displayLabel: "Radius",
          help: "Controls the scale of sharpened edges in rendered pixels.",
        })}
        {scalar("sharpeningDetail", "Sharpening fine detail", 0, 100, 1, {
          displayLabel: "Fine detail",
          help: "Lower values suppress weak detail; higher values retain finer texture.",
        })}
        {scalar("sharpeningMasking", "Sharpening edge masking", 0, 100, 1, {
          displayLabel: "Edge masking",
          help: "Protects flatter areas by restricting sharpening to stronger edges.",
        })}
        {scalar("noiseReduction", "Luminance noise", 0)}
        {scalar("colorNoiseReduction", "Color noise", 0)}
        <p className="develop-hint">Inspect at 100% for fine detail.</p>
      </Panel>
      <Panel title="Crop & Straighten" id="panel-crop" open={tool === "crop"}>
        {onSuggestCrop && (
          <button onClick={onSuggestCrop} disabled={browserOnly}>
            Automatic crop…
          </button>
        )}
        <div className="develop-inline">
          <button
            aria-pressed={tool === "crop"}
            onClick={() => onTool(tool === "crop" ? "edit" : "crop")}
          >
            {tool === "crop" ? "Done cropping" : "Edit crop"}
          </button>
          <button onClick={() => setCrop(defaults.crop, "Reset crop")}>Reset</button>
        </div>
        <div className="develop-inline">
          <span>Aspect</span>
          <select
            aria-label="Crop aspect"
            value={currentAspect}
            onChange={(e) => {
              const ratio = aspects.find((a) => a.id === e.target.value)?.ratio;
              if (!ratio) return;
              const w = Math.min(1, ratio / sourceAspect),
                h = Math.min(1, sourceAspect / ratio);
              setCrop({ width: w, height: h, x: (1 - w) / 2, y: (1 - h) / 2 }, "Crop aspect");
            }}
          >
            <option value="custom" disabled>
              Custom
            </option>
            {aspects.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <DevelopSlider
          id="slider-straighten"
          label="Straighten"
          disabled={browserOnly}
          {...(browserOnly ? { help: "Requires the local C++ Develop engine." } : {})}
          value={crop.angle}
          min={-45}
          max={45}
          step={0.1}
          onChange={(n, c) => setCrop({ angle: n }, "Straighten", c)}
        />
        <div className="develop-button-row">
          <button
            title="Rotate counterclockwise"
            aria-label="Rotate counterclockwise"
            onClick={() =>
              setCrop({ rotate: ((crop.rotate + 270) % 360) as 0 | 90 | 180 | 270 }, "Rotate left")
            }
          >
            <RotateCcw size={15} />
          </button>
          <button
            title="Rotate clockwise"
            aria-label="Rotate clockwise"
            onClick={() =>
              setCrop({ rotate: ((crop.rotate + 90) % 360) as 0 | 90 | 180 | 270 }, "Rotate right")
            }
          >
            <RotateCw size={15} />
          </button>
          <button
            aria-label="Flip horizontal"
            aria-pressed={crop.flipX}
            onClick={() => setCrop({ flipX: !crop.flipX }, "Flip horizontal")}
          >
            <FlipHorizontal2 size={15} />
          </button>
          <button
            aria-label="Flip vertical"
            aria-pressed={crop.flipY}
            onClick={() => setCrop({ flipY: !crop.flipY }, "Flip vertical")}
          >
            <FlipVertical2 size={15} />
          </button>
        </div>
        {(["x", "y", "width", "height"] as const).map((key) => (
          <DevelopSlider
            key={key}
            label={`Crop ${key}`}
            value={Math.round(crop[key] * 100)}
            min={key === "width" || key === "height" ? 1 : 0}
            max={100}
            reset={defaults.crop[key] * 100}
            onChange={(n, c) => {
              const v = n / 100;
              const patch =
                key === "x"
                  ? { x: Math.min(v, 1 - crop.width) }
                  : key === "y"
                    ? { y: Math.min(v, 1 - crop.height) }
                    : key === "width"
                      ? { width: Math.min(v, 1 - crop.x) }
                      : { height: Math.min(v, 1 - crop.y) };
              setCrop(patch, `Crop ${key}`, c);
            }}
          />
        ))}
      </Panel>
      <Panel title="Geometry" id="panel-geometry" open={tool === "guided"} disabled={browserOnly}>
        <div className="develop-upright-modes">
          {(
            [
              ["off", "Off"],
              ["auto", "Auto"],
              ["level", "Level"],
              ["vertical", "Vertical"],
              ["full", "Full"],
              ["guided", "Guided"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              aria-pressed={geometry.upright === mode}
              onClick={() => {
                setGeometry(
                  {
                    upright: mode,
                    // A solve belongs to one mode; keep guides, drop the old answer.
                    solved: mode === geometry.upright ? geometry.solved : null,
                  },
                  `Upright ${label}`,
                );
                if (mode === "guided") onTool("guided");
                else if (tool === "guided") onTool("edit");
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {geometry.upright === "guided" && (
          <>
            <div className="develop-inline">
              <button
                aria-pressed={tool === "guided"}
                disabled={geometry.guides.length >= UPRIGHT_MAX_GUIDES && tool !== "guided"}
                onClick={() => onTool(tool === "guided" ? "edit" : "guided")}
              >
                {tool === "guided" ? "Done drawing" : "Draw guides"}
              </button>
              <button
                disabled={!geometry.guides.length}
                onClick={() => setGeometry({ guides: [], solved: null }, "Clear guides")}
              >
                Clear
              </button>
            </div>
            <p className="develop-hint">{`${geometry.guides.length} of ${UPRIGHT_MAX_GUIDES} guides`}</p>
          </>
        )}
        {uprightStatus && (
          <p className="develop-hint" role="status">
            {uprightStatus}
          </p>
        )}
        {geometryScalar("vertical", "Vertical", -100, 100, 1)}
        {geometryScalar("horizontal", "Horizontal", -100, 100, 1)}
        {geometryScalar("rotate", "Rotate", -10, 10, 0.1)}
        {geometryScalar("aspect", "Aspect", -100, 100, 1)}
        {geometryScalar("scale", "Scale", 50, 150, 1, 100)}
        {geometryScalar("xOffset", "X offset", -100, 100, 1)}
        {geometryScalar("yOffset", "Y offset", -100, 100, 1)}
        <div className="develop-inline">
          <label>
            <input
              type="checkbox"
              checked={geometry.constrainCrop}
              onChange={(e) => setGeometry({ constrainCrop: e.target.checked }, "Constrain crop")}
            />
            Constrain crop
          </label>
          <button
            onClick={() => {
              setGeometry(defaultDevelopGeometry(), "Reset geometry");
              if (tool === "guided") onTool("edit");
            }}
          >
            Reset
          </button>
        </div>
      </Panel>
      <Panel title="Lens Correction" id="panel-lens" disabled={browserOnly}>
        <div className="develop-inline">
          <span>Enable</span>
          <label>
            <input
              type="checkbox"
              checked={value.lensCorrection.enabled}
              onChange={(e) => change({ 
                ...value, 
                lensCorrection: { ...value.lensCorrection, enabled: e.target.checked } 
              }, "Enable lens correction")}
            />
            Lens correction
          </label>
        </div>
        <div className="develop-inline">
          <span>Profile</span>
          <select
            aria-label="Lens profile"
            value={value.lensCorrection.profile}
            onChange={(e) => change({ 
              ...value, 
              lensCorrection: { ...value.lensCorrection, profile: e.target.value as any } 
            }, "Lens profile")}
          >
            <option value="none">None</option>
            <option value="auto">Auto</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <p className="develop-control-heading">Chromatic Aberration</p>
        <div className="develop-inline">
          <span>Enable</span>
          <label>
            <input
              type="checkbox"
              checked={value.lensCorrection.chromaticAberration.enabled}
              onChange={(e) => change({ 
                ...value, 
                lensCorrection: { 
                  ...value.lensCorrection, 
                  chromaticAberration: { ...value.lensCorrection.chromaticAberration, enabled: e.target.checked } 
                } 
              }, "Enable chromatic aberration")}
            />
            Chromatic aberration
          </label>
        </div>
        {lensScalar("chromaticAberration", "amount", "Amount", 0, 100, 1, {
          help: "Amount of chromatic aberration correction",
          reset: 50,
          disabled: !value.lensCorrection.chromaticAberration.enabled
        })}
        <p className="develop-control-heading">Vignette Correction</p>
        <div className="develop-inline">
          <span>Enable</span>
          <label>
            <input
              type="checkbox"
              checked={value.lensCorrection.vignetteCorrection.enabled}
              onChange={(e) => change({ 
                ...value, 
                lensCorrection: { 
                  ...value.lensCorrection, 
                  vignetteCorrection: { ...value.lensCorrection.vignetteCorrection, enabled: e.target.checked } 
                } 
              }, "Enable vignette correction")}
            />
            Vignette correction
          </label>
        </div>
        {lensScalar("vignetteCorrection", "amount", "Amount", -100, 100, 1, {
          help: "Amount of vignette correction",
          disabled: !value.lensCorrection.vignetteCorrection.enabled
        })}
      </Panel>
      <Panel title="Masking" id="panel-masks" open={tool === "mask"} disabled={browserOnly}>
        <div className="develop-button-row">
          <button disabled={value.masks.length >= 12} onClick={() => addMask("linear")}>
            <Plus size={12} />
            Linear
          </button>
          <button disabled={value.masks.length >= 12} onClick={() => addMask("radial")}>
            <Plus size={12} />
            Radial
          </button>
        </div>
        {value.masks.map((m) => (
          <div className="develop-mask-item" key={m.id}>
            <button
              aria-pressed={m.id === mask?.id}
              onClick={() => {
                onMask(m.id);
                onTool("mask");
              }}
            >
              {m.name}
            </button>
            <button
              aria-label={`Delete ${m.name}`}
              onClick={() => {
                change(
                  { ...value, masks: value.masks.filter((v) => v.id !== m.id) },
                  "Delete mask",
                );
                if (maskId === m.id) onMask(null);
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        {mask && (
          <>
            <div className="develop-inline">
              <label>
                <input
                  type="checkbox"
                  checked={mask.enabled}
                  onChange={(e) => updateMask({ enabled: e.target.checked }, "Toggle mask")}
                />
                Enabled
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={mask.invert}
                  onChange={(e) => updateMask({ invert: e.target.checked }, "Invert mask")}
                />
                Invert
              </label>
            </div>
            <DevelopSlider
              id="slider-mask-exposure"
              label="Mask exposure"
              value={mask.exposure}
              min={-5}
              max={5}
              step={0.05}
              onChange={(n, c) => updateMask({ exposure: n }, "Mask exposure", c)}
            />
            <DevelopSlider
              id="slider-mask-temp"
              label="Mask temp"
              value={mask.temperature}
              onChange={(n, c) => updateMask({ temperature: n }, "Mask temperature", c)}
            />
            <DevelopSlider
              id="slider-mask-saturation"
              label="Mask saturation"
              value={mask.saturation}
              onChange={(n, c) => updateMask({ saturation: n }, "Mask saturation", c)}
            />
            <DevelopSlider
              label="Feather"
              value={Math.round(mask.feather * 100)}
              min={0}
              reset={75}
              onChange={(n, c) => updateMask({ feather: n / 100 }, "Mask feather", c)}
            />
            <DevelopSlider
              label="Radius"
              value={Math.round(mask.radius * 100)}
              min={1}
              max={200}
              reset={30}
              onChange={(n, c) => updateMask({ radius: n / 100 }, "Mask radius", c)}
            />
            <DevelopSlider
              label="Mask angle"
              value={mask.angle}
              min={-180}
              max={180}
              onChange={(n, c) => updateMask({ angle: n }, "Mask angle", c)}
            />
            <button
              className="develop-wide"
              onClick={() => onTool(tool === "mask" ? "edit" : "mask")}
            >
              {tool === "mask" ? "Done masking" : "Position on photo"}
            </button>
          </>
        )}
      </Panel>
    </div>
  );
}
