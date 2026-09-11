import {
  DEVELOP_RECONNECT_LIMITS,
  type DevelopReconnectEntry,
  type DevelopReconnectPlan,
} from "./reconnect-plan";
import {
  assertDevelopReconnectTarget,
  DevelopSaveConflict,
  developDocumentSchema,
  reconnectDevelopPhoto,
  type createDevelopStore,
  type DevelopImportCommit,
  type DevelopPhoto,
  type DevelopPhotoInput,
} from "./store";

export type DevelopReconnectProgress = {
  index: number;
  total: number;
  targetId: string;
  fileName: string;
};
export type DevelopReconnectPreview = {
  previewBlob: Blob;
  width: number;
  height: number;
  previewOrigin?: NonNullable<DevelopPhotoInput["previewOrigin"]>;
};
export type DevelopReconnectReport = {
  attached: DevelopPhoto[];
  /** Authoritative committed documents, also retained when a display observer fails. */
  receipt: DevelopImportCommit;
  failures: { targetId: string; fileName: string; message: string }[];
  stopped: boolean;
  fatalError: string | null;
  selectedId: string | null;
};
export type DevelopReconnectOptions = {
  store: Pick<
    ReturnType<typeof createDevelopStore>,
    "namespace" | "readPhoto" | "attachMissingOriginal"
  >;
  decode: (
    file: File,
    currentPhoto: DevelopPhoto,
    signal: AbortSignal,
  ) => Promise<DevelopReconnectPreview>;
  signal?: AbortSignal;
  onProgress?: (progress: DevelopReconnectProgress) => void;
  onCommitted?: (
    receipt: DevelopImportCommit,
    progress: DevelopReconnectProgress,
  ) => void | Promise<void>;
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : "The original could not be reconnected.";
function detached(receipt: DevelopImportCommit): DevelopImportCommit {
  return {
    photos: receipt.photos.map((photo) => ({ ...photo })),
    documents: structuredClone(receipt.documents),
  };
}
function selectedEntries(
  plan: DevelopReconnectPlan,
  selectedIds: readonly string[],
): DevelopReconnectEntry[] {
  if (
    plan.entries.length > DEVELOP_RECONNECT_LIMITS.maxTargets ||
    selectedIds.length > DEVELOP_RECONNECT_LIMITS.maxTargets
  )
    throw new Error("Reconnect review exceeds the safe target limit. Scan a smaller folder.");
  if (
    new Set(selectedIds).size !== selectedIds.length ||
    new Set(plan.entries.map((entry) => entry.targetId)).size !== plan.entries.length
  )
    throw new Error("Reconnect selection contains duplicate photo IDs. Scan again.");
  const entries = new Map(plan.entries.map((entry) => [entry.targetId, entry]));
  const usedFiles = new Set<File>();
  return selectedIds.map((id) => {
    const entry = entries.get(id);
    if (
      !entry ||
      !["verified", "unverified"].includes(entry.status) ||
      !entry.file ||
      entry.candidates.length !== 1 ||
      entry.candidates[0]!.file !== entry.file ||
      entry.file.name !== entry.sourceFileName ||
      usedFiles.has(entry.file) ||
      (entry.status === "unverified" && entry.expectedSourceDigest !== null) ||
      (entry.status === "verified" && !entry.expectedSourceDigest)
    )
      throw new Error(
        "Only individually reviewed, unambiguous matches can be reconnected. Scan again.",
      );
    usedFiles.add(entry.file);
    return { ...entry, candidates: entry.candidates.map((candidate) => ({ ...candidate })) };
  });
}

/**
 * Execute a reviewed, namespace-bound plan, never ordinary content-ID import.
 * A selected unknown identity is explicit attachment, not a claim of verified history.
 * Decoding is sequential and injectable; only a completed storage receipt counts.
 */
export async function runDevelopReconnect(
  plan: DevelopReconnectPlan,
  selectedIds: readonly string[],
  options: DevelopReconnectOptions,
): Promise<DevelopReconnectReport> {
  const { store, decode, onProgress, onCommitted } = options;
  if (!plan.namespace || plan.namespace !== store.namespace)
    throw new Error(
      "This reconnect review belongs to another library. Scan again in the current library.",
    );
  const report: DevelopReconnectReport = {
    attached: [],
    receipt: { photos: [], documents: Object.create(null) },
    failures: [],
    stopped: plan.cancelled,
    fatalError: null,
    selectedId: null,
  };
  const signal = options.signal ?? new AbortController().signal;
  if (plan.cancelled || signal.aborted) {
    report.stopped = true;
    return report;
  }
  const entries = selectedEntries(plan, selectedIds);
  for (const [index, entry] of entries.entries()) {
    if (signal.aborted) {
      report.stopped = true;
      break;
    }
    const progress = {
      index: index + 1,
      total: entries.length,
      targetId: entry.targetId,
      fileName: entry.file!.name,
    };
    try {
      onProgress?.({ ...progress });
    } catch {
      /* Progress observers cannot change the review. */
    }
    if (signal.aborted) {
      report.stopped = true;
      break;
    }
    const expected = {
      sourceFileName: entry.sourceFileName,
      sourceDigest: entry.expectedSourceDigest,
    };
    let photo: DevelopPhoto;
    // Read and persistence errors are fatal. Never hide corruption as an individual bad image.
    try {
      const current = await store.readPhoto(entry.targetId);
      if (signal.aborted) {
        report.stopped = true;
        break;
      }
      if (
        !current ||
        current.photo.id !== entry.targetId ||
        current.document.photoId !== entry.targetId
      )
        throw new DevelopSaveConflict(entry.targetId);
      assertDevelopReconnectTarget(current.photo, expected);
      photo = current.photo;
    } catch (error) {
      report.fatalError = `${progress.fileName}: ${message(error)}`;
      break;
    }
    let input: DevelopPhotoInput;
    try {
      const preview = await decode(entry.file!, { ...photo }, signal);
      signal.throwIfAborted();
      if (
        !Number.isSafeInteger(preview.width) ||
        !Number.isSafeInteger(preview.height) ||
        preview.width <= 0 ||
        preview.height <= 0
      )
        throw new Error("This original did not produce valid decoded dimensions.");
      input = await reconnectDevelopPhoto(
        photo,
        entry.file!,
        preview.previewBlob,
        { width: preview.width, height: preview.height },
        preview.previewOrigin,
      );
      signal.throwIfAborted();
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        report.stopped = true;
        break;
      }
      report.failures.push({
        targetId: entry.targetId,
        fileName: progress.fileName,
        message: message(error),
      });
      continue;
    }
    let receipt: DevelopImportCommit;
    try {
      signal.throwIfAborted();
      receipt = await store.attachMissingOriginal(input, expected);
      const saved = receipt.photos[0];
      if (
        receipt.photos.length !== 1 ||
        !saved ||
        saved.id !== entry.targetId ||
        !saved.sourceBlob?.size ||
        !saved.previewBlob?.size ||
        saved.sourceFileName !== input.sourceFileName ||
        saved.sourceDigest !== input.sourceDigest ||
        Object.keys(receipt.documents).length !== 1 ||
        !Object.hasOwn(receipt.documents, entry.targetId)
      )
        throw new Error(
          "The attachment returned an invalid receipt. Reload the library to check what was saved.",
        );
      const doc = developDocumentSchema.parse(receipt.documents[entry.targetId]);
      if (doc.photoId !== entry.targetId)
        throw new Error("The attachment returned another photo's edits. Reload the library.");
      receipt = { photos: [{ ...saved }], documents: { [entry.targetId]: doc } };
    } catch (error) {
      report.fatalError = `${progress.fileName}: ${message(error)}`;
      break;
    }
    // Cancellation cannot roll back a completed IndexedDB transaction. Record and notify first.
    report.attached.push({ ...receipt.photos[0]! });
    report.receipt.photos.push({ ...receipt.photos[0]! });
    report.receipt.documents[entry.targetId] = structuredClone(receipt.documents[entry.targetId]!);
    report.selectedId ??= entry.targetId;
    try {
      await onCommitted?.(detached(receipt), progress);
    } catch (error) {
      report.fatalError = `The original was attached, but its display could not update. Reload before continuing. ${message(error)}`;
      break;
    }
  }
  report.stopped ||= signal.aborted;
  return report;
}
