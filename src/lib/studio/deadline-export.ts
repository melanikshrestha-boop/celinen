import { decodeFile, renderToCanvas, type Edits, type Shot } from "../imaging";
import { hashBlob } from "../projects/archive";
import { makeZip } from "../zip";

export const DEADLINE_LIMITS = Object.freeze({ count: 200, edge: 2048, bytes: 100 * 1024 * 1024 });
export const DEADLINE_RENDERER = "existing-browser-studio-renderer" as const;
export interface DeadlineRecipe {
  count: number;
  longestEdge: number;
  quality: number;
  prefix: string;
  caption: string;
  copyright: string;
}
export interface DeadlineFrame {
  readonly id: string;
  readonly name: string;
  readonly relativePath: string;
  readonly filename: string;
  readonly file: File;
  readonly isRaw: boolean;
  readonly edits: Readonly<Edits>;
  readonly focus: Readonly<{ x: number; y: number }> | null;
  readonly versionKey: string;
}
export interface DeadlinePlan {
  readonly id: string;
  readonly createdAt: string;
  readonly recipe: Readonly<DeadlineRecipe>;
  readonly keeperIds: readonly string[];
  readonly frames: readonly DeadlineFrame[];
}
export interface DeadlineImage {
  blob: Blob;
  width: number;
  height: number;
}
export interface DeadlineSuccess extends DeadlineImage {
  id: string;
  sha256: string;
  sourceSha256: string;
  versionSha256: string;
}
export interface DeadlineAttempt {
  plan: DeadlinePlan;
  images: readonly DeadlineSuccess[];
  failures: readonly { id: string; name: string; message: string }[];
  cancelled: boolean;
}
export type DeadlineRenderer = (
  frame: DeadlineFrame,
  recipe: Readonly<DeadlineRecipe>,
  signal?: AbortSignal,
) => Promise<DeadlineImage>;

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Deadline preparation cancelled.", "AbortError");
}

export function deadlinePrefix(value: string): string {
  // Keep generated deadline filenames short and portable across client devices.
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "deadline"
  );
}

function validateRecipe(recipe: DeadlineRecipe): Readonly<DeadlineRecipe> {
  if (!Number.isInteger(recipe.count) || recipe.count < 1 || recipe.count > DEADLINE_LIMITS.count)
    throw new Error("Choose between 1 and 200 keepers for a deadline set.");
  if (
    !Number.isInteger(recipe.longestEdge) ||
    recipe.longestEdge < 256 ||
    recipe.longestEdge > DEADLINE_LIMITS.edge
  )
    throw new Error("Longest edge must be between 256 and 2048 pixels.");
  if (!Number.isFinite(recipe.quality) || recipe.quality < 0.5 || recipe.quality > 1)
    throw new Error("JPEG quality must be between 50% and 100%.");
  if (
    typeof recipe.prefix !== "string" ||
    recipe.prefix.length > 200 ||
    typeof recipe.caption !== "string" ||
    recipe.caption.length > 2000 ||
    typeof recipe.copyright !== "string" ||
    recipe.copyright.length > 300
  )
    throw new Error(
      "Keep the filename prefix under 200 characters, caption under 2,000, and copyright under 300.",
    );
  return Object.freeze({ ...recipe, prefix: deadlinePrefix(recipe.prefix) });
}

function versionKey(shot: Shot): string {
  const focus = shot.faces?.center;
  return JSON.stringify({
    id: shot.id,
    name: shot.name,
    relativePath: shot.relativePath ?? shot.name,
    file: {
      name: shot.file.name,
      bytes: shot.file.size,
      modified: shot.file.lastModified,
      type: shot.file.type,
    },
    isRaw: shot.isRaw,
    width: shot.width,
    height: shot.height,
    sourceAvailable: shot.sourceAvailable !== false,
    error: shot.error ?? null,
    edits: {
      exposure: shot.edits.exposure,
      contrast: shot.edits.contrast,
      temp: shot.edits.temp,
      saturation: shot.edits.saturation,
      highlights: shot.edits.highlights,
      shadows: shot.edits.shadows,
      crop: shot.edits.crop,
    },
    focus: focus ? { x: focus.x, y: focus.y } : null,
  });
}

