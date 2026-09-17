/** In-app Wispr analogue. Triple-tap Space toggles dictation; Control+Space is
 * hold-to-talk (never Cmd+Space — that is Spotlight).
 */

export type DictationCaret = { prefix: string; suffix: string };

export type DictationHandle = {
  /** Focus is inside this mic's composer: it owns the hotkey. */
  armed: () => boolean;
  /** This mic is on screen and could take a dictation started from anywhere. */
  present: () => boolean;
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

export function isDictateChord(
  event: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey">,
) {
  return event.code === "Space" && event.ctrlKey && !event.metaKey && !event.altKey;
}

export function isPlainSpace(
  event: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
) {
  return (
    event.code === "Space" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
  );
}

/** Three quick Space taps. A slow gap, a held key, or any other key starts over,
 * so ordinary typing (one space between words) can never trigger it.
 */
export function createTripleTap(gapMs = 350, pressMs = 300) {
  let count = 0;
  let lastDown = 0;
  return {
    /** Position of this key-down in its run: 1, 2, or 3 (the triple; the run then ends). */
    down(now: number): 1 | 2 | 3 {
      if (now - lastDown > gapMs) count = 0;
      lastDown = now;
      count += 1;
      if (count < 3) return count as 1 | 2;
      count = 0;
      return 3;
    },
    up(now: number) {
      if (now - lastDown > pressMs) count = 0;
    },
    reset() {
      count = 0;
    },
  };
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

type TextField = HTMLInputElement | HTMLTextAreaElement;
function textFieldOf(element: Element | null): TextField | null {
  if (element instanceof HTMLTextAreaElement) return element;
  if (element instanceof HTMLInputElement && element.selectionStart != null) return element;
  return null;
}

/** Space already means something here (press a button, toggle a checkbox, type
 * into rich text we cannot restore), so the triple-tap stays out of the way.
 */
function spaceBelongsTo(element: Element | null) {
  if (!element || element === document.body) return false;
  if (textFieldOf(element)) return false;
  return Boolean(
    element.closest(
      "button,a[href],select,summary,input,[role=button],[role=checkbox],[role=switch],[role=tab],[role=menuitem],[role=option],[role=slider],[contenteditable=true],[contenteditable='']",
    ),
  );
}

const taps = createTripleTap();
// The field as it was before the first tap typed a space into it. Restoring this
// (not "delete two characters") also undoes macOS's double-space period.
let beforeTaps: { field: TextField; caret: DictationCaret } | null = null;

function onTripleTapDown(event: KeyboardEvent) {
  const focused = document.activeElement;
  if (event.repeat || spaceBelongsTo(focused)) {
    taps.reset();
    return;
  }
  const field = textFieldOf(focused);
  const tap = taps.down(event.timeStamp);
  // Key-down precedes insertion, so on the first tap the field is still untouched.
  if (tap === 1) beforeTaps = field ? { field, caret: dictationCaretOf(field, field.value) } : null;
  if (tap < 3) return;
  const snapshot = beforeTaps;
  beforeTaps = null;
  let handle = pick();
  // From a text field that is not a composer there is no mic to take the words.
  if (!handle && !field)
    for (const candidate of handles) if (candidate.present()) handle ??= candidate;
  if (!handle) return;
  event.preventDefault();
  event.stopPropagation();
  if (handle.listening()) handle.up();
  else handle.down(snapshot && snapshot.field === field ? snapshot.caret : undefined);
}

function onDown(event: KeyboardEvent) {
  if (isPlainSpace(event)) {
    onTripleTapDown(event);
    return;
  }
  taps.reset();
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
  if (event.code !== "Space") return;
  taps.up(event.timeStamp);
  if (!holding) return;
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
      taps.reset();
      beforeTaps = null;
    }
  };
}
