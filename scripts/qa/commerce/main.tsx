import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { AccountProvider } from "@/components/account/AccountProvider";
import { CommerceDesk } from "@/components/commerce/CommerceDesk";
import { PhotographerNetwork } from "@/components/commerce/PhotographerNetwork";
import { WorkbenchContext } from "@/components/workbench/context";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { LogoMark } from "@/components/lensos/Logo";
import "@/styles.css";
import "@/components/workbench/workbench.css";
function Surface() {
  const [mode, setMode] = useState("shop");
  return (
    <AccountProvider>
      <SidebarProvider
        className="photo-workbench"
        style={{ "--sidebar-width": "224px" } as React.CSSProperties}
      >
        <WorkbenchContext.Provider
          value={{
            chatTarget: null,
            studioVisible: false,
            activeTool: "/shop",
            storageScope: "qa-only",
            workspaceProjectId: null,
            openTool: async () => true,
            openWorkspaceRequest: async () => true,
            setToolTitle() {},
            showStudio: async () => true,
          }}
        >
          <Sidebar className="workbench-sidebar">
            <SidebarHeader>
              <a className="workbench-brand">
                <LogoMark size={26} />
                LensLabs
              </a>
            </SidebarHeader>
            <SidebarContent>
              <button className="workbench-nav-item" onClick={() => setMode("shop")}>
                Print shop
              </button>
              <button className="workbench-nav-item" onClick={() => setMode("network")}>
                Photographer network
              </button>
            </SidebarContent>
          </Sidebar>
          <div className="workbench-body">
            <header className="workbench-header">
              <SidebarTrigger />
              <span>Isolated QA · synthetic data</span>
              <button onClick={() => document.documentElement.classList.toggle("dark")}>
                Black / light
              </button>
            </header>
            <div className="workbench-panels">
              <section className="workbench-tool-pane">
                <div className="workbench-tool-scroll">
                  {mode === "shop" ? <CommerceDesk /> : <PhotographerNetwork />}
                </div>
              </section>
            </div>
          </div>
        </WorkbenchContext.Provider>
      </SidebarProvider>
    </AccountProvider>
  );
}
const router = createRouter({ routeTree: createRootRoute({ component: Surface }) });
createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
