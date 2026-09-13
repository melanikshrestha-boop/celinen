import { describe, expect, test } from "bun:test";
import {
  createTonightPasscode,
  makeTonightSlug,
  planTonightGallery,
  tonightGalleryPath,
  tonightProgress,
  TONIGHT_READY_RATIO,
} from "../src/lib/studio/tonight-gallery";
import { createTonightLocalGalleryRecord } from "../src/lib/delivery/tonight-local";
import type { CullFrame } from "../src/lib/studio/cull-decision";

const frame = (id: string, overrides: Partial<CullFrame> = {}): CullFrame => ({
  id,
  name: `${id}.jpg`,
  verdict: "keep",
  score: 80,
  flags: [],
  file: new File([id], `${id}.jpg`, { type: "image/jpeg" }),
  ...overrides,
});

describe("same-night gallery send", () => {
  test("is ready at 90% decided with at least one keeper", () => {
    const frames = [
      ...Array.from({ length: 9 }, (_, i) => frame(String(i), { verdict: "keep" })),
      frame("open", { verdict: "undecided" }),
    ];
    const progress = tonightProgress(frames);
    expect(TONIGHT_READY_RATIO).toBe(0.9);
    expect(progress.ready).toBe(true);
    expect(progress.keepers).toBe(9);
    const plan = planTonightGallery(frames, {
      title: "Chen",
      random: () => 0.1,
    });
    expect(plan.keepers).toHaveLength(9);
    expect(plan.downloadsEnabled).toBe(true);
    expect(plan.originalsUntouched).toBe(true);
    expect(plan.passcode).toHaveLength(6);
    expect(tonightGalleryPath(plan.slug)).toBe(`/g/${plan.slug}`);
  });

  test("blocks a send before 90% and never includes rejects", () => {
    const frames = [
      frame("a", { verdict: "keep" }),
      frame("b", { verdict: "reject" }),
      frame("c", { verdict: "undecided" }),
      frame("d", { verdict: "undecided" }),
    ];
    expect(tonightProgress(frames).ready).toBe(false);
    expect(() => planTonightGallery(frames, { title: "Chen" })).toThrow(/Decide 2 more/);
    const ready = [
      frame("a"),
      frame("b"),
      frame("c"),
      frame("d"),
      frame("e"),
      frame("f"),
      frame("g"),
      frame("h"),
      frame("i"),
      frame("cut", { verdict: "reject" }),
    ];
    const plan = planTonightGallery(ready, { title: "Chen", passcode: "PLANET", slug: "chen-abc12" });
    expect(plan.keepers.map((item) => item.id)).toEqual(["a", "b", "c", "d", "e", "f", "g", "h", "i"]);
    expect(plan.keepers.some((item) => item.verdict !== "keep")).toBe(false);
  });

  test("unreadable frames are not in the 90% denominator", () => {
    const frames = [
      frame("a"),
      frame("b"),
      frame("broken", { error: "unreadable", verdict: "undecided" }),
    ];
    expect(tonightProgress(frames)).toMatchObject({ readable: 2, decided: 2, ready: true });
  });

  test("local record stores passcode and never claims originals moved", () => {
    const gallery = createTonightLocalGalleryRecord(
      {
        title: "  Chen  ",
        passcode: "PLANET",
        slug: "chen-abc12",
        keepers: [frame("a")],
      },
      { id: "gallery-1", now: "2026-09-12T04:00:00.000Z" },
    );
    expect(gallery).toEqual({
      id: "gallery-1",
      slug: "chen-abc12",
      title: "Chen",
      passcode: "PLANET",
      downloadsEnabled: true,
      createdAt: "2026-09-12T04:00:00.000Z",
      keepers: 1,
      note: "Originals were not copied, moved, or modified.",
    });
  });

  test("passcode alphabet avoids 0/O/1/I", () => {
    const codes = Array.from({ length: 40 }, (_, i) => createTonightPasscode(() => (i % 32) / 32));
    expect(codes.every((code) => /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code))).toBe(true);
    expect(makeTonightSlug("Chen Wedding", () => 0.5)).toMatch(/^chen-wedding-[0-9a-z]+$/);
  });
});
