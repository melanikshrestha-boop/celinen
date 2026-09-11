import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ArrowUp,
  Aperture,
  CalendarDays,
  ChartNoAxesColumn,
  House,
  Images,
  PanelLeft,
  Plus,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useAccount } from "@/components/account/AccountProvider";
import { AccountMenu } from "@/components/account/AccountMenu";
import { SocialDock } from "./SocialDock";
import { LogoMark } from "@/components/lensos/Logo";
import { onHapticPress } from "@/lib/haptic-press";
import { PRODUCT_NAME } from "@/lib/product";
import { dashboardGreetingFor } from "@/lib/photographer-work-roles";
import { destinationPathFor } from "@/lib/workspace-routing";
import { listRecentShoots, shootHref, type RecentShoot } from "@/lib/studio/shoot-directory";
import { DashboardContext } from "./context";
import "./dashboard.css";

const MAIN = [
  { to: "/dashboard", label: "Home", icon: House, end: true },
  { to: "/studio", label: "Pick", icon: Aperture },
  { to: "/deliver", label: "Galleries", icon: Images },
  { to: "/develop", label: "Develop", icon: SlidersHorizontal },
  { to: "/dashboard", label: "Calendar", icon: CalendarDays, view: "calendar" as const },
  { to: "/earnings", label: "Analytics", icon: ChartNoAxesColumn },
  { to: "/publish", label: "Social accounts", icon: Share2 },
  { to: "/library", label: "Tools", icon: Wrench },
] as const;

type Role = "user" | "assistant";
type DashMessage = { id: string; role: Role; text: string };
type DashThread = { id: string; title: string; messages: DashMessage[]; updatedAt: number };

const RAIL_KEY = "celinen.dashboard.rail.v1";
const RAIL_WIDTH_KEY = "celinen.dashboard.rail.width.v1";
const OPEN_W = 248;
const MINI_W = 60;
const MIN_OPEN = 176;
/** Open rail stops here — labeled column, not a wide drawer. */
const MAX_OPEN = OPEN_W;
const SNAP_MINI = 132;

function readOpenWidth() {
  try {
    const n = Number(localStorage.getItem(RAIL_WIDTH_KEY));
    if (Number.isFinite(n) && n >= MIN_OPEN) return Math.round(Math.min(MAX_OPEN, n));
  } catch {
    /* ignore */
  }
  return OPEN_W;
}
function widthToMode(px: number): "open" | "mini" {
  return px < SNAP_MINI ? "mini" : "open";
}
function modeWidth(mode: "open" | "mini", openW: number) {
  return mode === "mini" ? MINI_W : openW;
}

function threadKey(scope: string) {
  return `celinen.dashboard.chat.v1:${scope}`;
}
function readThreads(scope: string): DashThread[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(threadKey(scope)) ?? "[]") as DashThread[];
    return Array.isArray(parsed) ? parsed.slice(0, 40) : [];
  } catch {
    return [];
  }
}
function writeThreads(scope: string, threads: DashThread[]) {
  localStorage.setItem(threadKey(scope), JSON.stringify(threads.slice(0, 40)));
}
function titleFrom(text: string) {
  const line = text.trim().replace(/\s+/g, " ");
  return line.slice(0, 42) || "Chat";
}
function replyFor(text: string) {
  const path = destinationPathFor(text);
  if (path === "/earnings") return { text: "Opening Analytics.", href: "/earnings" };
  if (path === "/deliver") return { text: "Opening Galleries.", href: "/deliver" };
  if (path === "/clients") return { text: "Opening clients.", href: "/clients" };
  if (path === "/adobe") return { text: "Opening Develop.", href: "/develop" };
  if (path === "/studio") return { text: "Opening Pick.", href: "/studio" };
  if (path === "/video") return { text: "Opening video.", href: "/video" };
  if (path === "/bookings") return { text: "Opening Calendar.", href: "/dashboard" };
  return { text: "Say send a gallery, check earnings, or open Pick to keep frames.", href: null };
}

function monthCells(year: number, month: number) {
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: first + days }, (_, index) =>
    index < first ? null : index - first + 1,
  );
}

