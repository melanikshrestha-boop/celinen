/* Detached browser-eval body. Local lab /shoots only; app code is not mocked.
 * 1. fotoLargeLibraryQACommand={action:'prepare',count:337} (or 1000); run body.
 * 2. Once state='prepared', optionally reload /shoots, set command to
 *    {action:'measure',runId:<returned ID>}, and run body again.
 *    Use action:'grid-measure' instead for the separate Library grid benchmark.
 *    Each measurement cleans its own run; prepare a fresh run for the other action.
 * 3. Poll fotoLargeLibraryQA, or its returned sessionStorage statusKey.
 * Measurement unmounts and cleans automatically. After interruption/reload use
 * {action:'cleanup',runId} from /shoots. No broad reset, presets or customer data.
 * These are tiny JPEG/SPA/storage/filmstrip timings, NOT RAW/import throughput,
 * cold native-process timings, Lighthouse, or a promise about production speed.
 */
const QA_SHOOT = /^eeaf3000-1111-4222-8333-2[0-9a-f]{11}$/;
const QA_RUN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const QA_ID = /^sha256:[0-9a-f]{64}$/;
const QA_SCOPE = "device-local";
const qaName = (shoot, index) =>
  `qa-large-${shoot.slice(-12)}-${String(index).padStart(4, "0")}.jpg`;
const qaNamespace = (shoot) => JSON.stringify([QA_SCOPE, `shoot:${shoot}`]);
const qaKey = (shoot, id) => JSON.stringify([QA_SCOPE, `shoot:${shoot}`, id]);
const qaMetadata = (index) => ({
  rating: index % 6,
  flag: index % 10 === 0 ? "pick" : index % 10 === 1 ? "reject" : null,
  colorLabel: null,
  hearted: false,
});
function qaCommand(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Set fotoLargeLibraryQACommand explicitly before running this test.");
  if (value.action === "prepare") {
    if (Object.keys(value).some((key) => !["action", "count"].includes(key)))
      throw new Error(
        "Prepare accepts only action and count; it always creates a fresh reserved shoot.",
      );
    const count = value.count ?? 337;
    if (count !== 337 && count !== 1000)
      throw new Error("Only 337 or 1000 synthetic photos are supported.");
    return { action: "prepare", count };
  }
  if (
    !["measure", "grid-measure", "cleanup"].includes(value.action) ||
    Object.keys(value).some((key) => !["action", "runId"].includes(key)) ||
    !QA_RUN.test(value.runId ?? "")
  )
    throw new Error("Use measure, grid-measure or cleanup with the exact returned runId.");
  return { action: value.action, runId: value.runId };
}
function qaGuard(origin, path, search, editorMounted, active) {
  if (origin !== "http://127.0.0.1:8085" || path !== "/shoots" || search || editorMounted)
    throw new Error("Run from local lab /shoots with Develop unmounted and no query.");
  if (active) throw new Error("Another in-window QA operation is running; wait before continuing.");
}
function qaManifest(value, runId) {
  if (
    !value ||
    value.version !== 1 ||
    value.runId !== runId ||
    !QA_RUN.test(runId) ||
    !QA_SHOOT.test(value.shoot ?? "") ||
    value.scope !== QA_SCOPE ||
    value.libraryId !== `shoot:${value.shoot}` ||
    value.namespace !== qaNamespace(value.shoot) ||
    ![337, 1000].includes(value.count) ||
    !Array.isArray(value.entries) ||
    value.entries.length > value.count
  )
    throw new Error("Invalid or unrelated QA manifest; no records will be changed.");
  const ids = new Set();
  value.entries.forEach((entry, index) => {
    if (
      !entry ||
      entry.index !== index ||
      entry.name !== qaName(value.shoot, index) ||
      !QA_ID.test(entry.id ?? "") ||
      ids.has(entry.id) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 1 ||
      entry.size > 32768 ||
      typeof entry.committed !== "boolean" ||
      !(entry.documentHash === null || QA_ID.test(entry.documentHash ?? "")) ||
      (entry.committed && !entry.documentHash)
    )
      throw new Error("Invalid generated-photo receipt in QA manifest.");
    ids.add(entry.id);
  });
  return value;
}
function qaRecords(manifest, records, requireComplete = false) {
  if (
    records.photos.length > manifest.entries.length ||
    records.documents.length !== records.photos.length ||
    (requireComplete && records.photos.length !== manifest.count)
  )
    throw new Error("QA photo/document counts changed; preserve the evidence for review.");
  const expected = new Map(manifest.entries.map((entry) => [entry.id, entry]));
  const seen = new Set();
  for (const record of records.photos) {
    const photo = record.value;
    const entry = expected.get(photo?.id);
    if (
      !entry ||
      seen.has(photo.id) ||
      record.namespace !== manifest.namespace ||
      record.key !== qaKey(manifest.shoot, photo.id) ||
      photo.sourceDigest !== entry.id ||
      photo.name !== entry.name ||
      photo.sourceFileName !== entry.name ||
      photo.sourceLastModified !== 1000 + entry.index ||
      photo.width !== 64 ||
      photo.height !== 48 ||
      photo.isRaw !== false ||
      !(photo.sourceBlob instanceof Blob) ||
      photo.sourceBlob.type !== "image/jpeg" ||
      photo.sourceBlob.size !== entry.size ||
      !(photo.previewBlob instanceof Blob) ||
      photo.previewBlob.type !== "image/jpeg" ||
      photo.previewBlob.size !== entry.size
    )
      throw new Error("A record is not an exact synthetic large-library fixture; cleanup refused.");
    seen.add(photo.id);
  }
  const documents = new Set();
  for (const record of records.documents) {
    const doc = record.value;
    const entry = expected.get(doc?.photoId);
    if (
      !entry ||
      !seen.has(doc.photoId) ||
      documents.has(doc.photoId) ||
      record.namespace !== manifest.namespace ||
      record.key !== qaKey(manifest.shoot, doc.photoId) ||
      doc.revision !== 0 ||
      doc.cursor !== 0 ||
      doc.history?.length !== 1 ||
      doc.snapshots?.length !== 0 ||
      JSON.stringify(doc.metadata) !== JSON.stringify(qaMetadata(entry.index))
    )
      throw new Error("A synthetic edit document changed; it will be preserved for review.");
    documents.add(doc.photoId);
  }
}
function qaSnapshot(records) {
  return JSON.stringify(records, (_key, value) =>
    value instanceof Blob
      ? {
          qaBlob: true,
          size: value.size,
          type: value.type,
          name: value instanceof File ? value.name : null,
          lastModified: value instanceof File ? value.lastModified : null,
        }
      : value,
  );
}
function qaStats(values) {
  if (!values.length) return { count: 0, total: 0, max: 0, p95: null };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: values.length,
    total: values.reduce((a, b) => a + b, 0),
    max: sorted.at(-1),
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}
function qaFilmstripInfo(element) {
  if (!element) return { logicalCount: 0, buttons: 0, virtualized: false, mountedBound: null };
  const buttons = [...element.children].filter((node) => node.tagName === "BUTTON").length;
  const declaredCount = element.getAttribute("data-photo-count");
  const virtualized = declaredCount !== null;
  const logicalCount = virtualized ? Number(declaredCount) : buttons;
  const stride = Number(element.getAttribute("data-item-stride"));
  if (
    !Number.isSafeInteger(logicalCount) ||
    logicalCount < 0 ||
    (virtualized && (!Number.isFinite(stride) || stride <= 0))
  )
    throw new Error("The filmstrip exposed invalid logical count/window bounds.");
  return {
    logicalCount,
    buttons,
    virtualized,
    mountedBound: virtualized ? Math.ceil(element.clientWidth / stride) + 10 : null,
  };
}
function qaGridInfo(element) {
  if (!element) return { logicalCount: 0, buttons: 0, virtualized: false, mountedBound: null };
  const buttons = [...element.children].filter((node) => node.tagName === "BUTTON").length;
  const count = element.getAttribute("data-photo-count");
  const virtualized = count !== null;
  const logicalCount = virtualized ? Number(count) : buttons;
  const rowStride = Number(element.getAttribute("data-row-stride"));
  const columns = Number(element.getAttribute("data-column-count"));
  if (
    !Number.isSafeInteger(logicalCount) ||
    logicalCount < 0 ||
    (virtualized &&
      (!Number.isFinite(rowStride) ||
        rowStride <= 0 ||
        !Number.isSafeInteger(columns) ||
        columns < 1))
  )
    throw new Error("The Library grid exposed invalid logical count/window bounds.");
  return {
    logicalCount,
    buttons,
    virtualized,
    mountedBound: virtualized
      ? (Math.ceil(element.clientHeight / rowStride) + 5) * columns + 1
      : null,
    rowStride: virtualized ? rowStride : null,
    columns: virtualized ? columns : null,
  };
}
function qaGridLookup(entries) {
  return {
    byId: new Map(entries.map((entry) => [entry.id, entry])),
    byName: new Map(entries.map((entry) => [entry.name, entry])),
  };
}
function qaGridPhotoId(node, lookup) {
  const declared = node.getAttribute("data-photo-id");
  if (declared !== null) {
    const entry = lookup.byId.get(declared);
    if (!entry || node.getAttribute("data-photo-index") !== String(entry.index))
      throw new Error("Grid card does not match its exact synthetic photo/index.");
    return entry.id;
  }
  // Legacy grid has no ID attributes; its exact rendered filename is unambiguous
  // inside this independently validated, unique-name synthetic manifest.
  const name = node.querySelector("span")?.textContent;
  return lookup.byName.get(name)?.id ?? null;
}
// END PURE GUARDS
const command = qaCommand(globalThis.fotoLargeLibraryQACommand);
delete globalThis.fotoLargeLibraryQACommand;
qaGuard(
  location.origin,
  location.pathname,
  location.search,
  Boolean(document.querySelector(".foto-develop")),
  globalThis.fotoLargeLibraryQA?.state === "running" ||
    globalThis.fotoImportLifecycle?.state === "running",
);
const runId = command.action === "prepare" ? crypto.randomUUID() : command.runId;
const prefix = `foto:qa:large-library:${runId}`;
const statusKey = `${prefix}:status`,
  manifestKey = `${prefix}:manifest`;
