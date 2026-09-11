import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  AtSign,
  BarChart3,
  BookOpen,
  Calendar,
  ChevronDown,
  DollarSign,
  Gift,
  Home,
  LogOut,
  MessageSquare,
  PanelLeft,
  Scissors,
  Settings,
  Workflow,
  Wrench,
} from "lucide-react";
import { useAccount } from "@/components/account/AccountProvider";
import { InviteFriendDialog } from "@/components/account/InviteFriendDialog";
import { accountInitials } from "@/lib/account-preferences";
import { PRODUCT_NAME } from "@/lib/product";
import { listRecentShoots, shootHref, type RecentShoot } from "@/lib/studio/shoot-directory";
import "./dashboard.css";

const MAIN = [
  { to: "/dashboard", label: "Home", icon: Home, end: true },
  { to: "/shoots", label: "Clipping", icon: Scissors },
  { to: "/tonight", label: "Automations", icon: Workflow },
  { to: "/dashboard", label: "Calendar", icon: Calendar, view: "calendar" },
  { to: "/earnings", label: "Analytics", icon: BarChart3 },
  { to: "/publish", label: "Social Accounts", icon: AtSign },
  { to: "/library", label: "Tools", icon: Wrench },
] as const;

function initial(name: string) {
  return (accountInitials(name).slice(0, 1) || "C").toUpperCase();
}

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
  const calendarOpen = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(
    "view",
  ) === "calendar";
  const [collapsed, setCollapsed] = useState(false);
  const [invite, setInvite] = useState(false);
  const [menu, setMenu] = useState(false);
  const inviteFocus = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [shoots, setShoots] = useState<RecentShoot[] | null>(null);

  useEffect(() => {
    if (account?.status === "out")
      void navigate({
        to: "/auth",
        search: { next: "/dashboard", mode: "signin", google: true },
        replace: true,
      });
  }, [account?.status, navigate]);

  const loading = !account || account.status === "loading" || account.status === "out";
  const name = account?.name?.trim() || PRODUCT_NAME;
  const workspace = account?.workspaceName?.trim() || name;
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

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const now = useMemo(() => new Date(), []);
  const cells = monthCells(now.getFullYear(), now.getMonth());
  const byDay = useMemo(() => {
    const map = new Map<number, RecentShoot[]>();
    for (const shoot of shoots ?? []) {
      const day = new Date(shoot.updatedAt).getDate();
      const month = new Date(shoot.updatedAt).getMonth();
      const year = new Date(shoot.updatedAt).getFullYear();
      if (month !== now.getMonth() || year !== now.getFullYear()) continue;
      const list = map.get(day) ?? [];
      list.push(shoot);
      map.set(day, list);
    }
    return map;
  }, [shoots, now]);

  return (
    <div className={`celinen-dash${collapsed ? " is-collapsed" : ""}`}>
      <aside className="celinen-dash__rail">
        <div className="celinen-dash__workspace" ref={menuRef}>
          <button
            type="button"
            className="celinen-dash__who"
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((open) => !open)}
          >
            <span className="celinen-dash__mark" aria-hidden="true">
              {loading ? "C" : initial(name)}
            </span>
            <span className="celinen-dash__who-copy">
              {loading ? "Loading..." : workspace}
            </span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="celinen-dash__collapse"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setCollapsed((value) => !value)}
          >
            <PanelLeft size={16} aria-hidden="true" />
          </button>
          {menu && account?.status === "in" && (
            <div className="celinen-dash__menu" role="menu">
              <Link role="menuitem" to="/settings" onClick={() => setMenu(false)}>
                Settings
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  void account.signOut().then((ok) => {
                    if (ok)
                      void navigate({
                        to: "/auth",
                        search: { next: "/dashboard", mode: "signin", google: true },
                      });
                  });
                }}
              >
                <LogOut size={15} aria-hidden="true" />
                Log out
              </button>
            </div>
          )}
        </div>
        <nav className="celinen-dash__nav" aria-label="Dashboard">
          {MAIN.map((item) => {
            const calendar = "view" in item;
            const on = calendar ? calendarOpen : Boolean(item.end) && !calendarOpen;
            return (
              <Link
                key={item.label}
                to={item.to}
                search={calendar ? { view: "calendar" } : item.end ? {} : undefined}
                activeOptions={item.end || calendar ? { exact: true } : undefined}
                className={on ? "celinen-dash__link is-active" : "celinen-dash__link"}
                activeProps={{
                  className:
                    item.end && calendarOpen ? "celinen-dash__link" : "celinen-dash__link is-active",
                }}
              >
                <item.icon size={18} strokeWidth={1.7} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="celinen-dash__foot">
          <Link to="/pricing" className="celinen-dash__link celinen-dash__upgrade">
            <DollarSign size={18} strokeWidth={1.7} aria-hidden="true" />
            <span>Upgrade</span>
          </Link>
          <button
            ref={inviteFocus}
            type="button"
            className="celinen-dash__link"
            onClick={() => setInvite(true)}
          >
            <Gift size={18} strokeWidth={1.7} aria-hidden="true" />
            <span>Refer & Earn</span>
          </button>
          <Link to="/docs" className="celinen-dash__link">
            <BookOpen size={18} strokeWidth={1.7} aria-hidden="true" />
            <span>Guides</span>
          </Link>
          <Link to="/help" className="celinen-dash__link">
            <MessageSquare size={18} strokeWidth={1.7} aria-hidden="true" />
            <span>Feedback</span>
          </Link>
          <Link to="/settings" className="celinen-dash__link">
            <Settings size={18} strokeWidth={1.7} aria-hidden="true" />
            <span>Settings</span>
          </Link>
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
          <div className="celinen-dash__home" />
        )}
      </main>
      <InviteFriendDialog open={invite} onOpenChange={setInvite} returnFocus={inviteFocus} />
    </div>
  );
}
