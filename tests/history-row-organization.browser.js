/* Async browser eval. Only writes fresh random-UUID QA accounts in the shoot-directory DB.
 * No Studio, Project, Develop, original image or actual signed-in account is mutated. */
if (!["localhost", "127.0.0.1"].includes(location.hostname))
  throw new Error("Local QA origin required.");
const m = await import("/src/lib/studio/shoot-directory.ts");
const scope = crypto.randomUUID(),
  otherScope = crypto.randomUUID(),
  id = crypto.randomUUID();
const dbName = `lenslabs-shoot-directory-v1:account:${scope}`;
const checks = [];
const check = (label, ok) => {
  if (!ok) throw new Error(label);
  checks.push(label);
};
const request = (value) =>
  new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
const complete = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(tx.error || new Error("Transaction aborted"));
  });
const opened = indexedDB.open(dbName, 1);
opened.onupgradeneeded = () => {
  opened.result.createObjectStore("shoots", { keyPath: "id" });
  opened.result.createObjectStore("preserved-extra");
};
const db = await request(opened);
const sentinel = {
  id,
  title: "QA preserved shoot",
  named: true,
  count: 337,
  updatedAt: 123,
  recoveredFromDevice: false,
  recoveryPending: false,
  future: { retain: ["yes"] },
};
const tx = db.transaction(["shoots", "preserved-extra"], "readwrite"),
  done = complete(tx);
tx.objectStore("shoots").put(sentinel);
tx.objectStore("preserved-extra").put(new Blob(["unchanged sentinel"]), "proof");
await done;
db.close();
const before = JSON.stringify((await m.listRecentShoots(scope))[0]);
await Promise.all([
  m.updateShootOrganization(scope, id, { pinned: true }, { pinned: false }),
  m.updateShootOrganization(scope, id, { archived: true }, { archived: false }),
]);
let rows = await m.listShootOrganization(scope);
check(
  "concurrent pin and archive patches both persist",
  rows[id].pinned && rows[id].archived && rows[id].revision === 2,
);
check(
  "source directory row unchanged by organization",
  JSON.stringify((await m.listRecentShoots(scope))[0]) === before,
);
check(
  "another account does not inherit organization",
  Object.keys(await m.listShootOrganization(otherScope)).length === 0,
);
await m.updateShootOrganization(scope, `project:${id}`, { pinned: false, archived: false });
rows = await m.listShootOrganization(scope);
check(
  "canonical project identity does not collide with shoot",
  rows[id].archived && !rows[`project:${id}`].archived,
);
await m.updateShootOrganization(scope, id, { archived: false }, { archived: true });
rows = await m.listShootOrganization(scope);
check("archive undo restores row without losing pin", rows[id].pinned && !rows[id].archived);
const reopened = await request(indexedDB.open(dbName, 2));
check(
  "version1 upgrade preserved unrelated store",
  reopened.objectStoreNames.contains("preserved-extra"),
);
const proof = await request(
  reopened.transaction("preserved-extra").objectStore("preserved-extra").get("proof"),
);
check("unrelated binary remains byte-identical", (await proof.text()) === "unchanged sentinel");
const inject = reopened.transaction("organization", "readwrite"),
  injected = complete(inject);
inject.objectStore("organization").put({ ...rows[id], futureOrganization: { keep: [1, 2, 3] } });
await injected;
reopened.close();
await m.updateShootOrganization(scope, id, { pinned: false }, { pinned: true });
rows = await m.listShootOrganization(scope);
check(
  "unknown organization fields survive patch",
  JSON.stringify(rows[id].futureOrganization) === '{"keep":[1,2,3]}',
);
const originalPut = IDBObjectStore.prototype.put;
let rejected = false;
try {
  IDBObjectStore.prototype.put = function (value, ...args) {
    const result = originalPut.call(this, value, ...args);
    if (this.name === "organization" && this.transaction.db.name === dbName)
      this.transaction.abort();
    return result;
  };
  try {
    await m.updateShootOrganization(scope, id, { archived: true });
  } catch {
    rejected = true;
  }
} finally {
  IDBObjectStore.prototype.put = originalPut;
}
check("aborted transaction reports failure", rejected);
check("failed archive did not persist", !(await m.listShootOrganization(scope))[id].archived);
await m.rememberShoot(scope, id, 338, "Automatic title");
const updated = (await m.listRecentShoots(scope))[0];
check(
  "ordinary directory updates preserve unknown source fields",
  JSON.stringify(updated.future) === '{"retain":["yes"]}',
);
check(
  "ordinary directory updates do not rewrite organization",
  !(await m.listShootOrganization(scope))[id].archived,
);
return {
  passed: checks.length,
  checks,
  isolatedQaAccounts: [scope, otherScope],
  sourceLibrariesTouched: false,
};
