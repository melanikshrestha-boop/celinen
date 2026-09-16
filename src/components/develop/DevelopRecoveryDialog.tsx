import { useLayoutEffect, useId, useMemo, useRef, useState } from "react";
import {
  DEVELOP_RECOVERY_LIMITS,
  parseDevelopRecovery,
  prepareDevelopRecovery,
  type createDevelopStore,
  type DevelopDocument,
  type DevelopLibrary,
  type DevelopRecovery,
  type DevelopRecoveryPlan,
} from "@/lib/develop/store";
import { developRecoveryAvailability } from "./recovery-state";
import "./develop-recovery.css";

export type DevelopRecoveryDialogProps = {
  store: ReturnType<typeof createDevelopStore>;
  scope: string;
  libraryId: string;
  onClose: () => void;
  /** Adopt transaction receipts immediately, even if the subsequent full library read fails. */
  onCommitted?: (documents: DevelopDocument[]) => void;
  onRestored: (library: DevelopLibrary) => void;
  onBusyChange?: (busy: boolean) => void;
};
type LoadedRecovery = { fileName: string; recovery: DevelopRecovery; library: DevelopLibrary };
type SavedRecovery = { restored: number; unchanged: number };

function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Recovery could not finish. Your original files are untouched.";
}

/** Content only. The parent owns the dialog heading, focus trap and outside-click/Escape guard. */
export function DevelopRecoveryDialog({
  store,
  scope,
  libraryId,
  onClose,
  onCommitted,
  onRestored,
  onBusyChange,
}: DevelopRecoveryDialogProps) {
  const [loaded, setLoaded] = useState<LoadedRecovery | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [plan, setPlan] = useState<DevelopRecoveryPlan | null>(null);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<SavedRecovery | null>(null);
  const [refreshed, setRefreshed] = useState(false);
  const generation = useRef(0),
    alive = useRef(true),
    locked = useRef(false);
  const owner = useRef({ store, scope, libraryId });
  owner.current = { store, scope, libraryId };
  const callbacks = useRef({ onBusyChange, onCommitted, onRestored });
  callbacks.current = { onBusyChange, onCommitted, onRestored };
  const descriptionId = useId(),
    errorId = useId();
  const availability = useMemo(
    () =>
      loaded
        ? developRecoveryAvailability(loaded.recovery, loaded.library)
        : { photos: [], missingPhotoIds: [] },
    [loaded],
  );

  // Initialize the operation owner before the chooser becomes interactable.
  // A passive mount effect could otherwise invalidate a file read started first.
  useLayoutEffect(() => {
    alive.current = true;
    generation.current += 1;
    locked.current = false;
    setLoaded(null);
    setSelected(new Set());
    setPlan(null);
    setStage("");
    setError("");
    setSaved(null);
    setRefreshed(false);
    return () => {
      alive.current = false;
      generation.current += 1;
      locked.current = false;
      callbacks.current.onBusyChange?.(false);
    };
  }, [store, scope, libraryId]);

  function begin(message: string): number | null {
    if (locked.current) return null;
    locked.current = true;
    const token = ++generation.current;
    setStage(message);
    setError("");
    callbacks.current.onBusyChange?.(true);
    return token;
  }
  function active(token: number) {
    return (
      alive.current &&
      owner.current.store === store &&
      owner.current.scope === scope &&
      owner.current.libraryId === libraryId &&
      generation.current === token
    );
  }
  function finish(token: number) {
    if (!active(token)) return;
    locked.current = false;
    setStage("");
    callbacks.current.onBusyChange?.(false);
  }
  async function chooseFile(file: File) {
    const token = begin("Reading recovery file…");
    if (token === null) return;
    setLoaded(null);
    setSelected(new Set());
    setPlan(null);
    setSaved(null);
    setRefreshed(false);
    try {
      if (!file.size) throw new Error("Choose a recovery JSON file that is not empty.");
      if (file.size > DEVELOP_RECOVERY_LIMITS.maxBytes)
        throw new Error("Recovery files must be no larger than 32 MB.");
      const text = await file.text();
      if (!active(token)) return;
      const recovery = parseDevelopRecovery(text, { scope, libraryId });
      const library = await store.loadLibrary();
      if (!active(token)) return;
      setLoaded({ fileName: file.name, recovery, library });
    } catch (cause) {
      if (active(token)) setError(errorText(cause));
    } finally {
      finish(token);
    }
  }
  function selectPhoto(id: string, checked: boolean) {
    if (locked.current || saved) return;
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    setPlan(null);
    setError("");
  }
  async function previewSelection() {
    if (!loaded || !selected.size || saved) return;
    const token = begin("Preparing recovery preview…");
    if (token === null) return;
    setPlan(null);
    try {
      const library = await store.loadLibrary();
      if (!active(token)) return;
      const availableIds = new Set(
        developRecoveryAvailability(loaded.recovery, library).photos.map((photo) => photo.id),
      );
      setLoaded({ ...loaded, library });
      // Any disappeared selection aborts this preview; it can never be silently applied.
      if ([...selected].some((id) => !availableIds.has(id))) {
        setSelected(new Set([...selected].filter((id) => availableIds.has(id))));
        throw new Error(
          "A selected photo is no longer in this project. Review the remaining selection and preview again.",
        );
      }
      setPlan(
        prepareDevelopRecovery(loaded.recovery, library, {
          scope,
          libraryId,
          photoIds: [...selected],
        }),
      );
    } catch (cause) {
      if (active(token)) setError(errorText(cause));
    } finally {
      finish(token);
    }
  }
  async function reloadSaved(token: number) {
    const library = await store.loadLibrary();
    if (!active(token)) return;
    callbacks.current.onRestored(library);
    if (active(token)) setRefreshed(true);
  }
  async function confirmRestore() {
    if (!loaded || !plan || !plan.updates.length || saved) return;
    const token = begin("Restoring selected edits…");
    if (token === null) return;
    let committed = false;
    try {
      const result = await store.restoreRecovery(loaded.recovery, {
        photoIds: plan.photoIds,
        expectedRevisions: plan.expectedRevisions,
      });
      if (!active(token)) return;
      committed = true;
      setSaved({
        restored: result.restoredPhotoIds.length,
        unchanged: result.unchangedPhotoIds.length,
      });
      setPlan(null);
      // A committed recipe must reach the editor before a fallible full-library
      // refresh. Otherwise closing its error state could expose the stale render.
      callbacks.current.onCommitted?.(result.documents);
      await reloadSaved(token);
    } catch (cause) {
      if (active(token)) {
        setPlan(null);
        setError(
          committed
            ? `Recovery was saved, but the workspace could not refresh. ${errorText(cause)}`
            : `${errorText(cause)} Preview the selection again before retrying.`,
        );
      }
    } finally {
      finish(token);
    }
  }
  async function retryReload() {
    if (!saved || refreshed) return;
    const token = begin("Reloading saved edits…");
    if (token === null) return;
    try {
      await reloadSaved(token);
    } catch (cause) {
      if (active(token)) setError(`Recovery is already saved. ${errorText(cause)}`);
    } finally {
      finish(token);
    }
  }

  return (
    <div className="develop-recovery" aria-busy={Boolean(stage)}>
      <p id={descriptionId}>
        Restore adjustments from a Celinen recovery file. Originals, ratings and saved history stay
        intact.
      </p>
      <fieldset disabled={Boolean(stage) || Boolean(saved)} className="develop-recovery-fields">
        <label className="develop-recovery-file">
          Recovery JSON file
          <input
            type="file"
            accept=".json,application/json"
            aria-describedby={descriptionId}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void chooseFile(file);
            }}
          />
        </label>
        {loaded && (
          <>
            <p className="develop-recovery-filename" title={loaded.fileName}>
              {loaded.fileName}
            </p>
            <div className="develop-recovery-selection-bar">
              <span>
                {availability.photos.length} photos found · {selected.size} selected
              </span>
              <div>
                <button
                  type="button"
                  disabled={!availability.photos.length}
                  onClick={() => {
                    if (locked.current) return;
                    setSelected(new Set(availability.photos.map((photo) => photo.id)));
                    setPlan(null);
                    setError("");
                  }}
                >
                  Select all
                </button>
                <button
                  type="button"
                  disabled={!selected.size}
                  onClick={() => {
                    if (locked.current) return;
                    setSelected(new Set());
                    setPlan(null);
                    setError("");
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
            {availability.photos.length > 0 && (
              <div
                className="develop-recovery-photo-list"
                role="group"
                aria-label="Photos available for recovery"
              >
                {availability.photos.map((photo) => (
                  <label key={photo.id} className="develop-recovery-photo">
                    <input
                      type="checkbox"
                      checked={selected.has(photo.id)}
                      onChange={(event) => selectPhoto(photo.id, event.currentTarget.checked)}
                    />
                    <span title={photo.name}>{photo.name}</span>
                  </label>
                ))}
              </div>
            )}
            {availability.missingPhotoIds.length > 0 && (
              <p className="develop-recovery-missing">
                {availability.missingPhotoIds.length} recovery photos are not in this project and
                will not be restored.
              </p>
            )}
          </>
        )}
      </fieldset>
      {plan && (
        <p className="develop-recovery-preview" role="status">
          {plan.updates.length
            ? `${plan.updates.length} photos will receive a new, undoable recovery step.`
            : "The selected photos already match this recovery."}
          {plan.unchangedPhotoIds.length > 0 && plan.updates.length > 0
            ? ` ${plan.unchangedPhotoIds.length} already match and will stay unchanged.`
            : ""}
        </p>
      )}
      {saved && (
        <p role="status">
          {saved.restored} photos restored.
          {saved.unchanged ? ` ${saved.unchanged} already matched.` : ""}
          {refreshed ? " Edits are saved." : " Reload the workspace to view the saved edits."}
        </p>
      )}
      {error && (
        <p id={errorId} className="develop-recovery-error" role="alert">
          {error}
        </p>
      )}
      {stage && (
        <p className="develop-recovery-status" role="status">
          {stage}
        </p>
      )}
      <div className="develop-dialog-actions">
        <button
          type="button"
          disabled={Boolean(stage)}
          onClick={() => {
            if (!locked.current) onClose();
          }}
        >
          {saved ? "Done" : "Cancel"}
        </button>
        {saved && !refreshed ? (
          <button
            type="button"
            className="develop-primary"
            disabled={Boolean(stage)}
            onClick={() => void retryReload()}
          >
            Reload saved edits
          </button>
        ) : !saved && plan && plan.updates.length > 0 ? (
          <button
            type="button"
            className="develop-primary"
            disabled={Boolean(stage)}
            aria-describedby={error ? errorId : undefined}
            onClick={() => void confirmRestore()}
          >
            Restore {plan.updates.length} photos
          </button>
        ) : !saved && !plan ? (
          <button
            type="button"
            className="develop-primary"
            disabled={Boolean(stage) || !loaded || !selected.size}
            onClick={() => void previewSelection()}
          >
            Preview selected
          </button>
        ) : null}
      </div>
    </div>
  );
}
