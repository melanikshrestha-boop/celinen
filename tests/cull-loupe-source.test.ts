import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { CullController, type CullSnapshot } from "../src/lib/studio/cull/controller";
import { DecodedLru } from "../src/lib/studio/cull/loupe-cache";
import { pickLoupeImage, type LoupeSources } from "../src/lib/studio/cull/loupe-source";
import { openFolder, writeFile } from "../src/lib/studio/cull/opfs";
import { PreviewLibrary } from "../src/lib/studio/cull/preview-library";
import { PreviewQueue, type PreviewEncoder } from "../src/lib/studio/cull/preview-queue";
import type { CullSourceRoot } from "../src/lib/studio/cull/sources";
import { openCullStore, type CullStore } from "../src/lib/studio/cull/store";
import { FakeOpfsDirectory, FakeStorage, frameFor, MockDirectory } from "./cull-originals.fixture";

const jpeg = (text: string) => new Blob([text], { type: "image/jpeg" });
const T = 1_726_000_000_000;

function sources(overrides: Partial<LoupeSources>): LoupeSources {
  return {
    live: () => null,
    reconnected: async () => null,
    preview: async () => null,
    thumbnail: async () => null,
    ...overrides,
  };
}

describe("loupe source preference", () => {
  test("live original, then reconnected, then preview, then thumbnail", async () => {
    const all = sources({
      live: () => new File(["live"], "a.jpg", { type: "image/jpeg" }),
      reconnected: async () => new File(["disk"], "a.jpg", { type: "image/jpeg" }),
      preview: async () => jpeg("preview"),
      thumbnail: async () => jpeg("thumb"),
    });
    expect((await pickLoupeImage(all))!.kind).toBe("original");
    expect((await pickLoupeImage({ ...all, live: () => null }))!.kind).toBe("reconnected");
    expect(
      (await pickLoupeImage({ ...all, live: () => null, reconnected: async () => null }))!.kind,
    ).toBe("preview");
    expect((await pickLoupeImage(sources({ thumbnail: async () => jpeg("t") })))!.kind).toBe(
      "thumbnail",
    );
    expect(await pickLoupeImage(sources({}))).toBeNull();
  });

  test("a RAW original is skipped for the preview made from it; a failing source falls through", async () => {
    const raw = new File(["nef"], "a.NEF", { type: "" });
    const picked = await pickLoupeImage(
      sources({
        live: () => raw,
        reconnected: async () => raw,
        preview: async () => jpeg("preview"),
      }),
    );
    expect(picked!.kind).toBe("preview");
    const afterRevoke = await pickLoupeImage(
      sources({
        reconnected: async () => {
          throw new Error("revoked");
        },
        preview: async () => {
          throw new Error("storage gone");
        },
        thumbnail: async () => jpeg("thumb"),
      }),
    );
    expect(afterRevoke!.kind).toBe("thumbnail");
    // An empty stored blob is no picture.
    expect(await pickLoupeImage(sources({ preview: async () => new Blob([]) }))).toBeNull();
  });
});

