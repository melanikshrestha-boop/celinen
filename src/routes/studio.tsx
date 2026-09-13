import {
  createFileRoute,
  Link,
  useBlocker,
  useNavigate,
  defaultStringifySearch,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWorkbench } from "@/components/workbench/context";
import { useDashboard } from "@/components/dashboard/context";
import { isWorkbenchRoute, studioBindingKey } from "@/lib/workbench";
import { readStudioHandoff, type DeliveryFocus } from "@/lib/delivery/studio-handoff";
import {
  DeliveryReference,
  type DeliveryReferenceValue,
} from "@/components/studio/DeliveryReference";
import {
  developWorkspaceHref,
  resolveWorkspaceBinding,
  shootWorkspaceHref,
} from "@/lib/workbench-projects";
import { createShootRepository } from "@/lib/develop/shoot-repository";
import {
  applyCullReviewProposal,
  CullRefreshSuperseded,
  createCullLightroomVerdicts,
  createCullShootView,
  mergeCullLightroomReviews,
  restoreCullReview,
} from "@/lib/develop/cull-view";
import { getDevelopImportSession } from "@/lib/develop/import-session";
import { CullChat, type ToolCall, type ImportAttachment } from "@/components/studio/CullChat";
import { useAccount } from "@/components/account/AccountProvider";
import { useProcessingWakeLock } from "@/components/account/WorkspacePreferences";
import { DEFAULT_PREFERENCES } from "@/lib/account-preferences";
import { matchesShortcut } from "@/lib/shortcuts";
import { importLanes } from "@/lib/settings-transfer";
import { Filmstrip } from "@/components/studio/Filmstrip";
import { PeoplePanel } from "@/components/studio/PeoplePanel";
import { StudioFilterMenu } from "@/components/studio/StudioFilterMenu";
import { SaveRecovery } from "@/components/studio/SaveRecovery";
import { describeShoot } from "@/lib/studio/shoot-brief";
import { createShootRecovery } from "@/lib/studio/recovery";
import { SaveProject } from "@/components/studio/SaveProject";
import {
  listRecentShoots,
  rememberShoot,
  renameShoot,
  studioDatabaseKey,
} from "@/lib/studio/shoot-directory";
import { rememberStudioRuntime, restoreStudioRuntime } from "@/lib/studio/runtime";
import { StudioSaveBoundary } from "@/lib/studio/save-boundary";
import { BurstReview } from "@/components/studio/BurstReview";
import type { StudioWorkflowIntent } from "@/lib/studio/workflow-intents";
import { ProjectStudioSession } from "@/lib/projects/studio-adapter";
import { isLocalSingleUserMode } from "@/lib/app-mode";
import { PRODUCT_NAME } from "@/lib/product";
import { PHOTO_ID_MAX_LENGTH } from "@/lib/photo-identity";
import { collectDroppedFiles } from "@/lib/studio/drop-import";
import { firstPassVerdict } from "@/lib/studio/first-pass";
import { smartCullPass } from "@/lib/studio/smart-cull";
import { applyBurstCull, formatCullCsv, formatJobJson } from "@/lib/studio/cull-decision";
import {
  applyImportCull,
  attachImportAnalysis,
  isImportAnalyzed,
  mergePreservedImportAnalysis,
} from "@/lib/studio/cull-on-import";
import { tonightGalleryPath } from "@/lib/studio/tonight-gallery";
import { sendTonightKeepers } from "@/lib/delivery/tonight-local";
import { createOriginalKeeperZip } from "@/lib/studio/keeper-package";
import { importedReviewVerdict } from "@/lib/studio/review-metadata";
import { LIGHTROOM_MATCHING } from "@/lib/lightroom-matching";
import type { AdobeSettingsPastePlan } from "@/lib/studio/adobe-paste";
import type { CreativeEditPlan } from "@/lib/studio/creative-edits";
import { proposeCull, type EditTarget, type StudioProposal } from "@/lib/studio/proposals";
import {
  DEFAULT_EDITS,
  type Flag,
  type Shot,
  type Verdict,
  decodeFile,
  faceDetectionAvailable,
  parseXmpSidecar,
  histogram,
  isRawFile,
  renderToCanvas,
  scoreOf,
} from "@/lib/imaging";
import { observationsFromPreviewUrl } from "@/lib/studio/face-descriptor";
import { decideGallery, proposeGallery } from "@/lib/studio/gallery-select";
import { INSIGHTFACE_WEIGHTS_NOTE, requestPeopleClusters } from "@/lib/studio/insightface";
import {
  shotsOfCluster,
  shotsOfPerson,
  type EventPerson,
  type RosterPerson,
} from "@/lib/studio/people";
import {
  canPersistStudioSession,
  readStudioSessionSnapshot,
  saveStudioSession,
  setStudioEventPeople,
  setStudioRoster,
  stableShotId,
  type StudioFilter,
  type StudioHydrationState,
} from "@/lib/studio/session";
import { countReviewIssue, filterReviewIssue, type ReviewIssue } from "@/lib/studio/review-filter";
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
        search["deliveryFrame"].length > PHOTO_ID_MAX_LENGTH ||
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
      { title: `${PRODUCT_NAME} Studio` },
      {
        name: "description",
        content:
          "Import a RAW or JPEG shoot, get every frame scored and flagged, keep or reject with one key, then develop and export your picks.",
      },
      { property: "og:title", content: `${PRODUCT_NAME} Studio` },
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
  const { project, shoot, deliveryFrame, deliveryVersion, deliveryHandoff } = Route.useSearch();
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
      key={JSON.stringify([project, shoot, deliveryFrame, deliveryVersion, deliveryHandoff])}
      projectId={project ?? null}
      {...(shoot ? { shootId: shoot } : {})}
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
  const dashboard = useDashboard();
  const embedded = Boolean(workbench) || dashboard;
  const navigate = useNavigate();
  const [repository] = useState(() =>
    createShootRepository({
      scope: storageScope,
      libraryId: projectId ? `project:${projectId}` : `shoot:${shootId ?? "legacy"}`,
    }),
  );
  const [canonicalView] = useState(() => createCullShootView(repository));
  const [importSession] = useState(() =>
    getDevelopImportSession({
      scope: storageScope,
      libraryId: projectId ? `project:${projectId}` : `shoot:${shootId ?? "legacy"}`,
    }),
  );
  const unanalyzedIds = useRef(new Set<string>());
  const nativeTreatmentIds = useRef(new Set<string>());
  const [catalogSignal, setCatalogSignal] = useState(0);
  const catalogRefresh = useRef(false);
  const catalogRefreshAgain = useRef(false);
  const studioVisible = workbench?.studioVisible ?? true;
  // Studio is keyed by project. State retains the loaded controller during
  // Fast Refresh; a memo can be invalidated while the hydration guard survives.
  const [projectSession] = useState(() =>
    projectId ? new ProjectStudioSession(projectId, deliveryFocus) : null,
  );
  const [saveBoundary] = useState(() => new StudioSaveBoundary());
  const loadStoredSession = useCallback(async () => {
    const legacy = projectSession
      ? await projectSession.load()
      : await readStudioSessionSnapshot(storageScope, shootId);
    try {
      const session = await canonicalView.read(legacy);
      unanalyzedIds.current = session.unanalyzedIds;
      nativeTreatmentIds.current = session.nativeTreatmentIds;
      for (const shot of session.shots) {
        if (shot.previewBlob) shot.previewUrl = URL.createObjectURL(shot.previewBlob);
      }
      return session;
    } finally {
      for (const shot of legacy?.shots ?? [])
        if (shot.previewUrl) URL.revokeObjectURL(shot.previewUrl);
    }
  }, [projectSession, storageScope, shootId, canonicalView]);
  const saveStoredSession = useCallback(
    async (frames: Shot[], selected: string | null, scope: StudioFilter) => {
      const acknowledge = saveBoundary.begin({
        shots: frames,
        selectedId: selected,
        filter: scope,
      });
      await canonicalView.save(frames, selected, scope);
      await saveStudioSession(frames, selected, scope, storageScope, shootId);
      if (!projectSession && frames.length)
        await rememberShoot(
          storageScope,
          shootId ?? "legacy",
          frames.length,
          describeShoot(frames, selected).title,
        );
      acknowledge();
    },
    [canonicalView, projectSession, storageScope, shootId, saveBoundary],
  );
  const [shots, setShots] = useState<Shot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [roster, setRoster] = useState<RosterPerson[]>([]);
  const [eventPeople, setEventPeople] = useState<EventPerson[]>([]);
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [clusterFilter, setClusterFilter] = useState<string | null>(null);
  const [peopleGrouping, setPeopleGrouping] = useState(false);
  const [reviewIssue, setReviewIssue] = useState<ReviewIssue | null>(null);
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
  const importCullRef = useRef({ running: false, token: 0, applied: false });
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
  const canonicalOpenRef = useRef<() => Promise<boolean>>(async () => false);
  const [compareBefore, setCompareBefore] = useState(false);
  const [showBefore, setShowBefore] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [importAttachment, setImportAttachment] = useState<ImportAttachment | null>(null);
  const [folderStatus, setFolderStatus] = useState<string | null>(null);
  const [chatHasContent, setChatHasContent] = useState(false);
  const identity = useAccount();
  const registerAccountLeave = identity?.registerLeaveGuard;
  const preferences = identity?.preferences ?? DEFAULT_PREFERENCES;
  useProcessingWakeLock(preferences.keepAwake, Boolean(progress || busy));
  const [burstOpen, setBurstOpen] = useState(false);
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
        ) {
          // The next view reads the same shoot. Do not race its hydration against
          // the 350 ms autosave debounce or an unresolved save conflict.
          if (!canPersistStudioSession(sessionStatusRef.current)) return true;
          try {
            await saveStoredSession(
              latestShotsRef.current,
              latestSelectedIdRef.current,
              latestFilterRef.current,
            );
            return false;
          } catch (error) {
            pauseSaving(error);
            return true;
          }
        }
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

  const runImportCull = useCallback(() => {
    if (importingRef.current || proposalRef.current) return;
    if (!canPersistStudioSession(sessionStatusRef.current)) return;
    if (importCullRef.current.running) return;
    const token = ++importCullRef.current.token;
    importCullRef.current.running = true;
    void (async () => {
      try {
        const pending = latestShotsRef.current.filter(
          (shot) =>
            unanalyzedIds.current.has(shot.id) &&
            shot.sourceAvailable !== false &&
            Boolean(shot.file?.size),
        );
        const analyzedIds = new Set<string>();
        await Promise.all(
          pending.map(async (shot) => {
            try {
              const result = await analyseFile(shot.file);
              if (token !== importCullRef.current.token) return;
              unanalyzedIds.current.delete(shot.id);
              analyzedIds.add(shot.id);
              updateShots((prev) =>
                prev.map((entry) =>
                  entry.id === shot.id ? attachImportAnalysis(entry, result) : entry,
                ),
              );
            } catch {
              /* Leave unanalyzed; never invent a quality score. */
            }
          }),
        );
        if (
          token !== importCullRef.current.token ||
          !canPersistStudioSession(sessionStatusRef.current) ||
          proposalRef.current ||
          importingRef.current
        )
          return;
        const onlyIds = importCullRef.current.applied ? analyzedIds : undefined;
        if (importCullRef.current.applied && !analyzedIds.size) return;
        const current = latestShotsRef.current;
        const result = applyImportCull(current, onlyIds ? { onlyIds } : {});
        importCullRef.current.applied = true;
        if (!result.changed) return;
        undoRef.current.push({
          selectedId: latestSelectedIdRef.current,
          frames: current.map((shot) => ({
            id: shot.id,
            verdict: shot.verdict,
            edits: { ...shot.edits },
          })),
        });
        if (undoRef.current.length > 30) undoRef.current.shift();
        updateShots(() => result.shots);
        const decided = result.shots.filter(
          (shot) => shot.verdict !== "undecided" && !shot.error,
        ).length;
        setSyncNote(
          `Cull on import · ${decided} decided · ${result.flagged} near-dupes flagged. Originals were not changed.`,
        );
      } finally {
        if (token === importCullRef.current.token) importCullRef.current.running = false;
      }
    })();
  }, [updateShots]);

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
    setReviewIssue(null);
  }, []);

  const selectReviewIssue = useCallback((next: ReviewIssue) => {
    latestFilterRef.current = "flagged";
    setFilter("flagged");
    setReviewIssue((current) => (current === next ? null : next));
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

  const stageRecipe = useCallback((recipe: EditRecipe) => {
    if (!canPersistStudioSession(sessionStatusRef.current))
      throw new Error("Resolve the paused save before previewing changes.");
    const note = `${recipe.title}: opening Develop for review. No image adjustments were applied or translated from the old editor.`;
    void canonicalOpenRef.current().then((opened) => {
      if (opened) setSyncNote(note.replace("opening Develop", "Develop opened"));
    });
    return note;
  }, []);

  const stageCreativeEdit = useCallback(
    (plan: CreativeEditPlan) =>
      stageRecipe({
        target: plan.target,
        title: plan.title,
        description: plan.description,
        limitations: plan.limitations,
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

  const groupFaces = useCallback(async () => {
    if (peopleGrouping) return;
    setPeopleGrouping(true);
    try {
      const observations = [];
      for (const shot of latestShotsRef.current) {
        if (!shot.previewUrl || shot.error) continue;
        observations.push(...(await observationsFromPreviewUrl(shot.previewUrl, shot.id)));
      }
      if (!observations.length) {
        setSyncNote(
          "No faces to group. Use a browser with FaceDetector, or tag jersey/bib yourself. No identities were assigned.",
        );
        return;
      }
      const review = await requestPeopleClusters(observations);
      const people: EventPerson[] = review.clusters.map((cluster) => ({
        id: cluster.id,
        label: "",
        role: "unlabeled",
        confirmed: false,
        frameIds: cluster.frameIds,
        observationIds: cluster.observationIds,
        source: cluster.source,
        minSimilarity: cluster.minSimilarity,
      }));
      setEventPeople(people);
      setStudioEventPeople(people, storageScope, shootId);
      setSyncNote(
        `${people.length} event-local ${people.length === 1 ? "person" : "people"} grouped. Name them yourself. FOTO does not infer family roles.`,
      );
    } catch (error) {
      setSyncNote(
        error instanceof Error
          ? error.message
          : "People matching failed. No identities were assigned.",
      );
    } finally {
      setPeopleGrouping(false);
    }
  }, [peopleGrouping, storageScope, shootId]);

  const proposeJobGallery = useCallback(() => {
    const plan = proposeGallery(latestShotsRef.current, { people: eventPeople });
    return stageCull(
      (shot) => decideGallery(shot, plan),
      "Gallery proposal",
      plan.limitations.join(" "),
    );
  }, [eventPeople, stageCull]);

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
        // Canonical review/edits win; the old runtime contributes only its undo record.
        updateShots(() => session.shots);
        selectShot(session.selectedId ?? session.shots[0]?.id ?? null);
        selectFilter(session.filter);
        setRoster(session.roster ?? []);
        setStudioRoster(session.roster ?? [], storageScope, shootId);
        setEventPeople(session.eventPeople ?? []);
        setStudioEventPeople(session.eventPeople ?? [], storageScope, shootId);
        setPersonFilter(null);
        setClusterFilter(null);
        hydrationRecoveryRef.current = false;
        selectSessionStatus("ready");
        runImportCull();
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
  }, [
    loadStoredSession,
    runtimeKey,
    selectFilter,
    selectSessionStatus,
    selectShot,
    updateShots,
    storageScope,
    shootId,
    runImportCull,
  ]);

  useEffect(
    () =>
      repository.subscribe((change) => {
        if (change.kind !== "import-job" && change.kind !== "presets")
          setCatalogSignal((value) => value + 1);
      }),
    [repository],
  );
  useEffect(() => {
    const update = () => {
      const job = importSession.getSnapshot();
      const running = job.phase === "discovering" || job.phase === "processing";
      importingRef.current = running;
      setProgress(
        running ? { done: job.saved + job.failed + job.duplicates, total: job.found } : null,
      );
      setFolderStatus(job.phase === "discovering" ? `Reading folder · ${job.found} photos` : null);
      if (!running && job.jobId) {
        setSyncNote(
          job.error ??
            `${job.saved} photos saved · ${job.failed} failed · ${job.duplicates} duplicates`,
        );
        setCatalogSignal((value) => value + 1);
      }
    };
    update();
    const unsubscribe = importSession.subscribe(update);
    void importSession
      .restore()
      .catch((error) =>
        setSyncNote(error instanceof Error ? error.message : "Import status unavailable."),
      );
    return unsubscribe;
  }, [importSession]);
  useEffect(
    () =>
      repository.registerFlushParticipant("cull", async () => {
        if (sessionStatusRef.current === "loading") await hydrationGateRef.current?.promise;
        if (!canPersistStudioSession(sessionStatusRef.current)) return false;
        try {
          await saveStoredSession(
            latestShotsRef.current,
            latestSelectedIdRef.current,
            latestFilterRef.current,
          );
          return true;
        } catch (error) {
          pauseSaving(error);
          return false;
        }
      }),
    [repository, saveStoredSession, pauseSaving],
  );
  useEffect(() => {
    if (!catalogSignal || sessionStatus !== "ready" || !studioVisible) return;
    if (catalogRefresh.current) {
      catalogRefreshAgain.current = true;
      return;
    }
    let cancelled = false;
    catalogRefresh.current = true;
    void (async () => {
      const before = {
        shots: latestShotsRef.current,
        selectedId: latestSelectedIdRef.current,
        filter: latestFilterRef.current,
      };
      await saveStoredSession(before.shots, before.selectedId, before.filter);
      const current = await canonicalView.read(
        undefined,
        () =>
          !cancelled &&
          mountedRef.current &&
          before.shots === latestShotsRef.current &&
          before.selectedId === latestSelectedIdRef.current &&
          before.filter === latestFilterRef.current,
      );
      if (cancelled || !mountedRef.current) return;
      nativeTreatmentIds.current = current.nativeTreatmentIds;
      const old = new Map(latestShotsRef.current.map((shot) => [shot.id, shot]));
      for (const shot of current.shots) {
        const prior = old.get(shot.id);
        if (shot.previewBlob && prior?.previewBlob === shot.previewBlob)
          shot.previewUrl = prior.previewUrl;
        else if (shot.previewBlob) {
          shot.previewUrl = URL.createObjectURL(shot.previewBlob);
          previewUrlsRef.current.add(shot.previewUrl);
        }
        if (prior?.previewUrl && prior.previewUrl !== shot.previewUrl) {
          URL.revokeObjectURL(prior.previewUrl);
          previewUrlsRef.current.delete(prior.previewUrl);
        }
      }
      const merged = current.shots.map((shot) => mergePreservedImportAnalysis(shot, old.get(shot.id)));
      unanalyzedIds.current = new Set(
        merged.filter((shot) => !isImportAnalyzed(shot) && !shot.error).map((shot) => shot.id),
      );
      updateShots(() => merged);
      selectShot(current.selectedId);
      selectFilter(current.filter);
      runImportCull();
    })()
      .catch((error) => {
        if (error instanceof CullRefreshSuperseded) catalogRefreshAgain.current = true;
        else if (!cancelled) pauseSaving(error);
      })
      .finally(() => {
        catalogRefresh.current = false;
        if (catalogRefreshAgain.current && mountedRef.current) {
          catalogRefreshAgain.current = false;
          setCatalogSignal((value) => value + 1);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    catalogSignal,
    sessionStatus,
    studioVisible,
    canonicalView,
    saveStoredSession,
    updateShots,
    selectShot,
    selectFilter,
    pauseSaving,
    runImportCull,
  ]);

  useEffect(() => {
    if (!canPersistStudioSession(sessionStatus) || shots.length === 0) return;
    const timer = window.setTimeout(() => {
      if (canPersistStudioSession(sessionStatusRef.current))
        void saveStoredSession(shots, selectedId, filter).catch(pauseSaving);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [filter, selectedId, sessionStatus, shots, roster, eventPeople, saveStoredSession, pauseSaving]);

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
        repository.close();
      }, 0);
    };
  }, [runtimeKey, repository]);

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
    if (pending.kind === "edit") {
      discardProposal();
      void canonicalOpenRef.current();
      return "Opening Develop for image adjustments. The legacy preview was discarded; no settings were applied.";
    }
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
    const next = applyCullReviewProposal(latestShotsRef.current, pending);
    checkpoint();
    updateShots(() => next);
    discardProposal();
    const receipt = `Accepted suggestions for ${pending.frames.length.toLocaleString()} photo${pending.frames.length === 1 ? "" : "s"}. Undo is available; originals are untouched.`;
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
    const restoredShots = restoreCullReview(latestShotsRef.current, previous.frames);
    latestShotsRef.current = restoredShots;
    setShots(restoredShots);
    const restoredSelection = restoredShots.some((shot) => shot.id === previous.selectedId)
      ? previous.selectedId
      : (restoredShots[0]?.id ?? null);
    selectShot(restoredSelection);
    setSyncNote(
      "Restored the previous picks. Image adjustments stay in Develop; originals are untouched.",
    );
    return true;
  }, [discardProposal, selectShot]);

  /* ---------------- import ---------------- */
  function importFiles(files: File[]) {
    if (!files.length) return;
    if (sessionStatusRef.current === "failed" || sessionStatusRef.current === "conflicted") {
      setSyncNote("Resolve this shoot's saved-state problem before importing.");
      return;
    }
    try {
      const job = importSession.startFiles(files);
      void job.catch((error) =>
        setSyncNote(error instanceof Error ? error.message : "Import paused."),
      );
      void (async () => {
        await hydrationGateRef.current?.promise;
        await openDevelop();
      })();
    } catch (error) {
      setSyncNote(error instanceof Error ? error.message : "Import could not start.");
    }
  }

  /* ---------------- Lightroom live bridge ---------------- */
  const lastBridgeAt = useRef(0);

  const mergeBridge = useCallback(
    (state: BridgeState) => {
      const result = mergeCullLightroomReviews(latestShotsRef.current, state.frames, Date.now());
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
            `Lightroom matched ${result.matched} photo${result.matched === 1 ? "" : "s"} by folder path; ${result.unmatched} unmatched. Picks, supported stars and color labels updated. Develop settings and IPTC were not imported; saved treatments are unchanged.`,
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
      const frames = createCullLightroomVerdicts(latestShotsRef.current);
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
    const cluster = clusterFilter
      ? eventPeople.find((person) => person.id === clusterFilter)
      : undefined;
    const byCluster = cluster ? shotsOfCluster(shots, cluster) : shots;
    const scoped = personFilter ? shotsOfPerson(byCluster, personFilter) : byCluster;
    if (reviewIssue) return filterReviewIssue(scoped, reviewIssue);
    switch (filter) {
      case "keepers":
        return scoped.filter((s) => s.verdict === "keep");
      case "rejected":
        return scoped.filter((s) => s.verdict === "reject");
      case "flagged":
        return scoped.filter((s) => s.flags.length > 0);
      case "todo":
        return scoped.filter((s) => s.verdict === "undecided");
      default:
        return scoped;
    }
  }, [shots, filter, reviewIssue, personFilter, clusterFilter, eventPeople]);

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

    const promise = (
      shot.previewBlob ? createImageBitmap(shot.previewBlob) : decodeFile(shot.file, 1800)
    )
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
    if (!studioVisible) return;
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
        // Cull shows the saved import preview, not an approximation of native Develop edits.
        renderToCanvas(canvas, bmp, DEFAULT_EDITS, 1400, null);
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
  }, [selected, getBitmap, proposalFrames, proposal, compareBefore, showBefore, studioVisible]);

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

  const applyVerdicts = useCallback(
    (changes: { id: string; verdict: Verdict }[]) => {
      if (!changes.length || !canPersistStudioSession(sessionStatusRef.current)) return;
      const next = new Map(changes.map((change) => [change.id, change.verdict]));
      checkpoint();
      updateShots((prev) =>
        prev.map((shot) => {
          const verdict = next.get(shot.id);
          return verdict && shot.verdict !== verdict ? { ...shot, verdict } : shot;
        }),
      );
    },
    [checkpoint, updateShots],
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

  const autoCull = () => {
    if (latestShotsRef.current.some((shot) => unanalyzedIds.current.has(shot.id))) {
      setSyncNote(
        "These photos have not been analyzed for culling. Review and keep/reject them manually; no quality scores were invented.",
      );
      return;
    }
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

  async function openDevelop() {
    if (!canPersistStudioSession(sessionStatusRef.current)) {
      setSyncNote("Resolve the paused save before opening Develop. Your work is unchanged.");
      return false;
    }
    if (proposalRef.current) {
      setSyncNote("Apply or discard the current suggestion before opening Develop.");
      return false;
    }
    try {
      if (!(await repository.flush())) {
        setSyncNote(
          "Develop could not open because this shoot has an unresolved save. Review the save warning; your photos and edits are unchanged.",
        );
        return false;
      }
      const href = developWorkspaceHref(
        {
          kind: "ready",
          projectId,
          ...(shootId ? { shootId } : {}),
          ...(deliveryFocus ? { deliveryFocus } : {}),
        },
        latestSelectedIdRef.current ? canonicalView.photoId(latestSelectedIdRef.current) : null,
      );
      if (workbench) return await workbench.openTool(href);
      await navigate({ href });
      return true;
    } catch (error) {
      pauseSaving(error);
      return false;
    }
  }
  canonicalOpenRef.current = openDevelop;

  const requestDevelopOutput = useCallback((purpose: string) => {
    const note = `Opening Develop for ${purpose}. No image was exported, downloaded or sent.`;
    void canonicalOpenRef.current().then((opened) => {
      if (opened) setSyncNote(note.replace("Opening Develop", "Develop opened"));
    });
    setSyncNote(note);
    return note;
  }, []);

  // Image edits and rendered exports have one authority: the native Develop page.
  const exportOne = async () => {
    await openDevelop();
  };

  const zipKeepers = async () => {
    if (proposalRef.current) {
      setSyncNote("Apply or discard the preview before zipping keepers.");
      return;
    }
    setBusy("Packing keepers…");
    try {
      const pack = await createOriginalKeeperZip(
        latestShotsRef.current,
        shootTitle.trim() || "Untitled shoot",
      );
      const url = URL.createObjectURL(pack.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = pack.filename;
      document.body.appendChild(a);
      try {
        a.click();
      } finally {
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      setBusy(null);
      setSyncNote(`${pack.keepers} keepers zipped to Downloads.`);
    } catch (error) {
      setBusy(null);
      setSyncNote(
        error instanceof Error ? error.message : "ZIP failed. Cull first; originals are unchanged.",
      );
    }
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
        ? `open frame: ${selected.name} (${unanalyzedIds.current.has(selected.id) ? "analysis pending; no quality score" : `score ${selected.score}`}, ${selected.verdict})`
        : "no frame open",
    ].join("\n");
  }, [shots, counts, filter, selected]);

  const sendKeepers = useCallback(async (): Promise<string> => {
    if (proposalRef.current) {
      const note = "Apply or discard the preview before sending.";
      setSyncNote(note);
      return `failed: ${note}`;
    }
    if (importingRef.current) {
      const note = "Wait for import to finish before sending.";
      setSyncNote(note);
      return `failed: ${note}`;
    }
    setBusy("Sending gallery…");
    try {
      const gallery = await sendTonightKeepers(
        latestShotsRef.current,
        shootTitle.trim() || "Untitled shoot",
      );
      const path = tonightGalleryPath(gallery.slug);
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const url = `${origin}${path}`;
      try {
        await navigator.clipboard.writeText(`${url} · ${gallery.passcode}`);
      } catch {
        /* Clipboard is optional; the note still has the link. */
      }
      setBusy(null);
      const note = `${gallery.keepers} keepers · ${path} · ${gallery.passcode}`;
      setSyncNote(note);
      return note;
    } catch (error) {
      setBusy(null);
      const note =
        error instanceof Error
          ? error.message
          : "Gallery was not sent. Originals are unchanged.";
      setSyncNote(note);
      return `failed: ${note}`;
    }
  }, [shootTitle]);

  const executeTool = useCallback(
    async ({ name, args }: ToolCall): Promise<string> => {
      const num = (k: string) =>
        typeof args[k] === "number" && Number.isFinite(args[k]) ? (args[k] as number) : undefined;
      const currentShots = () => latestShotsRef.current;
      const currentSelectedId = () => latestSelectedIdRef.current;
      if (
        ["cull", "keep_top", "reject_flagged"].includes(name) &&
        currentShots().some((shot) => unanalyzedIds.current.has(shot.id))
      )
        return "These photos have not been analyzed. Review them manually; no quality-based decisions were applied.";
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
            (s) =>
              smartCullPass(currentShots(), [], { rejectBelow: min, keepAt }).get(s.id) ??
              firstPassVerdict(s, { rejectBelow: min, keepAt }),
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
          if (
            (q === "best" || q === "worst") &&
            pool.some((shot) => unanalyzedIds.current.has(shot.id))
          )
            return "Quality analysis is pending; choose a photo by name or number.";
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
          const opened = await canonicalOpenRef.current();
          return opened
            ? "Develop opened. Adjust and review the photo there; no requested legacy settings were applied."
            : "Develop could not open. Resolve the save or pending-review warning; no settings were applied.";
        }
        case "auto_refine": {
          const opened = await canonicalOpenRef.current();
          return opened
            ? "Develop opened. Use Auto there and review its result; no automatic adjustment was applied in Cull."
            : "Develop could not open. No automatic adjustments were applied.";
        }
        case "export_keepers": {
          if (proposalRef.current) return "failed: Apply or discard the preview before exporting.";
          const n = currentShots().filter((s) => s.verdict === "keep" && !s.error).length;
          if (!n) return "failed: no keepers to export";
          const opened = await canonicalOpenRef.current();
          return opened
            ? `Develop opened for your ${n} keepers. Choose the photos and export settings there; no download has been requested.`
            : "Develop could not open. No keepers were exported.";
        }
        case "write_xmp": {
          if (proposalRef.current)
            return "failed: Apply or discard the preview before writing sidecars.";
          const n = currentShots().filter((s) => s.verdict !== "undecided" && !s.error).length;
          if (!n) return "failed: nothing decided yet";
          return requestDevelopOutput("sidecars and native editing settings");
        }
        case "undo_last":
          if (proposalRef.current) return discardProposal();
          return undoLast() ? "restored the previous studio state" : "nothing to undo";
        case "send_gallery":
          return await sendKeepers();
        default:
          return "failed: unknown tool";
      }
    },
    [discardProposal, requestDevelopOutput, selectFilter, selectShot, sendKeepers, stageCull, undoLast],
  );

  /** Download one validated archive; never flatten folders or overwrite originals. */

  const exportSidecars = () => requestDevelopOutput("sidecars and native editing settings");

  const downloadText = (filename: string, text: string, type: string) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    try {
      a.click();
    } finally {
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  };

  const exportCullSheet = () => {
    if (proposalRef.current) {
      const note = "Apply or discard the preview before exporting the cull sheet.";
      setSyncNote(note);
      return `failed: ${note}`;
    }
    try {
      const frames = latestShotsRef.current;
      if (!frames.length) throw new Error("Import a shoot before exporting a cull sheet.");
      const job = shootTitle.trim() || "Untitled shoot";
      downloadText("cull.csv", formatCullCsv(frames), "text/csv");
      downloadText("job.json", formatJobJson(job, "studio", frames), "application/json");
      const keepers = frames.filter((frame) => frame.verdict === "keep" && !frame.error).length;
      const note = `Requested cull.csv and job.json for ${frames.length} frames · ${keepers} keepers. Originals were not copied.`;
      setSyncNote(note);
      return note;
    } catch (error) {
      const note =
        error instanceof Error
          ? error.message
          : "Cull sheet export failed. Originals are unchanged.";
      setSyncNote(note);
      return `failed: ${note}`;
    }
  };

  const downloadKeeperPackage = async () => {
    requestDevelopOutput("edited keeper proofs");
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
      } else if (matchesShortcut(e, preferences.shortcuts.keep) || k === "k")
        setVerdict(selectedId, "keep");
      else if (matchesShortcut(e, preferences.shortcuts.reject) || k === "x" || k === "r")
        setVerdict(selectedId, "reject");
      else if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        const current = latestShotsRef.current.find((s) => s.id === selectedId)?.verdict;
        setVerdict(selectedId, current === "keep" ? "reject" : "keep");
      } else if (matchesShortcut(e, preferences.shortcuts.undecided) || k === "u")
        setVerdict(selectedId, "undecided", false);
      else if (matchesShortcut(e, preferences.shortcuts.reset) && k !== "r") {
        e.preventDefault();
        setSyncNote(
          stageRecipe({
            target: "selected",
            title: "Reset adjustments",
            description: "Review the reset in Develop.",
          }),
        );
      } else if (matchesShortcut(e, preferences.shortcuts.refine)) {
        e.preventDefault();
        setSyncNote(
          stageRecipe({
            target: "selected",
            title: "Auto adjustments",
            description: "Review Auto in Develop.",
          }),
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, step, setVerdict, stageRecipe, undoLast, workbench, preferences.shortcuts]);

  const onDrop = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    setDropActive(false);
    if (sessionStatusRef.current === "failed" || sessionStatusRef.current === "conflicted") {
      setSyncNote("Resolve this shoot's saved-state problem before importing.");
      return;
    }
    try {
      // Capture handles in the actual drop event. The session, not this route, owns the job.
      const job = importSession.startDrop(e.dataTransfer);
      void job.catch((error) =>
        setSyncNote(error instanceof Error ? error.message : "Import paused."),
      );
      void (async () => {
        await hydrationGateRef.current?.promise;
        await openDevelop();
      })();
    } catch (error) {
      setSyncNote(error instanceof Error ? error.message : "Import could not start.");
    }
  };

  const cancelImport = () => {
    importSession.cancel();
    folderAbortRef.current?.abort();
    folderAbortRef.current = null;
    setFolderStatus(null);
    importRunRef.current++;
    importCullRef.current.token += 1;
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
    if (!(await repository.flush())) return;
    if (workbench?.newShoot) {
      await workbench.newShoot();
      return;
    }
    const id = crypto.randomUUID();
    await renameShoot(storageScope, id, "Untitled shoot");
    await navigate({ href: shootWorkspaceHref(id, "cull") });
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
      return "Opened burst review. Keeping one frame rejects the other unreviewed frames in that burst. Existing picks stay.";
    }
    if (!latestShotsRef.current.some((shot) => shot.verdict === "keep"))
      return "Keep the photos you want to deliver first. A deadline export never selects photos for you.";
    return requestDevelopOutput("deadline keeper exports");
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
        if (!["apply_edits", "auto_refine", "export_keepers", "write_xmp"].includes(tool.name))
          void workbench?.showStudio();
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
      className={`paper-tex min-h-screen text-ink${workbench ? " workbench-embedded-studio" : ""}${dashboard ? " celinen-embedded-studio" : ""}`}
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
      {dropActive && (
        <div
          className="pointer-events-none fixed inset-3 z-50 flex flex-col items-center justify-center gap-3 bg-paper/95 outline-2 outline-rust"
          role="status"
        >
          <span className="font-display text-3xl tracking-tight">Drop the shoot</span>
          <small className="text-sm text-moss">
            Photos stay on this device. Originals stay untouched.
          </small>
        </div>
      )}
      <header className="sticky top-0 z-30 border-b border-border/70 bg-paper/85 backdrop-blur">
        <div className="mx-auto grid max-w-[1600px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            {!embedded && (
              <Link to="/" className="flex shrink-0 items-center gap-2">
                <span className="grid size-6 place-items-center rounded-full bg-ink font-display text-[11px] font-bold text-paper2">
                  L
                </span>
                <span className="font-display text-sm font-semibold tracking-tight">
                  {PRODUCT_NAME}
                </span>
              </Link>
            )}
            <span className="truncate font-mono text-[11px] text-moss">
              {shots.length
                ? `${counts.all} frames · ${counts.todo} to review · ${counts.keepers} keepers`
                : embedded
                  ? "Photos"
                  : "no shoot loaded"}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 font-mono text-[11px]">
            {!!counts.keepers && (
              <button
                type="button"
                onClick={() => void zipKeepers()}
                disabled={Boolean(busy)}
                className="rounded-md bg-ink px-2.5 py-1.5 text-paper2 transition-colors hover:bg-rust disabled:opacity-50"
              >
                {busy?.startsWith("Packing")
                  ? "Packing keepers…"
                  : `ZIP keepers (${counts.keepers})`}
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
                      () => requestDevelopOutput("social crops and exports"),
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
                    ["Export cull.csv", exportCullSheet, !shots.length],
                    ["ZIP keepers", () => void zipKeepers(), !counts.keepers],
                    [
                      "Download keepers package",
                      () => void downloadKeeperPackage(),
                      !counts.keepers,
                    ],
                    ["Send keepers to gallery", () => void sendKeepers(), !counts.keepers],
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
          id="foto-folder"
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
          id="foto-files"
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
        <div className={embedded ? "workbench-studio-recovery" : "px-6 py-3"}>{recovery}</div>
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

      <main
        className={
          embedded
            ? "grid min-h-0 flex-1 grid-cols-1"
            : "mx-auto grid max-w-[1600px] gap-5 px-6 pb-20 xl:grid-cols-[380px_minmax(0,1fr)]"
        }
      >
        <div className={embedded ? "min-h-0 min-w-0" : "min-w-0 xl:order-2"}>
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
                embedded
                  ? "workbench-empty-photos"
                  : "mt-24 cursor-pointer rounded-xl border border-dashed border-border px-6 py-24 text-center transition-colors hover:border-ink/30 focus-visible:outline-2 focus-visible:outline-rust"
              }
            >
              <h1 className="font-display text-3xl font-semibold tracking-tight">Drop the shoot</h1>
              <p className="mt-2 font-mono text-[11px] text-moss">
                Then K keep · R reject · ZIP keepers. Originals stay on this device.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  className="rounded-md bg-ink px-3 py-1.5 font-mono text-[11px] text-paper2"
                  onClick={(event) => {
                    event.stopPropagation();
                    inputRef.current?.click();
                  }}
                >
                  Choose files
                </button>
                <button
                  type="button"
                  className="rounded-md px-3 py-1.5 font-mono text-[11px] text-ink ring-1 ring-border"
                  onClick={(event) => {
                    event.stopPropagation();
                    folderRef.current?.click();
                  }}
                >
                  Choose folder
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-sm bg-paper2 p-5 shadow-2xl ring-1 ring-border md:p-7">
              {/* toolbar */}
              <div
                className={
                  embedded
                    ? "workbench-photo-toolbar"
                    : "flex flex-wrap items-center gap-2 border-b border-border pb-5"
                }
              >
                <div className="flex gap-1">
                  <button type="button" className="rounded-md bg-ink px-2 py-1 text-paper2">
                    Library
                  </button>
                  <button
                    type="button"
                    className="rounded-md px-2 py-1"
                    onClick={() => void openDevelop()}
                  >
                    Develop
                  </button>
                </div>
                {embedded ? (
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
                    ← → browse · K keep · R/X reject · Space toggle · U clear · ⌘Z undo
                  </p>

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <FlagTile
                      label="Focus / eyes"
                      n={countReviewIssue(shots, "focus")}
                      tone="rust"
                      active={reviewIssue === "focus"}
                      onClick={() => selectReviewIssue("focus")}
                    />
                    <FlagTile
                      label="Exposure"
                      n={countReviewIssue(shots, "exposure")}
                      tone="rust"
                      active={reviewIssue === "exposure"}
                      onClick={() => selectReviewIssue("exposure")}
                    />
                    <FlagTile
                      label="Duplicates"
                      n={countReviewIssue(shots, "duplicates")}
                      tone="sun"
                      active={reviewIssue === "duplicates"}
                      onClick={() => selectReviewIssue("duplicates")}
                    />
                  </div>
                  <PeoplePanel
                    roster={roster}
                    eventPeople={eventPeople}
                    shots={shots}
                    selected={selected}
                    personFilter={personFilter}
                    clusterFilter={clusterFilter}
                    grouping={peopleGrouping}
                    packNote={INSIGHTFACE_WEIGHTS_NOTE}
                    onRoster={(next) => {
                      setRoster(next);
                      setStudioRoster(next, storageScope, shootId);
                    }}
                    onTag={(shotId, subjects) =>
                      updateShots((current) =>
                        current.map((shot) => (shot.id === shotId ? { ...shot, subjects } : shot)),
                      )
                    }
                    onFilter={setPersonFilter}
                    onClusterFilter={setClusterFilter}
                    onEventPeople={(next) => {
                      setEventPeople(next);
                      setStudioEventPeople(next, storageScope, shootId);
                    }}
                    onGroupFaces={() => void groupFaces()}
                    onProposeGallery={() => {
                      try {
                        setSyncNote(proposeJobGallery());
                      } catch (error) {
                        setSyncNote(
                          error instanceof Error
                            ? error.message
                            : "Gallery proposal failed. Your picks are unchanged.",
                        );
                      }
                    }}
                  />
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
                        <span>Unedited import preview · Develop for saved edits</span>
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
                            {unanalyzedIds.current.has(selected.id)
                              ? "Analysis pending"
                              : `score ${selected.score}`}
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
                              nativeTreatmentIds.current.has(selected.id)
                                ? "The saved photo treatment is in Develop. Cull shows the unedited import preview."
                                : selected.develop
                                  ? `Last develop update ${new Date(selected.develop.at).toLocaleTimeString()}`
                                  : "No develop settings applied yet"
                            }
                          >
                            develop ·{" "}
                            {nativeTreatmentIds.current.has(selected.id)
                              ? "native editor"
                              : selected.develop
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
                          Export in Develop
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

                      <button
                        type="button"
                        className="mt-4 rounded-md bg-ink px-4 py-2 text-paper2"
                        onClick={() => void openDevelop()}
                      >
                        Open Develop
                      </button>
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
        ) : dashboard ? null : (
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
        onCull={(id, groupIds) => {
          if (!canPersistStudioSession(sessionStatusRef.current) || proposalRef.current) return;
          try {
            applyVerdicts(applyBurstCull(latestShotsRef.current, id, groupIds));
          } catch (error) {
            setSyncNote(
              error instanceof Error
                ? error.message
                : "Burst cull failed. Existing picks are unchanged.",
            );
          }
        }}
      />
    </div>
  );
}

function FlagTile({
  label,
  n,
  tone,
  active,
  onClick,
}: {
  label: string;
  n: number;
  tone: "rust" | "sun";
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={n === 0}
      onClick={onClick}
      className="torn flex items-center justify-between bg-paper2 p-3 text-left shadow transition-colors hover:bg-ink/5 disabled:cursor-default disabled:opacity-55 data-[active=true]:bg-ink/10"
      data-active={active}
      title={n ? `Show ${label.toLowerCase()} issues` : `No ${label.toLowerCase()} issues`}
    >
      <span className="font-mono text-[11px]">{label}</span>
      <span
        className={`font-display text-xl font-semibold ${tone === "rust" ? "text-rust" : "text-sun"}`}
      >
        {n}
      </span>
    </button>
  );
}
