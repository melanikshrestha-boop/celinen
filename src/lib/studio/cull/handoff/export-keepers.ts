/** Ship the keepers: copy the chosen originals — with their RAW/JPEG partners
 * — into a folder or zip, renamed by template, with ratings and labels in XMP
 * so Lightroom, Capture One, Bridge and Photo Mechanic open the shoot already
 * culled.
 *
 * Guarantees, in order of importance:
 * 1. Never overwrites an existing file unless `collision: "overwrite"`.
 * 2. Never leaves a half-written file: writes go through a swap file and a
 *    failed or cancelled write removes the name it created.
 * 3. Every copy is verified by size after writing.
 * 4. Every planned file ends up in exactly one of copied / skipped / failed.
 *    Metadata that could not travel is reported on top of that: a JPEG copied
 *    without its embedded rating also has a failed entry, and a DNG/TIFF unit
 *    whose rating has nowhere Lightroom reads a skipped "no-sidecar-target".
 */
import { embedJpegXmp } from "./jpeg-xmp";
import { ProgressMeter, runPool } from "./progress";
import { bodySize, joinPath, type HandoffTarget, type WriteBody } from "./target";
import { parseTemplate, renderTemplate, TemplateError } from "./template";
import {
  emptyReport,
  errorMessage,
  handoffVerdict,
  isAbort,
  sourcePath,
  type HandoffFrame,
  type HandoffProgress,
  type HandoffReport,
} from "./types";
import {
  buildXmp,
  frameXmpFields,
  isEmbeddingFormat,
  isJpegName,
  mergeXmp,
  RAW_EXTENSIONS,
  sidecarName,
  splitExtension,
  type XmpFields,
  type XmpMapping,
} from "./xmp";

export type CollisionPolicy = "rename" | "skip" | "overwrite";

export type ExportSidecarOptions = {
  /** Write XMP at all. Default true. */
  enabled?: boolean | undefined;
  /** Sidecar naming; see `sidecarName`. Default "lightroom". */
  style?: "lightroom" | "append" | undefined;
  /** JPEG-only frames: "embed" (default) writes XMP into the copy, which is
   * what Lightroom reads; "sidecar" writes `name.xmp` beside it; "none" skips. */
  jpeg?: "embed" | "sidecar" | "none" | undefined;
  mapping?: Partial<XmpMapping> | undefined;
  keywords?: readonly string[] | undefined;
  headline?: string | undefined;
  caption?: string | ((frame: HandoffFrame) => string | undefined) | undefined;
  /** Defaults to the export's start time. */
  metadataDate?: string | undefined;
};

export type ExportOptions = {
  target: HandoffTarget;
  frames: readonly HandoffFrame[];
  /** The original behind each frame, by frame id. */
  files: ReadonlyMap<string, File>;
  /** Every file from the card or folder, to find RAW/JPEG partners and
   * existing sidecars by base name. Defaults to the originals in `files`. */
  library?: readonly File[] | undefined;
  /** Which frames go. Default: keepers (the photographer's verdict, else the engine's). */
  select?: "keepers" | ((frame: HandoffFrame) => boolean) | undefined;
  /** File name template without extension. Default `{filename}`. */
  renameTemplate?: string | undefined;
  /** Optional folder template, e.g. `{date}`. */
  folderTemplate?: string | undefined;
  seqStart?: number | undefined;
  shootName?: string | undefined;
  /** Default "rename": `name-1`, `name-2`, keeping RAW and JPEG partners on the same suffix. */
  collision?: CollisionPolicy | undefined;
  /** Copy RAW/JPEG partners sharing a base name. Default true. */
  includePairs?: boolean | undefined;
  sidecars?: ExportSidecarOptions | undefined;
  /** Frames copied at once. Default 4, capped by the target (a zip takes 1). */
  concurrency?: number | undefined;
  signal?: AbortSignal | undefined;
  onProgress?: ((progress: HandoffProgress) => void) | undefined;
  /** Clock override for tests. */
  now?: (() => number) | undefined;
};

type Member = { file: File; source: string; ext: string };

