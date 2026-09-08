import { supportedPhoto } from "../studio/ingest";
import { developPhotoFromFile, type DevelopPhoto, type DevelopPhotoInput } from "./store";

export type DevelopImportProgress = { index: number; total: number; fileName: string };
export type DevelopImportReport = {
  imported: DevelopPhoto[];
  duplicates: number;
  failures: { fileName: string; message: string }[];
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
  save: (input: DevelopPhotoInput) => Promise<DevelopPhoto[]>;
  signal?: AbortSignal;
  onProgress?: (progress: DevelopImportProgress) => void;
};
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "This photo could not be imported.";

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
  const signal = options.signal ?? new AbortController().signal;
  const batch = [...files];
  for (const [index, file] of batch.entries()) {
    if (signal.aborted) {
      report.stopped = true;
      break;
    }
    try {
      options.onProgress?.({ index: index + 1, total: batch.length, fileName: file.name });
    } catch {
      /* Display observers cannot invalidate a file operation. */
    }
    let prepared: DevelopPhotoInput;
    try {
      signal.throwIfAborted();
      if (!supportedPhoto(file)) throw new Error("This file type is not a supported photo.");
      const identified = await developPhotoFromFile(file);
      signal.throwIfAborted();
      if (knownIds.has(identified.id)) {
        report.duplicates++;
        continue;
      }
      const sourceId = identified.id,
        sourceDigest = identified.sourceDigest;
      prepared = await options.preparePreview(file, identified, signal);
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
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        report.stopped = true;
        break;
      }
      report.failures.push({ fileName: file.name, message: errorText(error) });
      continue;
    }
    try {
      signal.throwIfAborted();
      const saved = await options.save(prepared);
      if (saved.length !== 1 || saved[0]?.id !== prepared.id)
        throw new Error(
          "Import storage returned an unexpected receipt. Reload the library before continuing.",
        );
      // Do not check cancellation between a completed save and recording its receipt.
      // A stop request cannot undo bytes that have already committed to IndexedDB.
      report.imported.push(...saved);
      report.selectedId ??= saved[0]?.id ?? null;
      knownIds.add(prepared.id);
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === "AbortError"))
        report.stopped = true;
      else report.fatalError = `${file.name}: ${errorText(error)}`;
      break;
    }
  }
  report.stopped ||= signal.aborted;
  return report;
}
