import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { developEngineStatus, renderDevelop } from "@/lib/develop/client";
import { defaultDevelopSettings } from "@/lib/develop/contract";
import {
  DEVELOP_RECONNECT_LIMITS,
  planDevelopReconnect,
  type DevelopReconnectPlan,
  type DevelopReconnectStatus,
} from "@/lib/develop/reconnect-plan";
import { runDevelopReconnect } from "@/lib/develop/reconnect";
import type { createDevelopStore, DevelopImportCommit, DevelopPhoto } from "@/lib/develop/store";
import "./develop-reconnect.css";

export type DevelopReconnectDialogProps = {
  store: ReturnType<typeof createDevelopStore>;
  onClose: () => void;
  /** Adopt each durable attachment before any later operation can fail. */
  onCommitted: (commit: DevelopImportCommit) => void;
  onBusyChange?: (busy: boolean) => void;
};
type ReconnectReport = Awaited<ReturnType<typeof runDevelopReconnect>>;
type Stage = "scan" | "attach" | null;
const PAGE_SIZE = 40;
const ISSUE_PAGE_SIZE = 10;
const statuses: DevelopReconnectStatus[] = [
  "verified",
  "unverified",
  "ambiguous",
  "mismatch",
  "unmatched",
];
const statusLabels: Record<DevelopReconnectStatus, string> = {
  verified: "Verified",
  unverified: "Filename only",
  ambiguous: "Ambiguous",
  mismatch: "Does not match",
  unmatched: "Not found",
};
const photoTypes = "image/*,.arw,.nef,.cr2,.cr3,.dng,.raf,.orf,.rw2,.pef,.raw";
const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Reconnect could not finish. Existing originals are unchanged.";

async function decodeOriginal(file: File, photo: DevelopPhoto, signal: AbortSignal) {
  signal.throwIfAborted();
  let previewBlob: Blob;
  let previewOrigin: "unknown" | "raw-demosaic" | "raster" = photo.isRaw ? "unknown" : "raster";
  try {
    previewBlob = await renderDevelop(file, defaultDevelopSettings(), { edge: 1600, signal });
  } catch (error) {
    signal.throwIfAborted();
    if (!photo.isRaw || !(await developEngineStatus())?.rawSupported) throw error;
    signal.throwIfAborted();
    previewBlob = await renderDevelop(file, defaultDevelopSettings(), {
      edge: 1600,
      sourceMode: "raw",
      signal,
    });
    previewOrigin = "raw-demosaic";
  }
  signal.throwIfAborted();
  const bitmap = await createImageBitmap(previewBlob);
  try {
    signal.throwIfAborted();
    return { previewBlob, width: bitmap.width, height: bitmap.height, previewOrigin };
  } finally {
    bitmap.close();
  }
}

