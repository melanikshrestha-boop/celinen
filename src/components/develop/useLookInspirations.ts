import { useCallback, useEffect, useRef, useState } from "react";
import { LOOK_MAX_INSPIRATIONS, type LookDescriptor } from "@/lib/develop/look-match";
import { describeLookWasm } from "@/lib/develop/wasm/client";

export type LookInspiration = {
  id: string;
  name: string;
  /** Object URL for the chip and the viewer reference. Revoked on removal. */
  url: string;
  descriptor: LookDescriptor | null;
  error: string;
};

// Formats every browser decodes for the engine. RAW and TIFF drops stay imports.
const INSPIRATION_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

/** While dragging: how many inspiration photos the drag carries, or 0 when it
 * holds anything else (a RAW, a folder, a document), which stays an import. */
export function lookDragCount(transfer: DataTransfer | null, limit: number): number {
  if (!transfer) return 0;
  const items = Array.from(transfer.items ?? []);
  if (!items.length || items.length > limit) return 0;
  return items.every((item) => item.kind === "file" && INSPIRATION_TYPES.has(item.type))
    ? items.length
    : 0;
}

/** On drop: the inspiration files, or null when the drop is an import. */
export function lookDropFiles(transfer: DataTransfer | null, limit: number): File[] | null {
  if (!transfer || lookDragCount(transfer, limit) === 0) return null;
  const files = Array.from(transfer.files);
  if (!files.length || files.length > limit) return null;
  return files.every((file) => INSPIRATION_TYPES.has(file.type) && file.size > 0) ? files : null;
}

/** Inspiration photos dropped on Clicky or the viewer, each measured once. */
export function useLookInspirations() {
  const [items, setItems] = useState<LookInspiration[]>([]);
  const live = useRef(new Map<string, AbortController>());
  const urls = useRef(new Map<string, string>());
  const nextId = useRef(1);

  const remove = useCallback((id: string) => {
    live.current.get(id)?.abort();
    live.current.delete(id);
    const url = urls.current.get(id);
    if (url) URL.revokeObjectURL(url);
    urls.current.delete(id);
    setItems((old) => old.filter((item) => item.id !== id));
  }, []);

  const add = useCallback((files: File[]) => {
    const room = LOOK_MAX_INSPIRATIONS - urls.current.size;
    for (const file of files.slice(0, Math.max(0, room))) {
      const id = `look-${nextId.current++}`;
      const url = URL.createObjectURL(file);
      const controller = new AbortController();
      urls.current.set(id, url);
      live.current.set(id, controller);
      setItems((old) => [...old, { id, name: file.name, url, descriptor: null, error: "" }]);
      void describeLookWasm(file, controller.signal)
        .then((descriptor) => {
          if (!controller.signal.aborted)
            setItems((old) => old.map((item) => (item.id === id ? { ...item, descriptor } : item)));
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          const error = cause instanceof Error ? cause.message : "This photo could not be read.";
          setItems((old) => old.map((item) => (item.id === id ? { ...item, error } : item)));
        })
        .finally(() => {
          if (live.current.get(id) === controller) live.current.delete(id);
        });
    }
  }, []);

  useEffect(() => {
    const controllers = live.current,
      objectUrls = urls.current;
    return () => {
      for (const controller of controllers.values()) controller.abort();
      for (const url of objectUrls.values()) URL.revokeObjectURL(url);
      controllers.clear();
      objectUrls.clear();
    };
  }, []);

  const descriptors = items.flatMap((item) => (item.descriptor ? [item.descriptor] : []));
  const measuring = items.some((item) => !item.descriptor && !item.error);
  return { items, add, remove, descriptors, measuring };
}
