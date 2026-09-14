import { z } from "zod";
import { workspaceStorageKey } from "../workspace-storage";
import { prepareShootCreation } from "../product-lifecycle";
export const shootIdSchema = z.union([z.string().uuid(), z.literal("legacy")]);
export const shootTitleSchema = z.string().trim().min(1, "Give this shoot a name.").max(200);
const rowSchema = z
  .object({
    id: shootIdSchema,
    title: shootTitleSchema,
    named: z.boolean(),
    count: z.number().int().nonnegative(),
    updatedAt: z.number(),
    recoveredFromDevice: z.boolean().default(false),
    recoveryPending: z.boolean().default(false),
  })
  .passthrough();
export const shootOrganizationKeySchema = z.union([
  shootIdSchema,
  z.string().regex(/^project:[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i),
]);
const organizationSchema = z
  .object({
    key: shootOrganizationKeySchema,
    pinned: z.boolean().default(false),
    archived: z.boolean().default(false),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  })
  .passthrough();
export type ShootOrganization = z.infer<typeof organizationSchema>;
export type ShootOrganizationPatch = Partial<Pick<ShootOrganization, "pinned" | "archived">>;
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
  const req = indexedDB.open(workspaceStorageKey("lenslabs-shoot-directory-v1", scope), 2);
  req.onupgradeneeded = () => {
    if (!req.result.objectStoreNames.contains("shoots"))
      req.result.createObjectStore("shoots", { keyPath: "id" });
    if (!req.result.objectStoreNames.contains("organization"))
      req.result.createObjectStore("organization", { keyPath: "key" });
  };
  return new Promise<IDBDatabase>((resolve, reject) => {
    let rejected = false;
    req.onerror = () => reject(req.error ?? new Error("Shoot directory could not open."));
    req.onblocked = () => {
      rejected = true;
      reject(new Error("Close older FOTO tabs and retry. Your saved shoots are unchanged."));
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      if (rejected) db.close();
      else resolve(db);
    };
  });
}
export async function listShootOrganization(
  scope: string,
): Promise<Record<string, ShootOrganization>> {
  const db = await open(scope);
  try {
    const rows = await request(db.transaction("organization").objectStore("organization").getAll());
    return Object.fromEntries(
      rows.map((value) => {
        const row = organizationSchema.parse(value);
        return [row.key, row];
      }),
    );
  } finally {
    db.close();
  }
}
export function mergeShootOrganization(
  key: string,
  existing: unknown,
  patch: ShootOrganizationPatch,
  expected: ShootOrganizationPatch = {},
): ShootOrganization {
  shootOrganizationKeySchema.parse(key);
  const parsedPatch = z
    .object({ pinned: z.boolean().optional(), archived: z.boolean().optional() })
    .strict()
    .parse(patch);
  const checked = Object.fromEntries(
    Object.entries(parsedPatch).filter(([, value]) => value !== undefined),
  ) as ShootOrganizationPatch;
  const guard = z
    .object({ pinned: z.boolean().optional(), archived: z.boolean().optional() })
    .strict()
    .parse(expected);
  if (!Object.keys(checked).length) throw new Error("Choose a shoot organization action.");
  const before = organizationSchema.parse(existing ?? { key });
  if (before.key !== key) throw new Error("Wrong shoot organization record.");
  for (const field of ["pinned", "archived"] as const)
    if (
      checked[field] !== undefined &&
      guard[field] !== undefined &&
      before[field] !== guard[field] &&
      before[field] !== checked[field]
    )
      throw new Error("This row changed in another tab. Refresh before trying again.");
  return organizationSchema.parse({ ...before, ...checked, revision: before.revision + 1 });
}
/** Metadata only: never changes the shoot/session, Project revision, photo bytes or Develop library. */
export async function updateShootOrganization(
  scope: string,
  key: string,
  patch: ShootOrganizationPatch,
  expected: ShootOrganizationPatch = {},
) {
  // Validate before opening storage; read/patch/put below share one serialized transaction.
  mergeShootOrganization(key, undefined, patch);
  const db = await open(scope);
  try {
    const tx = db.transaction("organization", "readwrite");
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
        reject(tx.error ?? new Error("Shoot organization could not be saved."));
    });
    void done.catch(() => {});
    try {
      const store = tx.objectStore("organization"),
        before = await request(store.get(key));
      const next = mergeShootOrganization(key, before, patch, expected);
      store.put(next);
      await done;
      window.dispatchEvent(new Event("lenslabs:shoots-changed"));
      return next;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* Completed/aborted transaction. */
      }
      await done.catch(() => {});
      throw error;
    }
  } finally {
    db.close();
  }
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
  const reportCreation = prepareShootCreation(scope, id);
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
    if (
      (!existing || (!before.named && before.count === 0)) &&
      !patch.recovered &&
      !patch.recoveryPending &&
      !("recoveredFromDevice" in before && before.recoveredFromDevice) &&
      !("recoveryPending" in before && before.recoveryPending) &&
      (patch.name !== undefined || (patch.count ?? 0) > 0)
    )
      void reportCreation();
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
