// Async browse-eval body, newer local editor only. No customer namespaces.
// install -> upload the three named public fixtures through Import photos ->
// report -> cleanup. Use a fresh reserved shoot ending 105..110 per timing run.
// Set globalThis.fotoImportPhase to select a phase (default install).
const match = location.pathname.match(/^\/shoots\/(eeaf3000-1111-4222-8333-0000000001(?:0[5-9]|10))\/develop$/);
if (location.origin !== "http://127.0.0.1:8085" || !match || location.search)
  throw new Error("Use a reserved 105..110 local import-timing shoot.");
const shoot = match[1];
const phase = globalThis.fotoImportPhase ?? "install";
delete globalThis.fotoImportPhase;
const module = await import("/src/lib/develop/store.ts");
const store = module.createDevelopStore({ scope: "device-local", libraryId: `shoot:${shoot}` });
const expected = [
  ["sony-a6000.ARW", 25624576, "ce8b4957281a817d52a07a691e2468567b6c78223bd0b514ffc1c65b002b8d89"],
  ["sony-a7iv-small.ARW", 22933504, "cbbd0930c7d8706dff84c68a2004454266e6fd0d8354f5f76a106b5d776e0223"],
  ["volleyball-portrait-cc0.jpg", 3148228, "5685e8468969ca05da9de250f5848df5318e6b47b1a14d4aebd5c19675224fce"],
];
const key = `foto:qa:import-phases:${shoot}`;
const root = () => document.querySelector(".foto-develop");
const button = (label) => [...(root()?.querySelectorAll("button") ?? [])].find(
  (b) => b.getAttribute("aria-label") === label || b.textContent.trim() === label,
);
const hash = async (blob) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
  .map((b) => b.toString(16).padStart(2, "0")).join("");
const wait = async (predicate, message, ms = 45000) => {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
};
const check = (label, condition) => { if (!condition) throw new Error(label); };

