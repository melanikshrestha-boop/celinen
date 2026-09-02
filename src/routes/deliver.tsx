import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
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

export const Route = createFileRoute("/deliver")({
  head: () => ({
    meta: [
      { title: "Delivery — LensLabs client galleries" },
      {
        name: "description",
        content:
          "Send a shoot to the client as a fast, passcode-protected gallery: they favourite the frames they want and download in one click.",
      },
      { property: "og:title", content: "Delivery — LensLabs client galleries" },
      {
        property: "og:description",
        content: "Gallery links, client favourites, downloads, expiry — no Pixieset required.",
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

function Deliver() {
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
      const res = (await getGallery({ data: { id: openId } })) as any;
      if (res?.error) return setError(res.error);
      setPhotos(res.photos ?? []);
      setFavorites(res.favorites ?? []);
    })();
  }, [openId]);

  const open = galleries.find((g) => g.id === openId) ?? null;
  const link = open ? `${typeof window !== "undefined" ? window.location.origin : "https://lenslab.dev"}/g/${open.slug}` : "";

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
    })) as any;
    setBusy(null);
    if (res?.error) return setError(res.error);
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
          const path = `${uid}/${open.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
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
      const res = (await getGallery({ data: { id: open.id } })) as any;
      setPhotos(res.photos ?? []);
      await refresh();
    }
    setProgress(null);
  };

  const patch = async (p: Partial<GalleryRow>) => {
    if (!open) return;
    await updateGallery({ data: { id: open.id, ...(p as any) } });
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
        sub="Passcode optional, downloads optional, expiry optional. The client favourites what they want and you see the picks instantly."
      />

      {error && (
        <Card className="mb-4 border-destructive/40">
          <p className="text-sm text-destructive">{error}</p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="space-y-3">
          <Card>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">New gallery</p>
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
                  <Btn className="px-3 py-1.5 text-[13px]" onClick={() => window.open(`/g/${open.slug}`, "_blank")}>
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
                    const prev = inbox.find((b) => b.gallery_id === open.id);
                    if (prev && prev.id !== e.target.value)
                      await attachGalleryToBooking({ data: { booking_id: prev.id, gallery_id: null } });
                    if (e.target.value)
                      await attachGalleryToBooking({
                        data: { booking_id: e.target.value, gallery_id: open.id },
                      });
                    setInbox(await listInboxBookings());
                  }}
                  className="rounded-lg border border-input bg-card px-2 py-1.5 text-[12px] text-ink"
                >
                  <option value="">— none —</option>
                  {inbox.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.requester_name ?? b.requester_email} · {b.shoot_type} · {b.preferred_date ?? "tbc"}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-3 flex flex-wrap gap-2">
                <Btn
                  className="px-3 py-1.5 text-[13px]"
                  onClick={() => void patch({ status: open.status === "live" ? "draft" : "live" } as any)}
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

            <Card
              className="border-dashed"
              // eslint-disable-next-line react/no-unknown-property
            >
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
                    <figure key={p.id} className="relative overflow-hidden rounded-xl border border-border">
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
