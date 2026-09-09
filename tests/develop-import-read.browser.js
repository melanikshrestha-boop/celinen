// Async browse-eval body. Reserved local QA shoot only; never customer data.
// Phases: install -> real chooser upload sony-a6000.ARW -> cancelled -> upload
// again -> verify (real JPEG drop, edit, histogram, export) -> reload -> cleanup.
// Set globalThis.fotoImportReadPhase before each eval. No native response mocks.
const shoot = "eeaf3000-1111-4222-8333-000000000104";
const path = `/shoots/${shoot}/develop`;
const key = `foto:qa:read-abort:${shoot}`;
const phase = globalThis.fotoImportReadPhase ?? "install";
delete globalThis.fotoImportReadPhase;
if (location.origin !== "http://127.0.0.1:8085" || location.pathname !== path)
  throw new Error("Use only the reserved read-abort QA shoot.");
const module = await import("/src/lib/develop/store.ts");
const store = module.createDevelopStore({ scope: "device-local", libraryId: `shoot:${shoot}` });
const hashes = {
  raw: "ce8b4957281a817d52a07a691e2468567b6c78223bd0b514ffc1c65b002b8d89",
  jpeg: "5685e8468969ca05da9de250f5848df5318e6b47b1a14d4aebd5c19675224fce",
};
const state = JSON.parse(sessionStorage.getItem(key) ?? "null") ?? { checks: [] };
state.checks = [...new Set(state.checks)];
const save = () => sessionStorage.setItem(key, JSON.stringify(state));
const check = (name, condition) => {
  if (!condition) throw new Error(name);
  if (!state.checks.includes(name)) state.checks.push(name);
  save();
};
const hash = async (blob) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
const wait = async (predicate, label, ms = 30000) => {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(label);
};
const root = () => document.querySelector(".foto-develop");
const button = (label) =>
  [...(root()?.querySelectorAll("button") ?? [])].find(
    (b) => b.textContent.trim() === label || b.getAttribute("aria-label") === label,
  );
const image = () => root()?.querySelector(".develop-image-frame img");
const ready = () =>
  !button("Stop import") && image()?.naturalWidth > 0 &&
  button("Remove Object")?.disabled === false &&
  root()?.querySelector('.develop-histogram-control[aria-busy="false"]') &&
  root()?.querySelector(".develop-save-status")?.textContent === "All edits saved";
const histogram = () =>
  [...(root()?.querySelectorAll(".develop-histogram svg path") ?? [])]
    .map((p) => p.getAttribute("d")).join("|");

if (phase === "install") {
  const library = await store.loadLibrary();
  if (library.photos.length || Object.keys(library.documents).length || state.started)
    throw new Error("Read-abort fixture must start in its empty reserved namespace.");
  await wait(() => button("Import") && !button("Import").disabled, "Import chooser missing");
  state.started = true;
  state.events = [];
  state.hashCalls = 0;
  state.nativeCalls = 0;
  const proto = FileReader.prototype;
  const originalRead = proto.readAsArrayBuffer;
  const originalAbort = proto.abort;
  const originalDigest = crypto.subtle.digest;
  const originalFetch = window.fetch;
  let observed = null;
  proto.readAsArrayBuffer = function (blob) {
    if (blob instanceof File && blob.name === "sony-a6000.ARW" && !observed) {
      if (blob.size !== 25624576) throw new Error("Unexpected RAW fixture size");
      observed = this;
      this.addEventListener("loadstart", () => {
        state.events.push("real-read-start");
        state.loadingAtStop = this.readyState === FileReader.LOADING;
        const stop = button("Stop import");
        state.stopVisible = Boolean(stop && !stop.disabled);
        state.stopAt = performance.now();
        stop?.click();
        save();
      }, { once: true });
    }
    return originalRead.call(this, blob);
  };
  proto.abort = function () {
    const result = originalAbort.call(this);
    if (this === observed) {
      state.events.push("real-read-abort");
      state.readerDone = this.readyState === FileReader.DONE && this.result === null;
      state.abortMs = performance.now() - state.stopAt;
      save();
    }
    return result;
  };
  crypto.subtle.digest = function (algorithm, bytes) {
    if (bytes.byteLength === 25624576) state.hashCalls++;
    return originalDigest.call(this, algorithm, bytes);
  };
  window.fetch = function (input) {
    if (input === "/__develop/render") state.nativeCalls++;
    return originalFetch.apply(this, arguments);
  };
  globalThis.fotoImportReadRestore = () => {
    proto.readAsArrayBuffer = originalRead;
    proto.abort = originalAbort;
    crypto.subtle.digest = originalDigest;
    window.fetch = originalFetch;
    delete globalThis.fotoImportReadRestore;
  };
  save();
  return { phase, next: "Upload the public sony-a6000.ARW through Import photos, then run cancelled." };
}

