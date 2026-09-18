import { baseName, RAW_EXTENSIONS } from "@/lib/imaging";

const RASTER_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "tif",
  "tiff",
  "heic",
  "heif",
  "avif",
]);

export type RawJpegPairable = {
  id: string;
  name: string;
  isRaw: boolean;
  sourceFileName?: string | null;
};

export type RawJpegPair = {
  /** Shared case-folded stem used for pairing (from source file when present). */
  stem: string;
  rawId: string;
  jpegId: string;
};

function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** Prefer the on-disk source filename for pairing; fall back to display name. */
export function pairSourceName(photo: RawJpegPairable): string {
  const source = photo.sourceFileName?.trim();
  return source && source.length > 0 ? source : photo.name;
}

export function pairStem(photo: RawJpegPairable): string {
  return baseName(pairSourceName(photo)).normalize("NFKC").trim().toLowerCase();
}

export function looksLikeRasterCompanion(photo: RawJpegPairable): boolean {
  if (photo.isRaw) return false;
  const ext = extensionOf(pairSourceName(photo));
  return ext.length === 0 || RASTER_EXTENSIONS.has(ext);
}

export function looksLikeRawCompanion(photo: RawJpegPairable): boolean {
  if (photo.isRaw) return true;
  return RAW_EXTENSIONS.includes(extensionOf(pairSourceName(photo)));
}

/**
 * Build RAW↔JPEG pairs from a library. One RAW + one raster with the same stem
 * become a pair. Ambiguous stems (2+ RAW or 2+ JPEG) are skipped.
 */
export function findRawJpegPairs(photos: readonly RawJpegPairable[]): RawJpegPair[] {
  const byStem = new Map<string, RawJpegPairable[]>();
  for (const photo of photos) {
    const stem = pairStem(photo);
    if (!stem) continue;
    const bucket = byStem.get(stem);
    if (bucket) bucket.push(photo);
    else byStem.set(stem, [photo]);
  }

  const pairs: RawJpegPair[] = [];
  for (const [stem, group] of byStem) {
    if (group.length < 2) continue;
    const raws = group.filter(looksLikeRawCompanion);
    const jpegs = group.filter(looksLikeRasterCompanion);
    if (raws.length !== 1 || jpegs.length !== 1) continue;
    pairs.push({ stem, rawId: raws[0]!.id, jpegId: jpegs[0]!.id });
  }
  return pairs;
}

export function pairForPhoto(
  photoId: string,
  photos: readonly RawJpegPairable[],
): RawJpegPair | null {
  return findRawJpegPairs(photos).find((p) => p.rawId === photoId || p.jpegId === photoId) ?? null;
}

/** The other half of the pair, or null when the photo is unpaired. */
export function companionPhotoId(
  photoId: string,
  photos: readonly RawJpegPairable[],
): string | null {
  const pair = pairForPhoto(photoId, photos);
  if (!pair) return null;
  return pair.rawId === photoId ? pair.jpegId : pair.rawId;
}

export type RawJpegSwitchTarget = "raw" | "jpeg";

export function switchTargetForPhoto(
  photo: RawJpegPairable,
  photos: readonly RawJpegPairable[],
): RawJpegSwitchTarget | null {
  const pair = pairForPhoto(photo.id, photos);
  if (!pair) return null;
  return photo.id === pair.rawId ? "raw" : "jpeg";
}

/** Select the RAW or JPEG half of the current pair. No-op when unpaired. */
export function resolveRawJpegSwitch(
  selectedId: string,
  target: RawJpegSwitchTarget,
  photos: readonly RawJpegPairable[],
): string {
  const pair = pairForPhoto(selectedId, photos);
  if (!pair) return selectedId;
  return target === "raw" ? pair.rawId : pair.jpegId;
}
