import { createContext, useContext } from "react";
export type WorkbenchContextValue = {
  chatTarget: HTMLElement | null;
  studioVisible: boolean;
  activeTool: string | null;
  storageScope: string;
  workspaceProjectId: string | null;
  newShoot?: () => Promise<boolean>;
  setToolTitle: (href: string, title: string) => void;
  openWorkspaceRequest: (request: {
    path: "/research" | "/mail";
    query: string;
  }) => Promise<boolean>;
  openTool: (href: string) => Promise<boolean>;
  showStudio: () => Promise<boolean>;
};
export const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);
export const useWorkbench = () => useContext(WorkbenchContext);