if (phase === "cancelled") {
  try {
    await wait(() => !button("Stop import"), "Stop never released import", 5000);
    // Observers close over the persisted state from install.
    Object.assign(state, JSON.parse(sessionStorage.getItem(key)));
    check("real chooser Stop reached a LOADING native FileReader", state.stopVisible && state.loadingAtStop);
    check("actual reader.abort finished before import released", state.readerDone && state.events.join(",") === "real-read-start,real-read-abort");
    check("cancelled read never entered full-file hashing or native decode", state.hashCalls === 0 && state.nativeCalls === 0);
    const library = await store.loadLibrary();
    check("cancelled read left no photo or edit document", !library.photos.length && !Object.keys(library.documents).length);
    check("Import is immediately available for retry", button("Import")?.disabled === false);
    check("UI reports cancellation, not a completed upload", root().textContent.includes("Import stopped"));
  } finally {
    globalThis.fotoImportReadRestore?.();
  }
  // Capture actual rendered and exported Blobs without fetching CSP-blocked blob: URLs.
  const createURL = URL.createObjectURL;
  const blobs = new Map();
  URL.createObjectURL = function (blob) {
    const url = createURL.call(URL, blob);
    blobs.set(url, blob);
    return url;
  };
  globalThis.fotoImportReadBlobs = blobs;
  globalThis.fotoImportReadURLRestore = () => {
    URL.createObjectURL = createURL;
    delete globalThis.fotoImportReadBlobs;
    delete globalThis.fotoImportReadURLRestore;
  };
  return { phase, checks: state.checks, abortMs: state.abortMs, next: "Retry the same RAW chooser upload, then run verify." };
}

if (phase === "verify") {
  const anchorClick = HTMLAnchorElement.prototype.click;
  try {
    await wait(ready, "Retried RAW import did not finish", 45000);
    let library = await store.loadLibrary();
    check("retry imports the same exact RAW source identity", library.photos.length === 1 && library.photos[0].id === `sha256:${hashes.raw}` && await hash(library.photos[0].sourceBlob) === hashes.raw);
    const rawDocument = JSON.stringify(library.documents[`sha256:${hashes.raw}`]);
    const response = await fetch("/tests/fixtures/photos/volleyball-portrait-cc0.jpg");
    if (!response.ok) throw new Error("Public JPEG fixture unavailable");
    const jpeg = await response.blob();
    check("drop fixture matches its public source hash", await hash(jpeg) === hashes.jpeg);
    const transfer = new DataTransfer();
    transfer.items.add(new File(["intentionally corrupt QA JPEG"], "qa-corrupt.jpg", { type: "image/jpeg" }));
    transfer.items.add(new File([jpeg], "volleyball-portrait-cc0.jpg", { type: "image/jpeg" }));
    root().dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    await wait(async () => (await store.loadLibrary()).photos.length === 2 && ready(), "Mixed drop failed to import the valid JPEG", 45000);
    library = await store.loadLibrary();
    check("bad dropped photo does not block or persist beside the valid photo", library.photos.length === 2 && library.photos.every((p) => Object.values(hashes).some((h) => p.id === `sha256:${h}`)) && root().textContent.includes("qa-corrupt.jpg"));
    check("drop preserves the existing RAW edits exactly", JSON.stringify(library.documents[`sha256:${hashes.raw}`]) === rawDocument);
    const blobs = globalThis.fotoImportReadBlobs;
    const before = image().src;
    await wait(() => histogram().length > 0, "Histogram did not load");
    const beforeHistogram = histogram();
    const beforeHash = await hash(blobs.get(before));
    const exposure = root().querySelector('input[aria-label="Exposure value"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(exposure, "0.75");
    exposure.dispatchEvent(new Event("input", { bubbles: true }));
    exposure.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await wait(() => ready() && image().src !== before && histogram() !== beforeHistogram, "Exposure did not update pixels and histogram");
    const displayed = blobs.get(image().src);
    const displayedHash = await hash(displayed);
    check("retry and drop leave a functioning editor and live histogram", displayedHash !== beforeHash);
    await wait(async () => module.currentRecipe((await store.loadLibrary()).documents[`sha256:${hashes.jpeg}`]).exposure === 0.75, "Exposure was not persisted");
    let download = null;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download.endsWith(".jpg")) { download = blobs.get(this.href); return; }
      return anchorClick.call(this);
    };
    button("Export").click();
    await wait(() => button("Preview export"), "Export dialog missing");
    button("Preview export").click();
    await wait(() => root().querySelector(".develop-export-proof img")?.naturalWidth > 0, "Export proof missing");
    check("edited export proof is byte-identical to the displayed JPEG", await hash(blobs.get(root().querySelector(".develop-export-proof img").src)) === displayedHash);
    button("Export JPEG").click();
    await wait(() => download && !root().querySelector("[role=dialog]"), "Export did not finish");
    check("download uses the exact edited proof bytes", await hash(download) === displayedHash);
    library = await store.loadLibrary();
    state.documents = library.documents;
    state.displayedHash = displayedHash;
    state.verified = true;
    save();
    return { phase, passed: state.checks.length, checks: state.checks, displayedSHA256: displayedHash };
  } finally {
    HTMLAnchorElement.prototype.click = anchorClick;
    globalThis.fotoImportReadURLRestore?.();
  }
}

