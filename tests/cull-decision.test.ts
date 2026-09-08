import { describe, expect, test } from "bun:test";
import {
  applyBurstCull,
  assertKeepersOnly,
  cullReason,
  formatCullCsv,
  formatJobJson,
  keeperPreviewFile,
  keepersForDelivery,
  type CullFrame,
} from "../src/lib/studio/cull-decision";

const frame = (id: string, overrides: Partial<CullFrame> = {}): CullFrame => ({
  id,
  name: `${id}.jpg`,
  relativePath: `card/${id}.jpg`,
  verdict: "undecided",
  score: 80,
  flags: [],
  ...overrides,
});

describe("burst cull is keep-one-reject-rest, not a favorite", () => {
  test("keeping one unreviewed frame rejects the other unreviewed frames", () => {
    const frames = [frame("a"), frame("b"), frame("c")];
    expect(applyBurstCull(frames, "b", ["a", "b", "c"])).toEqual([
      { id: "b", verdict: "keep" },
      { id: "a", verdict: "reject" },
      { id: "c", verdict: "reject" },
    ]);
    expect(frames.map((item) => item.verdict)).toEqual(["undecided", "undecided", "undecided"]);
  });

  test("existing keep and reject decisions are not overwritten", () => {
    const frames = [
      frame("a", { verdict: "keep" }),
      frame("b"),
      frame("c", { verdict: "reject" }),
      frame("d", { error: "unreadable" }),
    ];
    expect(applyBurstCull(frames, "b", ["a", "b", "c", "d"])).toEqual([
      { id: "b", verdict: "keep" },
    ]);
  });

  test("a decided frame is a no-op so favorites cannot masquerade as a recull", () => {
    expect(applyBurstCull([frame("a", { verdict: "keep" }), frame("b")], "a", ["a", "b"])).toEqual(
      [],
    );
    expect(applyBurstCull([frame("a", { verdict: "reject" }), frame("b")], "a", ["a", "b"])).toEqual(
      [],
    );
  });

  test("a keep outside the burst, or an unreadable keeper, changes nothing", () => {
    expect(() => applyBurstCull([frame("a"), frame("b")], "c", ["a", "b"])).toThrow(/not in this burst/);
    expect(() =>
      applyBurstCull([frame("a", { error: "missing" }), frame("b")], "a", ["a", "b"]),
    ).toThrow(/Reconnect/);
  });
});

describe("cull sheet and keepers-only delivery", () => {
  test("csv records photographer decisions with reject reasons", () => {
    const csv = formatCullCsv([
      frame("a", { verdict: "keep", score: 91 }),
      frame("b", { verdict: "reject", flags: ["eyes-closed"], score: 88 }),
      frame("c, quote\".CR3", {
        relativePath: `card/c, quote".CR3`,
        name: `c, quote".CR3`,
        verdict: "reject",
        flags: ["blur"],
      }),
      frame("d", { error: "decode", verdict: "undecided" }),
    ]);
    expect(csv).toBe(
      [
        "file,score,reason,decision",
        "card/a.jpg,91,keep,keep",
        "card/b.jpg,88,blink,reject",
        `"card/c, quote"".CR3",80,blur,reject`,
        "card/d.jpg,80,unreadable,undecided",
        "",
      ].join("\n"),
    );
    expect(cullReason(frame("e", { verdict: "reject", flags: ["duplicate"] }))).toBe("duplicate");
  });

  test("job.json counts keepers without copying originals", () => {
    const json = JSON.parse(
      formatJobJson("Chen Wedding", "/Volumes/CARD", [frame("a", { verdict: "keep" }), frame("b")]),
    );
    expect(json).toMatchObject({
      format: 1,
      job: "Chen Wedding",
      source: "/Volumes/CARD",
      files: 2,
      keepers: 1,
      rejected: 0,
      review: 1,
    });
    expect(json.note).toContain("not copied");
    expect(() => formatJobJson("  ", "/card", [])).toThrow(/Name the job/);
  });

  test("delivery accepts keepers only and refuses the card dump", () => {
    expect(() => keepersForDelivery([frame("a"), frame("b", { verdict: "reject" })])).toThrow(
      /Cull first/,
    );
    expect(keepersForDelivery([frame("a", { verdict: "keep" })]).map((item) => item.id)).toEqual([
      "a",
    ]);
    expect(() =>
      assertKeepersOnly([frame("a", { verdict: "keep" }), frame("b", { verdict: "reject" })]),
    ).toThrow(/cannot enter a client gallery/);
    expect(() =>
      keeperPreviewFile(frame("a", { verdict: "reject", file: new File(["x"], "a.jpg") })),
    ).toThrow(/Only keepers/);
  });

  test("RAW keepers travel as the Studio preview, never as a hostage original", () => {
    const preview = new Blob(["jpeg-bytes"], { type: "image/jpeg" });
    const file = keeperPreviewFile(
      frame("a", {
        verdict: "keep",
        name: "DSC_0001.CR3",
        isRaw: true,
        file: new File(["raw"], "DSC_0001.CR3"),
        previewBlob: preview,
      }),
    );
    expect(file.name).toBe("DSC_0001.jpg");
    expect(file.type).toBe("image/jpeg");
  });
});
