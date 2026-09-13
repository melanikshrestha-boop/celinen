import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { shortlistProtocol } from "../src/server/native-studio-plugin";
const frame = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  hash: "aaaaaaaaaaaaaaaa",
  score: 90,
  sharpness: 200,
  brightness: 120,
  verdict: "undecided",
  hashDomain: "native-cpp",
  flags: [],
  analysisAvailable: true,
  sourceAvailable: true,
  manualReview: false,
  ...extra,
});
test("native shortlist frames explicit eligibility and treats every non-underexposure flag as review", () => {
  for (const flag of [
    "blur",
    "soft",
    "face-soft",
    "eyes-closed",
    "overexposed",
    "duplicate",
    "expression-uncertain",
    "future-unknown",
  ]) {
    const text = shortlistProtocol({ targetCount: 1, frames: [frame("a", { flags: [flag] })] });
    expect(text.split("\n")[1]).toBe("19");
  }
  expect(
    shortlistProtocol({ targetCount: 1, frames: [frame("a", { flags: ["underexposed"] })] }).split(
      "\n",
    )[1],
  ).toBe("35");
  for (const input of [
    { targetCount: 0, frames: [] },
    { targetCount: 1.5, frames: [] },
    { targetCount: 1, frames: [frame("a"), frame("a")] },
    { targetCount: 1, frames: [frame("a", { analysisAvailable: undefined })] },
    { targetCount: 1, frames: [frame("a", { flags: [{}] })] },
  ])
    expect(() => shortlistProtocol(input)).toThrow();
});
test("real metadata-only native shortlist retains manual keeps and holds uncertain frames", () => {
  const frames = [
    frame("keep", { verdict: "keep", sourceAvailable: false }),
    frame("reject", { verdict: "reject" }),
    frame("dark", { score: 20, brightness: 20, flags: ["underexposed"] }),
    frame("hold", { manualReview: true }),
  ];
  const run = spawnSync("native/build/lenslabs-shortlist", {
    input: shortlistProtocol({ targetCount: 3, frames }),
    encoding: "utf8",
  });
  expect(run.status).toBe(0);
  const result = JSON.parse(run.stdout);
  expect(result.selectedIds).toEqual(["keep", "dark"]);
  expect(result.candidateIds).toEqual(["dark"]);
  expect(result.reviewIds).toEqual(["hold"]);
  expect(result.shortfall).toBe(1);
});
