import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { createPortal } from "react-dom";
import {
  FolderPlus,
  PanelLeft,
  PanelRightClose,
  PanelsTopLeft,
  MoreHorizontal,
  Users,
  Wallet,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAccount } from "@/components/account/AccountProvider";
import { AccountMenu } from "@/components/account/AccountMenu";
import { WorkspacePreferences } from "@/components/account/WorkspacePreferences";
import { useWorkspaceText } from "@/components/account/useWorkspaceText";
import { AccountSetup } from "@/components/account/AccountSetup";
import { LogoMark } from "@/components/lensos/Logo";
import { isLocalSingleUserMode } from "@/lib/app-mode";
import {
  addWorkbenchTab,
  closeWorkbenchTab,
  isWorkbenchRoute,
  safeSignInPath,
  studioBindingHref,
  studioBindingKey,
  studioWorkbenchBinding,
  workbenchTab,
  type WorkbenchTab,
  type StudioWorkbenchBinding,
} from "@/lib/workbench";
import { WorkbenchContext } from "./context";
import "./workbench.css";
import {
  explicitWorkspaceBinding,
  resolveWorkspaceBinding,
  projectScope,
  scopeToolHref,
  tabProjectScope,
  workspaceToolHref,
} from "@/lib/workbench-projects";
import { GmailConnection } from "./GmailConnection";
import { ResearchPanel } from "./ResearchPanel";
import { MailPanel } from "./MailPanel";
import { RecentShoots } from "./RecentShoots";
import { renameShoot } from "@/lib/studio/shoot-directory";
import { shootDisplayTitle } from "@/lib/workspace-labels";
import { ToolPalette } from "./ToolPalette";
import { ShootTabs } from "./ShootTabs";
import { SidebarHistoryControls } from "./SidebarHistoryControls";
import { useSidebarHistory } from "./useSidebarHistory";
import { ChatHistoryProvider, ChatRecents, NewChatButton, useChatHistory } from "./ChatHistory";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { readWorkbenchTabs, saveWorkbenchTabs } from "@/lib/workbench-tabs";
import { isSettingsPath } from "@/lib/settings-catalog";
import { matchesShortcut, DEFAULT_SHORTCUTS } from "@/lib/shortcuts";

const StudioController = lazy(() =>
  import("@/routes/studio").then((module) => ({ default: module.Studio })),
);

