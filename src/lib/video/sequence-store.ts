import { workspaceStorageKey } from "@/lib/workspace-storage";
import { emptySequence, parseSequence, type Sequence } from "./sequence";

export const VIDEO_SEQUENCE_STORAGE_KEY = "celinen.video-sequence.v1";

export function loadVideoSequence(scope = "device-local"): Sequence {
  if (typeof window === "undefined") return emptySequence();
  try {
    const raw = window.localStorage.getItem(workspaceStorageKey(VIDEO_SEQUENCE_STORAGE_KEY, scope));
    if (!raw) return emptySequence();
    return parseSequence(JSON.parse(raw)) ?? emptySequence();
  } catch {
    return emptySequence();
  }
}

export function saveVideoSequence(sequence: Sequence, scope = "device-local") {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      workspaceStorageKey(VIDEO_SEQUENCE_STORAGE_KEY, scope),
      JSON.stringify(sequence),
    );
  } catch {
    /* quota / private mode: sequence still works for this visit */
  }
}

export function clearVideoSequence(scope = "device-local") {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(workspaceStorageKey(VIDEO_SEQUENCE_STORAGE_KEY, scope));
  } catch {
    /* ignore */
  }
}
