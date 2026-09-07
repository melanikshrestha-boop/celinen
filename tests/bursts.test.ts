import { describe, expect, test } from "bun:test";
import {
  burstReceipts,
  requestBurstGroups,
  validateBurstResponse,
  type BurstFrame,
} from "../src/lib/studio/bursts";

const frame = (id: string): BurstFrame => ({
  id,
  name: `${id}.jpg`,
  relativePath: `match/${id}.jpg`,
  hash: "10".repeat(32),
  score: 80,
  sharpness: 100,
  brightness: 125,
  verdict: "undecided",
  captureTimeMs: 1700000000000,
  captureTimeBasis: "utc",
  cameraKey: "body-serial-1",
  previewUrl: `blob:${id}`,
});
const receipt = () => ({
  groups: [
    {
      id: "burst:a",
      kind: "burst",
      frameIds: ["a", "b"],
      recommendedId: "a",
      reason: "Same camera clock and similar previews.",
      confidence: "camera-time-and-appearance",
      evidence: {
        spanMs: 1000,
        maxGapMs: 1000,
        maxHashDistance: 2,
        cameraKey: "body-serial-1",
        folder: "match",
      },
    },
  ],
  stats: { inputFrames: 2, eligibleFrames: 2, groupedFrames: 2, comparisons: 2 },
});

