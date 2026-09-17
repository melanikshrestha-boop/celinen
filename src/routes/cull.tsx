import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useAccount } from "@/components/account/AccountProvider";
import { CullWorkspace } from "@/components/cull/CullWorkspace";
import { PRODUCT_NAME } from "@/lib/product";
import { CullController, type CullSnapshot } from "@/lib/studio/cull/controller";
import { openCullStore, type CullSessionSummary } from "@/lib/studio/cull/store";

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
};

/** One controller per account for as long as the page is open. */
function CullSessionHost({ scope }: { scope: string }) {
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
        owned = new CullController(store);
        unsubscribe = owned.subscribe(setSnapshot);
        setController(owned);
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
    (name: string, files: readonly File[]) => {
      if (!controller) return;
      setFailure(null);
      controller
        .importCard(name, files)
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
  // The loupe shows the original when this tab read the card and the browser
  // can paint it; RAW files and reopened sessions fall back to the thumbnail.
  const preview = useCallback(
    async (frameId: string) => {
      const original = controller?.original(frameId);
      if (original && /^image\/(jpeg|png|webp)$/.test(original.type)) return original;
      return controller?.thumbnail(frameId) ?? null;
    },
    [controller],
  );

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
      sessions={sessions}
      onOpenSession={onOpenSession}
    />
  );
}
