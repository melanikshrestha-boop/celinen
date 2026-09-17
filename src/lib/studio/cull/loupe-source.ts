/** Which picture the loupe shows for a frame, best first. */

export type LoupeSourceKind = "original" | "reconnected" | "preview" | "thumbnail";

export type LoupeImage = { kind: LoupeSourceKind; blob: Blob };

export type LoupeSources = {
  /** The File this tab imported, when it still holds it. */
  live: () => File | null;
  /** The original found again through a stored folder or file handle. */
  reconnected: () => Promise<File | null>;
  /** The 2048 px review preview in the private file system. */
  preview: () => Promise<Blob | null>;
  thumbnail: () => Promise<Blob | null>;
};

/** Formats every browser paints in an <img> or ImageBitmap. A RAW original is
 * not one of them; its review preview is. */
export function paintable(blob: Blob): boolean {
  return /^image\/(jpeg|png|webp)$/.test(blob.type);
}

/**
 * Live original → reconnected original → review preview → thumbnail. A source
 * that fails (a revoked handle, a missing file) falls through to the next one
 * instead of leaving the loupe empty.
 */
export async function pickLoupeImage(sources: LoupeSources): Promise<LoupeImage | null> {
  const live = sources.live();
  if (live && paintable(live)) return { kind: "original", blob: live };
  const attempts: [LoupeSourceKind, () => Promise<Blob | null>][] = [
    ["reconnected", sources.reconnected],
    ["preview", sources.preview],
    ["thumbnail", sources.thumbnail],
  ];
  for (const [kind, read] of attempts) {
    let blob: Blob | null = null;
    try {
      blob = await read();
    } catch {
      blob = null;
    }
    if (!blob || !blob.size) continue;
    // A reconnected RAW is not paintable; the stored preview is the better picture.
    if (kind === "reconnected" && !paintable(blob)) continue;
    return { kind, blob };
  }
  return null;
}
