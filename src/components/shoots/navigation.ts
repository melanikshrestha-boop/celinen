import { useCallback, useEffect, useRef, useState } from "react";
import {
  listRecentShoots,
  listShootOrganization,
  type RecentShoot,
  type ShootOrganization,
} from "@/lib/studio/shoot-directory";
import { listProjects } from "@/lib/projects/repository";
import type { Project } from "@/lib/projects/model";
import {
  parseShootKey,
  canonicalShootBinding,
  shootRoute,
  shootWorkspaceHref,
  SHOOT_WORKFLOW_TABS,
  type ShootWorkflowTab,
} from "@/lib/workbench-projects";
export { parseShootKey, shootWorkspaceHref } from "@/lib/workbench-projects";

export const SHOOT_TABS = SHOOT_WORKFLOW_TABS;
export type ShootTab = ShootWorkflowTab;
export const SHOOT_TAB_LABELS: Record<ShootTab, string> = {
  overview: "Overview",
  cull: "Cull",
  develop: "Develop",
  gallery: "Gallery",
  social: "Social",
  "smart-file": "SmartFile",
};
export type ShootSummary = {
  key: string;
  id: string;
  kind: "shoot" | "project";
  title: string;
  photoCount: number;
  updatedAt: number;
  genre: string | null;
  sport: string | null;
  kickoffAt: number | null;
  recoveryPending: boolean;
  pinned?: boolean;
  archived?: boolean;
};

