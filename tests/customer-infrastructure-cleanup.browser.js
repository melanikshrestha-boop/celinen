/* Removes only this run's exact synthetic QA records; never deletes a database.
 * Original finance/client states were null, original shoot rows are preserved. */
return await (async () => {
  const key = "foto:qa:customer-infrastructure";
  const meta = JSON.parse(sessionStorage.getItem(key) ?? "null");
  if (
    location.origin !== "http://127.0.0.1:8085" ||
    meta?.shootId !== "eeaf3000-1111-4222-8333-000000000071"
  )
    throw new Error("No recognized QA run to restore.");
  if (
    meta.financeKey !== "lenslabs.local-finance.v1" ||
    meta.clientKey !== "lenslabs.client-workspace.v1" ||
    localStorage.getItem(meta.financeKey) !== meta.fixture ||
    localStorage.getItem(meta.clientKey) !== meta.clients
  )
    throw new Error("QA data changed unexpectedly; refusing cleanup.");
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open("lenslabs-shoot-directory-v1");
    r.onupgradeneeded = () => {
      r.transaction.abort();
      reject(new Error("Missing directory"));
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  try {
    const transaction = db.transaction("shoots", "readwrite"),
      store = transaction.objectStore("shoots");
    const done = new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
    });
    void done.catch(() => {});
    const rows = await new Promise((resolve, reject) => {
      const r = store.getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const fixture = rows.find((r) => r.id === meta.shootId),
      others = rows.filter((r) => r.id !== meta.shootId);
    if (
      !fixture ||
      fixture.title !== "QA Portrait Session" ||
      fixture.count !== 0 ||
      fixture.recoveryPending ||
      JSON.stringify(others) !== JSON.stringify(meta.beforeShoots)
    ) {
      transaction.abort();
      await done.catch(() => {});
      throw new Error("Shoot directory changed; no cleanup performed.");
    }
    store.delete(meta.shootId);
    await done;
  } finally {
    db.close();
  }
  localStorage.removeItem(meta.financeKey);
  if (meta.clients !== null) localStorage.removeItem(meta.clientKey);
  sessionStorage.removeItem(key);
  window.dispatchEvent(new Event("foto:earnings-changed"));
  window.dispatchEvent(new StorageEvent("storage", { key: meta.clientKey }));
  window.dispatchEvent(new Event("lenslabs:shoots-changed"));
  return "Restored original empty finance/client stores; removed only QA shoot 071. All pre-existing shoots preserved. No real customer data touched.";
})();