export function createDeadlinePlan(shots: readonly Shot[], input: DeadlineRecipe): DeadlinePlan {
  const recipe = validateRecipe(input);
  if (new Set(shots.map((shot) => shot.id)).size !== shots.length)
    throw new Error(
      "This shoot contains duplicate frame IDs; reconnect the shoot before exporting.",
    );
  const keepers = shots.filter((shot) => shot.verdict === "keep");
  if (recipe.count > keepers.length)
    throw new Error(
      `Only ${keepers.length} keepers are selected. Mark keepers first or lower the count.`,
    );
  const frames = keepers.slice(0, recipe.count).map((shot, index): DeadlineFrame => {
    if (shot.sourceAvailable === false || !shot.file.size)
      throw new Error(
        `Reconnect the original for ${shot.name}; saved previews cannot be delivered as originals.`,
      );
    if (shot.error) throw new Error(`${shot.name} is unavailable: ${shot.error}`);
    if (shot.file.size > 128 * 1024 * 1024)
      throw new Error(`${shot.name} exceeds this release's 128 MiB per-source limit.`);
    if (
      !Number.isInteger(shot.width) ||
      !Number.isInteger(shot.height) ||
      shot.width < 1 ||
      shot.height < 1 ||
      shot.width * shot.height > 100_000_000
    )
      throw new Error(`${shot.name} has unsupported source dimensions.`);
    for (const value of [
      shot.edits.exposure,
      shot.edits.contrast,
      shot.edits.temp,
      shot.edits.saturation,
      shot.edits.highlights,
      shot.edits.shadows,
    ]) {
      if (!Number.isFinite(value) || value < -100 || value > 100)
        throw new Error(`${shot.name} has invalid edit values.`);
    }
    if (!["orig", "1:1", "4:5", "3:2", "16:9"].includes(shot.edits.crop))
      throw new Error(`${shot.name} has an invalid crop.`);
    const focus = shot.faces?.center;
    if (
      focus &&
      ![focus.x, focus.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    )
      throw new Error(`${shot.name} has an invalid crop focus.`);
    return Object.freeze({
      id: shot.id,
      name: shot.name,
      relativePath: shot.relativePath ?? shot.name,
      filename: `${recipe.prefix}-${String(index + 1).padStart(3, "0")}.jpg`,
      file: shot.file,
      isRaw: shot.isRaw,
      edits: Object.freeze({ ...shot.edits }),
      focus: focus ? Object.freeze({ ...focus }) : null,
      versionKey: versionKey(shot),
    });
  });
  return Object.freeze({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    recipe,
    keeperIds: Object.freeze(keepers.map((shot) => shot.id)),
    frames: Object.freeze(frames),
  });
}

/** Picks, source identity, exact edits and sequence must still match the approved preview. */
export function assertDeadlinePlanCurrent(plan: DeadlinePlan, shots: readonly Shot[]): void {
  const keepers = shots.filter((shot) => shot.verdict === "keep");
  if (
    new Set(shots.map((shot) => shot.id)).size !== shots.length ||
    keepers.length !== plan.keeperIds.length ||
    keepers.some((shot, index) => shot.id !== plan.keeperIds[index])
  )
    throw new Error("The shoot changed. Preview a fresh deadline set before downloading.");
  const byId = new Map(keepers.map((shot) => [shot.id, shot]));
  for (const frame of plan.frames) {
    const shot = byId.get(frame.id);
    if (!shot || shot.file !== frame.file || versionKey(shot) !== frame.versionKey)
      throw new Error("The shoot changed. Preview a fresh deadline set before downloading.");
  }
}

/** Reuses the existing Studio renderer: no new JavaScript processing kernel. */
export const renderDeadlineImage: DeadlineRenderer = async (frame, recipe, signal) => {
  abortIfNeeded(signal);
  const bitmap = await decodeFile(frame.file, recipe.longestEdge);
  try {
    abortIfNeeded(signal);
    const canvas = document.createElement("canvas");
    renderToCanvas(canvas, bitmap, { ...frame.edits }, recipe.longestEdge, frame.focus);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("JPEG encoding failed."))),
        "image/jpeg",
        recipe.quality,
      );
    });
    abortIfNeeded(signal);
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    bitmap.close();
  }
};

function checkImage(image: DeadlineImage, edge: number): void {
  if (
    !(image.blob instanceof Blob) ||
    image.blob.type !== "image/jpeg" ||
    image.blob.size < 4 ||
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width < 1 ||
    image.height < 1 ||
    Math.max(image.width, image.height) > edge
  )
    throw new Error("The renderer returned an invalid or oversized JPEG.");
}

