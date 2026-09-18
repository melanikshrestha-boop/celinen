/** "Post to Instagram" from Cull keepers or Develop selections.
 *
 * Flow on screen: choose and order up to ten photos, pick 4:5 or 1:1, drag each
 * preview to place the crop, write the caption. "Post" renders the real JPEGs
 * with the C++ framing engine and shows exactly those images for confirmation;
 * only the second, explicit "Post" sends anything. Nothing posts on its own.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import {
  INSTAGRAM_CAPTION_LIMIT,
  INSTAGRAM_CAROUSEL_LIMIT,
  INSTAGRAM_FEED_FORMATS,
  PUBLISHING_BUCKET,
  captionLength,
  captionProblem,
  instagramPostSettled,
  type InstagramFeedFormat,
} from "@/lib/social/instagram-post";
import type { FramedPhoto } from "@/lib/social/instagram-frame";
import {
  advanceInstagramPost,
  createInstagramPost,
  instagramAccount,
  startInstagramConnection,
} from "@/lib/business/instagram.functions";
import type { InstagramPostView } from "@/lib/business/instagram-post.server";

export type InstagramCandidate = {
  id: string;
  name: string;
  /** Small picture for the chooser. */
  thumbnail: () => Promise<Blob | null>;
  /** Larger picture for placing the crop; the thumbnail stands in when absent. */
  preview?: () => Promise<Blob | null>;
  /** Full developed pixels to frame, or null when this browser cannot read the file. */
  source: () => Promise<Blob | null>;
};

type Placement = { x: number; y: number };
type Account = Awaited<ReturnType<typeof instagramAccount>>;
type Phase =
  | { kind: "compose" }
  | { kind: "rendering"; done: number }
  | { kind: "confirm"; photos: FramedPhoto[]; urls: string[] }
  | { kind: "posting"; photos: FramedPhoto[]; urls: string[]; step: string }
  | { kind: "result"; post: InstagramPostView; photos: FramedPhoto[]; urls: string[] };

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function useThumbnail(candidate: InstagramCandidate | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!candidate) return;
    let live = true;
    let made: string | null = null;
    void (candidate.preview ?? candidate.thumbnail)()
      .catch(() => null)
      .then(async (blob) => blob ?? (await candidate.thumbnail().catch(() => null)))
      .then((blob) => {
        if (!live || !blob) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
      setUrl(null);
    };
  }, [candidate]);
  return url;
}

