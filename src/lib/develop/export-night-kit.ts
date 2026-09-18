/**
 * Export night kit: borders visible in edit + baked into JPEG bytes,
 * named watermark kits (local store), and a cancelable serial export queue.
 * Originals stay local; dressing never uploads source files.
 */

export const EXPORT_NIGHT_KIT_STORAGE_KEY = "celinen.export-night-kits.v1";
export const EXPORT_NIGHT_KIT_MAX = 3;

export type ExportBorder = {
  enabled: boolean;
  /** Border thickness as a fraction of the long edge (0-0.12). */
  widthRatio: number;
  color: string;
};

export type WatermarkPosition = "center" | "bottom-right" | "bottom-left" | "top-right";

export type WatermarkKit = {
  id: string;
  name: string;
  text: string;
  opacity: number;
  position: WatermarkPosition;
  /** Font size as a fraction of the short edge. */
  fontScale: number;
};

export type ExportDressing = {
  border: ExportBorder;
  kit: WatermarkKit | null;
};

export type ExportNightKitStore = {
  kits: WatermarkKit[];
  activeKitId: string | null;
  border: ExportBorder;
};

export type SerialExportFailure<T> = {
  index: number;
  item: T;
  message: string;
};

export type SerialExportResult<T> = {
  completed: number;
  failures: SerialExportFailure<T>[];
  cancelled: boolean;
};

const DEFAULT_BORDER: ExportBorder = Object.freeze({
  enabled: false,
  widthRatio: 0.03,
  color: "#ffffff",
});

export function defaultExportBorder(): ExportBorder {
  return { ...DEFAULT_BORDER };
}

export function defaultWatermarkKits(): WatermarkKit[] {
  const kits: WatermarkKit[] = [
    {
      id: "kit-client-proof",
      name: "Client proof",
      text: "PROOF",
      opacity: 0.35,
      position: "center",
      fontScale: 0.14,
    },
    {
      id: "kit-brand-corner",
      name: "Brand corner",
      text: "(c) Celinen",
      opacity: 0.55,
      position: "bottom-right",
      fontScale: 0.045,
    },
    {
      id: "kit-web-mark",
      name: "Web mark",
      text: "lenslab.dev",
      opacity: 0.4,
      position: "bottom-left",
      fontScale: 0.04,
    },
  ];
  return kits.map((kit) => ({ ...kit }));
}

function clamp(n: number, low: number, high: number) {
  return Math.min(high, Math.max(low, n));
}

function isPosition(value: unknown): value is WatermarkPosition {
  return (
    value === "center" ||
    value === "bottom-right" ||
    value === "bottom-left" ||
    value === "top-right"
  );
}

function sanitizeColor(value: unknown): string {
  if (typeof value !== "string") return "#ffffff";
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed) || /^#[0-9a-fA-F]{3}$/.test(trimmed)) return trimmed;
  return "#ffffff";
}

export function sanitizeExportBorder(input: Partial<ExportBorder> | null | undefined): ExportBorder {
  return {
    enabled: Boolean(input?.enabled),
    widthRatio: clamp(Number(input?.widthRatio) || DEFAULT_BORDER.widthRatio, 0, 0.12),
    color: sanitizeColor(input?.color),
  };
}

export function sanitizeWatermarkKit(input: Partial<WatermarkKit> & { id: string; name: string }): WatermarkKit {
  const name = input.name.trim().slice(0, 40) || "Untitled kit";
  return {
    id: input.id.slice(0, 64),
    name,
    text: (input.text ?? name).toString().slice(0, 80),
    opacity: clamp(Number(input.opacity) || 0.4, 0.05, 1),
    position: isPosition(input.position) ? input.position : "bottom-right",
    fontScale: clamp(Number(input.fontScale) || 0.05, 0.02, 0.25),
  };
}

export function borderInsetPx(longEdge: number, border: ExportBorder): number {
  if (!border.enabled) return 0;
  return Math.max(0, Math.round(longEdge * border.widthRatio));
}

/** Output size after dressing; used by preview chrome and tests without canvas. */
export function dressedExportSize(
  width: number,
  height: number,
  border: ExportBorder,
): { width: number; height: number; inset: number } {
  const longEdge = Math.max(width, height);
  const inset = borderInsetPx(longEdge, border);
  return { width: width + inset * 2, height: height + inset * 2, inset };
}

