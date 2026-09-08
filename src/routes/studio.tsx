import { createFileRoute, Link, useBlocker, defaultStringifySearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWorkbench } from "@/components/workbench/context";
import { isWorkbenchRoute, studioBindingKey } from "@/lib/workbench";
import { readStudioHandoff, type DeliveryFocus } from "@/lib/delivery/studio-handoff";
import {
  DeliveryReference,
  type DeliveryReferenceValue,
} from "@/components/studio/DeliveryReference";
import { resolveWorkspaceBinding } from "@/lib/workbench-projects";
import { EditSlider } from "@/components/studio/Slider";
import { CullChat, type ToolCall, type ImportAttachment } from "@/components/studio/CullChat";
import { useAccount } from "@/components/account/AccountProvider";
import { useProcessingWakeLock } from "@/components/account/WorkspacePreferences";
import { DEFAULT_PREFERENCES } from "@/lib/account-preferences";
import { matchesShortcut } from "@/lib/shortcuts";
import { importLanes } from "@/lib/settings-transfer";
import { Filmstrip } from "@/components/studio/Filmstrip";
import { StudioFilterMenu } from "@/components/studio/StudioFilterMenu";
import { SaveRecovery } from "@/components/studio/SaveRecovery";
import { describeShoot } from "@/lib/studio/shoot-brief";
import { createShootRecovery } from "@/lib/studio/recovery";
import { SaveProject } from "@/components/studio/SaveProject";
import { listRecentShoots, rememberShoot, studioDatabaseKey } from "@/lib/studio/shoot-directory";
import { rememberStudioRuntime, restoreStudioRuntime } from "@/lib/studio/runtime";
import { StudioSaveBoundary } from "@/lib/studio/save-boundary";
import { BurstReview } from "@/components/studio/BurstReview";
import { DeadlineExport } from "@/components/studio/DeadlineExport";
import { SocialExport } from "@/components/studio/SocialExport";
import type { StudioWorkflowIntent } from "@/lib/studio/workflow-intents";
import { ProjectStudioSession } from "@/lib/projects/studio-adapter";
import { isLocalSingleUserMode } from "@/lib/app-mode";
import { collectDroppedFiles } from "@/lib/studio/drop-import";
import { firstPassVerdict } from "@/lib/studio/first-pass";
import { importedReviewVerdict } from "@/lib/studio/review-metadata";
import {
  createLightroomVerdicts,
  mergeLightroomFrames,
  LIGHTROOM_MATCHING,
} from "@/lib/lightroom-matching";
import { createSidecarArchive } from "@/lib/studio/sidecar-export";
import type { AdobeSettingsPastePlan } from "@/lib/studio/adobe-paste";
import { applyCreativeEdit, type CreativeEditPlan } from "@/lib/studio/creative-edits";
import {
  applyProposal,
  proposeCull,
  proposeEdits,
  type EditTarget,
  type StudioProposal,
} from "@/lib/studio/proposals";
import {
  DEFAULT_EDITS,
  type Edits,
  type Flag,
  type Shot,
  type Verdict,
  autoRefine,
  decodeFile,
  faceDetectionAvailable,
  parseXmpSidecar,
  exportShot,
  histogram,
  isRawFile,
  renderToCanvas,
  scoreOf,
} from "@/lib/imaging";
import {
  canPersistStudioSession,
  clearStudioSession,
  loadStudioSession,
  saveStudioSession,
  stableShotId,
  type StudioFilter,
  type StudioHydrationState,
} from "@/lib/studio/session";
import { bridgeCredentials, bridgeFetch } from "@/lib/bridge-client";
import { indexDuplicateFrames } from "@/lib/studio/culling-index";
import {
  mergeIngestedShots,
  sidecarKey,
  uniquePhotos,
  readImportSidecars,
  sidecarReadNotice,
  createIngestResolver,
  SourceReconnectError,
} from "@/lib/studio/ingest";
import { analyseFile, disposeAnalysisWorkers } from "@/lib/studio/analysis-client";
import { bridgeEndpoint, downloadLightroomPlugin, type BridgeState } from "@/lib/lightroom-plugin";

