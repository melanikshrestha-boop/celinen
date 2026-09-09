import { useEffect, useMemo, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useWorkbench } from "@/components/workbench/context";
import {
  CLIENT_STAGES,
  buildWorkspaceClient,
  type ClientWorkspace,
  type ClientStage,
  type WorkspaceClient,
} from "@/lib/client-workspace";
import {
  CLIENT_COMMAND_EVENT,
  emptyExtra,
  findClient,
  formatDate,
  money,
  stageLabel,
  takePendingClientCommand,
  toRow,
  writeExtra,
  type ClientCommand,
  type ClientRow,
  type JobType,
} from "@/lib/clients/sheet";
import "./clients-sheet.css";
import { ClientContact, ClientFollowUp, ClientPeople } from "./ClientPeople";
import { ClientEditor, type ClientEdit } from "./ClientEditor";
import {
  CLIENT_STAGE_LABELS,
  clientFollowUp,
  clientRelationships,
  filterClients,
} from "@/lib/clients/crm";
import { useToolLeaveGuard } from "@/components/workbench/useToolLeaveGuard";
import { clientCsv, downloadText, localDate, reminderCalendar } from "@/lib/business/reminders";
import type { LocalDeliveryGallerySummary } from "@/lib/delivery/local";
import type { LocalInvoiceDraft } from "@/lib/local-finance-store";

const COLUMNS = [
  { key: "client", label: "Client", className: "clients-col-client" },
  { key: "alias", label: "Alias", className: "clients-col" },
  { key: "location", label: "Location", className: "clients-col" },
  { key: "paid", label: "Paid", className: "clients-col-num" },
  { key: "cover", label: "Cover", className: "clients-col-cover" },
  { key: "type", label: "Type", className: "clients-col" },
  { key: "date", label: "Date", className: "clients-col" },
  { key: "stage", label: "Stage", className: "clients-col" },
  { key: "gallery", label: "Gallery", className: "clients-col" },
  { key: "agreed", label: "Agreed", className: "clients-col-num" },
  { key: "nda", label: "NDA", className: "clients-col" },
  { key: "channel", label: "Channel", className: "clients-col" },
  { key: "watermark", label: "Watermark", className: "clients-col" },
  { key: "download", label: "Download", className: "clients-col" },
  { key: "expires", label: "Expires", className: "clients-col" },
  { key: "gps", label: "GPS", className: "clients-col" },
  { key: "serial", label: "Serial", className: "clients-col" },
  { key: "last", label: "Last", className: "clients-col" },
  { key: "guest", label: "Guest", className: "clients-col" },
  { key: "pw", label: "Client pw", className: "clients-col" },
  { key: "pin", label: "PIN", className: "clients-col" },
] as const;

function SelectChip({ value }: { value: string }) {
  if (!value) return null;
  return (
    <span className={`clients-select is-${value.toLowerCase().replace(/\s+/g, "-")}`}>{value}</span>
  );
}

function CoverThumb({ cover }: { cover: string | null }) {
  if (!cover) return null;
  return <img className="clients-file" src={cover} alt="" />;
}

function Cell({ row, column }: { row: ClientRow; column: (typeof COLUMNS)[number]["key"] }) {
  switch (column) {
    case "client":
      return row.name;
    case "alias":
      return row.alias;
    case "location":
      return row.location;
    case "paid":
      return money(row.receivedCents);
    case "cover":
      return <CoverThumb cover={row.cover} />;
    case "type":
      return <SelectChip value={row.type} />;
    case "date":
      return formatDate(row.date);
    case "stage":
      return <SelectChip value={stageLabel(row.sheetStage)} />;
    case "gallery":
      return <SelectChip value={row.gallery} />;
    case "agreed":
      return money(row.totalCents);
    case "nda":
      return <SelectChip value={row.nda} />;
    case "channel":
      return <SelectChip value={row.channel} />;
    case "watermark":
      return <SelectChip value={row.watermark} />;
    case "download":
      return <SelectChip value={row.download} />;
    case "expires":
      return formatDate(row.expires);
    case "gps":
      return <SelectChip value={row.gps} />;
    case "serial":
      return <SelectChip value={row.serial} />;
    case "last":
      return row.last;
    case "guest":
      return row.guest;
    case "pw":
      return row.clientPw;
    case "pin":
      return row.pin;
  }
}

