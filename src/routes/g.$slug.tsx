import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogoMark } from "@/components/lensos/Logo";
import { openGallery, toggleGalleryFavorite } from "@/lib/delivery.functions";
import { makeZip } from "@/lib/zip";

export const Route = createFileRoute("/g/$slug")({
  head: () => ({
    meta: [
      { title: "Your gallery — LensLabs" },
      {
        name: "description",
        content: "Your photographer delivered your shoot. Browse, favourite the frames you want, and download them.",
      },
      { property: "og:title", content: "Your gallery — LensLabs" },
      { property: "og:description", content: "Browse, favourite and download your delivered photos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ClientGallery,
});

type Photo = { id: string; filename: string; url: string | null };

function ClientGallery() {
  const { slug } = Route.useParams();
  const [state, setState] = useState<"loading" | "ok" | "passcode" | "gone">("loading");
  const [passcode, setPasscode] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [downloads, setDownloads] = useState(true);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [onlyPicks, setOnlyPicks] = useState(false);
  const [zipping, setZipping] = useState(false);

  const load = async (code?: string) => {
    const res = (await openGallery({ data: { slug, passcode: code ?? "" } })) as any;
    if (res?.error === "passcode") {
      setTitle(res.title ?? "");
      setState("passcode");
      return;
    }
    if (res?.error) return setState("gone");
    setTitle(res.gallery.title);
    setMessage(res.gallery.message);
    setDownloads(res.gallery.downloads_enabled);
    setPhotos(res.photos);
    setFavs(new Set(res.favorites));
    setState("ok");
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const toggle = async (id: string) => {
    const on = !favs.has(id);
    setFavs((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
    await toggleGalleryFavorite({ data: { slug, photo_id: id, on } });
  };

  /** Zip the originals byte-for-byte — no re-encode, no resize, RAW stays RAW. */
  const grabAll = async (list: Photo[]) => {
    setZipping(true);
    try {
      const entries: { path: string; bytes: Uint8Array }[] = [];
      for (const p of list) {
        if (!p.url) continue;
        const buf = await (await fetch(p.url)).arrayBuffer();
        entries.push({ path: p.filename, bytes: new Uint8Array(buf) });
      }
      const url = URL.createObjectURL(makeZip(entries));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title || "gallery"}-originals.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setZipping(false);
    }
  };

  const grab = async (p: Photo) => {
    if (!p.url) return;
    const blob = await (await fetch(p.url)).blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = p.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const shown = onlyPicks ? photos.filter((p) => favs.has(p.id)) : photos;

  if (state === "loading")
    return <p className="p-10 text-center font-mono text-[13px] text-moss">Opening gallery…</p>;

  if (state === "gone")
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <LogoMark />
        <h1 className="mt-4 font-display text-2xl font-bold tracking-tight">Link unavailable</h1>
        <p className="mt-2 text-sm text-moss">
          This gallery is closed or expired. Ask your photographer for a fresh link.
        </p>
      </div>
    );

  if (state === "passcode")
    return (
      <div className="mx-auto max-w-sm p-10 text-center">
        <LogoMark />
        <h1 className="mt-4 font-display text-2xl font-bold tracking-tight">{title || "Private gallery"}</h1>
        <p className="mt-2 text-sm text-moss">Enter the passcode your photographer sent you.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load(passcode);
          }}
        >
          <input
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="Passcode"
            className="mt-4 w-full rounded-lg border border-input bg-card px-3 py-2 text-center text-[14px] outline-none"
          />
          <button
            type="submit"
            className="mt-3 w-full rounded-lg bg-ink px-4 py-2 text-[14px] text-paper2"
          >
            Open gallery
          </button>
        </form>
      </div>
    );

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-border bg-paper/90 px-5 py-3 backdrop-blur">
        <LogoMark />
        <div>
          <p className="font-display text-[15px] font-semibold tracking-tight">{title}</p>
          <p className="font-mono text-[11px] text-moss">
            {photos.length} frames · {favs.size} favourited
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => setOnlyPicks((v) => !v)}
            className="rounded-lg border border-input px-3 py-1.5 font-mono text-[12px]"
          >
            {onlyPicks ? "Show all" : "Show favourites"}
          </button>
          {downloads && (
            <button
              onClick={() => void grabAll(shown)}
              disabled={zipping}
              className="rounded-lg bg-ink px-3 py-1.5 font-mono text-[12px] text-paper2 disabled:opacity-50"
            >
              {zipping ? "packing originals…" : `Download ${onlyPicks ? "favourites" : "all"} · RAW`}
            </button>
          )}
        </div>
      </header>

      {message && <p className="px-5 py-4 text-sm text-moss">{message}</p>}

      <div className="grid grid-cols-2 gap-2 p-5 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((p, i) => (
          <figure key={p.id} className="group relative overflow-hidden rounded-xl border border-border">
            {p.url && (
              <img
                src={p.url}
                alt={p.filename}
                loading="lazy"
                onClick={() => setLightbox(i)}
                className="aspect-[4/3] w-full cursor-zoom-in object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              />
            )}
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={() => void toggle(p.id)}
                aria-label="Favourite"
                className="rounded-full bg-white/90 px-2 py-1 text-[12px] text-black"
              >
                {favs.has(p.id) ? "♥ picked" : "♡ pick"}
              </button>
              {downloads && (
                <button
                  onClick={() => void grab(p)}
                  className="ml-auto rounded-full bg-white/90 px-2 py-1 text-[12px] text-black"
                >
                  download
                </button>
              )}
            </div>
            {favs.has(p.id) && (
              <span className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] text-black">
                ♥
              </span>
            )}
          </figure>
        ))}
      </div>

      {lightbox !== null && shown[lightbox]?.url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6"
          onClick={() => setLightbox(null)}
        >
          <img
            src={shown[lightbox]!.url!}
            alt={shown[lightbox]!.filename}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      )}
    </div>
  );
}
