import { useCallback, useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAccount } from "@/components/account/AccountProvider";
import { CullWorkspace } from "@/components/cull/CullWorkspace";
import { importName } from "@/components/cull/cull-review";
import { PRODUCT_NAME } from "@/lib/product";
import { CullController, type CullSnapshot } from "@/lib/studio/cull/controller";
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
        });
        unsubscribe = owned.subscribe(setSnapshot);
        setController(owned);
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
    (name: string, files: readonly File[], roots?: readonly CullSourceRoot[]) => {
      if (!controller) return;
      setFailure(null);
      controller
        .importCard(name, files, roots)
        .catch(report)
        .finally(() => void refreshSessions());
    },
    [controller, report, refreshSessions],
  );
  const onCancelImport = useCallback(() => controller?.cancelImport(), [controller]);
  const onDecide = useCallback(
    (ids: readonly string[], verdict: Parameters<CullController["decide"]>[1]) =>
      void controller?.decide(ids, verdict).catch(report),
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

  const shown = failure && !snapshot.notice ? { ...snapshot, notice: failure } : snapshot;
  return (
    <CullWorkspace
      snapshot={shown}
      onImport={onImport}
      onCancelImport={onCancelImport}
      onDecide={onDecide}
      onUndo={onUndo}
      thumbnail={thumbnail}
      preview={preview}
      onReconnect={onReconnect}
      sessions={sessions}
      onOpenSession={onOpenSession}
      onFace={(id, box) => controller?.noteFace(id, box)}
      onDevelop={onDevelop}
    />
  );
}
