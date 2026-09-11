import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router";
import { studioWorkbenchBinding, workbenchTab, type StudioWorkbenchBinding } from "./workbench";
import { PHOTO_ID_MAX_LENGTH } from "./photo-identity";

const idPattern = /^[a-f0-9-]{36}$/i;
const uuidPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export const SHOOT_WORKFLOW_TABS = [
  "overview",
  "cull",
  "develop",
  "gallery",
  "social",
  "smart-file",
] as const;
export type ShootWorkflowTab = (typeof SHOOT_WORKFLOW_TABS)[number];
/** Directory shoots and the separate local Project repository must never collide. */
export function parseShootKey(key: string): { kind: "shoot" | "project"; id: string } | null {
  const project = key.startsWith("project:");
  const id = project ? key.slice(8) : key;
  if (!uuidPattern.test(id) && (project || id !== "legacy")) return null;
  return { kind: project ? "project" : "shoot", id };
}
export function shootWorkspaceHref(key: string, tab: ShootWorkflowTab = "overview", search = "") {
  if (!parseShootKey(key) || !SHOOT_WORKFLOW_TABS.includes(tab))
    throw new Error("This shoot link is invalid.");
  if (search && !search.startsWith("?"))
    throw new Error("Shoot search parameters must start with ?.");
  return `/shoots/${encodeURIComponent(key)}${tab === "overview" ? "" : `/${tab}`}${search}`;
}
export function shootRoute(href: string): { key: string; tab: ShootWorkflowTab } | null {
  const match = new URL(href, "https://workspace.invalid").pathname.match(
    /^\/shoots\/([^/]+)(?:\/(cull|develop|gallery|social|smart-file))?\/?$/i,
  );
  if (!match) return null;
  try {
    return {
      key: decodeURIComponent(match[1]!),
      tab: (match[2]?.toLowerCase() ?? "overview") as ShootWorkflowTab,
    };
  } catch {
    return { key: "", tab: "overview" };
  }
}
export function shootKeyForBinding(binding: StudioWorkbenchBinding) {
  if (binding.kind !== "ready") return null;
  return binding.shootId ?? (binding.projectId ? `project:${binding.projectId}` : null);
}
/** One edit destination. Preserve exact source/version context rather than opening another Studio pane. */
export function developWorkspaceHref(binding: StudioWorkbenchBinding, photoId?: string | null) {
  if (binding.kind === "blocked") throw new Error(binding.reason);
  // Develop adds this prefix without changing the saved Studio frame identity.
  if (photoId && photoId.length > PHOTO_ID_MAX_LENGTH + "studio:".length)
    throw new Error("This photo reference is invalid.");
  return shootWorkspaceHref(
    shootKeyForBinding(binding) ?? "legacy",
    "develop",
    defaultStringifySearch({
      ...(photoId ? { photo: photoId } : {}),
      ...(binding.deliveryFocus && binding.projectId
        ? {
            project: binding.projectId,
            deliveryFrame: binding.deliveryFocus.frameId,
            deliveryVersion: binding.deliveryFocus.versionId,
            ...(binding.deliveryFocus.handoffId
              ? { deliveryHandoff: binding.deliveryFocus.handoffId }
              : {}),
          }
        : {}),
    }),
  );
}
const isStudio = (url: URL) =>
  url.pathname.replace(/\/+$/, "").toLowerCase() === "/studio" ||
  shootRoute(url.href)?.tab === "cull";
