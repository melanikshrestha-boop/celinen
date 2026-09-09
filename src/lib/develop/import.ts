import { supportedPhoto } from "../studio/ingest";
import {
  developDocumentSchema,
  developPhotoFromFile,
  type DevelopImportCommit,
  type DevelopPhoto,
  type DevelopPhotoInput,
} from "./store";

export type DevelopImportProgress = { index: number; total: number; fileName: string };
export type DevelopImportRegistration = DevelopImportProgress & { file: File };
export type DevelopImportFailure = { fileName: string; message: string };
export type DevelopImportReport = {
  imported: DevelopPhoto[];
  duplicates: number;
  failures: DevelopImportFailure[];
  stopped: boolean;
  fatalError: string | null;
  selectedId: string | null;
};
export type DevelopImportOptions = {
  existingIds: Iterable<string>;
  preparePreview: (
    file: File,
    identified: DevelopPhotoInput,
    signal: AbortSignal,
  ) => Promise<DevelopPhotoInput>;
  signal?: AbortSignal;
  /** Default one preserves existing callers; a coordinator may own up to four preparations. */
  preparationConcurrency?: number;
  /** RAW preview preparation has its own limit (one by default, never more than two). */
  rawPreparationConcurrency?: number;
  /** Metadata registration only: no source read, decoded preview, or durable save is implied. */
  onRegistered?: (progress: DevelopImportRegistration) => void;
  onProgress?: (progress: DevelopImportProgress) => void;
  onPrepared?: (input: DevelopPhotoInput, progress: DevelopImportProgress) => void;
  onFileFailure?: (failure: DevelopImportFailure, progress: DevelopImportProgress) => void;
  onDuplicate?: (progress: DevelopImportProgress) => void;
} & (
  | {
      save: (input: DevelopPhotoInput) => Promise<DevelopPhoto[]>;
      onCommitted?: never;
    }
  | {
      save: (input: DevelopPhotoInput) => Promise<DevelopImportCommit>;
      /** Observer only: receives exact saved documents after the transaction completes. */
      onCommitted?: (
        receipt: DevelopImportCommit,
        progress: DevelopImportProgress,
      ) => void | Promise<void>;
    }
);
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "This photo could not be imported.";
function observer(run: () => void) {
  try {
    run();
  } catch {
    /* Display observers cannot change source/commit outcomes. */
  }
}
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
type Prepared =
  | { kind: "prepared"; value: DevelopPhotoInput }
  | { kind: "duplicate" }
  | { kind: "failed"; message: string }
  | { kind: "stopped" };

function copyPrepared(input: DevelopPhotoInput): DevelopPhotoInput {
  const { sourceBlob, previewBlob, ...metadata } = input;
  return { ...structuredClone(metadata), sourceBlob, previewBlob };
}

/**
 * A viewable preview is not a complete import. Keep missing-source and missing-preview
 * records eligible for exact content-ID enrichment by addPhotos, which preserves edits.
 * This does not match legacy records by filename or authorize an original replacement.
 */
export function completeDevelopImportIds(
  photos: readonly Pick<DevelopPhoto, "id" | "sourceBlob" | "previewBlob">[],
): string[] {
  return photos
    .filter(
      (photo) =>
        photo.sourceBlob instanceof Blob &&
        photo.sourceBlob.size > 0 &&
        photo.previewBlob instanceof Blob &&
        photo.previewBlob.size > 0,
    )
    .map((photo) => photo.id);
}

/**
 * Only successful save receipts count as imports. File/decode failures are isolated;
 * storage failures stop the batch because later writes must not hide a persistence fault.
 * Existing IDs are caller-selected complete sources, never filename-only legacy matches.
 */
