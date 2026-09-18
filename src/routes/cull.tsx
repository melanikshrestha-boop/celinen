import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAccount } from "@/components/account/AccountProvider";
import { CullWorkspace } from "@/components/cull/CullWorkspace";
import { importName } from "@/components/cull/cull-review";
import { InstagramComposer, type InstagramCandidate } from "@/components/social/InstagramComposer";
import { PRODUCT_NAME } from "@/lib/product";
import { CullController, NO_CODES, type CullSnapshot } from "@/lib/studio/cull/controller";
import { opfsRoot } from "@/lib/studio/cull/opfs";
import { PreviewLibrary } from "@/lib/studio/cull/preview-library";
import { PreviewQueue, workerPreviewEncoder } from "@/lib/studio/cull/preview-queue";
import {
  folderPickerSupported,
  pickDirectoryHandle,
  type CullSourceRoot,
} from "@/lib/studio/cull/sources";
import { openCullStore, type CullSessionSummary, type CullStore } from "@/lib/studio/cull/store";
import {
  queueDevelopImport,
  snapshotPhotoFiles,
  takeStudioImport,
} from "@/lib/studio/pending-import";

export const Route = createFileRoute("/cull")({
  head: () => ({ meta: [{ title: `Cull — ${PRODUCT_NAME}` }] }),
  component: CullRoute,
});

function CullRoute() {
  const account = useAccount();
  // Sessions are stored per account, like the rest of Studio; nothing opens
  // until the account is known.
  if (!account?.scope) return <div className="paper-tex min-h-screen bg-paper" aria-busy="true" />;
  return <CullSessionHost key={account.scope} scope={account.scope} />;
}

const EMPTY: CullSnapshot = {
  sessionId: null,
  frames: [],
  progress: null,
  notice: null,
  canUndo: false,
  originals: "unavailable",
  backup: null,
  keepTarget: null,
  ranked: 0,
  codes: NO_CODES,
};

/** Review previews need a private file system, a worker that can draw, and a
 * decoder; every current browser has all three outside private windows. */
function previewsFor(scope: string, store: CullStore) {
  const supported =
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap === "function" &&
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function";
  if (!supported) return null;
  const library = new PreviewLibrary({
    scope,
    store,
    // Rejected in some private windows; the library treats that as no previews.
    root: () => opfsRoot(),
    storage: navigator.storage,
  });
  return { library, queue: new PreviewQueue({ scope, library, encoder: workerPreviewEncoder }) };
}