describe("decoded loupe cache", () => {
  test("holds a few frames, releases what it evicts, and decodes each once", async () => {
    const released: string[] = [];
    let decodes = 0;
    const cache = new DecodedLru<string>(2, (value) => released.push(value));
    const decode = (value: string) => async () => {
      decodes += 1;
      return value;
    };
    const [a, again] = await Promise.all([
      cache.get("a", decode("A")),
      cache.get("a", decode("A")),
    ]);
    expect([a, again, decodes]).toEqual(["A", "A", 1]);
    await cache.get("b", decode("B"));
    await cache.get("a", decode("A")); // a is now the most recent
    await cache.get("c", decode("C"));
    expect(released).toEqual(["B"]);
    expect(cache.has("a") && cache.has("c") && !cache.has("b")).toBe(true);
    cache.clear();
    expect(released.sort()).toEqual(["A", "B", "C"]);
  });

  test("a decode that finishes after its entry was evicted is released, not leaked", async () => {
    const released: string[] = [];
    const cache = new DecodedLru<string>(1, (value) => released.push(value));
    let finish!: (value: string) => void;
    const slow = cache.get("slow", () => new Promise((resolve) => (finish = resolve)));
    await cache.get("fast", async () => "FAST");
    finish("SLOW");
    expect(await slow).toBeNull();
    expect(released).toEqual(["SLOW"]);
    // A failed decode is not cached.
    expect(await cache.get("bad", async () => Promise.reject(new Error("corrupt")))).toBeNull();
    expect(cache.has("bad")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The controller, end to end, with the browser's file APIs faked.

function settle(controller: CullController): Promise<CullSnapshot> {
  return new Promise((resolve) => {
    const stop = controller.subscribe((snapshot) =>
      queueMicrotask(() => {
        stop();
        resolve(snapshot);
      }),
    );
  });
}

async function until(check: () => Promise<boolean> | boolean, timeoutMs = 2000) {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function world() {
  const storage = new FakeStorage(1024 * 1024 * 1024);
  const opfs = new FakeOpfsDirectory(storage);
  const idb = await openCullStore("account", new IDBFactory());
  // Real handles survive IndexedDB's structured clone; mock ones carry
  // functions, so this store keeps them in memory instead.
  const roots = new Map<string, CullSourceRoot[]>();
  const store: CullStore = {
    ...idb,
    saveSources: async (sessionId, list) => void roots.set(sessionId, [...list]),
    sources: async (sessionId) => roots.get(sessionId) ?? [],
  };
  const library = new PreviewLibrary({
    scope: "account",
    store,
    root: () => Promise.resolve(opfs),
    storage: storage.api(),
  });
  const encoder: PreviewEncoder = {
    async encode(request) {
      const folder = (await openFolder(opfs, request.folder, true))!;
      const bytes = new TextEncoder().encode(`preview of ${await request.file.text()}`);
      await writeFile(folder, request.name, bytes);
      return { id: 0, kind: "written", bytes: bytes.length, width: 2048, height: 1365 };
    },
    dispose: () => {},
  };
  const queue = new PreviewQueue({
    scope: "account",
    library,
    encoder: () => encoder,
    lock: (_name, task) => task(),
  });
  const card = new MockDirectory("Card", { state: "prompt", onRequest: () => "granted" });
  const files = [card.add("DCIM/IMG_1.jpg", "one", T), card.add("DCIM/IMG_2.jpg", "two", T + 1)];
  const frames = [
    frameFor("Card/DCIM/IMG_1.jpg", "one", T),
    frameFor("Card/DCIM/IMG_2.jpg", "two", T + 1),
  ];
  const session = await store.create("Game");
  await store.append(
    session.id,
    frames.map((frame) => ({ frame, thumbnail: jpeg(`thumb ${frame.name}`) })),
  );
  return { storage, opfs, store, library, queue, card, files, frames, session, roots };
}

describe("controller: the loupe after a reload", () => {
  test("stored handles ask once; after the grant originals show and previews fill in", async () => {
    const w = await world();
    await w.store.saveSources(w.session.id, [w.card]);
    const controller = new CullController(w.store, {
      previews: { library: w.library, queue: w.queue },
      canLocate: true,
    });
    await controller.open(w.session.id);
    expect((await settle(controller)).originals).toBe("reconnect");
    const [first] = w.frames;
    // Before the grant: the thumbnail, never a guess.
    expect((await controller.loupeImage(first!.id))!.kind).toBe("thumbnail");

    expect(await controller.reconnect()).toBe("connected");
    const image = (await controller.loupeImage(first!.id))!;
    expect(image.kind).toBe("reconnected");
    expect(await image.blob.text()).toBe("one");

    // Previews resume for every frame once the originals are reachable.
    await until(async () => (await w.library.covered(w.session.id)).size === 2);

    // Access revoked in site settings: the loupe drops to the stored preview
    // and offers the reconnect again.
    w.card.permission.state = "prompt";
    const fallback = (await controller.loupeImage(first!.id))!;
    expect(fallback.kind).toBe("preview");
    expect(await fallback.blob.text()).toBe("preview of one");
    await until(() => controller.snapshot().originals === "reconnect");
    controller.dispose();
  });

  test("a changed file on disk is never shown as the frame", async () => {
    const w = await world();
    w.card.permission.state = "granted";
    await w.store.saveSources(w.session.id, [w.card]);
    w.files[0]!.content = "one, re-exported";
    const controller = new CullController(w.store);
    await controller.open(w.session.id);
    expect((await settle(controller)).originals).toBe("connected");
    expect((await controller.loupeImage(w.frames[0]!.id))!.kind).toBe("thumbnail");
    expect((await controller.loupeImage(w.frames[1]!.id))!.kind).toBe("reconnected");
    controller.dispose();
  });

  test("a denied prompt is taken as the answer", async () => {
    const w = await world();
    w.card.permission.onRequest = () => "denied";
    await w.store.saveSources(w.session.id, [w.card]);
    const controller = new CullController(w.store, { canLocate: true });
    await controller.open(w.session.id);
    expect(await controller.reconnect()).toBe("unavailable");
    controller.dispose();
  });

  test("a session imported without handles can be located, but only by its own files", async () => {
    const w = await world();
    const controller = new CullController(w.store, {
      previews: { library: w.library, queue: w.queue },
      canLocate: true,
    });
    await controller.open(w.session.id);
    expect((await settle(controller)).originals).toBe("locate");

    const stranger = new MockDirectory("Other card");
    stranger.add("DCIM/IMG_1.jpg", "someone else's", T);
    expect(await controller.locate([stranger])).toBe(false);
    expect((await settle(controller)).notice).toBe("Those files are not this shoot's originals.");
    expect(w.roots.get(w.session.id)).toBeUndefined();

    w.card.permission.state = "granted";
    expect(await controller.locate([w.card])).toBe(true);
    const snapshot = await settle(controller);
    expect(snapshot.originals).toBe("connected");
    expect(snapshot.notice).toBeNull();
    expect(w.roots.get(w.session.id)).toEqual([w.card]);
    controller.dispose();
  });

  test("deleting a session removes its previews and stored handles with it", async () => {
    const w = await world();
    w.card.permission.state = "granted";
    await w.store.saveSources(w.session.id, [w.card]);
    const controller = new CullController(w.store, {
      previews: { library: w.library, queue: w.queue },
    });
    await controller.open(w.session.id);
    await until(async () => (await w.library.covered(w.session.id)).size === 2);
    expect(w.storage.usage).toBeGreaterThan(0);

    await controller.deleteSession(w.session.id);
    expect(controller.snapshot().sessionId).toBeNull();
    expect(w.opfs.files().size).toBe(0);
    expect(w.storage.usage).toBe(0);
    expect(await w.store.list()).toEqual([]);
    expect(await w.store.previews()).toEqual([]);
    controller.dispose();
  });
});
