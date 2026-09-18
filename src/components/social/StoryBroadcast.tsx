/** "Post to stories" — one hearted set, every destination at once.
 *
 * Flow on screen: the hearted photos arrive chosen; drag any one to place its
 * 9:16 crop; tick the destinations. "Post" frames the real JPEGs with the C++
 * engine and shows exactly those images for confirmation; only the second,
 * explicit "Post" sends anything. The result is one line per destination.
 *
 * Snapchat is not posted by Celinen and never claims to be: it has no story API
 * for other apps, so the framed photos go to the phone's share sheet (or a
 * download) and the photographer posts them herself.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import {
  DESTINATION_LABELS,
  PUBLISHING_BUCKET,
  SNAPCHAT_HANDOFF,
  STORY_FORMAT,
  STORY_SET_LIMIT,
  destinationSummary,
  type StoryBroadcastView,
  type StoryDestination,
} from "@/lib/social/story-broadcast";
import type { FramedStory } from "@/lib/social/instagram-frame";
import {
  advanceStoryBroadcast,
  createStoryBroadcast,
  reconcileStoryBroadcast,
  storyDestinations,
} from "@/lib/business/story-broadcast.functions";
import { startInstagramConnection } from "@/lib/business/instagram.functions";
import { connectFacebook } from "@/lib/business/facebook.functions";

export type StoryCandidate = {
  id: string;
  name: string;
  /** Picture for the chooser and for placing the crop. */
  preview: () => Promise<Blob | null>;
  /** Full developed pixels to frame, or null when this browser cannot read the file. */
  source: () => Promise<Blob | null>;
};

type Readiness = Awaited<ReturnType<typeof storyDestinations>>;
type Placement = { x: number; y: number };
type Phase =
  | { kind: "compose" }
  | { kind: "rendering"; done: number }
  | { kind: "confirm"; photos: FramedStory[]; urls: string[] }
  | { kind: "posting"; photos: FramedStory[]; urls: string[]; step: string }
  | { kind: "result"; broadcast: StoryBroadcastView | null; photos: FramedStory[]; urls: string[] };

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp = (value: number) => Math.min(1, Math.max(0, value));
/** Anything a read-back could still settle. */
const needsChecking = (broadcast: StoryBroadcastView | null) =>
  !!broadcast?.destinations.some(
    (line) => line.status === "uncertain" || line.status === "partial",
  );

function usePreview(candidate: StoryCandidate | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!candidate) return;
    let live = true;
    let made: string | null = null;
    void candidate
      .preview()
      .then((blob) => {
        if (!live || !blob) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => {});
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
      setUrl(null);
    };
  }, [candidate]);
  return url;
}

