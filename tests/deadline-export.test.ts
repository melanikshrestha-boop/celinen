import { describe, expect, test } from "bun:test";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";
import {
  assertDeadlinePlanCurrent,
  createDeadlineDownload,
  createDeadlinePlan,
  deadlinePrefix,
  prepareDeadlineExport,
  type DeadlineRecipe,
  type DeadlineRenderer,
} from "../src/lib/studio/deadline-export";

const recipe: DeadlineRecipe = {
  count: 2,
  longestEdge: 2048,
  quality: 0.92,
  prefix: "press",
  caption: "Game night",
  copyright: "© Photographer",
};
const shot = (id: string, verdict: Shot["verdict"] = "keep"): Shot => ({
  id,
  name: `${id}.jpg`,
  relativePath: `game/${id}.jpg`,
  file: new File([id], `${id}.jpg`, { type: "image/jpeg", lastModified: 1234 }),
  isRaw: false,
  previewUrl: null,
  width: 4000,
  height: 3000,
  sizeMb: 1,
  sharpness: 200,
  brightness: 100,
  clippedHighlights: 0,
  clippedShadows: 0,
  hash: "1".repeat(64),
  score: 90,
  flags: [],
  verdict,
  edits: { ...DEFAULT_EDITS },
});
const jpeg = (id: string) =>
  new Blob([new Uint8Array([0xff, 0xd8, 0xff]), id, new Uint8Array([0xff, 0xd9])], {
    type: "image/jpeg",
  });
const render: DeadlineRenderer = async (frame, config) => ({
  blob: jpeg(frame.id),
  width: config.longestEdge,
  height: 1200,
});