export async function prepareDeadlineExport(
  plan: DeadlinePlan,
  currentShots: () => readonly Shot[],
  options: {
    signal?: AbortSignal;
    render?: DeadlineRenderer;
    previous?: DeadlineAttempt;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<DeadlineAttempt> {
  assertDeadlinePlanCurrent(plan, currentShots());
  if (options.previous && options.previous.plan !== plan)
    throw new Error("Retry belongs to a different deadline preview.");
  const retained = new Map(options.previous?.images.map((image) => [image.id, image]) ?? []);
  const images: DeadlineSuccess[] = [];
  const failures: DeadlineAttempt["failures"][number][] = [];
  let bytes = 0;
  for (const frame of plan.frames) {
    if (options.signal?.aborted) break;
    assertDeadlinePlanCurrent(plan, currentShots());
    try {
      let image = retained.get(frame.id);
      if (!image) {
        const rendered = await (options.render ?? renderDeadlineImage)(
          frame,
          plan.recipe,
          options.signal,
        );
        checkImage(rendered, plan.recipe.longestEdge);
        if (bytes + rendered.blob.size > DEADLINE_LIMITS.bytes)
          throw new Error("Deadline ZIP exceeds 100 MiB. Lower the count, edge, or JPEG quality.");
        abortIfNeeded(options.signal);
        const sourceSha256 = await hashBlob(frame.file);
        const versionSha256 = await hashBlob(new Blob([sourceSha256, "\n", frame.versionKey]));
        image = Object.freeze({
          ...rendered,
          id: frame.id,
          sourceSha256,
          versionSha256,
          sha256: await hashBlob(rendered.blob),
        });
      }
      checkImage(image, plan.recipe.longestEdge);
      if (bytes + image.blob.size > DEADLINE_LIMITS.bytes)
        throw new Error("Deadline ZIP exceeds 100 MiB. Lower the count, edge, or JPEG quality.");
      abortIfNeeded(options.signal);
      images.push(image);
      bytes += image.blob.size;
    } catch (error) {
      if (options.signal?.aborted) break;
      failures.push({
        id: frame.id,
        name: frame.name,
        message: error instanceof Error ? error.message : "Could not render this frame.",
      });
    }
    options.onProgress?.(images.length + failures.length, plan.frames.length);
  }
  assertDeadlinePlanCurrent(plan, currentShots());
  return Object.freeze({
    plan,
    images: Object.freeze(images),
    failures: Object.freeze(failures),
    cancelled: options.signal?.aborted ?? false,
  });
}

/** Returns one complete archive only. Preparing never sends, downloads or changes picks. */
export async function createDeadlineDownload(
  attempt: DeadlineAttempt,
  currentShots: () => readonly Shot[],
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string; manifest: Record<string, unknown> }> {
  const { plan } = attempt;
  abortIfNeeded(signal);
  assertDeadlinePlanCurrent(plan, currentShots());
  if (attempt.cancelled || attempt.failures.length || attempt.images.length !== plan.frames.length)
    throw new Error(
      "Every selected frame must finish successfully. Retry failed frames before downloading.",
    );
  const byId = new Map(attempt.images.map((image) => [image.id, image]));
  if (byId.size !== plan.frames.length)
    throw new Error("Duplicate export receipts; prepare a fresh deadline set.");
  const entries: { path: string; bytes: Uint8Array }[] = [];
  const items = [];
  let bytes = 0;
  for (const frame of plan.frames) {
    abortIfNeeded(signal);
    const image = byId.get(frame.id);
    if (!image) throw new Error("A selected frame is missing. Prepare a fresh deadline set.");
    checkImage(image, plan.recipe.longestEdge);
    bytes += image.blob.size;
    if (bytes > DEADLINE_LIMITS.bytes) throw new Error("Deadline ZIP exceeds 100 MiB.");
    if (
      (await hashBlob(image.blob)) !== image.sha256 ||
      (await hashBlob(new Blob([image.sourceSha256, "\n", frame.versionKey]))) !==
        image.versionSha256
    )
      throw new Error("An export checksum failed. Prepare a fresh deadline set.");
    entries.push({ path: frame.filename, bytes: new Uint8Array(await image.blob.arrayBuffer()) });
    items.push({
      frameId: frame.id,
      filename: frame.filename,
      versionSha256: image.versionSha256,
      sha256: image.sha256,
      width: image.width,
      height: image.height,
      bytes: image.blob.size,
      source: {
        name: frame.name,
        relativePath: frame.relativePath,
        bytes: frame.file.size,
        modified: frame.file.lastModified,
        sha256: image.sourceSha256,
      },
      edits: frame.edits,
      cropFocus: frame.focus,
      rawRendering: frame.isRaw ? "embedded-preview-not-raw-development" : null,
    });
  }
  const manifest = {
    format: "lenslabs-deadline-set",
    version: 1,
    planId: plan.id,
    createdAt: plan.createdAt,
    state: "download-prepared-not-delivery-confirmed",
    renderer: DEADLINE_RENDERER,
    metadataPlacement: "manifest-sidecar-only-not-embedded-IPTC",
    recipe: plan.recipe,
    items,
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  // Account for the ZIP headers and directory too, not just JPEG payloads.
  if (bytes + manifestBytes.length + 100_000 > DEADLINE_LIMITS.bytes)
    throw new Error("Deadline ZIP exceeds 100 MiB including its manifest. Prepare a smaller set.");
  entries.push({ path: "manifest.json", bytes: manifestBytes });
  abortIfNeeded(signal);
  assertDeadlinePlanCurrent(plan, currentShots());
  const blob = makeZip(entries);
  assertDeadlinePlanCurrent(plan, currentShots());
  return { blob, filename: `${plan.recipe.prefix}-deadline.zip`, manifest };
}
