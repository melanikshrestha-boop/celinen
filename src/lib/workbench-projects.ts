import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router";
import { studioWorkbenchBinding, workbenchTab, type StudioWorkbenchBinding } from "./workbench";

const idPattern = /^[a-f0-9-]{36}$/i;
const isStudio = (url: URL) => url.pathname.replace(/\/+$/, "").toLowerCase() === "/studio";
export const projectScope = (binding: StudioWorkbenchBinding) =>
  binding.kind === "ready"
    ? binding.shootId === "legacy"
      ? "current"
      : (binding.shootId ?? binding.projectId ?? "current")
    : "unavailable";
export function explicitWorkspaceBinding(
  href: string,
  local: boolean,
): StudioWorkbenchBinding | null {
  const url = new URL(href, "https://workspace.invalid");
  if (url.searchParams.has("shoot")) return studioWorkbenchBinding(href, local);
  if (isStudio(url)) return studioWorkbenchBinding(href, local);
  if (
    !["workspaceProject", "workspaceFrame", "workspaceVersion"].some((key) =>
      url.searchParams.has(key),
    )
  )
    return null;
  const values = url.searchParams.getAll("workspaceProject");
  if (
    values.length !== 1 ||
    !idPattern.test(values[0]!) ||
    ["workspaceFrame", "workspaceVersion"].some((key) => url.searchParams.getAll(key).length > 1)
  )
    return {
      kind: "blocked",
      reason: "This workspace project link is invalid. No shoot was loaded.",
    };
  const search = defaultParseSearch(url.search) as Record<string, unknown>;
  return studioWorkbenchBinding(
    `/studio${defaultStringifySearch({ project: values[0], ...(url.searchParams.has("workspaceFrame") ? { deliveryFrame: search["workspaceFrame"] } : {}), ...(url.searchParams.has("workspaceVersion") ? { deliveryVersion: search["workspaceVersion"] } : {}) })}`,
    local,
  );
}
/** Background tool tabs must never rewind the current shoot's delivery revision. */
export function resolveWorkspaceBinding(
  href: string,
  remembered: StudioWorkbenchBinding,
  local: boolean,
): StudioWorkbenchBinding {
  const next = explicitWorkspaceBinding(href, local);
  if (!next) return remembered;
  if (
    !isStudio(new URL(href, "https://workspace.invalid")) &&
    next.kind === "ready" &&
    remembered.kind === "ready" &&
    !next.shootId &&
    !remembered.shootId &&
    next.projectId === remembered.projectId
  )
    return remembered;
  return next;
}
export function tabProjectScope(href: string) {
  const url = new URL(href, "https://workspace.invalid");
  if (url.searchParams.get("shoot") === "legacy") return "current";
  return (
    url.searchParams.get("shoot") ??
    (isStudio(url) ? url.searchParams.get("project") : url.searchParams.get("workspaceProject")) ??
    "current"
  );
}
/** Contextual sidebar opens inherit the shoot. Stored tab URLs always navigate exactly. */
export function scopeToolHref(href: string, binding: StudioWorkbenchBinding) {
  const url = new URL(href, "https://workspace.invalid");
  if (
    binding.kind === "ready" &&
    binding.shootId &&
    !url.searchParams.has("shoot") &&
    !url.searchParams.has("project") &&
    !url.searchParams.has("workspaceProject") &&
    (url.pathname === "/workspace" || workbenchTab(href))
  ) {
    url.searchParams.set("shoot", binding.shootId);
    return `${url.pathname}${url.search}`;
  }
  if (
    isStudio(url) ||
    url.searchParams.has("workspaceProject") ||
    binding.kind !== "ready" ||
    !binding.projectId
  )
    return href;
  if (url.pathname !== "/workspace" && !workbenchTab(href)) return href;
  return `${url.pathname}${defaultStringifySearch({ ...defaultParseSearch(url.search), workspaceProject: binding.projectId, ...(binding.deliveryFocus ? { workspaceFrame: binding.deliveryFocus.frameId, workspaceVersion: binding.deliveryFocus.versionId } : {}) })}`;
}
export function workspaceToolHref(
  path: "/research" | "/mail",
  query = "",
  extra: Record<string, string> = {},
) {
  // Gmail terms belong only in the ephemeral request map, never history/referrer URLs.
  return `${path}${defaultStringifySearch({ ...(path === "/research" && query ? { q: query.slice(0, 500) } : {}), ...extra })}`;
}
/** Decode router-serialized strings without rounding numeric-only Gmail identifiers. */
export function workspaceToolText(href: string, key: "q" | "message") {
  const url = new URL(href, "https://workspace.invalid");
  if (url.searchParams.getAll(key).length !== 1) return null;
  const parsed = defaultParseSearch(url.search) as Record<string, unknown>;
  const value = typeof parsed[key] === "string" ? parsed[key] : url.searchParams.get(key);
  return typeof value === "string" && value.length <= (key === "q" ? 500 : 200) ? value : null;
}
export function parseWorkspaceRequest(
  text: string,
): { path: "/research" | "/mail"; query: string } | null {
  const web = text
    .trim()
    .match(/^(?:(?:search|browse)\s+(?:the\s+)?web|look up)\s+(?:for\s+)?(.+)$/i);
  const mail = text
    .trim()
    .match(/^(?:search|find)(?:\s+(?:my|in))?\s+(?:gmail|emails?|mail)\s+(?:for\s+)?(.+)$/i);
  if (mail) return { path: "/mail", query: mail[1]!.trim().slice(0, 500) };
  if (web && !/^(?:my\s+)?(?:photos?|images?|shoot|keepers?)\b/i.test(web[1]!))
    return { path: "/research", query: web[1]!.trim().slice(0, 500) };
  return null;
}
