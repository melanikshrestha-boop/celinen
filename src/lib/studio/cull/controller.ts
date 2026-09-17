/** One cull session, end to end: read the card on every core, keep ranking the
 * shoot while frames arrive, save as it goes, and record the photographer's
 * decisions with undo. No React here, so the same controller drives the screen,
 * the tests and anything else that wants to run a cull.
 */
import { cullEngine } from "./client";
import type { CullRow, CullVerdict } from "./engine";
import { ingestFiles } from "./pool";
import {
  applySuggestions,
  decide,
  ingestProgress,
  type CullFrame,
  type CullProgress,
} from "./session";
import { createCullWriter, type CullStore } from "./store";

export type CullSnapshot = {
  sessionId: string | null;
  frames: readonly CullFrame[];
  progress: CullProgress | null;
  /** A problem the photographer should know about, such as a failed save. */
  notice: string | null;
  canUndo: boolean;
};

type Listener = (snapshot: CullSnapshot) => void;

// Re-ranking ten thousand frames takes tens of milliseconds, so doing it about
// once a second while a card reads keeps suggestions current at no visible cost.
const RERANK_INTERVAL_MS = 1000;
const UNDO_DEPTH = 50;

export class CullController {
  // Mutated in place while a card reads; the screen receives a copy at most once
  // per paint. Copying on every arriving frame would be quadratic at 10k frames.
  private frames: CullFrame[] = [];
  private published: readonly CullFrame[] | null = null;
  private byId = new Map<string, number>();
  private sessionId: string | null = null;
  private progress: CullProgress | null = null;
  private notice: string | null = null;
  private listeners = new Set<Listener>();
  private undoStack: { frames: CullFrame[] }[] = [];
  private rerankTimer: ReturnType<typeof setTimeout> | null = null;
  private importing: AbortController | null = null;
  // The originals of the card read in this tab, for a full-quality loupe. A
  // reopened session has thumbnails only until its folder is imported again:
  // browsers do not let a page keep file access across a reload.
  private originals = new Map<string, File>();
  private emitQueued = false;

