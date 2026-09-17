import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";
import {
  acknowledgeStudioSessionRevision,
  loadStudioSession,
  readStudioSessionSnapshot,
  saveStudioSession,
  StudioSaveConflict,
} from "../src/lib/studio/session";
import { studioDatabaseKey } from "../src/lib/studio/shoot-directory";

/**
 * Cull hydrates from one store and writes to this one. The regression: a page
 * that loads a saved shoot without recording the revision it read treats its own
 * first autosave as another tab's change, pauses saving, and then never culls,
 * scores, or re-mints a preview again.
 */

type Record_ = { id: string } & Record<string, unknown>;

function fakeIndexedDB() {
  const databases = new Map<string, Map<string, Map<string, Record_>>>();
  const settle = <T>(
    request: { result?: T; onsuccess?: unknown; onerror?: unknown },
    result: T,
  ) => {
    request.result = result;
    queueMicrotask(() => (request.onsuccess as (() => void) | undefined)?.());
    return request;
  };
  function store(records: Map<string, Record_>, pending: Promise<unknown>[]) {
    return {
      get(key: string) {
        const request: Record<string, unknown> = {};
        pending.push(Promise.resolve().then(() => settle(request, records.get(key))));
        return request;
      },
      getAllKeys() {
        const request: Record<string, unknown> = {};
        pending.push(Promise.resolve().then(() => settle(request, [...records.keys()])));
        return request;
      },
      put(value: Record_) {
        records.set(value.id, value);
      },
      delete(key: string) {
        records.delete(key);
      },
    };
  }
  return {
    open(name: string, _version?: number) {
      const request: Record<string, unknown> = {};
      const stores = databases.get(name) ?? databases.set(name, new Map()).get(name)!;
      const database = {
        objectStoreNames: { contains: (store: string) => stores.has(store) },
        createObjectStore: (store: string) => {
          stores.set(store, new Map());
          return store;
        },
        transaction(names: string | string[], _mode?: string) {
          const pending: Promise<unknown>[] = [];
          let aborted = false;
          const transaction: Record<string, unknown> = {
            objectStore: (name: string) => store(stores.get(name)!, pending),
            abort: () => {
              aborted = true;
              queueMicrotask(() => (transaction["onabort"] as (() => void) | undefined)?.());
            },
          };
          void [names].flat();
          queueMicrotask(async () => {
            await Promise.all(pending);
            await Promise.resolve();
            await Promise.all(pending);
            if (!aborted) (transaction["oncomplete"] as (() => void) | undefined)?.();
          });
          return transaction;
        },
        close: () => {},
      };
      queueMicrotask(() => {
        request["result"] = database;
        if (!stores.size) {
          (request["onupgradeneeded"] as (() => void) | undefined)?.();
        }
        (request["onsuccess"] as (() => void) | undefined)?.();
      });
      return request;
    },
    seed(scope: string, shootId: string, revision: number, shot: Record_) {
      const name = studioDatabaseKey(scope, shootId);
      const stores = databases.get(name) ?? databases.set(name, new Map()).get(name)!;
      stores.set(
        "sessions",
        new Map([
          [
            "active",
            {
              id: "active",
              shotIds: [shot.id],
              selectedId: shot.id,
              filter: "all",
              updatedAt: Date.now(),
              revision,
            } as Record_,
          ],
        ]),
      );
      stores.set("shots", new Map([[shot.id, shot]]));
    },
    revision(scope: string, shootId: string) {
      const stores = databases.get(studioDatabaseKey(scope, shootId));
      return stores?.get("sessions")?.get("active")?.["revision"] as number | undefined;
    },
  };
}

const storage = fakeIndexedDB();
const previous = Reflect.get(globalThis, "indexedDB") as unknown;

beforeAll(() => {
  Reflect.set(globalThis, "indexedDB", storage);
});
afterAll(() => {
  if (previous === undefined) Reflect.deleteProperty(globalThis, "indexedDB");
  else Reflect.set(globalThis, "indexedDB", previous);
});

const SNAPSHOT_SHOOT = "11111111-2222-4333-8444-555555555551";
const ACKNOWLEDGED_SHOOT = "11111111-2222-4333-8444-555555555552";
const OWNED_SHOOT = "11111111-2222-4333-8444-555555555553";

const bytes = new Blob([new Uint8Array(64).fill(7)], { type: "image/jpeg" });

function storedShot(id: string): Record_ {
  return {
    id,
    name: `${id}.jpg`,
    isRaw: false,
    width: 4000,
    height: 3000,
    sizeMb: 1,
    sharpness: 200,
    brightness: 120,
    clippedHighlights: 0,
    clippedShadows: 0,
    hash: "1".repeat(64),
    score: 80,
    flags: [],
    verdict: "undecided",
    edits: { ...DEFAULT_EDITS },
    sourceAvailable: false,
    previewBlob: bytes,
  };
}

function liveShot(id: string): Shot {
  return {
    ...(storedShot(id) as unknown as Shot),
    file: new File([bytes], `${id}.jpg`, { type: "image/jpeg" }),
    previewBlob: bytes,
    previewUrl: null,
  };
}

describe("Studio session revision acknowledgement", () => {
  test("a snapshot read leaves the writer unable to save its own shoot", async () => {
    storage.seed("device-local", SNAPSHOT_SHOOT, 5, storedShot("frame-a"));

    expect(await readStudioSessionSnapshot("device-local", SNAPSHOT_SHOOT)).not.toBeNull();

    await expect(
      saveStudioSession(
        [liveShot("frame-a")],
        "frame-a",
        "keepers",
        "device-local",
        SNAPSHOT_SHOOT,
      ),
    ).rejects.toBeInstanceOf(StudioSaveConflict);
    expect(storage.revision("device-local", SNAPSHOT_SHOOT)).toBe(5);
  });

  test("acknowledging the loaded revision keeps the next save writable", async () => {
    storage.seed("device-local", ACKNOWLEDGED_SHOOT, 5, storedShot("frame-b"));

    expect(await readStudioSessionSnapshot("device-local", ACKNOWLEDGED_SHOOT)).not.toBeNull();
    await acknowledgeStudioSessionRevision("device-local", ACKNOWLEDGED_SHOOT);

    await saveStudioSession(
      [liveShot("frame-b")],
      "frame-b",
      "keepers",
      "device-local",
      ACKNOWLEDGED_SHOOT,
    );
    expect(storage.revision("device-local", ACKNOWLEDGED_SHOOT)).toBe(6);
  });

  test("the owning read hydrates and acknowledges in one pass", async () => {
    storage.seed("device-local", OWNED_SHOOT, 5, storedShot("frame-c"));

    const session = await loadStudioSession("device-local", OWNED_SHOOT);
    expect(session?.shots).toHaveLength(1);

    await saveStudioSession(
      [liveShot("frame-c")],
      "frame-c",
      "keepers",
      "device-local",
      OWNED_SHOOT,
    );
    expect(storage.revision("device-local", OWNED_SHOOT)).toBe(6);
  });
});

describe("Cull hydration acknowledges what it loaded", () => {
  const source = readFileSync(resolve(import.meta.dir, "../src/routes/studio.tsx"), "utf8");

  test("Cull never hydrates through the non-owning snapshot read", () => {
    expect(source).not.toMatch(/readStudioSessionSnapshot\(/);
    expect(source).toMatch(/loadStudioSession\(storageScope, shootId\)/);
    expect(source).toMatch(/acknowledgeStudioSessionRevision\(storageScope, shootId\)/);
  });
});
