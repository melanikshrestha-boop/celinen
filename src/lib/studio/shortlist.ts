import { z } from "zod";
import type { Shot } from "@/lib/imaging";
import { sceneReceipts } from "./scene-navigation";
import { nativeStudioRequest } from "./native-client";

const MAX_FRAMES = 100000;
const ids = z.array(z.string().min(1).max(4096)).max(MAX_FRAMES);
const count = z.number().int().min(0).max(MAX_FRAMES);
const responseSchema = z.object({
  status: z.literal("suggestions-only"),
  method: z.literal("measured-diversity-v1"),
  selectedIds: ids,
  candidateIds: ids,
  reviewIds: ids,
  targetCount: count.min(1),
  shortfall: count,
  manualKeepsOverTarget: count,
  groupsCovered: count,
  groupCount: count,
  limitations: z.array(z.string().max(2000)).max(20),
});

/** Receipts only. C++ owns ranking; no originals or previews cross this boundary. */
export function shortlistRequest(
  shots: readonly Shot[],
  targetCount: number,
  pending: ReadonlySet<string> = new Set(),
) {
  if (!Number.isSafeInteger(targetCount) || targetCount < 1 || targetCount > MAX_FRAMES)
    throw new Error("Choose a shortlist size from 1 to 100,000 photos.");
  if (!shots.length) throw new Error("Import photos before requesting a shortlist.");
  const receipts = sceneReceipts(shots);
  return {
    targetCount,
    frames: receipts.map((receipt, i) => {
      const shot = shots[i]!;
      return {
        ...receipt,
        flags: [...shot.flags],
        analysisAvailable:
          !pending.has(shot.id) &&
          !shot.error &&
          /^(?:[01]{64}|[a-fA-F0-9]{16})$/.test(shot.hash) &&
          Number.isFinite(shot.score) &&
          shot.score >= 0 &&
          shot.score <= 100 &&
          Number.isFinite(shot.sharpness) &&
          shot.sharpness >= 0 &&
          shot.sharpness <= 1e9 &&
          Number.isFinite(shot.brightness) &&
          shot.brightness >= 0 &&
          shot.brightness <= 255,
        sourceAvailable: shot.sourceAvailable !== false && Boolean(shot.file?.size),
        manualReview: shot.develop?.label?.toLowerCase() === "red",
        ...(shot.error ? { error: shot.error } : {}),
      };
    }),
  };
}

export type ShortlistRequest = ReturnType<typeof shortlistRequest>;
type Receipt = ShortlistRequest["frames"][number];

// Validation of safety eligibility only, never an independent ranking implementation.
function eligible(frame: Receipt) {
  return (
    frame.verdict === "undecided" &&
    frame.analysisAvailable &&
    frame.sourceAvailable &&
    !frame.error &&
    !frame.manualReview &&
    !frame.flags.some((flag) => flag !== "underexposed") &&
    frame.hashDomain !== "unknown" &&
    frame.sharpness >= 130 &&
    frame.brightness <= 200 &&
    (frame.score >= 70 || (frame.flags.includes("underexposed") && frame.sharpness >= 130))
  );
}

export function validateShortlistResponse(value: unknown, request: ShortlistRequest) {
  const fail = (): never => {
    throw new Error("The shortlist returned invalid or stale evidence. No picks were changed.");
  };
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) return fail();
  const result = parsed.data;
  const frames = new Map(request.frames.map((frame) => [frame.id, frame]));
  const selected = new Set(result.selectedIds);
  const candidates = new Set(result.candidateIds);
  const review = new Set(result.reviewIds);
  const keeps = request.frames.filter((frame) => frame.verdict === "keep");
  if (
    frames.size !== request.frames.length ||
    result.targetCount !== request.targetCount ||
    selected.size !== result.selectedIds.length ||
    candidates.size !== result.candidateIds.length ||
    review.size !== result.reviewIds.length ||
    result.candidateIds.some((id) => !frames.has(id) || !eligible(frames.get(id)!)) ||
    result.reviewIds.some((id) => frames.get(id)?.verdict !== "undecided" || selected.has(id)) ||
    keeps.some((frame) => !selected.has(frame.id)) ||
    selected.size !== keeps.length + candidates.size ||
    result.selectedIds.some(
      (id) => !frames.has(id) || (frames.get(id)!.verdict !== "keep" && !candidates.has(id)),
    ) ||
    result.candidateIds.some((id) => !selected.has(id)) ||
    request.frames.some(
      (frame) => frame.verdict === "undecided" && !eligible(frame) && !review.has(frame.id),
    ) ||
    candidates.size > Math.max(0, request.targetCount - keeps.length) ||
    result.shortfall !== Math.max(0, request.targetCount - selected.size) ||
    result.manualKeepsOverTarget !== Math.max(0, keeps.length - request.targetCount) ||
    result.groupCount > frames.size ||
    result.groupsCovered > result.groupCount ||
    result.groupsCovered > selected.size
  )
    return fail();
  // A set with correct IDs but a different order is not the approved gallery order.
  const ordered = request.frames.filter((frame) => selected.has(frame.id)).map((frame) => frame.id);
  if (ordered.some((id, index) => result.selectedIds[index] !== id)) return fail();
  return Object.freeze({
    ...result,
    selectedIds: Object.freeze(result.selectedIds),
    candidateIds: Object.freeze(result.candidateIds),
    reviewIds: Object.freeze(result.reviewIds),
    limitations: Object.freeze(result.limitations),
  });
}

export type ShortlistResult = ReturnType<typeof validateShortlistResponse>;

export async function requestShortlist(
  request: ShortlistRequest,
  options: { signal?: AbortSignal; fetch?: typeof fetch; isCurrent?: () => boolean } = {},
): Promise<ShortlistResult> {
  options.signal?.throwIfAborted();
  if (options.isCurrent && !options.isCurrent())
    throw new Error("The shoot changed. Request a fresh shortlist; no picks were changed.");
  const response = await (options.fetch ?? nativeStudioRequest)("/__native/shortlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: options.signal ?? null,
  });
  if (!response.ok)
    throw new Error(`Shortlist unavailable (${response.status}). No picks were changed.`);
  const data: unknown = await response.json();
  options.signal?.throwIfAborted();
  if (options.isCurrent && !options.isCurrent())
    throw new Error("The shoot changed. Request a fresh shortlist; no picks were changed.");
  return validateShortlistResponse(data, request);
}

export function shortlistSummary(result: ShortlistResult): string {
  return [
    `${result.selectedIds.length} of ${result.targetCount} requested · ${result.candidateIds.length} new suggestions · ${result.reviewIds.length} need review.`,
    result.manualKeepsOverTarget
      ? `${result.manualKeepsOverTarget} over target because your existing keeps are protected.`
      : "",
    result.shortfall
      ? `${result.shortfall} short of target; uncertain photos were not filled in automatically.`
      : "",
    "Existing K/X decisions stay. Unchosen photos stay undecided. Nothing is saved until you accept.",
    "Uses measured quality and sequence groups, not recognition of people, expressions, or peak action.",
  ]
    .filter(Boolean)
    .join(" ");
}
