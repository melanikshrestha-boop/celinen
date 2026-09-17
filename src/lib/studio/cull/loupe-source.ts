/** Which picture the loupe shows for a frame, best first. */
import { inspectRawFile, orientedPreview, rawApi } from "./raw-container";
import { ingestRoute } from "./ingest-route";

export type LoupeSourceKind = "original" | "reconnected" | "preview" | "thumbnail";

export type LoupeImage = { kind: LoupeSourceKind; blob: Blob };

export type LoupeSources = {
  /** The File this tab imported, when it still holds it. */
  live: () => File | null;
  /** The original found again through a stored folder or file handle. */
  reconnected: () => Promise<File | null>;
  /** The review preview in the private file system, sized to this screen. */
  preview: () => Promise<Blob | null>;
  thumbnail: () => Promise<Blob | null>;
};

/** Formats every browser paints in an <img> or ImageBitmap. A RAW original is
 * not one of them; the JPEG the camera embedded in it is. */
export function paintable(blob: Blob): boolean {
  return /^image\/(jpeg|png|webp)$/.test(blob.type);
}

/**
 * The largest picture inside an original the browser cannot paint: the camera's
 * own embedded JPEG, tagged with the orientation its RAW container says, so the
 * loupe shows it the right way up at the highest resolution the file holds.
 * Null when the file holds none, or the RAW engine is unavailable.
 */
export async function embeddedPreview(file: Blob): Promise<Blob | null> {
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const route = ingestRoute(head);
  // A JPEG the browser called something else is still a JPEG.
  if (route === "jpeg") return file.slice(0, file.size, "image/jpeg");
  if (route !== "raw") return null;
  const api = await rawApi();
  const inspection = await inspectRawFile(file, api);
  const best = inspection.previews[0];
  return best ? orientedPreview(file, best, api) : null;
}

/**
 * Live original → reconnected original → review preview → thumbnail. A source
 * that fails (a revoked handle, a missing file) falls through to the next one
 * instead of leaving the loupe empty. A RAW original is shown through the
 * picture inside it, which beats any preview this device made from it.
 */
export async function pickLoupeImage(
  sources: LoupeSources,
  embedded: (file: Blob) => Promise<Blob | null> = embeddedPreview,
): Promise<LoupeImage | null> {
  const inside = async (file: Blob): Promise<Blob | null> => {
    try {
      const blob = await embedded(file);
      return blob?.size ? blob : null;
    } catch {
      return null;
    }
  };
  const live = sources.live();
  if (live) {
    if (paintable(live)) return { kind: "original", blob: live };
    const blob = await inside(live);
    if (blob) return { kind: "original", blob };
  }
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
    if (kind === "reconnected" && !paintable(blob)) {
      // A reconnected RAW: the picture inside it, or fall through to what this
      // device stored.
      const found = await inside(blob);
      if (!found) continue;
      return { kind, blob: found };
    }
    return { kind, blob };
  }
  return null;
}
