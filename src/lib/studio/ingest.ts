import { isRawFile, type Shot } from "@/lib/imaging";
import { stableShotId } from "./session";

export const SOURCE_DIGEST_CHUNK_BYTES = 4 * 1024 * 1024;
const sourceDigests = new WeakMap<File, string>();
const validDigest = (value: unknown): value is string =>
  typeof value === "string" && /^sha256-chain-v1:[0-9a-f]{64}$/.test(value);
const checkSourceAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException("Source verification stopped", "AbortError");
};

/**
 * Constant-memory, full-byte fingerprint. Not a raw-file SHA-256 or a perceptual hash.
 * Seed binds version, size and chunk size; each SHA-256 binds the previous digest
 * and the next fixed-size chunk. One 4 MiB chunk is read at a time per import lane.
 */
export async function fingerprintSource(file: File, signal?: AbortSignal): Promise<string> {
  checkSourceAbort(signal);
  const cached = sourceDigests.get(file);
  if (cached) return cached;
  if (!Number.isSafeInteger(file.size) || file.size < 0 || !globalThis.crypto?.subtle)
    throw new Error("Secure source verification is unavailable.");
  let digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`LensLabs source v1\n${file.size}\n${SOURCE_DIGEST_CHUNK_BYTES}`),
    ),
  );
  for (let offset = 0; offset < file.size; offset += SOURCE_DIGEST_CHUNK_BYTES) {
    checkSourceAbort(signal);
    const length = Math.min(SOURCE_DIGEST_CHUNK_BYTES, file.size - offset);
    const bytes = await file.slice(offset, offset + length).arrayBuffer();
    checkSourceAbort(signal);
    if (bytes.byteLength !== length) throw new Error("The original could not be read completely.");
    const input = new Uint8Array(digest.length + length);
    input.set(digest);
    input.set(new Uint8Array(bytes), digest.length);
    digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  }
  checkSourceAbort(signal);
  const result = `sha256-chain-v1:${Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  sourceDigests.set(file, result);
  return result;
}

export class SourceReconnectError extends Error {
  constructor(readonly reason: "unverified" | "mismatch") {
    super(
      reason === "unverified"
        ? "This older preview has no verified original fingerprint. It was preserved; import into a separate shoot to review the source."
        : "The selected original has different bytes. The saved photo, picks and edits were preserved.",
    );
    this.name = "SourceReconnectError";
  }
}

/** Verify before decoding or publishing replacement previews; never hash a saved preview as an original. */
export async function prepareIngestSource(file: File, saved?: Shot, signal?: AbortSignal) {
  checkSourceAbort(signal);
  if (saved?.sourceAvailable === false && !validDigest(saved.sourceDigest))
    throw new SourceReconnectError("unverified");
  const incoming = await fingerprintSource(file, signal);
  if (saved) {
    const expected =
      saved.sourceAvailable === false
        ? saved.sourceDigest
        : await fingerprintSource(saved.file, signal);
    if (incoming !== expected) throw new SourceReconnectError("mismatch");
  }
  return incoming;
}

function verifiedReplacement(saved: Shot, incoming: Shot): boolean {
  if (incoming.sourceAvailable === false) return false;
  if (saved.sourceAvailable !== false && saved.file === incoming.file) return true;
  const expected =
    saved.sourceAvailable === false ? saved.sourceDigest : sourceDigests.get(saved.file);
  // Only trust the incoming File actually read in this runtime, not a copied digest field.
  return validDigest(expected) && sourceDigests.get(incoming.file) === expected;
}

export function supportedPhoto(file: File): boolean {
  return (
    isRawFile(file) ||
    file.type.startsWith("image/") ||
    /\.(jpe?g|png|webp|avif|heic|heif|tiff?|bmp|gif)$/i.test(file.name)
  );
}

export function uniquePhotos(files: File[]): File[] {
  // Metadata is not source identity. Only repeated handles are safe to remove before reading.
  return [...new Set(files.filter(supportedPhoto))];
}

const SOURCE_ID_SUFFIX = /::source:sha256-chain-v1:[0-9a-f]{64}$/;

/**
 * One resolver per import, shared by its bounded processing lanes. Existing IDs never change.
 * Only new metadata collisions get content-qualified IDs; no source or saved-record migration.
 */
export function createIngestResolver(files: readonly File[], saved: readonly Shot[]) {
  const selected = new Set(files);
  const counts = new Map<string, number>();
  for (const file of selected) {
    const key = stableShotId(file);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const collisions = new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
  const savedById = new Map(saved.map((shot) => [shot.id, shot]));
  const savedGroups = new Set(saved.map((shot) => shot.id.replace(SOURCE_ID_SUFFIX, "")));
  const claimed = new Set<string>();

  return {
    // A sidecar cannot choose between distinct sources sharing its exact metadata target.
    ambiguousSidecarKeys: new Set(
      [...selected].filter((file) => collisions.has(stableShotId(file))).map(sidecarKey),
    ),
    hasExisting: (file: File) => savedGroups.has(stableShotId(file)),
    hasCollision: (file: File) => collisions.has(stableShotId(file)),
    async prepare(
      file: File,
      signal?: AbortSignal,
    ): Promise<{ id: string; sourceDigest: string } | null> {
      if (!selected.has(file)) throw new Error("This file was not part of the selected import.");
      const key = stableShotId(file);
      const sourceDigest = await fingerprintSource(file, signal);
      const qualified = `${key}::source:${sourceDigest}`;
      const existing = savedById.get(qualified) ?? savedById.get(key);
      // Once this metadata group exists, an unknown different source is not a reconnect.
      // In particular, never let an altered original inherit an existing frame's decisions.
      if (!existing && savedGroups.has(key)) throw new SourceReconnectError("mismatch");
      if (existing) await prepareIngestSource(file, existing, signal);
      checkSourceAbort(signal);
      const id = existing?.id ?? (collisions.has(key) ? qualified : key);
      if (claimed.has(id)) return null; // Repeated bytes verified, not guessed from name/size/date.
      claimed.add(id);
      return { id, sourceDigest };
    },
  };
}

/** Multiple camera cards often reuse filenames; sidecars belong to their directory. */
export function sidecarKey(file: File): string {
  return (file.webkitRelativePath || file.name).replace(/\\/g, "/").replace(/\.[^./]+$/, "");
}

export const SIDECAR_FILE_LIMIT = 256 * 1024;
export const SIDECAR_BATCH_LIMIT = 16 * 1024 * 1024;

/** Exact path matching only. Ambiguous or unreadable metadata never wins by file order. */
export async function readImportSidecars(
  files: readonly File[],
  signal?: AbortSignal,
): Promise<{
  values: Map<string, string>;
  ambiguous: number;
  unreadable: number;
  oversized: number;
  budgetSkipped: number;
}> {
  const groups = new Map<string, Set<File>>();
  for (const file of files) {
    if (!/\.xmp$/i.test(file.name)) continue;
    const key = sidecarKey(file);
    const group = groups.get(key) ?? new Set<File>();
    group.add(file);
    groups.set(key, group);
  }
  const result = {
    values: new Map<string, string>(),
    ambiguous: 0,
    unreadable: 0,
    oversized: 0,
    budgetSkipped: 0,
  };
  let bytesRead = 0;
  const checkAbort = () => {
    if (signal?.aborted) throw new DOMException("Sidecar import stopped", "AbortError");
  };
  for (const [key, group] of groups) {
    checkAbort();
    if (group.size !== 1) {
      result.ambiguous++;
      continue;
    }
    const file = [...group][0]!;
    if (file.size > SIDECAR_FILE_LIMIT) {
      result.oversized++;
      continue;
    }
    if (bytesRead + file.size > SIDECAR_BATCH_LIMIT) {
      result.budgetSkipped++;
      continue;
    }
    bytesRead += file.size;
    try {
      const bytes = await file.arrayBuffer();
      checkAbort();
      if (bytes.byteLength !== file.size) {
        result.unreadable++;
        continue;
      }
      result.values.set(key, new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      checkAbort();
      result.unreadable++;
    }
  }
  checkAbort();
  return result;
}

export function sidecarReadNotice(
  result: Awaited<ReturnType<typeof readImportSidecars>>,
  photos?: readonly File[],
): string {
  const photoKeys = photos
    ? new Set(
        photos.filter((file) => supportedPhoto(file) && !/\.xmp$/i.test(file.name)).map(sidecarKey),
      )
    : null;
  const unmatched = photoKeys
    ? [...result.values.keys()].filter((key) => !photoKeys.has(key)).length
    : 0;
  const parts = [
    result.ambiguous
      ? `${result.ambiguous} ambiguous sidecar target${result.ambiguous === 1 ? "" : "s"}`
      : "",
    result.unreadable
      ? `${result.unreadable} unreadable sidecar${result.unreadable === 1 ? "" : "s"}`
      : "",
    result.oversized
      ? `${result.oversized} sidecar${result.oversized === 1 ? "" : "s"} over 256 KiB`
      : "",
    result.budgetSkipped
      ? `${result.budgetSkipped} sidecar${result.budgetSkipped === 1 ? "" : "s"} beyond the 16 MiB read limit`
      : "",
    unmatched
      ? `${unmatched} sidecar${unmatched === 1 ? "" : "s"} without an exact photo match`
      : "",
  ].filter(Boolean);
  return parts.length ? `${parts.join(", ")} skipped; their metadata was not applied` : "";
}

/** Merge arriving previews without moving existing frames or replacing live decisions. */
export function mergeIngestedShots(previous: Shot[], incoming: Shot[]): Shot[] {
  const replacements = new Map(incoming.map((shot) => [shot.id, shot]));
  const next = previous.map((saved) => {
    const shot = replacements.get(saved.id);
    if (!shot) return saved;
    replacements.delete(saved.id);
    if (!verifiedReplacement(saved, shot)) return saved;
    if (shot.error && !saved.error && saved.previewUrl) return saved;
    return {
      ...shot,
      verdict: saved.verdict,
      edits: { ...saved.edits },
      ...(saved.develop ? { develop: { ...saved.develop } } : {}),
    };
  });
  return [...next, ...replacements.values()];
}
