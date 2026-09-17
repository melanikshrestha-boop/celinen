import { useEffect, useState } from "react";
import { useAccount } from "@/components/account/AccountProvider";
import { publicEntry } from "@/lib/public-entry";
import { Link } from "@tanstack/react-router";
import { ThemeToggle } from "@/components/lensos/Theme";
import { LogoMark } from "@/components/lensos/Logo";
import { PRODUCT_NAME } from "@/lib/product";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { ArrowRight, Menu } from "lucide-react";
import { FeaturesMenu } from "@/components/marketing/FeaturesMenu";
import { IntegrationsMenu } from "@/components/marketing/IntegrationsMenu";
import { UseCasesMenu } from "@/components/marketing/UseCasesMenu";
import { NavMenuProvider } from "@/components/marketing/nav-menu";

import { Footer as SiteFooter } from "@/components/lensos/Footer";
import { PublicEntryCta } from "@/components/PublicEntryCta";

const LINKS: { to: string; label: string; exact?: boolean }[] = [
  { to: "/", label: "Home", exact: true },
  { to: "/studio", label: "Studio" },
  { to: "/desk", label: "Event Desk" },
  { to: "/earnings", label: "Earnings" },
  { to: "/community", label: "Community" },
  { to: "/pricing", label: "Pricing" },
];

export function Nav({ landing = false }: { landing?: boolean }) {
  const account = useAccount();
  const entry = publicEntry(account?.status);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    const close = () => setMobileOpen(false);
    const query = window.matchMedia("(max-width: 900px)");
    query.addEventListener("change", close);
    window.addEventListener("orientationchange", close);
    return () => {
      query.removeEventListener("change", close);
      window.removeEventListener("orientationchange", close);
    };
  }, []);

  if (landing) {
    return (
      <div className="marketing-nav-shell">
        <header className="marketing-nav">
          <Link to="/" className="marketing-nav__brand" aria-label="celinen home">
            <LogoMark />
            <span>{PRODUCT_NAME}</span>
          </Link>
          <NavMenuProvider>
            <nav className="marketing-nav__links" aria-label="Main navigation">
              <FeaturesMenu />
              <UseCasesMenu />
              <IntegrationsMenu />
              <Link to="/pricing">Pricing</Link>
              <Link to="/docs">Docs</Link>
              <Link to="/changelog">Changelog</Link>
            </nav>
          </NavMenuProvider>
          <div className="marketing-nav__actions">
            <PublicEntryCta
              className="marketing-nav-cta"
              guestMode="signin"
              guestLabel={
                <>
                  Sign In
                  <ArrowRight size={16} aria-hidden="true" />
                </>
              }
              memberLabel={
                <>
                  Dashboard
                  <ArrowRight size={16} aria-hidden="true" />
                </>
              }
            />
            <DropdownMenu modal={false} open={mobileOpen} onOpenChange={setMobileOpen}>
              <DropdownMenuTrigger aria-label="Open menu" className="marketing-nav__more">
                <Menu size={20} aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={10} className="w-56 marketing-nav-menu">
                {[
                  { to: "/product", label: "Product" },
                  { to: "/use-cases", label: "Use Cases" },
                  { to: "/integrations", label: "Integrations" },
                  { to: "/compare", label: "Compare" },
                  { to: "/affiliates", label: "Affiliates" },
                  { to: "/pricing", label: "Pricing" },
                  { to: "/docs", label: "Docs" },
                  { to: "/blog", label: "Blog" },
                  { to: "/changelog", label: "Changelog" },
                  { to: "/security", label: "Security" },
                ].map((link) => (
                  <DropdownMenuItem key={link.to} asChild>
                    <Link to={link.to}>{link.label}</Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="sticky top-4 z-50 px-4">
      <header className="mx-auto grid w-full max-w-[1240px] grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-border bg-card/90 px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] backdrop-blur">
        <Link to="/" className="flex shrink-0 items-center gap-2">
          <LogoMark className="text-ink" />
          <span className="font-display text-[15px] font-semibold tracking-tight">
            {PRODUCT_NAME}
          </span>
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
            <DropdownMenuContent
              align="end"
              className={landing ? "w-48 marketing-nav-menu" : "w-48"}
            >
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

          <PublicEntryCta
            className="shrink-0 whitespace-nowrap rounded-xl bg-ink px-4 py-2 text-sm font-medium text-paper2 transition-opacity hover:opacity-85"
            guestLabel={`${entry.label} →`}
            memberLabel="Dashboard →"
          />
        </div>
      </header>
    </div>
  );
}

export const Footer = SiteFooter;
