/** Instagram-style tap: short haptic plus CSS scale-down bounce. */

const PRESS = "button:not([disabled]), a[href], [role='menuitem'], [role='button']";

export function hapticTap() {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  const motion =
    typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  if (motion?.matches) return;
  try {
    navigator.vibrate(12);
  } catch {
    /* some browsers throw when vibration is blocked */
  }
}

export function onHapticPress(event: {
  pointerType?: string;
  button: number;
  target: EventTarget | null;
}) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const node = event.target;
  if (!node || typeof (node as Element).closest !== "function") return;
  const el = node as Element;
  if (el.closest("[data-no-press]")) return;
  if (!el.closest(PRESS)) return;
  hapticTap();
}
