import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Copy, Upload } from "lucide-react";
import { MessageComposer } from "@/components/customer/MessageComposer";
import { Shell } from "@/components/lensos/Shell";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { DeliveryGallery } from "./DeliveryGallery";
import { ClientGalleryHeader, ClientGalleryFooter } from "./ClientGalleryIdentity";
import { GalleryPresentationForm } from "./GalleryPresentationForm";
import { galleryPresentation, type GalleryPresentation } from "@/lib/delivery/gallery-presentation";
import { NewGalleryFields } from "./NewGalleryFields";
import {
  copyGalleryText,
  galleryInvitation,
  invitationGeneration,
} from "@/lib/delivery/experience";
import { useToolLeaveGuard } from "@/components/workbench/useToolLeaveGuard";
import { useWorkbench } from "@/components/workbench/context";
import { studioBindingHref } from "@/lib/workbench";
import { prepareStudioHandoff, saveStudioHandoff } from "@/lib/delivery/studio-handoff";
import { messageOf, type MediaReader } from "./presentation";
import {
  clientState,
  type DeliveryCommand,
  type DeliveryPhoto,
  type DeliveryVersion,
} from "@/lib/delivery/workflow";
import {
  checkPrivateDelivery,
  changePrivateDelivery,
  createPrivateInvitation,
  getOwnerDeliveryMedia,
  getPrivateDelivery,
  listPrivateDeliveries,
} from "@/lib/delivery/remote.functions";
import {
  connectDraft,
  createDraft,
  draftWithJobs,
  listDrafts,
  listUploadJobs,
  prepareUpload,
  saveDraft,
  saveDraftPresentation,
  uploadJob,
  type Draft,
  type UploadJob,
} from "@/lib/delivery/outbox";
import { loadProject, listProjects, readProjectBlobs } from "@/lib/projects/repository";
import type { Project } from "@/lib/projects/model";
import type { RoomView } from "@/lib/delivery/remote.server";
import "./delivery.css";

type Summary = {
  id: string;
  title: string;
  clientName: string;
  status: string;
  count?: number;
  local?: boolean;
};
const dateValue = (days: number) =>
  new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

export function DeliveryWorkspace() {
  const [identity, setIdentity] = useState<{ ownerId: string | null; generation: number } | null>(
    null,
  );
  const generation = useRef(0);
  const currentOwner = useRef<string | null | undefined>(undefined);
  const invalidateIdentity = useCallback(() => {
    generation.current++;
    currentOwner.current = undefined;
  }, []);
  useEffect(() => {
    let alive = true,
      eventSeen = false;
    const accept = (ownerId: string | null) => {
      if (!alive || currentOwner.current === ownerId) return;
      currentOwner.current = ownerId;
      generation.current++;
      setIdentity({ ownerId, generation: generation.current });
    };
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      eventSeen = true;
      accept(session?.user.id ?? null);
    });
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!eventSeen) accept(data.session?.user.id ?? null);
      })
      .catch(() => {
        if (!eventSeen) accept(null);
      });
    return () => {
      alive = false;
      invalidateIdentity();
      data.subscription.unsubscribe();
    };
  }, [invalidateIdentity]);
  if (!identity)
    return (
      <Shell hideEventHeader>
        <p role="status">Checking account…</p>
      </Shell>
    );
  // Remount disposes dialogs, draft text, object URLs and invitation capabilities across identities.
  return (
    <AccountDeliveryWorkspace
      key={identity.generation}
      ownerId={identity.ownerId}
      ensureIdentity={() => {
        if (generation.current !== identity.generation)
          throw new Error("Account changed. Sign in to the original account to resume saved work.");
      }}
    />
  );
}

