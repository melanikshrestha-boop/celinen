import { describe, expect, test } from "bun:test";
import { emptyOutbound, type OutboundWorkspace } from "../src/lib/outbound/model";
import {
  createOutboundStore,
  OUTBOUND_CHANGED,
  OUTBOUND_DATABASE_NAME,
  OUTBOUND_STORE_NAME,
  OutboundSaveConflict,
  validateOutboundRecord,
  validateOutboundScope,
  type OutboundRecord,
} from "../src/lib/outbound/storage";

/** Minimal asynchronous request/transaction double. Real browser CAS is tested separately.
 * Serializes transactions and applies pending writes only on completion, not on put(). */
function databaseDouble(options: { failGet?: boolean; failPut?: boolean } = {}) {
  const rows = new Map<string, unknown>();
  const log: string[] = [];
  let tail = Promise.resolve();
  let closes = 0;
  const database = {
    objectStoreNames: { contains: (name: string) => name === OUTBOUND_STORE_NAME },
    close: () => closes++,
    transaction: (name: string, mode: string) => {
      expect(name).toBe(OUTBOUND_STORE_NAME);
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => (release = resolve));
      let ready = false;
      let finished = false;
      let job: (() => void) | null = null;
      const pending = new Map<string, unknown>();
      const transaction = {
        oncomplete: null as (() => void) | null,
        onabort: null as (() => void) | null,
        onerror: null as (() => void) | null,
        abort: () => {
          if (finished) throw new Error("Transaction is already finished");
          finished = true;
          queueMicrotask(() => {
            log.push("abort");
            transaction.onabort?.();
            release();
          });
        },
        objectStore: () => ({
          get: (scope: string) => {
            const request = {
              result: undefined as unknown,
              onsuccess: null as (() => void) | null,
            };
            job = () => {
              if (options.failGet) {
                transaction.onerror?.();
                transaction.abort();
                return;
              }
              request.result = structuredClone(rows.get(scope));
              request.onsuccess?.();
              queueMicrotask(() => {
                if (finished) return;
                for (const [key, value] of pending) rows.set(key, value);
                finished = true;
                log.push("complete");
                transaction.oncomplete?.();
                release();
              });
            };
            if (ready) queueMicrotask(job);
            return request;
          },
          put: (record: OutboundRecord) => {
            expect(mode).toBe("readwrite");
            log.push("put");
            if (options.failPut) throw new DOMException("Full", "QuotaExceededError");
            pending.set(record.scope, structuredClone(record));
          },
        }),
      };
      void previous.then(() => {
        ready = true;
        if (job) queueMicrotask(job);
      });
      return transaction;
    },
  };
  const factory = {
    open: (name: string, version: number) => {
      expect(name).toBe(OUTBOUND_DATABASE_NAME);
      expect(version).toBe(1);
      const request = { result: database, onsuccess: null as (() => void) | null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  } as unknown as IDBFactory;
  const events = new EventTarget();
  const store = createOutboundStore({ factory, eventTarget: events, channelFactory: () => null });
  return { rows, log, factory, store, events, closeCount: () => closes };
}

const rename = (name: string) => (workspace: OutboundWorkspace) => ({
  ...workspace,
  campaign: { ...workspace.campaign, senderName: name },
});

describe("Outbound account-scoped local persistence", () => {
  test("rejects absent, normalized, blank, oversized and control-character scopes", () => {
    for (const scope of [
      null,
      undefined,
      0,
      "",
      " ",
      " user",
      "user ",
      "a\nb",
      "a\0b",
      "a\u0080b",
      "a".repeat(513),
    ])
      expect(() => validateOutboundScope(scope)).toThrow("account scope");
    for (const scope of [
      "550e8400-e29b-41d4-a716-446655440000",
      "qa-outbound:reserved-007",
      "__proto__",
    ])
      expect(validateOutboundScope(scope)).toBe(scope);
  });

  test("validates exact account, saved schema and revision without aliasing caller data", () => {
    const record = { scope: "one", revision: 0, workspace: emptyOutbound() };
    const validated = validateOutboundRecord(record, "one");
    validated.workspace.campaign.senderName = "Changed";
    expect(record.workspace.campaign.senderName).not.toBe("Changed");
    for (const bad of [
      null,
      {},
      { ...record, scope: "two" },
      { ...record, revision: -1 },
      { ...record, revision: 0.5 },
      { ...record, revision: Number.MAX_SAFE_INTEGER },
      { ...record, extra: true },
      { ...record, workspace: { ...record.workspace, version: 2 } },
    ])
      expect(() => validateOutboundRecord(bad, "one")).toThrow("not been replaced");
  });

  test("missing account is a fresh, unwritten revision-zero workspace", async () => {
    const { store, rows, log, closeCount } = databaseDouble();
    const first = await store.read("one");
    expect(first).toEqual({ scope: "one", revision: 0, workspace: emptyOutbound() });
    expect(rows.size).toBe(0);
    expect(log).toEqual(["complete"]);
    expect(closeCount()).toBe(1);
  });

  test("saves only the exact account and returns detached records", async () => {
    const { store, rows } = databaseDouble();
    const saved = await store.update("one", 0, rename("Founder"));
    expect(saved.revision).toBe(1);
    expect((await store.read("two")).revision).toBe(0);
    expect(rows.size).toBe(1);
    saved.workspace.campaign.senderName = "Mutated after save";
    const reloaded = await store.read("one");
    expect(reloaded.workspace.campaign.senderName).toBe("Founder");
    reloaded.workspace.campaign.senderName = "Mutated after read";
    expect((await store.read("one")).workspace.campaign.senderName).toBe("Founder");
  });

  test("competing stores permit exactly one writer for a shared expected revision", async () => {
    const { store, factory, rows } = databaseDouble();
    const second = createOutboundStore({ factory, channelFactory: () => null });
    const results = await Promise.allSettled([
      store.update("one", 0, rename("First")),
      second.update("one", 0, rename("Second")),
    ]);
    expect(results[0]!.status).toBe("fulfilled");
    expect(results[1]!.status).toBe("rejected");
    const rejected = results[1] as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(OutboundSaveConflict);
    expect(rejected.reason.currentRevision).toBe(1);
    expect((rows.get("one") as OutboundRecord).workspace.campaign.senderName).toBe("First");
    expect((await second.update("one", 1, rename("Third"))).revision).toBe(2);
  });

  test("invalid revisions and scopes fail before calling transform or opening storage", async () => {
    const { store, log } = databaseDouble();
    let called = false;
    const transform = (workspace: OutboundWorkspace) => {
      called = true;
      return workspace;
    };
    await expect(store.update("one", -1, transform)).rejects.toThrow("valid saved revision");
    await expect(store.update("one", Number.NaN, transform)).rejects.toThrow(
      "valid saved revision",
    );
    await expect(store.update("", 0, transform)).rejects.toThrow("account scope");
    expect(called).toBe(false);
    expect(log).toHaveLength(0);
  });

  test("throwing, invalid or asynchronous transforms abort without overwrites", async () => {
    const { store, rows } = databaseDouble();
    await store.update("one", 0, rename("Kept"));
    const before = structuredClone(rows.get("one"));
    await expect(
      store.update("one", 1, (workspace) => {
        workspace.campaign.senderName = "Unsafe";
        throw new Error("Rejected transition");
      }),
    ).rejects.toThrow("Rejected transition");
    await expect(
      store.update("one", 1, () => ({ version: 9000 }) as unknown as OutboundWorkspace),
    ).rejects.toThrow();
    await expect(
      store.update(
        "one",
        1,
        (async (workspace: OutboundWorkspace) => workspace) as unknown as (
          workspace: OutboundWorkspace,
        ) => OutboundWorkspace,
      ),
    ).rejects.toThrow();
    expect(rows.get("one")).toEqual(before);
  });

  test("corrupt saved data is never treated as a missing record", async () => {
    const { store, rows } = databaseDouble();
    for (const value of [
      null,
      { scope: "other", revision: 1, workspace: emptyOutbound() },
      { scope: "one", revision: 1, workspace: { broken: true } },
    ]) {
      rows.set("one", value);
      await expect(store.read("one")).rejects.toThrow("not been replaced");
      await expect(store.update("one", 0, rename("Replacement"))).rejects.toThrow(
        "not been replaced",
      );
      expect(rows.get("one")).toEqual(value);
    }
  });

  test("failed writes and failed reads reject, close transactions and preserve prior state", async () => {
    const writes = databaseDouble({ failPut: true });
    const before = { scope: "one", revision: 1, workspace: emptyOutbound() };
    writes.rows.set("one", before);
    await expect(writes.store.update("one", 1, rename("Unsaved"))).rejects.toThrow("Full");
    expect(writes.rows.get("one")).toEqual(before);
    expect(writes.closeCount()).toBe(1);
    const reads = databaseDouble({ failGet: true });
    await expect(reads.store.read("one")).rejects.toThrow("storage failed");
    expect(reads.closeCount()).toBe(1);
  });

  test("open failures do not return an empty workspace", async () => {
    const factory = {
      open: () => {
        throw new Error("Browser policy");
      },
    } as unknown as IDBFactory;
    const store = createOutboundStore({ factory, channelFactory: () => null });
    await expect(store.read("one")).rejects.toThrow("unavailable");
    await expect(store.update("one", 0, rename("No save"))).rejects.toThrow("unavailable");
  });

  test("revision overflow fails closed", async () => {
    const { rows, store } = databaseDouble();
    const record = {
      scope: "one",
      revision: Number.MAX_SAFE_INTEGER - 1,
      workspace: emptyOutbound(),
    };
    rows.set("one", record);
    await expect(store.update("one", record.revision, rename("No save"))).rejects.toThrow(
      "capacity",
    );
    expect(rows.get("one")).toEqual(record);
  });

  test("same-window notifications are scoped, validated and sent only after commit", async () => {
    const { store, rows, events, log } = databaseDouble();
    const revisions: number[] = [];
    const unsubscribe = store.subscribe("one", (change) => {
      expect(log.at(-1)).toBe("complete");
      expect((rows.get("one") as OutboundRecord).revision).toBe(change.revision);
      revisions.push(change.revision);
    });
    await store.read("one");
    await store.update("two", 0, rename("Other"));
    await store.update("one", 0, rename("One"));
    await expect(store.update("one", 0, rename("Stale"))).rejects.toBeInstanceOf(
      OutboundSaveConflict,
    );
    for (const detail of [
      null,
      { scope: "one", revision: -1 },
      { scope: "two", revision: 2 },
      { scope: "one", revision: 1, workspace: {} },
    ])
      events.dispatchEvent(new CustomEvent(OUTBOUND_CHANGED, { detail }));
    expect(revisions).toEqual([1]);
    unsubscribe();
    await store.update("one", 1, rename("No listener"));
    expect(revisions).toEqual([1]);
  });

  test("notification failure cannot misreport a committed save as failed", async () => {
    const { factory, rows } = databaseDouble();
    const brokenChannel = {
      postMessage: () => {
        throw new Error("Post failed");
      },
      close: () => {
        throw new Error("Close failed");
      },
    } as unknown as BroadcastChannel;
    const store = createOutboundStore({ factory, channelFactory: () => brokenChannel });
    const result = await store.update("one", 0, rename("Saved"));
    expect(result.revision).toBe(1);
    expect((rows.get("one") as OutboundRecord).workspace.campaign.senderName).toBe("Saved");
  });
});
