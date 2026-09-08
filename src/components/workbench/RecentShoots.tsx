import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, MoreHorizontal, Pencil } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  listRecentShoots,
  rememberShoot,
  renameShoot,
  markDeviceRecovery,
  startDeviceRecovery,
  shootHref,
  type RecentShoot,
} from "@/lib/studio/shoot-directory";
import { inspectPreviousShoot, copyPreviousShoot } from "@/lib/studio/session";
import { projectDisplayTitle } from "@/lib/workspace-labels";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { shootPhotoCountLabel, shootUpdatedLabel } from "@/components/shoots/navigation";

export function RecentShoots({
  scope,
  activeId,
  open,
  children,
  hrefForShoot = shootHref,
  heading = "Recent shoots",
  showMetadata = false,
}: {
  scope: string;
  activeId: string | null;
  open: (href: string) => Promise<boolean>;
  children?: ReactNode;
  hrefForShoot?: (id: string) => string;
  heading?: string;
  showMetadata?: boolean;
}) {
  const [rows, setRows] = useState<RecentShoot[]>([]);
  const [previous, setPrevious] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(true);
  useEffect(() => setExpanded(true), [activeId]);
  const alive = useRef(true);
  const recoveryTarget = useRef<string | null>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const skipRenameBlur = useRef(false);
  useEffect(() => {
    if (renaming) renameInput.current?.select();
  }, [renaming]);
  const refresh = useCallback(async () => {
    try {
      const next = await listRecentShoots(scope);
      if (alive.current) setRows(next);
    } catch {
      if (alive.current) setError("Recent shoots could not be read. Your photos are still saved.");
    }
  }, [scope]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    void inspectPreviousShoot(scope)
      .then(async (count) => {
        const saved = await listRecentShoots(scope);
        if (count && alive.current && !saved.some((row) => row.id === "legacy")) {
          await rememberShoot(scope, "legacy", count, "Previous shoot");
        }
      })
      .catch(() => {});
    void inspectPreviousShoot("device-local")
      .then(async (count) => {
        const saved = await listRecentShoots(scope);
        if (alive.current) setPrevious(count > 0 && !saved.some((row) => row.recoveredFromDevice));
      })
      .catch(() => {});
    const changed = () => void refresh();
    window.addEventListener("lenslabs:shoots-changed", changed);
    window.addEventListener("focus", changed);
    return () => {
      alive.current = false;
      window.removeEventListener("lenslabs:shoots-changed", changed);
      window.removeEventListener("focus", changed);
    };
  }, [scope, refresh]);
  const edit = (id: string, title: string, pendingId: string | null = null) => {
    recoveryTarget.current = pendingId;
    setEditing(id);
    setName(title);
    setError("");
  };
  const startRename = (id: string, title: string) => {
    skipRenameBlur.current = false;
    setRenaming(id);
    setName(title);
  };
  const commitRename = async (id: string) => {
    const next = name.trim();
    const current = rows.find((row) => row.id === id);
    setRenaming(null);
    if (!next || !current || next === current.title) return;
    try {
      await renameShoot(scope, id, next);
      if (alive.current) await refresh();
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : "Could not rename this shoot.");
    }
  };
  const displayRows = rows;
  const showHistory = displayRows.some((row) => row.id === activeId);
  return (
    <section className="chat-recents" aria-label={heading}>
      {displayRows.length > 0 && (
        <div className="chat-recents-heading">
          <span>{heading}</span>
        </div>
      )}
      {displayRows.map((row) => (
        <div key={row.id} className="recent-shoot-item" data-shoot-id={row.id}>
          <div className={`recent-shoot-row ${activeId === row.id ? "is-active" : ""}`}>
            {renaming === row.id ? (
              <input
                ref={renameInput}
                className="recent-shoot-title-input"
                value={name}
                maxLength={200}
                aria-label="Shoot name"
                onChange={(event) => setName(event.target.value)}
                onBlur={() => {
                  if (skipRenameBlur.current) {
                    skipRenameBlur.current = false;
                    return;
                  }
                  void commitRename(row.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    (event.currentTarget as HTMLInputElement).blur();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    skipRenameBlur.current = true;
                    setRenaming(null);
                  }
                }}
              />
            ) : (
              <button
                className={`workbench-nav-item ${activeId === row.id ? "is-active" : ""}`}
                onClick={(event) => {
                  if (event.detail > 1) return;
                  if (row.recoveryPending) edit("recover-device", row.title, row.id);
                  else void open(hrefForShoot(row.id));
                }}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!row.recoveryPending) startRename(row.id, row.title);
                }}
              >
                <span>{projectDisplayTitle(row)}</span>
                {showMetadata && (
                  <small>
                    {shootPhotoCountLabel("shoot", row.count) &&
                      `${shootPhotoCountLabel("shoot", row.count)} · `}
                    {shootUpdatedLabel(row.updatedAt)}
                    {row.recoveryPending && " · Recovery unfinished"}
                  </small>
                )}
              </button>
            )}
            {activeId === row.id && children && (
              <button
                className="recent-shoot-expand"
                aria-label={`Shoots in ${projectDisplayTitle(row)}`}
                aria-expanded={expanded}
                onClick={() => setExpanded((value) => !value)}
              >
                <ChevronRight size={16} />
              </button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="recent-shoot-rename"
                  aria-label={`More options for ${projectDisplayTitle(row)}`}
                >
                  <MoreHorizontal size={16} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="ll-chat-menu">
                <DropdownMenuItem
                  onSelect={() =>
                    row.recoveryPending
                      ? edit("recover-device", row.title, row.id)
                      : startRename(row.id, row.title)
                  }
                >
                  <Pencil />
                  Rename
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {activeId === row.id && children && (
            <div className="recent-shoot-conversations" hidden={!expanded}>
              {children}
            </div>
          )}
        </div>
      ))}
      {!showHistory && !activeId && displayRows.length > 0 && children && (
        <div className="recent-shoot-conversations">{children}</div>
      )}
      {previous && (
        <button
          className="workbench-nav-item"
          onClick={() => edit("recover-device", "Recovered shoot")}
        >
          Recover previous device shoot
        </button>
      )}
      {error && (
        <p role="alert" className="recent-shoot-empty">
          {error}
        </p>
      )}
      <Dialog
        open={editing !== null}
        onOpenChange={(value) => {
          if (!value && !busy) setEditing(null);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {editing === "recover-device" ? "Bring back your saved shoot" : "Rename shoot"}
          </DialogTitle>
          <DialogDescription>
            {editing === "recover-device"
              ? "Copy the previous device’s previews, picks, and applied edits into this account. The old shoot stays untouched. Reconnect the source folder for original files."
              : "Choose a shoot name."}
          </DialogDescription>
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!editing || busy) return;
              setBusy(true);
              setError("");
              try {
                let id = editing;
                if (editing === "recover-device") {
                  const saved = await listRecentShoots(scope);
                  id =
                    recoveryTarget.current ??
                    saved.find((row) => row.recoveryPending)?.id ??
                    crypto.randomUUID();
                  recoveryTarget.current = id;
                  await startDeviceRecovery(scope, id, name);
                  const count = await copyPreviousShoot("device-local", scope, id);
                  await rememberShoot(scope, id, count, name);
                  await markDeviceRecovery(scope, id);
                }
                await renameShoot(scope, id, name);
                if (!alive.current) return;
                if (editing === "recover-device") setPrevious(false);
                setEditing(null);
                await refresh();
                await open(hrefForShoot(id));
              } catch (cause) {
                if (alive.current)
                  setError(cause instanceof Error ? cause.message : "Could not save this shoot.");
              } finally {
                if (alive.current) setBusy(false);
              }
            }}
          >
            <label className="block text-sm">
              Shoot name
              <input
                autoFocus
                required
                maxLength={200}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Recovered shoot"
                className="mt-2 w-full rounded-md border border-input bg-transparent p-3"
              />
            </label>
            <button
              disabled={busy || !name.trim()}
              className="rounded-lg bg-ink px-5 py-3 text-paper disabled:opacity-50"
            >
              {busy
                ? "Saving…"
                : editing === "recover-device"
                  ? "Copy into this account"
                  : "Save name"}
            </button>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