const status = {
  runId,
  action: command.action,
  state: "running",
  stage: "preflight",
  checks: [],
  startedAt: new Date().toISOString(),
  updatedAt: null,
  finishedAt: null,
  statusKey,
  manifestKey,
  shoot: null,
  metrics: null,
  cleanup: null,
  error: null,
  cleanupError: null,
};
globalThis.fotoLargeLibraryQA = status;
function persist() {
  status.updatedAt = new Date().toISOString();
  sessionStorage.setItem(statusKey, JSON.stringify(status));
}
function stage(value) {
  status.stage = value;
  persist();
}
function check(name, condition) {
  if (!condition) throw new Error(name);
  status.checks.push(name);
  persist();
}
const hash = async (blob) =>
  `sha256:${[...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
const documentHash = (doc) => hash(new Blob([JSON.stringify(doc)]));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const wait = async (predicate, message, ms = 45000) => {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (predicate()) return;
    await delay(25);
  }
  throw new Error(message);
};
persist(); // Refuse to seed anything if progress cannot survive a reload.
void (async () => {
  const { isLocalSingleUserMode } = await import("/src/lib/app-mode.ts");
  if (!isLocalSingleUserMode)
    throw new Error("This is only for local lab QA, never an account library.");
  const module = await import("/src/lib/develop/store.ts");
  const { defaultDevelopSettings } = await import("/src/lib/develop/contract.ts");
  const neutral = JSON.stringify(defaultDevelopSettings());
  let manifest =
    command.action === "prepare"
      ? {
          version: 1,
          runId,
          shoot: `eeaf3000-1111-4222-8333-2${crypto.randomUUID().replaceAll("-", "").slice(0, 11)}`,
          scope: QA_SCOPE,
          count: command.count,
          entries: [],
        }
      : qaManifest(JSON.parse(sessionStorage.getItem(manifestKey) ?? "null"), runId);
  if (command.action === "prepare") {
    manifest.libraryId = `shoot:${manifest.shoot}`;
    manifest.namespace = qaNamespace(manifest.shoot);
  }
  qaManifest(manifest, runId);
  status.shoot = manifest.shoot;
  const path = `/shoots/${manifest.shoot}/develop`;
  const store = module.createDevelopStore({ scope: QA_SCOPE, libraryId: manifest.libraryId });
  const saveManifest = () => sessionStorage.setItem(manifestKey, JSON.stringify(manifest));
  const requestResult = (request) =>
    new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("QA storage read failed."));
    });
  async function database() {
    return await new Promise((resolve, reject) => {
      const request = indexedDB.open(module.DEVELOP_DATABASE_NAME);
      let absent = false;
      request.onupgradeneeded = () => {
        absent = true;
        request.transaction.abort();
      };
      request.onerror = () => (absent ? resolve(null) : reject(request.error));
      request.onblocked = () => reject(new Error("Another tab is blocking QA storage."));
      request.onsuccess = () => resolve(request.result);
    });
  }
  async function readRecords(tx) {
    const [photos, documents] = await Promise.all(
      ["photos", "documents"].map((name) =>
        requestResult(tx.objectStore(name).index("namespace").getAll(manifest.namespace)),
      ),
    );
    return { photos, documents };
  }
  async function readStored() {
    const db = await database();
    if (!db) return { photos: [], documents: [] };
    try {
      return await readRecords(db.transaction(["photos", "documents"], "readonly"));
    } finally {
      db.close();
    }
  }
  async function verifyRecords(records, complete) {
    qaRecords(manifest, records, complete);
    const expected = new Map(manifest.entries.map((entry) => [entry.id, entry]));
    for (let index = 0; index < records.photos.length; index++) {
      const photo = records.photos[index].value;
      if (
        (await hash(photo.sourceBlob)) !== photo.id ||
        (await hash(photo.previewBlob)) !== photo.id
      )
        throw new Error("A synthetic original or preview changed; it will not be deleted.");
      if (index % 50 === 49) await delay(0);
    }
    for (const record of records.documents) {
      const doc = record.value,
        entry = expected.get(doc.photoId);
      if (
        JSON.stringify(doc.history[0].settings) !== neutral ||
        (entry.documentHash && (await documentHash(doc)) !== entry.documentHash)
      )
        throw new Error("Saved neutral QA history changed; preserve it for debugging.");
    }
  }
  async function cleanup() {
    qaGuard(
      location.origin,
      location.pathname,
      location.search,
      Boolean(document.querySelector(".foto-develop")),
      false,
    );
    stage("cleanup-audit-exact-namespace");
    const records = await readStored();
    await verifyRecords(records, false);
    const snapshot = qaSnapshot(records);
    const db = await database();
    if (!db)
      return {
        removed: 0,
        remainingPhotos: 0,
        remainingDocuments: 0,
        namespace: manifest.namespace,
      };
    try {
      const tx = db.transaction(["photos", "documents"], "readwrite");
      const done = new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error ?? new Error("QA cleanup did not commit."));
        tx.onerror = () => undefined;
      });
      void done.catch(() => undefined);
      try {
        const current = await readRecords(tx);
        qaRecords(manifest, current, false);
        if (qaSnapshot(current) !== snapshot)
          throw new Error("QA records changed during cleanup; no deletes committed.");
        for (const name of ["photos", "documents"])
          for (const record of current[name]) tx.objectStore(name).delete(record.key);
        await done;
      } catch (error) {
        try {
          tx.abort();
        } catch {
          /* Already aborted or completed. */
        }
        await done.catch(() => undefined);
        throw error;
      }
      const remaining = await readRecords(db.transaction(["photos", "documents"], "readonly"));
      if (remaining.photos.length || remaining.documents.length)
        throw new Error("QA records reappeared after cleanup.");
      return {
        removed: records.photos.length,
        remainingPhotos: 0,
        remainingDocuments: 0,
        namespace: manifest.namespace,
        note: "Only generated synthetic originals and their neutral QA documents were removed; they are regenerable.",
      };
    } finally {
      db.close();
    }
  }
  async function measureGrid() {
    // Separate path and time origin: never change the filmstrip baseline below.
    const gridLookup = qaGridLookup(manifest.entries);
    const root = () => document.querySelector(".foto-develop");
    const button = (label) =>
      [...(root()?.querySelectorAll("button") ?? [])].find(
        (node) => node.getAttribute("aria-label") === label || node.textContent.trim() === label,
      );
    const frame = () => root()?.querySelector('.develop-image-frame img[draggable="false"]');
    const grid = () => root()?.querySelector(".develop-library-grid");
    const cards = () => [...(grid()?.children ?? [])].filter((node) => node.tagName === "BUTTON");
    const activeId = () => {
      const label = root()
        ?.querySelector(".develop-filmstrip-items button.is-active")
        ?.getAttribute("aria-label");
      return manifest.entries.find((entry) => label?.endsWith(`. ${entry.name}`))?.id;
    };
    const saved = () =>
      root()?.querySelector(".develop-save-status")?.textContent === "All edits saved";
    const imageReady = (image) =>
      Boolean(
        image?.isConnected &&
        image.complete &&
        image.naturalWidth > 0 &&
        image.currentSrc === image.getAttribute("src"),
      );
    const urls = new Map(),
      live = new Set(),
      nativeBlobs = new WeakMap(),
      receipts = [];
    const longTasks = [],
      frames = [];
    const originalFetch = window.fetch,
      originalCreate = URL.createObjectURL,
      originalRevoke = URL.revokeObjectURL;
    let observer = null,
      raf = 0,
      measured = false,
      gridAt = null,
      lastFrame = 0,
      peakLive = 0;
    let baselineCreated = 0,
      baselineLive = 0;
    const now = () => performance.now() - gridAt;
    const metrics = {
      kind: "library-grid",
      count: manifest.count,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      timeBasis:
        "Immediately before the actual Library button click, after the first Develop image has a successful native-owned receipt",
      fixture:
        "64 × 48 distinct synthetic JPEG originals; generated raster previews, neutral recipes",
      instrumentation:
        "Pass-through fetch/blob and object-URL observation. Warmup URLs tracked separately; no source, response or recipe substitution",
      readinessDefinition:
        "All logical cards (or bounded virtual window) have image srcs; viewport-visible images are decoded with currentSrc equal to src. Offscreen lazy images are not forced to decode",
      gridMountedMs: null,
      logicalGridReadyMs: null,
      visibleDecodedReadyMs: null,
      initialGridEnd: null,
      initialGrid: null,
      operations: [],
      checkpoints: [],
      nativeRequests: [],
      warmup: null,
      urlStats: null,
      longTasks: null,
      frameGaps: null,
    };
    status.metrics = metrics;
    const nativeReady = (id) => {
      const image = frame(),
        receipt = image ? urls.get(image.currentSrc)?.native : null;
      return (
        imageReady(image) &&
        activeId() === id &&
        receipt?.sourceId === id &&
        receipt.ok &&
        button("Export") &&
        !button("Export").disabled &&
        saved() &&
        !root().textContent.includes("Import preview") &&
        !root().textContent.includes("Rendering…")
      );
    };
    const sampleGrid = () => ({
      ...qaGridInfo(grid()),
      images: grid()?.querySelectorAll("img").length ?? 0,
      decodedImages: [...(grid()?.querySelectorAll("img") ?? [])].filter(imageReady).length,
      childNodes: grid()?.querySelectorAll("*").length ?? 0,
      scrollTop: grid()?.scrollTop ?? 0,
      scrollHeight: grid()?.scrollHeight ?? 0,
      clientHeight: grid()?.clientHeight ?? 0,
      clientWidth: grid()?.clientWidth ?? 0,
      createdUrlsSinceGridClick: urls.size - baselineCreated,
      liveCreatedUrls: live.size,
    });
    const checkpoint = (name) => {
      const point = { name, at: now(), ...sampleGrid() };
      metrics.checkpoints.push(point);
      persist();
      return point;
    };
    const visibleImages = () => {
      // One geometry pass at each settled checkpoint, not an O(N) RAF workload.
      const bounds = grid().getBoundingClientRect();
      return cards()
        .filter((card) => {
          const rect = card.getBoundingClientRect();
          return (
            rect.bottom > Math.max(bounds.top, 0) &&
            rect.top < Math.min(bounds.bottom, innerHeight) &&
            rect.right > Math.max(bounds.left, 0) &&
            rect.left < Math.min(bounds.right, innerWidth)
          );
        })
        .map((card) => card.querySelector("img"));
    };
    function monitor(timestamp) {
      if (!measured) return;
      if (lastFrame) frames.push({ at: now(), duration: timestamp - lastFrame });
      lastFrame = timestamp;
      if (metrics.gridMountedMs === null && grid()) metrics.gridMountedMs = now();
      raf = requestAnimationFrame(monitor);
    }
    function stopMeasurements() {
      if (!measured) return;
      measured = false;
      cancelAnimationFrame(raf);
      if (observer) {
        for (const entry of observer.takeRecords())
          if (entry.startTime >= gridAt)
            longTasks.push({ at: entry.startTime - gridAt, duration: entry.duration });
        observer.disconnect();
      }
      metrics.longTasks = {
        supported: Boolean(observer),
        ...qaStats(longTasks.map((entry) => entry.duration)),
        entries: longTasks,
        initial: qaStats(
          longTasks
            .filter((entry) => entry.at < metrics.initialGridEnd)
            .map((entry) => entry.duration),
        ),
      };
      metrics.frameGaps = {
        ...qaStats(frames.map((entry) => entry.duration)),
        initial: qaStats(
          frames
            .filter((entry) => entry.at < metrics.initialGridEnd)
            .map((entry) => entry.duration),
        ),
      };
      metrics.nativeRequests = receipts
        .filter((receipt) => receipt.startedAt >= gridAt)
        .map((receipt) => ({
          started: receipt.startedAt - gridAt,
          finished: receipt.finishedAt === null ? null : receipt.finishedAt - gridAt,
          sourceId: receipt.sourceId,
          status: receipt.status,
          ok: receipt.ok,
          error: receipt.error,
        }));
      metrics.urlStats = {
        createdBeforeGrid: baselineCreated,
        liveBeforeGrid: baselineLive,
        createdSinceGridClick: urls.size - baselineCreated,
        peakLive,
        remainingBeforeUnmount: live.size,
        nativeOutputUrlsSinceGridClick: [...urls.values()].filter(
          (value) => value.at >= gridAt && value.native,
        ).length,
      };
    }
    try {
      stage("grid-preflight-verify-durable-fixtures");
      await verifyRecords(await readStored(), true);
      URL.createObjectURL = function (blob) {
        const url = originalCreate.call(this, blob);
        urls.set(url, { at: performance.now(), native: nativeBlobs.get(blob) ?? null });
        live.add(url);
        if (measured) peakLive = Math.max(peakLive, live.size);
        return url;
      };
      URL.revokeObjectURL = function (url) {
        live.delete(url);
        return originalRevoke.call(this, url);
      };
      window.fetch = async function (resource, init) {
        const href = typeof resource === "string" ? resource : (resource?.url ?? String(resource));
        const address = new URL(href, location.href);
        if (
          location.pathname !== path ||
          address.origin !== location.origin ||
          address.pathname !== "/__develop/render"
        )
          return originalFetch.call(this, resource, init);
        const receipt = {
          startedAt: performance.now(),
          finishedAt: null,
          sourceId: null,
          status: null,
          ok: false,
          error: null,
        };
        receipts.push(receipt);
        void (async () => {
          if (!(init?.body instanceof Blob)) throw new Error("Unrecognized native request body.");
          const prefix = await init.body.slice(0, 4).arrayBuffer();
          const length = new DataView(prefix).getUint32(0, false);
          if (length < 1 || length > 65536 || length + 4 >= init.body.size)
            throw new Error("Invalid native request header.");
          receipt.sourceId = await hash(init.body.slice(length + 4));
        })().catch((error) => {
          receipt.error = String(error);
        });
        try {
          const response = await originalFetch.call(this, resource, init);
          receipt.finishedAt = performance.now();
          receipt.status = response.status;
          receipt.ok = response.ok;
          const originalBlob = response.blob;
          Object.defineProperty(response, "blob", {
            value: async function () {
              const blob = await originalBlob.call(this);
              nativeBlobs.set(blob, receipt);
              return blob;
            },
          });
          return response;
        } catch (error) {
          receipt.finishedAt = performance.now();
          receipt.error = String(error);
          throw error;
        }
      };
      stage("grid-warmup-native-owned-develop");
      const warmupBegan = performance.now();
      history.pushState(history.state, "", path);
      window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
      const first = manifest.entries[0],
        last = manifest.entries.at(-1);
      await wait(
        () => location.pathname === path && nativeReady(first.id),
        "Grid warmup did not produce the first native-owned image.",
      );
      check(
        "grid warmup image belongs to its successful native source receipt",
        nativeReady(first.id),
      );
      metrics.warmup = {
        ms: performance.now() - warmupBegan,
        sourceId: first.id,
        createdUrls: urls.size,
        liveUrls: live.size,
      };
      const openLibrary = button("Library");
      if (!openLibrary || openLibrary.disabled)
        throw new Error("The actual Library button is unavailable.");
      stage("grid-measure-library-click");
      if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            if (gridAt !== null && entry.startTime >= gridAt)
              longTasks.push({ at: entry.startTime - gridAt, duration: entry.duration });
        });
        observer.observe({ type: "longtask", buffered: false });
      }
      baselineCreated = urls.size;
      baselineLive = live.size;
      peakLive = live.size;
      gridAt = performance.now();
      measured = true;
      raf = requestAnimationFrame(monitor);
      openLibrary.click();
      await wait(() => {
        const nodes = cards();
        return (
          button("Library")?.getAttribute("aria-pressed") === "true" &&
          qaGridInfo(grid()).logicalCount === manifest.count &&
          nodes.length > 0 &&
          nodes.every((node) => Boolean(node.querySelector("img")?.getAttribute("src")))
        );
      }, "Library did not expose all logical cards with owned image sources.");
      metrics.logicalGridReadyMs = now();
      const initialVisible = visibleImages();
      if (!initialVisible.length)
        throw new Error("No Library cards intersect the visible viewport.");
      await wait(
        () => initialVisible.every(imageReady),
        "Visible Library thumbnails did not decode their current sources.",
      );
      metrics.visibleDecodedReadyMs = now();
      metrics.initialGrid = checkpoint("grid-initial-visible-decoded");
      metrics.initialGridEnd = now();
      check(
        "grid retains the exact logical photo count",
        qaGridInfo(grid()).logicalCount === manifest.count,
      );
      check(
        "every mounted card maps to its exact synthetic identity",
        cards().every((node) => qaGridPhotoId(node, gridLookup)),
      );
      if (qaGridInfo(grid()).virtualized)
        check(
          "initial grid DOM is bounded by visible rows and overscan",
          qaGridInfo(grid()).buttons <= qaGridInfo(grid()).mountedBound,
        );
      const selectedBeforeScroll = activeId();
      check(
        "opening Library preserves the selected first photo",
        selectedBeforeScroll === first.id,
      );
      stage("grid-scroll-to-last-without-selection");
      const scrollBegan = now();
      grid().scrollTop = grid().scrollHeight;
      const lastCard = () => cards().find((node) => qaGridPhotoId(node, gridLookup) === last.id);
      await wait(() => {
        const card = lastCard();
        if (!card || !imageReady(card.querySelector("img"))) return false;
        const rect = card.getBoundingClientRect(),
          bounds = grid().getBoundingClientRect();
        return rect.bottom > bounds.top && rect.top < bounds.bottom;
      }, "Scrolling did not expose the last real card and its decoded current image.");
      metrics.operations.push({
        name: "grid-scroll-to-end",
        ms: now() - scrollBegan,
        ...sampleGrid(),
      });
      checkpoint("grid-scrolled-to-last");
      check(
        "manual grid scrolling does not select or open a photograph",
        activeId() === selectedBeforeScroll &&
          button("Library")?.getAttribute("aria-pressed") === "true",
      );
      if (qaGridInfo(grid()).virtualized)
        check(
          "scrolled grid DOM remains bounded",
          qaGridInfo(grid()).buttons <= qaGridInfo(grid()).mountedBound,
        );
      stage("grid-double-click-last-card");
      const openedAt = now(),
        card = lastCard();
      if (!card)
        throw new Error("Last Library card disappeared before the real double-click handler.");
      card.focus();
      card.click();
      card.click();
      card.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 }),
      );
      await wait(
        () =>
          !grid() &&
          button("Develop")?.getAttribute("aria-pressed") === "true" &&
          nativeReady(last.id),
        "Double-click did not open the last photograph with its own native receipt.",
      );
      metrics.operations.push({
        name: "grid-double-click-last-native-ready",
        ms: now() - openedAt,
        sourceId: last.id,
      });
      check(
        "last real grid card opens Develop with the last source's successful native receipt",
        nativeReady(last.id),
      );
      await delay(100); // Deliver final observer entries before integrity hashing.
      stopMeasurements();
      stage("grid-verify-original-preview-document-digests");
      await verifyRecords(await readStored(), true);
      check(
        "grid navigation preserves every original, preview, history, metadata and revision",
        true,
      );
    } catch (error) {
      status.failedStage = status.stage;
      status.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      stopMeasurements();
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.fetch = originalFetch;
      try {
        if (root()) {
          stage("grid-unmount-before-cleanup");
          if (!saved())
            throw new Error(
              "Editor has an unsaved or failed write; leave grid fixtures for review.",
            );
          const exit = document.querySelector('.foto-primary-nav a[href="/shoots"]');
          if (!exit)
            throw new Error("Real Shoots navigation is unavailable; grid cleanup refused.");
          exit.click();
          await wait(
            () => location.pathname === "/shoots" && !root(),
            "Develop did not unmount after grid measurement.",
          );
          await delay(100);
        }
        metrics.urlStats ??= {
          createdBeforeGrid: baselineCreated,
          liveBeforeGrid: baselineLive,
          createdSinceGridClick: urls.size - baselineCreated,
          peakLive,
        };
        metrics.urlStats.remainingAfterUnmount = live.size;
        store.close();
        status.cleanup = await cleanup();
      } catch (error) {
        status.cleanupError = error instanceof Error ? error.message : String(error);
      } finally {
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
      }
      if (status.cleanupError)
        throw new Error(`Grid QA cleanup needs attention: ${status.cleanupError}`);
    }
  }
  try {
    if (command.action === "prepare") {
      stage("verify-empty-reserved-library");
      const existing = await readStored();
      check(
        "fresh reserved namespace has no previous records",
        !existing.photos.length && !existing.documents.length,
      );
      saveManifest();
      stage("generate-and-commit-synthetic-jpegs");
      const began = performance.now(),
        ids = new Set();
      for (let start = 0; start < manifest.count; start += 25) {
        const inputs = [];
        for (let index = start; index < Math.min(start + 25, manifest.count); index++) {
          const canvas = document.createElement("canvas");
          canvas.width = 64;
          canvas.height = 48;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas is unavailable for synthetic JPEG generation.");
          context.fillStyle = `hsl(${(index * 137.508) % 360} 45% 45%)`;
          context.fillRect(0, 0, 64, 48);
          // Index bits + run-specific digits guarantee visibly different synthetic content.
          for (let bit = 0; bit < 10; bit++) {
            context.fillStyle = index & (1 << bit) ? "#f4f4f4" : "#101010";
            context.fillRect((bit % 5) * 12 + 2, Math.floor(bit / 5) * 12 + 2, 9, 9);
          }
          context.fillStyle = "#fff";
          context.font = "7px sans-serif";
          context.fillText(manifest.shoot.slice(-8), 2, 36);
          context.fillText(String(index), 2, 46);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
          canvas.width = canvas.height = 0;
          if (!blob) throw new Error("Synthetic JPEG generation failed.");
          const name = qaName(manifest.shoot, index);
          const file = new File([blob], name, { type: "image/jpeg", lastModified: 1000 + index });
          const input = await module.developPhotoFromFile(file, file, { width: 64, height: 48 });
          if (ids.has(input.id))
            throw new Error("Synthetic generator produced duplicate source bytes.");
          ids.add(input.id);
          inputs.push({
            ...input,
            previewOrigin: "raster",
            initialState: {
              settings: defaultDevelopSettings(),
              metadata: qaMetadata(index),
            },
          });
          manifest.entries.push({
            index,
            id: input.id,
            name,
            size: file.size,
            committed: false,
            documentHash: null,
          });
        }
        saveManifest(); // Exact candidate IDs survive a reload even between commit and its receipt.
        const receipt = await store.addPhotosWithDocuments(inputs);
        for (const photo of receipt.photos) {
          const entry = manifest.entries.find((candidate) => candidate.id === photo.id);
          entry.documentHash = await documentHash(receipt.documents[photo.id]);
          entry.committed = true;
        }
        saveManifest();
        status.preparedCount = manifest.entries.filter((entry) => entry.committed).length;
        persist();
        await delay(0);
      }
      status.setupMs = performance.now() - began;
      stage("verify-durable-seed");
      await verifyRecords(await readStored(), true);
      check(
        "all distinct originals, previews and neutral documents are durable",
        manifest.entries.length === manifest.count,
      );
      status.state = "prepared";
      status.stage = "prepared";
      status.url = `${location.origin}${path}`;
      status.next = `From /shoots set fotoLargeLibraryQACommand={action:'measure',runId:'${runId}'} and rerun; a reload between phases is supported.`;
      return;
    }
    if (command.action === "cleanup") {
      status.cleanup = await cleanup();
      status.state = "cleaned";
      status.stage = "cleaned";
      return;
    }
    if (
      manifest.entries.length !== manifest.count ||
      manifest.entries.some((entry) => !entry.committed)
    )
      throw new Error("Preparation did not complete. Use cleanup, not measure, for this run.");
    if (command.action === "grid-measure") {
      await measureGrid();
      status.state = "passed";
      status.stage = "complete";
      return;
    }
    const root = () => document.querySelector(".foto-develop");
    const button = (label) =>
      [...(root()?.querySelectorAll("button") ?? [])].find(
        (node) => node.getAttribute("aria-label") === label || node.textContent.trim() === label,
      );
    const frame = () => root()?.querySelector('.develop-image-frame img[draggable="false"]');
    const strip = () => root()?.querySelector(".develop-filmstrip-items");
    const stripButtons = () =>
      [...(strip()?.children ?? [])].filter((node) => node.tagName === "BUTTON");
    const stripInfo = () => qaFilmstripInfo(strip());
    const active = () => strip()?.querySelector("button.is-active");
    const expectedForActive = () =>
      manifest.entries.find((entry) =>
        active()?.getAttribute("aria-label")?.endsWith(`. ${entry.name}`),
      );
    const saveStatus = () => root()?.querySelector(".develop-save-status")?.textContent;
    const currentImageReady = () => {
      const img = frame();
      return Boolean(
        img && img.complete && img.naturalWidth > 0 && img.currentSrc === img.getAttribute("src"),
      );
    };
    const metrics = {
      count: manifest.count,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      timeBasis: "SPA history navigation after harness setup, not cold browser/native process load",
      fixture:
        "64 × 48 distinct synthetic JPEG originals; generated raster previews, neutral recipes",
      instrumentation:
        "Pass-through fetch/blob and object-URL observation; no source, native response or recipe substitution",
      mountMs: null,
      firstDecodedImageMs: null,
      firstNativeOwnedReadyMs: null,
      fullFilmstripMs: null,
      filmstripReadyDefinition:
        "Logical photo count ready; rendered DOM count recorded separately. Baseline non-windowed count equaled all DOM buttons.",
      filmstrip: null,
      operations: [],
      nativeRequests: [],
      urlStats: null,
      longTasks: null,
      frameGaps: null,
      checkpoints: [],
      initialLoadEnd: null,
    };
    status.metrics = metrics;
    const originalFetch = window.fetch,
      originalCreate = URL.createObjectURL,
      originalRevoke = URL.revokeObjectURL;
    const urls = new Map(),
      live = new Set(),
      nativeBlobs = new WeakMap(),
      longTasks = [],
      frames = [];
    let peakUrls = 0,
      raf = 0,
      startAt = 0,
      measured = false,
      lastFrame = 0,
      observer = null;
    const now = () => performance.now() - startAt;
    const sampleStrip = () => ({
      ...stripInfo(),
      images: strip()?.querySelectorAll("img").length ?? 0,
      decodedImages: [...(strip()?.querySelectorAll("img") ?? [])].filter(
        (img) => img.complete && img.naturalWidth > 0 && img.currentSrc === img.getAttribute("src"),
      ).length,
      childNodes: strip()?.querySelectorAll("*").length ?? 0,
      scrollWidth: strip()?.scrollWidth ?? 0,
      clientWidth: strip()?.clientWidth ?? 0,
      liveCreatedUrls: live.size,
      createdUrls: urls.size,
    });
    const nativeReady = (id) => {
      const image = frame();
      const receipt = image ? urls.get(image.currentSrc)?.native : null;
      return (
        currentImageReady() &&
        expectedForActive()?.id === id &&
        receipt?.sourceId === id &&
        receipt.ok &&
        button("Export") &&
        !button("Export").disabled &&
        saveStatus() === "All edits saved" &&
        !root().textContent.includes("Import preview") &&
        !root().textContent.includes("Rendering…")
      );
    };
    const checkpoint = (name) => {
      const point = { name, at: now(), ...sampleStrip() };
      metrics.checkpoints.push(point);
      persist();
      return point;
    };
    function monitor(timestamp) {
      if (!measured) return;
      if (lastFrame) frames.push({ at: now(), duration: timestamp - lastFrame });
      lastFrame = timestamp;
      if (metrics.mountMs === null && root()?.querySelector(".develop-workspace"))
        metrics.mountMs = now();
      if (metrics.firstDecodedImageMs === null && currentImageReady())
        metrics.firstDecodedImageMs = now();
      if (metrics.firstNativeOwnedReadyMs === null && nativeReady(manifest.entries[0].id))
        metrics.firstNativeOwnedReadyMs = now();
      if (metrics.fullFilmstripMs === null && stripInfo().logicalCount === manifest.count)
        metrics.fullFilmstripMs = now();
      raf = requestAnimationFrame(monitor);
    }
    try {
      URL.createObjectURL = function (blob) {
        const url = originalCreate.call(this, blob);
        if (measured) {
          urls.set(url, {
            size: blob.size,
            type: blob.type,
            at: now(),
            native: nativeBlobs.get(blob) ?? null,
          });
          live.add(url);
          peakUrls = Math.max(peakUrls, live.size);
        }
        return url;
      };
      URL.revokeObjectURL = function (url) {
        live.delete(url);
        return originalRevoke.call(this, url);
      };
      window.fetch = async function (resource, init) {
        const href = typeof resource === "string" ? resource : (resource?.url ?? String(resource));
        const address = new URL(href, location.href);
        if (
          !measured ||
          location.pathname !== path ||
          address.origin !== location.origin ||
          address.pathname !== "/__develop/render"
        )
          return originalFetch.call(this, resource, init);
        const receipt = {
          started: now(),
          finished: null,
          sourceId: null,
          status: null,
          ok: false,
          error: null,
        };
        metrics.nativeRequests.push(receipt);
        const identifying = (async () => {
          if (!(init?.body instanceof Blob)) throw new Error("Unrecognized native request body.");
          const prefix = await init.body.slice(0, 4).arrayBuffer();
          const length = new DataView(prefix).getUint32(0, false);
          if (length < 1 || length > 65536 || length + 4 >= init.body.size)
            throw new Error("Invalid native request header.");
          receipt.sourceId = await hash(init.body.slice(length + 4));
        })().catch((error) => {
          receipt.error = String(error);
        });
        try {
          const response = await originalFetch.call(this, resource, init);
          receipt.finished = now();
          receipt.status = response.status;
          receipt.ok = response.ok;
          const originalBlob = response.blob;
          Object.defineProperty(response, "blob", {
            value: async function () {
              const blob = await originalBlob.call(this);
              nativeBlobs.set(blob, receipt);
              return blob;
            },
          });
          void identifying;
          return response;
        } catch (error) {
          receipt.finished = now();
          receipt.error = String(error);
          throw error;
        }
      };
      if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            if (entry.startTime >= startAt)
              longTasks.push({ at: entry.startTime - startAt, duration: entry.duration });
        });
        observer.observe({ type: "longtask", buffered: false });
      }
      stage("measure-navigation-and-initial-editor");
      startAt = performance.now();
      measured = true;
      raf = requestAnimationFrame(monitor);
      history.pushState(history.state, "", path);
      window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
      await wait(
        () =>
          location.pathname === path &&
          stripInfo().logicalCount === manifest.count &&
          nativeReady(manifest.entries[0].id),
        "The full library/first native-owned current image did not become ready.",
      );
      metrics.firstNativeOwnedReadyMs ??= now();
      metrics.filmstrip = checkpoint("initial-native-owned-ready");
      metrics.initialLoadEnd = now();
      check(
        "first current image belongs to its successful native source receipt",
        nativeReady(manifest.entries[0].id),
      );
      check(
        "every synthetic photo remains in the logical filmstrip",
        stripInfo().logicalCount === manifest.count,
      );
      if (stripInfo().virtualized)
        check(
          "initial mounted filmstrip stays within viewport/overscan bounds",
          stripInfo().buttons <= stripInfo().mountedBound,
        );
      const operation = async (name, action, ready) => {
        stage(name);
        const began = now();
        action();
        await wait(ready, `${name} did not settle.`);
        metrics.operations.push({ name, ms: now() - began, ...sampleStrip() });
        persist();
      };
      await operation(
        "next-photo",
        () => button("Next photograph").click(),
        () => nativeReady(manifest.entries[1].id),
      );
      const last = manifest.entries.at(-1);
      if (stripInfo().virtualized) {
        await operation(
          "scroll-to-end",
          () => {
            strip().scrollLeft = strip().scrollWidth;
          },
          () => stripButtons().some((node) => node.getAttribute("data-photo-id") === last.id),
        );
        check(
          "scrolling exposes the last logical photo without growing the DOM",
          stripInfo().buttons <= stripInfo().mountedBound,
        );
      }
      await operation(
        "last-photo",
        () => {
          if (stripInfo().virtualized) {
            strip().focus();
            strip().dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "End",
                bubbles: true,
                cancelable: true,
              }),
            );
          } else {
            const node = stripButtons().find((node) =>
              node.getAttribute("aria-label")?.endsWith(`. ${last.name}`),
            );
            if (!node) throw new Error("Last photo has no real filmstrip button.");
            node.scrollIntoView({ block: "nearest", inline: "nearest" });
            node.click();
          }
        },
        () => nativeReady(last.id),
      );
      const selectFilter = (value) => {
        const input = root().querySelector('select[aria-label="Filter photos"]');
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(
          input,
          value,
        );
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };
      for (const filter of ["rated", "picks", "not-rejected", "all"]) {
        const expected = manifest.entries.filter(
          (entry) =>
            filter === "all" ||
            (filter === "rated"
              ? qaMetadata(entry.index).rating >= 3
              : filter === "picks"
                ? qaMetadata(entry.index).flag === "pick"
                : qaMetadata(entry.index).flag !== "reject"),
        );
        await operation(
          `filter-${filter}`,
          () => selectFilter(filter),
          () => {
            const id = expectedForActive()?.id;
            return (
              root()?.querySelector('select[aria-label="Filter photos"]')?.value === filter &&
              stripInfo().logicalCount === expected.length &&
              Boolean(id) &&
              nativeReady(id)
            );
          },
        );
        const expectedNames = new Set(expected.map((entry) => entry.name));
        check(
          `${filter} filter matches seeded metadata exactly`,
          stripButtons().every((node) => {
            const label = node.getAttribute("aria-label") ?? "";
            return expectedNames.has(label.slice(label.indexOf(". ") + 2));
          }),
        );
        if (stripInfo().virtualized)
          check(
            `${filter} filter retains a bounded mounted window`,
            stripInfo().buttons <= stripInfo().mountedBound,
          );
      }
      // Let the observer deliver its final tasks, without including integrity hashing.
      await delay(100);
      measured = false;
      cancelAnimationFrame(raf);
      if (observer) {
        for (const entry of observer.takeRecords())
          if (entry.startTime >= startAt)
            longTasks.push({ at: entry.startTime - startAt, duration: entry.duration });
        observer.disconnect();
      }
      metrics.longTasks = {
        supported: Boolean(observer),
        ...qaStats(longTasks.map((entry) => entry.duration)),
        entries: longTasks,
        initial: qaStats(
          longTasks
            .filter((entry) => entry.at < metrics.initialLoadEnd)
            .map((entry) => entry.duration),
        ),
      };
      metrics.frameGaps = {
        ...qaStats(frames.map((entry) => entry.duration)),
        initial: qaStats(
          frames
            .filter((entry) => entry.at < metrics.initialLoadEnd)
            .map((entry) => entry.duration),
        ),
      };
      metrics.urlStats = {
        created: urls.size,
        peakLive: peakUrls,
        remainingBeforeUnmount: live.size,
        nativeOutputUrls: [...urls.values()].filter((value) => value.native).length,
        jpegUrls: [...urls.values()].filter((value) => value.type === "image/jpeg").length,
      };
      stage("verify-originals-and-documents-after-interactions");
      await verifyRecords(await readStored(), true);
      check(
        "selection and filters preserve all original bytes, previews, histories and revisions",
        true,
      );
    } catch (error) {
      status.failedStage = status.stage;
      status.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      measured = false;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.fetch = originalFetch;
      // Keep URL release tracking through the actual unmount, then restore prototypes.
      try {
        if (root()) {
          stage("unmount-before-cleanup");
          if (saveStatus() !== "All edits saved")
            throw new Error("Editor has an unsaved or failed write; leave fixtures for review.");
          const exit = document.querySelector('.foto-primary-nav a[href="/shoots"]');
          if (!exit) throw new Error("Real Shoots navigation is unavailable; cleanup refused.");
          exit.click();
          await wait(() => location.pathname === "/shoots" && !root(), "Develop did not unmount.");
          await delay(100);
        }
        metrics.urlStats ??= { created: urls.size, peakLive: peakUrls };
        metrics.urlStats.remainingAfterUnmount = live.size;
        store.close();
        status.cleanup = await cleanup();
      } catch (error) {
        status.cleanupError = error instanceof Error ? error.message : String(error);
      } finally {
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
      }
      if (status.cleanupError)
        throw new Error(`QA cleanup needs attention: ${status.cleanupError}`);
    }
    status.state = "passed";
    status.stage = "complete";
  } finally {
    store.close();
  }
})().then(
  () => {
    status.finishedAt = new Date().toISOString();
    persist();
  },
  (error) => {
    status.failedStage ??= status.stage;
    status.state = "failed";
    status.error = error instanceof Error ? error.message : String(error);
    status.finishedAt = new Date().toISOString();
    try {
      persist();
    } catch (storageError) {
      status.persistenceError = String(storageError);
    }
  },
);
return {
  started: true,
  runId,
  action: command.action,
  status: "globalThis.fotoLargeLibraryQA",
  statusKey,
  manifestKey,
};
