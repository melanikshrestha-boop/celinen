import { Link } from "@tanstack/react-router";

export function Nav() {
  return (
    <header className="mx-auto flex w-full max-w-[1100px] items-center justify-between px-6 py-6">
      <Link to="/" className="font-display text-sm font-medium tracking-tight">
        Lens OS
      </Link>
      <nav className="flex items-center gap-6 text-sm text-moss">
        <Link to="/pricing" className="transition-colors hover:text-ink">
          Pricing
        </Link>
        <Link to="/studio" className="transition-colors hover:text-ink">
          Studio
        </Link>
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mx-auto w-full max-w-[1100px] px-6 py-8">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-moss">Lens OS · 2026</p>
    </footer>
  );
}
