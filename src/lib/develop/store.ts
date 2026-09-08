import { z } from "zod";
import { cropRect, DEFAULT_EDITS, type Shot } from "../imaging";
import {
  cloneDevelopSettings,
  defaultDevelopSettings,
  developSettingsSchema,
  DEVELOP_ENGINE_LIMITS,
  type DevelopSettings,
} from "./contract";

/** Deliberately separate from Studio's databases. Develop never writes a Studio session. */
export const DEVELOP_DATABASE_NAME = "foto-develop-v1";
export const DEVELOP_HISTORY_LIMIT = 200;
const STORES = { photos: "photos", documents: "documents", presets: "presets" } as const;
const nonempty = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value.trim().length > 0, "An identifier cannot be blank.");
const nameSchema = z.string().trim().min(1).max(100);
const revisionSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER - 1);
const historySchema = z
  .object({
    id: nonempty,
    label: nameSchema,
    settings: developSettingsSchema,
    at: z.number().finite().nonnegative(),
  })
  .strict();
const snapshotSchema = z
  .object({
    id: nonempty,
    name: nameSchema,
    settings: developSettingsSchema,
    at: z.number().finite().nonnegative(),
  })
  .strict();
const metadataSchema = z
  .object({
    rating: z.number().int().min(0).max(5),
    flag: z.enum(["pick", "reject"]).nullable(),
    colorLabel: z.enum(["red", "yellow", "green", "blue", "purple"]).nullable(),
  })
  .strict();
const initialStateSchema = z
  .object({ settings: developSettingsSchema, metadata: metadataSchema })
  .strict();
export const developDocumentSchema = z
  .object({
    photoId: nonempty,
    revision: revisionSchema,
    history: z
      .array(historySchema)
      .min(1)
      .max(DEVELOP_HISTORY_LIMIT + 1),
    cursor: z.number().int().nonnegative(),
    snapshots: z.array(snapshotSchema).max(50),
    metadata: metadataSchema,
    updatedAt: z.number().finite().nonnegative(),
  })
  .strict()
  .superRefine((doc, context) => {
    if (doc.cursor >= doc.history.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "History cursor is outside the saved history.",
      });
    if (new Set(doc.history.map((entry) => entry.id)).size !== doc.history.length)
      context.addIssue({ code: z.ZodIssueCode.custom, message: "History IDs must be unique." });
    if (new Set(doc.snapshots.map((entry) => entry.id)).size !== doc.snapshots.length)
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Snapshot IDs must be unique." });
  });
const presetSchema = z
  .object({
    id: nonempty,
    name: nameSchema,
    settings: developSettingsSchema,
    revision: revisionSchema,
    updatedAt: z.number().finite().nonnegative(),
  })
  .strict();

export type DevelopHistoryEntry = z.infer<typeof historySchema>;
export type DevelopSnapshot = z.infer<typeof snapshotSchema>;
export type DevelopDocument = z.infer<typeof developDocumentSchema>;
export type DevelopPreset = z.infer<typeof presetSchema>;

export type DevelopPhotoInput = {
  id: string;
  name: string;
  width: number;
  height: number;
  isRaw: boolean;
  sourceBlob: Blob | null;
  previewBlob: Blob | null;
  previewOrigin?: "embedded" | "raw-demosaic" | "raster" | "unknown";
  sourceFileName: string;
  sourceLastModified: number;
  sourceDigest: string | null;
  /** Consumed only when the photo is first inserted; never stored alongside its media. */
  initialState?: z.infer<typeof initialStateSchema>;
};
export type DevelopPhoto = Omit<DevelopPhotoInput, "initialState"> & {
  sourceAvailable: boolean;
  createdAt: number;
};
export type DevelopLibrary = {
  photos: DevelopPhoto[];
  documents: Record<string, DevelopDocument>;
  presets: DevelopPreset[];
};
export type DevelopStoreChange = { kind: "photos" | "documents" | "presets"; ids: string[] };
export type DevelopStoreOptions = { scope: string; libraryId: string; factory?: IDBFactory };

