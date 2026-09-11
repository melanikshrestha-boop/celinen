import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "@/components/account/AccountProvider";
import {
  contractDraft,
  EMPTY_CONTRACT_FIELDS,
  invoiceDraft,
  questionnaireDraft,
  quoteDraft,
  type ContractFields,
} from "@/lib/studio-desk/contract-draft";
import {
  readDesk,
  writeDesk,
  type DeskTemplate,
  type StudioDeskState,
  type TemplateKind,
} from "@/lib/studio-desk/store";
import { detectTimeZone, formatInZone, formatTimeZone, orderedTimeZones } from "@/lib/studio-desk/timezones";
import "./studio-desk.css";

type Desk = "types" | "sessions" | "calendar" | "site" | "templates";
const KINDS: { id: TemplateKind; label: string }[] = [
  { id: "contract", label: "Contracts" },
  { id: "invoice", label: "Invoices" },
  { id: "questionnaire", label: "Questionnaires" },
  { id: "quote", label: "Quotes" },
];

function monthCells(year: number, month: number) {
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: first + days }, (_, i) => (i < first ? null : i - first + 1));
}

export function StudioDesk() {
  const account = useAccount();
  const scope = account?.scope ?? "signed-out";
  const [desk, setDesk] = useState<Desk>("types");
  const [state, setState] = useState<StudioDeskState>(() => readDesk(scope));
  const [zoneDraft, setZoneDraft] = useState(state.timezone || detectTimeZone());
  const [kind, setKind] = useState<TemplateKind>("contract");
  const [openId, setOpenId] = useState<string | null>(null);
  const [fields, setFields] = useState<ContractFields>({
    ...EMPTY_CONTRACT_FIELDS,
    photographerName: account?.name ?? "",
    photographerEmail: account?.user?.email ?? "",
    effectiveDate: new Date().toISOString().slice(0, 10),
  });
  const [signName, setSignName] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const zones = useMemo(() => orderedTimeZones(detectTimeZone()), []);

  useEffect(() => {
    const next = readDesk(scope);
    setState(next);
    setZoneDraft(next.timezone || detectTimeZone());
  }, [scope]);

  function save(next: StudioDeskState) {
    setState(next);
    if (account?.status === "in" && scope !== "signed-out") writeDesk(scope, next);
  }
  function confirmZone() {
    save({ ...state, timezone: zoneDraft, timezoneConfirmed: true });
  }
  function addType(name: string) {
    const value = name.trim();
    if (!value || state.types.includes(value)) return;
    save({ ...state, types: [...state.types, value] });
  }
  function addSession(form: FormData) {
    const title = String(form.get("title") ?? "").trim();
    const type = String(form.get("type") ?? state.types[0] ?? "Game day");
    const start = String(form.get("start") ?? "");
    const client = String(form.get("client") ?? "").trim();
    if (!title || !start) return;
    const startIso = new Date(start).toISOString();
    save({
      ...state,
      sessions: [
        {
          id: crypto.randomUUID(),
          title,
          type,
          startIso,
          client,
        },
        ...state.sessions,
      ],
    });
  }
  function seedTemplate(nextKind: TemplateKind) {
    const body =
      nextKind === "invoice"
        ? invoiceDraft(fields)
        : nextKind === "quote"
          ? quoteDraft(fields)
          : nextKind === "questionnaire"
            ? questionnaireDraft()
            : contractDraft(fields);
    const row: DeskTemplate = {
      id: crypto.randomUUID(),
      kind: nextKind,
      name:
        nextKind === "contract"
          ? "College football photography agreement"
          : nextKind === "invoice"
            ? "Game-day invoice"
            : nextKind === "quote"
              ? "Game-day quote"
              : "Game-day questionnaire",
      body,
      createdAt: Date.now(),
    };
    save({ ...state, templates: [row, ...state.templates] });
    setOpenId(row.id);
  }
  const open = state.templates.find((row) => row.id === openId) ?? null;
  const now = new Date();
  const cells = monthCells(now.getFullYear(), now.getMonth());

  function pointer(event: React.PointerEvent<HTMLCanvasElement>) {
    const node = canvas.current;
    if (!node) return;
    const box = node.getBoundingClientRect();
    const ctx = node.getContext("2d");
    if (!ctx) return;
    const x = ((event.clientX - box.left) / box.width) * node.width;
    const y = ((event.clientY - box.top) / box.height) * node.height;
    if (event.type === "pointerdown") {
      drawing.current = true;
      node.setPointerCapture(event.pointerId);
      ctx.beginPath();
      ctx.moveTo(x, y);
      return;
    }
    if (!drawing.current) return;
    if (event.type === "pointerup" || event.type === "pointerleave") {
      drawing.current = false;
      return;
    }
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#142a36";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.stroke();
  }
  function sign() {
    if (!open || !signName.trim()) return;
    const signature = canvas.current?.toDataURL("image/png") ?? "";
    const signedAt = new Date().toISOString();
    save({
      ...state,
      templates: state.templates.map((row) =>
        row.id === open.id
          ? {
              ...row,
              body: `${row.body}\n\nSignatures\n${signName.trim()}\nSigned ${formatInZone(signedAt, state.timezone)} · ${state.timezone}\n`,
              signedBy: signName.trim(),
              signedAt,
              signature,
            }
          : row,
      ),
    });
  }

  if (account && account.status !== "in") return null;

  return (
    <div className="studio-desk">
      {!state.timezoneConfirmed && (
        <div className="studio-desk__gate">
          <div className="studio-desk__card">
            <h2>Time zone</h2>
            <label>
              Time Zone
              <select value={zoneDraft} onChange={(event) => setZoneDraft(event.target.value)}>
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {formatTimeZone(zone)}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="studio-desk__btn" onClick={confirmZone}>
              Confirm
            </button>
          </div>
        </div>
      )}
      <h1>Bookings</h1>
      <nav className="studio-desk__nav" aria-label="Bookings">
        {(
          [
            ["types", "Session Types"],
            ["sessions", "Sessions"],
            ["calendar", "Calendar"],
            ["site", "Booking Site"],
            ["templates", "Templates"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-current={desk === id ? "page" : undefined}
            onClick={() => {
              setDesk(id);
              setOpenId(null);
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {desk === "types" && (
        <section>
          <div className="studio-desk__grid">
            {state.types.map((type) => (
              <div key={type} className="studio-desk__tile">
                {type}
              </div>
            ))}
          </div>
          <form
            className="studio-desk__form"
            onSubmit={(event) => {
              event.preventDefault();
              const input = event.currentTarget.elements.namedItem("type") as HTMLInputElement;
              addType(input.value);
              input.value = "";
            }}
          >
            <label>
              New type
              <input name="type" />
            </label>
            <button className="studio-desk__btn" type="submit">
              Add
            </button>
          </form>
        </section>
      )}

      {desk === "sessions" && (
        <section>
          <form
            className="studio-desk__form"
            onSubmit={(event) => {
              event.preventDefault();
              addSession(new FormData(event.currentTarget));
              event.currentTarget.reset();
            }}
          >
            <label>
              Title
              <input name="title" placeholder="USC vs UCLA" />
            </label>
            <label>
              Type
              <select name="type">
                {state.types.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <label>
              Start
              <input name="start" type="datetime-local" />
            </label>
            <label>
              Client
              <input name="client" />
            </label>
            <button className="studio-desk__btn" type="submit">
              Add session
            </button>
          </form>
          <div className="studio-desk__list" style={{ marginTop: 24 }}>
            {state.sessions.map((row) => (
              <div key={row.id} className="studio-desk__row">
                <span>
                  {row.title}
                  <small className="studio-desk__muted" style={{ display: "block" }}>
                    {row.type} · {formatInZone(row.startIso, state.timezone)}
                  </small>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {desk === "calendar" && (
        <section>
          <h2>{now.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: state.timezone })}</h2>
          <p className="studio-desk__muted">{formatTimeZone(state.timezone)}</p>
          <div className="studio-desk__cal-week">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="studio-desk__cal-grid">
            {cells.map((day, index) => {
              const rows = state.sessions.filter((session) => {
                const at = new Date(session.startIso);
                const parts = new Intl.DateTimeFormat("en-US", {
                  timeZone: state.timezone,
                  day: "numeric",
                  month: "numeric",
                  year: "numeric",
                }).formatToParts(at);
                const d = Number(parts.find((part) => part.type === "day")?.value);
                const m = Number(parts.find((part) => part.type === "month")?.value);
                const y = Number(parts.find((part) => part.type === "year")?.value);
                return day !== null && d === day && m === now.getMonth() + 1 && y === now.getFullYear();
              });
              return (
                <div key={index} className={day ? "studio-desk__cal-day" : undefined}>
                  {day ? <span>{day}</span> : null}
                  {rows.map((row) => (
                    <button key={row.id} type="button" onClick={() => setDesk("sessions")}>
                      {row.title}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {desk === "site" && (
        <section>
          <h2>Booking site</h2>
          <p className="studio-desk__muted">
            Public calendar: /book-site · times shown in {formatTimeZone(state.timezone)}
          </p>
          <a className="studio-desk__btn" href="/book-site" style={{ marginTop: 16, width: "fit-content" }}>
            Open booking site
          </a>
        </section>
      )}

      {desk === "templates" && !open && (
        <section>
          <div className="studio-desk__head">
            <div className="studio-desk__tabs">
              {KINDS.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  aria-current={kind === row.id ? "page" : undefined}
                  onClick={() => setKind(row.id)}
                >
                  {row.label}
                </button>
              ))}
            </div>
            <button type="button" className="studio-desk__btn" onClick={() => seedTemplate(kind)}>
              New template
            </button>
          </div>
          <div className="studio-desk__list">
            {state.templates
              .filter((row) => row.kind === kind)
              .map((row) => (
                <button key={row.id} type="button" className="studio-desk__row" onClick={() => setOpenId(row.id)}>
                  <span>
                    {row.name}
                    <small className="studio-desk__muted" style={{ display: "block" }}>
                      {new Date(row.createdAt).toLocaleDateString()}
                      {row.signedBy ? ` · signed` : ""}
                    </small>
                  </span>
                </button>
              ))}
          </div>
        </section>
      )}

      {desk === "templates" && open && (
        <section className="studio-desk__sign">
          <div>
            <button type="button" className="studio-desk__btn is-ghost" onClick={() => setOpenId(null)}>
              Templates
            </button>
            <div className="studio-desk__form" style={{ marginTop: 20 }}>
              {(
                [
                  ["photographerName", "Photographer"],
                  ["clientName", "Client"],
                  ["school", "School"],
                  ["opponent", "Opponent"],
                  ["fee", "Fee (USD)"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    value={fields[key]}
                    onChange={(event) => setFields({ ...fields, [key]: event.target.value })}
                  />
                </label>
              ))}
              <button
                type="button"
                className="studio-desk__btn is-ghost"
                onClick={() =>
                  save({
                    ...state,
                    templates: state.templates.map((row) =>
                      row.id === open.id
                        ? {
                            ...row,
                            body:
                              open.kind === "invoice"
                                ? invoiceDraft(fields)
                                : open.kind === "quote"
                                  ? quoteDraft(fields)
                                  : open.kind === "questionnaire"
                                    ? questionnaireDraft()
                                    : contractDraft(fields),
                          }
                        : row,
                    ),
                  })
                }
              >
                Fill draft
              </button>
              <label>
                Sign as
                <input value={signName} onChange={(event) => setSignName(event.target.value)} />
              </label>
              <canvas
                ref={canvas}
                width={560}
                height={280}
                onPointerDown={pointer}
                onPointerMove={pointer}
                onPointerUp={pointer}
                onPointerLeave={pointer}
              />
              <button type="button" className="studio-desk__btn" onClick={sign}>
                Sign
              </button>
              {open.signedBy && (
                <p className="studio-desk__muted">
                  {open.signedBy} · {open.signedAt ? formatInZone(open.signedAt, state.timezone) : ""}
                </p>
              )}
            </div>
          </div>
          <pre className="studio-desk__doc">{open.body}</pre>
        </section>
      )}
    </div>
  );
}
