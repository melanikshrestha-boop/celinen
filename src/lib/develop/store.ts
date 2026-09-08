import { z } from "zod";
import { cropRect, DEFAULT_EDITS, type Shot } from "../imaging";
import { fingerprintSource } from "../studio/ingest";
import {
  assertPhotoNameAvailable,
  normalizePhotoDisplayName,
  renamedDevelopPhoto,
  uniquePhotoDisplayName,
  virtualCopyPhoto,
} from "./photo-management";
import { presetPackageMetadataSchema } from "./preset-package";
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
export const DEVELOP_RECOVERY_LIMITS = Object.freeze({
  maxBytes: 32 * 1024 * 1024,
  maxDocuments: 2000,
});
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
    packageMetadata: presetPackageMetadataSchema.optional(),
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
  /** Explicit source-attachment operation; never emitted by ordinary Studio imports. */
  reconnectOriginal?: true;
};
export type DevelopPhoto = Omit<DevelopPhotoInput, "initialState" | "reconnectOriginal"> & {
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
export type DevelopRecoveryTarget = Pick<DevelopStoreOptions, "scope" | "libraryId">;
export type DevelopRecovery = {
  version: 1;
  namespace: string;
  documents: Record<string, DevelopDocument>;
};
export type DevelopRecoveryPlan = {
  namespace: string;
  photoIds: string[];
  expectedRevisions: Record<string, number>;
  updates: { document: DevelopDocument; expectedRevision: number }[];
  unchangedPhotoIds: string[];
};
export type DevelopRecoveryResult = {
  documents: DevelopDocument[];
  restoredPhotoIds: string[];
  unchangedPhotoIds: string[];
};

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
export function createVirtualCopyDocument(
  source: DevelopDocument,
  photoId: string,
  now = timestamp(),
): DevelopDocument {
  const document = documentCopy(source);
  if (!photoId.startsWith("copy:") || photoId === document.photoId)
    throw new Error("A virtual copy needs a new copy identity.");
  return documentCopy({
    ...document,
    photoId,
    revision: 1,
    updatedAt: now,
    history: document.history.map((entry) => ({ ...entry, id: uniqueId() })),
    snapshots: document.snapshots.map((entry) => ({ ...entry, id: uniqueId() })),
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

function checkRecoverySize(text: string): void {
  if (
    typeof text !== "string" ||
    text.length > DEVELOP_RECOVERY_LIMITS.maxBytes ||
    new TextEncoder().encode(text).byteLength > DEVELOP_RECOVERY_LIMITS.maxBytes
  )
    throw new Error("Recovery files must be no larger than 32 MB. No saved edits were changed.");
}
function checkRecoveryCollections(rawDocument: unknown): void {
  if (!rawDocument || typeof rawDocument !== "object") return;
  const raw = rawDocument as Record<string, unknown>;
  const bounded = (value: unknown, limit: number) => {
    if (Array.isArray(value) && value.length > limit)
      throw new Error(
        "The recovery contains an invalid oversized edit history or settings collection.",
      );
  };
  // Zod array limits also validate their elements. Bound hostile collections before
  // parsing so a small JSON file containing millions of empty objects cannot expand
  // into millions of validation errors.
  bounded(raw["history"], DEVELOP_HISTORY_LIMIT + 1);
  bounded(raw["snapshots"], 50);
  const entries = [
    ...(Array.isArray(raw["history"]) ? raw["history"] : []),
    ...(Array.isArray(raw["snapshots"]) ? raw["snapshots"] : []),
  ];
  for (const entry of entries) {
    const settings = entry?.settings;
    if (!settings || typeof settings !== "object") continue;
    bounded(settings.curve, 16);
    bounded(settings.hsl, 8);
    bounded(settings.masks, DEVELOP_ENGINE_LIMITS.maxMasks);
    for (const channel of ["red", "green", "blue"]) bounded(settings.channelCurves?.[channel], 16);
  }
}
function checkedRecovery(input: unknown, target: DevelopRecoveryTarget): DevelopRecovery {
  const namespace = JSON.stringify([
    nonempty.parse(target.scope),
    nonempty.parse(target.libraryId),
  ]);
  const header = z
    .object({ version: z.literal(1), namespace: z.string().max(8192), documents: z.unknown() })
    .strict()
    .safeParse(input);
  if (!header.success)
    throw new Error("This is not a supported version 1 FOTO Develop recovery file.");
  if (header.data.namespace !== namespace)
    throw new Error(
      "This recovery belongs to a different workspace or project. Open its original Develop library.",
    );
  const rawDocuments = header.data.documents;
  if (!rawDocuments || typeof rawDocuments !== "object" || Array.isArray(rawDocuments))
    throw new Error("The recovery document index is invalid.");
  const entries = Object.entries(rawDocuments);
  if (!entries.length || entries.length > DEVELOP_RECOVERY_LIMITS.maxDocuments)
    throw new Error("A recovery must contain between 1 and 2,000 photo documents.");
  const documents: Record<string, DevelopDocument> = Object.create(null);
  for (const [id, rawDocument] of entries) {
    if (["__proto__", "prototype", "constructor"].includes(id))
      throw new Error("The recovery contains an invalid photo identifier.");
    checkRecoveryCollections(rawDocument);
    const result = developDocumentSchema.safeParse(rawDocument);
    if (!result.success)
      throw new Error(
        `Recovery edits for “${id.slice(0, 100)}” are invalid: ${result.error.issues[0]?.message ?? "Invalid document"}`,
      );
    if (id !== result.data.photoId)
      throw new Error("A recovery photo ID does not match its document index.");
    documents[id] = result.data;
  }
  const checked: DevelopRecovery = { version: 1, namespace, documents };
  // Revalidate the size for direct callers as well as the JSON file parser.
  checkRecoverySize(JSON.stringify(checked));
  return checked;
}

/** Reads existing recovery exports; never imports photo bytes, metadata, or a database. */
export function parseDevelopRecovery(text: string, target: DevelopRecoveryTarget): DevelopRecovery {
  checkRecoverySize(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("This recovery file is not valid JSON. No saved edits were changed.");
  }
  return checkedRecovery(parsed, target);
}

function recoverySelection(recovery: DevelopRecovery, photoIds: string[]): string[] {
  const checked = z
    .array(nonempty)
    .min(1)
    .max(DEVELOP_RECOVERY_LIMITS.maxDocuments)
    .parse(photoIds);
  if (new Set(checked).size !== checked.length)
    throw new Error("Select each recovery photo only once.");
  for (const id of checked)
    if (!Object.hasOwn(recovery.documents, id))
      throw new Error("A selected photo is not in this recovery file.");
  return checked;
}

/** Append a recoverable treatment without dropping saved redo steps or importing old metadata. */
function recoveredDocument(current: DevelopDocument, recovered: DevelopDocument): DevelopDocument {
  const checked = documentCopy(current);
  const settings = currentRecipe(recovered);
  const before = currentRecipe(checked);
  if (sameSettings(before, settings)) return checked;
  const at = timestamp();
  const entries: DevelopHistoryEntry[] = [];
  if (!sameSettings(checked.history.at(-1)!.settings, before))
    entries.push({ id: uniqueId(), label: "Before recovery", settings: before, at });
  entries.push({ id: uniqueId(), label: "Recovered adjustment", settings, at });
  if (checked.history.length + entries.length > DEVELOP_HISTORY_LIMIT + 1)
    throw new Error(
      "Recovery would exceed this photo’s 200-step history limit. Export your saved work before making room; no history was removed.",
    );
  return documentCopy({
    ...checked,
    history: [...checked.history, ...entries],
    cursor: checked.history.length + entries.length - 1,
    updatedAt: at,
  });
}

/** Read-only preview. Explicitly select photos, then pass its revision map to restoreRecovery. */
export function prepareDevelopRecovery(
  input: DevelopRecovery,
  library: DevelopLibrary,
  options: DevelopRecoveryTarget & { photoIds: string[] },
): DevelopRecoveryPlan {
  const recovery = checkedRecovery(input, options);
  const photoIds = recoverySelection(recovery, options.photoIds);
  const existingPhotoIds = new Set(library.photos.map((photo) => photo.id));
  const expectedRevisions: Record<string, number> = Object.create(null);
  const updates: DevelopRecoveryPlan["updates"] = [];
  const unchangedPhotoIds: string[] = [];
  for (const photoId of photoIds) {
    if (!existingPhotoIds.has(photoId) || !Object.hasOwn(library.documents, photoId))
      throw new Error(
        "A selected recovery photo is missing from this library. Reconnect or import its original into this project first.",
      );
    const current = documentCopy(library.documents[photoId]!);
    if (current.photoId !== photoId)
      throw new Error("The current Develop document index is invalid.");
    expectedRevisions[photoId] = current.revision;
    const document = recoveredDocument(current, recovery.documents[photoId]!);
    if (document.history.length === current.history.length) unchangedPhotoIds.push(photoId);
    else updates.push({ document, expectedRevision: current.revision });
  }
  return { namespace: recovery.namespace, photoIds, expectedRevisions, updates, unchangedPhotoIds };
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
  if (input.reconnectOriginal !== undefined && input.reconnectOriginal !== true)
    throw new Error("Invalid source reconnect operation.");
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
/**
 * A restored Studio snapshot has no bytes with which to compare fingerprint versions.
 * Keep a complete saved original instead of treating two algorithms as proof of a
 * different source. This is a no-op only: never use this exception to enrich media.
 */
export function canPreserveDevelopOriginalOnRestore(
  previous: DevelopPhotoInput,
  incoming: DevelopPhotoInput,
): boolean {
  const scheme = (digest: string | null) => {
    if (/^(?:sha256:)?[0-9a-f]{64}$/i.test(digest ?? "")) return "sha256";
    if (/^sha256-chain-v1:[0-9a-f]{64}$/i.test(digest ?? "")) return "sha256-chain-v1";
    return null;
  };
  const previousScheme = scheme(previous.sourceDigest);
  const incomingScheme = scheme(incoming.sourceDigest);
  return Boolean(
    previous.id === incoming.id &&
    previous.sourceBlob?.size &&
    incoming.sourceBlob === null &&
    !incoming.reconnectOriginal &&
    previousScheme &&
    incomingScheme &&
    previousScheme !== incomingScheme,
  );
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

/**
 * Explicit user-selected attachment only, never automatic filename reconciliation.
 * Historical records without a fingerprint may be attached only while their original
 * is missing. A filename match alone is not claimed as proof of historical identity.
 */
export async function reconnectDevelopPhoto(
  photo: DevelopPhoto,
  file: File,
  previewBlob: Blob,
  dimensions = { width: 0, height: 0 },
  previewOrigin: NonNullable<DevelopPhotoInput["previewOrigin"]> = "unknown",
): Promise<DevelopPhotoInput> {
  const expectedName = photo.sourceFileName || photo.name;
  const existing = checkedPhoto({ ...photo, sourceFileName: expectedName });
  if (file.name !== expectedName)
    throw new Error(
      `Choose the original named “${expectedName}”. No source or edits were changed.`,
    );
  if (!(previewBlob instanceof Blob) || !previewBlob.size || previewBlob.size > 32 * 1024 * 1024)
    throw new Error("Reconnect needs a valid decoded preview of the selected original.");
  if (photo.sourceAvailable && !existing.sourceBlob)
    throw new Error("This photo’s source state changed. Reload Develop before reconnecting it.");
  if (!existing.sourceDigest && (photo.sourceAvailable || existing.sourceBlob))
    throw new Error(
      "This photo already has an original. Its stored bytes will not be replaced by an unverified file.",
    );
  const incoming = await developPhotoFromFile(file, previewBlob, dimensions);
  if (existing.sourceDigest) {
    let matches = false;
    if (/^sha256:[0-9a-f]{64}$/i.test(existing.sourceDigest))
      matches = incoming.sourceDigest === existing.sourceDigest.toLowerCase();
    else if (/^[0-9a-f]{64}$/i.test(existing.sourceDigest))
      matches = incoming.sourceDigest === `sha256:${existing.sourceDigest.toLowerCase()}`;
    else if (/^sha256-chain-v1:[0-9a-f]{64}$/.test(existing.sourceDigest))
      matches = (await fingerprintSource(file)) === existing.sourceDigest;
    else
      throw new Error(
        "This saved source fingerprint cannot be verified. Import the file separately; the existing photo and edits remain unchanged.",
      );
    if (!matches)
      throw new Error(
        "The selected original has different bytes. The saved photo, source and edits were preserved.",
      );
  }
  if (existing.sourceBlob) {
    const originalReceipt = await developPhotoFromFile(
      new File([existing.sourceBlob], expectedName, { lastModified: existing.sourceLastModified }),
    );
    if (originalReceipt.sourceDigest !== incoming.sourceDigest)
      throw new Error(
        "The selected file differs from the stored original. No original was replaced.",
      );
  }
  return checkedPhoto({
    id: existing.id,
    name: existing.name,
    width: existing.width || incoming.width,
    height: existing.height || incoming.height,
    isRaw: existing.isRaw,
    sourceBlob: existing.sourceBlob ?? file,
    previewBlob,
    previewOrigin,
    sourceFileName: expectedName,
    sourceLastModified: existing.sourceLastModified || file.lastModified,
    sourceDigest: existing.sourceDigest ?? incoming.sourceDigest,
    reconnectOriginal: true,
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
              const {
                initialState: _initialState,
                reconnectOriginal: _reconnectOriginal,
                ...media
              } = input;
              const previous = photo ? checkedPhoto(photo.value) : null;
              if (input.reconnectOriginal && (!previous || !input.sourceBlob || !input.previewBlob))
                throw new Error(
                  "The reconnect target is no longer available in this Develop library. Reload before attaching the original.",
                );
              const refreshAttachedPreview = Boolean(
                input.reconnectOriginal && previous && !previous.sourceBlob && input.sourceBlob,
              );
              if (previous && canPreserveDevelopOriginalOnRestore(previous, input)) {
                output.push({ ...photo!.value, sourceAvailable: true });
                continue;
              }
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
                !(!previous.sourceBlob && !previous.sourceDigest && input.sourceDigest) &&
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
                    previewBlob: refreshAttachedPreview
                      ? input.previewBlob
                      : (previous.previewBlob ?? input.previewBlob),
                    previewOrigin:
                      !refreshAttachedPreview && previous.previewBlob
                        ? (previous.previewOrigin ?? "unknown")
                        : (input.previewOrigin ?? "unknown"),
                    sourceDigest:
                      previous.sourceDigest ?? (!previous.sourceBlob ? input.sourceDigest : null),
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
    /** Display name only: original filename, digest, media, and edit history are immutable here. */
    async renamePhoto(photoId: string, name: string, expectedName: string): Promise<DevelopPhoto> {
      const normalized = normalizePhotoDisplayName(name);
      nonempty.parse(expectedName);
      const db = await database();
      try {
        const result = await transaction(db, [STORES.photos], "readwrite", async (tx) => {
          const store = tx.objectStore(STORES.photos);
          const records = (await requestResult(
            store.index("namespace").getAll(namespace),
          )) as PhotoRecord[];
          const previous = records.find((record) => record.key === key(photoId));
          if (!previous || previous.namespace !== namespace)
            throw new Error("This photo is no longer available in this library.");
          checkedPhoto(previous.value);
          if (previous.value.id !== photoId) throw new Error("The saved photo index is invalid.");
          if (previous.value.name !== expectedName) throw new DevelopSaveConflict(photoId);
          if (previous.value.name === normalized) return previous.value;
          assertPhotoNameAvailable(
            normalized,
            records
              .filter((record) => record.value.id !== photoId)
              .map((record) => record.value.name),
          );
          const value = renamedDevelopPhoto(previous.value, normalized);
          store.put({ key: key(photoId), namespace, value } satisfies PhotoRecord);
          return value;
        });
        notify({ kind: "photos", ids: [photoId] });
        return result;
      } finally {
        db.close();
      }
    },
    /** One atomic local insert, using the saved source revision and never modifying its original. */
    async createVirtualCopy(
      sourcePhotoId: string,
      expectedRevision: number,
      name?: string,
    ): Promise<{ photo: DevelopPhoto; document: DevelopDocument }> {
      revisionSchema.parse(expectedRevision);
      if (name !== undefined) normalizePhotoDisplayName(name);
      const db = await database();
      try {
        const result = await transaction(
          db,
          [STORES.photos, STORES.documents],
          "readwrite",
          async (tx) => {
            const photos = tx.objectStore(STORES.photos),
              documents = tx.objectStore(STORES.documents);
            const [records, sourceRecord] = await Promise.all([
              requestResult(photos.index("namespace").getAll(namespace)) as Promise<PhotoRecord[]>,
              requestResult(documents.get(key(sourcePhotoId))) as Promise<
                DocumentRecord | undefined
              >,
            ]);
            const photoRecord = records.find((record) => record.key === key(sourcePhotoId));
            if (
              !photoRecord ||
              photoRecord.namespace !== namespace ||
              !sourceRecord ||
              sourceRecord.namespace !== namespace ||
              sourceRecord.key !== key(sourcePhotoId)
            )
              throw new Error("This photo and its edits are no longer available in this library.");
            checkedPhoto(photoRecord.value);
            if (photoRecord.value.id !== sourcePhotoId)
              throw new Error("The saved photo index is invalid.");
            const sourceDocument = documentCopy(sourceRecord.value);
            if (sourceDocument.photoId !== sourcePhotoId)
              throw new Error("The saved edit index is invalid.");
            if (sourceDocument.revision !== expectedRevision)
              throw new DevelopSaveConflict(sourcePhotoId);
            const names = records.map((record) => record.value.name);
            const copyName =
              name === undefined
                ? uniquePhotoDisplayName(photoRecord.value.name, names)
                : assertPhotoNameAvailable(name, names);
            const now = timestamp(),
              id = `copy:${uniqueId()}`;
            const photo = virtualCopyPhoto(photoRecord.value, id, copyName, now);
            checkedPhoto(photo);
            const document = createVirtualCopyDocument(sourceDocument, id, now);
            photos.add({ key: key(id), namespace, value: photo } satisfies PhotoRecord);
            documents.add({ key: key(id), namespace, value: document } satisfies DocumentRecord);
            return { photo, document };
          },
        );
        notify({ kind: "photos", ids: [result.photo.id] });
        return result;
      } finally {
        db.close();
      }
    },
    /** Explicit edit-only restore. Revision checks and the complete batch share one transaction. */
    async restoreRecovery(
      input: DevelopRecovery,
      options: { photoIds: string[]; expectedRevisions: Record<string, number> },
    ): Promise<DevelopRecoveryResult> {
      const recovery = checkedRecovery(input, { scope, libraryId });
      const photoIds = recoverySelection(recovery, options.photoIds);
      const revisions = z.record(revisionSchema).parse(options.expectedRevisions);
      if (
        Object.keys(revisions).length !== photoIds.length ||
        photoIds.some((id) => !Object.hasOwn(revisions, id))
      )
        throw new Error("Preview each selected recovery photo before confirming its restore.");
      const db = await database();
      try {
        const result = await transaction(
          db,
          [STORES.documents, STORES.photos],
          "readwrite",
          async (tx) => {
            const documentsStore = tx.objectStore(STORES.documents);
            const records = await Promise.all(
              photoIds.map(async (photoId) => ({
                photoId,
                document: (await requestResult(documentsStore.get(key(photoId)))) as
                  DocumentRecord | undefined,
                photo: await requestResult(tx.objectStore(STORES.photos).getKey(key(photoId))),
              })),
            );
            const result: DevelopRecoveryResult = {
              documents: [],
              restoredPhotoIds: [],
              unchangedPhotoIds: [],
            };
            for (const { photoId, document: record, photo } of records) {
              if (!record || photo === undefined)
                throw new Error(
                  "A selected recovery photo is no longer in this library. No edits were restored.",
                );
              const current = documentCopy(record.value);
              if (
                current.photoId !== photoId ||
                record.namespace !== namespace ||
                record.key !== key(photoId)
              )
                throw new Error("The saved Develop edit index is invalid.");
              if (current.revision !== revisions[photoId]) throw new DevelopSaveConflict(photoId);
              const restored = recoveredDocument(current, recovery.documents[photoId]!);
              if (restored.history.length === current.history.length) {
                result.documents.push(current);
                result.unchangedPhotoIds.push(photoId);
              } else {
                result.documents.push(
                  documentCopy({ ...restored, revision: current.revision + 1 }),
                );
                result.restoredPhotoIds.push(photoId);
              }
            }
            const changedIds = new Set(result.restoredPhotoIds);
            for (const value of result.documents)
              if (changedIds.has(value.photoId))
                documentsStore.put({
                  key: key(value.photoId),
                  namespace,
                  value,
                } satisfies DocumentRecord);
            return result;
          },
        );
        if (result.restoredPhotoIds.length)
          notify({ kind: "documents", ids: result.restoredPhotoIds });
        return result;
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
