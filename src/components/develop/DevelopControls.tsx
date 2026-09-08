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
  value,
  min = -100,
  max = 100,
  step = 1,
  reset = 0,
  onChange,
}: {
  label: string;
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
        {label}
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

export function ToneCurve({ value, change }: { value: DevelopSettings; change: DevelopChange }) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const current = useRef(value);
  current.current = value;
  function point(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)),
    };
  }
  return (
    <>
      <svg
        ref={svg}
        className="develop-curve"
        viewBox="0 0 200 200"
        role="img"
        aria-label="Tone curve. Drag points or click to add a point."
        onPointerDown={(e) => {
          const p = point(e);
          const near = current.current.curve.findIndex(
            (v) => Math.hypot(v.x - p.x, v.y - p.y) < 0.065,
          );
          if (near >= 0) drag.current = near;
          else if (
            current.current.curve.length < 16 &&
            p.x > 0.015 &&
            p.x < 0.985 &&
            !current.current.curve.some((v) => Math.abs(v.x - p.x) < 0.015)
          ) {
            const curve = [...current.current.curve, p].sort((a, b) => a.x - b.x);
            drag.current = curve.indexOf(p);
            current.current = { ...current.current, curve };
            change(current.current, "Tone curve", false);
          }
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current === null) return;
          const p = point(e),
            i = drag.current,
            curve = current.current.curve.map((v) => ({ ...v }));
          p.x =
            i === 0
              ? 0
              : i === curve.length - 1
                ? 1
                : Math.max(curve[i - 1]!.x + 0.005, Math.min(curve[i + 1]!.x - 0.005, p.x));
          curve[i] = p;
          current.current = { ...current.current, curve };
          change(current.current, "Tone curve", false);
        }}
        onPointerUp={() => {
          if (drag.current !== null) change(current.current, "Tone curve", true);
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
          change(current.current, "Tone curve", true);
        }}
      >
        {[50, 100, 150].map((n) => (
          <path key={n} d={`M${n} 0V200 M0 ${n}H200`} className="curve-grid" />
        ))}
        <path d="M0 200L200 0" className="curve-diagonal" />
        <polyline
          points={value.curve.map((p) => `${p.x * 200},${(1 - p.y) * 200}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        {value.curve.map((p, i) => (
          <circle key={i} cx={p.x * 200} cy={(1 - p.y) * 200} r="3.3" />
        ))}
      </svg>
      <div className="develop-inline">
        <span>Point curve · RGB</span>
        <button
          onClick={() => change({ ...value, curve: defaultDevelopSettings().curve }, "Reset curve")}
        >
          Linear
        </button>
      </div>
      <div className="develop-curve-points">
        {value.curve.map((p, i) => (
          <div key={i}>
            <label>
              Point {i + 1}
              <input
                aria-label={`Curve point ${i + 1} output`}
                type="number"
                min="0"
                max="100"
                value={Math.round(p.y * 100)}
                onChange={(e) =>
                  change(
                    {
                      ...value,
                      curve: value.curve.map((v, j) =>
                        j === i
                          ? { ...v, y: Math.max(0, Math.min(100, Number(e.target.value))) / 100 }
                          : v,
                      ),
                    },
                    "Tone curve",
                  )
                }
              />
            </label>
            {i > 0 && i < value.curve.length - 1 && (
              <button
                aria-label={`Remove curve point ${i + 1}`}
                onClick={() =>
                  change(
                    { ...value, curve: value.curve.filter((_, j) => i !== j) },
                    "Remove curve point",
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
  tool,
  onTool,
  maskId,
  onMask,
  sourceAspect = 1.5,
}: {
  value: DevelopSettings;
  change: DevelopChange;
  tool: DevelopTool;
  onTool: (tool: DevelopTool) => void;
  maskId: string | null;
  onMask: (id: string | null) => void;
  sourceAspect?: number;
}) {
  const [hslIndex, setHslIndex] = useState(0);
  const [grade, setGrade] = useState<"shadows" | "midtones" | "highlights">("midtones");
  const defaults = defaultDevelopSettings();
  const scalar = (key: keyof DevelopSettings, label: string, min = -100, max = 100, step = 1) => (
    <DevelopSlider
      key={key}
      label={label}
      value={value[key] as number}
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
        <ToneCurve value={value} change={change} />
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
        <div className="develop-segment">
          {(["shadows", "midtones", "highlights"] as const).map((g) => (
            <button key={g} aria-pressed={grade === g} onClick={() => setGrade(g)}>
              {g}
            </button>
          ))}
        </div>
        <div
          className="develop-grade-swatch"
          style={{
            background: `hsl(${value.grading[grade].hue} ${value.grading[grade].saturation}% 55%)`,
          }}
          aria-hidden="true"
        />
        {(["hue", "saturation", "luminance"] as const).map((key) => (
          <DevelopSlider
            key={key}
            label={`Grade ${key}`}
            value={value.grading[grade][key]}
            min={key === "luminance" ? -100 : 0}
            max={key === "hue" ? 360 : 100}
            onChange={(n, c) =>
              change(
                {
                  ...value,
                  grading: { ...value.grading, [grade]: { ...value.grading[grade], [key]: n } },
                },
                `${grade} ${key}`,
                c,
              )
            }
          />
        ))}
        <DevelopSlider
          label="Blending"
          value={value.grading.blending}
          min={0}
          reset={50}
          onChange={(n, c) =>
            change({ ...value, grading: { ...value.grading, blending: n } }, "Grading blending", c)
          }
        />
        <DevelopSlider
          label="Balance"
          value={value.grading.balance}
          onChange={(n, c) =>
            change({ ...value, grading: { ...value.grading, balance: n } }, "Grading balance", c)
          }
        />
      </Panel>
      <Panel title="Effects">
        {scalar("grain", "Grain", 0)}
        {scalar("grainSize", "Grain size", 0.5, 4, 0.1)}
        {scalar("halation", "Halation", 0)}
        {scalar("bloom", "Bloom", 0)}
        {scalar("fade", "Fade", 0)}
        {scalar("vignette", "Vignette")}
      </Panel>
      <Panel title="Detail">
        {scalar("sharpening", "Sharpening", 0)}
        {scalar("noiseReduction", "Luminance noise", 0)}
        {scalar("colorNoiseReduction", "Color noise", 0)}
        <p className="develop-hint">Inspect at 100% for fine detail.</p>
      </Panel>
      <Panel title="Crop & Straighten" open={tool === "crop"}>
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