describe("deadline set planning", () => {
  test("only existing keepers, in Studio order, with no changed picks", () => {
    const shots = [
      shot("reject", "reject"),
      shot("b"),
      shot("undecided", "undecided"),
      shot("a"),
      shot("c"),
    ];
    const before = shots.map((frame) => frame.verdict);
    const plan = createDeadlinePlan(shots, recipe);
    expect(plan.frames.map((frame) => frame.id)).toEqual(["b", "a"]);
    expect(plan.frames.map((frame) => frame.filename)).toEqual(["press-001.jpg", "press-002.jpg"]);
    expect(shots.map((frame) => frame.verdict)).toEqual(before);
    expect(plan.frames[0]!.file).toBe(shots[1]!.file);
  });

  test("snapshots freeze recipe, order, version, crop and edits without freezing user state", () => {
    const first = {
      ...shot("a"),
      faces: { count: 1, faceSharpness: 100, eyesOpen: true, center: { x: 0.5, y: 0.4 } },
    };
    const input = { ...recipe };
    const plan = createDeadlinePlan([first, shot("b")], input);
    input.prefix = "changed";
    first.edits.exposure = 20;
    first.faces.center.x = 0.2;
    expect(plan.recipe.prefix).toBe("press");
    expect(plan.frames[0]!.edits.exposure).toBe(0);
    expect(plan.frames[0]!.focus?.x).toBe(0.5);
    for (const value of [
      plan,
      plan.recipe,
      plan.frames,
      plan.frames[0],
      plan.frames[0]!.edits,
      plan.frames[0]!.focus,
      plan.keeperIds,
    ])
      expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(first)).toBe(false);
    expect(Object.isFrozen(first.edits)).toBe(false);
  });

  test("names stay flat and unique even for traversal, Unicode and repeated source names", () => {
    expect(deadlinePrefix("../../été\\evil:hi")).toBe("ete-evil-hi");
    expect(deadlinePrefix("../")).toBe("deadline");
    expect(deadlinePrefix("x".repeat(500))).toHaveLength(64);
    const shots = [shot("a"), { ...shot("b"), name: "a.jpg" }];
    const plan = createDeadlinePlan(shots, { ...recipe, prefix: "../../press" });
    expect(plan.frames.map((frame) => frame.filename)).toEqual(["press-001.jpg", "press-002.jpg"]);
  });

  for (const count of [0, -1, 201, 1.5, NaN, Infinity]) {
    test(`rejects invalid count ${count}`, () =>
      expect(() => createDeadlinePlan([shot("a"), shot("b")], { ...recipe, count })).toThrow(
        "1 and 200",
      ));
  }
  for (const longestEdge of [0, 255, 2049, 4096, 1024.1, NaN, Infinity]) {
    test(`rejects invalid edge ${longestEdge}`, () =>
      expect(() => createDeadlinePlan([shot("a"), shot("b")], { ...recipe, longestEdge })).toThrow(
        "256 and 2048",
      ));
  }
  for (const quality of [0, 0.49, 1.01, NaN, Infinity]) {
    test(`rejects invalid quality ${quality}`, () =>
      expect(() => createDeadlinePlan([shot("a"), shot("b")], { ...recipe, quality })).toThrow(
        "50% and 100%",
      ));
  }
  test("does not silently clamp insufficient keepers or skip unavailable selected originals", () => {
    expect(() => createDeadlinePlan([shot("a"), shot("b", "reject")], recipe)).toThrow(
      "Only 1 keepers",
    );
    expect(() => createDeadlinePlan([], recipe)).toThrow("Only 0 keepers");
    expect(() =>
      createDeadlinePlan([{ ...shot("a"), sourceAvailable: false }, shot("b")], recipe),
    ).toThrow("Reconnect");
    expect(() =>
      createDeadlinePlan([{ ...shot("a"), error: "Unreadable" }, shot("b")], recipe),
    ).toThrow("Unreadable");
    expect(() =>
      createDeadlinePlan([{ ...shot("a"), file: new File([], "a.jpg") }, shot("b")], recipe),
    ).toThrow("Reconnect");
    expect(() => createDeadlinePlan([shot("a"), shot("a")], recipe)).toThrow("duplicate");
  });
  test("rejects invalid edit/focus/dimension states and excessive metadata", () => {
    expect(() =>
      createDeadlinePlan(
        [{ ...shot("a"), edits: { ...DEFAULT_EDITS, exposure: Infinity } }, shot("b")],
        recipe,
      ),
    ).toThrow("invalid edit");
    expect(() =>
      createDeadlinePlan([{ ...shot("a"), width: 20_000, height: 20_000 }, shot("b")], recipe),
    ).toThrow("dimensions");
    expect(() =>
      createDeadlinePlan(
        [
          {
            ...shot("a"),
            faces: { count: 1, faceSharpness: 100, eyesOpen: true, center: { x: 2, y: 0 } },
          },
          shot("b"),
        ],
        recipe,
      ),
    ).toThrow("invalid crop focus");
    expect(() =>
      createDeadlinePlan([shot("a"), shot("b")], { ...recipe, caption: "x".repeat(2001) }),
    ).toThrow("2,000");
  });
});

describe("deadline staleness and protected picks", () => {
  const changes: [string, (shots: Shot[]) => Shot[]][] = [
    ["new keeper", (shots) => [...shots, shot("c")]],
    ["removed keeper", (shots) => shots.slice(1)],
    ["rejected selected keeper", (shots) => [{ ...shots[0]!, verdict: "reject" }, shots[1]!]],
    ["reordered keepers", (shots) => [...shots].reverse()],
    [
      "changed source object with equal metadata",
      (shots) => [
        {
          ...shots[0]!,
          file: new File(["a"], "a.jpg", { type: "image/jpeg", lastModified: 1234 }),
        },
        shots[1]!,
      ],
    ],
    [
      "changed edits",
      (shots) => [{ ...shots[0]!, edits: { ...DEFAULT_EDITS, shadows: 20 } }, shots[1]!],
    ],
    ["renamed source", (shots) => [{ ...shots[0]!, name: "renamed.jpg" }, shots[1]!]],
    ["source disconnected", (shots) => [{ ...shots[0]!, sourceAvailable: false }, shots[1]!]],
    [
      "changed focus",
      (shots) => [
        {
          ...shots[0]!,
          faces: { count: 1, faceSharpness: 100, eyesOpen: true, center: { x: 0.1, y: 0.4 } },
        },
        shots[1]!,
      ],
    ],
  ];
  for (const [name, mutate] of changes) {
    test(`${name} invalidates the frozen plan`, () => {
      const shots = [shot("a"), shot("b")];
      const plan = createDeadlinePlan(shots, recipe);
      expect(() => assertDeadlinePlanCurrent(plan, mutate(shots))).toThrow("shoot changed");
    });
  }
  test("unrelated rejected frames and analysis score updates do not invalidate selected output", () => {
    const shots = [shot("a"), shot("b")];
    const plan = createDeadlinePlan(shots, recipe);
    expect(() =>
      assertDeadlinePlanCurrent(plan, [
        { ...shots[0]!, score: 1 },
        shots[1]!,
        shot("rejected", "reject"),
      ]),
    ).not.toThrow();
  });
});

