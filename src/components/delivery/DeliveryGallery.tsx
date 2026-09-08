import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Check,
  Heart,
  MessageCircle,
  RefreshCw,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  downloadable,
  isApproved,
  nextAction,
  selectionsLocked,
  unresolved,
  type Actor,
  type DeliveryCommand,
  type DeliveryPhoto,
  type DeliveryVersion,
} from "@/lib/delivery/workflow";
import type { RoomView } from "@/lib/delivery/remote.server";
import "./delivery.css";
import { FinalDownloads } from "./FinalDownloads";
import { currentVersion, messageOf, sizeLabel, type MediaReader } from "./presentation";
import { useCommentDrafts } from "./useCommentDrafts";
const stamp = (date: string) =>
  new Date(date).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
export function DeliveryGallery({
  onDraftChange,
  room,
  actor,
  preview = false,
  localUrls,
  busy,
  run,
  refresh,
  media,
  onRevise,
  onStudio,
  draftScope,
}: {
  onDraftChange?: (dirty: boolean) => void;
  room: RoomView;
  actor: Actor;
  preview?: boolean;
  localUrls?: Record<string, string> | undefined;
  busy: boolean;
  run: (command: DeliveryCommand, operationId?: string) => Promise<void>;
  refresh: () => Promise<void>;
  media: MediaReader;
  onRevise?: (photo: DeliveryPhoto) => void;
  onStudio?: (version: DeliveryVersion) => Promise<void>;
  draftScope?: string;
}) {
  const state = room.state;
  const [tab, setTab] = useState<"photos" | "feedback" | "activity">("photos");
  const [filter, setFilter] = useState<"all" | "selected" | "changes" | "ready">("all");
  const [page, setPage] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [imageError, setImageError] = useState("");
  const [mediaRefresh, setMediaRefresh] = useState(0);
  const [actionError, setActionError] = useState("");
  const [downloadNote, setDownloadNote] = useState("");
  const [downloading, setDownloading] = useState(false);
  const notes = useCommentDrafts(preview ? undefined : draftScope, state.comments, actor);
  const { drafts } = notes;
  useEffect(() => {
    onDraftChange?.(notes.dirty);
  }, [notes.dirty, onDraftChange]);
  const [confirmationIds, setConfirmationIds] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<"submit" | "release" | null>(null);
  const [time, setTime] = useState(new Date().toISOString());
  const mediaRef = useRef(media);
  mediaRef.current = media;
  const photos = state.photos.filter((p) => currentVersion(p, actor)?.ready);
  const displayVersion = (p: DeliveryPhoto) =>
    filter === "ready" ? p.versions.find((v) => v.id === p.published) : currentVersion(p, actor);
  const shown = photos.filter(
    (p) =>
      filter === "all" ||
      (filter === "selected" && state.picks.includes(p.id)) ||
      (filter === "changes" && unresolved(state, p.id).length) ||
      (filter === "ready" && p.published && downloadable(state, p.published, time)),
  );
  const displayed = shown.slice(page * 48, (page + 1) * 48);
  const photo = photos.find((p) => p.id === active);
  const version = photo && displayVersion(photo);
  const requestRevision = !!(version && drafts[version.id]?.revision);
  const visibleIds = [
    ...new Set([...displayed.map((p) => displayVersion(p)!.id), ...(version ? [version.id] : [])]),
  ];
  const idsKey = visibleIds.join(",");
  const approvedUnreleased = photos
    .filter(
      (p) => p.published && isApproved(state, p.published) && !state.released.includes(p.published),
    )
    .map((p) => p.published!);

  useEffect(() => {
    setPage(0);
  }, [filter, tab]);
  useEffect(() => {
    setPage((old) => Math.min(old, Math.max(0, Math.ceil(shown.length / 48) - 1)));
  }, [shown.length]);
  useEffect(() => {
    let alive = true;
    async function updateImages() {
      setTime(new Date().toISOString());
      if (!idsKey) return;
      if (localUrls) {
        setUrls(localUrls);
        return;
      }
      try {
        const entries = await mediaRef.current(idsKey.split(","), "proof");
        if (alive) {
          setUrls(Object.fromEntries(entries.map((e) => [e.versionId, e.url])));
          setImageError("");
        }
      } catch (error) {
        if (alive) setImageError(messageOf(error));
      }
    }
    void updateImages();
    const interval = window.setInterval(() => {
      if (!document.hidden) void updateImages();
    }, 90000);
    const focus = () => void updateImages();
    window.addEventListener("focus", focus);
    return () => {
      alive = false;
      clearInterval(interval);
      window.removeEventListener("focus", focus);
    };
  }, [idsKey, room.revision, localUrls, mediaRefresh]);

  async function act(command: DeliveryCommand, operationId?: string) {
    setActionError("");
    try {
      await run(command, operationId);
      return true;
    } catch (error) {
      setActionError(messageOf(error));
      return false;
    }
  }
  async function download(v: DeliveryVersion, kind: "phone" | "full") {
    setDownloading(true);
    setDownloadNote("");
    setActionError("");
    try {
      const [entry] = await media([v.id], kind);
      if (!entry) throw new Error("This file is not available yet.");
      const response = await fetch(entry.url, { referrerPolicy: "no-referrer", cache: "no-store" });
      if (!response.ok) throw new Error("Download interrupted. Tap Download to retry.");
      const blob = await response.blob();
      if (blob.size !== v.variants[kind].bytes)
        throw new Error("The download is incomplete. Please retry.");
      const { hashBlob } = await import("@/lib/projects/archive");
      if ((await hashBlob(blob)) !== v.variants[kind].sha256)
        throw new Error("Download integrity check failed. Please retry.");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${v.filename.replace(/\.jpg$/i, "")}-v${v.number}-${kind === "full" ? "high-res" : "phone"}.jpg`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setDownloadNote(
        "Download handed to your browser. On iPhone, check Files → Downloads, then use Share → Save Image for Photos.",
      );
    } catch (error) {
      setActionError(messageOf(error));
    } finally {
      setDownloading(false);
    }
  }
  const navigation = (direction: number) => {
    const index = shown.findIndex((p) => p.id === active);
    const next = shown[index + direction];
    if (next) setActive(next.id);
  };
  const countChanges = state.comments.filter((c) => c.revision && !c.resolvedAt).length;
  const pickAction = actor === "client" && !preview && !selectionsLocked(state);

  return (
    <section className="delivery-gallery">
      <div className="delivery-status" role="status">
        <span className={`delivery-dot ${state.released.length ? "is-ready" : ""}`} />
        <p>{preview ? "Client preview · not a shared gallery" : nextAction(state, actor, time)}</p>
        {!preview && actor === "client" && !selectionsLocked(state) && (
          <button
            className="delivery-primary"
            disabled={busy || !state.picks.length}
            onClick={() => {
              setConfirmationIds([...state.picks]);
              setConfirmation("submit");
            }}
          >
            Submit {state.picks.length || "your"} selections <ArrowRight size={16} />
          </button>
        )}
        {!preview && actor === "owner" && approvedUnreleased.length > 0 && (
          <button
            className="delivery-primary"
            disabled={busy}
            onClick={() => {
              setConfirmationIds([...approvedUnreleased]);
              setConfirmation("release");
            }}
          >
            Release {approvedUnreleased.length} finals <ArrowRight size={16} />
          </button>
        )}
      </div>
      {state.message && <p className="delivery-welcome">{state.message}</p>}
      <div className="delivery-toolbar">
        <nav aria-label="Gallery sections" className="delivery-tabs">
          {(["photos", "feedback", "activity"] as const).map((name) => (
            <button
              key={name}
              aria-current={tab === name ? "page" : undefined}
              onClick={() => setTab(name)}
            >
              {name === "photos"
                ? `Photos ${photos.length}`
                : name === "feedback"
                  ? `Feedback${countChanges ? ` · ${countChanges} open` : ""}`
                  : "Activity"}
            </button>
          ))}
        </nav>
        {!preview && actor === "client" && (
          <FinalDownloads
            versions={photos.flatMap((p) =>
              p.published && downloadable(state, p.published, time)
                ? [p.versions.find((v) => v.id === p.published)!]
                : [],
            )}
            media={media}
          />
        )}
        <button
          className="delivery-quiet"
          disabled={busy}
          onClick={() => {
            setMediaRefresh((n) => n + 1);
            void refresh().catch((e) => setActionError(messageOf(e)));
          }}
          aria-label="Refresh gallery"
        >
          <RefreshCw size={15} />
          <span>Refresh</span>
        </button>
      </div>
      {(imageError || actionError) && (
        <p className="delivery-error" role="alert">
          {actionError || imageError}
        </p>
      )}
      {tab === "photos" && (
        <>
          <div className="delivery-filter-row">
            <div className="delivery-filters" aria-label="Filter photos">
              {(["all", "selected", "changes", "ready"] as const).map((f) => (
                <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {f === "all"
                    ? "All photos"
                    : f === "selected"
                      ? `Selected ${state.picks.length}`
                      : f === "changes"
                        ? "Needs changes"
                        : "Finals"}
                </button>
              ))}
            </div>
            <p>
              {selectionsLocked(state)
                ? "Selections submitted"
                : `${state.picks.length} of ${state.selectionLimit} selected`}
            </p>
          </div>
          {!shown.length && (
            <div className="delivery-empty">
              <p>
                {photos.length
                  ? "No photos in this view yet."
                  : actor === "owner"
                    ? "The work starts with your photos."
                    : "Your photographer is preparing your gallery."}
              </p>
              {actor === "owner" && !photos.length && (
                <span>
                  Add finished images or bring in your Studio keepers. Originals stay untouched.
                </span>
              )}
            </div>
          )}
          <div className="delivery-photo-grid">
            {displayed.map((p) => {
              const v = displayVersion(p)!;
              const selected = state.picks.includes(p.id);
              return (
                <figure key={p.id} className="delivery-photo">
                  <div className="delivery-image-wrap">
                    <button
                      className="delivery-open-photo"
                      onClick={() => {
                        setActive(p.id);
                        setActionError("");
                        setDownloadNote("");
                      }}
                      aria-label={`Open ${v.filename}, version ${v.number}`}
                    >
                      {urls[v.id] ? (
                        <img
                          src={urls[v.id]}
                          alt={v.filename}
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                          onError={() =>
                            setImageError(
                              "A preview expired or could not load. Refresh the gallery to retry.",
                            )
                          }
                        />
                      ) : (
                        <span className="delivery-image-loading">Preparing preview…</span>
                      )}
                    </button>
                    {(pickAction || selected) && (
                      <button
                        className={`delivery-pick ${selected ? "is-picked" : ""}`}
                        aria-label={`${selected ? "Deselect" : "Select"} ${v.filename}`}
                        aria-pressed={selected}
                        disabled={busy || !pickAction}
                        onClick={() => void act({ type: "pick", photoId: p.id, on: !selected })}
                      >
                        <Heart size={19} fill={selected ? "currentColor" : "none"} />
                      </button>
                    )}
                    {unresolved(state, p.id).length > 0 && (
                      <span className="delivery-image-tag">
                        <MessageCircle size={13} /> Changes requested
                      </span>
                    )}
                  </div>
                  <figcaption>
                    <span title={v.filename}>{v.filename}</span>
                    <span>
                      {state.released.includes(v.id)
                        ? "Final"
                        : isApproved(state, v.id)
                          ? "Approved"
                          : `v${v.number}`}
                    </span>
                  </figcaption>
                </figure>
              );
            })}
          </div>
          {shown.length > 48 && (
            <div className="delivery-pagination">
              <button className="delivery-quiet" disabled={!page} onClick={() => setPage(page - 1)}>
                <ArrowLeft size={16} /> Previous
              </button>
              <span>
                {page * 48 + 1}–{Math.min((page + 1) * 48, shown.length)} of {shown.length}
              </span>
              <button
                className="delivery-quiet"
                disabled={(page + 1) * 48 >= shown.length}
                onClick={() => setPage(page + 1)}
              >
                Next <ArrowRight size={16} />
              </button>
            </div>
          )}
        </>
      )}
      {tab === "feedback" && (
        <div className="delivery-feedback-list">
          {!state.comments.length && (
            <div className="delivery-empty">
              <p>A conversation, right beside the photo.</p>
              <span>Open any image to ask for a change or leave a note.</span>
            </div>
          )}
          {[...state.comments].reverse().map((comment) => (
            <article key={comment.id}>
              <button
                className="delivery-quiet"
                onClick={() => {
                  setActive(comment.photoId);
                  setActionError("");
                }}
              >
                {photos
                  .find((p) => p.id === comment.photoId)
                  ?.versions.find((v) => v.id === comment.versionId)?.filename ??
                  "Earlier photo version"}{" "}
                <ArrowRight size={14} />
              </button>
              <p className="delivery-comment-body">{comment.body}</p>
              <p className="delivery-meta">
                {comment.role === "owner" ? "Photographer" : state.clientName} · {stamp(comment.at)}
                {comment.revision
                  ? comment.resolvedAt
                    ? " · Addressed"
                    : " · Change requested"
                  : ""}
              </p>
            </article>
          ))}
        </div>
      )}
      {tab === "activity" && (
        <ol className="delivery-activity">
          {!state.events.length && <li>No shared activity yet.</li>}
          {[...state.events]
            .reverse()
            .filter((e) => !e.text.startsWith("Upload reserved"))
            .slice(0, 100)
            .map((event) => (
              <li key={event.id}>
                <time dateTime={event.at}>{stamp(event.at)}</time>
                <span>{event.text}</span>
                <small>{event.role === "owner" ? "Photographer" : state.clientName}</small>
              </li>
            ))}
        </ol>
      )}
      <Dialog
        open={!!version}
        onOpenChange={(open) => {
          if (!open) setActive(null);
        }}
      >
        <DialogContent
          className="delivery-viewer"
          onKeyDown={(event) => {
            if ((event.target as HTMLElement).closest("input,textarea,select,[contenteditable]"))
              return;
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              navigation(-1);
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              navigation(1);
            }
          }}
        >
          {photo && version && (
            <>
              <div className="delivery-viewer-image">
                <img src={urls[version.id]} alt={version.filename} referrerPolicy="no-referrer" />
                <div className="delivery-viewer-nav">
                  <button
                    className="delivery-quiet"
                    disabled={shown.findIndex((p) => p.id === active) <= 0}
                    onClick={() => navigation(-1)}
                    aria-label="Previous photo"
                  >
                    <ArrowLeft size={20} />
                  </button>
                  <span>Version {version.number}</span>
                  <button
                    className="delivery-quiet"
                    disabled={shown.findIndex((p) => p.id === active) >= shown.length - 1}
                    onClick={() => navigation(1)}
                    aria-label="Next photo"
                  >
                    <ArrowRight size={20} />
                  </button>
                </div>
              </div>
              <div className="delivery-conversation">
                <DialogTitle className="delivery-photo-title">{version.filename}</DialogTitle>
                <DialogDescription>
                  Version {version.number} · {version.variants.full.width} ×{" "}
                  {version.variants.full.height} px
                </DialogDescription>
                <p className="delivery-meta">
                  {actor === "owner" && photo.published !== version.id
                    ? "Unpublished version · only you can see this"
                    : isApproved(state, version.id)
                      ? "Client approved this exact version"
                      : "Open for feedback"}
                </p>
                <div className="delivery-photo-actions">
                  {pickAction && (
                    <button
                      className="delivery-quiet"
                      disabled={busy}
                      onClick={() =>
                        void act({
                          type: "pick",
                          photoId: photo.id,
                          on: !state.picks.includes(photo.id),
                        })
                      }
                    >
                      <Heart
                        size={16}
                        fill={state.picks.includes(photo.id) ? "currentColor" : "none"}
                      />
                      {state.picks.includes(photo.id) ? "Selected" : "Select photo"}
                    </button>
                  )}
                  {actor === "owner" && !preview && (
                    <>
                      <button
                        className="delivery-quiet"
                        disabled={busy}
                        onClick={() => onRevise?.(photo)}
                      >
                        Upload revision
                      </button>
                      {version.source && onStudio && (
                        <button
                          className="delivery-quiet"
                          disabled={busy}
                          onClick={() =>
                            void onStudio(version).catch((e) => setActionError(messageOf(e)))
                          }
                        >
                          Open in Studio <ArrowRight size={14} />
                        </button>
                      )}
                    </>
                  )}
                  {actor === "client" &&
                    !preview &&
                    selectionsLocked(state) &&
                    state.submissions.at(-1)?.items.some((i) => i.photoId === photo.id) && (
                      <button
                        className="delivery-primary"
                        disabled={
                          busy ||
                          isApproved(state, version.id) ||
                          !!unresolved(state, photo.id).length
                        }
                        onClick={() => void act({ type: "approve", versionId: version.id })}
                      >
                        <Check size={16} />
                        {isApproved(state, version.id)
                          ? `Version ${version.number} approved`
                          : `Approve version ${version.number}`}
                      </button>
                    )}
                </div>
                <div className="delivery-thread" aria-label="Photo conversation">
                  {state.comments
                    .filter((c) => c.photoId === photo.id)
                    .map((comment) => (
                      <article key={comment.id} className="delivery-comment">
                        <p className="delivery-meta">
                          {comment.role === "owner" ? "Photographer" : state.clientName} ·{" "}
                          {stamp(comment.at)}
                          {comment.versionId !== version.id ? " · earlier version" : ""}
                        </p>
                        <p className="delivery-comment-body">{comment.body}</p>
                        {comment.revision && (
                          <p className="delivery-meta">
                            {comment.resolvedAt
                              ? "✓ Addressed · approval is separate"
                              : "Change requested"}
                          </p>
                        )}
                        {actor === "owner" &&
                          comment.revision &&
                          !comment.resolvedAt &&
                          !preview && (
                            <button
                              className="delivery-quiet"
                              disabled={busy}
                              onClick={() => void act({ type: "resolve", commentId: comment.id })}
                            >
                              Mark addressed
                            </button>
                          )}
                      </article>
                    ))}
                  {!state.comments.some((c) => c.photoId === photo.id) && (
                    <p className="delivery-thread-empty">
                      “A little warmer, and could you crop out the person on the left?”
                      <br />
                      <span>No editing jargon needed.</span>
                    </p>
                  )}
                </div>
                <form
                  className="delivery-composer"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const sent = drafts[version.id];
                    const body = sent?.body.trim();
                    if (!sent || !body || preview) return;
                    if (
                      await act(
                        {
                          type: "comment",
                          versionId: version.id,
                          body,
                          revision: actor === "client" && sent.revision,
                        },
                        sent.operationId,
                      )
                    ) {
                      notes.acknowledge(version.id, sent.operationId);
                    }
                  }}
                >
                  {Object.entries(drafts)
                    .filter(
                      ([id, draft]) =>
                        id !== version.id && draft.body.trim() && draft.photoId === photo.id,
                    )
                    .map(([id, draft]) => (
                      <div key={id} className="delivery-notice">
                        <p>Your unsent note for an earlier version is still here:</p>
                        <p className="delivery-comment-body">{draft.body}</p>
                        <button
                          type="button"
                          className="delivery-quiet"
                          disabled={!!drafts[version.id]?.body.trim()}
                          onClick={() => {
                            notes.move(id, version.id, photo.id);
                          }}
                        >
                          Use this note for version {version.number}
                        </button>
                      </div>
                    ))}
                  <label className="sr-only" htmlFor="photo-comment">
                    Comment on version {version.number}
                  </label>
                  <textarea
                    id="photo-comment"
                    placeholder={
                      actor === "owner"
                        ? "Reply to your client…"
                        : "Tell your photographer what you have in mind…"
                    }
                    value={drafts[version.id]?.body ?? ""}
                    maxLength={4000}
                    onChange={(e) => {
                      notes.update(version.id, photo.id, { body: e.target.value });
                    }}
                    disabled={preview}
                    rows={3}
                  />
                  <div>
                    {actor === "client" && (
                      <label className="delivery-check">
                        <input
                          type="checkbox"
                          checked={requestRevision}
                          onChange={(e) =>
                            notes.update(version.id, photo.id, { revision: e.target.checked })
                          }
                          disabled={preview}
                        />
                        Request a change
                      </label>
                    )}
                    <button
                      className="delivery-primary"
                      disabled={busy || preview || !drafts[version.id]?.body.trim()}
                    >
                      {busy ? "Sending…" : actor === "owner" ? "Send reply" : "Send comment"}
                      <ArrowRight size={15} />
                    </button>
                  </div>
                  {notes.storageError && (
                    <p className="delivery-meta" role="alert">
                      {notes.storageError}
                    </p>
                  )}
                  <p className="delivery-meta">
                    {preview
                      ? "Preview only. Client actions are enabled on a published private link."
                      : requestRevision
                        ? "A change request pauses this photo’s approval and downloads."
                        : "Comments are shared with everyone holding this private link."}
                  </p>
                </form>
                {actionError && (
                  <p role="alert" className="delivery-error">
                    {actionError}
                  </p>
                )}
                {!preview && downloadable(state, version.id, time) && (
                  <div className="delivery-downloads">
                    <p>Download this final</p>
                    {(["phone", "full"] as const).map((kind) => (
                      <button
                        key={kind}
                        className="delivery-download-option"
                        disabled={downloading}
                        onClick={() => void download(version, kind)}
                      >
                        <ArrowDown size={18} />
                        <span>
                          {kind === "phone" ? "Phone & social" : "High-resolution JPEG"}
                          <small>
                            {version.variants[kind].width} × {version.variants[kind].height} ·{" "}
                            {sizeLabel(version.variants[kind].bytes)}
                          </small>
                        </span>
                      </button>
                    ))}
                    <p className="delivery-meta" role="status">
                      {downloading
                        ? "Downloading and checking the file…"
                        : downloadNote ||
                          "Individual files keep mobile downloads small and easy to retry."}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      >
        <DialogContent className="delivery-confirm">
          <DialogTitle>
            {confirmation === "submit"
              ? "Ready to send your selections?"
              : "Release these approved finals?"}
          </DialogTitle>
          <DialogDescription>
            {confirmation === "submit"
              ? `${confirmationIds.length} selected photos will be sent to your photographer. This locks your selection, not your feedback. You can still comment and ask for changes.`
              : `${confirmationIds.length} exact approved versions will become downloadable. Files already downloaded cannot be recalled.`}
          </DialogDescription>
          <div className="delivery-inline-actions">
            <button className="delivery-quiet" onClick={() => setConfirmation(null)}>
              Keep reviewing
            </button>
            <button
              className="delivery-primary"
              disabled={busy}
              onClick={async () => {
                if (
                  await act(
                    confirmation === "submit"
                      ? { type: "submit", photoIds: confirmationIds }
                      : { type: "release", versionIds: confirmationIds },
                  )
                )
                  setConfirmation(null);
              }}
            >
              {busy
                ? "Saving…"
                : confirmation === "submit"
                  ? "Submit selections"
                  : "Release finals"}
            </button>
          </div>
          {actionError && (
            <p role="alert" className="delivery-error">
              {actionError}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