export function AppDashboard({ children }: { children?: ReactNode }) {
  const account = useAccount();
  const navigate = useNavigate();
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const calendarOpen =
    new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("view") ===
    "calendar";
  const [shoots, setShoots] = useState<RecentShoot[]>([]);
  type RailMode = "open" | "mini";
  const [rail, setRailMode] = useState<RailMode>(() => {
    try {
      const stored = localStorage.getItem(RAIL_KEY);
      if (stored === "mini" || stored === "closed") return "mini";
      if (stored === "open") return "open";
    } catch {
      /* ignore */
    }
    return "open";
  });
  function setRail(next: RailMode) {
    setRailMode(next);
    try {
      localStorage.setItem(RAIL_KEY, next);
    } catch {
      /* ignore */
    }
  }
  const [openWidth, setOpenWidth] = useState(readOpenWidth);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const drag = useRef<{ startX: number; startW: number } | null>(null);
  const liveRef = useRef<number | null>(null);
  const winMove = useRef<(event: globalThis.PointerEvent) => void>(undefined);
  const winUp = useRef<(event: globalThis.PointerEvent) => void>(undefined);
  function persistOpenWidth(px: number) {
    const next = Math.max(MIN_OPEN, Math.min(MAX_OPEN, Math.round(px)));
    setOpenWidth(next);
    try {
      localStorage.setItem(RAIL_WIDTH_KEY, String(next));
    } catch {
      /* ignore */
    }
  }
  function shownWidth() {
    return liveWidth ?? modeWidth(rail, openWidth);
  }
  function detachResize() {
    if (winMove.current) window.removeEventListener("pointermove", winMove.current);
    if (winUp.current) {
      window.removeEventListener("pointerup", winUp.current);
      window.removeEventListener("pointercancel", winUp.current);
    }
    winMove.current = undefined;
    winUp.current = undefined;
  }
  function applyLive(px: number) {
    const next = Math.max(MINI_W, Math.min(MAX_OPEN, px));
    liveRef.current = next;
    setLiveWidth(next);
  }
  function onResizeDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startW = shownWidth();
    drag.current = { startX: event.clientX, startW };
    applyLive(startW);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* synthetic / no active pointer */
    }
    detachResize();
    winMove.current = (move) => {
      const start = drag.current;
      if (!start) return;
      applyLive(start.startW + move.clientX - start.startX);
    };
    winUp.current = () => onResizeUp();
    window.addEventListener("pointermove", winMove.current);
    window.addEventListener("pointerup", winUp.current);
    window.addEventListener("pointercancel", winUp.current);
  }
  function onResizeMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start) return;
    applyLive(start.startW + event.clientX - start.startX);
  }
  function onResizeUp() {
    if (!drag.current) return;
    drag.current = null;
    detachResize();
    const px = liveRef.current ?? shownWidth();
    liveRef.current = null;
    setLiveWidth(null);
    const next = widthToMode(px);
    if (next === "open") persistOpenWidth(px);
    setRail(next);
  }
  const [draft, setDraft] = useState("");
  const [threads, setThreads] = useState<DashThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => () => detachResize(), []);

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
    const rows = readThreads(scope);
    setThreads(rows);
    setActiveId(rows[0]?.id ?? null);
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

  const active = threads.find((thread) => thread.id === activeId) ?? null;

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [active?.messages.length]);

  function persist(next: DashThread[], id: string | null) {
    if (!scope) return;
    setThreads(next);
    setActiveId(id);
    writeThreads(scope, next);
  }
  function send() {
    const text = draft.trim();
    if (!text || !scope) return;
    const reply = replyFor(text);
    const user: DashMessage = { id: crypto.randomUUID(), role: "user", text };
    const assistant: DashMessage = { id: crypto.randomUUID(), role: "assistant", text: reply.text };
    const stamp = Date.now();
    let id = activeId;
    let next: DashThread[];
    if (active) {
      const updated = {
        ...active,
        title: active.messages.length ? active.title : titleFrom(text),
        messages: [...active.messages, user, assistant],
        updatedAt: stamp,
      };
      next = [updated, ...threads.filter((thread) => thread.id !== active.id)];
      id = updated.id;
    } else {
      const created: DashThread = {
        id: crypto.randomUUID(),
        title: titleFrom(text),
        messages: [user, assistant],
        updatedAt: stamp,
      };
      next = [created, ...threads];
      id = created.id;
    }
    setDraft("");
    persist(next, id);
    if (reply.href) {
      const href = reply.href;
      window.setTimeout(() => {
        if (href === "/dashboard") void navigate({ to: "/dashboard", search: { view: "calendar" } });
        else void navigate({ to: href as "/studio" });
      }, 280);
    }
  }

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

  const shown = shownWidth();
  const visual = liveWidth == null ? rail : widthToMode(liveWidth);

  return (
    <DashboardContext.Provider value={true}>
    <div
      className={`celinen-dash${visual === "mini" ? " is-mini" : ""}${liveWidth != null ? " is-resizing" : ""}`}
      style={{ ["--rail" as string]: `${shown}px` }}
      onPointerDown={onHapticPress}
    >
      <aside className="celinen-dash__rail">
        <div className="celinen-dash__top">
          {visual === "mini" ? (
            <button
              type="button"
              className="celinen-dash__brand"
              aria-label="Expand sidebar"
              onClick={() => setRail("open")}
            >
              <LogoMark size={28} />
            </button>
          ) : (
            <>
              <Link to="/dashboard" className="celinen-dash__brand">
                <LogoMark size={28} />
                <span>{PRODUCT_NAME}</span>
              </Link>
              <button
                type="button"
                className="celinen-dash__close"
                aria-label="Minimize sidebar"
                onClick={() => setRail("mini")}
              >
                <PanelLeft size={18} />
              </button>
            </>
          )}
        </div>
        <nav className="celinen-dash__nav" aria-label="Dashboard">
          {MAIN.map((item) => {
            const calendar = "view" in item;
            const on = calendar
              ? calendarOpen
              : "end" in item && item.end
                ? pathname === "/dashboard" && !calendarOpen
                : pathname === item.to || pathname.startsWith(`${item.to}/`);
            return (
              <Link
                key={item.label}
                to={item.to}
                title={item.label}
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
                <span className="celinen-dash__ico" aria-hidden="true">
                  <item.icon size={20} strokeWidth={2} />
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="celinen-dash__foot">
          <Link
            to="/pricing"
            title="Upgrade"
            className={`celinen-dash__link celinen-dash__upgrade${pathname === "/pricing" ? " is-active" : ""}`}
          >
            <span className="celinen-dash__ico" aria-hidden="true">
              <Sparkles size={20} strokeWidth={2} />
            </span>
            <span>Upgrade</span>
          </Link>
          <div className="celinen-dash__social">
            <SocialDock mini={visual === "mini"} />
          </div>
          <div className="celinen-dash__account">
            <AccountMenu />
          </div>
        </div>
      </aside>
      <div
        className="celinen-dash__resize"
        data-no-press
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={shown}
        aria-valuemin={MINI_W}
        aria-valuemax={MAX_OPEN}
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        onPointerCancel={onResizeUp}
        onLostPointerCapture={onResizeUp}
        onDoubleClick={() => setRail(visual === "mini" ? "open" : "mini")}
      />
      <main className={`celinen-dash__body${children ? " is-tool" : ""}`}>
        {loading ? (
          <div className="celinen-dash__loading">
            <span className="celinen-dash__spinner" aria-hidden="true" />
            <p>Loading your workspace…</p>
          </div>
        ) : children ? (
          children
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
          <div className="celinen-dash__chat">
            {active?.messages.length ? (
              <div className="celinen-dash__thread">
                {active.messages.map((message) => (
                  <p key={message.id} data-role={message.role}>
                    {message.text}
                  </p>
                ))}
                <div ref={end} />
              </div>
            ) : (
              <h1>{dashboardGreetingFor(account?.workRole)}</h1>
            )}
            <form
              className="celinen-dash__composer"
              onSubmit={(event) => {
                event.preventDefault();
                send();
              }}
            >
              <button
                type="button"
                className="celinen-dash__plus"
                aria-label="Open Pick"
                onClick={() => void navigate({ to: "/studio" })}
              >
                <Plus size={18} />
              </button>
              <textarea
                ref={box}
                rows={1}
                value={draft}
                placeholder="Message"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
              />
              <button
                type="submit"
                className="celinen-dash__send"
                disabled={!draft.trim()}
                aria-label="Send"
              >
                <ArrowUp size={18} />
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
    </DashboardContext.Provider>
  );
}