describe("deadline processing and ZIP backtests", () => {
  test("serial jobs preserve source bytes and exact edit identity in one complete ZIP", async () => {
    const shots = [shot("a"), shot("b")];
    shots[0]!.edits.temp = 25;
    const plan = createDeadlinePlan(shots, recipe);
    let active = 0;
    let maxActive = 0;
    const progress: number[] = [];
    const result = await prepareDeadlineExport(plan, () => shots, {
      render: async (frame, config) => {
        maxActive = Math.max(maxActive, ++active);
        await Promise.resolve();
        const image = await render(frame, config);
        active--;
        return image;
      },
      onProgress: (done) => progress.push(done),
    });
    expect(maxActive).toBe(1);
    expect(progress).toEqual([1, 2]);
    expect(result.failures).toEqual([]);
    expect(
      result.images.every(
        (image) => image.sha256.length === 64 && image.versionSha256.length === 64,
      ),
    ).toBe(true);
    const download = await createDeadlineDownload(result, () => shots);
    expect(download.filename).toBe("press-deadline.zip");
    expect(download.blob.type).toBe("application/zip");
    expect(new Uint8Array(await download.blob.slice(0, 4).arrayBuffer())).toEqual(
      new Uint8Array([80, 75, 3, 4]),
    );
    expect(download.manifest["metadataPlacement"]).toBe("manifest-sidecar-only-not-embedded-IPTC");
    expect(download.manifest["renderer"]).toBe("existing-browser-studio-renderer");
    const items = download.manifest["items"] as {
      frameId: string;
      edits: { temp: number };
      bytes: number;
      width: number;
    }[];
    expect(items.map((item) => item.frameId)).toEqual(["a", "b"]);
    expect(items[0]!.edits.temp).toBe(25);
    expect(items[0]!.width).toBe(2048);
    expect(items[0]!.bytes).toBe(jpeg("a").size);
    expect(await shots[0]!.file.text()).toBe("a");
    expect(shots.every((frame) => frame.verdict === "keep")).toBe(true);
  });
  test("per-file failures block download; retry only failures, retaining verified successes", async () => {
    const shots = [shot("a"), shot("b")];
    const plan = createDeadlinePlan(shots, recipe);
    const first = await prepareDeadlineExport(plan, () => shots, {
      render: async (frame, config) => {
        if (frame.id === "b") throw new Error("Decoder failed");
        return render(frame, config);
      },
    });
    expect(first.images.map((image) => image.id)).toEqual(["a"]);
    expect(first.failures).toEqual([{ id: "b", name: "b.jpg", message: "Decoder failed" }]);
    await expect(createDeadlineDownload(first, () => shots)).rejects.toThrow(
      "Every selected frame",
    );
    const retried: string[] = [];
    const retry = await prepareDeadlineExport(plan, () => shots, {
      previous: first,
      render: async (frame, config) => {
        retried.push(frame.id);
        return render(frame, config);
      },
    });
    expect(retried).toEqual(["b"]);
    expect(retry.images[0]).toBe(first.images[0]);
    expect(retry.failures).toEqual([]);
    await expect(createDeadlineDownload(retry, () => shots)).resolves.toHaveProperty("blob");
    const anotherPlan = createDeadlinePlan(shots, recipe);
    await expect(
      prepareDeadlineExport(anotherPlan, () => shots, { previous: first, render }),
    ).rejects.toThrow("different deadline");
  });
  test("cancellation stops future scheduling, blocks partial ZIP and permits resume", async () => {
    const shots = [shot("a"), shot("b")];
    const plan = createDeadlinePlan(shots, recipe);
    const controller = new AbortController();
    const result = await prepareDeadlineExport(plan, () => shots, {
      render,
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });
    expect(result.cancelled).toBe(true);
    expect(result.images.map((image) => image.id)).toEqual(["a"]);
    await expect(createDeadlineDownload(result, () => shots)).rejects.toThrow(
      "Every selected frame",
    );
    const resumed = await prepareDeadlineExport(plan, () => shots, { previous: result, render });
    expect(resumed.cancelled).toBe(false);
    expect(resumed.images).toHaveLength(2);
    const aborted = new AbortController();
    aborted.abort();
    await expect(createDeadlineDownload(resumed, () => shots, aborted.signal)).rejects.toThrow(
      "cancelled",
    );
  });
  test("mutations during asynchronous rendering and before final download never publish stale output", async () => {
    let shots = [shot("a"), shot("b")];
    const plan = createDeadlinePlan(shots, recipe);
    await expect(
      prepareDeadlineExport(plan, () => shots, {
        render: async (frame, config) => {
          shots = [{ ...shots[0]!, edits: { ...DEFAULT_EDITS, exposure: 20 } }, shots[1]!];
          return render(frame, config);
        },
      }),
    ).rejects.toThrow("shoot changed");
    shots = [shot("a"), shot("b")];
    const fresh = createDeadlinePlan(shots, recipe);
    const result = await prepareDeadlineExport(fresh, () => shots, { render });
    shots = shots.slice(1);
    await expect(createDeadlineDownload(result, () => shots)).rejects.toThrow("shoot changed");
  });
  test("invalid render receipts, missing outputs and corrupted JPEGs cannot become a successful set", async () => {
    const shots = [shot("a"), shot("b")];
    const plan = createDeadlinePlan(shots, recipe);
    const invalid = await prepareDeadlineExport(plan, () => shots, {
      render: async () => ({ blob: new Blob(["x"]), width: 4096, height: 3000 }),
    });
    expect(invalid.failures).toHaveLength(2);
    expect(invalid.images).toHaveLength(0);
    const result = await prepareDeadlineExport(plan, () => shots, { render });
    await expect(
      createDeadlineDownload({ ...result, images: result.images.slice(1) }, () => shots),
    ).rejects.toThrow("Every selected frame");
    await expect(
      createDeadlineDownload(
        { ...result, images: [result.images[0]!, result.images[0]!] },
        () => shots,
      ),
    ).rejects.toThrow("Duplicate export");
    await expect(
      createDeadlineDownload(
        { ...result, images: [{ ...result.images[0]!, blob: jpeg("changed") }, result.images[1]!] },
        () => shots,
      ),
    ).rejects.toThrow("checksum");
  });
  test("200 exports selected from 3,000 metadata fixtures stay bounded and do not alter any keepers", async () => {
    const shots = Array.from({ length: 3000 }, (_, index) =>
      shot(String(index), index % 2 ? "reject" : "keep"),
    );
    const plan = createDeadlinePlan(shots, { ...recipe, count: 200 });
    const result = await prepareDeadlineExport(plan, () => shots, { render });
    expect(result.images).toHaveLength(200);
    expect(plan.frames[199]!.id).toBe("398");
    expect(plan.frames[199]!.filename).toBe("press-200.jpg");
    const download = await createDeadlineDownload(result, () => shots);
    expect(download.manifest["items"] as unknown[]).toHaveLength(200);
    expect(shots.filter((frame) => frame.verdict === "keep")).toHaveLength(1500);
    expect(shots.filter((frame) => frame.verdict === "reject")).toHaveLength(1500);
  });
});
