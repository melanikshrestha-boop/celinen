import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/lensos/Logo";
import { uploadReferenceBatch, type ReferenceUpload } from "@/lib/reference-upload";
import {
  getShootSpace,
  createShootUploadUrl,
  recordShootUpload,
  addShootNote,
} from "@/lib/shoot-app.functions";

export const Route = createFileRoute("/s/$token")({
  ssr: false,
  remountDeps: ({ params }) => params.token,
  head: () => ({
    meta: [
      { title: "Your shoot — LensLabs" },
      {
        name: "description",
        content:
          "Your private LensLabs shoot space: references, notes with your photographer, and the final gallery.",
      },
      { property: "og:title", content: "Your shoot — LensLabs" },
      {
        property: "og:description",
        content: "References, notes and final photos — one private link.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ShootSpace,
});

type Space = Extract<Awaited<ReturnType<typeof getShootSpace>>, { booking: unknown }>;

const STATUS: Record<string, { label: string; tone: string }> = {
  new: { label: "Requested", tone: "bg-mist text-moss" },
  confirmed: { label: "Confirmed", tone: "bg-primary/10 text-primary" },
  declined: { label: "Declined", tone: "bg-destructive/10 text-destructive" },
};

function ShootSpace() {
  const { token } = Route.useParams();
  const [space, setSpace] = useState<Space | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "gone">("loading");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const uploadLock = useRef(false);
  const uploadGeneration = useRef(0);
  const [uploading, setUploading] = useState<string | null>(null);
  const [pendingUploads, setPendingUploads] = useState<ReferenceUpload[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const generation = uploadGeneration.current;
    const res = await getShootSpace({ data: { token } });
    if (generation !== uploadGeneration.current) return;
    if ("error" in res) return setState("gone");
    setSpace(res);
    setState("ok");
  }, [token]);

  useEffect(() => {
    const lifetime = uploadGeneration;
    void load();
    return () => {
      lifetime.current++;
    };
  }, [load]);

  const uploadFiles = async (entries: ReferenceUpload[]) => {
    if (!entries.length || uploadLock.current) return;
    const generation = uploadGeneration.current;
    const isCurrent = () => generation === uploadGeneration.current;
    uploadLock.current = true;
    setPendingUploads(entries);
    setUploadError(null);
    try {
      const result = await uploadReferenceBatch(entries, {
        isCurrent,
        createUrl: (file) => createShootUploadUrl({ data: { token, filename: file.name } }),
        put: (url, file) => fetch(url, { method: "PUT", body: file }),
        record: (path, file) =>
          recordShootUpload({ data: { token, storage_path: path, filename: file.name } }),
        isRecorded: async (path) => {
          const current = await getShootSpace({ data: { token } });
          if ("error" in current)
            throw new Error(
              "This shoot link could not confirm the upload. Ask your photographer for help.",
            );
          return current.uploads.some(
            (upload) =>
              upload.storage_path === path && typeof upload.url === "string" && !!upload.url.trim(),
          );
        },
        onProgress: (file) => setUploading(`Uploading ${file.name}…`),
      });
      if (!isCurrent()) return;
      setPendingUploads(result.pending);
      setUploadError(result.error);
      if (!result.pending.length && fileRef.current) fileRef.current.value = "";
      if (result.completed) {
        try {
          await load();
        } catch {
          if (!isCurrent()) return;
          setUploadError(
            [
              result.error,
              "Confirmed uploads were saved, but the list could not refresh. Reload to see them.",
            ]
              .filter(Boolean)
              .join(" "),
          );
        }
      }
    } finally {
      if (isCurrent()) {
        uploadLock.current = false;
        setUploading(null);
      }
    }
  };
  const onFiles = (files: FileList | null) => {
    return files?.length ? uploadFiles(Array.from(files, (file) => ({ file }))) : Promise.resolve();
  };

  const postNote = async () => {
    if (!note.trim()) return;
    setBusy("Sending…");
    await addShootNote({ data: { token, message: note } });
    setNote("");
    setBusy(null);
    await load();
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked */
    }
  };

  if (state === "loading")
    return <p className="p-10 text-center font-mono text-[13px] text-moss">Opening your shoot…</p>;

  if (state === "gone" || !space)
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <LogoMark />
        <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">
          Link unavailable
        </h1>
        <p className="mt-2 text-sm text-moss">
          This shoot link isn&apos;t valid anymore. Ask your photographer for a fresh one, or{" "}
          <Link to="/shoots" className="text-primary underline underline-offset-4">
            start a new shoot
          </Link>
          .
        </p>
      </div>
    );

  const b = space.booking;
  const status = STATUS[b.status] ?? STATUS["new"]!;

  return (
    <main className="min-h-dvh px-5 py-8">
      <div className="mx-auto max-w-[980px]">
        <header className="flex flex-wrap items-center gap-3">
          <Link to="/" className="flex items-center gap-2">
            <LogoMark className="text-ink" />
            <span className="font-display text-[15px] font-semibold tracking-tight">LensLabs</span>
          </Link>
          <span className={`rounded-full px-2.5 py-1 font-mono text-[11px] ${status.tone}`}>
            {status.label}
          </span>
          <button
            onClick={share}
            className="ml-auto rounded-xl border border-input px-3 py-1.5 font-mono text-[12px] text-moss transition-colors hover:text-ink"
          >
            {copied ? "link copied" : "copy shoot link"}
          </button>
        </header>

        <section className="mt-8">
          <h1 className="font-display text-[32px] font-semibold leading-[1.05] tracking-tight">
            {b.shoot_type} shoot{b.name ? ` · ${b.name}` : ""}
          </h1>
          <p className="mt-2 font-mono text-[12px] text-moss">
            {b.preferred_date ?? "date tbc"}
            {b.location ? ` · ${b.location}` : ""}
            {b.budget ? ` · $${Number(b.budget).toLocaleString()}` : ""}
          </p>
        </section>

        <div className="mt-8 grid gap-5 lg:grid-cols-[1.35fr_1fr]">
          {/* references */}
          <section className="panel p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-[17px] font-semibold tracking-tight">References</h2>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={!!uploading}
                className="rounded-lg bg-ink px-3 py-1.5 font-mono text-[12px] text-paper2"
              >
                Add photos
              </button>
            </div>
            <p className="mt-1 text-[13px] text-moss">
              Drop the looks you want. Your photographer sees these instantly.
            </p>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*"
              disabled={!!uploading}
              hidden
              onChange={(e) => void onFiles(e.target.files)}
            />

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void onFiles(e.dataTransfer.files);
              }}
              className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-dashed border-input p-3 sm:grid-cols-3"
            >
              {space.uploads.length === 0 && (
                <p className="col-span-full py-10 text-center font-mono text-[12px] text-moss">
                  drop reference photos here
                </p>
              )}
              {space.uploads.map((u) => (
                <figure key={u.id} className="overflow-hidden rounded-lg border border-border">
                  {u.url ? (
                    <img
                      src={u.url}
                      alt={u.filename}
                      loading="lazy"
                      className="aspect-square w-full object-cover"
                    />
                  ) : (
                    <div className="aspect-square w-full bg-mist" />
                  )}
                </figure>
              ))}
            </div>
            {(uploading || busy) && (
              <p className="mt-3 font-mono text-[12px] text-moss">{uploading || busy}</p>
            )}
            {uploadError && (
              <p role="alert" className="mt-3 text-[13px] text-destructive">
                {uploadError}
              </p>
            )}
            {!!pendingUploads.length && !uploading && (
              <button
                type="button"
                onClick={() => void uploadFiles(pendingUploads)}
                className="mt-3 text-[13px] underline"
              >
                {pendingUploads[0]?.confirmationUnknown
                  ? "Check upload status"
                  : "Retry remaining uploads"}
              </button>
            )}
          </section>

          <div className="space-y-5">
            {/* gallery */}
            <section className="panel p-6">
              <h2 className="font-display text-[17px] font-semibold tracking-tight">
                Final photos
              </h2>
              {space.gallery ? (
                <>
                  <p className="mt-1 text-[13px] text-moss">
                    {space.gallery.photo_count} frames delivered — full resolution, original files.
                  </p>
                  <Link
                    to="/g/$slug"
                    params={{ slug: space.gallery.slug }}
                    className="mt-4 inline-block rounded-xl bg-primary px-4 py-2.5 text-[14px] font-medium text-primary-foreground"
                  >
                    Open gallery →
                  </Link>
                </>
              ) : (
                <p className="mt-1 text-[13px] text-moss">
                  Nothing delivered yet. When your photographer publishes the gallery, it shows up
                  right here — and downloads come through untouched, RAW included.
                </p>
              )}
            </section>

            {/* notes */}
            <section className="panel p-6">
              <h2 className="font-display text-[17px] font-semibold tracking-tight">
                Notes with your photographer
              </h2>
              {b.message && (
                <pre className="mt-3 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-moss">
                  {b.message}
                </pre>
              )}
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="Add a note…"
                className="mt-3 w-full resize-none rounded-xl border border-input bg-card px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                onClick={() => void postNote()}
                className="mt-2 w-full rounded-xl border border-input px-4 py-2 text-[14px] transition-colors hover:bg-muted"
              >
                Send note
              </button>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
