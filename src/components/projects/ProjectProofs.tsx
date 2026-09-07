import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Btn } from "@/components/lensos/Shell";
import type { Project } from "@/lib/projects/model";
import {
  addOfflineFeedback,
  approvedProofItems,
  prepareApprovedProofDownload,
  prepareProjectProof,
} from "@/lib/projects/proofing";
import { commitProject, loadProject, readProjectBlobs } from "@/lib/projects/repository";

type FeedbackChoice = Project["feedback"][number]["choice"];
type PreviewState = { key: string; urls: Map<string, string>; error: string | null };
const choiceLabel: Record<FeedbackChoice, string> = {
  favorite: "Favorite recorded",
  approve: "Approval recorded",
  revision: "Revision requested",
};
const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
const fieldClass = `min-h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-ink ${focus}`;
const quietAction = `min-h-11 rounded-md border-0 bg-transparent px-3 transition-colors hover:bg-ink/5 hover:translate-y-0 ${focus}`;
const primaryAction = `min-h-11 rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper2 transition-colors hover:bg-ink/85 hover:translate-y-0 ${focus}`;
const formatDate = (date: string) => new Date(date).toLocaleString();

export function ProjectProofs({
  project,
  onUpdate,
}: {
  project: Project;
  onUpdate: (project: Project) => void;
}) {
  const latestProject = useRef(project);
  const updateParent = useRef(onUpdate);
  latestProject.current = project;
  updateParent.current = onUpdate;
  const mounted = useRef(true);
  const operation = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [proofId, setProofId] = useState<string | null>(null);
  const [frameId, setFrameId] = useState<string | null>(null);
  const [reviewer, setReviewer] = useState("");
  const [comment, setComment] = useState("");
  const [choice, setChoice] = useState<FeedbackChoice>("favorite");
  const [previews, setPreviews] = useState<PreviewState | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);

  const proof = project.proofs.find((entry) => entry.id === proofId) ?? project.proofs.at(-1);
  const item = proof?.items.find((entry) => entry.frameId === frameId) ?? proof?.items[0];
  const frame = project.frames.find((entry) => entry.id === item?.frameId);
  const keeperCount = project.frames.filter(
    (entry) => entry.metadata.verdict === "keep" && !entry.metadata.error,
  ).length;
  const feedback = useMemo(
    () => project.feedback.filter((entry) => entry.proofId === proof?.id),
    [project.feedback, proof?.id],
  );
  const latestFeedback = useMemo(() => {
    const result = new Map<string, Project["feedback"][number]>();
    for (const entry of feedback) result.set(`${entry.frameId}:${entry.versionId}`, entry);
    return result;
  }, [feedback]);
  const recorded = item ? latestFeedback.get(`${item.frameId}:${item.versionId}`) : undefined;
  const approvedCount = proof ? approvedProofItems(project, proof.id).length : 0;
  const previewKey = `${project.id}:${proof?.id ?? "none"}:${proof?.items.map((entry) => entry.blobId).join(",") ?? ""}:${previewAttempt}`;
  const visiblePreviews = previews?.key === previewKey ? previews : null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    setProofId(null);
    setFrameId(null);
    setReviewer("");
    setComment("");
    setChoice("favorite");
    setError(null);
    setNotice(null);
  }, [project.id]);

  useEffect(() => {
    setComment("");
  }, [proof?.id, item?.frameId]);

  useEffect(() => {
    let cancelled = false;
    const urls = new Map<string, string>();
    const snapshot = latestProject.current;
    const selectedProof = snapshot.proofs.find((entry) => entry.id === proof?.id);
    if (!selectedProof) {
      setPreviews({ key: previewKey, urls, error: null });
      return;
    }
    void readProjectBlobs(snapshot)
      .then((blobs) => {
        if (cancelled) return;
        for (const entry of selectedProof.items) {
          if (urls.has(entry.blobId)) continue;
          const blob = blobs.get(entry.blobId);
          if (!blob)
            throw new Error(
              "A saved proof image is missing. Restore the verified project archive.",
            );
          urls.set(entry.blobId, URL.createObjectURL(blob));
        }
        setPreviews({ key: previewKey, urls, error: null });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        for (const url of urls.values()) URL.revokeObjectURL(url);
        urls.clear();
        setPreviews({
          key: previewKey,
          urls,
          error: cause instanceof Error ? cause.message : "Could not open the saved proof images.",
        });
      });
    return () => {
      cancelled = true;
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, [previewKey, proof?.id]);

  function publishUpdate(updated: Project) {
    if (!mounted.current || latestProject.current.id !== updated.id) return;
    // A newer parent snapshot must never be replaced by an older async result.
    if (latestProject.current.revision > updated.revision) return;
    latestProject.current = updated;
    updateParent.current(updated);
  }

  async function run(label: string, task: (snapshot: Project) => Promise<void>) {
    if (operation.current) return;
    const snapshot = latestProject.current;
    operation.current = true;
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await task(snapshot);
    } catch (cause) {
      if (mounted.current && latestProject.current.id === snapshot.id) {
        setError(
          cause instanceof Error
            ? cause.message
            : "The operation failed. Existing project work is intact.",
        );
      }
    } finally {
      operation.current = false;
      if (mounted.current) {
        setBusy(null);
        setProgress(null);
      }
    }
  }

  function prepareProof() {
    void run("Preparing proof", async (snapshot) => {
      const updated = await prepareProjectProof(snapshot, (done, total) => {
        if (mounted.current && latestProject.current.id === snapshot.id)
          setProgress({ done, total });
      });
      publishUpdate(updated);
      if (mounted.current && latestProject.current.id === snapshot.id) {
        setProofId(updated.proofs.at(-1)?.id ?? null);
        setFrameId(null);
        setNotice(
          "A new frozen proof set was saved on this device. Existing proofs and their feedback are unchanged.",
        );
      }
    });
  }

  function recordFeedback(event: FormEvent) {
    event.preventDefault();
    if (!proof || !item || !reviewer.trim()) return;
    const input = {
      proofId: proof.id,
      frameId: item.frameId,
      versionId: item.versionId,
      choice,
      reviewer: reviewer.trim(),
      comment: comment.trim(),
    };
    void run("Saving feedback", async (snapshot) => {
      const updated = await commitProject(addOfflineFeedback(snapshot, input));
      publishUpdate(updated);
      if (mounted.current && latestProject.current.id === snapshot.id) {
        setComment("");
        setNotice(
          `${choiceLabel[input.choice]} for this exact proof version, as entered by you. The photographer's keeper decision was not changed.`,
        );
      }
    });
  }

  function downloadApproved() {
    if (!proof) return;
    const selectedProofId = proof.id;
    void run("Preparing approved ZIP", async (snapshot) => {
      const prepared = await prepareApprovedProofDownload(snapshot, selectedProofId);
      publishUpdate(prepared.project);
      if (!mounted.current || latestProject.current.id !== snapshot.id) return;
      const url = URL.createObjectURL(prepared.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `lenslabs-proof-${selectedProofId}.zip`;
      document.body.appendChild(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setNotice(
        "Approved proof JPEGs and their version manifest are prepared. Browser download requested—check your saved ZIP. This is not full-resolution or external client delivery.",
      );
    });
  }

  return (
    <section aria-label="Proof and review" className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold tracking-tight">Proof & review</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-moss">
            Feedback recorded by you on this device. Not a client login or public gallery.
          </p>
        </div>
        <Btn
          className={primaryAction}
          variant="primary"
          disabled={Boolean(busy) || keeperCount === 0 || keeperCount > 200}
          onClick={prepareProof}
        >
          Prepare keepers proof ({keeperCount})
        </Btn>
      </div>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-moss">
        Frozen JPEGs, up to 1,600 px and 200 keepers per set. New proofs keep earlier versions
        intact.
      </p>
      {keeperCount > 200 && (
        <p className="mt-2 text-sm text-rust">
          This project has more than 200 keepers. Large proof jobs are not supported in this
          release; existing sets below remain available.
        </p>
      )}
      {busy && (
        <p role="status" className="mt-3 text-sm text-moss">
          {busy}
          {progress ? ` · ${progress.done} / ${progress.total}` : "…"}
        </p>
      )}
      {progress && (
        <progress
          aria-label="Proof preparation"
          value={progress.done}
          max={progress.total}
          className="mt-2 w-full accent-rust"
        />
      )}
      {error && (
        <div role="alert" className="mt-3 space-y-2 text-sm text-destructive">
          <p>{error}</p>
          <Btn
            className={quietAction}
            disabled={Boolean(busy)}
            onClick={() =>
              void run("Reloading project", async (snapshot) => {
                const fresh = await loadProject(snapshot.id);
                publishUpdate(fresh);
                if (mounted.current && latestProject.current.id === snapshot.id)
                  setNotice(
                    "Loaded the latest saved project. Review it before retrying your action.",
                  );
              })
            }
          >
            Reload saved project
          </Btn>
        </div>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm text-moss">
          {notice}
        </p>
      )}

      {!proof ? (
        <p className="mt-5 text-sm text-moss">
          Save some keepers in this project's Studio, then prepare your first proof set here.
        </p>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
            <label className="min-w-0 flex-1 text-sm text-moss">
              Saved proof set
              <select
                aria-label="Saved proof set"
                className={`${fieldClass} mt-1`}
                value={proof.id}
                disabled={Boolean(busy)}
                onChange={(event) => {
                  setProofId(event.target.value);
                  setFrameId(null);
                  setNotice(null);
                }}
              >
                {project.proofs.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.title} · {entry.items.length} images · {formatDate(entry.createdAt)}
                  </option>
                ))}
              </select>
            </label>
            <Btn
              className={quietAction}
              disabled={Boolean(busy) || approvedCount === 0}
              onClick={downloadApproved}
            >
              Download recorded approvals ({approvedCount})
            </Btn>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-moss">
            Latest recorded approvals for this proof only. ZIP includes a version manifest; 100 MiB
            limit. Approvals never carry across proof sets.
          </p>

          {visiblePreviews?.error ? (
            <div role="alert" className="mt-4 text-sm text-destructive">
              <p>{visiblePreviews.error}</p>
              <Btn
                disabled={Boolean(busy)}
                className={`${quietAction} mt-2`}
                onClick={() => setPreviewAttempt((value) => value + 1)}
              >
                Retry proof images
              </Btn>
            </div>
          ) : (
            !visiblePreviews && (
              <p role="status" className="mt-4 text-sm text-moss">
                Opening saved proof images…
              </p>
            )
          )}

          <div className="mt-5 flex gap-3 overflow-x-auto px-0.5 py-1" aria-label="Proof images">
            {proof.items.map((entry, index) => {
              const source = project.frames.find((candidate) => candidate.id === entry.frameId);
              const state = latestFeedback.get(`${entry.frameId}:${entry.versionId}`);
              const url = visiblePreviews?.urls.get(entry.blobId);
              return (
                <button
                  key={entry.frameId}
                  type="button"
                  disabled={Boolean(busy)}
                  aria-pressed={item?.frameId === entry.frameId}
                  aria-label={`Review ${source?.metadata.relativePath ?? source?.originalName ?? `image ${index + 1}`} · ${state ? choiceLabel[state.choice] : "No feedback recorded"}`}
                  onClick={() => setFrameId(entry.frameId)}
                  className={`w-28 shrink-0 rounded-sm p-1 text-left transition-colors hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-50 ${focus} ${item?.frameId === entry.frameId ? "bg-ink/5 ring-1 ring-inset ring-ink/40" : ""}`}
                >
                  {url ? (
                    <img
                      src={url}
                      alt=""
                      loading="lazy"
                      className="aspect-[4/3] w-full object-contain"
                    />
                  ) : (
                    <span className="flex aspect-[4/3] items-center justify-center text-xs text-moss">
                      {index + 1}
                    </span>
                  )}
                  <span className="mt-1 block truncate text-xs text-moss">
                    {source?.originalName ?? entry.frameId}
                  </span>
                  <span className="mt-0.5 block text-xs text-moss">
                    {state ? choiceLabel[state.choice] : "Not reviewed"}
                  </span>
                </button>
              );
            })}
          </div>

          {item && (
            <div className="mt-5 grid items-start gap-x-7 gap-y-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(240px,1fr)]">
              <div className="min-w-0">
                {visiblePreviews?.urls.get(item.blobId) && (
                  <img
                    src={visiblePreviews.urls.get(item.blobId)}
                    alt={`Frozen proof of ${frame?.originalName ?? item.frameId}`}
                    className="max-h-[540px] w-full object-contain"
                  />
                )}
                <p className="mt-3 break-words text-sm font-medium tabular-nums">
                  {frame?.originalName ?? item.frameId} · {item.width} × {item.height}
                </p>
                <p className="mt-2 break-all font-mono text-xs leading-relaxed text-moss">
                  Proof version: {item.versionId}
                </p>
                <p className="mt-1 break-all text-xs leading-relaxed text-moss">
                  Source: {frame?.metadata.relativePath ?? frame?.originalName ?? item.frameId}
                </p>
                {!frame?.originalBlobId && (
                  <p className="mt-2 text-sm leading-relaxed text-rust">
                    The original is not stored in this project. This proof was prepared from the
                    saved preview; use its displayed dimensions when assessing quality.
                  </p>
                )}
                {frame?.currentVersionId !== item.versionId && (
                  <p className="mt-2 text-sm leading-relaxed text-rust">
                    Studio now has a different edit version. This proof and its recorded feedback
                    still refer to the older version shown here. Prepare a new proof to review the
                    current edit.
                  </p>
                )}
                {recorded && (
                  <p className="mt-2 text-sm leading-relaxed text-moss">
                    {choiceLabel[recorded.choice]} · {recorded.reviewer} · {formatDate(recorded.at)}
                    {recorded.comment ? ` · ${recorded.comment}` : ""}
                  </p>
                )}
              </div>
              <form onSubmit={recordFeedback} className="space-y-4">
                <h3 className="text-base font-medium">Record offline feedback</h3>
                <label className="block text-sm text-moss">
                  Reviewer name
                  <input
                    className={`${fieldClass} mt-1`}
                    value={reviewer}
                    onChange={(event) => setReviewer(event.target.value)}
                    required
                    maxLength={200}
                    disabled={Boolean(busy)}
                    placeholder="Whose feedback are you recording?"
                  />
                </label>
                <label className="block text-sm text-moss">
                  Feedback
                  <select
                    className={`${fieldClass} mt-1`}
                    value={choice}
                    onChange={(event) => setChoice(event.target.value as FeedbackChoice)}
                    disabled={Boolean(busy)}
                  >
                    <option value="favorite">Favorite</option>
                    <option value="approve">Approve this exact version</option>
                    <option value="revision">Request a revision</option>
                  </select>
                </label>
                <label className="block text-sm text-moss">
                  Comment
                  <textarea
                    className={`${fieldClass} mt-1 min-h-24`}
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    maxLength={4000}
                    disabled={Boolean(busy)}
                    placeholder="Optional notes, recorded without changing the image"
                  />
                </label>
                <button
                  type="submit"
                  disabled={
                    Boolean(busy) || !reviewer.trim() || !visiblePreviews?.urls.get(item.blobId)
                  }
                  className={`${primaryAction} disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  Record feedback
                </button>
                <p className="text-sm leading-relaxed text-moss">
                  Saved locally by you. No identity verification, message sent, or keeper change.
                </p>
              </form>
            </div>
          )}

          <details className="mt-6 text-sm">
            <summary className={`min-h-11 cursor-pointer rounded-md py-3 font-medium ${focus}`}>
              Recorded history for this proof ({feedback.length})
            </summary>
            {!feedback.length ? (
              <p className="mt-2 text-sm text-moss">No feedback recorded for this proof set.</p>
            ) : (
              <ol className="mt-3 space-y-3">
                {[...feedback].reverse().map((entry) => (
                  <li key={entry.id} className="text-sm leading-relaxed text-moss">
                    <p className="font-medium text-ink">
                      {choiceLabel[entry.choice]} · {entry.reviewer}
                    </p>
                    <p>
                      {project.frames.find((candidate) => candidate.id === entry.frameId)
                        ?.originalName ?? entry.frameId}{" "}
                      · {formatDate(entry.at)}
                    </p>
                    <p className="break-all font-mono text-xs">{entry.versionId}</p>
                    {entry.comment && <p className="mt-1 whitespace-pre-wrap">{entry.comment}</p>}
                    <p className="mt-1 text-xs">Recorded by photographer on this device</p>
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-3 text-sm text-moss">
              {project.exports.filter((entry) => entry.proofId === proof.id).length} download
              preparations recorded. These are not confirmations of external delivery.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