export async function runDevelopImport(
  files: readonly File[],
  options: DevelopImportOptions,
): Promise<DevelopImportReport> {
  const report: DevelopImportReport = {
    imported: [],
    duplicates: 0,
    failures: [],
    stopped: false,
    fatalError: null,
    selectedId: null,
  };
  const knownIds = new Set(options.existingIds);
  const controller = new AbortController();
  const signal = controller.signal;
  const batch = [...files];
  const concurrency = options.preparationConcurrency ?? 1;
  const rawConcurrency = options.rawPreparationConcurrency ?? 1;
  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 4 ||
    !Number.isInteger(rawConcurrency) ||
    rawConcurrency < 1 ||
    rawConcurrency > 2
  )
    throw new Error("Import preparation allows one to four jobs and one to two RAW jobs.");
  const progress = (index: number): DevelopImportProgress => ({
    index: index + 1,
    total: batch.length,
    fileName: batch[index]!.name,
  });
  // Hash reads overlap, but identity claims are ordered. A faster later copy may
  // not steal the first file's name, and a failed decode must permit a later retry.
  const identities = Array.from({ length: batch.length + 1 }, barrier);
  identities[0]!.release();
  const claims = new Map<string, { promise: Promise<boolean>; resolve: (ok: boolean) => void }>();
  const preparations = new Map<number, Promise<Prepared>>();
  const rawWaiters = new Set<() => void>();
  let nextStart = 0,
    rawActive = 0;
  const stop = () => {
    if (!signal.aborted) controller.abort(options.signal?.reason);
    for (const identity of identities) identity.release();
    for (const wake of rawWaiters) wake();
    rawWaiters.clear();
  };
  options.signal?.addEventListener("abort", stop, { once: true });
  if (options.signal?.aborted) stop();

  const prepare = async (index: number): Promise<Prepared> => {
    const file = batch[index]!;
    let claim: { promise: Promise<boolean>; resolve: (ok: boolean) => void } | undefined;
    let claimId: string | undefined;
    let rawOwned = false;
    try {
      signal.throwIfAborted();
      observer(() => options.onProgress?.(progress(index)));
      if (!supportedPhoto(file)) throw new Error("This file type is not a supported photo.");
      const identified = await developPhotoFromFile(file, undefined, undefined, signal);
      await identities[index]!.promise;
      signal.throwIfAborted();
      if (knownIds.has(identified.id)) return { kind: "duplicate" };
      let previous = claims.get(identified.id);
      // Reserve synchronously before releasing the next identity admission.
      if (!previous) {
        let resolve!: (ok: boolean) => void;
        claim = {
          promise: new Promise<boolean>((done) => {
            resolve = done;
          }),
          resolve: (ok) => resolve(ok),
        };
        claimId = identified.id;
        claims.set(claimId, claim);
      }
      identities[index + 1]!.release();
      while (previous) {
        if (await previous.promise) return { kind: "duplicate" };
        signal.throwIfAborted();
        previous = claims.get(identified.id);
        if (!previous) {
          let resolve!: (ok: boolean) => void;
          claim = {
            promise: new Promise<boolean>((done) => {
              resolve = done;
            }),
            resolve: (ok) => resolve(ok),
          };
          claimId = identified.id;
          claims.set(claimId, claim);
        }
      }
      const sourceId = identified.id,
        sourceDigest = identified.sourceDigest;
      if (identified.isRaw) {
        while (rawActive >= rawConcurrency) {
          await new Promise<void>((resolve) => {
            rawWaiters.add(resolve);
          });
          signal.throwIfAborted();
        }
        rawActive++;
        rawOwned = true;
      }
      signal.throwIfAborted();
      const prepared = await options.preparePreview(file, identified, signal);
      signal.throwIfAborted();
      if (
        prepared.id !== sourceId ||
        prepared.sourceDigest !== sourceDigest ||
        prepared.sourceBlob !== file
      )
        throw new Error(
          "Preview preparation changed the original photo identity. This file was not saved.",
        );
      if (!(prepared.previewBlob instanceof Blob) || !prepared.previewBlob.size)
        throw new Error("This photo did not produce a usable preview.");
      // Concurrent callbacks may retain/reuse their returned objects. Freeze the
      // preparation's metadata snapshot while it waits for its ordered save.
      const snapshot = copyPrepared(prepared);
      claim?.resolve(true);
      if (options.onPrepared)
        observer(() => options.onPrepared?.(copyPrepared(snapshot), progress(index)));
      signal.throwIfAborted();
      return { kind: "prepared", value: snapshot };
    } catch (error) {
      if (claim) {
        if (claimId && claims.get(claimId) === claim) claims.delete(claimId);
        claim.resolve(false);
      }
      return signal.aborted || (error instanceof Error && error.name === "AbortError")
        ? { kind: "stopped" }
        : { kind: "failed", message: errorText(error) };
    } finally {
      // A failed later hash must not release a hole ahead of an earlier identity.
      // Cancellation releases all barriers, while already-started reads still drain.
      await identities[index]!.promise;
      identities[index + 1]!.release();
      if (rawOwned) {
        rawActive--;
        for (const wake of rawWaiters) wake();
        rawWaiters.clear();
      }
    }
  };
  const fill = () => {
    while (!signal.aborted && nextStart < batch.length && preparations.size < concurrency) {
      const index = nextStart++;
      preparations.set(index, prepare(index));
    }
  };

  try {
    for (const [index, file] of batch.entries()) {
      if (signal.aborted) break;
      observer(() => options.onRegistered?.({ ...progress(index), file }));
    }
    fill();
    for (const [index, file] of batch.entries()) {
      if (signal.aborted) {
        report.stopped = true;
        break;
      }
      const outcome = await preparations.get(index)!;
      if (signal.aborted || outcome.kind === "stopped") {
        report.stopped = true;
        break;
      }
      if (outcome.kind === "failed") {
        const failure = { fileName: file.name, message: outcome.message };
        report.failures.push(failure);
        observer(() => options.onFileFailure?.({ ...failure }, progress(index)));
        preparations.delete(index);
        fill();
        continue;
      }
      if (outcome.kind === "duplicate" || knownIds.has(outcome.value.id)) {
        report.duplicates++;
        observer(() => options.onDuplicate?.(progress(index)));
        preparations.delete(index);
        fill();
        continue;
      }
      const prepared = outcome.value;
      try {
        signal.throwIfAborted();
        const receipt = await options.save(prepared);
        const saved = Array.isArray(receipt) ? receipt : receipt.photos;
        if (saved.length !== 1 || saved[0]?.id !== prepared.id)
          throw new Error(
            "Import storage returned an unexpected receipt. Reload the library before continuing.",
          );
        let observed: DevelopImportCommit | null = null;
        if (!Array.isArray(receipt)) {
          if (
            Object.keys(receipt.documents).length !== 1 ||
            !Object.hasOwn(receipt.documents, prepared.id)
          )
            throw new Error(
              "Import storage returned unexpected edit documents. Reload the library before continuing.",
            );
          const document = developDocumentSchema.parse(receipt.documents[prepared.id]);
          if (document.photoId !== prepared.id)
            throw new Error(
              "Import storage returned edits for another photo. Reload the library before continuing.",
            );
          // Give observers their own metadata/history objects, retaining immutable Blob handles.
          observed = {
            photos: saved.map((photo) => ({ ...photo })),
            documents: { [prepared.id]: document },
          };
        }
        // Do not check cancellation between a completed save and recording its receipt.
        // A stop request cannot undo bytes that have already committed to IndexedDB.
        report.imported.push(...saved);
        report.selectedId ??= saved[0]?.id ?? null;
        knownIds.add(prepared.id);
        if (observed && options.onCommitted) {
          try {
            await options.onCommitted(observed, {
              index: index + 1,
              total: batch.length,
              fileName: file.name,
            });
          } catch {
            /* Display observers cannot undo a durable import or stop subsequent files. */
          }
        }
      } catch (error) {
        if (signal.aborted || (error instanceof Error && error.name === "AbortError"))
          report.stopped = true;
        else report.fatalError = `${file.name}: ${errorText(error)}`;
        break;
      }
      preparations.delete(index);
      fill();
    }
  } finally {
    report.stopped ||= options.signal?.aborted === true;
    // Never return while an uncancelable hash or a decoder still owns work. Fatal
    // persistence faults also cancel and drain sibling preparations before reuse.
    stop();
    await Promise.all(preparations.values());
    options.signal?.removeEventListener("abort", stop);
  }
  return report;
}
