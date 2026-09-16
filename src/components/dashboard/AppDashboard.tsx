import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import {
  ArrowUp,
  CalendarDays,
  ChartNoAxesColumn,
  House,
  Images,
  Moon,
  PanelLeft,
  Plus,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Wrench,
} from "lucide-react";
import { useAccount } from "@/components/account/AccountProvider";
import { useIsMobile } from "@/hooks/use-mobile";
import { AccountMenu } from "@/components/account/AccountMenu";
import { SocialDock } from "./SocialDock";
import { LogoMark } from "@/components/lensos/Logo";
import { onHapticPress } from "@/lib/haptic-press";
import { PRODUCT_NAME } from "@/lib/product";
import { dashboardGreetingFor } from "@/lib/photographer-work-roles";
import { destinationPathFor } from "@/lib/workspace-routing";
import { buildSocialPost, isPostIntent, writeSocialDraft } from "@/lib/social-post";
import { DashboardContext } from "./context";
import { IosCalendar } from "./IosCalendar";
import { VoiceMic } from "./VoiceMic";
import { requestDashboardReply } from "@/lib/dashboard-assistant";
import { isPhotographyConversation } from "@/lib/photography-assistant";
import { collectDroppedFiles } from "@/lib/studio/drop-import";
import { queueStudioImport } from "@/lib/studio/pending-import";
import "./dashboard.css";
import "./social-accounts.css";

const MAIN = [
  { to: "/dashboard", label: "Home", icon: House, end: true },
  { to: "/deliver", label: "Gallery", icon: Images },
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
  if (isPhotographyConversation(text)) return null;
  if (
    !isPostIntent(text) &&
    !/^(?:open|show|go to|switch to|check)\s+(?:(?:my|the)\s+)?(?:pick|keepers|studio|develop|lightroom|calendar|bookings|earnings|analytics|clients|galleries|gallery|social accounts|video)[.!]?$/i.test(
      text.trim(),
    ) &&
    !/^(?:send|share)\s+(?:(?:a|the|my)\s+)?gallery[.!]?$/i.test(text.trim()) &&
    !/^(?:cull|pick|edit|develop)(?:\s+(?:this|my|the)\s+shoot)?[.!]?$/i.test(text.trim())
  )
    return null;
  if (/\bcalendar\b/i.test(text)) return { text: "Opening Calendar.", href: "/dashboard" };
  if (/\bdevelop\b/i.test(text)) return { text: "Opening Develop.", href: "/develop" };
  if (/\banalytics\b/i.test(text)) return { text: "Opening Analytics.", href: "/earnings" };
  if (isPostIntent(text)) {
    writeSocialDraft(buildSocialPost({ idea: text }));
    return {
      text: "Drafted the caption. Review it on Social, then post from a connected account.",
      href: "/publish",
    };
  }
  const path = destinationPathFor(text);
  if (path === "/publish") {
    writeSocialDraft(buildSocialPost({ idea: text }));
    return { text: "Opening Social accounts with that idea.", href: "/publish" };
  }
  if (path === "/earnings") return { text: "Opening Analytics.", href: "/earnings" };
  if (path === "/deliver") return { text: "Opening Galleries.", href: "/deliver" };
  if (path === "/clients") return { text: "Opening clients.", href: "/clients" };
  if (path === "/adobe") return { text: "Opening Develop.", href: "/develop" };
  if (path === "/studio") return { text: "Opening Pick in chat.", href: "/studio" };
  if (path === "/video") return { text: "Opening video.", href: "/video" };
  if (path === "/bookings") return { text: "Opening Calendar.", href: "/dashboard" };
  return { text: "Say send a gallery, check earnings, or open Pick to keep frames.", href: null };
}

