import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { openFolder, previewFolder, writeFile } from "../src/lib/studio/cull/opfs";
import {
  evictionOrder,
  previewBudget,
  PreviewLibrary,
  previewFileName,
  type EvictionCandidate,
} from "../src/lib/studio/cull/preview-library";
import {
  PreviewQueue,
  previewOrder,
  type PreviewEncoder,
} from "../src/lib/studio/cull/preview-queue";
import type { PreviewRequest } from "../src/lib/studio/cull/preview-messages";
import type { CullFrame } from "../src/lib/studio/cull/session";
import { SourcePermissionError } from "../src/lib/studio/cull/sources";
import { openCullStore, type CullPreviewRow, type CullStore } from "../src/lib/studio/cull/store";
import { cullRow } from "./cull-review.fixture";
import { FakeOpfsDirectory, FakeStorage } from "./cull-originals.fixture";

const MB = 1024 * 1024;

function frame(id: string, extra: Partial<CullFrame> = {}): CullFrame {
  return {
    id,
    name: `${id}.jpg`,
    width: 6000,
    height: 4000,
    bytes: 12 * MB,
    captureTimeMs: null,
    verdict: "undecided",
    decided: false,
    ...extra,
  };
}

function row(
  sessionId: string,
  frameId: string,
  extra: Partial<CullPreviewRow> = {},
): CullPreviewRow {
  return {
    sessionId,
    frameId,
    file: `${frameId}.jpg`,
    bytes: MB,
    width: 2048,
    height: 1365,
    createdAt: 0,
    suggestedReject: false,
    ...extra,
  };
}

async function setup(quota: number) {
  const storage = new FakeStorage(quota);
  const root = new FakeOpfsDirectory(storage);
  const store = await openCullStore("account", new IDBFactory());
  const library = new PreviewLibrary({
    scope: "account",
    store,
    root: () => Promise.resolve(root),
    storage: storage.api(),
  });
  return { storage, root, store, library };
}

/** Writes `size` bytes the way the preview worker does, and answers like it. */
function fakeEncoder(
  root: FakeOpfsDirectory,
  options: { size?: number; fail?: (request: Omit<PreviewRequest, "id">) => boolean } = {},
) {
  const requests: Omit<PreviewRequest, "id">[] = [];
  let disposed = 0;
  const encoder: PreviewEncoder = {
    async encode(request) {
      requests.push(request);
      if (options.fail?.(request)) return { id: 0, kind: "failed", error: "Unsupported" };
      const folder = (await openFolder(root, request.folder, true))!;
      try {
        await writeFile(folder, request.name, new Uint8Array(options.size ?? MB));
      } catch (error) {
        if (error instanceof DOMException && error.name === "QuotaExceededError")
          return { id: 0, kind: "quota" };
        throw error;
      }
      return { id: 0, kind: "written", bytes: options.size ?? MB, width: 2048, height: 1365 };
    },
    dispose: () => {
      disposed += 1;
    },
  };
  return { encoder, requests, disposed: () => disposed };
}

const noLock = <T>(_name: string, task: () => Promise<T>) => task();

function runner(frames: CullFrame[]) {
  const byId = new Map(frames.map((f) => [f.id, f]));
  return {
    frames: () => frames,
    frame: (id: string) => byId.get(id),
  };
}

describe("preview budget", () => {
  test("takes 80% of quota, less everything else stored and a reserve", () => {
    // 100 GB quota, 2 GB of other data, 10 GB of previews already.
    const GB = 1024 * MB;
    expect(previewBudget({ quota: 100 * GB, usage: 12 * GB }, 10 * GB)).toBe(
      80 * GB - 2 * GB - 512 * MB,
    );
    // A small quota keeps a proportional reserve rather than 512 MB.
    expect(previewBudget({ quota: 100 * MB, usage: 0 }, 0)).toBe(80 * MB - 10 * MB);
    expect(previewBudget({}, 0)).toBe(0);
    expect(previewBudget({ quota: 10 * MB, usage: 50 * MB }, 0)).toBe(0);
  });
});

