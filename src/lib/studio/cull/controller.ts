/** One cull session, end to end: read the card on every core, keep ranking the
 * shoot while frames arrive, save as it goes, and record the photographer's
 * decisions with undo. No React here, so the same controller drives the screen,
 * the tests and anything else that wants to run a cull.
 */
import { cullEngine } from "./client";
import type { CullRow, CullVerdict } from "./engine";
import { decodeScaled } from "./decode";
import { applyTaste, keepBiasFromEye, loadEye, rememberDecision, saveEye } from "./eye";
import { pickLoupeImage, type LoupeImage } from "./loupe-source";
import { findPortraitFaceOriented, type PortraitFace } from "./portrait-face";
import { ingestFiles } from "./pool";
import type { PreviewLibrary } from "./preview-library";
import type { PreviewQueue } from "./preview-queue";
import {
  applySuggestions,
  decide,
  effectiveVerdict,
  ingestProgress,
  type CullFrame,
  type CullProgress,
} from "./session";
import {
  OriginalResolver,
  requestSourcePermission,
  SourcePermissionError,
  sourcePermission,
  type CullPermission,
  type CullSourceRoot,
} from "./sources";
import { createCullWriter, type CullStore } from "./store";

/**
 * Where the session's originals stand, for the loupe.
 * - live: this tab imported the card and still holds its files.
 * - connected: stored handles resolve (permission granted).
 * - reconnect: stored handles need the photographer's permission again.
 * - locate: nothing stored, but this browser can pick the folder to find them.
 * - unavailable: previews and thumbnails only.
 */
export type CullOriginals = "live" | "connected" | "reconnect" | "locate" | "unavailable";

export type CullControllerOptions = {
  /** Review previews in the private file system; absent where the browser cannot keep them. */
  previews?: { library: PreviewLibrary; queue: PreviewQueue } | null | undefined;
  /** This browser has a folder picker that returns a handle. */
  canLocate?: boolean | undefined;
  /** Account scope for on-device taste memory. */
  scope?: string | undefined;
};

export type CullSnapshot = {
  sessionId: string | null;
  frames: readonly CullFrame[];
  progress: CullProgress | null;
  /** A problem the photographer should know about, such as a failed save. */
  notice: string | null;
  canUndo: boolean;
  originals: CullOriginals;
};

type Listener = (snapshot: CullSnapshot) => void;

