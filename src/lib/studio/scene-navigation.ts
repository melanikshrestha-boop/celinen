import { z } from "zod";
import type { BurstFrame } from "./bursts";
import { nativeStudioRequest } from "./native-client";

const groupSchema = z.object({
  frameIds: z.array(z.string()).min(1).max(100000),
  possibleVisualOutlierIds: z.array(z.string()).max(100000),
  reason: z.enum([
    "sequence-start",
    "folder-change",
    "camera-change",
    "capture-gap",
    "appearance-change",
  ]),
  evidence: z.object({
    hashDistance: z.number().int().min(0).max(64),
    brightnessDelta: z.number().finite().min(0).max(255),
    captureGapMs: z.number().int().min(0).max(8.64e15),
  }),
});
const responseSchema = z.object({
  status: z.literal("suggestions-only"),
  uncertain: z.literal(true),
  method: z.literal("adjacent-preview-time-v1"),
  limitations: z.string().max(2000),
  groups: z.array(groupSchema).max(100000),
});
export type SceneNavigationResult = z.infer<typeof responseSchema>;
export const sceneReasonLabel = {
  "sequence-start": "Start of sequence",
  "folder-change": "Folder change",
  "camera-change": "Camera change",
  "capture-gap": "Capture gap",
  "appearance-change": "Possible scene change",
} as const;

/** Closed controls do no receipt work; invalid input cannot crash Studio render. */
export function sceneEvidenceState(frames: readonly BurstFrame[], scopeKey: string, open: boolean) {
  if (!open) return { key: JSON.stringify([scopeKey, false]), error: "" };
  try {
    return {
      key: JSON.stringify([
        scopeKey,
        sceneReceipts(frames).map(({ verdict: _verdict, ...frame }) => frame),
      ]),
      error: "",
    };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : "Scene navigation unavailable.";
    return { key: JSON.stringify([scopeKey, "invalid", error]), error };
  }
}

/** Include missing/error frames without inventing measurements. Never reorder. */
export function sceneReceipts(frames: readonly BurstFrame[]) {
  if (frames.length > 100000 || new Set(frames.map((f) => f.id)).size !== frames.length)
    throw new Error("Scene navigation needs at most 100,000 unique frame IDs.");
  return frames.map((f) => {
    const measured =
      !f.error &&
      /^(?:[01]{64}|[a-fA-F0-9]{16})$/.test(f.hash) &&
      Number.isFinite(f.score) &&
      f.score >= 0 &&
      f.score <= 100 &&
      Number.isFinite(f.sharpness) &&
      f.sharpness >= 0 &&
      f.sharpness <= 1e9 &&
      Number.isFinite(f.brightness) &&
      f.brightness >= 0 &&
      f.brightness <= 255;
    const basis =
      !f.error && (f.captureTimeBasis === "utc" || f.captureTimeBasis === "camera_clock")
        ? f.captureTimeBasis
        : "unknown";
    return {
      id: f.id,
      name: f.name,
      relativePath: f.relativePath,
      verdict: f.verdict,
      hash: measured ? f.hash : "0000000000000000",
      score: measured ? f.score : 0,
      sharpness: measured ? f.sharpness : 0,
      brightness: measured ? f.brightness : 0,
      hashDomain: !measured
        ? "unknown"
        : f.analysisBackend === "native-cpp"
          ? "native-cpp"
          : f.analysisBackend === "worker" || f.analysisBackend === "main-thread"
            ? "browser"
            : "unknown",
      captureTimeBasis: basis,
      captureTimeMs:
        basis !== "unknown" &&
        Number.isSafeInteger(f.captureTimeMs) &&
        (f.captureTimeMs ?? 0) > 0 &&
        (f.captureTimeMs ?? 0) <= 8.64e15
          ? f.captureTimeMs
          : 0,
      cameraKey: !f.error ? f.cameraKey : undefined,
    };
  });
}

export function validateSceneResponse(
  value: unknown,
  ids: readonly string[],
): SceneNavigationResult {
  const result = responseSchema.safeParse(value);
  const fail = () => {
    throw new Error(
      "Scene navigation is unavailable or returned stale evidence. Rebuild the local C++ engine and retry. No picks were changed.",
    );
  };
  if (!result.success || new Set(ids).size !== ids.length) return fail();
  let cursor = 0;
  for (const group of result.data.groups) {
    for (const id of group.frameIds) if (id !== ids[cursor++]) return fail();
    const members = new Set(group.frameIds);
    if (
      new Set(group.possibleVisualOutlierIds).size !== group.possibleVisualOutlierIds.length ||
      group.possibleVisualOutlierIds.some((id) => !members.has(id))
    )
      return fail();
  }
  if (cursor !== ids.length) return fail();
  return result.data;
}

export async function requestSceneNavigation(
  frames: readonly BurstFrame[],
  options: { signal?: AbortSignal | undefined; fetch?: typeof fetch | undefined } = {},
): Promise<SceneNavigationResult> {
  const receipts = sceneReceipts(frames);
  if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  const response = await (options.fetch ?? nativeStudioRequest)("/__native/bursts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ frames: receipts, sceneNavigation: true }),
    signal: options.signal ?? null,
  });
  if (!response.ok)
    throw new Error(`Scene navigation unavailable (${response.status}). No picks were changed.`);
  const data: unknown = await response.json();
  if (options.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  return validateSceneResponse(
    data && typeof data === "object" && "sceneNavigation" in data ? data.sceneNavigation : null,
    receipts.map((f) => f.id),
  );
}
