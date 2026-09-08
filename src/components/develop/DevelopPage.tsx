import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import { useWorkbench } from "@/components/workbench/context";
import { useToolLeaveGuard } from "@/components/workbench/useToolLeaveGuard";
import { readStudioSessionSnapshot } from "@/lib/studio/session";
import { ProjectStudioSession } from "@/lib/projects/studio-adapter";
import {
  defaultDevelopSettings,
  cloneDevelopSettings,
  type DevelopSettings,
} from "@/lib/develop/contract";
import { renderDevelop, developEngineStatus } from "@/lib/develop/client";
import { AutoCropDialog } from "./AutoCropDialog";
import { runDevelopImport, type DevelopImportReport } from "@/lib/develop/import";
import { collectDroppedFiles } from "@/lib/studio/drop-import";
import {
  createDevelopStore,
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
  developPhotoFromShot,
  reconnectDevelopPhoto,
  type DevelopDocument,
  type DevelopPhoto,
  type DevelopLibrary,
  type DevelopPreset,
} from "@/lib/develop/store";
import { photoExportFilename } from "@/lib/develop/photo-management";
import { DevelopPhotoActions } from "./DevelopPhotoActions";
import { PresetExchange } from "./PresetExchange";
import { ReferencePresetDialog } from "./ReferencePresetDialog";
import { DevelopControls, Panel, type DevelopTool } from "./DevelopControls";
import { DevelopViewer } from "./DevelopViewer";
import { DevelopHistogram } from "./DevelopHistogram";
import {
  analyzeDevelopPixels,
  suggestDevelopTone,
  type DevelopHistogramData,
} from "@/lib/develop/histogram";
import { DevelopRecoveryDialog } from "./DevelopRecoveryDialog";
import { useDevelopPointer } from "./useDevelopPointer";
import {
  currentDevelopRender,
  currentDevelopExportProof,
  filteredDevelopSelection,
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
    const u = URL.createObjectURL(blob);
    setValue({ blob, url: u });
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return value && value.blob === blob ? value.url : null;
}
function Thumb({ photo }: { photo: DevelopPhoto }) {
  const url = useBlobUrl(photo.previewBlob ?? (!photo.isRaw ? photo.sourceBlob : null));
  return url ? <img src={url} alt="" loading="lazy" /> : <ImagePlus size={18} />;
}

