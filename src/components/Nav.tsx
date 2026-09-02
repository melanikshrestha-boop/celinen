import { Link } from "@tanstack/react-router";
import { ThemeToggle } from "@/components/lensos/Theme";
import { LogoMark } from "@/components/lensos/Logo";

import { Footer as SiteFooter } from "@/components/lensos/Footer";

export function Nav() {
  return (
    <div className="sticky top-4 z-50 px-4">
      <header className="mx-auto flex w-full max-w-[1240px] items-center justify-between rounded-2xl border border-border bg-card/90 px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] backdrop-blur">
        <Link to="/" className="flex items-center gap-2">
          <LogoMark className="text-ink" />

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
            to="/desk"
            className="rounded-lg px-3 py-1.5 transition-colors hover:bg-muted hover:text-ink"
            activeProps={{ className: "rounded-lg px-3 py-1.5 bg-muted text-ink" }}
          >
            Event Desk
          </Link>
          <Link
            to="/earnings"
            className="rounded-lg px-3 py-1.5 transition-colors hover:bg-muted hover:text-ink"
            activeProps={{ className: "rounded-lg px-3 py-1.5 bg-muted text-ink" }}
          >
            Earnings
          </Link>
          <Link
            to="/pricing"
            className="rounded-lg px-3 py-1.5 transition-colors hover:bg-muted hover:text-ink"
            activeProps={{ className: "rounded-lg px-3 py-1.5 bg-muted text-ink" }}
          >
            Pricing
          </Link>
        </nav>

        <div className="flex items-center gap-2">
        <ThemeToggle />
        <Link
          to="/studio"
          className="rounded-xl bg-ink px-4 py-2 text-sm font-medium text-paper2 transition-opacity hover:opacity-85"
        >
          Get started →
        </Link>
        </div>
      </header>
    </div>
  );
}

export const Footer = SiteFooter;
