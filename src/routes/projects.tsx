import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Shell, Btn } from "@/components/lensos/Shell";
import { isLocalSingleUserMode } from "@/lib/app-mode";
import {
  PROJECT_TYPES,
  activity,
  newProject,
  now,
  projectBlobIds,
  validateProject,
  type Project,
  type ProjectInput,
} from "@/lib/projects/model";
import { commitProject, listProjects, readProjectBlobs } from "@/lib/projects/repository";
import { createProjectArchive, parseProjectArchive } from "@/lib/projects/archive";
import { ProjectProofs } from "@/components/projects/ProjectProofs";
import { loadClientWorkspace, type WorkspaceClient } from "@/lib/client-workspace";
import { loadLocalFinanceState, type LocalInvoiceDraft } from "@/lib/local-finance-store";
import { listLocalDeliveryGalleries, type LocalDeliveryGallerySummary } from "@/lib/delivery/local";

export const Route = createFileRoute("/projects")({
  validateSearch: (search: Record<string, unknown>): { id?: string } =>
    typeof search["id"] === "string" ? { id: search["id"] } : {},
  head: () => ({
    meta: [{ title: "Shoots — LensLabs" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: Projects,
});
const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
const field = `mt-1 min-h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ${focus}`;
const quietAction = `min-h-11 rounded-md border-0 bg-transparent px-3 transition-colors hover:bg-ink/5 hover:translate-y-0 ${focus}`;
const primaryAction = `inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper2 transition-colors hover:bg-ink/85 ${focus}`;
const textLink = `inline-flex min-h-11 items-center rounded-md text-moss underline decoration-ink/25 underline-offset-4 hover:text-ink ${focus}`;
const empty: ProjectInput = {
  title: "",
  genre: "sports",
  brief: "",
  clientId: null,
  bookingId: null,
  invoiceIds: [],
  galleryIds: [],
};

function Projects() {
  const search = Route.useSearch();
  const [local, setLocal] = useState<boolean | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(search.id ?? null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<ProjectInput>(empty);
  const [baseRevision, setBaseRevision] = useState(0);
  const [clients, setClients] = useState<WorkspaceClient[]>([]);
  const [invoices, setInvoices] = useState<LocalInvoiceDraft[]>([]);
  const [galleries, setGalleries] = useState<LocalDeliveryGallerySummary[]>([]);
  const [pendingRestore, setPendingRestore] = useState<{
    project: Project;
    blobs: Map<string, Blob>;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const project = projects.find((row) => row.id === selectedId) ?? null;

  const refresh = async () => {
    try {
      const rows = await listProjects();
      setProjects(rows);
      setSelectedId((id) => id ?? rows[0]?.id ?? null);
      const c = loadClientWorkspace();
      if (!c.ok) throw new Error(c.error);
      setClients(c.state.clients);
      const f = loadLocalFinanceState();
      if (!f.ok) throw new Error(f.warning);
      setInvoices(f.state.invoices);
      setGalleries(await listLocalDeliveryGalleries());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read saved projects.");
    }
  };
  useEffect(() => {
    setLocal(isLocalSingleUserMode);
    if (!isLocalSingleUserMode) return;
    void refresh();
    const handler = () => void refresh();
    window.addEventListener("focus", handler);
    window.addEventListener("lenslabs:projects-changed", handler);
    return () => {
      window.removeEventListener("focus", handler);
      window.removeEventListener("lenslabs:projects-changed", handler);
    };
  }, []);
  const update = (row: Project) => {
    setProjects((rows) => [row, ...rows.filter((entry) => entry.id !== row.id)]);
    setSelectedId(row.id);
  };
  const task = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The operation failed. Existing data was preserved.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const openForm = (row: Project | null) => {
    setCreating(!row);
    setEditing(true);
    setDraft(
      row
        ? {
            title: row.title,
            genre: row.genre,
            brief: row.brief,
            clientId: row.clientId,
            bookingId: row.bookingId,
            invoiceIds: row.invoiceIds,
            galleryIds: row.galleryIds,
          }
        : empty,
    );
    setBaseRevision(row?.revision ?? 0);
  };
  const saveDetails = async (event: React.FormEvent) => {
    event.preventDefault();
    await task(async () => {
      const base = creating ? newProject(draft) : project;
      if (!base) throw new Error("Choose a project first.");
      if (!creating && base.revision !== baseRevision)
        throw new Error(
          "Project changed while this form was open. Cancel and reopen it; your work was not overwritten.",
        );
      const client = clients.find((row) => row.id === draft.clientId);
      if (draft.clientId && !client && base.clientId !== draft.clientId)
        throw new Error("Selected client is unavailable.");
      const booking = client?.bookings.find((row) => row.id === draft.bookingId);
      if (draft.bookingId && !booking && base.bookingId !== draft.bookingId)
        throw new Error("Selected booking does not belong to this client.");
      const refs = new Map(base.references.map((ref) => [`${ref.kind}:${ref.id}`, ref]));
      const addRef = (kind: Project["references"][number]["kind"], record: { id: string }) =>
        refs.set(`${kind}:${record.id}`, {
          kind,
          id: record.id,
          snapshot: JSON.parse(JSON.stringify(record)),
          capturedAt: now(),
        });
      if (client) addRef("client", client);
      if (booking) addRef("booking", booking);
      for (const invoice of invoices.filter((row) => draft.invoiceIds.includes(row.id)))
        addRef("invoice", invoice);
      for (const gallery of galleries.filter((row) => draft.galleryIds.includes(row.id)))
        addRef("gallery", gallery);
      const saved = await commitProject(
        validateProject({
          ...base,
          ...draft,
          references: [...refs.values()],
          activity: [
            ...base.activity,
            activity(
              "Project brief saved",
              "Explicit client, booking and draft references; no payment or publication implied.",
            ),
          ],
        }),
        new Map(),
        { create: creating },
      );
      update(saved);
      setEditing(false);
      setStatus("Project saved. Connected records keep their existing IDs.");
    });
  };
  const exportArchive = () =>
    void task(async () => {
      if (!project) return;
      setStatus("Verifying project media and preparing archive…");
      const blobs = await readProjectBlobs(project);
      const archive = await createProjectArchive(project, blobs);
      download(archive, `lenslabs-${project.id}.lenspack`);
      setStatus(
        "Archive download prepared. Store it outside this browser and test Restore; a local cache is not a backup.",
      );
    });
  const inspectArchive = (file: File) =>
    void task(async () => {
      setPendingRestore(null);
      setStatus("Checking archive checksums and relationships…");
      const parsed = await parseProjectArchive(file);
      const incoming = validateProject(parsed.document);
      const required = new Set(projectBlobIds(incoming));
      if (required.size !== parsed.blobs.size || [...required].some((id) => !parsed.blobs.has(id)))
        throw new Error("Archive media does not match the project's exact references.");
      setPendingRestore({ project: incoming, blobs: parsed.blobs });
      setStatus("Archive verified. Review it before restoring. No records changed yet.");
    });

  return (
    <Shell hideEventHeader quietWorkspace>
      <h1 className="mb-5 font-display text-2xl font-semibold tracking-tight">Shoots</h1>
      {local === null ? (
        <p>Opening workspace…</p>
      ) : !local ? (
        <p>
          Connected projects are currently available only in the local development workspace. Hosted
          organization access is a separate release gate.
        </p>
      ) : (
        <>
          <div className="mb-7 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link to="/studio" search={{}} className={primaryAction}>
              Start in Studio
            </Link>
            <Btn className={quietAction} disabled={busy} onClick={() => openForm(null)}>
              New project
            </Btn>
            <Btn className={quietAction} disabled={busy} onClick={() => fileRef.current?.click()}>
              Restore archive
            </Btn>
            <input
              ref={fileRef}
              type="file"
              accept=".lenspack"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) inspectArchive(file);
              }}
            />
          </div>
          {error && (
            <p role="alert" className="mb-4 text-sm text-destructive">
              {error}
            </p>
          )}
          {status && (
            <p role="status" className="mb-4 text-sm text-moss">
              {status}
            </p>
          )}
          {pendingRestore && (
            <section aria-label="Review archive restore" className="mb-8 max-w-3xl">
              <h2 className="font-display text-lg font-semibold">
                Restore {pendingRestore.project.title}
              </h2>
              <p className="my-3 text-sm leading-relaxed text-moss">
                {pendingRestore.project.frames.length} frames ·{" "}
                {pendingRestore.project.frames.filter((frame) => frame.originalBlobId).length}{" "}
                originals · {pendingRestore.project.editVersions.length} edit versions ·{" "}
                {pendingRestore.project.proofs.length} proof sets. IDs, reference snapshots and
                history will be preserved. Conflicting projects are never overwritten.
              </p>
              <div className="flex gap-2">
                <Btn
                  className={`${primaryAction} hover:translate-y-0`}
                  disabled={busy}
                  variant="primary"
                  onClick={() =>
                    void task(async () => {
                      const restored = await commitProject(
                        pendingRestore.project,
                        pendingRestore.blobs,
                        { restore: true },
                      );
                      update(restored);
                      setPendingRestore(null);
                      setStatus(
                        "Project restored from a checksum-verified archive. Existing client/finance records were not replaced.",
                      );
                    })
                  }
                >
                  Confirm restore
                </Btn>
                <Btn
                  className={quietAction}
                  disabled={busy}
                  onClick={() => setPendingRestore(null)}
                >
                  Cancel
                </Btn>
              </div>
            </section>
          )}
          <div className="grid items-start gap-x-10 gap-y-7 lg:grid-cols-[220px_minmax(0,1fr)]">
            <aside aria-label="Saved shoots" className="min-w-0 lg:sticky lg:top-28">
              <label className="mb-3 block text-sm text-moss">
                Find projects
                <input
                  aria-label="Find projects"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search shoots…"
                  className={field}
                />
              </label>
              <div className="max-h-56 space-y-1 overflow-y-auto px-0.5 lg:max-h-[65vh]">
                {projects
                  .filter((row) =>
                    `${row.title} ${row.genre} ${row.brief}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      aria-pressed={row.id === selectedId}
                      onClick={() => {
                        setSelectedId(row.id);
                        setEditing(false);
                      }}
                      className={`block min-h-14 w-full rounded-md px-3 py-2 text-left transition-colors hover:bg-ink/5 ${focus} ${row.id === selectedId ? "bg-ink/7 text-ink" : "text-moss"}`}
                    >
                      <p className="break-words text-sm font-medium">{row.title}</p>
                      <p className="mt-0.5 text-xs text-moss">
                        {row.genre} · {row.frames.length} frames
                      </p>
                    </button>
                  ))}
              </div>
              {!projects.length && (
                <p className="py-3 text-sm leading-relaxed text-moss">
                  No saved shoots. Start in Studio, then save your project.
                </p>
              )}
            </aside>
            <div className="min-w-0 space-y-9">
              {editing ? (
                <section aria-label="Project brief" className="max-w-3xl">
                  <h2 className="font-display text-xl font-semibold tracking-tight">
                    {creating ? "New project" : "Project brief"}
                  </h2>
                  <form
                    onSubmit={(event) => void saveDetails(event)}
                    className="mt-5 space-y-5 text-sm"
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label>
                        Name
                        <input
                          required
                          maxLength={200}
                          value={draft.title}
                          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                          className={field}
                        />
                      </label>
                      <label>
                        Photography type
                        <select
                          value={draft.genre}
                          onChange={(event) =>
                            setDraft({ ...draft, genre: event.target.value as Project["genre"] })
                          }
                          className={field}
                        >
                          {PROJECT_TYPES.map((type) => (
                            <option key={type}>{type}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="block">
                      Brief, required moments and outputs
                      <textarea
                        rows={4}
                        value={draft.brief}
                        onChange={(event) => setDraft({ ...draft, brief: event.target.value })}
                        className={field}
                      />
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label>
                        Client (optional)
                        <select
                          value={draft.clientId ?? ""}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              clientId: event.target.value || null,
                              bookingId: null,
                            })
                          }
                          className={field}
                        >
                          <option value="">No client / personal or editorial work</option>
                          {clients.map((client) => (
                            <option key={client.id} value={client.id}>
                              {client.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Booking (optional)
                        <select
                          value={draft.bookingId ?? ""}
                          onChange={(event) =>
                            setDraft({ ...draft, bookingId: event.target.value || null })
                          }
                          className={field}
                        >
                          <option value="">No booking</option>
                          {clients
                            .find((client) => client.id === draft.clientId)
                            ?.bookings.map((booking) => (
                              <option key={booking.id} value={booking.id}>
                                {booking.title} · {booking.date}
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>
                    <fieldset>
                      <legend className="mb-2">Link existing invoice drafts</legend>
                      {invoices.map((invoice) => (
                        <label
                          key={invoice.id}
                          className="mr-4 inline-flex min-h-11 items-center gap-2"
                        >
                          <input
                            type="checkbox"
                            checked={draft.invoiceIds.includes(invoice.id)}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                invoiceIds: event.target.checked
                                  ? [...draft.invoiceIds, invoice.id]
                                  : draft.invoiceIds.filter((id) => id !== invoice.id),
                              })
                            }
                          />
                          {invoice.description} · {invoice.clientName}
                        </label>
                      ))}
                      {!invoices.length && (
                        <p className="text-moss">No invoice drafts yet. Create them in Earnings.</p>
                      )}
                    </fieldset>
                    <fieldset>
                      <legend className="mb-2">Link existing gallery drafts</legend>
                      {galleries.map((gallery) => (
                        <label
                          key={gallery.id}
                          className="mr-4 inline-flex min-h-11 items-center gap-2"
                        >
                          <input
                            type="checkbox"
                            checked={draft.galleryIds.includes(gallery.id)}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                galleryIds: event.target.checked
                                  ? [...draft.galleryIds, gallery.id]
                                  : draft.galleryIds.filter((id) => id !== gallery.id),
                              })
                            }
                          />
                          {gallery.title}
                        </label>
                      ))}
                      {!galleries.length && (
                        <p className="text-moss">
                          No gallery drafts yet. Versioned project proofs can be created below.
                        </p>
                      )}
                    </fieldset>
                    <div className="flex gap-2">
                      <button
                        disabled={busy}
                        className={`${primaryAction} disabled:cursor-not-allowed disabled:opacity-40`}
                      >
                        Save project
                      </button>
                      <Btn
                        className={quietAction}
                        disabled={busy}
                        onClick={() => setEditing(false)}
                      >
                        Cancel
                      </Btn>
                    </div>
                  </form>
                </section>
              ) : project ? (
                <>
                  <section aria-label="Selected shoot">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="break-words font-display text-xl font-semibold tracking-tight">
                          {project.title}
                        </h2>
                        <p className="mt-1 text-sm text-moss">
                          {project.genre} · device-local · saved{" "}
                          {new Date(project.updatedAt).toLocaleString()}
                        </p>
                      </div>
                      <Link to="/studio" search={{ project: project.id }} className={primaryAction}>
                        Open Studio
                      </Link>
                    </div>
                    <p className="my-4 max-w-3xl whitespace-pre-wrap text-sm leading-relaxed">
                      {project.brief || "No brief yet."}
                    </p>
                    <div className="-ml-3 flex flex-wrap gap-1">
                      <Btn
                        className={quietAction}
                        disabled={busy}
                        onClick={() => openForm(project)}
                      >
                        Edit brief & links
                      </Btn>
                      <Btn className={quietAction} disabled={busy} onClick={exportArchive}>
                        Download archive
                      </Btn>
                    </div>
                    <p className="mt-3 text-sm tabular-nums text-moss">
                      {project.frames.length} frames ·{" "}
                      {project.frames.filter((frame) => frame.metadata.verdict === "keep").length}{" "}
                      keepers · {project.editVersions.length} saved edit versions ·{" "}
                      {project.frames.filter((frame) => frame.originalBlobId).length} stored
                      originals.
                    </p>
                    <p className="mt-2 max-w-3xl text-sm leading-relaxed text-moss">
                      Original files are checksum-verified on reopen. Browser storage is not a
                      backup. Archives: 256 MiB maximum; sources: 128 MiB each.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-5 text-sm">
                      <Link to="/clients" className={textLink}>
                        Clients {project.clientId ? "· linked" : "· optional"}
                      </Link>
                      <Link to="/earnings" className={textLink}>
                        {project.invoiceIds.length} invoice drafts
                      </Link>
                      <Link to="/deliver" className={textLink}>
                        {project.galleryIds.length} gallery draft links
                      </Link>
                    </div>
                    {project.references.length > 0 && (
                      <details className="mt-4 text-sm">
                        <summary className={`min-h-11 cursor-pointer rounded-md py-3 ${focus}`}>
                          Captured business references
                        </summary>
                        {project.references.map((ref) => (
                          <p key={`${ref.kind}:${ref.id}`} className="mt-2 break-all text-moss">
                            {ref.kind}:{" "}
                            {String(
                              ref.snapshot["name"] ??
                                ref.snapshot["title"] ??
                                ref.snapshot["description"] ??
                                ref.id,
                            )}{" "}
                            · captured {new Date(ref.capturedAt).toLocaleString()}. Reference
                            snapshot, not live payment or booking confirmation.
                          </p>
                        ))}
                      </details>
                    )}
                  </section>
                  <ProjectProofs key={project.id} project={project} onUpdate={update} />
                  <section aria-label="Project activity">
                    <h2 className="font-display text-lg font-semibold tracking-tight">Activity</h2>
                    <ol className="mt-3 space-y-4">
                      {project.activity
                        .slice(-12)
                        .reverse()
                        .map((entry) => (
                          <li key={entry.id} className="text-sm">
                            <p>
                              {entry.action}{" "}
                              <span className="text-moss">
                                · {new Date(entry.at).toLocaleString()}
                              </span>
                            </p>
                            <p className="text-moss">{entry.detail}</p>
                          </li>
                        ))}
                    </ol>
                  </section>
                </>
              ) : (
                <section aria-label="Start a shoot" className="py-2">
                  <h2 className="font-display text-xl font-semibold tracking-tight">
                    Start with your photos
                  </h2>
                  <p className="mt-2 max-w-md text-sm leading-relaxed text-moss">
                    Open Studio to import and edit. Save a named shoot whenever you're ready;
                    clients and bookings can come later.
                  </p>
                </section>
              )}
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