export function DevelopPage({
  scope,
  projectId,
  shootId,
}: {
  scope: string;
  projectId: string | null;
  shootId?: string;
}) {
  const workbench = useWorkbench();
  const pointerBoundary = useDevelopPointer();
  const store = useMemo(
    () =>
      createDevelopStore({
        scope,
        libraryId: projectId ? `project:${projectId}` : `shoot:${shootId ?? "legacy"}`,
      }),
    [scope, projectId, shootId],
  );
  const [library, setLibrary] = useState<DevelopLibrary>({
    photos: [],
    documents: {},
    presets: [],
  });
  const docs = useRef<Record<string, DevelopDocument>>({}),
    revisions = useRef<Record<string, number>>({});
  const [selected, setSelected] = useState<string | null>(null),
    selectedRef = useRef<string | null>(null);
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());
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
  const [saveError, setSaveError] = useState(""),
    [pending, setPending] = useState(0),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(""),
    [engine, setEngine] = useState<boolean | null>(null);
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
  const [copiedPhoto, setCopiedPhoto] = useState<{ id: string; revision: number } | null>(null);
  const [renderBlob, setRenderBlob] = useState<Blob | null>(null),
    [neutralBlob, setNeutralBlob] = useState<Blob | null>(null),
    [rendering, setRendering] = useState(false),
    [renderError, setRenderError] = useState("");
  const renderOwner = useRef<DevelopRenderOwner | null>(null),
    neutralOwner = useRef<{ id: string | null; source: Blob } | null>(null);
  const [histogram, setHistogram] = useState<DevelopHistogramData | null>(null),
    [sourceHistogram, setSourceHistogram] = useState<DevelopHistogramData | null>(null),
    [adaptiveLooks, setAdaptiveLooks] = useState(true),
    [clipping, setClipping] = useState({ shadows: false, highlights: false }),
    [dimensions, setDimensions] = useState({ width: 0, height: 0 }),
    [sourceAspect, setSourceAspect] = useState(1.5);
  const onDimensions = useCallback(
    (width: number, height: number) => setDimensions({ width, height }),
    [],
  );
  const [dialog, setDialog] = useState<
      | "preset"
      | "snapshot"
      | "export"
      | "sync"
      | "recovery"
      | "rename"
      | "presets"
      | "reference"
      | "auto-crop"
      | null
    >(null),
    [name, setName] = useState(""),
    [exportEdge, setExportEdge] = useState(4096),
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
  const previewSource = photo?.isRaw ? (photo.previewBlob ?? source) : source;
  const exportRequest: DevelopExportRequest | null =
    photo && source
      ? {
          id: photo.id,
          source:
            photo.isRaw && exportSourceMode === "preview" ? (photo.previewBlob ?? source) : source,
          recipeKey: JSON.stringify(cloneDevelopSettings(draft)),
          edge: exportEdge,
          quality: exportQuality,
          sourceMode: photo.isRaw && photo.sourceAvailable ? exportSourceMode : "preview",
        }
      : null;
  const proofReady = currentDevelopExportProof(exportProof, exportRequest);
  const proofUrl = useBlobUrl(proofReady ? exportProof?.blob : null);
  const url = useBlobUrl(
      currentDevelopRender(renderOwner.current, selected, previewSource, tool !== "edit")
        ? renderBlob
        : null,
    ),
    beforeUrl = useBlobUrl(
      neutralOwner.current?.id === selected && neutralOwner.current?.source === previewSource
        ? neutralBlob
        : null,
    );
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
  useToolLeaveGuard(
    busy || pending || draftDirty || saveError
      ? "Develop still has work that has not finished saving."
      : null,
    flush,
  );
  useEffect(() => {
    alive.current = true;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (draftDirtyRef.current || pendingRef.current || failed.current || operationLock.current) {
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
  }, []);
  useEffect(() => {
    let cancelled = false;
    void developEngineStatus().then((s) => {
      if (!cancelled) setEngine(Boolean(s?.ready));
    });
    return () => {
      cancelled = true;
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
          "Photo copied in FOTO. Paste creates an independent virtual copy; the original is untouched.",
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

  function markDraftDirty(value: boolean) {
    draftDirtyRef.current = value;
    setDraftDirty(value);
  }
  function editsLocked() {
    return failed.current || operationLock.current !== null || !alive.current;
  }

  const adopt = useCallback((next: DevelopLibrary, choose?: string | null) => {
    docs.current = next.documents;
    revisions.current = Object.fromEntries(
      Object.entries(next.documents).map(([id, d]) => [id, d.revision]),
    );
    setLibrary(next);
    const chosen = next.photos.find((p) => p.id === choose);
    const id =
      chosen && (chosen.sourceBlob?.size || chosen.previewBlob?.size)
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
    void (async () => {
      try {
        let snapshot = await store.loadLibrary();
        // Read the current shoot once. All writes below go to the separate Develop database.
        const session = projectId
          ? await new ProjectStudioSession(projectId).load()
          : await readStudioSessionSnapshot(scope, shootId);
        if (session) {
          try {
            if (!cancelled && session.shots.length) {
              await store.addPhotos(session.shots.map(developPhotoFromShot));
              snapshot = await store.loadLibrary();
            }
          } finally {
            for (const shot of session.shots)
              if (shot.previewUrl) URL.revokeObjectURL(shot.previewUrl);
          }
        }
        if (cancelled) return;
        adopt(snapshot, session?.selectedId ? `studio:${session.selectedId}` : null);
        setReady(true);
      } catch (e) {
        if (!cancelled) setLoadError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, scope, projectId, shootId, adopt]);

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
    const recipe = currentRecipe(next);
    draftRef.current = recipe;
    setDraft(recipe);
    markDraftDirty(false);
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
    neutralOwner.current?.source === previewSource;
  function autoTone() {
    if (!sourceStatsReady || !sourceHistogram) return;
    const suggestion = suggestDevelopTone(sourceHistogram);
    if (!suggestion.applicable) {
      setNotice(suggestion.reason);
      return;
    }
    change({ ...draft, exposure: suggestion.exposure }, "Auto exposure · source luminance");
    setNotice(
      `Auto exposure ${suggestion.exposure > 0 ? "+" : ""}${suggestion.exposure} EV · ${suggestion.reason}. Review the preview; undo is available.`,
    );
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
    setRenderBlob(null);
    setNeutralBlob(null);
    setRenderError("");
    setDimensions({ width: 0, height: 0 });
    setHistogram(null);
    setSourceHistogram(null);
    setClipping({ shadows: false, highlights: false });
    setSourceAspect(photo?.width && photo?.height ? photo.width / photo.height : 1.5);
    if (!previewSource) return;
    const controller = new AbortController();
    void renderDevelop(previewSource, defaultDevelopSettings(), { signal: controller.signal })
      .then(async (blob) => {
        if (controller.signal.aborted) return;
        const bitmap = await createImageBitmap(blob);
        try {
          if (!controller.signal.aborted) {
            const canvas = document.createElement("canvas");
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const context = canvas.getContext("2d");
            if (context) {
              context.drawImage(bitmap, 0, 0);
              setSourceHistogram(
                analyzeDevelopPixels(context.getImageData(0, 0, canvas.width, canvas.height).data),
              );
            }
            neutralOwner.current = { id: selected, source: previewSource };
            setNeutralBlob(blob);
            setSourceAspect(bitmap.width / bitmap.height);
          }
        } finally {
          bitmap.close();
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setRenderError(errorMessage(e));
      });
    return () => controller.abort();
  }, [selected, previewSource, photo?.width, photo?.height]);
  const renderRecipe = useMemo(
    () => (tool === "edit" ? draft : { ...draft, crop: defaultDevelopSettings().crop }),
    [draft, tool],
  );
  useEffect(() => {
    if (!previewSource) {
      setRendering(false);
      return;
    }
    const controller = new AbortController();
    setRendering(true);
    const timeout = setTimeout(() => {
      void renderDevelop(previewSource, renderRecipe, { signal: controller.signal })
        .then((blob) => {
          if (!controller.signal.aborted) {
            renderOwner.current = {
              id: selected,
              source: previewSource,
              sourceGeometry: tool !== "edit",
            };
            setRenderBlob(blob);
            setRenderError("");
            setRendering(false);
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setRenderError(errorMessage(e));
            setRendering(false);
          }
        });
    }, 140);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [selected, previewSource, renderRecipe, tool]);

  async function importPhotos(incomingFiles: File[] | DataTransfer) {
    if (
      (Array.isArray(incomingFiles) && !incomingFiles.length) ||
      !ready ||
      editsLocked() ||
      dialog
    )
      return;
    operationLock.current = "import";
    setBusy("Preparing import…");
    setNotice("");
    setImportFailures([]);
    const controller = new AbortController();
    importAbort.current = controller;
    let importedSelection: string | null = null;
    try {
      // Capture dropped handles during the event, before an await protects the drag store.
      const dropped = Array.isArray(incomingFiles)
        ? null
        : collectDroppedFiles(incomingFiles, {
            signal: controller.signal,
            onProgress: (progress) =>
              alive.current && setBusy(`Reading folder · ${progress.files} files`),
          });
      const collected = dropped ? await dropped : null;
      const files = collected?.files ?? (incomingFiles as File[]);
      const warnings = (collected?.warnings ?? []).map((warning) => ({
        fileName: warning.path || "Folder",
        message: warning.message,
      }));
      if (!(await flush()))
        throw new Error("Resolve the save problem before importing more photos.");
      const result = await runDevelopImport(files, {
        // A byte-identical import can restore a missing Develop original. addPhotos
        // merges media into the old record without replacing its editing document.
        existingIds: availablePhotos.map((item) => item.id),
        signal: controller.signal,
        onProgress: ({ index, total, fileName }) =>
          alive.current && setBusy(`Importing ${index} of ${total} · ${fileName}`),
        save: (incoming) => store.addPhotos([incoming]),
        preparePreview: async (file, incoming, signal) => {
          let preview: Blob;
          let previewOrigin: "unknown" | "raw-demosaic" | "raster" = incoming.isRaw
            ? "unknown"
            : "raster";
          try {
            preview = await renderDevelop(file, defaultDevelopSettings(), {
              edge: 1600,
              signal,
            });
          } catch (previewError) {
            signal.throwIfAborted();
            if (!incoming.isRaw || !(await developEngineStatus())?.rawSupported) throw previewError;
            if (alive.current) setBusy(`Importing ${file.name} · developing RAW preview`);
            preview = await renderDevelop(file, defaultDevelopSettings(), {
              edge: 1600,
              sourceMode: "raw",
              signal,
            });
            previewOrigin = "raw-demosaic";
          }
          const bitmap = await createImageBitmap(preview);
          const dims = { width: bitmap.width, height: bitmap.height };
          bitmap.close();
          return { ...incoming, previewBlob: preview, previewOrigin, ...dims };
        },
      });
      importedSelection = result.selectedId;
      if (alive.current) {
        setImportFailures([...warnings, ...result.failures]);
        if (importedSelection) {
          setFilter("all");
          setMode("develop");
          setTool("edit");
          setBefore(false);
          setCompare(false);
        }
        setNotice(
          `${result.imported.length} ${result.imported.length === 1 ? "photo" : "photos"} imported${result.duplicates ? ` · ${result.duplicates} already in this library` : ""}${result.failures.length ? ` · ${result.failures.length} could not be imported` : ""}${warnings.length ? ` · ${warnings.length} folder warnings` : ""}${result.stopped ? " · Import stopped" : ""}${result.fatalError ? ` · ${result.fatalError}` : ""}`,
        );
      }
    } catch (e) {
      if (alive.current) setNotice(controller.signal.aborted ? "Import stopped." : errorMessage(e));
    } finally {
      // Editing entry points stay locked until every queued write and refresh has settled.
      // Never replace in-memory recovery edits after a failed save.
      if (alive.current && !failed.current) {
        try {
          if (await flush()) {
            const refreshed = await store.loadLibrary();
            if (alive.current && !failed.current)
              adopt(refreshed, importedSelection ?? selectedRef.current);
          }
        } catch (e) {
          failed.current = true;
          if (alive.current)
            setSaveError(`Could not reopen the imported library. ${errorMessage(e)}`);
        }
      }
      operationLock.current = null;
      importAbort.current = null;
      if (alive.current) setBusy("");
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
      let preview: Blob;
      let previewOrigin: "unknown" | "raw-demosaic" | "raster" = target.isRaw
        ? "unknown"
        : "raster";
      try {
        preview = await renderDevelop(file, defaultDevelopSettings(), {
          edge: 1600,
          signal: controller.signal,
        });
      } catch (previewError) {
        controller.signal.throwIfAborted();
        if (!target.isRaw || !(await developEngineStatus())?.rawSupported) throw previewError;
        setBusy(`Reconnecting ${target.name} · developing RAW preview`);
        preview = await renderDevelop(file, defaultDevelopSettings(), {
          edge: 1600,
          sourceMode: "raw",
          signal: controller.signal,
        });
        previewOrigin = "raw-demosaic";
      }
      const bitmap = await createImageBitmap(preview);
      const dims = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      controller.signal.throwIfAborted();
      const incoming = await reconnectDevelopPhoto(target, file, preview, dims, previewOrigin);
      controller.signal.throwIfAborted();
      if (!alive.current) return;
      // Attach media to the existing photo ID. Never create a new document or reset its history.
      await store.addPhotos([incoming]);
      attached = true;
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
    const request = exportRequest;
    const recipe = cloneDevelopSettings(draftRef.current);
    operationLock.current = "dialog";
    setDialogError("");
    setExportProof(null);
    setBusy("Rendering export preview…");
    const controller = new AbortController();
    exportAbort.current = controller;
    try {
      if (!(await flush()))
        throw new Error("These edits could not be saved. Save a recovery file before continuing.");
      controller.signal.throwIfAborted();
      const blob = await renderDevelop(request.source, recipe, {
        edge: request.edge,
        quality: request.quality / 100,
        sourceMode: request.sourceMode,
        signal: controller.signal,
      });
      const bitmap = await createImageBitmap(blob);
      try {
        if (alive.current && !controller.signal.aborted)
          setExportProof({ ...request, blob, width: bitmap.width, height: bitmap.height });
      } finally {
        bitmap.close();
      }
    } catch (e) {
      if (alive.current)
        setDialogError(controller.signal.aborted ? "Export preview cancelled." : errorMessage(e));
    } finally {
      operationLock.current = null;
      exportAbort.current = null;
      if (alive.current) setBusy("");
    }
  }
  async function confirmDialog() {
    if (!dialog || editsLocked()) return;
    const action = dialog,
      activeId = selectedRef.current,
      recipe = cloneDevelopSettings(draftRef.current);
    operationLock.current = "dialog";
    setDialogError("");
    setBusy(action === "export" ? "Rendering export" : "Saving…");
    const controller = new AbortController();
    exportAbort.current = controller;
    try {
      if (!(await flush()))
        throw new Error("These edits could not be saved. Save a recovery file before continuing.");
      controller.signal.throwIfAborted();
      if (action === "preset") {
        const preset = await store.savePreset(createDevelopPreset(name, recipe));
        if (alive.current) {
          setLibrary((old) => ({ ...old, presets: [...old.presets, preset] }));
          setNotice("Preset saved");
        }
      }
      if (action === "rename") {
        if (!photo || activeId !== photo.id)
          throw new Error("Choose the photo again before renaming.");
        const renamed = await store.renamePhoto(photo.id, name, photo.name);
        if (alive.current) {
          setLibrary((old) => ({
            ...old,
            photos: old.photos.map((item) => (item.id === renamed.id ? renamed : item)),
          }));
          setNotice("Library and export name updated. The original filename is unchanged.");
        }
      }
      if (action === "snapshot") {
        const current = activeId ? docs.current[activeId] : undefined;
        if (!current) throw new Error("Choose a photo first.");
        if (!(await updateDoc(addSnapshot(current, name), true)))
          throw new Error(
            "The snapshot was not saved. Your edits remain available in the recovery file.",
          );
        if (alive.current) setNotice("Snapshot saved");
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
        if (alive.current) setNotice(`Settings synced to ${updates.length} photos`);
      }
      if (action === "export") {
        if (!photo || !exportRequest) throw new Error("Choose a photo with a source first.");
        const { sourceMode } = exportRequest;
        // Download the exact proof bytes when all inputs still match. A changed
        // source, recipe, size or quality can never reuse a stale preview.
        const blob =
          currentDevelopExportProof(exportProof, exportRequest) && exportProof
            ? exportProof.blob
            : await renderDevelop(exportRequest.source, recipe, {
                edge: exportRequest.edge,
                quality: exportRequest.quality / 100,
                signal: controller.signal,
                sourceMode,
              });
        const bitmap = await createImageBitmap(blob);
        const size = `${bitmap.width} × ${bitmap.height}`;
        bitmap.close();
        if (alive.current && !controller.signal.aborted) {
          download(blob, photoExportFilename(photo.name));
          setNotice(
            `Exported ${size} JPEG${photo.isRaw ? (sourceMode === "raw" ? " from sensor RAW" : photo.previewOrigin === "raw-demosaic" ? " from a saved sensor-derived preview" : " from RAW preview") : ""}`,
          );
        }
      }
      if (alive.current) {
        setDialog(null);
        setName("");
      }
    } catch (e) {
      if (alive.current) setDialogError(errorMessage(e));
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
  if (!ready) return <div className="foto-develop develop-loading">Opening Develop…</div>;
  return (
    <section
      {...pointerBoundary}
      className={`foto-develop${dragging ? " is-dragging" : ""}`}
      aria-label="FOTO Develop"
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
            FOTO <small>Photo Lab</small>
          </span>
        </div>
        <div className="develop-top-actions">
          <button onClick={() => workbench?.showStudio()}>Studio</button>
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
          <button disabled={!!busy || !!saveError} onClick={() => input.current?.click()}>
            <Plus size={14} />
            Import
          </button>
          {availablePhotos.length > 0 && (
            <button
              disabled={!source || !!busy || !!saveError || rendering || !!renderError}
              onClick={() => openDialog("export")}
            >
              <ArrowDownToLine size={14} />
              Export
            </button>
          )}
        </div>
      </header>
      {(saveError || notice || busy || engine === false) && (
        <div className={`develop-status ${saveError ? "is-error" : ""}`} role="status">
          <span>
            {saveError ||
              busy ||
              notice ||
              (engine === false
                ? "The local image engine is not ready. Rebuild it and reload Develop."
                : "")}
          </span>
          {saveError ? (
            <button onClick={recoveryFile}>Save recovery file</button>
          ) : operationLock.current === "import" && !busy.startsWith("Reconnecting") ? (
            <button onClick={() => importAbort.current?.abort()}>Stop import</button>
          ) : busy.startsWith("Reconnecting") ? (
            <button onClick={() => importAbort.current?.abort()}>Stop reconnect</button>
          ) : notice ? (
            <button aria-label="Dismiss message" onClick={() => setNotice("")}>
              ×
            </button>
          ) : null}
        </div>
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
      >
        {source && (
          <aside className="develop-left">
            <Panel title="Navigator" open>
              <div className="develop-navigator">
                {beforeUrl ? (
                  <img src={beforeUrl} alt="Navigator preview" />
                ) : (
                  <ImagePlus size={24} />
                )}
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
                    disabled={!source || !!saveError}
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
                  <ul>
                    {library.photos
                      .filter((p) => !p.sourceBlob?.size && !p.previewBlob?.size)
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
            <div className="develop-library-grid">
              {visible.map((p) => (
                <button
                  key={p.id}
                  aria-pressed={selectedSet.has(p.id)}
                  onClick={(e) => select(p.id, e.shiftKey || e.metaKey || e.ctrlKey)}
                  onDoubleClick={() => setMode("develop")}
                >
                  <Thumb photo={p} />
                  <span>{p.name}</span>
                  <small>{"★".repeat(library.documents[p.id]?.metadata.rating ?? 0)}</small>
                </button>
              ))}
            </div>
          ) : (
            <>
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
                  url={url ?? beforeUrl}
                  emptyLabel={
                    photo
                      ? renderError
                        ? "Preview unavailable."
                        : "Preparing preview…"
                      : "Choose a photograph to begin."
                  }
                  beforeUrl={beforeUrl}
                  before={before}
                  compare={compare}
                  zoom={zoom}
                  grid={grid}
                  tool={tool}
                  settings={draft}
                  change={change}
                  maskId={maskId}
                  onDimensions={onDimensions}
                  onHistogram={setHistogram}
                  clipping={clipping}
                />
              )}
              {renderError && (
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
                    disabled={!beforeUrl}
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
                  {rendering
                    ? "Rendering…"
                    : dimensions.width
                      ? `${dimensions.width} × ${dimensions.height}`
                      : ""}
                  {source && photo?.isRaw
                    ? photo.previewOrigin === "raw-demosaic"
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
        {source && (
          <aside className="develop-right">
            <div className="develop-histogram-wrap">
              <div className="develop-inline">
                <span>Histogram</span>
                <button
                  type="button"
                  disabled={!sourceStatsReady || !!saveError || !!busy}
                  title="Suggest exposure from original preview luminance, protecting highlight headroom. A normal-key starting point, not an artistic decision."
                  onClick={autoTone}
                >
                  Auto exposure
                </button>
              </div>
              <DevelopHistogram
                key={selected}
                histogram={histogram}
                value={draft}
                change={change}
                disabled={!url || !!saveError || !!busy || before || tool !== "edit"}
                clipping={clipping}
                onClipping={setClipping}
              />
              <div className="develop-inline">
                <span>
                  {!source
                    ? "No image source"
                    : photo?.isRaw
                      ? photo.previewOrigin === "raw-demosaic"
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
        <footer className="develop-filmstrip" inert={Boolean(busy || dialog)}>
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
          <div className="develop-filmstrip-items" role="group" aria-label="Filmstrip">
            {filmstripPhotos.map((p, i) => (
              <button
                key={p.id}
                aria-label={`${i + 1}. ${p.name}`}
                aria-pressed={selectedSet.has(p.id)}
                className={selected === p.id ? "is-active" : ""}
                onClick={(e) => select(p.id, e.shiftKey || e.metaKey || e.ctrlKey)}
              >
                <span className="develop-frame-number">{i + 1}</span>
                <Thumb photo={p} />
                <span className="develop-frame-name">{p.name}</span>
                {library.documents[p.id]?.metadata.flag === "pick" && (
                  <Check className="develop-frame-flag" size={12} />
                )}
              </button>
            ))}
          </div>
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
            className={`develop-dialog${dialog === "export" || dialog === "reference" || dialog === "auto-crop" ? " develop-export-dialog" : dialog === "recovery" ? " develop-recovery-dialog" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="develop-dialog-title"
            tabIndex={-1}
          >
            <h2 id="develop-dialog-title">
              {dialog === "preset"
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
            {dialog === "recovery" ? (
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
                    sourceMode: "preview",
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
                      Source quality
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
                        ? "LibRaw decodes the sensor data. Preview export to check the exact JPEG before downloading. Color can differ from the editor’s saved preview."
                        : photo.previewOrigin === "raw-demosaic"
                          ? "Exports the saved 1,600px sensor-derived preview. Choose Full RAW demosaic for a new render from the original."
                          : photo.previewOrigin === "embedded"
                            ? "Exports the camera’s embedded preview, not sensor RAW data."
                            : "Exports the saved preview, not a new render from sensor RAW data."}
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
                  </select>
                </label>
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
              dialog !== "presets" &&
              dialog !== "reference" &&
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