export function WorkbenchBoundary({ children }: { children: ReactNode }) {
  const routeIds = useRouterState({
    select: (state) => state.matches.map((match) => match.routeId),
  });
  if (!isWorkbenchRoute(routeIds)) return children;
  return <AccountWorkbench>{children}</AccountWorkbench>;
}
function AccountWorkbench({ children }: { children: ReactNode }) {
  const identity = useAccount();
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const resize = () => {
      const node = viewportRef.current;
      if (!node) return;
      if (window.innerWidth < 1024 && viewport.scale === 1)
        node.style.setProperty("--workspace-viewport-height", `${viewport.height}px`);
      else node.style.removeProperty("--workspace-viewport-height");
    };
    resize();
    viewport.addEventListener("resize", resize);
    return () => viewport.removeEventListener("resize", resize);
  }, [identity?.scope]);
  const navigate = useNavigate();
  const account = identity?.scope;
  const [sidebarOpen, setSidebarOpen] = useState(identity?.preferences.sidebarOpen ?? true);
  useEffect(() => {
    setSidebarOpen(identity?.preferences.sidebarOpen ?? true);
  }, [account, identity?.preferences.sidebarOpen]);
  const href = useRouterState({ select: (state) => state.location.href });
  useEffect(() => {
    if (
      identity?.status === "out" &&
      new URL(href, "https://workspace.invalid").pathname !== "/auth"
    )
      void navigate({ to: "/auth", search: { next: safeSignInPath(href) }, replace: true });
  }, [identity?.status, href, navigate]);
  if (!account)
    return (
      <main className="workbench-lock">
        <LogoMark size={36} />
        <p>
          {identity?.status !== "out"
            ? "Opening your workspace…"
            : identity.local
              ? "Your local workspace is closed."
              : "Sign in to open your workspace."}
        </p>
        {identity?.error && <p role="alert">{identity.error}</p>}
        {identity?.status === "out" && (
          <Link to="/auth" search={{ next: safeSignInPath(href) }}>
            Sign in →
          </Link>
        )}
      </main>
    );
  if (identity && !identity.setupComplete) return <AccountSetup key={account} />;
  return (
    <SidebarProvider
      ref={viewportRef}
      key={account}
      className={`photo-workbench ${isSettingsPath(new URL(href, "https://workspace.invalid").pathname) ? "settings-mode" : ""}`}
      open={sidebarOpen}
      onOpenChange={(sidebarOpen) => {
        setSidebarOpen(sidebarOpen);
        try {
          identity?.savePreferences({ sidebarOpen });
        } catch {
          /* Navigation remains usable when this browser refuses preference storage. */
        }
      }}
      style={{ "--sidebar-width": "var(--workspace-sidebar-width)" } as React.CSSProperties}
    >
      <GmailConnection>
        <WorkbenchFrame account={account}>{children}</WorkbenchFrame>
      </GmailConnection>
    </SidebarProvider>
  );
}
function WorkbenchFrame({ children, account }: { children: ReactNode; account: string }) {
  const sidebarHistory = useSidebarHistory();
  const t = useWorkspaceText();
  const shortcuts = useAccount()?.preferences.shortcuts ?? DEFAULT_SHORTCUTS;
  const navigate = useNavigate();
  const router = useRouter();
  const href = useRouterState({ select: (state) => state.location.href });
  const current = workbenchTab(href);
  const [tabs, setTabs] = useState<WorkbenchTab[]>(() =>
    current ? addWorkbenchTab(readWorkbenchTabs(account), current) : readWorkbenchTabs(account),
  );
  useEffect(() => {
    try {
      saveWorkbenchTabs(account, tabs);
    } catch {
      /* Tabs remain usable if the browser refuses persistence. */
    }
  }, [account, tabs]);
  const tabsRef = useRef(tabs);
  tabsRef.current = current ? addWorkbenchTab(tabs, current) : tabs;
  const [chatTarget, setChatTarget] = useState<HTMLDivElement | null>(null);
  // Keep conversation actions mounted while the responsive drawer closes.
  // Only their navigation host moves; dialogs and keyboard actions stay alive.
  const [historyHost] = useState(() =>
    typeof document === "undefined" ? null : document.createElement("div"),
  );
  const mountHistory = useCallback(
    (node: HTMLDivElement | null) => {
      if (node && historyHost) node.appendChild(historyHost);
    },
    [historyHost],
  );
  const [quickChat, setQuickChat] = useState(false);
  const [binding, setBinding] = useState<StudioWorkbenchBinding>(
    () =>
      explicitWorkspaceBinding(href, isLocalSingleUserMode) ??
      (current?.path === "/studio"
        ? studioWorkbenchBinding(href, isLocalSingleUserMode)
        : { kind: "ready", projectId: null, shootId: crypto.randomUUID() }),
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<"chat" | "tool">(current ? "tool" : "chat");
  const [compact, setCompact] = useState(false);
  const [requests, setRequests] = useState<Record<string, string>>({});
  const consumeRequest = useCallback((tabHref: string) => {
    setRequests((old) => {
      if (!(tabHref in old)) return old;
      const next = { ...old };
      delete next[tabHref];
      return next;
    });
  }, []);
  const [tabNote, setTabNote] = useState("");
  const [titles, setTitles] = useState<Record<string, string>>({});
  const setToolTitle = useCallback((tabHref: string, title: string) => {
    setTitles((old) => ({ ...old, [tabHref]: title.slice(0, 70) }));
  }, []);
  const { setOpenMobile, open: sidebarOpen, setOpen: setSidebarOpen } = useSidebar();
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches,
  );
  const sidebarTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const changed = () => {
      setNarrow(media.matches);
      if (!media.matches) setOpenMobile(false);
    };
    changed();
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, [setOpenMobile]);
  const openExact = useCallback(
    async (destination: string) => {
      const tab = workbenchTab(destination);
      const home = new URL(destination, "https://workspace.invalid");
      if (home.origin !== "https://workspace.invalid" || (home.pathname !== "/workspace" && !tab))
        return false;
      if (
        tab &&
        tabsRef.current.filter((entry) => tabProjectScope(entry.href) === tabProjectScope(tab.href))
          .length >= 32 &&
        !tabsRef.current.some((entry) => entry.href === tab.href)
      ) {
        setTabNote("This shoot has 32 open tabs. Close one before opening another.");
        return false;
      }
      setTabNote("");
      setOpenMobile(false);
      if (
        (tab?.href ?? destination) ===
        (workbenchTab(router.state.location.href)?.href ?? router.state.location.href)
      )
        setMobilePane(tab ? "tool" : "chat");
      if (
        isSettingsPath(home.pathname) &&
        !isSettingsPath(new URL(router.state.location.href, "https://workspace.invalid").pathname)
      ) {
        try {
          sessionStorage.setItem(`lenslabs.settings-return:${account}`, router.state.location.href);
        } catch {
          /* Navigation works without session storage. */
        }
      }
      await navigate({
        href: isSettingsPath(home.pathname) ? destination : (tab?.href ?? destination),
      });
      return (
        (workbenchTab(router.state.location.href)?.href ?? router.state.location.href) ===
        (tab?.href ?? destination)
      );
    },
    [navigate, router, setOpenMobile, account],
  );
  const openTool = useCallback(
    (destination: string) =>
      openExact(
        scopeToolHref(destination === "/deliver" ? "/deliver?workflow=1" : destination, binding),
      ),
    [openExact, binding],
  );
  const newShoot = useCallback(async () => {
    const id = crypto.randomUUID();
    if (!(await openExact(`/workspace?shoot=${id}`))) return false;
    try {
      await renameShoot(account, id, "Untitled project");
    } catch {
      setTabNote(
        "The new project could not be added to Recents. Keep this tab open and try naming it again.",
      );
    }
    return true;
  }, [openExact, account]);
  useEffect(() => {
    if (
      new URL(href, "https://workspace.invalid").pathname === "/workspace" &&
      !explicitWorkspaceBinding(href, isLocalSingleUserMode) &&
      binding.kind === "ready" &&
      binding.shootId
    )
      void navigate({ href: `/workspace?shoot=${binding.shootId}`, replace: true });
  }, [href, binding, navigate]);
  const openWorkspaceRequest = useCallback(
    async (request: { path: "/research" | "/mail"; query: string }) => {
      const destination = scopeToolHref(
        workspaceToolHref(request.path, request.query, { tab: crypto.randomUUID() }),
        binding,
      );
      const opened = await openExact(destination);
      if (opened)
        setRequests((old) => ({ ...old, [workbenchTab(destination)!.href]: request.query }));
      return opened;
    },
    [binding, openExact],
  );
  const showStudio = useCallback(() => openTool(studioBindingHref(binding)), [openTool, binding]);
  useEffect(() => {
    const tab = workbenchTab(href);
    setMobilePane(tab ? "tool" : "chat");
    if (tab) setTabs((old) => addWorkbenchTab(old, tab));
    if (explicitWorkspaceBinding(href, isLocalSingleUserMode))
      setBinding((old) => {
        const next = resolveWorkspaceBinding(href, old, isLocalSingleUserMode);
        return JSON.stringify(old) === JSON.stringify(next) ? old : next;
      });
  }, [href]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 850px)");
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (matchesShortcut(event, shortcuts.tools)) {
        event.preventDefault();
        setSearchOpen((old) => !old);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [shortcuts.tools]);
  // Bind during render on Studio navigation; no intermediate frame may edit the previous shoot.
  const activeBinding = resolveWorkspaceBinding(href, binding, isLocalSingleUserMode);
  const activeTool = !compact || mobilePane === "tool" ? (current?.path ?? null) : null;
  const studioVisible = activeTool === "/studio";
  const openQuickChat = useCallback(async () => {
    if (!current || current.path === "/settings") {
      if (!(await openTool("/studio"))) return;
    }
    setQuickChat(true);
    requestAnimationFrame(() =>
      chatTarget?.querySelector<HTMLTextAreaElement>("textarea")?.focus(),
    );
  }, [current, openTool, chatTarget]);
  const closeQuickChat = useCallback(() => setQuickChat(false), []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !(event.target as HTMLElement)?.closest("[role=dialog],[role=menu]")
      )
        setQuickChat(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  const context = useMemo(
    () => ({
      chatTarget,
      studioVisible,
      activeTool,
      openTool,
      showStudio,
      storageScope: account,
      workspaceProjectId: activeBinding.kind === "ready" ? activeBinding.projectId : null,
      newShoot,
      openQuickChat,
      closeQuickChat,
      openWorkspaceRequest,
      setToolTitle,
    }),
    [
      chatTarget,
      studioVisible,
      activeTool,
      openTool,
      showStudio,
      account,
      activeBinding,
      newShoot,
      openQuickChat,
      closeQuickChat,
      openWorkspaceRequest,
      setToolTitle,
    ],
  );
  const openedTabs = current ? addWorkbenchTab(tabs, current) : tabs;
  const projectTabs = openedTabs.filter(
    (tab) => tabProjectScope(tab.href) === projectScope(activeBinding),
  );
  const connectionTabs = projectTabs.filter(
    (tab) => tab.path === "/research" || tab.path === "/mail",
  );
  const newTool = (path: string) => {
    void openTool(
      path === "/research" || path === "/mail"
        ? workspaceToolHref(path, "", { tab: crypto.randomUUID() })
        : path,
    );
  };
  const showTool = !!current;
  const closeTab = async (tab: WorkbenchTab) => {
    const closed = closeWorkbenchTab(projectTabs, tab.href, current?.href ?? "/workspace");
    const forget = () => {
      setTabs((old) => old.filter((entry) => entry.href !== tab.href));
      setRequests((old) => {
        const next = { ...old };
        delete next[tab.href];
        return next;
      });
      setTitles((old) => {
        const next = { ...old };
        delete next[tab.href];
        return next;
      });
    };
    if (closed.next === (current?.href ?? "/workspace")) {
      forget();
      return true;
    }
    await navigate({
      href: closed.next === "/workspace" ? scopeToolHref(closed.next, activeBinding) : closed.next,
    });
    if ((workbenchTab(router.state.location.href)?.href ?? router.state.location.href) === tab.href)
      return false;
    forget();
    return true;
  };
  return (
    <ChatHistoryProvider scope={account} project={projectScope(activeBinding)}>
      <WorkbenchContext.Provider value={context}>
        <WorkspacePreferences />
        <WorkspaceSidebar narrow={narrow} trigger={sidebarTriggerRef}>
          <SidebarHeader className="workbench-sidebar-top">
            <div className="workbench-sidebar-toolbar">
              <button
                className="workbench-sidebar-toggle"
                aria-label={narrow ? "Close sidebar" : "Collapse sidebar"}
                onClick={() => (narrow ? setOpenMobile(false) : setSidebarOpen(false))}
              >
                <PanelLeft size={20} />
              </button>
              <SidebarHistoryControls navigation={sidebarHistory} />
            </div>
            <div className="workbench-brand-row">
              <a
                href={scopeToolHref("/workspace", binding)}
                onClick={(event) => {
                  if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                    event.preventDefault();
                    void openTool("/workspace");
                  }
                }}
                className="workbench-brand"
              >
                <LogoMark size={22} />
                Lens Lab
              </a>
              <button
                className="workbench-tools-button"
                aria-label="All tools"
                title="All tools (⌘K)"
                onClick={() => setSearchOpen(true)}
              >
                <PanelsTopLeft size={19} />
              </button>
            </div>
          </SidebarHeader>
          <SidebarContent className="workbench-sidebar-content">
            <NewChatButton />
            <button className="workbench-nav-item" onClick={() => void newShoot()}>
              <FolderPlus size={20} />
              {t("New project")}
            </button>
            <nav className="workbench-business-nav" aria-label="Business tools">
              {[
                { path: "/clients", label: "Client database", Icon: Users },
                { path: "/earnings", label: "Earnings", Icon: Wallet },
              ].map(({ path, label, Icon }) => (
                <a
                  key={path}
                  className={`workbench-nav-item ${current?.path === path ? "is-active" : ""}`}
                  href={scopeToolHref(path, activeBinding)}
                  aria-current={current?.path === path ? "page" : undefined}
                  onClick={(event) => {
                    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                      event.preventDefault();
                      void openTool(path);
                    }
                  }}
                >
                  <Icon size={20} />
                  <span>{t(label)}</span>
                </a>
              ))}
            </nav>
            <RecentShoots
              scope={account}
              activeId={
                activeBinding.kind === "ready" && !activeBinding.projectId
                  ? (activeBinding.shootId ?? "legacy")
                  : null
              }
              open={openExact}
            >
              <div ref={mountHistory} />
            </RecentShoots>
          </SidebarContent>
          <SidebarFooter className="workbench-sidebar-bottom">
            <AccountMenu />
          </SidebarFooter>
        </WorkspaceSidebar>
        {historyHost &&
          createPortal(<ChatRecents menuSide={narrow ? "bottom" : "right"} />, historyHost)}
        <div className="workbench-body">
          <header className="workbench-header">
            {(narrow || !sidebarOpen) && (
              <button
                ref={sidebarTriggerRef}
                className="workbench-sidebar-toggle"
                aria-label="Open sidebar"
                onClick={() => (narrow ? setOpenMobile(true) : setSidebarOpen(true))}
              >
                <PanelLeft size={20} />
              </button>
            )}
            {projectTabs.length === 0 && !showTool && <ConversationHeading />}
            {(projectTabs.length > 0 || showTool) && (
              <ShootTabs
                tabs={projectTabs}
                currentHref={current?.href ?? null}
                chatHref={scopeToolHref("/workspace", activeBinding)}
                titles={titles}
                onOpen={openExact}
                onClose={closeTab}
                onNew={() => setSearchOpen(true)}
              />
            )}
            {tabNote && <span role="status">{tabNote}</span>}
            <div className="workbench-header-actions">
              {showTool && (
                <>
                  {compact ? (
                    <button
                      className="workbench-pane-toggle"
                      onClick={() => setMobilePane((pane) => (pane === "chat" ? "tool" : "chat"))}
                    >
                      {mobilePane === "tool" ? "Back to chat" : `Open ${current.label}`}
                    </button>
                  ) : (
                    <button
                      aria-label="Hide tool pane"
                      title="Hide tool pane"
                      onClick={() => openTool("/workspace")}
                    >
                      <PanelRightClose size={18} />
                    </button>
                  )}
                </>
              )}
            </div>
          </header>
          <div
            className={`workbench-panels ${showTool ? "has-tool" : ""} ${current?.path === "/settings" && (!compact || mobilePane === "tool") ? "is-settings" : ""}`}
            data-mobile-pane={showTool ? mobilePane : "chat"}
          >
            <main
              className={`workbench-conversation ${quickChat ? "is-quick-chat" : ""}`}
              hidden={
                !quickChat &&
                showTool &&
                ((compact && mobilePane === "tool") ||
                  (!compact && ["/clients", "/earnings"].includes(current?.path ?? "")))
              }
              aria-label="Photography chat"
            >
              {quickChat && (
                <div className="ll-quick-header">
                  <span>Quick Chat · current shoot</span>
                  <div>
                    <button
                      onClick={() => {
                        setQuickChat(false);
                        void openTool("/workspace");
                      }}
                    >
                      Expand
                    </button>
                    <button aria-label="Close Quick Chat" onClick={() => setQuickChat(false)}>
                      Close
                    </button>
                  </div>
                </div>
              )}
              <div ref={setChatTarget} className="workbench-chat-mount" />
              {activeBinding.kind === "blocked" && <p role="alert">{activeBinding.reason}</p>}
            </main>
            <section
              className="workbench-tool-pane"
              hidden={!showTool || (compact && mobilePane === "chat")}
              aria-label="Open tools"
            >
              <div className="workbench-tool-scroll">
                <div
                  data-workbench-tool="studio"
                  hidden={!studioVisible}
                  tabIndex={-1}
                  onPointerDown={(event) => {
                    if (
                      !(event.target as HTMLElement).closest(
                        "button,input,textarea,select,a,[role=dialog]",
                      )
                    )
                      event.currentTarget.focus({ preventScroll: true });
                  }}
                >
                  {activeBinding.kind === "blocked" ? (
                    <p role="alert" className="workbench-loading">
                      {activeBinding.reason}
                    </p>
                  ) : (
                    chatTarget && (
                      <Suspense fallback={<p className="workbench-loading">Opening Studio…</p>}>
                        <StudioController
                          key={studioBindingKey(activeBinding)}
                          {...activeBinding}
                          storageScope={account}
                        />
                      </Suspense>
                    )
                  )}
                </div>
                {connectionTabs.map((tab) => (
                  <div
                    key={tab.href}
                    data-workbench-tool="connection"
                    hidden={current?.href !== tab.href}
                  >
                    {tab.path === "/research" ? (
                      <ResearchPanel
                        href={tab.href}
                        requested={requests[tab.href]}
                        onRequestConsumed={consumeRequest}
                      />
                    ) : (
                      <MailPanel
                        href={tab.href}
                        requested={requests[tab.href]}
                        onRequestConsumed={consumeRequest}
                      />
                    )}
                  </div>
                ))}
                <div
                  data-workbench-tool="route"
                  hidden={
                    current?.path === "/studio" ||
                    current?.path === "/research" ||
                    current?.path === "/mail"
                  }
                  tabIndex={-1}
                  onPointerDown={(event) => {
                    if (
                      !(event.target as HTMLElement).closest(
                        "button,input,textarea,select,a,[role=dialog]",
                      )
                    )
                      event.currentTarget.focus({ preventScroll: true });
                  }}
                >
                  {children}
                </div>
              </div>
            </section>
          </div>
        </div>
        <ToolPalette
          open={searchOpen}
          onOpenChange={setSearchOpen}
          onSelect={(path) => {
            if (path === "/studio") void showStudio();
            else newTool(path);
          }}
        />
      </WorkbenchContext.Provider>
    </ChatHistoryProvider>
  );
}