  constructor(private readonly store: CullStore) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): CullSnapshot {
    this.published ??= this.frames.slice();
    return {
      sessionId: this.sessionId,
      frames: this.published,
      progress: this.progress,
      notice: this.notice,
      canUndo: this.undoStack.length > 0,
    };
  }

  /** Frames arrive by the hundred per second; the screen needs one update per frame of animation. */
  private emit() {
    if (this.emitQueued) return;
    this.emitQueued = true;
    const run = () => {
      this.emitQueued = false;
      const snapshot = this.snapshot();
      for (const listener of this.listeners) listener(snapshot);
    };
    // A hidden tab never runs animation frames. A photographer who imports a
    // card and switches away should come back to a current screen, so fall back
    // to a slow timer while the page is not visible.
    const visible = typeof document === "undefined" || document.visibilityState !== "hidden";
    if (visible && typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else if (typeof document !== "undefined") setTimeout(run, 250);
    else queueMicrotask(run);
  }

  private replace(next: CullFrame[]) {
    this.frames = next;
    this.byId = new Map(next.map((frame, index) => [frame.id, index]));
    this.changed();
  }

  private changed() {
    this.published = null;
    this.emit();
  }

  async open(sessionId: string): Promise<void> {
    this.cancelImport();
    if (sessionId !== this.sessionId) this.originals.clear();
    const frames = await this.store.frames(sessionId);
    this.sessionId = sessionId;
    this.undoStack = [];
    this.progress = null;
    this.notice = null;
    this.replace(frames);
    await this.rerank();
  }

  /** Starts a new session from a card and reads it. Resolves when the card is done. */
  async importCard(name: string, files: readonly File[]): Promise<void> {
    this.cancelImport();
    const photos = files.filter((file) => file.size > 0);
    const session = await this.store.create(name);
    this.sessionId = session.id;
    this.undoStack = [];
    this.notice = null;
    this.originals.clear();
    this.replace([]);

    const controller = new AbortController();
    this.importing = controller;
    const writer = createCullWriter(this.store, session.id, {
      // A decision made while a frame still waits in the batch must be what is saved.
      latest: (frame) => {
        const index = this.byId.get(frame.id);
        return index === undefined ? frame : (this.frames[index] ?? frame);
      },
      onError: () => {
        this.notice =
          "Some frames could not be saved on this device. Keep this tab open until the import finishes.";
        this.emit();
      },
    });
    const started = performance.now();
    this.progress = ingestProgress(photos.length, 0, 0, 0);
    try {
      await ingestFiles(photos, {
        signal: controller.signal,
        onFrame: ({ frame, thumbnail, file }) => {
          this.byId.set(frame.id, this.frames.length);
          this.frames.push(frame);
          if (!frame.error) this.originals.set(frame.id, file);
          writer.add(frame, thumbnail);
          this.scheduleRerank();
        },
        onProgress: (read, failed, total) => {
          this.progress = ingestProgress(total, read, failed, performance.now() - started);
          this.changed();
        },
      });
    } finally {
      if (this.importing === controller) this.importing = null;
      await writer.flush();
    }
    this.replace([...this.frames].sort(captureOrder));
    await this.rerank();
  }

  cancelImport() {
    this.importing?.abort();
    this.importing = null;
  }

  private scheduleRerank() {
    if (this.rerankTimer) return;
    this.rerankTimer = setTimeout(() => {
      this.rerankTimer = null;
      void this.rerank();
    }, RERANK_INTERVAL_MS);
  }

  /** Asks the engine to rank the whole shoot again. Decisions are never touched. */
  async rerank(): Promise<void> {
    const measured = this.frames.filter((frame) => frame.reading && !frame.error);
    if (!measured.length) return this.emit();
    const engine = await cullEngine();
    if (!engine) {
      this.notice =
        "This browser cannot run the cull engine; frames can still be kept and rejected by hand.";
      return this.emit();
    }
    let rows: CullRow[];
    try {
      rows = engine.shoot(
        measured.map((frame) => ({
          reading: frame.reading!,
          captureTimeMs: frame.captureTimeMs,
          verdict: frame.decided ? frame.verdict : "undecided",
        })),
      );
    } catch (error) {
      this.notice = error instanceof Error ? error.message : "The shoot could not be ranked.";
      return this.emit();
    }
    const suggestions = new Map(rows.map((row, index) => [measured[index]!.id, row]));
    // Suggestions are not saved: reopening a session ranks it again from the
    // stored measurements, and saving them here would rewrite thousands of rows
    // a second while a card reads. Only the photographer's decisions persist.
    this.replace(applySuggestions(this.frames, suggestions));
  }

  /** Records the photographer's decision on these frames. Undoable. */
  async decide(ids: readonly string[], verdict: CullVerdict): Promise<void> {
    const changed: CullFrame[] = [];
    const before: CullFrame[] = [];
    const next = [...this.frames];
    for (const id of ids) {
      const index = this.byId.get(id);
      if (index === undefined) continue;
      const current = next[index]!;
      const updated = decide(current, verdict);
      if (updated === current) continue;
      before.push(current);
      next[index] = updated;
      changed.push(updated);
    }
    if (!changed.length) return;
    this.undoStack.push({ frames: before });
    if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
    this.replace(next);
    await this.persist(changed);
  }

  async undo(): Promise<void> {
    const step = this.undoStack.pop();
    if (!step) return;
    const next = [...this.frames];
    for (const frame of step.frames) {
      const index = this.byId.get(frame.id);
      if (index !== undefined) next[index] = frame;
    }
    this.replace(next);
    await this.persist(step.frames);
  }

  /** Every session stored for this account, newest first. */
  sessions() {
    return this.store.list();
  }

  /** The original file, when this tab read the card itself. */
  original(frameId: string): File | null {
    return this.originals.get(frameId) ?? null;
  }

  thumbnail(frameId: string): Promise<Blob | null> {
    if (!this.sessionId) return Promise.resolve(null);
    return this.store.thumbnail(this.sessionId, frameId);
  }

  private async persist(frames: readonly CullFrame[]) {
    if (!this.sessionId || !frames.length) return;
    try {
      await this.store.update(this.sessionId, frames);
    } catch {
      this.notice =
        "The latest decisions are not saved on this device yet. Keep this tab open and try again.";
      this.emit();
    }
  }

  dispose() {
    this.cancelImport();
    if (this.rerankTimer) clearTimeout(this.rerankTimer);
    this.listeners.clear();
    this.originals.clear();
    this.store.close();
  }
}

function captureOrder(a: CullFrame, b: CullFrame) {
  if (a.captureTimeMs !== null && b.captureTimeMs !== null && a.captureTimeMs !== b.captureTimeMs)
    return a.captureTimeMs - b.captureTimeMs;
  return a.name.localeCompare(b.name, undefined, { numeric: true });
}
