import type { MouseEvent, PointerEvent } from "react";

/** Row actions do not trigger a parent row's selection, drag, or double-click rename. */
export function stopRowAction(event: MouseEvent | PointerEvent) {
  event.stopPropagation();
}
