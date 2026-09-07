import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useLens } from "@/lib/lensos-store";
import { clientOf } from "@/lib/lensos";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/lensos/Theme";
import { Footer } from "@/components/lensos/Footer";
import { LogoMark } from "@/components/lensos/Logo";
import { useSessionState } from "@/lib/use-session";
import { useWorkbench } from "@/components/workbench/context";

/** Every workspace screen is private — nothing renders until a studio is signed in. */
function Locked({ loading }: { loading: boolean }) {
  return (
    <div className="grid min-h-screen place-items-center px-6 text-ink">
      <div className="flex flex-col items-center text-center">
        <div className="float-y">
          <LogoMark size={72} className={loading ? "iris-spin text-ink" : "iris-breathe text-ink"} />
        </div>
        {loading ? (
          <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.22em] text-moss">
            opening workspace…
          </p>
        ) : (
          <>
            <h1 className="rise-in mt-8 font-display text-[clamp(1.8rem,5vw,2.9rem)] font-bold tracking-[-0.04em]">
              Sign in to open your studio.
            </h1>
            <p className="rise-in mt-3 max-w-[380px] text-moss [animation-delay:120ms]">
              Your desk, picks and clients are private.
            </p>
            <div className="rise-in mt-8 flex gap-3 [animation-delay:220ms]">
              <Link
                to="/auth"
                search={{ next: "/desk" }}
                className="rounded-xl bg-ink px-6 py-3 text-sm font-medium text-paper2 transition-all hover:-translate-y-0.5"
              >
                Sign in →
              </Link>
              <Link
                to="/"
                className="rounded-xl border border-input bg-card px-6 py-3 text-sm text-moss transition-all hover:-translate-y-0.5 hover:text-ink"
              >
                See the demo
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}


const NAV = [
  { to: "/projects", label: "Projects" },
  { to: "/desk", label: "Event Desk" },
  { to: "/pick", label: "Pick" },
  { to: "/metadata", label: "Metadata" },
  { to: "/packages", label: "Packages" },
  { to: "/rates", label: "Rates" },
  { to: "/adobe", label: "Adobe" },
  { to: "/send", label: "Send" },
  { to: "/deliver", label: "Deliver" },
  { to: "/clients", label: "Clients" },
  { to: "/business", label: "Business" },
  { to: "/earnings", label: "Earnings" },
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
      { label: "Export tax summary", run: () => navigate({ to: "/earnings" }) },
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

export function Shell(props: { children: React.ReactNode; onAddSource?: (() => void) | undefined; hideEventHeader?: boolean | undefined; quietWorkspace?: boolean }) {
  const workbench = useWorkbench();
  if (workbench) return <div className="workbench-tool-content">{!props.hideEventHeader && <EventHeader onAddSource={props.onAddSource} />}{props.children}</div>;
  return <StandaloneShell {...props} />;
}

function StandaloneShell({
  children,
  onAddSource,
  hideEventHeader,
  quietWorkspace = false,
}: {
  children: React.ReactNode;
  onAddSource?: (() => void) | undefined;
  hideEventHeader?: boolean | undefined;
  quietWorkspace?: boolean;
}) {
  const [palette, setPalette] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const session = useSessionState();

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

  if (session !== "in") return <Locked loading={session === "loading"} />;

  return (
    <div className="min-h-screen text-ink">

      <div className={quietWorkspace ? "sticky top-0 z-50 bg-paper/95" : "sticky top-0 z-50 border-b border-border bg-card/85 backdrop-blur"}>
        <div className="mx-auto flex w-full max-w-[1240px] items-center gap-3 px-6 py-3">
          <Link to="/" className="flex shrink-0 items-center gap-2">
            <LogoMark className="text-ink" />
            <span className="font-display text-[15px] font-semibold tracking-tight">LensLabs</span>
          </Link>

          <nav className="flex flex-1 flex-wrap items-center gap-0.5 text-[13px] text-moss">
            {(quietWorkspace ? [
              { to: "/studio", label: "Studio" },
              { to: "/projects", label: "Shoots" },
              { to: "/clients", label: "Clients" },
            ] as const : NAV).map((n) => (
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

          <ThemeToggle className={quietWorkspace ? "!border-0" : undefined} />

          <button
            onClick={() => setPalette(true)}
            aria-label="Open workspace navigation"
            className={quietWorkspace ? "shrink-0 px-2 py-2 text-sm text-moss hover:text-ink" : "hidden shrink-0 items-center gap-2 rounded-lg border border-input px-2.5 py-1.5 font-mono text-[11px] text-moss transition-colors hover:text-ink md:flex"}
          >
            {quietWorkspace ? "More" : "⌘K"}
          </button>
        </div>
      </div>

      {!hideEventHeader && <EventHeader onAddSource={onAddSource} />}

      <main className="mx-auto w-full max-w-[1240px] px-6 py-10">{children}</main>
      {!quietWorkspace && <Footer />}
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
