import { useState } from "react";
import { useWorkbench } from "@/components/workbench/context";
import type { Shot } from "@/lib/imaging";
import type { StudioFilter } from "@/lib/studio/session";
import { newProject, PROJECT_TYPES, type Project } from "@/lib/projects/model";
import { captureProject } from "@/lib/projects/studio-adapter";
import { commitProject } from "@/lib/projects/repository";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";

export function SaveProject({
  shots,
  selectedId,
  filter,
  disabled,
}: {
  shots: Shot[];
  selectedId: string | null;
  filter: StudioFilter;
  disabled: boolean;
}) {
  const workbench = useWorkbench();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState<Project["genre"]>("sports");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || disabled) return;
    setBusy(true);
    setStatus("Checking project storage…");
    try {
      const bytes = shots.reduce(
        (total, shot) =>
          total +
          (shot.sourceAvailable === false ? 0 : shot.file.size) +
          (shot.previewBlob?.size ?? 0),
        0,
      );
      const storage = await navigator.storage?.estimate?.();
      if (storage?.quota && bytes > storage.quota - (storage.usage ?? 0))
        throw new Error(
          "Not enough browser storage for these originals. Keep the source files safe; a native storage workflow is required for this shoot.",
        );
      const project = newProject({
        title,
        genre,
        brief: "",
        clientId: null,
        bookingId: null,
        invoiceIds: [],
        galleryIds: [],
      });
      const captured = await captureProject(project, shots, selectedId, filter, (done, total) =>
        setStatus(`Verifying files ${done.toLocaleString()} / ${total.toLocaleString()}…`),
      );
      const saved = await commitProject(captured.project, captured.blobs, { create: true });
      const href = `/studio?project=${encodeURIComponent(saved.id)}`;
      if (workbench) { await workbench.openTool(href); setBusy(false); setOpen(false); }
      else window.location.assign(href);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Project could not be saved. Your current shoot is unchanged.",
      );
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value);
      }}
    >
      <DialogTrigger
        disabled={disabled || !shots.length}
        className="rounded-md px-2.5 py-1.5 text-moss hover:text-ink disabled:opacity-40"
      >
        Save project
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Save this shoot as a project</DialogTitle>
        <DialogDescription>
          Keep these files, picks and edit versions together. Your current Studio snapshot stays
          intact.
        </DialogDescription>
        <form onSubmit={(event) => void save(event)} className="space-y-4 text-sm">
          <label className="block">
            Project name
            <input
              required
              value={title}
              maxLength={200}
              disabled={busy}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-card p-2"
            />
          </label>
          <label className="block">
            Photography type
            <select
              value={genre}
              disabled={busy}
              onChange={(event) => setGenre(event.target.value as Project["genre"])}
              className="mt-1 w-full rounded-md border border-input bg-card p-2"
            >
              {PROJECT_TYPES.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
          <p className="text-moss">
            {shots.filter((shot) => shot.sourceAvailable !== false).length.toLocaleString()}{" "}
            connected originals;{" "}
            {shots.filter((shot) => shot.sourceAvailable === false).length.toLocaleString()}{" "}
            preview-only frames. Files stay on this device. Browser storage is not a backup.
          </p>
          <p className="text-moss">
            Current limit: 128 MiB per source file. Portable archives are limited to 256 MiB; larger
            shoots need the planned native backup path.
          </p>
          {status && <p role="status">{status}</p>}
          <button
            disabled={busy || !title.trim()}
            className="rounded-md bg-ink px-4 py-2 text-paper2 disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save and open project"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
