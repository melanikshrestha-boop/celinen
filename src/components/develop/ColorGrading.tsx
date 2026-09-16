import { useId, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { RotateCcw } from "lucide-react";
import {
  defaultDevelopSettings,
  type DevelopGrade,
  type DevelopSettings,
} from "@/lib/develop/contract";
import type { DevelopChange } from "./DevelopControls";
import {
  ColorWheelGesture,
  ColorGradingOwnership,
  keyboardGrade,
  neutralGrading,
  sameGrade,
  wheelPosition,
  type GradeRange,
  type WheelModifiers,
} from "./color-grading";
import "./color-grading.css";

type SliderProps = {
  label: string;
  displayLabel?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  reset?: number;
  onChange: (value: number, commit: boolean) => void;
};
const ranges: GradeRange[] = ["shadows", "midtones", "highlights", "global"];
const names: Record<GradeRange, string> = {
  shadows: "Shadows",
  midtones: "Midtones",
  highlights: "Highlights",
  global: "Global",
};
type GradingView = GradeRange | "three-way";
const views: { id: GradingView; title: string; label: string }[] = [
  { id: "three-way", title: "Three-way color grading", label: "3-way" },
  { id: "shadows", title: "Shadows color grading", label: "Shadows" },
  { id: "midtones", title: "Midtones color grading", label: "Mid" },
  { id: "highlights", title: "Highlights color grading", label: "High" },
  { id: "global", title: "Global color grading", label: "Global" },
];
const neutral = (): DevelopGrade => ({ hue: 0, saturation: 0, luminance: 0 });
const display = (n: number) => Math.round(n * 10) / 10;

export function GradingWheel({
  label,
  value,
  onChange,
  ownership,
  owner,
  id,
}: {
  label: string;
  value: DevelopGrade;
  onChange: (value: DevelopGrade, commit: boolean) => void;
  ownership: ColorGradingOwnership;
  owner: string;
  id?: string;
}) {
  const help = useId();
  const current = useRef(value);
  const alive = useRef(true);
  const publish = useRef(onChange);
  publish.current = (next, commit) => {
    if (!alive.current) return;
    current.current = next;
    onChange(next, commit);
  };
  const [gesture] = useState(
    () => new ColorWheelGesture((next, commit) => publish.current(next, commit)),
  );
  const pointer = useRef<number | null>(null);
  const keyboard = useRef<DevelopGrade | null>(null);
  const previous = current.current;
  current.current = value;
  const position = wheelPosition(value);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      gesture.discard();
      ownership.release(owner);
      // Ensure cleanup on unmount
      pointer.current = null;
      keyboard.current = null;
    };
  }, [gesture, ownership, owner]);
  // Undo, presets or a recovery receipt can replace the current recipe mid-drag.
  // Never let a stale gesture overwrite that external change.
  useLayoutEffect(() => {
    if (gesture.value && !sameGrade(gesture.value, value)) {
      gesture.discard();
      pointer.current = null;
      ownership.release(owner);
    }
    if (keyboard.current && !sameGrade(previous, value)) {
      keyboard.current = null;
      ownership.release(owner);
    }
  }, [gesture, owner, ownership, previous, value]);
  const modifiers = (event: React.PointerEvent): WheelModifiers => ({
    shift: event.shiftKey,
    hueOnly: event.ctrlKey || event.metaKey,
    fine: event.altKey,
  });
  const point = (event: React.PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const radius = Math.min(box.width, box.height) / 2;
    return {
      x: (event.clientX - box.left - box.width / 2) / radius,
      y: (event.clientY - box.top - box.height / 2) / radius,
    };
  };
  const finishKeyboard = (cancel = false) => {
    const initial = keyboard.current;
    keyboard.current = null;
    if (initial && !sameGrade(initial, current.current))
      publish.current(cancel ? initial : current.current, !cancel);
    if (initial) ownership.release(owner);
  };
  const finishPointer = (event: React.PointerEvent<HTMLButtonElement>, cancel = false) => {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    gesture.finish(event.pointerId, cancel);
    ownership.release(owner);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <>
      <button
        type="button"
        id={id}
        className="develop-grade-wheel"
        role="slider"
        tabIndex={0}
        aria-label={`${label} color wheel`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={display(value.saturation)}
        aria-valuetext={`Hue ${display(value.hue)} degrees, saturation ${display(value.saturation)} percent`}
        aria-describedby={help}
        onPointerDown={(event) => {
          if (event.button !== 0 || event.currentTarget.closest("fieldset:disabled")) return;
          if (pointer.current !== null) return;
          finishKeyboard();
          if (!ownership.claim(owner)) return;
          event.preventDefault();
          event.currentTarget.focus();
          if (!gesture.begin(event.pointerId, current.current, point(event), modifiers(event)))
            return;
          pointer.current = event.pointerId;
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // Untrusted pointers still receive moves on this wheel.
          }
        }}
        onPointerMove={(event) => gesture.move(event.pointerId, point(event), modifiers(event))}
        onPointerUp={(event) => finishPointer(event)}
        onPointerCancel={(event) => finishPointer(event, true)}
        onLostPointerCapture={(event) => finishPointer(event, true)}
        onKeyDown={(event) => {
          if (event.currentTarget.closest("fieldset:disabled")) return;
          if (event.key === "Escape" && (pointer.current !== null || keyboard.current)) {
            event.preventDefault();
            event.stopPropagation();
            if (pointer.current !== null) {
              const captured = pointer.current;
              gesture.finish(captured, true);
              pointer.current = null;
              ownership.release(owner);
              if (event.currentTarget.hasPointerCapture(captured))
                event.currentTarget.releasePointerCapture(captured);
            }
            finishKeyboard(true);
            return;
          }
          if (pointer.current !== null) return;
          const next = keyboardGrade(current.current, event.key, {
            shift: event.shiftKey,
            alt: event.altKey,
          });
          if (!next) return;
          if (!ownership.claim(owner)) return;
          event.preventDefault();
          event.stopPropagation();
          keyboard.current ??= { ...current.current };
          publish.current(next, false);
        }}
        onKeyUp={(event) => {
          if (!event.key.startsWith("Arrow")) return;
          event.stopPropagation();
          finishKeyboard();
        }}
        onBlur={() => finishKeyboard()}
      >
        <span className="develop-grade-center" aria-hidden="true" />
        <span
          className="develop-grade-ray"
          aria-hidden="true"
          style={{ transform: `rotate(${value.hue}deg)`, width: `${value.saturation / 2}%` }}
        />
        <span
          className="develop-grade-handle"
          aria-hidden="true"
          style={{
            left: `${50 + position.x * 50}%`,
            top: `${50 + position.y * 50}%`,
            background: `hsl(${value.hue} ${value.saturation}% 50%)`,
          }}
        />
      </button>
      <span className="sr-only" id={help}>
        Drag for hue and saturation. Shift: saturation only. Control or Command: hue only. Alt or
        Option: fine adjustment. Focus and use Left/Right for hue, Up/Down for saturation; Shift
        changes by ten. Alt reverses the hue arrows. Escape cancels the current gesture. Numeric
        controls are also available below.
      </span>
    </>
  );
}