export const Route = createFileRoute("/studio")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    project?: string;
    shoot?: string;
    deliveryFrame?: string;
    deliveryVersion?: string;
    deliveryHandoff?: string;
  } => {
    if (search["shoot"] !== undefined) {
      if (
        typeof search["shoot"] !== "string" ||
        !/^(?:legacy|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/i.test(search["shoot"]) ||
        [
          "project",
          "deliveryFrame",
          "deliveryVersion",
          "deliveryHandoff",
          "workspaceProject",
          "workspaceFrame",
          "workspaceVersion",
          "workspaceHandoff",
        ].some((key) => search[key] !== undefined)
      )
        throw new Error("Invalid shoot link.");
      return { shoot: search["shoot"] };
    }
    if (search["project"] === undefined) {
      if (
        ["deliveryFrame", "deliveryVersion", "deliveryHandoff"].some(
          (key) => search[key] !== undefined,
        )
      )
        throw new Error("Invalid delivery source reference.");
      return {};
    }
    if (typeof search["project"] !== "string" || !/^[a-f0-9-]{36}$/i.test(search["project"]))
      throw new Error("Invalid project identifier.");
    if (
      ["deliveryFrame", "deliveryVersion", "deliveryHandoff"].some(
        (key) => search[key] !== undefined,
      )
    ) {
      if (
        typeof search["deliveryFrame"] !== "string" ||
        !search["deliveryFrame"] ||
        search["deliveryFrame"].length > 2000 ||
        typeof search["deliveryVersion"] !== "string" ||
        !search["deliveryVersion"] ||
        search["deliveryVersion"].length > 2000 ||
        (search["deliveryHandoff"] !== undefined &&
          (typeof search["deliveryHandoff"] !== "string" ||
            !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(search["deliveryHandoff"])))
      )
        throw new Error("Invalid delivery source reference.");
      return {
        project: search["project"],
        deliveryFrame: search["deliveryFrame"],
        deliveryVersion: search["deliveryVersion"],
        ...(typeof search["deliveryHandoff"] === "string"
          ? { deliveryHandoff: search["deliveryHandoff"] }
          : {}),
      };
    }
    return { project: search["project"] };
  },
  head: () => ({
    meta: [
      { title: "LensLabs Studio — Cull & Develop Your Shoot" },
      {
        name: "description",
        content:
          "Import a RAW or JPEG shoot, get every frame scored and flagged, keep or reject with one key, then develop and export your picks.",
      },
      { property: "og:title", content: "LensLabs Studio — Cull & Develop Your Shoot" },
      {
        property: "og:description",
        content: "The LensLabs culling bench: score, flag, keep, develop, export.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StudioRoute,
});

function StudioRoute() {
  const workbench = useWorkbench();
  const { project, deliveryFrame, deliveryVersion, deliveryHandoff } = Route.useSearch();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  // The root workspace owns one persistent controller across tool navigation.
  if (workbench) return null;
  if (project && !ready) return <p className="p-8">Opening project…</p>;
  if (project && !isLocalSingleUserMode)
    return (
      <p className="p-8">
        Named projects are currently available only in the local development workspace. No private
        project data was loaded.
      </p>
    );
  return (
    <Studio
      key={JSON.stringify([project, deliveryFrame, deliveryVersion, deliveryHandoff])}
      projectId={project ?? null}
      {...(deliveryFrame && deliveryVersion
        ? {
            deliveryFocus: {
              frameId: deliveryFrame,
              versionId: deliveryVersion,
              ...(deliveryHandoff ? { handoffId: deliveryHandoff } : {}),
            },
          }
        : {})}
    />
  );
}

type Filter = StudioFilter;

const FLAG_LABEL: Record<Flag, string> = {
  soft: "soft focus",
  blur: "blurred",
  underexposed: "underexposed",
  overexposed: "blown highlights",
  duplicate: "duplicate",
  "face-soft": "face not sharp",
  "eyes-closed": "eyes closed",
};

const CROPS: Edits["crop"][] = ["orig", "1:1", "4:5", "3:2", "16:9"];

type UndoCheckpoint = {
  selectedId: string | null;
  frames: Array<Pick<Shot, "id" | "verdict" | "edits">>;
};

type HydrationGate = {
  promise: Promise<void>;
  resolve: () => void;
};

type EditRecipe = {
  target: EditTarget;
  title: string;
  description: string;
  limitations?: string[];
  transform: (shot: Shot) => Edits;
};

export function Studio({
  projectId,
  deliveryFocus,
  storageScope = "device-local",
  shootId,
}: {
  projectId: string | null;
  deliveryFocus?: DeliveryFocus;
  storageScope?: string;
  shootId?: string;
}) {
  const workbench = useWorkbench();
  // Studio is keyed by project. State retains the loaded controller during
  // Fast Refresh; a memo can be invalidated while the hydration guard survives.
  const [projectSession] = useState(() =>
    projectId ? new ProjectStudioSession(projectId, deliveryFocus) : null,
  );
  const [saveBoundary] = useState(() => new StudioSaveBoundary());
  const loadStoredSession = useCallback(
    () => (projectSession ? projectSession.load() : loadStudioSession(storageScope, shootId)),
    [projectSession, storageScope, shootId],
  );
  const saveStoredSession = useCallback(
    async (frames: Shot[], selected: string | null, scope: StudioFilter) => {
      const acknowledge = saveBoundary.begin({
        shots: frames,
        selectedId: selected,
        filter: scope,
      });
      if (projectSession) await projectSession.save(frames, selected, scope);
      else {
        await saveStudioSession(frames, selected, scope, storageScope, shootId);
        if (frames.length)
          await rememberShoot(
            storageScope,
            shootId ?? "legacy",
            frames.length,
            describeShoot(frames, selected).title,
          );
      }
      acknowledge();
    },
    [projectSession, storageScope, shootId, saveBoundary],
  );
  const [shots, setShots] = useState<Shot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sessionStatus, setSessionStatus] = useState<StudioHydrationState>("loading");
  const [deliveryReference, setDeliveryReference] = useState<DeliveryReferenceValue | null>(null);
  const [deliveryReferenceError, setDeliveryReferenceError] = useState<string | null>(null);
  useEffect(() => {
    if (!deliveryFocus?.handoffId || !projectSession || sessionStatus !== "ready") return;
    try {
      const reference = readStudioHandoff(
        window.sessionStorage,
        storageScope,
        deliveryFocus.handoffId,
      );
      setDeliveryReference(projectSession.deliveryReference(reference));
      setDeliveryReferenceError(null);
    } catch (error) {
      setDeliveryReference(null);
      setDeliveryReferenceError(
        error instanceof Error
          ? error.message
          : "Reopen this photo from Delivery to refresh its feedback.",
      );
    }
  }, [deliveryFocus?.handoffId, projectSession, sessionStatus, storageScope]);
  const [saveFailure, setSaveFailure] = useState<string | null>(null);
  const recoveryReloadRef = useRef(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [bins, setBins] = useState<number[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loupeStatus, setLoupeStatus] = useState<"loading" | "ready" | "failed">("loading");
  const renderedProposalRef = useRef<{ proposal: StudioProposal; shotId: string } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bitmapCache = useRef(new Map<string, ImageBitmap>());
  const bitmapPromisesRef = useRef(new Map<string, Promise<ImageBitmap>>());
  const latestShotsRef = useRef<Shot[]>([]);
  const latestSelectedIdRef = useRef<string | null>(null);
  const latestFilterRef = useRef<Filter>("all");
  const sessionStatusRef = useRef<StudioHydrationState>("loading");
  const hydrationRecoveryRef = useRef(false);
  const hydrationCompletedRef = useRef(false);
  const resourceCleanupRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrationGateRef = useRef<HydrationGate | null>(null);
  const mountedRef = useRef(true);
  const undoRef = useRef<UndoCheckpoint[]>([]);
  const runtimeKey = `${studioDatabaseKey(storageScope, shootId)}:${projectId ?? ""}`;
  const [shootTitle, setShootTitle] = useState("");
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void listRecentShoots(storageScope)
        .then((rows) => {
          if (alive)
            setShootTitle(rows.find((row) => row.id === (shootId ?? "legacy"))?.title ?? "");
        })
        .catch(() => {});
    };
    refresh();
    window.addEventListener("lenslabs:shoots-changed", refresh);
    return () => {
      alive = false;
      window.removeEventListener("lenslabs:shoots-changed", refresh);
    };
  }, [storageScope, shootId]);
  const importRunRef = useRef(0);
  const importingRef = useRef(false);
  const importAbortRef = useRef<AbortController | null>(null);
  const previewUrlsRef = useRef(new Set<string>());
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [faceEngine, setFaceEngine] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [linked, setLinked] = useState(false);
  const [proposal, setProposal] = useState<StudioProposal | null>(null);
  const proposalRef = useRef<StudioProposal | null>(null);
  const recipeRef = useRef<EditRecipe | null>(null);
  const [compareBefore, setCompareBefore] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [importAttachment, setImportAttachment] = useState<ImportAttachment | null>(null);
  const [folderStatus, setFolderStatus] = useState<string | null>(null);
  const [chatHasContent, setChatHasContent] = useState(false);
  const identity = useAccount();
  const registerAccountLeave = identity?.registerLeaveGuard;
  const preferences = identity?.preferences ?? DEFAULT_PREFERENCES;
  useProcessingWakeLock(preferences.keepAwake, Boolean(progress || busy));
  const [burstOpen, setBurstOpen] = useState(false);
  const [deadlineOpen, setDeadlineOpen] = useState(false);
  const [socialOpen, setSocialOpen] = useState(false);
  const [deadlineCount, setDeadlineCount] = useState(20);
  const folderAbortRef = useRef<AbortController | null>(null);
  useBlocker({
    shouldBlockFn: async ({ next }) => {
      if (!workbench) return false;
      if (isWorkbenchRoute([next.routeId])) {
        const nextBinding = resolveWorkspaceBinding(
          `${next.pathname}${defaultStringifySearch(next.search)}`,
          {
            kind: "ready",
            projectId,
            ...(shootId ? { shootId } : {}),
            ...(deliveryFocus ? { deliveryFocus } : {}),
          },
          isLocalSingleUserMode,
        );
        if (
          studioBindingKey(nextBinding) ===
          studioBindingKey({
            kind: "ready",
            projectId,
            ...(shootId ? { shootId } : {}),
            ...(deliveryFocus ? { deliveryFocus } : {}),
          })
        )
          return false;
      }
      if (sessionStatusRef.current === "conflicted") {
        setSyncNote(
          "Resolve the paused save before leaving this shoot. Your unsaved work is still in this tab.",
        );
        return true;
      }
      const unfinished = progress || folderStatus || busy || proposal || chatHasContent;
      if (
        unfinished &&
        !window.confirm(
          "Switching shoots or leaving the workspace ends this chat and any unfinished import or preview. Saved photos and edits are kept. Continue?",
        )
      )
        return true;
      if (canPersistStudioSession(sessionStatusRef.current)) {
        try {
          await saveStoredSession(
            latestShotsRef.current,
            latestSelectedIdRef.current,
            latestFilterRef.current,
          );
        } catch (error) {
          pauseSaving(error);
          return true;
        }
      }
      return false;
    },
    enableBeforeUnload: () =>
      !recoveryReloadRef.current &&
      Boolean(
        sessionStatusRef.current === "conflicted" ||
        saveBoundary.pending({
          shots: latestShotsRef.current,
          selectedId: latestSelectedIdRef.current,
          filter: latestFilterRef.current,
        }) ||
        (workbench && (progress || folderStatus || busy || proposal || chatHasContent)),
      ),
  });
  const proposalFrames = useMemo(
    () => new Map(proposal?.frames.map((frame) => [frame.id, frame]) ?? []),
    [proposal],
  );

  if (!hydrationGateRef.current) {
    let resolve = () => {};
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    hydrationGateRef.current = { promise, resolve };
  }

  latestFilterRef.current = filter;

  const updateShots = useCallback((updater: (current: Shot[]) => Shot[]) => {
    if (sessionStatusRef.current === "conflicted") return;
    const next = updater(latestShotsRef.current);
    latestShotsRef.current = next;
    setShots(next);
  }, []);

  const selectShot = useCallback((id: string | null) => {
    if (id !== latestSelectedIdRef.current) {
      renderedProposalRef.current = null;
      setLoupeStatus("loading");
    }
    latestSelectedIdRef.current = id;
    setSelectedId(id);
  }, []);

  const selectFilter = useCallback((next: Filter) => {
    latestFilterRef.current = next;
    setFilter(next);
  }, []);

  const selectSessionStatus = useCallback((next: StudioHydrationState) => {
    sessionStatusRef.current = next;
    setSessionStatus(next);
  }, []);

  const pauseSaving = useCallback(
    (error: unknown) => {
      if (!mountedRef.current) return;
      // Freeze synchronously before React renders or any queued ingest/bridge callback runs.
      selectSessionStatus("conflicted");
      setSaveFailure(
        error instanceof Error ? error.message : "Local storage could not save this shoot.",
      );
      folderAbortRef.current?.abort();
      folderAbortRef.current = null;
      importRunRef.current++;
      importAbortRef.current?.abort();
      importAbortRef.current = null;
      importingRef.current = false;
      setLinked(false);
      setProgress(null);
      setFolderStatus(null);
    },
    [selectSessionStatus],
  );

  useEffect(
    () =>
      registerAccountLeave?.(async () => {
        if (sessionStatusRef.current !== "ready")
          throw new Error(
            "Wait for your shoot to load, or resolve its paused save before signing out.",
          );
        if (importingRef.current || progress || folderStatus || busy || proposalRef.current)
          throw new Error("Finish or cancel the current import or preview before signing out.");
        try {
          await saveStoredSession(
            latestShotsRef.current,
            latestSelectedIdRef.current,
            latestFilterRef.current,
          );
        } catch (error) {
          pauseSaving(error);
          throw new Error(
            "Your shoot could not be saved. Resolve the save warning before signing out.",
          );
        }
        return true;
      }),
    [registerAccountLeave, saveStoredSession, pauseSaving, progress, folderStatus, busy],
  );

  const showProposal = useCallback(
    (next: StudioProposal) => {
      renderedProposalRef.current = null;
      setLoupeStatus("loading");
      proposalRef.current = next;
      setProposal(next);
      setCompareBefore(false);
      if (!next.frames.some((frame) => frame.id === latestSelectedIdRef.current)) {
        selectFilter("all");
        selectShot(next.frames[0]?.id ?? null);
      }
      return `Preview ready: ${next.title} for ${next.frames.length.toLocaleString()} photo${next.frames.length === 1 ? "" : "s"}. Review it, then apply or discard. Nothing has been changed.`;
    },
    [selectFilter, selectShot],
  );

  const discardProposal = useCallback(() => {
    renderedProposalRef.current = null;
    proposalRef.current = null;
    recipeRef.current = null;
    setProposal(null);
    setCompareBefore(false);
    setSyncNote((note) =>
      note?.startsWith("Preview ready:") || note?.startsWith("Apply or discard") ? null : note,
    );
    return "Preview discarded. Your photos and picks are unchanged.";
  }, []);

  const stageRecipe = useCallback(
    (recipe: EditRecipe) => {
      if (!canPersistStudioSession(sessionStatusRef.current))
        throw new Error("Resolve the paused save before previewing changes.");
      if (importingRef.current && recipe.target !== "selected")
        throw new Error(
          "Let ingest finish before previewing a whole batch. You can edit the open photo now.",
        );
      const next = proposeEdits(
        latestShotsRef.current,
        latestSelectedIdRef.current,
        recipe.target,
        recipe.transform,
        recipe,
      );
      recipeRef.current = recipe;
      return showProposal(next);
    },
    [showProposal],
  );

  const stageCreativeEdit = useCallback(
    (plan: CreativeEditPlan) =>
      stageRecipe({
        target: plan.target,
        title: plan.title,
        description: plan.description,
        limitations: plan.limitations,
        transform: (shot) => applyCreativeEdit(shot.edits, plan),
      }),
    [stageRecipe],
  );

  const stageAdobeSettings = useCallback(
    (plan: AdobeSettingsPastePlan) =>
      stageRecipe({
        target: "selected",
        title: plan.name,
        description: plan.summary,
        limitations: plan.warnings,
        transform: (shot) => ({ ...shot.edits, ...plan.edits }),
      }),
    [stageRecipe],
  );

  const stageCull = useCallback(
    (decide: (shot: Shot) => Verdict, title: string, description: string) => {
      if (!canPersistStudioSession(sessionStatusRef.current))
        throw new Error("Resolve the paused save before previewing selections.");
      if (importingRef.current)
        throw new Error(
          "Let ingest finish before suggesting changes to the whole shoot. You can keep reviewing arriving frames.",
        );
      recipeRef.current = null;
      return showProposal(proposeCull(latestShotsRef.current, decide, { title, description }));
    },
    [showProposal],
  );

  useEffect(() => setFaceEngine(faceDetectionAvailable()), []);

  useEffect(() => {
    // Fast Refresh replays effects while preserving this live shoot and its refs.
    // Only the first hydration may replace in-memory state.
    if (hydrationCompletedRef.current) return;
    let alive = true;
    void loadStoredSession()
      .then((session) => {
        if (!alive) {
          if (session) {
            for (const shot of session.shots) {
              if (shot.previewUrl) URL.revokeObjectURL(shot.previewUrl);
            }
          }
          return;
        }
        if (latestShotsRef.current.length || importRunRef.current > 0) {
          // Imports are gated while hydration is pending. If an import still
          // raced in, preserve the stored session and keep persistence paused.
          if (session) {
            for (const shot of session.shots) {
              if (shot.previewUrl) URL.revokeObjectURL(shot.previewUrl);
            }
          }
          selectSessionStatus("failed");
          hydrationRecoveryRef.current = false;
          setSyncNote(
            "The saved Studio session was not replaced because an import started while it was opening. Reload to restore it, or choose New Shoot to replace it explicitly.",
          );
          return;
        }
        if (!session) {
          hydrationRecoveryRef.current = false;
          selectSessionStatus("ready");
          return;
        }
        for (const shot of session.shots) {
          if (shot.previewUrl) previewUrlsRef.current.add(shot.previewUrl);
        }
        const restored = restoreStudioRuntime(runtimeKey, session.shots);
        undoRef.current = restored.undo as UndoCheckpoint[];
        updateShots(() => restored.shots);
        selectShot(session.selectedId ?? session.shots[0]?.id ?? null);
        selectFilter(session.filter);
        hydrationRecoveryRef.current = false;
        selectSessionStatus("ready");
        setSyncNote(
          `${session.shots.length} saved frame${session.shots.length === 1 ? "" : "s"} restored · ${session.shots.some((shot) => shot.sourceAvailable === false) ? "reconnect missing originals before high-resolution export." : "original files available on this device."}`,
        );
      })
      .catch(() => {
        if (alive) {
          hydrationRecoveryRef.current = true;
          selectSessionStatus("failed");
          setSyncNote(
            "Local session could not be restored. Saving is paused so the stored snapshot stays untouched; reload, or choose New Shoot to replace it explicitly.",
          );
        }
      })
      .finally(() => {
        if (alive) {
          hydrationCompletedRef.current = true;
          hydrationGateRef.current?.resolve();
        }
      });
    return () => {
      alive = false;
    };
  }, [loadStoredSession, runtimeKey, selectFilter, selectSessionStatus, selectShot, updateShots]);

  useEffect(() => {
    if (!canPersistStudioSession(sessionStatus) || shots.length === 0) return;
    const timer = window.setTimeout(() => {
      if (canPersistStudioSession(sessionStatusRef.current))
        void saveStoredSession(shots, selectedId, filter).catch(pauseSaving);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [filter, selectedId, sessionStatus, shots, saveStoredSession, pauseSaving]);

  useEffect(() => {
    if (!canPersistStudioSession(sessionStatus)) return;
    const flush = () => {
      if (
        !canPersistStudioSession(sessionStatusRef.current) ||
        latestShotsRef.current.length === 0
      ) {
        return;
      }
      void saveStoredSession(
        latestShotsRef.current,
        latestSelectedIdRef.current,
        latestFilterRef.current,
      ).catch(pauseSaving);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flush();
    };
  }, [sessionStatus, saveStoredSession, pauseSaving]);

  useEffect(() => {
    const bitmaps = bitmapCache.current;
    const bitmapPromises = bitmapPromisesRef.current;
    const previewUrls = previewUrlsRef.current;
    if (resourceCleanupRef.current !== null) clearTimeout(resourceCleanupRef.current);
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (canPersistStudioSession(sessionStatusRef.current))
        rememberStudioRuntime(runtimeKey, latestShotsRef.current, undoRef.current);
      // Defer disposal one turn so Strict Mode / Fast Refresh can reconnect.
      // Actual unmounts still release all resources and cancel pending ingest.
      resourceCleanupRef.current = setTimeout(() => {
        folderAbortRef.current?.abort();
        importAbortRef.current?.abort();
        disposeAnalysisWorkers();
        for (const bitmap of bitmaps.values()) bitmap.close?.();
        bitmaps.clear();
        bitmapPromises.clear();
        for (const url of previewUrls) URL.revokeObjectURL(url);
        previewUrls.clear();
      }, 0);
    };
  }, [runtimeKey]);

  const checkpoint = useCallback(() => {
    if (!canPersistStudioSession(sessionStatusRef.current)) return;
    undoRef.current.push({
      selectedId: latestSelectedIdRef.current,
      frames: latestShotsRef.current.map((shot) => ({
        id: shot.id,
        verdict: shot.verdict,
        edits: { ...shot.edits },
      })),
    });
    if (undoRef.current.length > 30) undoRef.current.shift();
  }, []);

  const applyReviewedProposal = useCallback(() => {
    const pending = proposalRef.current;
    if (!pending) return "There is no preview waiting to be applied.";
    if (!canPersistStudioSession(sessionStatusRef.current))
      throw new Error("Wait until your saved session is available before applying changes.");
    if (importingRef.current && (pending.kind === "cull" || pending.target !== "selected"))
      throw new Error("Finish ingest before accepting batch changes.");
    if (!pending.frames.some((frame) => frame.id === latestSelectedIdRef.current)) {
      const firstFrame = pending.frames[0];
      if (!firstFrame) throw new Error("No changes are waiting to be applied.");
      selectFilter("all");
      selectShot(firstFrame.id);
      throw new Error("Opened a photo from this preview. Review it before applying the changes.");
    }
    const rendered = renderedProposalRef.current;
    if (rendered?.proposal !== pending || rendered.shotId !== latestSelectedIdRef.current)
      throw new Error(
        "Wait for the proposed photo to finish rendering before applying. If the preview fails, reconnect its source or discard the proposal.",
      );
    const next = applyProposal(latestShotsRef.current, pending);
    checkpoint();
    updateShots(() => next);
    discardProposal();
    const receipt = `${pending.kind === "edit" ? "Applied the edit to" : "Accepted suggestions for"} ${pending.frames.length.toLocaleString()} photo${pending.frames.length === 1 ? "" : "s"}. Undo is available; originals are untouched.`;
    setSyncNote(receipt);
    return receipt;
  }, [checkpoint, discardProposal, selectFilter, selectShot, updateShots]);

  const changeProposalTarget = useCallback(
    (target: EditTarget) => {
      const recipe = recipeRef.current;
      if (!recipe) return;
      try {
        stageRecipe({ ...recipe, target });
      } catch (error) {
        setSyncNote(error instanceof Error ? error.message : "Could not change the preview scope.");
      }
    },
    [stageRecipe],
  );

  const undoLast = useCallback(() => {
    if (!canPersistStudioSession(sessionStatusRef.current)) return false;
    if (proposalRef.current) {
      discardProposal();
      return true;
    }
    const previous = undoRef.current.pop();
    if (!previous) return false;
    const states = new Map(previous.frames.map((frame) => [frame.id, frame]));
    const restoredShots = latestShotsRef.current.map((shot) => {
      const state = states.get(shot.id);
      return state ? { ...shot, verdict: state.verdict, edits: { ...state.edits } } : shot;
    });
    latestShotsRef.current = restoredShots;
    setShots(restoredShots);
    const restoredSelection = restoredShots.some((shot) => shot.id === previous.selectedId)
      ? previous.selectedId
      : (restoredShots[0]?.id ?? null);
    selectShot(restoredSelection);
    setSyncNote("Restored the previous edits and picks. Originals are untouched.");
    return true;
  }, [discardProposal, selectShot]);

  /* ---------------- import ---------------- */
  const importFiles = useCallback(
    async (files: File[], sourceSignal?: AbortSignal) => {
      const requestedRun = importRunRef.current;
      if (sourceSignal?.aborted) return;
      if (folderAbortRef.current && folderAbortRef.current.signal !== sourceSignal) {
        setSyncNote("A folder is being read. Finish or stop it before adding more photos.");
        return;
      }
      if (sessionStatusRef.current === "loading") {
        setProgress({ done: 0, total: uniquePhotos(files).length });
        setSyncNote("Opening the saved Studio session before adding these files…");
        await hydrationGateRef.current?.promise;
      }
      if (!mountedRef.current || sourceSignal?.aborted || requestedRun !== importRunRef.current)
        return;
      if (sessionStatusRef.current === "failed" || sessionStatusRef.current === "conflicted") {
        setProgress(null);
        setSyncNote(
          "Studio is not saving. Reload before importing; if the saved session is unreadable, choose New Shoot to replace it explicitly.",
        );
        return;
      }
      if (sessionStatusRef.current === "clearing") {
        setSyncNote("Wait for the saved Studio session operation to finish first.");
        return;
      }
      if (importingRef.current) {
        setSyncNote("A folder is still importing. Finish or cancel it before adding another.");
        return;
      }
      importingRef.current = true;
      const selectedPhotos = uniquePhotos(files);
      const folderName = files[0]?.webkitRelativePath.split("/").slice(0, -1)[0];
      setImportAttachment({
        name:
          folderName ||
          (files.length === 1 ? files[0]!.name : `${files.length.toLocaleString()} selected files`),
        kind: folderName ? "folder" : "files",
        count: selectedPhotos.length,
        ...(!folderName &&
        selectedPhotos.length === 1 &&
        /^image\/(jpeg|png|webp|gif|avif)$/.test(selectedPhotos[0]!.type)
          ? { preview: selectedPhotos[0] }
          : {}),
      });
      const abortController = new AbortController();
      importAbortRef.current = abortController;
      const importRun = ++importRunRef.current;
      setProgress({ done: 0, total: uniquePhotos(files).length });
      // Lightroom folders carry .xmp sidecars next to the negatives.
      const sidecarFiles = preferences.importSidecars
        ? files.filter((f) => f.name.toLowerCase().endsWith(".xmp"))
        : [];
      let sidecarResult: Awaited<ReturnType<typeof readImportSidecars>>;
      try {
        sidecarResult = await readImportSidecars(sidecarFiles, abortController.signal);
      } catch {
        if (mountedRef.current && importRunRef.current === importRun) {
          importingRef.current = false;
          importAbortRef.current = null;
          setProgress(null);
          setSyncNote("Sidecar import stopped. Existing photos and decisions are unchanged.");
        }
        return;
      }
      const sidecars = sidecarResult.values;
      let sidecarNotice = sidecarReadNotice(sidecarResult, files);
      files = uniquePhotos(files);
      const identities = createIngestResolver(files, latestShotsRef.current);
      let ambiguousSourceSidecars = 0;
      for (const key of identities.ambiguousSidecarKeys) {
        if (sidecars.delete(key)) ambiguousSourceSidecars++;
      }
      if (ambiguousSourceSidecars)
        sidecarNotice = [
          sidecarNotice,
          `${ambiguousSourceSidecars} sidecar target${ambiguousSourceSidecars === 1 ? "" : "s"} shared by colliding photo names skipped; their metadata was not applied`,
        ]
          .filter(Boolean)
          .join(" · ");
      if (!mountedRef.current || importRunRef.current !== importRun) return;
      if (sidecars.size || sidecarNotice) {
        setSyncNote(
          `${sidecars.size} sidecar${sidecars.size === 1 ? "" : "s"} read for exact folder/name matching${sidecarNotice ? ` · ${sidecarNotice}` : ""}.`,
        );
      }
      if (!files.length) {
        importingRef.current = false;
        importAbortRef.current = null;
        setProgress(null);
        setSyncNote(
          `No supported photos found. Choose RAW, JPEG, or other browser-readable images.${sidecarNotice ? ` ${sidecarNotice}.` : ""}`,
        );
        return;
      }
      setProgress({ done: 0, total: files.length });
      const started = performance.now();
      const added: Shot[] = new Array(files.length);
      let doneCount = 0;
      let firstPreviewMs: number | null = null;
      let lastPublishedAt = 0;
      let nativeFrames = 0;
      let nativeCacheHits = 0;
      let skippedReconnects = 0;
      let legacyReconnects = 0;
      let verifiedRepeatInputs = 0;
      let unverifiedCollisionInputs = 0;
      const pending = new Map<string, Shot>();

      const publishPreviews = () => {
        if (!pending.size || !mountedRef.current || importRunRef.current !== importRun) return;
        const batch = [...pending.values()];
        pending.clear();
        const prior = new Map(latestShotsRef.current.map((shot) => [shot.id, shot]));
        updateShots((previous) => mergeIngestedShots(previous, batch));
        const accepted = new Map(latestShotsRef.current.map((shot) => [shot.id, shot]));
        for (const shot of batch) {
          const old = prior.get(shot.id);
          if (accepted.get(shot.id)?.file !== shot.file || accepted.get(shot.id) === old) {
            if (shot.previewUrl && shot.previewUrl !== old?.previewUrl) {
              URL.revokeObjectURL(shot.previewUrl);
              previewUrlsRef.current.delete(shot.previewUrl);
            }
            continue;
          }
          if (old?.previewUrl && old.previewUrl !== shot.previewUrl) {
            URL.revokeObjectURL(old.previewUrl);
            previewUrlsRef.current.delete(old.previewUrl);
          }
          bitmapCache.current.get(shot.id)?.close?.();
          bitmapCache.current.delete(shot.id);
          bitmapPromisesRef.current.delete(shot.id);
        }
        if (!latestSelectedIdRef.current) selectShot(batch[0]?.id ?? null);
        if (firstPreviewMs === null && batch.some((shot) => shot.previewUrl)) {
          firstPreviewMs = performance.now() - started;
        }
        lastPublishedAt = performance.now();
      };

      const one = async (i: number) => {
        if (!mountedRef.current || importRunRef.current !== importRun) return;
        const file = files[i]!;
        let id = stableShotId(file);
        const raw = isRawFile(file);
        let sourceDigest: string | undefined;
        try {
          const prepared = await identities.prepare(file, abortController.signal);
          if (!prepared) {
            verifiedRepeatInputs++;
            return;
          }
          id = prepared.id;
          sourceDigest = prepared.sourceDigest;
          if (!mountedRef.current || importRunRef.current !== importRun) return;
          const result = await analyseFile(file, { signal: abortController.signal });
          if (!mountedRef.current || importRunRef.current !== importRun) return;
          const { analysis } = result;
          if (result.backend === "native-cpp") {
            nativeFrames++;
            if (result.nativeCached) nativeCacheHits++;
          }
          const faces = analysis.faces;
          const { score, flags } = scoreOf(analysis);

          const sidecar = sidecars.get(sidecarKey(file));
          const parsed = sidecar ? parseXmpSidecar(sidecar) : null;

          const blob = result.previewBlob;
          const url = URL.createObjectURL(blob);

          added[i] = {
            id,
            file,
            name: file.name,
            relativePath:
              (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
            isRaw: raw,
            captureTimeMs: result.captureTimeMs,
            captureTimeBasis: result.captureTimeBasis,
            cameraKey: result.cameraKey,
            analysisBackend: result.backend,
            previewUrl: url,
            previewBlob: blob ?? undefined,
            sourceAvailable: true,
            sourceDigest,
            width: result.width,
            height: result.height,
            sizeMb: file.size / 1e6,
            sharpness: analysis.sharpness,
            brightness: analysis.brightness,
            clippedHighlights: analysis.clippedHighlights,
            clippedShadows: analysis.clippedShadows,
            hash: analysis.hash,
            tone: analysis.tone,
            score,
            flags,
            verdict: importedReviewVerdict(parsed),
            edits: { ...DEFAULT_EDITS, ...(parsed?.edits ?? {}) },
            faces: faces ?? undefined,
            develop: parsed
              ? {
                  origin: "sidecar",
                  at: Date.now(),
                  rating: parsed.rating ?? undefined,
                  label: parsed.label,
                }
              : undefined,
          };
          if (url) previewUrlsRef.current.add(url);
        } catch (err) {
          if (!mountedRef.current || importRunRef.current !== importRun) return;
          if (err instanceof SourceReconnectError || identities.hasExisting(file)) {
            skippedReconnects++;
            if (err instanceof SourceReconnectError && err.reason === "unverified")
              legacyReconnects++;
            return;
          }
          if (!sourceDigest && identities.hasCollision(file)) {
            // No trustworthy ID can be assigned to unreadable colliding sources.
            unverifiedCollisionInputs++;
            return;
          }
          added[i] = {
            id,
            file,
            name: file.name,
            relativePath:
              (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
            isRaw: raw,
            previewUrl: null,
            sourceAvailable: true,
            sourceDigest,
            width: 0,
            height: 0,
            sizeMb: file.size / 1e6,
            sharpness: 0,
            brightness: 0,
            clippedHighlights: 0,
            clippedShadows: 0,
            hash: "",
            score: 0,
            flags: [],
            verdict: "undecided",
            edits: { ...DEFAULT_EDITS },
            error: err instanceof Error ? err.message : "Could not read this file",
          };
        } finally {
          doneCount++;
          if (mountedRef.current && importRunRef.current === importRun) {
            if (added[i]) pending.set(added[i]!.id, added[i]!);
            if (doneCount === 1 || performance.now() - lastPublishedAt >= 100) publishPreviews();
            setProgress({ done: doneCount, total: files.length });
          }
        }
      };

      // RAW decoders are memory-heavy, so keep those shoots deliberately narrow.
      const lanes = importLanes(
        files.some(isRawFile),
        navigator.hardwareConcurrency,
        preferences.processingSpeed,
      );
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(lanes, files.length) }, async () => {
          while (cursor < files.length && mountedRef.current && importRunRef.current === importRun)
            await one(cursor++);
        }),
      );

      const batch = added.filter(Boolean);
      if (!mountedRef.current || importRunRef.current !== importRun) {
        const visibleUrls = new Set(latestShotsRef.current.map((shot) => shot.previewUrl));
        for (const shot of batch) {
          if (shot.previewUrl && !visibleUrls.has(shot.previewUrl)) {
            URL.revokeObjectURL(shot.previewUrl);
            previewUrlsRef.current.delete(shot.previewUrl);
          }
        }
        return;
      }
      publishPreviews();
      updateShots((next) => {
        const { duplicateIds } = indexDuplicateFrames(next);
        return next.map((shot) => ({
          ...shot,
          flags: [
            ...shot.flags.filter((flag) => flag !== "duplicate"),
            ...(duplicateIds.has(shot.id) ? ["duplicate" as const] : []),
          ],
        }));
      });
      importingRef.current = false;
      importAbortRef.current = null;
      setProgress(null);
      if (!latestSelectedIdRef.current) selectShot(batch[0]?.id ?? null);
      const secs = (performance.now() - started) / 1000;
      const successes = batch.filter((shot) => !shot.error).length;
      const summary = `${successes} frame${successes === 1 ? "" : "s"} read in ${secs.toFixed(1)}s · ${Math.round(successes / Math.max(secs, 0.001))}/sec${firstPreviewMs === null ? "" : ` · first preview ${(firstPreviewMs / 1000).toFixed(2)}s`}${nativeFrames ? ` · C++ ${nativeFrames}${nativeCacheHits ? ` (${nativeCacheHits} cached)` : ""}` : " · browser engine"}${successes < batch.length ? ` · ${batch.length - successes} unreadable; retained for review` : ""}`;
      setSyncNote(
        `${summary}${sidecarNotice ? ` · ${sidecarNotice}` : ""}${verifiedRepeatInputs ? ` · ${verifiedRepeatInputs} repeated input${verifiedRepeatInputs === 1 ? "" : "s"} verified byte-for-byte` : ""}${unverifiedCollisionInputs ? ` · ${unverifiedCollisionInputs} same-name source${unverifiedCollisionInputs === 1 ? "" : "s"} could not be verified; skipped without changing originals` : ""}${skippedReconnects ? ` · ${skippedReconnects} source reconnect${skippedReconnects === 1 ? "" : "s"} could not be verified; saved photos, picks and edits preserved` : ""}${legacyReconnects ? ` · ${legacyReconnects} older preview${legacyReconnects === 1 ? " has" : "s have"} no original fingerprint; import into a separate shoot to review` : ""}`,
      );
      // Import starts the mechanical first pass, but never accepts it for the
      // photographer or displaces a preview they are already working on.
      if (!proposalRef.current && batch.some((shot) => !shot.error)) {
        try {
          stageCull(
            firstPassVerdict,
            "First pass ready",
            "Sharpness, exposure and similarity checked. Review these suggestions; your existing picks are protected.",
          );
        } catch {
          /* No eligible change: imported photos remain available. */
        }
      }
    },
    [selectShot, stageCull, updateShots, preferences.importSidecars, preferences.processingSpeed],
  );

  /* ---------------- Lightroom live bridge ---------------- */
  const lastBridgeAt = useRef(0);

  const mergeBridge = useCallback(
    (state: BridgeState) => {
      const result = mergeLightroomFrames(latestShotsRef.current, state.frames, Date.now());
      if (result.matched) updateShots(() => result.shots);
      return result;
    },
    [updateShots],
  );

  const pullFromLightroom = useCallback(
    async (quiet = false) => {
      if (!canPersistStudioSession(sessionStatusRef.current)) return;
      if (proposalRef.current) {
        if (!quiet) setSyncNote("Apply or discard the preview before syncing from Lightroom.");
        return;
      }
      const snapshot = latestShotsRef.current;
      try {
        const res = await bridgeFetch(`${bridgeEndpoint()}?side=studio`, { cache: "no-store" });
        if (!res.ok) throw new Error("The Lightroom bridge did not accept the request.");
        const state = (await res.json()) as BridgeState;
        if (!Number.isFinite(state.at) || state.at <= 0 || state.at === lastBridgeAt.current)
          return;
        // A pending request must not overwrite a newer edit, proposal or shoot.
        if (
          snapshot !== latestShotsRef.current ||
          proposalRef.current ||
          !canPersistStudioSession(sessionStatusRef.current)
        )
          return;
        const result = mergeBridge(state);
        if (result.matched) {
          lastBridgeAt.current = state.at;
          setSyncNote(
            `Lightroom matched ${result.matched} photo${result.matched === 1 ? "" : "s"} by folder path; ${result.unmatched} unmatched. Develop settings, stars and IPTC applied.`,
          );
        } else if (state.frames.length)
          setSyncNote(
            "No matching Lightroom source paths. Import the matching folder; filenames alone are not used.",
          );
      } catch (error) {
        if (error instanceof Error) setSyncNote(error.message);
        else if (!quiet) setSyncNote("LensLabs bridge unreachable — is the studio server running?");
      }
    },
    [mergeBridge],
  );

  useEffect(() => {
    if (!linked) return;
    void pullFromLightroom(true);
    const t = setInterval(() => void pullFromLightroom(true), 4000);
    return () => clearInterval(t);
  }, [linked, pullFromLightroom]);

  /** Publish LensLabs verdicts so the plugin's "Pull" writes them into the catalog. */
  const pushToLightroom = useCallback(async () => {
    if (!canPersistStudioSession(sessionStatusRef.current)) {
      setSyncNote("Resolve the paused save before publishing changes to Lightroom.");
      return;
    }
    if (proposalRef.current) {
      setSyncNote("Apply or discard the preview before publishing changes to Lightroom.");
      return;
    }
    try {
      const frames = createLightroomVerdicts(latestShotsRef.current);
      const res = await bridgeFetch(bridgeEndpoint(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: `verdicts-${LIGHTROOM_MATCHING}`,
          direction: "to-lightroom",
          frames,
        }),
      });
      if (!res.ok)
        throw new Error(
          "Could not queue folder-matched verdicts. Check that the deployed bridge and Lightroom plug-in are updated.",
        );
      setSyncNote(
        `${frames.length} frames queued, not yet applied. In Lightroom plug-in 1.3 or newer, run Plug-in Extras → “Pull LensLabs verdicts”.`,
      );
    } catch (error) {
      setSyncNote(
        error instanceof Error
          ? error.message
          : "Could not reach the LensLabs bridge to publish verdicts.",
      );
    }
  }, []);

  /* ---------------- derived ---------------- */
  const visible = useMemo(() => {
    switch (filter) {
      case "keepers":
        return shots.filter((s) => s.verdict === "keep");
      case "rejected":
        return shots.filter((s) => s.verdict === "reject");
      case "flagged":
        return shots.filter((s) => s.flags.length > 0);
      case "todo":
        return shots.filter((s) => s.verdict === "undecided");
      default:
        return shots;
    }
  }, [shots, filter]);

  const selected = shots.find((s) => s.id === selectedId) ?? null;
  const counts = useMemo(
    () => ({
      all: shots.length,
      keepers: shots.filter((s) => s.verdict === "keep").length,
      rejected: shots.filter((s) => s.verdict === "reject").length,
      flagged: shots.filter((s) => s.flags.length > 0).length,
      todo: shots.filter((s) => s.verdict === "undecided").length,
    }),
    [shots],
  );

  /* ---------------- loupe render ---------------- */
  const getBitmap = useCallback(async (shot: Shot) => {
    const cached = bitmapCache.current.get(shot.id);
    if (cached) return cached;
    const pending = bitmapPromisesRef.current.get(shot.id);
    if (pending) return pending;

    const promise = decodeFile(shot.file, 1800)
      .then((bmp) => {
        const current = latestShotsRef.current.find((candidate) => candidate.id === shot.id);
        if (!mountedRef.current || current?.file !== shot.file) {
          bmp.close?.();
          throw new Error("Preview source changed before decoding finished");
        }
        if (bitmapCache.current.size > 4) {
          const [firstKey] = bitmapCache.current.keys();
          const old = bitmapCache.current.get(firstKey!);
          old?.close?.();
          bitmapCache.current.delete(firstKey!);
        }
        bitmapCache.current.set(shot.id, bmp);
        return bmp;
      })
      .finally(() => {
        if (bitmapPromisesRef.current.get(shot.id) === promise) {
          bitmapPromisesRef.current.delete(shot.id);
        }
      });
    bitmapPromisesRef.current.set(shot.id, promise);
    return promise;
  }, []);

  useEffect(() => {
    let cancelled = false;
    renderedProposalRef.current = null;
    const canvas = canvasRef.current;
    if (!selected || selected.error || !canvas) {
      setLoupeStatus(selected?.error ? "failed" : "loading");
      return;
    }
    setLoupeStatus("loading");
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    (async () => {
      try {
        const bmp = await getBitmap(selected);
        if (cancelled) return;
        const preview = proposalFrames.get(selected.id);
        const edits =
          preview && proposal?.kind === "edit"
            ? compareBefore
              ? preview.beforeEdits
              : preview.afterEdits
            : selected.edits;
        renderToCanvas(canvas, bmp, edits, 1400, selected.faces?.center ?? null);
        setBins(histogram(canvas));
        if (proposal && preview) renderedProposalRef.current = { proposal, shotId: selected.id };
        setLoupeStatus("ready");
      } catch {
        if (!cancelled) {
          canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
          setLoupeStatus("failed");
          setBins([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, getBitmap, proposalFrames, proposal, compareBefore]);

  /* ---------------- actions ---------------- */
  const setVerdict = useCallback(
    (id: string, verdict: Verdict, advance = true) => {
      if (!canPersistStudioSession(sessionStatusRef.current)) return;
      checkpoint();
      updateShots((prev) => prev.map((s) => (s.id === id ? { ...s, verdict } : s)));
      if (!advance) return;
      const idx = visible.findIndex((s) => s.id === id);
      const next = visible[idx + 1];
      if (next) selectShot(next.id);
    },
    [checkpoint, selectShot, updateShots, visible],
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      if (!selectedId) return;
      const idx = visible.findIndex((s) => s.id === selectedId);
      const next = visible[idx + dir];
      if (next) selectShot(next.id);
    },
    [selectShot, visible, selectedId],
  );

  const updateEdits = (patch: Partial<Edits>) => {
    if (!canPersistStudioSession(sessionStatusRef.current)) return;
    if (!selected) return;
    updateShots((prev) =>
      prev.map((s) => (s.id === selected.id ? { ...s, edits: { ...s.edits, ...patch } } : s)),
    );
  };

  /** Lightroom-style Auto: derive develop settings from the frame's own histogram. */
  const autoRefineOne = (id?: string) => {
    if (!canPersistStudioSession(sessionStatusRef.current)) return;
    const target = id ?? selectedId;
    if (!target) return;
    updateShots((prev) =>
      prev.map((s) =>
        s.id === target && !s.error && s.tone ? { ...s, edits: autoRefine(s.tone, s.edits) } : s,
      ),
    );
  };

  const autoRefineMany = (scope: "keepers" | "all") => {
    if (!canPersistStudioSession(sessionStatusRef.current)) return 0;
    let n = 0;
    updateShots((prev) =>
      prev.map((s) => {
        if (s.error || !s.tone) return s;
        if (scope === "keepers" && s.verdict !== "keep") return s;
        n++;
        return { ...s, edits: autoRefine(s.tone, s.edits) };
      }),
    );
    return n;
  };

  const autoCull = () => {
    try {
      const receipt = stageCull(
        firstPassVerdict,
        "Suggested selections",
        "Review recommendations for undecided photos. Your existing keeps and rejects are protected.",
      );
      setSyncNote(receipt);
    } catch (error) {
      setSyncNote(error instanceof Error ? error.message : "Could not suggest selections.");
    }
  };

  const exportOne = async () => {
    if (proposalRef.current) {
      setSyncNote(
        "Apply or discard the preview before exporting, so the exported image matches your decision.",
      );
      return;
    }
    if (!selected || selected.error) return;
    if (selected.sourceAvailable === false) {
      setSyncNote("Reconnect the original source folder before high-resolution JPEG export.");
      return;
    }
    setBusy("Exporting…");
    let bmp: ImageBitmap | null = null;
    try {
      bmp = await decodeFile(selected.file);
      await exportShot(bmp, selected.edits, selected.name, selected.faces?.center ?? null);
    } catch (error) {
      setSyncNote(error instanceof Error ? error.message : "Could not export this frame.");
    } finally {
      bmp?.close?.();
      setBusy(null);
    }
  };

  const exportKeepers = async (): Promise<number> => {
    if (proposalRef.current) {
      setSyncNote("Apply or discard the preview before exporting.");
      return 0;
    }
    const disconnected = latestShotsRef.current.filter(
      (shot) => shot.verdict === "keep" && shot.sourceAvailable === false,
    ).length;
    if (disconnected) {
      setSyncNote(
        `${disconnected} keeper${disconnected === 1 ? " needs" : "s need"} the original source folder reconnected before export.`,
      );
      return 0;
    }
    const keepers = latestShotsRef.current.filter((s) => s.verdict === "keep" && !s.error);
    let exported = 0;
    try {
      for (let i = 0; i < keepers.length; i++) {
        const keeper = keepers[i]!;
        setBusy(`Exporting ${i + 1}/${keepers.length}…`);
        let bmp: ImageBitmap | null = null;
        try {
          bmp = await decodeFile(keeper.file);
          await exportShot(bmp, keeper.edits, keeper.name, keeper.faces?.center ?? null);
          exported++;
        } finally {
          bmp?.close?.();
        }
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
    } catch (error) {
      setSyncNote(
        `${exported}/${keepers.length} exported · ${error instanceof Error ? error.message : "export stopped"}`,
      );
    } finally {
      setBusy(null);
    }
    return exported;
  };

  /* ---------------- assistant ---------------- */
  const chatContext = useMemo(() => {
    if (!shots.length) return "No shoot loaded yet. Use import_photos to open the picker.";
    const flagCount: Record<string, number> = {};
    for (const s of shots) for (const f of s.flags) flagCount[f] = (flagCount[f] ?? 0) + 1;
    return [
      `${counts.all} frames · ${counts.keepers} keepers · ${counts.rejected} rejected · ${counts.todo} still undecided`,
      `flags: ${
        Object.entries(flagCount)
          .map(([f, n]) => `${f} ${n}`)
          .join(", ") || "none"
      }`,
      `filter showing: ${filter}`,
      selected
        ? `open frame: ${selected.name} (score ${selected.score}, ${selected.verdict})`
        : "no frame open",
    ].join("\n");
  }, [shots, counts, filter, selected]);

  const executeTool = useCallback(
    async ({ name, args }: ToolCall): Promise<string> => {
      const num = (k: string) =>
        typeof args[k] === "number" && Number.isFinite(args[k]) ? (args[k] as number) : undefined;
      const currentShots = () => latestShotsRef.current;
      const currentSelectedId = () => latestSelectedIdRef.current;
      switch (name) {
        case "import_photos":
          inputRef.current?.click();
          return "file picker opened";
        case "cull": {
          if (importingRef.current)
            return "failed: Ingest is still running. You can review arriving frames now; run the whole-shoot cull after ingest finishes.";
          const min = num("min_score") ?? 45;
          const keepAt = num("keep_score") ?? 70;
          return stageCull(
            (s) => firstPassVerdict(s, { rejectBelow: min, keepAt }),
            "Suggested selections",
            "Suggestions for undecided photos only. Your existing decisions are protected.",
          );
        }
        case "keep_top": {
          if (importingRef.current)
            return "failed: Wait for ingest to finish before ranking the whole shoot. Your current picks are unchanged.";
          const n = Math.max(1, Math.round(num("n") ?? 10));
          const ranked = [...currentShots()]
            .filter((s) => !s.error)
            .sort((a, b) => b.score - a.score)
            .slice(0, n);
          const ids = new Set(ranked.map((s) => s.id));
          return stageCull(
            (s) => (ids.has(s.id) ? "keep" : "reject"),
            `Top ${ids.size} shortlist`,
            "This proposal ranks the whole shoot by measured quality. It may replace existing picks; compare the photos before accepting.",
          );
        }
        case "reject_flagged": {
          if (importingRef.current)
            return "failed: Wait for ingest and duplicate analysis to finish before rejecting flagged frames. Your current picks are unchanged.";
          const flags = (Array.isArray(args["flags"]) ? args["flags"] : []) as Flag[];
          return stageCull(
            (s) => (s.flags.some((f) => flags.includes(f)) ? "reject" : s.verdict),
            "Review flagged photos",
            `Suggest rejecting photos flagged ${flags.join(", ")}. Existing keepers matching those flags are included; you decide.`,
          );
        }
        case "set_filter": {
          const f = String(args["filter"] ?? "all") as Filter;
          if (!["all", "keepers", "flagged", "rejected", "todo"].includes(f))
            return "failed: unknown photo filter";
          selectFilter(f);
          return `showing ${f}`;
        }
        case "select_photo": {
          const q = String(args["query"] ?? "")
            .trim()
            .toLowerCase();
          const pool = currentShots().filter((s) => !s.error);
          if (!pool.length) return "failed: nothing to open";
          let target = pool.find((s) => s.name.toLowerCase().includes(q));
          if (!target && q === "best") target = [...pool].sort((a, b) => b.score - a.score)[0];
          if (!target && q === "worst") target = [...pool].sort((a, b) => a.score - b.score)[0];
          if (!target && /^\d+$/.test(q)) target = pool[Number(q) - 1];
          if (!target) return `failed: no frame matched "${q}"`;
          selectShot(target.id);
          return `opened ${target.name}`;
        }
        case "apply_edits": {
          const patch: Partial<Edits> = {};
          const map: [string, keyof Edits][] = [
            ["exposure", "exposure"],
            ["contrast", "contrast"],
            ["temperature", "temp"],
            ["saturation", "saturation"],
            ["highlights", "highlights"],
            ["shadows", "shadows"],
          ];
          for (const [from, to] of map) {
            const v = num(from);
            if (v !== undefined)
              (patch as Record<string, unknown>)[to] = Math.max(-100, Math.min(100, v));
          }
          if (typeof args["crop"] === "string" && CROPS.includes(args["crop"] as Edits["crop"]))
            patch.crop = args["crop"] as Edits["crop"];
          if (!Object.keys(patch).length) return "failed: no supported settings given";
          const target =
            args["target"] === "all"
              ? "all"
              : args["target"] === "keepers"
                ? "keepers"
                : "selected";
          return stageRecipe({
            target,
            title: "Proposed look",
            description: "Preview these light, color and framing adjustments before saving them.",
            transform: (s) => ({ ...s.edits, ...patch }),
          });
        }
        case "auto_refine": {
          const scope =
            args["target"] === "selected"
              ? "selected"
              : args["target"] === "all"
                ? "all"
                : "keepers";
          return stageRecipe({
            target: scope,
            title: "Balanced light and color",
            description:
              "Gently balance each photo using its own measured light and color. This is a starting point for your eye, not a learned style.",
            transform: (s) => (s.tone ? autoRefine(s.tone, s.edits) : { ...s.edits }),
          });
        }
        case "export_keepers": {
          if (proposalRef.current) return "failed: Apply or discard the preview before exporting.";
          const n = currentShots().filter((s) => s.verdict === "keep" && !s.error).length;
          if (!n) return "failed: no keepers to export";
          const exported = await exportKeepers();
          return exported === n
            ? `exported ${exported} keeper${exported === 1 ? "" : "s"}`
            : `exported ${exported}/${n} keepers`;
        }
        case "write_xmp": {
          if (proposalRef.current)
            return "failed: Apply or discard the preview before writing sidecars.";
          const n = currentShots().filter((s) => s.verdict !== "undecided" && !s.error).length;
          if (!n) return "failed: nothing decided yet";
          return exportSidecars();
        }
        case "undo_last":
          if (proposalRef.current) return discardProposal();
          return undoLast() ? "restored the previous studio state" : "nothing to undo";
        default:
          return "failed: unknown tool";
      }
    },
    [discardProposal, selectFilter, selectShot, stageCull, stageRecipe, undoLast],
  );

  /** Download one validated archive; never flatten folders or overwrite originals. */

  const exportSidecars = () => {
    if (proposalRef.current) {
      setSyncNote("Apply or discard the preview before writing sidecars.");
      return "failed: Apply or discard the preview before writing sidecars.";
    }
    try {
      const { blob, sidecarCount, photoCount } = createSidecarArchive(latestShotsRef.current);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "LensLabs-sidecars.zip";
      document.body.appendChild(a);
      try {
        a.click();
      } finally {
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      const note = `Requested one ZIP download: ${sidecarCount} sidecar${sidecarCount === 1 ? "" : "s"} for ${photoCount} photo${photoCount === 1 ? "" : "s"}, with original folder paths. Extract separately and back up existing XMP before placing sidecars beside the matching originals. Only supported settings are included; then re-read metadata in your editor.`;
      setSyncNote(note);
      return note;
    } catch (error) {
      const note =
        error instanceof Error
          ? error.message
          : "Sidecar export failed. Your originals are unchanged.";
      setSyncNote(note);
      return `failed: ${note}`;
    }
  };

  /* ---------------- keyboard ---------------- */
  useEffect(() => {
    const exportRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ project: string; respond: (note: string) => void }>)
        .detail;
      const expected = shootId === "legacy" ? "current" : (shootId ?? projectId ?? "current");
      if (detail?.project !== expected || typeof detail.respond !== "function") return;
      if (sessionStatusRef.current !== "ready" || importingRef.current) {
        detail.respond("Wait for the shoot to finish loading or importing before exporting.");
        return;
      }
      detail.respond(exportSidecars());
    };
    window.addEventListener("lenslabs:export-adobe", exportRequest);
    return () => window.removeEventListener("lenslabs:export-adobe", exportRequest);
  });
  useEffect(() => {
    const openFolder = (event: Event) => {
      const detail = (event as CustomEvent<{ respond: (message: string) => void }>).detail;
      if (typeof detail?.respond !== "function") return;
      if (sessionStatusRef.current !== "ready" || importingRef.current || proposalRef.current) {
        detail.respond("Finish loading, importing or reviewing the current preview first.");
        return;
      }
      folderRef.current?.click();
      detail.respond(
        "Choose a folder to import. Only the files you select are read; originals stay untouched.",
      );
    };
    window.addEventListener("lenslabs:open-folder", openFolder);
    return () => window.removeEventListener("lenslabs:open-folder", openFolder);
  }, []);
  useEffect(() => {
    const jump = (event: Event) => {
      const detail = (event as CustomEvent<{ number: number; respond: (message: string) => void }>)
        .detail;
      if (typeof detail?.respond !== "function") return;
      const frames = latestShotsRef.current;
      if (sessionStatusRef.current !== "ready" || !frames.length) {
        detail.respond("Import photos and wait for this shoot to load first.");
        return;
      }
      if (
        !Number.isSafeInteger(detail.number) ||
        detail.number < 1 ||
        detail.number > frames.length
      ) {
        detail.respond(`Enter a photo number from 1 to ${frames.length}.`);
        return;
      }
      selectFilter("all");
      selectShot(frames[detail.number - 1]!.id);
      detail.respond("");
    };
    window.addEventListener("lenslabs:go-to-photo", jump);
    return () => window.removeEventListener("lenslabs:go-to-photo", jump);
  }, [selectFilter, selectShot]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        e.defaultPrevented ||
        (workbench &&
          t?.closest(
            'summary, details[open], [role="combobox"], [role="listbox"], [role="menu"], [role="dialog"]',
          ))
      )
        return;
      if (workbench && (!workbench.studioVisible || !t?.closest('[data-workbench-tool="studio"]')))
        return;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "z") {
        e.preventDefault();
        undoLast();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (!selectedId) return;
      if (k === "arrowright" || k === "arrowdown") {
        e.preventDefault();
        step(1);
      } else if (k === "arrowleft" || k === "arrowup") {
        e.preventDefault();
        step(-1);
      } else if (matchesShortcut(e, preferences.shortcuts.keep)) setVerdict(selectedId, "keep");
      else if (matchesShortcut(e, preferences.shortcuts.reject)) setVerdict(selectedId, "reject");
      else if (matchesShortcut(e, preferences.shortcuts.undecided))
        setVerdict(selectedId, "undecided", false);
      else if (matchesShortcut(e, preferences.shortcuts.reset)) {
        checkpoint();
        updateEdits({ ...DEFAULT_EDITS });
      } else if (matchesShortcut(e, preferences.shortcuts.refine)) {
        checkpoint();
        autoRefineOne();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkpoint, selectedId, step, setVerdict, undoLast, workbench, preferences.shortcuts]);

  const onDrop = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    setDropActive(false);
    if (importingRef.current || folderAbortRef.current) {
      setSyncNote("A folder is already being read. Finish or stop it before adding another.");
      return;
    }
    const controller = new AbortController();
    folderAbortRef.current = controller;
    const droppedEntries = Array.from(e.dataTransfer.items)
      .map((item) => {
        try {
          return item.webkitGetAsEntry?.();
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    setImportAttachment({
      name: droppedEntries.length === 1 ? droppedEntries[0]!.name : "Selected files",
      kind: droppedEntries.some((entry) => entry?.isDirectory) ? "folder" : "files",
      count: null,
    });
    setFolderStatus("Opening folder…");
    // Capture directory entries while the drop event still grants access.
    void collectDroppedFiles(e.dataTransfer, {
      signal: controller.signal,
      onProgress: (p) => {
        if (folderAbortRef.current === controller && !controller.signal.aborted)
          setFolderStatus(`Reading folder · ${p.files.toLocaleString()} files found`);
      },
    })
      .then(async (result) => {
        if (controller.signal.aborted || !mountedRef.current) return;
        setFolderStatus("Preparing photos…");
        if (!result.files.length) {
          setSyncNote(
            result.warnings[0]?.message ?? "This folder has no readable files. Try Choose folder.",
          );
          return;
        }
        await importFiles(result.files, controller.signal);
        if (result.warnings.length && mountedRef.current && !controller.signal.aborted)
          setSyncNote(
            `${result.warnings.length} folder item(s) could not be read. ${result.warnings[0]?.message} Available photos were kept.`,
          );
      })
      .catch((error: unknown) => {
        if (mountedRef.current && !controller.signal.aborted)
          setSyncNote(
            error instanceof Error
              ? error.message
              : "Could not read the folder. Try Choose folder.",
          );
      })
      .finally(() => {
        if (folderAbortRef.current === controller) {
          folderAbortRef.current = null;
          if (mountedRef.current) setFolderStatus(null);
        }
      });
  };

  const cancelImport = () => {
    folderAbortRef.current?.abort();
    folderAbortRef.current = null;
    setFolderStatus(null);
    importRunRef.current++;
    importAbortRef.current?.abort();
    importAbortRef.current = null;
    importingRef.current = false;
    setProgress(null);
    updateShots((current) => {
      const { duplicateIds } = indexDuplicateFrames(current);
      return current.map((shot) => ({
        ...shot,
        flags: [
          ...shot.flags.filter((flag) => flag !== "duplicate"),
          ...(duplicateIds.has(shot.id) ? ["duplicate" as const] : []),
        ],
      }));
    });
    setSyncNote(
      `Import stopped · ${latestShotsRef.current.length} available frames and your decisions remain. Originals were not changed.`,
    );
  };

  const startNewShoot = async () => {
    if (sessionStatusRef.current === "conflicted") return;
    if (projectSession) {
      setSyncNote(
        "Named projects are preserved. Create another project from Projects; nothing here was cleared.",
      );
      return;
    }
    if (sessionStatusRef.current === "loading" || sessionStatusRef.current === "clearing") {
      setSyncNote("Wait for the saved Studio session operation to finish first.");
      return;
    }
    const replacingUnreadableSnapshot = hydrationRecoveryRef.current;
    if (
      (latestShotsRef.current.length || replacingUnreadableSnapshot) &&
      !window.confirm(
        replacingUnreadableSnapshot
          ? "Start a new shoot and replace the saved Studio snapshot that could not be restored? Original files are never touched."
          : "Start a new shoot? This clears the current local previews, picks, and edits from LensLabs. Your original files are never touched.",
      )
    ) {
      return;
    }

    folderAbortRef.current?.abort();
    folderAbortRef.current = null;
    setFolderStatus(null);
    importRunRef.current++;
    importAbortRef.current?.abort();
    importAbortRef.current = null;
    importingRef.current = false;
    selectSessionStatus("clearing");
    setBusy("Starting new shoot…");

    try {
      await clearStudioSession({
        force: replacingUnreadableSnapshot,
        scope: storageScope,
        ...(shootId ? { shootId } : {}),
      });
      if (!mountedRef.current) return;
      discardProposal();
      for (const bitmap of bitmapCache.current.values()) bitmap.close?.();
      bitmapCache.current.clear();
      bitmapPromisesRef.current.clear();
      for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
      previewUrlsRef.current.clear();
      undoRef.current = [];
      latestShotsRef.current = [];
      latestSelectedIdRef.current = null;
      latestFilterRef.current = "all";
      setShots([]);
      setSelectedId(null);
      selectFilter("all");
      setBins([]);
      setProgress(null);
      setBusy(null);
      selectSessionStatus("ready");
      hydrationRecoveryRef.current = false;
      setSyncNote("New shoot ready · originals were not changed.");
    } catch {
      if (mountedRef.current) {
        setBusy(null);
        selectSessionStatus("failed");
        setSyncNote(
          replacingUnreadableSnapshot
            ? "The previous local snapshot could not be replaced, so it remains untouched."
            : "The saved Studio session changed elsewhere or could not be cleared. It remains untouched; reload before continuing.",
        );
      }
    }
  };

  const openWorkflow = (intent: Exclude<StudioWorkflowIntent, { kind: "refusal" }>): string => {
    if (!canPersistStudioSession(sessionStatusRef.current))
      return "Wait for the saved Studio session before opening this workflow.";
    if (proposalRef.current)
      return "Apply or discard the current preview first. Nothing was exported or reselected.";
    if (intent.kind === "bursts") {
      if (importingRef.current || folderAbortRef.current)
        return "Finish or stop ingest before grouping the current shoot.";
      if (latestShotsRef.current.filter((shot) => !shot.error).length < 2)
        return "Import at least two readable photos to compare related frames.";
      setBurstOpen(true);
      return "Opened burst review. Suggestions never reject alternatives or overwrite your picks.";
    }
    if (!latestShotsRef.current.some((shot) => shot.verdict === "keep"))
      return "Keep the photos you want to deliver first. A deadline export never selects photos for you.";
    setDeadlineCount(intent.count);
    setDeadlineOpen(true);
    return "Opened deadline preparation for your keepers. Review the recipe and approve the local download; nothing has been sent.";
  };

  const shootBrief = useMemo(
    () => ({ ...describeShoot(shots, selectedId), ...(shootTitle ? { title: shootTitle } : {}) }),
    [shots, selectedId, shootTitle],
  );
  const recovery = saveFailure ? (
    <SaveRecovery
      message={saveFailure}
      onDownload={async () => {
        const blob = await createShootRecovery(
          latestShotsRef.current,
          latestSelectedIdRef.current,
          latestFilterRef.current,
        );
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `LensLabs-recovery-${Date.now()}.lenspack`;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }}
      onReload={() => {
        if (
          !window.confirm(
            "Reload the last saved shoot? Unsaved changes in this tab, this chat, and unapplied previews will be lost. Download and verify a recovery copy first if you need them. Original files and the newer saved shoot will not be changed.",
          )
        )
          return;
        // Full navigation discards this controller and its queue. Never adopt a newer
        // revision into a live writer whose stale snapshots could still be queued.
        recoveryReloadRef.current = true;
        window.location.reload();
      }}
    />
  ) : null;
  const chat = (
    <CullChat
      workspace={!!workbench}
      storageScope={storageScope}
      onConversationChange={setChatHasContent}
      onWorkspaceRequest={workbench?.openWorkspaceRequest}
      onNavigate={
        workbench
          ? (href) => (href === "/studio" ? workbench.showStudio() : workbench.openTool(href))
          : undefined
      }
      context={chatContext}
      execute={async (tool) => {
        const result = await executeTool(tool);
        workbench?.showStudio();
        return result;
      }}
      stageEdit={(plan) => {
        const result = stageCreativeEdit(plan);
        if (proposalRef.current) workbench?.showStudio();
        return result;
      }}
      stageAdobeSettings={(plan) => {
        const result = stageAdobeSettings(plan);
        if (proposalRef.current) workbench?.showStudio();
        return result;
      }}
      frameCount={shots.length}
      shoot={shootBrief}
      paused={sessionStatus === "conflicted"}
      recovery={recovery}
      deliveryReference={
        <DeliveryReference
          value={deliveryReference}
          error={deliveryReferenceError}
          source={shots.find((shot) => shot.id === deliveryFocus?.frameId)}
          selectedId={selectedId}
          onSelect={() => {
            if (deliveryFocus) {
              selectFilter("all");
              selectShot(deliveryFocus.frameId);
            }
          }}
        />
      }
      onReviewShoot={() => {
        selectFilter(shootBrief.undecided ? "todo" : "all");
        selectShot(shootBrief.reviewId);
        void workbench?.showStudio();
      }}
      onOpenPhoto={(id) => {
        selectFilter("all");
        selectShot(id);
        void workbench?.showStudio();
      }}
      status={folderStatus ?? (syncNote?.startsWith("0 saved frames restored") ? null : syncNote)}
      importProgress={progress}
      importAttachment={importAttachment}
      dragActive={dropActive}
      importing={Boolean(progress || folderStatus)}
      onImportFolder={() => {
        folderRef.current?.click();
      }}
      onImportFiles={() => {
        inputRef.current?.click();
      }}
      onCancelImport={cancelImport}
      onWorkflow={openWorkflow}
      proposal={proposal}
      before={compareBefore}
      onCompare={() => {
        workbench?.showStudio();
        setCompareBefore((value) => !value);
      }}
      onApply={applyReviewedProposal}
      onDiscard={discardProposal}
      onTarget={changeProposalTarget}
    />
  );

  return (
    <div
      className={`paper-tex min-h-screen text-ink ${workbench ? "workbench-embedded-studio" : ""}`}
      onDrop={onDrop}
      onDragEnter={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) {
          e.preventDefault();
          setDropActive(true);
        }
      }}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDragLeave={(e) => {
        if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDropActive(false);
      }}
    >
      {dropActive && !workbench && (
        <div
          className="pointer-events-none fixed inset-3 z-50 flex flex-col items-center justify-center gap-3 bg-paper/95 outline-2 outline-rust"
          role="status"
        >
          <span className="font-display text-3xl tracking-tight">Drop your folder to start</span>
          <small className="text-sm text-moss">
            Photos stay on this device. Originals stay untouched.
          </small>
        </div>
      )}
      <header className="sticky top-0 z-30 border-b border-border/70 bg-paper/85 backdrop-blur">
        <div className="mx-auto grid max-w-[1600px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            {!workbench && (
              <Link to="/" className="flex shrink-0 items-center gap-2">
                <span className="grid size-6 place-items-center rounded-full bg-ink font-display text-[11px] font-bold text-paper2">
                  L
                </span>
                <span className="font-display text-sm font-semibold tracking-tight">LensLabs</span>
              </Link>
            )}
            <span className="truncate font-mono text-[11px] text-moss">
              {shots.length
                ? `${counts.all} frames · ${counts.todo} to review · ${counts.keepers} keepers`
                : workbench
                  ? "Photos"
                  : "no shoot loaded"}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 font-mono text-[11px]">
            {!!counts.keepers && (
              <button
                onClick={() => void exportKeepers()}
                className="rounded-md px-2.5 py-1.5 text-moss transition-colors hover:bg-ink/5 hover:text-ink"
              >
                Export {counts.keepers}
              </button>
            )}
            {!workbench && (
              <button
                disabled={Boolean(progress || folderStatus)}
                onClick={() => (shots.length ? autoCull() : inputRef.current?.click())}
                className="rounded-md bg-ink px-3 py-1.5 text-paper2 transition-colors hover:bg-rust"
              >
                {shots.length ? "Auto-cull" : "Import"}
              </button>
            )}
            <details className="relative">
              <summary
                aria-label="Shoot actions"
                title="Shoot actions"
                className="grid size-7 cursor-pointer list-none place-items-center rounded-md text-moss transition-colors hover:bg-ink/5 hover:text-ink [&::-webkit-details-marker]:hidden"
              >
                ···
              </summary>
              <div className="absolute right-0 z-40 mt-1.5 w-60 rounded-lg border border-border bg-paper2 p-1 shadow-xl">
                <Link
                  to="/projects"
                  className="block w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-ink/5"
                >
                  Shoots
                </Link>
                <div className="[&_button]:w-full [&_button]:text-left">
                  {projectId ? (
                    <button
                      disabled={!canPersistStudioSession(sessionStatus)}
                      className="rounded-md px-2.5 py-1.5 text-moss hover:text-ink"
                      onClick={() => {
                        if (!canPersistStudioSession(sessionStatusRef.current)) return;
                        if (progress || folderAbortRef.current || proposalRef.current) {
                          setSyncNote(
                            "Finish ingest and apply or discard the preview before leaving this project.",
                          );
                          return;
                        }
                        setBusy("Saving project…");
                        void saveStoredSession(
                          latestShotsRef.current,
                          latestSelectedIdRef.current,
                          latestFilterRef.current,
                        )
                          .then(() =>
                            window.location.assign(`/projects?id=${encodeURIComponent(projectId)}`),
                          )
                          .catch((error: unknown) => {
                            setBusy(null);
                            pauseSaving(error);
                          });
                      }}
                    >
                      Project
                    </button>
                  ) : isLocalSingleUserMode ? (
                    <SaveProject
                      shots={shots}
                      selectedId={selectedId}
                      filter={filter}
                      disabled={Boolean(
                        progress ||
                        folderStatus ||
                        proposal ||
                        !canPersistStudioSession(sessionStatus),
                      )}
                    />
                  ) : null}
                </div>
                {(
                  [
                    ...(workbench && shots.length
                      ? [["Auto-cull shoot", () => autoCull(), Boolean(progress || folderStatus)]]
                      : []),
                    [
                      "Import files",
                      () => inputRef.current?.click(),
                      Boolean(progress || folderStatus),
                    ],
                    [
                      "Import Lightroom folder",
                      () => folderRef.current?.click(),
                      Boolean(progress || folderStatus),
                    ],
                    ["Cancel import", cancelImport, !progress && !folderStatus],
                    [
                      "Review bursts",
                      () => setSyncNote(openWorkflow({ kind: "bursts" })),
                      shots.length < 2,
                    ],
                    [
                      "Prepare deadline set",
                      () => setSyncNote(openWorkflow({ kind: "deadline", count: 20 })),
                      !counts.keepers,
                    ],
                    [
                      "Share to social",
                      () => setSocialOpen(true),
                      !selected || Boolean(progress || folderStatus),
                    ],
                    [
                      "New shoot",
                      () => void startNewShoot(),
                      sessionStatus === "loading" ||
                        sessionStatus === "clearing" ||
                        (!shots.length && sessionStatus !== "failed"),
                    ],
                    [
                      "Write XMP sidecars",
                      exportSidecars,
                      !shots.some((s) => s.verdict !== "undecided"),
                    ],
                    ["Publish verdicts to Lightroom", () => void pushToLightroom(), !shots.length],
                    [
                      "Download Lightroom plugin",
                      () => {
                        void bridgeCredentials().then((creds) => {
                          const endpoint = downloadLightroomPlugin(creds);
                          setSyncNote(`Plugin downloaded · endpoint ${endpoint}`);
                        });
                      },
                      false,
                    ],
                    [
                      linked ? "Live sync · on" : "Live sync · off",
                      () => setLinked((v) => !v),
                      false,
                    ],
                  ] as [string, () => void, boolean][]
                ).map(([label, run, disabled]) => (
                  <button
                    key={label}
                    disabled={disabled || sessionStatus === "conflicted"}
                    onClick={(e) => {
                      run();
                      (e.currentTarget.closest("details") as HTMLDetailsElement).open = false;
                    }}
                    className="block w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-ink/5 disabled:opacity-35 disabled:hover:bg-transparent"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </details>
          </div>
        </div>

        {sessionStatus === "failed" && (
          <div
            role="alert"
            className="mx-auto max-w-[1600px] px-5 pb-2 font-mono text-[11px] font-semibold text-rust"
          >
            Studio saving is paused. Reload before continuing; New Shoot can replace an unreadable
            saved session after confirmation.
          </div>
        )}
        <input
          ref={folderRef}
          type="file"
          multiple
          // @ts-expect-error non-standard directory picker attributes
          webkitdirectory=""
          directory=""
          className="hidden"
          disabled={sessionStatus === "clearing" || Boolean(progress || folderStatus)}
          onChange={(e) => {
            void importFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.nef,.cr2,.cr3,.arw,.dng,.raf,.orf,.rw2,.pef,.srw,.xmp"
          className="hidden"
          disabled={sessionStatus === "clearing" || Boolean(progress || folderStatus)}
          onChange={(e) => {
            void importFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </header>
      {recovery && (
        <div className={workbench ? "workbench-studio-recovery" : "px-6 py-3"}>{recovery}</div>
      )}

      {progress && (
        <div className="mx-auto max-w-[1600px] px-6 pb-4">
          <div className="rounded-sm bg-paper2 p-4 shadow ring-1 ring-border">
            <div className="flex justify-between font-mono text-[11px]">
              <span>Ingesting shoot… · review frames as they arrive</span>
              <span className="text-rust">
                {progress.done} / {progress.total}
              </span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-ink/15">
              <div
                className="h-full rounded-full bg-rust transition-[width]"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto grid max-w-[1600px] gap-5 px-6 pb-20 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="min-w-0 xl:order-2">
          {!shots.length && !progress ? (
            <div
              role="button"
              tabIndex={0}
              aria-label="Import a shoot"
              onClick={() => inputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  inputRef.current?.click();
                }
              }}
              className={
                workbench
                  ? "workbench-empty-photos"
                  : "mt-24 cursor-pointer rounded-xl border border-dashed border-border px-6 py-24 text-center transition-colors hover:border-ink/30 focus-visible:outline-2 focus-visible:outline-rust"
              }
            >
              <h1 className="font-display text-3xl font-semibold tracking-tight">
                {workbench ? "Drop photos or a folder" : "Drop the shoot."}
              </h1>
              <p className="mt-2 font-mono text-[11px] text-moss">
                {workbench
                  ? "Or click to choose photos. Originals stay untouched."
                  : "RAW or JPEG · stays on your machine · ⌘ nothing else to set up"}
              </p>
              {!workbench && (
                <p className="mt-10 font-mono text-[11px] text-moss">
                  K keep · X reject · ← → move
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-sm bg-paper2 p-5 shadow-2xl ring-1 ring-border md:p-7">
              {/* toolbar */}
              <div
                className={
                  workbench
                    ? "workbench-photo-toolbar"
                    : "flex flex-wrap items-center gap-2 border-b border-border pb-5"
                }
              >
                {workbench ? (
                  <StudioFilterMenu value={filter} counts={counts} onChange={selectFilter} />
                ) : (
                  <>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-moss">
                      Filter
                    </span>
                    {(
                      [
                        ["all", `All ${counts.all}`],
                        ["todo", `To review ${counts.todo}`],
                        ["keepers", `Keepers ${counts.keepers}`],
                        ["flagged", `Flagged ${counts.flagged}`],
                        ["rejected", `Rejected ${counts.rejected}`],
                      ] as [Filter, string][]
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => selectFilter(key)}
                        aria-pressed={filter === key}
                        className={`rounded-full px-3 py-1 font-mono text-[11px] transition-colors ${
                          filter === key
                            ? "bg-ink text-paper2"
                            : "border border-input hover:bg-ink hover:text-paper2"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </>
                )}
                {busy && <span className="ml-auto font-mono text-[11px] text-rust">{busy}</span>}
              </div>

              <div className="grid gap-5 pt-5 lg:grid-cols-12">
                {/* filmstrip */}
                <div className="lg:col-span-5">
                  <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-moss">
                    Filmstrip · {visible.length} frames
                  </div>
                  <Filmstrip shots={visible} selectedId={selectedId} onSelect={selectShot} />
                  <p className="mt-3 font-mono text-[10px] text-moss">
                    ← → browse · K keep · X reject · U clear pick · ⌘Z undo
                  </p>

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <FlagTile
                      label="Blur / soft"
                      n={countFlag(shots, ["blur", "soft"])}
                      tone="rust"
                    />
                    <FlagTile
                      label="Exposure"
                      n={countFlag(shots, ["underexposed", "overexposed"])}
                      tone="rust"
                    />
                    <FlagTile label="Duplicates" n={countFlag(shots, ["duplicate"])} tone="sun" />
                  </div>
                </div>

                {/* loupe */}
                <div className="lg:col-span-7">
                  {selected ? (
                    <>
                      <div className="relative grid min-h-[300px] place-items-center bg-ink/5 outline-1 -outline-offset-1 outline-ink/10">
                        {selected.error ? (
                          <p className="p-10 text-center font-mono text-[12px] text-rust">
                            {selected.error}
                            <br />
                            <span className="text-moss">
                              Export a JPEG/DNG preview from your camera or converter and re-import.
                            </span>
                          </p>
                        ) : (
                          <canvas
                            ref={canvasRef}
                            className={`max-h-[520px] w-full object-contain ${loupeStatus === "ready" ? "" : "invisible"}`}
                          />
                        )}
                        {!selected.error && loupeStatus !== "ready" && (
                          <p
                            role="status"
                            className="absolute p-6 text-center text-[12px] text-moss"
                          >
                            {loupeStatus === "loading"
                              ? "Rendering photo…"
                              : "Preview unavailable. Reconnect the source to review this photo."}
                          </p>
                        )}
                        {loupeStatus === "ready" && proposalFrames.has(selected.id) && (
                          <span
                            className="absolute left-2 top-2 rounded-md bg-ink/85 px-2.5 py-1.5 text-[11px] text-paper2"
                            role="status"
                          >
                            {proposal?.kind === "edit"
                              ? compareBefore
                                ? "Before · saved version"
                                : "Proposed edit · not applied"
                              : `Suggestion: ${proposalFrames.get(selected.id)?.afterVerdict} · not applied`}
                          </span>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wider">
                        <span>
                          {selected.name} · {selected.width}×{selected.height} ·{" "}
                          {selected.sizeMb.toFixed(1)} MB {selected.isRaw && "· RAW"}
                        </span>
                        <span className="flex flex-wrap items-center gap-1">
                          {selected.sourceAvailable === false && (
                            <span className="rounded-full bg-sun px-2 py-0.5 text-ink">
                              preview only · reconnect source
                            </span>
                          )}
                          {selected.flags.map((f) => (
                            <span
                              key={f}
                              className="rounded-full bg-sun px-2 py-0.5 text-[10px] text-ink"
                            >
                              {FLAG_LABEL[f]}
                            </span>
                          ))}
                          <span className="rounded-full bg-moss px-2 py-0.5 text-paper2">
                            score {selected.score}
                          </span>
                          {selected.faces && (
                            <span className="rounded-full border border-input px-2 py-0.5">
                              {selected.faces.count} face{selected.faces.count === 1 ? "" : "s"}
                              {selected.faces.eyesOpen === null
                                ? ""
                                : selected.faces.eyesOpen
                                  ? " · eyes open"
                                  : " · eyes closed"}
                            </span>
                          )}
                          <span
                            className={`rounded-full px-2 py-0.5 ${
                              selected.develop ? "bg-ink text-paper2" : "border border-input"
                            }`}
                            title={
                              selected.develop
                                ? `Last develop update ${new Date(selected.develop.at).toLocaleTimeString()}`
                                : "No develop settings applied yet"
                            }
                          >
                            develop ·{" "}
                            {selected.develop
                              ? selected.develop.origin === "lightroom"
                                ? "from Lightroom (live)"
                                : selected.develop.origin === "sidecar"
                                  ? "from XMP sidecar"
                                  : "LensLabs, published"
                              : "untouched"}
                          </span>
                          {selected.develop?.rating !== undefined &&
                            selected.develop.rating !== null && (
                              <span className="rounded-full border border-input px-2 py-0.5">
                                {selected.develop.rating}★
                              </span>
                            )}
                          {selected.develop?.label && (
                            <span className="rounded-full border border-input px-2 py-0.5">
                              {selected.develop.label} label
                            </span>
                          )}
                          {selected.develop?.caption && (
                            <span className="rounded-full border border-input px-2 py-0.5">
                              IPTC: {selected.develop.caption}
                            </span>
                          )}
                        </span>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          onClick={() => setVerdict(selected.id, "keep")}
                          aria-pressed={selected.verdict === "keep"}
                          className={`rounded-full px-5 py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors ${
                            selected.verdict === "keep"
                              ? "bg-moss text-paper2"
                              : "border border-input hover:bg-moss hover:text-paper2"
                          }`}
                        >
                          Keep · K
                        </button>
                        <button
                          onClick={() => setVerdict(selected.id, "reject")}
                          aria-pressed={selected.verdict === "reject"}
                          className={`rounded-full px-5 py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors ${
                            selected.verdict === "reject"
                              ? "bg-rust text-paper2"
                              : "border border-input hover:bg-rust hover:text-paper2"
                          }`}
                        >
                          Reject · X
                        </button>
                        <button
                          onClick={() => void exportOne()}
                          className="ml-auto rounded-full bg-ink px-5 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-paper2 transition-colors hover:bg-rust"
                        >
                          Export frame
                        </button>
                      </div>

                      {/* histogram */}
                      <div
                        className="mt-5 flex h-16 items-end gap-[2px] bg-ink/5 p-2"
                        aria-label="Histogram"
                      >
                        {bins.map((b, i) => (
                          <span
                            key={i}
                            className="flex-1 rounded-[1px] bg-moss/70"
                            style={{ height: `${Math.max(2, b * 100)}%` }}
                          />
                        ))}
                      </div>

                      {/* edit desk */}
                      <div className="mt-5 border-t border-border pt-5">
                        <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-moss">
                          Edit desk · Lightroom-style
                        </div>
                        <div className="grid grid-cols-2 gap-x-8 gap-y-5 md:grid-cols-3">
                          <EditSlider
                            label="Exposure"
                            value={selected.edits.exposure}
                            onChangeStart={checkpoint}
                            onChange={(v) => updateEdits({ exposure: v })}
                          />
                          <EditSlider
                            label="Contrast"
                            value={selected.edits.contrast}
                            onChangeStart={checkpoint}
                            onChange={(v) => updateEdits({ contrast: v })}
                          />
                          <EditSlider
                            label="Temp (WB)"
                            value={selected.edits.temp}
                            onChangeStart={checkpoint}
                            onChange={(v) => updateEdits({ temp: v })}
                          />
                          <EditSlider
                            label="Highlights"
                            value={selected.edits.highlights}
                            onChangeStart={checkpoint}
                            onChange={(v) => updateEdits({ highlights: v })}
                          />
                          <EditSlider
                            label="Shadows"
                            value={selected.edits.shadows}
                            onChangeStart={checkpoint}
                            onChange={(v) => updateEdits({ shadows: v })}
                          />
                          <EditSlider
                            label="Saturation"
                            value={selected.edits.saturation}
                            onChangeStart={checkpoint}
                            onChange={(v) => updateEdits({ saturation: v })}
                          />
                          <div>
                            <div className="flex justify-between font-mono text-[10px] uppercase tracking-wider">
                              <span>Crop</span>
                              <span className="text-ink/50">{selected.edits.crop}</span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {CROPS.map((c) => (
                                <button
                                  key={c}
                                  aria-pressed={selected.edits.crop === c}
                                  onClick={() => {
                                    checkpoint();
                                    updateEdits({ crop: c });
                                  }}
                                  className={`rounded px-2 py-0.5 font-mono text-[10px] ${
                                    selected.edits.crop === c
                                      ? "bg-ink text-paper2"
                                      : "border border-input"
                                  }`}
                                >
                                  {c}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="col-span-full flex flex-wrap items-center gap-2 border-t border-border pt-4">
                            <button
                              onClick={() => {
                                checkpoint();
                                autoRefineOne();
                              }}
                              disabled={!selected.tone}
                              className="rounded-full bg-ink px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-paper2 transition-colors hover:bg-rust disabled:opacity-40"
                            >
                              Auto refine · A
                            </button>
                            <button
                              onClick={() => {
                                checkpoint();
                                autoRefineMany("keepers");
                              }}
                              disabled={!counts.keepers}
                              className="rounded-full border border-input px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider hover:bg-ink hover:text-paper2 disabled:opacity-40"
                            >
                              Auto refine all keepers
                            </button>
                            <span className="font-mono text-[10px] text-moss">
                              tone, white balance and recovery from this frame's histogram
                            </span>
                          </div>
                          <button
                            onClick={() => {
                              checkpoint();
                              updateEdits({ ...DEFAULT_EDITS });
                            }}
                            className="self-end justify-self-start rounded-full border border-input px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider hover:bg-ink hover:text-paper2"
                          >
                            Reset · R
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="grid h-full place-items-center font-mono text-[11px] text-moss">
                      Select a frame from the filmstrip.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* assistant rail — chat while it culls in the background */}
        {workbench?.chatTarget ? (
          createPortal(
            <div
              className="workbench-chat-root"
              onDrop={onDrop}
              onDragOver={(event) => {
                if (Array.from(event.dataTransfer.types).includes("Files")) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }
              }}
            >
              {chat}
            </div>,
            workbench.chatTarget,
          )
        ) : (
          <aside
            className="xl:order-1 xl:sticky xl:top-16 xl:h-[calc(100vh-5rem)]"
            aria-label="Photo assistant"
          >
            <div className="h-full rounded-sm bg-paper2 p-4 shadow-2xl ring-1 ring-border">
              {chat}
            </div>
          </aside>
        )}
      </main>
      <BurstReview
        open={burstOpen}
        onOpenChange={setBurstOpen}
        shots={shots}
        onKeep={(id) => {
          const shot = latestShotsRef.current.find((frame) => frame.id === id);
          if (
            canPersistStudioSession(sessionStatusRef.current) &&
            !proposalRef.current &&
            shot?.verdict === "undecided"
          )
            setVerdict(id, "keep", false);
        }}
      />
      <DeadlineExport
        open={deadlineOpen}
        onOpenChange={setDeadlineOpen}
        shots={shots}
        initialCount={deadlineCount}
      />
      <SocialExport open={socialOpen} onOpenChange={setSocialOpen} shot={selected} />
    </div>
  );
}

function countFlag(shots: Shot[], flags: Flag[]) {
  return shots.filter((s) => s.flags.some((f) => flags.includes(f))).length;
}

function FlagTile({ label, n, tone }: { label: string; n: number; tone: "rust" | "sun" }) {
  return (
    <div className="torn flex items-center justify-between bg-paper2 p-3 shadow">
      <span className="font-mono text-[11px]">{label}</span>
      <span
        className={`font-display text-xl font-semibold ${tone === "rust" ? "text-rust" : "text-sun"}`}
      >
        {n}
      </span>
    </div>
  );
}
