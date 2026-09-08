import { useEffect, useRef, useState } from "react";
import type { DevelopSettings } from "@/lib/develop/contract";
import { renderDevelop } from "@/lib/develop/client";
import { suggestAutoCrop, type AutoCropResult } from "@/lib/develop/auto-crop";

export function AutoCropDialog({
  current,
  getNeutral,
  apply,
  processing,
  close,
}: {
  current: DevelopSettings;
  getNeutral: (signal: AbortSignal) => Promise<Blob>;
  apply: (crop: DevelopSettings["crop"]) => void;
  processing: (busy: boolean) => void;
  close: () => void;
}) {
  const [aspect, setAspect] = useState("original");
  const [result, setResult] = useState<AutoCropResult | null>(null);
  const [preview, setPreview] = useState<Blob | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abort.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!preview) {
      setUrl("");
      return;
    }
    const next = URL.createObjectURL(preview);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [preview]);
  async function analyze() {
    if (busy) return;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    processing(true);
    setResult(null);
    setPreview(null);
    setError("");
    try {
      const source = await getNeutral(controller.signal);
      const proposal = await suggestAutoCrop(
        source,
        { aspect: aspect === "original" ? null : Number(aspect) },
        controller.signal,
      );
      const rendered = await renderDevelop(
        source,
        { ...current, crop: proposal.crop },
        { edge: 1000, quality: 0.95, signal: controller.signal },
      );
      if (alive.current && !controller.signal.aborted) {
        setResult(proposal);
        setPreview(rendered);
      }
    } catch (cause) {
      if (alive.current)
        setError(
          controller.signal.aborted
            ? "Cancelled. Your crop is unchanged."
            : cause instanceof Error
              ? cause.message
              : "Crop analysis failed.",
        );
    } finally {
      abort.current = null;
      if (alive.current) {
        setBusy(false);
        processing(false);
      }
    }
  }
  return (
    <div className="develop-auto-crop-dialog">
      <p>
        A local edge and composition analysis suggests a crop and level horizon. Review it before
        applying; this is not subject-recognition AI.
      </p>
      <label>
        Target format{" "}
        <select
          aria-label="Automatic crop aspect"
          value={aspect}
          disabled={busy}
          onChange={(e) => {
            setAspect(e.target.value);
            setResult(null);
            setPreview(null);
          }}
        >
          <option value="original">Original proportions</option>
          <option value="1">Square · 1:1</option>
          <option value="0.8">Portrait · 4:5</option>
          <option value="1.5">Landscape · 3:2</option>
          <option value="1.7777777778">Widescreen · 16:9</option>
          <option value="0.5625">Story · 9:16</option>
        </select>
      </label>
      <div className="develop-dialog-actions">
        <button disabled={busy} onClick={() => void analyze()}>
          {busy ? "Analyzing composition…" : "Suggest crop"}
        </button>
        {busy && <button onClick={() => abort.current?.abort()}>Cancel analysis</button>}
      </div>
      {error && <p role="alert">{error}</p>}
      {result && (
        <>
          {url && (
            <img className="develop-auto-crop-preview" src={url} alt="Suggested crop preview" />
          )}
          <p>
            {result.confidence[0]!.toUpperCase() + result.confidence.slice(1)} confidence ·{" "}
            {Math.round(result.analysis.retainedArea * 100)}% of the frame retained ·{" "}
            {result.crop.angle.toFixed(1)}° straighten
          </p>
          {result.reasons.map((reason) => (
            <p className="develop-hint" key={reason}>
              {reason}
            </p>
          ))}
          <p className="develop-hint">
            Applying replaces the current crop, rotation and flips. Color, detail and masks stay
            intact. Undo restores your previous crop.
          </p>
        </>
      )}
      <div className="develop-dialog-actions">
        <button disabled={busy} onClick={close}>
          Cancel
        </button>
        <button disabled={busy || !result} onClick={() => result && apply(result.crop)}>
          Apply suggested crop
        </button>
      </div>
    </div>
  );
}
