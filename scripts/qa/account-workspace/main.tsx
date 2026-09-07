import React from "react";
import { createRoot } from "react-dom/client";
import { createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { AccountProvider, useAccount } from "../../../src/components/account/AccountProvider";
import { AccountSetup } from "../../../src/components/account/AccountSetup";
import { AccountMenu } from "../../../src/components/account/AccountMenu";
import { NewChatButton } from "../../../src/components/workbench/ChatHistory";
import { Settings } from "../../../src/routes/settings";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarProvider,
  SidebarTrigger,
} from "../../../src/components/ui/sidebar";
import { WorkbenchContext } from "../../../src/components/workbench/context";
import { LogoMark } from "../../../src/components/lensos/Logo";
import { Camera, Aperture, Image, Users } from "lucide-react";
import { qa } from "./fixture";
import "../../../src/styles.css";
import "../../../src/components/workbench/workbench.css";

function Surface() {
  const account = useAccount()!;
  if (account.status !== "in")
    return (
      <p role="status">
        {account.status === "loading" ? "Opening QA…" : "Signed out — private settings unavailable"}
      </p>
    );
  if (!account.setupComplete) return <AccountSetup key={account.scope} />;
  const openTool = async (path: string) => {
    qa.paths.push(path);
    return true;
  };
  return (
    <SidebarProvider
      className="photo-workbench"
      open={account.preferences.sidebarOpen}
      onOpenChange={(sidebarOpen) => account.savePreferences({ sidebarOpen })}
      style={{ "--sidebar-width": "224px" } as React.CSSProperties}
    >
      <WorkbenchContext.Provider
        value={{
          chatTarget: null,
          studioVisible: false,
          activeTool: "/settings",
          storageScope: account.scope!,
          workspaceProjectId: null,
          openTool,
          openWorkspaceRequest: async () => true,
          setToolTitle() {},
          showStudio: async () => true,
        }}
      >
        <Sidebar className="workbench-sidebar">
          <SidebarHeader className="workbench-sidebar-top">
            <a className="workbench-brand" href="#">
              <LogoMark size={26} />
              LensLabs
            </a>
          </SidebarHeader>
          <SidebarContent>
            <NewChatButton camera />
            {[
              [Aperture, "Studio"],
              [Image, "Delivery"],
              [Users, "Clients"],
            ].map(([Icon, label]) => (
              <button key={String(label)} className="workbench-nav-item">
                <Icon size={17} />
                {label}
              </button>
            ))}
            <p className="recent-shoot-empty">Recent Shoots</p>
          </SidebarContent>
          <SidebarFooter>
            <AccountMenu />
          </SidebarFooter>
        </Sidebar>
        <div className="workbench-body">
          <header className="workbench-header">
            <SidebarTrigger />
            <span>Photo assistant</span>
            <span style={{ marginLeft: "auto", fontSize: 12 }}>
              Isolated QA · synthetic account
            </span>
          </header>
          <div className="workbench-panels is-settings">
            <section className="workbench-tool-pane">
              <div className="workbench-tool-scroll">
                <Settings key={account.scope} />
              </div>
            </section>
          </div>
        </div>
      </WorkbenchContext.Provider>
    </SidebarProvider>
  );
}
const route = createRootRoute({
  component: () => (
    <AccountProvider>
      <Surface />
    </AccountProvider>
  ),
});
const router = createRouter({ routeTree: route });
const root = import.meta.hot?.data["root"] ?? createRoot(document.getElementById("root")!);
if (import.meta.hot) import.meta.hot.data["root"] = root;
root.render(<RouterProvider router={router} />);
