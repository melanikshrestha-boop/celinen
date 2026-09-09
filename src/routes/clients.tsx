import { createFileRoute } from "@tanstack/react-router";
import "@/components/lensos/business-workspace.css";
import { useEffect, useRef, useState } from "react";
import { ClientsSheet } from "@/components/clients/ClientsSheet";
import { PRODUCT_NAME } from "@/lib/product";
import { readBusinessClients, saveBusinessClients } from "@/lib/business/clients.functions";
import { Shell } from "@/components/lensos/Shell";
import { isLocalSingleUserMode } from "@/lib/app-mode";
import {
  CLIENT_WORKSPACE_KEY,
  commitClientWorkspace,
  emptyClientWorkspace,
  loadClientWorkspace,
  upsertWorkspaceClient,
  type ClientWorkspace,
  type WorkspaceClient,
} from "@/lib/client-workspace";
import {
  LOCAL_FINANCE_STORAGE_KEY,
  loadLocalFinanceState,
  type LocalInvoiceDraft,
} from "@/lib/local-finance-store";
import { listLocalDeliveryGalleries, type LocalDeliveryGallerySummary } from "@/lib/delivery/local";

export const Route = createFileRoute("/clients")({
  head: () => ({
    meta: [
      { title: "Clients — " + PRODUCT_NAME },
      { name: "description", content: "Client contacts, follow-ups, bookings, and linked work." },
    ],
  }),
  component: ClientsWorkspace,
});

export function ClientsWorkspace() {
  const [local, setLocal] = useState<boolean | null>(null);
  useEffect(
    () =>
      setLocal(
        isLocalSingleUserMode || new URLSearchParams(window.location.search).get("legacy") === "1",
      ),
    [],
  );
  if (local === null)
    return (
      <Shell>
        <p className="text-sm text-moss">Opening clients…</p>
      </Shell>
    );
  return <LocalClients cloud={!local} />;
}

export function LocalClients({ cloud = false }: { cloud?: boolean }) {
  const [state, setState] = useState<ClientWorkspace>(emptyClientWorkspace);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const readSequence = useRef(0);
  const mounted = useRef(true);
  const [galleries, setGalleries] = useState<LocalDeliveryGallerySummary[]>([]);
  const [invoices, setInvoices] = useState<LocalInvoiceDraft[]>([]);
  const [draftError, setDraftError] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    let alive = true;
    async function readClients() {
      if (busyRef.current) return;
      const sequence = ++readSequence.current;
      const loaded = cloud
        ? await readBusinessClients()
            .then((value) => ({ ok: true as const, state: value }))
            .catch((failure) => ({
              ok: false as const,
              error: failure instanceof Error ? failure.message : "Client sync is unavailable.",
            }))
        : loadClientWorkspace();
      if (!alive || sequence !== readSequence.current) return;
      if (loaded.ok) {
        // Loading is read-only: never seed, reorder, prune or rewrite the user's contacts.
        setState(loaded.state);
        setReady(true);
        setError(null);
      } else {
        setError(loaded.error);
        setReady(false);
      }
    }
    async function readDrafts() {
      // Device drafts are not another signed-in account's relationships.
      if (cloud) {
        setGalleries([]);
        setInvoices([]);
        setDraftError(null);
        return;
      }
      const finance = loadLocalFinanceState();
      let galleryRows: LocalDeliveryGallerySummary[] = [];
      let galleryError: string | null = null;
      try {
        galleryRows = await listLocalDeliveryGalleries();
      } catch {
        galleryError = "Gallery drafts could not be read. Their saved data was not changed.";
      }
      if (!alive) return;
      setGalleries(galleryRows);
      setInvoices(finance.ok ? finance.state.invoices : []);
      setDraftError(galleryError ?? (finance.ok ? null : finance.warning));
    }
    const storage = (event: StorageEvent) => {
      if (event.key === CLIENT_WORKSPACE_KEY || event.key === null) void readClients();
      if (event.key === LOCAL_FINANCE_STORAGE_KEY || event.key === null) void readDrafts();
    };
    const focus = () => {
      void readClients();
      void readDrafts();
    };
    void readClients();
    void readDrafts();
    window.addEventListener("storage", storage);
    window.addEventListener("focus", focus);
    return () => {
      alive = false;
      mounted.current = false;
      window.removeEventListener("storage", storage);
      window.removeEventListener("focus", focus);
    };
  }, [cloud]);

  async function saveClient(next: WorkspaceClient, revision = state.revision): Promise<boolean> {
    if (!ready || busyRef.current) return false;
    busyRef.current = true;
    ++readSequence.current;
    setError(null);
    try {
      const update = {
        ...upsertWorkspaceClient(state, { ...next, updatedAt: new Date().toISOString() }),
        revision,
      };
      const result = cloud
        ? await saveBusinessClients({ data: update })
            .then((value) => ({ ok: true as const, state: value }))
            .catch((failure) => ({
              ok: false as const,
              error: failure instanceof Error ? failure.message : "Client save failed.",
            }))
        : await commitClientWorkspace(update);
      if (!mounted.current) return result.ok;
      if (!result.ok) {
        setError(result.error);
        if ("currentState" in result) setState(result.currentState as ClientWorkspace);
        return false;
      }
      setState(result.state);
      return true;
    } finally {
      busyRef.current = false;
    }
  }
  return (
    <Shell hideEventHeader>
      <ClientsSheet
        state={state}
        ready={ready}
        error={error}
        cloud={cloud}
        onSave={saveClient}
        galleries={galleries}
        invoices={invoices}
        relationshipError={draftError}
      />
    </Shell>
  );
}
