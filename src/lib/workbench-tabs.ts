import { addWorkbenchTab, workbenchTab, type WorkbenchTab } from "./workbench";
import { workspaceStorageKey } from "./workspace-storage";
import { shootIdSchema } from "./studio/shoot-directory";
import { tabProjectScope } from "./workbench-projects";
export const workbenchTabsKey = (scope: string) =>
  workspaceStorageKey("lenslabs.tool-tabs.v1", scope);
/** Remember tool locations only. Mail/search requests and focused client revision links are session-only. */
export function restorableTabs(value: unknown): WorkbenchTab[] {
  if (!Array.isArray(value)) return [];
  let tabs: WorkbenchTab[] = [];
  const counts = new Map<string, number>();
  for (const href of value) {
    if (typeof href !== "string" || href.length > 500) continue;
    const tab = workbenchTab(href);
    if (!tab || tab.path === "/mail" || tab.path === "/research") continue;
    const url = new URL(href, "https://workspace.invalid");
    if (
      [...url.searchParams].some(([key, value]) =>
        key === "project" || key === "workspaceProject" || (tab.path === "/publish" && key === "gallery")
          ? !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
          : key === "shoot"
            ? !shootIdSchema.safeParse(value).success
            : !(["workflow", "legacy"].includes(key) && ["1", "true"].includes(value)),
      )
    )
      continue;
    if (
      url.searchParams.has("shoot") &&
      ["project", "workspaceProject"].some((key) => url.searchParams.has(key))
    )
      continue;
    if ([...url.searchParams.keys()].some((key) => url.searchParams.getAll(key).length > 1))
      continue;
    const scope = tabProjectScope(tab.href);
    if ((counts.get(scope) ?? 0) >= 32 || tabs.some((existing) => existing.href === tab.href))
      continue;
    counts.set(scope, (counts.get(scope) ?? 0) + 1);
    tabs = addWorkbenchTab(tabs, tab);
  }
  return tabs;
}
export function readWorkbenchTabs(scope: string): WorkbenchTab[] {
  try {
    return restorableTabs(JSON.parse(localStorage.getItem(workbenchTabsKey(scope)) ?? "[]"));
  } catch {
    return [];
  }
}
export function saveWorkbenchTabs(scope: string, tabs: WorkbenchTab[]) {
  localStorage.setItem(
    workbenchTabsKey(scope),
    JSON.stringify(restorableTabs(tabs.map((tab) => tab.href)).map((tab) => tab.href)),
  );
}
