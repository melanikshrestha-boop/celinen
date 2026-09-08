import { createFileRoute, useLocation } from "@tanstack/react-router";
import { OutboundWorkspace } from "./outbound";
import { ShootLink } from "@/components/shoots/ShootsHub";
import { APPLICATION_ORIGIN } from "@/lib/application-origin";
import { DeliveryWorkspace } from "@/components/delivery/DeliveryWorkspace";
import { useCallback, useEffect, useRef, useState } from "react";
import { useToolLeaveGuard } from "@/components/workbench/useToolLeaveGuard";
import { useWorkbench } from "@/components/workbench/context";
import { Btn, Card, Chip, SectionTitle, Shell } from "@/components/lensos/Shell";
import { supabase } from "@/integrations/supabase/client";
import {
  addGalleryPhotos,
  createGallery,
  deleteGallery,
  getGallery,
  listGalleries,
  updateGallery,
} from "@/lib/delivery.functions";
import { listClients } from "@/lib/finance.functions";
import { listInboxBookings, attachGalleryToBooking } from "@/lib/client-portal.functions";
import { isLocalSingleUserMode } from "@/lib/app-mode";
import {
  addLocalDeliveryPhotos,
  buildLocalDeliveryManifest,
  createLocalDeliveryGallery,
  createLocalDeliveryPhotoDraft,
  deleteLocalDeliveryGallery,
  deleteLocalDeliveryPhoto,
  getLocalDeliveryGallery,
  listLocalDeliveryGalleries,
  updateLocalDeliveryGallery,
  type LocalDeliveryGallerySummary,
  type LocalDeliveryPhoto,
} from "@/lib/delivery/local";

