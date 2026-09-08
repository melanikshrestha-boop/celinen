import { z } from "zod";
import { workspaceStorageKey } from "../workspace-storage";
export const shootIdSchema = z.union([z.string().uuid(), z.literal("legacy")]);
export const shootTitleSchema = z.string().trim().min(1, "Give this shoot a name.").max(200);
const rowSchema = z.object({
  id: shootIdSchema,
  title: shootTitleSchema,
  named: z.boolean(),
  count: z.number().int().nonnegative(),
  updatedAt: z.number(),
  recoveredFromDevice: z.boolean().default(false),
  recoveryPending: z.boolean().default(false),
});
export type RecentShoot = z.infer<typeof rowSchema>;
export const shootHref = (id: string) =>
  `/workspace?shoot=${encodeURIComponent(shootIdSchema.parse(id))}`;
export function studioDatabaseKey(scope: string, shootId?: string) {
  const id = shootId === undefined ? "legacy" : shootIdSchema.parse(shootId);
  return workspaceStorageKey(
    id === "legacy" ? "lens-os-local-studio" : `lens-os-local-studio:shoot:${id}`,
    scope,
  );
}
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function open(scope: string) {
  const req = indexedDB.open(workspaceStorageKey("lenslabs-shoot-directory-v1", scope), 1);
  req.onupgradeneeded = () => req.result.createObjectStore("shoots", { keyPath: "id" });
  return request(req);
}
/** Empty Untitled leftovers from old auto-minted workspace IDs. Real Shoot #N rows stay. */
export function isGhostShoot(row: Pick<RecentShoot, "title" | "count" | "recoveryPending">) {
  if (row.recoveryPending || row.count > 0) return false;
  return /^(untitled (shoot|project)|new chat)$/i.test(row.title.trim());
}

export async function listRecentShoots(scope: string): Promise<RecentShoot[]> {
  const db = await open(scope);
  try {
    const rows = await request(db.transaction("shoots").objectStore("shoots").getAll());
    return rows
      .map((row) => rowSchema.parse(row))
      .filter((row) => (row.count > 0 || row.named) && !isGhostShoot(row))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    db.close();
  }
}
async function update(
  scope: string,
  id: string,
  patch: {
    count?: number;
    title?: string;
    name?: string;
    recovered?: boolean;
    recoveryPending?: boolean;
  },
) {
  shootIdSchema.parse(id);
  if (patch.name !== undefined) shootTitleSchema.parse(patch.name);
  const db = await open(scope);
  try {
    const tx = db.transaction("shoots", "readwrite");
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
        reject(tx.error ?? new Error("Shoot name could not be saved."));
    });
    const store = tx.objectStore("shoots");
    void done.catch(() => {});
    const existing = await request(store.get(id));
    const before = existing
      ? rowSchema.parse(existing)
      : { id, title: "Untitled shoot", named: false, count: 0, updatedAt: 0 };
    store.put(
      rowSchema.parse({
        ...before,
        count: patch.count ?? before.count,
        title:
          patch.name?.trim() ?? (before.named ? before.title : patch.title?.trim() || before.title),
        named: patch.name !== undefined || before.named,
        recoveredFromDevice:
          patch.recovered ?? ("recoveredFromDevice" in before ? before.recoveredFromDevice : false),
        recoveryPending:
          patch.recoveryPending ?? ("recoveryPending" in before ? before.recoveryPending : false),
        updatedAt: Date.now(),
      }),
    );
    await done;
    window.dispatchEvent(new Event("lenslabs:shoots-changed"));
  } finally {
    db.close();
  }
}
export const rememberShoot = (scope: string, id: string, count: number, title: string) =>
  update(scope, id, { count, title });
/** Naming does not touch photo/session revisions, so active autosaves cannot conflict. */
export const renameShoot = (scope: string, id: string, name: string) => update(scope, id, { name });

const memorySeq = new Map<string, number>();
const shootSeqKey = (scope: string) => {
  try {
    return workspaceStorageKey("foto.shoot-seq.v1", scope);
  } catch {
    return `foto.shoot-seq.v1:memory:${scope}`;
  }
};

/** Spotify-style: Shoot #1, #2… the number is creation order, not the current title. */
export function nextShootLabel(scope: string) {
  const key = shootSeqKey(scope);
  let n = memorySeq.get(key) ?? 0;
  try {
    const stored = Number(localStorage.getItem(key) ?? String(n));
    if (Number.isFinite(stored) && stored > n) n = stored;
  } catch {
    /* Memory holds the counter if storage is blocked. */
  }
  if (!Number.isFinite(n) || n < 0) n = 0;
  n += 1;
  memorySeq.set(key, n);
  try {
    localStorage.setItem(key, String(n));
  } catch {
    /* Memory still advances in this tab. */
  }
  return `Shoot #${n}`;
}
export const markDeviceRecovery = (scope: string, id: string) =>
  update(scope, id, { recovered: true, recoveryPending: false });
/** Register before copying media so interrupted recovery remains discoverable and retryable. */
export const startDeviceRecovery = (scope: string, id: string, name: string) =>
  update(scope, id, { name, recoveryPending: true });