/** The path owns the source. Matching legacy query references are retained; conflicts fail closed. */
export function canonicalShootBinding(href: string, local: boolean): StudioWorkbenchBinding | null {
  const route = shootRoute(href);
  if (!route) return null;
  const target = parseShootKey(route.key),
    url = new URL(href, "https://workspace.invalid");
  const blocked: StudioWorkbenchBinding = {
    kind: "blocked",
    reason:
      "This shoot link contains invalid or conflicting source references. No photos were opened.",
  };
  if (!target) return blocked;
  const same = (key: string) =>
    !url.searchParams.has(key) ||
    (url.searchParams.getAll(key).length === 1 && url.searchParams.get(key) === target.id);
  if (target.kind === "shoot") {
    if (!same("shoot")) return blocked;
    url.searchParams.set("shoot", target.id);
    return studioWorkbenchBinding(`/studio${url.search}`, local);
  }
  if (url.searchParams.has("shoot") || !same("project") || !same("workspaceProject"))
    return blocked;
  const directKeys = ["project", "deliveryFrame", "deliveryVersion", "deliveryHandoff"];
  const workspaceKeys = [
    "workspaceProject",
    "workspaceFrame",
    "workspaceVersion",
    "workspaceHandoff",
  ];
  if (
    directKeys.some((key) => url.searchParams.has(key)) &&
    workspaceKeys.some((key) => url.searchParams.has(key))
  )
    return blocked;
  if ([...directKeys, ...workspaceKeys].some((key) => url.searchParams.getAll(key).length > 1))
    return blocked;
  const parsed = defaultParseSearch(url.search) as Record<string, unknown>;
  const workspace = workspaceKeys.some((key) => url.searchParams.has(key));
  const frame = workspace ? "workspaceFrame" : "deliveryFrame",
    version = workspace ? "workspaceVersion" : "deliveryVersion",
    handoff = workspace ? "workspaceHandoff" : "deliveryHandoff";
  return studioWorkbenchBinding(
    `/studio${defaultStringifySearch({ project: target.id, ...(url.searchParams.has(frame) ? { deliveryFrame: parsed[frame] } : {}), ...(url.searchParams.has(version) ? { deliveryVersion: parsed[version] } : {}), ...(url.searchParams.has(handoff) ? { deliveryHandoff: parsed[handoff] } : {}) })}`,
    local,
  );
}
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
  const canonical = canonicalShootBinding(href, local);
  if (canonical) return canonical;
  if (url.searchParams.has("shoot")) return studioWorkbenchBinding(href, local);
  if (isStudio(url)) return studioWorkbenchBinding(href, local);
  if (
    !["workspaceProject", "workspaceFrame", "workspaceVersion", "workspaceHandoff"].some((key) =>
      url.searchParams.has(key),
    )
  )
    return null;
  const values = url.searchParams.getAll("workspaceProject");
  if (
    values.length !== 1 ||
    !idPattern.test(values[0]!) ||
    ["workspaceFrame", "workspaceVersion", "workspaceHandoff"].some(
      (key) => url.searchParams.getAll(key).length > 1,
    )
  )
    return {
      kind: "blocked",
      reason: "This workspace project link is invalid. No shoot was loaded.",
    };
  const search = defaultParseSearch(url.search) as Record<string, unknown>;
  return studioWorkbenchBinding(
    `/studio${defaultStringifySearch({ project: values[0], ...(url.searchParams.has("workspaceFrame") ? { deliveryFrame: search["workspaceFrame"] } : {}), ...(url.searchParams.has("workspaceVersion") ? { deliveryVersion: search["workspaceVersion"] } : {}), ...(url.searchParams.has("workspaceHandoff") ? { deliveryHandoff: search["workspaceHandoff"] } : {}) })}`,
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
/** The editing boundary is independent of the controller's remembered tool context. */
export function deliveryBoundaryBinding(
  href: string,
  active: StudioWorkbenchBinding,
  local: boolean,
): StudioWorkbenchBinding {
  if (active.kind === "blocked") return active;
  const explicit = explicitWorkspaceBinding(href, local);
  if (explicit?.kind === "blocked") return explicit;
  // A same-project tool deliberately cannot rewind the remembered controller.
  // Its explicit delivery URL must nevertheless fence every mounted editor.
  if (explicit?.kind === "ready" && explicit.deliveryFocus) return explicit;
  return active;
}
export function tabProjectScope(href: string) {
  const url = new URL(href, "https://workspace.invalid");
  const canonical = canonicalShootBinding(href, true);
  if (canonical) return projectScope(canonical);
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
  // A selected canonical shoot has its own identity; primary landing pages are not contextual tools.
  if (
    shootRoute(href) ||
    ["/tonight", "/shoots", "/clients", "/library", "/money", "/earnings"].includes(
      url.pathname.replace(/\/$/, ""),
    )
  )
    return href;
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
  return `${url.pathname}${defaultStringifySearch({ ...defaultParseSearch(url.search), workspaceProject: binding.projectId, ...(binding.deliveryFocus ? { workspaceFrame: binding.deliveryFocus.frameId, workspaceVersion: binding.deliveryFocus.versionId, ...(binding.deliveryFocus.handoffId ? { workspaceHandoff: binding.deliveryFocus.handoffId } : {}) } : {}) })}`;
}
/** Redirect old entry points without modifying the underlying database or dropping deep-link context. */
export function legacyWorkbenchRedirect(
  href: string,
  remembered: StudioWorkbenchBinding | null,
  local: boolean,
): { href: string } | { blocked: string } | null {
  const url = new URL(href, "https://workspace.invalid");
  const path = url.pathname.replace(/\/$/, "").toLowerCase();
  const destination = (
    {
      "/jobs": "/shoots",
      "/money": "/earnings",
      "/outbound": "/deliver",
    } as Record<string, string>
  )[path];
  if (destination) return { href: `${destination}${url.search}${url.hash}` };
  if (path !== "/develop") return null;
  const explicit =
    url.searchParams.has("project") ||
    ["deliveryFrame", "deliveryVersion", "deliveryHandoff"].some((key) => url.searchParams.has(key))
      ? studioWorkbenchBinding(`/studio${url.search}`, local)
      : explicitWorkspaceBinding(href, local);
  const binding = explicit ?? remembered;
  if (binding?.kind === "blocked") return { blocked: binding.reason };
  const key = binding ? shootKeyForBinding(binding) : null;
  if (!key) return { href: `/library${url.search}${url.hash}` };
  // A remembered delivery revision also belongs to this source, even without explicit query fields.
  if (!explicit && binding?.kind === "ready" && binding.deliveryFocus && binding.projectId) {
    url.searchParams.set("workspaceProject", binding.projectId);
    const refs = defaultStringifySearch({
      workspaceFrame: binding.deliveryFocus.frameId,
      workspaceVersion: binding.deliveryFocus.versionId,
      ...(binding.deliveryFocus.handoffId
        ? { workspaceHandoff: binding.deliveryFocus.handoffId }
        : {}),
    });
    new URLSearchParams(refs).forEach((value, name) => url.searchParams.set(name, value));
  }
  const target = `${shootWorkspaceHref(key, "develop", url.search)}${url.hash}`;
  const checked = canonicalShootBinding(target, local);
  return checked?.kind === "blocked" ? { blocked: checked.reason } : { href: target };
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
