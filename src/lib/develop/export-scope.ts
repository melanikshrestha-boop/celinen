import { z } from "zod";
import { PHOTO_ID_MAX_LENGTH } from "../photo-identity";
import { jpegDimensions } from "../delivery/media-integrity";
import { makeZip } from "../zip";
import { cloneDevelopSettings, DEVELOP_ENGINE_LIMITS, type DevelopSettings } from "./contract";
import { renderDevelop } from "./client";
import { currentRecipe, type DevelopImportCommit, type DevelopPhoto } from "./store";
import { uniquePhotoExportFilename } from "./photo-management";

export const DEVELOP_BATCH_LIMITS = Object.freeze({ count: 200, bytes: 100 * 1024 * 1024 });
const lifetime = 24 * 60 * 60 * 1000;
const maxHandoffBytes = 1024 * 1024;
const scopeSchema = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    namespace: z.string().min(1).max(8192),
    kind: z.enum(["keepers", "selected", "group"]),
    label: z.string().trim().min(1).max(120),
    photoIds: z
      .array(
        z
          .string()
          .min(1)
          .max(PHOTO_ID_MAX_LENGTH + 7),
      )
      .min(1)
      .max(DEVELOP_BATCH_LIMITS.count),
    createdAt: z.number().int().nonnegative().safe(),
  })
  .strict();
export type DevelopExportScope = Readonly<Omit<z.infer<typeof scopeSchema>, "photoIds">> & {
  readonly photoIds: readonly string[];
};
type HandoffStorage = Pick<Storage, "getItem" | "setItem">;
const key = (id: string) => `foto.develop-export-scope.v1:${id}`;
function validateScope(value: unknown, namespace: string, now = Date.now()): DevelopExportScope {
  const scope = scopeSchema.parse(value);
  if (scope.namespace !== namespace || scope.createdAt > now || now - scope.createdAt >= lifetime)
    throw new Error(
      "This export scope belongs to another shoot or has expired. Select the photos again in Cull.",
    );
  if (new Set(scope.photoIds).size !== scope.photoIds.length)
    throw new Error("An export scope cannot repeat a photo.");
  return Object.freeze({ ...scope, photoIds: Object.freeze(scope.photoIds) });
}

/** Scope is not approval: reload may reuse IDs, but never reuses rendered-version authority. */
export function saveDevelopExportScope(
  storage: HandoffStorage,
  namespace: string,
  input: { kind: DevelopExportScope["kind"]; photoIds: readonly string[]; label: string },
  now = Date.now(),
): string {
  const scope = validateScope(
    { ...input, version: 1, id: crypto.randomUUID(), namespace, createdAt: now },
    namespace,
    now,
  );
  const serialized = JSON.stringify(scope);
  if (new TextEncoder().encode(serialized).byteLength > maxHandoffBytes)
    throw new Error("This export scope is too large. Choose fewer photos.");
  if (storage.getItem(key(scope.id)) !== null)
    throw new Error("This export reference already exists. Select the photos again.");
  storage.setItem(key(scope.id), serialized);
  if (storage.getItem(key(scope.id)) !== serialized)
    throw new Error("The export scope could not be saved. No photos were exported.");
  return scope.id;
}

export function readDevelopExportScope(
  storage: Pick<Storage, "getItem">,
  namespace: string,
  href: string,
  now = Date.now(),
): DevelopExportScope | null {
  const params = new URL(href, "https://workspace.invalid").searchParams;
  const tokens = params.getAll("exportScope");
  if (!tokens.length) return null;
  if (tokens.length !== 1 || !z.string().uuid().safeParse(tokens[0]).success)
    throw new Error("This export reference is invalid. Select the photos again in Cull.");
  if (
    [
      "deliveryFrame",
      "deliveryVersion",
      "deliveryHandoff",
      "workspaceFrame",
      "workspaceVersion",
      "workspaceHandoff",
    ].some((name) => params.has(name))
  )
    throw new Error("An exact delivery version cannot be replaced by a working-edit batch export.");
  const serialized = storage.getItem(key(tokens[0]!));
  if (!serialized || new TextEncoder().encode(serialized).byteLength > maxHandoffBytes)
    throw new Error(
      "This export scope is unavailable in this tab. Select the photos again in Cull.",
    );
  const scope = validateScope(JSON.parse(serialized), namespace, now);
  if (scope.id !== tokens[0])
    throw new Error("This export reference does not match its saved scope.");
  return scope;
}

