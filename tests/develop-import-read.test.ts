import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { DEVELOP_ENGINE_LIMITS } from "../src/lib/develop/contract";
import { runDevelopImport } from "../src/lib/develop/import";
import { developPhotoFromFile, type DevelopPhotoInput } from "../src/lib/develop/store";

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Test deadline only. Production must cancel FileReader, not race a read/hash.
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Operation did not settle after cancellation")),
          150,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function assertAbort(outcome: Outcome<unknown>) {
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect((outcome.error as Error).name).toBe("AbortError");
}

/** These tests are serial; every global descriptor, pending operation and listener
 * is restored in finally. No browser database, native service or source disk is used. */
async function readers(body: (f: ReturnType<typeof makeReaders>) => Promise<void>) {
  const f = makeReaders();
  try {
    await body(f);
  } finally {
    await f.close();
  }
}
function makeReaders() {
  const previousReader = Object.getOwnPropertyDescriptor(globalThis, "FileReader");
  const previousDigest = Object.getOwnPropertyDescriptor(crypto.subtle, "digest");
  const actualDigest = crypto.subtle.digest.bind(crypto.subtle);
  const instances: Reader[] = [];
  const events: string[] = [];
  const digestCalls: number[] = [];
  const releases: (() => void)[] = [];
  const tracked: Promise<unknown>[] = [];
  const signals: {
    signal: AbortSignal;
    add?: PropertyDescriptor;
    remove?: PropertyDescriptor;
    added: EventListenerOrEventListenerObject[];
    removed: EventListenerOrEventListenerObject[];
  }[] = [];
  let readHook: ((reader: Reader, blob: Blob) => void) | null = null;
  let digestHook: ((data: BufferSource) => Promise<ArrayBuffer>) | null = null;
  class Reader extends EventTarget {
    static readonly EMPTY = 0;
    static readonly LOADING = 1;
    static readonly DONE = 2;
    readonly EMPTY = 0;
    readonly LOADING = 1;
    readonly DONE = 2;
    readyState = 0;
    result: string | ArrayBuffer | null = null;
    error: DOMException | null = null;
    source: Blob | null = null;
    abortCalls = 0;
    onload: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onabort: ((event: Event) => void) | null = null;
    onloadend: ((event: Event) => void) | null = null;
    active = new Map<string, Set<EventListenerOrEventListenerObject>>();
    constructor() {
      super();
      instances.push(this);
    }
    override addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (listener) {
        const set = this.active.get(type) ?? new Set();
        set.add(listener);
        this.active.set(type, set);
      }
      super.addEventListener(type, listener, options);
    }
    override removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) {
      if (listener) this.active.get(type)?.delete(listener);
      super.removeEventListener(type, listener, options);
    }
    readAsArrayBuffer(blob: Blob) {
      this.source = blob;
      this.readyState = 1;
      events.push("reader:read");
      readHook?.(this, blob);
    }
    emit(type: "load" | "error" | "abort" | "loadend") {
      const event = new Event(type);
      this.dispatchEvent(event);
      this[`on${type}`]?.(event);
    }
    succeed(result: string | ArrayBuffer | null) {
      this.readyState = 2;
      this.result = result;
      this.emit("load");
      this.emit("loadend");
    }
    fail() {
      this.readyState = 2;
      this.error = new DOMException("The selected source cannot be read", "NotReadableError");
      this.emit("error");
      this.emit("loadend");
    }
    abort() {
      this.abortCalls++;
      events.push("reader:abort");
      const wasLoading = this.readyState === 1;
      this.readyState = 2;
      this.result = null;
      if (wasLoading) {
        this.emit("abort");
        this.emit("loadend");
      }
    }
  }
  Object.defineProperty(globalThis, "FileReader", {
    configurable: true,
    writable: true,
    value: Reader,
  });
  Object.defineProperty(crypto.subtle, "digest", {
    configurable: true,
    writable: true,
    value: (algorithm: AlgorithmIdentifier, data: BufferSource) => {
      expect(algorithm).toBe("SHA-256");
      digestCalls.push(data.byteLength);
      return digestHook ? digestHook(data) : actualDigest(algorithm, data);
    },
  });
  function signal() {
    const controller = new AbortController();
    const value = controller.signal;
    const add = value.addEventListener.bind(value),
      remove = value.removeEventListener.bind(value);
    const entry = {
      signal: value,
      add: Object.getOwnPropertyDescriptor(value, "addEventListener"),
      remove: Object.getOwnPropertyDescriptor(value, "removeEventListener"),
      added: [] as EventListenerOrEventListenerObject[],
      removed: [] as EventListenerOrEventListenerObject[],
    };
    signals.push(entry);
    Object.defineProperty(value, "addEventListener", {
      configurable: true,
      value: (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) => {
        if (type === "abort") entry.added.push(listener);
        add(type, listener, options);
      },
    });
    Object.defineProperty(value, "removeEventListener", {
      configurable: true,
      value: (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions,
      ) => {
        if (type === "abort") entry.removed.push(listener);
        remove(type, listener, options);
      },
    });
    return controller;
  }
  function source(name = "source.jpg", text = "exact original bytes", delayed = false) {
    const bytes = new TextEncoder().encode(text).buffer;
    const file = new File([bytes], name, { type: "image/jpeg", lastModified: 173 });
    const gate = deferred<ArrayBuffer>();
    releases.push(() => gate.resolve(bytes));
    let reads = 0;
    Object.defineProperty(file, "arrayBuffer", {
      configurable: true,
      value: () => {
        reads++;
        events.push("blob:read");
        return delayed ? gate.promise : Promise.resolve(bytes);
      },
    });
    return {
      file,
      bytes,
      gate,
      reads: () => reads,
      hash: `sha256:${createHash("sha256").update(new Uint8Array(bytes)).digest("hex")}`,
    };
  }
  function track<T>(promise: Promise<T>) {
    let settled = false;
    const outcome = promise.then<Outcome<T>, Outcome<T>>(
      (value) => {
        settled = true;
        events.push("settled");
        return { ok: true, value };
      },
      (error) => {
        settled = true;
        events.push("settled");
        return { ok: false, error };
      },
    );
    tracked.push(outcome);
    return { outcome, settled: () => settled };
  }
  function clean() {
    for (const reader of instances) {
      expect(reader.onload).toBeNull();
      expect(reader.onerror).toBeNull();
      expect(reader.onabort).toBeNull();
      expect(reader.onloadend).toBeNull();
      expect([...reader.active.values()].every((set) => set.size === 0)).toBe(true);
    }
    for (const entry of signals) {
      for (const listener of entry.added) expect(entry.removed).toContain(listener);
    }
  }
  return {
    instances,
    events,
    digestCalls,
    source,
    signal,
    track,
    clean,
    onRead(hook: typeof readHook) {
      readHook = hook;
    },
    onDigest(hook: typeof digestHook) {
      digestHook = hook;
    },
    actualDigest,
    releaseLater(release: () => void) {
      releases.push(release);
    },
    withoutReader() {
      Reflect.deleteProperty(globalThis, "FileReader");
    },
    async close() {
      for (const release of releases) release();
      for (const reader of instances) if (reader.readyState === 1) reader.abort();
      try {
        await bounded(Promise.all(tracked));
      } finally {
        if (previousReader) Object.defineProperty(globalThis, "FileReader", previousReader);
        else Reflect.deleteProperty(globalThis, "FileReader");
        if (previousDigest) Object.defineProperty(crypto.subtle, "digest", previousDigest);
        else Reflect.deleteProperty(crypto.subtle, "digest");
        for (const entry of signals) {
          if (entry.add) Object.defineProperty(entry.signal, "addEventListener", entry.add);
          else Reflect.deleteProperty(entry.signal, "addEventListener");
          if (entry.remove)
            Object.defineProperty(entry.signal, "removeEventListener", entry.remove);
          else Reflect.deleteProperty(entry.signal, "removeEventListener");
        }
      }
    },
  };
}

