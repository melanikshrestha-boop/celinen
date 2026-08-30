import { Link } from "@tanstack/react-router";

export function Nav() {
  return (
    <header className="mx-auto flex max-w-[1240px] items-center justify-between px-6 pt-6">
      <Link to="/" className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-full bg-rust font-display text-lg font-bold text-paper2">
          L
        </span>
        <span className="font-display text-xl font-semibold tracking-tight">Lens&nbsp;OS</span>
        <span className="mt-1 hidden rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-moss sm:inline">
          culling studio
        </span>
      </Link>
      <nav className="hidden items-center gap-8 font-mono text-xs uppercase tracking-[0.15em] md:flex">
        <Link to="/" hash="workflow" className="hover:text-rust">
          Workflow
        </Link>
        <Link to="/pricing" className="hover:text-rust">
          Pricing
        </Link>
        <Link to="/studio" className="hover:text-rust">
          Workspace
        </Link>
      </nav>
      <Link
        to="/studio"
        className="rounded-full bg-ink px-4 py-2 font-mono text-xs uppercase tracking-[0.15em] text-paper2 transition-colors hover:bg-rust"
      >
        Open studio
      </Link>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mx-auto max-w-[1240px] px-6 pb-10">
      <div className="flex flex-col items-center justify-between gap-4 border-t border-border pt-8 md:flex-row">
        <div className="flex items-center gap-3">
          <span className="grid size-8 place-items-center rounded-full bg-rust font-display font-bold text-paper2">
            L
          </span>
          <span className="font-display font-semibold">Lens OS</span>
        </div>
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-moss">
          Shot by humans · cull by Lens OS · © 2026
        </p>
      </div>
    </footer>
  );
}
