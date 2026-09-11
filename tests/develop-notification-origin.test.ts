/** Isolated runtime tests: no network, browser, credentials, or real IndexedDB. */
import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cases = [
  "module import and store creation never request randomness; committed notifications share one origin",
  "hot replacement retains notification identity and same-window observers without duplicate echoes",
  "hot replacement before the first save shares a lazy identity with surviving stores",
] as const;

if (!process.argv.includes("--notification-origin-fixture")) {
  describe("Develop notification origin", () => {
    for (const [index, name] of cases.entries()) {
      test(name, () => {
        const result = Bun.spawnSync(
          [
            process.execPath,
            fileURLToPath(import.meta.url),
            "--notification-origin-fixture",
            String(index),
          ],
          { stdout: "pipe", stderr: "pipe" },
        );
        expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
        expect(new TextDecoder().decode(result.stdout)).toContain("NOTIFICATION_ORIGIN_OK");
      });
    }
  });
} else {
  await runFixture(Number(process.argv.at(-1)));
}

async function runFixture(scenario: number) {
  globalThis.fetch = (() => {
    throw new Error("Unexpected network access");
  }) as typeof fetch;
  let allowRandom = false;
  let randomCalls = 0;
  const origin = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    value: () => {
      assert.ok(allowRandom, "randomUUID is forbidden during module initialization");
      randomCalls++;
      return randomCalls === 1 ? origin : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    },
  });
  type Message = { namespace: string; kind: string; ids: string[]; origin: string };
  const messages: Message[] = [];
  class Channel {
    static active = new Set<Channel>();
    onmessage: ((event: { data: Message }) => void) | null = null;
    constructor(readonly name: string) {
      Channel.active.add(this);
    }
    postMessage(data: Message) {
      messages.push(data);
      for (const receiver of Channel.active)
        if (receiver !== this && receiver.name === this.name) receiver.onmessage?.({ data });
    }
    close() {
      Channel.active.delete(this);
    }
  }
  globalThis.BroadcastChannel = Channel as unknown as typeof BroadcastChannel;
  // Import the actual, untransformed module with the Workers-style random guard active.
  const actual = await import("../src/lib/develop/store");
  assert.equal(randomCalls, 0);
  const factory = memoryFactory();
  const options = { scope: "notification-qa", libraryId: "same-shoot", factory };
  const events: string[][] = [[], [], []];
  const listen = (index: number) => (change: { ids: string[] }) =>
    events[index].push(...change.ids);
  const job: import("../src/lib/develop/store").DevelopImportJob = {
    version: 1,
    revision: 0,
    id: "qa-import",
    phase: "discovering",
    startedAt: 1,
    finishedAt: null,
    rows: [],
    found: 0,
    previewReady: 0,
    analyzed: 0,
    saved: 0,
    failed: 0,
    duplicates: 0,
    error: null,
  };
  if (scenario === 0) {
    const a = actual.createDevelopStore(options);
    const b = actual.createDevelopStore(options);
    const other = actual.createDevelopStore({ ...options, libraryId: "different-shoot" });
    a.subscribe(listen(0));
    b.subscribe(listen(1));
    other.subscribe(listen(2));
    await a.saveDocuments([]);
    await a.readPhotosWithDocuments([]);
    assert.equal(randomCalls, 0, "construction, subscription and empty operations are lazy");
    allowRandom = true;
    const saved = await a.saveImportJob(job, 0);
    assert.equal(saved.revision, 1);
    assert.deepEqual(events, [[job.id], [job.id], []], "same-window callbacks fire exactly once");
    await b.saveImportJob({ ...saved, phase: "processing" }, saved.revision);
    assert.equal(randomCalls, 1, "all stores reuse one notification origin");
    assert.deepEqual(
      messages.map((message) => message.origin),
      [origin, origin],
    );
    assert.deepEqual(
      events,
      [[job.id, job.id], [job.id, job.id], []],
      "channel echoes are ignored",
    );
    const remote = new Channel("foto-develop:notification-qa");
    remote.postMessage({
      namespace: a.namespace,
      kind: "documents",
      ids: ["remote-photo"],
      origin: "remote-window",
    });
    assert.deepEqual(events, [
      [job.id, job.id, "remote-photo"],
      [job.id, job.id, "remote-photo"],
      [],
    ]);
    remote.postMessage({ namespace: a.namespace, kind: "documents", ids: ["self-echo"], origin });
    assert.equal(events[0].length, 3);
    assert.equal(randomCalls, 1);
    a.close();
    b.close();
    other.close();
    remote.close();
  } else {
    // The real source is evaluated twice; only import bindings and Vite's hot runtime
    // are injected. This simulates module disposal without mocking store behavior.
    const bindings = Object.assign(
      {},
      { z: (await import("zod")).z },
      await import("../src/lib/imaging"),
      await import("../src/lib/studio/ingest"),
      await import("../src/lib/photo-identity"),
      await import("../src/lib/develop/photo-management"),
      await import("../src/lib/develop/preset-package"),
      await import("../src/lib/develop/contract"),
    );
    const source = readFileSync(new URL("../src/lib/develop/store.ts", import.meta.url), "utf8");
    const compiled = new Bun.Transpiler({ loader: "ts", target: "browser" })
      .transformSync(source.replace(/import\.meta\.hot/g, "hot"))
      .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "")
      .replace(/^export\s+(?=(?:async\s+)?function|const|class)/gm, "");
    const bindingNames = Object.keys(bindings).filter((name) => name !== "default");
    const evaluate = new Function(
      "hot",
      ...bindingNames,
      `${compiled}\nreturn { createDevelopStore };`,
    );
    const data: Record<string, unknown> = {};
    let dispose: ((data: Record<string, unknown>) => void) | undefined;
    const hot = {
      data,
      dispose(callback: typeof dispose) {
        dispose = callback;
      },
    };
    const load = () =>
      evaluate(hot, ...bindingNames.map((name) => bindings[name])) as Pick<
        typeof actual,
        "createDevelopStore"
      >;
    const cold = load();
    assert.equal(randomCalls, 0);
    dispose!(data);
    assert.equal(randomCalls, 0, "disposing an unused hot module remains lazy");
    const first = load();
    assert.notEqual(first.createDevelopStore, cold.createDevelopStore);
    const a = first.createDevelopStore(options);
    a.subscribe(listen(0));
    assert.equal(randomCalls, 0);
    if (scenario === 2) {
      dispose!(data);
      const second = load();
      const b = second.createDevelopStore(options);
      b.subscribe(listen(1));
      assert.equal(randomCalls, 0);
      allowRandom = true;
      const saved = await a.saveImportJob(job, 0);
      await b.saveImportJob({ ...saved, phase: "processing" }, saved.revision);
      assert.equal(randomCalls, 1, "old and new modules must share the still-lazy origin");
      assert.deepEqual(events, [[job.id, job.id], [job.id, job.id], []]);
      a.close();
      b.close();
      assert.equal(Channel.active.size, 0);
      console.log("NOTIFICATION_ORIGIN_OK");
      return;
    }
    allowRandom = true;
    const saved = await a.saveImportJob(job, 0);
    dispose!(data);
    assert.equal(randomCalls, 1, "disposing a used hot module retains its identity");
    const second = load();
    const b = second.createDevelopStore(options);
    b.subscribe(listen(1));
    await b.saveImportJob({ ...saved, phase: "processing" }, saved.revision);
    assert.equal(randomCalls, 1, "hot replacement reuses the original window identity");
    assert.deepEqual(
      events,
      [[job.id, job.id], [job.id], []],
      "retained observers do not receive channel duplicates",
    );
    assert.deepEqual(
      messages.map((message) => message.origin),
      [origin, origin],
    );
    a.close();
    b.close();
  }
  assert.equal(Channel.active.size, 0);
  console.log("NOTIFICATION_ORIGIN_OK");
}

/** Only the request/transaction behavior used by saveImportJob; all records remain in RAM. */
function memoryFactory(): IDBFactory {
  const records = new Map<string, unknown>();
  const success = (result: unknown) => {
    const request = { result, onsuccess: null as (() => void) | null };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  };
  const database = {
    close() {},
    transaction() {
      const transaction = {
        oncomplete: null as (() => void) | null,
        objectStore() {
          return {
            get: (key: string) => success(records.get(key)),
            put(record: { key: string }) {
              records.set(record.key, record);
            },
          };
        },
      };
      setTimeout(() => transaction.oncomplete?.(), 0);
      return transaction;
    },
  };
  return { open: () => success(database) } as unknown as IDBFactory;
}