export type ExportUnit = {
  /** The frame whose verdict and rating the unit's metadata carries. */
  frame: HandoffFrame;
  frameIds: string[];
  members: Member[];
  /** An existing `.xmp` beside the originals, merged into rather than replaced. */
  sourceSidecar: File | null;
  sortTime: number;
};

export type ExportPlanIssue = { frameId: string; source: string; reason: string };

/** Groups selected frames into units of files that travel together, in capture order. */
export function planExportUnits(
  options: Pick<ExportOptions, "frames" | "files" | "library" | "select" | "includePairs">,
): { units: ExportUnit[]; issues: ExportPlanIssue[] } {
  const select =
    typeof options.select === "function"
      ? options.select
      : (frame: HandoffFrame) => handoffVerdict(frame) === "keep";
  const library = options.library ?? [...options.files.values()];
  const includePairs = options.includePairs ?? true;

  // Card files by folder + base name, case-insensitively: `_DSC5098.ARW`,
  // `_DSC5098.JPG` and `_DSC5098.xmp` are one photo.
  const byKey = new Map<string, File[]>();
  for (const file of library) {
    const key = unitKey(sourcePath(file));
    const list = byKey.get(key);
    if (list) list.push(file);
    else byKey.set(key, [file]);
  }

  const units = new Map<string, ExportUnit>();
  const issues: ExportPlanIssue[] = [];
  for (const frame of options.frames) {
    if (!select(frame)) continue;
    const file = options.files.get(frame.id);
    if (!file) {
      issues.push({
        frameId: frame.id,
        source: frame.relativePath ?? frame.name,
        reason: "The original is not open in this tab. Import the folder again to export it.",
      });
      continue;
    }
    const key = unitKey(sourcePath(file));
    let unit = units.get(key);
    if (!unit) {
      unit = {
        frame,
        frameIds: [],
        members: [],
        sourceSidecar: null,
        sortTime: frame.captureTimeMs ?? file.lastModified,
      };
      units.set(key, unit);
    }
    unit.frameIds.push(frame.id);
    // A RAW frame speaks for the unit; its JPEG is the camera's preview of it.
    if (isRaw(file.name) && !isRaw(unit.frame.name)) unit.frame = frame;
    const candidates = includePairs ? [file, ...(byKey.get(key) ?? [])] : [file];
    for (const candidate of candidates) {
      const { ext } = splitExtension(candidate.name);
      if (ext.toLowerCase() === "xmp") {
        unit.sourceSidecar ??= candidate;
        continue;
      }
      const source = sourcePath(candidate);
      if (
        unit.members.some(
          (member) => member.source === source && member.file.size === candidate.size,
        )
      )
        continue;
      unit.members.push({ file: candidate, source, ext });
    }
    // With pairs off, a sidecar beside the original is still the one to merge into.
    if (!includePairs) {
      unit.sourceSidecar ??=
        (byKey.get(key) ?? []).find((f) => splitExtension(f.name).ext.toLowerCase() === "xmp") ??
        null;
    }
  }
  for (const unit of units.values()) {
    // RAW first, so the sidecar is named after it and progress shows the big file.
    unit.members.sort((a, b) => Number(isRaw(b.file.name)) - Number(isRaw(a.file.name)));
  }
  const ordered = [...units.values()].sort(
    (a, b) => a.sortTime - b.sortTime || a.members[0]!.source.localeCompare(b.members[0]!.source),
  );
  return { units: ordered, issues };
}

function unitKey(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dir = slash >= 0 ? path.slice(0, slash) : "";
  const { base } = splitExtension(slash >= 0 ? path.slice(slash + 1) : path);
  return `${dir}/${base}`.toLowerCase();
}

function isRaw(name: string): boolean {
  return RAW_EXTENSIONS.has(splitExtension(name).ext.toLowerCase());
}

/** One file a unit will write. */
type Planned = {
  path: string[];
  role: "original" | "sidecar";
  member?: Member | undefined;
};

/**
 * Copies the selected frames into `options.target` and reports what happened
 * to every file. Progress counts originals (files and bytes); sidecars are
 * small and appear only in the report. Resolves, never rejects, for per-file
 * problems; a cancelled run resolves with `cancelled: true`. When the target
 * is a zip, a cancelled run leaves a truncated archive — discard it.
 */
