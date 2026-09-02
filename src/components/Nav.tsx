import { Link } from "@tanstack/react-router";

export function Nav() {
  return (
    <div className="sticky top-4 z-50 px-4">
      <header className="mx-auto flex w-full max-w-[1240px] items-center justify-between rounded-2xl border border-border bg-card/90 px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] backdrop-blur">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-md bg-ink font-display text-[13px] font-bold text-paper2">
            L
          </span>
          <span className="font-display text-[15px] font-semibold tracking-tight">Lens OS</span>
        </Link>

        <nav className="hidden items-center gap-1 text-sm text-moss sm:flex">
          <Link
            to="/"
            className="rounded-lg px-3 py-1.5 transition-colors hover:bg-muted hover:text-ink"
            activeProps={{ className: "rounded-lg px-3 py-1.5 bg-muted text-ink" }}
            activeOptions={{ exact: true }}
          >
            Home
          </Link>
          <Link
            to="/studio"
            className="rounded-lg px-3 py-1.5 transition-colors hover:bg-muted hover:text-ink"
            activeProps={{ className: "rounded-lg px-3 py-1.5 bg-muted text-ink" }}
          >
            Studio
          </Link>
          <Link
            to="/pricing"
            className="rounded-lg px-3 py-1.5 transition-colors hover:bg-muted hover:text-ink"
            activeProps={{ className: "rounded-lg px-3 py-1.5 bg-muted text-ink" }}
          >
            Pricing
          </Link>
        </nav>

        <Link
          to="/studio"
          className="rounded-xl bg-ink px-4 py-2 text-sm font-medium text-paper2 transition-opacity hover:opacity-85"
        >
          Get started →
        </Link>
      </header>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="mx-auto w-full max-w-[1240px] px-6 py-10">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">Lens OS · 2026</p>
    </footer>
  );
}
