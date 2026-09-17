/** Review-size previews kept on this device, so the loupe shows a real photo
 * after a reload in every browser — not a 320 px thumbnail.
 *
 * Each preview is a JPEG in the Origin Private File System, indexed in the cull
 * database, and sized to the photographer's own screen: a 4K retina display
 * gets a 3840 px preview, never more than the picture inside the file holds.
 * A sports card is ten thousand frames, so the library lives inside a budget
 * taken from the browser's own quota and gives space back in the order a
 * photographer would: frames they rejected, then frames the engine would
 * reject, then whole sessions, oldest first. The open session's keepers and
 * undecided frames are never given up for more previews.
 */
import type { CullVerdict } from "./engine";
import { isNotFound, openFolder, previewFolder, removeEntry, type OpfsDirectory } from "./opfs";
import type { CullFrame } from "./session";
import type { CullPreviewRow, CullSessionSummary, CullStore } from "./store";

/** Never smaller than this, whatever the screen says. */
export const PREVIEW_MIN_EDGE = 2048;
/** Nor larger: past an 8K screen this is storage spent on nothing. */
export const PREVIEW_MAX_EDGE = 7680;
export const PREVIEW_QUALITY = 0.9;

/**
 * The long edge worth storing: the screen's own pixels, so the loupe shows a
 * real photograph at 1:1 instead of an upscaled 2048 px one. Capping to what
 * the original holds happens in the decode, which never enlarges.
 */
export function previewEdge(
  screen?: { width: number; height: number } | undefined,
  devicePixelRatio?: number | undefined,
): number {
  const display = screen ?? (typeof globalThis === "undefined" ? undefined : globalThis.screen);
  const ratio =
    devicePixelRatio ?? (typeof globalThis === "undefined" ? 1 : globalThis.devicePixelRatio || 1);
  const pixels = display ? Math.max(display.width, display.height) * ratio : 0;
  if (!(pixels > 0)) return PREVIEW_MIN_EDGE;
  return Math.min(PREVIEW_MAX_EDGE, Math.max(PREVIEW_MIN_EDGE, Math.ceil(pixels)));
}

/** What a preview is assumed to cost before it exists: a busy 2048 px sports
 * frame at q0.9 is 0.5–1 MB, and area grows with the square of the edge. */
export function previewBytesEstimate(edge: number): number {
  const scale = Math.max(1, edge / PREVIEW_MIN_EDGE);
  return Math.ceil(1024 * 1024 * scale * scale);
}
export const PREVIEW_BYTES_ESTIMATE = previewBytesEstimate(PREVIEW_MIN_EDGE);

/** Previews made before this generation are remade when the originals are at
 * hand again: generation 2 turns RAW previews the way their container says and
 * is sized to the screen. Older files stay readable until they are replaced,
 * so a session whose originals are gone keeps the picture it has. */
export const PREVIEW_GENERATION = 2;
/** Space left for everything else this origin stores (the cull database's own
 * thumbnails and frames, Studio's saved shoots). */
const RESERVE_BYTES = 512 * 1024 * 1024;
/** Share of the browser's quota previews may grow into. */
const QUOTA_SHARE = 0.8;
/** How much may be written between two `storage.estimate()` calls. Estimates
 * are coarse and not free, so they are not taken for every frame. */
const ESTIMATE_EVERY_BYTES = 64 * 1024 * 1024;

export type StorageEstimateLike = { quota?: number | undefined; usage?: number | undefined };

export type StorageLike = {
  estimate(): Promise<StorageEstimateLike>;
  persist?: (() => Promise<boolean>) | undefined;
  persisted?: (() => Promise<boolean>) | undefined;
};

/**
 * Bytes previews may occupy in total. `previewBytes` is what the previews held
 * when the estimate was taken, so the rest of `usage` is everything else.
 */
export function previewBudget(estimate: StorageEstimateLike, previewBytes: number): number {
  const quota = estimate.quota ?? 0;
  const usage = estimate.usage ?? 0;
  if (!(quota > 0)) return 0;
  const other = Math.max(0, usage - previewBytes);
  const reserve = Math.min(RESERVE_BYTES, quota * 0.1);
  return Math.max(0, Math.floor(quota * QUOTA_SHARE - other - reserve));
}

export type EvictionCandidate = {
  row: CullPreviewRow;
  /** When the session was last touched; older sessions give up space first. */
  sessionUpdatedAt: number;
  /** The photographer's verdict, when they decided. */
  decided: CullVerdict | null;
  /** The engine's current suggestion is to reject. */
  suggestedReject: boolean;
};

/**
 * Which previews to give up, first to last. Rows not listed are never evicted:
 * the open session's keepers and undecided frames.
 *
 * 1. Frames the photographer rejected, oldest session first.
 * 2. Frames the engine suggests rejecting that nobody has decided.
 * 3. Whole sessions other than the open one, oldest first — undecided frames
 *    before keepers within each.
 */