export type DevelopBatchStore = {
  namespace: string;
  readPhotosWithDocuments(ids: readonly string[]): Promise<DevelopImportCommit>;
};
export type DevelopBatchConfig = { edge: number; quality: number; sourceMode: "raw" | "preview" };
type BatchFrame = {
  id: string;
  name: string;
  filename: string;
  revision: number;
  recipe: DevelopSettings;
  source: Blob;
  sourceMode: "raw" | "preview";
  sourceHash: string;
  identity: string;
};
export type DevelopBatchPlan = {
  readonly scope: DevelopExportScope;
  readonly config: Readonly<DevelopBatchConfig>;
  readonly frames: readonly Readonly<BatchFrame>[];
};
type BatchImage = {
  readonly id: string;
  readonly blob: Blob;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
};
export type DevelopBatchProof = {
  readonly plan: DevelopBatchPlan;
  readonly images: readonly BatchImage[];
};
const plans = new WeakSet<object>(),
  proofs = new WeakSet<object>();
const stale = () =>
  new Error(
    "This export set changed. Preview a fresh set before downloading; no partial ZIP was offered.",
  );
async function sha256(blob: Blob, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const value = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  signal?.throwIfAborted();
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function sourceFor(photo: DevelopPhoto, mode: DevelopBatchConfig["sourceMode"]) {
  if (!photo.sourceAvailable || !photo.sourceBlob?.size)
    throw new Error(
      `${photo.name}: reconnect the original before batch export. No saved preview was substituted.`,
    );
  const source = photo.isRaw && mode === "preview" ? photo.previewBlob : photo.sourceBlob;
  if (!source?.size || source.size > DEVELOP_ENGINE_LIMITS.maxFileBytes)
    throw new Error(`${photo.name}: this processing source is unavailable or exceeds 128 MiB.`);
  return {
    source,
    sourceMode: photo.isRaw && mode === "raw" ? ("raw" as const) : ("preview" as const),
  };
}
function identity(photo: DevelopPhoto, document: DevelopImportCommit["documents"][string]) {
  return JSON.stringify({
    id: photo.id,
    name: photo.name,
    sourceDigest: photo.sourceDigest,
    sourceAvailable: photo.sourceAvailable,
    isRaw: photo.isRaw,
    previewOrigin: photo.previewOrigin,
    revision: document.revision,
    recipe: currentRecipe(document),
    flag: document.metadata.flag,
  });
}
async function capture(
  scope: DevelopExportScope,
  store: DevelopBatchStore,
  config: DevelopBatchConfig,
  signal?: AbortSignal,
) {
  validateScope(scope, store.namespace);
  signal?.throwIfAborted();
  const snapshot = await store.readPhotosWithDocuments(scope.photoIds);
  signal?.throwIfAborted();
  if (
    snapshot.photos.length !== scope.photoIds.length ||
    new Set(snapshot.photos.map((photo) => photo.id)).size !== scope.photoIds.length
  )
    throw stale();
  const byId = new Map(snapshot.photos.map((photo) => [photo.id, photo]));
  const filenames: string[] = [],
    frames: BatchFrame[] = [];
  for (const id of scope.photoIds) {
    const photo = byId.get(id),
      document = snapshot.documents[id];
    if (
      !photo ||
      !document ||
      document.photoId !== id ||
      !Number.isSafeInteger(document.revision) ||
      document.revision < 0
    )
      throw stale();
    if (scope.kind === "keepers" && document.metadata.flag !== "pick") throw stale();
    const filename = uniquePhotoExportFilename(photo.name, filenames);
    filenames.push(filename);
    const { source, sourceMode } = sourceFor(photo, config.sourceMode);
    frames.push({
      id,
      name: photo.name,
      filename,
      revision: document.revision,
      recipe: cloneDevelopSettings(currentRecipe(document)),
      source,
      sourceMode,
      sourceHash: await sha256(source, signal),
      identity: identity(photo, document),
    });
  }
  return frames;
}
function freezeRecipe<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeRecipe(child);
    Object.freeze(value);
  }
  return value;
}
export async function createDevelopBatchPlan(
  scope: DevelopExportScope,
  store: DevelopBatchStore,
  config: DevelopBatchConfig,
  signal?: AbortSignal,
): Promise<DevelopBatchPlan> {
  if (
    !Number.isInteger(config.edge) ||
    config.edge < 32 ||
    config.edge > DEVELOP_ENGINE_LIMITS.maxEdge ||
    !Number.isFinite(config.quality) ||
    config.quality < 50 ||
    config.quality > 100 ||
    !["raw", "preview"].includes(config.sourceMode)
  )
    throw new Error("Invalid batch export settings.");
  const checked = validateScope(scope, store.namespace);
  const frames = await capture(checked, store, config, signal);
  const plan = Object.freeze({
    scope: checked,
    config: Object.freeze({ ...config }),
    frames: Object.freeze(
      frames.map((frame) => Object.freeze({ ...frame, recipe: freezeRecipe(frame.recipe) })),
    ),
  });
  plans.add(plan);
  return plan;
}
export async function assertDevelopBatchCurrent(
  plan: DevelopBatchPlan,
  store: DevelopBatchStore,
  signal?: AbortSignal,
) {
  if (!plans.has(plan)) throw stale();
  const current = await capture(plan.scope, store, plan.config, signal);
  if (
    current.some(
      (frame, index) =>
        frame.identity !== plan.frames[index]?.identity ||
        frame.sourceHash !== plan.frames[index]?.sourceHash,
    )
  )
    throw stale();
}

