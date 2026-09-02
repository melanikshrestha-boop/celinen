import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Shell } from "@/components/lensos/Shell";
import { LogoMark } from "@/components/lensos/Logo";
import { useLens } from "@/lib/lensos-store";
import { packageFill } from "@/lib/lensos";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/desk")({
  head: () => ({
    meta: [
      { title: "Event Desk — LensLabs Production" },
      {
        name: "description",
        content:
          "One screen for the shoot: sources ingesting, keepers picked, packages due. Private to your studio.",
      },
      { property: "og:title", content: "Event Desk — LensLabs Production" },
      {
        property: "og:description",
        content: "Sources, picks and deadlines for the current event.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Desk,
});

function Stat({
  label,
  value,
  sub,
  delay,
  to,
}: {
  label: string;
  value: string;
  sub: string;
  delay: number;
  to?: "/pick" | "/packages" | "/send";
}) {
  const body = (
    <div
      className="rise-in group relative overflow-hidden rounded-2xl border border-border bg-card p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(0,0,0,0.08)]"
      style={{ animationDelay: `${delay}ms` }}
    >
      <span className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-ink/[0.04] to-transparent sweep" />
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-moss">{label}</p>
      <p className="mt-3 font-display text-[clamp(1.9rem,4vw,2.6rem)] font-bold leading-none tracking-[-0.04em]">
        {value}
      </p>
      <p className="mt-2 text-[13px] text-moss">{sub}</p>
    </div>
  );
  return to ? (
    <Link to={to} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

function Desk() {
  const { active, events, setActiveId, attachSource } = useLens();
  const [showEvents, setShowEvents] = useState(false);

  const files = active.sources.reduce((s, x) => s + x.files, 0);
  const previews = active.sources.reduce((s, x) => s + x.previews, 0);
  const ingest = files ? Math.round((previews / files) * 100) : 0;
  const due = active.packages
    .map((p) => ({ p, short: Math.max(0, p.target - packageFill(active, p)) }))
    .sort((a, b) => b.short - a.short)[0];

  return (
    <Shell onAddSource={() => attachSource("New source")}>
      <section className="flex flex-col items-center py-10 text-center">
        <div className="float-y">
          <LogoMark size={56} className="iris-breathe text-ink" />
        </div>
        <h1 className="rise-in mt-6 font-display text-[clamp(2rem,5.5vw,3.4rem)] font-bold leading-[1] tracking-[-0.045em]">
          {active.name}
        </h1>
        <button
          onClick={() => setShowEvents((v) => !v)}
          className="rise-in mt-3 rounded-full border border-border px-3 py-1 text-[12px] text-moss transition-colors hover:text-ink [animation-delay:100ms]"
        >
          {showEvents ? "hide events" : "switch event"}
        </button>

        {showEvents && (
          <div className="scale-in mt-4 flex flex-wrap justify-center gap-2">
            {events.map((e) => (
              <button
                key={e.id}
                onClick={() => {
                  setActiveId(e.id);
                  setShowEvents(false);
                }}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[13px] transition-all hover:-translate-y-0.5",
                  e.id === active.id
                    ? "border-ink bg-ink text-paper2"
                    : "border-border bg-card text-moss hover:text-ink",
                )}
              >
                {e.name}
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Ingest"
          value={files ? `${ingest}%` : "—"}
          sub={files ? `${previews}/${files} previews` : "attach a card to start"}
          delay={0}
        />
        <Stat
          label="Picks"
          value={`${active.pickQueue.selects}`}
          sub={`${active.pickQueue.reviewed}/${active.pickQueue.total} reviewed`}
          delay={90}
          to="/pick"
        />
        <Stat
          label="Next due"
          value={due ? (due.short > 0 ? `${due.short}` : "✓") : "—"}
          sub={due ? `${due.p.name} · ${due.p.deadline}` : "no packages"}
          delay={180}
          to="/packages"
        />
      </div>

      <div className="rise-in mt-4 overflow-hidden rounded-2xl border border-border bg-card [animation-delay:260ms]">
        {active.sources.length === 0 ? (
          <button
            onClick={() => attachSource("New source")}
            className="flex w-full items-center justify-center gap-3 px-5 py-10 text-sm text-moss transition-colors hover:text-ink"
          >
            <LogoMark size={20} className="iris-spin" />
            Drop a card or folder to begin
          </button>
        ) : (
          active.sources.map((s, i) => (
            <div
              key={s.id}
              className="flex items-center gap-4 border-b border-border px-5 py-4 last:border-0"
            >
              <span className="live-dot size-1.5 shrink-0 rounded-full bg-rust" />
              <span className="w-40 shrink-0 truncate text-[14px] font-medium">{s.label}</span>
              <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="bar-fill absolute inset-y-0 left-0 rounded-full bg-ink"
                  style={{
                    width: `${s.files ? Math.round((s.previews / s.files) * 100) : 0}%`,
                    animationDelay: `${i * 120}ms`,
                  }}
                />
              </span>
              <span className="shrink-0 font-mono text-[11px] text-moss">{s.state}</span>
            </div>
          ))
        )}
      </div>

      <div className="rise-in mt-8 flex justify-center [animation-delay:340ms]">
        <Link
          to="/pick"
          className="group rounded-xl bg-ink px-7 py-3.5 text-sm font-medium text-paper2 transition-all hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(0,0,0,0.18)]"
        >
          Open Pick{" "}
          <span className="inline-block transition-transform group-hover:translate-x-1">→</span>
        </Link>
      </div>
    </Shell>
  );
}
