/**
 * Same-night keeper gallery.
 * Ready when ~90% of readable frames are decided and at least one keeper exists.
 * Originals stay on the photographer's machine; the gallery is keepers only.
 */
import {
  keepersForDelivery,
  type CullFrame,
} from "./cull-decision";

export const TONIGHT_READY_RATIO = 0.9;

export type TonightProgress = {
  readable: number;
  decided: number;
  keepers: number;
  remaining: number;
  ratio: number;
  ready: boolean;
};

export type TonightGalleryPlan = {
  title: string;
  passcode: string;
  slug: string;
  downloadsEnabled: true;
  keepers: CullFrame[];
  originalsUntouched: true;
};

const PASSCODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function tonightProgress(
  frames: readonly Pick<CullFrame, "verdict" | "error">[],
): TonightProgress {
  const readable = frames.filter((frame) => !frame.error);
  const decided = readable.filter((frame) => frame.verdict !== "undecided");
  const keepers = readable.filter((frame) => frame.verdict === "keep");
  const remaining = readable.length - decided.length;
  const ratio = readable.length ? decided.length / readable.length : 0;
  return {
    readable: readable.length,
    decided: decided.length,
    keepers: keepers.length,
    remaining,
    ratio,
    ready: readable.length > 0 && ratio >= TONIGHT_READY_RATIO && keepers.length > 0,
  };
}

export function createTonightPasscode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += PASSCODE_ALPHABET[Math.floor(random() * PASSCODE_ALPHABET.length)]!;
  }
  return code;
}

export function makeTonightSlug(title: string, random: () => number = Math.random): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28);
  const tail = Math.floor(random() * 36 ** 5)
    .toString(36)
    .padStart(5, "0");
  return `${base || "gallery"}-${tail}`;
}

export function planTonightGallery(
  frames: readonly CullFrame[],
  input: { title: string; passcode?: string; slug?: string; random?: () => number } = {
    title: "",
  },
): TonightGalleryPlan {
  const progress = tonightProgress(frames);
  if (!progress.ready) {
    if (!progress.readable) throw new Error("Import and cull first.");
    if (progress.keepers === 0 && progress.ratio >= TONIGHT_READY_RATIO)
      throw new Error("Keep at least one frame before sending.");
    const need = Math.max(1, Math.ceil(progress.readable * TONIGHT_READY_RATIO) - progress.decided);
    throw new Error(
      `Decide ${need} more frame${need === 1 ? "" : "s"} first (${progress.decided} of ${progress.readable}).`,
    );
  }
  const title = input.title.trim() || "Untitled shoot";
  const random = input.random ?? Math.random;
  return {
    title,
    passcode: input.passcode?.trim() || createTonightPasscode(random),
    slug: input.slug?.trim() || makeTonightSlug(title, random),
    downloadsEnabled: true,
    keepers: keepersForDelivery(frames),
    originalsUntouched: true,
  };
}

export function tonightGalleryPath(slug: string): string {
  if (!slug.trim() || slug.includes("/") || slug.includes("\\"))
    throw new Error("Gallery link is missing.");
  return `/g/${slug}`;
}
