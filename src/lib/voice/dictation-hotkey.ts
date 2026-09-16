/** In-app Wispr analogue: Control+Space (never Cmd+Space — that is Spotlight). */

export type DictationCaret = { prefix: string; suffix: string };

export type DictationHandle = {
  armed: () => boolean;
  listening: () => boolean;
  down: (caret?: DictationCaret) => void;
  up: () => void;
};

const handles = new Set<DictationHandle>();
let attached = false;
let holding = false;
let downAt = 0;
let active: DictationHandle | undefined;
const HOLD_MS = 180;

export function isDictateChord(event: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey">) {
  return event.code === "Space" && event.ctrlKey && !event.metaKey && !event.altKey;
}

export function dictationCaretOf(
  field: { value: string; selectionStart: number | null; selectionEnd: number | null } | null,
  value: string,
): DictationCaret {
  if (!field || field.selectionStart == null) return { prefix: value, suffix: "" };
  return {
    prefix: value.slice(0, field.selectionStart),
    suffix: value.slice(field.selectionEnd ?? field.selectionStart),
  };
}

function pick(): DictationHandle | undefined {
  for (const handle of handles) if (handle.armed()) return handle;
  return undefined;
}

function onDown(event: KeyboardEvent) {
  if (!isDictateChord(event) || event.repeat) return;
  const handle = pick();
  if (!handle) return;
  event.preventDefault();
  if (handle.listening() && !holding) {
    handle.up();
    active = undefined;
    return;
  }
  active = handle;
  holding = true;
  downAt = Date.now();
  if (!handle.listening()) handle.down();
}

function onUp(event: KeyboardEvent) {
  if (event.code !== "Space" || !holding) return;
  holding = false;
  if (Date.now() - downAt < HOLD_MS) return;
  active?.up();
  active = undefined;
}

export function registerDictationHotkey(handle: DictationHandle) {
  handles.add(handle);
  if (!attached && typeof window !== "undefined") {
    attached = true;
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
  }
  return () => {
    handles.delete(handle);
    if (!handles.size && attached) {
      attached = false;
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
    }
  };
}
