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
import {
  PanelLeft,
  PanelRightClose,
  PanelsTopLeft,
  MoreHorizontal,
  Search,
  Settings,
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
import { AccountSetup } from "@/components/account/AccountSetup";
import { LogoMark } from "@/components/lensos/Logo";
import { isLocalSingleUserMode } from "@/lib/app-mode";
import { PRODUCT_NAME } from "@/lib/product";
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
import { cancelDevelopImportsOutsideScope } from "@/lib/develop/import-session";
import { DeliveryVersionBoundary } from "@/components/develop/DeliveryVersionBoundary";
import "./workbench.css";
import {
  deliveryBoundaryBinding,
  explicitWorkspaceBinding,
  resolveWorkspaceBinding,
  projectScope,
  scopeToolHref,
  tabProjectScope,
  workspaceToolHref,
  shootRoute,
  shootKeyForBinding,
} from "@/lib/workbench-projects";
import { GmailConnection } from "./GmailConnection";
import { ResearchPanel } from "./ResearchPanel";
import { MailPanel } from "./MailPanel";
import { nextShootLabel, renameShoot } from "@/lib/studio/shoot-directory";
import { shootDisplayTitle } from "@/lib/workspace-labels";
import { ToolPalette } from "./ToolPalette";
import { ShootTabs } from "./ShootTabs";
import { SidebarHistoryControls } from "./SidebarHistoryControls";
import { useSidebarHistory } from "./useSidebarHistory";
import { ChatHistoryProvider, ChatRecents, useChatHistory } from "./ChatHistory";
import { LibraryRecents, NewShootAction, PrimaryNavigation } from "./PrimaryNavigation";
import { FOTO_PRIMARY_NAV, primaryNavigationPath } from "./primary-navigation";
import {
  parseShootKey,
  shootWorkspaceHref,
  shootSummaryDetail,
  useShootNavigationData,
} from "@/components/shoots/navigation";
import { ShootWorkflowTabs } from "@/components/shoots/ShootWorkspaceFrame";
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
  useEffect(() => {
    cancelDevelopImportsOutsideScope(account ?? "signed-out");
  }, [account]);
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
      style={
        {
          "--sidebar-width": "var(--workspace-sidebar-width)",
          "--sidebar-width-icon": "52px",
        } as React.CSSProperties
      }
    >
      <GmailConnection>
        <WorkbenchFrame account={account}>{children}</WorkbenchFrame>
      </GmailConnection>
    </SidebarProvider>
  );
}
function WorkbenchFrame({ children, account }: { children: ReactNode; account: string }) {
  const sidebarHistory = useSidebarHistory();
  const shortcuts = useAccount()?.preferences.shortcuts ?? DEFAULT_SHORTCUTS;
  const navigate = useNavigate();
  const router = useRouter();
  const href = useRouterState({ select: (state) => state.location.href });
  const current = workbenchTab(href);
  const pathname = new URL(href, "https://workspace.invalid").pathname;
  const routeShoot = shootRoute(href);
  const routeShootKey = routeShoot && parseShootKey(routeShoot.key) ? routeShoot.key : null;
  const shootTab = routeShoot?.tab ?? "overview";
  const primaryPath = primaryNavigationPath(pathname);
  const primarySurface = !!primaryPath;
  const isCull = !!routeShootKey && shootTab === "cull";
  const isDevelop = !!routeShootKey && shootTab === "develop";
  const navigationData = useShootNavigationData(account, isLocalSingleUserMode);
  const [tabs, setTabs] = useState<WorkbenchTab[]>(() =>
    current && !primarySurface
      ? addWorkbenchTab(readWorkbenchTabs(account), current)
      : readWorkbenchTabs(account),
  );
  useEffect(() => {
    try {
      saveWorkbenchTabs(account, tabs);
    } catch {
      /* Tabs remain usable if the browser refuses persistence. */
    }
  }, [account, tabs]);
  const tabsRef = useRef(tabs);
  tabsRef.current = current && !primarySurface ? addWorkbenchTab(tabs, current) : tabs;
  const [chatTarget, setChatTarget] = useState<HTMLDivElement | null>(null);
  const [quickChat, setQuickChat] = useState(false);
  const [binding, setBinding] = useState<StudioWorkbenchBinding>(
    () =>
      explicitWorkspaceBinding(href, isLocalSingleUserMode) ??
      (current?.path === "/studio"
        ? studioWorkbenchBinding(href, isLocalSingleUserMode)
        : { kind: "ready", projectId: null }),
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
    const clipped = title.slice(0, 70);
    setTitles((old) => (old[tabHref] === clipped ? old : { ...old, [tabHref]: clipped }));
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
        !primaryNavigationPath(home.pathname) &&
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
  const creatingRef = useRef(false);
  const pendingShoot = useRef<{ id: string; title: string } | null>(null);
  const [creatingShoot, setCreatingShoot] = useState(false);
  const newShoot = useCallback(async () => {
    if (creatingRef.current) return false;
    creatingRef.current = true;
    setCreatingShoot(true);
    try {
      const draft = pendingShoot.current ?? {
        id: crypto.randomUUID(),
        title: nextShootLabel(account),
      };
      pendingShoot.current = draft;
      if (!(await openExact(shootWorkspaceHref(draft.id)))) return false;
      await renameShoot(account, draft.id, draft.title);
      pendingShoot.current = null;
      return true;
    } catch {
      setTabNote("This shoot could not be saved. Click New Shoot to retry saving the same shoot.");
      return false;
    } finally {
      creatingRef.current = false;
      setCreatingShoot(false);
    }
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
  const showStudio = useCallback(() => {
    if (binding.kind === "blocked") return Promise.resolve(false);
    const search = new URL(studioBindingHref(binding), "https://workspace.invalid").search;
    return openTool(shootWorkspaceHref(shootKeyForBinding(binding) ?? "legacy", "cull", search));
  }, [openTool, binding]);
  useEffect(() => {
    const tab = workbenchTab(href);
    setMobilePane(tab ? "tool" : "chat");
    if (tab && !primaryNavigationPath(new URL(href, "https://workspace.invalid").pathname))
      setTabs((old) => addWorkbenchTab(old, tab));
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
  const boundaryBinding = deliveryBoundaryBinding(href, activeBinding, isLocalSingleUserMode);
  const activeTool = !compact || mobilePane === "tool" ? (current?.path ?? null) : null;
  const studioVisible = current?.path === "/studio" || isCull;
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
      workspaceShootId: activeBinding.kind === "ready" ? activeBinding.shootId : undefined,
      workspaceDeliveryFocus:
        activeBinding.kind === "ready" ? activeBinding.deliveryFocus : undefined,
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
    (tab) =>
      tab.href === current?.href || tabProjectScope(tab.href) === projectScope(activeBinding),
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
  // Invalid canonical links still need their route's error UI, never the previous conversation.
  const showTool = !!current || primarySurface;
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
        <WorkspaceSidebar
          narrow={narrow}
          trigger={sidebarTriggerRef}
          rail={
            <aside className="foto-mobile-rail" aria-label="Workspace navigation">
              <button
                ref={sidebarTriggerRef}
                className="workbench-sidebar-toggle"
                aria-label="Open Sidebar"
                title="Open Sidebar"
                onClick={() => setOpenMobile(true)}
              >
                <LogoMark size={22} />
              </button>
              <NewShootAction create={newShoot} busy={creatingShoot} />
              <PrimaryNavigation
                pathname={pathname}
                open={openExact}
                counts={{ "/tonight": navigationData.tonightCount }}
              />
              <button
                className="workbench-sidebar-toggle foto-rail-settings"
                aria-label="Settings"
                title="Settings"
                onClick={() => void openExact("/settings/general")}
              >
                <Settings size={20} strokeWidth={1.65} />
              </button>
            </aside>
          }
        >
          <SidebarHeader className="workbench-sidebar-top">
            <div className="workbench-brand-row">
              {!narrow && !sidebarOpen ? (
                <button
                  type="button"
                  className="workbench-brand workbench-rail-logo"
                  aria-label="Open Sidebar"
                  title="Open Sidebar"
                  onClick={() => setSidebarOpen(true)}
                >
                  <LogoMark size={22} />
                </button>
              ) : (
                <a
                  href="/tonight"
                  onClick={(event) => {
                    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                      event.preventDefault();
                      void openExact("/tonight");
                    }
                  }}
                  className="workbench-brand"
                >
                  <LogoMark size={22} />
                  {PRODUCT_NAME}
                </a>
              )}
              <div className="workbench-brand-actions">
                <button
                  className="workbench-sidebar-toggle"
                  aria-label={narrow ? "Close Sidebar" : "Collapse Sidebar"}
                  title={narrow ? "Close Sidebar" : "Collapse Sidebar"}
                  onClick={() => (narrow ? setOpenMobile(false) : setSidebarOpen(false))}
                >
                  <PanelLeft size={20} />
                </button>
              </div>
            </div>
          </SidebarHeader>
          <SidebarContent className="workbench-sidebar-content">
            <NewShootAction create={newShoot} busy={creatingShoot} />
            <button
              className="workbench-nav-item workbench-rail-search"
              aria-label="Search"
              title="Search (⌘K)"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={20} />
            </button>
            <PrimaryNavigation
              pathname={pathname}
              open={openExact}
              counts={{ "/tonight": navigationData.tonightCount }}
            />
            <LibraryRecents
              rows={navigationData.recents.map((row) => ({
                id: row.key,
                title: row.title,
                href: row.recoveryPending ? "/library" : shootWorkspaceHref(row.key),
                detail: shootSummaryDetail(row),
                recoveryPending: row.recoveryPending,
                pinned: Boolean(row.pinned),
                archived: Boolean(row.archived),
              }))}
              activeId={routeShootKey}
              open={openExact}
              loading={navigationData.loading}
              error={navigationData.error}
              scope={account}
            />
            <div className="foto-sidebar-chats">
              <ChatRecents menuSide="right" />
            </div>
          </SidebarContent>
          <SidebarFooter className="workbench-sidebar-bottom">
            <button
              className="workbench-nav-item foto-secondary-nav"
              onClick={() => setSearchOpen(true)}
              aria-label="All Tools"
              title="All Tools (⌘K)"
            >
              <PanelsTopLeft size={20} strokeWidth={1.65} />
              <span className="foto-nav-label">All Tools</span>
              <kbd className="foto-nav-label">⌘K</kbd>
            </button>
            <AccountMenu />
          </SidebarFooter>
        </WorkspaceSidebar>
        <div className="workbench-body">
          <header className={`workbench-header ${primarySurface ? "foto-workflow-header" : ""}`}>
            <SidebarHistoryControls navigation={sidebarHistory} />
            {routeShootKey ? (
              <ShootWorkflowTabs id={routeShootKey} active={shootTab} />
            ) : primarySurface ? (
              <span className="foto-page-location">
                {FOTO_PRIMARY_NAV.find((item) => item.href === primaryPath)?.label ?? "Shoots"}
              </span>
            ) : null}
            {!primarySurface && projectTabs.length === 0 && !showTool && <ConversationHeading />}
            {!primarySurface && (projectTabs.length > 0 || showTool) && (
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
              {showTool && !primarySurface && current && current.path !== "/studio" && (
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
            className={`workbench-panels ${showTool ? "has-tool" : ""} ${primarySurface ? "foto-workflow-panels" : ""} ${studioVisible ? "is-studio" : ""} ${current?.path === "/develop" || isDevelop ? "is-develop" : ""} ${current?.path === "/clients" ? "is-clients" : ""} ${current?.path === "/earnings" || pathname === "/money" ? "is-earnings" : ""} ${current?.path === "/outbound" ? "is-outbound" : ""} ${current?.path === "/settings" && (!compact || mobilePane === "tool") ? "is-settings" : ""}`}
            data-mobile-pane={showTool ? mobilePane : "chat"}
          >
            <main
              className={`workbench-conversation ${quickChat ? "is-quick-chat" : ""}`}
              hidden={
                !quickChat &&
                showTool &&
                (primarySurface ||
                  (compact && mobilePane === "tool") ||
                  (!compact &&
                    (current?.path === "/earnings" ||
                      current?.path === "/outbound" ||
                      current?.path === "/develop" ||
                      current?.path === "/clients" ||
                      current?.path === "/studio")))
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
              hidden={
                !showTool || (compact && mobilePane === "chat" && current?.path !== "/studio")
              }
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
                    chatTarget &&
                    (boundaryBinding.kind === "blocked" ? (
                      <p role="alert" className="workbench-loading">
                        {boundaryBinding.reason}
                      </p>
                    ) : (
                      <DeliveryVersionBoundary {...boundaryBinding}>
                        <Suspense fallback={<p className="workbench-loading">Opening Studio…</p>}>
                          <StudioController
                            key={studioBindingKey(activeBinding)}
                            {...activeBinding}
                            storageScope={account}
                          />
                        </Suspense>
                      </DeliveryVersionBoundary>
                    ))
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
                    studioVisible || current?.path === "/research" || current?.path === "/mail"
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
  rail,
}: {
  narrow: boolean;
  trigger: React.RefObject<HTMLButtonElement | null>;
  children: ReactNode;
  rail: ReactNode;
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
  if (!narrow)
    return (
      <Sidebar className="workbench-sidebar" collapsible="icon">
        {children}
      </Sidebar>
    );
  return (
    <>
      {rail}
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
            <SheetTitle>foto navigation</SheetTitle>
            <SheetDescription>Tonight, Shoots, Library, Deliver and Earnings.</SheetDescription>
          </SheetHeader>
          {children}
        </SheetContent>
      </Sheet>
    </>
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
