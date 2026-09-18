/** One cull session, end to end: read the card on every core, keep ranking the
 * shoot while frames arrive, save as it goes, and record the photographer's
 * decisions with undo. No React here, so the same controller drives the screen,
 * the tests and anything else that wants to run a cull.
 */
import { mergeCodeTables, parseCodeReplacements, rosterCodes, type CodeTable } from "./captions";
import { cullEngine } from "./client";
import type { CullRow, CullVerdict } from "./engine";
import { decodeScaled } from "./decode";
import { applyTaste, keepBiasFromEye, loadEye, rememberDecision, saveEye } from "./eye";
import { startBackupIngest, type BackupReport } from "./handoff/backup-ingest";
import { exportKeepers } from "./handoff/export-keepers";
import type { HandoffTarget } from "./handoff/target";
import type { HandoffProgress, HandoffReport } from "./handoff/types";
import { rankKeepers, refineFocusRows, targetRow } from "./keepers";
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
  markFrame,
  type CullFrame,
  type CullLabel,
  type CullMarks,
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
import { createCullWriter, type CullCodeTableRow, type CullStore } from "./store";

/** One loaded caption code source, as the screen lists it. */
export type CullCodeSource = {
  id: string;
  name: string;
  kind: "codes" | "roster";
  prefix: string;
  count: number;
};

/** Every caption code this account has loaded, merged in load order. */
export type CullCodes = { sources: readonly CullCodeSource[]; table: CodeTable };

/** Where a card's backup copy stands. Second copies are optional and never
 * hold up the cull: a failed backup is reported, never thrown. */
export type CullBackupState = {
  files: number;
  totalFiles: number;
  bytes: number;
  totalBytes: number;
  /** Copies both destinations have finished, when there are two. */
  done: boolean;
  failed: number;
  cancelled: boolean;
};

/** Where the keepers go and how they are named. */
export type CullExportRequest = {
  target: HandoffTarget;
  /** The frames to send; without it, the shoot's keepers. */
  ids?: readonly string[] | undefined;
  /** File name template without extension; `{filename}` by default. */
  renameTemplate?: string | undefined;
  folderTemplate?: string | undefined;
  /** Write XMP (stars, label, caption, tag) beside or inside the copies. Default on. */
  sidecars?: boolean | undefined;
  signal?: AbortSignal | undefined;
  onProgress?: ((progress: HandoffProgress) => void) | undefined;
  /** Told while the originals are being found, before any copy starts. */
  onPrepare?: ((found: number, total: number) => void) | undefined;
};

/** Originals resolved at once when a reopened session has to find them again. */
const RESOLVE_LANES = 8;

/** Lightroom's own label names, which it matches by text. */
const LABEL_NAMES: Record<CullLabel, string> = {
  red: "Red",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
};

/** Photo Mechanic's tag has no XMP field of its own; a keyword is what every
 * other program can act on. */
const TAGGED_KEYWORDS: readonly string[] = ["tagged"];

export const NO_CODES: CullCodes = {
  sources: [],
  table: { codes: new Map(), folded: new Map() },
};

function parseCodeRow(row: Pick<CullCodeTableRow, "kind" | "prefix" | "text">) {
  return row.kind === "roster"
    ? rosterCodes(row.text, row.prefix)
    : parseCodeReplacements(row.text);
}

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
  /** Where the card's second copy stands, while one is being made. */
  backup: CullBackupState | null;
  /** The "Keep ~N" line, or null for the engine's own verdicts. */
  keepTarget: number | null;
  /** Frames the keep line runs across: measured and readable. */
  ranked: number;
  codes: CullCodes;
};

type Listener = (snapshot: CullSnapshot) => void;

