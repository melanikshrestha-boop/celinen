import { productOperation } from "@/lib/product-lifecycle";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowDownToLine,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Crop,
  Grid2X2,
  ImagePlus,
  Layers2,
  Maximize,
  Plus,
  Redo2,
  Star,
  Undo2,
  WandSparkles,
} from "lucide-react";
import { useWorkbench } from "@/components/workbench/context";
import { useLocation, useNavigate } from "@tanstack/react-router";
import type { DeliveryFocus } from "@/lib/delivery/studio-handoff";
import { DeliveryVersionBoundary } from "./DeliveryVersionBoundary";
import { createShootRepository } from "@/lib/develop/shoot-repository";
import {
  developViewFilter,
  reconcileDevelopView,
  type DevelopViewBaseline,
} from "@/lib/develop/cull-view";
import { getDevelopImportSession } from "@/lib/develop/import-session";
import { useToolLeaveGuard } from "@/components/workbench/useToolLeaveGuard";
import { readStudioSessionSnapshot } from "@/lib/studio/session";
import { ProjectStudioSession } from "@/lib/projects/studio-adapter";
import {
  DEVELOP_ENGINE_LIMITS,
  defaultDevelopSettings,
  cloneDevelopSettings,
  type DevelopSettings,
} from "@/lib/develop/contract";
import { renderDevelop, developEngineStatus } from "@/lib/develop/client";
import { BROWSER_DEVELOP_ENGINE } from "@/lib/develop/browser-render";
import { unsupportedBrowserDevelopEdits } from "@/lib/develop/browser-capabilities";
import { prepareDevelopPreview } from "@/lib/develop/preview";
import {
  asDevelopViewBlob,
  decodeDevelopPreview,
  developPhotoViewBlob,
} from "@/lib/develop/decode-preview";
import { DevelopTutor } from "./DevelopTutor";
import { canReuseNeutralDevelop, isNeutralDevelopRecipe } from "@/lib/develop/neutral";
import { AutoCropDialog } from "./AutoCropDialog";
import { ObjectRemoveDialog } from "./ObjectRemoveDialog";
import type { DevelopImportReport } from "@/lib/develop/import";
import {
  currentRecipe,
  pushHistory,
  undoHistory,
  redoHistory,
  jumpToHistory,
  addSnapshot,
  restoreSnapshot,
  removeSnapshot,
  createDevelopPreset,
  developRecoveryDocuments,
  developPhotosFromStudio,
  developPhotoFromFile,
  reconnectDevelopPhoto,
  mergeDevelopImportCommit,
  type DevelopDocument,
  type DevelopPhoto,
  type DevelopLibrary,
  type DevelopPreset,
  type DevelopImportCommit,
} from "@/lib/develop/store";
import { photoExportFilename, uniquePhotoDisplayName } from "@/lib/develop/photo-management";
import { removalRenderEdge } from "@/lib/develop/object-remove";
import { DevelopPhotoActions } from "./DevelopPhotoActions";
import { PresetExchange } from "./PresetExchange";
import { ReferencePresetDialog } from "./ReferencePresetDialog";
import { DevelopControls, Panel, type DevelopTool } from "./DevelopControls";
import { DevelopViewer } from "./DevelopViewer";
import { DevelopHistogram } from "./DevelopHistogram";
import { DevelopFilmstrip } from "./DevelopFilmstrip";
import { DevelopLibraryGrid } from "./DevelopLibraryGrid";
import {
  suggestDevelopLight,
  suggestDevelopTone,
  type DevelopHistogramData,
} from "@/lib/develop/histogram";
import { analyzeDevelopBlob } from "@/lib/develop/pixel-analysis";
import {
  createDevelopPixelSampleChannel,
  type DevelopPixelSample,
} from "@/lib/develop/pixel-sample";
import { DevelopRecoveryDialog } from "./DevelopRecoveryDialog";
import { DevelopReconnectDialog } from "./DevelopReconnectDialog";
import { useDevelopPointer } from "./useDevelopPointer";
import {
  currentDevelopRender,
  currentDevelopExportProof,
  filteredDevelopSelection,
  developProcessingSource,
  type DevelopExportProof,
  type DevelopExportRequest,
  type DevelopRenderOwner,
} from "./develop-state";
import "./develop.css";

const builtinPresets: { name: string; color: string; patch: Partial<DevelopSettings> }[] = [
  { name: "Original", color: "#bcbcbc", patch: {} },
  {
    name: "Clean daylight",
    color: "#c1bba0",
    patch: { highlights: -20, shadows: 18, vibrance: 12 },
  },
  {
    name: "Warm negative",
    color: "#c69776",
    patch: { temperature: 14, contrast: -8, highlights: -30, shadows: 18, grain: 18, fade: 10 },
  },
  {
    name: "Soft portrait",
    color: "#c7a1a3",
    patch: { texture: -16, clarity: -8, highlights: -20, shadows: 12, vibrance: 8 },
  },
  {
    name: "Cinema dusk",
    color: "#829b9a",
    patch: { temperature: -8, contrast: 14, shadows: 12, saturation: -16, vignette: -18 },
  },
  {
    name: "Classic monochrome",
    color: "#a7a7a7",
    patch: { saturation: -100, contrast: 22, highlights: -18, shadows: 14, grain: 20 },
  },
];
function errorMessage(e: unknown) {
  return e instanceof Error
    ? e.message
    : "The operation could not finish. Your originals are untouched.";
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function useBlobUrl(blob: Blob | null | undefined) {
  const [value, setValue] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!blob) {
      setValue(null);
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    void asDevelopViewBlob(blob)
      .catch(() => null)
      .then((typed) => {
        if (cancelled) return;
        if (!typed) {
          setValue(null);
          return;
        }
        url = URL.createObjectURL(typed);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setValue({ blob, url });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [blob]);
  return value && value.blob === blob ? value.url : null;
}
function SafePreview({ src, className }: { src: string | null; className?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [src]);
  if (!src || broken) return null;
  return <img className={className} src={src} alt="" onError={() => setBroken(true)} />;
}
function Thumb({ photo }: { photo: DevelopPhoto }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    let cancelled = false;
    void developPhotoViewBlob(photo).then((next) => {
      if (!cancelled) setBlob(next);
    });
    return () => {
      cancelled = true;
    };
  }, [photo]);
  const url = useBlobUrl(blob);
  return url ? <SafePreview src={url} /> : null;
}

type DevelopPageProps = {
  scope: string;
  projectId: string | null;
  shootId?: string;
  deliveryFocus?: DeliveryFocus;
};

export function DevelopPage(props: DevelopPageProps) {
  // A saved legacy treatment is not a native history entry. This boundary must
  // stay above all editor, adoption, import, and export hooks.
  return (
    <DeliveryVersionBoundary {...props}>
      <DevelopEditor {...props} />
    </DeliveryVersionBoundary>
  );
}

