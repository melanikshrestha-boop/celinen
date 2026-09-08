import { createFileRoute, Link } from "@tanstack/react-router";
import "@/components/lensos/business-workspace.css";
import { useToolLeaveGuard } from "@/components/workbench/useToolLeaveGuard";
import { useEffect, useRef, useState } from "react";
import { ClientsSheet } from "@/components/clients/ClientsSheet";
import { PRODUCT_NAME } from "@/lib/product";
import { ensureSeedClients } from "@/lib/clients/sheet";
import { readBusinessClients, saveBusinessClients } from "@/lib/business/clients.functions";
import {
  clientCsv,
  downloadText,
  dueClients,
  localDate,
  nextFollowUp,
  reminderCalendar,
} from "@/lib/business/reminders";
import { Btn, Card, Chip, SectionTitle, Shell } from "@/components/lensos/Shell";
import { useLens } from "@/lib/lensos-store";
import { isLocalSingleUserMode } from "@/lib/app-mode";
import {
  BOOKING_STATUSES,
  CLIENT_STAGES,
  CLIENT_WORKSPACE_KEY,
  buildClientBooking,
  buildWorkspaceClient,
  clientToInput,
  commitClientWorkspace,
  emptyClientInput,
  emptyClientWorkspace,
  linkClientDraft,
  loadClientWorkspace,
  upsertClientBooking,
  upsertWorkspaceClient,
  type BookingStatus,
  type ClientBooking,
  type ClientInput,
  type ClientStage,
  type ClientWorkspace,
  type WorkspaceClient,
} from "@/lib/client-workspace";
import {
  LOCAL_FINANCE_STORAGE_KEY,
  loadLocalFinanceState,
  type LocalInvoiceDraft,
} from "@/lib/local-finance-store";
import {
  getLocalDeliveryGallery,
  listLocalDeliveryGalleries,
  type LocalDeliveryGallerySummary,
} from "@/lib/delivery/local";