export function evictionOrder(
  candidates: readonly EvictionCandidate[],
  openSessionId: string | null,
): CullPreviewRow[] {
  const tier = (candidate: EvictionCandidate): number | null => {
    if (candidate.decided === "reject") return 0;
    if (candidate.decided !== "keep" && candidate.suggestedReject) return 1;
    if (candidate.row.sessionId === openSessionId) return null;
    return candidate.decided === "keep" ? 3 : 2;
  };
  const ranked: { candidate: EvictionCandidate; tier: number }[] = [];
  for (const candidate of candidates) {
    if (candidate.row.failed || !candidate.row.bytes) continue;
    const rank = tier(candidate);
    if (rank !== null) ranked.push({ candidate, tier: rank });
  }
  const sessionTier = (rank: number) => (rank >= 2 ? 2 : rank);
  ranked.sort(
    (a, b) =>
      sessionTier(a.tier) - sessionTier(b.tier) ||
      a.candidate.sessionUpdatedAt - b.candidate.sessionUpdatedAt ||
      // Inside one old session: undecided before keepers.
      a.tier - b.tier ||
      a.candidate.row.createdAt - b.candidate.row.createdAt,
  );
  return ranked.map(({ candidate }) => candidate.row);
}

type LibraryStore = Pick<
  CullStore,
  "list" | "frames" | "previews" | "preview" | "putPreview" | "deletePreviews"
>;

const key = (sessionId: string, frameId: string) => JSON.stringify([sessionId, frameId]);

/** The open session as the controller holds it: decisions and fresh suggestions. */
export type OpenSession = { sessionId: string; frames: readonly CullFrame[] };

export class PreviewLibrary {
  private rows: Map<string, CullPreviewRow> | null = null;
  private loading: Promise<Map<string, CullPreviewRow>> | null = null;
  private bytes = 0;
  private budget: { limit: number; writtenSince: number } | null = null;
  private persistAsked = false;

  constructor(
    private readonly deps: {
      scope: string;
      store: LibraryStore;
      root: () => Promise<OpfsDirectory> | null;
      storage: StorageLike | null;
    },
  ) {}

  private index(): Promise<Map<string, CullPreviewRow>> {
    if (this.rows) return Promise.resolve(this.rows);
    this.loading ??= this.deps.store.previews().then(
      (rows) => {
        this.rows = new Map(rows.map((row) => [key(row.sessionId, row.frameId), row]));
        this.bytes = rows.reduce((sum, row) => sum + row.bytes, 0);
        this.loading = null;
        return this.rows;
      },
      (error: unknown) => {
        this.loading = null;
        throw error;
      },
    );
    return this.loading;
  }

  /** Reads the index again, for a session another tab may have written to. */
  refresh() {
    this.rows = null;
    this.loading = null;
    this.budget = null;
  }

  async totalBytes(): Promise<number> {
    await this.index();
    return this.bytes;
  }

  /** Frame ids in this session that already have a preview of this generation,
   * or failed to get one. A preview from an older generation is not counted, so
   * it is remade the next time the originals are at hand. */
  async covered(sessionId: string): Promise<Set<string>> {
    const rows = await this.index();
    const ids = new Set<string>();
    for (const row of rows.values())
      if (row.sessionId === sessionId && isCurrentPreview(row.file)) ids.add(row.frameId);
    return ids;
  }

  async folder(sessionId: string, create: boolean): Promise<OpfsDirectory | null> {
    const root = await this.deps.root();
    if (!root) return null;
    return openFolder(root, previewFolder(this.deps.scope, sessionId), create);
  }

  /** The stored preview for a frame, or null. A row whose file has gone
   * (cleared site data, a crash between delete and unindex) is dropped. */
  async read(sessionId: string, frameId: string): Promise<File | null> {
    const rows = await this.index();
    const row = rows.get(key(sessionId, frameId));
    if (!row || row.failed) return null;
    try {
      const folder = await this.folder(sessionId, false);
      const file = folder ? await (await folder.getFileHandle(row.file)).getFile() : null;
      if (file && file.size === row.bytes) return file;
    } catch (error) {
      if (!isNotFound(error)) return null; // unreadable right now; keep the row
    }
    await this.forget([row]);
    return null;
  }

  /** Asks the browser not to clear previews under storage pressure. Once per page. */
  async persist(): Promise<boolean> {
    const storage = this.deps.storage;
    if (this.persistAsked || !storage?.persist) return false;
    this.persistAsked = true;
    try {
      if (storage.persisted && (await storage.persisted())) return true;
      return await storage.persist();
    } catch {
      return false;
    }
  }

  private async limit(force: boolean): Promise<number> {
    if (!this.deps.storage) return 0;
    if (!force && this.budget && this.budget.writtenSince < ESTIMATE_EVERY_BYTES)
      return this.budget.limit;
    let estimate: StorageEstimateLike;
    try {
      estimate = await this.deps.storage.estimate();
    } catch {
      estimate = {};
    }
    const limit = previewBudget(estimate, this.bytes);
    this.budget = { limit, writtenSince: 0 };
    return limit;
  }

