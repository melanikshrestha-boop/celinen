import { useEffect, useRef, useState } from "react";
import { defaultDevelopSettings, type DevelopSettings } from "@/lib/develop/contract";
import { renderDevelop } from "@/lib/develop/client";
import { fitReferenceLook } from "@/lib/develop/reference";
import type { ReferenceFitResult } from "@/lib/develop/reference-contract";
import { createDevelopPreset, type DevelopPreset } from "@/lib/develop/store";
import { applyReferenceLook } from "@/lib/develop/reference-apply";

function Preview({ blob, label }: { blob: Blob | null; label: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!blob) {
      setUrl("");
      return;
    }
    const value = URL.createObjectURL(blob);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [blob]);
  return (
    <figure>
      {url && <img src={url} alt={label} />}
      <figcaption>{label}</figcaption>
    </figure>
  );
}

export function ReferencePresetDialog({
  sourceName,
  getNeutral,
  apply,
  save,
  close,
  processing,
  current,
}: {
  sourceName: string;
  getNeutral: (signal: AbortSignal) => Promise<Blob>;
  apply: (settings: DevelopSettings) => void;
  save: (preset: DevelopPreset) => Promise<void>;
  close: () => void;
  processing: (busy: boolean) => void;
  current: DevelopSettings;
}) {
  const [file, setFile] = useState<File | null>(null),
    [name, setName] = useState("Matched look");
  const [result, setResult] = useState<ReferenceFitResult | null>(null),
    [error, setError] = useState("");
  const [original, setOriginal] = useState<Blob | null>(null),
    [reference, setReference] = useState<Blob | null>(null),
    [matched, setMatched] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const abort = useRef<AbortController | null>(null),
    alive = useRef(true),
    releaseProcessing = useRef<(() => void) | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abort.current?.abort();
      // Warm photo navigation keeps the parent editor, not this dialog.
      releaseProcessing.current?.();
    };
  }, []);
  async function fit() {
    if (!file || busy || abort.current || !alive.current) return;
    const controller = new AbortController();
    abort.current = controller;
    const release = () => {
      if (abort.current !== controller) return;
      abort.current = null;
      releaseProcessing.current = null;
      processing(false);
    };
    releaseProcessing.current = release;
    setBusy(true);
    processing(true);
    setError("");
    setNotice("");
    setResult(null);
    setMatched(null);
    try {
      const neutral = await getNeutral(controller.signal);
      controller.signal.throwIfAborted();
      const fitted = await fitReferenceLook(neutral, file, { signal: controller.signal });
      controller.signal.throwIfAborted();
      const preview = await renderDevelop(neutral, applyReferenceLook(current, fitted.settings), {
        edge: 1000,
        quality: 0.95,
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      const target = await renderDevelop(file, defaultDevelopSettings(), {
        edge: 1000,
        quality: 0.95,
        signal: controller.signal,
      });
      if (alive.current && abort.current === controller && !controller.signal.aborted) {
        setOriginal(neutral);
        setReference(target);
        setMatched(preview);
        setResult(fitted);
      }
    } catch (cause) {
      if (alive.current && abort.current === controller)
        setError(
          controller.signal.aborted
            ? "Fit cancelled. No edits were applied."
            : cause instanceof Error
              ? cause.message
              : "Reference fit failed.",
        );
    } finally {
      // Cleanup may have released this lease and a replacement may already own
      // the parent lock. A late worker must not release that newer operation.
      if (abort.current === controller) {
        release();
        if (alive.current) setBusy(false);
      }
    }
  }
  return (
    <div className="develop-reference-dialog">
      <p>
        Original: <strong>{sourceName}</strong>. Choose the edited version of this same, uncropped
        frame.
      </p>
      <p className="develop-hint">
        Estimates a reusable look, not the exact edits. Camera profiles, retouching, local masks,
        grain and cropping cannot be reliably recovered from two photographs.
      </p>
      <p className="develop-hint">
        Replaces global color, tone and film effects. Keeps your grain, noise reduction, sharpening,
        crop and masks. Matching uses the Develop sRGB preview; sensor RAW exports can differ.
      </p>
      <label>
        Edited reference
        <input
          aria-label="Edited reference photo"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/tiff,.jpg,.jpeg,.png,.webp,.tif,.tiff"
          disabled={busy}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setResult(null);
            setOriginal(null);
            setReference(null);
            setMatched(null);
            setError("");
            setNotice("");
          }}
        />
      </label>
      <button disabled={!file || busy} onClick={() => void fit()}>
        {busy && !saving ? "Matching the reference…" : "Estimate preset"}
      </button>
      {busy && !saving && <button onClick={() => abort.current?.abort()}>Cancel fitting</button>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {result && (
        <>
          <div className="develop-reference-comparison">
            <Preview blob={original} label="Original" />
            <Preview blob={reference} label="Reference" />
            <Preview blob={matched} label="Estimated look" />
          </div>
          <p>
            Held-out RGB error: {(result.diagnostics.beforeRmse * 255).toFixed(1)} →{" "}
            {(result.diagnostics.afterRmse * 255).toFixed(1)} / 255 (
            {Math.round(result.diagnostics.improvement * 100)}% closer). Measured on the fitted
            global look before your retained detail edits.
          </p>
          {result.warnings.map((warning) => (
            <p className="develop-hint" key={warning}>
              {warning}
            </p>
          ))}
          <label>
            Preset name
            <input
              aria-label="Matched preset name"
              value={name}
              maxLength={100}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="develop-dialog-actions">
            <button
              disabled={busy}
              onClick={() => apply(applyReferenceLook(current, result.settings))}
            >
              Apply estimated look
            </button>
            <button
              disabled={busy || !name.trim()}
              onClick={async () => {
                setBusy(true);
                setSaving(true);
                setError("");
                try {
                  await save(
                    createDevelopPreset(name, applyReferenceLook(current, result.settings)),
                  );
                  if (alive.current)
                    setNotice("Preset saved. Export it from Import / export presets.");
                } catch (cause) {
                  if (alive.current)
                    setError(cause instanceof Error ? cause.message : "Preset could not be saved.");
                } finally {
                  if (alive.current) {
                    setBusy(false);
                    setSaving(false);
                  }
                }
              }}
            >
              {saving ? "Saving preset…" : "Save estimated preset"}
            </button>
          </div>
        </>
      )}
      <div className="develop-dialog-actions">
        <button disabled={busy} onClick={close}>
          Done
        </button>
      </div>
    </div>
  );
}
