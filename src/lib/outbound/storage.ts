import { z } from "zod";
import { emptyOutbound, outboundSchema, type OutboundWorkspace } from "./model";

/** Separate from client lists, Studio sessions and Develop media. No remote synchronization. */
export const OUTBOUND_DATABASE_NAME = "foto-outbound-v1";
export const OUTBOUND_STORE_NAME = "workspaces";
export const OUTBOUND_CHANGED = "foto:outbound-changed";
const CHANNEL_NAME = "foto-outbound-changes-v1";
const revisionSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER - 1);
const scopeSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      value === value.trim() &&
      ![...value].some((char) => {
        const code = char.charCodeAt(0);
        return code < 32 || (code >= 127 && code <= 159);
      }),
  );
const recordSchema = z
  .object({ scope: scopeSchema, revision: revisionSchema, workspace: outboundSchema })
  .strict();
const changeSchema = z.object({ scope: scopeSchema, revision: revisionSchema }).strict();

export type OutboundRecord = {
  scope: string;
  revision: number;
  workspace: OutboundWorkspace;
};
export type OutboundChange = Pick<OutboundRecord, "scope" | "revision">;
export type OutboundStoreOptions = {
  factory?: IDBFactory;
  eventTarget?: EventTarget;
  /** Returning null disables cross-tab notifications, without weakening transactional saves. */
  channelFactory?: (name: string) => BroadcastChannel | null;
};

export class OutboundSaveConflict extends Error {
  constructor(public readonly currentRevision: number) {
    super("Outbound changed in another tab. Reload its latest saved state before saving again.");
    this.name = "OutboundSaveConflict";
  }
}

/** Never normalize identity scopes: trimming or falling back could select another account. */
export function validateOutboundScope(scope: unknown): string {
  const result = scopeSchema.safeParse(scope);
  if (!result.success)
    throw new Error("An exact, non-empty account scope is required for outbound.");
  return result.data;
}

/** Invalid stored records are an error, not permission to replace them with an empty desk. */
export function validateOutboundRecord(value: unknown, expectedScope: string): OutboundRecord {
  const scope = validateOutboundScope(expectedScope);
  const result = recordSchema.safeParse(value);
  if (!result.success || result.data.scope !== scope)
    throw new Error("Saved outbound data could not be validated. It has not been replaced.");
  return result.data;
}

function openDatabase(factory: IDBFactory | undefined): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!factory) {
      reject(new Error("This browser cannot open local outbound storage. Nothing was saved."));
      return;
    }
    let failed = false;
    const fail = (message: string) => {
      failed = true;
      reject(new Error(message));
    };
    try {
      const request = factory.open(OUTBOUND_DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        // A pending request can become unblocked after its caller already received an error.
        if (failed) {
          request.transaction?.abort();
          return;
        }
        if (!request.result.objectStoreNames.contains(OUTBOUND_STORE_NAME))
          request.result.createObjectStore(OUTBOUND_STORE_NAME, { keyPath: "scope" });
      };
      request.onblocked = () =>
        fail("Outbound storage is blocked by another tab. Close that tab and try again.");
      request.onerror = () =>
        fail("Local outbound storage could not be opened. Existing data has not been replaced.");
      request.onsuccess = () => {
        const database = request.result;
        if (failed) {
          database.close();
          return;
        }
        database.onversionchange = () => database.close();
        if (!database.objectStoreNames.contains(OUTBOUND_STORE_NAME)) {
          database.close();
          fail("Outbound storage is incomplete. Existing data has not been replaced.");
          return;
        }
        resolve(database);
      };
    } catch {
      fail("Local outbound storage is unavailable. Nothing was saved.");
    }
  });
}

const fallbackEvents = new EventTarget();

