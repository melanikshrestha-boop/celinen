import { createFileRoute, Link } from "@tanstack/react-router";
import { useWorkbench } from "@/components/workbench/context";
import { useToolLeaveGuard } from "@/components/workbench/useToolLeaveGuard";
import { workspaceStorageKey } from "@/lib/workspace-storage";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  FolderOpen,
  RotateCcw,
  Video as VideoIcon,
  X,
} from "lucide-react";
import {
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LogoMark } from "@/components/lensos/Logo";
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
      { title: "Video Review — Celinen" },
      {
        name: "description",
        content:
          "Review local video clips, mark selects, and export a JSON manifest without uploading or changing source media.",
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

const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "webm", "ogv", "ogg"];
const VIDEO_PENDING_COMMAND_KEY = "lenslabs.pending-command.v1:video";
const LEGACY_PENDING_COMMAND_KEY = "lenslabs.pending-command.v1";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "todo", label: "To review" },
  { key: "keepers", label: "Keepers" },
  { key: "rejected", label: "Rejected" },
];

const QUICK_COMMANDS = [
  "keep clips longer than 10 seconds",
  "show undecided clips",
  "export selects manifest",
];

function isVideoFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return file.type.startsWith("video/") || VIDEO_EXTENSIONS.includes(extension);
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "duration unavailable";
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainder
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

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
  const workbench = useWorkbench();
  const storageScope = workbench?.storageScope ?? "device-local";
  const fileRef = useRef<HTMLInputElement>(null);
  const commandRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (workbench && (workbench.activeTool !== "/video" || !target?.closest('[data-workbench-tool="route"]'))) return;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (event.key.toLowerCase() === "k" && selected) {
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
  }, [applyVerdict, selected, step, undo, workbench]);

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
      note: "References original local files. Celinen did not upload, modify, or transcode media.",
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
    anchor.download = `lenslabs-video-selects-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setNote(
      `Exported a manifest for ${keepers.length} selected clip${keepers.length === 1 ? "" : "s"}.`,
    );
  }, [clips]);

  const runCommand = (raw: string) => {
    const value = raw.trim().toLowerCase();
    if (!value) return;

    if (/\b(export|download|manifest)\b/.test(value)) {
      exportManifest();
    } else if (/\bundo\b/.test(value)) {
      undo();
    } else if (/\b(show|filter)\b.*\b(keeper|keepers|selects)\b/.test(value)) {
      setFilter("keepers");
      setNote("Showing keepers.");
    } else if (/\b(show|filter)\b.*\b(reject|rejected|cuts)\b/.test(value)) {
      setFilter("rejected");
      setNote("Showing rejected clips.");
    } else if (/\b(show|filter)\b.*\b(todo|undecided|unreviewed)\b/.test(value)) {
      setFilter("todo");
      setNote("Showing clips still to review.");
    } else if (/\b(show|filter)\b.*\ball\b/.test(value)) {
      setFilter("all");
      setNote("Showing every clip.");
    } else if (/\bkeep\b.*\b(selected|this|current)\b/.test(value) && selected) {
      applyVerdict([selected.id], "keep", "Kept");
    } else if (/\b(reject|cut)\b.*\b(selected|this|current)\b/.test(value) && selected) {
      applyVerdict([selected.id], "reject", "Rejected");
    } else {
      const longer = value.match(
        /\bkeep\b.*\b(?:longer|over|more than)\s+(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)?\b/,
      );
      const shorter = value.match(
        /\b(?:reject|cut)\b.*\b(?:shorter|under|less than)\s+(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)?\b/,
      );
      const first = value.match(/\bkeep\b.*\bfirst\s+(\d+)\b/);

      if (longer) {
        const threshold = Number(longer[1]);
        applyVerdict(
          clips.filter((clip) => clip.duration > threshold).map((clip) => clip.id),
          "keep",
          `Kept clips over ${threshold}s`,
        );
      } else if (shorter) {
        const threshold = Number(shorter[1]);
        applyVerdict(
          clips
            .filter((clip) => clip.duration > 0 && clip.duration < threshold)
            .map((clip) => clip.id),
          "reject",
          `Rejected clips under ${threshold}s`,
        );
      } else if (first) {
        const amount = Math.max(0, Number(first[1]));
        applyVerdict(
          clips.slice(0, amount).map((clip) => clip.id),
          "keep",
          `Kept first ${amount}`,
        );
      } else if (/\bkeep\b.*\ball\b/.test(value)) {
        applyVerdict(
          clips.map((clip) => clip.id),
          "keep",
          "Kept all",
        );
      } else if (/\b(reject|cut)\b.*\ball\b/.test(value)) {
        applyVerdict(
          clips.map((clip) => clip.id),
          "reject",
          "Rejected all",
        );
      } else if (clips.length === 0) {
        setNote("Import footage first, then run the command.");
      } else {
        setNote(
          "Try: keep clips longer than 10 seconds, show undecided clips, undo, or export the manifest.",
        );
      }
    }
    setCommand("");
  };

  const submitCommand = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runCommand(command);
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    void importFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <div className="min-h-screen bg-paper p-2 text-ink sm:p-3">
      <div className="mx-auto flex min-h-[calc(100vh-1rem)] max-w-[1800px] flex-col gap-2 sm:min-h-[calc(100vh-1.5rem)]">
        <header className="flex min-h-12 flex-wrap items-center gap-2 rounded-xl bg-card px-3 py-2 sm:px-4">
          <Link to="/" className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-muted">
            <ArrowLeft size={14} className="text-moss" />
            <LogoMark size={22} className="text-ink" />
            <span className="font-display text-sm font-semibold tracking-tight">Video review</span>
          </Link>
          <span className="font-mono text-[10px] text-moss">
            {counts.all} clips · {counts.todo} to review · {counts.keepers} keepers
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={undo}
              disabled={journal.length === 0}
              data-app-key="undo"
              className="grid size-8 place-items-center rounded-lg bg-muted text-moss transition-colors hover:text-ink disabled:opacity-35"
              aria-label="Undo last verdict"
              title="Undo · ⌘Z · U"
            >
              <RotateCcw size={14} />
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={probing !== null}
              className="flex items-center gap-2 rounded-lg bg-ink px-3 py-2 text-[12px] font-medium text-paper2 transition-colors hover:bg-rust disabled:opacity-50"
            >
              <FolderOpen size={14} />
              {clips.some((clip) => !clip.url) ? "Reconnect / add" : "Import footage"}
            </button>
            <button
              type="button"
              onClick={exportManifest}
              disabled={counts.keepers === 0}
              className="hidden items-center gap-2 rounded-lg bg-muted px-3 py-2 text-[12px] text-moss transition-colors hover:text-ink disabled:opacity-35 sm:flex"
            >
              <Download size={14} />
              Export JSON
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="video/*,.mov,.mp4,.m4v,.webm,.ogv,.ogg"
            multiple
            className="hidden"
            onChange={(event) => {
              void importFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
        </header>

        <div className="grid flex-1 gap-2 lg:min-h-0 lg:grid-cols-[260px_minmax(0,1fr)_320px]">
          <main
            className={`order-1 flex min-h-[520px] flex-col rounded-xl bg-[#080809] p-3 transition-colors lg:col-start-2 lg:row-start-1 lg:min-h-0 ${
              dragging ? "bg-muted" : ""
            }`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (event.currentTarget === event.target) setDragging(false);
            }}
            onDrop={onDrop}
          >
            {probing ? (
              <div
                className="mb-2 rounded-lg bg-card px-3 py-2 font-mono text-[10px] text-moss"
                role="status"
                aria-live="polite"
              >
                Reading metadata · {probing.done}/{probing.total}
                {probing.failed > 0 ? ` · ${probing.failed} unavailable` : ""}
              </div>
            ) : null}

            {selected ? (
              <>
                <div className="flex min-h-[300px] flex-1 items-center justify-center overflow-hidden rounded-lg bg-black">
                  {selected.url ? (
                    <video
                      key={selected.id}
                      src={selected.url}
                      controls
                      playsInline
                      preload="metadata"
                      aria-label={`Preview ${selected.name}`}
                      className="max-h-[calc(100vh-230px)] max-w-full"
                    >
                      This browser cannot play {selected.name}.
                    </video>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={probing !== null}
                      className="flex max-w-md flex-col items-center rounded-xl bg-card px-7 py-8 text-center text-ink transition-colors hover:bg-paper disabled:opacity-50"
                    >
                      <FolderOpen size={24} strokeWidth={1.5} className="text-moss" />
                      <span className="mt-4 font-display text-xl font-semibold tracking-tight">
                        Reconnect {selected.name}
                      </span>
                      <span className="mt-2 text-[12px] leading-relaxed text-moss">
                        Review marks and metadata were restored. Choose the matching original files
                        to resume playback; Celinen never stored the video bytes.
                      </span>
                    </button>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 px-1">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{selected.name}</p>
                    <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-moss">
                      {formatDuration(selected.duration)} · {selected.width || "?"}×
                      {selected.height || "?"} · {formatBytes(selected.size)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    className="grid size-8 place-items-center rounded-lg bg-muted text-moss hover:text-ink"
                    aria-label="Previous clip"
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => step(1)}
                    className="grid size-8 place-items-center rounded-lg bg-muted text-moss hover:text-ink"
                    aria-label="Next clip"
                  >
                    <ChevronRight size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyVerdict([selected.id], "keep", "Kept")}
                    aria-pressed={selected.verdict === "keep"}
                    aria-keyshortcuts="K"
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-medium transition-colors ${
                      selected.verdict === "keep"
                        ? "bg-ink text-paper2"
                        : "bg-muted text-moss hover:text-ink"
                    }`}
                  >
                    <Check size={14} /> Keep · K
                  </button>
                  <button
                    type="button"
                    onClick={() => applyVerdict([selected.id], "reject", "Rejected")}
                    aria-pressed={selected.verdict === "reject"}
                    aria-keyshortcuts="X"
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-medium transition-colors ${
                      selected.verdict === "reject"
                        ? "bg-rust text-paper2"
                        : "bg-muted text-moss hover:text-ink"
                    }`}
                  >
                    <X size={14} /> Reject · X
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={probing !== null}
                className="m-1 flex flex-1 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-input px-6 py-20 text-center transition-colors hover:border-ink/30"
              >
                <VideoIcon size={28} strokeWidth={1.4} className="text-moss" />
                <h1 className="mt-5 font-display text-[clamp(1.8rem,4vw,3rem)] font-semibold tracking-[-0.04em]">
                  Drop footage here.
                </h1>
                <p className="mt-2 max-w-[460px] text-[13px] leading-relaxed text-moss">
                  Celinen reads local metadata and plays formats your browser supports. It does not
                  upload, modify, or transcode originals.
                </p>
                <span className="mt-6 rounded-lg bg-ink px-4 py-2 text-[12px] font-medium text-paper2">
                  Choose video files
                </span>
              </button>
            )}
          </main>

          <aside className="order-2 flex min-h-[320px] flex-col rounded-xl bg-card p-3 lg:col-start-1 lg:row-start-1 lg:min-h-0">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Video filters">
              {FILTERS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setFilter(item.key)}
                  aria-pressed={filter === item.key}
                  className={`rounded-md px-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.1em] transition-colors ${
                    filter === item.key ? "bg-ink text-paper2" : "bg-muted text-moss hover:text-ink"
                  }`}
                >
                  {item.label} {counts[item.key]}
                </button>
              ))}
            </div>

            <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
              {visible.length === 0 ? (
                <p className="rounded-lg bg-muted/60 px-3 py-6 text-center text-[12px] text-moss">
                  {clips.length === 0 ? "No clips loaded" : "No clips in this filter"}
                </p>
              ) : (
                visible.map((clip, index) => (
                  <button
                    key={clip.id}
                    type="button"
                    onClick={() => setSelectedId(clip.id)}
                    aria-current={selected?.id === clip.id ? "true" : undefined}
                    aria-label={`${clip.name}, ${clip.verdict}${clip.url ? "" : ", reconnect source"}`}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors ${
                      selected?.id === clip.id ? "bg-muted text-ink" : "text-moss hover:bg-muted/60"
                    }`}
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-paper">
                      {clip.verdict === "keep" ? (
                        <Check size={14} className="text-ink" />
                      ) : clip.verdict === "reject" ? (
                        <X size={14} className="text-rust" />
                      ) : (
                        <Film size={14} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium text-ink">
                        {index + 1}. {clip.name}
                      </span>
                      <span className="mt-0.5 block font-mono text-[9px] text-moss">
                        {formatDuration(clip.duration)} · {formatBytes(clip.size)}
                        {!clip.url ? " · reconnect" : ""}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>

            {clips.length > 0 ? (
              <button
                type="button"
                onClick={clearReview}
                disabled={probing !== null}
                className="mt-2 self-start rounded-md px-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-moss transition-colors hover:bg-muted hover:text-ink disabled:opacity-35"
              >
                Clear saved review
              </button>
            ) : null}
          </aside>

          <aside className="order-3 flex min-h-[360px] flex-col rounded-xl bg-card p-4 lg:col-start-3 lg:row-start-1 lg:min-h-0">
            <div className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-rust" />
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-moss">
                Local commands
              </p>
            </div>
            <p className="mt-5 text-[13px] leading-relaxed text-moss">
              Commands change review marks and filters only. Every verdict is reversible with U.
            </p>

            <div className="mt-5 space-y-1">
              {QUICK_COMMANDS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => runCommand(item)}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-[12px] text-moss transition-colors hover:bg-muted hover:text-ink"
                >
                  <span className="font-mono text-rust">›</span>
                  {item}
                </button>
              ))}
            </div>

            <div className="mt-auto pt-8">
              <p
                className="min-h-10 rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-relaxed text-moss"
                role="status"
                aria-live="polite"
              >
                {note}
              </p>
              <form onSubmit={submitCommand} className="mt-2 rounded-lg bg-paper p-2">
                <input
                  ref={commandRef}
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder="Keep clips longer than 10 seconds…"
                  aria-label="Run a local video command"
                  className="w-full bg-transparent px-1 py-1.5 text-[12px] outline-none placeholder:text-moss/70"
                />
                <div className="mt-1 flex items-center px-1 font-mono text-[9px] text-moss">
                  Enter to run
                  <button
                    type="submit"
                    className="ml-auto rounded-md bg-ink px-2 py-1 text-paper2 hover:bg-rust"
                  >
                    Run
                  </button>
                </div>
              </form>
            </div>
          </aside>
        </div>

        <div className="flex min-h-7 flex-wrap items-center gap-3 rounded-lg bg-card px-3 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-moss">
          <span className="size-1.5 rounded-full bg-rust" />
          Local metadata + playback
          <span>originals read-only</span>
          <span>review marks saved locally · media never stored</span>
          <span className="ml-auto">K keep · X reject · U undo · ← → move</span>
        </div>
      </div>
    </div>
  );
}
