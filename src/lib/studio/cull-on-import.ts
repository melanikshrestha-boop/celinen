/**
 * Cull that runs when photos land.
 * Blur comes from analysis; near-dupes from the Hamming index.
 * Suggestions apply to undecided frames only. Originals are never touched.
 */
import { scoreOf, type Analysis, type Flag, type Shot, type Verdict } from "@/lib/imaging";
import { indexDuplicateFrames } from "./culling-index";
import { smartCullPass, type BurstHint } from "./smart-cull";

export type ImportAnalysisReceipt = {
  width: number;
  height: number;
  analysis: Analysis;
  backend: "worker" | "main-thread" | "native-cpp";
  captureTimeMs?: number | undefined;
  cameraKey?: string | undefined;
  captureTimeBasis?: "utc" | "camera_clock" | undefined;
};

const ANALYSIS_FLAGS: ReadonlySet<Flag> = new Set([
  "soft",
  "blur",
  "underexposed",
  "overexposed",
  "face-soft",
  "eyes-closed",
]);

export function isImportAnalyzed(shot: Pick<Shot, "error" | "hash" | "score">): boolean {
  return (
    shot.error === undefined &&
    typeof shot.hash === "string" &&
    shot.hash.length > 0 &&
    Number.isFinite(shot.score) &&
    shot.score >= 0 &&
    shot.score <= 100
  );
}

const MIN_ANALYSIS_BYTES = 32;

/**
 * Score the original when it is on this machine. If the folder is offline,
 * score the stored preview. Never upload. Never invent a score from empty bytes.
 */
export function analysisBytesForShot(
  shot: Pick<Shot, "file" | "previewBlob" | "sourceAvailable" | "name">,
): File | null {
  if (shot.sourceAvailable !== false && (shot.file?.size ?? 0) >= MIN_ANALYSIS_BYTES)
    return shot.file;
  const blob = shot.previewBlob;
  if (blob && blob.size >= MIN_ANALYSIS_BYTES) {
    if (shot.file && shot.file.size === blob.size) return shot.file;
    return new File([blob], `${shot.name.replace(/\.[^.]+$/, "") || "frame"}.preview.jpg`, {
      type: blob.type || "image/jpeg",
      lastModified: 0,
    });
  }
  if ((shot.file?.size ?? 0) >= MIN_ANALYSIS_BYTES) return shot.file;
  return null;
}

/** Keep is green (≥70), reject is red (<45). Unscored frames stay neutral. */
export function cullScoreTone(
  shot: Pick<Shot, "verdict" | "error" | "hash" | "score">,
): "keep" | "reject" | "open" {
  if (shot.verdict === "keep") return "keep";
  if (shot.verdict === "reject") return "reject";
  if (!isImportAnalyzed(shot)) return "open";
  if (shot.score >= 70) return "keep";
  if (shot.score < 45) return "reject";
  return "open";
}

/** Product moss/rust are gray/blue. Cull rates are keep-green and reject-red. */
export function cullToneClass(tone: "keep" | "reject" | "open", kind: "fill" | "border"): string {
  if (tone === "keep")
    return kind === "fill"
      ? "bg-[#1f9d5c] text-white"
      : "border border-[#1f9d5c] text-[#1f9d5c] hover:bg-[#1f9d5c] hover:text-white";
  if (tone === "reject")
    return kind === "fill"
      ? "bg-[#e24b4a] text-white"
      : "border border-[#e24b4a] text-[#e24b4a] hover:bg-[#e24b4a] hover:text-white";
  return kind === "fill" ? "bg-ink/70 text-paper2" : "border border-input";
}

/** Map a local analysis receipt onto a shot. Never changes keep/reject or the File handle. */
export function attachImportAnalysis(shot: Shot, result: ImportAnalysisReceipt): Shot {
  const { score, flags } = scoreOf(result.analysis);
  const kept = shot.flags.filter((flag) => !ANALYSIS_FLAGS.has(flag));
  return {
    ...shot,
    width: result.width || shot.width,
    height: result.height || shot.height,
    sharpness: result.analysis.sharpness,
    brightness: result.analysis.brightness,
    clippedHighlights: result.analysis.clippedHighlights,
    clippedShadows: result.analysis.clippedShadows,
    hash: result.analysis.hash,
    tone: result.analysis.tone,
    ...(result.analysis.faces ? { faces: result.analysis.faces } : {}),
    score,
    flags: [...kept, ...flags],
    analysisBackend: result.backend,
    ...(result.captureTimeMs !== undefined ? { captureTimeMs: result.captureTimeMs } : {}),
    ...(result.cameraKey !== undefined ? { cameraKey: result.cameraKey } : {}),
    ...(result.captureTimeBasis !== undefined ? { captureTimeBasis: result.captureTimeBasis } : {}),
  };
}