export const Route = createFileRoute("/deliver")({
  // Source/query references survive old bookmarks and transitions between delivery desks.
  validateSearch: (search: Record<string, unknown>) => search,
  head: () => ({
    meta: [
      { title: "Deliver — FOTO" },
      {
        name: "description",
        content:
          "Send keepers after you cull. Clients favorite from that set — they never see the card dump.",
      },
      { property: "og:title", content: "Delivery — LensLabs client galleries" },
      {
        property: "og:description",
        content: "Keepers-only galleries, client favorites, downloads, expiry.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Deliver,
});

type GalleryRow = {
  id: string;
  title: string;
  slug: string;
  status: string;
  downloads_enabled: boolean;
  passcode: string | null;
  view_count: number;
  message: string | null;
  photo_count: number;
  favorite_count: number;
};

type Photo = { id: string; filename: string; url: string | null };

type GalleryDetailResponse = {
  error?: string;
  photos?: Photo[];
  favorites?: { photo_id: string; viewer: string }[];
};

type CreateGalleryResponse = {
  error?: string;
  gallery?: { id: string };
};

type GalleryPatch = {
  status?: "draft" | "live" | "archived";
  downloads_enabled?: boolean;
};

type LocalPhotoView = LocalDeliveryPhoto & { previewUrl: string };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function readableSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function manifestFilename(title: string): string {
  const stem = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${stem || "gallery"}-local-manifest.json`;
}

function Deliver() {
  const href = useLocation({ select: (location) => location.href });
  const search = new URL(href, "https://workspace.invalid").searchParams;
  const section =
    search.get("desk") === "outbound"
      ? "outbound"
      : ["1", "true"].includes(search.get("legacy") ?? "")
        ? "legacy"
        : "galleries";
  const sectionHref = (next: "galleries" | "legacy" | "outbound") => {
    const url = new URL(href, "https://workspace.invalid");
    for (const key of ["desk", "legacy", "workflow"]) url.searchParams.delete(key);
    if (next === "outbound") url.searchParams.set("desk", "outbound");
    if (next === "legacy") url.searchParams.set("legacy", "1");
    return `/deliver${url.search}${url.hash}`;
  };
  return (
    <>
      <nav className="shoot-workflow-tabs" aria-label="Delivery desks">
        <ShootLink href={sectionHref("galleries")} current={section === "galleries"}>
          Galleries
        </ShootLink>
        <ShootLink href={sectionHref("legacy")} current={section === "legacy"}>
          Saved galleries
        </ShootLink>
        {isLocalSingleUserMode && (
          <ShootLink href={sectionHref("outbound")} current={section === "outbound"}>
            Outreach drafts
          </ShootLink>
        )}
      </nav>
      {section === "outbound" ? (
        <OutboundWorkspace />
      ) : section === "legacy" ? (
        <LegacyDeliver />
      ) : (
        <DeliveryWorkspace />
      )}
    </>
  );
}

function ProofingEntry() {
  const workspace = useWorkbench();
  const [error, setError] = useState("");
  return (
    <div className="mb-6 text-sm">
      <a
        href="/deliver?workflow=1"
        className="text-ink underline underline-offset-4"
        onClick={(event) => {
          if (!workspace || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
            return;
          event.preventDefault();
          void workspace
            .openTool("/deliver?workflow=1")
            .catch(() => setError("Could not open proofing. Try again."));
        }}
      >
        Open proof-to-final delivery →
      </a>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

function LegacyDeliver() {
  const [mode, setMode] = useState<"pending" | "local" | "cloud">("pending");

  useEffect(() => {
    setMode(isLocalSingleUserMode ? "local" : "cloud");
  }, []);

  if (mode === "pending") return null;
  return mode === "local" ? <LocalDeliver /> : <CloudDeliver />;
}

function LocalDeliver() {
  const [galleries, setGalleries] = useState<LocalDeliveryGallerySummary[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<LocalPhotoView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", message: "" });
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [photoRevision, setPhotoRevision] = useState(0);
  const [loadedGalleryId, setLoadedGalleryId] = useState<string | null>(null);
  useToolLeaveGuard(
    busy || progress
      ? "Gallery preparation is still in progress and may stop if you leave."
      : form.title.trim() || form.message.trim()
        ? "Your unsaved gallery details will be discarded."
        : null,
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDialogElement>(null);
  const photoUrls = useRef<string[]>([]);
  const mounted = useRef(true);
  const refreshSequence = useRef(0);

  const revokePhotoUrls = useCallback(() => {
    photoUrls.current.forEach((url) => URL.revokeObjectURL(url));
    photoUrls.current = [];
  }, []);

  const replacePhotos = useCallback(
    (records: LocalDeliveryPhoto[]) => {
      revokePhotoUrls();
      const nextUrls: string[] = [];
      try {
        const views = records.map((photo) => {
          const previewUrl = URL.createObjectURL(photo.previewBlob);
          nextUrls.push(previewUrl);
          return { ...photo, previewUrl };
        });
        photoUrls.current = nextUrls;
        setPhotos(views);
      } catch (cause) {
        nextUrls.forEach((url) => URL.revokeObjectURL(url));
        throw cause;
      }
    },
    [revokePhotoUrls],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revokePhotoUrls();
    };
  }, [revokePhotoUrls]);

  const refresh = useCallback(async (preferredId?: string | null) => {
    const sequence = ++refreshSequence.current;
    const rows = await listLocalDeliveryGalleries();
    if (!mounted.current || sequence !== refreshSequence.current) return;
    setGalleries(rows);
    setOpenId((current) => {
      const candidate = preferredId === undefined ? current : preferredId;
      if (candidate && rows.some((gallery) => gallery.id === candidate)) return candidate;
      return rows[0]?.id ?? null;
    });
  }, []);

  useEffect(() => {
    void refresh().catch((cause) => {
      if (mounted.current) {
        setError(errorMessage(cause, "Could not open local gallery storage."));
      }
    });
  }, [refresh]);

  useEffect(() => {
    replacePhotos([]);
    setLoadedGalleryId(null);
    if (!openId) return;

    let active = true;
    void getLocalDeliveryGallery(openId)
      .then((result) => {
        if (!active || !mounted.current) return;
        if (!result) {
          setOpenId(null);
          return;
        }
        replacePhotos(result.photos);
        setLoadedGalleryId(openId);
      })
      .catch((cause) => {
        if (active && mounted.current) {
          setError(errorMessage(cause, "Could not read this local gallery."));
        }
      });

    return () => {
      active = false;
    };
  }, [openId, photoRevision, replacePhotos]);

  const open = galleries.find((gallery) => gallery.id === openId) ?? null;
  const photosReady = open !== null && loadedGalleryId === open.id;
  const visiblePhotos = photosReady ? photos : [];

  const create = async () => {
    if (!form.title.trim() || busy) return;
    setBusy("create");
    setError(null);
    setNotice(null);
    try {
      const gallery = await createLocalDeliveryGallery(form);
      if (!mounted.current) return;
      setForm({ title: "", message: "" });
      await refresh(gallery.id);
      if (mounted.current) setNotice("Local gallery draft created. Nothing was shared.");
    } catch (cause) {
      if (mounted.current) {
        setError(errorMessage(cause, "Could not create the local gallery."));
      }
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const upload = async (files: FileList | File[]) => {
    if (!open || busy) return;
    const selected = [...files];
    const supported = selected.filter(
      (file) => file.type === "image/jpeg" || file.type === "image/png",
    );
    if (supported.length === 0) {
      setError("Choose JPEG or PNG exports for a local gallery preview.");
      return;
    }

    setBusy("photos");
    setError(null);
    setNotice(null);
    setProgress({ done: 0, total: supported.length });
    const drafts = [];
    let failed = selected.length - supported.length;
    try {
      for (const file of supported) {
        try {
          drafts.push(await createLocalDeliveryPhotoDraft(file));
        } catch {
          failed += 1;
        } finally {
          if (mounted.current) {
            setProgress((current) => ({
              done: Math.min((current?.done ?? 0) + 1, supported.length),
              total: supported.length,
            }));
          }
        }
      }

      const added = await addLocalDeliveryPhotos(open.id, drafts);
      if (!mounted.current) return;
      await refresh(open.id);
      setLoadedGalleryId(null);
      setPhotoRevision((revision) => revision + 1);
      setNotice(
        `${added} local preview${added === 1 ? "" : "s"} saved${
          failed ? ` · ${failed} skipped` : ""
        }. Originals stayed where they are.`,
      );
    } catch (cause) {
      if (mounted.current) {
        setError(errorMessage(cause, "Could not save the local previews."));
      }
    } finally {
      if (mounted.current) {
        setProgress(null);
        setBusy(null);
      }
    }
  };

  const toggleDownloads = async () => {
    if (!open || busy) return;
    setBusy("update");
    setError(null);
    setNotice(null);
    try {
      await updateLocalDeliveryGallery(open.id, {
        downloadsEnabled: !open.downloadsEnabled,
      });
      await refresh(open.id);
      if (mounted.current) setNotice("Draft preference saved on this device.");
    } catch (cause) {
      if (mounted.current) {
        setError(errorMessage(cause, "Could not update the local draft."));
      }
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const removeGallery = async () => {
    if (!open || busy) return;
    const confirmed = window.confirm(
      `Delete the local draft “${open.title}” and its previews? Your original files will not be touched.`,
    );
    if (!confirmed) return;

    setBusy("delete");
    setError(null);
    setNotice(null);
    try {
      await deleteLocalDeliveryGallery(open.id);
      if (!mounted.current) return;
      setOpenId(null);
      setLoadedGalleryId(null);
      replacePhotos([]);
      await refresh();
      if (mounted.current) setNotice("Local draft deleted. Originals were not touched.");
    } catch (cause) {
      if (mounted.current) {
        setError(errorMessage(cause, "Could not delete the local draft."));
      }
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const removePhoto = async (photo: LocalPhotoView) => {
    if (busy) return;
    const confirmed = window.confirm(
      `Remove “${photo.filename}” from this local draft? The original file will not be touched.`,
    );
    if (!confirmed) return;

    setBusy(`photo:${photo.id}`);
    setError(null);
    try {
      await deleteLocalDeliveryPhoto(photo.id);
      if (!mounted.current) return;
      await refresh(openId);
      setLoadedGalleryId(null);
      setPhotoRevision((revision) => revision + 1);
    } catch (cause) {
      if (mounted.current) {
        setError(errorMessage(cause, "Could not remove the local preview."));
      }
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const exportManifest = () => {
    if (!open || !photosReady) return;
    const storedPhotos = visiblePhotos.map(({ previewUrl: _previewUrl, ...photo }) => photo);
    const manifest = buildLocalDeliveryManifest(open, storedPhotos);
    const blob = new Blob([JSON.stringify(manifest, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = manifestFilename(open.title);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Local planning manifest exported. No gallery was published.");
  };

  return (
    <Shell hideEventHeader>
      <SectionTitle
        kicker="Delivery"
        title="Hand the shoot over in one link."
        sub="Prepare a gallery locally. Previews stay on this device; publishing, passcodes and client links require a connected account."
      />
      <ProofingEntry />

      {error && (
        <Card className="mb-4 border-destructive/40">
          <p className="text-sm text-destructive">{error}</p>
        </Card>
      )}
      {notice && (
        <Card className="mb-4">
          <p role="status" className="text-sm text-moss">
            {notice}
          </p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="space-y-3">
          <Card>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
              New gallery
            </p>
            <input
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") void create();
              }}
              placeholder="Halden Invitational — finals"
              aria-label="Gallery title"
              className="mt-3 w-full rounded-lg border border-input bg-card px-3 py-2 text-[13px] outline-none"
            />
            <select
              disabled
              aria-label="Gallery client — connected account required"
              title="Client assignments require a connected account."
              className="mt-2 w-full rounded-lg border border-input bg-card px-3 py-2 text-[13px] outline-none"
            >
              <option>No client · local draft</option>
            </select>
            <input
              disabled
              placeholder="Passcode (when published)"
              aria-label="Passcode — connected account required"
              title="A local draft has no public link to protect."
              className="mt-2 w-full rounded-lg border border-input bg-card px-3 py-2 text-[13px] outline-none"
            />
            <textarea
              value={form.message}
              onChange={(event) => setForm({ ...form, message: event.target.value })}
              placeholder="Note shown to the client"
              aria-label="Gallery working note"
              rows={2}
              className="mt-2 w-full rounded-lg border border-input bg-card px-3 py-2 text-[13px] outline-none"
            />
            <Btn
              className="mt-3 w-full justify-center"
              variant="primary"
              disabled={busy !== null || !form.title.trim()}
              onClick={() => void create()}
            >
              {busy === "create" ? "Creating…" : "Create gallery"}
            </Btn>
          </Card>

          {galleries.map((gallery) => (
            <button
              key={gallery.id}
              disabled={busy !== null}
              onClick={() => setOpenId(gallery.id)}
              className={`block w-full rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 ${
                openId === gallery.id ? "border-rust/50 bg-card" : "border-border bg-card"
              }`}
            >
              <p className="font-display text-[15px] font-semibold tracking-tight">
                {gallery.title}
              </p>
              <p className="font-mono text-[11px] text-moss">
                {gallery.photoCount} local preview{gallery.photoCount === 1 ? "" : "s"} · not shared
              </p>
            </button>
          ))}
        </div>

        {open ? (
          <div className="space-y-4">
            <Card>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-display text-lg font-semibold tracking-tight">{open.title}</p>
                <Chip tone="quiet">local draft</Chip>
                <div className="ml-auto flex gap-2">
                  <Btn className="px-3 py-1.5 text-[13px]" disabled>
                    <span title="Publishing requires a connected account. This draft has no public link.">
                      Copy link
                    </span>
                  </Btn>
                  <Btn
                    className="px-3 py-1.5 text-[13px]"
                    disabled={busy !== null || !photosReady}
                    onClick={() => previewRef.current?.showModal()}
                  >
                    Preview
                  </Btn>
                </div>
              </div>
              <p className="mt-2 break-all font-mono text-[12px] text-moss">
                Not shared · no public link
              </p>
              <label className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[12px] text-moss">
                Send to shoot request
                <select
                  disabled
                  title="Shoot requests require a connected account."
                  className="rounded-lg border border-input bg-card px-2 py-1.5 text-[12px] text-ink"
                >
                  <option>— local draft —</option>
                </select>
              </label>

              <div className="mt-3 flex flex-wrap gap-2">
                <Btn className="px-3 py-1.5 text-[13px]" disabled>
                  <span title="Publishing requires a connected account.">Publish</span>
                </Btn>
                <Btn
                  className="px-3 py-1.5 text-[13px]"
                  disabled={busy !== null}
                  onClick={() => void toggleDownloads()}
                >
                  Downloads: {open.downloadsEnabled ? "on" : "off"}
                </Btn>
                <Btn
                  className="ml-auto px-3 py-1.5 text-[13px]"
                  disabled={busy !== null}
                  onClick={() => void removeGallery()}
                >
                  {busy === "delete" ? "Deleting…" : "Delete"}
                </Btn>
              </div>
            </Card>

            <Card className="border-dashed">
              <div
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void upload(event.dataTransfer.files);
                }}
                className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 text-center"
              >
                <p className="font-display text-[15px] font-semibold tracking-tight">
                  Drop keepers here to deliver
                </p>
                <p className="mt-1 text-[13px] text-moss">
                  JPEG or PNG exports. Previews stay on this device until you publish.
                </p>
                <Btn
                  className="mt-3"
                  variant="primary"
                  disabled={busy !== null}
                  onClick={() => fileRef.current?.click()}
                >
                  Choose files
                </Btn>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                  hidden
                  onChange={(event) => {
                    const selected = event.currentTarget.files
                      ? [...event.currentTarget.files]
                      : [];
                    event.currentTarget.value = "";
                    if (selected.length) void upload(selected);
                  }}
                />
                {progress && (
                  <p className="mt-3 font-mono text-[12px] text-moss">
                    preparing {progress.done}/{progress.total}
                  </p>
                )}
              </div>
            </Card>

            <Card className="p-0">
              <div className="flex items-center gap-2 border-b border-border p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
                  Gallery frames
                </p>
                <p className="ml-auto font-mono text-[11px] text-moss">
                  {visiblePhotos.length} frame{visiblePhotos.length === 1 ? "" : "s"}
                </p>
              </div>
              {!photosReady ? (
                <p className="p-6 text-sm text-moss">Opening local previews…</p>
              ) : visiblePhotos.length === 0 ? (
                <p className="p-6 text-sm text-moss">Nothing delivered yet.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 lg:grid-cols-4">
                  {visiblePhotos.map((photo) => (
                    <figure
                      key={photo.id}
                      className="group relative overflow-hidden rounded-xl border border-border"
                      title={`${photo.filename} · ${photo.width}×${photo.height} · ${readableSize(photo.size)}`}
                    >
                      <img
                        src={photo.previewUrl}
                        alt={photo.filename}
                        loading="lazy"
                        className="aspect-[4/3] w-full object-cover"
                      />
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void removePhoto(photo)}
                        aria-label={`Remove ${photo.filename} from local draft`}
                        className="absolute right-2 top-2 rounded-full bg-ink/85 px-2 py-1 font-mono text-[10px] text-paper2 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 disabled:opacity-40"
                      >
                        remove
                      </button>
                    </figure>
                  ))}
                </div>
              )}
            </Card>
          </div>
        ) : (
          <Card>
            <p className="text-sm text-moss">Create a gallery to start delivering.</p>
          </Card>
        )}
      </div>
      <dialog
        ref={previewRef}
        aria-label="Local gallery preview"
        className="m-auto max-h-[85vh] w-[min(960px,90vw)] overflow-y-auto rounded-2xl border border-border bg-card p-6 text-ink backdrop:bg-ink/40"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-lg font-semibold tracking-tight">{open?.title}</h2>
          <Chip>local preview · not published</Chip>
          <Btn className="ml-auto px-3 py-1.5 text-[13px]" onClick={exportManifest}>
            Export draft
          </Btn>
          <Btn className="px-3 py-1.5 text-[13px]" onClick={() => previewRef.current?.close()}>
            Close
          </Btn>
        </div>
        {open?.message && <p className="mt-3 text-sm text-moss">{open.message}</p>}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {visiblePhotos.map((photo) => (
            <figure key={photo.id}>
              <img
                src={photo.previewUrl}
                alt={photo.filename}
                className="aspect-[4/3] w-full rounded-xl object-cover"
              />
              <figcaption className="mt-1 truncate font-mono text-[11px] text-moss">
                {photo.filename}
              </figcaption>
            </figure>
          ))}
        </div>
        {visiblePhotos.length === 0 && (
          <p className="mt-4 text-sm text-moss">Add keepers to preview this gallery.</p>
        )}
      </dialog>
    </Shell>
  );
}

function CloudDeliver() {
  const [galleries, setGalleries] = useState<GalleryRow[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string; org: string | null }[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [favorites, setFavorites] = useState<{ photo_id: string; viewer: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({ title: "", client_id: "", passcode: "", message: "" });
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [inbox, setInbox] = useState<Awaited<ReturnType<typeof listInboxBookings>>>([]);
  useToolLeaveGuard(
    busy || progress
      ? "A gallery upload or update is still in progress."
      : Object.values(form).some((value) => value.trim())
        ? "Your unsaved gallery details will be discarded."
        : null,
  );

  const refresh = useCallback(async () => {
    const rows = (await listGalleries()) as unknown as GalleryRow[];
    setGalleries(rows);
    if (!openId && rows[0]) setOpenId(rows[0].id);
  }, [openId]);

  useEffect(() => {
    void (async () => {
      try {
        await refresh();
        setClients((await listClients()) as never);
        setInbox(await listInboxBookings());
      } catch {
        setError("Sign in to manage delivery galleries.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!openId) return;
    void (async () => {
      const res = (await getGallery({ data: { id: openId } })) as unknown as GalleryDetailResponse;
      if (res?.error) return setError(res.error);
      setPhotos(res.photos ?? []);
      setFavorites(res.favorites ?? []);
    })();
  }, [openId]);

  const open = galleries.find((g) => g.id === openId) ?? null;
  const link = open
    ? `${typeof window !== "undefined" ? window.location.origin : APPLICATION_ORIGIN}/g/${open.slug}`
    : "";

  const create = async () => {
    if (!form.title.trim()) return;
    setBusy("create");
    const res = (await createGallery({
      data: {
        title: form.title,
        client_id: form.client_id || null,
        passcode: form.passcode || null,
        message: form.message || null,
      },
    })) as unknown as CreateGalleryResponse;
    setBusy(null);
    if (res?.error) return setError(res.error);
    if (!res.gallery) return setError("Gallery could not be created.");
    setForm({ title: "", client_id: "", passcode: "", message: "" });
    setOpenId(res.gallery.id);
    await refresh();
  };

  const upload = async (files: FileList | File[]) => {
    if (!open) return;
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    const { data: session } = await supabase.auth.getUser();
    const uid = session.user?.id;
    if (!uid) return setError("Sign in first.");

    setProgress({ done: 0, total: list.length });
    const uploaded: { storage_path: string; filename: string }[] = [];
    let done = 0;
    const lanes = 4;
    const queue = [...list];
    await Promise.all(
      Array.from({ length: Math.min(lanes, queue.length) }, async () => {
        while (queue.length) {
          const file = queue.shift()!;
          const path = `${uid}/${open.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
          const { error: upErr } = await supabase.storage
            .from("deliveries")
            .upload(path, file, { cacheControl: "3600", upsert: false });
          if (!upErr) uploaded.push({ storage_path: path, filename: file.name });
          done += 1;
          setProgress({ done, total: list.length });
        }
      }),
    );

    if (uploaded.length) {
      await addGalleryPhotos({ data: { gallery_id: open.id, files: uploaded } });
      const res = (await getGallery({ data: { id: open.id } })) as unknown as GalleryDetailResponse;
      setPhotos(res.photos ?? []);
      await refresh();
    }
    setProgress(null);
  };

  const patch = async (p: GalleryPatch) => {
    if (!open) return;
    await updateGallery({ data: { id: open.id, ...p } });
    await refresh();
  };

  const remove = async () => {
    if (!open) return;
    setBusy("delete");
    await deleteGallery({ data: { id: open.id } });
    setBusy(null);
    setOpenId(null);
    setPhotos([]);
    await refresh();
  };

  const favSet = new Set(favorites.map((f) => f.photo_id));

  return (
    <Shell hideEventHeader>
      <SectionTitle
        kicker="Delivery"
        title="Hand the shoot over in one link."
        sub="Keepers only. Clients favorite from that set. Passcode, downloads, and expiry are optional."
      />
      <ProofingEntry />

      {error && (
        <Card className="mb-4 border-destructive/40">
          <p className="text-sm text-destructive">{error}</p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="space-y-3">
          <Card>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
              New gallery
            </p>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Halden Invitational — finals"
              className="mt-3 w-full rounded-lg border border-input bg-card px-3 py-2 text-[13px] outline-none"
            />
            <select
              value={form.client_id}
              onChange={(e) => setForm({ ...form, client_id: e.target.value })}
              className="mt-2 w-full rounded-lg border border-input bg-card px-3 py-2 text-[13px] outline-none"
            >
              <option value="">No client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.org || c.name}
                </option>
              ))}
            </select>
            <input
              value={form.passcode}
              onChange={(e) => setForm({ ...form, passcode: e.target.value })}
              placeholder="Passcode (optional)"
              className="mt-2 w-full rounded-lg border border-input bg-card px-3 py-2 text-[13px] outline-none"
            />
            <textarea
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              placeholder="Note shown to the client"
              rows={2}
              className="mt-2 w-full rounded-lg border border-input bg-card px-3 py-2 text-[13px] outline-none"
            />
            <Btn
              className="mt-3 w-full justify-center"
              variant="primary"
              disabled={busy === "create"}
              onClick={() => void create()}
            >
              {busy === "create" ? "Creating…" : "Create gallery"}
            </Btn>
          </Card>

          {galleries.map((g) => (
            <button
              key={g.id}
              onClick={() => setOpenId(g.id)}
              className={`block w-full rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 ${
                openId === g.id ? "border-rust/50 bg-card" : "border-border bg-card"
              }`}
            >
              <p className="font-display text-[15px] font-semibold tracking-tight">{g.title}</p>
              <p className="font-mono text-[11px] text-moss">
                {g.photo_count} frames · {g.favorite_count} picks · {g.view_count} views
              </p>
            </button>
          ))}
        </div>

        {open ? (
          <div className="space-y-4">
            <Card>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-display text-lg font-semibold tracking-tight">{open.title}</p>
                <Chip tone={open.status === "live" ? "accent" : "quiet"}>{open.status}</Chip>
                {open.passcode && <Chip>passcode</Chip>}
                <div className="ml-auto flex gap-2">
                  <Btn
                    className="px-3 py-1.5 text-[13px]"
                    onClick={() => {
                      void navigator.clipboard.writeText(link);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1400);
                    }}
                  >
                    {copied ? "Copied" : "Copy link"}
                  </Btn>
                  <Btn
                    className="px-3 py-1.5 text-[13px]"
                    onClick={() => window.open(`/g/${open.slug}`, "_blank")}
                  >
                    Preview
                  </Btn>
                </div>
              </div>
              <p className="mt-2 break-all font-mono text-[12px] text-moss">{link}</p>

              <label className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[12px] text-moss">
                Send to shoot request
                <select
                  value={inbox.find((b) => b.gallery_id === open.id)?.id ?? ""}
                  onChange={async (e) => {
                    if (busy) return;
                    const bookingId = e.currentTarget.value;
                    const galleryId = open.id;
                    const prev = inbox.find((b) => b.gallery_id === open.id);
                    if ((prev?.id ?? "") === bookingId) return;
                    let unlinked = false;
                    setBusy("linking-booking");
                    setError(null);
                    try {
                      if (prev) {
                        const result = await attachGalleryToBooking({
                          data: { booking_id: prev.id, gallery_id: null },
                        });
                        if (!("ok" in result) || !result.ok) {
                          setError(result.error || "Could not unlink the previous request.");
                          return;
                        }
                        unlinked = true;
                        // Reflect the confirmed write, even if the next link fails.
                        setInbox((rows) =>
                          rows.map((row) =>
                            row.id === prev.id ? { ...row, gallery_id: null } : row,
                          ),
                        );
                      }
                      if (bookingId) {
                        const result = await attachGalleryToBooking({
                          data: { booking_id: bookingId, gallery_id: galleryId },
                        });
                        if (!("ok" in result) || !result.ok) {
                          setError(
                            `${unlinked ? "The previous request was unlinked. " : ""}${result.error || "Could not link this request."}`,
                          );
                          return;
                        }
                        setInbox((rows) =>
                          rows.map((row) =>
                            row.id === bookingId ? { ...row, gallery_id: galleryId } : row,
                          ),
                        );
                      }
                      setInbox(await listInboxBookings());
                    } catch (cause) {
                      const message =
                        cause instanceof Error
                          ? cause.message
                          : "Could not update the gallery link.";
                      setError(
                        `${unlinked ? "The previous request was unlinked. " : ""}${message}`,
                      );
                    } finally {
                      setBusy(null);
                    }
                  }}
                  className="rounded-lg border border-input bg-card px-2 py-1.5 text-[12px] text-ink"
                >
                  <option value="">— none —</option>
                  {inbox.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.requester_name ?? b.requester_email} · {b.shoot_type} ·{" "}
                      {b.preferred_date ?? "tbc"}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-3 flex flex-wrap gap-2">
                <Btn
                  className="px-3 py-1.5 text-[13px]"
                  onClick={() => void patch({ status: open.status === "live" ? "draft" : "live" })}
                >
                  {open.status === "live" ? "Unpublish" : "Publish"}
                </Btn>
                <Btn
                  className="px-3 py-1.5 text-[13px]"
                  onClick={() => void patch({ downloads_enabled: !open.downloads_enabled })}
                >
                  Downloads: {open.downloads_enabled ? "on" : "off"}
                </Btn>
                <Btn
                  className="ml-auto px-3 py-1.5 text-[13px]"
                  disabled={busy === "delete"}
                  onClick={() => void remove()}
                >
                  Delete
                </Btn>
              </div>
            </Card>

            <Card className="border-dashed">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void upload(e.dataTransfer.files);
                }}
                className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 text-center"
              >
                <p className="font-display text-[15px] font-semibold tracking-tight">
                  Drop keepers here to deliver
                </p>
                <p className="mt-1 text-[13px] text-moss">
                  JPEG or PNG exports. They upload straight to the client link.
                </p>
                <Btn className="mt-3" variant="primary" onClick={() => fileRef.current?.click()}>
                  Choose files
                </Btn>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept="image/*"
                  hidden
                  onChange={(e) => e.target.files && void upload(e.target.files)}
                />
                {progress && (
                  <p className="mt-3 font-mono text-[12px] text-moss">
                    uploading {progress.done}/{progress.total}
                  </p>
                )}
              </div>
            </Card>

            <Card className="p-0">
              <div className="flex items-center gap-2 border-b border-border p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
                  Delivered frames
                </p>
                <p className="ml-auto font-mono text-[11px] text-moss">
                  {photos.length} frames · {favorites.length} client picks
                </p>
              </div>
              {photos.length === 0 ? (
                <p className="p-6 text-sm text-moss">Nothing delivered yet.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 lg:grid-cols-4">
                  {photos.map((p) => (
                    <figure
                      key={p.id}
                      className="relative overflow-hidden rounded-xl border border-border"
                    >
                      {p.url && (
                        <img
                          src={p.url}
                          alt={p.filename}
                          loading="lazy"
                          className="aspect-[4/3] w-full object-cover"
                        />
                      )}
                      {favSet.has(p.id) && (
                        <span className="absolute right-2 top-2 rounded-full bg-ink px-2 py-0.5 font-mono text-[10px] text-paper2">
                          picked
                        </span>
                      )}
                    </figure>
                  ))}
                </div>
              )}
            </Card>
          </div>
        ) : (
          <Card>
            <p className="text-sm text-moss">Create a gallery to start delivering.</p>
          </Card>
        )}
      </div>
    </Shell>
  );
}