/** One controller per account for as long as the page is open. */
function CullSessionHost({ scope }: { scope: string }) {
  const navigate = useNavigate();
  const [controller, setController] = useState<CullController | null>(null);
  const [snapshot, setSnapshot] = useState<CullSnapshot>(EMPTY);
  const [sessions, setSessions] = useState<readonly CullSessionSummary[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let owned: CullController | null = null;
    let unsubscribe = () => {};
    openCullStore(scope).then(
      async (store) => {
        if (!live) return store.close();
        owned = new CullController(store, {
          previews: previewsFor(scope, store),
          canLocate: folderPickerSupported(),
          scope,
        });
        unsubscribe = owned.subscribe(setSnapshot);
        setController(owned);
        void owned.loadCodes();
        // Photos dropped on Home start culling the moment the store is open.
        const queued = takeStudioImport();
        if (queued.length)
          owned
            .importCard(importName(queued), queued)
            .catch((error: unknown) => {
              if (live && !(error instanceof DOMException && error.name === "AbortError"))
                setFailure(
                  error instanceof Error ? error.message : "Something went wrong with this card.",
                );
            })
            .finally(() => {
              if (live) void owned?.sessions().then(setSessions, () => {});
            });
        setSessions(await store.list().catch(() => []));
      },
      (error: unknown) => {
        if (live)
          setFailure(error instanceof Error ? error.message : "Cull storage is unavailable.");
      },
    );
    return () => {
      live = false;
      unsubscribe();
      owned?.dispose();
    };
  }, [scope]);

  const refreshSessions = useCallback(async () => {
    if (!controller) return;
    setSessions(await controller.sessions().catch(() => []));
  }, [controller]);

  const report = useCallback((error: unknown) => {
    // A cancelled import is the photographer's own choice, not a problem to report.
    if (error instanceof DOMException && error.name === "AbortError") return;
    setFailure(error instanceof Error ? error.message : "Something went wrong with this card.");
  }, []);

  const onImport = useCallback(
    (
      name: string,
      files: readonly File[],
      roots?: readonly CullSourceRoot[],
      backup?: Parameters<CullController["importCard"]>[3],
    ) => {
      if (!controller) return;
      setFailure(null);
      controller
        .importCard(name, files, roots, backup)
        .catch(report)
        .finally(() => void refreshSessions());
    },
    [controller, report, refreshSessions],
  );
  const onCancelImport = useCallback(() => controller?.cancelImport(), [controller]);
  const onCancelBackup = useCallback(() => controller?.cancelBackup(), [controller]);
  const onExport = useCallback(
    (request: Parameters<CullController["exportFrames"]>[0]) =>
      controller
        ? controller.exportFrames(request)
        : Promise.reject(new Error("Cull is not ready.")),
    [controller],
  );
  const onMark = useCallback(
    (ids: readonly string[], marks: Parameters<CullController["mark"]>[1]) =>
      void controller?.mark(ids, marks).catch(report),
    [controller, report],
  );
  const onKeepTarget = useCallback(
    (target: number | null) => controller?.setKeepTarget(target),
    [controller],
  );
  // The code panel reports its own problems next to the file it could not read.
  const onAddCodes = useCallback(
    (input: Parameters<CullController["addCodes"]>[0]) =>
      controller ? controller.addCodes(input) : Promise.reject(new Error("Cull is not ready.")),
    [controller],
  );
  const onRemoveCodes = useCallback(
    (id: string) => void controller?.removeCodes(id).catch(report),
    [controller, report],
  );
  const onUndo = useCallback(() => void controller?.undo().catch(report), [controller, report]);
  const onOpenSession = useCallback(
    (id: string) => void controller?.open(id).catch(report),
    [controller, report],
  );
  const thumbnail = useCallback(
    (frameId: string) => controller?.thumbnail(frameId) ?? Promise.resolve(null),
    [controller],
  );
  // Live original, then a reconnected one, then the stored review preview, then the thumbnail.
  const preview = useCallback(
    (frameId: string) => controller?.loupeImage(frameId) ?? Promise.resolve(null),
    [controller],
  );
  // Runs inside the click: both the permission prompt and the folder picker need it.
  const onReconnect = useCallback(() => {
    if (!controller) return;
    const { originals } = controller.snapshot();
    if (originals === "reconnect") void controller.reconnect().catch(report);
    else if (originals === "locate")
      void pickDirectoryHandle()
        .then((directory) => (directory ? controller.locate([directory]) : false))
        .catch(report);
  }, [controller, report]);

  const onDevelop = useCallback(() => {
    if (!controller) return;
    const files = controller.keeperFiles();
    if (!files.length) {
      setFailure("Keep the originals in this tab, then Go to Develop.");
      return;
    }
    setFailure(null);
    void snapshotPhotoFiles(files)
      .then((copies) => {
        queueDevelopImport(copies);
        return navigate({ to: "/develop" });
      })
      .catch(report);
  }, [controller, navigate, report]);

  // Instagram: keepers this tab can decode post from their originals. RAW keepers
  // and reopened sessions have no readable original here; Develop posts those.
  const [instagram, setInstagram] = useState<{ ids: readonly string[]; initial: string[] } | null>(
    null,
  );
  const onInstagram = useCallback(
    (ids: readonly string[], currentId: string | null) =>
      setInstagram({
        ids,
        initial: currentId && ids.includes(currentId) ? [currentId] : ids.slice(0, 1),
      }),
    [],
  );
  const candidates = useMemo<InstagramCandidate[]>(() => {
    if (!instagram || !controller) return [];
    const names = new Map(snapshot.frames.map((frame) => [frame.id, frame.name]));
    return instagram.ids.map((id) => ({
      id,
      name: names.get(id) ?? "Photo",
      thumbnail: () => controller.thumbnail(id),
      preview: async () => (await preview(id))?.blob ?? null,
      source: async () => {
        const original = controller.original(id);
        return original && /^image\/(jpeg|png|webp)$/.test(original.type) ? original : null;
      },
    }));
    // Frame names only label tiles; the candidate list is fixed while the composer is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instagram, controller, preview]);

  const shown = failure && !snapshot.notice ? { ...snapshot, notice: failure } : snapshot;
  return (
    <>
      {instagram && (
        <InstagramComposer
          open
          onOpenChange={(open) => (open ? undefined : setInstagram(null))}
          origin="cull"
          candidates={candidates}
          initial={instagram.initial}
        />
      )}
      <CullWorkspace
        snapshot={shown}
        onImport={onImport}
        onCancelImport={onCancelImport}
        onCancelBackup={onCancelBackup}
        onExport={onExport}
        onMark={onMark}
        onUndo={onUndo}
        onKeepTarget={onKeepTarget}
        onAddCodes={onAddCodes}
        onRemoveCodes={onRemoveCodes}
        thumbnail={thumbnail}
        preview={preview}
        onReconnect={onReconnect}
        sessions={sessions}
        onOpenSession={onOpenSession}
        onFace={(id, box) => controller?.noteFace(id, box)}
        onDevelop={onDevelop}
        onInstagram={onInstagram}
      />
    </>
  );
}
