import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useLens } from "@/lib/lensos-store";
import { clientOf } from "@/lib/lensos";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/desk", label: "Event Desk" },
  { to: "/pick", label: "Pick" },
  { to: "/metadata", label: "Metadata" },
  { to: "/packages", label: "Packages" },
  { to: "/adobe", label: "Adobe" },
  { to: "/send", label: "Send" },
  { to: "/clients", label: "Clients" },
  { to: "/business", label: "Business" },
  { to: "/settings", label: "Settings" },
] as const;

export function Chip({ children, tone = "quiet" }: { children: React.ReactNode; tone?: "quiet" | "accent" | "warn" | "solid" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
        tone === "quiet" && "border-border text-moss",
        tone === "accent" && "border-rust/30 bg-rust/8 text-rust",
        tone === "warn" && "border-destructive/30 bg-destructive/8 text-destructive",
        tone === "solid" && "border-ink bg-ink text-paper2",
      )}
    >
      {children}
    </span>
  );
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ kicker, title, sub }: { kicker: string; title: string; sub?: string }) {
  return (
    <div className="mb-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">{kicker}</p>
      <h1 className="mt-2 font-display text-[clamp(1.6rem,3.4vw,2.4rem)] font-bold tracking-[-0.035em]">
        {title}
      </h1>
      {sub ? <p className="mt-2 max-w-[620px] text-sm text-moss">{sub}</p> : null}
    </div>
  );
}

export function Btn({
  children,
  onClick,
  variant = "ghost",
  disabled,
  className,
}: {
  children: React.ReactNode;
  onClick?: (() => void) | undefined;
  variant?: "primary" | "ghost" | "danger" | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40",
        variant === "primary" && "bg-ink text-paper2 hover:-translate-y-0.5 hover:opacity-90",
        variant === "ghost" && "border border-input bg-card text-moss hover:text-ink",
        variant === "danger" && "border border-destructive/40 text-destructive hover:bg-destructive/8",
        className,
      )}
    >
      {children}
    </button>
  );
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const { events, setActiveId } = useLens();

  const commands = useMemo(() => {
    const go = NAV.map((n) => ({
      label: `Go to ${n.label}`,
      run: () => navigate({ to: n.to }),
    }));
    const swap = events.map((e) => ({
      label: `Switch event · ${e.name}`,
      run: () => setActiveId(e.id),
    }));
    const extra = [
      { label: "Open Pick studio queue", run: () => navigate({ to: "/studio" }) },
      { label: "Open portfolio", run: () => navigate({ to: "/portfolio" }) },
    ];
    return [...go, ...swap, ...extra].filter((c) =>
      c.label.toLowerCase().includes(q.toLowerCase()),
    );
  }, [q, events, navigate, setActiveId]);

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-ink/25 p-4 pt-[14vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="scale-in w-full max-w-[560px] overflow-hidden rounded-2xl border border-border bg-card shadow-[0_30px_80px_rgba(0,0,0,0.20)]"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Jump to a screen or run a command…"
          className="w-full border-b border-border bg-transparent px-5 py-4 text-sm outline-none placeholder:text-moss"
        />
        <div className="max-h-[320px] overflow-y-auto p-2">
          {commands.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-moss">No matching command</p>
          )}
          {commands.map((c) => (
            <button
              key={c.label}
              onClick={() => {
                c.run();
                onClose();
              }}
              className="block w-full rounded-xl px-3 py-2.5 text-left text-sm text-moss transition-colors hover:bg-muted hover:text-ink"
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function EventHeader({ onAddSource }: { onAddSource?: (() => void) | undefined }) {
  const { active, clients, events, setActiveId } = useLens();
  const client = clientOf(clients, active.clientId);
  const next = active.deadlines[0];

  return (
    <div className="border-b border-border bg-card/70 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
        <div>
          <select
            value={active.id}
            onChange={(e) => setActiveId(e.target.value)}
            className="-ml-1 max-w-[280px] truncate rounded-lg bg-transparent px-1 font-display text-[17px] font-semibold tracking-tight outline-none hover:bg-muted"
          >
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <p className="text-[13px] text-moss">
            {active.genre} · {active.venue} · {active.start} · {client?.name}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {next ? (
            <Chip tone="accent">
              next · {next.label} — {next.at}
            </Chip>
          ) : (
            <Chip>no deadline set</Chip>
          )}
          <Chip tone={active.offline ? "warn" : "quiet"}>
            <span className="live-dot size-1.5 rounded-full bg-current" />
            {active.offline ? "offline · local only" : "online · local first"}
          </Chip>
          <Btn onClick={onAddSource} variant="ghost" className="px-3 py-1.5 text-[13px]">
            Add source
          </Btn>
        </div>
      </div>
    </div>
  );
}

export function Shell({
  children,
  onAddSource,
  hideEventHeader,
}: {
  children: React.ReactNode;
  onAddSource?: (() => void) | undefined;
  hideEventHeader?: boolean | undefined;
}) {
  const [palette, setPalette] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
      if (e.key === "Escape") setPalette(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen text-ink">
      <div className="sticky top-0 z-50 border-b border-border bg-card/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1240px] items-center gap-3 px-6 py-3">
          <Link to="/" className="flex shrink-0 items-center gap-2">
            <span className="grid size-6 place-items-center rounded-md bg-ink font-display text-[13px] font-bold text-paper2">
              L
            </span>
            <span className="font-display text-[15px] font-semibold tracking-tight">Lens OS</span>
          </Link>

          <nav className="flex flex-1 flex-wrap items-center gap-0.5 text-[13px] text-moss">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 transition-colors hover:bg-muted hover:text-ink",
                  pathname === n.to && "bg-muted text-ink",
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <button
            onClick={() => setPalette(true)}
            className="hidden shrink-0 items-center gap-2 rounded-lg border border-input px-2.5 py-1.5 font-mono text-[11px] text-moss transition-colors hover:text-ink md:flex"
          >
            ⌘K
          </button>
        </div>
      </div>

      {!hideEventHeader && <EventHeader onAddSource={onAddSource} />}

      <main className="mx-auto w-full max-w-[1240px] px-6 py-10">{children}</main>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
