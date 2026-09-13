import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = readFileSync(new URL("../src/routes/studio.tsx", import.meta.url), "utf8");
const start = source.indexOf("  const loadStoredSession = useCallback(");
const end = source.indexOf("  const saveStoredSession = useCallback(", start);
if (start < 0 || end < 0) throw new Error("Studio owner hydration callback missing");
const callback = new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(start, end));

// The real session module owns process-global writer state. Run it in a fresh
// process with synthetic in-memory IndexedDB, never another test's globals or a
// browser/account database. The route callback is extracted, not reimplemented.
const fixture = String.raw`
import assert from "node:assert/strict";
import * as studio from "./src/lib/studio/session.ts";
import { DEFAULT_EDITS } from "./src/lib/imaging.ts";
import { studioDatabaseKey } from "./src/lib/studio/shoot-directory.ts";

const account = crypto.randomUUID(), shootId = crypto.randomUUID();
const databaseName = studioDatabaseKey(account, shootId);
const frame = {
  id: "synthetic-photo", name: "synthetic.jpg", isRaw: false,
  width: 1, height: 1, sizeMb: 0, sharpness: 200, brightness: 120,
  clippedHighlights: 0, clippedShadows: 0, hash: "01".repeat(32), score: 90,
  flags: [], verdict: "undecided", edits: { ...DEFAULT_EDITS }, previewBlob: null,
};
const rows = {
  sessions: new Map([["active", {
    id: "active", revision: 7, shotIds: empty ? [] : [frame.id],
    selectedId: empty ? null : frame.id, filter: "all", updatedAt: 1,
  }]]),
  shots: new Map(empty ? [] : [[frame.id, frame]]),
};
const database = {
  close() {},
  transaction(names, mode) {
    let timer, aborted = false;
    const writes = [];
    const tx = {
      oncomplete: null, onabort: null,
      abort() {
        aborted = true;
        clearTimeout(timer);
        queueMicrotask(() => tx.onabort?.());
      },
      objectStore(name) {
        assert(names.includes(name));
        const finish = () => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            if (aborted) return;
            for (const write of writes) write();
            tx.oncomplete?.();
          }, 0);
        };
        const request = (value) => {
          const result = { result: structuredClone(value), onsuccess: null };
          queueMicrotask(() => { result.onsuccess?.(); finish(); });
          return result;
        };
        return {
          get: (key) => request(rows[name].get(key)),
          getAllKeys: () => request([...rows[name].keys()]),
          put(record) {
            assert.equal(mode, "readwrite");
            const copy = structuredClone(record);
            writes.push(() => rows[name].set(copy.id, copy));
            finish();
          },
          delete(key) {
            assert.equal(mode, "readwrite");
            writes.push(() => rows[name].delete(key));
            finish();
          },
        };
      },
    };
    return tx;
  },
};
globalThis.indexedDB = {
  open(name, version) {
    assert.equal(name, databaseName);
    assert.equal(version, 2);
    const request = { result: database, onsuccess: null };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  },
};

const calls = [];
const unanalyzedIds = { current: null }, nativeTreatmentIds = { current: null };
const canonical = {
  shots: [{ ...frame, file: new File(["synthetic original"], frame.name), previewUrl: null }],
  selectedId: frame.id, filter: "all", unanalyzedIds: new Set(),
  nativeTreatmentIds: new Set([frame.id]),
};
const load = new Function(
  "useCallback", "projectSession", "loadStudioSession", "readStudioSessionSnapshot",
  "canonicalView", "mergeStudioSubjects", "unanalyzedIds", "nativeTreatmentIds",
  "storageScope", "shootId", callback + "\nreturn loadStoredSession;",
)(
  (value) => value, null,
  async (...args) => { calls.push("owner"); return studio.loadStudioSession(...args); },
  async (...args) => { calls.push("snapshot"); return studio.readStudioSessionSnapshot(...args); },
  { read: async (legacy) => {
    calls.push("canonical");
    if (empty) assert.equal(legacy, null);
    else {
      assert.equal(legacy.shots[0].id, frame.id);
      assert.equal(legacy.shots[0].sourceAvailable, false);
    }
    return canonical;
  } },
  (shot) => shot, unanalyzedIds, nativeTreatmentIds, account, shootId,
);
const hydrated = await load();
assert.equal(hydrated, canonical);
assert.equal(unanalyzedIds.current, canonical.unanalyzedIds);
assert.equal(nativeTreatmentIds.current, canonical.nativeTreatmentIds);
// This is the next real compatibility write after a filter/review gesture.
// With snapshot-only hydration it throws StudioSaveConflict at revision 7.
await studio.saveStudioSession(hydrated.shots, hydrated.selectedId, "flagged", account, shootId);
assert.deepEqual(calls, ["owner", "canonical"]);
assert.equal(rows.sessions.get("active").revision, 8);
assert.equal(rows.sessions.get("active").filter, "flagged");
assert.equal(rows.shots.get(frame.id).verdict, "undecided");
for (const [index, verdict] of ["keep", "reject"].entries()) {
  const reviewed = hydrated.shots.map((shot) => ({ ...shot, verdict }));
  await studio.saveStudioSession(reviewed, hydrated.selectedId, "flagged", account, shootId);
  assert.equal(rows.sessions.get("active").revision, 9 + index);
  assert.equal(rows.shots.get(frame.id).verdict, verdict);
}

// A later tool snapshot still must not acknowledge an external writer on behalf
// of this mounted owner. Preserve the real CAS, not a save-time auto-rebase.
rows.sessions.set("active", { ...rows.sessions.get("active"), revision: 11, filter: "keepers" });
await studio.readStudioSessionSnapshot(account, shootId);
await assert.rejects(
  studio.saveStudioSession(hydrated.shots, hydrated.selectedId, "all", account, shootId),
  studio.StudioSaveConflict,
);
assert.equal(rows.sessions.get("active").revision, 11);
assert.equal(rows.sessions.get("active").filter, "keepers");
assert.equal(rows.shots.get(frame.id).verdict, "reject");
console.log("owner-hydration-save-and-stale-writer-checks-passed");
`;

function run(empty: boolean, code = callback) {
  return spawnSync(
    process.execPath,
    ["-e", `const callback = ${JSON.stringify(code)}, empty = ${empty};\n${fixture}`],
    { cwd: root, encoding: "utf8", timeout: 15000 },
  );
}

describe("Studio initial hydration owns its compatibility writer baseline", () => {
  test.each([false, true])(
    "owner hydration allows the next save and preserves stale-writer checks (empty tombstone: %s)",
    (empty) => {
      const result = run(empty);
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("owner-hydration-save-and-stale-writer-checks-passed");
    },
  );

  test("the original snapshot-only callback fails at the real save boundary", () => {
    const prior = callback.replace(/await loadStudioSession\(/, "await readStudioSessionSnapshot(");
    expect(prior).not.toBe(callback);
    const result = run(false, prior);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("StudioSaveConflict");
    expect(result.stderr).toContain("Saving is paused to protect both versions");
    expect(result.stdout).not.toContain("owner-hydration-save-and-stale-writer-checks-passed");
  });
});