  /**
   * Makes room for `bytes` more, evicting in `evictionOrder`. False when the
   * budget cannot fit it without touching what must be kept.
   */
  async reserve(bytes: number, open: OpenSession | null, force = false): Promise<boolean> {
    await this.index();
    const limit = await this.limit(force);
    if (this.bytes + bytes <= limit) return true;
    const order = await this.evictable(open);
    const doomed: CullPreviewRow[] = [];
    let freed = 0;
    for (const row of order) {
      if (this.bytes - freed + bytes <= limit) break;
      doomed.push(row);
      freed += row.bytes;
    }
    if (this.bytes - freed + bytes > limit) return false;
    await this.evict(doomed);
    return true;
  }

  private async evictable(open: OpenSession | null): Promise<CullPreviewRow[]> {
    const rows = await this.index();
    const sessions = new Map<string, CullSessionSummary>(
      (await this.deps.store.list()).map((session) => [session.id, session]),
    );
    const decisions = new Map<string, Map<string, CullFrame>>();
    if (open) decisions.set(open.sessionId, new Map(open.frames.map((frame) => [frame.id, frame])));
    const candidates: EvictionCandidate[] = [];
    for (const row of rows.values()) {
      let frames = decisions.get(row.sessionId);
      if (!frames) {
        const stored = sessions.has(row.sessionId)
          ? await this.deps.store.frames(row.sessionId).catch(() => [])
          : [];
        frames = new Map(stored.map((frame) => [frame.id, frame]));
        decisions.set(row.sessionId, frames);
      }
      const frame = frames.get(row.frameId);
      const openFrame = open?.sessionId === row.sessionId;
      candidates.push({
        row,
        // A session that no longer exists is the oldest of all.
        sessionUpdatedAt: sessions.get(row.sessionId)?.updatedAt ?? Number.NEGATIVE_INFINITY,
        decided: frame?.decided ? frame.verdict : null,
        suggestedReject:
          openFrame && frame ? frame.suggestion?.verdict === "reject" : row.suggestedReject,
      });
    }
    return evictionOrder(candidates, open?.sessionId ?? null);
  }

  /** Deletes preview files, then their index rows. A crash in between leaves
   * rows pointing at nothing, which `read` cleans up; never files nobody counts. */
  async evict(rows: readonly CullPreviewRow[]) {
    if (!rows.length) return;
    const bySession = new Map<string, CullPreviewRow[]>();
    for (const row of rows) {
      const list = bySession.get(row.sessionId);
      if (list) list.push(row);
      else bySession.set(row.sessionId, [row]);
    }
    for (const [sessionId, list] of bySession) {
      const folder = await this.folder(sessionId, false).catch(() => null);
      if (folder) for (const row of list) await removeEntry(folder, row.file).catch(() => {});
    }
    await this.forget(rows);
  }

  private async forget(rows: readonly CullPreviewRow[]) {
    const index = await this.index();
    for (const row of rows) {
      if (index.delete(key(row.sessionId, row.frameId))) this.bytes -= row.bytes;
    }
    await this.deps.store.deletePreviews(rows);
  }

  /** Indexes a preview the worker has written, removing the file it replaces. */
  async record(row: CullPreviewRow) {
    const index = await this.index();
    const previous = index.get(key(row.sessionId, row.frameId));
    if (previous && previous.file !== row.file) {
      const folder = await this.folder(row.sessionId, false).catch(() => null);
      if (folder) await removeEntry(folder, previous.file).catch(() => {});
    }
    await this.deps.store.putPreview(row);
    if (previous) this.bytes -= previous.bytes;
    index.set(key(row.sessionId, row.frameId), row);
    this.bytes += row.bytes;
    if (this.budget) this.budget.writtenSince += row.bytes;
  }

  /** Removes every preview file and index row of a session. Call when the session is deleted. */
  async deleteSession(sessionId: string) {
    const index = await this.index();
    const rows = [...index.values()].filter((row) => row.sessionId === sessionId);
    const root = await this.deps.root();
    if (root) {
      const parent = await openFolder(root, previewFolder(this.deps.scope), false);
      const [, , folderName] = previewFolder(this.deps.scope, sessionId);
      if (parent && folderName) await removeEntry(parent, folderName, true);
    }
    await this.forget(rows);
  }
}

/** A file name for a frame's preview: frame ids are card paths, which can be
 * longer than a file name may be and hold characters a folder cannot. */
export async function previewFileName(frameId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(frameId));
  const hex = Array.from(new Uint8Array(digest).subarray(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  // The generation rides in the name, so a preview made by an older build is
  // recognized without a database migration.
  return `${hex}-${PREVIEW_GENERATION}.jpg`;
}

/** Whether a stored preview file was made by this build's preview pass. */
export function isCurrentPreview(file: string): boolean {
  return file.endsWith(`-${PREVIEW_GENERATION}.jpg`);
}
