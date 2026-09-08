import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { DevelopPointerOwnership } from "@/lib/develop/interaction";

/** Recipes are whole-image transactions: a second touch cannot commit another control's preview. */
export function useDevelopPointer() {
  const gate = useRef(new DevelopPointerOwnership());
  const target = useRef<EventTarget | null>(null);
  useEffect(() => {
    const release = (event: PointerEvent) => {
      gate.current.release(event.pointerId);
    };
    const blur = () => {
      gate.current.blur();
    };
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("blur", blur);
    };
  }, []);
  function blockOther(event: ReactPointerEvent) {
    if (gate.current.accepts(event.pointerId)) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  }
  return {
    onPointerDownCapture(event: ReactPointerEvent) {
      if (event.button !== 0) return;
      if (!gate.current.down(event.pointerId)) {
        event.preventDefault();
        event.stopPropagation();
      } else target.current = event.target;
    },
    onPointerMoveCapture: blockOther,
    onPointerUpCapture: blockOther,
    onPointerCancelCapture: blockOther,
    onClickCapture(event: ReactMouseEvent) {
      const native = event.nativeEvent as MouseEvent & { pointerId?: number };
      if (!gate.current.click(native.pointerId, native.detail > 0)) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    onKeyDownCapture(event: ReactKeyboardEvent) {
      if (gate.current.active !== null && target.current !== event.target) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}
