export type ProjectCollection = {
  id: string;
  title: string;
  projectIds: string[];
};

const KEY = "celinen.project.collections.v1";

function favorites(): ProjectCollection {
  return { id: "favorites", title: "Favorites", projectIds: [] };
}

export function readProjectCollections(): ProjectCollection[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [favorites()];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [favorites()];
    const rows = parsed
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const item = row as Record<string, unknown>;
        if (typeof item.id !== "string" || typeof item.title !== "string") return null;
        const projectIds = Array.isArray(item.projectIds)
          ? item.projectIds.filter((id): id is string => typeof id === "string").slice(0, 200)
          : [];
        return { id: item.id.slice(0, 80), title: item.title.slice(0, 80), projectIds };
      })
      .filter((row): row is ProjectCollection => Boolean(row));
    if (!rows.some((row) => row.id === "favorites")) rows.unshift(favorites());
    return rows.slice(0, 40);
  } catch {
    return [favorites()];
  }
}

export function writeProjectCollections(rows: ProjectCollection[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows.slice(0, 40)));
  } catch {
    /* private mode */
  }
}