/**
 * Catalog reloads from Develop drop analysis. Keep the in-session measurements
 * so a refresh cannot un-cull a shoot that already ran.
 */
export function mergePreservedImportAnalysis(projected: Shot, prior?: Shot): Shot {
  if (!prior || !isImportAnalyzed(prior) || isImportAnalyzed(projected)) return projected;
  return {
    ...projected,
    sharpness: prior.sharpness,
    brightness: prior.brightness,
    clippedHighlights: prior.clippedHighlights,
    clippedShadows: prior.clippedShadows,
    hash: prior.hash,
    score: prior.score,
    flags: prior.flags,
    ...(prior.tone ? { tone: prior.tone } : {}),
    ...(prior.faces ? { faces: prior.faces } : {}),
    ...(prior.analysisBackend ? { analysisBackend: prior.analysisBackend } : {}),
    ...(prior.captureTimeMs !== undefined ? { captureTimeMs: prior.captureTimeMs } : {}),
    ...(prior.cameraKey !== undefined ? { cameraKey: prior.cameraKey } : {}),
    ...(prior.captureTimeBasis !== undefined ? { captureTimeBasis: prior.captureTimeBasis } : {}),
    file: prior.file?.size ? prior.file : projected.file,
  };
}

function sameFlags(a: readonly Flag[], b: readonly Flag[]): boolean {
  return a.length === b.length && a.every((flag, index) => flag === b[index]);
}

/** Near-dupes become a flag. Existing keep/reject and File handles stay. */
export function flagImportDuplicates(frames: readonly Shot[]): Shot[] {
  const { duplicateIds } = indexDuplicateFrames(
    frames.filter((shot) => isImportAnalyzed(shot) && /^[01]{64}$/.test(shot.hash)),
  );
  return frames.map((shot) => {
    const next = shot.flags.filter((flag) => flag !== "duplicate");
    if (duplicateIds.has(shot.id)) next.push("duplicate");
    return sameFlags(shot.flags, next) ? shot : { ...shot, flags: next };
  });
}

export type ImportCullResult = {
  shots: Shot[];
  changed: number;
  flagged: number;
  skipped: number;
};

/**
 * Flag blur/dupes, then suggest keep/reject for undecided analyzed frames.
 * Unanalyzed and unreadable frames stay undecided. Nothing is deleted.
 */
export function applyImportCull(
  frames: readonly Shot[],
  options: { bursts?: readonly BurstHint[]; onlyIds?: ReadonlySet<string> } = {},
): ImportCullResult {
  const flagged = flagImportDuplicates(frames);
  const flaggedCount = flagged.filter((shot) => shot.flags.includes("duplicate")).length;
  const eligible = flagged.filter((shot) => {
    if (!isImportAnalyzed(shot) || shot.verdict !== "undecided") return false;
    return !options.onlyIds || options.onlyIds.has(shot.id);
  });
  const skipped = flagged.filter((shot) => !isImportAnalyzed(shot)).length;
  if (!eligible.length) {
    const changed = flagged.reduce(
      (count, shot, index) => count + (shot === frames[index] ? 0 : 1),
      0,
    );
    return { shots: flagged, changed, flagged: flaggedCount, skipped };
  }
  const suggestions = smartCullPass(eligible, options.bursts ?? []);
  let changed = 0;
  const shots = flagged.map((shot, index) => {
    const suggested = suggestions.get(shot.id);
    const nextVerdict: Verdict | undefined =
      suggested && shot.verdict === "undecided" ? suggested : undefined;
    const verdictChanged = nextVerdict !== undefined && nextVerdict !== shot.verdict;
    if (!verdictChanged && shot === frames[index]) return shot;
    changed += 1;
    return verdictChanged ? { ...shot, verdict: nextVerdict } : shot;
  });
  return { shots, changed, flagged: flaggedCount, skipped };
}
