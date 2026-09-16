import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Plus, Search, SlidersHorizontal, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToolLeaveGuard } from "@/components/workbench/useToolLeaveGuard";
import {
  campaignSchema,
  composeEmail,
  evaluateProspect,
  exportProspectCsv,
  parseProspectCsv,
  transition,
  type Campaign,
  type OutboundCommand,
  type Prospect,
  type ProspectInput,
} from "@/lib/outbound/model";
import {
  readOutbound,
  updateOutbound,
  subscribeOutbound,
  OutboundSaveConflict,
  type OutboundRecord,
} from "@/lib/outbound/storage";
import { blankProspect, ProspectForm } from "./ProspectForm";
import "./outbound.css";

const humanize = (value: string) =>
  value.replaceAll("-", " ").replace(/^./, (c) => c.toUpperCase());
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "This change could not be saved. Please retry.";
const today = () => new Date().toISOString().slice(0, 10);
const download = (name: string, text: string, type: string) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
type Filter = "priority" | "all" | "follow-up" | "suppressed";
type Modal =
  "add" | "edit" | "campaign" | "import" | "contact" | "reply" | "conversion" | "suppress" | null;

export function OutboundPage({ scope }: { scope: string }) {
  const [record, setRecord] = useState<OutboundRecord | null>(null);
  const current = useRef(record);
  current.current = record;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState<Filter>("priority");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [stale, setStale] = useState(false);
  const [detailDirty, setDetailDirty] = useState(false);
  const load = useCallback(async () => {
    try {
      const next = await readOutbound(scope);
      if (alive.current && (!current.current || next.revision >= current.current.revision)) {
        current.current = next;
        setRecord(next);
        setError("");
        setStale(false);
      }
    } catch (cause) {
      if (alive.current) setError(errorText(cause));
    }
  }, [scope]);
  useEffect(() => {
    alive.current = true;
    void load();
    const stop = subscribeOutbound(scope, ({ revision }) => {
      if (current.current && revision > current.current.revision && !inFlight.current)
        setStale(true);
    });
    const focus = () => {
      void readOutbound(scope)
        .then((next) => {
          if (alive.current && current.current && next.revision > current.current.revision)
            setStale(true);
        })
        .catch((cause: unknown) => {
          if (alive.current) setError(errorText(cause));
        });
    };
    window.addEventListener("focus", focus);
    return () => {
      alive.current = false;
      stop();
      window.removeEventListener("focus", focus);
    };
  }, [load, scope]);
  useToolLeaveGuard(
    busy
      ? "An outbound change is still saving."
      : modal
        ? "Close or save the open outbound form before leaving."
        : detailDirty
          ? "This prospect has unsaved changes."
          : null,
  );

  const commit = async (command: OutboundCommand) => {
    if (!current.current || inFlight.current) throw new Error("Please wait for the current save.");
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await updateOutbound(scope, current.current.revision, (workspace) =>
        transition(workspace, command, new Date().toISOString()),
      );
      if (alive.current) {
        current.current = next;
        setRecord(next);
        setNotice("Saved on this device.");
      }
      return next;
    } catch (cause) {
      if (alive.current) {
        setError(errorText(cause));
        if (cause instanceof OutboundSaveConflict) setStale(true);
      }
      throw cause;
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const close = () => {
    if (!busy && (!modal || window.confirm("Close this form? Any unsaved changes will be lost.")))
      setModal(null);
  };
  if (!record)
    return (
      <section className="outbound-page">
        <h1>Outbound</h1>
        {error ? (
          <>
            <p role="alert" className="out-error">
              {error}
            </p>
            <button className="out-button" onClick={() => void load()}>
              Retry opening
            </button>
          </>
        ) : (
          <p>Opening your outreach desk…</p>
        )}
      </section>
    );
  const { campaign, prospects } = record.workspace;
  const now = new Date().toISOString();
  const prospect = prospects.find((item) => item.id === selected);
  const matches = prospects
    .filter((p) => {
      if (
        filter === "suppressed"
          ? p.stage !== "suppressed"
          : filter !== "all" && p.stage === "suppressed"
      )
        return false;
      if (
        filter === "priority" &&
        ["contacted", "replied", "converted", "not-now"].includes(p.stage)
      )
        return false;
      if (
        filter === "follow-up" &&
        (!p.followUpOn || p.followUpOn > today() || !["contacted", "replied"].includes(p.stage))
      )
        return false;
      return `${p.name} ${p.company} ${p.email ?? ""} ${p.specialty} ${p.signal}`
        .toLowerCase()
        .includes(query.toLowerCase());
    })
    .sort(
      (a, b) =>
        Number(evaluateProspect(b, campaign, now).eligible) -
          Number(evaluateProspect(a, campaign, now).eligible) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
  const exportRecords = () => {
    download(
      `foto-prospects-${today()}.csv`,
      exportProspectCsv(prospects),
      "text/csv;charset=utf-8",
    );
    setNotice("Exported your prospect records. CSV contains private contact data.");
  };
  return (
    <section className="outbound-page" aria-label="Celinen outbound desk">
      <header className="out-head">
        <div>
          <h1>Outbound</h1>
          <p>Celinen growth · private, on this device · drafts only</p>
        </div>
        <div className="out-actions">
          <button
            aria-label="Campaign settings"
            title="Campaign settings"
            onClick={() => setModal("campaign")}
            disabled={busy || detailDirty}
          >
            <SlidersHorizontal size={15} />
          </button>
          <button disabled={busy || detailDirty} onClick={() => setModal("import")}>
            <Upload size={14} />
            Import
          </button>
          <button onClick={exportRecords} disabled={!prospects.length}>
            <Download size={14} />
            Export
          </button>
          <button
            className="out-primary"
            disabled={busy || detailDirty}
            onClick={() => setModal("add")}
          >
            <Plus size={15} />
            Add prospect
          </button>
        </div>
      </header>
      <div className="out-stats" aria-label="Recorded outreach totals">
        {[
          [prospects.filter((p) => p.stage !== "suppressed").length, "Prospects"],
          [
            prospects.filter((p) => evaluateProspect(p, campaign, now).grade === "ready").length,
            "Evidence ready",
          ],
          [prospects.filter((p) => Boolean(p.contactedAt)).length, "Contact logged"],
          [
            prospects.filter((p) => p.activities.some((a) => a.type === "reply-logged")).length,
            "Replies logged",
          ],
          [
            prospects.filter((p) => p.activities.some((a) => a.type === "conversion-logged"))
              .length,
            "Conversions logged",
          ],
        ].map(([count, label]) => (
          <div className="out-stat" key={label}>
            <strong>{count}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      {stale && (
        <div className="out-actions out-status" role="status">
          Another tab has newer changes.
          <button
            disabled={busy}
            onClick={() => {
              if (
                (!modal && !detailDirty) ||
                window.confirm("Reload the latest records and discard unsaved form changes?")
              ) {
                setModal(null);
                setSelected("");
                setDetailDirty(false);
                void load();
              }
            }}
          >
            Reload records
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="out-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="out-status">
          {notice}
        </p>
      )}
      <div className="out-toolbar">
        <div className="out-filters" aria-label="Prospect views">
          {(["priority", "all", "follow-up", "suppressed"] as const).map((value) => (
            <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {value === "priority" ? "Review queue" : humanize(value)}
            </button>
          ))}
        </div>
        <input
          className="out-search"
          aria-label="Search prospects"
          placeholder="Search prospects"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="out-layout">
        <div className="out-table-wrap">
          {matches.length ? (
            <table className="out-table">
              <thead>
                <tr>
                  <th scope="col">Photographer / studio</th>
                  <th scope="col">Evidence</th>
                  <th scope="col">Stage</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((p) => (
                  <tr key={p.id} data-selected={selected === p.id}>
                    <td>
                      <button
                        className="out-prospect"
                        aria-label={`Open ${p.name}`}
                        onClick={() => {
                          if (p.id === selected || busy) return;
                          if (
                            !detailDirty ||
                            window.confirm("Discard unsaved draft changes and open this prospect?")
                          ) {
                            setDetailDirty(false);
                            setSelected(p.id);
                          }
                        }}
                      >
                        <strong>{p.name}</strong>
                        <span>{p.company || p.specialty}</span>
                      </button>
                    </td>
                    <td>
                      <span className="out-stage">
                        {humanize(evaluateProspect(p, campaign, now).grade)}
                      </span>
                    </td>
                    <td>
                      <span className="out-stage">{humanize(p.stage)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="out-empty">
              <h2>
                {prospects.length
                  ? "No prospects in this view"
                  : "Start with a reason to reach out."}
              </h2>
              <p>
                {prospects.length
                  ? "Try another view or search."
                  : "Add a photographer, a source link, and a specific reason Celinen might fit their work. Review the draft before sharing it."}
              </p>
              {!prospects.length && (
                <button className="out-button" onClick={() => setModal("add")}>
                  Add your first prospect
                </button>
              )}
            </div>
          )}
          <details className="out-research">
            <summary>
              <Search size={13} style={{ display: "inline", marginRight: 6 }} />
              Research starting points
            </summary>
            <p>
              These open searches, not imported leads. Check the source and add relevant public
              business contacts yourself.
            </p>
            {[
              ["Photographers discussing a culling backlog", 'photographer "culling" "backlog"'],
              [
                "Product studios hiring editing help",
                'product photography studio "retoucher" "hiring"',
              ],
              [
                "Photographers discussing gallery delivery",
                'photographer "client gallery" "workflow"',
              ],
            ].map(([label, q]) => (
              <a
                key={q}
                href={`https://www.google.com/search?q=${encodeURIComponent(q!)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {label} ↗
              </a>
            ))}
          </details>
        </div>
        {prospect ? (
          <ProspectDetail
            key={prospect.id}
            prospect={prospect}
            campaign={campaign}
            busy={busy}
            commit={commit}
            onModal={setModal}
            onNotice={setNotice}
            onDirty={setDetailDirty}
            scope={scope}
            revision={record.revision}
          />
        ) : (
          <aside className="out-detail">
            <h2>One relevant conversation at a time.</h2>
            <p className="out-muted">
              Select a prospect to review the evidence, prepare an opener, and keep track of the
              response.
            </p>
            <p className="out-muted">
              No inbox connection or automatic sending. Contact, reply, and conversion totals come
              from your own activity logs.
            </p>
          </aside>
        )}
      </div>
      <Dialog
        open={modal !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent
          className="out-dialog"
          onInteractOutside={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <DialogTitle>
            {modal === "add"
              ? "Add prospect"
              : modal === "edit"
                ? "Edit prospect"
                : modal === "campaign"
                  ? "Celinen campaign"
                  : modal === "import"
                    ? "Import prospects"
                    : modal === "contact"
                      ? "Log contact"
                      : modal === "reply"
                        ? "Log reply"
                        : modal === "conversion"
                          ? "Log conversion"
                          : "Do not contact"}
          </DialogTitle>
          <DialogDescription>
            {modal === "campaign"
              ? "Your offer and identity are included in drafts. Changing them requires a fresh review."
              : modal === "import"
                ? "Preview a CSV before adding records. Existing contacts are never overwritten."
                : modal === "suppress"
                  ? "This blocks new drafts and outreach for this contact. Their history stays intact."
                  : modal === "contact"
                    ? "Log a message you actually sent outside Celinen. This is not a delivery receipt."
                    : "Saved privately on this device. Nothing is sent from this form."}
          </DialogDescription>
          {(modal === "add" || modal === "edit") && (
            <ProspectForm
              key={modal}
              initial={modal === "edit" && prospect ? prospect : blankProspect()}
              busy={busy}
              onSave={async (input) => {
                const id = modal === "edit" && prospect ? prospect.id : crypto.randomUUID();
                await commit({ type: modal === "edit" ? "edit" : "add", id, input });
                setSelected(id);
                setModal(null);
              }}
            />
          )}
          {modal === "campaign" && (
            <CampaignForm
              campaign={campaign}
              busy={busy}
              onSave={async (value) => {
                await commit({ type: "campaign", campaign: value });
                setModal(null);
              }}
            />
          )}
          {modal === "import" && (
            <ImportForm
              busy={busy}
              onSave={async (inputs) => {
                const entries = inputs.map((input) => ({ id: crypto.randomUUID(), input }));
                await commit({ type: "import", entries });
                setModal(null);
                setNotice(`${entries.length} prospects imported. No messages sent.`);
              }}
            />
          )}
          {prospect && ["contact", "reply", "conversion", "suppress"].includes(modal ?? "") && (
            <ActivityForm
              kind={modal!}
              busy={busy}
              onSave={async (note, channel) => {
                const type =
                  modal === "contact"
                    ? "log-contact"
                    : modal === "reply"
                      ? "log-reply"
                      : modal === "conversion"
                        ? "log-conversion"
                        : "suppress";
                await commit(
                  type === "log-contact"
                    ? { type, id: prospect.id, channel, note }
                    : { type, id: prospect.id, note },
                );
                setModal(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ProspectDetail({
  prospect: p,
  campaign,
  busy,
  commit,
  onModal,
  onNotice,
  onDirty,
  scope,
  revision,
}: {
  prospect: Prospect;
  campaign: Campaign;
  busy: boolean;
  commit: (command: OutboundCommand) => Promise<OutboundRecord>;
  onModal: (modal: Modal) => void;
  onNotice: (notice: string) => void;
  onDirty: (dirty: boolean) => void;
  scope: string;
  revision: number;
}) {
  const [subject, setSubject] = useState(p.subject),
    [body, setBody] = useState(p.body);
  const [followUp, setFollowUp] = useState(p.followUpOn ?? "");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const dirty = subject !== p.subject || body !== p.body || followUp !== (p.followUpOn ?? "");
  useEffect(() => {
    setSubject(p.subject);
    setBody(p.body);
  }, [p.subject, p.body]);
  useEffect(() => setFollowUp(p.followUpOn ?? ""), [p.followUpOn]);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const status = evaluateProspect(p, campaign, new Date().toISOString());
  const run = (command: OutboundCommand) => {
    void commit(command).catch(() => undefined);
  };
  const suppressed = p.stage === "suppressed";
  const openComposer = async () => {
    try {
      if (dirty) throw new Error("Save your draft changes first.");
      const latest = await commit({ type: "compose", id: p.id });
      const saved = latest.workspace.prospects.find((item) => item.id === p.id)!;
      if (!mounted.current) return;
      const url = composeEmail(saved, latest.workspace.campaign, new Date().toISOString());
      // The user sends in their email application. Opening it is not a send event.
      const link = document.createElement("a");
      link.href = url;
      link.click();
      onNotice("Email composer requested. Send there, then log the contact here.");
    } catch (cause) {
      onNotice(errorText(cause));
    }
  };
  const copy = async () => {
    try {
      const latest = await readOutbound(scope);
      if (!mounted.current) return;
      if (latest.revision !== revision)
        throw new Error("Another tab changed this desk. Reload records before copying.");
      const saved = latest.workspace.prospects.find((item) => item.id === p.id)!;
      const check = evaluateProspect(saved, latest.workspace.campaign, new Date().toISOString());
      if (!check.eligible || !check.approvalCurrent || dirty || suppressed)
        throw new Error("Review and approve the saved draft first.");
      await navigator.clipboard.writeText(`Subject: ${saved.subject}\n\n${saved.body}`);
      onNotice("Draft copied. Nothing was sent.");
    } catch (cause) {
      onNotice(errorText(cause));
    }
  };
  return (
    <aside className="out-detail" aria-label="Prospect details">
      <div className="out-head">
        <div>
          <h2>{p.name}</h2>
          <span className="out-muted">{p.company || p.specialty}</span>
        </div>
        <button
          className="out-button"
          disabled={busy || suppressed || dirty}
          onClick={() => onModal("edit")}
        >
          Edit
        </button>
      </div>
      <p className="out-muted">{p.email || "No email recorded"}</p>
      <h3>Why now</h3>
      <p>{p.signal || "Add an observed signal before drafting."}</p>
      {p.sourceUrl && (
        <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer">
          View source ↗
        </a>
      )}{" "}
      {p.observedOn && <span className="out-muted"> · {p.observedOn}</span>}
      <h3>Why Celinen</h3>
      <p>{p.fitReason || "Add a specific fit rationale."}</p>
      <ul className="out-reasons">
        {status.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      {p.notes && (
        <details>
          <summary>Private notes</summary>
          <p>{p.notes}</p>
        </details>
      )}
      <h3>Outreach draft</h3>
      {p.body ? (
        <div className="out-form">
          <label>
            Subject
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={200}
              disabled={suppressed || busy}
            />
          </label>
          <label>
            Message
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={8}
              maxLength={10000}
              disabled={suppressed || busy}
            />
          </label>
        </div>
      ) : (
        <p className="out-muted">
          A factual starting draft uses your saved signal and campaign. Review the wording yourself.
        </p>
      )}
      <div className="out-actions">
        <button
          disabled={busy || suppressed || status.grade !== "ready"}
          onClick={() => {
            if (
              !p.body ||
              window.confirm("Replace this draft with a new one from the saved evidence?")
            )
              run({ type: "draft", id: p.id });
          }}
        >
          {p.body ? "Rebuild draft" : "Prepare draft"}
        </button>
        {p.body && (
          <>
            <button
              disabled={busy || (subject === p.subject && body === p.body) || suppressed}
              onClick={() => run({ type: "edit-draft", id: p.id, subject, body })}
            >
              Save draft
            </button>
            <button
              className="out-primary"
              disabled={busy || dirty || !status.eligible || status.approvalCurrent}
              onClick={() => run({ type: "approve", id: p.id })}
            >
              {status.approvalCurrent ? "Approved" : "Approve draft"}
            </button>
          </>
        )}
      </div>
      {p.body && (
        <div className="out-actions">
          <button
            disabled={busy || dirty || !status.approvalCurrent || !status.eligible}
            onClick={() => void copy()}
          >
            Copy draft
          </button>
          <button
            disabled={busy || dirty || !status.canCompose}
            onClick={() => void openComposer()}
          >
            Open in email
          </button>
          <button
            disabled={busy || dirty || !status.approvalCurrent || !status.eligible}
            onClick={() => onModal("contact")}
          >
            Log contact
          </button>
        </div>
      )}
      {p.contactedAt && !suppressed && (
        <>
          <h3>Outcome & follow-up</h3>
          <div className="out-actions">
            <button
              disabled={busy || dirty || !["contacted", "replied"].includes(p.stage)}
              onClick={() => onModal("reply")}
            >
              Log reply
            </button>
            <button
              disabled={busy || dirty || p.stage !== "replied"}
              onClick={() => onModal("conversion")}
            >
              Log conversion
            </button>
            <button
              disabled={busy || dirty || p.stage === "not-now" || p.stage === "converted"}
              onClick={() => run({ type: "not-now", id: p.id })}
            >
              Not now
            </button>
          </div>
          <div className="out-form" style={{ marginTop: 12 }}>
            <label>
              Follow-up date
              <input
                type="date"
                value={followUp}
                min={today()}
                disabled={busy}
                onChange={(event) => setFollowUp(event.target.value)}
              />
            </label>
            <div className="out-actions">
              <button
                disabled={busy || followUp === (p.followUpOn ?? "")}
                onClick={() => run({ type: "follow-up", id: p.id, date: followUp })}
              >
                Save follow-up
              </button>
            </div>
          </div>
        </>
      )}
      <h3>Activity</h3>
      <ol className="out-history">
        {p.activities
          .slice()
          .reverse()
          .map((activity) => (
            <li key={activity.id}>
              {humanize(activity.type)} <span>· {new Date(activity.at).toLocaleString()}</span>
              <div>{activity.detail}</div>
            </li>
          ))}
      </ol>
      {!suppressed && (
        <div className="out-actions">
          <button disabled={busy || dirty} onClick={() => onModal("suppress")}>
            Do not contact
          </button>
        </div>
      )}
    </aside>
  );
}

function CampaignForm({
  campaign,
  busy,
  onSave,
}: {
  campaign: Campaign;
  busy: boolean;
  onSave: (campaign: Campaign) => Promise<void>;
}) {
  const [value, setValue] = useState(campaign),
    [error, setError] = useState("");
  return (
    <form
      className="out-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        const result = campaignSchema.safeParse(value);
        if (!result.success) {
          setError(result.error.issues.map((issue) => issue.message).join(". "));
          return;
        }
        void onSave(result.data).catch((cause) => setError(errorText(cause)));
      }}
    >
      {(
        [
          ["senderName", "Your name"],
          ["offer", "What you’re offering"],
          ["cta", "The ask"],
          ["signature", "Signature / contact details"],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <textarea
            rows={key === "offer" || key === "signature" ? 3 : 2}
            value={value[key]}
            disabled={busy}
            maxLength={2000}
            onChange={(event) => setValue({ ...value, [key]: event.target.value })}
          />
        </label>
      ))}
      <p className="out-muted">
        Use claims you can demonstrate. Add your real contact details and an appropriate opt-out
        before sending.
      </p>
      {error && (
        <p role="alert" className="out-error">
          {error}
        </p>
      )}
      <div className="out-actions">
        <button className="out-primary" disabled={busy}>
          Save campaign
        </button>
      </div>
    </form>
  );
}

function ImportForm({
  busy,
  onSave,
}: {
  busy: boolean;
  onSave: (inputs: ProspectInput[]) => Promise<void>;
}) {
  const [inputs, setInputs] = useState<ProspectInput[]>([]),
    [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const read = async (file?: File) => {
    const version = ++generation.current;
    setInputs([]);
    setError("");
    if (!file) return;
    setReading(true);
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("Choose a CSV under 2 MB.");
      const parsed = parseProspectCsv(await file.text());
      if (version === generation.current) setInputs(parsed);
    } catch (cause) {
      if (version === generation.current) setError(errorText(cause));
    } finally {
      if (version === generation.current) setReading(false);
    }
  };
  return (
    <div className="out-form">
      <div className="out-actions">
        <button
          onClick={() =>
            download(
              "foto-prospect-template.csv",
              "name,company,email,website,specialty,signal,sourceUrl,observedOn,fitReason,notes\r\n",
              "text/csv",
            )
          }
        >
          Download CSV template
        </button>
      </div>
      <label>
        Prospect CSV
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(event) => void read(event.target.files?.[0])}
        />
      </label>
      <p className="out-muted">
        Up to 1,000 rows. Duplicate email addresses or studio websites stop the import so you can
        resolve them first.
      </p>
      {reading && <p role="status">Reading CSV…</p>}
      {inputs.length > 0 && (
        <div className="out-import-preview">
          <strong>{inputs.length} prospects ready to import</strong>
          {inputs.slice(0, 10).map((p, i) => (
            <p key={i}>
              {p.name} · {p.company || p.specialty}
            </p>
          ))}
          {inputs.length > 10 && <p>and {inputs.length - 10} more</p>}
        </div>
      )}
      {error && (
        <p role="alert" className="out-error">
          {error}
        </p>
      )}
      <div className="out-actions">
        <button
          className="out-primary"
          disabled={busy || reading || !inputs.length}
          onClick={() => {
            setError("");
            void onSave(inputs).catch((cause) => setError(errorText(cause)));
          }}
        >
          Import {inputs.length || ""} prospects
        </button>
      </div>
    </div>
  );
}

function ActivityForm({
  kind,
  busy,
  onSave,
}: {
  kind: string;
  busy: boolean;
  onSave: (note: string, channel: "email" | "other") => Promise<void>;
}) {
  const [note, setNote] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [channel, setChannel] = useState<"email" | "other">("email"),
    [error, setError] = useState("");
  return (
    <form
      className="out-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!confirmed) return;
        setError("");
        void onSave(note, channel).catch((cause) => setError(errorText(cause)));
      }}
    >
      {kind === "contact" && (
        <label>
          Channel
          <select
            value={channel}
            disabled={busy}
            onChange={(event) => setChannel(event.target.value as "email" | "other")}
          >
            <option value="email">Email</option>
            <option value="other">Other / direct message</option>
          </select>
        </label>
      )}
      <label>
        {kind === "conversion"
          ? "What changed? (for example, started a trial)"
          : "Notes / evidence"}
        <textarea
          value={note}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          maxLength={2000}
          required={kind !== "contact"}
        />
      </label>
      <label className="out-check">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={busy}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        {kind === "contact"
          ? "I actually sent this message outside Celinen."
          : kind === "suppress"
            ? "Block future outreach to this contact. Keep the record and history."
            : "This outcome actually happened. I’m recording it manually."}
      </label>
      {error && (
        <p role="alert" className="out-error">
          {error}
        </p>
      )}
      <div className="out-actions">
        <button className="out-primary" disabled={busy || !confirmed}>
          {kind === "suppress" ? "Block outreach" : "Save activity"}
        </button>
      </div>
    </form>
  );
}