if (phase === "reload") {
  if (!state.verified) throw new Error("Complete verify before reload check");
  await wait(ready, "Reloaded library did not become editable", 45000);
  const library = await store.loadLibrary();
  check("reload preserves exact saved history and metadata", JSON.stringify(library.documents) === JSON.stringify(state.documents));
  check("reload retains both complete originals", library.photos.length === 2 && (await Promise.all(library.photos.map((p) => hash(p.sourceBlob)))).every((h) => Object.values(hashes).includes(h)));
  // Reload currently selects the first photo. Select the edited JPEG explicitly;
  // selection persistence is not part of this file-read regression.
  const jpegTile = root().querySelector('button[aria-label="2. volleyball-portrait-cc0.jpg"]');
  if (!jpegTile) throw new Error("Reloaded JPEG tile missing");
  jpegTile.click();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await wait(() => ready() && root().querySelector('input[aria-label="Exposure value"]')?.value === "0.75", "Reloaded JPEG edit did not render");
  check("reload restores the effective edit and histogram", root().querySelector('input[aria-label="Exposure value"]')?.value === "0.75" && histogram().length > 0);
  return { phase, passed: state.checks.length, checks: state.checks };
}

if (phase === "cleanup") {
  globalThis.fotoImportReadRestore?.();
  globalThis.fotoImportReadURLRestore?.();
  const library = await store.loadLibrary();
  if (!state.started || library.photos.some((p) => !Object.values(hashes).some((h) => p.id === `sha256:${h}`)))
    throw new Error("Foreign records in reserved QA library; refuse cleanup");
  for (const photo of library.photos)
    if (await hash(photo.sourceBlob) !== photo.id.slice(7)) throw new Error("QA source identity changed; refuse cleanup");
  const overview = document.querySelector(`a[href="/shoots/${shoot}"]`);
  if (!overview) throw new Error("Cannot unmount editor before cleanup");
  overview.click();
  await wait(() => !root(), "Editor still mounted");
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(module.DEVELOP_DATABASE_NAME);
    request.onupgradeneeded = () => request.transaction.abort();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const ids = library.photos.map((p) => p.id);
  let deleted = 0;
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["photos", "documents"], "readwrite");
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error ?? new Error("Cleanup aborted"));
      for (const name of ["photos", "documents"]) {
        const target = tx.objectStore(name);
        const request = target.index("namespace").getAllKeys(store.namespace);
        request.onsuccess = () => {
          for (const found of request.result) {
            if (!ids.some((id) => found === JSON.stringify(["device-local", `shoot:${shoot}`, id]))) {
              tx.abort(); return;
            }
            target.delete(found); deleted++;
          }
        };
      }
    });
  } finally { db.close(); }
  const remaining = await store.loadLibrary();
  check("cleanup removes only exact QA photo and document keys", remaining.photos.length === 0 && Object.keys(remaining.documents).length === 0);
  state.cleanup = { deleted, remaining: 0 };
  save();
  return { phase, passed: state.checks.length, cleanup: state.cleanup };
}
throw new Error("Unknown read-abort QA phase");
