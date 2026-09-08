import { useAccount } from "@/components/account/AccountProvider";
import { publicEntry } from "@/lib/public-entry";
import { Link } from "@tanstack/react-router";
import { ThemeToggle } from "@/components/lensos/Theme";
import { LogoMark } from "@/components/lensos/Logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { Footer as SiteFooter } from "@/components/lensos/Footer";

const LINKS: { to: string; label: string; exact?: boolean }[] = [
  { to: "/", label: "Home", exact: true },
  { to: "/studio", label: "Studio" },
  { to: "/desk", label: "Event Desk" },
  { to: "/earnings", label: "Earnings" },
  { to: "/book", label: "Book a shoot" },
  { to: "/community", label: "Community" },
  { to: "/pricing", label: "Pricing" },
];

export function Nav({ landing = false }: { landing?: boolean }) {
  const account = useAccount();
  const entry = publicEntry(account?.status);

  return (
    <div className="sticky top-4 z-50 px-4">
      <header className="mx-auto grid w-full max-w-[1240px] grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-border bg-card/90 px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] backdrop-blur">
        <Link to="/" className="flex shrink-0 items-center gap-2">
          <LogoMark className="text-ink" />
          <span className="font-display text-[15px] font-semibold tracking-tight">LensLabs</span>
        </Link>

        <nav className="hidden min-w-0 items-center justify-center gap-1 whitespace-nowrap text-sm text-moss lg:flex">
          {landing ? (
            <>
              <a href="#workflow" className="rounded-lg px-3 py-1.5 hover:bg-muted hover:text-ink">
                How it works
              </a>
              <a href="#savings" className="rounded-lg px-3 py-1.5 hover:bg-muted hover:text-ink">
                Savings
              </a>
              <Link to="/pricing" className="rounded-lg px-3 py-1.5 hover:bg-muted hover:text-ink">
                Pricing
              </Link>
            </>
          ) : (
            LINKS.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="rounded-lg px-3 py-1.5 transition-colors hover:bg-muted hover:text-ink"
                activeProps={{ className: "rounded-lg px-3 py-1.5 bg-muted text-ink" }}
                {...(l.exact ? { activeOptions: { exact: true } } : {})}
              >
                {l.label}
              </Link>
            ))
          )}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          {!landing && <ThemeToggle />}

          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Open menu"
              className="grid size-9 shrink-0 place-items-center rounded-xl border border-input text-moss transition-colors hover:text-ink lg:hidden"
            >
              <span className="-mt-1.5 text-lg leading-none">…</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {(landing
                ? [
                    { to: "/docs", label: "Workflow guide" },
                    { to: "/pricing", label: "Pricing" },
                    { to: "/studio", label: "Studio" },
                  ]
                : LINKS
              ).map((l) => (
                <DropdownMenuItem key={l.to} asChild>
                  <Link to={l.to} className="w-full cursor-pointer text-sm">
                    {l.label}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Link
            to={entry.to}
            search={entry.search}
            className="shrink-0 whitespace-nowrap rounded-xl bg-ink px-4 py-2 text-sm font-medium text-paper2 transition-opacity hover:opacity-85"
          >
            {entry.label} →
          </Link>
        </div>
      </header>
    </div>
  );
}

export const Footer = SiteFooter;