export function AppDashboard({ children }: { children?: ReactNode }) {
  const account = useAccount();
  const mobile = useIsMobile();
  const mobileRef = useRef(mobile);
  mobileRef.current = mobile;
  const navigate = useNavigate();
  const router = useRouter();
  useEffect(() => {
    void router.preloadRoute({ to: "/studio" });
    void router.preloadRoute({ to: "/publish" });
    void router.preloadRoute({ to: "/develop" });
  }, [router]);
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const calendarOpen =
    new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("view") ===
    "calendar";
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
    // A desktop drag that crosses the mobile breakpoint is not a preference change.
    if (mobileRef.current) return;
    const next = widthToMode(px);
    if (next === "open") persistOpenWidth(px);
    setRail(next);
  }
  const [draft, setDraft] = useState("");
  const [threads, setThreads] = useState<DashThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [replying, setReplying] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const pendingReply = useRef<AbortController | null>(null);
  const currentScope = useRef(account?.scope);
  currentScope.current = account?.scope;
  const box = useRef<HTMLTextAreaElement>(null);
  const photos = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const wasTool = useRef(false);

  useEffect(() => () => detachResize(), []);

  useEffect(() => {
    if (!mobile) return;
    drag.current = null;
    detachResize();
    liveRef.current = null;
    setLiveWidth(null);
  }, [mobile]);

  useEffect(() => {
    if (account?.status === "out")
      void navigate({
        to: "/auth",
        search: { next: "/dashboard", mode: "signin" },
        replace: true,
      });
  }, [account?.status, navigate]);

  const loading = !account || account.status === "loading" || account.status === "out";
  const scope = account?.scope;

  function ingestPhotos(files: File[]) {
    if (!files.length) return;
    queueStudioImport(files);
    void navigate({ to: "/studio" });
  }

  useEffect(() => {
    if (!scope) return;
    const rows = readThreads(scope);
    setThreads(rows);
    // Home lands on the Ocoya generate pane, not the last ChatGPT-style thread.
    setActiveId(null);
  }, [scope]);

  const active = threads.find((thread) => thread.id === activeId) ?? null;
  const onChat = !children && !calendarOpen;
  useEffect(() => {
    pendingReply.current?.abort();
    pendingReply.current = null;
    setReplying(false);
    setChatError(null);
    return () => {
      pendingReply.current?.abort();
    };
  }, [scope, onChat]);

  useEffect(() => {
    if (wasTool.current && onChat) setActiveId(null);
    wasTool.current = !onChat;
  }, [onChat]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [active?.messages.length]);

  function persist(next: DashThread[], id: string | null) {
    if (!scope) return;
    setThreads(next);
    setActiveId(id);
    writeThreads(scope, next);
  }
  async function send(fromVoice?: string) {
    const text = (fromVoice ?? draft).trim();
    if (!text || !scope || pendingReply.current) return;
    setChatError(null);
    const reply = replyFor(text);
    const user: DashMessage = { id: crypto.randomUUID(), role: "user", text };
    const assistant: DashMessage[] = reply
      ? [{ id: crypto.randomUUID(), role: "assistant", text: reply.text }]
      : [];
    const stamp = Date.now();
    let id = activeId;
    let next: DashThread[];
    if (active) {
      const updated = {
        ...active,
        title: active.messages.length ? active.title : titleFrom(text),
        messages: [...active.messages, user, ...assistant],
        updatedAt: stamp,
      };
      next = [updated, ...threads.filter((thread) => thread.id !== active.id)];
      id = updated.id;
    } else {
      const created: DashThread = {
        id: crypto.randomUUID(),
        title: titleFrom(text),
        messages: [user, ...assistant],
        updatedAt: stamp,
      };
      next = [created, ...threads];
      id = created.id;
    }
    setDraft("");
    if (box.current) {
      box.current.style.height = "";
    }
    try {
      persist(next, id);
    } catch {
      setChatError(
        "This chat could not be saved on this device. Your message is still visible; keep this tab open.",
      );
      return;
    }
    if (!reply) {
      const controller = new AbortController();
      pendingReply.current = controller;
      setReplying(true);
      const thread = next.find((item) => item.id === id)!;
      try {
        const text = await requestDashboardReply({
          scope,
          messages: thread.messages,
          enabled: account?.preferences.cloudAssistant === true,
          signal: controller.signal,
          workRole: account?.workRole ?? "sports",
        });
        if (controller.signal.aborted || currentScope.current !== scope) return;
        persist(
          next.map((item) =>
            item.id === id
              ? {
                  ...item,
                  messages: [
                    ...item.messages,
                    { id: crypto.randomUUID(), role: "assistant", text },
                  ],
                  updatedAt: Date.now(),
                }
              : item,
          ),
          id,
        );
      } catch (error) {
        if (!controller.signal.aborted && currentScope.current === scope)
          setChatError(
            error instanceof Error
              ? error.message
              : "The assistant could not reply. Please try again.",
          );
      } finally {
        if (pendingReply.current === controller) {
          pendingReply.current = null;
          setReplying(false);
        }
      }
      return;
    }
    if (reply.href) {
      const href = reply.href;
      window.setTimeout(() => {
        if (href === "/dashboard")
          void navigate({ to: "/dashboard", search: { view: "calendar" } });
        else if (href === "/publish") void navigate({ to: "/publish" });
        else void navigate({ to: href as "/studio" });
      }, 280);
    }
  }

  // Narrow-screen presentation is temporary; retain the user's desktop rail settings.
  const shown = mobile ? MINI_W : shownWidth();
  const visual = mobile ? "mini" : liveWidth == null ? rail : widthToMode(liveWidth);

  return (
    <DashboardContext.Provider value={true}>
      <div
        className={`celinen-dash${visual === "mini" ? " is-mini" : ""}${liveWidth != null ? " is-resizing" : ""}`}
        style={{ ["--rail" as string]: `${shown}px` }}
        onPointerDown={onHapticPress}
      >
        <aside className="celinen-dash__rail">
          <div className="celinen-dash__top">
            {mobile ? (
              <Link to="/dashboard" className="celinen-dash__brand" aria-label="Home">
                <LogoMark size={28} />
              </Link>
            ) : visual === "mini" ? (
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
                  <PanelLeft size={18} strokeWidth={1.5} />
                </button>
              </>
            )}
          </div>
          <nav className="celinen-dash__nav" aria-label="Dashboard">
            {MAIN.map((item) => {
              const calendar = "view" in item;
              const label =
                item.to === "/deliver"
                  ? Number(localStorage.getItem("celinen.gallery.count.v1") || "0") > 1
                    ? "Galleries"
                    : "Gallery"
                  : item.label;
              const on = calendar
                ? calendarOpen
                : "end" in item && item.end
                  ? pathname === "/dashboard" && !calendarOpen
                  : pathname === item.to || pathname.startsWith(`${item.to}/`);
              return (
                <Link
                  key={"view" in item ? `${item.to}:${item.view}` : item.to}
                  to={item.to}
                  title={label}
                  aria-label={label}
                  search={
                    calendar ? { view: "calendar" } : "end" in item && item.end ? {} : undefined
                  }
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
                    <item.icon size={20} strokeWidth={1.5} />
                  </span>
                  <span>{label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="celinen-dash__foot">
            <Link
              to="/pricing"
              title="Upgrade"
              aria-label="Upgrade"
              className={`celinen-dash__link celinen-dash__upgrade${pathname === "/pricing" ? " is-active" : ""}`}
            >
              <span className="celinen-dash__ico" aria-hidden="true">
                <Sparkles size={20} strokeWidth={1.5} />
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
        {!mobile && (
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
        )}
        <main
          className={`celinen-dash__body${children ? " is-tool" : calendarOpen ? " is-cal" : " is-chat"}`}
        >
          {account && account.status === "in" ? (
            <div className="celinen-dash__theme" role="group" aria-label="Appearance">
              <button
                type="button"
                aria-label="Light"
                aria-pressed={account.preferences.theme === "light"}
                onClick={() => account.savePreferences({ theme: "light" })}
              >
                <Sun size={14} strokeWidth={1.5} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Dark"
                aria-pressed={account.preferences.theme === "dark"}
                onClick={() => account.savePreferences({ theme: "dark" })}
              >
                <Moon size={14} strokeWidth={1.5} aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {loading ? (
            <div className="celinen-dash__loading">
              <span className="celinen-dash__spinner" aria-hidden="true" />
              <p>Loading your workspace…</p>
            </div>
          ) : children ? (
            children
          ) : calendarOpen ? (
            <IosCalendar />
          ) : (
            <div
              className={`social-post${active?.messages.length ? " has-thread" : ""}`}
              onPointerDown={onHapticPress}
              onDragOver={(event) => {
                if (!Array.from(event.dataTransfer.types).includes("Files")) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }}
              onDrop={(event) => {
                event.preventDefault();
                void collectDroppedFiles(event.dataTransfer).then((result) =>
                  ingestPhotos(result.files),
                );
              }}
            >
              <input
                id="celinen-home-photos"
                ref={photos}
                type="file"
                multiple
                tabIndex={-1}
                accept="image/*,.nef,.cr2,.cr3,.arw,.dng,.raf,.orf,.rw2,.pef,.srw,.xmp"
                className="absolute h-px w-px overflow-hidden opacity-0"
                onChange={(event) => {
                  ingestPhotos(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
              <div className="social-post__stage">
                {active?.messages.length ? (
                  <div className="celinen-dash__thread" aria-label="Conversation">
                    {active.messages.map((message) => (
                      <p key={message.id} data-role={message.role}>
                        {message.text}
                      </p>
                    ))}
                    <div ref={end} />
                  </div>
                ) : (
                  <div className="social-post__hero">
                    <h1>{dashboardGreetingFor(account?.workRole)}</h1>
                  </div>
                )}
                <form
                  className="social-post__composer celinen-dash__composer"
                  onSubmit={(event) => {
                    event.preventDefault();
                    send();
                  }}
                >
                  <label
                    htmlFor="celinen-home-photos"
                    className="celinen-dash__plus"
                    aria-label="Add photos"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Plus size={20} strokeWidth={1.8} />
                  </label>
                  <textarea
                    ref={box}
                    rows={1}
                    value={draft}
                    placeholder="drop your game here"
                    onChange={(event) => {
                      setDraft(event.target.value);
                      const el = event.currentTarget;
                      el.style.height = "auto";
                      el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        send();
                      }
                    }}
                  />
                  <VoiceMic
                    value={draft}
                    onChange={(next) => {
                      setDraft(next);
                      const el = box.current;
                      if (!el) return;
                      el.style.height = "auto";
                      el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
                    }}
                    onSend={(text) => send(text)}
                    inputRef={box}
                  />
                  <button
                    type="submit"
                    className="social-post__send"
                    disabled={!draft.trim() || replying}
                    aria-label="Send"
                  >
                    <ArrowUp size={18} />
                  </button>
                </form>
                {replying && <p role="status">Thinking…</p>}
                {chatError && <p role="alert">{chatError}</p>}
              </div>
            </div>
          )}
        </main>
      </div>
    </DashboardContext.Provider>
  );
}
