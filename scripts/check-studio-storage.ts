/** Isolated IndexedDB integration check. Usage: bun scripts/check-studio-storage.ts /absolute/path/to/fake-indexeddb/build/esm/index.js */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { DEFAULT_EDITS, type Shot } from "../src/lib/imaging";
type StudioModule = typeof import("../src/lib/studio/session");

const simulator = process.argv[2];
if (!simulator)
  throw new Error(
    "Pass the path to a separately installed fake-indexeddb module. No real browser storage is used.",
  );
const { IDBFactory } = await import(pathToFileURL(resolve(simulator)).href);
Object.defineProperty(globalThis, "indexedDB", { value: new IDBFactory(), configurable: true });
// Bun strips query strings from file imports. Bundle into distinct in-memory
// modules so their writer maps are genuinely separate while IndexedDB is shared.
const build = await Bun.build({
  entrypoints: [resolve("src/lib/studio/session.ts")],
  target: "browser",
  format: "cjs",
  write: false,
  define: { "import.meta.hot": "__studioHot" },
});
if (!build.success) throw new Error("Could not build the isolated writer fixture");
const source = await build.outputs[0]!.text();
const factory = new Function("module", "exports", "__studioHot", source);
type HotData = Record<string, unknown>;
const tab = (data: HotData = {}, dispose = (_callback: (data: HotData) => void) => {}) => {
  const module = { exports: {} };
  factory(module, module.exports, { data, dispose });
  return module.exports as StudioModule;
};
let disposeA = (_data: HotData) => {};
const hotA: HotData = {};
const a = tab(hotA, (callback) => {
  disposeA = callback;
});
const b = tab();
assert.notEqual(
  a.loadStudioSession,
  b.loadStudioSession,
  "Each tab must have an independent writer map",
);
const scope = "device-local";
const urls: string[] = [];
async function load(tab: typeof a) {
  const session = await tab.loadStudioSession(scope);
  for (const shot of session?.shots ?? []) if (shot.previewUrl) urls.push(shot.previewUrl);
  return session;
}
function readStored() {
  return new Promise<{
    session: { revision: number; updatedAt: number };
    shot: { verdict: string; previewBlob: Blob };
  }>((resolveResult, reject) => {
    const req = indexedDB.open("lens-os-local-studio", 2);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(["sessions", "shots"], "readonly");
      const session = tx.objectStore("sessions").get("active");
      const shot = tx.objectStore("shots").get("fixture");
      tx.oncomplete = () => {
        db.close();
        resolveResult({ session: session.result, shot: shot.result });
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}
const fixture: Shot = {
  id: "fixture",
  name: "fixture.jpg",
  file: new File(["original"], "fixture.jpg"),
  previewUrl: null,
  previewBlob: new Blob(["preview-A"], { type: "image/jpeg" }),
  sourceAvailable: true,
  isRaw: false,
  width: 10,
  height: 10,
  sizeMb: 0.001,
  sharpness: 40,
  brightness: 120,
  clippedHighlights: 0,
  clippedShadows: 0,
  hash: "1".repeat(64),
  score: 80,
  flags: [],
  verdict: "undecided",
  edits: { ...DEFAULT_EDITS },
};
try {
  assert.equal(await load(a), null);
  assert.equal(await load(b), null);
  await a.saveStudioSession([fixture], fixture.id, "all", scope);
  const initial = await readStored();
  assert.equal(initial.session.revision, 1);
  await assert.rejects(
    b.saveStudioSession([{ ...fixture, verdict: "reject" }], fixture.id, "all", scope),
    /another tab/,
  );
  assert.equal((await readStored()).shot.verdict, "undecided");
  const restored = await load(b);
  await b.saveStudioSession(restored.shots, fixture.id, "all", scope);
  const unchanged = await readStored();
  assert.equal(unchanged.session.revision, 1, "Hydration/visibility no-op cannot advance revision");
  assert.equal(unchanged.session.updatedAt, initial.session.updatedAt);
  await a.saveStudioSession([{ ...fixture, verdict: "keep" }], fixture.id, "all", scope);
  const staleOne = b.saveStudioSession(restored.shots, fixture.id, "all", scope);
  const staleTwo = b.saveStudioSession(restored.shots, fixture.id, "all", scope);
  const results = await Promise.allSettled([staleOne, staleTwo]);
  assert.ok(results.every((result) => result.status === "rejected"));
  assert.equal(
    (await readStored()).shot.verdict,
    "keep",
    "Queued stale saves cannot change newer picks",
  );
  const updated: Shot = {
    ...fixture,
    verdict: "keep",
    previewBlob: new Blob(["preview-B"], { type: "image/jpeg" }),
  };
  await a.saveStudioSession([updated], fixture.id, "all", scope);
  assert.equal(
    await (await readStored()).shot.previewBlob.text(),
    "preview-B",
    "Equal-size replacement previews must persist",
  );
  await assert.rejects(b.clearStudioSession({ scope }), /another tab/);
  assert.equal((await readStored()).shot.verdict, "keep");
  disposeA(hotA);
  const refreshed = tab(hotA);
  const beforeRefresh = (await readStored()).session.revision;
  await refreshed.saveStudioSession([updated], fixture.id, "all", scope);
  assert.equal(
    (await readStored()).session.revision,
    beforeRefresh,
    "HMR retains the live writer revision and no-op cache",
  );
  console.log(
    "PASS: isolated tabs, stale/queued-write refusal, unchanged-save no-op, same-size preview replacement, stale-clear refusal, HMR writer recovery",
  );
} finally {
  for (const url of urls) URL.revokeObjectURL(url);
}
