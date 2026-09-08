import { useRef, useState, type ReactNode } from "react";
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

export type DevelopChange = (settings: DevelopSettings, label: string, commit?: boolean) => void;
export type DevelopTool = "edit" | "crop" | "mask";
export function Panel({
  title,
  children,
  open = false,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="develop-panel" open={open || undefined}>
      <summary>
        {title}
        <ChevronDown size={12} />
      </summary>
      <div className="develop-panel-body">{children}</div>
    </details>
  );
}

export function DevelopSlider({
  label,
  displayLabel,
  value,
  min = -100,
  max = 100,
  step = 1,
  reset = 0,
  onChange,
}: {
  label: string;
  displayLabel?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  reset?: number;
  onChange: (value: number, commit: boolean) => void;
}) {
  const last = useRef(value);
  last.current = value;
  return (
    <div className="develop-slider">
      <label onDoubleClick={() => onChange(reset, true)} title="Double-click to reset">
        {displayLabel ?? label}
      </label>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          last.current = Number(e.target.value);
          onChange(last.current, false);
        }}
        onPointerUp={() => onChange(last.current, true)}
        onKeyUp={() => onChange(last.current, true)}
        onBlur={() => onChange(last.current, true)}
      />
      <input
        type="number"
        aria-label={`${label} value`}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) {
            last.current = Math.min(max, Math.max(min, v));
            onChange(last.current, false);
          }
        }}
        onBlur={() => onChange(last.current, true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
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
  const drag = useRef<{ index: number; channel: CurveChannel } | null>(null);
  const current = useRef(value);
  current.current = value;
  const selectedChannel = curveChannels.find((c) => c.id === channel)!;
  const points = getCurve(value, channel);
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
  ) {
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
    change(current.current, label, commit);
  }
  function finishDrag() {
    const gesture = drag.current;
    if (!gesture) return;
    drag.current = null;
    change(
      current.current,
      gesture.channel === "master"
        ? "Tone curve"
        : `${curveChannels.find((c) => c.id === gesture.channel)!.label} tone curve`,
      true,
    );
  }
  function point(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)),
    };
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
              finishDrag();
              setChannel(c.id);
            }}
          >
            {c.short}
          </button>
        ))}
      </div>
      <svg
        className="develop-curve"
        data-channel={channel}
        style={{ color: selectedChannel.color }}
        viewBox="0 0 200 200"
        role="img"
        aria-label={`${selectedChannel.label} tone curve. Drag points or use the point controls below.`}
        onPointerDown={(e) => {
          if (e.button !== 0 || e.currentTarget.closest("fieldset:disabled")) return;
          e.preventDefault();
          const p = point(e);
          const curve = getCurve(current.current, channel);
          const near = curve.findIndex((v) => Math.hypot(v.x - p.x, v.y - p.y) < 0.065);
          if (near >= 0) drag.current = { index: near, channel };
          else if (
            curve.length < 16 &&
            p.x > 0.015 &&
            p.x < 0.985 &&
            !curve.some((v) => Math.abs(v.x - p.x) < 0.015)
          ) {
            const next = [...curve, p].sort((a, b) => a.x - b.x);
            drag.current = { index: next.indexOf(p), channel };
            editCurve(next, curveLabel, false);
          }
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current === null) return;
          const p = point(e),
            { index: i, channel: active } = drag.current,
            curve = getCurve(current.current, active).map((v) => ({ ...v }));
          p.x =
            i === 0
              ? 0
              : i === curve.length - 1
                ? 1
                : Math.max(curve[i - 1]!.x + 0.005, Math.min(curve[i + 1]!.x - 0.005, p.x));
          curve[i] = p;
          editCurve(
            curve,
            active === "master"
              ? "Tone curve"
              : `${curveChannels.find((c) => c.id === active)!.label} tone curve`,
            false,
            active,
          );
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={finishDrag}
      >
        {[50, 100, 150].map((n) => (
          <path key={n} d={`M${n} 0V200 M0 ${n}H200`} className="curve-grid" />
        ))}
        <path d="M0 200L200 0" className="curve-diagonal" />
        <polyline
          points={points.map((p) => `${p.x * 200},${(1 - p.y) * 200}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        {points.map((p, i) => (
          <circle key={i} cx={p.x * 200} cy={(1 - p.y) * 200} r="3.3" />
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
                onBlur={() => change(current.current, curveLabel, true)}
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
}) {
  const [hslIndex, setHslIndex] = useState(0);
  const defaults = defaultDevelopSettings();
  const scalar = (key: keyof DevelopSettings, label: string, min = -100, max = 100, step = 1) => (
    <DevelopSlider
      key={key}
      label={label}
      value={(value[key] ?? defaults[key]) as number}
      min={min}
      max={max}
      step={step}
      reset={defaults[key] as number}
      onChange={(n, c) => change({ ...value, [key]: n }, label, c)}
    />
  );
  const crop = value.crop;
  const cropAspect = (sourceAspect * crop.width) / crop.height;
  const aspects = [
    { id: "original", label: "Original", ratio: sourceAspect },
    { id: "1:1", label: "1 × 1", ratio: 1 },
    { id: "4:5", label: "4 × 5", ratio: 4 / 5 },
    { id: "3:2", label: "3 × 2", ratio: 3 / 2 },
    { id: "16:9", label: "16 × 9", ratio: 16 / 9 },
  ];
  const currentAspect = aspects.find((a) => Math.abs(a.ratio - cropAspect) < 0.015)?.id ?? "custom";
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
      <Panel title="Basic" open>
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
        {scalar("texture", "Texture")}
        {scalar("clarity", "Clarity")}
        {scalar("dehaze", "Dehaze")}
        {scalar("vibrance", "Vibrance")}
        {scalar("saturation", "Saturation")}
      </Panel>
      <Panel title="Tone Curve">
        <ToneCurve key={photoId} value={value} change={change} />
      </Panel>
      <Panel title="Color Mixer">
        <div className="develop-colors" role="group" aria-label="Color range">
          {DEVELOP_HSL_CHANNELS.map((name, i) => (
            <button
              key={name}
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
      <Panel title="Color Grading">
        <ColorGrading key={photoId} value={value} change={change} Slider={DevelopSlider} />
      </Panel>
      <Panel title="Effects">
        {scalar("grain", "Grain", 0)}
        {scalar("grainSize", "Grain size", 0.5, 4, 0.1)}
        {scalar("grainLuminance", "Grain luminance", 0)}
        {scalar("halation", "Halation", 0)}
        {scalar("bloom", "Bloom", 0)}
        {scalar("fade", "Fade", 0)}
        {scalar("vignette", "Vignette")}
        {scalar("filmFalloff", "Film falloff", 0)}
      </Panel>
      <Panel title="Detail">
        {scalar("sharpening", "Sharpening", 0)}
        {scalar("noiseReduction", "Luminance noise", 0)}
        {scalar("colorNoiseReduction", "Color noise", 0)}
        <p className="develop-hint">Inspect at 100% for fine detail.</p>
      </Panel>
      <Panel title="Crop & Straighten" open={tool === "crop"}>
        {onSuggestCrop && <button onClick={onSuggestCrop}>Automatic crop…</button>}
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
          label="Straighten"
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
      <Panel title="Masking" open={tool === "mask"}>
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
              label="Mask exposure"
              value={mask.exposure}
              min={-5}
              max={5}
              step={0.05}
              onChange={(n, c) => updateMask({ exposure: n }, "Mask exposure", c)}
            />
            <DevelopSlider
              label="Mask temp"
              value={mask.temperature}
              onChange={(n, c) => updateMask({ temperature: n }, "Mask temperature", c)}
            />
            <DevelopSlider
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