const PAGE_PROPS: { label: string; value: (row: ClientRow) => string }[] = [
  { label: "Alias", value: (row) => row.alias },
  { label: "Location", value: (row) => row.location },
  { label: "Paid", value: (row) => money(row.receivedCents) },
  { label: "Cover", value: (row) => (row.cover ? "1 file" : "") },
  { label: "Type", value: (row) => row.type },
  { label: "Date", value: (row) => formatDate(row.date) },
  { label: "Stage", value: (row) => stageLabel(row.sheetStage) },
  { label: "Gallery", value: (row) => row.gallery },
  { label: "Agreed", value: (row) => money(row.totalCents) },
  { label: "NDA", value: (row) => (row.ndaOn ? `${row.nda} · ${formatDate(row.ndaOn)}` : row.nda) },
  { label: "Channel", value: (row) => row.channel },
  { label: "Watermark", value: (row) => row.watermark },
  { label: "Download", value: (row) => row.download },
  { label: "Expires", value: (row) => formatDate(row.expires) },
  { label: "GPS", value: (row) => row.gps },
  { label: "Serial", value: (row) => row.serial },
  { label: "Last", value: (row) => row.last },
  { label: "Guest", value: (row) => row.guest },
  { label: "Client pw", value: (row) => row.clientPw },
  { label: "PIN", value: (row) => row.pin },
  { label: "Notes", value: (row) => row.notes },
];

