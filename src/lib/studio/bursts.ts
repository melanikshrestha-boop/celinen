import type { Verdict } from "@/lib/imaging";
import { nativeStudioRequest } from "@/lib/studio/native-client";

/** Presentation/transport only. Grouping and ranking execute in C++, not here. */
export interface BurstFrame {
  id: string;
  name: string;
  relativePath?: string | undefined;
  hash: string;
  score: number;
  sharpness: number;
  brightness: number;
  verdict: Verdict;
  previewUrl?: string | null | undefined;
  error?: string | undefined;
  captureTimeMs?: number | undefined;
  captureTimeBasis?: "utc" | "camera_clock" | undefined;
  cameraKey?: string | undefined;
  analysisBackend?: "native-cpp" | "worker" | "main-thread" | undefined;
}

export interface BurstGroup {
  id: string;
  kind: "burst" | "similar";
  frameIds: string[];
  recommendedId: string;
  reason: string;
  confidence: "camera-time-and-appearance" | "appearance-only";
  evidence: {
    spanMs: number;
    maxGapMs: number;
    maxHashDistance: number;
    cameraKey: string;
    folder: string;
  };
}

export interface BurstReviewResult {
  groups: BurstGroup[];
  stats: {
    inputFrames: number;
    eligibleFrames: number;
    groupedFrames: number;
    comparisons: number;
  };
}

type Receipt = Omit<BurstFrame, "previewUrl" | "error">;

function captureBasis(frame: BurstFrame): "utc" | "camera_clock" | "unknown" {
  return frame.captureTimeBasis === "utc" || frame.captureTimeBasis === "camera_clock"
    ? frame.captureTimeBasis
    : "unknown";
}