// Re-ranking ten thousand frames takes tens of milliseconds, so doing it about
// once a second while a card reads keeps suggestions current at no visible cost.
const RERANK_INTERVAL_MS = 1000;
const UNDO_DEPTH = 50;
const TARGET_SAVE_MS = 250;
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
  // The engine's rows after focus demotion, the shoot ranked by them once, and
  // the keep line across that ranking. Moving the line reads these; only a
  // rerank rebuilds them.
  private rows = new Map<string, CullRow>();
  private order: string[] = [];
  private keepTarget: number | null = null;
  private codes: CullCodes = NO_CODES;
  private codesLoaded: Promise<void> | null = null;
  private targetSave: ReturnType<typeof setTimeout> | null = null;
  private backup: CullBackupState | null = null;
  private backupJob: ReturnType<typeof startBackupIngest> | null = null;
  private sessionName = "";

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
      backup: this.backup,
      keepTarget: this.keepTarget,
      ranked: this.order.length,
      codes: this.codes,
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

  /** Same frames in the same order, some of them changed: the id index stands.
   * This is the keypress path, so it must not rebuild anything per frame. */
  private swap(next: CullFrame[]) {
    this.frames = next;
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
    const [frames, summary] = await Promise.all([
      this.store.frames(sessionId),
      this.store
        .list()
        .then((all) => all.find((session) => session.id === sessionId))
        .catch(() => undefined),
    ]);
    this.sessionId = sessionId;
    this.sessionName = summary?.name ?? "";
    this.undoStack = [];
    this.progress = null;
    this.notice = null;
    this.keepTarget = summary?.keepTarget ?? null;
    this.resetRanking();
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
    /** Second (and third) copies of the card, made while it is read. */
    backup?: { primary: HandoffTarget; secondary?: HandoffTarget | undefined } | undefined,
  ): Promise<void> {
    this.cancelImport();
    this.stopPreviews();
    const photos = files.filter((file) => file.size > 0);
    const session = await this.store.create(name);
    this.sessionName = session.name;
    this.sessionId = session.id;
    this.undoStack = [];
    this.notice = null;
    this.keepTarget = null;
    this.resetRanking();
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
    // The card is copied while it is read, one file at a time per destination
    // (backup-ingest's default), so the ingest pool keeps the cores and the
    // photographer is reviewing long before the copy finishes.
    const copy = backup
      ? startBackupIngest({
          primary: backup.primary,
          ...(backup.secondary ? { secondary: backup.secondary } : {}),
          shootName: session.name,
          onProgress: (progress) => {
            this.backup = {
              files: progress.files,
              totalFiles: progress.totalFiles,
              bytes: progress.bytes,
              totalBytes: progress.totalBytes,
              done: false,
              failed: this.backup?.failed ?? 0,
              cancelled: false,
            };
            this.changed();
          },
        })
      : null;
    if (copy) {
      this.backup = {
        files: 0,
        totalFiles: photos.length,
        bytes: 0,
        totalBytes: photos.reduce((sum, file) => sum + file.size, 0),
        done: false,
        failed: 0,
        cancelled: false,
      };
      copy.add(photos);
      copy.close();
      this.backupJob = copy;
      void copy.done.then(
        (report) => this.finishBackup(report),
        () => this.finishBackup(null),
      );
    }
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

  /** Stops the card's second copy. The photos already copied stay where they are. */
  cancelBackup() {
    this.backupJob?.cancel();
  }

  private finishBackup(report: BackupReport | null) {
    this.backupJob = null;
    const failed = report
      ? report.primary.failed.length + (report.secondary?.failed.length ?? 0)
      : 1;
    this.backup = {
      files: this.backup?.files ?? 0,
      totalFiles: this.backup?.totalFiles ?? 0,
      bytes: this.backup?.bytes ?? 0,
      totalBytes: this.backup?.totalBytes ?? 0,
      done: true,
      failed,
      cancelled: report?.cancelled ?? false,
    };
    if (failed)
      this.notice = report
        ? `${failed.toLocaleString("en-US")} of the card's photos could not be copied to the backup.`
        : "The card backup stopped before it finished.";
    this.emit();
  }

  /**
   * Copies the chosen frames — keepers by default — to a folder or zip, with
   * their RAW/JPEG partners, renamed by template, and stars, color label, tag
   * and caption written as XMP so Lightroom and Photo Mechanic open the shoot
   * already culled. Resolves with what happened to every file; a per-file
   * problem is reported, never thrown.
   */
  async exportFrames(request: CullExportRequest): Promise<HandoffReport> {
    const frames = this.frames;
    // Every original of the card, so a JPEG travels with its RAW even when only
    // one of the pair is a frame in the review.
    const files = new Map<string, File>();
    const resolver = this.originalsState === "connected" ? this.resolver : null;
    let checked = 0;
    let next = 0;
    const lanes = Array.from({ length: Math.min(RESOLVE_LANES, frames.length || 1) }, async () => {
      for (;;) {
        const frame = frames[next++];
        if (!frame) return;
        if (request.signal?.aborted) return;
        if (!frame.error) {
          const file =
            this.originals.get(frame.id) ??
            (resolver ? await resolver.resolve(frame).catch(() => null) : null);
          if (file) files.set(frame.id, file);
        }
        request.onPrepare?.(++checked, frames.length);
      }
    });
    await Promise.all(lanes);

    const wanted = request.ids ? new Set(request.ids) : null;
    return exportKeepers({
      target: request.target,
      frames,
      files,
      library: [...files.values()],
      ...(wanted ? { select: (frame) => wanted.has(frame.id) } : {}),
      ...(request.renameTemplate ? { renameTemplate: request.renameTemplate } : {}),
      ...(request.folderTemplate ? { folderTemplate: request.folderTemplate } : {}),
      ...(this.sessionName ? { shootName: this.sessionName } : {}),
      ...(request.signal ? { signal: request.signal } : {}),
      ...(request.onProgress ? { onProgress: request.onProgress } : {}),
      sidecars:
        request.sidecars === false
          ? { enabled: false }
          : {
              // The photographer's own marks, straight from the frame.
              caption: (frame) => this.frame(frame.id)?.caption,
              label: (frame) => {
                const label = this.frame(frame.id)?.label;
                return label ? LABEL_NAMES[label] : null;
              },
              keywords: (frame) => (this.frame(frame.id)?.tagged ? TAGGED_KEYWORDS : undefined),
            },
    });
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
      this.keepTarget = null;
      this.resetRanking();
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
    // The engine's rows, then the AF evidence it does not see (keepers.ts).
    this.rows = refineFocusRows(
      this.frames,
      new Map(rows.map((row, index) => [measured[index]!.id, row])),
    );
    // A target above the ranked count is kept as set: frames still arriving fill it.
    this.order = rankKeepers(this.frames, this.rows);
    const suggestions = new Map<string, CullRow>();
    this.order.forEach((id, position) => suggestions.set(id, this.suggestionAt(id, position)));
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

  private resetRanking() {
    this.rows = new Map();
    this.order = [];
  }

  /** A frame's suggestion at its place in the ranking, under the current keep line. */
  private suggestionAt(id: string, position: number): CullRow {
    const row = this.rows.get(id)!;
    return this.keepTarget === null ? row : targetRow(row, position < this.keepTarget);
  }

  /**
   * Moves the keep line: the top `target` frames of the ranking are suggested
   * keeps and the rest rejects; null returns to the engine's own verdicts.
   * Only frames between the old and new line change, so a slider drag over ten
   * thousand frames does work proportional to how far it moved. Decisions are
   * never changed: a decided frame's verdict is the photographer's.
   */
  setKeepTarget(target: number | null): void {
    const next =
      target === null || !Number.isFinite(target)
        ? null
        : Math.max(0, Math.min(this.order.length, Math.round(target)));
    const previous = this.keepTarget;
    if (next === previous) return;
    this.keepTarget = next;
    // From or to the engine's verdicts every frame may differ; between two lines only the band does.
    const [from, to] =
      previous === null || next === null
        ? [0, this.order.length]
        : [Math.min(previous, next), Math.min(this.order.length, Math.max(previous, next))];
    let frames: CullFrame[] | null = null;
    for (let position = from; position < to; position++) {
      const id = this.order[position]!;
      const index = this.byId.get(id);
      if (index === undefined) continue;
      const current = (frames ?? this.frames)[index]!;
      const suggestion = this.suggestionAt(id, position);
      if (current.suggestion === suggestion) continue;
      frames ??= this.frames.slice();
      frames[index] = { ...current, suggestion };
    }
    if (frames) this.swap(frames);
    else this.emit();
    // A drag moves the line sixty times a second; storage needs only where it stops.
    const sessionId = this.sessionId;
    if (this.targetSave) clearTimeout(this.targetSave);
    this.targetSave = null;
    if (!sessionId) return;
    this.targetSave = setTimeout(() => {
      this.targetSave = null;
      void Promise.resolve()
        .then(() => this.store.setKeepTarget(sessionId, next))
        // A target is a view of the suggestions; losing it loses nothing decided.
        .catch(() => {});
    }, TARGET_SAVE_MS);
  }

  /** Records the photographer's decision on these frames. Undoable. */
  decide(ids: readonly string[], verdict: CullVerdict): Promise<void> {
    return this.mark(ids, { verdict });
  }

  /**
   * Sets verdict, stars, label, tag or caption on these frames as one undo
   * step. Work is proportional to the frames named, never to the shoot.
   */
  async mark(ids: readonly string[], marks: CullMarks): Promise<void> {
    const changed: CullFrame[] = [];
    const before: CullFrame[] = [];
    let next: CullFrame[] | null = null;
    for (const id of ids) {
      const index = this.byId.get(id);
      if (index === undefined) continue;
      const current = (next ?? this.frames)[index]!;
      const updated = markFrame(current, marks);
      if (updated === current) continue;
      next ??= this.frames.slice();
      before.push(current);
      next[index] = updated;
      changed.push(updated);
    }
    if (!next) return;
    this.undoStack.push({ frames: before });
    if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
    this.swap(next);
    if (this.options.scope && marks.verdict) {
      let eye = loadEye(this.options.scope);
      for (const frame of changed) {
        if (!frame.reading) continue;
        eye = rememberDecision(eye, frame.reading, marks.verdict);
      }
      saveEye(this.options.scope, eye);
    }
    await this.persist(changed);
    this.scheduleRerank();
  }

  async undo(): Promise<void> {
    const step = this.undoStack.pop();
    if (!step) return;
    const next = this.frames.slice();
    const restored: CullFrame[] = [];
    for (const saved of step.frames) {
      const index = this.byId.get(saved.id);
      if (index === undefined) continue;
      // Only the photographer's own fields go back; a rerank or keep line since
      // then has moved the suggestion on, and undo must not bring the old one back.
      const frame: CullFrame = { ...saved, suggestion: next[index]!.suggestion };
      if (!frame.suggestion) delete frame.suggestion;
      next[index] = frame;
      restored.push(frame);
    }
    this.swap(next);
    await this.persist(restored);
  }

  /** Loads this account's caption codes once; later calls share the load. */
  loadCodes(): Promise<void> {
    this.codesLoaded ??= Promise.resolve()
      .then(() => this.store.codeTables())
      .then(
        (rows) => this.setCodes(rows),
        // Captions still work by hand without stored codes.
        () => {},
      );
    return this.codesLoaded;
  }

  private setCodes(rows: readonly CullCodeTableRow[]) {
    const sources: CullCodeSource[] = [];
    const tables: CodeTable[] = [];
    for (const row of rows) {
      const { table } = parseCodeRow(row);
      tables.push(table);
      sources.push({
        id: row.id,
        name: row.name,
        kind: row.kind,
        prefix: row.prefix,
        count: table.codes.size,
      });
    }
    this.codes = { sources, table: mergeCodeTables(...tables) };
    this.emit();
  }

  /**
   * Adds a Photo Mechanic code replacement file or a roster CSV for this
   * account. Rejected, with the file's first problem, when it yields no codes.
   */
  async addCodes(input: {
    name: string;
    kind: "codes" | "roster";
    prefix?: string | undefined;
    text: string;
  }): Promise<CullCodeSource> {
    const prefix = input.kind === "roster" ? (input.prefix ?? "").trim() : "";
    const { table, issues } = parseCodeRow({ kind: input.kind, prefix, text: input.text });
    if (!table.codes.size)
      throw new Error(
        issues[0] ? `Line ${issues[0].line}: ${issues[0].message}` : "No codes in that file.",
      );
    const existing = await this.store.codeTables();
    const row: CullCodeTableRow = {
      id: crypto.randomUUID(),
      name: input.name.slice(0, 120) || "Codes",
      kind: input.kind,
      prefix,
      text: input.text,
      // Strictly after every stored table, so it wins collisions even within one millisecond.
      createdAt: Math.max(Date.now(), (existing.at(-1)?.createdAt ?? 0) + 1),
    };
    await this.store.putCodeTable(row);
    const rows = await this.store.codeTables();
    this.setCodes(rows);
    return this.codes.sources.find((source) => source.id === row.id)!;
  }

  async removeCodes(id: string): Promise<void> {
    await this.store.deleteCodeTable(id);
    this.setCodes(await this.store.codeTables());
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
    if (this.targetSave && this.sessionId) {
      clearTimeout(this.targetSave);
      // The transaction opens synchronously, so it completes before close() takes effect.
      void this.store.setKeepTarget(this.sessionId, this.keepTarget).catch(() => {});
    }
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
