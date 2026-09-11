import { createContext, useContext } from "react";
import type { DeliveryFocus } from "@/lib/delivery/studio-handoff";
export type WorkbenchContextValue = {
  chatTarget: HTMLElement | null;
  studioVisible: boolean;
  activeTool: string | null;
  storageScope: string;
  workspaceProjectId: string | null;
  workspaceShootId?: string | undefined;
  workspaceDeliveryFocus?: DeliveryFocus | undefined;
  newShoot?: () => Promise<boolean>;
  openQuickChat?: () => Promise<void>;
  closeQuickChat?: () => void;
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