describe("eviction order", () => {
  const candidate = (
    sessionId: string,
    frameId: string,
    sessionUpdatedAt: number,
    decided: EvictionCandidate["decided"],
    suggestedReject = false,
  ): EvictionCandidate => ({
    row: row(sessionId, frameId),
    sessionUpdatedAt,
    decided,
    suggestedReject,
  });

  test("photographer rejects, then engine rejects, then old sessions; never the open session's keepers", () => {
    const order = evictionOrder(
      [
        candidate("open", "open-keep", 300, "keep"),
        candidate("open", "open-undecided", 300, null),
        candidate("open", "open-suggested", 300, null, true),
        candidate("open", "open-rejected", 300, "reject"),
        candidate("old", "old-keep", 100, "keep"),
        candidate("old", "old-undecided", 100, null),
        candidate("old", "old-rejected", 100, "reject"),
        candidate("mid", "mid-undecided", 200, null),
        candidate("mid", "mid-keep-suggested-reject", 200, "keep", true),
      ],
      "open",
    );
    expect(order.map((r) => r.frameId)).toEqual([
      "old-rejected",
      "open-rejected",
      "open-suggested",
      "old-undecided",
      "old-keep",
      "mid-undecided",
      // The photographer's keep outranks the engine's reject suggestion.
      "mid-keep-suggested-reject",
    ]);
  });

  test("failed rows hold no bytes and are not candidates", () => {
    const failed: EvictionCandidate = {
      row: row("old", "f", { failed: true, bytes: 0 }),
      sessionUpdatedAt: 0,
      decided: "reject",
      suggestedReject: false,
    };
    expect(evictionOrder([failed], null)).toEqual([]);
  });
});

describe("preview library", () => {
  test("records, reads back, and drops a row whose file has gone", async () => {
    const { root, store, library } = await setup(1024 * MB);
    const session = await store.create("Game");
    const { encoder } = fakeEncoder(root, { size: 1234 });
    const name = await previewFileName("Card/IMG_1.jpg:1:2:0");
    expect(name).toMatch(/^[0-9a-f]{32}-2\.jpg$/); // the generation rides in the name
    const reply = await encoder.encode({
      file: new File(["x"], "IMG_1.jpg"),
      folder: previewFolder("account", session.id),
      name,
      maxEdge: 2048,
      quality: 0.82,
    });
    expect(reply.kind).toBe("written");
    await library.record(row(session.id, "a", { file: name, bytes: 1234 }));
    expect((await library.read(session.id, "a"))!.size).toBe(1234);
    expect(await library.totalBytes()).toBe(1234);

    // Site data cleared underneath: the row goes too, and the loupe falls back.
    const folder = (await openFolder(root, previewFolder("account", session.id), false))!;
    await folder.removeEntry(name);
    expect(await library.read(session.id, "a")).toBeNull();
    expect(await store.preview(session.id, "a")).toBeNull();
    expect(await library.totalBytes()).toBe(0);
    store.close();
  });

  test("makes room by evicting in order, and refuses rather than touch the open session's keepers", async () => {
    // 20 MB quota: 16 MB at 80%, less a 2 MB reserve = 14 MB for previews.
    const { storage, root, store, library } = await setup(20 * MB);
    const old = await store.create("Old game");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const open = await store.create("Tonight");
    await store.append(old.id, [
      { frame: frame("o1"), thumbnail: new Blob() },
      { frame: frame("o2", { verdict: "reject", decided: true }), thumbnail: new Blob() },
    ]);
    const openFrames = Array.from({ length: 12 }, (_, i) =>
      frame(
        `n${i}`,
        i === 0 ? { suggestion: cullRow({ verdict: "reject", reason: "out-of-focus" }) } : {},
      ),
    );
    const write = async (sessionId: string, frameId: string) => {
      const folder = (await openFolder(root, previewFolder("account", sessionId), true))!;
      await writeFile(folder, `${frameId}.jpg`, new Uint8Array(MB));
      await library.record(row(sessionId, frameId));
    };
    await write(old.id, "o1");
    await write(old.id, "o2");
    for (const f of openFrames) await write(open.id, f.id);
    expect(await library.totalBytes()).toBe(14 * MB);
    expect(storage.usage).toBe(14 * MB);

    const session = { sessionId: open.id, frames: openFrames };
    // One more: the old session's rejected frame goes first.
    expect(await library.reserve(MB, session, true)).toBe(true);
    expect(await store.preview(old.id, "o2")).toBeNull();
    expect(await store.preview(old.id, "o1")).not.toBeNull();
    // Space is really given back, not just unindexed.
    expect(storage.usage).toBe(13 * MB);

    // Two more: the open session's engine reject, then the old session's undecided frame.
    await write(open.id, "n12");
    openFrames.push(frame("n12"));
    expect(await library.reserve(2 * MB, session, true)).toBe(true);
    expect(await store.preview(open.id, "n0")).toBeNull();
    expect(await store.preview(old.id, "o1")).toBeNull();

    // Nothing left but the open session's keepers and undecided frames: refuse.
    expect(await library.reserve(5 * MB, session, true)).toBe(false);
    expect((await store.previews()).filter((r) => r.sessionId === open.id)).toHaveLength(12);
    store.close();
  });

  test("deleting a session removes its preview files, rows, frames and thumbnails", async () => {
    const { storage, root, store, library } = await setup(1024 * MB);
    const keep = await store.create("Keep");
    const gone = await store.create("Gone");
    for (const session of [keep, gone]) {
      await store.append(session.id, [{ frame: frame("a"), thumbnail: new Blob(["t"]) }]);
      const folder = (await openFolder(root, previewFolder("account", session.id), true))!;
      await writeFile(folder, "a.jpg", new Uint8Array(MB));
      await library.record(row(session.id, "a"));
    }
    await library.deleteSession(gone.id);
    await store.deleteSession(gone.id);
    expect([...root.files().keys()]).toEqual([`celinen-cull-previews/account/${keep.id}/a.jpg`]);
    expect(storage.usage).toBe(MB);
    expect(await library.totalBytes()).toBe(MB);
    expect(await store.frames(gone.id)).toEqual([]);
    expect(await store.thumbnail(gone.id, "a")).toBeNull();
    expect((await store.previews()).map((r) => r.sessionId)).toEqual([keep.id]);
    expect(await store.thumbnail(keep.id, "a")).not.toBeNull();
    store.close();
  });
});

