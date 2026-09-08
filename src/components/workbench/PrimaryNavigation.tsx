import { useId, type ReactElement } from "react";
import { SquarePen } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FOTO_PRIMARY_NAV, followNavigation, primaryNavigationPath } from "./primary-navigation";

export function NavigationHint({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" className="foto-nav-tooltip">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function PrimaryNavigation({
  pathname,
  open,
  counts = {},
}: {
  pathname: string;
  open: (href: string) => unknown;
  counts?: Partial<Record<"/tonight" | "/deliver", number | null>>;
}) {
  const active = primaryNavigationPath(pathname);
  const badgeId = useId();
  return (
    <nav className="foto-primary-nav" aria-label="Primary navigation">
      {FOTO_PRIMARY_NAV.map(({ href, label, Icon }) => {
        const count = href === "/tonight" || href === "/deliver" ? counts[href] : null;
        const hasCount = typeof count === "number" && Number.isFinite(count) && count > 0;
        return (
          <NavigationHint key={href} label={label}>
            <a
              className={`workbench-nav-item foto-primary-item ${active === href ? "is-active" : ""}`}
              href={href}
              aria-label={label}
              aria-describedby={hasCount ? `${badgeId}-${label}` : undefined}
              aria-current={active === href ? "page" : undefined}
              onClick={(event) => followNavigation(event, href, open)}
            >
              <Icon size={20} strokeWidth={1.65} aria-hidden="true" />
              <span className="foto-nav-label">{label}</span>
              {hasCount && (
                <span
                  className="foto-nav-count"
                  id={`${badgeId}-${label}`}
                  aria-label={`${count} ${href === "/tonight" ? "scheduled shoots" : "unpublished galleries"}`}
                >
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </a>
          </NavigationHint>
        );
      })}
    </nav>
  );
}

export function NewShootAction({ create, busy }: { create: () => unknown; busy: boolean }) {
  return (
    <NavigationHint label="New shoot">
      <button
        className="workbench-nav-item foto-new-shoot"
        aria-label="New shoot"
        disabled={busy}
        onClick={() => void create()}
      >
        <SquarePen size={20} strokeWidth={1.65} aria-hidden="true" />
        <span className="foto-nav-label">{busy ? "Opening…" : "New shoot"}</span>
      </button>
    </NavigationHint>
  );
}

export type NavigationRecent = {
  id: string;
  title: string;
  href: string;
  detail: string;
  recoveryPending?: boolean;
};
export function LibraryRecents({
  rows,
  activeId,
  open,
  loading,
  error,
}: {
  rows: NavigationRecent[];
  activeId: string | null;
  open: (href: string) => unknown;
  loading: boolean;
  error: string;
}) {
  if (!rows.length && !loading && !error) return null;
  return (
    <section className="foto-library-recents" aria-label="Recent library">
      <h2>Recent</h2>
      {rows.slice(0, 8).map((row) => (
        <a
          key={row.id}
          href={row.href}
          className={`foto-library-row ${activeId === row.id ? "is-active" : ""}`}
          aria-current={activeId === row.id ? "page" : undefined}
          onClick={(event) => followNavigation(event, row.href, open)}
        >
          <span title={row.title}>{row.title}</span>
          <small>{row.recoveryPending ? "Recovery available" : row.detail}</small>
        </a>
      ))}
      {loading && !rows.length && <p role="status">Opening library…</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
