import type { BridgeFrame } from "./lightroom-plugin";
import type { Shot } from "./imaging";
import { exportedReviewMetadata, importedReviewVerdict } from "./studio/review-metadata";

export const LIGHTROOM_MATCHING = "relative-path-v1";
export const LIGHTROOM_BATCH_LIMIT = 5000;

/** Exact path segments, including extension. No basename, case or Unicode guessing. */
function pathParts(value: unknown, absolute: boolean): string[] | null {
  if (typeof value !== "string" || !value || value.length > 4096) return null;
  if ([...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null;
  const path = value.replace(/\\/g, "/");
  const isAbsolute = path.startsWith("/") || /^[a-z]:\//i.test(path);
  if (isAbsolute !== absolute) return null;
  const parts = path.replace(/^\/+/, "").split("/");
  if (parts.length > 64 || parts.some((part) => !part || part === "." || part === ".."))
    return null;
  return parts;
}

export function relativeLightroomPath(file: unknown, path: unknown): string {
  const parts = pathParts(path, false);
  if (!parts || parts.length < 2 || parts.at(-1) !== file)
    throw new Error(
      "Import the matching source folder before Lightroom sync. Loose files and mismatched paths cannot be matched safely.",
    );
  return parts.join("/");
}

export function matchesLightroomPath(relative: string, absolute: unknown): boolean {
  const source = pathParts(absolute, true);
  const parts = pathParts(relative, false);
  return Boolean(
    source &&
    parts &&
    parts.length >= 2 &&
    source.length >= parts.length &&
    parts.every((part, index) => part === source[source.length - parts.length + index]),
  );
}

/** Validate incoming shape before applying any fields; no silent truncation. */
export function checkedLightroomFrames(value: unknown): BridgeFrame[] {
  if (!Array.isArray(value) || value.length > LIGHTROOM_BATCH_LIMIT)
    throw new Error("Lightroom sync needs a valid batch of at most 5,000 photos.");
  for (const frame of value) {
    if (
      !frame ||
      typeof frame !== "object" ||
      Array.isArray(frame) ||
      typeof frame.file !== "string" ||
      !frame.file ||
      frame.file.length > 1024 ||
      /[/\\]/.test(frame.file) ||
      [...frame.file].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    )
      throw new Error("Lightroom sent an invalid filename. No photos were changed.");
    for (const key of ["rating", "pick", "score"] as const) {
      if (
        frame[key] !== undefined &&
        (typeof frame[key] !== "number" || !Number.isFinite(frame[key]))
      )
        throw new Error("Lightroom sent invalid review metadata. No photos were changed.");
    }
    if (
      (frame.rating !== undefined &&
        (!Number.isInteger(frame.rating) || frame.rating < -1 || frame.rating > 5)) ||
      (frame.pick !== undefined && ![-1, 0, 1].includes(frame.pick))
    )
      throw new Error("Lightroom sent invalid stars or picks. No photos were changed.");
    for (const [key, limit] of [
      ["path", 4096],
      ["relativePath", 4096],
      ["uuid", 256],
      ["package", 1000],
    ] as const) {
      if (frame[key] !== undefined && (typeof frame[key] !== "string" || frame[key].length > limit))
        throw new Error("Lightroom sent invalid source metadata. No photos were changed.");
    }
    if (
      frame.label !== undefined &&
      frame.label !== null &&
      (typeof frame.label !== "string" || frame.label.length > 1000)
    )
      throw new Error("Lightroom sent an invalid label. No photos were changed.");
    if (frame.develop !== undefined) {
      if (!frame.develop || typeof frame.develop !== "object" || Array.isArray(frame.develop))
        throw new Error("Lightroom sent invalid develop settings. No photos were changed.");
      for (const key of [
        "exposure",
        "contrast",
        "highlights",
        "shadows",
        "saturation",
        "temperature",
      ])
        if (
          frame.develop[key] !== undefined &&
          (typeof frame.develop[key] !== "number" || !Number.isFinite(frame.develop[key]))
        )
          throw new Error("Lightroom sent invalid develop settings. No photos were changed.");
      if (
        (frame.develop.cropped !== undefined && typeof frame.develop.cropped !== "boolean") ||
        (frame.develop.processVersion !== undefined &&
          (typeof frame.develop.processVersion !== "string" ||
            frame.develop.processVersion.length > 128))
      )
        throw new Error("Lightroom sent invalid develop metadata. No photos were changed.");
    }
    if (
      frame.iptc !== undefined &&
      (!frame.iptc ||
        typeof frame.iptc !== "object" ||
        Array.isArray(frame.iptc) ||
        (frame.iptc.caption !== undefined &&
          (typeof frame.iptc.caption !== "string" || frame.iptc.caption.length > 10_000)))
    )
      throw new Error("Lightroom sent an invalid caption. No photos were changed.");
  }
  return value as BridgeFrame[];
}

export function mergeLightroomFrames(shots: readonly Shot[], input: unknown, now: number) {
  const frames = checkedLightroomFrames(input);
  const filenames = new Set(frames.map((frame) => frame.file));
  const wanted = new Map<Shot, string>();
  const wantedPaths = new Set<string>();
  const depths = new Set<number>();
  for (const shot of shots) {
    if (!filenames.has(shot.name)) continue;
    const path = relativeLightroomPath(shot.name, shot.relativePath);
    wanted.set(shot, path);
    wantedPaths.add(path);
    depths.add(path.split("/").length);
  }
  // Parse each incoming path once, rather than scanning every namesake for each
  // photo. Depth is bounded, and only requested suffixes are retained in memory.
  const index = new Map<string, BridgeFrame | null>();
  for (const frame of frames) {
    const parts = pathParts(frame.path, true);
    if (!parts || parts.at(-1) !== frame.file) continue;
    for (const depth of depths) {
      if (parts.length < depth) continue;
      const path = parts.slice(-depth).join("/");
      if (wantedPaths.has(path)) index.set(path, index.has(path) ? null : frame);
    }
  }
  const used = new Set<BridgeFrame>();
  const matched = new Map<Shot, BridgeFrame>();
  for (const [shot, path] of wanted) {
    const frame = index.get(path);
    if (frame === null || (frame && used.has(frame)))
      throw new Error(
        "Lightroom sync paused: duplicate paths or virtual copies make this selection ambiguous. No photos were changed.",
      );
    if (frame) {
      matched.set(shot, frame);
      used.add(frame);
    }
  }
  const clamp = (n: number) => Math.max(-100, Math.min(100, n));
  const next = shots.map((shot) => {
    const frame = matched.get(shot);
    if (!frame) return shot;
    const d = frame.develop ?? {};
    return {
      ...shot,
      edits: {
        ...shot.edits,
        ...(d.exposure !== undefined ? { exposure: clamp(d.exposure * 20) } : {}),
        ...(d.contrast !== undefined ? { contrast: clamp(d.contrast) } : {}),
        ...(d.highlights !== undefined ? { highlights: clamp(d.highlights) } : {}),
        ...(d.shadows !== undefined ? { shadows: clamp(d.shadows) } : {}),
        ...(d.saturation !== undefined ? { saturation: clamp(d.saturation) } : {}),
        ...(d.temperature !== undefined
          ? { temp: clamp(((d.temperature - 5500) / 4500) * 100) }
          : {}),
      },
      verdict: importedReviewVerdict(frame, shot.verdict),
      develop: {
        ...shot.develop,
        origin: "lightroom" as const,
        at: now,
        ...(frame.rating !== undefined ? { rating: frame.rating } : {}),
        ...(frame.label !== undefined ? { label: frame.label } : {}),
        ...(frame.iptc?.caption !== undefined ? { caption: frame.iptc.caption } : {}),
        ...(d.cropped !== undefined ? { cropped: d.cropped } : {}),
        ...(d.processVersion !== undefined ? { processVersion: d.processVersion } : {}),
      },
    };
  });
  return { shots: next, matched: matched.size, unmatched: shots.length - matched.size };
}

/** Outgoing protocol is intentionally incompatible with filename-only plug-ins. */
export function checkedLightroomVerdicts(value: unknown): BridgeFrame[] {
  const frames = checkedLightroomFrames(value);
  if (!frames.length) throw new Error("No photos to send to Lightroom.");
  const paths = new Set<string>();
  for (const frame of frames) {
    const path = relativeLightroomPath(frame.file, frame.relativePath);
    if (paths.has(path))
      throw new Error("Lightroom sync paused: duplicate source paths. No verdicts were queued.");
    paths.add(path);
    if (
      !["keep", "reject", "undecided"].includes(frame.verdict ?? "") ||
      (frame.rating !== undefined && (!Number.isInteger(frame.rating) || frame.rating < 0))
    )
      throw new Error(
        "Use valid picks and whole-star ratings before sending verdicts to Lightroom.",
      );
  }
  return frames;
}

export function createLightroomVerdicts(shots: readonly Shot[]): BridgeFrame[] {
  const frames = shots
    .filter((shot) => !shot.error)
    .map((shot) => ({
      file: shot.name,
      relativePath: relativeLightroomPath(shot.name, shot.relativePath),
      verdict: shot.verdict,
      score: shot.score,
      ...exportedReviewMetadata(shot),
      develop: {
        exposure: shot.edits.exposure / 20,
        contrast: shot.edits.contrast,
        highlights: shot.edits.highlights,
        shadows: shot.edits.shadows,
        saturation: shot.edits.saturation,
        temperature: Math.round(5500 + (shot.edits.temp / 100) * 4500),
      },
    }));
  return checkedLightroomVerdicts(frames);
}
