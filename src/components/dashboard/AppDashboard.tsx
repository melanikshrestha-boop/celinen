import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowUp,
  AtSign,
  BarChart3,
  Calendar,
  LogOut,
  Plus,
  Scissors,
  Search,
  Settings,
  SquarePen,
  Workflow,
  Wrench,
} from "lucide-react";
import { useAccount } from "@/components/account/AccountProvider";
import { PRODUCT_NAME } from "@/lib/product";
import { listRecentShoots, shootHref, type RecentShoot } from "@/lib/studio/shoot-directory";
import {
  dashboardGreetingFor,
  workDestinationsFor,
} from "@/lib/photographer-work-roles";
import { destinationPathFor } from "@/lib/workspace-routing";
import "./dashboard.css";

type Role = "user" | "assistant";
type DashMessage = { id: string; role: Role; text: string };
type DashThread = { id: string; title: string; messages: DashMessage[]; updatedAt: number };

const WORK = [
  { to: "/shoots" as const, label: "Clipping", icon: Scissors },
  { to: "/tonight" as const, label: "Automations", icon: Workflow },
  { to: "/earnings" as const, label: "Analytics", icon: BarChart3 },
  { to: "/publish" as const, label: "Social Accounts", icon: AtSign },
  { to: "/library" as const, label: "Tools", icon: Wrench },
  { to: "/bookings" as const, label: "Bookings", icon: Calendar },
];

function monthCells(year: number, month: number) {
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: first + days }, (_, index) =>
    index < first ? null : index - first + 1,
  );
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
  return line.slice(0, 42) || "New chat";
}
function replyFor(text: string) {
  const path = destinationPathFor(text);
  if (path === "/earnings") return { text: "Opening Analytics.", href: "/earnings" };
  if (path === "/deliver") return { text: "Opening delivery.", href: "/deliver" };
  if (path === "/clients") return { text: "Opening clients.", href: "/clients" };
  if (path === "/adobe") return { text: "Opening Adobe.", href: "/adobe" };
  if (path === "/video") return { text: "Opening video.", href: "/video" };
  if (path === "/bookings") return { text: "Opening bookings.", href: "/bookings" };
  return { text: "Say send a gallery, check earnings, or open Clipping to pick keepers.", href: null };
}

export function AppDashboard() {
  const account = useAccount();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"chat" | "work">("chat");
  const [draft, setDraft] = useState("");
  const [threads, setThreads] = useState<DashThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [shoots, setShoots] = useState<RecentShoot[]>([]);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [calendar, setCalendar] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);

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
    const rows = readThreads(scope);
    setThreads(rows);
    setActiveId(rows[0]?.id ?? null);
    void listRecentShoots(scope)
      .then(setShoots)
      .catch(() => setShoots([]));
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
  const active = threads.find((thread) => thread.id === activeId) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((thread) => thread.title.toLowerCase().includes(q));
  }, [threads, query]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [active?.messages.length]);

  function persist(next: DashThread[], id: string | null) {
    if (!scope) return;
    setThreads(next);
    setActiveId(id);
    writeThreads(scope, next);
  }
  function newChat() {
    setDraft("");
    setMode("chat");
    persist(threads, null);
    box.current?.focus();
  }
  function send() {
    const text = draft.trim();
    if (!text || !scope) return;
    const reply = replyFor(text);
    const user: DashMessage = { id: crypto.randomUUID(), role: "user", text };
    const assistant: DashMessage = { id: crypto.randomUUID(), role: "assistant", text: reply.text };
    const now = Date.now();
    let id = activeId;
    let next: DashThread[];
    if (active) {
      const updated = {
        ...active,
        title: active.messages.length ? active.title : titleFrom(text),
        messages: [...active.messages, user, assistant],
        updatedAt: now,
      };
      next = [updated, ...threads.filter((thread) => thread.id !== active.id)];
      id = updated.id;
    } else {
      const created: DashThread = {
        id: crypto.randomUUID(),
        title: titleFrom(text),
        messages: [user, assistant],
        updatedAt: now,
      };
      next = [created, ...threads];
      id = created.id;
    }
    setDraft("");
    persist(next, id);
    if (reply.href) window.setTimeout(() => void navigate({ to: reply.href! }), 280);
  }

  return (
    <div className="celinen-dash">
      <aside className="celinen-dash__rail">
        <div className="celinen-dash__top">
          <Link to="/dashboard" className="celinen-dash__brand">
            {PRODUCT_NAME}
          </Link>
          <button
            type="button"
            className="celinen-dash__icon"
            aria-label="Search chats"
            onClick={() => setSearchOpen((open) => !open)}
          >
            <Search size={18} />
          </button>
        </div>
        {searchOpen && (
          <input
            className="celinen-dash__find"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            autoFocus
          />
        )}
        <button type="button" className="celinen-dash__new" onClick={newChat}>
          <SquarePen size={18} />
          New chat
        </button>
        <div className="celinen-dash__recents">
          {filtered.length > 0 && <p>Recents</p>}
          {filtered.map((thread) => (
            <button
              key={thread.id}
              type="button"
              className={thread.id === activeId ? "is-active" : undefined}
              onClick={() => {
                setActiveId(thread.id);
                setMode("chat");
              }}
            >
              {thread.title}
            </button>
          ))}
          {shoots.length > 0 && <p>Shoots</p>}
          {shoots.slice(0, 12).map((shoot) => (
            <a key={shoot.id} href={shootHref(shoot.id)}>
              {shoot.title}
            </a>
          ))}
        </div>
        <div className="celinen-dash__foot">
          <Link to="/settings">
            <Settings size={16} />
            Settings
          </Link>
          {account?.status === "in" && (
            <button
              type="button"
              onClick={() =>
                void account.signOut().then((ok) => {
                  if (ok)
                    void navigate({
                      to: "/auth",
                      search: { next: "/dashboard", mode: "signin", google: true },
                    });
                })
              }
            >
              <LogOut size={16} />
              Log out
            </button>
          )}
        </div>
      </aside>
      <section className="celinen-dash__stage">
        <div className="celinen-dash__modes" role="tablist" aria-label="Dashboard mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "chat"}
            className={mode === "chat" ? "is-on" : undefined}
            onClick={() => {
              setMode("chat");
              setCalendar(false);
            }}
          >
            Chat
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "work"}
            className={mode === "work" ? "is-on" : undefined}
            onClick={() => {
              setMode("work");
              setCalendar(false);
            }}
          >
            Work
          </button>
        </div>
        {loading ? (
          <div className="celinen-dash__loading">
            <span className="celinen-dash__spinner" aria-hidden="true" />
            <p>Loading your workspace…</p>
          </div>
        ) : mode === "work" ? (
          calendar ? (
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
            <div className="celinen-dash__work">
              {workDestinationsFor(account?.workRole, WORK).map((item) => (
                <Link key={item.label} to={item.to}>
                  <item.icon size={18} />
                  {item.label}
                </Link>
              ))}
              <button type="button" onClick={() => setCalendar(true)}>
                <Calendar size={18} />
                Calendar
              </button>
            </div>
          )
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
                aria-label="New shoot"
                onClick={() => void navigate({ to: "/shoots" })}
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
      </section>
    </div>
  );
}
