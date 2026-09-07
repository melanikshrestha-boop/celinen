import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Pencil } from "lucide-react";
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
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export function RecentShoots({
  scope,
  activeId,
  open,
}: {
  scope: string;
  activeId: string | null;
  open: (href: string) => Promise<boolean>;
}) {
  const [rows, setRows] = useState<RecentShoot[]>([]);
  const [previous, setPrevious] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const recoveryTarget = useRef<string | null>(null);
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
  return (
    <section className="chat-recents" aria-label="Recent Shoots">
      <div className="chat-recents-heading">
        <span>Recent Shoots</span>
      </div>
      {rows.map((row) => (
        <div key={row.id} className="recent-shoot-row">
          <button
            className={`workbench-nav-item ${activeId === row.id ? "is-active" : ""}`}
            onClick={() =>
              row.recoveryPending
                ? edit("recover-device", row.title, row.id)
                : void open(shootHref(row.id))
            }
          >
            <Camera size={16} />
            <span>{row.title}</span>
          </button>
          <button
            className="recent-shoot-rename"
            aria-label={`Rename ${row.title}`}
            onClick={() =>
              row.recoveryPending
                ? edit("recover-device", row.title, row.id)
                : edit(row.id, row.title)
            }
          >
            <Pencil size={14} />
          </button>
        </div>
      ))}
      {!rows.length && <p className="recent-shoot-empty">Your imported shoots will appear here.</p>}
      {activeId && !rows.some((row) => row.id === activeId) && (
        <button className="workbench-nav-item" onClick={() => edit(activeId, "")}>
          <Camera size={16} />
          Name this shoot
        </button>
      )}
      {previous && (
        <button
          className="workbench-nav-item"
          onClick={() => edit("recover-device", "Lunara Glow Shoot")}
        >
          <Camera size={16} />
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
            {editing === "recover-device" ? "Bring back your saved shoot" : "Name this shoot"}
          </DialogTitle>
          <DialogDescription>
            {editing === "recover-device"
              ? "Copy the previous device’s previews, picks, and applied edits into this account. The old shoot stays untouched. Reconnect the source folder for original files."
              : "Use a name you’ll recognize, like Lunara Glow Shoot or Real Estate Shoot."}
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
                await open(shootHref(id));
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
                placeholder="Lunara Glow Shoot"
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
