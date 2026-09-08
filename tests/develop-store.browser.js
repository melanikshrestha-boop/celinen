/*
 * Async browser-eval body. Run against the local Vite app in an isolated QA profile.
 * Writes only unique qa-develop-* namespaces in the separate FOTO Develop database.
 * No customer files, Studio sessions, or other storage namespaces are modified.
 */
if (!["localhost", "127.0.0.1"].includes(location.hostname)) throw new Error("Develop storage checks require a local QA origin.");
const module = await import("/src/lib/develop/store.ts");
const { defaultDevelopSettings } = await import("/src/lib/develop/contract.ts");
const scope = `qa-develop-${crypto.randomUUID()}`;
const a = module.createDevelopStore({ scope, libraryId: "one" });
const b = module.createDevelopStore({ scope, libraryId: "one" });
const otherProject = module.createDevelopStore({ scope, libraryId: "two" });
const otherScope = module.createDevelopStore({ scope: `${scope}-other`, libraryId: "one" });
const checks = [];
function check(name, condition) { if (!condition) throw new Error(name); checks.push(name); }
const changed = (doc, exposure) => module.pushHistory(doc, { ...module.currentRecipe(doc), exposure }, "Exposure");
const writes = [];
const originalPut = IDBObjectStore.prototype.put;
try {
  const first = await module.developPhotoFromFile(new File(["QA source A"], "same-name.jpg", { type: "image/jpeg", lastModified: 1 }));
  const second = await module.developPhotoFromFile(new File(["QA source B"], "same-name.jpg", { type: "image/jpeg", lastModified: 1 }));
  check("same-name originals have different content identities", first.id !== second.id);
  await a.addPhotos([first, second]);
  let loaded = await a.loadLibrary();
  check("two original blobs and neutral documents commit together", loaded.photos.length === 2 && Object.keys(loaded.documents).length === 2 && loaded.photos.every((photo) => photo.sourceAvailable));
  check("stored original bytes survive structured clone", await loaded.photos.find((photo) => photo.id === first.id).sourceBlob.text() === "QA source A");
  check("project and account scopes remain isolated", (await otherProject.loadLibrary()).photos.length === 0 && (await otherScope.loadLibrary()).photos.length === 0);

  const stale = (await b.loadLibrary()).documents[first.id];
  const saved = await a.saveDocument(changed(loaded.documents[first.id], 1));
  check("successful transaction increments the saved revision", saved.revision === 1);
  let conflict = null;
  try { await b.saveDocument(changed(stale, 2)); } catch (error) { conflict = error; }
  check("a stale competing writer is rejected without overwriting", conflict instanceof module.DevelopSaveConflict && module.currentRecipe((await a.loadLibrary()).documents[first.id]).exposure === 1);

  loaded = await a.loadLibrary();
  const batchStale = loaded.documents[first.id];
  await b.saveDocument(changed(batchStale, 2));
  let batchConflict = null;
  try { await a.saveDocuments([{ document: changed(batchStale, 3) }, { document: changed(loaded.documents[second.id], 3) }]); } catch (error) { batchConflict = error; }
  loaded = await a.loadLibrary();
  check("one conflict aborts an entire multi-photo sync transaction", batchConflict instanceof module.DevelopSaveConflict && module.currentRecipe(loaded.documents[first.id]).exposure === 2 && module.currentRecipe(loaded.documents[second.id]).exposure === 0);

  const withSnapshot = module.addSnapshot(loaded.documents[first.id], "Saved treatment");
  await a.saveDocument(module.undoHistory(withSnapshot));
  loaded = await b.loadLibrary();
  const persisted = loaded.documents[first.id];
  check("undo cursor and named snapshot survive reload", module.currentRecipe(persisted).exposure === 1 && persisted.snapshots[0].settings.exposure === 2 && module.currentRecipe(module.redoHistory(persisted)).exposure === 2);

  await a.addPhotos([first]);
  loaded = await a.loadLibrary();
  check("reimport preserves existing edits, history, snapshots and original", loaded.photos.length === 2 && loaded.documents[first.id].revision === persisted.revision && loaded.documents[first.id].snapshots.length === 1 && await loaded.photos.find((photo) => photo.id === first.id).sourceBlob.text() === "QA source A");

  const seeded = { ...first, id: "studio:qa-seeded", initialState: { settings: { ...defaultDevelopSettings(), exposure: 0.5, temperature: 15 }, metadata: { rating: 4, flag: "pick", colorLabel: "green" } } };
  await a.addPhotos([seeded]);
  loaded = await a.loadLibrary();
  check("first Studio import seeds settings and explicit review metadata", module.currentRecipe(loaded.documents[seeded.id]).exposure === 0.5 && loaded.documents[seeded.id].metadata.rating === 4 && loaded.documents[seeded.id].metadata.flag === "pick");
  check("media records do not duplicate initial edit recipes", !Object.prototype.hasOwnProperty.call(loaded.photos.find(photo => photo.id === seeded.id), "initialState"));
  const developEdit = await a.saveDocument(changed(loaded.documents[seeded.id], 2.5));
  await a.addPhotos([{ ...seeded, initialState: { settings: { ...defaultDevelopSettings(), exposure: -2 }, metadata: { rating: 1, flag: "reject", colorLabel: "red" } } }]);
  loaded = await a.loadLibrary();
  check("later Studio imports cannot replace Develop history or metadata", module.currentRecipe(loaded.documents[seeded.id]).exposure === 2.5 && loaded.documents[seeded.id].revision === developEdit.revision && loaded.documents[seeded.id].metadata.rating === 4 && loaded.documents[seeded.id].metadata.flag === "pick");

  const previewOnly = { ...first, id: "studio:qa-preview", sourceBlob: null, previewBlob: new Blob(["QA preview"], { type: "image/jpeg" }), sourceDigest: null };
  await a.addPhotos([previewOnly]);
  loaded = await a.loadLibrary();
  check("restored previews are honestly marked preview-only", !loaded.photos.find((photo) => photo.id === previewOnly.id).sourceAvailable);
  await a.saveDocument(changed(loaded.documents[previewOnly.id], 0.5));
  await a.addPhotos([{ ...previewOnly, sourceBlob: first.sourceBlob, sourceDigest: first.sourceDigest }]);
  loaded = await a.loadLibrary();
  check("reconnecting an original preserves its existing recipe", loaded.photos.find((photo) => photo.id === previewOnly.id).sourceAvailable && module.currentRecipe(loaded.documents[previewOnly.id]).exposure === 0.5);

  const preset = await a.savePreset(module.createDevelopPreset("QA saved preset", defaultDevelopSettings()));
  check("presets are shared within a workspace but not across accounts", (await otherProject.loadLibrary()).presets[0]?.id === preset.id && (await otherScope.loadLibrary()).presets.length === 0);
  let presetConflict = null;
  try { await b.savePreset({ ...preset, name: "Stale preset" }, 0); } catch (error) { presetConflict = error; }
  check("preset writes use the same optimistic revision boundary", presetConflict instanceof module.DevelopSaveConflict);

  loaded = await a.loadLibrary();
  const beforeFailureA = loaded.documents[first.id], beforeFailureB = loaded.documents[second.id];
  IDBObjectStore.prototype.put = function(value, ...args) {
    if (value?.namespace === a.namespace && value?.value?.photoId === second.id) throw new DOMException("QA quota injection", "QuotaExceededError");
    if (value?.namespace === a.namespace) writes.push(value.key);
    return originalPut.call(this, value, ...args);
  };
  let quotaFailure = null;
  try { await a.saveDocuments([{ document: changed(beforeFailureA, 4) }, { document: changed(beforeFailureB, 4) }]); } catch (error) { quotaFailure = error; }
  IDBObjectStore.prototype.put = originalPut;
  loaded = await b.loadLibrary();
  check("injected quota failure reports failure after a prior write was queued", writes.length > 0 && quotaFailure instanceof module.DevelopStorageUnavailable);
  check("aborted storage batch leaves no partial edit revisions", loaded.documents[first.id].revision === beforeFailureA.revision && loaded.documents[second.id].revision === beforeFailureB.revision);

  const raceDocument = loaded.documents[first.id];
  const race = await Promise.allSettled([a.saveDocument(changed(raceDocument, 3)), b.saveDocument(changed(raceDocument, -3))]);
  check("simultaneous writers produce one commit and one explicit conflict", race.filter((result) => result.status === "fulfilled").length === 1 && race.filter((result) => result.status === "rejected" && result.reason instanceof module.DevelopSaveConflict).length === 1);

  return { passed: checks.length, checks, browser: navigator.userAgent, scope, note: "Synthetic storage fixtures; not photographic processing, native pixels, quota exhaustion, or crash-recovery proof." };
} finally {
  IDBObjectStore.prototype.put = originalPut;
  a.close(); b.close(); otherProject.close(); otherScope.close();
}
