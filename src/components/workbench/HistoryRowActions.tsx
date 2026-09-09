import { Archive, ArchiveRestore, Pin, PinOff } from "lucide-react";
import { stopRowAction } from "./row-action-event";
import { historyKindLabel } from "./sidebar-presentation";
import "./row-actions.css";

/** Sibling controls, never nested in a navigation link. Visibility is owned by this exact row. */
export function HistoryRowActions({
  title,
  kind,
  pinned,
  archived,
  disabled,
  pin,
  archive,
}: {
  title: string;
  kind: "chat" | "shoot" | "album";
  pinned: boolean;
  archived: boolean;
  disabled: boolean;
  pin: () => void;
  archive: () => void;
}) {
  const label = historyKindLabel(kind);
  return (
    <span
      className="history-row-actions"
      onPointerDown={stopRowAction}
      onDoubleClick={stopRowAction}
    >
      <button
        type="button"
        className="history-row-action"
        title={`${pinned ? "Unpin" : "Pin"} ${label}`}
        aria-label={`${pinned ? "Unpin" : "Pin"} ${label}: ${title}`}
        aria-pressed={pinned}
        disabled={disabled}
        onClick={(event) => {
          stopRowAction(event);
          pin();
        }}
      >
        {pinned ? <PinOff size={15} aria-hidden="true" /> : <Pin size={15} aria-hidden="true" />}
      </button>
      <button
        type="button"
        className="history-row-action"
        title={`${archived ? "Restore" : "Archive"} ${label}`}
        aria-label={`${archived ? "Restore" : "Archive"} ${label}: ${title}`}
        disabled={disabled}
        onClick={(event) => {
          stopRowAction(event);
          archive();
        }}
      >
        {archived ? (
          <ArchiveRestore size={15} aria-hidden="true" />
        ) : (
          <Archive size={15} aria-hidden="true" />
        )}
      </button>
    </span>
  );
}

export function ArchiveUndo({
  title,
  disabled,
  undo,
}: {
  title: string;
  disabled: boolean;
  undo: () => void;
}) {
  return (
    <p className="history-archive-notice" role="status">
      <span>Archived “{title}”.</span>
      <button type="button" disabled={disabled} onClick={undo}>
        Undo
      </button>
    </p>
  );
}
