import { createFileRoute } from "@tanstack/react-router";
import { useAccount } from "@/components/account/AccountProvider";
import { useSignedOutRedirect } from "@/components/account/useSignedOutRedirect";
import { useToolLeaveGuard } from "@/components/workbench/useToolLeaveGuard";
import { VideoEditor } from "@/components/video/VideoEditor";
import { PRODUCT_TITLE } from "@/lib/product";
import { parseVideoCommand } from "@/lib/video/commands";
import { isVideoFile } from "@/lib/video/media";
import { takeVideoImport } from "@/lib/video/pending-import";
import { VIDEO_PRODUCT_TITLE } from "@/lib/video/product";
import {
  appendSource,
  clipUnderTime,
  emptySequence,
  insertSourceAtPlayhead,
  pruneMissingSources,
  razorAt,
  rippleDelete,
  setPlayhead,
  type Sequence,
} from "@/lib/video/sequence";
import { clearVideoSequence, loadVideoSequence, saveVideoSequence } from "@/lib/video/sequence-store";
import { workspaceStorageKey } from "@/lib/workspace-storage";
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clearVideoReviewSession,
  commitVideoReviewSession,
  loadVideoReviewSession,
  type PersistedJournalEntry,
  type PersistedVideoClip,
  type VideoFilter,
  type VideoMetadataStatus,
  type VideoReviewDraft,
  type VideoVerdict,
} from "@/lib/video/session";

export const Route = createFileRoute("/video")({
  head: () => ({
    meta: [
      { title: `${VIDEO_PRODUCT_TITLE} — ${PRODUCT_TITLE}` },
      {
        name: "description",
        content: "Edit video in Celinen. Footage stays on this device.",
      },
    ],
  }),
  component: VideoReview,
});

type Verdict = VideoVerdict;
type Filter = VideoFilter;
type VideoClip = PersistedVideoClip & { url: string | null };
type JournalEntry = PersistedJournalEntry;

type ProbeResult = Pick<VideoClip, "duration" | "width" | "height" | "metadataStatus"> & {
  failure: "error" | "timeout" | null;
};

const VIDEO_PENDING_COMMAND_KEY = "lenslabs.pending-command.v1:video";
const LEGACY_PENDING_COMMAND_KEY = "lenslabs.pending-command.v1";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "todo", label: "To review" },
  { key: "keepers", label: "Keepers" },
  { key: "rejected", label: "Rejected" },
];

const QUICK_COMMANDS = [
  "split at playhead",
  "insert this on the timeline",
  "keep clips longer than 10 seconds",
  "play sequence",
];

function toPersistedClip(clip: VideoClip): PersistedVideoClip {
  return {
    id: clip.id,
    name: clip.name,
    type: clip.type,
    size: clip.size,
    lastModified: clip.lastModified,
    duration: clip.duration,
    width: clip.width,
    height: clip.height,
    verdict: clip.verdict,
    metadataStatus: clip.metadataStatus,
  };
}

function clipSignature(clip: Pick<VideoClip, "name" | "size" | "lastModified">) {
  return `${clip.name}:${clip.size}:${clip.lastModified}`;
}

function persistedDraftFingerprint(draft: VideoReviewDraft) {
  return JSON.stringify(draft);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runWorker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]!, index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runWorker()));
  return results;
}

function probeVideo(url: string) {
  return new Promise<ProbeResult>((resolve) => {
    const media = document.createElement("video");
    let settled = false;

    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      media.removeAttribute("src");
      media.load();
      resolve(result);
    };

    const timeout = window.setTimeout(
      () =>
        finish({
          duration: 0,
          width: 0,
          height: 0,
          metadataStatus: "unavailable",
          failure: "timeout",
        }),
      12_000,
    );

    media.preload = "metadata";
    media.muted = true;
    media.onloadedmetadata = () =>
      finish({
        duration: Number.isFinite(media.duration) ? media.duration : 0,
        width: media.videoWidth || 0,
        height: media.videoHeight || 0,
        metadataStatus: "ready",
        failure: null,
      });
    media.onerror = () =>
      finish({
        duration: 0,
        width: 0,
        height: 0,
        metadataStatus: "unavailable",
        failure: "error",
      });
    media.src = url;
  });
}

