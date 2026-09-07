// Isolated database integration checks; never reads the real app's saved photos.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadStudioSession,
  saveStudioSession,
  inspectPreviousShoot,
  copyPreviousShoot,
} from "../src/lib/studio/session";
import {
  listRecentShoots,
  rememberShoot,
  renameShoot,
  markDeviceRecovery,
  startDeviceRecovery,
  studioDatabaseKey,
} from "../src/lib/studio/shoot-directory";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";
const runtime = process.argv[2];
if (!runtime?.startsWith("/"))
  throw new Error("Pass the absolute isolated test-runtime directory.");
await import(pathToFileURL(resolve(runtime, "node_modules/fake-indexeddb/auto/index.mjs")).href);
Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true });
const owner = crypto.randomUUID(),
  other = crypto.randomUUID(),
  first = crypto.randomUUID(),
  empty = crypto.randomUUID();
const frames = Array.from(
  { length: 16 },
  (_, i) =>
    ({
      id: `photo-${i}`,
      name: `${i}.jpg`,
      file: new File([`original-${i}`], `${i}.jpg`),
      previewBlob: new Blob([`preview-${i}`], { type: "image/jpeg" }),
      previewUrl: null,
      width: 10,
      height: 10,
      sourceAvailable: true,
      isRaw: false,
      sizeMb: 1,
      sharpness: 10,
      brightness: 100,
      clippedHighlights: 0,
      clippedShadows: 0,
      hash: "0",
      score: 10,
      flags: [],
      verdict: i < 3 ? "keep" : "undecided",
      edits: { ...DEFAULT_EDITS, exposure: i },
    }) as Shot,
);
await loadStudioSession();
await saveStudioSession(frames, frames[2]!.id, "keepers");
assert.equal(await inspectPreviousShoot("device-local"), 16);
assert.equal(await loadStudioSession(owner, empty), null);
assert.equal(await loadStudioSession(other, first), null);
await startDeviceRecovery(owner, first, "Lunara Glow Shoot");
assert.equal((await listRecentShoots(owner))[0]?.recoveryPending, true);
const count = await copyPreviousShoot("device-local", owner, first);
assert.equal(count, 16);
// A reload/retry after committing media must resume the same shoot, not duplicate it.
assert.equal(await copyPreviousShoot("device-local", owner, first), 16);
assert.equal((await listRecentShoots(owner)).length, 1);
await rememberShoot(owner, first, count, "Imported shoot");
await renameShoot(owner, first, "Lunara Glow Shoot");
await markDeviceRecovery(owner, first);
const read = async (scope: string, id?: string) => {
  const data = await loadStudioSession(scope, id);
  for (const s of data?.shots ?? []) if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
  return data;
};
const restored = (await read(owner, first))!;
assert.deepEqual(
  restored.shots.map((s) => [s.id, s.verdict, s.edits]),
  frames.map((s) => [s.id, s.verdict, s.edits]),
);
assert.equal(restored.selectedId, "photo-2");
assert.equal(restored.filter, "keepers");
assert.equal(await restored.shots[15]!.previewBlob!.text(), "preview-15");
assert.equal((await read("device-local"))!.shots.length, 16);
assert.equal(await copyPreviousShoot("device-local", owner, first), 16);
assert.equal((await read(owner, first))!.shots.length, 16);
assert.equal(await read(owner, empty), null);
await saveStudioSession([frames[0]!], frames[0]!.id, "all", owner, empty);
await assert.rejects(copyPreviousShoot("device-local", owner, empty), /already contains/);
await rememberShoot(owner, empty, 1, "Real Estate Shoot");
assert.equal((await read(owner, first))!.shots.length, 16);
await rememberShoot(owner, first, 16, "Camera folder");
const rows = await listRecentShoots(owner);
assert.equal(rows.find((r) => r.id === first)?.title, "Lunara Glow Shoot");
assert.equal(rows.find((r) => r.id === first)?.recoveredFromDevice, true);
assert.equal(rows.find((r) => r.id === first)?.recoveryPending, false);
assert.equal(rows.length, 2);
assert.equal((await listRecentShoots(other)).length, 0);
// Malformed legacy records must fail before any destination record is committed.
const malformed = crypto.randomUUID(),
  destination = crypto.randomUUID();
await new Promise<void>((resolve, reject) => {
  const req = indexedDB.open(studioDatabaseKey(malformed), 2);
  req.onupgradeneeded = () => {
    req.result.createObjectStore("sessions", { keyPath: "id" });
    req.result.createObjectStore("shots", { keyPath: "id" });
  };
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const db = req.result,
      tx = db.transaction("sessions", "readwrite");
    tx.objectStore("sessions").put({
      id: "active",
      shots: [{ id: "valid" }, { name: "missing ID" }],
      selectedId: null,
      filter: "all",
    });
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  };
});
await assert.rejects(copyPreviousShoot(malformed, owner, destination), /invalid frame IDs/);
assert.equal(await read(owner, destination), null);
console.log(
  "PASS: 16-frame recovery, empty new shoot, interrupted recovery retry, malformed-source rollback, source preservation, occupied-target refusal, exact picks/edits/previews/view, isolated names and accounts.",
);