function uniqueId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
  );
}
function timestamp(): number {
  return Date.now();
}
function documentCopy(document: DevelopDocument): DevelopDocument {
  return developDocumentSchema.parse(document);
}
function sameSettings(a: DevelopSettings, b: DevelopSettings): boolean {
  return JSON.stringify(cloneDevelopSettings(a)) === JSON.stringify(cloneDevelopSettings(b));
}

export function createDevelopDocument(
  photoId: string,
  settings = defaultDevelopSettings(),
): DevelopDocument {
  const now = timestamp();
  return developDocumentSchema.parse({
    photoId,
    revision: 0,
    history: [
      { id: uniqueId(), label: "Original", settings: cloneDevelopSettings(settings), at: now },
    ],
    cursor: 0,
    snapshots: [],
    metadata: { rating: 0, flag: null, colorLabel: null },
    updatedAt: now,
  });
}
/** A transferred Studio treatment is undoable back to the untouched source. */
export function developDocumentForImport(input: DevelopPhotoInput): DevelopDocument {
  const original = createDevelopDocument(input.id);
  if (!input.initialState) return original;
  const initial = initialStateSchema.parse(input.initialState);
  return documentCopy({
    ...pushHistory(original, initial.settings, "Studio settings"),
    metadata: initial.metadata,
  });
}
/** Returns a deep copy, so manipulating controls cannot silently change undo history. */
export function currentRecipe(document: DevelopDocument): DevelopSettings {
  const checked = documentCopy(document);
  return cloneDevelopSettings(checked.history[checked.cursor]!.settings);
}
export function pushHistory(
  document: DevelopDocument,
  settings: DevelopSettings,
  label = "Adjustment",
): DevelopDocument {
  const checked = documentCopy(document);
  const recipe = cloneDevelopSettings(settings);
  if (sameSettings(currentRecipe(checked), recipe)) return checked;
  const at = timestamp();
  let history = [
    ...checked.history.slice(0, checked.cursor + 1),
    { id: uniqueId(), label: nameSchema.parse(label), settings: recipe, at },
  ];
  // Keep Original forever and the latest 200 steps; named snapshots are independent.
  if (history.length > DEVELOP_HISTORY_LIMIT + 1)
    history = [history[0]!, ...history.slice(-DEVELOP_HISTORY_LIMIT)];
  return { ...checked, history, cursor: history.length - 1, updatedAt: at };
}
export function undoHistory(document: DevelopDocument): DevelopDocument {
  const checked = documentCopy(document);
  return checked.cursor === 0
    ? checked
    : { ...checked, cursor: checked.cursor - 1, updatedAt: timestamp() };
}
export function redoHistory(document: DevelopDocument): DevelopDocument {
  const checked = documentCopy(document);
  return checked.cursor >= checked.history.length - 1
    ? checked
    : { ...checked, cursor: checked.cursor + 1, updatedAt: timestamp() };
}
export function jumpToHistory(document: DevelopDocument, cursor: number): DevelopDocument {
  return documentCopy({ ...document, cursor, updatedAt: timestamp() });
}
export function addSnapshot(document: DevelopDocument, name: string): DevelopDocument {
  const checked = documentCopy(document);
  if (checked.snapshots.length >= 50)
    throw new Error("This photo already has 50 snapshots. Remove an unused snapshot first.");
  return documentCopy({
    ...checked,
    snapshots: [
      ...checked.snapshots,
      {
        id: uniqueId(),
        name: nameSchema.parse(name),
        settings: currentRecipe(checked),
        at: timestamp(),
      },
    ],
    updatedAt: timestamp(),
  });
}
export function restoreSnapshot(document: DevelopDocument, snapshotId: string): DevelopDocument {
  const checked = documentCopy(document);
  const snapshot = checked.snapshots.find((item) => item.id === snapshotId);
  if (!snapshot) throw new Error("That snapshot is no longer available.");
  return pushHistory(checked, snapshot.settings, `Snapshot: ${snapshot.name}`.slice(0, 100));
}
export function removeSnapshot(document: DevelopDocument, snapshotId: string): DevelopDocument {
  const checked = documentCopy(document);
  return {
    ...checked,
    snapshots: checked.snapshots.filter((item) => item.id !== snapshotId),
    updatedAt: timestamp(),
  };
}
export function createDevelopPreset(name: string, settings: DevelopSettings): DevelopPreset {
  return presetSchema.parse({
    id: uniqueId(),
    name,
    settings,
    revision: 0,
    updatedAt: timestamp(),
  });
}