/** Serial native renders only. A partial attempt is never a downloadable proof set. */
export async function prepareDevelopBatch(
  plan: DevelopBatchPlan,
  store: DevelopBatchStore,
  options: {
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
    render?: typeof renderDevelop;
  } = {},
): Promise<DevelopBatchProof> {
  await assertDevelopBatchCurrent(plan, store, options.signal);
  const images: BatchImage[] = [];
  let bytes = 0;
  for (const frame of plan.frames) {
    options.signal?.throwIfAborted();
    const blob = await (options.render ?? renderDevelop)(frame.source, frame.recipe, {
      edge: plan.config.edge,
      quality: plan.config.quality / 100,
      sourceMode: frame.sourceMode,
      nativeOnly: true,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    options.signal?.throwIfAborted();
    bytes += blob.size;
    if (!blob.size || blob.size > 32 * 1024 * 1024 || bytes > DEVELOP_BATCH_LIMITS.bytes)
      throw new Error(
        "This export set exceeds the 100 MiB ZIP limit. Choose fewer photos or a smaller size. No partial ZIP was offered.",
      );
    const dimensions = jpegDimensions(new Uint8Array(await blob.arrayBuffer()));
    if (
      Math.max(dimensions.width, dimensions.height) > plan.config.edge ||
      dimensions.width * dimensions.height > DEVELOP_ENGINE_LIMITS.maxOutputPixels
    )
      throw new Error("The native export dimensions do not match this request.");
    images.push(
      Object.freeze({
        id: frame.id,
        blob,
        sha256: await sha256(blob, options.signal),
        ...dimensions,
      }),
    );
    options.onProgress?.(images.length, plan.frames.length);
  }
  await assertDevelopBatchCurrent(plan, store, options.signal);
  const proof = Object.freeze({ plan, images: Object.freeze(images) });
  proofs.add(proof);
  return proof;
}

/** Only the exact prepared bytes are archived; newer recipes never inherit this proof. */
export async function developBatchZip(
  proof: DevelopBatchProof,
  store: DevelopBatchStore,
  signal?: AbortSignal,
): Promise<Blob> {
  if (!proofs.has(proof) || proof.images.length !== proof.plan.frames.length) throw stale();
  await assertDevelopBatchCurrent(proof.plan, store, signal);
  const entries = [];
  for (const [index, frame] of proof.plan.frames.entries()) {
    signal?.throwIfAborted();
    const image = proof.images[index];
    if (image?.id !== frame.id || (await sha256(image.blob, signal)) !== image.sha256)
      throw stale();
    entries.push({ path: frame.filename, bytes: new Uint8Array(await image.blob.arrayBuffer()) });
  }
  // ZIP overhead is included in the limit. Recheck after async byte reads too.
  await assertDevelopBatchCurrent(proof.plan, store, signal);
  const blob = makeZip(entries);
  signal?.throwIfAborted();
  if (blob.size > DEVELOP_BATCH_LIMITS.bytes)
    throw new Error("This ZIP exceeds 100 MiB. Choose fewer photos; no download was requested.");
  return blob;
}
