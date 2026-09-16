import { assertProjectAdvance, now, projectBlobIds, validateProject, type Project } from "./model";
import { hashBlob } from "./archive";

const DB = "lenslabs-projects-v1";
const DOCUMENTS = "projects";
const BLOBS = "blobs";
const verified = new WeakMap<Blob, Promise<string>>();
function digest(blob: Blob) {
  let value = verified.get(blob);
  if (!value) {
    value = hashBlob(blob);
    verified.set(blob, value);
  }
  return value;
}
export function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Project storage request failed."));
  });
}
function completed(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error ?? new Error("Project transaction failed. Existing records were preserved."));
  });
}
async function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined")
    throw new Error("This browser cannot store local projects.");
  const request = indexedDB.open(DB, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(DOCUMENTS))
      request.result.createObjectStore(DOCUMENTS, { keyPath: "id" });
    if (!request.result.objectStoreNames.contains(BLOBS)) request.result.createObjectStore(BLOBS);
  };
  const db = await idbRequest(request);
  db.onversionchange = () => db.close();
  return db;
}

export async function readBlob(id: string): Promise<Blob | null> {
  const db = await open();
  try {
    const blob = await idbRequest(db.transaction(BLOBS).objectStore(BLOBS).get(id));
    return blob instanceof Blob ? blob : null;
  } finally {
    db.close();
  }
}

export async function listProjects(): Promise<Project[]> {
  const db = await open();
  try {
    const rows = await idbRequest(db.transaction(DOCUMENTS).objectStore(DOCUMENTS).getAll());
    return rows.map(validateProject).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } finally {
    db.close();
  }
}
export async function loadProject(id: string): Promise<Project> {
  const db = await open();
  try {
    const row = await idbRequest(db.transaction(DOCUMENTS).objectStore(DOCUMENTS).get(id));
    if (!row) throw new Error("Project not found on this device.");
    return validateProject(row);
  } finally {
    db.close();
  }
}
export async function readProjectBlobs(project: Project): Promise<Map<string, Blob>> {
  const db = await open();
  try {
    const tx = db.transaction(BLOBS);
    const store = tx.objectStore(BLOBS);
    const keys = projectBlobIds(project);
    const values = await Promise.all(keys.map((key) => idbRequest(store.get(key))));
    const blobs = new Map<string, Blob>();
    for (const [i, key] of keys.entries()) {
      const blob: unknown = values[i];
      if (!(blob instanceof Blob))
        throw new Error(
          "Project media is missing. Nothing was discarded; restore a verified archive.",
        );
      if ((await digest(blob)) !== key)
        throw new Error(
          "Stored media checksum failed. Restore a verified archive before using this project.",
        );
      blobs.set(key, blob);
    }
    return blobs;
  } finally {
    db.close();
  }
}

/** Hash work happens before the transaction; document and new media commit together. */
export async function commitProject(
  input: Project,
  blobs: ReadonlyMap<string, Blob> = new Map(),
  options: { create?: boolean; restore?: boolean } = {},
): Promise<Project> {
  const project = validateProject(input);
  const needed = new Set(projectBlobIds(project));
  for (const [key, blob] of blobs) {
    if (!needed.has(key)) throw new Error("Archive includes unrelated media.");
    if ((await digest(blob)) !== key)
      throw new Error("Media checksum failed; no project was changed.");
  }
  const db = await open();
  try {
    const tx = db.transaction([DOCUMENTS, BLOBS], "readwrite");
    const done = completed(tx);
    void done.catch(() => {});
    try {
      const store = tx.objectStore(DOCUMENTS);
      const raw = await idbRequest(store.get(project.id));
      const current = raw ? validateProject(raw) : null;
      if (options.restore && current) {
        if (JSON.stringify(current) !== JSON.stringify(project))
          throw new Error(
            "This project ID already has different work. Restore was refused; existing work is intact.",
          );
      } else if (options.create || options.restore) {
        if (current) throw new Error("Project already exists.");
      } else {
        if (!current) throw new Error("Project no longer exists. Reload before saving.");
        assertProjectAdvance(current, project);
      }
      const media = tx.objectStore(BLOBS);
      const existingKeys = new Set((await idbRequest(media.getAllKeys())).map(String));
      if ([...needed].some((key) => !existingKeys.has(key) && !blobs.has(key)))
        throw new Error("A referenced original or preview is missing.");
      for (const [key, blob] of blobs) {
        if (options.restore) media.put(blob, key);
        else if (!existingKeys.has(key)) media.add(blob, key);
      }
      const saved = options.restore
        ? project
        : validateProject({ ...project, revision: project.revision + 1, updatedAt: now() });
      store.put(saved);
      await done;
      if (typeof window !== "undefined")
        window.dispatchEvent(new Event("lenslabs:projects-changed"));
      return saved;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* already ended */
      }
      await done.catch(() => {});
      throw error;
    }
  } finally {
    db.close();
  }
}