/** Content only: the parent owns the heading, focus trap and Escape/outside-click guard. */
export function DevelopReconnectDialog({
  store,
  onClose,
  onCommitted,
  onBusyChange,
}: DevelopReconnectDialogProps) {
  const [plan, setPlan] = useState<DevelopReconnectPlan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [stage, setStage] = useState<Stage>(null);
  const [progress, setProgress] = useState("");
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<ReconnectReport | null>(null);
  const [committedCount, setCommittedCount] = useState(0);
  const [requestedCount, setRequestedCount] = useState(0);
  const [filter, setFilter] = useState<DevelopReconnectStatus | "all">("all");
  const [page, setPage] = useState(0);
  const [warningPage, setWarningPage] = useState(0);
  const [failurePage, setFailurePage] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const matchList = useRef<HTMLUListElement>(null);
  const alive = useRef(false);
  const generation = useRef(0);
  const operation = useRef<{
    token: number;
    stage: Exclude<Stage, null>;
    abort: AbortController;
  } | null>(null);
  const owner = useRef(store);
  owner.current = store;
  const callbacks = useRef({ onClose, onCommitted, onBusyChange });
  callbacks.current = { onClose, onCommitted, onBusyChange };
  const descriptionId = useId();
  const identityId = useId();

  useLayoutEffect(() => {
    alive.current = true;
    generation.current++;
    setPlan(null);
    setSelected(new Set());
    setStage(null);
    setProgress("");
    setStopping(false);
    setError("");
    setReport(null);
    setCommittedCount(0);
    setRequestedCount(0);
    setFilter("all");
    setPage(0);
    setWarningPage(0);
    setFailurePage(0);
    return () => {
      alive.current = false;
      // This is an operation counter, not a DOM ref: invalidate the latest run.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      operation.current?.abort.abort();
      operation.current = null;
      callbacks.current.onBusyChange?.(false);
    };
  }, [store]);

  function active(token: number) {
    return alive.current && owner.current === store && generation.current === token;
  }
  function begin(nextStage: Exclude<Stage, null>) {
    if (!alive.current || owner.current !== store || operation.current) return null;
    const next = { token: ++generation.current, stage: nextStage, abort: new AbortController() };
    operation.current = next;
    setStage(nextStage);
    setStopping(false);
    setError("");
    callbacks.current.onBusyChange?.(true);
    return next;
  }
  function finish(token: number) {
    if (!active(token)) return;
    operation.current = null;
    setStage(null);
    setProgress("");
    setStopping(false);
    callbacks.current.onBusyChange?.(false);
  }
  function cancelOperation() {
    const current = operation.current;
    if (!current || owner.current !== store) return;
    current.abort.abort();
    if (current.stage === "scan") {
      // A partly scanned folder cannot prove uniqueness; never expose its matches.
      finish(current.token);
      generation.current++;
      setPlan(null);
      setSelected(new Set());
      setError("Scan cancelled. Nothing was changed. Choose files again to review originals.");
    } else {
      // Do not invalidate receipts from a transaction already in flight.
      setStopping(true);
      setProgress("Stopping after the current attachment. Saved attachments will stay connected.");
    }
  }

  async function chooseFiles(files: FileList | readonly File[]) {
    if (!alive.current || owner.current !== store || operation.current) return;
    if (files.length > DEVELOP_RECONNECT_LIMITS.maxFiles) {
      setPlan(null);
      setSelected(new Set());
      setError("Choose at most 10,000 files for one scan. Nothing was changed.");
      return;
    }
    if (!files.length) return;
    const batch = Array.from(files); // Preserve duplicate filenames and folder paths.
    const current = begin("scan");
    if (!current) return;
    setPlan(null);
    setSelected(new Set());
    setReport(null);
    setCommittedCount(0);
    setRequestedCount(0);
    setPage(0);
    setWarningPage(0);
    setFailurePage(0);
    setFilter("all");
    setProgress("Reading this project's missing originals…");
    try {
      const library = await store.loadLibrary();
      if (!active(current.token) || current.abort.signal.aborted) return;
      const result = await planDevelopReconnect(library.photos, batch, {
        namespace: store.namespace,
        signal: current.abort.signal,
        onProgress: ({ index, total, fileName }) => {
          if (active(current.token)) setProgress(`Checking ${index} of ${total} · ${fileName}`);
        },
      });
      if (!active(current.token) || current.abort.signal.aborted || result.cancelled) return;
      setPlan(result);
      setSelected(
        new Set(
          result.entries
            .filter((entry) => entry.status === "verified" && entry.file && entry.selectedByDefault)
            .map((entry) => entry.targetId),
        ),
      );
    } catch (cause) {
      if (active(current.token)) setError(messageOf(cause));
    } finally {
      finish(current.token);
    }
  }

  async function attachSelected() {
    if (!plan || !selected.size || report) return;
    const current = begin("attach");
    if (!current) return;
    const committedIds = new Set<string>();
    setRequestedCount(selected.size);
    setProgress(`Reconnecting ${selected.size} selected originals…`);
    try {
      const result = await runDevelopReconnect(plan, [...selected], {
        store,
        decode: decodeOriginal,
        signal: current.abort.signal,
        onProgress: ({ index, total, fileName }) => {
          if (active(current.token) && !current.abort.signal.aborted)
            setProgress(`Reconnecting ${index} of ${total} · ${fileName}`);
        },
        onCommitted: (commit) => {
          if (active(current.token)) {
            for (const photo of commit.photos) committedIds.add(photo.id);
            setCommittedCount(committedIds.size);
            callbacks.current.onCommitted(commit);
          }
        },
      });
      if (!active(current.token)) return;
      setReport(result);
      setSelected(new Set());
      if (result.fatalError) setError(result.fatalError);
    } catch (cause) {
      if (active(current.token)) {
        // Do not offer the stale plan again after an unexpected executor failure.
        setPlan(null);
        setSelected(new Set());
        setError(
          `${messageOf(cause)} Scan again before retrying. Any confirmed attachments stay saved.`,
        );
      }
    } finally {
      finish(current.token);
    }
  }

  const counts = useMemo(() => {
    const result = { verified: 0, unverified: 0, ambiguous: 0, mismatch: 0, unmatched: 0 };
    for (const entry of plan?.entries ?? []) result[entry.status]++;
    return result;
  }, [plan]);
  const entries = useMemo(
    () =>
      statuses.flatMap((status) =>
        filter === "all" || filter === status
          ? (plan?.entries ?? []).filter((entry) => entry.status === status)
          : [],
      ),
    [plan, filter],
  );
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  useLayoutEffect(() => {
    if (matchList.current) matchList.current.scrollTop = 0;
  }, [currentPage, filter, plan]);
  const filenameOnlySelected =
    plan?.entries.filter((entry) => entry.status === "unverified" && selected.has(entry.targetId))
      .length ?? 0;
  const warnings = plan?.warnings ?? [];
  const failures = report?.failures ?? [];
  const busy = stage !== null;

  return (
    <div className="develop-reconnect" aria-busy={busy}>
      <p id={descriptionId}>
        Find missing originals in files or a folder. Existing originals, edits, ratings and history
        stay intact.
      </p>
      <div className="develop-reconnect-choosers">
        <button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>
          Choose Photos
        </button>
        <button type="button" disabled={busy} onClick={() => folderInput.current?.click()}>
          Choose Folder
        </button>
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          accept={photoTypes}
          aria-label="Reconnect original photos"
          disabled={busy}
          onChange={(event) => {
            const files = event.currentTarget.files;
            if (files) void chooseFiles(files);
            event.currentTarget.value = "";
          }}
        />
        <input
          ref={(element) => {
            folderInput.current = element;
            element?.setAttribute("webkitdirectory", "");
          }}
          type="file"
          hidden
          multiple
          aria-label="Reconnect originals folder"
          disabled={busy}
          onChange={(event) => {
            const files = event.currentTarget.files;
            if (files) void chooseFiles(files);
            event.currentTarget.value = "";
          }}
        />
      </div>
      {plan && !report && (
        <>
          <p className="develop-reconnect-summary" role="status">
            {plan.filesChecked} files checked · {plan.entries.length} missing originals ·{" "}
            {selected.size} selected
            {plan.skippedIds.length ? ` · ${plan.skippedIds.length} already connected` : ""}
          </p>
          {counts.unverified > 0 && (
            <p id={identityId} className="develop-reconnect-warning">
              Filename-only matches have no saved fingerprint. Select one only if you know it is the
              original; its previous identity cannot be verified.
            </p>
          )}
          {plan.entries.length > 0 ? (
            <>
              <p className="develop-reconnect-verification">
                Fingerprints are checked now; files are decoded before attachment.
              </p>
              <div className="develop-reconnect-toolbar">
                <select
                  aria-label="Reconnect match status"
                  disabled={busy}
                  value={filter}
                  onChange={(event) => {
                    setFilter(event.currentTarget.value as typeof filter);
                    setPage(0);
                  }}
                >
                  <option value="all">All matches ({plan.entries.length})</option>
                  {statuses.map((status) => (
                    <option key={status} value={status}>
                      {statusLabels[status]} ({counts[status]})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy || !counts.verified}
                  onClick={() => {
                    if (!operation.current)
                      setSelected(
                        new Set(
                          plan.entries
                            .filter((entry) => entry.status === "verified" && entry.file)
                            .map((entry) => entry.targetId),
                        ),
                      );
                  }}
                >
                  Select Verified
                </button>
                <button
                  type="button"
                  disabled={busy || !selected.size}
                  onClick={() => {
                    if (!operation.current) setSelected(new Set());
                  }}
                >
                  Clear
                </button>
              </div>
              <ul
                ref={matchList}
                className="develop-reconnect-list"
                aria-label="Original matches"
                data-match-count={entries.length}
              >
                {entries
                  .slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
                  .map((entry, index) => {
                    const selectable =
                      Boolean(entry.file) &&
                      (entry.status === "verified" || entry.status === "unverified");
                    const reasonId = `${descriptionId}-match-${currentPage * PAGE_SIZE + index}`;
                    const path = entry.candidates[0]?.path;
                    const showPath = Boolean(entry.file && path && path !== entry.file.name);
                    const visibleReason =
                      entry.status === "ambiguous"
                        ? "No unique match. Reconnect individually or scan a smaller folder."
                        : entry.status === "mismatch"
                          ? entry.reason.split(/\.\s/, 1)[0] +
                            (entry.reason.includes(". ") ? "." : "")
                          : null;
                    return (
                      <li
                        key={entry.targetId}
                        data-match-status={entry.status}
                        aria-describedby={reasonId}
                      >
                        <label title={entry.reason}>
                          <input
                            type="checkbox"
                            checked={selected.has(entry.targetId)}
                            disabled={busy || !selectable}
                            aria-label={`Reconnect ${entry.targetName}`}
                            aria-describedby={`${reasonId}${entry.status === "unverified" ? ` ${identityId}` : ""}`}
                            onChange={(event) => {
                              if (operation.current || !selectable) return;
                              const checked = event.currentTarget.checked;
                              setSelected((previous) => {
                                const next = new Set(previous);
                                if (checked) next.add(entry.targetId);
                                else next.delete(entry.targetId);
                                return next;
                              });
                            }}
                          />
                          <span className="develop-reconnect-name" title={entry.targetName}>
                            {entry.targetName}
                          </span>
                          <span className="develop-reconnect-badge">
                            {statusLabels[entry.status]}
                          </span>
                        </label>
                        <span id={reasonId} className="develop-reconnect-description">
                          {entry.reason}
                        </span>
                        {visibleReason && <p>{visibleReason}</p>}
                        {showPath && (
                          <span className="develop-reconnect-path" title={path}>
                            {path}
                          </span>
                        )}
                      </li>
                    );
                  })}
              </ul>
              <div className="develop-reconnect-pagination" aria-label="Match pages">
                <span>
                  {entries.length
                    ? `${currentPage * PAGE_SIZE + 1}–${Math.min(entries.length, (currentPage + 1) * PAGE_SIZE)} of ${entries.length}`
                    : "No matches in this group"}
                </span>
                <button
                  type="button"
                  disabled={busy || currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={busy || currentPage + 1 >= pages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </button>
              </div>
            </>
          ) : (
            <p>Every saved original is already connected. No files need attaching.</p>
          )}
        </>
      )}
      {warnings.length > 0 && (
        <details className="develop-reconnect-issues">
          <summary>
            {warnings.length} file {warnings.length === 1 ? "warning" : "warnings"}
          </summary>
          <ul>
            {warnings
              .slice(warningPage * ISSUE_PAGE_SIZE, (warningPage + 1) * ISSUE_PAGE_SIZE)
              .map((warning) => (
                <li key={warning.fileIndex}>
                  <strong>{warning.path || warning.fileName}</strong>
                  <span>{warning.reason}</span>
                </li>
              ))}
          </ul>
          {warnings.length > ISSUE_PAGE_SIZE && (
            <div className="develop-reconnect-pagination">
              <span>
                Page {warningPage + 1} of {Math.ceil(warnings.length / ISSUE_PAGE_SIZE)}
              </span>
              <button
                type="button"
                disabled={warningPage === 0}
                onClick={() => setWarningPage(warningPage - 1)}
              >
                Previous Warnings
              </button>
              <button
                type="button"
                disabled={(warningPage + 1) * ISSUE_PAGE_SIZE >= warnings.length}
                onClick={() => setWarningPage(warningPage + 1)}
              >
                Next Warnings
              </button>
            </div>
          )}
        </details>
      )}
      {report && (
        <p role="status" className="develop-reconnect-result">
          {report.attached.length} originals connected.{" "}
          {failures.length ? `${failures.length} could not be connected. ` : ""}
          {report.stopped ? "Reconnect stopped. " : ""}
          {requestedCount > report.attached.length
            ? `${requestedCount - report.attached.length} selected originals were not attached by this run. `
            : ""}
          Edits and history are preserved. Choose files again to review any remaining originals.
        </p>
      )}
      {failures.length > 0 && (
        <details className="develop-reconnect-issues" open>
          <summary>
            {failures.length} reconnect {failures.length === 1 ? "issue" : "issues"}
          </summary>
          <ul>
            {failures
              .slice(failurePage * ISSUE_PAGE_SIZE, (failurePage + 1) * ISSUE_PAGE_SIZE)
              .map((failure) => (
                <li key={failure.targetId}>
                  <strong>{failure.fileName}</strong>
                  <span>{failure.message}</span>
                </li>
              ))}
          </ul>
          {failures.length > ISSUE_PAGE_SIZE && (
            <div className="develop-reconnect-pagination">
              <span>
                Page {failurePage + 1} of {Math.ceil(failures.length / ISSUE_PAGE_SIZE)}
              </span>
              <button
                type="button"
                disabled={failurePage === 0}
                onClick={() => setFailurePage(failurePage - 1)}
              >
                Previous Issues
              </button>
              <button
                type="button"
                disabled={(failurePage + 1) * ISSUE_PAGE_SIZE >= failures.length}
                onClick={() => setFailurePage(failurePage + 1)}
              >
                Next Issues
              </button>
            </div>
          )}
        </details>
      )}
      {error && (
        <p className="develop-reconnect-error" role="alert">
          {error}
        </p>
      )}
      {!report && committedCount > 0 && (
        <p role="status">{committedCount} originals connected and saved.</p>
      )}
      {busy && (
        <p role="status" className="develop-reconnect-progress">
          {progress}
        </p>
      )}
      {!busy && filenameOnlySelected > 0 && (
        <p className="develop-reconnect-warning">
          You are explicitly attaching {filenameOnlySelected} filename-only{" "}
          {filenameOnlySelected === 1 ? "match" : "matches"} without a previous fingerprint.
        </p>
      )}
      <div className="develop-dialog-actions">
        {busy ? (
          <button type="button" disabled={stopping} onClick={cancelOperation}>
            {stopping ? "Stopping…" : stage === "scan" ? "Cancel Scan" : "Stop Reconnect"}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                if (!operation.current) callbacks.current.onClose();
              }}
            >
              {report ? "Done" : "Cancel"}
            </button>
            {!report && (
              <button
                type="button"
                className="develop-primary"
                disabled={!plan || !selected.size}
                onClick={() => void attachSelected()}
              >
                Reconnect {selected.size || "Selected"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
