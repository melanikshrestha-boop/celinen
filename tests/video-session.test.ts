import { describe, expect, test } from "bun:test";
import {
  VIDEO_REVIEW_STORAGE_KEY,
  clearVideoReviewSession,
  loadVideoReviewSession,
  saveVideoReviewSession,
  type VideoReviewDraft,
  type VideoReviewLockManager,
  type VideoReviewStorage,
} from "../src/lib/video/session";

class MemoryStorage implements VideoReviewStorage {
  value: string | null;
  writes = 0;

  constructor(value: string | null = null) {
    this.value = value;
  }

  getItem(key: string) {
    expect(key).toBe(VIDEO_REVIEW_STORAGE_KEY);
    return this.value;
  }

  setItem(key: string, value: string) {
    expect(key).toBe(VIDEO_REVIEW_STORAGE_KEY);
    this.writes += 1;
    this.value = value;
  }
}

const immediateLock: VideoReviewLockManager = {
  request: async (_name, callback) => callback(),
};

const clip = (id: string, verdict: "undecided" | "keep" = "undecided") => ({
  id,
  name: `${id}.mov`,
  type: "video/quicktime",
  size: 1234,
  lastModified: 1_788_595_200_000,
  duration: 12.5,
  width: 3840,
  height: 2160,
  verdict,
  metadataStatus: "ready" as const,
});

const draft = (id: string): VideoReviewDraft => ({
  clips: [clip(id)],
  selectedId: id,
  filter: "all",
  journal: [],
});

describe("video review persistence", () => {
  test("preserves an unreadable snapshot instead of replacing it", () => {
    const storage = new MemoryStorage("{broken");
    const loaded = loadVideoReviewSession(storage);
    expect(loaded.status).toBe("invalid");

    const saved = saveVideoReviewSession(draft("incoming"), 0, storage);
    expect(saved.ok).toBe(false);
    expect(storage.value).toBe("{broken");
    expect(storage.writes).toBe(0);
  });

  test("rejects a stale tab without dropping the newer review", () => {
    const storage = new MemoryStorage();
    const savedA = saveVideoReviewSession(draft("tab-a"), 0, storage, "2026-09-04T12:00:00.000Z");
    expect(savedA.ok).toBe(true);

    const savedB = saveVideoReviewSession(draft("tab-b"), 0, storage, "2026-09-04T12:00:01.000Z");
    expect(savedB.ok).toBe(false);
    if (savedB.ok) throw new Error("Expected a stale writer conflict");
    expect(savedB.reason).toBe("conflict");

    const current = loadVideoReviewSession(storage);
    expect(current.status).toBe("ready");
    if (current.status !== "ready") throw new Error("Expected a saved review");
    expect(current.session.clips.map((item) => item.id)).toEqual(["tab-a"]);
  });

  test("keeps a revision tombstone so a stale tab cannot resurrect a cleared review", async () => {
    const storage = new MemoryStorage();
    const saved = saveVideoReviewSession(draft("old"), 0, storage);
    if (!saved.ok) throw new Error(saved.error);

    const staleRevision = saved.session.revision;
    const cleared = await clearVideoReviewSession({
      storage,
      lockManager: immediateLock,
      now: "2026-09-04T12:00:02.000Z",
    });
    expect(cleared.ok).toBe(true);

    const resurrect = saveVideoReviewSession(draft("old"), staleRevision, storage);
    expect(resurrect.ok).toBe(false);
    const current = loadVideoReviewSession(storage);
    expect(current.status).toBe("ready");
    if (current.status !== "ready") throw new Error("Expected a clear tombstone");
    expect(current.session.clips).toEqual([]);
  });

  test("rejects a partially invalid clip list instead of silently shrinking it", () => {
    const raw = JSON.stringify({
      version: 1,
      revision: 4,
      clips: [clip("safe"), { ...clip("bad"), size: -1 }],
      selectedId: "safe",
      filter: "all",
      journal: [],
      updatedAt: "2026-09-04T12:00:00.000Z",
    });
    const storage = new MemoryStorage(raw);
    expect(loadVideoReviewSession(storage).status).toBe("invalid");
    expect(storage.value).toBe(raw);
    expect(storage.writes).toBe(0);
  });
});
