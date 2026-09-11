import { createContext, useContext } from "react";

/** True when a photographer surface is mounted inside the ChatGPT-style dashboard shell. */
export const DashboardContext = createContext(false);
export function useDashboard() {
  return useContext(DashboardContext);
}
