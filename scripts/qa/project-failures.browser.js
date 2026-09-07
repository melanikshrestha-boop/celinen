/**
 * Browser eval body, not a Node/module entry point. Run with gstack browse eval.
 * Use only an isolated 127.0.0.1 development QA profile after creating/restoring
 * the exact fixture project "QA real photo project — R1". Never run on a user shoot.
 * This deliberately appends a QA brief checkpoint and advances that project's
 * revision. It also temporarily injects a quota failure into IndexedDB writes.
 * See README.md before running. The original body passed browser QA on 2026-09-04.
 */
if (location.hostname !== "127.0.0.1") throw new Error("Recovery QA origin only");

const r = await import("/src/lib/projects/repository.ts");
const a = await import("/src/lib/projects/archive.ts");
const s = await import("/src/lib/projects/studio-adapter.ts");
const m = await import("/src/lib/projects/model.ts");
const p = (await r.listProjects()).find((p) => p.title === "QA real photo project — R1");
if (!p) throw new Error("QA project missing");

const b = await r.readProjectBlobs(p);
const pack = await a.createProjectArchive(p, b);
const parsed = await a.parseProjectArchive(pack);
const repeat = await r.commitProject(m.validateProject(parsed.document), parsed.blobs, {
  restore: true,
});
if (JSON.stringify(repeat) !== JSON.stringify(p))
  throw new Error("Idempotent restore altered document");

// Corrupt an in-memory archive copy, never the stored original or downloaded backup.
const bytes = new Uint8Array(await pack.arrayBuffer());
bytes[bytes.length - 1] ^= 1;
let corruption = "";
try {
  await a.parseProjectArchive(new Blob([bytes]));
  throw new Error("Corruption accepted");
} catch (e) {
  corruption = e.message;
  if (corruption === "Corruption accepted") throw e;
}

const snapshot = async () => {
  const db = await r.idbRequest(indexedDB.open("lenslabs-projects-v1", 1));
  try {
    const tx = db.transaction(["projects", "blobs"]);
    return {
      projects: (await r.idbRequest(tx.objectStore("projects").getAllKeys())).map(String).sort(),
      blobs: (await r.idbRequest(tx.objectStore("blobs").getAllKeys())).map(String).sort(),
    };
  } finally {
    db.close();
  }
};
const before = await snapshot();
const hydrated = await s.hydrateProject(p, b);
const seed = {
  ...hydrated.shots[0],
  id: "qa-atomic-failure",
  name: "qa-only.bin",
  file: new File(["QA only storage failure test"], "qa-only.bin"),
  previewBlob: undefined,
  previewUrl: null,
};
const fresh = m.newProject({
  title: "QA transaction must not persist",
  genre: "personal",
  brief: "",
  clientId: null,
  bookingId: null,
  invoiceIds: [],
  galleryIds: [],
});
const captured = await s.captureProject(fresh, [seed], seed.id, "all");

let missing = "";
try {
  await r.commitProject(captured.project, new Map(), { create: true });
  throw new Error("Missing media accepted");
} catch (e) {
  missing = e.message;
  if (missing === "Missing media accepted") throw e;
}

// Fail at the document write, after source-media writes have been queued in the transaction.
const put = IDBObjectStore.prototype.put;
let quota = "";
try {
  IDBObjectStore.prototype.put = function (...args) {
    if (this.name === "projects")
      throw new DOMException("QA injected quota failure", "QuotaExceededError");
    return put.apply(this, args);
  };
  await r.commitProject(captured.project, captured.blobs, { create: true });
  throw new Error("Quota injection did not reject");
} catch (e) {
  quota = e.message;
  if (quota === "Quota injection did not reject") throw e;
} finally {
  IDBObjectStore.prototype.put = put;
  for (const shot of hydrated.shots) if (shot.previewUrl) URL.revokeObjectURL(shot.previewUrl);
}
if (JSON.stringify(before) !== JSON.stringify(await snapshot()))
  throw new Error("Failed transaction left partial records or media");

// Intentional durable QA mutation: keep the newer document, then reject two stale writes.
const competing = {
  ...p,
  brief: p.brief + "\nQA competing writer checkpoint.",
  activity: [...p.activity, m.activity("QA concurrency", "Recovery-origin only")],
};
const newer = await r.commitProject(competing);
let stale = "";
try {
  await r.commitProject(p);
  throw new Error("Stale revision accepted");
} catch (e) {
  stale = e.message;
  if (stale === "Stale revision accepted") throw e;
}
let conflict = "";
try {
  await r.commitProject(p, b, { restore: true });
  throw new Error("Conflicting restore accepted");
} catch (e) {
  conflict = e.message;
  if (conflict === "Conflicting restore accepted") throw e;
}
if (JSON.stringify(await r.loadProject(p.id)) !== JSON.stringify(newer))
  throw new Error("A rejected operation overwrote newer work");

return {
  idempotentRestore: true,
  corruptionRejected: corruption,
  missingMediaRejected: missing,
  simulatedQuotaRejected: quota,
  transactionLeftNoPartialRecords: true,
  staleWriterRejected: stale,
  conflictingRestoreRejected: conflict,
  newerWorkUnchanged: true,
};