function AccountDeliveryWorkspace({
  ownerId,
  ensureIdentity,
}: {
  ownerId: string | null;
  ensureIdentity: () => void;
}) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const ensureActive = useCallback(() => {
    ensureIdentity();
    if (!mounted.current)
      throw new Error("Delivery workspace closed. Prepared files are preserved.");
  }, [ensureIdentity]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [local, setLocal] = useState(false);
  const [ready, setReady] = useState(false);
  const signedIn = !!ownerId;
  const [setupNote, setSetupNote] = useState("Checking private delivery…");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState("");
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [localUrls, setLocalUrls] = useState<Record<string, string>>({});
  const [newOpen, setNewOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [settings, setSettings] = useState(false);
  const [publishConfirm, setPublishConfirm] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [sharedGeneration, setSharedGeneration] = useState<string | null>(null);
  const shareUrlRef = useRef(shareUrl);
  shareUrlRef.current = shareUrl;
  useEffect(() => {
    if (
      shareUrl &&
      (!room ||
        room.state.status !== "live" ||
        Date.parse(room.state.expiresAt) <= Date.now() ||
        invitationGeneration(room.state) !== sharedGeneration)
    )
      setShareUrl("");
  }, [shareUrl, room, sharedGeneration]);
  const [copied, setCopied] = useState(false);
  const [invitationCopied, setInvitationCopied] = useState(false);
  const [presentationDirty, setPresentationDirty] = useState(false);
  useEffect(() => {
    setCopied(false);
    setInvitationCopied(false);
  }, [shareUrl, room?.revision, room?.state.presentation]);
  const [projectOpen, setProjectOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [replacement, setReplacement] = useState<DeliveryPhoto | null>(null);
  const workbench = useWorkbench();
  const [unsentFeedback, setUnsentFeedback] = useState(false);
  const [newFormDirty, setNewFormDirty] = useState(false);
  useToolLeaveGuard(
    busy || preparing
      ? "Delivery preparation or upload is in progress. Leaving may interrupt it; already prepared files remain available to retry."
      : unsentFeedback
        ? "Your unsent photo comments will be discarded."
        : presentationDirty || (newOpen && newFormDirty)
          ? "Your unsaved gallery details will be discarded."
          : null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const operationIds = useRef(new Map<string, string>());
  const activeId = useRef<string | null>(null);
  const pendingCreateId = useRef(crypto.randomUUID());
  const roomRef = useRef(room);
  roomRef.current = room;
  const copyShare = (text: string, message: boolean) => {
    const snapshot = { id: room?.id, revision: room?.revision, url: shareUrl };
    const current = () => {
      try {
        ensureActive();
      } catch {
        return false;
      }
      return (
        roomRef.current?.id === snapshot.id &&
        roomRef.current?.revision === snapshot.revision &&
        shareUrlRef.current === snapshot.url
      );
    };
    return copyGalleryText(
      text,
      (value) => navigator.clipboard.writeText(value),
      current,
      () => (message ? setInvitationCopied(true) : setCopied(true)),
      () =>
        setError(
          "Could not copy automatically. Select the link or invitation message and copy it manually.",
        ),
    );
  };
  const cloud = ready && signedIn;
  useEffect(() => {
    const input = inputRef.current;
    const cancel = () => setReplacement(null);
    input?.addEventListener("cancel", cancel);
    return () => input?.removeEventListener("cancel", cancel);
  }, [room?.id]);

  useEffect(() => {
    let alive = true;
    void listDrafts(ownerId)
      .then((saved) => {
        if (alive) setDrafts(saved);
      })
      .catch((e) => setError(messageOf(e)));
    // Device-local drafts do not need a cloud-readiness request or a cloud account.
    if (!ownerId) {
      setReady(false);
      setSetupNote("Sign in to connect this draft to your private online gallery.");
    } else
      void checkPrivateDelivery()
        .then((value) => {
          if (alive) {
            setReady(value.ready);
            setSetupNote(value.reason);
          }
        })
        .catch(() => {
          if (alive)
            setSetupNote(
              "Private delivery is unavailable. You can still prepare a draft on this device.",
            );
        });
    return () => {
      alive = false;
    };
  }, [ownerId]);
  useEffect(() => {
    if (!cloud) return;
    let alive = true;
    void listPrivateDeliveries()
      .then((items) => {
        if (alive) setSummaries(items);
      })
      .catch((e) => setError(messageOf(e)));
    return () => {
      alive = false;
    };
  }, [cloud, room?.revision]);
  useEffect(() => {
    const urls = Object.fromEntries(jobs.map((j) => [j.id, URL.createObjectURL(j.files.proof)]));
    setLocalUrls(urls);
    return () => {
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [jobs]);

  const allSummaries = [
    ...summaries,
    ...drafts
      .filter((d) => !summaries.some((s) => s.id === d.id))
      .map((d) => ({
        id: d.id,
        title: d.state.title,
        clientName: d.state.clientName,
        status: "draft",
        count: d.state.photos.length,
        local: true,
      })),
  ];
  useEffect(() => {
    try {
      localStorage.setItem("celinen.gallery.count.v1", String(allSummaries.length));
      window.dispatchEvent(new Event("celinen-gallery-count"));
    } catch {
      /* ignore quota */
    }
  }, [allSummaries.length]);
  async function open(id: string) {
    if (busy) return;
    if (id === room?.id) return;
    if (
      unsentFeedback &&
      id !== room?.id &&
      !window.confirm("Discard unsent photo comments and open another gallery?")
    )
      return;
    setUnsentFeedback(false);
    activeId.current = id;
    setError("");
    setShareUrl("");
    setJobs([]);
    setRoom(null);
    try {
      const savedJobs = await listUploadJobs(id, ownerId);
      ensureActive();
      if (activeId.current !== id) return;
      setJobs(savedJobs);
      const currentDrafts = await listDrafts(ownerId);
      ensureActive();
      if (activeId.current !== id) return;
      setDrafts(currentDrafts);
      const draft = currentDrafts.find((d) => d.id === id);
      if (cloud && (!draft || draft.synced)) {
        const next = await getPrivateDelivery({ data: { id } });
        ensureActive();
        if (activeId.current === id) {
          setRoom(next);
          setLocal(false);
        }
      } else if (draft) {
        const updated = draftWithJobs(draft, savedJobs);
        await saveDraft(updated);
        if (activeId.current === id) {
          setRoom({ id, revision: 0, state: updated.state });
          setLocal(true);
        }
      } else throw new Error("Sign in to the photographer account to open this private gallery.");
    } catch (e) {
      if (activeId.current === id) setError(messageOf(e));
    }
  }
  const refresh = useCallback(async () => {
    const current = roomRef.current;
    if (!current) return;
    if (local) return;
    const next = await getPrivateDelivery({ data: { id: current.id } });
    ensureActive();
    if (activeId.current === current.id)
      setRoom((old) => (old?.id === next.id && old.revision > next.revision ? old : next));
  }, [local, ensureActive]);
  const roomId = room?.id;
  useEffect(() => {
    if (local || !roomId) return;
    const timer = window.setInterval(() => {
      if (!document.hidden && !busy) void refresh().catch((e) => setError(messageOf(e)));
    }, 20000);
    return () => clearInterval(timer);
  }, [roomId, local, refresh, busy]);

  const run = async (command: DeliveryCommand) => {
    ensureActive();
    if (!room || local)
      throw new Error(
        "Connect this draft to private delivery before inviting clients or recording shared activity.",
      );
    const key = JSON.stringify(command);
    const operationId = operationIds.current.get(key) ?? crypto.randomUUID();
    operationIds.current.set(key, operationId);
    setBusy(true);
    try {
      const next = await changePrivateDelivery({
        data: { id: room.id, revision: room.revision, operationId, command },
      });
      ensureActive();
      setRoom(next);
      operationIds.current.delete(key);
      if (command.type === "close") setShareUrl("");
    } catch (e) {
      await refresh().catch(() => {});
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const ownerAction = async (command: DeliveryCommand) => {
    setError("");
    try {
      await run(command);
    } catch (e) {
      setError(messageOf(e));
    }
  };
  const savePresentation = async (presentation: GalleryPresentation) => {
    ensureActive();
    if (!room) throw new Error("Open a gallery first.");
    if (!local) {
      await run({ type: "presentation", presentation });
      return;
    }
    setBusy(true);
    try {
      const updated = await saveDraftPresentation(
        room.id,
        ownerId,
        galleryPresentation(room.state),
        presentation,
      );
      ensureActive();
      setRoom((old) =>
        old?.id === updated.id ? { ...old, state: { ...old.state, presentation } } : old,
      );
      setDrafts(await listDrafts(ownerId));
    } finally {
      setBusy(false);
    }
  };
  const media: MediaReader = async (ids, kind) => {
    ensureActive();
    if (!room) return [];
    if (local)
      return ids
        .filter((id) => localUrls[id])
        .map((versionId) => ({ versionId, url: localUrls[versionId]! }));
    const result = await getOwnerDeliveryMedia({ data: { id: room.id, versionIds: ids, kind } });
    ensureActive();
    return result;
  };
  async function persistPrepared(id: string, newJobs: UploadJob[]) {
    ensureActive();
    const all = await listUploadJobs(id, ownerId);
    ensureActive();
    setJobs(all);
    const draft = (await listDrafts(ownerId)).find((d) => d.id === id);
    ensureActive();
    if (local && draft) {
      const updated = draftWithJobs(draft, all);
      await saveDraft(updated);
      setDrafts(await listDrafts(ownerId));
      setRoom({ id, revision: 0, state: updated.state });
    }
    if (!local && cloud) await uploadMany(newJobs);
  }
  async function addFiles(files: File[], replace: DeliveryPhoto | null = replacement) {
    if (!room || busy || !files.length) return;
    if (replace && files.length !== 1) {
      setError("Choose exactly one file for this photo’s new version.");
      return;
    }
    if (!replace && files.length + room.state.photos.length > 3000) {
      setError("A gallery supports up to 3,000 photos. Start a second delivery for the rest.");
      return;
    }
    setBusy(true);
    setError("");
    const created: UploadJob[] = [];
    const failures: string[] = [];
    try {
      for (const [index, file] of files.entries()) {
        ensureActive();
        setPreparing(`Preparing ${index + 1} of ${files.length} · ${file.name}`);
        try {
          created.push(
            await prepareUpload(room.id, file, {
              ownerId: drafts.find((d) => d.id === room.id)?.ownerId === null ? null : ownerId,
              ...(replace ? { photoId: replace.id } : {}),
            }),
          );
        } catch (e) {
          failures.push(messageOf(e));
        }
      }
      await persistPrepared(room.id, created);
      if (failures.length)
        setError(`${failures.length} files could not be prepared: ${failures.join(" · ")}`);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPreparing("");
      setBusy(false);
      setReplacement(null);
    }
  }
  async function uploadMany(pending: UploadJob[]) {
    let failed = 0;
    for (const [index, job] of pending.entries()) {
      ensureActive();
      setPreparing(`Uploading ${index + 1} of ${pending.length} · ${job.version.filename}`);
      try {
        const next = await uploadJob(
          job,
          (updated) => setJobs((old) => old.map((j) => (j.id === updated.id ? updated : j))),
          ensureActive,
        );
        ensureActive();
        setRoom(next);
      } catch {
        failed++;
      }
    }
    if (failed)
      setError(
        `${failed} uploads need attention. Their prepared files are saved on this device; use Retry uploads.`,
      );
  }
  async function syncUploads() {
    if (!room || !cloud) return;
    setBusy(true);
    setError("");
    try {
      if (local) {
        const draft = (await listDrafts(ownerId)).find((d) => d.id === room.id);
        if (!draft) throw new Error("Local draft not found.");
        if (!ownerId) throw new Error("Sign in to connect this draft.");
        setRoom(await connectDraft(draft, ownerId, ensureActive));
        ensureActive();
        setLocal(false);
        setDrafts(await listDrafts(ownerId));
      }
      await uploadMany(
        (await listUploadJobs(room.id, ownerId)).filter((j) => j.status !== "ready"),
      );
      setPreparing("");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
      setPreparing("");
    }
  }
  async function bringProject() {
    if (!room || !selectedProject) return;
    setBusy(true);
    setError("");
    try {
      const project = await loadProject(selectedProject);
      ensureActive();
      const unavailable = project.frames.filter(
        (f) => f.metadata.verdict === "keep" && (f.metadata.error || !f.originalBlobId),
      );
      const frames = project.frames.filter(
        (frame) =>
          frame.metadata.verdict === "keep" && !frame.metadata.error && frame.originalBlobId,
      );
      if (!frames.length)
        throw new Error(
          "This project has no keepers with connected originals. Choose your keepers in Studio first.",
        );
      const newFrames = frames.filter(
        (frame) =>
          !room.state.photos.some((p) =>
            p.versions.some(
              (v) => v.source?.projectId === project.id && v.source.frameId === frame.id,
            ),
          ),
      );
      if (room.state.photos.length + newFrames.length > 3000)
        throw new Error("This import would exceed 3,000 photos. Use a second gallery.");
      const blobs = await readProjectBlobs(project);
      const created: UploadJob[] = [];
      for (const [index, frame] of frames.entries()) {
        ensureActive();
        setPreparing(`Preparing keeper ${index + 1} of ${frames.length} · ${frame.originalName}`);
        const existing = room.state.photos.find((p) =>
          p.versions.some(
            (v) => v.source?.projectId === project.id && v.source.frameId === frame.id,
          ),
        );
        if (existing?.versions.some((v) => v.source?.editVersionId === frame.currentVersionId))
          continue;
        const blob = blobs.get(frame.originalBlobId!);
        if (!blob) throw new Error(`${frame.originalName}: original missing.`);
        const file = new File([blob], frame.originalName, { type: frame.originalType });
        created.push(
          await prepareUpload(room.id, file, {
            ownerId: drafts.find((d) => d.id === room.id)?.ownerId === null ? null : ownerId,
            ...(existing ? { photoId: existing.id } : {}),
            source: {
              projectId: project.id,
              frameId: frame.id,
              editVersionId: frame.currentVersionId,
              originalSha256: frame.originalBlobId!,
            },
            edits: frame.metadata.edits,
            focus: frame.metadata.faces?.center ?? null,
          }),
        );
      }
      await persistPrepared(room.id, created);
      setProjectOpen(false);
      if (unavailable.length)
        setError(
          `${created.length} prepared · ${unavailable.length} keepers need attention in Studio: ${unavailable.map((f) => f.originalName).join(", ")}. Those files were not uploaded or discarded.`,
        );
    } catch (e) {
      setError(messageOf(e));
      // Earlier prepared frames survive a later failed frame and remain retryable.
      const saved = await listUploadJobs(room.id, ownerId);
      setJobs(saved);
      if (local) await persistPrepared(room.id, []);
    } finally {
      setBusy(false);
      setPreparing("");
    }
  }
  async function openStudio(version: DeliveryVersion) {
    if (!version.source)
      throw new Error(
        "This file was uploaded directly. Open the source in your editor and upload a revision here.",
      );
    if (!room) throw new Error("Open the gallery before opening Studio.");
    const scope = workbench?.storageScope ?? ownerId ?? "device-local";
    if (ownerId && scope !== ownerId)
      throw new Error("The workspace account changed. Reopen Delivery in the matching account.");
    const { handoff, focus } = await prepareStudioHandoff(
      room,
      version.id,
      scope,
      loadProject,
      () => {
        ensureActive();
        return (
          roomRef.current?.id === room.id &&
          roomRef.current?.revision === room.revision &&
          activeId.current === room.id
        );
      },
    );
    saveStudioHandoff(window.sessionStorage, handoff);
    const href = studioBindingHref({
      kind: "ready",
      projectId: handoff.source.projectId,
      deliveryFocus: focus,
    });
    if (workbench) await workbench.openTool(href);
    else window.location.assign(href);
  }
  const pending = jobs.filter((j) => j.status !== "ready");
  let invitationText = "";
  if (room && shareUrl) {
    try {
      invitationText = galleryInvitation(room.state, shareUrl, new Date().toISOString());
    } catch {
      /* Expired or closed galleries cannot produce a ready-to-send invitation. */
    }
  }
  const unpublished =
    room?.state.photos
      .filter((p) => p.current && p.current !== p.published)
      .map((p) => p.current!) ?? [];
  const previewRoom = room
    ? {
        ...room,
        state: clientState({
          ...room.state,
          status: "live",
          photos: room.state.photos.map((p) => ({
            ...p,
            published: p.current,
            versions: p.versions.map((v) => ({
              ...v,
              publishedAt: v.id === p.current ? v.createdAt : v.publishedAt,
            })),
          })),
        }),
      }
    : null;

  return (
    <Shell hideEventHeader>
      <section
        className="delivery-workspace"
        onDragOver={(e) => {
          if (room && e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!room) return;
          e.preventDefault();
          setReplacement(null);
          void addFiles(Array.from(e.dataTransfer.files), null);
        }}
      >
        <div className="delivery-topline">
          <h1>{allSummaries.length > 1 ? "Galleries" : "Gallery"}</h1>
          <div className="delivery-inline-actions">
            <button
              className="delivery-primary"
              disabled={busy}
              onClick={() => {
                setError("");
                setNewOpen(true);
              }}
            >
              New Gallery
            </button>
          </div>
        </div>
        <div className={`delivery-layout${allSummaries.length ? "" : " is-empty"}`}>
          {allSummaries.length ? (
          <aside className="delivery-sidebar" aria-label="Galleries">
            {allSummaries.map((g) => (
              <button
                key={g.id}
                disabled={busy}
                onClick={() => void open(g.id)}
                className="delivery-room-link"
                aria-current={room?.id === g.id ? "page" : undefined}
              >
                <strong>{g.title}</strong>
                <small>
                  {g.clientName} · {g.local ? "On this device" : g.status}
                </small>
              </button>
            ))}
          </aside>
          ) : null}
          <div>
            {!room ? (
              <div className="delivery-empty" aria-label="Gallery" />
            ) : (
              <>
                <div className="delivery-room-heading">
                  {!local && room.state.released.length > 0 && (
                    <button
                      className="delivery-quiet"
                      disabled={busy}
                      onClick={() => {
                        const href = `/publish?gallery=${room.id}`;
                        if (workbench) void workbench.openTool(href);
                        else window.location.assign(href);
                      }}
                    >
                      Share finals to portfolio & Instagram <ArrowRight size={16} />
                    </button>
                  )}
                  <div>
                    <h2>{room.state.title}</h2>
                    <p>
                      For {room.state.clientName} ·{" "}
                      {local
                        ? "On this device · not shared"
                        : `Private · expires ${new Date(room.state.expiresAt).toLocaleDateString()}`}
                    </p>
                  </div>
                  <div className="delivery-inline-actions">
                    <button className="delivery-quiet" onClick={() => setPreview(true)}>
                      Client preview
                    </button>
                    <button
                      className="delivery-quiet"
                      onClick={() => setSettings(true)}
                      aria-label="Gallery settings"
                    >
                      <ChevronDown size={17} />
                    </button>
                    {!local && room.state.status === "live" && (
                      <button
                        className="delivery-primary"
                        disabled={busy}
                        onClick={() => setShareOpen(true)}
                      >
                        Share gallery <ArrowRight size={16} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="delivery-inline-actions">
                  <button
                    className="delivery-quiet"
                    disabled={busy}
                    onClick={() => {
                      setReplacement(null);
                      inputRef.current?.click();
                    }}
                  >
                    <Upload size={15} />
                    Add photos
                  </button>
                  <button
                    className="delivery-quiet"
                    disabled={busy}
                    onClick={async () => {
                      try {
                        setProjects(await listProjects());
                        setProjectOpen(true);
                      } catch (e) {
                        setError(messageOf(e));
                      }
                    }}
                  >
                    Bring Studio keepers <ArrowRight size={14} />
                  </button>
                  {unpublished.length > 0 && !local && (
                    <button
                      className="delivery-primary"
                      disabled={busy || pending.length > 0}
                      onClick={() => setPublishConfirm(true)}
                    >
                      Review & publish {unpublished.length}
                    </button>
                  )}
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  multiple={!replacement}
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(event) => {
                    void addFiles(Array.from(event.target.files ?? []));
                    event.target.value = "";
                  }}
                />
                {local && (
                  <div className="delivery-notice">
                    {cloud
                      ? "Prepared on this device. Connect and upload to create your private online gallery."
                      : setupNote ||
                        "Sign in to connect this draft to your private online gallery."}
                    <div className="delivery-inline-actions">
                      {cloud ? (
                        <button
                          className="delivery-primary"
                          disabled={busy || !jobs.length}
                          onClick={() => void syncUploads()}
                        >
                          Connect & upload {jobs.length} photos
                        </button>
                      ) : ready && !signedIn ? (
                        <a className="delivery-quiet" href="/auth?next=%2Fdeliver%3Fworkflow%3D1">
                          Sign in for private delivery <ArrowRight size={14} />
                        </a>
                      ) : (
                        <button className="delivery-quiet" onClick={() => setSettings(true)}>
                          Connection details
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {(preparing || pending.length > 0) && (
                  <div className="delivery-upload-list">
                    <p className="delivery-meta" role="status" aria-live="polite">
                      {preparing ||
                        `${jobs.filter((j) => j.status === "ready").length} verified online · ${pending.length} ${local ? "prepared locally" : "need upload"}`}
                    </p>
                    {pending.slice(0, 8).map((job) => (
                      <div className="delivery-upload-row" key={job.id}>
                        <span>
                          {job.version.filename}
                          <small>
                            {job.error ||
                              (local
                                ? "Prepared on this device"
                                : `${job.uploaded.length}/3 files transferred · ${job.status}`)}
                          </small>
                        </span>
                      </div>
                    ))}
                    {pending.length > 8 && (
                      <p className="delivery-meta">
                        And {pending.length - 8} more in the saved queue.
                      </p>
                    )}
                    {!local && !!pending.length && (
                      <button
                        className="delivery-quiet"
                        disabled={busy || !cloud}
                        onClick={() => void syncUploads()}
                      >
                        Retry uploads <ArrowRight size={14} />
                      </button>
                    )}
                  </div>
                )}
                <DeliveryGallery
                  key={room.id}
                  room={room}
                  actor="owner"
                  onDraftChange={setUnsentFeedback}
                  busy={busy}
                  run={run}
                  refresh={refresh}
                  media={media}
                  localUrls={local ? localUrls : undefined}
                  onRevise={(photo) => {
                    setReplacement(photo);
                    setTimeout(() => inputRef.current?.click(), 0);
                  }}
                  onStudio={openStudio}
                />
              </>
            )}
            {error && (
              <p className="delivery-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
        <Dialog open={newOpen} onOpenChange={setNewOpen}>
          <DialogContent className="delivery-confirm delivery-new-gallery">
            <DialogTitle>A new client gallery</DialogTitle>
            <DialogDescription>
              A private draft first. You decide when to share it.
            </DialogDescription>
            <form
              className="delivery-form"
              onChange={() => setNewFormDirty(true)}
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                const form = new FormData(e.currentTarget);
                try {
                  const draft = await createDraft(
                    {
                      id: pendingCreateId.current,
                      title: String(form.get("title")),
                      clientName: String(form.get("client")),
                      message: String(form.get("message")),
                      selectionLimit: Number(form.get("limit")),
                      expiresAt: new Date(`${form.get("expires")}T23:59:59`).toISOString(),
                    },
                    ownerId,
                  );
                  ensureActive();
                  setDrafts(await listDrafts(ownerId));
                  activeId.current = draft.id;
                  setRoom({ id: draft.id, revision: 0, state: draft.state });
                  setLocal(true);
                  setJobs([]);
                  setShareUrl("");
                  setNewOpen(false);
                  pendingCreateId.current = crypto.randomUUID();
                } catch (err) {
                  setError(messageOf(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <NewGalleryFields
                defaultDate={dateValue(30)}
                earliestDate={dateValue(1)}
                latestDate={dateValue(365)}
              />
              <button className="delivery-primary delivery-create-submit" disabled={busy}>
                {busy ? "Creating…" : "Create private draft"}
                <ArrowRight size={16} />
              </button>
              {error && (
                <p className="delivery-error" role="alert">
                  {error}
                </p>
              )}
            </form>
          </DialogContent>
        </Dialog>
        <Dialog open={projectOpen} onOpenChange={setProjectOpen}>
          <DialogContent className="delivery-confirm">
            <DialogTitle>Bring your Studio keepers</DialogTitle>
            <DialogDescription>
              Creates frozen JPEG renditions from your saved edits, linked to each source frame and
              edit version. RAW originals stay on this device. High-resolution exports are capped at
              4,800 px; this is not a full RAW renderer.
            </DialogDescription>
            <div className="delivery-form">
              <label>
                Saved project
                <select
                  value={selectedProject}
                  onChange={(e) => setSelectedProject(e.target.value)}
                >
                  <option value="">Choose a project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} · {p.frames.filter((f) => f.metadata.verdict === "keep").length}{" "}
                      keepers
                    </option>
                  ))}
                </select>
              </label>
              {!projects.length && (
                <p className="delivery-notice">
                  Save a named project in Studio first. No original files were changed.
                </p>
              )}
              <button
                className="delivery-primary"
                disabled={busy || !selectedProject}
                onClick={() => void bringProject()}
              >
                {preparing || "Prepare keepers"}
              </button>
              {error && (
                <p className="delivery-error" role="alert">
                  {error}
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={preview} onOpenChange={setPreview}>
          <DialogContent className="delivery-confirm !max-w-[1200px] !w-[96vw]">
            <DialogTitle>Client preview</DialogTitle>
            <DialogDescription>
              Read-only preview on this device. Comments, selections, approvals, and downloads
              require the published private link.
            </DialogDescription>
            {previewRoom && (
              <>
                <ClientGalleryHeader state={previewRoom.state} />
                <DeliveryGallery
                  room={previewRoom}
                  actor="client"
                  preview
                  busy={false}
                  run={async () => {}}
                  refresh={refresh}
                  media={media}
                  localUrls={local ? localUrls : undefined}
                />
                <ClientGalleryFooter state={previewRoom.state} preview />
              </>
            )}
          </DialogContent>
        </Dialog>
        <Dialog open={publishConfirm} onOpenChange={setPublishConfirm}>
          <DialogContent className="delivery-confirm">
            <DialogTitle>Publish {unpublished.length} photo versions?</DialogTitle>
            <DialogDescription>
              {room?.state.clientName} can review these photos with a private invitation. Publishing
              a new version removes the previous version’s download access and requires approval
              again. High-resolution files remain locked until you release approved finals.
            </DialogDescription>
            <p className="delivery-meta">
              Up to {room?.state.selectionLimit} selections · expires{" "}
              {room && new Date(room.state.expiresAt).toLocaleDateString()}
            </p>
            <button
              className="delivery-primary"
              disabled={busy}
              onClick={async () => {
                try {
                  await run({ type: "publish", versionIds: unpublished });
                  setPublishConfirm(false);
                  setShareOpen(true);
                } catch (e) {
                  setError(messageOf(e));
                }
              }}
            >
              Publish for review
            </button>
            {error && (
              <p className="delivery-error" role="alert">
                {error}
              </p>
            )}
          </DialogContent>
        </Dialog>
        <Dialog open={shareOpen} onOpenChange={setShareOpen}>
          <DialogContent className="delivery-confirm">
            <DialogTitle>One private place for the conversation</DialogTitle>
            <DialogDescription>
              Anyone holding this link can act as {room?.state.clientName}. It is a shared client
              invitation, not verified individual identity. Send it only to your intended
              collaborators.
            </DialogDescription>
            {shareUrl ? (
              <>
                <input
                  className="delivery-share-link"
                  aria-label="Private gallery invitation"
                  value={shareUrl}
                  readOnly
                  onFocus={(e) => e.target.select()}
                />
                <div className="delivery-inline-actions">
                  <button
                    className="delivery-primary"
                    disabled={!invitationText}
                    onClick={async () => {
                      try {
                        if (!room) return;
                        await copyShare(
                          galleryInvitation(room.state, shareUrl, new Date().toISOString()),
                          true,
                        );
                      } catch (cause) {
                        setError(messageOf(cause));
                      }
                    }}
                  >
                    <Copy size={15} />
                    {invitationCopied ? "Message copied" : "Copy invitation message"}
                  </button>
                  <button
                    className="delivery-quiet"
                    onClick={async () => {
                      try {
                        await copyShare(shareUrl, false);
                      } catch {
                        setError(
                          "Could not copy automatically. Select the link and copy it manually.",
                        );
                      }
                    }}
                  >
                    <Copy size={15} />
                    {copied ? "Copied" : "Copy private link"}
                  </button>
                  <a
                    className="delivery-quiet"
                    href={shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open client gallery <ArrowRight size={14} />
                  </a>
                </div>
                {invitationText && (
                  <MessageComposer
                    key={`${room?.id}:${room?.revision}:${shareUrl}`}
                    title="Your Photo Gallery"
                    hideCopy
                    text={invitationText}
                    beforeAction={() => {
                      ensureActive();
                      if (
                        !room ||
                        roomRef.current?.id !== room.id ||
                        roomRef.current?.revision !== room.revision ||
                        shareUrlRef.current !== shareUrl ||
                        galleryInvitation(room.state, shareUrl, new Date().toISOString()) !==
                          invitationText
                      )
                        throw new Error(
                          "This invitation changed or expired. Reopen Share before sending.",
                        );
                    }}
                  />
                )}
              </>
            ) : (
              <button
                className="delivery-primary"
                disabled={busy}
                onClick={async () => {
                  if (!room) return;
                  setBusy(true);
                  setError("");
                  try {
                    const result = await createPrivateInvitation({
                      data: { id: room.id, revision: room.revision },
                    });
                    setRoom(result.room);
                    setShareUrl(result.url);
                    setSharedGeneration(invitationGeneration(result.room.state));
                    setCopied(false);
                    setInvitationCopied(false);
                  } catch (e) {
                    setError(messageOf(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Create new private link <ArrowRight size={16} />
              </button>
            )}
            <p className="delivery-meta">
              Creating a new link revokes the previous invitation. Closing the gallery stops new
              access; already issued media links can remain usable for up to two minutes. Previously
              downloaded files cannot be recalled.
            </p>
            {error && (
              <p className="delivery-error" role="alert">
                {error}
              </p>
            )}
          </DialogContent>
        </Dialog>
        <Dialog
          open={settings}
          onOpenChange={(open) => {
            if (
              !open &&
              presentationDirty &&
              !window.confirm("Discard unsaved presentation changes?")
            )
              return;
            setSettings(open);
          }}
        >
          <DialogContent className="delivery-confirm">
            <DialogTitle>Delivery controls</DialogTitle>
            <DialogDescription>
              {local
                ? "This is a device-local draft. No client link or shared activity exists yet."
                : "Your client’s selection, each approval, and every final release remain separate."}
            </DialogDescription>
            {room && (
              <GalleryPresentationForm
                key={room.id}
                state={room.state}
                busy={busy || !!preparing}
                save={savePresentation}
                onDirty={setPresentationDirty}
              />
            )}
            {!ready && (
              <p className="delivery-notice">
                Remote sharing needs the private delivery database migration, a server-only Supabase
                connection, and the deployed gallery address. Nothing here is publicly accessible
                yet. Do not put server secrets in browser settings.
              </p>
            )}
            {room && !local && (
              <>
                <button
                  className="delivery-quiet"
                  disabled={busy}
                  onClick={() => void ownerAction({ type: "reopenSelections" })}
                >
                  Reopen client selections (also pauses final downloads)
                </button>
                {room.state.status === "closed" ||
                Date.parse(room.state.expiresAt) <= Date.now() ? (
                  <button
                    className="delivery-primary"
                    disabled={busy}
                    onClick={() =>
                      void ownerAction({
                        type: "reopen",
                        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
                      })
                    }
                  >
                    Reopen for 30 days
                  </button>
                ) : (
                  <button
                    className="delivery-quiet text-destructive"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Close this gallery and revoke the client invitation? Already downloaded files cannot be recalled.",
                        )
                      )
                        void ownerAction({ type: "close" });
                    }}
                  >
                    Close gallery & revoke invitation
                  </button>
                )}
              </>
            )}
            <p className="delivery-meta">
              Media: JPEG proofs up to 1,600 px · phone copies up to 2,048 px · high-resolution
              JPEGs up to 4,800 px. No RAW originals are uploaded. Your previous galleries remain
              available separately.
            </p>
            {error && (
              <p className="delivery-error" role="alert">
                {error}
              </p>
            )}
          </DialogContent>
        </Dialog>
      </section>
    </Shell>
  );
}