export async function exportKeepers(options: ExportOptions): Promise<HandoffReport> {
  const now = options.now ?? Date.now;
  const started = now();
  const report = emptyReport();
  const { target, signal } = options;
  const collision: CollisionPolicy =
    // A zip cannot replace an entry; "overwrite" there means a new name.
    target.kind === "zip" && options.collision === "overwrite"
      ? "rename"
      : (options.collision ?? "rename");
  const sidecarOptions = options.sidecars ?? {};
  const sidecarsOn = sidecarOptions.enabled ?? true;
  const jpegMode = sidecarOptions.jpeg ?? "embed";
  const metadataDate = sidecarOptions.metadataDate ?? new Date(started).toISOString();
  const renameTemplate = options.renameTemplate ?? "{filename}";
  const seqStart = options.seqStart ?? 1;

  const { units, issues } = planExportUnits(options);
  for (const issue of issues) report.failed.push(issue);

  // A malformed template fails the whole export before the destination is touched.
  try {
    parseTemplate(renameTemplate);
    if (options.folderTemplate) parseTemplate(options.folderTemplate);
  } catch (error) {
    if (!(error instanceof TemplateError)) throw error;
    for (const unit of units)
      for (const member of unit.members)
        report.failed.push({
          frameId: unit.frame.id,
          source: member.source,
          reason: error.message,
        });
    report.elapsedMs = now() - started;
    return report;
  }

  const meter = new ProgressMeter(
    units.reduce((sum, unit) => sum + unit.members.length, 0),
    units.reduce((sum, unit) => sum + unit.members.reduce((s, m) => s + m.file.size, 0), 0),
    options.onProgress,
  );
  meter.emit(true);
  const finishOriginal = (member: Member) => {
    meter.addBytes(member.file.size);
    meter.fileDone();
  };

  // Names claimed by this run, case-insensitively (APFS, NTFS and exFAT are).
  const reserved = new Set<string>();
  const key = (path: readonly string[]) => joinPath(path).toLowerCase();
  // Choosing a name asks the destination, so units choose one at a time;
  // otherwise two could both find `name-1` free and collide.
  let reservation: Promise<unknown> = Promise.resolve();

  const fieldsFor = (unit: ExportUnit): XmpFields => {
    const caption =
      typeof sidecarOptions.caption === "function"
        ? sidecarOptions.caption(unit.frame)
        : sidecarOptions.caption;
    return frameXmpFields(
      unit.frame,
      {
        metadataDate,
        ...(sidecarOptions.keywords ? { keywords: sidecarOptions.keywords } : {}),
        ...(sidecarOptions.headline !== undefined ? { headline: sidecarOptions.headline } : {}),
        ...(caption !== undefined ? { caption } : {}),
      },
      sidecarOptions.mapping,
    );
  };

  /** How this unit's metadata travels. */
  const metadataRoute = (unit: ExportUnit): "sidecar" | "embed" | "unsupported" | "none" => {
    if (!sidecarsOn) return "none";
    // Any member that cannot hold XMP itself (a RAW) gets the sidecar, and
    // Lightroom applies it to the JPEG partner too.
    if (unit.members.some((m) => !isEmbeddingFormat(m.file.name))) return "sidecar";
    if (unit.members.every((m) => isJpegName(m.file.name))) {
      if (jpegMode === "embed") return "embed";
      if (jpegMode === "sidecar") return "sidecar";
      return "none";
    }
    // DNG, TIFF, PNG, PSD: Lightroom reads only XMP inside those files, and
    // writing inside them is not implemented. Reported, never silent.
    return "unsupported";
  };

  const chooseNames = (
    unit: ExportUnit,
    seq: number,
    route: ReturnType<typeof metadataRoute>,
  ): Promise<{ write: Planned[]; existing: Planned[] } | "failed"> => {
    const primary = unit.members[0]!;
    const context = {
      fileName: primary.file.name,
      relativePath: primary.source,
      captureTimeMs: unit.frame.captureTimeMs,
      captureTimeBasis: unit.frame.captureTimeBasis,
      fallbackTimeMs: primary.file.lastModified,
      seq,
      cameraKey: unit.frame.cameraKey,
      shootName: options.shootName,
    };
    let folders: string[];
    let base: string;
    try {
      const rendered = renderTemplate(renameTemplate, context);
      base = rendered[rendered.length - 1]!;
      folders = [
        ...(options.folderTemplate ? renderTemplate(options.folderTemplate, context) : []),
        ...rendered.slice(0, -1),
      ];
    } catch (error) {
      for (const member of unit.members)
        report.failed.push({
          frameId: unit.frame.id,
          source: member.source,
          reason: errorMessage(error),
        });
      return Promise.resolve("failed");
    }

    const namesFor = (candidate: string): Planned[] => {
      const planned: Planned[] = unit.members.map((member) => ({
        path: [...folders, member.ext ? `${candidate}.${member.ext}` : candidate],
        role: "original",
        member,
      }));
      if (route === "sidecar") {
        const named = planned[0]!.path[planned[0]!.path.length - 1]!;
        const sidecar = sidecarName(named, { style: sidecarOptions.style, includeEmbedding: true });
        if (sidecar) planned.push({ path: [...folders, sidecar], role: "sidecar" });
      }
      return planned;
    };

    const run = reservation.then(async () => {
      for (let attempt = 0; attempt < 10_000; attempt++) {
        const planned = namesFor(attempt === 0 ? base : `${base}-${attempt}`);
        const keys = planned.map((p) => key(p.path));
        // Members differing only by extension case collapse on this destination.
        if (new Set(keys).size !== keys.length) break;
        if (keys.some((k) => reserved.has(k))) continue;
        const stats = await Promise.all(planned.map((p) => target.stat(p.path)));
        if (stats.some((stat) => stat?.kind === "directory")) continue;
        const taken = stats.map((stat) => stat !== null);
        if (collision === "rename" && taken.some(Boolean)) continue;
        for (const k of keys) reserved.add(k);
        if (collision === "overwrite") return { write: planned, existing: [] };
        return {
          write: planned.filter((_, i) => !taken[i]),
          existing: planned.filter((_, i) => taken[i]),
        };
      }
      for (const member of unit.members)
        report.failed.push({
          frameId: unit.frame.id,
          source: member.source,
          reason: "No free file name at the destination.",
        });
      return "failed" as const;
    });
    reservation = run.catch(() => {});
    return run;
  };

  const cancelled = (unit: ExportUnit, p: Planned) =>
    report.skipped.push({
      frameId: unit.frame.id,
      source: p.member?.source ?? joinPath(p.path),
      destination: joinPath(p.path),
      reason: "cancelled",
    });

  /** Writes one body, verifies its size, and records the outcome. */
  const writeVerified = async (
    unit: ExportUnit,
    p: Planned,
    body: WriteBody,
    lastModified: number,
  ): Promise<boolean> => {
    const expected = bodySize(body);
    const source = p.member?.source ?? joinPath(p.path);
    const destination = joinPath(p.path);
    let counted = 0;
    try {
      signal?.throwIfAborted();
      const written = await target.write(p.path, body, {
        signal,
        lastModified,
        onBytes: p.member
          ? (bytes) => {
              counted += bytes;
              meter.addBytes(bytes);
            }
          : undefined,
      });
      if (written !== expected) {
        // The file is this run's own and wrong; a short copy must not pass for a photo.
        await target.remove(p.path).catch(() => {});
        report.failed.push({
          frameId: unit.frame.id,
          source,
          destination,
          reason: `Size check failed: the destination has ${written} bytes, expected ${expected}.`,
        });
        return false;
      }
      report.copied.push({ frameId: unit.frame.id, source, destination, bytes: written });
      report.bytes += written;
      return true;
    } catch (error) {
      if (isAbort(error, signal)) cancelled(unit, p);
      else
        report.failed.push({
          frameId: unit.frame.id,
          source,
          destination,
          reason: errorMessage(error),
        });
      return false;
    } finally {
      if (p.member) {
        // Progress settles at the original's size whatever became of it.
        meter.rewindBytes(counted);
        finishOriginal(p.member);
      }
    }
  };

  const exportUnit = async (unit: ExportUnit, seq: number) => {
    const route = metadataRoute(unit);
    let names: Awaited<ReturnType<typeof chooseNames>>;
    try {
      names = await chooseNames(unit, seq, route);
    } catch (error) {
      // The destination could not be asked (permission revoked, drive gone).
      for (const member of unit.members)
        report.failed.push({
          frameId: unit.frame.id,
          source: member.source,
          reason: errorMessage(error),
        });
      names = "failed";
    }
    if (names === "failed") {
      unit.members.forEach(finishOriginal);
      return;
    }
    for (const p of names.existing) {
      report.skipped.push({
        frameId: unit.frame.id,
        source: p.member?.source ?? joinPath(p.path),
        destination: joinPath(p.path),
        reason: "exists",
      });
      if (p.member) finishOriginal(p.member);
    }
    if (route === "unsupported") {
      report.skipped.push({
        frameId: unit.frame.id,
        source: unit.members[0]!.source,
        reason: "no-sidecar-target",
      });
    }

    const fields = route === "sidecar" || route === "embed" ? fieldsFor(unit) : null;
    let originalsOk = true;
    for (const p of names.write) {
      if (p.role !== "original" || !p.member) continue;
      if (signal?.aborted) {
        cancelled(unit, p);
        finishOriginal(p.member);
        originalsOk = false;
        continue;
      }
      let body: WriteBody = p.member.file;
      if (route === "embed" && fields) {
        try {
          body = await embedJpegXmp(p.member.file, (existing) =>
            existing ? mergeXmp(existing, fields) : buildXmp(fields, { padding: 2048 }),
          );
        } catch (error) {
          // The photo still goes, untouched; only its rating could not be written.
          report.failed.push({
            frameId: unit.frame.id,
            source: p.member.source,
            destination: joinPath(p.path),
            reason: `Rating not embedded: ${errorMessage(error)}`,
          });
        }
      }
      if (!(await writeVerified(unit, p, body, p.member.file.lastModified))) originalsOk = false;
    }

    const sidecar = names.write.find((p) => p.role === "sidecar");
    if (!sidecar || !fields) return;
    if (signal?.aborted) {
      cancelled(unit, sidecar);
      return;
    }
    if (!originalsOk) {
      // A sidecar without its photo would be an orphan in the photographer's folder.
      report.skipped.push({
        frameId: unit.frame.id,
        source: joinPath(sidecar.path),
        destination: joinPath(sidecar.path),
        reason: "no-sidecar-target",
      });
      return;
    }
    let packet: string;
    try {
      // Merge into what is already there: the destination's sidecar when
      // overwriting, else one that came off the card with the originals.
      const existing =
        (collision === "overwrite" ? await target.readText(sidecar.path) : null) ??
        (unit.sourceSidecar ? await unit.sourceSidecar.text() : null);
      packet = existing ? mergeXmp(existing, fields) : buildXmp(fields);
    } catch (error) {
      report.failed.push({
        frameId: unit.frame.id,
        source: unit.sourceSidecar ? sourcePath(unit.sourceSidecar) : joinPath(sidecar.path),
        destination: joinPath(sidecar.path),
        reason: errorMessage(error),
      });
      return;
    }
    await writeVerified(unit, sidecar, new TextEncoder().encode(packet), now());
  };

  const indexed = units.map((unit, index) => ({ unit, seq: seqStart + index }));
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, target.maxConcurrency));
  await runPool(indexed, concurrency, ({ unit, seq }) => exportUnit(unit, seq), {
    signal,
    onSkipped: ({ unit }) => {
      for (const member of unit.members) {
        report.skipped.push({ frameId: unit.frame.id, source: member.source, reason: "cancelled" });
        finishOriginal(member);
      }
    },
  });

  report.cancelled = Boolean(signal?.aborted);
  report.elapsedMs = now() - started;
  meter.emit(true);
  return report;
}
