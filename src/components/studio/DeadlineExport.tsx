import { useCallback, useEffect, useRef, useState } from "react";
import type { Shot } from "@/lib/imaging";
import {
  assertDeadlinePlanCurrent,
  createDeadlineDownload,
  createDeadlinePlan,
  prepareDeadlineExport,
  type DeadlineAttempt,
  type DeadlinePlan,
  type DeadlineRecipe,
} from "@/lib/studio/deadline-export";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const fieldClass =
  "mt-1 w-full bg-transparent py-1.5 text-ink outline-none focus:ring-1 focus:ring-moss disabled:opacity-50";
const actionClass = "rounded-md bg-ink px-4 py-2 text-paper2 disabled:opacity-40";

/** Secondary workflow only: no changes to the Studio shell, chat rail or edit desk. */
export function DeadlineExport({
  open,
  onOpenChange,
  shots,
  initialCount = 20,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  shots: Shot[];
  initialCount?: number;
}) {
  const current = useRef(shots);
  current.current = shots;
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [recipe, setRecipe] = useState<DeadlineRecipe>({
    count: 20,
    longestEdge: 2048,
    quality: 0.92,
    prefix: "press",
    caption: "",
    copyright: "",
  });
  const [plan, setPlan] = useState<DeadlinePlan | null>(null);
  const [attempt, setAttempt] = useState<DeadlineAttempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const keeperCount = shots.filter((shot) => shot.verdict === "keep").length;
  const invalidateJob = useCallback(() => {
    generation.current++;
    controller.current?.abort();
  }, []);

  useEffect(() => {
    invalidateJob();
    setBusy(false);
    setPlan(null);
    setAttempt(null);
    setStatus("");
    setProgress(0);
    if (open)
      setRecipe((value) => ({
        ...value,
        count: Math.min(
          200,
          Math.max(1, initialCount),
          Math.max(1, current.current.filter((shot) => shot.verdict === "keep").length),
        ),
      }));
    return invalidateJob;
  }, [open, initialCount, invalidateJob]);

  let stale = false;
  if (plan) {
    try {
      assertDeadlinePlanCurrent(plan, shots);
    } catch {
      stale = true;
    }
  }
  const ready =
    !!attempt &&
    !attempt.cancelled &&
    !attempt.failures.length &&
    attempt.images.length === plan?.frames.length;
  const reset = () => {
    setPlan(null);
    setAttempt(null);
    setStatus("");
    setProgress(0);
  };
  const updateRecipe = <K extends keyof DeadlineRecipe>(key: K, value: DeadlineRecipe[K]) =>
    setRecipe((previous) => ({ ...previous, [key]: value }));
  const preview = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      setPlan(createDeadlinePlan(current.current, recipe));
      setAttempt(null);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not preview this deadline set.");
    }
  };
  const prepare = async () => {
    if (!plan || busy || stale) return;
    const token = ++generation.current;
    controller.current = new AbortController();
    setBusy(true);
    setStatus("Preparing JPEGs locally…");
    try {
      const next = await prepareDeadlineExport(plan, () => current.current, {
        signal: controller.current.signal,
        ...(attempt ? { previous: attempt } : {}),
        onProgress: (done) => {
          if (generation.current === token) setProgress(done);
        },
      });
      if (generation.current !== token) return;
      setAttempt(next);
      setStatus(
        next.cancelled
          ? `Stopped. ${next.images.length} JPEGs are ready; resume to finish this set.`
          : next.failures.length
            ? `${next.failures.length} frames failed. Nothing was downloaded; retry to complete the set.`
            : `${next.images.length} JPEGs verified. Review the set and approve its local download.`,
      );
    } catch (error) {
      if (generation.current === token)
        setStatus(error instanceof Error ? error.message : "Could not prepare this set.");
    } finally {
      if (generation.current === token) setBusy(false);
    }
  };
  const download = async () => {
    if (!attempt || busy || stale || !ready) return;
    const token = ++generation.current;
    controller.current = new AbortController();
    setBusy(true);
    setStatus("Verifying the complete ZIP…");
    try {
      const result = await createDeadlineDownload(
        attempt,
        () => current.current,
        controller.current.signal,
      );
      if (generation.current !== token || controller.current.signal.aborted) return;
      assertDeadlinePlanCurrent(attempt.plan, current.current);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setStatus(
        "ZIP download requested. Nothing was sent to a client; confirm the download in your browser.",
      );
    } catch (error) {
      if (generation.current === token)
        setStatus(error instanceof Error ? error.message : "Could not create this download.");
    } finally {
      if (generation.current === token) setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) controller.current?.abort();
        onOpenChange(value);
      }}
    >
      <DialogContent className="max-h-[88vh] overflow-y-auto border-0 bg-paper p-6 text-ink shadow-none sm:max-w-xl">
        <DialogTitle>Deadline set</DialogTitle>
        <DialogDescription className="text-moss">
          Your first delivery, from keepers you already chose. One local ZIP; originals and picks
          stay untouched.
        </DialogDescription>
        {!plan ? (
          <form onSubmit={preview} className="space-y-4 text-sm">
            <p className="text-moss">
              {keeperCount} keepers available · Studio order · up to 200 per set
            </p>
            <div className="grid grid-cols-3 gap-4">
              <label>
                Photo count
                <input
                  aria-label="Deadline photo count"
                  type="number"
                  min={1}
                  max={Math.min(200, keeperCount || 200)}
                  required
                  value={recipe.count}
                  onChange={(event) => updateRecipe("count", Number(event.target.value))}
                  className={fieldClass}
                />
              </label>
              <label>
                Longest edge
                <select
                  aria-label="Deadline longest edge"
                  value={recipe.longestEdge}
                  onChange={(event) => updateRecipe("longestEdge", Number(event.target.value))}
                  className={fieldClass}
                >
                  <option value={2048}>2048 px</option>
                  <option value={1600}>1600 px</option>
                  <option value={1200}>1200 px</option>
                </select>
              </label>
              <label>
                JPEG quality
                <input
                  aria-label="Deadline JPEG quality"
                  type="number"
                  min={50}
                  max={100}
                  required
                  value={Math.round(recipe.quality * 100)}
                  onChange={(event) => updateRecipe("quality", Number(event.target.value) / 100)}
                  className={fieldClass}
                />
              </label>
            </div>
            <label className="block">
              Filename prefix
              <input
                aria-label="Deadline filename prefix"
                value={recipe.prefix}
                maxLength={200}
                onChange={(event) => updateRecipe("prefix", event.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="block">
              Caption <span className="text-moss">· optional, sidecar only</span>
              <textarea
                aria-label="Deadline caption"
                value={recipe.caption}
                maxLength={2000}
                rows={2}
                onChange={(event) => updateRecipe("caption", event.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="block">
              Copyright <span className="text-moss">· optional, sidecar only</span>
              <input
                aria-label="Deadline copyright"
                value={recipe.copyright}
                maxLength={300}
                onChange={(event) => updateRecipe("copyright", event.target.value)}
                className={fieldClass}
              />
            </label>
            {!keeperCount && (
              <p>
                Mark your keepers in Studio first. Rejected and undecided photos are never added
                automatically.
              </p>
            )}
            <button type="submit" disabled={!keeperCount} className={actionClass}>
              Preview deadline set
            </button>
          </form>
        ) : (
          <div className="space-y-4 text-sm">
            <p>
              {plan.frames.length} keepers · {plan.recipe.longestEdge} px maximum ·{" "}
              {Math.round(plan.recipe.quality * 100)}% JPEG
            </p>
            <ol aria-label="Deadline export preview" className="max-h-52 space-y-2 overflow-y-auto">
              {plan.frames.map((frame) => (
                <li key={frame.id} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate" title={frame.relativePath}>
                    {frame.name}
                  </span>
                  <span className="shrink-0 text-moss">{frame.filename}</span>
                </li>
              ))}
            </ol>
            <p className="text-xs leading-relaxed text-moss">
              Uses the existing Studio browser renderer, including your crop and warmth—not the
              native C++ renderer. Caption and copyright are in manifest.json, not embedded IPTC.
              RAW files use embedded previews, not RAW development. Reconnect missing originals
              first. Maximum ZIP size: 100 MiB.
            </p>
            {stale && (
              <p role="alert">
                The shoot changed. Preview a fresh set so the files, picks and edits match.
              </p>
            )}
            {!!attempt?.failures.length && (
              <ul
                aria-label="Deadline export failures"
                className="max-h-32 space-y-1 overflow-y-auto text-destructive"
              >
                {attempt.failures.map((failure) => (
                  <li key={failure.id}>
                    {failure.name}: {failure.message}
                  </li>
                ))}
              </ul>
            )}
            {busy && (
              <p aria-live="polite">
                {progress} / {plan.frames.length} prepared
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {busy ? (
                <button
                  type="button"
                  className={actionClass}
                  onClick={() => controller.current?.abort()}
                >
                  Cancel
                </button>
              ) : ready ? (
                <button
                  type="button"
                  disabled={stale}
                  onClick={() => void download()}
                  className={actionClass}
                >
                  Download deadline set
                </button>
              ) : (
                <button
                  type="button"
                  disabled={stale}
                  onClick={() => void prepare()}
                  className={actionClass}
                >
                  {attempt?.cancelled
                    ? "Resume preparation"
                    : attempt?.failures.length
                      ? "Retry failed frames"
                      : "Prepare JPEGs"}
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={reset}
                className="px-2 py-2 text-moss disabled:opacity-40"
              >
                {stale ? "Preview fresh set" : "Change recipe"}
              </button>
            </div>
          </div>
        )}
        {status && (
          <p role="status" className="text-sm text-moss">
            {status}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
