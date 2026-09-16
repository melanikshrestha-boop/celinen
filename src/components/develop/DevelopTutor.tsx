import { useEffect, useRef, useState } from "react";
import {
  applyLook,
  bezierArc,
  compileLook,
  lookTitle,
  pointerLabel,
  type TutorBeat,
  type TutorDraw,
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
type Buddy = { x: number; y: number; rotation: number; scale: number };
type Voice = "idle" | "listening" | "teaching";

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

function speechCtor(): (new () => SpeechRec) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const line = text.trim().toLowerCase();
  if (!line) return;
  const utterance = new SpeechSynthesisUtterance(line);
  utterance.rate = 1.04;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

function hush() {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
}

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

function visiblePhotoBox() {
  const img = document.querySelector(".develop-stage .develop-image-frame img");
  const stage = document.querySelector(".develop-stage");
  if (!(img instanceof HTMLElement) || !(stage instanceof HTMLElement)) return null;
  const photo = img.getBoundingClientRect();
  const clip = stage.getBoundingClientRect();
  const left = Math.max(photo.left, clip.left);
  const top = Math.max(photo.top, clip.top);
  const width = Math.min(photo.right, clip.right) - left;
  const height = Math.min(photo.bottom, clip.bottom) - top;
  if (width < 40 || height < 40) return null;
  return { left, top, width, height };
}

function pin(x: number, y: number) {
  const root = document.querySelector(".develop-tutor-layer")?.getBoundingClientRect();
  return { x: x - (root?.left ?? 0), y: y - (root?.top ?? 0) };
}

function photoMark(kind: TutorDraw): Ring | null {
  const box = visiblePhotoBox();
  if (!box) return null;
  if (kind === "subject" || kind === "skin") {
    const w = box.width * (kind === "skin" ? 0.28 : 0.38);
    const h = box.height * (kind === "skin" ? 0.34 : 0.5);
    return {
      x: box.left + box.width / 2 - w / 2,
      y: box.top + box.height * 0.44 - h / 2,
      w,
      h,
      label: kind === "skin" ? "skin" : "person",
    };
  }
  if (kind === "windows")
    return {
      x: box.left + box.width * 0.08,
      y: box.top + 8,
      w: box.width * 0.84,
      h: box.height * 0.22,
      label: "windows",
    };
  return { x: box.left + 12, y: box.bottom - 48, w: 92, h: 28, label: "street" };
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
  const [buddy, setBuddy] = useState<Buddy>({ x: 24, y: 24, rotation: -35, scale: 1 });
  const [ring, setRing] = useState<Ring | null>(null);
  const [draw, setDraw] = useState<Ring | null>(null);
  const [mode, setMode] = useState<"do" | "show">("do");
  const [voice, setVoice] = useState<Voice>("idle");
  const [canTalk, setCanTalk] = useState(false);
  const bar = useRef<HTMLFormElement>(null);
  const recipe = useRef(settings);
  const originRef = useRef<DevelopSettings | null>(null);
  const beatsRef = useRef<TutorBeat[]>([]);
  const indexRef = useRef(0);
  const modeRef = useRef(mode);
  const buddyRef = useRef(buddy);
  const flight = useRef(0);
  const rec = useRef<SpeechRec | null>(null);
  const heard = useRef("");
  recipe.current = settings;
  originRef.current = origin;
  beatsRef.current = beats;
  indexRef.current = index;
  modeRef.current = mode;
  buddyRef.current = buddy;
  const beat = beats[index] ?? null;
  const teaching = beats.length > 0 && index < beats.length;

  function parkBuddy() {
    const box = bar.current?.getBoundingClientRect();
    if (!box) return;
    flyTo(pin(box.left + 22, box.top + box.height / 2), true);
    setRing(null);
    setDraw(null);
  }

  function flyTo(end: { x: number; y: number }, snap = false) {
    window.cancelAnimationFrame(flight.current);
    const start = { x: buddyRef.current.x, y: buddyRef.current.y };
    if (snap) {
      const next = { x: end.x, y: end.y, rotation: -35, scale: 1 };
      buddyRef.current = next;
      setBuddy(next);
      return;
    }
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const duration = Math.min(Math.max(distance / 1400, 0.28), 0.7) * 1000;
    const t0 = performance.now();
    const tick = (now: number) => {
      const linear = Math.min(1, (now - t0) / duration);
      const pose = bezierArc(start, end, linear);
      buddyRef.current = pose;
      setBuddy(pose);
      if (linear < 1) flight.current = window.requestAnimationFrame(tick);
      else setBuddy({ x: end.x, y: end.y, rotation: -35, scale: 1 });
    };
    flight.current = window.requestAnimationFrame(tick);
  }

  function fly(id?: string, label = "", mark?: TutorDraw) {
    const target = id ? controlBox(id) : null;
    const markBox = mark ? photoMark(mark) : null;
    setDraw(
      markBox
        ? { ...markBox, ...pin(markBox.x, markBox.y), w: markBox.w, h: markBox.h }
        : null,
    );
    if (!target) {
      parkBuddy();
      return;
    }
    const beside = pin(target.box.right + 8, target.box.top + 12);
    flyTo(beside);
    const ringAt = pin(target.box.left - 8, target.box.top - 8);
    setRing({
      x: ringAt.x,
      y: ringAt.y,
      w: target.box.width + 16,
      h: target.box.height + 16,
      label: pointerLabel(id) || label,
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
        fly(next.point, next.say, next.draw);
        speak(next.say);
        if (!replay) paint(at, false);
      });
    });
  }

  function startLook(line = ask.trim()) {
    if (!line || !enabled) return;
    setVoice("teaching");
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
    hush();
    window.cancelAnimationFrame(flight.current);
    setBeats([]);
    beatsRef.current = [];
    setIndex(0);
    setOrigin(null);
    originRef.current = null;
    setRing(null);
    setDraw(null);
    setVoice("idle");
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
    hush();
    paint(planned.length - 1, true, title);
    const last = planned[planned.length - 1];
    if (last?.open) revealPanel(last.open);
    fly(last?.point, last?.say ?? "", last?.draw);
    window.setTimeout(dismiss, 420);
  }

  function holdTalk(on: boolean) {
    const Ctor = speechCtor();
    if (!Ctor) return;
    if (!on) {
      rec.current?.stop();
      rec.current = null;
      if (voice === "listening") setVoice("idle");
      return;
    }
    try {
      const session = new Ctor();
      session.lang = "en-US";
      session.interimResults = true;
      session.continuous = false;
      session.onresult = (event) => {
        const last = event.results[event.results.length - 1];
        const text = last?.[0]?.transcript?.trim();
        if (text) {
          heard.current = text;
          setAsk(text);
        }
      };
      session.onend = () => {
        rec.current = null;
        setVoice("idle");
      };
      session.onerror = () => setVoice("idle");
      rec.current = session;
      setVoice("listening");
      session.start();
    } catch {
      setVoice("idle");
    }
  }

  useEffect(() => {
    setCanTalk(Boolean(speechCtor()));
  }, []);

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
    const pointed = document.getElementById(beat.point);
    const advance = () => nextBeat();
    pointed?.addEventListener("pointerup", advance);
    const keys = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return;
      if (event.key === "Enter" || event.key.toLowerCase() === "n") {
        event.preventDefault();
        nextBeat();
      }
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        runBeat(beat, index, true);
      }
    };
    window.addEventListener("keydown", keys);
    return () => {
      pointed?.removeEventListener("pointerup", advance);
      window.removeEventListener("keydown", keys);
    };
    // nextBeat closes over index; rebind each beat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat, index]);

  if (!enabled) return null;
  return (
    <div className="develop-tutor" aria-label="Look tutor">
      <div className="develop-tutor-layer" aria-hidden="true">
      <div
        className={`develop-tutor-buddy${teaching ? " is-teaching" : ""}${voice === "listening" ? " is-listening" : ""}`}
        style={{
          transform: `translate(${buddy.x - 8}px, ${buddy.y - 8}px) rotate(${buddy.rotation}deg) scale(${buddy.scale})`,
        }}
      >
        {voice === "listening" ? (
          <span className="develop-tutor-wave" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        ) : (
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <polygon points="8,1 15,14 1,14" />
          </svg>
        )}
      </div>
      {teaching && ring ? (
        <div
          key={`ring-${index}`}
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
      {teaching && draw ? (
        <div
          key={`draw-${index}`}
          className="develop-tutor-draw"
          style={{
            transform: `translate(${draw.x}px, ${draw.y}px)`,
            width: draw.w,
            height: draw.h,
          }}
        >
          <span>{draw.label}</span>
        </div>
      ) : null}
      </div>
      <form
        ref={bar}
        className="develop-lookbar"
        onSubmit={(event) => {
          event.preventDefault();
          startLook();
        }}
      >
        {canTalk ? (
          <button
            type="button"
            className={voice === "listening" ? "is-on" : undefined}
            aria-pressed={voice === "listening"}
            aria-label="Hold to talk"
            onPointerDown={(event) => {
              event.preventDefault();
              heard.current = "";
              holdTalk(true);
            }}
            onPointerUp={() => {
              holdTalk(false);
              window.setTimeout(() => {
                if (heard.current.trim()) startLook(heard.current.trim());
              }, 120);
            }}
            onPointerCancel={() => holdTalk(false)}
          >
            Talk
          </button>
        ) : null}
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