export function ColorGrading({
  value,
  change,
  Slider,
}: {
  value: DevelopSettings;
  change: DevelopChange;
  Slider: ComponentType<SliderProps>;
}) {
  const [view, setView] = useState<GradingView>("three-way");
  const [activeOwner, setActiveOwner] = useState<string | null>(null);
  const [ownership] = useState(() => new ColorGradingOwnership(setActiveOwner));
  const numericInitial = useRef<{
    owner: string;
    update: Partial<DevelopSettings["grading"]>;
  } | null>(null);
  const tabId = useId();
  const current = useRef(value);
  const previousGrading = current.current.grading;
  current.current = value;
  useLayoutEffect(() => {
    const initial = numericInitial.current;
    if (initial && JSON.stringify(previousGrading) !== JSON.stringify(value.grading)) {
      numericInitial.current = null;
      ownership.release(initial.owner);
    }
  }, [ownership, previousGrading, value.grading]);
  
  useLayoutEffect(() => {
    return () => {
      numericInitial.current = null;
      ownership.releaseAll();
    };
  }, [ownership]);
  const legacy = value.grading.model === "legacy" && !neutralGrading(value.grading);
  const patch = (
    update: Partial<DevelopSettings["grading"]>,
    label: string,
    commit = true,
    owner?: string,
  ) => {
    if (owner ? !ownership.claim(owner) : ownership.current !== null) return;
    const settings = current.current;
    if (owner?.startsWith("numeric:") && !numericInitial.current) {
      const initial = Object.fromEntries(
        Object.keys(update).map((key) => [
          key,
          settings.grading[key as keyof typeof settings.grading],
        ]),
      );
      numericInitial.current = { owner, update: initial };
    }
    const grading = { ...settings.grading, ...update };
    current.current = { ...settings, grading };
    change(current.current, label, commit);
    if (commit && owner?.startsWith("numeric:")) {
      numericInitial.current = null;
      ownership.release(owner);
    }
  };
  const grade = (range: GradeRange) => value.grading[range] ?? neutral();
  const changeGrade = (range: GradeRange, next: DevelopGrade, commit: boolean) =>
    patch({ [range]: next }, `${names[range]} color grading`, commit, `wheel:${range}`);
  const numericControl = (owner: string, children: React.ReactNode) => (
    <fieldset
      className="develop-grading-control"
      disabled={activeOwner !== null && activeOwner !== owner}
      onPointerCancel={() => {
        const initial = numericInitial.current;
        if (initial?.owner !== owner || ownership.current !== owner) return;
        patch(initial.update, "Cancel color grading", false, owner);
        numericInitial.current = null;
        ownership.release(owner);
      }}
    >
      {children}
    </fieldset>
  );
  const numeric = (range: GradeRange, key: keyof DevelopGrade) =>
    numericControl(
      `numeric:${range}:${key}`,
      <Slider
        key={key}
        label={`${names[range]} ${key}`}
        displayLabel={key.charAt(0).toUpperCase() + key.slice(1)}
        value={display(grade(range)[key])}
        min={key === "luminance" ? -100 : 0}
        max={key === "hue" ? 360 : 100}
        step={0.1}
        onChange={(n, commit) =>
          patch(
            { [range]: { ...current.current.grading[range], [key]: n } },
            `${names[range]} ${key}`,
            commit,
            `numeric:${range}:${key}`,
          )
        }
      />,
    );
  return (
    <div className="develop-grading">
      <div className="develop-grading-views" role="tablist" aria-label="Color grading view">
        {views.map((entry, index) => (
          <button
            key={entry.id}
            type="button"
            disabled={activeOwner !== null}
            role="tab"
            id={`${tabId}-${entry.id}`}
            aria-controls={`${tabId}-panel`}
            aria-label={entry.title}
            aria-selected={view === entry.id}
            tabIndex={view === entry.id ? 0 : -1}
            onClick={() => setView(entry.id)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % views.length
                  : event.key === "ArrowLeft"
                    ? (index + views.length - 1) % views.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? views.length - 1
                        : null;
              if (next === null) return;
              event.preventDefault();
              event.stopPropagation();
              setView(views[next]!.id);
              event.currentTarget.parentElement
                ?.querySelectorAll<HTMLButtonElement>("button")
                [next]?.focus();
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div
        className={`develop-grading-wheels ${view === "three-way" ? "is-three-way" : ""}`}
        role="tabpanel"
        id={`${tabId}-panel`}
        aria-labelledby={`${tabId}-${view}`}
      >
        {(view === "three-way" ? ranges.slice(0, 3) : [view]).map((range) => (
          <div className={`develop-grading-range is-${range}`} key={range}>
            <div className="develop-grading-range-head">
              <span>{names[range]}</span>
              <button
                type="button"
                disabled={activeOwner !== null}
                aria-label={`Reset ${range} color grading`}
                title={`Reset ${range}`}
                onClick={() => patch({ [range]: neutral() }, `Reset ${names[range]} color grading`)}
              >
                <RotateCcw size={11} />
              </button>
            </div>
            <fieldset
              className="develop-grading-control"
              disabled={activeOwner !== null && activeOwner !== `wheel:${range}`}
            >
              <GradingWheel
                id={`wheel-${range}`}
                label={names[range]}
                value={grade(range)}
                onChange={(next, commit) => changeGrade(range, next, commit)}
                ownership={ownership}
                owner={`wheel:${range}`}
              />
            </fieldset>
            {view === "three-way" ? (
              <details className="develop-grading-values">
                <summary>
                  H {display(grade(range).hue)}° · S {display(grade(range).saturation)}
                </summary>
                {numeric(range, "hue")}
                {numeric(range, "saturation")}
              </details>
            ) : (
              <>
                {numeric(range, "hue")}
                {numeric(range, "saturation")}
              </>
            )}
            {numeric(range, "luminance")}
          </div>
        ))}
      </div>
      {view !== "global" && (
        <>
          {numericControl(
            "numeric:blending",
            <Slider
              label="Blending"
              value={value.grading.blending}
              min={0}
              reset={50}
              onChange={(n, commit) =>
                patch({ blending: n }, "Grading blending", commit, "numeric:blending")
              }
            />,
          )}
          {numericControl(
            "numeric:balance",
            <Slider
              label="Balance"
              value={value.grading.balance}
              onChange={(n, commit) =>
                patch({ balance: n }, "Grading balance", commit, "numeric:balance")
              }
            />,
          )}
        </>
      )}
      <div className="develop-grading-footer">
        <span title="Shift: saturation only · Ctrl/⌘: hue only · Alt/Option: fine adjustment">
          Drag to grade · Alt/⌥ for fine control
        </span>
        <button
          type="button"
          disabled={activeOwner !== null}
          aria-label="Reset all color grading"
          onClick={() => patch(defaultDevelopSettings().grading, "Reset color grading")}
        >
          Reset
        </button>
      </div>
      {legacy && (
        <div className="develop-grading-legacy">
          <span>Saved grading keeps its original rendering.</span>
          <button
            type="button"
            disabled={activeOwner !== null}
            onClick={() => patch({ model: "tonal" }, "Use updated color grading")}
          >
            Use updated grading
          </button>
        </div>
      )}
    </div>
  );
}
