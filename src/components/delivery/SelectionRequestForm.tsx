import { useEffect, useState } from "react";
import {
  selectionRequest,
  selectionsLocked,
  validateSelectionRequest,
  type DeliveryState,
  type SelectionRequest,
} from "@/lib/delivery/workflow";
import { messageOf } from "./presentation";

function localDateTime(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function SelectionRequestForm({
  state,
  busy,
  save,
  onDirty,
}: {
  state: DeliveryState;
  busy: boolean;
  save: (request: SelectionRequest) => Promise<void>;
  onDirty: (dirty: boolean) => void;
}) {
  const [baseline, setBaseline] = useState(selectionRequest(state));
  const [limit, setLimit] = useState(String(state.selectionLimit));
  const [deadline, setDeadline] = useState(localDateTime(state.selectionDeadline ?? null));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const dirty =
    limit !== String(baseline.selectionLimit) ||
    deadline !== localDateTime(baseline.selectionDeadline);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  return (
    <form
      className="delivery-form delivery-selection-request-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        setSaved(false);
        try {
          if (JSON.stringify(selectionRequest(state)) !== JSON.stringify(baseline))
            throw new Error(
              "The selection request changed. Close and reopen these controls before saving.",
            );
          const request = validateSelectionRequest(
            state,
            {
              selectionLimit: Number(limit),
              selectionDeadline: deadline ? new Date(deadline).toISOString() : null,
            },
            new Date().toISOString(),
          );
          await save(request);
          setBaseline(request);
          setSaved(true);
        } catch (cause) {
          setError(messageOf(cause));
        }
      }}
    >
      <h3>Selection request</h3>
      <div className="delivery-form-row">
        <label>
          Maximum selections
          <input
            type="number"
            min={Math.max(1, state.picks.length)}
            max={3000}
            required
            value={limit}
            disabled={busy || selectionsLocked(state)}
            onChange={(e) => {
              setLimit(e.target.value);
              setSaved(false);
            }}
          />
        </label>
        <label>
          Selection deadline (optional)
          <input
            type="datetime-local"
            value={deadline}
            max={localDateTime(state.expiresAt)}
            disabled={busy || selectionsLocked(state)}
            onChange={(e) => {
              setDeadline(e.target.value);
              setSaved(false);
            }}
          />
        </label>
      </div>
      <p className="delivery-meta">
        Your local time. After this deadline, picks stay saved; new selections and submissions
        pause. Comments and approved downloads stay available until gallery expiry. No reminder
        emails are sent.
      </p>
      {selectionsLocked(state) && (
        <p className="delivery-meta">Reopen submitted selections before changing this request.</p>
      )}
      <button className="delivery-primary" disabled={busy || !dirty || selectionsLocked(state)}>
        Save selection request
      </button>
      {error && (
        <p role="alert" className="delivery-error">
          {error}
        </p>
      )}
      {saved && <p role="status">Selection request saved.</p>}
    </form>
  );
}