/** Keep a source-version handoff only while moving inside the same shoot. */
export function shootContextHref(key: string, tab: ShootTab, currentHref: string) {
  const url = new URL(currentHref, "https://workspace.invalid");
  return shootRoute(currentHref)?.key === key
    ? `${shootWorkspaceHref(key, tab, url.search)}${url.hash}`
    : shootWorkspaceHref(key, tab);
}
export function shootAssistantHref(key: string, currentHref?: string) {
  const target = parseShootKey(key);
  if (!target) throw new Error("This shoot link is invalid.");
  if (currentHref && shootRoute(currentHref)?.key === key) {
    const binding = canonicalShootBinding(currentHref, true);
    if (binding?.kind !== "ready") throw new Error("This shoot source link is invalid.");
    const url = new URL(currentHref, "https://workspace.invalid");
    if (target.kind === "project") {
      // Preserve the already-serialized values: numeric-looking frame IDs must remain strings.
      for (const [from, to] of [
        ["project", "workspaceProject"],
        ["deliveryFrame", "workspaceFrame"],
        ["deliveryVersion", "workspaceVersion"],
        ["deliveryHandoff", "workspaceHandoff"],
      ] as const) {
        const value = url.searchParams.get(from);
        if (value !== null) {
          url.searchParams.set(to, value);
          url.searchParams.delete(from);
        }
      }
      url.searchParams.set("workspaceProject", target.id);
    } else url.searchParams.set("shoot", target.id);
    return `/workspace${url.search}${url.hash}`;
  }
  return `/workspace?${target.kind === "project" ? "workspaceProject" : "shoot"}=${encodeURIComponent(target.id)}`;
}
export function shootUpdatedLabel(timestamp: number) {
  if (!Number.isFinite(timestamp) || !Number.isFinite(new Date(timestamp).getTime()))
    return "Update date unavailable";
  return `Updated ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp)}`;
}
/** Directory counts cover Cull only; an independent Develop catalog may contain more photos. */
export function shootPhotoCountLabel(kind: ShootSummary["kind"], count: number) {
  if (kind === "shoot" && count === 0) return null;
  return `${count.toLocaleString()} ${kind === "shoot" ? "Cull " : ""}${count === 1 ? "photo" : "photos"}`;
}
export function shootSummaryDetail(row: ShootSummary) {
  const count = shootPhotoCountLabel(row.kind, row.photoCount);
  return [row.sport ?? row.genre ?? count, shootUpdatedLabel(row.updatedAt)]
    .filter(Boolean)
    .join(" · ");
}
/** Existing schemas have no kickoff/sport fields. Never infer them from titles or modification dates. */
export function summarizeShoots(
  shoots: readonly RecentShoot[],
  projects: readonly Project[],
  organization: Readonly<Record<string, ShootOrganization>> = {},
): ShootSummary[] {
  return [
    ...shoots.map((row): ShootSummary => ({
      key: row.id,
      id: row.id,
      kind: "shoot",
      title: row.title,
      photoCount: row.count,
      updatedAt: row.updatedAt,
      genre: null,
      sport: null,
      kickoffAt: null,
      recoveryPending: row.recoveryPending,
      pinned: organization[row.id]?.pinned ?? false,
      archived: organization[row.id]?.archived ?? false,
    })),
    ...projects.map((row): ShootSummary => ({
      key: `project:${row.id}`,
      id: row.id,
      kind: "project",
      title: row.title,
      photoCount: row.frames.length,
      updatedAt: Date.parse(row.updatedAt),
      genre: row.genre,
      sport: null,
      kickoffAt: null,
      recoveryPending: false,
      pinned: organization[`project:${row.id}`]?.pinned ?? false,
      archived: organization[`project:${row.id}`]?.archived ?? false,
    })),
  ].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      (Number.isFinite(b.updatedAt) ? b.updatedAt : 0) -
        (Number.isFinite(a.updatedAt) ? a.updatedAt : 0) ||
      a.key.localeCompare(b.key),
  );
}
export function shootsInNext24Hours(rows: readonly ShootSummary[], now = Date.now()) {
  return rows.filter(
    (row) =>
      row.kickoffAt !== null &&
      Number.isFinite(row.kickoffAt) &&
      row.kickoffAt >= now &&
      row.kickoffAt < now + 24 * 60 * 60 * 1000,
  );
}
export async function loadShootSummaries(scope: string, includeLocalProjects: boolean) {
  const [shoots, projects, organization] = await Promise.all([
    listRecentShoots(scope),
    // The separate Project repository belongs to the local single-user workspace, not to cloud accounts.
    includeLocalProjects ? listProjects() : Promise.resolve([]),
    listShootOrganization(scope),
  ]);
  return summarizeShoots(shoots, projects, organization);
}
export function useShootNavigationData(scope: string, includeLocalProjects: boolean) {
  const owner = JSON.stringify([scope, includeLocalProjects]);
  const generation = useRef(0);
  const [state, setState] = useState<{
    owner: string;
    rows: ShootSummary[];
    loading: boolean;
    error: string;
  }>({ owner, rows: [], loading: true, error: "" });
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setState((old) => ({
      owner,
      rows: old.owner === owner ? old.rows : [],
      loading: true,
      error: "",
    }));
    try {
      const rows = await loadShootSummaries(scope, includeLocalProjects);
      if (generation.current === request) setState({ owner, rows, loading: false, error: "" });
    } catch (error) {
      if (generation.current === request)
        setState((old) => ({
          owner,
          rows: old.owner === owner ? old.rows : [],
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "Saved shoots could not be read. No records were changed.",
        }));
    }
  }, [scope, includeLocalProjects, owner]);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    void refresh();
    const changed = () => void refresh();
    window.addEventListener("lenslabs:shoots-changed", changed);
    window.addEventListener("lenslabs:projects-changed", changed);
    window.addEventListener("focus", changed);
    return () => {
      invalidate();
      window.removeEventListener("lenslabs:shoots-changed", changed);
      window.removeEventListener("lenslabs:projects-changed", changed);
      window.removeEventListener("focus", changed);
    };
  }, [refresh, invalidate]);
  const current = state.owner === owner ? state : { owner, rows: [], loading: true, error: "" };
  const scheduleKnown =
    current.rows.length > 0 && current.rows.every((row) => row.kickoffAt !== null);
  return {
    ...current,
    recents: current.rows.filter((row) => !row.archived).slice(0, 8),
    scheduleKnown,
    tonightCount: scheduleKnown ? shootsInNext24Hours(current.rows).length : null,
    refresh,
  };
}
