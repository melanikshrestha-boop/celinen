import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router";
import type { DeliveryFocus } from "./delivery/studio-handoff";
import { isSettingsPath } from "./settings-catalog";
import { PHOTO_ID_MAX_LENGTH } from "./photo-identity";

export const WORKBENCH_TOOLS = [
  { path: "/tonight", label: "Tonight", group: "Workspace" },
  { path: "/shoots", label: "Shoots", group: "Workspace" },
  { path: "/library", label: "Library", group: "Workspace" },
  { path: "/money", label: "Earnings (legacy link)", group: "Business" },
  { path: "/studio", label: "Studio", group: "Workspace" },
  { path: "/develop", label: "Develop", group: "Workspace" },
  { path: "/projects", label: "Projects", group: "Workspace" },
  { path: "/deliver", label: "Delivery", group: "Workspace" },
  { path: "/clients", label: "Clients", group: "Business" },
  { path: "/outbound", label: "Outbound", group: "Business" },
  { path: "/publish", label: "Publish", group: "Workspace" },
  { path: "/shop", label: "Print shop", group: "Business" },
  { path: "/network", label: "Photographer network", group: "Business" },
  { path: "/mail", label: "Gmail", group: "Connections" },
  { path: "/research", label: "Web research", group: "Connections" },
  { path: "/desk", label: "Event desk", group: "Tools" },
  { path: "/pick", label: "Picks", group: "Tools" },
  { path: "/metadata", label: "Metadata", group: "Tools" },
  { path: "/adobe", label: "Adobe settings", group: "Tools" },
  { path: "/send", label: "Send", group: "Tools" },
  { path: "/bookings", label: "Bookings", group: "Business" },
  { path: "/packages", label: "Packages", group: "Business" },
  { path: "/rates", label: "Rates", group: "Business" },
  { path: "/business", label: "Business", group: "Business" },
  { path: "/earnings", label: "Earnings", group: "Business" },
  { path: "/portfolio", label: "Portfolio", group: "Business" },
  { path: "/settings", label: "Settings", group: "Account" },
] as const;
/** Keep everyday navigation small; the complete catalogue remains in the command menu. */
export const WORKBENCH_PRIMARY_TOOLS = [
  "/tonight",
  "/shoots",
  "/clients",
  "/library",
  "/deliver",
  "/earnings",
].map((path) => ({
  ...WORKBENCH_TOOLS.find((tool) => tool.path === path)!,
  ...(path === "/deliver" ? { label: "Deliver" } : {}),
}));
export type WorkbenchTab = { href: string; label: string; path: string };
const unsafeUrlCharacters = (value: string) =>
  [...value].some((char) => char === "\\" || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
export type StudioWorkbenchBinding =
  | {
      kind: "ready";
      projectId: string | null;
      shootId?: string;
      deliveryFocus?: DeliveryFocus;
    }
  | { kind: "blocked"; reason: string };

/** A bad deep link must never fall through to an unrelated editable shoot. */
export function studioWorkbenchBinding(
  href: string,
  localProjects: boolean,
): StudioWorkbenchBinding {
  const url = new URL(href, "https://workspace.invalid");
  if (url.searchParams.has("shoot")) {
    const ids = url.searchParams.getAll("shoot");
    if (
      ids.length !== 1 ||
      !/^(?:legacy|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/i.test(ids[0]!) ||
      [
        "project",
        "workspaceProject",
        "deliveryFrame",
        "deliveryVersion",
        "deliveryHandoff",
        "workspaceFrame",
        "workspaceVersion",
        "workspaceHandoff",
      ].some((key) => url.searchParams.has(key))
    )
      return { kind: "blocked", reason: "This shoot link is invalid. No photos were opened." };
    return { kind: "ready", projectId: null, shootId: ids[0]! };
  }
  if (url.pathname.replace(/\/$/, "").toLowerCase() !== "/studio")
    return { kind: "ready", projectId: null };
  const parsed = defaultParseSearch(url.search) as Record<string, unknown>;
  const projectId = parsed["project"] ?? null;
  const frameId = parsed["deliveryFrame"];
  const versionId = parsed["deliveryVersion"];
  const handoffId = parsed["deliveryHandoff"];
  if (
    ["project", "deliveryFrame", "deliveryVersion", "deliveryHandoff"].some(
      (key) => url.searchParams.getAll(key).length > 1,
    )
  )
    return {
      kind: "blocked",
      reason: "This link contains conflicting source references. No shoot was opened.",
    };
  if (
    url.searchParams.has("project") &&
    (typeof projectId !== "string" || !/^[a-f0-9-]{36}$/i.test(projectId))
  )
    return { kind: "blocked", reason: "This project link is invalid. No shoot was opened." };
  if (projectId && !localProjects)
    return {
      kind: "blocked",
      reason:
        "Named projects are available in the local workspace only. No private project data was loaded.",
    };
  if (
    ["deliveryFrame", "deliveryVersion", "deliveryHandoff"].some((key) => url.searchParams.has(key))
  ) {
    if (
      typeof projectId !== "string" ||
      typeof frameId !== "string" ||
      typeof versionId !== "string" ||
      !frameId ||
      !versionId ||
      frameId.length > PHOTO_ID_MAX_LENGTH ||
      versionId.length > 2000 ||
      (handoffId !== undefined &&
        (typeof handoffId !== "string" ||
          !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(handoffId)))
    )
      return {
        kind: "blocked",
        reason: "This delivery version link is incomplete. No shoot was opened.",
      };
    return {
      kind: "ready",
      projectId,
      deliveryFocus: {
        frameId,
        versionId,
        ...(typeof handoffId === "string" ? { handoffId } : {}),
      },
    };
  }
  return { kind: "ready", projectId: typeof projectId === "string" ? projectId : null };
}

export function studioBindingKey(binding: StudioWorkbenchBinding) {
  return binding.kind === "blocked"
    ? "blocked"
    : JSON.stringify([
        binding.projectId,
        binding.shootId,
        binding.deliveryFocus?.frameId,
        binding.deliveryFocus?.versionId,
        binding.deliveryFocus?.handoffId,
      ]);
}

export function studioBindingHref(binding: StudioWorkbenchBinding) {
  if (binding.kind === "ready" && binding.shootId)
    return `/studio?shoot=${encodeURIComponent(binding.shootId)}`;
  if (binding.kind === "blocked" || !binding.projectId) return "/studio";
  return `/studio${defaultStringifySearch({ project: binding.projectId, ...(binding.deliveryFocus ? { deliveryFrame: binding.deliveryFocus.frameId, deliveryVersion: binding.deliveryFocus.versionId, ...(binding.deliveryFocus.handoffId ? { deliveryHandoff: binding.deliveryFocus.handoffId } : {}) } : {}) })}`;
}
/** Photographer rail destinations live in the dashboard ChatGPT shell, not Workbench. */
/** Pages that render inside the Home dashboard's sidebar. Everything a photographer
 * can reach from Home belongs here: the shoot pages are where Cull's "Open Develop"
 * and the shoot breadcrumb lead, and landing them in the older workspace chrome
 * swapped the whole interface out from under the photographer mid-cull. */
export const DASHBOARD_APP_PATHS = [
  "/studio",
  "/cull",
  "/shoots",
  "/tonight",
  "/clients",
  "/deliver",
  "/develop",
  "/poses",
  "/earnings",
  "/publish",
  "/library",
  "/settings",
  "/help",
  "/community",
] as const;

export function isDashboardAppPath(pathname: string) {
  const path = pathname.replace(/\/$/, "").toLowerCase() || "/";
  return DASHBOARD_APP_PATHS.some((base) => path === base || path.startsWith(`${base}/`));
}

export function isDashboardAppRoute(routeIds: readonly string[], pathname = "") {
  if (isDashboardAppPath(pathname)) return true;
  if (routeIds.includes("/settings_/$section")) return true;
  return DASHBOARD_APP_PATHS.some((path) => routeIds.includes(path));
}

/** Video is a separate product on this domain. It never uses Celinen's shell. */
export function isVideoAppPath(pathname: string) {
  const path = pathname.replace(/\/$/, "").toLowerCase() || "/";
  return path === "/video" || path.startsWith("/video/");
}

export function isWorkbenchRoute(routeIds: readonly string[]) {
  return routeIds.some(
    (id) =>
      id === "/workspace" ||
      id === "/shoot" ||
      id === "/jobs" ||
      id.startsWith("/shoots/") ||
      (WORKBENCH_TOOLS.some((t) => t.path === id) && !isDashboardAppPath(id)),
  );
}

/** Signed-in app surfaces, including Dashboard which is not a workbench chrome route. */
export function isPrivateAppRoute(routeIds: readonly string[], pathname = "") {
  if (isWorkbenchRoute(routeIds)) return true;
  if (isDashboardAppRoute(routeIds, pathname)) return true;
  const path = pathname.replace(/\/$/, "") || "/";
  return routeIds.includes("/dashboard") || path === "/dashboard";
}
export function workbenchTab(href: string): WorkbenchTab | null {
  if (!href.startsWith("/") || href.startsWith("//") || unsafeUrlCharacters(href)) return null;
  const url = new URL(href, "https://workspace.invalid");
  if (url.origin !== "https://workspace.invalid") return null;
  const path = url.pathname.replace(/\/$/, "").toLowerCase();
  const shoot = path.match(/^\/shoots\/([^/]+)(?:\/(cull|develop|gallery|social|smart-file))?$/);
  if (shoot) {
    const label =
      (
        {
          cull: "Cull",
          develop: "Develop",
          gallery: "Gallery",
          social: "Social",
          "smart-file": "SmartFile",
        } as Record<string, string>
      )[shoot[2] ?? ""] ?? "Overview";
    url.searchParams.sort();
    return {
      href: `${url.pathname.replace(/\/$/, "")}${url.search}${url.hash}`,
      path: url.pathname.replace(/\/$/, ""),
      label,
    };
  }
  const tool = WORKBENCH_TOOLS.find(
    (t) => t.path === path || (t.path === "/settings" && isSettingsPath(path)),
  );
  if (!tool) return null;
  const parsedQuery = (defaultParseSearch(url.search) as Record<string, unknown>)["q"];
  const queryLabel = typeof parsedQuery === "string" ? parsedQuery : url.searchParams.get("q");
  if (path === "/deliver")
    for (const flag of ["workflow", "legacy"]) {
      if (["1", "true"].includes(url.searchParams.get(flag) ?? "")) url.searchParams.set(flag, "1");
    }
  // Equivalent shoot URLs describe one tab, independent of query insertion order.
  if (url.searchParams.has("shoot")) url.searchParams.sort();
  return {
    href: `${tool.path}${url.search}${["/tonight", "/shoots", "/library", "/deliver", "/money", "/earnings"].includes(tool.path) ? url.hash : ""}`,
    path: tool.path,
    label:
      tool.label +
      (path === "/research" && queryLabel
        ? ` · ${queryLabel.slice(0, 36)}`
        : path === "/mail" && url.searchParams.has("message")
          ? " · Message"
          : "") +
      (tool.path === "/deliver" && url.searchParams.get("workflow") === "1" ? " · Proofing" : ""),
  };
}
export function addWorkbenchTab(tabs: WorkbenchTab[], tab: WorkbenchTab) {
  return tabs.some((t) => t.href === tab.href) ? tabs : [...tabs, tab];
}
export function closeWorkbenchTab(tabs: WorkbenchTab[], href: string, activeHref: string) {
  const index = tabs.findIndex((tab) => tab.href === href);
  const remaining = tabs.filter((tab) => tab.href !== href);
  return {
    tabs: remaining,
    next:
      href === activeHref ? (remaining[Math.max(0, index - 1)]?.href ?? "/workspace") : activeHref,
  };
}
/** Navigation is deliberately explicit; opening a tool does not authorize its business actions. */
export function workbenchNavigation(text: string): string | null {
  const match = text.trim().match(/^(?:open|show|go to|switch to)\s+(?:the\s+)?(.+?)[.!]?$/i);
  if (!match) return null;
  const name = match[1]!.toLowerCase().trim();
  if (["chat", "assistant", "workspace"].includes(name)) return "/workspace";
  if (["proofing", "client proofing", "private delivery"].includes(name))
    return "/deliver?workflow=1";
  if (name === "deliver") return "/deliver";
  if (["clients", "contacts", "client database"].includes(name)) return "/clients";
  if (["social", "social media", "instagram", "publishing"].includes(name)) return "/publish";
  if (["shop", "store", "prints", "domains", "shopify"].includes(name)) return "/shop";
  if (["network", "marketplace", "photographers", "collaborations"].includes(name))
    return "/network";
  return WORKBENCH_TOOLS.find((t) => t.label.toLowerCase() === name)?.path ?? null;
}
export function safeSignInPath(path: string) {
  if (!path.startsWith("/") || path.startsWith("//") || unsafeUrlCharacters(path))
    return "/dashboard";
  try {
    const decoded = decodeURIComponent(path);
    if (unsafeUrlCharacters(decoded) || decoded.startsWith("//")) return "/dashboard";
    const url = new URL(path, "https://workspace.invalid");
    if (url.origin !== "https://workspace.invalid" || /^\/auth\/?$/i.test(url.pathname))
      return "/dashboard";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/dashboard";
  }
}