/** The drawer is composed here so other uses of the shared Sidebar retain their breakpoint. */
function WorkspaceSidebar({
  narrow,
  trigger,
  children,
}: {
  narrow: boolean;
  trigger: React.RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}) {
  const { openMobile, setOpenMobile } = useSidebar();
  useEffect(() => {
    if (!narrow) return;
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setOpenMobile(!openMobile);
      }
    };
    window.addEventListener("keydown", shortcut, true);
    return () => window.removeEventListener("keydown", shortcut, true);
  }, [narrow, openMobile, setOpenMobile]);
  if (!narrow) return <Sidebar className="workbench-sidebar">{children}</Sidebar>;
  return (
    <Sheet open={openMobile} onOpenChange={setOpenMobile}>
      <SheetContent
        side="left"
        className="workbench-mobile-sidebar"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          trigger.current?.focus();
        }}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>LensLabs navigation</SheetTitle>
          <SheetDescription>Projects, shoots and business tools.</SheetDescription>
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  );
}

function ConversationHeading() {
  const history = useChatHistory();
  const active = history?.active;
  if (!active || (!active.named && !active.messages.length)) return null;
  const disabled =
    !history.ready || history.locked || history.pending || history.switching || !!history.error;
  return (
    <>
      <span className="workbench-conversation-title" title={shootDisplayTitle(active)}>
        {shootDisplayTitle(active)}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="workbench-sidebar-toggle"
            aria-label="Conversation actions"
            disabled={disabled}
          >
            <MoreHorizontal size={20} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="ll-chat-menu" align="end">
          {active.messages.some((message) => !message.privateConnector) && (
            <DropdownMenuItem
              onSelect={() =>
                window.dispatchEvent(
                  new CustomEvent("lenslabs:chat-dialog", { detail: { action: "share" } }),
                )
              }
            >
              Share with client…
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() =>
              window.dispatchEvent(
                new CustomEvent("lenslabs:chat-dialog", { detail: { action: "rename" } }),
              )
            }
          >
            Rename
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
