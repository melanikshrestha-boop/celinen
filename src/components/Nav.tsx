import { Link } from "@tanstack/react-router";

export function Nav() {
  return (
    <header className="mx-auto flex max-w-[1240px] items-center justify-between px-6 pt-6">
      <Link to="/" className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-lg border border-rust/40 bg-rust/15 font-mono text-sm font-bold text-rust">
          ◎
        </span>
        <span className="font-display text-xl font-bold tracking-tight">Lens&nbsp;OS</span>
        <span className="mt-0.5 hidden rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-moss sm:inline">
          culling engine
        </span>
      </Link>
      <nav className="hidden items-center gap-8 font-mono text-xs uppercase tracking-[0.15em] text-moss md:flex">
        <Link to="/" hash="workflow" className="transition-colors hover:text-rust">
          Workflow
        </Link>
        <Link to="/pricing" className="transition-colors hover:text-rust">
          Pricing
        </Link>
        <Link to="/studio" className="transition-colors hover:text-rust">
          Workspace
        </Link>
      </nav>
      <Link
        to="/studio"
        className="rounded-full bg-rust px-4 py-2 font-mono text-xs uppercase tracking-[0.15em] text-paper transition-transform hover:-translate-y-0.5"
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
          <span className="grid size-8 place-items-center rounded-lg border border-rust/40 bg-rust/15 font-mono text-xs font-bold text-rust">
            ◎
          </span>
          <span className="font-display font-bold">Lens OS</span>
        </div>
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-moss">
          Shot by humans · culled locally · © 2026
        </p>
      </div>
    </footer>
  );
}
