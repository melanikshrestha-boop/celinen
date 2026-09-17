import { useEffect } from "react";
import {
  appEditKey,
  clickAppKeyButton,
  isTypingTarget,
  selectedText,
  topAppKeys,
} from "@/lib/app-keys";

/** ⌘Z / ⌘C / ⌘V / ⌘X / ⌘A / ⌘⇧Z follow the same buttons as on screen. */
export function AppKeys() {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      const edit = appEditKey(event);
      if (!edit) return;
      const typing = isTypingTarget(event.target);
      if (typing && (edit === "copy" || edit === "cut" || edit === "paste" || edit === "selectAll"))
        return;
      if (typing && (edit === "undo" || edit === "redo")) return;
      if (edit === "copy" && selectedText()) return;
      const actions = topAppKeys();
      if (edit === "undo") {
        if (actions?.undo) {
          event.preventDefault();
          actions.undo();
        } else if (clickAppKeyButton("undo")) event.preventDefault();
        return;
      }
      if (edit === "redo") {
        if (actions?.redo) {
          event.preventDefault();
          actions.redo();
        } else if (clickAppKeyButton("redo")) event.preventDefault();
        return;
      }
      if (edit === "copy") {
        if (actions?.copy?.()) {
          event.preventDefault();
          return;
        }
        if (clickAppKeyButton("copy")) event.preventDefault();
        return;
      }
      if (edit === "cut") {
        if (actions?.cut?.()) event.preventDefault();
        return;
      }
      if (edit === "selectAll") {
        if (actions?.selectAll?.()) event.preventDefault();
        return;
      }
    }

    function onPaste(event: ClipboardEvent) {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      const files = [...(event.clipboardData?.files ?? [])];
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!files.length && !text) return;
      const actions = topAppKeys();
      if (actions?.paste?.(files, text)) event.preventDefault();
    }

    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  }, []);
  return null;
}