// Re-ranking ten thousand frames takes tens of milliseconds, so doing it about
// once a second while a card reads keeps suggestions current at no visible cost.
const RERANK_INTERVAL_MS = 1000;
const UNDO_DEPTH = 50;
/** Frames tried when adopting a picked folder as a session's originals. */
const LOCATE_PROBES = 8;

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
  // The originals of the card read in this tab, for a full-quality loupe.
  // Browsers do not let a page keep a File across a reload; handles (below)
  // and stored previews cover the loupe after one.
  private originals = new Map<string, File>();
  // Where the card sits on disk, in browsers that hand out file handles.
  private roots: readonly CullSourceRoot[] = [];
  private resolver: OriginalResolver | null = null;
  private originalsState: CullOriginals = "unavailable";
  private previewRun: { abort: AbortController; done: Promise<void> } | null = null;
  private emitQueued = false;

  constructor(
    private readonly store: CullStore,
    private readonly options: CullControllerOptions = {},
  ) {}

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
      originals: this.originalsState,
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

  private frame(frameId: string): CullFrame | undefined {
    const index = this.byId.get(frameId);
    return index === undefined ? undefined : this.frames[index];
  }

  async open(sessionId: string): Promise<void> {
    this.cancelImport();
    this.stopPreviews();
    if (sessionId !== this.sessionId) this.forgetOriginals();
    const frames = await this.store.frames(sessionId);
    this.sessionId = sessionId;
    this.undoStack = [];
    this.progress = null;
    this.notice = null;
    this.replace(frames);
    await this.rerank();
    void this.rescanMissedFaces();
    await this.connectSources(sessionId);
  }

  /** Starts a new session from a card and reads it. Resolves when the card is done.
   * `roots` are the handles the card came through, where the browser offers them. */
  async importCard(
    name: string,
    files: readonly File[],
    roots: readonly CullSourceRoot[] = [],
  ): Promise<void> {
    this.cancelImport();
    this.stopPreviews();
    const photos = files.filter((file) => file.size > 0);
    const session = await this.store.create(name);
    this.sessionId = session.id;
    this.undoStack = [];
    this.notice = null;
    this.forgetOriginals();
    this.originalsState = "live";
    if (roots.length) {
      this.roots = [...roots];
      this.resolver = new OriginalResolver(this.roots);
      // Not part of the ingest: a browser that cannot store handles still reads the card.
      void Promise.resolve()
        .then(() => this.store.saveSources(session.id, roots))
        .catch(() => {});
    }
    this.replace([]);

    const controller = new AbortController();
    this.importing = controller;
    const writer = createCullWriter(this.store, session.id, {
      // A decision made while a frame still waits in the batch must be what is saved.
      latest: (frame) => this.frame(frame.id) ?? frame,
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
        onEyesUnavailable: () => {
          this.notice =
            "Eyes are not being checked on this device: the face models could not be loaded. Focus, exposure and duplicates still are.";
          this.emit();
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
    void this.rescanMissedFaces();
    // Only now, with every core free again, do previews begin.
    if (this.sessionId === session.id) this.startPreviews();
  }

  cancelImport() {
    this.importing?.abort();
    this.importing = null;
  }

  private forgetOriginals() {
    this.originals.clear();
    this.roots = [];
    this.resolver = null;
    this.originalsState = "unavailable";
  }

  /** Learns whether this session's originals can be reached and, if so, resumes
   * its previews. Never prompts: a prompt needs the photographer's click. */
  private async connectSources(sessionId: string) {
    if (this.originals.size) {
      this.originalsState = "live";
      this.startPreviews();
      return this.emit();
    }
    // A store that cannot say (an older or partial one) means no stored handles.
    const roots = await Promise.resolve()
      .then(() => this.store.sources(sessionId))
      .catch((): CullSourceRoot[] => []);
    if (this.sessionId !== sessionId) return;
    this.roots = roots;
    if (!roots.length) {
      this.originalsState = this.options.canLocate ? "locate" : "unavailable";
      return this.emit();
    }
    const permission = await sourcePermission(roots);
    if (this.sessionId === sessionId) this.applyPermission(permission);
  }

  private applyPermission(permission: CullPermission) {
    if (permission === "granted") {
      this.resolver = new OriginalResolver(this.roots);
      this.originalsState = "connected";
      this.startPreviews();
    } else {
      this.resolver = null;
      // A refusal is the photographer's answer; the action is not offered again.
      this.originalsState = permission === "prompt" ? "reconnect" : "unavailable";
    }
    this.emit();
  }

  /** Asks for access to the stored originals. Call from the photographer's click. */
  async reconnect(): Promise<CullOriginals> {
    if (this.originalsState !== "reconnect" || !this.roots.length) return this.originalsState;
    const sessionId = this.sessionId;
    const permission = await requestSourcePermission(this.roots);
    if (this.sessionId === sessionId) this.applyPermission(permission);
    return this.originalsState;
  }

  /**
   * Adopts folders or files the photographer picked as this session's originals.
   * Accepted only when frames of the session resolve through them with matching
   * size and date, so picking the wrong folder changes nothing.
   */
  async locate(roots: readonly CullSourceRoot[]): Promise<boolean> {
    const sessionId = this.sessionId;
    if (!sessionId || !roots.length) return false;
    const resolver = new OriginalResolver(roots);
    const readable = this.frames.filter((frame) => !frame.error);
    // Spread across the card, so a folder holding part of it still counts.
    const probes =
      readable.length <= LOCATE_PROBES
        ? readable
        : Array.from(
            { length: LOCATE_PROBES },
            (_, index) => readable[Math.floor((index * readable.length) / LOCATE_PROBES)]!,
          );
    let found = false;
    for (const frame of probes) {
      if (await resolver.resolve(frame).catch(() => null)) {
        found = true;
        break;
      }
    }
    if (this.sessionId !== sessionId) return false;
    if (!found) {
      this.notice = "Those files are not this shoot's originals.";
      this.emit();
      return false;
    }
    this.notice = null;
    this.roots = [...roots];
    await this.store.saveSources(sessionId, roots).catch(() => {});
    if (this.sessionId === sessionId) this.applyPermission("granted");
    return true;
  }

  /** Makes review previews for the open session from whichever originals are at hand. */
  private startPreviews() {
    const previews = this.options.previews;
    const sessionId = this.sessionId;
    if (!previews || !sessionId) return;
    if (this.originalsState !== "live" && this.originalsState !== "connected") return;
    this.stopPreviews();
    const abort = new AbortController();
    const resolver = this.resolver;
    const run = { abort, done: Promise.resolve() };
    this.previewRun = run;
    run.done = previews.queue
      .run({
        sessionId,
        frames: () => this.frames,
        frame: (id) => this.frame(id),
        original: async (frame) =>
          this.originals.get(frame.id) ?? (resolver ? resolver.resolve(frame) : null),
        signal: abort.signal,
      })
      .then(
        (result) => {
          if (result.end === "permission" && this.resolver === resolver) void this.permissionLost();
        },
        // Previews improve the loupe; they are never a failure to report.
        () => {},
      )
      .finally(() => {
        if (this.previewRun === run) this.previewRun = null;
      });
  }

  /** Stops the preview run; resolves once the photo it was writing has landed. */
  private stopPreviews(): Promise<void> {
    const run = this.previewRun;
    this.previewRun = null;
    if (!run) return Promise.resolve();
    run.abort.abort();
    return run.done;
  }

  /** Access went away mid-session (revoked in site settings). Ask where it stands now. */
  private async permissionLost() {
    const sessionId = this.sessionId;
    this.resolver = null;
    this.stopPreviews();
    if (!this.roots.length) return;
    const permission = await sourcePermission(this.roots);
    if (this.sessionId !== sessionId) return;
    this.originalsState = permission === "denied" ? "unavailable" : "reconnect";
    this.emit();
  }

  /** The best picture of a frame this browser can paint right now. */
  loupeImage(frameId: string): Promise<LoupeImage | null> {
    const sessionId = this.sessionId;
    const frame = this.frame(frameId);
    if (!sessionId || !frame) return Promise.resolve(null);
    const resolver = this.originalsState === "connected" ? this.resolver : null;
    return pickLoupeImage({
      live: () => this.originals.get(frameId) ?? null,
      reconnected: async () => {
        if (!resolver) return null;
        try {
          return await resolver.resolve(frame);
        } catch (error) {
          if (error instanceof SourcePermissionError && this.resolver === resolver)
            void this.permissionLost();
          return null;
        }
      },
      preview: async () => (await this.options.previews?.library.read(sessionId, frameId)) ?? null,
      thumbnail: () => this.store.thumbnail(sessionId, frameId),
    });
  }

  /** Deletes a session with its thumbnails, stored handles and previews. */
  async deleteSession(sessionId: string): Promise<void> {
    if (sessionId === this.sessionId) {
      this.cancelImport();
      const stopped = this.stopPreviews();
      this.forgetOriginals();
      this.sessionId = null;
      this.undoStack = [];
      this.progress = null;
      this.replace([]);
      // A preview mid-write would otherwise land after its folder is gone.
      await stopped;
    }
    await this.store.deleteSession(sessionId);
    await this.options.previews?.library.deleteSession(sessionId);
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
      const eye = this.options.scope ? loadEye(this.options.scope) : { samples: [] };
      rows = engine.shoot(
        measured.map((frame) => ({
          reading: applyTaste(frame.reading!, eye),
          captureTimeMs: frame.captureTimeMs,
          verdict: frame.decided ? frame.verdict : "undecided",
        })),
        { keepBias: keepBiasFromEye(eye) },
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

  /** A face the loupe found on a frame ingest missed (Safari has no FaceDetector). */
  noteFace(id: string, box: PortraitFace): void {
    const index = this.byId.get(id);
    if (index === undefined) return;
    const frame = this.frames[index]!;
    if (!frame.reading) return;
    if (
      frame.reading.hasFace &&
      frame.reading.faceBox &&
      Math.abs(frame.reading.faceBox.x - box.x) < 0.02 &&
      Math.abs(frame.reading.faceBox.y - box.y) < 0.02
    )
      return;
    const next = [...this.frames];
    next[index] = {
      ...frame,
      reading: {
        ...frame.reading,
        hasFace: true,
        faceBox: box,
        subjectX: box.x + box.width / 2,
        subjectY: box.y + box.height * 0.42,
      },
    };
    this.replace(next);
    void this.persist([next[index]!]);
    this.scheduleRerank();
  }

  /** Old sessions were measured without a face finder. Thumbnails are enough to
   * recover a head, so opening a card does not keep saying "no face" forever. */
  private async rescanMissedFaces() {
    const sessionId = this.sessionId;
    if (!sessionId || typeof createImageBitmap !== "function") return;
    const missed = this.frames
      .filter((frame) => frame.reading && !frame.reading.hasFace && !frame.reading.faceBox)
      .slice(0, 300);
    for (let index = 0; index < missed.length; index++) {
      const frame = missed[index]!;
      if (index && index % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      if (this.sessionId !== sessionId) return;
      const blob = await this.store.thumbnail(sessionId, frame.id).catch(() => null);
      if (!blob?.size) continue;
      try {
        const bitmap = await decodeScaled(blob, 320);
        const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(16, Math.round(bitmap.width * scale));
        const h = Math.max(16, Math.round(bitmap.height * scale));
        const canvas =
          typeof OffscreenCanvas === "function"
            ? new OffscreenCanvas(w, h)
            : typeof document !== "undefined"
              ? document.createElement("canvas")
              : null;
        if (!canvas) {
          bitmap.close();
          continue;
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          bitmap.close();
          continue;
        }
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close();
        const found = findPortraitFaceOriented(
          ctx.getImageData(0, 0, w, h).data,
          w,
          h,
          frame.reading?.afBox,
        );
        if (found) this.noteFace(frame.id, found.uprightBox);
      } catch {
        /* a broken thumbnail is not a face */
      }
    }
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
    if (this.options.scope) {
      let eye = loadEye(this.options.scope);
      for (const frame of changed) {
        if (!frame.reading) continue;
        eye = rememberDecision(eye, frame.reading, verdict);
      }
      saveEye(this.options.scope, eye);
    }
    await this.persist(changed);
    this.scheduleRerank();
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

  /** Keepers this tab still holds as Files, in capture order. */
  keeperFiles(): File[] {
    const files: File[] = [];
    for (const frame of this.frames) {
      if (effectiveVerdict(frame) !== "keep") continue;
      const file = this.originals.get(frame.id);
      if (file?.size) files.push(file);
    }
    return files;
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
    this.stopPreviews();
    if (this.rerankTimer) clearTimeout(this.rerankTimer);
    this.listeners.clear();
    this.forgetOriginals();
    this.store.close();
  }
}

function captureOrder(a: CullFrame, b: CullFrame) {
  if (a.captureTimeMs !== null && b.captureTimeMs !== null && a.captureTimeMs !== b.captureTimeMs)
    return a.captureTimeMs - b.captureTimeMs;
  return a.name.localeCompare(b.name, undefined, { numeric: true });
}