describe("preview queue", () => {
  test("keepers first, rejects last, unreadable frames never", () => {
    const frames = [
      frame("reject", { verdict: "reject", decided: true }),
      frame("undecided"),
      frame("broken", { error: "Unreadable" }),
      frame("keep", { suggestion: cullRow({ verdict: "keep" }) }),
      frame("done"),
    ];
    expect(previewOrder(frames, new Set(["done"])).map((f) => f.id)).toEqual([
      "keep",
      "undecided",
      "reject",
    ]);
  });

  test("a run interrupted halfway resumes with only the frames still missing", async () => {
    const { storage, root, store, library } = await setup(1024 * MB);
    const session = await store.create("Game");
    const frames = Array.from({ length: 6 }, (_, i) => frame(`f${i}`));
    const first = fakeEncoder(root);
    const queue = new PreviewQueue({
      scope: "account",
      library,
      encoder: () => first.encoder,
      lock: noLock,
    });
    const stop = new AbortController();
    let served = 0;
    const result = await queue.run({
      sessionId: session.id,
      ...runner(frames),
      // The tab "closes" after the third original is handed over.
      original: async (f) => {
        served += 1;
        if (served === 3) stop.abort();
        return new File([f.id], f.name);
      },
      signal: stop.signal,
    });
    expect(result).toEqual({ written: 2, failed: 0, missing: 0, end: "aborted" });
    expect(first.disposed()).toBe(1);
    expect(storage.persistCalls).toBe(1);

    // A new page: new library, same storage. Originals come back (a reconnect).
    const reopened = new PreviewLibrary({
      scope: "account",
      store,
      root: () => Promise.resolve(root),
      storage: storage.api(),
    });
    const second = fakeEncoder(root);
    const resumed = new PreviewQueue({
      scope: "account",
      library: reopened,
      encoder: () => second.encoder,
      lock: noLock,
    });
    const asked: string[] = [];
    const again = await resumed.run({
      sessionId: session.id,
      ...runner(frames),
      original: async (f) => {
        asked.push(f.id);
        return new File([f.id], f.name);
      },
      signal: new AbortController().signal,
    });
    expect(again).toEqual({ written: 4, failed: 0, missing: 0, end: "done" });
    expect(asked).toEqual(["f2", "f3", "f4", "f5"]);
    expect(await reopened.totalBytes()).toBe(6 * MB);
    // Nothing left: a third run does no work and starts no worker.
    let started = 0;
    const idle = new PreviewQueue({
      scope: "account",
      library: reopened,
      encoder: () => {
        started += 1;
        return second.encoder;
      },
      lock: noLock,
    });
    expect(
      await idle.run({
        sessionId: session.id,
        ...runner(frames),
        original: async () => null,
        signal: new AbortController().signal,
      }),
    ).toEqual({ written: 0, failed: 0, missing: 0, end: "done" });
    expect(started).toBe(0);
    store.close();
  });

  test("missing originals are skipped, undecodable ones are recorded once, lost access stops", async () => {
    const { root, store, library } = await setup(1024 * MB);
    const session = await store.create("Game");
    const frames = [frame("moved"), frame("heic"), frame("ok"), frame("after-revoke")];
    const { encoder } = fakeEncoder(root, { fail: (request) => request.file.name === "heic.jpg" });
    const queue = new PreviewQueue({
      scope: "account",
      library,
      encoder: () => encoder,
      lock: noLock,
    });
    const result = await queue.run({
      sessionId: session.id,
      ...runner(frames),
      original: async (f) => {
        if (f.id === "moved") return null;
        if (f.id === "after-revoke") throw new SourcePermissionError();
        return new File([f.id], f.name);
      },
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ written: 1, failed: 1, missing: 1, end: "permission" });
    const covered = await library.covered(session.id);
    // The failure is remembered so it is not retried every visit; the missing frame is not.
    expect([...covered].sort()).toEqual(["heic", "ok"]);
    expect(await library.read(session.id, "heic")).toBeNull();
    store.close();
  });

  test("stops when the budget is full instead of evicting what the photographer needs", async () => {
    const { root, store, library } = await setup(8 * MB); // 6.4 MB - 0.8 MB reserve = 5.6 MB
    const session = await store.create("Game");
    const frames = Array.from({ length: 10 }, (_, i) => frame(`f${i}`));
    const { encoder } = fakeEncoder(root);
    const queue = new PreviewQueue({
      scope: "account",
      library,
      encoder: () => encoder,
      lock: noLock,
    });
    const result = await queue.run({
      sessionId: session.id,
      ...runner(frames),
      original: async (f) => new File([f.id], f.name),
      signal: new AbortController().signal,
    });
    expect(result.end).toBe("full");
    expect(result.written).toBe(5); // 5 MB written, and a sixth estimated MB would pass 5.6
    expect(await library.totalBytes()).toBe(5 * MB);
    store.close();
  });

  test("a quota refusal the estimate missed is retried once after a fresh estimate", async () => {
    const { storage, root, store, library } = await setup(1024 * MB);
    const session = await store.create("Game");
    const { encoder } = fakeEncoder(root);
    let refusals = 1;
    const flaky: PreviewEncoder = {
      encode: async (request) => {
        if (refusals-- > 0) return { id: 0, kind: "quota" };
        return encoder.encode(request);
      },
      dispose: () => {},
    };
    const queue = new PreviewQueue({
      scope: "account",
      library,
      encoder: () => flaky,
      lock: noLock,
    });
    const result = await queue.run({
      sessionId: session.id,
      ...runner([frame("a")]),
      original: async (f) => new File([f.id], f.name),
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ written: 1, failed: 0, missing: 0, end: "done" });
    expect(storage.usage).toBe(MB);
    store.close();
  });

  test("another tab already making this session's previews: this one does nothing", async () => {
    const { root, store, library } = await setup(1024 * MB);
    const { encoder } = fakeEncoder(root);
    const queue = new PreviewQueue({
      scope: "account",
      library,
      encoder: () => encoder,
      lock: async () => null,
    });
    const result = await queue.run({
      sessionId: "s",
      ...runner([frame("a")]),
      original: async () => new File(["a"], "a.jpg"),
      signal: new AbortController().signal,
    });
    expect(result.end).toBe("busy");
    store.close();
  });
});

export type { CullStore };