export function StoryBroadcast({
  open,
  onOpenChange,
  origin,
  candidates,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  origin: "develop" | "cull";
  candidates: readonly StoryCandidate[];
  initial: readonly string[];
}) {
  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const [selected, setSelected] = useState<string[]>(() =>
    initial.filter((id) => byId.has(id)).slice(0, STORY_SET_LIMIT),
  );
  const [active, setActive] = useState<string | null>(() => initial[0] ?? null);
  const [placements, setPlacements] = useState<Record<string, Placement>>({});
  const [destinations, setDestinations] = useState<StoryDestination[]>(["instagram-story"]);
  const [ready, setReady] = useState<Readiness | null>(null);
  const [readyError, setReadyError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "compose" });
  const [error, setError] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  // One broadcast id per exact set of bytes: a second Post of the same photos
  // resumes the same broadcast rather than starting one that could double-post.
  const broadcastIds = useRef(new Map<string, string>());
  /** The set that was last sent, so the result can be checked again. */
  const lastId = useRef<string | null>(null);

  const loadReadiness = useCallback(async () => {
    setReadyError(null);
    try {
      setReady(await storyDestinations());
    } catch (reason) {
      setReadyError(errorText(reason, "Connected accounts could not be read."));
    }
  }, []);
  useEffect(() => {
    void loadReadiness();
  }, [loadReadiness]);

  const activeCandidate = active ? byId.get(active) : undefined;
  const previewUrl = usePreview(activeCandidate);
  const busy = phase.kind === "rendering" || phase.kind === "posting";

  const serverChosen = destinations.filter((d) => d !== "snapchat");
  const snapchatChosen = destinations.includes("snapchat");
  const blocked = serverChosen.filter((d) =>
    d === "instagram-story" ? !ready?.instagram.ready : !ready?.facebook.ready,
  );
  const canPost = selected.length > 0 && destinations.length > 0 && !blocked.length && !busy;

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : current.length >= STORY_SET_LIMIT
          ? current
          : [...current, id],
    );
    setActive(id);
  }

  function toggleDestination(destination: StoryDestination) {
    setDestinations((current) =>
      current.includes(destination)
        ? current.filter((entry) => entry !== destination)
        : [...current, destination],
    );
  }

  // Dragging the preview moves which part of an over-wide photo stays in the 9:16 frame.
  const drag = useRef<{ x: number; y: number; start: Placement; w: number; h: number } | null>(
    null,
  );
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!active || busy) return;
    const box = event.currentTarget.getBoundingClientRect();
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      start: placements[active] ?? { x: 0.5, y: 0.5 },
      w: box.width,
      h: box.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || !active) return;
    setPlacements((current) => ({
      ...current,
      [active]: {
        x: clamp(state.start.x - (event.clientX - state.x) / state.w),
        y: clamp(state.start.y - (event.clientY - state.y) / state.h),
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
      const { frameForStory } = await import("@/lib/social/instagram-frame");
      const photos: FramedStory[] = [];
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
        photos.push(await frameForStory(source, { x, y, zoom: 1 }, controller.signal));
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

  async function post(photos: FramedStory[], urls: string[]) {
    setError(null);
    const step = (text: string) => setPhase({ kind: "posting", photos, urls, step: text });
    let broadcast: StoryBroadcastView | null = null;
    try {
      if (serverChosen.length) {
        const content = JSON.stringify([
          [...serverChosen].sort(),
          photos.map((photo) => photo.sha256),
        ]);
        let id = broadcastIds.current.get(content);
        if (!id) broadcastIds.current.set(content, (id = crypto.randomUUID()));

        step("Uploading");
        const created = await createStoryBroadcast({
          data: {
            id,
            source: origin,
            destinations: serverChosen as ("instagram-story" | "facebook-story")[],
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
        broadcast = created.broadcast;
        // Each call is one bounded server step; the server decides what is safe next.
        const deadline = Date.now() + 10 * 60_000;
        for (let attempt = 0; ; attempt++) {
          broadcast = await advanceStoryBroadcast({ data: { id } });
          if (broadcast.status !== "broadcasting" && broadcast.status !== "awaiting-upload") break;
          if (Date.now() > deadline) break;
          step("Posting");
          await wait(Math.min(20_000, 1500 + attempt * 2_500));
        }
        // A photo whose confirmation was lost is settled by reading the platform
        // back, never by sending it again. Worth one pass before showing a result.
        if (needsChecking(broadcast)) {
          step("Checking");
          broadcast = await reconcileStoryBroadcast({ data: { id } }).catch(() => broadcast);
        }
        lastId.current = id;
      }
      setPhase({ kind: "result", broadcast, photos, urls });
    } catch (reason) {
      setError(errorText(reason, "These stories could not be posted."));
      setPhase({ kind: "confirm", photos, urls });
    }
  }

  /** Snapchat: the phone's own share sheet if it takes files, otherwise a save.
   * Celinen never posts to Snapchat and never says it did. */
  async function handOffToSnapchat(photos: FramedStory[]) {
    setHandoff(null);
    const files = photos.map(
      (photo, index) => new File([photo.blob], `story-${index + 1}.jpg`, { type: "image/jpeg" }),
    );
    const share = navigator.share?.bind(navigator);
    if (share && navigator.canShare?.({ files })) {
      try {
        await share({ files });
        setHandoff("Shared. Post them in Snapchat.");
        return;
      } catch (reason) {
        // A cancelled share sheet is not a failure; fall through to saving.
        if (reason instanceof DOMException && reason.name === "AbortError") return;
      }
    }
    for (const file of files) {
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.click();
      URL.revokeObjectURL(url);
    }
    setHandoff("Saved. Post them in Snapchat.");
  }

  async function connect(destination: StoryDestination) {
    // Open the tab inside the click so it is not blocked; this page keeps its photos.
    const tab = window.open("about:blank", "_blank");
    try {
      const url =
        destination === "instagram-story"
          ? await startInstagramConnection()
          : await connectFacebook();
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch (reason) {
      tab?.close();
      setReadyError(errorText(reason, "That account could not be connected."));
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

  const destinationName = (destination: StoryDestination) =>
    destination === "instagram-story"
      ? ready?.instagram.name
      : destination === "facebook-story"
        ? ready?.facebook.name
        : "";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={close}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // Studio screens bind single-key shortcuts (H hearts a photo); none may fire from here.
          onKeyDown={(event) => event.stopPropagation()}
          className="story-broadcast fixed left-1/2 top-1/2 z-50 flex h-[min(720px,92dvh)] w-[min(960px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-paper2 text-ink shadow-2xl"
        >
          <header className="flex items-center gap-3 px-5 py-3">
            <DialogPrimitive.Title className="font-display text-[20px] font-medium tracking-[-0.03em]">
              Post to stories
            </DialogPrimitive.Title>
            <span className="ml-auto font-mono text-[11px] text-moss">
              {selected.length} {selected.length === 1 ? "photo" : "photos"}
            </span>
            <DialogPrimitive.Close
              className={buttonQuiet}
              aria-label="Close"
              disabled={phase.kind === "posting"}
            >
              <X size={16} />
            </DialogPrimitive.Close>
          </header>

          {readyError ? (
            <p role="alert" className="px-5 pb-2 font-mono text-[11px] text-rust">
              {readyError}
            </p>
          ) : null}

          {phase.kind === "compose" || phase.kind === "rendering" ? (
            <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-5 pb-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <section className="flex min-w-0 flex-col gap-3">
                <div
                  className="relative mx-auto aspect-[9/16] w-full max-w-[260px] cursor-grab touch-none overflow-hidden rounded-lg bg-ink/5 active:cursor-grabbing"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={() => (drag.current = null)}
                  onPointerCancel={() => (drag.current = null)}
                >
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt=""
                      draggable={false}
                      className="h-full w-full object-cover"
                      style={{
                        objectPosition: `${(placements[active ?? ""]?.x ?? 0.5) * 100}% ${(placements[active ?? ""]?.y ?? 0.5) * 100}%`,
                      }}
                    />
                  ) : null}
                </div>
                <p className="text-center font-mono text-[11px] text-moss">{STORY_FORMAT.label}</p>
              </section>

              <section className="flex min-w-0 flex-col gap-4">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Destinations">
                  {(Object.keys(DESTINATION_LABELS) as StoryDestination[]).map((destination) => {
                    const chosen = destinations.includes(destination);
                    const name = destinationName(destination);
                    return (
                      <button
                        key={destination}
                        type="button"
                        aria-pressed={chosen}
                        disabled={busy}
                        onClick={() => toggleDestination(destination)}
                        className={`rounded-full px-3 py-1 font-mono text-[11px] transition-colors ${chosen ? "bg-ink text-paper2" : "border border-input hover:bg-ink hover:text-paper2"}`}
                      >
                        {DESTINATION_LABELS[destination]}
                        {chosen && name ? ` · ${name}` : ""}
                      </button>
                    );
                  })}
                </div>

                {blocked.map((destination) => (
                  <div key={destination} className="flex items-center gap-2 font-mono text-[11px]">
                    <button
                      type="button"
                      className={buttonPrimary}
                      onClick={() => void connect(destination)}
                    >
                      Connect {DESTINATION_LABELS[destination]}
                    </button>
                    <button
                      type="button"
                      className={buttonQuiet}
                      onClick={() => void loadReadiness()}
                    >
                      Refresh
                    </button>
                  </div>
                ))}

                {snapchatChosen ? (
                  <p className="font-mono text-[11px] text-moss">{SNAPCHAT_HANDOFF}</p>
                ) : null}

                <ul className="grid min-h-0 flex-1 grid-cols-4 content-start gap-1.5 overflow-y-auto">
                  {candidates.map((candidate) => (
                    <li key={candidate.id}>
                      <button
                        type="button"
                        aria-pressed={selected.includes(candidate.id)}
                        aria-label={candidate.name}
                        disabled={busy}
                        onClick={() => toggle(candidate.id)}
                        className={`flex aspect-[9/16] w-full items-end justify-start overflow-hidden rounded-md border p-1 text-left font-mono text-[9px] leading-tight ${
                          selected.includes(candidate.id)
                            ? "border-ink bg-ink/10"
                            : "border-input opacity-60"
                        } ${active === candidate.id ? "ring-1 ring-ink" : ""}`}
                      >
                        <span className="truncate">{candidate.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>

                {error ? (
                  <p role="alert" className="font-mono text-[11px] text-rust">
                    {error}
                  </p>
                ) : null}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={buttonPrimary}
                    disabled={!canPost}
                    onClick={() => void render()}
                  >
                    {phase.kind === "rendering"
                      ? `Preparing ${phase.done}/${selected.length}`
                      : "Post"}
                  </button>
                </div>
              </section>
            </div>
          ) : null}

          {phase.kind === "confirm" || phase.kind === "posting" ? (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5">
              <ul className="flex flex-wrap gap-2">
                {phase.urls.map((url, index) => (
                  <li key={url}>
                    <img
                      src={url}
                      alt={`Story ${index + 1}`}
                      className="aspect-[9/16] w-[86px] rounded-md object-cover"
                    />
                  </li>
                ))}
              </ul>
              <ul className="font-mono text-[11px] text-moss">
                {destinations.map((destination) => (
                  <li key={destination}>
                    {DESTINATION_LABELS[destination]}
                    {destinationName(destination) ? ` · ${destinationName(destination)}` : ""}
                    {destination === "snapchat" ? " · save and post" : ""}
                  </li>
                ))}
              </ul>
              {error ? (
                <p role="alert" className="font-mono text-[11px] text-rust">
                  {error}
                </p>
              ) : null}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={buttonPrimary}
                  disabled={phase.kind === "posting"}
                  onClick={() => void post(phase.photos, phase.urls)}
                >
                  {phase.kind === "posting" ? phase.step : "Post"}
                </button>
                <button
                  type="button"
                  className={buttonQuiet}
                  disabled={phase.kind === "posting"}
                  onClick={() => {
                    phase.urls.forEach((url) => URL.revokeObjectURL(url));
                    setPhase({ kind: "compose" });
                  }}
                >
                  Back
                </button>
              </div>
            </div>
          ) : null}

          {phase.kind === "result" ? (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5">
              <ul className="flex flex-col gap-1.5 font-mono text-[12px]">
                {(phase.broadcast?.destinations ?? []).map((line) => (
                  <li key={line.destination} className="flex items-baseline gap-2">
                    <span className="w-24 shrink-0">{line.label}</span>
                    <span
                      className={
                        line.status === "posted"
                          ? ""
                          : line.status === "working" || line.status === "pending"
                            ? "text-moss"
                            : "text-rust"
                      }
                    >
                      {destinationSummary(line.status, line.posted, line.total)}
                    </span>
                    {line.note ? <span className="text-moss">{line.note}</span> : null}
                  </li>
                ))}
                {snapchatChosen ? (
                  <li className="flex items-baseline gap-2">
                    <span className="w-24 shrink-0">{DESTINATION_LABELS.snapchat}</span>
                    <span className="text-moss">{handoff ?? "Save to post"}</span>
                  </li>
                ) : null}
              </ul>
              {error ? (
                <p role="alert" className="font-mono text-[11px] text-rust">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {snapchatChosen ? (
                  <button
                    type="button"
                    className={buttonPrimary}
                    onClick={() => void handOffToSnapchat(phase.photos)}
                  >
                    Save for Snapchat
                  </button>
                ) : null}
                {needsChecking(phase.broadcast) && lastId.current ? (
                  <button
                    type="button"
                    className={buttonQuiet}
                    onClick={() =>
                      void reconcileStoryBroadcast({ data: { id: lastId.current! } })
                        .then((broadcast) =>
                          setPhase({
                            kind: "result",
                            broadcast,
                            photos: phase.photos,
                            urls: phase.urls,
                          }),
                        )
                        .catch((reason: unknown) =>
                          setError(errorText(reason, "That could not be checked.")),
                        )
                    }
                  >
                    Check again
                  </button>
                ) : null}
                {phase.broadcast?.destinations.some(
                  (line) => line.status !== "posted" && line.status !== "uncertain",
                ) ? (
                  <button
                    type="button"
                    className={buttonQuiet}
                    onClick={() => void post(phase.photos, phase.urls)}
                  >
                    Try again
                  </button>
                ) : null}
                <button
                  type="button"
                  className={buttonQuiet}
                  onClick={() => {
                    phase.urls.forEach((url) => URL.revokeObjectURL(url));
                    onOpenChange(false);
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
