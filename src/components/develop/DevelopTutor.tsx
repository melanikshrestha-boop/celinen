import { useEffect, useRef, useState } from "react";
import {
  applyLook,
  compileLook,
  lookTitle,
  type TutorBeat,
} from "@/lib/develop/tutor";
import { cloneDevelopSettings, type DevelopSettings } from "@/lib/develop/contract";
import "./develop-tutor.css";

type Props = {
  settings: DevelopSettings;
  onChange: (next: DevelopSettings, label: string, commit?: boolean) => void;
  enabled: boolean;
  photoId?: string | null;
  advanced?: boolean;
};

type Ring = { x: number; y: number; w: number; h: number; label: string };

function revealPanel(id: string) {
  for (const node of document.querySelectorAll(".develop-right details.develop-panel[id]")) {
    if (node instanceof HTMLDetailsElement) node.open = node.id === id;
  }
  const node = document.getElementById(id);
  if (node instanceof HTMLDetailsElement) node.open = true;
  if (id === "panel-mixer") document.getElementById("hsl-orange")?.click();
}

function controlBox(id: string) {
  const node = document.getElementById(id);
  if (!node) return null;
  node.scrollIntoView({ block: "nearest", inline: "nearest" });
  const box = node.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + Math.min(24, box.height / 2), box, node };
}

export function DevelopTutor({
  settings,
  onChange,
  enabled,
  photoId,
  advanced = true,
}: Props) {
  const [ask, setAsk] = useState("");
  const [beats, setBeats] = useState<TutorBeat[]>([]);
  const [index, setIndex] = useState(0);
  const [origin, setOrigin] = useState<DevelopSettings | null>(null);
  const [title, setTitle] = useState("Look");
  const [buddy, setBuddy] = useState({ x: 24, y: 24 });
  const [ring, setRing] = useState<Ring | null>(null);
  const [mode, setMode] = useState<"do" | "show">("do");
  const bar = useRef<HTMLFormElement>(null);
  const recipe = useRef(settings);
  const originRef = useRef<DevelopSettings | null>(null);
  const beatsRef = useRef<TutorBeat[]>([]);
  const indexRef = useRef(0);
  const modeRef = useRef(mode);
  recipe.current = settings;
  originRef.current = origin;
  beatsRef.current = beats;
  indexRef.current = index;
  modeRef.current = mode;
  const beat = beats[index] ?? null;
  const teaching = beats.length > 0 && index < beats.length;

  function parkBuddy() {
    const box = bar.current?.getBoundingClientRect();
    if (!box) return;
    setBuddy({ x: box.left + 18, y: box.top + box.height / 2 });
    setRing(null);
  }

  function fly(id?: string, label = "") {
    const target = id ? controlBox(id) : null;
    if (!target) {
      parkBuddy();
      return;
    }
    setBuddy({ x: target.box.right + 22, y: target.y });
    setRing({
      x: target.box.left - 8,
      y: target.box.top - 8,
      w: target.box.width + 16,
      h: target.box.height + 16,
      label,
    });
  }

  function paint(through: number, commit = false, label = title) {
    const start = originRef.current;
    const planned = beatsRef.current;
    if (!start || !planned.length) return;
    const next =
      modeRef.current === "do" || commit ? applyLook(start, planned, through) : start;
    onChange(next, label, commit);
  }

  function runBeat(next: TutorBeat, at: number, replay = false) {
    if (next.open) revealPanel(next.open);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fly(next.point, next.say);
        if (!replay) paint(at, false);
      });
    });
  }

  function start() {
    const line = ask.trim();
    if (!line || !enabled) return;
    const planned = compileLook(line, recipe.current, { advanced });
    if (!planned.length) return;
    const snapshot = cloneDevelopSettings(recipe.current);
    const name = lookTitle(line);
    setOrigin(snapshot);
    originRef.current = snapshot;
    setTitle(name);
    setBeats(planned);
    beatsRef.current = planned;
    setIndex(0);
    indexRef.current = 0;
    runBeat(planned[0]!, 0);
  }

  function dismiss() {
    setBeats([]);
    beatsRef.current = [];
    setIndex(0);
    setOrigin(null);
    originRef.current = null;
    setRing(null);
    requestAnimationFrame(parkBuddy);
  }

  function finish(commit: boolean) {
    const name = title;
    if (commit && modeRef.current === "do") paint(beatsRef.current.length - 1, true, name);
    else if (!commit && originRef.current) onChange(originRef.current, name, true);
    dismiss();
  }

  function nextBeat() {
    const following = beats[index + 1];
    if (!following) {
      finish(true);
      return;
    }
    const at = index + 1;
    setIndex(at);
    indexRef.current = at;
    runBeat(following, at);
  }

  function backBeat() {
    if (index === 0) return;
    const at = index - 1;
    const previous = beats[at];
    if (!previous) return;
    setIndex(at);
    indexRef.current = at;
    runBeat(previous, at);
  }

  function applyAll() {
    const planned = beatsRef.current;
    if (!planned.length) return;
    paint(planned.length - 1, true, title);
    const last = planned[planned.length - 1];
    if (last?.open) revealPanel(last.open);
    fly(last?.point, last?.say ?? "");
    window.setTimeout(dismiss, 280);
  }

  useEffect(() => {
    parkBuddy();
  }, [enabled]);

  useEffect(() => {
    dismiss();
    // Photo change drops the overlay; the editor already swapped the recipe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoId]);

  useEffect(() => {
    if (!beat?.point) return;
    const tick = window.setInterval(() => fly(beat.point, beat.say), 400);
    const pointed = document.getElementById(beat.point);
    const advance = () => nextBeat();
    pointed?.addEventListener("pointerup", advance);
    return () => {
      window.clearInterval(tick);
      pointed?.removeEventListener("pointerup", advance);
    };
    // nextBeat closes over index; rebind each beat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat, index]);

  if (!enabled) return null;
  return (
    <div className="develop-tutor" aria-label="Look tutor">
      <div
        className={`develop-tutor-buddy${teaching ? " is-teaching" : ""}`}
        style={{ transform: `translate(${buddy.x - 14}px, ${buddy.y - 14}px)` }}
      />
      {teaching && ring ? (
        <div
          key={index}
          className="develop-tutor-ring"
          style={{
            transform: `translate(${ring.x}px, ${ring.y}px)`,
            width: ring.w,
            height: ring.h,
          }}
        >
          <span>{ring.label}</span>
        </div>
      ) : null}
      <form
        ref={bar}
        className="develop-lookbar"
        onSubmit={(event) => {
          event.preventDefault();
          start();
        }}
      >
        <input
          value={ask}
          onChange={(event) => setAsk(event.target.value)}
          placeholder="warmer, cinematic, sonder"
          aria-label="Look"
        />
        <button type="submit">Go</button>
        <button
          type="button"
          className={mode === "show" ? "is-on" : undefined}
          aria-pressed={mode === "show"}
          onClick={() => setMode(mode === "do" ? "show" : "do")}
        >
          {mode === "do" ? "Do" : "Show"}
        </button>
      </form>
      {teaching && beat ? (
        <div className="develop-lesson">
          <p>
            {index + 1}/{beats.length} {beat.say}
          </p>
          <div>
            <button type="button" disabled={index === 0} onClick={backBeat}>
              Back
            </button>
            <button type="button" onClick={() => beat && runBeat(beat, index, true)}>
              Repeat
            </button>
            <button type="button" onClick={nextBeat}>
              {beat.done || index === beats.length - 1 ? "Done" : "Next"}
            </button>
            <button type="button" onClick={applyAll}>
              Apply all
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