export function burstReceipts(frames: readonly BurstFrame[]): Receipt[] {
  return frames
    .filter((frame) => !frame.error)
    .map((frame) => ({
      id: frame.id,
      name: frame.name,
      relativePath: frame.relativePath,
      hash: frame.hash,
      score: frame.score,
      sharpness: frame.sharpness,
      brightness: frame.brightness,
      verdict: frame.verdict,
      // A timestamp with unknown clock semantics is appearance-only evidence.
      captureTimeMs: captureBasis(frame) === "unknown" ? undefined : frame.captureTimeMs,
      captureTimeBasis: captureBasis(frame) === "unknown" ? undefined : frame.captureTimeBasis,
      cameraKey: frame.cameraKey,
      analysisBackend: frame.analysisBackend,
    }));
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

/** Reject corrupt/stale native responses rather than showing unrelated photo IDs. */
export function validateBurstResponse(
  value: unknown,
  receipts: readonly Receipt[],
): BurstReviewResult {
  const fail = () => {
    throw new Error("Native burst review returned an invalid receipt. No selections were changed.");
  };
  if (!object(value) || !Array.isArray(value["groups"]) || !object(value["stats"])) return fail();
  const stats = value["stats"];
  if (
    !integer(stats["inputFrames"], receipts.length) ||
    stats["inputFrames"] !== receipts.length ||
    !integer(stats["eligibleFrames"], receipts.length) ||
    !integer(stats["groupedFrames"], receipts.length) ||
    !integer(stats["comparisons"], receipts.length * 32) ||
    stats["groupedFrames"] > stats["eligibleFrames"]
  )
    return fail();
  if (value["groups"].length > receipts.length / 2) return fail();
  const frames = new Map(receipts.map((frame) => [frame.id, frame]));
  if (frames.size !== receipts.length) return fail();
  const assigned = new Set<string>();
  const groupIds = new Set<string>();
  const groups: BurstGroup[] = [];
  for (const group of value["groups"]) {
    if (
      !object(group) ||
      typeof group["id"] !== "string" ||
      groupIds.has(group["id"]) ||
      (group["kind"] !== "burst" && group["kind"] !== "similar") ||
      typeof group["recommendedId"] !== "string" ||
      typeof group["reason"] !== "string" ||
      !Array.isArray(group["frameIds"]) ||
      group["frameIds"].length < 2 ||
      group["frameIds"].length > 24 ||
      !object(group["evidence"])
    )
      return fail();
    const evidence = group["evidence"];
    if (
      !integer(evidence["spanMs"], 6000) ||
      !integer(evidence["maxGapMs"], 1500) ||
      !integer(evidence["maxHashDistance"], 8) ||
      typeof evidence["cameraKey"] !== "string" ||
      typeof evidence["folder"] !== "string" ||
      group["confidence"] !==
        (group["kind"] === "burst" ? "camera-time-and-appearance" : "appearance-only")
    )
      return fail();
    for (const id of group["frameIds"]) {
      if (typeof id !== "string" || !frames.has(id) || assigned.has(id)) return fail();
      assigned.add(id);
    }
    if (group["kind"] === "burst") {
      const members = (group["frameIds"] as string[]).map((id) => frames.get(id)!);
      const basis = captureBasis(members[0]!);
      if (
        basis === "unknown" ||
        !evidence["cameraKey"] ||
        members.some(
          (frame) =>
            captureBasis(frame) !== basis ||
            !Number.isFinite(frame.captureTimeMs) ||
            (frame.captureTimeMs ?? 0) <= 0 ||
            frame.cameraKey !== evidence["cameraKey"],
        )
      )
        return fail();
    }
    const recommended = group["recommendedId"];
    if (
      recommended &&
      (!group["frameIds"].includes(recommended) || frames.get(recommended)?.verdict === "reject")
    )
      return fail();
    groupIds.add(group["id"]);
    groups.push(group as unknown as BurstGroup);
  }
  if (assigned.size !== stats["groupedFrames"]) return fail();
  return { groups, stats: stats as unknown as BurstReviewResult["stats"] };
}

export async function requestBurstGroups(
  frames: readonly BurstFrame[],
  options: { signal?: AbortSignal | undefined; fetch?: typeof fetch | undefined } = {},
): Promise<BurstReviewResult> {
  const receipts = burstReceipts(frames);
  if (
    receipts.length > 100000 ||
    new Set(receipts.map((frame) => frame.id)).size !== receipts.length
  ) {
    throw new Error(
      "Burst review needs at most 100,000 uniquely identified frames. No selections were changed.",
    );
  }
  const output: BurstReviewResult = {
    groups: [],
    stats: { inputFrames: 0, eligibleFrames: 0, groupedFrames: 0, comparisons: 0 },
  };
  // Native and legacy browser hashes use different resampling kernels. Never
  // compare across those domains, even if IDs, camera and timestamps match.
  // Likewise, normalized UTC and an unzoned camera clock are not comparable.
  for (const backend of ["native-cpp", "browser"] as const) {
    for (const basis of ["utc", "camera_clock", "unknown"] as const) {
      const batch = receipts.filter(
        (frame) =>
          (frame.analysisBackend === "native-cpp" ? "native-cpp" : "browser") === backend &&
          captureBasis(frame) === basis,
      );
      if (!batch.length) continue;
      const response = await (options.fetch ?? nativeStudioRequest)("/__native/bursts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frames: batch }),
        signal: options.signal ?? null,
      });
      if (!response.ok) {
        throw new Error(
          response.status === 503
            ? "The C++ engine is unavailable. Start the local native service, then retry. No selections were changed."
            : `Burst review could not finish (${response.status}). No selections were changed.`,
        );
      }
      const result = validateBurstResponse(await response.json(), batch);
      output.groups.push(
        ...result.groups.map((group) => ({ ...group, id: `${backend}:${basis}:${group.id}` })),
      );
      output.stats.inputFrames += result.stats.inputFrames;
      output.stats.eligibleFrames += result.stats.eligibleFrames;
      output.stats.groupedFrames += result.stats.groupedFrames;
      output.stats.comparisons += result.stats.comparisons;
    }
  }
  return output;
}
