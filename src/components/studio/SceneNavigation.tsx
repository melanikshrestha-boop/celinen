import { useEffect, useMemo, useRef, useState } from "react";
import type { BurstFrame } from "@/lib/studio/bursts";
import {
  requestSceneNavigation,
  sceneEvidenceState,
  sceneReasonLabel,
  type SceneNavigationResult,
} from "@/lib/studio/scene-navigation";

export interface SceneNavigationProps {
  open: boolean;
  shots: readonly BurstFrame[];
  scopeKey: string;
  onSelect: (frameIds: readonly string[] | null) => void;
  onQueueFocus?: () => void;
}

export function SceneNavigation({
  open,
  shots,
  scopeKey,
  onSelect,
  onQueueFocus,
}: SceneNavigationProps) {
  const [receipt, setReceipt] = useState<{
    key: string;
    result: SceneNavigationResult | null;
    error: string;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState("");
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  // Exclude photographer picks: navigating/reviewing must not restart grouping.
  const evidence = useMemo(
    () => sceneEvidenceState(shots, scopeKey, open),
    [shots, scopeKey, open],
  );
  const requestKey = JSON.stringify([evidence.key, retry]);
  // Fence at render time, before the previous effect's cleanup has run.
  const latestKey = useRef(requestKey);
  latestKey.current = requestKey;
  const result = receipt?.key === requestKey ? receipt.result : null;
  const error = evidence.error || (receipt?.key === requestKey ? receipt.error : "");
  useEffect(() => {
    const controller = new AbortController();
    setReceipt(null);
    setSelected("");
    selectRef.current(null);
    if (open && !evidence.error)
      void requestSceneNavigation(shotsRef.current, { signal: controller.signal })
        .then((next) => {
          if (!controller.signal.aborted && latestKey.current === requestKey)
            setReceipt({ key: requestKey, result: next, error: "" });
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted && latestKey.current === requestKey)
            setReceipt({
              key: requestKey,
              result: null,
              error: cause instanceof Error ? cause.message : "Scene navigation unavailable.",
            });
        });
    return () => controller.abort();
  }, [open, requestKey, evidence.error]);
  if (!open) return null;
  if (error)
    return (
      <span className="text-xs text-muted-foreground" role="status">
        {error}
        <button
          type="button"
          className="ml-2 underline"
          onClick={() => setRetry((value) => value + 1)}
        >
          Retry scene navigation
        </button>
      </span>
    );
  return (
    <select
      aria-label="Scene navigation"
      className="h-8 max-w-64 rounded-md border border-input bg-background px-2 text-xs"
      title={result?.limitations ?? "Finding possible scene changes from preview evidence."}
      disabled={!result}
      value={result ? selected : ""}
      onChange={(event) => {
        if (latestKey.current !== requestKey || !result) return;
        const value = event.target.value;
        setSelected(value);
        const [kind, index] = value.split(":");
        const group = result?.groups[Number(index)];
        onSelect(
          !value || !group
            ? null
            : kind === "outlier"
              ? group.possibleVisualOutlierIds
              : group.frameIds,
        );
        event.currentTarget.blur();
        onQueueFocus?.();
      }}
    >
      <option value="">
        {result ? `All scenes (${shots.length})` : "Finding scene suggestions…"}
      </option>
      {result?.groups.map((group, index) => (
        <option key={group.frameIds[0]} value={`scene:${index}`}>
          {index + 1} · {sceneReasonLabel[group.reason]} ({group.frameIds.length})
        </option>
      ))}
      {result?.groups.flatMap((group, index) =>
        group.possibleVisualOutlierIds.length
          ? [
              <option key={`outlier:${index}`} value={`outlier:${index}`}>
                Possible visual outliers ({group.possibleVisualOutlierIds.length}) · {index + 1}
              </option>,
            ]
          : [],
      )}
    </select>
  );
}
