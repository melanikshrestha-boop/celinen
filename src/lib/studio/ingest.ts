import { isRawFile, type Shot } from "@/lib/imaging";
import { stableShotId } from "./session";

export function supportedPhoto(file: File): boolean {
  return (
    isRawFile(file) ||
    file.type.startsWith("image/") ||
    /\.(jpe?g|png|webp|avif|heic|heif|tiff?|bmp|gif)$/i.test(file.name)
  );
}

export function uniquePhotos(files: File[]): File[] {
  return [
    ...new Map(files.filter(supportedPhoto).map((file) => [stableShotId(file), file])).values(),
  ];
}

/** Multiple camera cards often reuse filenames; sidecars belong to their directory. */
export function sidecarKey(file: File): string {
  return (file.webkitRelativePath || file.name)
    .replace(/\\/g, "/")
    .replace(/\.[^./]+$/, "")
    .toLowerCase();
}

/** Merge arriving previews without moving existing frames or replacing live decisions. */
export function mergeIngestedShots(previous: Shot[], incoming: Shot[]): Shot[] {
  const replacements = new Map(incoming.map((shot) => [shot.id, shot]));
  const next = previous.map((saved) => {
    const shot = replacements.get(saved.id);
    if (!shot) return saved;
    replacements.delete(saved.id);
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