describe("native burst transport", () => {
  test("serializes analysis metadata without uploading pixels or mutating picks", () => {
    const frames = [
      frame("a"),
      { ...frame("b"), verdict: "keep" as const },
      { ...frame("bad"), error: "Unreadable" },
    ];
    const before = JSON.stringify(frames);
    const payload = burstReceipts(frames);
    expect(payload.map((item) => item.id)).toEqual(["a", "b"]);
    expect(payload[1]?.verdict).toBe("keep");
    expect(payload[0]).not.toHaveProperty("previewUrl");
    expect(payload[0]).not.toHaveProperty("file");
    expect(JSON.stringify(frames)).toBe(before);
  });

  test("never infers capture time from name, file modification or upload time", () => {
    const input = {
      ...frame("20250901-120000"),
      captureTimeMs: undefined,
      cameraKey: undefined,
      file: { lastModified: 1756713600000 },
    };
    const payload = burstReceipts([input]);
    expect(payload[0]?.captureTimeMs).toBeUndefined();
    expect(payload[0]?.cameraKey).toBeUndefined();
    expect(payload[0]).not.toHaveProperty("file");
  });

  test("validates native evidence, group membership, and counts", () => {
    const response = receipt();
    expect(validateBurstResponse(response, [frame("a"), frame("b")])).toEqual(response);
    expect(
      validateBurstResponse(
        {
          groups: [],
          stats: { inputFrames: 0, eligibleFrames: 0, groupedFrames: 0, comparisons: 0 },
        },
        [],
      ),
    ).toHaveProperty("groups", []);
  });

  test("refuses unknown or duplicated image IDs", () => {
    for (const ids of [
      ["a", "unknown"],
      ["a", "a"],
    ]) {
      const value = receipt();
      value.groups[0]!.frameIds = ids;
      expect(() => validateBurstResponse(value, [frame("a"), frame("b")])).toThrow(
        "No selections were changed",
      );
    }
    expect(() => validateBurstResponse(receipt(), [frame("a"), frame("a")])).toThrow();
  });

  test("refuses a native recommendation that overrides a rejection", () => {
    expect(() =>
      validateBurstResponse(receipt(), [{ ...frame("a"), verdict: "reject" }, frame("b")]),
    ).toThrow();
    const allRejected = receipt();
    allRejected.groups[0]!.recommendedId = "";
    expect(
      validateBurstResponse(allRejected, [
        { ...frame("a"), verdict: "reject" },
        { ...frame("b"), verdict: "reject" },
      ]).groups[0]?.recommendedId,
    ).toBe("");
  });

  test("rejects unbounded or fabricated burst evidence", () => {
    for (const patch of [
      { spanMs: 6001 },
      { maxGapMs: 1501 },
      { maxHashDistance: 9 },
      { spanMs: NaN },
    ]) {
      const value = receipt();
      Object.assign(value.groups[0]!.evidence, patch);
      expect(() => validateBurstResponse(value, [frame("a"), frame("b")])).toThrow();
    }
    const mislabeled = receipt();
    mislabeled.groups[0]!.kind = "similar";
    expect(() => validateBurstResponse(mislabeled, [frame("a"), frame("b")])).toThrow();
  });

  test("rejects incomplete group counts and nonmembers recommended as keepers", () => {
    const badCount = receipt();
    badCount.stats.groupedFrames = 1;
    expect(() => validateBurstResponse(badCount, [frame("a"), frame("b")])).toThrow();
    const badRecommendation = receipt();
    badRecommendation.groups[0]!.recommendedId = "other";
    expect(() => validateBurstResponse(badRecommendation, [frame("a"), frame("b")])).toThrow();
  });

  test("posts to native endpoint and passes cancellation through", async () => {
    const controller = new AbortController();
    let seen: RequestInit | undefined;
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      expect(url).toBe("/__native/bursts");
      seen = init;
      return new Response(JSON.stringify(receipt()), { status: 200 });
    }) as typeof fetch;
    const result = await requestBurstGroups([frame("a"), frame("b")], {
      signal: controller.signal,
      fetch: fetcher,
    });
    expect(result.groups).toHaveLength(1);
    expect(seen?.method).toBe("POST");
    expect(seen?.signal).toBe(controller.signal);
    expect(JSON.parse(String(seen?.body)).frames).toHaveLength(2);
  });

  test("native failures do not fabricate client-side substitute groups", async () => {
    for (const status of [413, 500, 503]) {
      const fetcher = (async () => new Response("Unavailable", { status })) as typeof fetch;
      await expect(
        requestBurstGroups([frame("a"), frame("b")], { fetch: fetcher }),
      ).rejects.toThrow("No selections were changed");
    }
  });

  test("never compares native and browser hashes against each other", async () => {
    const native = ["a", "b"].map((id) => ({
      ...frame(id),
      analysisBackend: "native-cpp" as const,
    }));
    const browser = [frame("c"), { ...frame("d"), analysisBackend: "worker" as const }];
    const batches: string[][] = [];
    const fetcher = (async (_url: unknown, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body)).frames as BurstFrame[];
      batches.push(sent.map((item) => item.id));
      const result = receipt();
      result.groups[0]!.frameIds = sent.map((item) => item.id);
      result.groups[0]!.id = `burst:${sent[0]!.id}`;
      result.groups[0]!.recommendedId = sent[0]!.id;
      return new Response(JSON.stringify(result));
    }) as typeof fetch;
    const result = await requestBurstGroups([browser[0]!, native[0]!, browser[1]!, native[1]!], {
      fetch: fetcher,
    });
    expect(batches).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(result.groups.map((group) => group.id)).toEqual([
      "native-cpp:utc:burst:a",
      "browser:utc:burst:c",
    ]);
    expect(result.stats.inputFrames).toBe(4);
    expect(result.stats.groupedFrames).toBe(4);
  });

  test("no native request is made for an empty readable set", async () => {
    const fetcher = (() => {
      throw new Error("Should not call native");
    }) as typeof fetch;
    expect(
      (await requestBurstGroups([{ ...frame("bad"), error: "Unreadable" }], { fetch: fetcher }))
        .groups,
    ).toEqual([]);
  });

  test("duplicate IDs across hash domains cannot produce ambiguous keep actions", async () => {
    const fetcher = (() => {
      throw new Error("Should not call native");
    }) as typeof fetch;
    await expect(
      requestBurstGroups([frame("a"), { ...frame("a"), analysisBackend: "native-cpp" }], {
        fetch: fetcher,
      }),
    ).rejects.toThrow("uniquely identified");
  });

  test("UTC, camera-clock, and unknown timestamps never share a native batch", async () => {
    const frames: BurstFrame[] = [
      { ...frame("utc-a"), analysisBackend: "native-cpp", captureTimeBasis: "utc" },
      { ...frame("clock-a"), analysisBackend: "native-cpp", captureTimeBasis: "camera_clock" },
      { ...frame("unknown-a"), analysisBackend: "native-cpp", captureTimeBasis: undefined },
      { ...frame("utc-b"), analysisBackend: "native-cpp", captureTimeBasis: "utc" },
      { ...frame("clock-b"), analysisBackend: "native-cpp", captureTimeBasis: "camera_clock" },
      { ...frame("unknown-b"), analysisBackend: "native-cpp", captureTimeBasis: undefined },
    ];
    const batches: BurstFrame[][] = [];
    const fetcher = (async (_url: unknown, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body)).frames as BurstFrame[];
      batches.push(sent);
      const result = receipt();
      const unknown = sent[0]!.captureTimeBasis === undefined;
      result.groups[0]!.frameIds = sent.map((item) => item.id);
      result.groups[0]!.recommendedId = sent[0]!.id;
      result.groups[0]!.kind = unknown ? "similar" : "burst";
      result.groups[0]!.confidence = unknown ? "appearance-only" : "camera-time-and-appearance";
      if (unknown)
        Object.assign(result.groups[0]!.evidence, { spanMs: 0, maxGapMs: 0, cameraKey: "" });
      return new Response(JSON.stringify(result));
    }) as typeof fetch;
    const before = JSON.stringify(frames);
    const result = await requestBurstGroups(frames, { fetch: fetcher });
    expect(batches.map((batch) => batch.map((item) => item.id))).toEqual([
      ["utc-a", "utc-b"],
      ["clock-a", "clock-b"],
      ["unknown-a", "unknown-b"],
    ]);
    expect(batches[2]!.every((item) => item.captureTimeMs === undefined)).toBe(true);
    expect(batches[2]!.every((item) => item.cameraKey === "body-serial-1")).toBe(true);
    expect(result.groups.map((group) => group.kind)).toEqual(["burst", "burst", "similar"]);
    expect(result.stats.groupedFrames).toBe(6);
    expect(JSON.stringify(frames)).toBe(before);
  });

  test("unknown clock basis strips timestamps instead of inventing UTC", () => {
    const unknown = { ...frame("a"), captureTimeBasis: undefined };
    expect(burstReceipts([unknown])[0]?.captureTimeMs).toBeUndefined();
    expect(burstReceipts([unknown])[0]?.cameraKey).toBe("body-serial-1");
    expect(() => validateBurstResponse(receipt(), [unknown, frame("b")])).toThrow();
    expect(() =>
      validateBurstResponse(receipt(), [
        frame("a"),
        { ...frame("b"), captureTimeBasis: "camera_clock" },
      ]),
    ).toThrow();
  });

  test("3000 receipt transport remains metadata-only and input-immutable", () => {
    const frames = Array.from({ length: 3000 }, (_, i) => ({
      ...frame(String(i)),
      verdict: i % 3 === 0 ? ("keep" as const) : ("reject" as const),
    }));
    const before = JSON.stringify(frames);
    const payload = burstReceipts(frames);
    expect(payload).toHaveLength(3000);
    expect(JSON.stringify(payload)).not.toContain("blob:");
    expect(payload.every((item, index) => item.verdict === frames[index]?.verdict)).toBe(true);
    expect(JSON.stringify(frames)).toBe(before);
  });
});
