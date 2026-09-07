// Isolated IndexedDB integration check. Never opens the app's browser storage.
// bun scripts/workbench-storage-check.ts /absolute/runtime-with-fake-indexeddb
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadStudioSession,
  saveStudioSession,
  clearStudioSession,
} from "../src/lib/studio/session";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";
import { workspaceStorageKey } from "../src/lib/workspace-storage";
const runtime = process.argv[2];
if (!runtime?.startsWith("/")) throw new Error("Pass an absolute isolated test-runtime directory.");
await import(pathToFileURL(resolve(runtime, "node_modules/fake-indexeddb/auto/index.mjs")).href);
const accountA = crypto.randomUUID(),
  accountB = crypto.randomUUID();
const shot = (name: string): Shot =>
  ({
    id: "same-id",
    file: new File([name], "test.jpg"),
    name,
    previewUrl: null,
    previewBlob: new Blob([name], { type: "image/jpeg" }),
    isRaw: false,
    width: 1,
    height: 1,
    sizeMb: 1,
    sharpness: 1,
    brightness: 0.5,
    clippedHighlights: 0,
    clippedShadows: 0,
    hash: "00",
    tone: 0,
    score: 80,
    flags: [],
    verdict: "undecided",
    edits: { ...DEFAULT_EDITS },
  }) as Shot;
await loadStudioSession();
await saveStudioSession([shot("Legacy device shoot")], "same-id", "all");
assert.equal(await loadStudioSession(accountA), null);
assert.equal(await loadStudioSession(accountB), null);
// Schedule A, hydrate B, then complete A: queued writes retain A's immutable scope.
const delayedA = saveStudioSession([shot("Account A")], "same-id", "all", accountA);
assert.equal(await loadStudioSession(accountB), null);
await delayedA;
await saveStudioSession([shot("Account B")], "same-id", "keepers", accountB);
const read = async (scope = "device-local") => {
  const loaded = await loadStudioSession(scope);
  for (const frame of loaded?.shots ?? [])
    if (frame.previewUrl) URL.revokeObjectURL(frame.previewUrl);
  return loaded;
};
assert.equal((await read(accountA))?.shots[0]?.name, "Account A");
assert.equal((await read(accountB))?.shots[0]?.name, "Account B");
assert.equal((await read(accountB))?.filter, "keepers");
assert.equal((await read())?.shots[0]?.name, "Legacy device shoot");
await clearStudioSession({ scope: accountA });
assert.equal(await read(accountA), null);
assert.equal((await read(accountB))?.shots[0]?.name, "Account B");
assert.equal((await read())?.shots[0]?.name, "Legacy device shoot");
// Simulate another browser tab advancing B's revision; stale writes must fail closed.
const db = await new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(workspaceStorageKey("lens-os-local-studio", accountB));
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
await new Promise<void>((resolve, reject) => {
  const transaction = db.transaction("sessions", "readwrite");
  const store = transaction.objectStore("sessions"),
    request = store.get("active");
  request.onsuccess = () => store.put({ ...request.result, revision: request.result.revision + 1 });
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error);
});
db.close();
await assert.rejects(saveStudioSession([shot("Stale")], "same-id", "all", accountB), /another tab/);
assert.equal((await read(accountB))?.shots[0]?.name, "Account B");
assert.equal((await read())?.shots[0]?.name, "Legacy device shoot");
console.log(
  "13 isolated Studio account-storage checks passed; no browser or original files touched.",
);
