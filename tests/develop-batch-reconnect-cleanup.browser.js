// Audit first. To remove only this turn's disposable fixtures, set
// globalThis.fotoBatchReconnectCleanupApply=true and rerun on /shoots (Develop unmounted).
if (
  location.origin !== "http://127.0.0.1:8085" ||
  location.pathname !== "/shoots" ||
  location.search ||
  document.querySelector(".foto-develop")
)
  throw new Error("Unmount Develop on local /shoots before cleanup.");
const apply = globalThis.fotoBatchReconnectCleanupApply === true;
delete globalThis.fotoBatchReconnectCleanupApply;
const shoots = ["eeaf3000-1111-4222-8333-000000000101", "eeaf3000-1111-4222-8333-000000000102"];
const namespace = (shoot) => JSON.stringify(["device-local", `shoot:${shoot}`]);
const key = (shoot, id) => JSON.stringify(["device-local", `shoot:${shoot}`, id]);
const request = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
const hash = async (blob) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
const snapshot = (records) =>
  JSON.stringify(records, (_key, value) =>
    value instanceof Blob ? { bytes: value.size, type: value.type } : value,
  );
const baselines = shoots.map((shoot, i) =>
  JSON.parse(
    sessionStorage.getItem(`foto:qa:${i ? "reconnect-races" : "batch-reconnect"}:${shoot}`) ||
      "null",
  ),
);
if (baselines.some((value) => !value))
  throw new Error("Both fixture ownership markers are required.");
const ids = [Object.keys(baselines[0].expected), baselines[1].ids];
if (
  ids[0].length !== 337 ||
  ids[0].some((id, i) => id !== `studio:qa-batch-reconnect-${i}`) ||
  JSON.stringify(ids[1]) !==
    JSON.stringify(["studio:qa-race-stale", "studio:qa-race-atomic", "studio:qa-race-cancel"])
)
  throw new Error("Fixture IDs differ.");
const db = await new Promise((resolve, reject) => {
  const open = indexedDB.open("foto-develop-v1");
  open.onupgradeneeded = () => open.transaction.abort();
  open.onerror = () => reject(open.error);
  open.onsuccess = () => resolve(open.result);
});
const read = async (tx, shoot) => {
  const [photos, documents] = await Promise.all(
    ["photos", "documents"].map((name) =>
      request(tx.objectStore(name).index("namespace").getAll(namespace(shoot))),
    ),
  );
  return { photos, documents };
};
const validate = (records, i) => {
  if (records.photos.length !== ids[i].length || records.documents.length !== ids[i].length)
    throw new Error("Fixture count changed.");
  for (const kind of ["photos", "documents"]) {
    for (const record of records[kind]) {
      const id = kind === "photos" ? record.value.id : record.value.photoId;
      if (
        !ids[i].includes(id) ||
        record.key !== key(shoots[i], id) ||
        record.namespace !== namespace(shoots[i])
      )
        throw new Error("Non-QA record found.");
      if (
        !i &&
        kind === "documents" &&
        JSON.stringify(record.value) !== JSON.stringify(baselines[0].documents[id])
      )
        throw new Error("QA edits changed since verification.");
    }
  }
};
try {
  const audits = [];
  for (let i = 0; i < shoots.length; i++) {
    const records = await read(db.transaction(["photos", "documents"], "readonly"), shoots[i]);
    validate(records, i);
    let originals = 0;
    for (const { value } of records.photos) {
      if (value.sourceBlob?.size) {
        originals++;
        const digest = await hash(value.sourceBlob);
        if (
          i
            ? !baselines[1].hashes.includes(digest)
            : `sha256:${digest}` !== baselines[0].expected[value.id].digest
        )
          throw new Error("Original bytes differ from the public/synthetic fixture.");
      }
    }
    if (originals !== 3)
      throw new Error("Exactly three tested originals per namespace are required.");
    audits.push({ records, snapshot: snapshot(records) });
  }
  if (!apply)
    return {
      audited: true,
      photos: 340,
      documents: 340,
      originals: 6,
      namespaces: shoots.map(namespace),
      deleted: false,
    };
  const tx = db.transaction(["photos", "documents"], "readwrite");
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new Error("Cleanup aborted."));
  });
  void done.catch(() => {});
  try {
    const current = await Promise.all(shoots.map((shoot) => read(tx, shoot)));
    current.forEach((records, i) => {
      validate(records, i);
      if (snapshot(records) !== audits[i].snapshot)
        throw new Error("Fixture changed after audit; nothing removed.");
    });
    shoots.forEach((shoot, i) =>
      ids[i].forEach((id) => {
        tx.objectStore("photos").delete(key(shoot, id));
        tx.objectStore("documents").delete(key(shoot, id));
      }),
    );
    await done;
  } catch (error) {
    try {
      tx.abort();
    } catch {}
    throw error;
  }
  const after = await Promise.all(
    shoots.map((shoot) => read(db.transaction(["photos", "documents"], "readonly"), shoot)),
  );
  if (after.some((records) => records.photos.length || records.documents.length))
    throw new Error("Fixture cleanup readback failed.");
  return {
    deleted: true,
    photos: 340,
    documents: 340,
    readback: "Both QA namespaces empty. Customer namespaces never accessed.",
  };
} finally {
  db.close();
}
