/** Standard edit keys. Text fields keep the browser’s own undo/copy/paste. */

export type AppKeyActions = {
  undo?: () => void;
  redo?: () => void;
  copy?: () => boolean | void;
  paste?: (files: File[], text: string) => boolean | void;
  cut?: () => boolean | void;
  selectAll?: () => boolean | void;
};

const layers: AppKeyActions[] = [];

export function registerAppKeys(actions: AppKeyActions) {
  layers.push(actions);
  return () => {
    const index = layers.lastIndexOf(actions);
    if (index >= 0) layers.splice(index, 1);
  };
}

export function topAppKeys() {
  return layers.at(-1);
}

export function isTypingTarget(target: EventTarget | null) {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest("input,textarea,select,[contenteditable=true],[contenteditable='']"),
  );
}

export function selectedText() {
  return (typeof window !== "undefined" ? window.getSelection()?.toString() : "") ?? "";
}

export function isModKey(event: Pick<KeyboardEvent, "metaKey" | "ctrlKey">) {
  return event.metaKey || event.ctrlKey;
}

export function appEditKey(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
): "undo" | "redo" | "copy" | "paste" | "cut" | "selectAll" | null {
  if (!isModKey(event) || event.altKey) return null;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key === "z" && event.shiftKey) return "redo";
  if (key === "z") return "undo";
  if (key === "y") return "redo";
  if (key === "c") return "copy";
  if (key === "v") return "paste";
  if (key === "x") return "cut";
  if (key === "a") return "selectAll";
  return null;
}

export function clickAppKeyButton(name: string) {
  const nodes = [...document.querySelectorAll<HTMLButtonElement>(`[data-app-key="${name}"]`)];
  const button = nodes
    .reverse()
    .find((node) => !node.disabled && node.getClientRects().length > 0);
  button?.click();
  return Boolean(button);
}