function VideoReview() {
  useSignedOutRedirect();
  const account = useAccount();
  const storageScope = account?.scope ?? "device-local";
  const fileRef = useRef<HTMLInputElement>(null);
  const commandRef = useRef<HTMLInputElement>(null);
  const programRef = useRef<HTMLVideoElement>(null);
  const objectUrls = useRef(new Set<string>());
  const importingRef = useRef(false);
  const importRunRef = useRef(0);
  const mountedRef = useRef(true);
  const storageFailureNoted = useRef(false);
  const storageWritableRef = useRef(true);
  const storageRevisionRef = useRef(0);
  const persistedFingerprintRef = useRef("");
  const persistenceGenerationRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [clips, setClips] = useState<VideoClip[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [command, setCommand] = useState("");
  const [note, setNote] = useState("Import footage to begin a local review.");
  const [probing, setProbing] = useState<{
    done: number;
    total: number;
    failed: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [sequence, setSequence] = useState<Sequence>(() => emptySequence());
  const [tool, setTool] = useState<"select" | "razor">("select");
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const clipsRef = useRef<VideoClip[]>([]);

  const counts = useMemo(
    () => ({
      all: clips.length,
      todo: clips.filter((clip) => clip.verdict === "undecided").length,
      keepers: clips.filter((clip) => clip.verdict === "keep").length,
      rejected: clips.filter((clip) => clip.verdict === "reject").length,
    }),
    [clips],
  );

  const visible = useMemo(
    () =>
      clips.filter((clip) => {
        if (filter === "todo") return clip.verdict === "undecided";
        if (filter === "keepers") return clip.verdict === "keep";
        if (filter === "rejected") return clip.verdict === "reject";
        return true;
      }),
    [clips, filter],
  );

  const selected = visible.find((clip) => clip.id === selectedId) ?? visible[0] ?? null;
  clipsRef.current = clips;

  useEffect(() => {
    const restored = loadVideoReviewSession(undefined, storageScope);
    if (restored.status === "invalid") {
      storageWritableRef.current = false;
      setNote(restored.warning);
      setHydrated(true);
      return;
    }

    const session = restored.status === "ready" ? restored.session : null;
    storageRevisionRef.current = session?.revision ?? 0;
    const baseline: VideoReviewDraft = session
      ? {
          clips: session.clips,
          selectedId: session.selectedId,
          filter: session.filter,
          journal: session.journal,
        }
      : { clips: [], selectedId: null, filter: "all", journal: [] };
    persistedFingerprintRef.current = persistedDraftFingerprint(baseline);

    if (session?.clips.length) {
      setClips(session.clips.map((clip) => ({ ...clip, url: null })));
      setSelectedId(
        session.clips.some((clip) => clip.id === session.selectedId)
          ? session.selectedId
          : session.clips[0]!.id,
      );
      setFilter(session.filter);
      setJournal(session.journal);
      setNote(
        `Restored ${session.clips.length} clip${session.clips.length === 1 ? "" : "s"} and review marks. Reconnect originals to resume playback; media bytes were never stored.`,
      );
    }
    const restoredSequence = pruneMissingSources(
      loadVideoSequence(storageScope),
      new Set((session?.clips ?? []).map((clip) => clip.id)),
    );
    setSequence(restoredSequence);
    setHydrated(true);
  }, [storageScope]);

  const persistReview = useCallback(() => {
    if (!storageWritableRef.current) return Promise.resolve(false);
    const draft: VideoReviewDraft = {
      clips: clips.map(toPersistedClip),
      selectedId,
      filter,
      journal,
    };
    const fingerprint = persistedDraftFingerprint(draft);
    if (fingerprint === persistedFingerprintRef.current) return Promise.resolve(true);

    const generation = persistenceGenerationRef.current;
    const save = saveQueueRef.current
      .catch(() => {
        // The result handler below reports storage failures. Keep the queue usable.
      })
      .then(async () => {
        if (generation !== persistenceGenerationRef.current) return false;
        const result = await commitVideoReviewSession(draft, storageRevisionRef.current, { scope: storageScope });
        if (generation !== persistenceGenerationRef.current) return false;

        if (!result.ok) {
          if (result.reason === "conflict") {
            persistenceGenerationRef.current += 1;
            const current = result.currentSession;
            if (current) {
              storageRevisionRef.current = current.revision;
              const currentDraft: VideoReviewDraft = {
                clips: current.clips,
                selectedId: current.selectedId,
                filter: current.filter,
                journal: current.journal,
              };
              persistedFingerprintRef.current = persistedDraftFingerprint(currentDraft);
              objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
              objectUrls.current.clear();
              setClips(current.clips.map((clip) => ({ ...clip, url: null })));
              setSelectedId(current.selectedId);
              setFilter(current.filter);
              setJournal(current.journal);
            } else {
              storageRevisionRef.current = 0;
              const emptyDraft: VideoReviewDraft = {
                clips: [],
                selectedId: null,
                filter: "all",
                journal: [],
              };
              persistedFingerprintRef.current = persistedDraftFingerprint(emptyDraft);
              objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
              objectUrls.current.clear();
              setClips([]);
              setSelectedId(null);
              setFilter("all");
              setJournal([]);
            }
          } else {
            storageWritableRef.current = false;
          }
          setNote(result.error);
          return false;
        }

        storageRevisionRef.current = result.session.revision;
        persistedFingerprintRef.current = fingerprint;
        return true;
      });

    saveQueueRef.current = save.then(
      () => undefined,
      () => undefined,
    );
    return save;
  }, [clips, filter, journal, selectedId, storageScope]);

  useToolLeaveGuard(
    probing ? "Video import is still running and will stop." : clips.some((clip) => clip.url)
      ? "Review marks will be saved. Reconnect your original videos when you reopen this tool to resume playback."
      : command.trim() ? "Your unsent video command will be discarded." : null,
    persistReview,
  );

  useEffect(() => {
    if (!hydrated) return;
    void persistReview().then((saved) => {
      if (!saved && !storageFailureNoted.current) storageFailureNoted.current = true;
    });
  }, [hydrated, persistReview]);

  useEffect(() => {
    if (!hydrated) return;
    saveVideoSequence(sequence, storageScope);
  }, [hydrated, sequence, storageScope]);

  useEffect(() => {
    if (!hydrated) return;
    const saveBeforeLeaving = () => {
      void persistReview();
    };
    window.addEventListener("pagehide", saveBeforeLeaving);
    return () => window.removeEventListener("pagehide", saveBeforeLeaving);
  }, [hydrated, persistReview]);

  useEffect(() => {
    try {
      const key = workspaceStorageKey(VIDEO_PENDING_COMMAND_KEY, storageScope);
      const pending = sessionStorage.getItem(key);
      if (pending) {
        setCommand(pending);
        window.setTimeout(() => commandRef.current?.focus(), 0);
      }
      sessionStorage.removeItem(key);
      if (storageScope === "device-local") sessionStorage.removeItem(LEGACY_PENDING_COMMAND_KEY);
    } catch {
      // Local review still works when session storage is unavailable.
    }
  }, [storageScope]);

  useEffect(() => {
    const activeImportRun = importRunRef;
    const urls = objectUrls.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeImportRun.current++;
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const applyVerdict = useCallback(
    (ids: string[], verdict: Verdict, label: string) => {
      const idSet = new Set(ids);
      const changes = clips
        .filter((clip) => idSet.has(clip.id) && clip.verdict !== verdict)
        .map((clip) => ({ id: clip.id, previous: clip.verdict, next: verdict }));
      if (changes.length === 0) {
        setNote("Nothing changed.");
        return;
      }

      const changedIds = new Set(changes.map((change) => change.id));
      setClips((current) =>
        current.map((clip) => (changedIds.has(clip.id) ? { ...clip, verdict } : clip)),
      );
      setJournal((current) => [
        ...current.slice(-49),
        { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, label, changes },
      ]);
      setNote(`${label} · ${changes.length} clip${changes.length === 1 ? "" : "s"}`);
    },
    [clips],
  );

  const undo = useCallback(() => {
    const entry = journal.at(-1);
    if (!entry) {
      setNote("Nothing to undo.");
      return;
    }
    const previous = new Map(entry.changes.map((change) => [change.id, change.previous]));
    setClips((current) =>
      current.map((clip) => {
        const verdict = previous.get(clip.id);
        return verdict ? { ...clip, verdict } : clip;
      }),
    );
    setJournal((current) => current.slice(0, -1));
    setNote(`Undid ${entry.label.toLowerCase()}.`);
  }, [journal]);

  const step = useCallback(
    (direction: -1 | 1) => {
      if (visible.length === 0) return;
      const current = Math.max(
        0,
        visible.findIndex((clip) => clip.id === selected?.id),
      );
      const next = (current + direction + visible.length) % visible.length;
      setSelectedId(visible[next]!.id);
    },
    [selected?.id, visible],
  );

  const razorPlayhead = useCallback(() => {
    setSequence((current) => razorAt(current, current.playhead));
    setNote("Split at playhead.");
  }, []);

  const togglePlay = useCallback(() => {
    playingRef.current = !playingRef.current;
    setPlaying(playingRef.current);
    const video = programRef.current;
    if (!video) return;
    if (playingRef.current) void video.play();
    else video.pause();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (target?.closest("[data-app-key]") && event.key.toLowerCase() === "z") return;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        togglePlay();
      } else if (event.key.toLowerCase() === "c") {
        razorPlayhead();
      } else if (event.key.toLowerCase() === "v") {
        setTool("select");
      } else if (event.key.toLowerCase() === "k" && selected) {
        applyVerdict([selected.id], "keep", "Kept");
      } else if (event.key.toLowerCase() === "x" && selected) {
        applyVerdict([selected.id], "reject", "Rejected");
      } else if (event.key.toLowerCase() === "u") {
        undo();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applyVerdict, selected, step, undo]);

  const importFiles = async (files: File[]) => {
    if (importingRef.current) {
      setNote("Finish reading the current files before adding more footage.");
      return;
    }

    const accepted = files.filter(isVideoFile);
    if (accepted.length === 0) {
      setNote("No supported video files found.");
      return;
    }

    const existingBySignature = new Map(clips.map((clip) => [clipSignature(clip), clip]));
    const incomingSignatures = new Set<string>();
    const tasks = accepted.flatMap((file) => {
      const signature = clipSignature({
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
      });
      if (incomingSignatures.has(signature)) return [];
      incomingSignatures.add(signature);

      const existing = existingBySignature.get(signature) ?? null;
      if (existing?.url) return [];
      return [{ file, existing }];
    });
    const skipped = accepted.length - tasks.length;

    if (tasks.length === 0) {
      setNote("Those clips are already connected to this review.");
      return;
    }

    importingRef.current = true;
    const importRun = ++importRunRef.current;
    setProbing({ done: 0, total: tasks.length, failed: 0 });

    try {
      const processed = await mapWithConcurrency(tasks, 4, async ({ file, existing }, index) => {
        if (!mountedRef.current || importRunRef.current !== importRun) return null;
        let probeUnavailable = false;
        let url: string | null = null;

        try {
          url = URL.createObjectURL(file);
          objectUrls.current.add(url);
          const probe = await probeVideo(url);
          if (!mountedRef.current || importRunRef.current !== importRun) {
            URL.revokeObjectURL(url);
            objectUrls.current.delete(url);
            return null;
          }
          probeUnavailable = probe.metadataStatus === "unavailable";
          const metadata =
            probe.metadataStatus === "ready" || !existing
              ? probe
              : {
                  duration: existing.duration,
                  width: existing.width,
                  height: existing.height,
                  metadataStatus: existing.metadataStatus,
                };

          return {
            clip: {
              id:
                existing?.id ??
                `${file.name}-${file.size}-${file.lastModified}-${Date.now()}-${index}`,
              name: file.name,
              url,
              type: file.type || existing?.type || "video/unknown",
              size: file.size,
              lastModified: file.lastModified,
              verdict: existing?.verdict ?? ("undecided" as const),
              duration: metadata.duration,
              width: metadata.width,
              height: metadata.height,
              metadataStatus: metadata.metadataStatus as VideoMetadataStatus,
            },
            reconnect: Boolean(existing),
            probeUnavailable,
          };
        } catch {
          if (url) {
            URL.revokeObjectURL(url);
            objectUrls.current.delete(url);
          }
          probeUnavailable = true;
          return null;
        } finally {
          if (mountedRef.current && importRunRef.current === importRun) {
            setProbing((current) =>
              current
                ? {
                    ...current,
                    done: current.done + 1,
                    failed: current.failed + (probeUnavailable ? 1 : 0),
                  }
                : current,
            );
          }
        }
      });

      if (!mountedRef.current || importRunRef.current !== importRun) return;

      const ready = processed.filter((result) => result !== null);
      const replacements = new Map(
        ready.filter((result) => result.reconnect).map((result) => [result.clip.id, result.clip]),
      );
      const added = ready.filter((result) => !result.reconnect).map((result) => result.clip);
      const reconnected = replacements.size;
      const unavailable = processed.filter(
        (result) => result === null || result.probeUnavailable,
      ).length;

      setClips((current) => [
        ...current.map((clip) => {
          const replacement = replacements.get(clip.id);
          return replacement
            ? {
                ...clip,
                url: replacement.url,
                type: replacement.type,
                duration: replacement.duration,
                width: replacement.width,
                height: replacement.height,
                metadataStatus: replacement.metadataStatus,
              }
            : clip;
        }),
        ...added,
      ]);
      setSelectedId((current) => current ?? ready[0]?.clip.id ?? null);
      setFilter("all");
      if (added.length) {
        setSequence((current) => {
          let next = current;
          const already = new Set(current.videoTracks.flat().map((clip) => clip.sourceId));
          for (const clip of added) {
            if (already.has(clip.id) || clip.duration <= 0) continue;
            next = appendSource(next, clip.id, clip.duration);
            already.add(clip.id);
          }
          return next;
        });
      }

      const actions = [
        added.length > 0 ? `${added.length} added` : "",
        reconnected > 0 ? `${reconnected} reconnected` : "",
        skipped > 0 ? `${skipped} already connected` : "",
        unavailable > 0 ? `${unavailable} metadata unavailable` : "",
      ].filter(Boolean);
      setNote(`${actions.join(" · ")}. Originals remain local and read-only.`);
    } finally {
      importingRef.current = false;
      if (mountedRef.current && importRunRef.current === importRun) setProbing(null);
    }
  };

  const clearReview = async () => {
    if (
      !window.confirm(
        "Clear saved review marks and metadata? This does not delete or change any original files.",
      )
    ) {
      return;
    }
    await saveQueueRef.current.catch(() => undefined);
    persistenceGenerationRef.current += 1;
    const cleared = await clearVideoReviewSession({ scope: storageScope });
    if (!cleared.ok) {
      setNote(cleared.error);
      return;
    }

    storageWritableRef.current = true;
    storageFailureNoted.current = false;
    storageRevisionRef.current = cleared.session.revision;
    persistedFingerprintRef.current = persistedDraftFingerprint({
      clips: [],
      selectedId: null,
      filter: "all",
      journal: [],
    });
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current.clear();
    setClips([]);
    setSelectedId(null);
    setFilter("all");
    setJournal([]);
    setSequence(emptySequence());
    clearVideoSequence(storageScope);
    setNote("Review data cleared. Original files were not changed.");
  };

  const exportManifest = useCallback(() => {
    const keepers = clips.filter((clip) => clip.verdict === "keep");
    if (keepers.length === 0) {
      setNote("Mark at least one keeper before exporting a manifest.");
      return;
    }

    const payload = {
      format: "lenslabs-video-selects/v1",
      exportedAt: new Date().toISOString(),
      note: "References original local files. Video did not upload, modify, or transcode media.",
      clips: keepers.map((clip) => ({
        filename: clip.name,
        durationSeconds: Number(clip.duration.toFixed(3)),
        width: clip.width,
        height: clip.height,
        bytes: clip.size,
        mimeType: clip.type,
        lastModified: new Date(clip.lastModified).toISOString(),
      })),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `video-selects-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setNote(
      `Exported a manifest for ${keepers.length} selected clip${keepers.length === 1 ? "" : "s"}.`,
    );
  }, [clips]);

  const runCommand = (raw: string) => {
    const parsed = parseVideoCommand(raw);
    if (parsed.kind === "unknown" && !raw.trim()) return;

    if (parsed.kind === "export") exportManifest();
    else if (parsed.kind === "undo") undo();
    else if (parsed.kind === "play") {
      if (!playingRef.current) togglePlay();
      setNote("Playing.");
    } else if (parsed.kind === "pause") {
      if (playingRef.current) togglePlay();
      setNote("Paused.");
    } else if (parsed.kind === "razor") razorPlayhead();
    else if (parsed.kind === "ripple-delete") {
      const clip = clipUnderTime(sequence, sequence.playhead);
      if (!clip) setNote("Move the playhead onto a clip to delete it.");
      else {
        setSequence((current) => rippleDelete(current, clip.id));
        setNote("Ripple deleted.");
      }
    } else if (parsed.kind === "insert-selected") {
      if (!selected) setNote("Select a clip in the bin first.");
      else if (selected.duration <= 0) setNote("Reconnect the clip before inserting it.");
      else {
        setSequence((current) => insertSourceAtPlayhead(current, selected.id, selected.duration));
        setNote(`Inserted ${selected.name}.`);
      }
    } else if (parsed.kind === "filter") {
      setFilter(parsed.filter);
      setNote(`Showing ${parsed.filter}.`);
    } else if (parsed.kind === "verdict") {
      const ids =
        parsed.ids === "all" ? clips.map((clip) => clip.id) : selected ? [selected.id] : [];
      if (ids.length === 0) setNote("Nothing to mark.");
      else applyVerdict(ids, parsed.verdict, parsed.verdict === "keep" ? "Kept" : "Rejected");
    } else if (parsed.kind === "verdict-duration") {
      const ids = clips
        .filter((clip) =>
          parsed.compare === "over" ? clip.duration > parsed.seconds : clip.duration > 0 && clip.duration < parsed.seconds,
        )
        .map((clip) => clip.id);
      applyVerdict(
        ids,
        parsed.verdict,
        parsed.compare === "over"
          ? `Kept clips over ${parsed.seconds}s`
          : `Rejected clips under ${parsed.seconds}s`,
      );
    } else if (parsed.kind === "verdict-first") {
      applyVerdict(
        clips.slice(0, parsed.count).map((clip) => clip.id),
        "keep",
        `Kept first ${parsed.count}`,
      );
    } else if (clips.length === 0) {
      setNote("Import footage first, then run the command.");
    } else {
      setNote("Try: split at playhead, insert this on the timeline, or keep clips longer than 10 seconds.");
    }
    setCommand("");
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    void importFiles(Array.from(event.dataTransfer.files));
  };

  useEffect(() => {
    if (!hydrated) return;
    const pending = takeVideoImport();
    if (pending.length) void importFiles(pending);
  }, [hydrated]);

  useEffect(() => {
    const video = programRef.current;
    if (!video) return;
    const onTime = () => {
      const sourceId = selected?.id;
      if (!sourceId) return;
      const placed = sequence.videoTracks.flat().find((clip) => clip.sourceId === sourceId);
      if (!placed) return;
      setSequence((current) =>
        setPlayhead(current, placed.start + Math.max(0, video.currentTime - placed.inPoint)),
      );
    };
    video.addEventListener("timeupdate", onTime);
    return () => video.removeEventListener("timeupdate", onTime);
  }, [selected?.id, sequence.videoTracks]);

  return (
    <VideoEditor
      clips={clips}
      visible={visible}
      selected={selected}
      filter={filter}
      filters={FILTERS}
      counts={counts}
      sequence={sequence}
      tool={tool}
      playing={playing}
      probing={probing}
      dragging={dragging}
      note={note}
      command={command}
      commandRef={commandRef}
      fileRef={fileRef}
      programRef={programRef}
      onFilter={setFilter}
      onSelect={setSelectedId}
      onKeep={() => selected && applyVerdict([selected.id], "keep", "Kept")}
      onReject={() => selected && applyVerdict([selected.id], "reject", "Rejected")}
      onUndo={undo}
      onImport={() => fileRef.current?.click()}
      onFiles={(files) => void importFiles(files)}
      onDrop={onDrop}
      onDragState={setDragging}
      onTool={setTool}
      onPlayToggle={togglePlay}
      onRazor={razorPlayhead}
      onTimelineClick={(time) => {
        setSequence((current) => {
          const next = setPlayhead(current, time);
          return tool === "razor" ? razorAt(next, next.playhead) : next;
        });
        const video = programRef.current;
        const clip = selected;
        if (video && clip) {
          const placed = sequence.videoTracks.flat().find((item) => item.sourceId === clip.id);
          if (placed) video.currentTime = placed.inPoint + Math.max(0, time - placed.start);
        }
      }}
      onSelectTimelineClip={(clip) => {
        setSelectedId(clip.sourceId);
        setSequence((current) => setPlayhead(current, clip.start));
      }}
      onCommandChange={setCommand}
      onCommand={runCommand}
      quickCommands={QUICK_COMMANDS}
    />
  );
}
