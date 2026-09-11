import { DEFAULT_EDITS, type Shot } from "../imaging";
import {
  createDevelopStore,
  developDocumentSchema,
  type DevelopDocument,
  type DevelopPhoto,
  type DevelopStoreOptions,
} from "./store";

export type { ShootManifest, ShootManifestView } from "./store";
type FlushParticipant = { owner: symbol; flush: () => Promise<boolean> };
type FlushGroup = {
  owners: number;
  participants: Map<string, FlushParticipant>;
  running: Promise<boolean> | null;
};
const groups: Map<string, FlushGroup> = import.meta.hot?.data["shootFlushGroups"] ?? new Map();
if (import.meta.hot)
  import.meta.hot.dispose((data) => {
    data["shootFlushGroups"] = groups;
  });

/** One durable catalogue, with a shared in-window save fence for each account/shoot. */
export function createShootRepository(options: DevelopStoreOptions) {
  const store = createDevelopStore(options);
  const namespace = store.namespace;
  let group = groups.get(namespace);
  if (!group) {
    group = { owners: 0, participants: new Map(), running: null };
    groups.set(namespace, group);
  }
  const shared = group;
  shared.owners++;
  const owner = Symbol(namespace);
  let closed = false;
  const open = () => {
    if (closed) throw new Error("This shoot repository has been closed.");
  };
  return {
    store,
    namespace,
    read() {
      open();
      return store.loadLibraryWithManifest();
    },
    readManifest() {
      open();
      return store.readManifest();
    },
    saveManifest: store.saveManifest,
    subscribe: store.subscribe,
    /** Participants drain their own save queue. They must not recursively call this flush. */
    registerFlushParticipant(id: string, flush: () => Promise<boolean>): () => void {
      open();
      if (!id.trim() || id.length > 200 || typeof flush !== "function")
        throw new Error("A save participant needs a stable name and a flush function.");
      if (shared.participants.has(id))
        throw new Error("This shoot already has that save participant.");
      const participant = { owner, flush };
      shared.participants.set(id, participant);
      return () => {
        if (shared.participants.get(id) === participant) shared.participants.delete(id);
      };
    },
    flush(): Promise<boolean> {
      open();
      if (shared.running) return shared.running;
      const completed = new Set<FlushParticipant>();
      const run = async () => {
        try {
          // A participant mounted during a pending flush must join this same fence.
          for (;;) {
            const pending = [...shared.participants.values()].filter(
              (entry) => !completed.has(entry),
            );
            if (!pending.length) return true;
            if (completed.size + pending.length > 1000) return false;
            for (const entry of pending) {
              if (![...shared.participants.values()].includes(entry)) continue;
              completed.add(entry);
              if (!(await entry.flush())) return false;
            }
          }
        } catch {
          return false;
        }
      };
      const promise = Promise.resolve()
        .then(run)
        .finally(() => {
          if (shared.running === promise) shared.running = null;
          if (!shared.owners && !shared.running) groups.delete(namespace);
        });
      shared.running = promise;
      return promise;
    },
    close() {
      if (closed) return;
      closed = true;
      for (const [id, entry] of shared.participants)
        if (entry.owner === owner) shared.participants.delete(id);
      shared.owners--;
      if (!shared.owners && !shared.running) groups.delete(namespace);
      store.close();
    },
  };
}
export type ShootRepository = ReturnType<typeof createShootRepository>;

/**
 * Review projection only. Native recipe/history remain in the Develop document.
 * No URLs are allocated and no legacy store is written. The returned legacy Edits
 * are an archived reference, never a conversion of native curves, masks or grading.
 */
export function projectDevelopPhotoToStudio(
  photo: DevelopPhoto,
  document: DevelopDocument,
): {
  shot: Shot;
  treatment: "native";
  legacyAvailable: boolean;
  needsAnalysis: boolean;
} {
  const saved = developDocumentSchema.parse(document);
  if (saved.photoId !== photo.id)
    throw new Error("This editing document belongs to another photo.");
  const legacy = photo.legacy;
  const metadata = legacy ? structuredClone(legacy.metadata) : {};
  const original = photo.sourceAvailable && photo.sourceBlob?.size ? photo.sourceBlob : null;
  const preview = photo.previewBlob?.size ? photo.previewBlob : null;
  const file =
    original instanceof File
      ? original
      : new File(
          original ? [original] : preview ? [preview] : [],
          original ? photo.sourceFileName : `${photo.sourceFileName}.preview.jpg`,
          {
            type: original?.type || preview?.type || "image/jpeg",
            lastModified: original ? photo.sourceLastModified : 0,
          },
        );
  const oldEdits = metadata["edits"] as Shot["edits"] | undefined;
  const oldDevelop = metadata["develop"] as Shot["develop"];
  const needsAnalysis = !(
    typeof metadata["hash"] === "string" &&
    metadata["hash"].length > 0 &&
    typeof metadata["sharpness"] === "number" &&
    !metadata["error"]
  );
  const shot: Shot = {
    sharpness: 0,
    brightness: 0,
    clippedHighlights: 0,
    clippedShadows: 0,
    hash: "",
    score: 0,
    flags: [],
    ...metadata,
    id: legacy && photo.id === `studio:${legacy.shotId}` ? legacy.shotId : photo.id,
    name: photo.name,
    file,
    isRaw: photo.isRaw,
    width: photo.width,
    height: photo.height,
    sizeMb: original
      ? original.size / 1e6
      : typeof metadata["sizeMb"] === "number"
        ? metadata["sizeMb"]
        : 0,
    previewUrl: null,
    ...(preview ? { previewBlob: preview } : {}),
    sourceAvailable: Boolean(original),
    ...(photo.sourceDigest ? { sourceDigest: photo.sourceDigest } : {}),
    verdict:
      saved.metadata.flag === "pick"
        ? "keep"
        : saved.metadata.flag === "reject"
          ? "reject"
          : "undecided",
    edits: { ...DEFAULT_EDITS, ...oldEdits },
    develop: {
      ...oldDevelop,
      origin: oldDevelop?.origin ?? "lens os",
      at: oldDevelop?.at ?? 0,
      rating: saved.metadata.rating,
      label: saved.metadata.colorLabel,
    },
  };
  return { shot, treatment: "native", legacyAvailable: Boolean(legacy), needsAnalysis };
}
