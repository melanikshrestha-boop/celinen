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
import { Aperture, Image, PanelRightClose, PanelsTopLeft, Users } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAccount } from "@/components/account/AccountProvider";
import { AccountMenu } from "@/components/account/AccountMenu";
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
  WORKBENCH_PRIMARY_TOOLS,
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
import { ToolPalette } from "./ToolPalette";
import { ShootTabs } from "./ShootTabs";
import { ChatHistoryProvider, ChatRecents, NewChatButton } from "./ChatHistory";
import { readWorkbenchTabs, saveWorkbenchTabs } from "@/lib/workbench-tabs";

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
      key={account}
      className="photo-workbench"
      open={sidebarOpen}
      onOpenChange={(sidebarOpen) => {
        setSidebarOpen(sidebarOpen);
        try {
          identity?.savePreferences({ sidebarOpen });
        } catch {
          /* Navigation remains usable when this browser refuses preference storage. */
        }
      }}
      style={{ "--sidebar-width": "224px" } as React.CSSProperties}
    >
      <GmailConnection>
        <WorkbenchFrame account={account}>{children}</WorkbenchFrame>
      </GmailConnection>
    </SidebarProvider>
  );
}
function WorkbenchFrame({ children, account }: { children: ReactNode; account: string }) {
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
  const { setOpenMobile } = useSidebar();
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
      await navigate({ href: tab?.href ?? destination });
      return (
        (workbenchTab(router.state.location.href)?.href ?? router.state.location.href) ===
        (tab?.href ?? destination)
      );
    },
    [navigate, router, setOpenMobile],
  );
  const openTool = useCallback(
    (destination: string) =>
      openExact(
        scopeToolHref(destination === "/deliver" ? "/deliver?workflow=1" : destination, binding),
      ),
    [openExact, binding],
  );
  const newShoot = useCallback(
    () => openExact(`/workspace?shoot=${crypto.randomUUID()}`),
    [openExact],
  );
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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((old) => !old);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  // Bind during render on Studio navigation; no intermediate frame may edit the previous shoot.
  const activeBinding = resolveWorkspaceBinding(href, binding, isLocalSingleUserMode);
  const activeTool = !compact || mobilePane === "tool" ? (current?.path ?? null) : null;
  const studioVisible = activeTool === "/studio";
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
        <Sidebar className="workbench-sidebar">
          <SidebarHeader className="workbench-sidebar-top">
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
              <LogoMark size={24} />
              LensLabs
            </a>
          </SidebarHeader>
          <SidebarContent className="workbench-sidebar-content">
            <NewChatButton />
            <NewChatButton camera active={!showTool} />
            {WORKBENCH_PRIMARY_TOOLS.map((tool) => {
              const Icon =
                tool.path === "/studio" ? Aperture : tool.path === "/deliver" ? Image : Users;
              return (
                <a
                  key={tool.path}
                  href={
                    tool.path === "/studio"
                      ? studioBindingHref(binding)
                      : scopeToolHref(
                          tool.path === "/deliver" ? "/deliver?workflow=1" : tool.path,
                          binding,
                        )
                  }
                  onClick={(event) => {
                    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                      event.preventDefault();
                      if (tool.path === "/studio") showStudio();
                      else newTool(tool.path);
                    }
                  }}
                  className={`workbench-nav-item ${current?.path === tool.path ? "is-active" : ""}`}
                  aria-current={current?.path === tool.path ? "page" : undefined}
                >
                  <Icon size={16} />
                  {tool.label}
                </a>
              );
            })}
            <button
              className={`workbench-nav-item workbench-tools-trigger ${current && !WORKBENCH_PRIMARY_TOOLS.some((tool) => tool.path === current.path) ? "is-active" : ""}`}
              onClick={() => setSearchOpen(true)}
            >
              <PanelsTopLeft size={17} />
              All tools<kbd>⌘K</kbd>
            </button>
            <RecentShoots
              scope={account}
              activeId={
                activeBinding.kind === "ready" && !activeBinding.projectId
                  ? (activeBinding.shootId ?? "legacy")
                  : null
              }
              open={openExact}
            />
            <details className="recent-shoot-conversations">
              <summary>Conversations in this shoot</summary>
              <ChatRecents />
            </details>
          </SidebarContent>
          <SidebarFooter className="workbench-sidebar-bottom">
            <AccountMenu />
          </SidebarFooter>
        </Sidebar>
        <div className="workbench-body">
          <header className="workbench-header">
            <SidebarTrigger />
            <span>Photo assistant</span>
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
          <ShootTabs
            tabs={projectTabs}
            currentHref={current?.href ?? null}
            chatHref={scopeToolHref("/workspace", activeBinding)}
            titles={titles}
            onOpen={openExact}
            onClose={closeTab}
            onNew={() => setSearchOpen(true)}
          />
          <div
            className={`workbench-panels ${showTool ? "has-tool" : ""} ${current?.path === "/settings" && (!compact || mobilePane === "tool") ? "is-settings" : ""}`}
            data-mobile-pane={showTool ? mobilePane : "chat"}
          >
            <main
              className="workbench-conversation"
              hidden={compact && showTool && mobilePane === "tool"}
              aria-label="Photography chat"
            >
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
