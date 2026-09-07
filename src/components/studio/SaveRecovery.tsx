import { useState } from "react";

export function SaveRecovery({
  message,
  onDownload,
  onReload,
}: {
  message: string;
  onDownload: () => Promise<void>;
  onReload: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  return (
    <details className="workbench-save-recovery">
      <summary>
        <span role="status">Saving paused · keep this tab open</span>
        <span>Resolve</span>
      </summary>
      <p>{message} The photos shown here have not been replaced. Changes are paused.</p>
      <div className="workbench-save-recovery-actions">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setNotice("Preparing a recovery copy…");
            try {
              await onDownload();
              setNotice(
                "Download requested. Check that the .lenspack file is saved before reloading. Restore it from the local Projects import.",
              );
            } catch (error) {
              setNotice(
                error instanceof Error
                  ? error.message
                  : "Backup failed. Keep this tab open; nothing was replaced.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Preparing copy…" : "Download recovery copy"}
        </button>
        <button type="button" disabled={busy} onClick={onReload}>
          Reload saved shoot…
        </button>
      </div>
      <small>
        Copy includes picks, applied edits and available media—not chat or unapplied previews.
        Originals that need reconnecting remain preview-only. Limit: 256 MiB.
      </small>
      {notice && <p role="status">{notice}</p>}
    </details>
  );
}