describe("Develop cancellable original fingerprint reads", () => {
  test("empty and oversized sources are rejected before any reader or hash starts", async () => {
    for (const size of [0, DEVELOP_ENGINE_LIMITS.maxFileBytes + 1]) {
      for (const withSignal of [false, true])
        await readers(async (f) => {
          const source = f.source(),
            controller = f.signal();
          // Admission test only; never allocate a 128 MiB fixture to test its size guard.
          Object.defineProperty(source.file, "size", { value: size });
          const outcome = await bounded(
            f.track(
              developPhotoFromFile(
                source.file,
                null,
                undefined,
                withSignal ? controller.signal : undefined,
              ),
            ).outcome,
          );
          expect(outcome.ok).toBe(false);
          expect(source.reads()).toBe(0);
          expect(f.instances).toHaveLength(0);
          expect(f.digestCalls).toHaveLength(0);
          f.clean();
        });
    }
  });

  test("pre-aborted identification performs no read or hash", async () =>
    readers(async (f) => {
      const source = f.source(),
        controller = f.signal();
      controller.abort();
      const pending = f.track(
        developPhotoFromFile(source.file, null, undefined, controller.signal),
      );
      assertAbort(await bounded(pending.outcome));
      expect(source.reads()).toBe(0);
      expect(f.instances).toHaveLength(0);
      expect(f.digestCalls).toHaveLength(0);
      f.clean();
    }));

  test("custom signal reasons including null survive pre-abort and a pending read", async () => {
    for (const reason of [null, "user stopped", new Error("custom stop"), { action: "stop" }]) {
      for (const phase of ["before", "reading"])
        await readers(async (f) => {
          const source = f.source(),
            controller = f.signal();
          if (phase === "before") controller.abort(reason);
          const pending = f.track(
            developPhotoFromFile(source.file, null, undefined, controller.signal),
          );
          if (phase === "reading") {
            await turn();
            controller.abort(reason);
          }
          const outcome = await bounded(pending.outcome);
          expect(outcome.ok).toBe(false);
          if (!outcome.ok) expect(outcome.error).toBe(reason);
          expect(source.reads()).toBe(0);
          expect(f.digestCalls).toHaveLength(0);
          expect(f.instances).toHaveLength(phase === "before" ? 0 : 1);
          if (phase === "reading") expect(f.instances[0]!.abortCalls).toBe(1);
          f.clean();
        });
    }
  });

  test("reader-originated abort stops import even while its signal stays live", async () =>
    readers(async (f) => {
      const source = f.source(),
        controller = f.signal();
      let previews = 0,
        saves = 0;
      const pending = f.track(
        runDevelopImport([source.file], {
          existingIds: [],
          signal: controller.signal,
          preparePreview: async () => {
            previews++;
            throw new Error("Unexpected decode");
          },
          save: async () => {
            saves++;
            throw new Error("Unexpected write");
          },
        }),
      );
      await turn();
      f.instances[0]!.abort();
      const outcome = await bounded(pending.outcome);
      expect(controller.signal.aborted).toBe(false);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.value.stopped).toBe(true);
        expect(outcome.value.imported).toEqual([]);
        expect(outcome.value.failures).toEqual([]);
        expect(outcome.value.fatalError).toBeNull();
      }
      expect(previews).toBe(0);
      expect(saves).toBe(0);
      expect(source.reads()).toBe(0);
      expect(f.digestCalls).toHaveLength(0);
      f.clean();
    }));

  test("reader constructor failure neither falls back nor installs abort listeners", async () =>
    readers(async (f) => {
      const source = f.source(),
        controller = f.signal();
      const failure = new DOMException("Reader unavailable", "SecurityError");
      Object.defineProperty(globalThis, "FileReader", {
        configurable: true,
        value: class {
          constructor() {
            throw failure;
          }
        },
      });
      const outcome = await bounded(
        f.track(developPhotoFromFile(source.file, null, undefined, controller.signal)).outcome,
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error).toBe(failure);
      expect(f.instances).toHaveLength(0);
      expect(source.reads()).toBe(0);
      expect(f.digestCalls).toHaveLength(0);
      f.clean();
    }));

  test("pending browser read is actually aborted before the importer settles", async () =>
    readers(async (f) => {
      const source = f.source("pending.jpg", "not customer data", true),
        controller = f.signal();
      let previews = 0,
        saves = 0;
      const pending = f.track(
        runDevelopImport([source.file], {
          existingIds: [],
          signal: controller.signal,
          preparePreview: async () => {
            previews++;
            throw new Error("Unexpected decode");
          },
          save: async () => {
            saves++;
            throw new Error("Unexpected write");
          },
        }),
      );
      await turn();
      controller.abort();
      const outcome = await bounded(pending.outcome);
      expect(f.events).toContain("reader:abort");
      expect(f.events.indexOf("reader:abort")).toBeLessThan(f.events.indexOf("settled"));
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.value.stopped).toBe(true);
        expect(outcome.value.imported).toEqual([]);
      }
      expect(source.reads()).toBe(0);
      expect(previews).toBe(0);
      expect(saves).toBe(0);
      expect(f.digestCalls).toHaveLength(0);
      f.clean();
    }));

  test("synchronous read success returns exact full SHA and cleans named listeners", async () =>
    readers(async (f) => {
      const source = f.source("same.ARW", "all bytes\0including the end"),
        controller = f.signal();
      f.onRead((reader) => reader.succeed(source.bytes));
      const result = await developPhotoFromFile(
        source.file,
        null,
        { width: 80, height: 60 },
        controller.signal,
      );
      expect(result.id).toBe(source.hash);
      expect(result.sourceDigest).toBe(source.hash);
      expect(result.sourceBlob).toBe(source.file);
      expect(result.sourceFileName).toBe("same.ARW");
      expect(result.width).toBe(80);
      expect(result.height).toBe(60);
      expect(result.isRaw).toBe(true);
      expect(source.reads()).toBe(0);
      expect(f.digestCalls).toEqual([source.bytes.byteLength]);
      controller.abort();
      expect(f.instances[0]!.abortCalls).toBe(0);
      f.clean();
    }));

  test("synchronous signal abort during read start cannot miss cancellation", async () =>
    readers(async (f) => {
      const source = f.source(),
        controller = f.signal();
      f.onRead(() => controller.abort());
      assertAbort(
        await bounded(
          f.track(developPhotoFromFile(source.file, null, undefined, controller.signal)).outcome,
        ),
      );
      expect(f.instances[0]!.abortCalls).toBe(1);
      expect(f.digestCalls).toHaveLength(0);
      f.clean();
    }));

  test("read failure is not retried through Blob.arrayBuffer and later batch files still import", async () =>
    readers(async (f) => {
      const broken = f.source("broken.jpg"),
        good = f.source("good.jpg", "good bytes"),
        controller = f.signal();
      f.onRead((reader, file) =>
        file === broken.file ? reader.fail() : reader.succeed(good.bytes),
      );
      const previewed: string[] = [],
        saved: string[] = [];
      const report = await runDevelopImport([broken.file, good.file], {
        existingIds: [],
        signal: controller.signal,
        preparePreview: async (file, input) => {
          previewed.push(file.name);
          return { ...input, previewBlob: new Blob(["preview"]) };
        },
        save: async (input) => {
          saved.push(input.id);
          return [{ ...input, sourceAvailable: true, createdAt: 1 }];
        },
      });
      expect(report.failures.map((failure) => failure.fileName)).toEqual(["broken.jpg"]);
      expect(report.imported.map((photo) => photo.id)).toEqual([good.hash]);
      expect(previewed).toEqual(["good.jpg"]);
      expect(saved).toEqual([good.hash]);
      expect(broken.reads()).toBe(0);
      expect(good.reads()).toBe(0);
      expect(f.digestCalls).toEqual([good.bytes.byteLength]);
      f.clean();
    }));

  test("invalid or truncated reader results fail before hashing", async () => {
    for (const result of [null, "not an ArrayBuffer", new ArrayBuffer(1)])
      await readers(async (f) => {
        const source = f.source(),
          controller = f.signal();
        f.onRead((reader) => reader.succeed(result));
        const outcome = await bounded(
          f.track(developPhotoFromFile(source.file, null, undefined, controller.signal)).outcome,
        );
        expect(outcome.ok).toBe(false);
        expect(f.digestCalls).toHaveLength(0);
        expect(source.reads()).toBe(0);
        f.clean();
      });
  });

  test("read start throwing removes listeners without fallback or hashing", async () =>
    readers(async (f) => {
      const source = f.source(),
        controller = f.signal();
      f.onRead(() => {
        throw new DOMException("Denied", "SecurityError");
      });
      const outcome = await bounded(
        f.track(developPhotoFromFile(source.file, null, undefined, controller.signal)).outcome,
      );
      expect(outcome.ok).toBe(false);
      expect(source.reads()).toBe(0);
      expect(f.digestCalls).toHaveLength(0);
      f.clean();
    }));

  test("abort after load but before its continuation never starts a digest", async () =>
    readers(async (f) => {
      const source = f.source(),
        controller = f.signal();
      f.onRead((reader) => {
        reader.succeed(source.bytes);
        controller.abort();
      });
      assertAbort(
        await bounded(
          f.track(developPhotoFromFile(source.file, null, undefined, controller.signal)).outcome,
        ),
      );
      expect(f.digestCalls).toHaveLength(0);
      f.clean();
    }));

  test("already-started digest remains owned until settled after Stop", async () =>
    readers(async (f) => {
      const source = f.source(),
        controller = f.signal();
      const hash = deferred<ArrayBuffer>(),
        started = deferred<void>();
      f.releaseLater(() => hash.resolve(new ArrayBuffer(32)));
      f.onRead((reader) => reader.succeed(source.bytes));
      f.onDigest(() => {
        started.resolve();
        return hash.promise;
      });
      const pending = f.track(
        developPhotoFromFile(source.file, null, undefined, controller.signal),
      );
      await bounded(started.promise);
      controller.abort();
      await turn();
      expect(pending.settled()).toBe(false);
      hash.resolve(await f.actualDigest("SHA-256", source.bytes));
      assertAbort(await bounded(pending.outcome));
      expect(f.instances[0]!.abortCalls).toBe(0);
      expect(f.digestCalls).toHaveLength(1);
      f.clean();
    }));

  test("digest rejection after Stop is observed and produces no late import", async () =>
    readers(async (f) => {
      const source = f.source(),
        controller = f.signal(),
        hash = deferred<ArrayBuffer>(),
        started = deferred<void>();
      f.releaseLater(() => hash.resolve(new ArrayBuffer(32)));
      f.onRead((reader) => reader.succeed(source.bytes));
      f.onDigest(() => {
        started.resolve();
        return hash.promise;
      });
      let previewed = 0;
      const pending = f.track(
        runDevelopImport([source.file], {
          existingIds: [],
          signal: controller.signal,
          preparePreview: async () => {
            previewed++;
            throw new Error("Late decode");
          },
          save: async () => {
            throw new Error("Late write");
          },
        }),
      );
      await bounded(started.promise);
      controller.abort();
      await turn();
      expect(pending.settled()).toBe(false);
      hash.reject(new Error("Digest failed late"));
      const outcome = await bounded(pending.outcome);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.value.stopped).toBe(true);
        expect(outcome.value.imported).toEqual([]);
      }
      expect(previewed).toBe(0);
      f.clean();
    }));

  test("without a browser reader fallback waits for its read to drain after Stop", async () =>
    readers(async (f) => {
      f.withoutReader();
      const source = f.source("fallback.jpg", "fallback original", true),
        controller = f.signal();
      const pending = f.track(
        developPhotoFromFile(source.file, null, undefined, controller.signal),
      );
      await turn();
      controller.abort();
      await turn();
      expect(source.reads()).toBe(1);
      expect(pending.settled()).toBe(false);
      source.gate.resolve(source.bytes);
      assertAbort(await bounded(pending.outcome));
      expect(f.digestCalls).toHaveLength(0);
      expect(f.instances).toHaveLength(0);
      f.clean();
    }));

  test("invalid or short fallback results are rejected before hashing in both fallback modes", async () => {
    for (const result of [null, "not an ArrayBuffer", new ArrayBuffer(1)]) {
      for (const mode of ["no-signal", "reader-absent"])
        await readers(async (f) => {
          const source = f.source(),
            controller = f.signal();
          if (mode === "reader-absent") f.withoutReader();
          let reads = 0;
          Object.defineProperty(source.file, "arrayBuffer", {
            value: async () => {
              reads++;
              return result;
            },
          });
          const outcome = await bounded(
            f.track(
              developPhotoFromFile(
                source.file,
                null,
                undefined,
                mode === "reader-absent" ? controller.signal : undefined,
              ),
            ).outcome,
          );
          expect(outcome.ok).toBe(false);
          expect(reads).toBe(1);
          expect(f.instances).toHaveLength(0);
          expect(f.digestCalls).toHaveLength(0);
          f.clean();
        });
    }
  });

  test("no-signal call retains Blob.arrayBuffer and identical full SHA", async () =>
    readers(async (f) => {
      const source = f.source();
      const result = await developPhotoFromFile(source.file);
      expect(result.id).toBe(source.hash);
      expect(result.sourceBlob).toBe(source.file);
      expect(source.reads()).toBe(1);
      expect(f.instances).toHaveLength(0);
      expect(f.digestCalls).toEqual([source.bytes.byteLength]);
      f.clean();
    }));

  test("cold nonbrowser fallback with a signal returns the same full SHA", async () =>
    readers(async (f) => {
      f.withoutReader();
      const source = f.source(),
        controller = f.signal();
      const result = await developPhotoFromFile(source.file, null, undefined, controller.signal);
      expect(result.id).toBe(source.hash);
      expect(result.sourceBlob).toBe(source.file);
      expect(source.reads()).toBe(1);
      expect(f.instances).toHaveLength(0);
      expect(f.digestCalls).toEqual([source.bytes.byteLength]);
      f.clean();
    }));

  test("cancelled reader cannot publish late success or affect an independent call", async () =>
    readers(async (f) => {
      const first = f.source("first.jpg"),
        second = f.source("second.jpg", "independent second source");
      const a = f.signal(),
        b = f.signal();
      const one = f.track(developPhotoFromFile(first.file, null, undefined, a.signal));
      const two = f.track(developPhotoFromFile(second.file, null, undefined, b.signal));
      await turn();
      a.abort();
      assertAbort(await bounded(one.outcome));
      const readerA = f.instances[0]!,
        readerB = f.instances[1]!;
      readerA.succeed(first.bytes);
      readerA.fail();
      expect(two.settled()).toBe(false);
      expect(readerB.abortCalls).toBe(0);
      readerB.succeed(second.bytes);
      const outcome = await bounded(two.outcome);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.value.id).toBe(second.hash);
      expect(f.digestCalls).toEqual([second.bytes.byteLength]);
      f.clean();
    }));

  test("Stop after save still returns the exact durable receipt", async () =>
    readers(async (f) => {
      const source = f.source(),
        controller = f.signal();
      f.onRead((reader) => reader.succeed(source.bytes));
      let savedInput: DevelopPhotoInput | null = null;
      const report = await runDevelopImport([source.file, f.source("later.jpg").file], {
        existingIds: [],
        signal: controller.signal,
        preparePreview: async (_file, input) => ({ ...input, previewBlob: new Blob(["preview"]) }),
        save: async (input) => {
          savedInput = input;
          controller.abort();
          return [{ ...input, sourceAvailable: true, createdAt: 1 }];
        },
      });
      expect(report.stopped).toBe(true);
      expect(report.imported).toHaveLength(1);
      expect(report.imported[0]!.id).toBe(source.hash);
      expect(report.selectedId).toBe(source.hash);
      expect(savedInput!.sourceBlob).toBe(source.file);
      expect(f.instances).toHaveLength(1);
      f.clean();
    }));
});
