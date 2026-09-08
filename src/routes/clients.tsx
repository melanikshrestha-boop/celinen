import { createFileRoute, Link } from "@tanstack/react-router";
import "@/components/lensos/business-workspace.css";
import { useToolLeaveGuard } from "@/components/workbench/useToolLeaveGuard";
import { useEffect, useRef, useState } from "react";
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
      { title: "Clients — LensLabs" },
      {
        name: "description",
        content:
          "Client records with contacts, default templates and destinations, plus their events, open packages and last delivery. No CRM bloat.",
      },
      { property: "og:title", content: "Clients — LensLabs" },
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
        setState(loaded.state);
        setSelected((id) => id || loaded.state.clients[0]?.id || "");
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
  const visibleClients = state.clients.filter(
    (entry) =>
      (filter === "all" || entry.stage === filter) &&
      (!onlyDue || dueClients([entry], today).length > 0) &&
      `${entry.name} ${entry.org} ${entry.email}`.toLowerCase().includes(search.toLowerCase()),
  );
  const linkedGalleries = client
    ? galleries.filter((gallery) => client.galleryIds.includes(gallery.id))
    : [];
  const linkedInvoices = client
    ? invoices.filter((invoice) => client.invoiceIds.includes(invoice.id))
    : [];

  return (
    <Shell hideEventHeader>
      <div className="business-workspace">
        <SectionTitle
          kicker="Business"
          title="Client database"
          sub={
            cloud
              ? "Contacts, bookings, and follow-ups."
              : isLocalSingleUserMode
                ? "Contacts, bookings, and follow-ups. Saved on this device."
                : "Previous device-only records. These are not synced or assigned to your signed-in account."
          }
        />
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {!isLocalSingleUserMode && (
            <a
              className="text-sm text-moss underline underline-offset-4"
              href={cloud ? "/clients?legacy=1" : "/clients"}
            >
              {cloud ? "Previous device records" : "Account clients"}
            </a>
          )}
          <Btn variant="primary" disabled={!ready || busy} onClick={() => openClientForm("new")}>
            Add client
          </Btn>
          <label className="sr-only" htmlFor="client-search">
            Search clients
          </label>
          <input
            id="client-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search clients…"
            className={`${field} max-w-[220px]`}
          />
          <label className="sr-only" htmlFor="client-stage-filter">
            Filter clients by stage
          </label>
          <select
            id="client-stage-filter"
            className={`${field} max-w-[160px]`}
            value={filter}
            onChange={(event) => setFilter(event.target.value as ClientStage | "all")}
          >
            <option value="all">All stages</option>
            {CLIENT_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="px-2 py-2 text-sm text-moss hover:text-ink"
            aria-pressed={onlyDue}
            onClick={() => setOnlyDue(!onlyDue)}
          >
            {onlyDue
              ? "Show everyone"
              : `${dueClients(state.clients, today).length} follow-ups due`}
          </button>
          <details className="relative ml-auto text-sm">
            <summary className="cursor-pointer py-2 text-moss">Export & reminders</summary>
            <div className="absolute right-0 z-10 mt-2 w-64 rounded-xl bg-card p-4 shadow-lg">
              <button
                disabled={!ready}
                className="block py-2"
                onClick={() =>
                  downloadText(
                    clientCsv(state.clients),
                    "lenslabs-clients.csv",
                    "text/csv;charset=utf-8",
                  )
                }
              >
                Export spreadsheet
              </button>
              <button
                disabled={!ready || !state.clients.some((c) => c.followUpOn)}
                className="block py-2"
                onClick={() =>
                  downloadText(
                    reminderCalendar(state.clients),
                    "lenslabs-follow-ups.ics",
                    "text/calendar;charset=utf-8",
                  )
                }
              >
                Add follow-ups to calendar
              </button>
              <p className="mt-2 text-sm text-moss">
                Import into your calendar for alerts while LensLabs is closed. Re-export after
                changing dates; this is not a live sync.
              </p>
            </div>
          </details>
          {notice && (
            <p role="status" className="text-[12px] text-moss">
              {notice}
            </p>
          )}
        </div>
        {error && (
          <p role="alert" className="mb-4 text-sm text-destructive">
            {error}
          </p>
        )}
        <div
          className={`grid gap-8 ${client || editing ? "xl:grid-cols-[minmax(380px,1fr)_minmax(320px,1fr)]" : ""}`}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-moss">
                <tr>
                  <th className="px-3 py-3 font-normal">Client</th>
                  <th className="px-3 py-3 font-normal">Stage</th>
                  <th className="px-3 py-3 font-normal">Next follow-up</th>
                </tr>
              </thead>
              <tbody>
                {visibleClients.map((entry) => (
                  <tr
                    key={entry.id}
                    className={selected === entry.id ? "bg-muted/50" : "hover:bg-muted/30"}
                  >
                    <td className="p-3">
                      <button
                        onClick={() => {
                          setSelected(entry.id);
                          setEditing(null);
                          setBookingEdit(null);
                          setPreview(false);
                        }}
                        className="block w-full text-left"
                      >
                        <p className="font-display text-[15px] font-semibold tracking-tight">
                          {entry.name}
                        </p>
                        <p className="text-[13px] text-moss">
                          {entry.org || entry.email || "Contact not added"}
                        </p>
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <select
                        aria-label={`Stage for ${entry.name}`}
                        className="max-w-28 bg-transparent py-2 capitalize"
                        disabled={busy || !!editing || !!bookingEdit}
                        value={entry.stage}
                        onChange={(e) =>
                          void saveClient({
                            ...entry,
                            stage: e.target.value as ClientStage,
                            updatedAt: new Date().toISOString(),
                          })
                        }
                      >
                        {CLIENT_STAGES.map((stage) => (
                          <option key={stage}>{stage}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <input
                        aria-label={`Follow-up for ${entry.name}`}
                        type="date"
                        className={`w-36 bg-transparent py-2 ${entry.followUpOn && entry.followUpOn <= today ? "text-rust" : "text-moss"}`}
                        disabled={busy || !!editing || !!bookingEdit}
                        value={entry.followUpOn ?? ""}
                        onChange={(e) =>
                          void saveClient({
                            ...entry,
                            followUpOn: e.target.value || null,
                            updatedAt: new Date().toISOString(),
                          })
                        }
                      />
                      {dueClients([entry], today).length > 0 && (
                        <div className="flex gap-3 text-sm">
                          <button
                            disabled={busy || !!editing || !!bookingEdit}
                            onClick={() => void saveClient({ ...entry, followUpOn: null })}
                          >
                            Done
                          </button>
                          <button
                            disabled={busy || !!editing || !!bookingEdit}
                            className="text-moss"
                            onClick={() =>
                              void saveClient({ ...entry, followUpOn: nextFollowUp(today) })
                            }
                          >
                            Next week
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ready && visibleClients.length === 0 && (
              <p className="p-4 text-sm text-moss">
                {state.clients.length ? "No matching clients." : "Your first lead starts here."}
              </p>
            )}
          </div>
          <div className="space-y-4">
            {editing ? (
              <Card>
                <h2 className="font-display text-lg font-semibold">
                  {editing === "new" ? "Add client" : "Edit client"}
                </h2>
                <form onSubmit={submitClient} className="mt-4 space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className={label}>
                      Name
                      <input
                        required
                        className={field}
                        value={draft.name}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      />
                    </label>
                    <label className={label}>
                      Team / organization
                      <input
                        className={field}
                        value={draft.org}
                        onChange={(e) => setDraft({ ...draft, org: e.target.value })}
                      />
                    </label>
                    <label className={label}>
                      Email
                      <input
                        type="email"
                        className={field}
                        value={draft.email}
                        onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                      />
                    </label>
                    <label className={label}>
                      Phone
                      <input
                        type="tel"
                        className={field}
                        value={draft.phone}
                        onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                      />
                    </label>
                    <label className={label}>
                      How they found you
                      <input
                        className={field}
                        placeholder="Referral, Instagram, club outreach…"
                        value={draft.source}
                        onChange={(e) => setDraft({ ...draft, source: e.target.value })}
                      />
                    </label>
                    <label className={label}>
                      Stage
                      <select
                        className={field}
                        value={draft.stage}
                        onChange={(e) =>
                          setDraft({ ...draft, stage: e.target.value as ClientStage })
                        }
                      >
                        {CLIENT_STAGES.map((stage) => (
                          <option key={stage}>{stage}</option>
                        ))}
                      </select>
                    </label>
                    <label className={label}>
                      Next follow-up
                      <input
                        type="date"
                        name="followUpOn"
                        className={field}
                        value={draft.followUpOn}
                        onChange={(e) => setDraft({ ...draft, followUpOn: e.target.value })}
                        onInput={(e) => setDraft({ ...draft, followUpOn: e.currentTarget.value })}
                      />
                    </label>
                    <label className={label}>
                      Budget (USD, optional)
                      <input
                        inputMode="decimal"
                        className={field}
                        value={draft.budget}
                        onChange={(e) => setDraft({ ...draft, budget: e.target.value })}
                      />
                    </label>
                  </div>
                  <label className={`${label} block`}>
                    Creative brief
                    <textarea
                      rows={4}
                      className={field}
                      placeholder="What do they need? What should the photos feel like?"
                      value={draft.brief}
                      onChange={(e) => setDraft({ ...draft, brief: e.target.value })}
                    />
                  </label>
                  <div className="flex gap-2">
                    <button className={submitButton} type="submit" disabled={busy || !ready}>
                      {busy ? "Saving…" : "Save client"}
                    </button>
                    <button className={cancelButton} type="button" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              </Card>
            ) : client ? (
              <>
                <Card>
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-lg font-semibold">{client.name}</h2>
                    <Chip>{client.stage}</Chip>
                    <div className="ml-auto flex gap-2">
                      <Btn onClick={() => openClientForm("client")}>Edit</Btn>
                      <Btn
                        onClick={() => {
                          setPreview(!preview);
                          setBookingEdit(null);
                        }}
                      >
                        {preview ? "Back to client" : "Preview portal"}
                      </Btn>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-moss">
                        Contacts
                      </p>
                      <p className="text-sm">{client.org || client.name}</p>
                      <p className="text-sm text-moss">{client.email || "No email yet"}</p>
                      {client.phone && <p className="text-sm text-moss">{client.phone}</p>}
                    </div>
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-moss">
                        {preview ? "Shoot brief" : "Acquisition"}
                      </p>
                      {preview ? (
                        <p className="whitespace-pre-wrap text-sm">
                          {client.brief || "No brief yet."}
                        </p>
                      ) : (
                        <>
                          <p className="text-sm">{client.source || "Source not recorded"}</p>
                          <p className="text-sm text-moss">
                            {client.followUpOn
                              ? `Follow up ${client.followUpOn}`
                              : "No follow-up scheduled"}
                          </p>
                          <p className="text-sm text-moss">
                            {client.budgetCents === null
                              ? "Budget not agreed"
                              : `${dollars(client.budgetCents)} budget · manually entered`}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                  {!preview && client.brief && (
                    <p className="mt-4 whitespace-pre-wrap text-sm">{client.brief}</p>
                  )}
                </Card>
                {preview && (
                  <p role="status" className="text-[13px] text-moss">
                    Client portal preview — only on this device. No public link, invitation,
                    payment, or client access has been created.
                  </p>
                )}
                <Card className="p-0">
                  <div className="flex items-center justify-between gap-2 border-b border-border p-4">
                    <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
                      Shoots & bookings
                    </h3>
                    {!preview && (
                      <Btn disabled={busy || !ready} onClick={() => openBookingForm()}>
                        Add booking
                      </Btn>
                    )}
                  </div>
                  {bookingEdit && (
                    <form onSubmit={submitBooking} className="space-y-3 border-b border-border p-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className={label}>
                          Shoot name
                          <input
                            required
                            className={field}
                            value={bookingDraft.title}
                            placeholder="Saturday match coverage"
                            onChange={(e) =>
                              setBookingDraft({ ...bookingDraft, title: e.target.value })
                            }
                          />
                        </label>
                        <label className={label}>
                          Shoot date
                          <input
                            required
                            type="date"
                            name="shootDate"
                            className={field}
                            value={bookingDraft.date}
                            onChange={(e) =>
                              setBookingDraft({ ...bookingDraft, date: e.target.value })
                            }
                            onInput={(e) =>
                              setBookingDraft({ ...bookingDraft, date: e.currentTarget.value })
                            }
                          />
                        </label>
                        <label className={label}>
                          Location
                          <input
                            className={field}
                            value={bookingDraft.location}
                            onChange={(e) =>
                              setBookingDraft({ ...bookingDraft, location: e.target.value })
                            }
                          />
                        </label>
                        <label className={label}>
                          Booking status
                          <select
                            className={field}
                            value={bookingDraft.status}
                            onChange={(e) =>
                              setBookingDraft({
                                ...bookingDraft,
                                status: e.target.value as BookingStatus,
                              })
                            }
                          >
                            {BOOKING_STATUSES.map((status) => (
                              <option key={status}>{status}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <p className="text-[12px] text-moss">
                        Only mark confirmed after agreeing with the client. This records your
                        decision; it does not send a confirmation.
                      </p>
                      <div className="flex gap-2">
                        <button className={submitButton} type="submit" disabled={busy || !ready}>
                          Save booking
                        </button>
                        <button
                          className={cancelButton}
                          type="button"
                          onClick={() => setBookingEdit(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                  {!client.bookings.length && (
                    <p className="p-4 text-sm text-moss">No bookings yet.</p>
                  )}
                  {client.bookings.map((booking) => (
                    <div
                      key={booking.id}
                      className="flex flex-wrap items-center gap-2 border-b border-border p-4 last:border-0"
                    >
                      <div>
                        <p className="font-display text-[15px] font-semibold tracking-tight">
                          {booking.title}
                        </p>
                        <p className="text-[13px] text-moss">
                          {booking.date}
                          {booking.location ? ` · ${booking.location}` : ""}
                        </p>
                      </div>
                      <span className="ml-auto">
                        <Chip tone={booking.status === "confirmed" ? "accent" : "quiet"}>
                          {booking.status}
                        </Chip>
                      </span>
                      {!preview && (
                        <Btn disabled={busy || !ready} onClick={() => openBookingForm(booking)}>
                          Edit booking
                        </Btn>
                      )}
                    </div>
                  ))}
                </Card>
                {draftError && (
                  <p role="alert" className="text-sm text-destructive">
                    {draftError}
                  </p>
                )}
                <Card>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
                      Gallery drafts
                    </h3>
                    {!preview && (
                      <Link className="text-[13px] text-rust underline" to="/deliver">
                        Manage galleries
                      </Link>
                    )}
                  </div>
                  {!preview && (
                    <p className="mt-2 text-[12px] text-moss">
                      Choose the drafts that belong to this client. These links remain private.
                    </p>
                  )}
                  <div className="mt-3 space-y-3">
                    {(preview ? linkedGalleries : galleries).map((gallery) =>
                      preview ? (
                        <LocalGalleryPreview key={gallery.id} gallery={gallery} />
                      ) : (
                        <label key={gallery.id} className="flex items-center gap-3 text-sm">
                          <input
                            type="checkbox"
                            checked={client.galleryIds.includes(gallery.id)}
                            disabled={busy || !ready}
                            onChange={(event) =>
                              void saveClient(
                                linkClientDraft(
                                  client,
                                  "gallery",
                                  gallery.id,
                                  event.target.checked,
                                ),
                              )
                            }
                          />
                          <span>
                            {gallery.title}
                            <span className="ml-2 text-moss">
                              {gallery.photoCount} photos · local draft
                            </span>
                          </span>
                        </label>
                      ),
                    )}
                  </div>
                  {!(preview ? linkedGalleries : galleries).length && (
                    <p className="mt-3 text-sm text-moss">
                      {preview
                        ? "No galleries linked yet."
                        : "Create a gallery in Deliver, then link it here."}
                    </p>
                  )}
                  {client.galleryIds.some(
                    (id) => !galleries.some((gallery) => gallery.id === id),
                  ) && (
                    <p className="mt-2 text-[12px] text-moss">
                      A linked gallery is unavailable on this device. Its client reference is
                      preserved.
                    </p>
                  )}
                </Card>
                <Card>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
                      Invoice drafts
                    </h3>
                    {!preview && (
                      <Link className="text-[13px] text-rust underline" to="/earnings">
                        Manage invoices
                      </Link>
                    )}
                  </div>
                  <div className="mt-3 space-y-3">
                    {(preview ? linkedInvoices : invoices).map((invoice) => (
                      <label key={invoice.id} className="flex items-start gap-3 text-sm">
                        {!preview && (
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={client.invoiceIds.includes(invoice.id)}
                            disabled={busy || !ready}
                            onChange={(event) =>
                              void saveClient(
                                linkClientDraft(
                                  client,
                                  "invoice",
                                  invoice.id,
                                  event.target.checked,
                                ),
                              )
                            }
                          />
                        )}
                        <span className="min-w-0 flex-1">
                          {invoice.description}
                          <span className="block text-[12px] text-moss">
                            {preview
                              ? "Unsent draft"
                              : `${invoice.clientName}${invoice.clientEmail ? ` · ${invoice.clientEmail}` : ""} · unsent draft`}
                            {invoice.dueDate ? ` · due ${invoice.dueDate}` : ""}
                          </span>
                        </span>
                        <span className="font-mono text-[13px]">
                          {dollars(invoice.amountCents)}
                        </span>
                      </label>
                    ))}
                  </div>
                  {!(preview ? linkedInvoices : invoices).length && (
                    <p className="mt-3 text-sm text-moss">
                      {preview
                        ? "No invoices linked yet."
                        : "Create an invoice draft in Earnings, then link it here."}
                    </p>
                  )}
                  {client.invoiceIds.some(
                    (id) => !invoices.some((invoice) => invoice.id === id),
                  ) && (
                    <p className="mt-2 text-[12px] text-moss">
                      A linked invoice is unavailable on this device. Its client reference is
                      preserved.
                    </p>
                  )}
                </Card>
              </>
            ) : (
              ready && (
                <Card>
                  <p className="text-sm text-moss">
                    Add a client, record the brief, then turn it into a booking. Your clients will
                    appear here.
                  </p>
                </Card>
              )
            )}
          </div>
        </div>
      </div>
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
