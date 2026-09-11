import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  BookOpen,
  Calendar,
  Home,
  Images,
  Scissors,
  Settings,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";
import { useAccount } from "@/components/account/AccountProvider";
import { LogoMark } from "@/components/lensos/Logo";
import { PRODUCT_NAME } from "@/lib/product";
import { dashboardGreetingFor } from "@/lib/photographer-work-roles";
import { listRecentShoots, shootHref, type RecentShoot } from "@/lib/studio/shoot-directory";
import "./dashboard.css";

const MAIN = [
  { to: "/dashboard", label: "Home", icon: Home, end: true },
  { to: "/studio", label: "Pick", icon: Scissors },
  { to: "/deliver", label: "Galleries", icon: Images },
  { to: "/develop", label: "Develop", icon: SlidersHorizontal },
  { to: "/dashboard", label: "Calendar", icon: Calendar, view: "calendar" as const },
  { to: "/earnings", label: "Analytics", icon: BarChart3 },
  { to: "/publish", label: "Social accounts", icon: Share2 },
  { to: "/library", label: "Tools", icon: Wrench },
] as const;

const FOOT = [
  { to: "/pricing", label: "Upgrade", icon: Sparkles, upgrade: true },
  { to: "/help", label: "Guide", icon: BookOpen },
  { to: "/community", label: "Community", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

function monthCells(year: number, month: number) {
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: first + days }, (_, index) =>
    index < first ? null : index - first + 1,
  );
}

export function AppDashboard() {
  const account = useAccount();
  const navigate = useNavigate();
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const calendarOpen =
    new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("view") ===
    "calendar";
  const [shoots, setShoots] = useState<RecentShoot[]>([]);

  useEffect(() => {
    if (account?.status === "out")
      void navigate({
        to: "/auth",
        search: { next: "/dashboard", mode: "signin", google: true },
        replace: true,
      });
  }, [account?.status, navigate]);

  const loading = !account || account.status === "loading" || account.status === "out";
  const scope = account?.scope;

  useEffect(() => {
    if (!scope) return;
    let alive = true;
    void listRecentShoots(scope)
      .then((rows) => {
        if (alive) setShoots(rows);
      })
      .catch(() => {
        if (alive) setShoots([]);
      });
    return () => {
      alive = false;
    };
  }, [scope]);

  const now = useMemo(() => new Date(), []);
  const cells = monthCells(now.getFullYear(), now.getMonth());
  const byDay = useMemo(() => {
    const map = new Map<number, RecentShoot[]>();
    for (const shoot of shoots) {
      const at = new Date(shoot.updatedAt);
      if (at.getMonth() !== now.getMonth() || at.getFullYear() !== now.getFullYear()) continue;
      const list = map.get(at.getDate()) ?? [];
      list.push(shoot);
      map.set(at.getDate(), list);
    }
    return map;
  }, [shoots, now]);

  return (
    <div className="celinen-dash">
      <aside className="celinen-dash__rail">
        <Link to="/dashboard" className="celinen-dash__brand">
          <LogoMark size={28} />
          {PRODUCT_NAME}
        </Link>
        <nav className="celinen-dash__nav" aria-label="Dashboard">
          {MAIN.map((item) => {
            const calendar = "view" in item;
            const on = calendar ? calendarOpen : Boolean("end" in item && item.end) && !calendarOpen;
            return (
              <Link
                key={item.label}
                to={item.to}
                search={calendar ? { view: "calendar" } : "end" in item && item.end ? {} : undefined}
                activeOptions={"end" in item || calendar ? { exact: true } : undefined}
                className={on ? "celinen-dash__link is-active" : "celinen-dash__link"}
                activeProps={{
                  className:
                    "end" in item && item.end && calendarOpen
                      ? "celinen-dash__link"
                      : "celinen-dash__link is-active",
                }}
              >
                <item.icon size={18} strokeWidth={1.7} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="celinen-dash__foot">
          {FOOT.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              className={
                "upgrade" in item && item.upgrade
                  ? "celinen-dash__link celinen-dash__upgrade"
                  : "celinen-dash__link"
              }
            >
              <item.icon size={18} strokeWidth={1.7} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          ))}
        </div>
      </aside>
      <main className="celinen-dash__body">
        {loading ? (
          <div className="celinen-dash__loading">
            <span className="celinen-dash__spinner" aria-hidden="true" />
            <p>Loading your workspace…</p>
          </div>
        ) : calendarOpen ? (
          <section className="celinen-dash__cal" aria-label="Calendar">
            <h1>{now.toLocaleString("en-US", { month: "long", year: "numeric" })}</h1>
            <div className="celinen-dash__cal-week">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
            <div className="celinen-dash__cal-grid">
              {cells.map((day, index) => {
                const rows = day ? byDay.get(day) : undefined;
                return (
                  <div key={index} className={day ? "celinen-dash__cal-day" : undefined}>
                    {day ? <span>{day}</span> : null}
                    {rows?.map((shoot) => (
                      <a key={shoot.id} href={shootHref(shoot.id)}>
                        {shoot.title}
                      </a>
                    ))}
                  </div>
                );
              })}
            </div>
          </section>
        ) : (
          <div className="celinen-dash__home">
            <h1>{dashboardGreetingFor(account?.workRole)}</h1>
          </div>
        )}
      </main>
    </div>
  );
}
