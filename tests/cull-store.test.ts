import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createCullWriter, cullDatabaseName, openCullStore } from "../src/lib/studio/cull/store";
import type { CullFrame } from "../src/lib/studio/cull/session";

function frame(id: string, captureTimeMs: number | null, extra: Partial<CullFrame> = {}): CullFrame {
  return {
    id,
    name: `${id}.jpg`,
    width: 6000,
    height: 4000,
    bytes: 12_000_000,
    captureTimeMs,
    verdict: "undecided",
    decided: false,
    ...extra,
  };
}

const thumb = (label: string) => new Blob([`jpeg-bytes-${label}`], { type: "image/jpeg" });

describe("on-device cull sessions", () => {
  test("a session round-trips frames in capture order, with thumbnails stored apart", async () => {
    const store = await openCullStore("account-a", new IDBFactory());
    const session = await store.create("  Varsity vs. Central  ");
    expect(session.name).toBe("Varsity vs. Central");
    await store.append(session.id, [
      { frame: frame("late", 3000), thumbnail: thumb("late") },
      { frame: frame("early", 1000), thumbnail: thumb("early") },
      { frame: frame("untimed", null), thumbnail: new Blob() },
    ]);
    const frames = await store.frames(session.id);
    expect(frames.map((f) => f.id)).toEqual(["early", "late", "untimed"]);
    // Frame rows carry no storage bookkeeping back to the screen.
    expect(Object.keys(frames[0]!)).not.toContain("sessionId");
    expect(await (await store.thumbnail(session.id, "early"))!.text()).toBe("jpeg-bytes-early");
    expect(await store.thumbnail(session.id, "untimed")).toBeNull();
    const [summary] = await store.list();
    expect(summary!.frameCount).toBe(3);
    store.close();
  });

  test("decisions update frame rows without touching thumbnails or counts", async () => {
    const factory = new IDBFactory();
    const store = await openCullStore("account-a", factory);
    const session = await store.create("Game");
    await store.append(session.id, [{ frame: frame("a", 1), thumbnail: thumb("a") }]);
    await store.update(session.id, [frame("a", 1, { verdict: "keep", decided: true })]);
    const [saved] = await store.frames(session.id);
    expect(saved!.verdict).toBe("keep");
    expect(saved!.decided).toBe(true);
    expect(await (await store.thumbnail(session.id, "a"))!.text()).toBe("jpeg-bytes-a");
    expect((await store.list())[0]!.frameCount).toBe(1);
    store.close();
    // A reload sees the decision.
    const reopened = await openCullStore("account-a", factory);
    expect((await reopened.frames(session.id))[0]!.verdict).toBe("keep");
    reopened.close();
  });

  test("accounts never see each other's sessions", async () => {
    const factory = new IDBFactory();
    const mine = await openCullStore("account-a", factory);
    await mine.create("Mine");
    const theirs = await openCullStore("account-b", factory);
    expect(await theirs.list()).toEqual([]);
    expect(cullDatabaseName("a/b c")).toBe("celinen-cull:a_b_c");
    mine.close();
    theirs.close();
  });

  test("writing to a session that no longer exists fails loudly", async () => {
    const store = await openCullStore("account-a", new IDBFactory());
    await expect(
      store.append("missing", [{ frame: frame("a", 1), thumbnail: thumb("a") }]),
    ).rejects.toThrow("no longer exists");
    store.close();
  });

  test("a ten-thousand frame card is a few dozen writes, not ten thousand", async () => {
    const store = await openCullStore("account-a", new IDBFactory());
    const session = await store.create("Tournament");
    let transactions = 0;
    const counting = {
      append: async (id: string, batch: Parameters<typeof store.append>[1]) => {
        transactions += 1;
        await store.append(id, batch);
      },
    };
    const writer = createCullWriter(counting, session.id, { batch: 250, delayMs: 10_000 });
    for (let i = 0; i < 10_000; i++) writer.add(frame(`f${i}`, i * 100), thumb(String(i)));
    await writer.flush();
    expect(transactions).toBe(40);
    expect((await store.list())[0]!.frameCount).toBe(10_000);
    expect(await store.frames(session.id)).toHaveLength(10_000);
    store.close();
  }, 120_000);

  test("a failed batch is reported, not swallowed", async () => {
    const errors: unknown[] = [];
    const writer = createCullWriter(
      { append: async () => Promise.reject(new Error("QuotaExceededError")) },
      "session",
      { batch: 2, delayMs: 10_000, onError: (error) => errors.push(error) },
    );
    writer.add(frame("a", 1), thumb("a"));
    writer.add(frame("b", 2), thumb("b"));
    await writer.flush();
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain("QuotaExceededError");
  });
});