/** Loads its picture only once scrolled into view: a card can hold hundreds of keepers. */
function Thumb({ candidate, className }: { candidate: InstagramCandidate; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const holder = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = holder.current;
    if (!element || visible) return;
    if (typeof IntersectionObserver === "undefined") return setVisible(true);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    let made: string | null = null;
    void candidate
      .thumbnail()
      .catch(() => null)
      .then((blob) => {
        if (!live || !blob) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [candidate, visible]);
  return url ? (
    <img src={url} alt="" draggable={false} className={className} />
  ) : (
    <span ref={holder} className={`block bg-ink/5 ${className ?? ""}`} />
  );
}

export function InstagramComposer({
  open,
  onOpenChange,
  origin,
  candidates,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  origin: "cull" | "develop";
  candidates: readonly InstagramCandidate[];
  initial: readonly string[];
}) {
  const [account, setAccount] = useState<Account | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [format, setFormat] = useState<InstagramFeedFormat>("portrait");
  const [placements, setPlacements] = useState<Record<string, Placement>>({});
  const [caption, setCaption] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "compose" });
  const [error, setError] = useState<string | null>(null);
  const dragging = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  /** One post id per exact content, so retrying the same post can never post twice. */
  const postIds = useRef(new Map<string, string>());

  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);

  const loadAccount = useCallback(async () => {
    setAccountError(null);
    try {
      setAccount(await instagramAccount());
    } catch (reason) {
      setAccountError(errorText(reason, "Instagram is unavailable right now."));
    }
  }, []);

  // Each opening starts from what the photographer had in hand.
  useEffect(() => {
    if (!open) return;
    const start = initial.filter((id) => byId.has(id)).slice(0, INSTAGRAM_CAROUSEL_LIMIT);
    setSelected(start);
    setActive(start[0] ?? null);
    setPlacements({});
    setPhase({ kind: "compose" });
    setError(null);
    void loadAccount();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open]);

  // Rendered previews own object URLs; release them when leaving that phase.
  const urls = "urls" in phase ? phase.urls : null;
  useEffect(() => () => urls?.forEach((url) => URL.revokeObjectURL(url)), [urls]);
  useEffect(() => () => abort.current?.abort(), []);

  const activeCandidate = active ? byId.get(active) : undefined;
  const activeUrl = useThumbnail(activeCandidate);
  const placement = (active && placements[active]) || { x: 0.5, y: 0.5 };
  const size = INSTAGRAM_FEED_FORMATS[format];
  const problem = captionProblem(caption);
  const busy = phase.kind === "rendering" || phase.kind === "posting";
  const connection = account?.connection;
  const canPost =
    !busy &&
    selected.length > 0 &&
    !problem &&
    !!connection?.active &&
    connection.scopes.includes("instagram_business_content_publish");

  function toggle(id: string) {
    setError(null);
    if (selected.includes(id)) {
      const next = selected.filter((value) => value !== id);
      setSelected(next);
      if (active === id) setActive(next[0] ?? null);
      return;
    }
    if (selected.length >= INSTAGRAM_CAROUSEL_LIMIT) {
      setError(`A post holds up to ${INSTAGRAM_CAROUSEL_LIMIT} photos.`);
      return;
    }
    setSelected([...selected, id]);
    setActive(id);
  }
  function move(id: string, to: number) {
    setSelected((current) => {
      const from = current.indexOf(id);
      if (from < 0 || to < 0 || to >= current.length || from === to) return current;
      const next = [...current];
      next.splice(from, 1);
      next.splice(to, 0, id);
      return next;
    });
  }

  // Dragging the preview moves the crop, in the same 0..1 terms the C++ operator uses.
  const pan = useRef<{
    x: number;
    y: number;
    start: Placement;
    width: number;
    height: number;
  } | null>(null);
  function onPanStart(event: PointerEvent<HTMLDivElement>) {
    if (!active || busy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const box = event.currentTarget.getBoundingClientRect();
    pan.current = {
      x: event.clientX,
      y: event.clientY,
      start: placement,
      width: box.width,
      height: box.height,
    };
  }
  function onPanMove(event: PointerEvent<HTMLDivElement>) {
    const drag = pan.current;
    if (!drag || !active) return;
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    setPlacements((current) => ({
      ...current,
      [active]: {
        x: clamp(drag.start.x - (event.clientX - drag.x) / drag.width),
        y: clamp(drag.start.y - (event.clientY - drag.y) / drag.height),
      },
    }));
  }

  async function render() {
    if (!canPost) return;
    setError(null);
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ kind: "rendering", done: 0 });
    try {
      const { frameForInstagram } = await import("@/lib/social/instagram-frame");
      const photos: FramedPhoto[] = [];
      for (const id of selected) {
        const candidate = byId.get(id)!;
        const source = await candidate.source();
        if (!source)
          throw new Error(
            origin === "cull"
              ? `${candidate.name} cannot be read here. Open it in Develop to post it.`
              : `${candidate.name} has no available source.`,
          );
        const { x, y } = placements[id] ?? { x: 0.5, y: 0.5 };
        photos.push(await frameForInstagram(source, { format, x, y, zoom: 1 }, controller.signal));
        setPhase({ kind: "rendering", done: photos.length });
      }
      setPhase({
        kind: "confirm",
        photos,
        urls: photos.map((photo) => URL.createObjectURL(photo.blob)),
      });
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(errorText(reason, "These photos could not be prepared."));
      setPhase({ kind: "compose" });
    }
  }

  async function post(photos: FramedPhoto[], previews: string[]) {
    setError(null);
    const content = JSON.stringify([format, caption, photos.map((photo) => photo.sha256)]);
    let id = postIds.current.get(content);
    if (!id) postIds.current.set(content, (id = crypto.randomUUID()));
    const step = (text: string) =>
      setPhase({ kind: "posting", photos, urls: previews, step: text });
    try {
      step("Uploading");
      const created = await createInstagramPost({
        data: {
          id,
          source: origin,
          format,
          caption,
          items: photos.map(({ sha256, bytes, width, height }) => ({
            sha256,
            bytes,
            width,
            height,
          })),
        },
      });
      if (created.uploads.length) {
        const { supabase } = await import("@/integrations/supabase/client");
        for (const [index, ticket] of created.uploads.entries()) {
          const uploaded = await supabase.storage
            .from(PUBLISHING_BUCKET)
            .uploadToSignedUrl(ticket.path, ticket.token, photos[index]!.blob, {
              contentType: "image/jpeg",
              upsert: true,
            });
          if (uploaded.error)
            throw new Error("A photo did not upload. Nothing was posted; try again.");
        }
      }
      step("Posting");
      let view = created.post;
      const deadline = Date.now() + 6 * 60_000;
      // Each call is one bounded server step; the server decides what is safe to do next.
      for (let attempt = 0; ; attempt++) {
        view = await advanceInstagramPost({ data: { id } });
        if (instagramPostSettled(view.status)) break;
        if (view.status === "awaiting-upload")
          throw new Error(view.note || "The photos did not upload.");
        if (Date.now() > deadline) break;
        step(view.status === "processing" ? "Instagram is processing" : "Posting");
        await wait(
          view.status === "processing" ? Math.min(30_000, 10_000 + attempt * 5_000) : 1000,
        );
      }
      setPhase({ kind: "result", post: view, photos, urls: previews });
    } catch (reason) {
      setError(errorText(reason, "Instagram could not post this."));
      setPhase({ kind: "confirm", photos, urls: previews });
    }
  }

  async function connect() {
    // Open the tab inside the click so it is not blocked; this page keeps its photos.
    const tab = window.open("about:blank", "_blank");
    try {
      const url = await startInstagramConnection();
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch (reason) {
      tab?.close();
      setAccountError(errorText(reason, "Instagram could not be connected."));
    }
  }

  const close = (next: boolean) => {
    if (!next && phase.kind === "posting") return; // an in-flight post must report back first
    if (!next) abort.current?.abort();
    onOpenChange(next);
  };

  const buttonPrimary =
    "rounded-md bg-ink px-3 py-1.5 text-paper2 transition-colors hover:bg-rust disabled:opacity-40 disabled:hover:bg-ink";
  const buttonQuiet = "rounded-md px-2.5 py-1.5 hover:bg-ink/5 disabled:opacity-40";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={close}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // Studio screens bind single-key shortcuts (K keeps a frame); none may fire from here.
          onKeyDown={(event) => event.stopPropagation()}
          className="instagram-composer fixed left-1/2 top-1/2 z-50 flex h-[min(720px,92dvh)] w-[min(960px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-paper2 text-ink shadow-2xl"
        >
          <header className="flex items-center gap-3 px-5 py-3">
            <DialogPrimitive.Title className="font-display text-[20px] font-medium tracking-[-0.03em]">
              Post to Instagram
            </DialogPrimitive.Title>
            <span className="ml-auto font-mono text-[11px] text-moss">
              {connection?.active ? `@${connection.username}` : null}
            </span>
            <DialogPrimitive.Close
              className={buttonQuiet}
              aria-label="Close"
              disabled={phase.kind === "posting"}
            >
              <X size={16} />
            </DialogPrimitive.Close>
          </header>

          {accountError || (account && (!account.configured || !connection?.active)) ? (
            <div className="flex flex-wrap items-center gap-2 px-5 pb-3 font-mono text-[11px]">
              {accountError ? (
                <p role="alert" className="text-rust">
                  {accountError}
                </p>
              ) : !account!.configured ? (
                <p role="alert" className="text-rust">
                  Instagram is not set up for Celinen yet.
                </p>
              ) : (
                <>
                  <button type="button" className={buttonPrimary} onClick={() => void connect()}>
                    {connection ? "Reconnect Instagram" : "Connect Instagram"}
                  </button>
                  <button type="button" className={buttonQuiet} onClick={() => void loadAccount()}>
                    Refresh
                  </button>
                </>
              )}
            </div>
          ) : null}

          {phase.kind === "compose" || phase.kind === "rendering" ? (
            <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-5 pb-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <section className="flex min-w-0 flex-col gap-3">
                <div
                  className="flex items-center gap-1 font-mono text-[11px]"
                  role="group"
                  aria-label="Crop"
                >
                  {(Object.keys(INSTAGRAM_FEED_FORMATS) as InstagramFeedFormat[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={format === key}
                      disabled={busy}
                      onClick={() => setFormat(key)}
                      className={`rounded-full px-3 py-1 transition-colors ${format === key ? "bg-ink text-paper2" : "border border-input hover:bg-ink hover:text-paper2"}`}
                    >
                      {INSTAGRAM_FEED_FORMATS[key].label}
                    </button>
                  ))}
                </div>
                <div
                  className="relative mx-auto w-full max-w-[420px] cursor-grab touch-none overflow-hidden rounded-md bg-ink/5 active:cursor-grabbing"
                  style={{ aspectRatio: `${size.width} / ${size.height}` }}
                  onPointerDown={onPanStart}
                  onPointerMove={onPanMove}
                  onPointerUp={() => (pan.current = null)}
                  onPointerCancel={() => (pan.current = null)}
                  aria-label="Crop preview"
                  role="img"
                >
                  {activeUrl ? (
                    <img
                      src={activeUrl}
                      alt=""
                      draggable={false}
                      className="pointer-events-none h-full w-full select-none object-cover"
                      style={{ objectPosition: `${placement.x * 100}% ${placement.y * 100}%` }}
                    />
                  ) : null}
                </div>
                {selected.length > 0 && (
                  <ol className="flex flex-wrap gap-2" aria-label="Post order">
                    {selected.map((id, index) => {
                      const candidate = byId.get(id)!;
                      return (
                        <li
                          key={id}
                          draggable={!busy}
                          onDragStart={(event) => {
                            dragging.current = id;
                            event.dataTransfer.effectAllowed = "move";
                          }}
                          onDragOver={(event) => {
                            if (dragging.current) event.preventDefault();
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            if (dragging.current) move(dragging.current, index);
                            dragging.current = null;
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "ArrowLeft") move(id, index - 1);
                            if (event.key === "ArrowRight") move(id, index + 1);
                          }}
                          className="group relative"
                        >
                          <button
                            type="button"
                            aria-label={`${index + 1}. ${candidate.name}`}
                            aria-current={active === id ? "true" : undefined}
                            onClick={() => setActive(id)}
                            className="block overflow-hidden rounded-md outline-offset-2 aria-[current=true]:outline aria-[current=true]:outline-2 aria-[current=true]:outline-rust"
                          >
                            <Thumb candidate={candidate} className="h-14 w-14 object-cover" />
                          </button>
                          <span className="pointer-events-none absolute left-1 top-1 rounded bg-ink/70 px-1 font-mono text-[10px] text-paper2">
                            {index + 1}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>

              <section className="flex min-w-0 flex-col gap-3">
                {candidates.length > 1 && (
                  <div className="grid max-h-[220px] grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5 overflow-y-auto">
                    {candidates.map((candidate) => {
                      const chosen = selected.includes(candidate.id);
                      return (
                        <button
                          key={candidate.id}
                          type="button"
                          aria-pressed={chosen}
                          aria-label={candidate.name}
                          disabled={busy}
                          onClick={() => toggle(candidate.id)}
                          className={`relative overflow-hidden rounded-md transition-opacity ${chosen ? "" : "opacity-55 hover:opacity-100"}`}
                        >
                          <Thumb
                            candidate={candidate}
                            className="aspect-square w-full object-cover"
                          />
                          {chosen && (
                            <span className="absolute right-1 top-1 rounded bg-rust px-1 font-mono text-[10px] text-paper2">
                              {selected.indexOf(candidate.id) + 1}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                <label className="flex flex-1 flex-col gap-1.5">
                  <span className="sr-only">Caption</span>
                  <textarea
                    value={caption}
                    disabled={busy}
                    onChange={(event) => setCaption(event.target.value)}
                    rows={7}
                    placeholder="Caption"
                    className="min-h-[140px] flex-1 resize-none rounded-md border border-input bg-transparent p-3 text-[15px] leading-relaxed outline-none focus:border-ink"
                  />
                </label>
                <div className="flex items-center gap-2 font-mono text-[11px]">
                  <span
                    className={
                      captionLength(caption) > INSTAGRAM_CAPTION_LIMIT ? "text-rust" : "text-moss"
                    }
                    aria-live="polite"
                  >
                    {`${captionLength(caption).toLocaleString("en-US")} / ${INSTAGRAM_CAPTION_LIMIT.toLocaleString("en-US")}`}
                  </span>
                  <span className="ml-auto text-moss">
                    {phase.kind === "rendering" ? `${phase.done} / ${selected.length}` : null}
                  </span>
                  <button
                    type="button"
                    className={buttonPrimary}
                    disabled={!canPost}
                    onClick={() => void render()}
                  >
                    {selected.length > 1 ? `Post ${selected.length}` : "Post"}
                  </button>
                </div>
                {(problem || error) && (
                  <p role="alert" className="font-mono text-[11px] text-rust">
                    {error ?? problem}
                  </p>
                )}
              </section>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5">
              <ol className="flex gap-2 overflow-x-auto" aria-label="Photos to post">
                {phase.urls.map((url, index) => (
                  <li key={url} className="shrink-0">
                    <img
                      src={url}
                      alt={`Photo ${index + 1}`}
                      className="h-[min(320px,38dvh)] rounded-md object-cover"
                      style={{ aspectRatio: `${size.width} / ${size.height}` }}
                    />
                  </li>
                ))}
              </ol>
              {caption && (
                <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{caption}</p>
              )}
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                {phase.kind === "confirm" && (
                  <>
                    <button
                      type="button"
                      className={buttonQuiet}
                      onClick={() => {
                        setError(null);
                        setPhase({ kind: "compose" });
                      }}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      className={`${buttonPrimary} ml-auto`}
                      onClick={() => void post(phase.photos, phase.urls)}
                    >
                      {`Post to @${connection?.username ?? "Instagram"}`}
                    </button>
                  </>
                )}
                {phase.kind === "posting" && (
                  <p role="status" className="text-moss">
                    {phase.step}
                  </p>
                )}
                {phase.kind === "result" && (
                  <>
                    <p
                      role="status"
                      className={phase.post.status === "published" ? "text-ink" : "text-rust"}
                    >
                      {phase.post.note}
                    </p>
                    {phase.post.permalink && (
                      <a
                        href={phase.post.permalink}
                        target="_blank"
                        rel="noreferrer"
                        className={`${buttonPrimary} ml-auto`}
                      >
                        Open on Instagram
                      </a>
                    )}
                    {phase.post.status === "failed" && (
                      <button
                        type="button"
                        className={`${buttonPrimary} ml-auto`}
                        onClick={() => void post(phase.photos, phase.urls)}
                      >
                        Try again
                      </button>
                    )}
                    {!instagramPostSettled(phase.post.status) ||
                    phase.post.status === "uncertain" ? (
                      <button
                        type="button"
                        className={`${buttonQuiet} ml-auto`}
                        onClick={() => void post(phase.photos, phase.urls)}
                      >
                        Check again
                      </button>
                    ) : null}
                  </>
                )}
              </div>
              {error && (
                <p role="alert" className="font-mono text-[11px] text-rust">
                  {error}
                </p>
              )}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
