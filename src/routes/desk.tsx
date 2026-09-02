import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Btn, Card, Chip, SectionTitle, Shell } from "@/components/lensos/Shell";
import { useLens } from "@/lib/lensos-store";
import { packageFill, type IngestState } from "@/lib/lensos";

export const Route = createFileRoute("/desk")({
  head: () => ({
    meta: [
      { title: "Event Desk — LensLabs Production" },
      {
        name: "description",
        content:
          "Create and switch events, attach sources, watch ingest progress and see which packages still need selects.",
      },
      { property: "og:title", content: "Event Desk — LensLabs Production" },
      {
        property: "og:description",
        content: "The home base for a shoot: events, sources, ingest state and package deadlines.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Desk,
});

const INGEST_FLOW: IngestState[] = [
  "source waiting",
  "permission needed",
  "enumerating",
  "indexing previews",
  "queue ready",
  "ingest complete",
];

function Desk() {
  const { active, events, clients, setActiveId, createEvent, attachSource } = useLens();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [genre, setGenre] = useState("");
  const [venue, setVenue] = useState("");
  const [clientId, setClientId] = useState(clients[0]!.id);

  const hasWork = active.sources.length > 0 || active.picks.length > 0;

  return (
    <Shell onAddSource={() => attachSource(`Folder · /volumes/${Date.now().toString().slice(-4)}`)}>
      <SectionTitle
        kicker="Event Desk"
        title="Everything the job needs before and after Pick."
        sub="Originals stay read-only. Reject is a soft reject. Nothing sends without your approval."
      />

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <div className="flex items-center justify-between">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">Sources</p>
            <Btn
              onClick={() => attachSource(`Card · Slot ${active.sources.length + 1}`)}
              className="px-3 py-1.5 text-[13px]"
            >
              Attach source
            </Btn>
          </div>

          {active.sources.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-input p-8 text-center">
              <p className="font-display text-[17px] font-semibold tracking-tight">
                No source attached
              </p>
              <p className="mt-1 text-sm text-moss">Two ways to start work.</p>
              <div className="mt-5 flex justify-center gap-2">
                <Btn variant="primary" onClick={() => setCreating(true)}>
                  Create event
                </Btn>
                <Btn onClick={() => attachSource("Card · Slot 1")}>Attach source</Btn>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {active.sources.map((s) => {
                const step = INGEST_FLOW.indexOf(s.state);
                return (
                  <div key={s.id} className="rounded-xl border border-border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-display text-[15px] font-semibold tracking-tight">
                        {s.label}
                      </p>
                      <Chip tone={s.state === "ingest complete" ? "accent" : "quiet"}>{s.state}</Chip>
                    </div>
                    <div className="mt-3 flex gap-1">
                      {INGEST_FLOW.slice(2).map((st, i) => (
                        <span
                          key={st}
                          className={`h-1 flex-1 rounded-full ${
                            step - 2 >= i ? "bg-rust" : "bg-muted"
                          }`}
                        />
                      ))}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[11px] text-moss sm:grid-cols-4">
                      <span>{s.files} files</span>
                      <span>{s.previews} previews</span>
                      <span>{s.duplicates} dupes</span>
                      <span>{s.unsupported} unsupported</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {s.verifying && <Chip>copy + verify in background</Chip>}
                      {s.lowDisk && <Chip tone="warn">low disk</Chip>}
                      {s.previews > 0 && <Chip tone="accent">previews exist · queue reviewable</Chip>}
                    </div>
                  </div>
                );
              })}
              <p className="text-[12px] text-moss">
                Queue ready means previews exist for review — not just filenames counted.
              </p>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">Pick</p>
            <p className="mt-2 font-display text-[17px] font-semibold tracking-tight">
              {hasWork ? "Queue ready" : "Nothing to review yet"}
            </p>
            <p className="mt-1 text-sm text-moss">
              {active.pickQueue.reviewed}/{active.pickQueue.total} reviewed ·{" "}
              {active.pickQueue.selects} selects
            </p>
            <Link
              to="/pick"
              className="mt-4 inline-block rounded-xl bg-ink px-4 py-2 text-sm font-medium text-paper2 transition-all hover:-translate-y-0.5"
            >
              Open Pick →
            </Link>
          </Card>

          <Card>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">
              Package deadlines
            </p>
            {active.packages.length === 0 && (
              <p className="mt-3 text-sm text-moss">No packages yet.</p>
            )}
            <div className="mt-3 space-y-3">
              {active.packages.map((p) => {
                const fill = packageFill(active, p);
                const short = Math.max(0, p.target - fill);
                return (
                  <div key={p.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{p.name}</span>
                      <span className="font-mono text-[11px] text-moss">{p.deadline}</span>
                    </div>
                    <p className="mt-1 text-[13px] text-moss">
                      {fill}/{p.target} selects ·{" "}
                      {short > 0 ? (
                        <span className="text-rust">{short} short</span>
                      ) : (
                        "target met"
                      )}
                    </p>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">Events</p>
          <Btn onClick={() => setCreating((c) => !c)} className="px-3 py-1.5 text-[13px]">
            {creating ? "Cancel" : "Create event"}
          </Btn>
        </div>

        {creating && (
          <Card className="mt-3">
            <div className="grid gap-3 sm:grid-cols-4">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Event name"
                className="rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none"
              />
              <input
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                placeholder="Sport / genre"
                className="rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none"
              />
              <input
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="Venue"
                className="rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none"
              />
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none"
              >
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <Btn
              variant="primary"
              className="mt-3"
              disabled={!name.trim()}
              onClick={() => {
                createEvent({ name: name.trim(), genre, venue, clientId });
                setName("");
                setCreating(false);
              }}
            >
              Create event + draft job
            </Btn>
          </Card>
        )}

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {events.map((e) => (
            <button
              key={e.id}
              onClick={() => setActiveId(e.id)}
              className={`rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 ${
                e.id === active.id ? "border-rust/50 bg-card" : "border-border bg-card"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-display text-[15px] font-semibold tracking-tight">
                  {e.name}
                </span>
              </div>
              <p className="mt-1 text-[13px] text-moss">
                {e.genre} · {e.start}
              </p>
              <div className="mt-3">
                <Chip tone={e.status === "active" ? "accent" : "quiet"}>{e.status}</Chip>
              </div>
            </button>
          ))}
        </div>
      </div>
    </Shell>
  );
}