export const Route = createFileRoute("/clients")({
  head: () => ({
    meta: [
      { title: `Clients — ${PRODUCT_NAME}` },
      {
        name: "description",
        content:
          "Client records with contacts, default templates and destinations, plus their events, open packages and last delivery. No CRM bloat.",
      },
      { property: "og:title", content: `Clients — ${PRODUCT_NAME}` },
      {
        property: "og:description",
        content: "Contacts, defaults, events, open packages, last delivery.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Clients,
});

function Clients() {
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

function DemoClients() {
  const { clients, events, setActiveId } = useLens();
  const [open, setOpen] = useState(clients[0]?.id ?? "");
  const client = clients.find((c) => c.id === open);
  const theirEvents = events.filter((e) => e.clientId === open);

  return (
    <Shell>
      <SectionTitle
        kicker="Clients"
        title="Who the work is for, and what they expect by default."
        sub="Contacts, default template, default destination, and every event you have run for them."
      />

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="space-y-2">
          {clients.map((c) => (
            <button
              key={c.id}
              onClick={() => setOpen(c.id)}
              className={`block w-full rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 ${
                open === c.id ? "border-rust/50 bg-card" : "border-border bg-card"
              }`}
            >
              <p className="font-display text-[15px] font-semibold tracking-tight">{c.name}</p>
              <p className="text-[13px] text-moss">{c.org}</p>
            </button>
          ))}
        </div>

        {client && (
          <div className="space-y-4">
            <Card>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-moss">
                    Contacts
                  </p>
                  {client.contacts.map((c) => (
                    <p key={c.email} className="text-sm">
                      {c.name} · <span className="text-moss">{c.email}</span>
                    </p>
                  ))}
                </div>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-moss">
                    Defaults
                  </p>
                  <p className="text-sm">{client.template}</p>
                  <p className="text-sm text-moss">{client.destination}</p>
                </div>
              </div>
            </Card>

            <Card className="p-0">
              <p className="border-b border-border p-4 font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
                Events
              </p>
              {theirEvents.length === 0 && <p className="p-4 text-sm text-moss">No events yet.</p>}
              {theirEvents.map((e) => {
                const openPkgs = e.packages.filter((p) => p.state !== "delivered").length;
                const last = e.receipts[e.receipts.length - 1];
                return (
                  <button
                    key={e.id}
                    onClick={() => setActiveId(e.id)}
                    className="flex w-full flex-wrap items-center gap-2 border-b border-border p-4 text-left last:border-0 hover:bg-muted"
                  >
                    <span className="font-display text-[15px] font-semibold tracking-tight">
                      {e.name}
                    </span>
                    <Chip
                      tone={
                        e.status === "active"
                          ? "accent"
                          : e.status === "delivered"
                            ? "solid"
                            : "quiet"
                      }
                    >
                      {e.status}
                    </Chip>
                    <span className="ml-auto text-[13px] text-moss">
                      {openPkgs} open package{openPkgs === 1 ? "" : "s"} ·{" "}
                      {last ? `last delivery ${last.at}` : "no delivery yet"}
                    </span>
                  </button>
                );
              })}
            </Card>
          </div>
        )}
      </div>
    </Shell>
  );
}

const field =
  "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-rust/30";
const label = "space-y-1.5 text-[12px] text-moss";
const submitButton =
  "rounded-xl bg-ink px-4 py-2 text-sm font-medium text-paper2 hover:opacity-90 disabled:opacity-40";
const cancelButton =
  "rounded-xl border border-input bg-card px-4 py-2 text-sm font-medium text-moss hover:text-ink";
const dollars = (cents: number) =>
  (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
type BookingInput = { title: string; date: string; location: string; status: BookingStatus };
const emptyBooking = (): BookingInput => ({
  title: "",
  date: "",
  location: "",
  status: "requested",
});

export function LocalClients({ cloud = false }: { cloud?: boolean }) {
  const [state, setState] = useState<ClientWorkspace>(emptyClientWorkspace);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState<ClientStage | "all">("all");
  const [search, setSearch] = useState("");
  const [onlyDue, setOnlyDue] = useState(false);
  const [today, setToday] = useState(localDate);
  useEffect(() => {
    const timer = setInterval(() => setToday(localDate()), 60000);
    return () => clearInterval(timer);
  }, []);
  const [editing, setEditing] = useState<"new" | "client" | null>(null);
  const [draft, setDraft] = useState<ClientInput>(emptyClientInput);
  const [editRevision, setEditRevision] = useState(0);
  const [bookingDraft, setBookingDraft] = useState<BookingInput>(emptyBooking);
  const [bookingEdit, setBookingEdit] = useState<ClientBooking | "new" | null>(null);
  const [bookingRevision, setBookingRevision] = useState(0);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [galleries, setGalleries] = useState<LocalDeliveryGallerySummary[]>([]);
  const [invoices, setInvoices] = useState<LocalInvoiceDraft[]>([]);
  const [draftError, setDraftError] = useState<string | null>(null);
  const client = state.clients.find((entry) => entry.id === selected);
  useToolLeaveGuard(
    busy
      ? "A client or booking save is still in progress."
      : editing || bookingEdit
        ? "You have an open client or booking form. Any unsaved changes will be discarded."
        : null,
  );

  useEffect(() => {
    let alive = true;
    const readClients = async () => {
      const loaded = cloud
        ? await readBusinessClients()
            .then((state) => ({ ok: true as const, state }))
            .catch((e) => ({
              ok: false as const,
              error: e instanceof Error ? e.message : "Client sync is unavailable.",
            }))
        : loadClientWorkspace();
      if (!alive) return;
      if (loaded.ok) {
        const seeded = cloud ? loaded.state : ensureSeedClients(loaded.state);
        if (!cloud && seeded !== loaded.state && seeded.revision === loaded.state.revision) {
          void commitClientWorkspace(seeded).then((saved) => {
            if (!alive) return;
            if (saved.ok) {
              setState(saved.state);
              setSelected((id) => id || saved.state.clients[0]?.id || "");
            } else {
              setState(seeded);
              setSelected((id) => id || seeded.clients[0]?.id || "");
            }
            setReady(true);
          });
          return;
        }
        setState(seeded);
        setSelected((id) => id || seeded.clients[0]?.id || "");
        setReady(true);
      } else {
        setError(loaded.error);
        setReady(false);
      }
    };
    const readDrafts = async () => {
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
    };
    const storage = (event: StorageEvent) => {
      if (event.key === CLIENT_WORKSPACE_KEY || event.key === null) readClients();
      if (event.key === LOCAL_FINANCE_STORAGE_KEY || event.key === null) void readDrafts();
    };
    const focus = () => {
      readClients();
      void readDrafts();
    };
    readClients();
    void readDrafts();
    window.addEventListener("storage", storage);
    window.addEventListener("focus", focus);
    return () => {
      alive = false;
      window.removeEventListener("storage", storage);
      window.removeEventListener("focus", focus);
    };
  }, [cloud]);

  async function saveClient(next: WorkspaceClient, revision = state.revision): Promise<boolean> {
    if (!ready || busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const update = {
        ...upsertWorkspaceClient(state, { ...next, updatedAt: new Date().toISOString() }),
        revision,
      };
      const result = cloud
        ? await saveBusinessClients({ data: update })
            .then((state) => ({ ok: true as const, state }))
            .catch((e) => ({
              ok: false as const,
              error: e instanceof Error ? e.message : "Client save failed.",
            }))
        : await commitClientWorkspace(update);
      if (!result.ok) {
        setError(result.error);
        if ("currentState" in result) setState(result.currentState as ClientWorkspace);
        return false;
      }
      setState(result.state);
      setSelected(next.id);
      setNotice(cloud ? "Saved to your account." : "Saved on this device.");
      return true;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function openClientForm(mode: "new" | "client") {
    setDraft(mode === "client" && client ? clientToInput(client) : emptyClientInput());
    setEditRevision(state.revision);
    setEditing(mode);
    setBookingEdit(null);
    setPreview(false);
    setError(null);
  }
  async function submitClient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const built = buildWorkspaceClient(
      { ...draft, followUpOn: String(fields.get("followUpOn") ?? "") },
      editing === "client" ? client : undefined,
    );
    if (!built.ok) return setError(built.error);
    if (await saveClient(built.value, editRevision)) setEditing(null);
  }
  function openBookingForm(existing?: ClientBooking) {
    setBookingEdit(existing ?? "new");
    setBookingDraft(existing ?? emptyBooking());
    setBookingRevision(state.revision);
    setEditing(null);
    setError(null);
  }
  async function submitBooking(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    const fields = new FormData(event.currentTarget);
    const built = buildClientBooking(
      { ...bookingDraft, date: String(fields.get("shootDate") ?? "") },
      bookingEdit === "new" || bookingEdit === null ? undefined : bookingEdit,
    );
    if (!built.ok) return setError(built.error);
    if (await saveClient(upsertClientBooking(client, built.value), bookingRevision))
      setBookingEdit(null);
  }
  return (
    <Shell hideEventHeader>
      <ClientsSheet state={state} ready={ready} error={error} cloud={cloud} onSave={saveClient} />
    </Shell>
  );
}

function LocalGalleryPreview({ gallery }: { gallery: LocalDeliveryGallerySummary }) {
  const [photos, setPhotos] = useState<Array<{ url: string; name: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    void getLocalDeliveryGallery(gallery.id)
      .then((result) => {
        if (!alive) return;
        if (!result) return setError("This gallery is no longer available.");
        setPhotos(
          result.photos.slice(0, 12).map((photo) => {
            const url = URL.createObjectURL(photo.previewBlob);
            urls.push(url);
            return { url, name: photo.filename };
          }),
        );
      })
      .catch(() => {
        if (alive) setError("Preview could not be loaded.");
      });
    return () => {
      alive = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [gallery.id]);
  return (
    <div>
      <p className="text-sm">
        {gallery.title}{" "}
        <span className="text-moss">· {gallery.photoCount} photos · local draft</span>
      </p>
      {gallery.message && (
        <p className="mt-1 whitespace-pre-wrap text-[13px] text-moss">{gallery.message}</p>
      )}
      {photos.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((photo) => (
            <img
              key={photo.url}
              src={photo.url}
              alt={photo.name}
              className="aspect-square w-full rounded-lg object-cover"
            />
          ))}
        </div>
      )}
      {gallery.photoCount > 12 && (
        <p className="mt-2 text-[12px] text-moss">Showing the first 12 previews.</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
