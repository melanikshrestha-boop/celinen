import type { DevelopPhoto } from "./store";

export const DEVELOP_PHOTO_NAME_LIMIT = 180;
const imageExtension =
  /\.(?:jpe?g|png|webp|avif|heic|heif|tiff?|dng|arw|cr2|cr3|nef|nrw|orf|raf|rw2|pef|srw)$/i;

/** Display/export naming only. Never rename or modify the imported source file. */
export function normalizePhotoDisplayName(value: string): string {
  if (typeof value !== "string") throw new Error("Enter a photo name.");
  const name = value.normalize("NFC").trim();
  if (!name || name.length > DEVELOP_PHOTO_NAME_LIMIT)
    throw new Error(`Use a photo name between 1 and ${DEVELOP_PHOTO_NAME_LIMIT} characters.`);
  if (/[\p{Cc}\u202a-\u202e\u2066-\u2069/\\<>:"|?*]/u.test(name) || /[. ]$/.test(name))
    throw new Error(
      "Photo names cannot contain path separators, control characters, or filename punctuation.",
    );
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
    throw new Error("Choose a name that is not reserved by the operating system.");
  return name;
}

const comparableName = (name: string) => name.normalize("NFKC").trim().toLowerCase();
function truncateName(name: string, maxLength: number) {
  let result = "";
  for (const character of name) {
    if (result.length + character.length > maxLength) break;
    result += character;
  }
  return result;
}
/** Imported POSIX filenames can be longer or contain punctuation forbidden for new names. */
function derivedPhotoName(value: string) {
  if (typeof value !== "string") throw new Error("Enter a photo name.");
  const safe =
    value
      .normalize("NFC")
      .replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069/\\<>:"|?*]/gu, "-")
      .trim()
      .replace(/[. ]+$/g, "") || "Photo";
  const extension = safe.match(imageExtension)?.[0] ?? "";
  let stem = extension ? safe.slice(0, -extension.length) : safe;
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)) stem = `Photo ${stem}`;
  return normalizePhotoDisplayName(
    `${truncateName(stem, DEVELOP_PHOTO_NAME_LIMIT - extension.length).trimEnd()}${extension}`,
  );
}
export function assertPhotoNameAvailable(name: string, existingNames: readonly string[]) {
  const normalized = normalizePhotoDisplayName(name);
  if (existingNames.some((existing) => comparableName(existing) === comparableName(normalized)))
    throw new Error("Another photo already uses this name. Choose a different name.");
  return normalized;
}

/** Deterministic suffixing is resolved inside the write transaction to avoid racing another tab. */
export function uniquePhotoDisplayName(name: string, existingNames: readonly string[]): string {
  const normalized = derivedPhotoName(name);
  const extension = normalized.match(imageExtension)?.[0] ?? "";
  const stem = extension ? normalized.slice(0, -extension.length) : normalized;
  const occupied = new Set(existingNames.map(comparableName));
  for (let index = 1; index <= existingNames.length + 1; index++) {
    const suffix = index === 1 ? " copy" : ` copy ${index}`;
    const available = DEVELOP_PHOTO_NAME_LIMIT - suffix.length - extension.length;
    const candidate = normalizePhotoDisplayName(
      `${truncateName(stem, available).trimEnd()}${suffix}${extension}`,
    );
    if (!occupied.has(comparableName(candidate))) return candidate;
  }
  throw new Error("A unique copy name could not be created.");
}

export function photoExportFilename(name: string, extension: "jpg" | "png" | "tif" = "jpg") {
  if (!["jpg", "png", "tif"].includes(extension)) throw new Error("Unsupported export extension.");
  const normalized = derivedPhotoName(name);
  const stem = normalized.replace(imageExtension, "");
  return `${truncateName(stem, DEVELOP_PHOTO_NAME_LIMIT - extension.length - 1).trimEnd()}.${extension}`;
}

/** For multi-file exports, reserve every returned filename before choosing the next one. */
export function uniquePhotoExportFilename(
  name: string,
  existingFilenames: readonly string[],
  extension: "jpg" | "png" | "tif" = "jpg",
) {
  const filename = photoExportFilename(name, extension);
  const occupied = new Set(existingFilenames.map(comparableName));
  if (!occupied.has(comparableName(filename))) return filename;
  const stem = filename.slice(0, -(extension.length + 1));
  for (let index = 2; index <= existingFilenames.length + 2; index++) {
    const suffix = ` (${index}).${extension}`;
    const candidate = `${truncateName(stem, DEVELOP_PHOTO_NAME_LIMIT - suffix.length).trimEnd()}${suffix}`;
    if (!occupied.has(comparableName(candidate))) return candidate;
  }
  throw new Error("A unique export filename could not be created.");
}

export function renamedDevelopPhoto(photo: DevelopPhoto, name: string): DevelopPhoto {
  return { ...photo, name: normalizePhotoDisplayName(name) };
}

export function virtualCopyPhoto(
  photo: DevelopPhoto,
  id: string,
  name: string,
  createdAt = Date.now(),
): DevelopPhoto {
  if (!id.startsWith("copy:") || !id.slice(5).trim() || id === photo.id || id.length > 512)
    throw new Error("A virtual copy needs a new copy identity.");
  if (!Number.isFinite(createdAt) || createdAt < 0) throw new Error("Invalid copy creation time.");
  if (!photo.sourceBlob?.size && !photo.previewBlob?.size)
    throw new Error("Reconnect the original before duplicating this photo.");
  return {
    ...photo,
    id,
    name: normalizePhotoDisplayName(name),
    createdAt,
    sourceAvailable: Boolean(photo.sourceBlob?.size),
  };
}