if (phase === "install") {
  const library = await store.loadLibrary();
  if (library.photos.length || Object.keys(library.documents).length || sessionStorage.getItem(key))
    throw new Error("Timing requires a fresh empty QA shoot.");
  await wait(() => button("Import")?.disabled === false, "Import chooser unavailable");
  const state = {
    shoot, started: null, firstThumbnailMs: null, allThumbnailsMs: null,
    importFinishedMs: null, editorReadyMs: null, maxFrameGapMs: 0,
    reads: [], hashes: [], renders: [], bitmaps: [], writes: [], opens: [], longTasks: [],
  };
  globalThis.fotoImportPhases = state;
  const original = {
    read: FileReader.prototype.readAsArrayBuffer,
    digest: crypto.subtle.digest, fetch: window.fetch, bitmap: window.createImageBitmap,
    transaction: IDBDatabase.prototype.transaction, put: IDBObjectStore.prototype.put,
    add: IDBObjectStore.prototype.add, open: indexedDB.open, createURL: URL.createObjectURL,
  };
  const blobs = new Map(), transactions = new WeakMap();
  globalThis.fotoImportPhaseBlobs = blobs;
  const clock = () => performance.now() - state.started;
  const chooser = root().querySelector('input[type="file"][aria-label="Import photos"]');
  const begin = () => {
    check("wrong public fixture selection", chooser.files.length === 3 && expected.every(
      ([name, size], i) => chooser.files[i].name === name && chooser.files[i].size === size,
    ));
    state.started = performance.now();
  };
  chooser.addEventListener("change", begin, { capture: true, once: true });
  FileReader.prototype.readAsArrayBuffer = function (file) {
    if (state.started !== null && file instanceof File && expected.some(([name]) => name === file.name)) {
      const record = { name: file.name, startMs: clock(), durationMs: null };
      state.reads.push(record);
      this.addEventListener("loadend", () => { record.durationMs = clock() - record.startMs; }, { once: true });
    }
    return original.read.call(this, file);
  };
  crypto.subtle.digest = function (algorithm, bytes) {
    const file = state.started !== null && expected.find(([, size]) => size === bytes.byteLength);
    const record = { name: file?.[0], startMs: clock(), durationMs: null };
    if (file) state.hashes.push(record);
    return original.digest.call(this, algorithm, bytes).finally(() => {
      if (file) record.durationMs = clock() - record.startMs;
    });
  };
  window.fetch = function (input, options) {
    const tracked = state.started !== null && input === "/__develop/render" && options?.body instanceof Blob;
    const record = { startMs: clock(), durationMs: null, status: null, mode: null, edge: null, name: null };
    if (tracked) {
      state.renders.push(record);
      void options.body.slice(0, 4).arrayBuffer().then(async (bytes) => {
        const length = new DataView(bytes).getUint32(0, false);
        const header = JSON.parse(await options.body.slice(4, 4 + length).text());
        record.mode = header.sourceMode; record.edge = header.edge;
        record.name = expected.find(([, size]) => size === options.body.size - length - 4)?.[0] ?? "other";
      });
    }
    return original.fetch.apply(this, arguments).then((response) => {
      if (tracked) { record.durationMs = clock() - record.startMs; record.status = response.status; }
      return response;
    });
  };
  window.createImageBitmap = function (input) {
    const tracked = state.started !== null && input instanceof Blob;
    const record = { bytes: input?.size, startMs: clock(), durationMs: null };
    if (tracked) state.bitmaps.push(record);
    return original.bitmap.apply(this, arguments).finally(() => {
      if (tracked) record.durationMs = clock() - record.startMs;
    });
  };
  indexedDB.open = function (name) {
    const request = original.open.apply(this, arguments);
    if (state.started !== null && name === module.DEVELOP_DATABASE_NAME) {
      const record = { startMs: clock(), durationMs: null };
      state.opens.push(record);
      request.addEventListener("success", () => { record.durationMs = clock() - record.startMs; }, { once: true });
    }
    return request;
  };
  IDBDatabase.prototype.transaction = function () {
    const tx = original.transaction.apply(this, arguments);
    if (state.started !== null && this.name === module.DEVELOP_DATABASE_NAME && tx.mode === "readwrite") {
      const record = { startMs: clock(), durationMs: null, owned: false };
      transactions.set(tx, record);
      tx.addEventListener("complete", () => {
        if (record.owned) { record.durationMs = clock() - record.startMs; state.writes.push(record); }
      }, { once: true });
    }
    return tx;
  };
  for (const operation of ["put", "add"]) IDBObjectStore.prototype[operation] = function (value) {
    const record = transactions.get(this.transaction);
    if (record && value?.namespace === store.namespace) record.owned = true;
    return original[operation].apply(this, arguments);
  };
  URL.createObjectURL = function (blob) {
    const url = original.createURL.call(URL, blob); blobs.set(url, blob); return url;
  };
  let frameId, lastFrame = null;
  const frame = (now) => {
    if (state.started !== null && lastFrame !== null) state.maxFrameGapMs = Math.max(state.maxFrameGapMs, now - lastFrame);
    lastFrame = now; frameId = requestAnimationFrame(frame);
  };
  frameId = requestAnimationFrame(frame);
  let stableSince = null;
  const interval = setInterval(() => {
    if (state.started === null) return;
    const now = clock();
    const decoded = [...root().querySelectorAll(".develop-filmstrip-items img")].filter((img) => img.naturalWidth > 0).length;
    if (decoded && state.firstThumbnailMs === null) state.firstThumbnailMs = now;
    if (decoded === 3 && state.allThumbnailsMs === null) state.allThumbnailsMs = now;
    if (!button("Stop import") && root().textContent.includes("3 photos imported") && state.importFinishedMs === null) state.importFinishedMs = now;
    const ready = state.importFinishedMs !== null && button("Remove Object")?.disabled === false &&
      root().querySelector(".develop-image-frame img")?.naturalWidth > 0 &&
      root().querySelector('.develop-histogram-control[aria-busy="false"]') &&
      root().querySelector(".develop-save-status")?.textContent === "All edits saved";
    if (!ready) stableSince = null;
    else {
      stableSince ??= now;
      if (now - stableSince >= 200) { state.editorReadyMs = stableSince; clearInterval(interval); }
    }
  }, 25);
  const observer = PerformanceObserver.supportedEntryTypes.includes("longtask") ? new PerformanceObserver((records) => {
    if (state.started !== null) for (const entry of records.getEntries())
      if (entry.startTime >= state.started) state.longTasks.push({ startMs: entry.startTime - state.started, durationMs: entry.duration });
  }) : null;
  observer?.observe({ type: "longtask", buffered: false });
  globalThis.fotoImportPhaseRestore = () => {
    FileReader.prototype.readAsArrayBuffer = original.read; crypto.subtle.digest = original.digest;
    window.fetch = original.fetch; window.createImageBitmap = original.bitmap;
    indexedDB.open = original.open; IDBDatabase.prototype.transaction = original.transaction;
    IDBObjectStore.prototype.put = original.put; IDBObjectStore.prototype.add = original.add;
    URL.createObjectURL = original.createURL;
    chooser.removeEventListener("change", begin, { capture: true });
    cancelAnimationFrame(frameId); clearInterval(interval); observer?.disconnect();
    delete globalThis.fotoImportPhaseRestore;
  };
  return { phase, shoot, next: "Upload A6000, A7IV-small, then volleyball JPEG through the real chooser." };
}