export function ClientsSheet({
  state,
  ready,
  error,
  cloud,
  onSave,
  galleries = [],
  invoices = [],
  relationshipError = null,
}: {
  state: ClientWorkspace;
  ready: boolean;
  error: string | null;
  cloud: boolean;
  onSave: (client: WorkspaceClient, revision?: number) => Promise<boolean>;
  galleries?: readonly LocalDeliveryGallerySummary[];
  invoices?: readonly LocalInvoiceDraft[];
  relationshipError?: string | null;
}) {
  const workbench = useWorkbench();
  const setToolTitle = workbench?.setToolTitle;
  const href = useRouterState({ select: (s) => s.location.href });
  const [view, setView] = useState<"people" | "followups" | "board" | "sheet">("people");
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState<ClientStage | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [edit, setEdit] = useState<ClientEdit | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [today, setToday] = useState(localDate);
  const rows = useMemo(() => state.clients.map(toRow), [state.clients]);
  const visible = filterClients(rows, {
    query: search,
    stage,
    today,
    followUps: view === "followups",
    extra: (row) => row.alias + " " + row.type + " " + row.location,
  });
  const opened = openId ? rows.find((row) => row.id === openId) : undefined;
  const toolTitle = opened?.name ?? "Clients";
  const due = state.clients.filter((client) =>
    ["overdue", "today"].includes(clientFollowUp(client, today)),
  ).length;
  useToolLeaveGuard(
    saving
      ? "A client save is still in progress."
      : edit
        ? "You have unsaved client or booking details."
        : null,
  );
  useEffect(() => {
    const timer = setInterval(() => setToday(localDate()), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setToolTitle?.(href, toolTitle);
  }, [href, toolTitle, setToolTitle]);

  async function persist(client: WorkspaceClient, revision: number) {
    if (!ready || savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    setNote(null);
    try {
      const ok = await onSave(client, revision);
      if (ok) setNote(cloud ? "Saved to your account." : "Saved on this device.");
      else
        setSaveError(
          "This change was not saved. Review the error, then cancel and reopen the form if the records changed.",
        );
      return ok;
    } catch (failure) {
      setSaveError(
        failure instanceof Error
          ? failure.message
          : "The change could not be saved. Nothing was sent.",
      );
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  function beginEdit(client?: WorkspaceClient, followUp = false) {
    setEdit({ kind: "client", ...(client ? { client } : {}), revision: state.revision, followUp });
    if (client) setOpenId(client.id);
    setSaveError(null);
  }
  async function createLead(name: string, type: JobType | "", date: string) {
    const built = buildWorkspaceClient({
      name,
      org: "",
      email: "",
      phone: "",
      source: type,
      brief: "",
      followUpOn: "",
      budget: "",
      stage: "new",
    });
    if (!built.ok) return setSaveError(built.error);
    if (await persist(built.value, state.revision)) {
      writeExtra(built.value.id, { ...emptyExtra(), type, date });
      setOpenId(built.value.id);
    }
  }
  async function applyCommand(command: ClientCommand) {
    if (!ready || edit || savingRef.current) {
      setNote("Finish the open form before another client action.");
      return;
    }
    if (command.kind === "quiet") {
      setStage("archived");
      setSearch("");
      setOpenId(null);
      setView("people");
      return;
    }
    if (command.kind === "unopened") {
      setNote(
        "Gallery viewing activity is not tracked here. Saved gallery labels do not prove that a client opened a gallery.",
      );
      return;
    }
    if (command.kind === "add") {
      await createLead(command.name, command.type ?? "", command.date ?? "");
      return;
    }
    const hit = findClient(rows, command.name);
    if (!hit) {
      setNote("No client named " + command.name + ".");
      return;
    }
    setOpenId(hit.id);
    if (command.kind === "attach") {
      // A requested booking is not a created shoot/project: let the user supply and review it.
      setEdit({ kind: "booking", client: hit, revision: state.revision });
    }
  }
  useEffect(() => {
    const onCommand = (event: Event) => {
      const command = (event as CustomEvent<ClientCommand>).detail;
      if (!command) return;
      takePendingClientCommand();
      void applyCommand(command);
    };
    window.addEventListener(CLIENT_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(CLIENT_COMMAND_EVENT, onCommand);
  });
  useEffect(() => {
    if (!ready) return;
    const pending = takePendingClientCommand();
    if (pending) void applyCommand(pending);
  });

  const alerts = (
    <>
      {error && (
        <p className="clients-alert" role="alert">
          {error}
        </p>
      )}
      {saveError && (
        <p className="clients-alert" role="alert">
          {saveError}
        </p>
      )}
      {note && (
        <p className="clients-notice" role="status">
          {note}
        </p>
      )}
    </>
  );
  const editor = edit ? (
    <ClientEditor
      key={
        edit.kind +
        (edit.client?.id ?? "new") +
        (edit.kind === "booking" ? (edit.booking?.id ?? "new") : "")
      }
      edit={edit}
      saving={saving}
      onSave={async (client, revision) => {
        const ok = await persist(client, revision);
        if (ok) setOpenId(client.id);
        return ok;
      }}
      onCancel={() => setEdit(null)}
    />
  ) : null;

  if (opened && !edit) {
    const relationships = clientRelationships(opened, galleries, invoices);
    return (
      <div className="clients-sheet">
        <article className="clients-detail">
          <button type="button" className="clients-back" onClick={() => setOpenId(null)}>
            ← All clients
          </button>
          {alerts}
          <header className="clients-detail-head">
            <span className="clients-avatar" aria-hidden="true">
              {opened.initials}
            </span>
            <div>
              <h1>{opened.name}</h1>
              {opened.org && <p>{opened.org}</p>}
              <span className="clients-stage">{CLIENT_STAGE_LABELS[opened.stage]}</span>
            </div>
            <button type="button" disabled={!ready || saving} onClick={() => beginEdit(opened)}>
              Edit contact
            </button>
          </header>
          <div className="clients-detail-grid">
            <section aria-label="Contact and follow-up">
              <h2>Contact</h2>
              <ClientContact client={opened} />
              {opened.source && <p className="clients-muted">Source · {opened.source}</p>}
              <div className="clients-section-heading">
                <h2>Next follow-up</h2>
                <button type="button" disabled={saving} onClick={() => beginEdit(opened, true)}>
                  Schedule
                </button>
              </div>
              <ClientFollowUp client={opened} today={today} />
              {opened.followUpOn && (
                <div className="clients-inline-actions">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      void persist({ ...opened, followUpOn: null }, state.revision);
                    }}
                  >
                    Clear reminder
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      downloadText(
                        reminderCalendar([opened]),
                        "client-follow-up.ics",
                        "text/calendar",
                      )
                    }
                  >
                    Add to calendar
                  </button>
                </div>
              )}
              <h2>Brief / notes</h2>
              <p className="clients-brief">{opened.brief || "No notes yet."}</p>
              {opened.budgetCents !== null && (
                <p className="clients-muted">
                  Planning budget ·{" "}
                  {new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(
                    opened.budgetCents / 100,
                  )}{" "}
                  · not a payment
                </p>
              )}
            </section>
            <section aria-label="Client relationships">
              <div className="clients-section-heading">
                <h2>
                  Bookings <span>{opened.bookings.length}</span>
                </h2>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    setEdit({ kind: "booking", client: opened, revision: state.revision })
                  }
                >
                  Add booking
                </button>
              </div>
              {opened.bookings.length ? (
                [...opened.bookings]
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .map((booking) => (
                    <div className="clients-relationship" key={booking.id}>
                      <div>
                        <strong>{booking.title}</strong>
                        <p>
                          {formatDate(booking.date)}
                          {booking.location ? " · " + booking.location : ""} · {booking.status}
                        </p>
                        <details>
                          <summary>Record ID</summary>
                          <code>{booking.id}</code>
                        </details>
                      </div>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() =>
                          setEdit({
                            kind: "booking",
                            client: opened,
                            booking,
                            revision: state.revision,
                          })
                        }
                      >
                        Edit
                      </button>
                    </div>
                  ))
              ) : (
                <p className="clients-muted">No bookings recorded.</p>
              )}
              <h2>
                Galleries <span>{relationships.galleries.length}</span>
              </h2>
              {relationships.galleries.length ? (
                relationships.galleries.map(({ id, record }) => (
                  <div className="clients-relationship" key={id}>
                    <div>
                      <strong>{record?.title ?? "Linked gallery"}</strong>
                      <p>
                        {record
                          ? record.photoCount + " photos · local draft"
                          : "Details not available in this workspace"}
                      </p>
                      <code>{id}</code>
                    </div>
                  </div>
                ))
              ) : (
                <p className="clients-muted">No galleries linked.</p>
              )}
              <h2>
                Invoices <span>{relationships.invoices.length}</span>
              </h2>
              {relationships.invoices.length ? (
                relationships.invoices.map(({ id, record, conflict }) => (
                  <div className="clients-relationship" key={id}>
                    <div>
                      <strong>{record?.description || "Linked invoice"}</strong>
                      <p>
                        {conflict
                          ? "Conflicting client link — review in Earnings"
                          : record
                            ? "Draft · not sent" +
                              (record.dueDate ? " · due " + formatDate(record.dueDate) : "")
                            : "Details not available in this workspace"}
                      </p>
                      <code>{id}</code>
                    </div>
                  </div>
                ))
              ) : (
                <p className="clients-muted">No invoices linked.</p>
              )}
              {relationshipError && (
                <p className="clients-alert" role="alert">
                  {relationshipError}
                </p>
              )}
            </section>
          </div>
          <details className="clients-extra">
            <summary>All saved sheet fields & record details</summary>
            <p className="clients-muted">
              Legacy planning fields are retained as entered. “Paid”, gallery, NDA, password and
              access labels are not verified payments, signatures, viewing activity or active access
              controls.
            </p>
            <dl className="clients-props">
              <div className="clients-prop">
                <dt>Client ID</dt>
                <dd>
                  <code>{opened.id}</code>
                </dd>
              </div>
              <div className="clients-prop">
                <dt>Created</dt>
                <dd>{opened.createdAt}</dd>
              </div>
              <div className="clients-prop">
                <dt>Updated</dt>
                <dd>{opened.updatedAt}</dd>
              </div>
              {PAGE_PROPS.map((prop) => (
                <div className="clients-prop" key={prop.label}>
                  <dt>{prop.label}</dt>
                  <dd>
                    {prop.label === "Cover" && opened.cover ? (
                      <CoverThumb cover={opened.cover} />
                    ) : (
                      prop.value(opened) || "—"
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        </article>
      </div>
    );
  }
  return (
    <div className="clients-sheet">
      <header className="clients-head">
        <div>
          <h1 className="clients-title">Clients</h1>
          <p className="clients-sub">
            {ready
              ? rows.length +
                " contacts · " +
                due +
                " follow-ups due · " +
                (cloud ? "Saved to your account" : "Saved on this device")
              : "Opening saved clients…"}
          </p>
        </div>
        {!edit && (
          <button
            type="button"
            className="clients-primary"
            disabled={!ready || saving}
            onClick={() => beginEdit()}
          >
            New client
          </button>
        )}
      </header>
      {alerts}
      {editor || (
        <>
          <div className="clients-toolbar">
            <div className="clients-view-switch" aria-label="Client views">
              {(
                [
                  ["people", "People"],
                  ["followups", "Follow-ups"],
                  ["board", "Board"],
                  ["sheet", "All fields"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={view === key}
                  onClick={() => setView(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="clients-search">
              <span className="clients-sr-only">Search clients</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, email, phone…"
              />
            </label>
            <select
              aria-label="Filter by client stage"
              value={stage}
              onChange={(event) => setStage(event.target.value as ClientStage | "all")}
            >
              <option value="all">All stages</option>
              {CLIENT_STAGES.map((item) => (
                <option key={item} value={item}>
                  {CLIENT_STAGE_LABELS[item]}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!ready || !visible.length}
              onClick={() => downloadText(clientCsv(visible), "clients.csv", "text/csv")}
            >
              Export CSV
            </button>
          </div>
          <div className="clients-canvas">
            {view === "followups" && (
              <p className="clients-muted">
                Scheduled reminders, earliest first. Email and phone actions open your own apps;
                nothing is sent automatically.
              </p>
            )}
            {!ready ? (
              <p className="clients-empty">
                Your saved clients will appear here once storage is available.
              </p>
            ) : !visible.length ? (
              <div className="clients-empty">
                <h2>
                  {rows.length
                    ? view === "followups"
                      ? "No scheduled follow-ups match"
                      : "No matching clients"
                    : "Your next client starts here"}
                </h2>
                <p>
                  {rows.length
                    ? view === "followups"
                      ? "Open a contact to schedule their next follow-up."
                      : "Try another name, email, phone, or stage."
                    : "Add a contact, plan a shoot, and keep their next step in view."}
                </p>
                {rows.length ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setStage("all");
                      setView("people");
                    }}
                  >
                    Show all clients
                  </button>
                ) : (
                  <button type="button" onClick={() => beginEdit()}>
                    Add your first client
                  </button>
                )}
              </div>
            ) : view === "sheet" ? (
              <>
                <p className="clients-muted">
                  All retained legacy planning fields. Payment, gallery, NDA and access labels are
                  not live verification.
                </p>
                <table className="clients-table">
                  <thead>
                    <tr>
                      {COLUMNS.map((column) => (
                        <th scope="col" key={column.key} className={column.className}>
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => (
                      <tr key={row.id}>
                        {COLUMNS.map((column) => (
                          <td key={column.key} className={column.className}>
                            {column.key === "client" ? (
                              <button
                                className="clients-name-button"
                                type="button"
                                onClick={() => setOpenId(row.id)}
                              >
                                {row.name}
                              </button>
                            ) : (
                              <Cell row={row} column={column.key} />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <ClientPeople
                clients={visible}
                today={today}
                board={view === "board"}
                busy={saving}
                onOpen={(client) => setOpenId(client.id)}
                onFollowUp={(client) => beginEdit(client, true)}
                onStage={(client, nextStage) => {
                  if (nextStage !== client.stage)
                    void persist({ ...client, stage: nextStage }, state.revision);
                }}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Compatibility export for existing assistant commands; no component state is exported.
// eslint-disable-next-line react-refresh/only-export-components
export { dispatchClientCommand as applyIncomingClientCommand } from "@/lib/clients/sheet";
