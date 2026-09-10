/* Run with gstack eval in an isolated launched Chromium at /settings/appearance.
 * Run again after a real reload to verify persistence and remove only this QA fixture.
 * Tiny synthetic raster images test navigation, never RAW import performance.
 */
return await (async () => {
  const shoot = "eeaf3000-1111-4222-8333-193901d95991";
  const scope = "device-local";
  const base = `/shoots/${shoot}/develop`;
  const namespace = JSON.stringify([scope, `shoot:${shoot}`]);
  const marker = "foto:qa:warm-navigation:193901d95991";
  if (location.origin !== "http://127.0.0.1:8085")
    throw new Error("Isolated local LAB browser required.");
  const { isLocalSingleUserMode } = await import("/src/lib/app-mode.ts");
  if (!isLocalSingleUserMode) throw new Error("Never run with a real account.");
  const api = await import("/src/lib/develop/store.ts");
  const directory = await import("/src/lib/studio/shoot-directory.ts");
  const store = api.createDevelopStore({ scope, libraryId: `shoot:${shoot}` });
  const checks = [];
  const check = (name, value) => {
    if (!value) throw new Error(name);
    checks.push(name);
  };
  const wait = async (name, predicate) => {
    const end = performance.now() + 20000;
    while (performance.now() < end) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error(`Timed out: ${name}`);
  };
  const request = (req) =>
    new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const hash = async (blob) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  const root = () => document.querySelector(".foto-develop");
  const exposure = () => root()?.querySelector('[aria-label="Exposure value"]');
  const ready = () =>
    exposure() &&
    !exposure().disabled &&
    root()?.querySelector(".develop-image-frame img")?.naturalWidth > 0;
  const router = window.__TSR_ROUTER__;
  if (typeof router?.navigate !== "function") throw new Error("Actual app router unavailable.");
  const saved = sessionStorage.getItem(marker);
  if (saved) {
    const state = JSON.parse(saved);
    if (state.shoot !== shoot || state.namespace !== namespace || state.stage !== "reload")
      throw new Error("Unexpected prior QA state; refusing to overwrite.");
    checks.push(...state.checks);
    await wait("reloaded native editor", ready);
    check("real reload occurred", performance.timeOrigin > state.timeOrigin);
    check(
      "reload restored exact requested photo",
      location.pathname === base &&
        new URL(location.href).searchParams.get("photo") === state.ids[0],
    );
    check("saved adjustment survived reload", Number(exposure().value) === 0.85);
    const library = await store.loadLibraryWithManifest();
    check(
      "three IDs and order survive reload",
      JSON.stringify(library.photos.map((p) => p.id)) === JSON.stringify(state.ids),
    );
    for (const photo of library.photos)
      check(
        `original unchanged: ${photo.name}`,
        (await hash(photo.sourceBlob)) === state.digests[photo.id],
      );
    check(
      "history retained prior adjustment",
      api.currentRecipe(library.documents[state.ids[0]]).exposure === 0.85 &&
        library.documents[state.ids[0]].history.length >= 2,
    );
    // Leave the entire workbench before deleting the exact synthetic fixture.
    await router.navigate({ href: "/pricing" });
    await wait(
      "all photo controllers unmounted",
      () => !document.querySelector(".foto-develop, .workbench-embedded-studio"),
    );
    store.close();
    const db = await request(indexedDB.open("foto-develop-v1"));
    try {
      const tx = db.transaction(["photos", "documents", "manifests", "importJobs"], "readwrite");
      const done = new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
      });
      for (const name of ["photos", "documents"]) {
        const objectStore = tx.objectStore(name);
        const keys = await request(objectStore.index("namespace").getAllKeys(namespace));
        for (const key of keys) objectStore.delete(key);
      }
      tx.objectStore("manifests").delete(namespace);
      tx.objectStore("importJobs").delete(namespace);
      await done;
    } finally {
      db.close();
    }
    const studioName = directory.studioDatabaseKey(scope, shoot);
    if (studioName !== state.studioName) throw new Error("QA cleanup source mismatch.");
    await request(indexedDB.deleteDatabase(studioName));
    const directoryName = "lenslabs-shoot-directory-v1";
    if ((await indexedDB.databases()).some((entry) => entry.name === directoryName)) {
      const index = await request(indexedDB.open(directoryName));
      try {
        const tx = index.transaction(["shoots", "organization"], "readwrite");
        const done = new Promise((resolve, reject) => {
          tx.oncomplete = resolve;
          tx.onabort = () => reject(tx.error);
        });
        tx.objectStore("shoots").delete(shoot);
        tx.objectStore("organization").delete(shoot);
        await done;
      } finally {
        index.close();
      }
    }
    sessionStorage.removeItem(marker);
    return {
      state: "passed",
      passed: checks.length,
      checks,
      cleanup:
        "Only reserved synthetic photo/document/manifest/session/directory entries removed. No customer records.",
    };
  }
  if (location.pathname !== "/settings/appearance")
    throw new Error("Begin on isolated /settings/appearance.");
  const initial = await store.loadLibraryWithManifest();
  if (
    initial.photos.length ||
    initial.manifest.photoIds.length ||
    (await directory.listRecentShoots(scope)).some((row) => row.id === shoot)
  )
    throw new Error("Reserved shoot must be empty; no existing data will be overwritten.");
  const studioName = directory.studioDatabaseKey(scope, shoot);
  if ((await indexedDB.databases()).some((entry) => entry.name === studioName))
    throw new Error("Reserved legacy source must not already exist.");
  const photos = [];
  for (const [index, color] of ["#887755", "#447766", "#665588"].entries()) {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 120;
    const context = canvas.getContext("2d");
    context.fillStyle = color;
    context.fillRect(0, 0, 160, 120);
    context.fillStyle = "#cfcfcf";
    context.fillRect(20, 20, 30 + index * 20, 60);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const input = await api.developPhotoFromFile(
      new File([blob], `warm-navigation-${index + 1}.png`, { type: "image/png", lastModified: 1 }),
    );
    photos.push({ ...input, width: 160, height: 120, previewBlob: blob, previewOrigin: "raster" });
  }
  await store.addPhotos(photos);
  const ids = photos.map((photo) => photo.id);
  const digests = Object.fromEntries(
    await Promise.all(photos.map(async (photo) => [photo.id, await hash(photo.sourceBlob)])),
  );
  const navigate = (id) => router.navigate({ href: `${base}?photo=${encodeURIComponent(id)}` });
  const originalGet = IDBObjectStore.prototype.get;
  const success = Object.getOwnPropertyDescriptor(IDBRequest.prototype, "onsuccess");
  const originalConfirm = window.confirm;
  let target = null,
    eligible = 0,
    held = null;
  // Delay only this shoot's exact manifest read. Requests and transactions remain
  // real IndexedDB operations; normal router blockers and save queues still run.
  IDBObjectStore.prototype.get = function (key) {
    const req = originalGet.call(this, key);
    const match =
      target &&
      key === namespace &&
      this.name === "manifests" &&
      this.transaction.mode === "readonly" &&
      this.transaction.objectStoreNames.length === 2 &&
      new URL(location.href).searchParams.get("photo") === target;
    if (match && ++eligible === 2) {
      Object.defineProperty(req, "onsuccess", {
        configurable: true,
        set(fn) {
          success.set.call(req, (event) => {
            held = () => fn.call(req, event);
          });
        },
        get() {
          return success.get.call(req);
        },
      });
    }
    return req;
  };
  window.confirm = (message) => {
    if (String(message).includes("Develop still has work that has not finished saving."))
      return true;
    throw new Error(`Unexpected confirmation in reserved QA: ${message}`);
  };
  try {
    await navigate(ids[0]);
    await wait("initial full editor", ready);
    const slider = root().querySelector('input[type="range"][aria-label="Exposure"]');
    if (!slider) throw new Error("Exposure control unavailable.");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(slider, "0.85");
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(requestAnimationFrame);
    check("ordinary real control updated the draft", Number(exposure().value) === 0.85);
    target = ids[1];
    eligible = 0;
    await navigate(ids[1]);
    await wait("held warm-load manifest", () => held);
    check(
      "warm route uses the requested photo ID",
      new URL(location.href).searchParams.get("photo") === ids[1],
    );
    check(
      "previous photo controls unavailable while target loads",
      !exposure() && root()?.textContent.includes("Opening Develop"),
    );
    const committed = await store.readPhoto(ids[0]);
    check(
      "normal navigation fence saved prior draft",
      api.currentRecipe(committed.document).exposure === 0.85,
    );
    const release = held;
    held = null;
    target = null;
    release();
    await wait("second photo controls", ready);
    check("second photo did not inherit first photo exposure", Number(exposure().value) === 0);
    target = ids[2];
    eligible = 0;
    await navigate(ids[2]);
    await wait("held superseded request", () => held);
    await navigate(ids[0]);
    await wait("newer requested photo", () => ready() && Number(exposure().value) === 0.85);
    const stale = held;
    held = null;
    target = null;
    stale();
    await new Promise((resolve) => setTimeout(resolve, 150));
    check(
      "late cancelled manifest cannot rewind selected photo",
      new URL(location.href).searchParams.get("photo") === ids[0] &&
        Number(exposure().value) === 0.85,
    );
    const after = await store.loadLibraryWithManifest();
    check(
      "all fixture photo identities and order remain intact",
      JSON.stringify(after.photos.map((photo) => photo.id)) === JSON.stringify(ids),
    );
    sessionStorage.setItem(
      marker,
      JSON.stringify({
        stage: "reload",
        shoot,
        namespace,
        studioName,
        ids,
        digests,
        checks,
        timeOrigin: performance.timeOrigin,
      }),
    );
    return {
      state: "reload-required",
      passed: checks.length,
      checks,
      next: "Run a real browser reload, then evaluate this file again for persistence and exact fixture cleanup.",
    };
  } finally {
    if (held) held();
    IDBObjectStore.prototype.get = originalGet;
    window.confirm = originalConfirm;
    store.close();
  }
})();
