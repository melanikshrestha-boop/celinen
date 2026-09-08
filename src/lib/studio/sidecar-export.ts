import { baseName, buildXmpSidecar, type Shot } from "../imaging";
import { makeZip, type ZipEntry } from "../zip";
import { exportedReviewMetadata } from "./review-metadata";

type SidecarShot = Pick<Shot, "name" | "relativePath" | "verdict" | "error" | "edits" | "develop">;
export const SIDECAR_EXPORT_LIMITS = Object.freeze({ photos: 20_000, bytes: 32 * 1024 * 1024 });
const encoder = new TextEncoder();

// Be conservative on filesystems that fold case or normalize Unicode. Never
// silently rename a sidecar: its name is how an editor associates it to a photo.
function pathKey(path: string): string {
  return path.normalize("NFC").toUpperCase().toLowerCase();
}

function sidecarPath(shot: SidecarShot): string {
  const path = shot.relativePath ?? shot.name;
  const parts = path.split("/");
  if (
    !path ||
    encoder.encode(path).length > 1024 ||
    new TextDecoder().decode(encoder.encode(path)) !== path ||
    // eslint-disable-next-line no-control-regex -- ZIP paths must reject control characters.
    /[\\<>:"|?*\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(path) ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[. ]$/.test(part) ||
        encoder.encode(part).length > 255 ||
        /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part),
    ) ||
    parts.at(-1) !== shot.name
  ) {
    throw new Error(
      "Sidecars were not exported. Reconnect a folder with valid, unambiguous relative filenames; no paths were renamed.",
    );
  }
  const stem = baseName(shot.name);
  if (
    !stem ||
    stem.startsWith(".") ||
    /[. ]$/.test(stem) ||
    encoder.encode(`${stem}.xmp`).length > 255
  )
    throw new Error(
      "Sidecars were not exported. A photo needs a portable filename before an XMP can be matched safely.",
    );
  parts[parts.length - 1] = `${stem}.xmp`;
  return parts.join("/");
}

const isReviewed = (shot: SidecarShot) => shot.verdict !== "undecided" && !shot.error;

/** All-or-nothing plan. Includes unreviewed companions in collision detection. */
export function planSidecarExport(shots: readonly SidecarShot[]): {
  entries: ZipEntry[];
  photoCount: number;
} {
  if (shots.length > SIDECAR_EXPORT_LIMITS.photos)
    throw new Error(
      "Sidecars were not exported. Split this shoot into groups of at most 20,000 photos.",
    );
  const photoCount = shots.filter(isReviewed).length;
  if (!photoCount)
    throw new Error("Nothing decided yet. Keep or reject a photo before exporting sidecars.");

  const groups = new Map<string, { path: string; shots: SidecarShot[] }>();
  for (const shot of shots) {
    const path = sidecarPath(shot);
    const key = pathKey(path);
    const group = groups.get(key);
    if (group) {
      if (group.path !== path)
        throw new Error(
          `Sidecars were not exported. “${path}” has a case or Unicode filename collision. Rename the source files or folders and reconnect them.`,
        );
      group.shots.push(shot);
    } else groups.set(key, { path, shots: [shot] });
  }

  const entries: ZipEntry[] = [];
  let bytes = 22; // ZIP end-of-directory record; bound before allocating the archive.
  for (const { path, shots: group } of groups.values()) {
    if (!group.some(isReviewed)) continue;
    if (!group.every(isReviewed))
      throw new Error(
        `Sidecars were not exported. “${path}” also belongs to an unreviewed or unreadable photo. Review the companion before exporting.`,
      );
    let text: string | undefined;
    for (const shot of group) {
      const metadata = exportedReviewMetadata(shot);
      const xml = buildXmpSidecar(shot.edits, shot.verdict, metadata.rating, metadata.label);
      if (text !== undefined && text !== xml)
        throw new Error(
          `Sidecars were not exported. Photos sharing “${path}” have different picks or settings. Give their originals distinct names or folders and reconnect them.`,
        );
      text = xml;
    }
    bytes += 76 + 2 * encoder.encode(path).length + encoder.encode(text!).length;
    if (bytes > SIDECAR_EXPORT_LIMITS.bytes)
      throw new Error(
        "Sidecars were not exported. This metadata archive exceeds 32 MiB; export a smaller shoot.",
      );
    entries.push({ path, text: text! });
  }

  const files = new Set(entries.map((entry) => pathKey(entry.path)));
  const directories = new Map<string, string>();
  for (const entry of entries) {
    const parts = entry.path.split("/");
    for (let depth = 1; depth < parts.length; depth++) {
      const directory = parts.slice(0, depth).join("/");
      const key = pathKey(directory);
      if (files.has(key))
        throw new Error(
          "Sidecars were not exported. A sidecar filename conflicts with a folder name; rename that source folder and reconnect it.",
        );
      const previous = directories.get(key);
      if (previous !== undefined && previous !== directory)
        throw new Error(
          "Sidecars were not exported. Folder names have a case or Unicode collision; give those source folders distinct names and reconnect them.",
        );
      directories.set(key, directory);
    }
  }
  return { entries, photoCount };
}

export function createSidecarArchive(shots: readonly SidecarShot[]) {
  const plan = planSidecarExport(shots);
  return {
    blob: makeZip(plan.entries),
    sidecarCount: plan.entries.length,
    photoCount: plan.photoCount,
  };
}