export function exportDressingKey(dressing: ExportDressing): string {
  const border = sanitizeExportBorder(dressing.border);
  const kit = dressing.kit
    ? {
        id: dressing.kit.id,
        name: dressing.kit.name,
        text: dressing.kit.text,
        opacity: dressing.kit.opacity,
        position: dressing.kit.position,
        fontScale: dressing.kit.fontScale,
      }
    : null;
  return JSON.stringify({ border, kit });
}

export function dressingIsActive(dressing: ExportDressing): boolean {
  return Boolean(dressing.border.enabled || (dressing.kit && dressing.kit.text.trim()));
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function readRawStore(storage: StorageLike | null | undefined): unknown {
  if (!storage) return null;
  try {
    const raw = storage.getItem(EXPORT_NIGHT_KIT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function loadExportNightKitStore(
  storage: StorageLike | null | undefined = typeof localStorage === "undefined" ? null : localStorage,
): ExportNightKitStore {
  const defaults = defaultWatermarkKits();
  const parsed = readRawStore(storage);
  if (!parsed || typeof parsed !== "object") {
    return {
      kits: defaults,
      activeKitId: defaults[0]!.id,
      border: defaultExportBorder(),
    };
  }
  const record = parsed as {
    kits?: unknown;
    activeKitId?: unknown;
    border?: Partial<ExportBorder>;
  };
  const kitsIn = Array.isArray(record["kits"]) ? record["kits"] : [];
  const kits: WatermarkKit[] = [];
  for (const item of kitsIn) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<WatermarkKit>;
    if (typeof row.id !== "string" || typeof row.name !== "string") continue;
    kits.push(sanitizeWatermarkKit(row as Partial<WatermarkKit> & { id: string; name: string }));
    if (kits.length >= EXPORT_NIGHT_KIT_MAX) break;
  }
  const resolved = kits.length >= 2 ? kits : defaults;
  const storedActive = record["activeKitId"];
  const activeKitId =
    typeof storedActive === "string" && resolved.some((kit) => kit.id === storedActive)
      ? storedActive
      : (resolved[0]?.id ?? null);
  return {
    kits: resolved,
    activeKitId,
    border: sanitizeExportBorder(record["border"]),
  };
}

export function saveExportNightKitStore(
  store: ExportNightKitStore,
  storage: StorageLike | null | undefined = typeof localStorage === "undefined" ? null : localStorage,
): ExportNightKitStore {
  const kits = store.kits
    .slice(0, EXPORT_NIGHT_KIT_MAX)
    .map((kit) => sanitizeWatermarkKit(kit));
  if (kits.length < 2) {
    throw new Error("Keep at least two named watermark kits.");
  }
  const activeKitId =
    store.activeKitId && kits.some((kit) => kit.id === store.activeKitId)
      ? store.activeKitId
      : kits[0]!.id;
  const next: ExportNightKitStore = {
    kits,
    activeKitId,
    border: sanitizeExportBorder(store.border),
  };
  try {
    storage?.setItem(EXPORT_NIGHT_KIT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* Kits stay in memory if storage is blocked. */
  }
  return next;
}

export function upsertWatermarkKit(
  store: ExportNightKitStore,
  kit: WatermarkKit,
): ExportNightKitStore {
  const cleaned = sanitizeWatermarkKit(kit);
  const existing = store.kits.findIndex((row) => row.id === cleaned.id);
  let kits: WatermarkKit[];
  if (existing >= 0) {
    kits = store.kits.map((row, index) => (index === existing ? cleaned : row));
  } else {
    if (store.kits.length >= EXPORT_NIGHT_KIT_MAX)
      throw new Error(`At most ${EXPORT_NIGHT_KIT_MAX} watermark kits can be stored.`);
    kits = [...store.kits, cleaned];
  }
  return saveExportNightKitStore({ ...store, kits, activeKitId: cleaned.id });
}

export function activeWatermarkKit(store: ExportNightKitStore): WatermarkKit | null {
  if (!store.activeKitId) return null;
  return store.kits.find((kit) => kit.id === store.activeKitId) ?? null;
}

/** Upgrade legacy client sheet On/Off into a real kit name. "On" -> first kit; "Off"/empty -> "". */
export function resolveClientWatermarkKitName(
  value: string | null | undefined,
  kits: readonly WatermarkKit[] = defaultWatermarkKits(),
): string {
  const raw = (value ?? "").trim();
  if (!raw || /^off$/i.test(raw)) return "";
  if (/^on$/i.test(raw)) return kits[0]?.name ?? "Client proof";
  const byName = kits.find((kit) => kit.name.toLowerCase() === raw.toLowerCase());
  if (byName) return byName.name;
  const byId = kits.find((kit) => kit.id === raw);
  return byId?.name ?? raw.slice(0, 40);
}

export function findWatermarkKitByName(
  kits: readonly WatermarkKit[],
  name: string,
): WatermarkKit | null {
  const resolved = resolveClientWatermarkKitName(name, kits);
  if (!resolved) return null;
  return kits.find((kit) => kit.name.toLowerCase() === resolved.toLowerCase()) ?? null;
}

function drawWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  kit: WatermarkKit,
) {
  const text = kit.text.trim();
  if (!text) return;
  const shortEdge = Math.min(width, height);
  const fontPx = Math.max(12, Math.round(shortEdge * kit.fontScale));
  ctx.save();
  ctx.globalAlpha = kit.opacity;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = Math.max(1, Math.round(fontPx * 0.06));
  ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  const metrics = ctx.measureText(text);
  const pad = Math.round(shortEdge * 0.04);
  let x = width / 2;
  let y = height / 2;
  ctx.textAlign = "center";
  if (kit.position === "bottom-right") {
    ctx.textAlign = "right";
    x = width - pad;
    y = height - pad - fontPx * 0.2;
  } else if (kit.position === "bottom-left") {
    ctx.textAlign = "left";
    x = pad;
    y = height - pad - fontPx * 0.2;
  } else if (kit.position === "top-right") {
    ctx.textAlign = "right";
    x = width - pad;
    y = pad + fontPx * 0.4;
  } else {
    void metrics;
  }
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Bake border + watermark into JPEG bytes. Preview and download share this path. */
export async function dressExportJpeg(
  source: Blob,
  dressing: ExportDressing,
  options: { quality?: number; signal?: AbortSignal } = {},
): Promise<{ blob: Blob; width: number; height: number }> {
  options.signal?.throwIfAborted();
  if (!dressingIsActive(dressing)) {
    throw new Error("No border or watermark kit is active.");
  }
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    throw new Error("Export dressing needs a browser canvas.");
  }
  const border = sanitizeExportBorder(dressing.border);
  const bitmap = await createImageBitmap(source);
  try {
    options.signal?.throwIfAborted();
    const sized = dressedExportSize(bitmap.width, bitmap.height, border);
    const canvas = document.createElement("canvas");
    canvas.width = sized.width;
    canvas.height = sized.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Export dressing could not open a drawing surface.");
    if (border.enabled && sized.inset > 0) {
      ctx.fillStyle = border.color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(bitmap, sized.inset, sized.inset);
    if (dressing.kit) drawWatermark(ctx, canvas.width, canvas.height, dressing.kit);
    options.signal?.throwIfAborted();
    const quality = clamp(options.quality ?? 0.92, 0.5, 1);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!blob || blob.size < 4) throw new Error("Export dressing returned an incomplete JPEG.");
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    bitmap.close();
  }
}

/** Multi-photo export: one file after another. Cancel stops the next item; failures isolate. */
export async function runSerialExportQueue<T>(
  items: readonly T[],
  exportOne: (item: T, signal: AbortSignal, index: number) => Promise<void>,
  options: {
    signal?: AbortSignal;
    onProgress?: (done: number, total: number, item: T) => void;
  } = {},
): Promise<SerialExportResult<T>> {
  const failures: SerialExportFailure<T>[] = [];
  let completed = 0;
  for (let index = 0; index < items.length; index++) {
    if (options.signal?.aborted) {
      return { completed, failures, cancelled: true };
    }
    const item = items[index]!;
    try {
      await exportOne(item, options.signal ?? new AbortController().signal, index);
      completed += 1;
    } catch (error) {
      if (options.signal?.aborted) {
        return { completed, failures, cancelled: true };
      }
      failures.push({
        index,
        item,
        message: error instanceof Error ? error.message : "Export failed for this photo.",
      });
    }
    options.onProgress?.(completed + failures.length, items.length, item);
  }
  return { completed, failures, cancelled: Boolean(options.signal?.aborted) };
}