if (phase === "report") {
  const state = globalThis.fotoImportPhases;
  if (!state || state.shoot !== shoot) throw new Error("Install timing observers first");
  try {
    await wait(() => state.editorReadyMs !== null, "Three-photo import/editor did not become ready");
  } finally { globalThis.fotoImportPhaseRestore?.(); }
  const library = await store.loadLibrary();
  check("all exact public sources saved", library.photos.length === 3 && Object.keys(library.documents).length === 3);
  for (const [name, size, sha] of expected) {
    const photo = library.photos.find((p) => p.id === `sha256:${sha}`);
    check("source identity/readback mismatch", photo?.sourceFileName === name && photo.sourceBlob.size === size && await hash(photo.sourceBlob) === sha);
    check("original recipe changed", module.currentRecipe(library.documents[photo.id]).exposure === 0);
  }
  check("no unexplained native failure", state.renders.every((r) => r.status === 200));
  check("one whole-file hash per original", state.hashes.length === 3 && expected.every(([name]) => state.hashes.filter((r) => r.name === name).length === 1));
  const blobs = globalThis.fotoImportPhaseBlobs;
  const displayed = blobs.get(root().querySelector(".develop-image-frame img").src);
  state.displayedSHA256 = await hash(displayed);
  const click = HTMLAnchorElement.prototype.click;
  const createURL = URL.createObjectURL;
  let download = null;
  try {
    URL.createObjectURL = function (blob) {
      const url = createURL.call(URL, blob); blobs.set(url, blob); return url;
    };
    HTMLAnchorElement.prototype.click = function () {
      if (this.download.endsWith(".jpg")) { download = blobs.get(this.href); return; }
      return click.call(this);
    };
    button("Export").click();
    await wait(() => button("Preview export"), "Export dialog missing");
    button("Preview export").click();
    await wait(() => root().querySelector(".develop-export-proof img")?.naturalWidth > 0, "Export proof missing");
    check("proof differs from displayed image", await hash(blobs.get(root().querySelector(".develop-export-proof img").src)) === state.displayedSHA256);
    button("Export JPEG").click();
    await wait(() => download && !root().querySelector("[role=dialog]"), "Export receipt missing");
    check("download differs from displayed image", await hash(download) === state.displayedSHA256);
    state.exportMatches = true;
  } finally { HTMLAnchorElement.prototype.click = click; URL.createObjectURL = createURL; }
  state.documents = library.documents;
  sessionStorage.setItem(key, JSON.stringify(state));
  delete globalThis.fotoImportPhaseBlobs;
  return { ...state, documents: "3 exact saved documents retained in QA receipt" };
}

if (phase === "cleanup") {
  globalThis.fotoImportPhaseRestore?.();
  const state = JSON.parse(sessionStorage.getItem(key) ?? "null");
  if (state?.shoot !== shoot || !state.exportMatches) throw new Error("Complete QA receipt required before cleanup");
  const library = await store.loadLibrary();
  check("QA history changed before cleanup", JSON.stringify(library.documents) === JSON.stringify(state.documents));
  for (const photo of library.photos) check("foreign QA original", expected.some(([, , sha]) => photo.id === `sha256:${sha}`) && await hash(photo.sourceBlob) === photo.id.slice(7));
  document.querySelector(`a[href="/shoots/${shoot}"]`).click();
  await wait(() => !root(), "Editor did not unmount");
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(module.DEVELOP_DATABASE_NAME);
    request.onupgradeneeded = () => request.transaction.abort();
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  let deleted = 0;
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["photos", "documents"], "readwrite");
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error ?? new Error("QA cleanup failed"));
      for (const name of ["photos", "documents"]) {
        const target = tx.objectStore(name), request = target.index("namespace").getAllKeys(store.namespace);
        request.onsuccess = () => {
          for (const found of request.result) {
            if (!expected.some(([, , sha]) => found === JSON.stringify(["device-local", `shoot:${shoot}`, `sha256:${sha}`]))) { tx.abort(); return; }
            target.delete(found); deleted++;
          }
        };
      }
    });
  } finally { db.close(); }
  const remaining = await store.loadLibrary();
  check("QA records remain", !remaining.photos.length && !Object.keys(remaining.documents).length);
  state.cleanup = { deleted, remaining: 0 }; sessionStorage.setItem(key, JSON.stringify(state));
  return state.cleanup;
}
throw new Error("Unknown import timing phase");
