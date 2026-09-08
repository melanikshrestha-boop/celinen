import { useEffect, useMemo, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useWorkbench } from "@/components/workbench/context";
import {
  buildClientBooking,
  buildWorkspaceClient,
  upsertClientBooking,
  type ClientWorkspace,
  type WorkspaceClient,
} from "@/lib/client-workspace";
import {
  CLIENT_COMMAND_EVENT,
  SHEET_STAGES,
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
  type SheetExtra,
} from "@/lib/clients/sheet";
import "./clients-sheet.css";

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
  return <span className={`clients-select is-${value.toLowerCase().replace(/\s+/g, "-")}`}>{value}</span>;
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

function extraFromRow(row: ClientRow): SheetExtra {
  return {
    type: row.type,
    location: row.location,
    date: row.date,
    cover: row.cover,
    receivedCents: row.receivedCents,
    totalCents: row.totalCents,
    gallery: row.gallery,
    last: row.last,
    guest: row.guest,
    clientPw: row.clientPw,
    pin: row.pin,
    sheetStage: row.sheetStage,
    alias: row.alias,
    nda: row.nda,
    ndaOn: row.ndaOn,
    channel: row.channel,
    watermark: row.watermark,
    download: row.download,
    expires: row.expires,
    gps: row.gps,
    serial: row.serial,
    notes: row.notes,
  };
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
}: {
  state: ClientWorkspace;
  ready: boolean;
  error: string | null;
  cloud: boolean;
  onSave: (client: WorkspaceClient, revision?: number) => Promise<boolean>;
}) {
  const workbench = useWorkbench();
  const href = useRouterState({ select: (s) => s.location.href });
  const [view, setView] = useState<"table" | "board">("table");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [naming, setNaming] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const rows = useMemo(() => state.clients.map(toRow), [state.clients]);
  const quiet = rows.filter((row) => row.sheetStage === "quiet").length;
  const visible = rows.filter((row) => {
    const hay = `${row.name} ${row.alias} ${row.type} ${row.location} ${row.guest} ${row.pin}`.toLowerCase();
    return hay.includes(search.toLowerCase());
  });
  const opened = openId ? rows.find((row) => row.id === openId) : undefined;

  useEffect(() => {
    workbench?.setToolTitle(href, opened ? opened.alias || opened.name : "Clients");
  }, [href, opened, workbench]);

  useEffect(() => {
    const onCommand = (event: Event) => {
      const command = (event as CustomEvent<ClientCommand>).detail;
      if (!command) return;
      void applyCommand(command);
    };
    window.addEventListener(CLIENT_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(CLIENT_COMMAND_EVENT, onCommand);
  });

  useEffect(() => {
    if (!ready || !rows.length) return;
    const pending = takePendingClientCommand();
    if (pending) void applyCommand(pending);
  }, [ready, rows.length]);

  async function applyCommand(command: ClientCommand) {
    if (command.kind === "open") {
      const hit = findClient(rows, command.name);
      if (hit) {
        setOpenId(hit.id);
        setNote(null);
      } else setNote(`No one named ${command.name} on the sheet.`);
      return;
    }
    if (command.kind === "quiet") {
      setSearch("");
      setOpenId(null);
      setView("table");
      setNote(quiet ? `${quiet} quiet` : "No quiet names.");
      return;
    }
    if (command.kind === "unopened") {
      setOpenId(null);
      setView("table");
      const closed = rows.filter((row) => row.gallery !== "Live").map((row) => row.name);
      setNote(closed.length ? closed.join(" · ") : "Every gallery has been opened.");
      return;
    }
    if (command.kind === "attach") {
      const hit = findClient(rows, command.name);
      if (!hit) {
        setNote(`No one named ${command.name} on the sheet.`);
        return;
      }
      const booked = buildClientBooking({
        title: "New project",
        date: new Date().toISOString().slice(0, 10),
        location: hit.location,
        status: "requested",
      });
      if (!booked.ok) return setNote(booked.error);
      const next = upsertClientBooking(hit, booked.value);
      writeExtra(hit.id, { ...extraFromRow(hit), last: "now" });
      await onSave(next, state.revision);
      setOpenId(hit.id);
      return;
    }
    await createLead(command.name, command.type ?? "", command.date ?? "");
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
    if (!built.ok) {
      setNote(built.error);
      return;
    }
    const extra: SheetExtra = { ...emptyExtra(), type, date };
    writeExtra(built.value.id, extra);
    const ok = await onSave(built.value, state.revision);
    if (ok) {
      setNaming(false);
      setDraftName("");
      setOpenId(built.value.id);
      setNote(null);
    }
  }

  const subtitle = `${rows.length}${quiet ? ` · ${quiet} quiet` : ""} · ${cloud ? "saved to your account" : "saved on this device"}`;

  if (opened) {
    return (
      <div className="clients-sheet">
        <article className="clients-page">
          <button type="button" className="clients-back" onClick={() => setOpenId(null)}>
            Clients
          </button>
          {opened.cover ? (
            <div className="clients-cover-banner">
              <img src={opened.cover} alt="" />
            </div>
          ) : null}
          <div className="clients-page-body">
            <h1>{opened.name}</h1>
            {opened.alias ? <p className="clients-alias">{opened.alias}</p> : null}
            <dl className="clients-props">
              {PAGE_PROPS.map((prop) => {
                const value = prop.value(opened);
                const isSelect = [
                  "Type",
                  "Stage",
                  "Gallery",
                  "NDA",
                  "Channel",
                  "Watermark",
                  "Download",
                  "GPS",
                  "Serial",
                ].includes(prop.label);
                const chipValue =
                  prop.label === "NDA" ? opened.nda : value.includes(" · ") ? value.split(" · ")[0]! : value;
                return (
                  <div className="clients-prop" key={prop.label}>
                    <dt>{prop.label}</dt>
                    <dd>
                      {isSelect && chipValue ? (
                        <>
                          <SelectChip value={chipValue} />
                          {prop.label === "NDA" && opened.ndaOn ? ` · ${formatDate(opened.ndaOn)}` : ""}
                        </>
                      ) : prop.label === "Cover" && opened.cover ? (
                        <CoverThumb cover={opened.cover} />
                      ) : (
                        value
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        </article>
      </div>
    );
  }

  return (
    <div className="clients-sheet">
      <header className="clients-head">
        <p className="clients-kicker">Business</p>
        <h1 className="clients-title">Clients</h1>
        <p className="clients-sub">{subtitle}</p>
      </header>
      <div className="clients-toolbar">
        <button type="button" aria-current={view === "table" ? "true" : undefined} onClick={() => setView("table")}>
          Table
        </button>
        <button type="button" aria-current={view === "board" ? "true" : undefined} onClick={() => setView("board")}>
          Board
        </button>
        <input
          id="client-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="search"
          aria-label="Search"
        />
        <button
          type="button"
          className="clients-new"
          disabled={!ready}
          onClick={() => {
            setNaming(true);
            setView("table");
          }}
        >
          New
        </button>
      </div>
      {error && (
        <p className="clients-alert" role="alert">
          {error}
        </p>
      )}
      {note && (
        <p className="clients-alert" role="status">
          {note}
        </p>
      )}
      <div className="clients-canvas">
        {!visible.length && !naming ? (
          <div className="clients-empty">The first name on the sheet.</div>
        ) : view === "board" ? (
          <div className="clients-board">
            {SHEET_STAGES.map((stage) => {
              const group = visible.filter((row) => row.sheetStage === stage);
              if (!group.length) return null;
              return (
                <section key={stage} className="clients-board-col">
                  <h3>{stageLabel(stage)}</h3>
                  {group.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      className="clients-card"
                      onClick={() => setOpenId(row.id)}
                    >
                      <CoverThumb cover={row.cover} />
                      <p>{row.name}</p>
                    </button>
                  ))}
                </section>
              );
            })}
          </div>
        ) : (
          <>
            <table className="clients-table">
              <thead>
                <tr>
                  {COLUMNS.map((column) => (
                    <th key={column.key} className={column.className}>
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr
                    key={row.id}
                    className="clients-row"
                    onClick={() => setOpenId(row.id)}
                  >
                    {COLUMNS.map((column) => (
                      <td key={column.key} className={column.className}>
                        <Cell row={row} column={column.key} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <form
              className="clients-new-page"
              onSubmit={(event) => {
                event.preventDefault();
                const name = draftName.trim();
                if (!name) {
                  setNaming(true);
                  return;
                }
                void createLead(name, "", "");
              }}
            >
              {naming ? (
                <input
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onBlur={() => {
                    if (!draftName.trim()) setNaming(false);
                  }}
                  placeholder="New page"
                  aria-label="New client"
                  autoFocus
                />
              ) : (
                <button type="button" disabled={!ready} onClick={() => setNaming(true)}>
                  + New
                </button>
              )}
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export { dispatchClientCommand as applyIncomingClientCommand } from "@/lib/clients/sheet";
