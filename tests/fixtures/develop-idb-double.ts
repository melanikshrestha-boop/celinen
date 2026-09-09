import { DEVELOP_DATABASE_NAME } from "../../src/lib/develop/store";

/** Scoped transaction double, not proof of browser IndexedDB behavior. Pending writes
 * become visible only at completion; overlapping transactions are serialized. */
export function developIdbDouble() {
  const rows = {
    photos: new Map<string, unknown>(),
    documents: new Map<string, unknown>(),
    presets: new Map<string, unknown>(),
    manifests: new Map<string, unknown>(),
    importJobs: new Map<string, unknown>(),
  };
  const log: string[] = [];
  let tail = Promise.resolve();
  const faults = { put: false, complete: false };
  const database = {
    close() {},
    transaction(names: string[], mode: string) {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      let finished = false;
      let completion: ReturnType<typeof setTimeout> | undefined;
      const pending: { name: keyof typeof rows; key: string; value: unknown }[] = [];
      const tx = {
        error: null as Error | null,
        oncomplete: null as (() => void) | null,
        onabort: null as (() => void) | null,
        onerror: null as (() => void) | null,
        abort() {
          if (finished) throw new Error("Transaction finished");
          finished = true;
          clearTimeout(completion);
          queueMicrotask(() => {
            log.push("abort");
            tx.onabort?.();
            release();
          });
        },
        objectStore(name: keyof typeof rows) {
          if (!names.includes(name)) throw new Error("Store outside transaction");
          function finishLater() {
            clearTimeout(completion);
            completion = setTimeout(() => {
              if (finished) return;
              if (faults.complete && pending.length) {
                tx.error = new Error("Commit failed");
                tx.abort();
                return;
              }
              for (const write of pending) rows[write.name].set(write.key, write.value);
              finished = true;
              log.push("complete");
              tx.oncomplete?.();
              release();
            }, 0);
          }
          function write(record: { key: string }, add: boolean) {
            if (mode !== "readwrite") throw new Error("Readonly write");
            if (faults.put) throw new DOMException("Full", "QuotaExceededError");
            if (add && rows[name].has(record.key)) throw new Error("Duplicate key");
            log.push(`${name}:put:${record.key}`);
            pending.push({ name, key: record.key, value: structuredClone(record) });
            finishLater();
          }
          return {
            index(field: string) {
              const all = (query: unknown, keyOnly: boolean) => {
                const request = {
                  result: undefined as unknown,
                  onsuccess: null as (() => void) | null,
                  onerror: null as (() => void) | null,
                };
                void previous.then(() => {
                  if (finished) return;
                  log.push(`${name}:index:${field}`);
                  request.result = [...rows[name]]
                    .filter(([, value]) => (value as Record<string, unknown>)[field] === query)
                    .map(([key, value]) => (keyOnly ? key : structuredClone(value)));
                  request.onsuccess?.();
                  finishLater();
                });
                return request;
              };
              return {
                getAll: (query: unknown) => all(query, false),
                getAllKeys: (query: unknown) => all(query, true),
              };
            },
            get(key: string, keyOnly = false) {
              const request = {
                result: undefined as unknown,
                onsuccess: null as (() => void) | null,
                onerror: null as (() => void) | null,
              };
              void previous.then(() => {
                if (finished) return;
                log.push(`${name}:get:${key}`);
                request.result = keyOnly
                  ? rows[name].has(key)
                    ? key
                    : undefined
                  : structuredClone(rows[name].get(key));
                request.onsuccess?.();
                finishLater();
              });
              return request;
            },
            getKey(key: string) {
              return this.get(key, true);
            },
            put: (record: { key: string }) => write(record, false),
            add: (record: { key: string }) => write(record, true),
          };
        },
      };
      return tx;
    },
  };
  const factory = {
    open(name: string, version: number) {
      if (name !== DEVELOP_DATABASE_NAME || version !== 3) throw new Error("Unexpected database");
      const request = { result: database, onsuccess: null as (() => void) | null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  } as unknown as IDBFactory;
  return { factory, rows, log, faults };
}