/** Includes an in-progress gesture without changing the live documents or pretending it saved. */
export function developRecoveryDocuments(
  documents: Record<string, DevelopDocument>,
  selectedId: string | null,
  draft: DevelopSettings,
): Record<string, DevelopDocument> {
  const recovered: Record<string, DevelopDocument> = Object.create(null);
  for (const [id, document] of Object.entries(documents)) recovered[id] = documentCopy(document);
  if (selectedId && recovered[selectedId])
    recovered[selectedId] = pushHistory(recovered[selectedId]!, draft, "Recovered adjustment");
  return recovered;
}

export class DevelopSaveConflict extends Error {
  constructor(public readonly recordId: string) {
    super(
      "This photo or preset changed in another tab. Your edits are still in memory; reload its saved version before continuing.",
    );
    this.name = "DevelopSaveConflict";
  }
}
export class DevelopStorageUnavailable extends Error {
  constructor(
    message = "Local Develop storage is unavailable. Your originals have not been changed.",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DevelopStorageUnavailable";
  }
}
function storageError(error: unknown): Error {
  if (error instanceof DevelopSaveConflict || error instanceof DevelopStorageUnavailable)
    return error;
  if (error instanceof DOMException && error.name === "QuotaExceededError")
    return new DevelopStorageUnavailable(
      "There is not enough browser storage to save this import. Free device storage and try again; your original files are untouched.",
      { cause: error },
    );
  return error instanceof Error
    ? error
    : new DevelopStorageUnavailable(undefined, { cause: error });
}
function checkedPhoto(input: DevelopPhotoInput): DevelopPhotoInput {
  nonempty.parse(input.id);
  nonempty.parse(input.name);
  nonempty.parse(input.sourceFileName);
  for (const dimension of [input.width, input.height])
    if (!Number.isSafeInteger(dimension) || dimension < 0 || dimension > 100000)
      throw new Error("Invalid photo dimensions.");
  if (!Number.isFinite(input.sourceLastModified) || input.sourceLastModified < 0)
    throw new Error("Invalid photo modification time.");
  if (typeof input.isRaw !== "boolean") throw new Error("Invalid photo format.");
  if (
    input.previewOrigin !== undefined &&
    !["embedded", "raw-demosaic", "raster", "unknown"].includes(input.previewOrigin)
  )
    throw new Error("Invalid preview origin.");
  for (const blob of [input.sourceBlob, input.previewBlob])
    if (blob !== null && (!(blob instanceof Blob) || blob.size === 0))
      throw new Error("Photo data is empty or invalid.");
  if (
    input.sourceDigest !== null &&
    (typeof input.sourceDigest !== "string" || input.sourceDigest.length > 200)
  )
    throw new Error("Invalid photo identity.");
  const initialState =
    input.initialState === undefined ? undefined : initialStateSchema.parse(input.initialState);
  return {
    ...input,
    previewOrigin: input.previewOrigin ?? "unknown",
    ...(initialState ? { initialState } : {}),
  };
}
/** Parameter migration, not a promise of identical pixels across the two renderers. */
export function developInitialStateFromShot(shot: Shot): z.infer<typeof initialStateSchema> {
  const legacy = { ...DEFAULT_EDITS, ...shot.edits };
  const signed = (value: number) => {
    if (!Number.isFinite(value))
      throw new Error("This Studio photo has an invalid saved adjustment.");
    return Math.max(-100, Math.min(100, value));
  };
  const settings = defaultDevelopSettings();
  // Studio applies a 1 + exposure/100 gain. Map that gain to EV; the separate
  // Adobe wire convention (/20) would greatly amplify ordinary Studio edits.
  // Native Develop operates in linear light, so this is not pixel equivalence.
  settings.exposure = Math.max(
    -5,
    Math.min(5, Math.log2(Math.max(1 / 32, 1 + signed(legacy.exposure) / 100))),
  );
  settings.temperature = signed(legacy.temp);
  settings.contrast = signed(legacy.contrast);
  settings.highlights = signed(legacy.highlights);
  settings.shadows = signed(legacy.shadows);
  settings.saturation = signed(legacy.saturation);
  if (shot.width > 0 && shot.height > 0 && legacy.crop !== "orig") {
    const rect = cropRect(shot.width, shot.height, legacy.crop, shot.faces?.center);
    settings.crop = {
      ...settings.crop,
      x: rect.sx / shot.width,
      y: rect.sy / shot.height,
      width: Math.max(0.01, rect.sw / shot.width),
      height: Math.max(0.01, rect.sh / shot.height),
    };
    settings.crop.x = Math.min(settings.crop.x, 1 - settings.crop.width);
    settings.crop.y = Math.min(settings.crop.y, 1 - settings.crop.height);
  }
  const rating = shot.develop?.rating;
  const color = shot.develop?.label?.trim().toLowerCase();
  const parsedColor = metadataSchema.shape.colorLabel.safeParse(color);
  return initialStateSchema.parse({
    settings,
    metadata: {
      rating:
        typeof rating === "number" && Number.isInteger(rating) && rating >= 0 && rating <= 5
          ? rating
          : 0,
      flag: shot.verdict === "keep" ? "pick" : shot.verdict === "reject" ? "reject" : null,
      colorLabel: parsedColor.success ? parsedColor.data : null,
    },
  });
}
/** A restored Studio preview stays a preview; it is never mislabeled as a RAW original. */
export function developPhotoFromShot(shot: Shot): DevelopPhotoInput {
  const sourceBlob = shot.sourceAvailable !== false && shot.file?.size > 0 ? shot.file : null;
  return checkedPhoto({
    id: `studio:${shot.id}`,
    name: shot.name,
    width: shot.width,
    height: shot.height,
    isRaw: shot.isRaw,
    sourceBlob,
    previewBlob: shot.previewBlob?.size ? shot.previewBlob : null,
    sourceFileName: sourceBlob instanceof File ? sourceBlob.name : shot.name,
    sourceLastModified: sourceBlob instanceof File ? sourceBlob.lastModified : 0,
    sourceDigest: shot.sourceDigest ?? null,
    initialState: developInitialStateFromShot(shot),
  });
}
/** Content-addressed identities prevent unrelated files with the same name from sharing edits. */
export async function developPhotoFromFile(
  file: File,
  previewBlob: Blob | null = null,
  dimensions = { width: 0, height: 0 },
): Promise<DevelopPhotoInput> {
  if (!file.size) throw new Error("This photo is empty.");
  if (file.size > DEVELOP_ENGINE_LIMITS.maxFileBytes)
    throw new Error("Choose a photo smaller than 128 MB for Develop.");
  if (!globalThis.crypto?.subtle)
    throw new Error("Secure photo fingerprinting is unavailable. Open FOTO on localhost or HTTPS.");
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const identity = `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  return checkedPhoto({
    id: identity,
    name: file.name,
    width: dimensions.width,
    height: dimensions.height,
    isRaw: /\.(nef|cr2|cr3|arw|dng|raf|orf|rw2|pef|srw|raw)$/i.test(file.name),
    sourceBlob: file,
    previewBlob,
    sourceFileName: file.name,
    sourceLastModified: file.lastModified,
    sourceDigest: identity,
  });
}

type PhotoRecord = { key: string; namespace: string; value: DevelopPhoto };
type DocumentRecord = { key: string; namespace: string; value: DevelopDocument };
type PresetRecord = { key: string; scope: string; value: DevelopPreset };
function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local Develop request failed."));
  });
}
function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DEVELOP_DATABASE_NAME, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(STORES.photos, { keyPath: "key" }).createIndex("namespace", "namespace");
      db.createObjectStore(STORES.documents, { keyPath: "key" }).createIndex(
        "namespace",
        "namespace",
      );
      db.createObjectStore(STORES.presets, { keyPath: "key" }).createIndex("scope", "scope");
    };
    request.onblocked = () => {
      blocked = true;
      reject(
        new DevelopStorageUnavailable(
          "Another FOTO tab is blocking local storage. Close the other tab and retry.",
        ),
      );
    };
    request.onerror = () => reject(storageError(request.error));
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
async function transaction<T>(
  database: IDBDatabase,
  names: string[],
  mode: IDBTransactionMode,
  action: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const tx = database.transaction(names, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("Local Develop transaction was not saved."));
    tx.onerror = () => {
      /* onabort is authoritative; avoid claiming a write on request success. */
    };
  });
  // A request can fail before action returns. Observe its abort now and rethrow below.
  void done.catch(() => undefined);
  try {
    const result = await action(tx);
    await done;
    return result;
  } catch (cause) {
    try {
      tx.abort();
    } catch {
      /* already finished */
    }
    throw storageError(cause);
  }
}

export function createDevelopStore(options: DevelopStoreOptions) {
  const scope = nonempty.parse(options.scope);
  const libraryId = nonempty.parse(options.libraryId);
  const namespace = JSON.stringify([scope, libraryId]);
  const key = (id: string) => JSON.stringify([scope, libraryId, nonempty.parse(id)]);
  const presetKey = (id: string) => JSON.stringify([scope, nonempty.parse(id)]);
  const listeners = new Set<(change: DevelopStoreChange) => void>();
  let channel: BroadcastChannel | null = null;
  let closed = false;
  async function database() {
    if (closed) throw new DevelopStorageUnavailable("This Develop library has been closed.");
    const factory = options.factory ?? globalThis.indexedDB;
    if (!factory) throw new DevelopStorageUnavailable();
    return openDatabase(factory);
  }
  function notify(change: DevelopStoreChange) {
    for (const listener of listeners) {
      try {
        listener(change);
      } catch {
        /* An observer cannot invalidate a committed write. */
      }
    }
    // A writer need not itself subscribe for other tabs to receive its commit.
    if (channel) channel.postMessage({ namespace, ...change });
    else if (typeof BroadcastChannel !== "undefined") {
      try {
        const publisher = new BroadcastChannel(`foto-develop:${scope}`);
        publisher.postMessage({ namespace, ...change });
        publisher.close();
      } catch {
        /* Optimistic revisions remain authoritative when messaging is unavailable. */
      }
    }
  }
  return {
    namespace,
    async loadLibrary(): Promise<DevelopLibrary> {
      const db = await database();
      try {
        return await transaction(db, Object.values(STORES), "readonly", async (tx) => {
          const [photoRecords, documentRecords, presetRecords] = await Promise.all([
            requestResult(
              tx.objectStore(STORES.photos).index("namespace").getAll(namespace),
            ) as Promise<PhotoRecord[]>,
            requestResult(
              tx.objectStore(STORES.documents).index("namespace").getAll(namespace),
            ) as Promise<DocumentRecord[]>,
            requestResult(tx.objectStore(STORES.presets).index("scope").getAll(scope)) as Promise<
              PresetRecord[]
            >,
          ]);
          const documents: Record<string, DevelopDocument> = Object.create(null);
          for (const record of documentRecords) {
            const doc = documentCopy(record.value);
            if (record.key !== key(doc.photoId) || record.namespace !== namespace)
              throw new Error("The saved Develop edit index is invalid.");
            documents[doc.photoId] = doc;
          }
          const photos = photoRecords
            .map((record) => {
              const input = checkedPhoto(record.value);
              if (record.key !== key(input.id) || record.namespace !== namespace)
                throw new Error("The saved Develop photo index is invalid.");
              if (!documents[input.id])
                throw new Error(
                  "A saved photo is missing its Develop edits. Importing is paused to protect your library.",
                );
              if (!Number.isFinite(record.value.createdAt))
                throw new Error("The saved Develop photo date is invalid.");
              return {
                ...input,
                createdAt: record.value.createdAt,
                sourceAvailable: Boolean(input.sourceBlob?.size),
              };
            })
            .sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name));
          const presets = presetRecords
            .map((record) => {
              const preset = presetSchema.parse(record.value);
              if (record.key !== presetKey(preset.id) || record.scope !== scope)
                throw new Error("The saved preset index is invalid.");
              return preset;
            })
            .sort((a, b) => a.name.localeCompare(b.name));
          return { photos, documents, presets };
        });
      } finally {
        db.close();
      }
    },
    /** Merge-only imports: existing edits and saved originals are never replaced. */
    async addPhotos(inputs: DevelopPhotoInput[]): Promise<DevelopPhoto[]> {
      const checked = inputs.map(checkedPhoto);
      if (new Set(checked.map((photo) => photo.id)).size !== checked.length)
        throw new Error("The import contains duplicate photo IDs.");
      if (!checked.length) return [];
      const db = await database();
      try {
        const photos = await transaction(
          db,
          [STORES.photos, STORES.documents],
          "readwrite",
          async (tx) => {
            const photosStore = tx.objectStore(STORES.photos),
              documentsStore = tx.objectStore(STORES.documents);
            const existing = await Promise.all(
              checked.map(async (input) => ({
                input,
                photo: (await requestResult(photosStore.get(key(input.id)))) as
                  PhotoRecord | undefined,
              })),
            );
            const output: DevelopPhoto[] = [];
            for (const { input, photo } of existing) {
              const { initialState: _initialState, ...media } = input;
              const previous = photo ? checkedPhoto(photo.value) : null;
              if (
                previous?.sourceDigest &&
                input.sourceDigest &&
                previous.sourceDigest !== input.sourceDigest
              )
                throw new Error(
                  "This photo ID belongs to a different original. Import it as a separate photo.",
                );
              if (
                previous &&
                !(!previous.sourceBlob && input.sourceBlob) &&
                !(!previous.previewBlob && input.previewBlob) &&
                !(!previous.sourceDigest && input.sourceDigest) &&
                !(!previous.width && input.width) &&
                !(!previous.height && input.height)
              ) {
                // Opening Develop again must not rewrite hundreds of unchanged RAW blobs.
                output.push({ ...photo!.value, sourceAvailable: Boolean(previous.sourceBlob) });
                continue;
              }
              const value: DevelopPhoto = previous
                ? {
                    ...photo!.value,
                    sourceBlob: previous.sourceBlob ?? input.sourceBlob,
                    previewBlob: previous.previewBlob ?? input.previewBlob,
                    previewOrigin: previous.previewBlob
                      ? (previous.previewOrigin ?? "unknown")
                      : (input.previewOrigin ?? "unknown"),
                    sourceDigest: previous.sourceDigest ?? input.sourceDigest,
                    sourceFileName: previous.sourceBlob
                      ? previous.sourceFileName
                      : input.sourceFileName,
                    sourceLastModified: previous.sourceBlob
                      ? previous.sourceLastModified
                      : input.sourceLastModified,
                    width: previous.width || input.width,
                    height: previous.height || input.height,
                    sourceAvailable: Boolean(previous.sourceBlob ?? input.sourceBlob),
                  }
                : { ...media, sourceAvailable: Boolean(input.sourceBlob), createdAt: timestamp() };
              photosStore.put({ key: key(value.id), namespace, value } satisfies PhotoRecord);
              if (!previous)
                documentsStore.add({
                  key: key(value.id),
                  namespace,
                  value: developDocumentForImport(input),
                } satisfies DocumentRecord);
              output.push(value);
            }
            return output;
          },
        );
        notify({ kind: "photos", ids: photos.map((photo) => photo.id) });
        return photos;
      } finally {
        db.close();
      }
    },
    async saveDocuments(
      updates: { document: DevelopDocument; expectedRevision?: number }[],
    ): Promise<DevelopDocument[]> {
      const checked = updates.map(({ document, expectedRevision }) => ({
        document: documentCopy(document),
        expectedRevision: revisionSchema.parse(expectedRevision ?? document.revision),
      }));
      if (new Set(checked.map(({ document }) => document.photoId)).size !== checked.length)
        throw new Error("A photo appears twice in this edit batch.");
      if (!checked.length) return [];
      const db = await database();
      try {
        const result = await transaction(
          db,
          [STORES.documents, STORES.photos],
          "readwrite",
          async (tx) => {
            const store = tx.objectStore(STORES.documents);
            const records = await Promise.all(
              checked.map(async (update) => {
                const [record, photo] = await Promise.all([
                  requestResult(store.get(key(update.document.photoId))) as Promise<
                    DocumentRecord | undefined
                  >,
                  requestResult(tx.objectStore(STORES.photos).getKey(key(update.document.photoId))),
                ]);
                return { ...update, record, photo };
              }),
            );
            const documents = records.map(({ document, expectedRevision, record, photo }) => {
              if (photo === undefined || !record)
                throw new Error("Import this photo before saving its Develop edits.");
              const previous = documentCopy(record.value);
              if (previous.revision !== expectedRevision)
                throw new DevelopSaveConflict(document.photoId);
              return documentCopy({
                ...document,
                revision: expectedRevision + 1,
                updatedAt: timestamp(),
              });
            });
            for (const value of documents)
              store.put({ key: key(value.photoId), namespace, value } satisfies DocumentRecord);
            return documents;
          },
        );
        notify({ kind: "documents", ids: result.map((document) => document.photoId) });
        return result;
      } finally {
        db.close();
      }
    },
    async saveDocument(
      document: DevelopDocument,
      expectedRevision = document.revision,
    ): Promise<DevelopDocument> {
      const documents = await this.saveDocuments([{ document, expectedRevision }]);
      return documents[0]!;
    },
    async savePreset(
      input: DevelopPreset,
      expectedRevision = input.revision,
    ): Promise<DevelopPreset> {
      const checked = presetSchema.parse(input);
      revisionSchema.parse(expectedRevision);
      const db = await database();
      try {
        const result = await transaction(db, [STORES.presets], "readwrite", async (tx) => {
          const store = tx.objectStore(STORES.presets);
          const previous = (await requestResult(store.get(presetKey(checked.id)))) as
            PresetRecord | undefined;
          if ((previous?.value.revision ?? 0) !== expectedRevision)
            throw new DevelopSaveConflict(checked.id);
          const value = presetSchema.parse({
            ...checked,
            revision: expectedRevision + 1,
            updatedAt: timestamp(),
          });
          store.put({ key: presetKey(value.id), scope, value } satisfies PresetRecord);
          return value;
        });
        notify({ kind: "presets", ids: [result.id] });
        return result;
      } finally {
        db.close();
      }
    },
    subscribe(listener: (change: DevelopStoreChange) => void): () => void {
      if (closed) throw new DevelopStorageUnavailable("This Develop library has been closed.");
      listeners.add(listener);
      if (!channel && typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel(`foto-develop:${scope}`);
        channel.onmessage = (event: MessageEvent<DevelopStoreChange & { namespace: string }>) => {
          if (
            !event.data ||
            !["photos", "documents", "presets"].includes(event.data.kind) ||
            !Array.isArray(event.data.ids)
          )
            return;
          if (event.data.kind !== "presets" && event.data.namespace !== namespace) return;
          for (const callback of listeners) {
            try {
              callback(event.data);
            } catch {
              /* observer only */
            }
          }
        };
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          channel?.close();
          channel = null;
        }
      };
    },
    close() {
      closed = true;
      listeners.clear();
      channel?.close();
      channel = null;
    },
  };
}
export type DevelopStore = ReturnType<typeof createDevelopStore>;
