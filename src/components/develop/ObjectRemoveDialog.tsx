import { useEffect, useRef, useState } from "react";
import {
  findPhotoObjects,
  objectAtPoint,
  objectSelectionMask,
  removePhotoObjects,
  REMOVE_MAX_EDGE,
  REMOVE_ANALYSIS_EDGE,
  type ObjectInstances,
} from "@/lib/develop/object-remove";
import { decodeDevelopPreview } from "@/lib/develop/decode-preview";
import "./object-remove.css";

export function ObjectRemoveDialog({
  getRendered,
  saveCopy,
  processing,
  close,
  onPreviewPending,
}: {
  getRendered: (signal: AbortSignal) => Promise<Blob>;
  saveCopy: (blob: Blob) => Promise<void>;
  processing: (busy: boolean) => void;
  close: () => void;
  onPreviewPending: (pending: boolean) => void;
}) {
  const callbacks = useRef({ getRendered, saveCopy, processing, close });
  callbacks.current = { getRendered, saveCopy, processing, close };
  const [image, setImage] = useState<ImageData | null>(null),
    [source, setSource] = useState<Blob | null>(null);
  const [instances, setInstances] = useState<ObjectInstances | null>(null),
    [selected, setSelected] = useState<number[]>([]);
  const [result, setResult] = useState<Blob | null>(null),
    [showOriginal, setShowOriginal] = useState(false);
  useEffect(() => {
    onPreviewPending(Boolean(result));
    return () => onPreviewPending(false);
  }, [result, onPreviewPending]);
  const [url, setUrl] = useState(""),
    [busy, setBusy] = useState("Preparing Photo…"),
    [error, setError] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null),
    abort = useRef<AbortController | null>(null),
    alive = useRef(true),
    saving = useRef(false);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    abort.current = controller;
    callbacks.current.processing(true);
    void (async () => {
      try {
        const blob = await callbacks.current.getRendered(controller.signal);
        controller.signal.throwIfAborted();
        const bitmap = await decodeDevelopPreview(blob);
        let full: ImageData, analysis: ImageData;
        const fullCanvas = document.createElement("canvas");
        const small = document.createElement("canvas");
        try {
          if (
            bitmap.width < 16 ||
            bitmap.height < 16 ||
            bitmap.width > REMOVE_MAX_EDGE ||
            bitmap.height > REMOVE_MAX_EDGE
          )
            throw new Error("Removal needs a rendered copy up to 4,096 px.");
          controller.signal.throwIfAborted();
          fullCanvas.width = bitmap.width;
          fullCanvas.height = bitmap.height;
          const ctx = fullCanvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) throw new Error("Photo pixels could not be read.");
          ctx.drawImage(bitmap, 0, 0);
          full = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
          const scale = Math.min(1, REMOVE_ANALYSIS_EDGE / Math.max(bitmap.width, bitmap.height));
          small.width = Math.round(bitmap.width * scale);
          small.height = Math.round(bitmap.height * scale);
          const smallContext = small.getContext("2d");
          if (!smallContext) throw new Error("Object preview could not be read.");
          smallContext.drawImage(bitmap, 0, 0, small.width, small.height);
          analysis = smallContext.getImageData(0, 0, small.width, small.height);
        } finally {
          bitmap.close();
          fullCanvas.width = fullCanvas.height = small.width = small.height = 0;
        }
        controller.signal.throwIfAborted();
        setSource(blob);
        setImage(full);
        setBusy("Finding Objects…");
        const found = await findPhotoObjects(analysis, controller.signal);
        if (!controller.signal.aborted && alive.current) setInstances(found);
      } catch (cause) {
        if (!controller.signal.aborted && alive.current)
          setError(cause instanceof Error ? cause.message : "Object selection failed.");
      } finally {
        if (!controller.signal.aborted && alive.current) {
          setBusy("");
          callbacks.current.processing(false);
        }
      }
    })();
    return () => {
      alive.current = false;
      controller.abort();
      abort.current?.abort();
      callbacks.current.processing(false);
    };
  }, []);
  const displayed = showOriginal || !result ? source : result;
  useEffect(() => {
    if (!displayed) {
      setUrl("");
      return;
    }
    const next = URL.createObjectURL(displayed);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [displayed]);
  useEffect(() => {
    const target = canvas.current;
    if (!target || !instances) return;
    target.width = instances.width;
    target.height = instances.height;
    const context = target.getContext("2d");
    if (!context) return;
    const overlay = context.createImageData(instances.width, instances.height),
      ids = new Set(selected);
    for (let i = 0; i < instances.labels.length; i++)
      if (ids.has(instances.labels[i]!)) {
        overlay.data[i * 4] = 255;
        overlay.data[i * 4 + 1] = 220;
        overlay.data[i * 4 + 2] = 240;
        overlay.data[i * 4 + 3] = 110;
      }
    context.putImageData(overlay, 0, 0);
  }, [instances, selected, result]);
  function toggle(id: number) {
    if (busy || !id) return;
    setSelected((ids) => (ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]));
    setResult(null);
    setError("");
    setShowOriginal(false);
  }
  async function remove() {
    if (!image || !instances || !selected.length || busy) return;
    const controller = new AbortController();
    abort.current = controller;
    setBusy("Reconstructing Background…");
    callbacks.current.processing(true);
    setError("");
    try {
      // Yield so feedback paints before bounded full-resolution mask work.
      await new Promise((resolve) => setTimeout(resolve, 0));
      controller.signal.throwIfAborted();
      const mask = objectSelectionMask(instances, selected, image.width, image.height, 3);
      const filled = await removePhotoObjects(image, mask, controller.signal);
      if (alive.current && !controller.signal.aborted) {
        setResult(filled);
        setShowOriginal(false);
      }
    } catch (cause) {
      if (alive.current && !controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Removal failed.");
    } finally {
      if (alive.current) {
        setBusy("");
        callbacks.current.processing(false);
      }
    }
  }
  async function save() {
    if (!result || busy || saving.current) return;
    saving.current = true;
    setBusy("Saving Copy…");
    callbacks.current.processing(true);
    setError("");
    try {
      await callbacks.current.saveCopy(result);
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : "The copy could not be saved.");
    } finally {
      saving.current = false;
      if (alive.current) {
        setBusy("");
        callbacks.current.processing(false);
      }
    }
  }
  const objects = instances
    ? [...new Set(instances.labels)].filter(Boolean).sort((a, b) => a - b)
    : [];
  return (
    <div className="foto-object-remove">
      <p className="develop-hint">
        Click a detected person or object. Save a separate rendered copy, up to 4,096 px. Your
        original and edits stay intact.
      </p>
      {url && (
        <div
          className="foto-object-image"
          style={{
            aspectRatio: image ? `${image.width} / ${image.height}` : undefined,
            width: image
              ? `min(100%, ${(50 * image.width) / image.height}dvh, calc((100dvh - 360px) * ${image.width / image.height}))`
              : undefined,
          }}
        >
          <img
            src={url}
            alt={result && !showOriginal ? "Removal preview" : "Photo before removal"}
          />
          {!result && (
            <button
              type="button"
              className="foto-object-picker"
              aria-label="Click an object in the photo to select it"
              disabled={!!busy || !instances}
              onClick={(event) => {
                if (!instances) return;
                const rect = event.currentTarget.getBoundingClientRect();
                const id = objectAtPoint(
                  instances,
                  (event.clientX - rect.left) / rect.width,
                  (event.clientY - rect.top) / rect.height,
                );
                if (!id) {
                  setError("No distinct object at that point. Choose a detected object below.");
                  return;
                }
                toggle(id);
              }}
            >
              <canvas ref={canvas} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {busy && <p role="status">{busy}</p>}
      {error && <p role="alert">{error}</p>}
      {objects.length > 0 && !result && (
        <div className="foto-object-choices" aria-label="Detected objects">
          {objects.map((id, index) => (
            <button
              type="button"
              key={id}
              disabled={!!busy}
              aria-pressed={selected.includes(id)}
              onClick={() => toggle(id)}
            >
              Object {index + 1}
            </button>
          ))}
        </div>
      )}
      {result && (
        <div className="foto-object-choices">
          <button aria-pressed={showOriginal} onClick={() => setShowOriginal((value) => !value)}>
            Before / After
          </button>
          <button
            disabled={!!busy}
            onClick={() => {
              setResult(null);
              setShowOriginal(false);
            }}
          >
            Adjust Selection
          </button>
        </div>
      )}
      <p className="develop-hint">
        Experimental, on-device texture fill. Best for small objects on simple backgrounds; nearby
        people may be grouped. Review for artifacts. Your original stays untouched.
      </p>
      <div className="develop-dialog-actions">
        <button
          disabled={saving.current}
          onClick={() => {
            abort.current?.abort();
            callbacks.current.close();
          }}
        >
          Cancel
        </button>
        {result ? (
          <button className="develop-primary" disabled={!!busy} onClick={() => void save()}>
            Save Copy
          </button>
        ) : (
          <button
            className="develop-primary"
            disabled={!!busy || !selected.length}
            onClick={() => void remove()}
          >
            Remove Selected
          </button>
        )}
      </div>
    </div>
  );
}
