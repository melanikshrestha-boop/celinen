import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  requestSceneNavigation,
  sceneReceipts,
  sceneEvidenceState,
  validateSceneResponse,
} from "../src/lib/studio/scene-navigation";
import { burstProtocol } from "../src/server/native-studio-plugin";
import type { BurstFrame } from "../src/lib/studio/bursts";
const frame = (id: string, extra: Partial<BurstFrame> = {}): BurstFrame => ({
  id,
  name: `${id}.jpg`,
  hash: "aaaaaaaaaaaaaaaa",
  score: 80,
  sharpness: 200,
  brightness: 120,
  verdict: "undecided",
  analysisBackend: "native-cpp",
  ...extra,
});
const response = (ids: string[]) => ({
  status: "suggestions-only",
  uncertain: true,
  method: "adjacent-preview-time-v1",
  limitations: "Not subject recognition.",
  groups: ids.length
    ? [
        {
          frameIds: ids,
          possibleVisualOutlierIds: [],
          reason: "sequence-start",
          evidence: { hashDistance: 0, brightnessDelta: 0, captureGapMs: 0 },
        },
      ]
    : [],
});
describe("scene navigation", () => {
  test.skipIf(!existsSync("native/build/lenslabs-bursts"))(
    "real native v2 response validates ordered mixed evidence",
    () => {
      const frames = [
        frame("z", { captureTimeBasis: "utc", captureTimeMs: 10000 }),
        frame("a", {
          analysisBackend: "worker",
          captureTimeBasis: "camera_clock",
          captureTimeMs: 90000,
        }),
        frame("missing", { error: "pending" }),
      ];
      const run = spawnSync("native/build/lenslabs-bursts", {
        input: burstProtocol({ frames: sceneReceipts(frames), sceneNavigation: true }),
        encoding: "utf8",
      });
      expect(run.status).toBe(0);
      const result = validateSceneResponse(
        JSON.parse(run.stdout).sceneNavigation,
        frames.map((f) => f.id),
      );
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0]?.frameIds).toEqual(["z", "a", "missing"]);
    },
  );
  test("closed control skips invalid evidence; picks do not restart but scope/metrics do", () => {
    const frames = [frame("a"), frame("a")];
    expect(sceneEvidenceState(frames, "shoot", false).error).toBe("");
    expect(sceneEvidenceState(frames, "shoot", true).error).toContain("unique");
    const original = sceneEvidenceState([frame("a")], "shoot", true);
    expect(sceneEvidenceState([frame("a", { verdict: "keep" })], "shoot", true).key).toBe(
      original.key,
    );
    expect(sceneEvidenceState([frame("a", { brightness: 121 })], "shoot", true).key).not.toBe(
      original.key,
    );
    expect(sceneEvidenceState([frame("a")], "other-shoot", true).key).not.toBe(original.key);
  });
  test("preserves order, decisions and unknown/error frames without fabricated measurements", () => {
    const input = [
      frame("z", { verdict: "keep" }),
      frame("a", { error: "failed", verdict: "reject" }),
      frame("b", { hash: "" }),
    ];
    const result = sceneReceipts(input);
    expect(result.map((f) => f.id)).toEqual(["z", "a", "b"]);
    expect(result.map((f) => f.verdict)).toEqual(["keep", "reject", "undecided"]);
    expect(result.map((f) => f.hashDomain)).toEqual(["native-cpp", "unknown", "unknown"]);
    expect(result[1]?.hash).toBe("0000000000000000");
    expect(input[1]?.error).toBe("failed");
  });
  test("v2 framing keeps mixed domains/bases in original order; unknown time is zero", () => {
    const frames = sceneReceipts([
      frame("z", { captureTimeBasis: "utc", captureTimeMs: 90000 }),
      frame("a", {
        analysisBackend: "worker",
        captureTimeBasis: "camera_clock",
        captureTimeMs: 10000,
      }),
      frame("b", { captureTimeMs: 12345 }),
    ]);
    const rows = burstProtocol({ frames, sceneNavigation: true }).trim().split("\n");
    expect(rows[0]).toBe("LENSBURST2 3");
    expect(rows[1]).toEndWith("native-cpp utc");
    expect(rows[2]).toEndWith("browser camera_clock");
    expect(rows[3]?.split(" ")[5]).toBe("0");
    expect(rows.slice(1).map((r) => Buffer.from(r.split(" ")[0]!, "hex").toString())).toEqual([
      "z",
      "a",
      "b",
    ]);
    expect(() => burstProtocol({ frames, sceneNavigation: false })).toThrow();
    expect(() =>
      burstProtocol({ frames: [{ ...frames[0], hashDomain: "fake" }], sceneNavigation: true }),
    ).toThrow();
  });
  test("rejects stale, missing, duplicate or reordered IDs and foreign outliers", () => {
    expect(validateSceneResponse(response(["a", "b"]), ["a", "b"]).groups).toHaveLength(1);
    for (const ids of [["b", "a"], ["a"], ["a", "a"], ["a", "foreign"]])
      expect(() => validateSceneResponse(response(ids), ["a", "b"])).toThrow();
    const bad = response(["a"]);
    bad.groups[0]!.possibleVisualOutlierIds = ["foreign"] as never[];
    expect(() => validateSceneResponse(bad, ["a"])).toThrow();
    expect(() => validateSceneResponse({ groups: [] }, [])).toThrow("Rebuild");
  });
  test("one request with all frames, even across domains; late aborted result is discarded", async () => {
    let count = 0;
    const frames = [frame("a"), frame("b", { analysisBackend: "worker" })];
    const mock = (async (_url, init) => {
      count++;
      expect(JSON.parse(String(init?.body)).frames.map((f: { id: string }) => f.id)).toEqual([
        "a",
        "b",
      ]);
      return Response.json({ sceneNavigation: response(["a", "b"]) });
    }) as typeof fetch;
    await requestSceneNavigation(frames, { fetch: mock });
    expect(count).toBe(1);
    const controller = new AbortController();
    await expect(
      requestSceneNavigation(frames, {
        signal: controller.signal,
        fetch: (async () => {
          controller.abort();
          return Response.json({ sceneNavigation: response(["a", "b"]) });
        }) as typeof fetch,
      }),
    ).rejects.toThrow("Cancelled");
  });
});