export function createOutboundStore(options: OutboundStoreOptions = {}) {
  const events = options.eventTarget ?? (typeof window === "undefined" ? fallbackEvents : window);
  const makeChannel =
    options.channelFactory ??
    ((name: string) =>
      typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(name));

  function announce(change: OutboundChange) {
    // These are invalidation hints only, never prospect/email/message payloads.
    // A notification failure must not turn a committed save into a reported failure/retry.
    try {
      events.dispatchEvent(new CustomEvent(OUTBOUND_CHANGED, { detail: { ...change } }));
    } catch {
      /* Focus/reload still reads the committed revision. */
    }
    let channel: BroadcastChannel | null = null;
    try {
      channel = makeChannel(CHANNEL_NAME);
      channel?.postMessage(change);
    } catch {
      /* IndexedDB CAS still prevents stale writes if cross-tab messaging is unavailable. */
    } finally {
      try {
        channel?.close();
      } catch {
        /* A committed result must survive an unavailable notification channel. */
      }
    }
  }

  async function access(
    requestedScope: string,
    edit?: {
      expectedRevision: number;
      transform: (workspace: OutboundWorkspace) => OutboundWorkspace;
    },
  ): Promise<OutboundRecord> {
    const scope = validateOutboundScope(requestedScope);
    if (edit && !revisionSchema.safeParse(edit.expectedRevision).success)
      throw new Error("Outbound needs a valid saved revision before it can be changed.");
    const database = await openDatabase(options.factory ?? globalThis.indexedDB);
    return new Promise((resolve, reject) => {
      let result: OutboundRecord | undefined;
      let failure: unknown;
      let transaction: IDBTransaction;
      try {
        transaction = database.transaction(OUTBOUND_STORE_NAME, edit ? "readwrite" : "readonly");
      } catch {
        database.close();
        reject(new Error("Outbound storage could not start a transaction. Nothing was saved."));
        return;
      }
      const abort = (error: unknown) => {
        failure = error;
        try {
          transaction.abort();
        } catch {
          database.close();
          reject(error);
        }
      };
      transaction.onabort = () => {
        database.close();
        reject(
          failure ??
            new Error("Outbound could not be saved. Check available device storage and try again."),
        );
      };
      transaction.onerror = () => {
        failure ??= new Error(
          "Outbound storage failed. No changes from this transaction were saved.",
        );
      };
      transaction.oncomplete = () => {
        database.close();
        if (!result) {
          reject(
            new Error("Outbound storage finished without a saved result. Reload before retrying."),
          );
          return;
        }
        if (edit) announce({ scope, revision: result.revision });
        resolve(result);
      };
      try {
        const store = transaction.objectStore(OUTBOUND_STORE_NAME);
        const request = store.get(scope);
        request.onsuccess = () => {
          try {
            const current =
              request.result === undefined
                ? { scope, revision: 0, workspace: emptyOutbound() }
                : validateOutboundRecord(request.result, scope);
            if (!edit) {
              result = current;
              return;
            }
            if (current.revision !== edit.expectedRevision)
              throw new OutboundSaveConflict(current.revision);
            if (current.revision >= Number.MAX_SAFE_INTEGER - 1)
              throw new Error("Outbound revision capacity has been reached. Nothing was saved.");
            // The transform is deliberately synchronous inside the same readwrite transaction.
            // Passing an async callback is rejected by the schema; never await network work here.
            const workspace = outboundSchema.parse(
              edit.transform(outboundSchema.parse(current.workspace)),
            );
            result = { scope, revision: current.revision + 1, workspace };
            store.put(result);
          } catch (error) {
            abort(error);
          }
        };
      } catch (error) {
        abort(error);
      }
    });
  }

  return {
    read(scope: string): Promise<OutboundRecord> {
      return access(scope);
    },
    update(
      scope: string,
      expectedRevision: number,
      transform: (workspace: OutboundWorkspace) => OutboundWorkspace,
    ): Promise<OutboundRecord> {
      return access(scope, { expectedRevision, transform });
    },
    subscribe(scope: string, listener: (change: OutboundChange) => void): () => void {
      const checkedScope = validateOutboundScope(scope);
      const receive = (value: unknown) => {
        const result = changeSchema.safeParse(value);
        if (result.success && result.data.scope === checkedScope) listener(result.data);
      };
      const local = (event: Event) => receive((event as CustomEvent<unknown>).detail);
      events.addEventListener(OUTBOUND_CHANGED, local);
      let channel: BroadcastChannel | null = null;
      try {
        channel = makeChannel(CHANNEL_NAME);
        if (channel) channel.onmessage = (event: MessageEvent<unknown>) => receive(event.data);
      } catch {
        /* No network connection is required; callers should also refresh on window focus. */
      }
      return () => {
        events.removeEventListener(OUTBOUND_CHANGED, local);
        channel?.close();
      };
    },
  };
}

let defaultStore: ReturnType<typeof createOutboundStore> | undefined;
const getDefaultStore = () => (defaultStore ??= createOutboundStore());
export const readOutbound = (scope: string) => getDefaultStore().read(scope);
export const updateOutbound = (
  scope: string,
  expectedRevision: number,
  transform: (workspace: OutboundWorkspace) => OutboundWorkspace,
) => getDefaultStore().update(scope, expectedRevision, transform);
export const subscribeOutbound = (scope: string, listener: (change: OutboundChange) => void) =>
  getDefaultStore().subscribe(scope, listener);