function DevelopEditor({ scope, projectId, shootId, deliveryFocus }: DevelopPageProps) {
  const workbench = useWorkbench();
  const navigate = useNavigate();
  const href = useLocation({ select: (location) => location.href });
  const pointerBoundary = useDevelopPointer();
  const repository = useMemo(
    () =>
      createShootRepository({
        scope,
        libraryId: projectId ? `project:${projectId}` : `shoot:${shootId ?? "legacy"}`,
      }),
    [scope, projectId, shootId],
  );
  const store = repository.store;
  const importSession = useMemo(
    () =>
      getDevelopImportSession({
        scope,
        libraryId: projectId ? `project:${projectId}` : `shoot:${shootId ?? "legacy"}`,
      }),
    [scope, projectId, shootId],
  );
  const importState = useSyncExternalStore(
    importSession.subscribe,
    importSession.getSnapshot,
    importSession.getSnapshot,
  );
  const [importRowsPage, setImportRowsPage] = useState(0);
  useEffect(() => setImportRowsPage(0), [importState.jobId]);
  const repositoryCleanup = useRef(new Map<typeof repository, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = repositoryCleanup.current;
    const pendingClose = timers.get(repository);
    if (pendingClose) clearTimeout(pendingClose);
    timers.delete(repository);
    return () => {
      timers.set(
        repository,
        setTimeout(() => {
          timers.delete(repository);
          repository.close();
        }, 0),
      );
    };
  }, [repository]);
  const focusedFrame = deliveryFocus?.frameId,
    focusedVersion = deliveryFocus?.versionId,
    focusedHandoff = deliveryFocus?.handoffId;
  const stableDeliveryFocus = useMemo(
    () =>
      focusedFrame && focusedVersion
        ? {
            frameId: focusedFrame,
            versionId: focusedVersion,
            ...(focusedHandoff ? { handoffId: focusedHandoff } : {}),
          }
        : undefined,
    [focusedFrame, focusedVersion, focusedHandoff],
  );
  const [catalogSignal, setCatalogSignal] = useState(0);
  const catalogChanges = useRef(new Map<string, DevelopImportCommit | null>());
  const presetsChanged = useRef(false);
  const importSelection = useRef<{ jobId: string | null; selected: boolean }>({
    jobId: null,
    selected: false,
  });
  const [library, setLibrary] = useState<DevelopLibrary>({
    photos: [],
    documents: {},
    presets: [],
  });
  const reconnectLibrary = useRef(library);
  reconnectLibrary.current = library;
  const docs = useRef<Record<string, DevelopDocument>>({}),
    revisions = useRef<Record<string, number>>({});
  const [selected, setSelected] = useState<string | null>(null),
    selectedRef = useRef<string | null>(null);
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());
  const [leftW, setLeftW] = useState(220);
  const [rightW, setRightW] = useState(300);
  const [filmH, setFilmH] = useState(108);
  const [draft, setDraft] = useState(defaultDevelopSettings),
    draftRef = useRef(draft);
  draftRef.current = draft;
  const [draftDirty, setDraftDirty] = useState(false),
    draftDirtyRef = useRef(false),
    pendingRef = useRef(0);
  const previous = useRef<string | null>(null),
    queue = useRef<Promise<void>>(Promise.resolve()),
    failed = useRef(false);
  const [ready, setReady] = useState(false),
    [loadError, setLoadError] = useState("");
  // Hydration fences the current route before effects run, including delayed
  // callbacks from controls belonging to the previously displayed photo.
  const hydration = useRef({ href, repository, ready: false });
  if (hydration.current.href !== href || hydration.current.repository !== repository)
    hydration.current = { href, repository, ready: false };
  const [saveError, setSaveError] = useState(""),
    [pending, setPending] = useState(0),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(""),
    [engine, setEngine] = useState<boolean | null>(null);
  const [browserOnly, setBrowserOnly] = useState(false);
  const [removalPreviewPending, setRemovalPreviewPending] = useState(false);
  const [importFailures, setImportFailures] = useState<DevelopImportReport["failures"]>([]),
    [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [tool, setTool] = useState<DevelopTool>("edit"),
    [maskId, setMaskId] = useState<string | null>(null);
  const [mode, setMode] = useState<"develop" | "library">("develop"),
    [before, setBefore] = useState(false),
    [compare, setCompare] = useState(false),
    [zoom, setZoom] = useState<"fit" | "100">("fit"),
    [grid, setGrid] = useState(false);
  const [filter, setFilter] = useState("all"),
    [clipboard, setClipboard] = useState<DevelopSettings | null>(null),
    [activePreset, setActivePreset] = useState("Original");
  const viewFilter = useRef(filter);
  viewFilter.current = filter;
  const viewBaseline = useRef<DevelopViewBaseline | null>(null);
  const explicitViewFilter = useRef(false);
  const hydrated = useRef(false);
  const [copiedPhoto, setCopiedPhoto] = useState<{ id: string; revision: number } | null>(null);
  const [renderBlob, setRenderBlob] = useState<Blob | null>(null),
    [neutralBlob, setNeutralBlob] = useState<Blob | null>(null),
    [rendering, setRendering] = useState(false),
    [renderError, setRenderError] = useState("");
  const renderOwner = useRef<DevelopRenderOwner | null>(null),
    neutralOwner = useRef<{ id: string | null; source: Blob; renderKey: string } | null>(null),
    editorProof = useRef<DevelopExportProof | null>(null);
  const [histogram, setHistogram] = useState<DevelopHistogramData | null>(null),
    [histogramPhoto, setHistogramPhoto] = useState<string | null>(null),
    [histogramUrl, setHistogramUrl] = useState<string | null>(null),
    [histogramError, setHistogramError] = useState<{ url: string; message: string } | null>(null),
    [sourceHistogram, setSourceHistogram] = useState<DevelopHistogramData | null>(null),
    [adaptiveLooks, setAdaptiveLooks] = useState(true),
    [clipping, setClipping] = useState({ shadows: false, highlights: false }),
    [dimensions, setDimensions] = useState({ width: 0, height: 0 }),
    [sourceAspect, setSourceAspect] = useState(1.5);
  const onDimensions = useCallback(
    (width: number, height: number) => setDimensions({ width, height }),
    [],
  );
  const onHistogram = useCallback(
    (measured: DevelopHistogramData, measuredUrl: string) => {
      setHistogram(measured);
      setHistogramPhoto(selected);
      setHistogramUrl(measuredUrl);
      setHistogramError(null);
    },
    [selected],
  );
  const onHistogramError = useCallback((message: string, measuredUrl: string) => {
    setHistogramError({ url: measuredUrl, message });
  }, []);
  const [dialog, setDialog] = useState<
      | "preset"
      | "snapshot"
      | "export"
      | "sync"
      | "recovery"
      | "reconnect"
      | "rename"
      | "presets"
      | "reference"
      | "auto-crop"
      | "remove"
      | null
    >(null),
    [name, setName] = useState(""),
    [exportEdge, setExportEdge] = useState<number>(DEVELOP_ENGINE_LIMITS.defaultExportEdge),
    [exportQuality, setExportQuality] = useState(95),
    [exportSourceMode, setExportSourceMode] = useState<"raw" | "preview">("raw");
  const [exportProof, setExportProof] = useState<DevelopExportProof | null>(null),
    [proofZoom, setProofZoom] = useState(false);
  const [syncCrop, setSyncCrop] = useState(false),
    [syncMasks, setSyncMasks] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    folderInput = useRef<HTMLInputElement>(null),
    reconnectInput = useRef<HTMLInputElement>(null),
    reconnectTarget = useRef<DevelopPhoto | null>(null),
    importAbort = useRef<AbortController | null>(null),
    exportAbort = useRef<AbortController | null>(null),
    alive = useRef(true);
  const operationLock = useRef<"import" | "dialog" | null>(null),
    [dialogError, setDialogError] = useState("");
  const importing = importState.phase === "discovering" || importState.phase === "processing";
  const dialogElement = useRef<HTMLElement>(null),
    dialogOpener = useRef<HTMLElement | null>(null);
  const photo = library.photos.find((p) => p.id === selected) ?? null,
    doc = selected ? library.documents[selected] : undefined;
  const source = photo?.sourceBlob?.size
    ? photo.sourceBlob
    : photo?.previewBlob?.size
      ? photo.previewBlob
      : null;
  const availablePhotos = library.photos.filter((p) => p.sourceBlob?.size || p.previewBlob?.size);
  const { source: previewSource, sourceMode: processingMode } = developProcessingSource(
    photo,
    exportSourceMode,
  );
  const renderKey = `${processingMode}:${exportEdge}:${exportQuality}`;
  const exportRequest: DevelopExportRequest | null =
    photo && previewSource
      ? {
          id: photo.id,
          source: previewSource,
          recipeKey: JSON.stringify(cloneDevelopSettings(draft)),
          edge: exportEdge,
          quality: exportQuality,
          sourceMode: processingMode,
        }
      : null;
  const proofReady = currentDevelopExportProof(exportProof, exportRequest);
  const proofUrl = useBlobUrl(proofReady ? exportProof?.blob : null);
  const url = useBlobUrl(
      currentDevelopRender(renderOwner.current, selected, previewSource, tool !== "edit", renderKey)
        ? renderBlob
        : null,
    ),
    beforeUrl = useBlobUrl(
      neutralOwner.current?.id === selected &&
        neutralOwner.current?.source === previewSource &&
        neutralOwner.current?.renderKey === renderKey
        ? neutralBlob
        : null,
    );
  const [photoViewBlob, setPhotoViewBlob] = useState<Blob | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!photo) {
      setPhotoViewBlob(null);
      return;
    }
    void developPhotoViewBlob(photo).then((next) => {
      if (!cancelled) setPhotoViewBlob(next);
    });
    return () => {
      cancelled = true;
    };
  }, [photo, photo?.id, photo?.previewBlob, photo?.sourceBlob, photo?.isRaw]);
  // A committed import is immediately viewable. Its camera preview is explicitly
  // temporary: it is never used as an export proof or a source-space editing surface.
  const quickPreviewBlob = !url && !beforeUrl ? photoViewBlob : null;
  const quickPreviewUrl = useBlobUrl(quickPreviewBlob);
  const viewerUrl = url ?? beforeUrl ?? quickPreviewUrl;
  const viewerBlob = url ? renderBlob : beforeUrl ? neutralBlob : quickPreviewBlob;
  const displayedUrl = before && beforeUrl ? beforeUrl : viewerUrl;
  const pixelSampleChannel = useMemo(createDevelopPixelSampleChannel, []);
  const onPixelSample = useCallback(
    (sample: DevelopPixelSample | null) => {
      pixelSampleChannel.publish(sample && displayedUrl ? { url: displayedUrl, sample } : null);
    },
    [displayedUrl, pixelSampleChannel],
  );
  const currentHistogramError =
    histogramError?.url === displayedUrl ? histogramError.message : null;
  const histogramPending = !currentHistogramError && (rendering || displayedUrl !== histogramUrl);
  const visible = library.photos.filter(
    (p) =>
      filter === "all" ||
      (filter === "picks"
        ? library.documents[p.id]?.metadata.flag === "pick"
        : filter === "rated"
          ? (library.documents[p.id]?.metadata.rating ?? 0) >= 3
          : library.documents[p.id]?.metadata.flag !== "reject"),
  );
  const filmstripPhotos = visible.filter((p) => p.sourceBlob?.size || p.previewBlob?.size);
  const flushLatest = useRef<() => Promise<boolean>>(async () => true);
  const flush = useCallback(() => flushLatest.current(), []);
  useEffect(() => repository.registerFlushParticipant("develop", flush), [repository, flush]);
  useToolLeaveGuard(
    removalPreviewPending
      ? "Your removal preview has not been saved as a copy."
      : busy || pending || draftDirty || saveError
        ? "Develop still has work that has not finished saving."
        : null,
    flush,
  );
  useEffect(() => {
    alive.current = true;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        draftDirtyRef.current ||
        pendingRef.current ||
        failed.current ||
        operationLock.current ||
        importSession.isRunning()
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      alive.current = false;
      importAbort.current?.abort();
      exportAbort.current?.abort();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [importSession]);
  useEffect(() => {
    let cancelled = false;
    const read = () => {
      void developEngineStatus(true).then((s) => {
        if (!cancelled) {
          setEngine(Boolean(s?.ready));
          setBrowserOnly(!s?.ready || s.engine === BROWSER_DEVELOP_ENGINE);
        }
      });
    };
    read();
    window.addEventListener("focus", read);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", read);
    };
  }, []);
  useEffect(() => {
    setDialogError("");
    if (dialog !== "export") {
      setExportProof(null);
      setProofZoom(false);
    }
  }, [dialog]);
  useEffect(() => {
    if (!dialog) return;
    const opener = dialogOpener.current;
    const focusable = () =>
      Array.from(
        dialogElement.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])",
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0 && !element.closest("[inert]"));
    const focusFirst = () => (focusable()[0] ?? dialogElement.current)?.focus();
    const frame = requestAnimationFrame(focusFirst);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!operationLock.current) setDialog(null);
      } else if (event.key === "Tab") {
        const elements = focusable(),
          first = elements[0],
          last = elements.at(-1),
          active = document.activeElement;
        if (!first || !dialogElement.current?.contains(active)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
          if (!first) dialogElement.current?.focus();
        } else if (event.shiftKey && active === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const keepFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialogElement.current?.contains(event.target))
        focusFirst();
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", keepFocus, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", keepFocus, true);
      if (opener?.isConnected && !opener.closest("[inert]")) opener.focus();
    };
  }, [dialog]);

  function openDialog(next: NonNullable<typeof dialog>) {
    if (editsLocked()) return;
    dialogOpener.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDialog(next);
  }
  async function savePortablePreset(preset: DevelopPreset) {
    if (editsLocked()) throw new Error("Wait for the current operation to finish.");
    operationLock.current = "dialog";
    setBusy("Saving preset…");
    try {
      if (!(await flush())) throw new Error("Save the current edits before adding a preset.");
      const saved = await store.savePreset(preset);
      if (alive.current) setLibrary((old) => ({ ...old, presets: [...old.presets, saved] }));
    } finally {
      operationLock.current = null;
      if (alive.current) setBusy("");
    }
  }
  async function copyPhoto() {
    if (editsLocked() || !selectedRef.current) return;
    const id = selectedRef.current;
    operationLock.current = "dialog";
    setBusy("Copying photo…");
    try {
      if (!(await flush())) return;
      const current = docs.current[id];
      if (current && alive.current) {
        setCopiedPhoto({ id, revision: current.revision });
        setNotice(
          "Photo copied in Celinen. Paste creates an independent virtual copy; the original is untouched.",
        );
      }
    } finally {
      operationLock.current = null;
      if (alive.current) setBusy("");
    }
  }
  async function duplicatePhoto(copied = false) {
    if (editsLocked() || !selectedRef.current) return;
    operationLock.current = "dialog";
    setBusy("Creating virtual copy…");
    try {
      if (!(await flush())) return;
      const id = copied ? copiedPhoto?.id : selectedRef.current;
      const revision = copied ? copiedPhoto?.revision : id ? docs.current[id]?.revision : undefined;
      if (!id || revision === undefined) throw new Error("Copy a photo first.");
      const result = await store.createVirtualCopy(id, revision);
      if (alive.current) {
        explicitViewFilter.current = true;
        viewFilter.current = "all";
        setFilter("all");
        adopt(
          {
            ...library,
            photos: [...library.photos, result.photo],
            documents: { ...docs.current, [result.photo.id]: result.document },
          },
          result.photo.id,
        );
        setNotice("Virtual copy created with its own edits and history. Original file untouched.");
      }
    } catch (cause) {
      if (alive.current) setNotice(errorMessage(cause));
    } finally {
      operationLock.current = null;
      if (alive.current) setBusy("");
    }
  }
  async function openRecovery() {
    if (editsLocked()) return;
    dialogOpener.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    operationLock.current = "dialog";
    setBusy("Saving edits…");
    try {
      if (await flush()) {
        if (alive.current) setDialog("recovery");
      }
    } finally {
      operationLock.current = null;
      if (alive.current) setBusy("");
    }
  }

  async function openReconnect() {
    if (editsLocked() || !library.photos.some((entry) => !entry.sourceBlob?.size)) return;
    dialogOpener.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    operationLock.current = "dialog";
    setBusy("Saving edits…");
    try {
      if (await flush()) {
        if (alive.current) setDialog("reconnect");
      }
    } finally {
      operationLock.current = null;
      if (alive.current) setBusy("");
    }
  }

  function markDraftDirty(value: boolean) {
    draftDirtyRef.current = value;
    setDraftDirty(value);
  }
  function editsLocked() {
    return (
      !hydration.current.ready || failed.current || operationLock.current !== null || !alive.current
    );
  }

  const adopt = useCallback((next: DevelopLibrary, choose?: string | null, exact = false) => {
    docs.current = next.documents;
    revisions.current = Object.fromEntries(
      Object.entries(next.documents).map(([id, d]) => [id, d.revision]),
    );
    setLibrary(next);
    const chosen = next.photos.find((p) => p.id === choose);
    const id =
      chosen && (exact || chosen.sourceBlob?.size || chosen.previewBlob?.size)
        ? chosen.id
        : (next.photos.find((p) => p.sourceBlob?.size || p.previewBlob?.size)?.id ??
          chosen?.id ??
          next.photos[0]?.id ??
          null);
    selectedRef.current = id;
    setSelected(id);
    setSelectedSet(new Set(id ? [id] : []));
    const recipe = id ? currentRecipe(next.documents[id]!) : defaultDevelopSettings();
    draftRef.current = recipe;
    setDraft(recipe);
    draftDirtyRef.current = false;
    setDraftDirty(false);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const request = hydration.current;
    const current = () => !cancelled && alive.current && hydration.current === request;
    request.ready = false;
    setReady(false);
    setLoadError("");
    void (async () => {
      try {
        if (!(await repository.flush()))
          throw new Error(
            "The current shoot could not finish saving. Resolve its save error before opening Develop.",
          );
        if (!current()) return;
        let snapshot = await store.loadLibrary();
        if (!current()) return;
        // Read the current shoot once. All writes below go to the separate Develop database.
        const session = projectId
          ? await new ProjectStudioSession(projectId, stableDeliveryFocus).load()
          : await readStudioSessionSnapshot(scope, shootId);
        if (session) {
          try {
            if (current() && session.shots.length) {
              const receipt = await store.addPhotosWithDocuments(
                developPhotosFromStudio(session.shots, snapshot, store.namespace),
              );
              snapshot = mergeDevelopImportCommit(snapshot, receipt);
            }
          } finally {
            for (const shot of session.shots)
              if (shot.previewUrl) URL.revokeObjectURL(shot.previewUrl);
          }
        }
        if (!current()) return;
        const requestedPhoto = new URL(href, "https://workspace.invalid").searchParams.get("photo");
        const focusedId = focusedFrame ? `studio:${focusedFrame}` : requestedPhoto;
        if (focusedId && !snapshot.photos.some((photo) => photo.id === focusedId))
          throw new Error(
            "The requested photo is not in this shoot. No different photo was selected.",
          );
        const manifest = await repository.readManifest();
        if (!current()) return;
        adopt(
          snapshot,
          focusedId ??
            manifest.selectedId ??
            (session?.selectedId ? `studio:${session.selectedId}` : null),
          Boolean(focusedId),
        );
        const projectedFilter = developViewFilter(manifest.filter);
        viewBaseline.current = {
          selectedId: focusedId ? manifest.selectedId : selectedRef.current,
          filter: projectedFilter,
          sourceSelectedId: manifest.selectedId,
          sourceFilter: manifest.filter,
        };
        explicitViewFilter.current = false;
        viewFilter.current = projectedFilter;
        setFilter(projectedFilter);
        hydrated.current = true;
        request.ready = true;
        setReady(true);
      } catch (e) {
        if (current()) setLoadError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    store,
    repository,
    scope,
    projectId,
    shootId,
    stableDeliveryFocus,
    focusedFrame,
    href,
    adopt,
  ]);

  useEffect(() => {
    const unsubscribe = repository.subscribe((change) => {
      if (change.kind === "manifest" || change.kind === "import-job") return;
      if (change.kind === "presets") presetsChanged.current = true;
      else {
        const receipt = change.commit ?? { photos: [], documents: {} };
        for (const id of change.ids) catalogChanges.current.set(id, receipt);
      }
      setCatalogSignal((value) => value + 1);
    });
    void importSession.restore().catch((error) => setNotice(errorMessage(error)));
    return unsubscribe;
  }, [repository, importSession]);
  useEffect(() => {
    setImportFailures(importState.failures);
    if (importState.jobId && !importing)
      setNotice(
        importState.error ??
          `${importState.saved} photos saved · ${importState.failed} failed · ${importState.duplicates} duplicates`,
      );
  }, [importState, importing]);
  useEffect(() => {
    if (!ready || !hydration.current.ready || failed.current || pendingRef.current) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const captured = new Map(catalogChanges.current);
      if (importState.selectedId && !captured.size && !importSelection.current.selected)
        captured.set(importState.selectedId, null);
      void (async () => {
        const ids = [...captured.keys()];
        let incoming = { ...reconnectLibrary.current, documents: { ...docs.current } };
        const receipts = new Set(
          [...captured.values()].filter(
            (value): value is DevelopImportCommit => value !== null && value.photos.length > 0,
          ),
        );
        const receipt: DevelopImportCommit = { photos: [], documents: Object.create(null) };
        // A newer per-photo notification supersedes that entry even when another
        // photo still retains the original multi-photo receipt.
        for (const cached of receipts)
          for (const photo of cached.photos)
            if (captured.get(photo.id) === cached) {
              receipt.photos.push(photo);
              receipt.documents[photo.id] = cached.documents[photo.id]!;
            }
        const received = new Set(receipt.photos.map((photo) => photo.id));
        const missing = ids.filter((id) => !received.has(id));
        if (missing.length) {
          const loaded = await store.readPhotosWithDocuments(missing);
          receipt.photos.push(...loaded.photos);
          Object.assign(receipt.documents, loaded.documents);
        }
        // Targeted rereads must not move earlier imports behind cached entries.
        const order = new Map(ids.map((id, index) => [id, index]));
        receipt.photos.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
        incoming = mergeDevelopImportCommit(incoming, receipt);
        if (presetsChanged.current)
          incoming = { ...incoming, presets: (await store.loadLibrary()).presets };
        return incoming;
      })()
        .then((incoming) => {
          if (
            cancelled ||
            !alive.current ||
            !hydration.current.ready ||
            failed.current ||
            pendingRef.current
          )
            return;
          for (const [id, value] of captured)
            if (catalogChanges.current.get(id) === value) catalogChanges.current.delete(id);
          presetsChanged.current = false;
          const dirtyId = draftDirtyRef.current ? selectedRef.current : null;
          const nextDocs = { ...incoming.documents };
          if (dirtyId && docs.current[dirtyId]) nextDocs[dirtyId] = docs.current[dirtyId]!;
          docs.current = nextDocs;
          for (const [id, document] of Object.entries(nextDocs))
            if (id !== dirtyId) revisions.current[id] = document.revision;
          if (!dirtyId && selectedRef.current && nextDocs[selectedRef.current]) {
            const recipe = currentRecipe(nextDocs[selectedRef.current]!);
            if (JSON.stringify(recipe) !== JSON.stringify(draftRef.current)) {
              draftRef.current = recipe;
              setDraft(recipe);
            }
          }
          setLibrary((old) => ({
            ...incoming,
            documents: nextDocs,
            photos: incoming.photos.map((entry) => {
              const prior = old.photos.find((photo) => photo.id === entry.id);
              // Originals are immutable under an existing ID. Retain their browser handles,
              // but never hide an actual missing-source attachment or changed metadata.
              return prior?.sourceBlob &&
                entry.sourceBlob &&
                prior.sourceDigest === entry.sourceDigest
                ? {
                    ...entry,
                    sourceBlob: prior.sourceBlob,
                    previewBlob: prior.previewBlob ?? entry.previewBlob,
                  }
                : entry;
            }),
          }));
          if (importSelection.current.jobId !== importState.jobId)
            importSelection.current = {
              jobId: importState.jobId,
              selected: !importing && Boolean(selectedRef.current),
            };
          const incomingId = !importSelection.current.selected ? importState.selectedId : null;
          if (incomingId && nextDocs[incomingId] && !dirtyId && !operationLock.current) {
            importSelection.current.selected = true;
            selectedRef.current = incomingId;
            setSelected(incomingId);
            setSelectedSet(new Set([incomingId]));
            const recipe = currentRecipe(nextDocs[incomingId]!);
            draftRef.current = recipe;
            setDraft(recipe);
            explicitViewFilter.current = true;
            viewFilter.current = "all";
            setFilter("all");
            setMode("develop");
          }
        })
        .catch((error) => {
          if (!cancelled) setSaveError(errorMessage(error));
        });
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    catalogSignal,
    ready,
    pending,
    repository,
    store,
    importState.jobId,
    importState.selectedId,
    importing,
  ]);

  function persistBatch(updates: DevelopDocument[], internal = false): Promise<boolean> {
    if (failed.current || (!internal && editsLocked())) return Promise.resolve(false);
    if (!updates.length) return Promise.resolve(true);
    for (const d of updates) docs.current[d.photoId] = d;
    setLibrary((old) => ({ ...old, documents: { ...docs.current } }));
    pendingRef.current++;
    setPending(pendingRef.current);
    queue.current = queue.current
      .then(async () => {
        if (failed.current) return;
        try {
          const saved = await store.saveDocuments(
            updates.map((document) => ({
              document,
              expectedRevision: revisions.current[document.photoId] ?? 0,
            })),
          );
          for (const d of saved) {
            revisions.current[d.photoId] = d.revision;
            docs.current[d.photoId] = { ...docs.current[d.photoId]!, revision: d.revision };
          }
          if (alive.current) setLibrary((old) => ({ ...old, documents: { ...docs.current } }));
        } catch (e) {
          failed.current = true;
          if (alive.current) setSaveError(errorMessage(e));
        }
      })
      .finally(() => {
        pendingRef.current = Math.max(0, pendingRef.current - 1);
        if (alive.current) setPending(pendingRef.current);
      });
    return queue.current.then(() => !failed.current);
  }
  function commitDraft(label = "Adjustment") {
    const id = selectedRef.current,
      existing = id ? docs.current[id] : undefined;
    if (!existing || failed.current) return;
    if (JSON.stringify(currentRecipe(existing)) !== JSON.stringify(draftRef.current))
      void persistBatch([pushHistory(existing, draftRef.current, label)], true);
    markDraftDirty(false);
  }
  flushLatest.current = async () => {
    try {
      commitDraft();
      let tail: Promise<void>;
      do {
        tail = queue.current;
        await tail;
      } while (tail !== queue.current);
      if (!failed.current && hydrated.current && viewBaseline.current) {
        const manifest = await repository.readManifest();
        const photoId = selectedRef.current;
        const next = reconcileDevelopView(
          manifest,
          viewBaseline.current,
          photoId,
          viewFilter.current,
          explicitViewFilter.current,
        );
        if (
          (!photoId || manifest.photoIds.includes(photoId)) &&
          (manifest.selectedId !== next.view.selectedId || manifest.filter !== next.view.filter)
        )
          await repository.saveManifest(next.view, manifest.revision);
        viewBaseline.current = next.baseline;
        explicitViewFilter.current = false;
      }
      return !failed.current;
    } catch (e) {
      failed.current = true;
      if (alive.current) setSaveError(errorMessage(e));
      return false;
    }
  };
  function recoveryFile() {
    const recovered = developRecoveryDocuments(docs.current, selectedRef.current, draftRef.current);
    download(
      new Blob(
        [JSON.stringify({ version: 1, namespace: store.namespace, documents: recovered }, null, 2)],
        { type: "application/json" },
      ),
      "foto-develop-recovery.json",
    );
  }
  function updateDoc(next: DevelopDocument, internal = false): Promise<boolean> {
    if (failed.current || (!internal && editsLocked())) return Promise.resolve(false);
    // A background document belongs to its photo, not whichever photo a later
    // route hydration selected while its save was pending.
    if (next.photoId === selectedRef.current) {
      const recipe = currentRecipe(next);
      draftRef.current = recipe;
      setDraft(recipe);
      markDraftDirty(false);
    }
    return persistBatch([next], internal);
  }
  function change(next: DevelopSettings, label: string, commit = true) {
    if (editsLocked() || !selectedRef.current || !source) return;
    draftRef.current = next;
    setDraft(next);
    setBefore(false);
    setActivePreset("");
    const existing = docs.current[selectedRef.current];
    const dirty = Boolean(
      existing && JSON.stringify(currentRecipe(existing)) !== JSON.stringify(next),
    );
    markDraftDirty(dirty);
    if (commit && existing) {
      if (dirty) void persistBatch([pushHistory(existing, next, label)]);
      markDraftDirty(false);
    }
  }
  function select(id: string, multi = false) {
    if (editsLocked() || !docs.current[id]) return;
    importSelection.current.selected = true;
    const currentId = selectedRef.current;
    commitDraft();
    if (currentId !== id) previous.current = currentId;
    selectedRef.current = id;
    setSelected(id);
    setSelectedSet((old) => (multi ? new Set([...old, id]) : new Set([id])));
    const next = currentRecipe(docs.current[id]!);
    draftRef.current = next;
    setDraft(next);
    setBefore(false);
    setTool("edit");
    setMaskId(null);
    setActivePreset("");
  }
  function changeFilter(next: string) {
    if (editsLocked()) return;
    commitDraft();
    explicitViewFilter.current = true;
    viewFilter.current = next;
    const visibleIds = library.photos
      .filter((p) => {
        if (!p.sourceBlob?.size && !p.previewBlob?.size) return false;
        const metadata = docs.current[p.id]?.metadata;
        return (
          next === "all" ||
          (next === "picks"
            ? metadata?.flag === "pick"
            : next === "rated"
              ? (metadata?.rating ?? 0) >= 3
              : metadata?.flag !== "reject")
        );
      })
      .map((p) => p.id);
    const filtered = filteredDevelopSelection(visibleIds, selectedRef.current, selectedSet);
    setFilter(next);
    setSelectedSet(filtered.selectedIds);
    if (filtered.activeId !== selectedRef.current) {
      previous.current = selectedRef.current;
      selectedRef.current = filtered.activeId;
      setSelected(filtered.activeId);
      const nextRecipe = filtered.activeId
        ? currentRecipe(docs.current[filtered.activeId]!)
        : defaultDevelopSettings();
      draftRef.current = nextRecipe;
      setDraft(nextRecipe);
      setBefore(false);
      setTool("edit");
      setMaskId(null);
      setActivePreset("");
    }
  }
  function changeTool(next: DevelopTool) {
    if (editsLocked() || !source) return;
    if (browserOnly && next === "mask") {
      setNotice("Masking requires the local C++ Develop engine. Your saved edits are unchanged.");
      return;
    }
    commitDraft();
    setTool(next);
    setCompare(false);
    setBefore(false);
    setZoom("fit");
  }
  function applyPreset(preset: { name: string; settings: DevelopSettings }) {
    change(
      { ...cloneDevelopSettings(preset.settings), crop: draft.crop, masks: draft.masks },
      `Preset: ${preset.name}`.slice(0, 100),
    );
    setActivePreset(preset.name);
  }
  const sourceStatsReady =
    sourceHistogram &&
    neutralOwner.current?.id === selected &&
    neutralOwner.current?.source === previewSource &&
    neutralOwner.current?.renderKey === renderKey;
  function autoTone(spread = false) {
    if (!sourceStatsReady || !sourceHistogram) return;
    const suggestion = suggestDevelopLight(sourceHistogram);
    if (!suggestion.applicable) {
      setNotice(suggestion.reason);
      return;
    }
    const patch = {
      exposure: suggestion.exposure,
      highlights: suggestion.highlights,
      shadows: suggestion.shadows,
      whites: suggestion.whites,
      blacks: suggestion.blacks,
    };
    change({ ...draft, ...patch }, "Light");
    if (spread) {
      const targets = visible
        .map((photo) => docs.current[photo.id])
        .filter(
          (document): document is DevelopDocument =>
            Boolean(document) && document.photoId !== selected,
        );
      if (targets.length)
        void persistBatch(
          targets.map((target) =>
            pushHistory(target, { ...currentRecipe(target), ...patch }, "Light"),
          ),
          true,
        );
    }
  }
  function startSplit(
    edge: "left" | "right" | "film",
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    event.preventDefault();
    const origin = edge === "film" ? event.clientY : event.clientX;
    const start = edge === "left" ? leftW : edge === "right" ? rightW : filmH;
    const move = (next: PointerEvent) => {
      const delta = edge === "film" ? origin - next.clientY : next.clientX - origin;
      if (edge === "left") setLeftW(Math.min(420, Math.max(160, start + delta)));
      else if (edge === "right") setRightW(Math.min(480, Math.max(220, start - delta)));
      else setFilmH(Math.min(280, Math.max(72, start + delta)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  function applyBuiltin(preset: (typeof builtinPresets)[number]) {
    if (preset.name === "Original") {
      reset();
      return;
    }
    const settings = { ...defaultDevelopSettings(), ...preset.patch };
    if (adaptiveLooks && sourceStatsReady && sourceHistogram) {
      const suggestion = suggestDevelopTone(sourceHistogram);
      settings.exposure = suggestion.exposure;
      if (settings.grain > 0) settings.grainLuminance = 100;
      setNotice(
        `${preset.name} · ${suggestion.exposure > 0 ? "+" : ""}${suggestion.exposure} EV · ${suggestion.reason}.`,
      );
    }
    applyPreset({ name: preset.name, settings });
  }
  function reset() {
    change(defaultDevelopSettings(), "Reset settings");
    setActivePreset("Original");
  }
  function undo() {
    if (editsLocked() || !source) return;
    commitDraft();
    const id = selectedRef.current;
    if (id && docs.current[id]) void updateDoc(undoHistory(docs.current[id]!));
  }
  function redo() {
    if (editsLocked() || !source) return;
    commitDraft();
    const id = selectedRef.current;
    if (id && docs.current[id]) void updateDoc(redoHistory(docs.current[id]!));
  }

  useEffect(() => {
    // Foreground preview admission is prioritized over background import by the native client.
    setRenderBlob(null);
    setNeutralBlob(null);
    setRenderError("");
    setDimensions({ width: 0, height: 0 });
    setHistogram(null);
    setHistogramUrl(null);
    setHistogramError(null);
    setSourceHistogram(null);
    setClipping({ shadows: false, highlights: false });
    setSourceAspect(photo?.width && photo?.height ? photo.width / photo.height : 1.5);
    if (!previewSource) return;
    const controller = new AbortController();
    void renderDevelop(previewSource, defaultDevelopSettings(), {
      signal: controller.signal,
      sourceMode: processingMode,
      edge: exportEdge,
      quality: exportQuality / 100,
    })
      .then(async (blob) => {
        if (controller.signal.aborted) return;
        neutralOwner.current = { id: selected, source: previewSource, renderKey };
        setNeutralBlob(blob);
        try {
          const analysis = await analyzeDevelopBlob(blob, { signal: controller.signal });
          if (controller.signal.aborted) return;
          setSourceHistogram(analysis.histogram);
          setSourceAspect(analysis.width / analysis.height);
        } catch (error) {
          if (!controller.signal.aborted)
            setNotice(`Source histogram unavailable. ${errorMessage(error)}`);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setRenderError(errorMessage(e));
          setRendering(false);
        }
      });
    return () => controller.abort();
  }, [
    selected,
    previewSource,
    photo?.width,
    photo?.height,
    processingMode,
    exportEdge,
    exportQuality,
    renderKey,
  ]);
  const renderRecipe = useMemo(
    () => (tool === "edit" ? draft : { ...draft, crop: defaultDevelopSettings().crop }),
    [draft, tool],
  );
  const neutralRecipe = useMemo(() => isNeutralDevelopRecipe(renderRecipe), [renderRecipe]);
  useEffect(() => {
    if (!previewSource) {
      setRendering(false);
      return;
    }
    // RAW has one bounded worker lane. Wait for the source histogram render
    // instead of exhausting retries while an expensive neutral demosaic runs.
    if (
      processingMode === "raw" &&
      !(
        neutralBlob &&
        neutralOwner.current?.id === selected &&
        neutralOwner.current?.source === previewSource &&
        neutralOwner.current.renderKey === renderKey
      )
    ) {
      setRendering(true);
      return;
    }
    const controller = new AbortController();
    setRendering(true);
    const canReuseNeutral = () =>
      canReuseNeutralDevelop({
        neutralBlob,
        owner: neutralOwner.current,
        id: selected,
        source: previewSource,
        renderKey,
        neutralRecipe,
      });
    const reusableNeutral = canReuseNeutral();
    const timeout = setTimeout(
      () => {
        const rendered = canReuseNeutral()
          ? Promise.resolve(neutralBlob!)
          : renderDevelop(previewSource, renderRecipe, {
              signal: controller.signal,
              sourceMode: processingMode,
              edge: exportEdge,
              quality: exportQuality / 100,
            });
        void rendered
          .then(async (blob) => {
            const bitmap = await decodeDevelopPreview(blob);
            try {
              if (!controller.signal.aborted) {
                renderOwner.current = {
                  id: selected,
                  source: previewSource,
                  sourceGeometry: tool !== "edit",
                  renderKey,
                };
                if (selected)
                  editorProof.current = {
                    id: selected,
                    source: previewSource,
                    recipeKey: JSON.stringify(cloneDevelopSettings(renderRecipe)),
                    edge: exportEdge,
                    quality: exportQuality,
                    sourceMode: processingMode,
                    blob,
                    width: bitmap.width,
                    height: bitmap.height,
                  };
                setRenderBlob(blob);
                setRenderError("");
                setRendering(false);
              }
            } finally {
              bitmap.close();
            }
          })
          .catch((e) => {
            if (!controller.signal.aborted) {
              // An unsuccessful recipe must not leave an older edit or export
              // proof looking current. Keep the explicitly labeled source preview.
              renderOwner.current = null;
              editorProof.current = null;
              setRenderBlob(null);
              setExportProof(null);
              setRenderError(errorMessage(e));
              setRendering(false);
            }
          });
      },
      reusableNeutral ? 0 : processingMode === "raw" ? 250 : 140,
    );
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [
    selected,
    previewSource,
    renderRecipe,
    neutralRecipe,
    tool,
    processingMode,
    exportEdge,
    exportQuality,
    renderKey,
    neutralBlob,
  ]);

  async function importPhotos(incomingFiles: File[] | DataTransfer) {
    if ((Array.isArray(incomingFiles) && !incomingFiles.length) || failed.current || dialog) return;
    try {
      // Capture drop handles before any await. The account/shoot session owns work beyond this route.
      const job = Array.isArray(incomingFiles)
        ? importSession.startFiles(incomingFiles)
        : importSession.startDrop(incomingFiles);
      setNotice("");
      setImportFailures([]);
      await job;
    } catch (error) {
      if (alive.current) setNotice(errorMessage(error));
    }
  }
  function chooseOriginal() {
    if (!photo || photo.sourceBlob?.size || editsLocked()) return;
    reconnectTarget.current = photo;
    reconnectInput.current?.click();
  }
  async function reconnectOriginal(file: File, target: DevelopPhoto | null) {
    if (!target || target.sourceBlob?.size || !ready || editsLocked()) return;
    operationLock.current = "import";
    setBusy(`Reconnecting ${target.name}`);
    setNotice("");
    setImportFailures([]);
    const controller = new AbortController();
    importAbort.current = controller;
    let attached = false;
    try {
      if (file.name !== (target.sourceFileName || target.name))
        throw new Error(`Choose the original file named ${target.sourceFileName || target.name}.`);
      if (!(await flush()))
        throw new Error("Resolve the save problem before reconnecting an original.");
      controller.signal.throwIfAborted();
      const current = await store.readPhoto(target.id);
      if (
        !current ||
        current.photo.sourceBlob?.size ||
        (current.photo.sourceFileName || current.photo.name) !==
          (target.sourceFileName || target.name) ||
        current.photo.sourceDigest !== target.sourceDigest
      )
        throw new Error("This original changed after the file chooser opened. Choose it again.");
      if (target.isRaw) setBusy(`Reconnecting ${target.name} · developing RAW preview`);
      const preview = await prepareDevelopPreview(file, target, controller.signal);
      controller.signal.throwIfAborted();
      const incoming = await reconnectDevelopPhoto(
        current.photo,
        file,
        preview.previewBlob,
        { width: preview.width, height: preview.height },
        preview.previewOrigin,
      );
      controller.signal.throwIfAborted();
      if (!alive.current) return;
      // Attach media to the existing photo ID. Never create a new document or reset its history.
      const receipt = await store.attachMissingOriginal(incoming, {
        sourceFileName: target.sourceFileName || target.name,
        sourceDigest: target.sourceDigest,
      });
      attached = true;
      if (alive.current && !failed.current)
        adopt(
          mergeDevelopImportCommit({ ...library, documents: docs.current }, receipt),
          target.id,
        );
      const refreshed = await store.loadLibrary();
      if (alive.current && !failed.current) {
        adopt(refreshed, target.id);
        setNotice(
          target.sourceDigest
            ? `Original reconnected · ${target.name}. Edits and history preserved.`
            : `File attached · ${target.name}. Edits preserved; previous file identity was not recorded.`,
        );
      }
    } catch (e) {
      if (alive.current) {
        if (attached) {
          failed.current = true;
          setSaveError(
            `The original was attached, but the library could not reload. ${errorMessage(e)}`,
          );
        } else {
          setNotice(
            controller.signal.aborted
              ? "Reconnect stopped. The saved photo is unchanged."
              : `${errorMessage(e)} The saved photo is unchanged.`,
          );
        }
      }
    } finally {
      operationLock.current = null;
      importAbort.current = null;
      if (alive.current) setBusy("");
    }
  }
  async function previewExport() {
    if (dialog !== "export" || editsLocked() || !exportRequest) return;
    const owner = hydration.current;
    const current = () => alive.current && hydration.current === owner;
    const recipe = cloneDevelopSettings(draftRef.current);
    const request = { ...exportRequest, recipeKey: JSON.stringify(recipe) };
    operationLock.current = "dialog";
    setDialogError("");
    setExportProof(null);
    setBusy("Rendering export preview…");
    const controller = new AbortController();
    exportAbort.current = controller;
    try {
      if (!(await flush()))
        throw new Error("These edits could not be saved. Save a recovery file before continuing.");
      if (!current()) return;
      controller.signal.throwIfAborted();
      const cached = currentDevelopExportProof(editorProof.current, request)
        ? editorProof.current
        : null;
      const blob =
        cached?.blob ??
        (await renderDevelop(request.source, recipe, {
          edge: request.edge,
          quality: request.quality / 100,
          sourceMode: request.sourceMode,
          signal: controller.signal,
        }));
      const bitmap = await decodeDevelopPreview(blob);
      try {
        if (current() && !controller.signal.aborted)
          setExportProof({ ...request, blob, width: bitmap.width, height: bitmap.height });
      } finally {
        bitmap.close();
      }
    } catch (e) {
      if (current())
        setDialogError(controller.signal.aborted ? "Export preview cancelled." : errorMessage(e));
    } finally {
      operationLock.current = null;
      exportAbort.current = null;
      if (alive.current) setBusy("");
    }
  }
  async function confirmDialog() {
    if (!dialog || editsLocked()) return;
    const owner = hydration.current;
    const current = () => alive.current && hydration.current === owner;
    const action = dialog,
      activeId = selectedRef.current,
      recipe = cloneDevelopSettings(draftRef.current);
    operationLock.current = "dialog";
    setDialogError("");
    setBusy(action === "export" ? "Rendering export" : "Saving…");
    const controller = new AbortController();
    exportAbort.current = controller;
    const telemetry =
      action === "export"
        ? productOperation(scope, shootId ?? projectId ?? undefined, "export", { photo_count: 1 })
        : undefined;
    try {
      if (!(await flush()))
        throw new Error("These edits could not be saved. Save a recovery file before continuing.");
      if (!current()) return;
      controller.signal.throwIfAborted();
      if (action === "preset") {
        const preset = await store.savePreset(createDevelopPreset(name, recipe));
        if (current()) {
          setLibrary((old) => ({ ...old, presets: [...old.presets, preset] }));
          setNotice("Preset saved");
        }
      }
      if (action === "rename") {
        if (!photo || activeId !== photo.id)
          throw new Error("Choose the photo again before renaming.");
        const renamed = await store.renamePhoto(photo.id, name, photo.name);
        if (current()) {
          setLibrary((old) => ({
            ...old,
            photos: old.photos.map((item) => (item.id === renamed.id ? renamed : item)),
          }));
          setNotice("Library and export name updated. The original filename is unchanged.");
        }
      }
      if (action === "snapshot") {
        const document = activeId ? docs.current[activeId] : undefined;
        if (!document) throw new Error("Choose a photo first.");
        if (!(await updateDoc(addSnapshot(document, name), true)))
          throw new Error(
            "The snapshot was not saved. Your edits remain available in the recovery file.",
          );
        if (current()) setNotice("Snapshot saved");
      }
      if (action === "sync") {
        if (!activeId) throw new Error("Choose a source photo first.");
        const visibleIds = new Set(visible.map((p) => p.id));
        if (!visibleIds.has(activeId))
          throw new Error("Choose a visible source photo before syncing.");
        const updates = [...selectedSet]
          .filter((id) => id !== activeId && visibleIds.has(id))
          .map((id) => {
            const target = docs.current[id];
            if (!target) throw new Error("A selected photo is no longer available.");
            const targetRecipe = currentRecipe(target);
            return pushHistory(
              target,
              {
                ...cloneDevelopSettings(recipe),
                crop: syncCrop ? recipe.crop : targetRecipe.crop,
                masks: syncMasks ? recipe.masks : targetRecipe.masks,
              },
              `Sync from ${photo?.name ?? "photo"}`.slice(0, 100),
            );
          });
        if (!updates.length) throw new Error("Select at least two photos to sync settings.");
        if (!(await persistBatch(updates, true)))
          throw new Error(
            "Settings were not synced. Your edits remain available in the recovery file.",
          );
        if (current()) setNotice(`Settings synced to ${updates.length} photos`);
      }
      if (action === "export") {
        if (!photo || !exportRequest) throw new Error("Choose a photo with a source first.");
        const request = { ...exportRequest, recipeKey: JSON.stringify(recipe) };
        const { sourceMode } = request;
        // Download the exact proof bytes when all inputs still match. A changed
        // source, recipe, size or quality can never reuse a stale preview.
        const blob =
          currentDevelopExportProof(exportProof, request) && exportProof
            ? exportProof.blob
            : currentDevelopExportProof(editorProof.current, request) && editorProof.current
              ? editorProof.current.blob
              : await renderDevelop(request.source, recipe, {
                  edge: request.edge,
                  quality: request.quality / 100,
                  signal: controller.signal,
                  sourceMode,
                });
        const bitmap = await decodeDevelopPreview(blob);
        const size = `${bitmap.width} × ${bitmap.height}`;
        bitmap.close();
        if (current() && !controller.signal.aborted) {
          download(blob, photoExportFilename(photo.name));
          telemetry?.finish();
          setNotice(
            `Exported ${size} JPEG${photo.isRaw ? (sourceMode === "raw" ? " from sensor RAW" : photo.previewOrigin === "raw-demosaic" ? " from a saved sensor-derived preview" : " from RAW preview") : ""}`,
          );
        }
      }
      if (current()) {
        setDialog(null);
        setName("");
      }
    } catch (e) {
      if (current()) setDialogError(errorMessage(e));
    } finally {
      operationLock.current = null;
      exportAbort.current = null;
      if (alive.current) setBusy("");
    }
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        dialog ||
        editsLocked() ||
        (e.target instanceof HTMLElement &&
          e.target.closest("input,textarea,select,[contenteditable=true],[role=dialog]"))
      )
        return;
      const mod = e.metaKey || e.ctrlKey,
        key = e.key.toLowerCase();
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod) return;
      if (key === "\\" && source) {
        e.preventDefault();
        setBefore((v) => !v);
      }
      if (key === "g") setMode("library");
      if (key === "d") setMode("develop");
      if (key === "r") changeTool(tool === "crop" ? "edit" : "crop");
      if (key === "y" && source) {
        setCompare((v) => !v);
        setTool("edit");
        setBefore(false);
      }
      if (key === "z" && source) {
        e.preventDefault();
        setZoom((v) => (v === "fit" ? "100" : "fit"));
      }
      if (key === "j" && source) {
        e.preventDefault();
        setClipping((current) => {
          const enabled = !(current.shadows || current.highlights);
          return { shadows: enabled, highlights: enabled };
        });
      }
      if (key === "arrowleft" || key === "arrowright") {
        e.preventDefault();
        const navigable = mode === "library" ? visible : filmstripPhotos;
        const i = navigable.findIndex((p) => p.id === selectedRef.current),
          p = navigable[i + (key === "arrowleft" ? -1 : 1)];
        if (p) select(p.id);
      }
      const id = selectedRef.current,
        current = id ? docs.current[id] : null;
      if (current && /^[0-5]$/.test(key))
        persistBatch([{ ...current, metadata: { ...current.metadata, rating: Number(key) } }]);
      if (current && (key === "p" || key === "u" || (key === "x" && tool !== "crop")))
        persistBatch([
          {
            ...current,
            metadata: {
              ...current.metadata,
              flag: key === "p" ? "pick" : key === "x" ? "reject" : null,
            },
          },
        ]);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  if (loadError)
    return (
      <div className="foto-develop develop-loading">
        <h1>Develop</h1>
        <p role="alert">{loadError}</p>
        <button onClick={() => window.location.reload()}>Retry opening</button>
      </div>
    );
  if (!ready || !hydration.current.ready)
    return <div className="foto-develop develop-loading">Opening Develop…</div>;
  return (
    <section
      {...pointerBoundary}
      className={`foto-develop${dragging ? " is-dragging" : ""}`}
      aria-label="Celinen Develop"
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        dragDepth.current++;
        if (!busy && !dialog) setDragging(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = busy || dialog ? "none" : "copy";
      }}
      onDragLeave={(event) => {
        event.stopPropagation();
        if (--dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        dragDepth.current = 0;
        setDragging(false);
        void importPhotos(event.dataTransfer);
      }}
    >
      {dragging && <div className="develop-drop-overlay">Drop photos or folders to import</div>}
      <input
        ref={input}
        type="file"
        hidden
        multiple
        aria-label="Import photos"
        accept="image/*,.arw,.nef,.cr2,.cr3,.dng,.raf,.orf,.rw2,.pef,.raw"
        onChange={(e) => {
          void importPhotos(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <input
        ref={(element) => {
          folderInput.current = element;
          element?.setAttribute("webkitdirectory", "");
        }}
        type="file"
        hidden
        multiple
        aria-label="Import photo folder"
        onChange={(event) => {
          void importPhotos(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <input
        ref={reconnectInput}
        type="file"
        hidden
        aria-label="Reconnect original file"
        accept="image/*,.arw,.nef,.cr2,.cr3,.dng,.raf,.orf,.rw2,.pef,.raw"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const target = reconnectTarget.current ?? photo;
          reconnectTarget.current = null;
          e.target.value = "";
          if (file) void reconnectOriginal(file, target);
        }}
      />
      <header className="develop-topbar" inert={Boolean(dialog)}>
        <div className="develop-brand">
          <span className="develop-brand-mark">f.</span>
          <span>
            Celinen <small>Photo Lab</small>
          </span>
        </div>
        <div className="develop-top-actions">
          <button
            onClick={() => {
              if (workbench) void workbench.showStudio();
              else void navigate({ to: "/dashboard" });
            }}
          >
            Cull
          </button>
          {library.photos.length > 0 && (
            <div className="develop-segment">
              <button aria-pressed={mode === "library"} onClick={() => setMode("library")}>
                Library
              </button>
              <button aria-pressed={mode === "develop"} onClick={() => setMode("develop")}>
                Develop
              </button>
            </div>
          )}
          <button
            disabled={!!busy || !!saveError || importing}
            onClick={() => input.current?.click()}
          >
            <Plus size={14} />
            Import
          </button>
          {library.photos.some((entry) => !entry.sourceBlob?.size) && (
            <button disabled={!!busy || !!saveError} onClick={() => void openReconnect()}>
              Reconnect
            </button>
          )}
          {availablePhotos.length > 0 && (
            <button
              disabled={!url || !!busy || !!saveError || rendering || !!renderError}
              onClick={() => openDialog("export")}
            >
              <ArrowDownToLine size={14} />
              Export
            </button>
          )}
        </div>
      </header>
      {(saveError || notice || busy || importing || engine === false) && (
        <div className={`develop-status ${saveError ? "is-error" : ""}`} role="status">
          <span>
            {saveError ||
              busy ||
              (importing
                ? `${importState.found} found · ${importState.previewReady} previews · ${importState.saved} saved · ${importState.failed} failed`
                : "") ||
              notice ||
              (engine === false ? "The image engine on this computer is not running." : "")}
          </span>
          {saveError ? (
            <button onClick={recoveryFile}>Save recovery file</button>
          ) : importing ? (
            <button onClick={() => importSession.cancel()}>Stop import</button>
          ) : busy.startsWith("Reconnecting") && dialog !== "reconnect" ? (
            <button onClick={() => importAbort.current?.abort()}>Stop reconnect</button>
          ) : notice ? (
            <button aria-label="Dismiss message" onClick={() => setNotice("")}>
              ×
            </button>
          ) : null}
        </div>
      )}
      {importState.jobId && importState.rows.length > 0 && (
        <details className="develop-import-report">
          <summary>
            Import: {importState.found} found · {importState.saved} saved · {importState.analyzed}{" "}
            analyzed
          </summary>
          <ul>
            {importState.rows.slice(importRowsPage * 40, (importRowsPage + 1) * 40).map((row) => (
              <li key={row.id}>
                {row.photoId && library.documents[row.photoId] ? (
                  <button onClick={() => select(row.photoId!)}>{row.name}</button>
                ) : (
                  <strong>{row.name}</strong>
                )}
                <span>
                  {row.status.replaceAll("-", " ")}
                  {row.error ? ` · ${row.error}` : ""}
                </span>
              </li>
            ))}
          </ul>
          {importState.rows.length > 40 && (
            <div>
              <button
                disabled={!importRowsPage}
                onClick={() => setImportRowsPage((page) => page - 1)}
              >
                Previous files
              </button>
              <span>
                Page {importRowsPage + 1} of {Math.ceil(importState.rows.length / 40)}
              </span>
              <button
                disabled={(importRowsPage + 1) * 40 >= importState.rows.length}
                onClick={() => setImportRowsPage((page) => page + 1)}
              >
                Next files
              </button>
            </div>
          )}
        </details>
      )}
      {importFailures.length > 0 && (
        <details className="develop-import-report">
          <summary>
            {importFailures.length} import {importFailures.length === 1 ? "issue" : "issues"} · view
            details
          </summary>
          <ul>
            {importFailures.map((failure, index) => (
              <li key={index}>
                <strong>{failure.fileName}</strong>
                <span>{failure.message}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div
        className={`develop-workspace${!source ? " is-without-photo" : ""}`}
        inert={Boolean(busy || dialog)}
        style={
          {
            "--dv-left": `${leftW}px`,
            "--dv-right": `${rightW}px`,
          } as CSSProperties
        }
      >
        {source && (
          <aside className="develop-left">
            <Panel title="Navigator" open>
              <div className="develop-navigator">
                <SafePreview src={displayedUrl} />
              </div>
              <div className="develop-inline">
                <button
                  disabled={!source}
                  aria-pressed={zoom === "fit"}
                  onClick={() => setZoom("fit")}
                >
                  Fit
                </button>
                <button
                  disabled={!source}
                  aria-pressed={zoom === "100"}
                  onClick={() => setZoom("100")}
                >
                  100% preview
                </button>
              </div>
            </Panel>
            <Panel title="Presets" open>
              <label
                className="develop-adaptive-toggle"
                title="Normal-key starting point from the original sRGB preview, with a highlight guard. Does not change white balance or guess artistic intent."
              >
                <input
                  type="checkbox"
                  checked={adaptiveLooks}
                  onChange={(e) => setAdaptiveLooks(e.target.checked)}
                />
                Adapt built-in looks to light
              </label>
              <div className="develop-preset-list">
                {builtinPresets.map((p) => (
                  <button
                    key={p.name}
                    disabled={
                      !source ||
                      !!saveError ||
                      !!busy ||
                      (browserOnly &&
                        unsupportedBrowserDevelopEdits({ ...defaultDevelopSettings(), ...p.patch })
                          .length > 0) ||
                      (p.name !== "Original" && adaptiveLooks && !sourceStatsReady)
                    }
                    aria-pressed={activePreset === p.name}
                    onClick={() => applyBuiltin(p)}
                  >
                    <span style={{ background: p.color }} />
                    {p.name}
                    {activePreset === p.name && <Check size={12} />}
                  </button>
                ))}
                {library.presets.map((p) => (
                  <button
                    key={p.id}
                    disabled={
                      !source ||
                      !!saveError ||
                      (browserOnly && unsupportedBrowserDevelopEdits(p.settings).length > 0)
                    }
                    aria-pressed={activePreset === p.name}
                    onClick={() => applyPreset(p)}
                  >
                    <span />
                    {p.name}
                  </button>
                ))}
              </div>
              <button
                className="develop-wide develop-quiet"
                disabled={!photo}
                onClick={() => {
                  setName("");
                  openDialog("preset");
                }}
              >
                <Plus size={12} />
                Create preset
              </button>
              <button className="develop-wide develop-quiet" onClick={() => openDialog("presets")}>
                Import / export presets…
              </button>
              <button
                className="develop-wide develop-quiet"
                disabled={!photo || !!saveError}
                onClick={() => openDialog("reference")}
              >
                Match edited reference…
              </button>
            </Panel>
            <Panel title="Snapshots">
              <button
                className="develop-wide develop-quiet"
                disabled={!photo || !!saveError}
                onClick={() => {
                  setName("");
                  openDialog("snapshot");
                }}
              >
                <Plus size={12} />
                New snapshot
              </button>
              {doc?.snapshots.map((s) => (
                <div className="develop-mask-item" key={s.id}>
                  <button
                    disabled={!source || !!saveError}
                    onClick={() => updateDoc(restoreSnapshot(doc, s.id))}
                  >
                    {s.name}
                  </button>
                  <button
                    aria-label={`Remove snapshot ${s.name}`}
                    onClick={() => updateDoc(removeSnapshot(doc, s.id))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </Panel>
            <Panel title="History" open>
              <div className="develop-history">
                {doc?.history
                  .map((h, i) => ({ h, i }))
                  .reverse()
                  .map(({ h, i }) => (
                    <button
                      key={h.id}
                      disabled={!source || !!saveError}
                      aria-pressed={doc.cursor === i}
                      onClick={() => updateDoc(jumpToHistory(doc, i))}
                    >
                      {h.label}
                    </button>
                  ))}
              </div>
            </Panel>
            <Panel title="Recovery">
              <button
                className="develop-wide develop-quiet"
                disabled={!library.photos.length}
                onClick={recoveryFile}
              >
                Save recovery file
              </button>
              <button
                className="develop-wide develop-quiet"
                disabled={!!saveError || !!busy}
                onClick={() => void openRecovery()}
              >
                Import recovery file
              </button>
            </Panel>
            <div className="develop-left-footer">
              <button
                disabled={!photo}
                onClick={() => {
                  setClipboard(cloneDevelopSettings(draft));
                  setNotice("Settings copied");
                }}
              >
                <Copy size={12} />
                Copy
              </button>
              <button
                disabled={!clipboard || !source || !!saveError}
                onClick={() =>
                  clipboard &&
                  change(
                    { ...cloneDevelopSettings(clipboard), crop: draft.crop, masks: draft.masks },
                    "Paste settings",
                  )
                }
              >
                Paste
              </button>
            </div>
          </aside>
        )}
        {source ? (
          <button
            type="button"
            className="develop-split"
            aria-label="Resize left panel"
            onPointerDown={(event) => startSplit("left", event)}
          />
        ) : null}
        <main className="develop-center">
          {availablePhotos.length > 0 &&
          !(mode === "library" ? visible.length : filmstripPhotos.length) ? (
            <div className="develop-empty">
              <h1>No photos match this filter</h1>
              <button onClick={() => changeFilter("all")}>Show all photos</button>
            </div>
          ) : !source && (mode === "develop" || !library.photos.length) ? (
            <div className="develop-empty">
              <ImagePlus size={34} strokeWidth={1} />
              <h1>Bring your photos into Develop</h1>
              <p>Drop photos or a folder here to get started.</p>
              <div className="develop-import-actions">
                <button
                  className="develop-primary"
                  disabled={!!busy || !!saveError}
                  onClick={() => input.current?.click()}
                >
                  Import photos
                </button>
                <button
                  disabled={!!busy || !!saveError}
                  onClick={() => folderInput.current?.click()}
                >
                  Choose folder
                </button>
              </div>
              <small>JPEG, PNG, TIFF, HEIC and supported RAW files.</small>
              {library.photos.length > 0 && (
                <details className="develop-missing-files">
                  <summary>
                    {library.photos.length - availablePhotos.length} saved photos need their
                    originals
                  </summary>
                  <p>Your edits are saved. Reconnect the original file to resume.</p>
                  <button disabled={!!busy || !!saveError} onClick={() => void openReconnect()}>
                    Reconnect a folder
                  </button>
                  <ul>
                    {library.photos
                      .filter((p) => !p.sourceBlob?.size && !p.previewBlob?.size)
                      .slice(0, 20)
                      .map((p) => (
                        <li key={p.id}>
                          <span>{p.name}</span>
                          <button
                            onClick={() => {
                              reconnectTarget.current = p;
                              reconnectInput.current?.click();
                            }}
                          >
                            Reconnect original
                          </button>
                        </li>
                      ))}
                  </ul>
                  {library.photos.length - availablePhotos.length > 20 && (
                    <small>
                      Showing 20. Use Reconnect a folder to review all missing originals.
                    </small>
                  )}
                  <small>
                    Older entries without a fingerprint are matched by filename only. Choose the
                    exact original.
                  </small>
                  <button onClick={recoveryFile}>Save edit recovery file</button>
                  <button onClick={() => void openRecovery()} disabled={!!saveError}>
                    Import recovery file
                  </button>
                </details>
              )}
            </div>
          ) : mode === "library" ? (
            <DevelopLibraryGrid
              photos={visible}
              documents={library.documents}
              selected={selected}
              selectedIds={selectedSet}
              onSelect={select}
              onOpen={(id) => {
                if (editsLocked()) return;
                select(id);
                setMode("develop");
              }}
            />
          ) : (
            <>
              <DevelopTutor
                settings={draft}
                onChange={change}
                enabled={Boolean(source && draft)}
                photoId={selected}
                advanced={!browserOnly}
              />
              <div className="develop-view-toolbar">
                <div>
                  <DevelopPhotoActions
                    disabled={!photo || !!saveError || !!busy}
                    canPaste={!!copiedPhoto}
                    rename={() => {
                      setName(photo?.name ?? "");
                      openDialog("rename");
                    }}
                    duplicate={() => void duplicatePhoto()}
                    copy={() => void copyPhoto()}
                    paste={() => void duplicatePhoto(true)}
                  />
                  <button
                    aria-label="Undo"
                    disabled={!source || !doc || doc.cursor === 0 || !!saveError}
                    onClick={undo}
                  >
                    <Undo2 size={15} />
                  </button>
                  <button
                    aria-label="Redo"
                    disabled={
                      !source || !doc || doc.cursor === doc.history.length - 1 || !!saveError
                    }
                    onClick={redo}
                  >
                    <Redo2 size={15} />
                  </button>
                </div>
                <span>
                  {tool === "crop"
                    ? "Crop · drag a rectangle on the source"
                    : tool === "mask"
                      ? "Mask · drag to position on the source"
                      : photo?.name}
                </span>
                <div>
                  <button
                    aria-label="Remove Object"
                    title="Remove Object"
                    disabled={!url || !!busy || !!saveError || rendering || !!renderError}
                    onClick={() => openDialog("remove")}
                  >
                    <WandSparkles size={15} />
                  </button>
                  <button
                    aria-label="Crop tool"
                    disabled={!source}
                    aria-pressed={tool === "crop"}
                    onClick={() => changeTool(tool === "crop" ? "edit" : "crop")}
                  >
                    <Crop size={15} />
                  </button>
                  <button
                    aria-label="Mask tool"
                    disabled={!source}
                    aria-pressed={tool === "mask"}
                    onClick={() => changeTool(tool === "mask" ? "edit" : "mask")}
                  >
                    <Layers2 size={15} />
                  </button>
                  <button
                    aria-label="Composition grid"
                    disabled={!source}
                    aria-pressed={grid}
                    onClick={() => setGrid((v) => !v)}
                  >
                    <Grid2X2 size={15} />
                  </button>
                </div>
              </div>
              {photo && !source ? (
                <div className="develop-empty" role="status">
                  <ImagePlus size={28} strokeWidth={1} />
                  <h1>Original file needed</h1>
                  <p>{photo.sourceFileName || photo.name}</p>
                  <small>
                    This saved photo has no preview on this device.
                    <br />
                    Reconnect its original to continue. Your edits and history stay intact.
                  </small>
                  {!photo.sourceDigest && (
                    <small>
                      No file fingerprint was saved. Choose the exact original; only its filename
                      can be checked.
                    </small>
                  )}
                  <button
                    className="develop-primary"
                    disabled={!!busy || !!saveError || engine === false}
                    onClick={chooseOriginal}
                  >
                    Reconnect original
                  </button>
                </div>
              ) : (
                <DevelopViewer
                  key={selected ?? "empty"}
                  url={viewerUrl}
                  blob={viewerBlob}
                  emptyLabel={
                    photo
                      ? renderError
                        ? "Preview unavailable."
                        : "Preparing preview…"
                      : "Choose a photograph to begin."
                  }
                  beforeUrl={beforeUrl}
                  beforeBlob={neutralBlob}
                  before={before}
                  compare={compare}
                  zoom={zoom}
                  grid={Boolean(url || beforeUrl) && grid}
                  tool={url || beforeUrl ? tool : "edit"}
                  settings={draft}
                  change={change}
                  maskId={maskId}
                  onDimensions={onDimensions}
                  onHistogram={onHistogram}
                  onHistogramError={onHistogramError}
                  onPixelSample={onPixelSample}
                  knownHistogram={
                    (before && beforeUrl) || viewerBlob === neutralBlob ? sourceHistogram : null
                  }
                  clipping={clipping}
                />
              )}
              {renderError && !displayedUrl && (
                <p className="develop-render-error" role="alert">
                  {renderError}
                </p>
              )}
              {photo && !photo.sourceBlob && source && (
                <div className="develop-bottom-toolbar">
                  <span>
                    Preview only · Choose the original {photo.sourceFileName || photo.name}.
                    {!photo.sourceDigest &&
                      " No fingerprint was saved; only the filename can be checked."}
                  </span>
                  <button onClick={chooseOriginal} disabled={!!saveError || engine === false}>
                    Reconnect original
                  </button>
                </div>
              )}
              <div className="develop-bottom-toolbar">
                <div>
                  <button
                    aria-pressed={before}
                    disabled={!beforeUrl}
                    onClick={() => {
                      setBefore((v) => !v);
                      setTool("edit");
                      setCompare(false);
                    }}
                  >
                    Before
                  </button>
                  <button
                    aria-label="Compare before and after"
                    aria-pressed={compare}
                    disabled={!beforeUrl || !url || !!renderError}
                    onClick={() => {
                      setCompare((v) => !v);
                      setBefore(false);
                      setTool("edit");
                    }}
                  >
                    <Layers2 size={14} />
                  </button>
                </div>
                <span>
                  {renderError
                    ? "Adjustments unavailable · Showing source preview"
                    : quickPreviewUrl
                      ? importing
                        ? "Import preview"
                        : "Import preview · Preparing full-quality image…"
                      : rendering
                        ? "Rendering…"
                        : dimensions.width
                          ? `${dimensions.width} × ${dimensions.height}`
                          : ""}
                  {!renderError && !rendering && url && source && photo?.isRaw
                    ? processingMode === "raw"
                      ? " · Sensor RAW · export-matched"
                      : photo.previewOrigin === "raw-demosaic"
                        ? " · Sensor-derived preview"
                        : " · RAW preview"
                    : source && !photo?.sourceAvailable
                      ? " · Preview source"
                      : ""}
                </span>
                <button
                  disabled={!source}
                  onClick={() => setZoom((v) => (v === "fit" ? "100" : "fit"))}
                >
                  <Maximize size={12} />
                  {zoom === "fit" ? "Fit" : "100% preview"}
                </button>
              </div>
            </>
          )}
        </main>
        {source ? (
          <button
            type="button"
            className="develop-split"
            aria-label="Resize right panel"
            onPointerDown={(event) => startSplit("right", event)}
          />
        ) : null}
        {source && (
          <aside className="develop-right">
            <div className="develop-histogram-wrap">
              <div className="develop-inline">
                <span>Histogram</span>
                <button
                  type="button"
                  disabled={!sourceStatsReady || !!saveError || !!busy}
                  onClick={() => autoTone(false)}
                >
                  Light
                </button>
                <button
                  type="button"
                  disabled={!sourceStatsReady || !!saveError || !!busy || visible.length < 2}
                  onClick={() => autoTone(true)}
                >
                  All
                </button>
              </div>
              <DevelopHistogram
                key={selected}
                histogram={histogramPhoto === selected ? histogram : null}
                value={draft}
                change={change}
                disabled={!url || !!saveError || !!busy || before || tool !== "edit"}
                clipping={clipping}
                onClipping={setClipping}
                pending={histogramPending}
                sampleChannel={pixelSampleChannel}
                sampleUrl={displayedUrl}
                sourceLabel={
                  quickPreviewUrl
                    ? "Import preview"
                    : before
                      ? "Before adjustments"
                      : !url && beforeUrl
                        ? "Original preview · Adjustments unavailable"
                        : "Rendered preview"
                }
              />
              {currentHistogramError && (
                <p className="develop-hint" role="status">
                  Histogram unavailable. {currentHistogramError}
                </p>
              )}
              <div className="develop-inline">
                <span>
                  {!source
                    ? "No image source"
                    : quickPreviewUrl
                      ? "Import preview · sRGB"
                      : photo?.isRaw
                        ? processingMode === "raw"
                          ? "Sensor RAW · sRGB"
                          : photo.previewOrigin === "raw-demosaic"
                            ? "Sensor preview · sRGB"
                            : "RAW preview · sRGB"
                        : "sRGB"}
                </span>
                <span>
                  {saveError
                    ? "Not saved"
                    : draftDirty
                      ? "Unsaved adjustment"
                      : pending
                        ? "Saving…"
                        : "Local edits"}
                </span>
              </div>
            </div>
            {browserOnly && (
              <p className="develop-hint" role="status">
                Browser Develop supports basic tone, white balance and crop. Advanced edits need the
                local C++ engine; originals and saved recipes remain intact.
              </p>
            )}
            <fieldset disabled={!source || !!saveError || !!busy}>
              <DevelopControls
                photoId={selected ?? "empty"}
                value={draft}
                change={change}
                tool={tool}
                onTool={changeTool}
                maskId={maskId}
                onMask={setMaskId}
                sourceAspect={sourceAspect}
                onSuggestCrop={() => openDialog("auto-crop")}
                browserOnly={browserOnly}
              />
            </fieldset>
            <div className="develop-right-footer">
              <button
                disabled={!source || !!saveError || (selectedSet.size < 2 && !previous.current)}
                onClick={() => {
                  if (selectedSet.size > 1) {
                    openDialog("sync");
                    return;
                  }
                  const p = previous.current ? docs.current[previous.current] : null;
                  if (p)
                    change(
                      { ...currentRecipe(p), crop: draft.crop, masks: draft.masks },
                      "Previous settings",
                    );
                }}
              >
                {selectedSet.size > 1 ? "Sync…" : "Previous"}
              </button>
              <button disabled={!source || !!saveError} onClick={reset}>
                Reset
              </button>
            </div>
          </aside>
        )}
      </div>
      {availablePhotos.length > 0 && (
        <footer
          className="develop-filmstrip"
          inert={Boolean(busy || dialog)}
          style={{ height: filmH }}
        >
          <button
            type="button"
            className="develop-split develop-split--film"
            aria-label="Resize filmstrip"
            onPointerDown={(event) => startSplit("film", event)}
          />
          <div className="develop-filmstrip-bar">
            <div>
              <button
                disabled={!!busy || !!saveError || engine === false}
                onClick={() => input.current?.click()}
              >
                <Plus size={13} />
                Import
              </button>
              <button
                aria-label="Previous photograph"
                disabled={!selected || filmstripPhotos.findIndex((p) => p.id === selected) < 1}
                onClick={() => {
                  const i = filmstripPhotos.findIndex((p) => p.id === selected);
                  if (filmstripPhotos[i - 1]) select(filmstripPhotos[i - 1]!.id);
                }}
              >
                <ChevronLeft size={15} />
              </button>
              <button
                aria-label="Next photograph"
                disabled={
                  !selected ||
                  filmstripPhotos.findIndex((p) => p.id === selected) >= filmstripPhotos.length - 1
                }
                onClick={() => {
                  const i = filmstripPhotos.findIndex((p) => p.id === selected);
                  if (filmstripPhotos[i + 1]) select(filmstripPhotos[i + 1]!.id);
                }}
              >
                <ChevronRight size={15} />
              </button>
              <span>
                {availablePhotos.length} available · {selectedSet.size} selected
              </span>
            </div>
            <div>
              {doc && (
                <div className="develop-rating" role="group" aria-label="Photo rating">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      disabled={!!saveError}
                      aria-label={`Rate ${n} stars`}
                      aria-pressed={doc.metadata.rating >= n}
                      onClick={() =>
                        persistBatch([
                          {
                            ...doc,
                            metadata: {
                              ...doc.metadata,
                              rating: doc.metadata.rating === n ? 0 : n,
                            },
                          },
                        ])
                      }
                    >
                      <Star size={11} fill={doc.metadata.rating >= n ? "currentColor" : "none"} />
                    </button>
                  ))}
                </div>
              )}
              <select
                aria-label="Filter photos"
                value={filter}
                onChange={(e) => changeFilter(e.target.value)}
              >
                <option value="all">All photos</option>
                <option value="picks">Picks</option>
                <option value="rated">3 stars and up</option>
                <option value="not-rejected">Not rejected</option>
              </select>
              <span className="develop-save-status">
                {saveError
                  ? "Save needs attention"
                  : draftDirty
                    ? "Unsaved adjustment"
                    : pending
                      ? "Saving…"
                      : "All edits saved"}
              </span>
            </div>
          </div>
          <DevelopFilmstrip
            photos={filmstripPhotos}
            documents={library.documents}
            selected={selected}
            selectedIds={selectedSet}
            onSelect={select}
          />
        </footer>
      )}
      {dialog && (
        <div
          className="develop-modal-backdrop"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !busy) setDialog(null);
          }}
        >
          <section
            ref={dialogElement}
            className={`develop-dialog${dialog === "export" || dialog === "reference" || dialog === "auto-crop" || dialog === "remove" ? " develop-export-dialog" : dialog === "recovery" ? " develop-recovery-dialog" : dialog === "reconnect" ? " develop-reconnect-dialog" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="develop-dialog-title"
            tabIndex={-1}
          >
            <h2 id="develop-dialog-title">
              {dialog === "reconnect"
                ? "Reconnect Originals"
                : dialog === "remove"
                  ? "Remove Object"
                  : dialog === "preset"
                    ? "Create preset"
                    : dialog === "presets"
                      ? "Portable presets"
                      : dialog === "auto-crop"
                        ? "Automatic crop"
                        : dialog === "reference"
                          ? "Match an edited reference"
                          : dialog === "rename"
                            ? "Rename photo"
                            : dialog === "snapshot"
                              ? "Save snapshot"
                              : dialog === "sync"
                                ? "Sync settings"
                                : dialog === "recovery"
                                  ? "Recover saved edits"
                                  : "Export photograph"}
            </h2>
            {dialogError && <p role="alert">{dialogError}</p>}
            {dialog === "reconnect" ? (
              <DevelopReconnectDialog
                store={store}
                onClose={() => setDialog(null)}
                onCommitted={(receipt) => {
                  // Use each durable transaction immediately, even when the batch is
                  // canceled later. A stale render must never discard earlier receipts.
                  const next = mergeDevelopImportCommit(
                    { ...reconnectLibrary.current, documents: docs.current },
                    receipt,
                  );
                  reconnectLibrary.current = next;
                  adopt(next, selectedRef.current ?? receipt.photos[0]?.id);
                }}
                onBusyChange={(value) => {
                  // Reuse the import processing lane so full-quality editor renders
                  // do not compete with the originals currently being decoded.
                  operationLock.current = value ? "import" : null;
                  setBusy(value ? "Reconnecting originals…" : "");
                }}
              />
            ) : dialog === "recovery" ? (
              <DevelopRecoveryDialog
                store={store}
                scope={scope}
                libraryId={projectId ? `project:${projectId}` : `shoot:${shootId ?? "legacy"}`}
                onClose={() => setDialog(null)}
                onCommitted={(documents) => {
                  // A successful transaction is authoritative even if the optional
                  // full-library refresh subsequently fails. Never expose/export
                  // the old draft after recovery has already been committed.
                  const nextDocuments = { ...docs.current };
                  for (const document of documents) nextDocuments[document.photoId] = document;
                  adopt({ ...library, documents: nextDocuments }, selectedRef.current);
                }}
                onRestored={(next) => {
                  adopt(next, selectedRef.current);
                  setDialog(null);
                  setNotice("Recovery edits restored. Originals and existing history preserved.");
                }}
                onBusyChange={(value) => {
                  operationLock.current = value ? "dialog" : null;
                  setBusy(value ? "Recovering edits…" : "");
                }}
              />
            ) : dialog === "presets" ? (
              <PresetExchange
                recipe={draft}
                presets={library.presets}
                save={savePortablePreset}
                close={() => setDialog(null)}
              />
            ) : dialog === "remove" ? (
              <ObjectRemoveDialog
                key={selected}
                onPreviewPending={setRemovalPreviewPending}
                getRendered={async (signal) => {
                  if (!photo || !exportRequest || selectedRef.current !== photo.id)
                    throw new Error("Choose a photo first.");
                  if (!(await flush())) throw new Error("Save the current edits first.");
                  signal.throwIfAborted();
                  const recipe = cloneDevelopSettings(draftRef.current);
                  const request = {
                    ...exportRequest,
                    edge: removalRenderEdge(exportRequest.edge),
                    recipeKey: JSON.stringify(recipe),
                  };
                  if (
                    editorProof.current &&
                    currentDevelopExportProof(editorProof.current, request)
                  )
                    return editorProof.current.blob;
                  return renderDevelop(request.source, recipe, {
                    edge: request.edge,
                    quality: request.quality / 100,
                    sourceMode: request.sourceMode,
                    signal,
                  });
                }}
                processing={(value) => {
                  operationLock.current = value ? "dialog" : null;
                  setBusy(value ? "Removing Object…" : "");
                }}
                saveCopy={async (blob) => {
                  if (!photo || selectedRef.current !== photo.id || failed.current)
                    throw new Error("The selected photo changed. Reopen removal before saving.");
                  if (!(await flush())) throw new Error("Save the current edits first.");
                  const name = uniquePhotoDisplayName(
                    `${photo.name.replace(/\.[^.]+$/, "")}-removed.png`,
                    library.photos.map((item) => item.name),
                  );
                  const file = new File([blob], name, {
                    type: "image/png",
                    lastModified: Date.now(),
                  });
                  const bitmap = await decodeDevelopPreview(blob);
                  const dimensions = { width: bitmap.width, height: bitmap.height };
                  bitmap.close();
                  const incoming = await developPhotoFromFile(file, blob, dimensions);
                  if (!alive.current || selectedRef.current !== photo.id)
                    throw new Error("The workspace changed. Nothing was replaced.");
                  await store.addPhotos([
                    { ...incoming, previewBlob: blob, previewOrigin: "raster" },
                  ]);
                  const next = await store.loadLibrary();
                  if (alive.current) {
                    adopt(next, incoming.id);
                    explicitViewFilter.current = true;
                    viewFilter.current = "all";
                    setFilter("all");
                    setMode("develop");
                    setTool("edit");
                    setBefore(false);
                    setCompare(false);
                    setDialog(null);
                    setNotice(
                      library.photos.some((item) => item.id === incoming.id)
                        ? "Existing removal copy opened. Original and edits preserved."
                        : "Removal saved as a separate copy. Original and edits preserved.",
                    );
                  }
                }}
                close={() => setDialog(null)}
              />
            ) : dialog === "auto-crop" ? (
              <AutoCropDialog
                current={draft}
                getNeutral={async (signal) => {
                  if (!previewSource) throw new Error("Choose a photo first.");
                  if (!(await flush())) throw new Error("Save the current edits first.");
                  return renderDevelop(previewSource, defaultDevelopSettings(), {
                    edge: 1600,
                    quality: 1,
                    signal,
                    sourceMode: processingMode,
                  });
                }}
                processing={(value) => {
                  operationLock.current = value ? "dialog" : null;
                  setBusy(value ? "Analyzing crop…" : "");
                }}
                apply={(crop) => {
                  change({ ...draft, crop }, "Automatic crop");
                  setDialog(null);
                  changeTool("edit");
                }}
                close={() => setDialog(null)}
              />
            ) : dialog === "reference" ? (
              <ReferencePresetDialog
                current={draft}
                sourceName={photo?.name ?? "Selected photo"}
                getNeutral={async (signal) => {
                  if (!previewSource || !photo) throw new Error("Choose an original photo first.");
                  if (!(await flush())) throw new Error("Save the current edits first.");
                  return renderDevelop(previewSource, defaultDevelopSettings(), {
                    edge: 1600,
                    quality: 1,
                    signal,
                    sourceMode: processingMode,
                  });
                }}
                processing={(value) => {
                  operationLock.current = value ? "dialog" : null;
                  setBusy(value ? "Matching reference…" : "");
                }}
                apply={(settings) => {
                  change(settings, "Estimated reference look");
                  setDialog(null);
                }}
                save={savePortablePreset}
                close={() => setDialog(null)}
              />
            ) : dialog === "preset" || dialog === "snapshot" || dialog === "rename" ? (
              <label>
                {dialog === "rename"
                  ? "Library and export name (original filename stays unchanged)"
                  : "Name"}
                <input
                  autoFocus
                  maxLength={dialog === "rename" ? 180 : 100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && name.trim()) void confirmDialog();
                  }}
                />
              </label>
            ) : dialog === "sync" ? (
              <>
                <p>
                  Apply the active photo’s settings to {selectedSet.size - 1} selected photos. Each
                  photo keeps its own undo history.
                </p>
                <label className="develop-check">
                  <input
                    type="checkbox"
                    checked={syncCrop}
                    onChange={(e) => setSyncCrop(e.target.checked)}
                  />
                  Include crop and orientation
                </label>
                <label className="develop-check">
                  <input
                    type="checkbox"
                    checked={syncMasks}
                    onChange={(e) => setSyncMasks(e.target.checked)}
                  />
                  Include masks
                </label>
              </>
            ) : (
              <fieldset className="develop-export-settings" disabled={!!busy}>
                <p>JPEG · sRGB · original file untouched</p>
                {photo?.isRaw && photo.sourceAvailable && (
                  <>
                    <label>
                      Processing source · editor and export
                      <select
                        value={exportSourceMode}
                        onChange={(e) => setExportSourceMode(e.target.value as "raw" | "preview")}
                      >
                        <option value="raw">Full RAW demosaic</option>
                        <option value="preview">
                          {photo.previewOrigin === "raw-demosaic"
                            ? "Saved sensor-derived preview"
                            : photo.previewOrigin === "embedded"
                              ? "Embedded camera preview"
                              : "Saved preview"}
                        </option>
                      </select>
                    </label>
                    <p className="develop-export-disclosure">
                      {exportSourceMode === "raw"
                        ? "The editor and export use the same sensor RAW render, size, quality and sRGB color. The displayed edited JPEG is reused for download when all settings match."
                        : photo.previewOrigin === "raw-demosaic"
                          ? "The editor and export both use the saved sensor-derived preview. Choose Full RAW demosaic for a new render from the original."
                          : photo.previewOrigin === "embedded"
                            ? "The editor and export both use the camera’s embedded preview, not sensor RAW data."
                            : "The editor and export both use the saved preview, not a new render from sensor RAW data."}
                    </p>
                  </>
                )}
                {!photo?.sourceAvailable && (
                  <p className="develop-export-disclosure">
                    Only a saved preview is available for this photo.
                  </p>
                )}
                <label>
                  Long edge
                  <select
                    value={exportEdge}
                    onChange={(e) => setExportEdge(Number(e.target.value))}
                  >
                    <option value={1600}>1,600 px</option>
                    <option value={2048}>2,048 px</option>
                    <option value={4096}>Up to 4,096 px</option>
                    <option value={DEVELOP_ENGINE_LIMITS.maxEdge}>Up to 8,192 px / 36 MP</option>
                  </select>
                </label>
                {exportEdge > DEVELOP_ENGINE_LIMITS.defaultExportEdge && (
                  <p className="develop-export-disclosure">
                    Keeps the source resolution up to 8,192 px and 36 MP, without upscaling. Larger
                    renders use more memory and run one at a time. Preview and download still use
                    the same file.
                  </p>
                )}
                <label>
                  JPEG quality
                  <input
                    type="number"
                    min={50}
                    max={100}
                    value={exportQuality}
                    onChange={(e) =>
                      setExportQuality(Math.max(50, Math.min(100, Number(e.target.value))))
                    }
                  />
                </label>
                <div className="develop-proof-toolbar">
                  <button
                    type="button"
                    onClick={() => void previewExport()}
                    disabled={!exportRequest || !!saveError}
                  >
                    {proofReady ? "Refresh preview" : "Preview export"}
                  </button>
                  {proofReady && (
                    <button
                      type="button"
                      aria-label="Export preview at 100 percent"
                      aria-pressed={proofZoom}
                      onClick={() => setProofZoom((value) => !value)}
                    >
                      {proofZoom ? "Fit" : "100%"}
                    </button>
                  )}
                </div>
                {proofUrl && exportProof && (
                  <figure className="develop-export-proof">
                    <div
                      className={proofZoom ? "is-actual-size" : ""}
                      tabIndex={0}
                      aria-label={
                        proofZoom
                          ? "Export preview, scroll to inspect actual pixels"
                          : "Export preview"
                      }
                    >
                      <img
                        src={proofUrl}
                        alt={`Export preview of ${photo?.name ?? "photograph"}`}
                        width={exportProof.width}
                        height={exportProof.height}
                      />
                    </div>
                    <figcaption>
                      {exportProof.width.toLocaleString()} × {exportProof.height.toLocaleString()} ·
                      JPEG
                      {exportProof.sourceMode === "raw" ? " · Sensor RAW" : ""}
                      <span>Export downloads this exact file. This is not a print soft proof.</span>
                    </figcaption>
                  </figure>
                )}
                {!proofReady && exportProof && (
                  <p className="develop-export-disclosure">
                    Export settings changed. Preview again to inspect the new file.
                  </p>
                )}
              </fieldset>
            )}
            {dialog !== "recovery" &&
              dialog !== "reconnect" &&
              dialog !== "presets" &&
              dialog !== "reference" &&
              dialog !== "remove" &&
              dialog !== "auto-crop" && (
                <div className="develop-dialog-actions">
                  {busy === "Rendering export preview…" && (
                    <button onClick={() => exportAbort.current?.abort()}>Stop preview</button>
                  )}
                  <button disabled={!!busy} onClick={() => setDialog(null)}>
                    Cancel
                  </button>
                  <button
                    className="develop-primary"
                    disabled={
                      !!busy ||
                      ((dialog === "preset" || dialog === "snapshot" || dialog === "rename") &&
                        !name.trim())
                    }
                    onClick={() => void confirmDialog()}
                  >
                    {busy ||
                      (dialog === "export"
                        ? "Export JPEG"
                        : dialog === "sync"
                          ? "Sync settings"
                          : "Save")}
                  </button>
                </div>
              )}
          </section>
        </div>
      )}
    </section>
  );
}
