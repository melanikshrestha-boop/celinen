import { supportedPhoto } from "../studio/ingest";
import {
  developDocumentSchema,
  developImportOrderSchema,
  developPhotoFromFile,
  type DevelopImportCommit,
  type DevelopPhoto,
  type DevelopPhotoInput,
  type DevelopImportOrder,
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
  /** Opt-in durable input ordering; requires an admitted coordinator/store receipt. */
  ordering?: Pick<DevelopImportOrder, "namespace" | "jobId">;
  /** Metadata registration only: no source read, decoded preview, or durable save is implied. */
  onRegistered?: (progress: DevelopImportRegistration) => void;
  onProgress?: (progress: DevelopImportProgress) => void;
  onPrepared?: (input: DevelopPhotoInput, progress: DevelopImportProgress) => void;
  /** All sources resolved to previews, duplicates, or failures; commits may still be pending. */
  onPreparationComplete?: () => void;
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
  | { kind: "duplicate"; sourceId: string }
  | { kind: "failed"; message: string }
  | { kind: "stopped" };
type Identified =
  | { kind: "identified"; value: DevelopPhotoInput }
  | Extract<Prepared, { kind: "failed" | "stopped" }>;
type IdentityClaim = {
  succeeded: boolean;
  waiting: { index: number; input: DevelopPhotoInput }[];
};
type PreviewCandidate = { index: number; input: DevelopPhotoInput; claim: IdentityClaim };

/** Lightweight, input-ordered candidates only; never holds decoded pixels or read buffers. */
function candidateQueue() {
  const heap: PreviewCandidate[] = [];
  return {
    peek: () => heap[0],
    push(candidate: PreviewCandidate) {
      let at = heap.length;
      heap.push(candidate);
      while (at > 0) {
        const parent = (at - 1) >> 1;
        if (heap[parent]!.index <= candidate.index) break;
        heap[at] = heap[parent]!;
        at = parent;
      }
      heap[at] = candidate;
    },
    pop() {
      const first = heap[0],
        last = heap.pop();
      if (!first || !heap.length) return first;
      let at = 0;
      while (at * 2 + 1 < heap.length) {
        let child = at * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1]!.index < heap[child]!.index) child++;
        if (last!.index <= heap[child]!.index) break;
        heap[at] = heap[child]!;
        at = child;
      }
      heap[at] = last!;
      return first;
    },
  };
}

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
  const ordering = options.ordering ? { ...options.ordering } : null;
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
  // Read buffers and previews have independent bounds. RAW/duplicate waiters retain
  // only verified metadata and the original immutable File handle, not a heavy slot.
  // Identity claims still advance strictly in input order, before fair preview dispatch.
  const completions = Array.from({ length: batch.length }, barrier);
  const outcomes = new Map<number, Prepared>();
  const preparationSettled = new Set<number>();
  let preparationStopped = false;
  const reads = new Map<number, Promise<Identified>>();
  const claims = new Map<string, IdentityClaim>();
  const rasters = candidateQueue(),
    raws = candidateQueue();
  const heldPreviews = new Set<number>(); // Active + ready + currently committing, <= concurrency.
  const activePreviews = new Set<Promise<void>>();
  const committedOrdinals = new Map<number, string>();
  const sortedOrdinals: number[] = [];
  const importedByIndex = new Map<number, DevelopPhoto[]>();
  const consumedIndices = new Set<number>();
  const readyQueue: number[] = [];
  const pendingDuplicates = new Map<string, number[]>();
  let readyHead = 0;
  let consumedCount = 0;
  let outcomeAvailable = barrier();
  let nextRead = 0,
    commitIndex = 0,
    rawActive = 0,
    identifying: Promise<void> = Promise.resolve();
  let commitAdvance = barrier();
  const stop = () => {
    if (!signal.aborted) controller.abort(options.signal?.reason);
    for (const completion of completions) completion.release();
    commitAdvance.release();
    outcomeAvailable.release();
  };
  options.signal?.addEventListener("abort", stop, { once: true });
  if (options.signal?.aborted) stop();

  function wakeReady() {
    const available = outcomeAvailable;
    outcomeAvailable = barrier();
    available.release();
  }
  function complete(index: number, outcome: Prepared) {
    outcomes.set(index, outcome);
    completions[index]!.release();
    if (ordering) {
      if (outcome.kind === "duplicate" && !knownIds.has(outcome.sourceId)) {
        const waiting = pendingDuplicates.get(outcome.sourceId) ?? [];
        waiting.push(index);
        pendingDuplicates.set(outcome.sourceId, waiting);
      } else {
        readyQueue.push(index);
        wakeReady();
      }
    }
    const firstSettlement = !preparationSettled.has(index);
    preparationSettled.add(index);
    preparationStopped ||= outcome.kind === "stopped";
    if (
      firstSettlement &&
      preparationSettled.size === batch.length &&
      !signal.aborted &&
      !preparationStopped
    )
      observer(() => options.onPreparationComplete?.());
  }
  const identify = async (index: number): Promise<Identified> => {
    const file = batch[index]!;
    try {
      signal.throwIfAborted();
      observer(() => options.onProgress?.(progress(index)));
      if (!supportedPhoto(file)) throw new Error("This file type is not a supported photo.");
      const identified = await developPhotoFromFile(file, undefined, undefined, signal);
      signal.throwIfAborted();
      return { kind: "identified", value: identified };
    } catch (error) {
      return signal.aborted || (error instanceof Error && error.name === "AbortError")
        ? { kind: "stopped" }
        : { kind: "failed", message: errorText(error) };
    }
  };
  function fillReads() {
    while (!signal.aborted && nextRead < batch.length && reads.size < concurrency) {
      const index = nextRead++;
      reads.set(index, identify(index));
    }
  }
  function queuePreview(candidate: PreviewCandidate) {
    (candidate.input.isRaw ? raws : rasters).push(candidate);
  }
  async function prepare({ index, input: identified, claim }: PreviewCandidate): Promise<void> {
    const file = batch[index]!;
    const sourceId = identified.id,
      sourceDigest = identified.sourceDigest,
      rawOwned = identified.isRaw;
    let ready = false;
    try {
      signal.throwIfAborted();
      const prepared = await options.preparePreview(file, identified, signal);
      signal.throwIfAborted();
      if (
        prepared.id !== sourceId ||
        prepared.sourceDigest !== sourceDigest ||
        prepared.sourceBlob !== file ||
        prepared.importOrder !== undefined ||
        prepared.importBefore !== undefined
      )
        throw new Error(
          "Preview preparation changed the original photo identity. This file was not saved.",
        );
      if (!(prepared.previewBlob instanceof Blob) || !prepared.previewBlob.size)
        throw new Error("This photo did not produce a usable preview.");
      // Concurrent callbacks may retain/reuse their returned objects. Freeze the
      // preparation's metadata snapshot while it waits for its ordered save.
      const snapshot = copyPrepared(prepared);
      claim.succeeded = true;
      for (const duplicate of claim.waiting.splice(0))
        complete(duplicate.index, { kind: "duplicate", sourceId });
      if (options.onPrepared)
        observer(() => options.onPrepared?.(copyPrepared(snapshot), progress(index)));
      signal.throwIfAborted();
      ready = true;
      complete(index, { kind: "prepared", value: snapshot });
    } catch (error) {
      const stopped = signal.aborted || (error instanceof Error && error.name === "AbortError");
      complete(
        index,
        stopped ? { kind: "stopped" } : { kind: "failed", message: errorText(error) },
      );
      if (!stopped) {
        // The earliest matching input owns the retry too; a raster extension must
        // never jump ahead of an earlier original with the same verified bytes.
        const retry = claim.waiting.shift();
        if (retry) queuePreview({ ...retry, claim });
        else claims.delete(sourceId);
      }
    } finally {
      if (!ready) heldPreviews.delete(index);
      if (rawOwned) rawActive--;
      dispatchPreviews();
    }
  }
  function dispatchPreviews() {
    while (!signal.aborted && heldPreviews.size < concurrency) {
      const raster = rasters.peek();
      const raw = rawActive < rawConcurrency ? raws.peek() : undefined;
      const candidate = raw && (!raster || raw.index < raster.index) ? raw : raster;
      if (!candidate) return;
      // Ahead-of-order ready results may use spare slots, but must leave room for
      // the next receipt. Otherwise a slow hash / duplicate retry can deadlock
      // behind a completely full ready buffer that cannot commit out of order.
      if (
        !ordering &&
        candidate.index !== commitIndex &&
        !heldPreviews.has(commitIndex) &&
        heldPreviews.size >= concurrency - 1
      )
        return;
      (candidate.input.isRaw ? raws : rasters).pop();
      heldPreviews.add(candidate.index);
      if (candidate.input.isRaw) rawActive++;
      const task = prepare(candidate).finally(() => activePreviews.delete(task));
      activePreviews.add(task);
    }
  }
  async function identifyInOrder() {
    fillReads();
    for (let index = 0; index < batch.length && !signal.aborted; index++) {
      const identified = await reads.get(index)!;
      reads.delete(index);
      if (signal.aborted) return;
      if (identified.kind !== "identified") complete(index, identified);
      else {
        const input = identified.value;
        const existing = claims.get(input.id);
        if (knownIds.has(input.id) || existing?.succeeded)
          complete(index, { kind: "duplicate", sourceId: input.id });
        else if (existing) existing.waiting.push({ index, input });
        else {
          const claim: IdentityClaim = { succeeded: false, waiting: [] };
          claims.set(input.id, claim);
          queuePreview({ index, input, claim });
        }
      }
      dispatchPreviews();
      // Existing single-worker callers promise no read/progress for the next
      // source until this receipt has drained, including a fatal storage stop.
      while (concurrency === 1 && commitIndex <= index && !signal.aborted)
        await commitAdvance.promise;
      fillReads();
    }
  }
  function consumed(index: number) {
    outcomes.delete(index);
    heldPreviews.delete(index);
    consumedCount++;
    consumedIndices.add(index);
    while (consumedIndices.delete(commitIndex)) commitIndex++;
    const advanced = commitAdvance;
    commitAdvance = barrier();
    advanced.release();
    dispatchPreviews();
  }
  async function* readyIndices() {
    if (!ordering) {
      for (let index = 0; index < batch.length && !signal.aborted; index++) {
        await completions[index]!.promise;
        yield index;
      }
      return;
    }
    while (consumedCount < batch.length && !signal.aborted) {
      const wait = outcomeAvailable.promise;
      // A duplicate is counted only after its winning source's durable ACK.
      if (readyHead < readyQueue.length) {
        const index = readyQueue[readyHead++]!;
        if (readyHead >= 1024 && readyHead * 2 >= readyQueue.length) {
          readyQueue.splice(0, readyHead);
          readyHead = 0;
        }
        yield index;
      } else await wait;
    }
  }
  function ordinalPosition(index: number) {
    let low = 0,
      high = sortedOrdinals.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (sortedOrdinals[middle]! < index) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  try {
    for (const [index, file] of batch.entries()) {
      if (signal.aborted) break;
      observer(() => options.onRegistered?.({ ...progress(index), file }));
    }
    if (!batch.length && !signal.aborted) observer(() => options.onPreparationComplete?.());
    identifying = identifyInOrder();
    for await (const index of readyIndices()) {
      const file = batch[index]!;
      if (signal.aborted) {
        report.stopped = true;
        break;
      }
      const outcome = outcomes.get(index);
      if (signal.aborted || !outcome || outcome.kind === "stopped") {
        report.stopped = true;
        break;
      }
      if (outcome.kind === "failed") {
        const failure = { fileName: file.name, message: outcome.message };
        report.failures.push(failure);
        observer(() => options.onFileFailure?.({ ...failure }, progress(index)));
        consumed(index);
        continue;
      }
      if (outcome.kind === "duplicate" || knownIds.has(outcome.value.id)) {
        report.duplicates++;
        observer(() => options.onDuplicate?.(progress(index)));
        consumed(index);
        continue;
      }
      let prepared = outcome.value;
      try {
        signal.throwIfAborted();
        if (ordering) {
          const later = sortedOrdinals[ordinalPosition(index)];
          prepared = {
            ...prepared,
            importOrder: developImportOrderSchema.parse({
              version: 1,
              ...ordering,
              ordinal: index,
              photoId: prepared.id,
              sourceDigest: prepared.sourceDigest,
            }),
            ...(later !== undefined
              ? { importBefore: { ordinal: later, photoId: committedOrdinals.get(later)! } }
              : {}),
          };
        }
        const receipt = await options.save(prepared);
        const saved = Array.isArray(receipt) ? receipt : receipt.photos;
        if (saved.length !== 1 || saved[0]?.id !== prepared.id)
          throw new Error(
            "Import storage returned an unexpected receipt. Reload the library before continuing.",
          );
        if (ordering) {
          if (
            Array.isArray(receipt) ||
            !receipt.ordering ||
            JSON.stringify(developImportOrderSchema.parse(receipt.ordering.order)) !==
              JSON.stringify(prepared.importOrder) ||
            typeof receipt.ordering.inserted !== "boolean"
          )
            throw new Error("Import storage did not acknowledge this photo's exact job order.");
          if (receipt.ordering.inserted) {
            committedOrdinals.set(index, prepared.id);
            sortedOrdinals.splice(ordinalPosition(index), 0, index);
          }
        }
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
        importedByIndex.set(index, saved);
        report.selectedId ??= saved[0]?.id ?? null;
        knownIds.add(prepared.id);
        const duplicates = pendingDuplicates.get(prepared.id);
        if (duplicates) {
          pendingDuplicates.delete(prepared.id);
          for (const duplicate of duplicates) readyQueue.push(duplicate);
          wakeReady();
        }
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
      consumed(index);
    }
  } finally {
    report.stopped ||= options.signal?.aborted === true;
    // Never return while an uncancelable hash or a decoder still owns work. Fatal
    // persistence faults also cancel and drain sibling preparations before reuse.
    stop();
    await identifying;
    await Promise.all(reads.values());
    await Promise.all(activePreviews);
    options.signal?.removeEventListener("abort", stop);
  }
  if (ordering) {
    report.imported = [...importedByIndex]
      .sort(([a], [b]) => a - b)
      .flatMap(([, photos]) => photos);
    report.selectedId = report.imported[0]?.id ?? null;
  }
  return report;
}
