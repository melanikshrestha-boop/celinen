/*
 * Async browser-eval body for an isolated local QA tab. Uses the real IndexedDB
 * implementation with fresh UUID account/shoot namespaces only. It never opens
 * a customer shoot and removes only the synthetic databases it creates.
 */
if (!["localhost", "127.0.0.1"].includes(location.hostname))
  throw new Error("Studio snapshot checks require a local QA origin.");
const studio = await import("/src/lib/studio/session.ts");
const { studioDatabaseKey } = await import("/src/lib/studio/shoot-directory.ts");
const account = crypto.randomUUID();
const checks = [], databases = [], urls = [];
function check(name, condition) {
  if (!condition) throw new Error(name);
  checks.push(name);
}
const request = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
async function withDatabase(shootId, callback) {
  const name = studioDatabaseKey(account, shootId);
  if (!databases.includes(name)) databases.push(name);
  const opening = indexedDB.open(name, 2);
  opening.onupgradeneeded = () => {
    opening.result.createObjectStore("sessions", { keyPath: "id" });
    opening.result.createObjectStore("shots", { keyPath: "id" });
  };
  const db = await request(opening);
  try { return await callback(db); } finally { db.close(); }
}
function record(exposure) {
  return {
    id: "qa-frame", name: "readonly-fixture.jpg", isRaw: false,
    previewBlob: new Blob(["synthetic preview"], { type: "image/jpeg" }),
    sourceAvailable: false, width: 1, height: 1, sizeMb: 0.001,
    sharpness: 0, brightness: 0.5, clippedHighlights: 0, clippedShadows: 0,
    hash: "qa", score: 0, flags: [], verdict: "undecided",
    edits: { exposure, contrast: 0, temp: 0, saturation: 0, highlights: 0, shadows: 0, crop: "orig" },
  };
}
async function seed(shootId, revision, exposure, mode = "frame") {
  await withDatabase(shootId, async (db) => {
    const tx = db.transaction(["sessions", "shots"], "readwrite");
    const completed = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    const sessions = tx.objectStore("sessions"), shots = tx.objectStore("shots");
    if (mode === "absent") sessions.delete("active");
    else sessions.put({
      id: "active", revision, writerId: "qa-external-writer",
      shotIds: mode === "empty" ? [] : mode === "missing" ? ["missing-frame"] : ["qa-frame"],
      selectedId: "qa-frame", filter: "all", updatedAt: Date.now(),
    });
    if (mode === "frame") shots.put(record(exposure));
    await completed;
  });
}
function retain(session) {
  for (const shot of session?.shots ?? []) if (shot.previewUrl) urls.push(shot.previewUrl);
  return session;
}
async function snapshot(shootId) {
  return retain(await studio.readStudioSessionSnapshot(account, shootId));
}
async function ownerLoad(shootId) {
  return retain(await studio.loadStudioSession(account, shootId));
}
async function saved(shootId) {
  return withDatabase(shootId, async (db) => {
    const tx = db.transaction(["sessions", "shots"], "readonly");
    return Promise.all([
      request(tx.objectStore("sessions").get("active")),
      request(tx.objectStore("shots").get("qa-frame")),
    ]);
  });
}
async function staleSave(session, shootId) {
  try {
    await studio.saveStudioSession(session.shots, session.selectedId, session.filter, account, shootId);
    return null;
  } catch (error) { return error; }
}
try {
  const changed = crypto.randomUUID();
  await seed(changed, 1, 10);
  const stale = await ownerLoad(changed);
  await seed(changed, 2, 75);
  const read = await snapshot(changed);
  check("snapshot hydrates the latest external edit and honest preview source", read.shots[0].edits.exposure === 75 && !read.shots[0].sourceAvailable && await read.shots[0].file.text() === "synthetic preview");
  check("snapshot owns independent disposable preview URLs", read.shots[0].previewUrl !== stale.shots[0].previewUrl);
  check("read-only hydration cannot acknowledge another tab's revision", await staleSave(stale, changed) instanceof studio.StudioSaveConflict);
  let clearFailure = null;
  try { await studio.clearStudioSession({ scope: account, shootId: changed }); } catch (error) { clearFailure = error; }
  check("read-only hydration cannot authorize a stale clear", clearFailure instanceof Error && clearFailure.message.includes("changed in another tab"));
  const [keptSession, keptShot] = await saved(changed);
  check("rejected save and clear preserve the external revision and pixels", keptSession.revision === 2 && keptShot.edits.exposure === 75 && await keptShot.previewBlob.text() === "synthetic preview");

  const refreshed = await ownerLoad(changed);
  refreshed.shots[0].edits.exposure = 40;
  await studio.saveStudioSession(refreshed.shots, refreshed.selectedId, refreshed.filter, account, changed);
  const [acknowledged, edited] = await saved(changed);
  check("normal owner hydration still acknowledges a revision and allows a save", acknowledged.revision === 3 && edited.edits.exposure === 40);

  for (const mode of ["empty", "absent", "missing"]) {
    const id = crypto.randomUUID();
    await seed(id, 4, 12);
    const old = await ownerLoad(id);
    await seed(id, 5, 99, mode);
    let result, failed = null;
    try { result = await snapshot(id); } catch (error) { failed = error; }
    check(`${mode} snapshot preserves existing validation`, mode === "missing" ? failed instanceof Error && failed.message.includes("missing frame records") : result === null && failed === null);
    check(`${mode} snapshot cannot rebase a stale Studio writer`, await staleSave(old, id) instanceof studio.StudioSaveConflict);
    const [after] = await saved(id);
    check(`${mode} snapshot/save leaves the external session untouched`, mode === "absent" ? after === undefined : after.revision === 5 && (mode !== "empty" || after.shotIds.length === 0));
  }

  const firstRead = crypto.randomUUID();
  await seed(firstRead, 7, 20);
  const unowned = await snapshot(firstRead);
  check("a tool's first read never establishes a new Studio writer baseline", await staleSave(unowned, firstRead) instanceof studio.StudioSaveConflict);
  return { passed: checks.length, checks, browser: navigator.userAgent, note: "Real IndexedDB; synthetic isolated account and shoots. No customer data or image processing involved." };
} finally {
  for (const url of urls) URL.revokeObjectURL(url);
  for (const name of databases) await request(indexedDB.deleteDatabase(name));
}
