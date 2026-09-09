/* Detached cancellation/stale-source regression, NOT an import/throughput benchmark.
 * Run only on the already-hydrated public QA shoot ...097 in Develop, filter All,
 * with no busy operation/dialog and all edits saved. Poll returned global/statusKey.
 * 12 four-key bursts with 40 ms gaps, plus eight settled arrows, bootstrap and
 * original-selection restore: at most 59 transitions. No edits, cleanup or sends.
 * Full RAW request-source hashing adds overhead; this fixture reports no timings.
 */
const NS_SHOOT = "eeaf3000-1111-4222-8333-000000000097";
const NS_SCOPE = "device-local";
const NS_PATH = `/shoots/${NS_SHOOT}/develop`;
const NS_NAMESPACE = JSON.stringify([NS_SCOPE, `shoot:${NS_SHOOT}`]);
const NS_SOURCES = new Map([
  [
    "sha256:ce8b4957281a817d52a07a691e2468567b6c78223bd0b514ffc1c65b002b8d89",
    { name: "sony-a6000.ARW", size: 25624576, isRaw: true },
  ],
  [
    "sha256:cbbd0930c7d8706dff84c68a2004454266e6fd0d8354f5f76a106b5d776e0223",
    { name: "sony-a7iv-small.ARW", size: 22933504, isRaw: true },
  ],
  [
    "sha256:5685e8468969ca05da9de250f5848df5318e6b47b1a14d4aebd5c19675224fce",
    { name: "volleyball-portrait-cc0.jpg", size: 3148228, isRaw: false },
  ],
]);
function nsGuard(surface, initial = false) {
  if (
    surface.origin !== "http://127.0.0.1:8085" ||
    surface.path !== NS_PATH ||
    surface.search ||
    surface.hash
  )
    throw new Error("Navigation stress is restricted to the exact local public 097 Develop route.");
  if (
    !surface.mounted ||
    surface.mode !== "develop" ||
    surface.filter !== "all" ||
    surface.dialog ||
    surface.busy
  )
    throw new Error("Use hydrated Develop, filter All, with no dialog or busy operation.");
  if (initial && (!surface.ready || surface.active || surface.tool))
    throw new Error("Wait for saved, decoded normal Develop with no other QA operation running.");
}
function nsCycles() {
  return Array.from({ length: 12 }, (_, index) => ({
    cycle: index + 1,
    burst: ["ArrowRight", "ArrowRight", "ArrowLeft", "ArrowLeft"],
    // Settled navigation visits all three sources, not only the first two.
    settled:
      index === 2 || index === 8
        ? ["ArrowRight", "ArrowLeft"]
        : index === 5
          ? ["ArrowRight", "ArrowRight", "ArrowLeft", "ArrowLeft"]
          : [],
  }));
}
function nsRecords(records, schema) {
  if (!records || records.photos?.length !== 3 || records.documents?.length !== 3)
    throw new Error(
      "Expected exactly the three public photo/document pairs; no navigation started.",
    );
  const seen = new Set();
  for (const record of records.photos) {
    const photo = record?.value,
      source = NS_SOURCES.get(photo?.id);
    if (
      !source ||
      seen.has(photo.id) ||
      record.namespace !== NS_NAMESPACE ||
      record.key !== JSON.stringify([NS_SCOPE, `shoot:${NS_SHOOT}`, photo.id]) ||
      photo.name !== source.name ||
      photo.sourceFileName !== source.name ||
      photo.sourceDigest !== photo.id ||
      photo.sourceAvailable !== true ||
      photo.isRaw !== source.isRaw ||
      !(photo.sourceBlob instanceof Blob) ||
      photo.sourceBlob.size !== source.size ||
      (photo.sourceBlob instanceof File && photo.sourceBlob.name !== source.name)
    )
      throw new Error("Stored photo identity is not an exact public 097 original.");
    seen.add(photo.id);
  }
  const docs = new Set();
  for (const record of records.documents) {
    const doc = record?.value;
    if (
      !seen.has(doc?.photoId) ||
      docs.has(doc.photoId) ||
      record.namespace !== NS_NAMESPACE ||
      record.key !== JSON.stringify([NS_SCOPE, `shoot:${NS_SHOOT}`, doc.photoId]) ||
      !schema.safeParse(doc).success
    )
      throw new Error("Stored edit identity/history is invalid; leave this library untouched.");
    docs.add(doc.photoId);
  }
}
function nsSnapshot(records) {
  return JSON.stringify(records, (_key, value) =>
    value instanceof Blob
      ? {
          nsBlob: true,
          size: value.size,
          type: value.type,
          name: value instanceof File ? value.name : null,
          lastModified: value instanceof File ? value.lastModified : null,
        }
      : value,
  );
}
function nsOrder(nodes) {
  if (nodes.length !== 3)
    throw new Error("All three public photos must be visible in the filmstrip.");
  const ids = nodes.map((node, index) => {
    const id = node.getAttribute("data-photo-id"),
      expected = NS_SOURCES.get(id);
    if (
      !expected ||
      node.getAttribute("data-photo-index") !== String(index) ||
      node.getAttribute("aria-label") !== `${index + 1}. ${expected.name}`
    )
      throw new Error("Filmstrip identity/index differs from the three exact public photos.");
    return id;
  });
  if (new Set(ids).size !== 3) throw new Error("Filmstrip contains duplicate public identities.");
  return ids;
}
// END PURE GUARDS
const root = () => document.querySelector(".foto-develop");
const button = (label) =>
  [...(root()?.querySelectorAll("button") ?? [])].find(
    (node) => node.getAttribute("aria-label") === label || node.textContent.trim() === label,
  );
const strip = () => root()?.querySelector(".develop-filmstrip-items");
const cards = () => [...(strip()?.children ?? [])].filter((node) => node.tagName === "BUTTON");
const selectedId = () => strip()?.querySelector("button.is-active")?.getAttribute("data-photo-id");
const frame = () => root()?.querySelector('.develop-image-frame img[alt="Developed photo"]');
const decoded = () => {
  const image = frame();
  return Boolean(
    image?.isConnected &&
    image.complete &&
    image.naturalWidth > 0 &&
    image.currentSrc === image.getAttribute("src"),
  );
};
const renderReady = () =>
  decoded() &&
  button("Export") &&
  !button("Export").disabled &&
  root()?.querySelector(".develop-save-status")?.textContent === "All edits saved" &&
  !root().textContent.includes("Rendering…") &&
  !root().textContent.includes("Import preview");
const surface = () => ({
  origin: location.origin,
  path: location.pathname,
  search: location.search,
  hash: location.hash,
  mounted: Boolean(root()),
  mode: button("Develop")?.getAttribute("aria-pressed") === "true" ? "develop" : "other",
  filter: root()?.querySelector('select[aria-label="Filter photos"]')?.value,
  dialog: Boolean(root()?.querySelector('[role="dialog"]')),
  busy: !button("Import") || button("Import").disabled,
  ready: Boolean(renderReady()),
  tool:
    button("Crop tool")?.getAttribute("aria-pressed") === "true" ||
    button("Mask tool")?.getAttribute("aria-pressed") === "true",
  active:
    globalThis.fotoNavigationStress?.state === "running" ||
    globalThis.fotoLargeLibraryQA?.state === "running" ||
    globalThis.fotoImportLifecycle?.state === "running" ||
    globalThis.fotoPublicPerformanceCleanup?.state === "running",
});
nsGuard(surface(), true);
const order = nsOrder(cards()),
  originalSelection = selectedId();
if (!order.includes(originalSelection))
  throw new Error("The original selected photo is not a verified public fixture.");
const runId = crypto.randomUUID(),
  statusKey = `foto:qa:navigation-stress:${runId}`;
const status = {
  state: "running",
  runId,
  statusKey,
  shoot: NS_SHOOT,
  stage: "preflight",
  originalSelection,
  order,
  transitions: 0,
  cyclesCompleted: 0,
  checks: [],
  observations: [],
  counts: {
    requests: 0,
    successful: 0,
    failed: 0,
    aborted: 0,
    identified: 0,
    peakHashQueue: 0,
    peakTrackedUrls: 0,
  },
  staleSourceErrors: [],
  receiptErrors: [],
  error: null,
  restoreError: null,
  integrityError: null,
  restoredSelection: false,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  note: "Cancellation/source-ownership regression only. Full RAW hashing adds overhead; no speed or throughput measurement. No photos or edits are deleted.",
};
globalThis.fotoNavigationStress = status;
const persist = () => sessionStorage.setItem(statusKey, JSON.stringify(status));
const stage = (name) => {
  status.stage = name;
  persist();
};
const check = (name, result) => {
  if (!result) throw new Error(name);
  status.checks.push(name);
  persist();
};
const hash = async (blob) =>
  `sha256:${[...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
persist(); // No navigation if progress cannot survive a reload.
void (async () => {
  const { isLocalSingleUserMode } = await import("/src/lib/app-mode.ts");
  if (!isLocalSingleUserMode) throw new Error("Only device-local QA is allowed.");
  const { DEVELOP_DATABASE_NAME, developDocumentSchema } =
    await import("/src/lib/develop/store.ts");
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DEVELOP_DATABASE_NAME);
    request.onupgradeneeded = () => request.transaction.abort(); // Never create a database.
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("QA read is blocked by a database upgrade."));
    request.onsuccess = () => resolve(request.result);
  });
  const readRecords = async () => {
    const tx = db.transaction(["photos", "documents"], "readonly");
    const [photos, documents] = await Promise.all(
      ["photos", "documents"].map(
        (name) =>
          new Promise((resolve, reject) => {
            const request = tx.objectStore(name).index("namespace").getAll(NS_NAMESPACE);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          }),
      ),
    );
    const records = { photos, documents };
    nsRecords(records, developDocumentSchema);
    return records;
  };
  const originalFetch = window.fetch,
    originalCreate = URL.createObjectURL,
    originalRevoke = URL.revokeObjectURL;
  const liveUrls = new Map(),
    nativeBlobs = new WeakMap(),
    sourceOwners = new Map();
  const hashQueue = [],
    pendingHashTasks = new Set();
  let hashing = false,
    tracking = true,
    raf = 0,
    beforeSnapshot = null,
    previewHashes = null,
    startedNavigation = false;
  const rememberSource = (digest, photoId, kind) => {
    const old = sourceOwners.get(digest);
    if (old && old.photoId !== photoId)
      throw new Error("Shared preview/source bytes are ambiguous across QA photos.");
    sourceOwners.set(digest, { photoId, kind: old?.kind === "original" ? "original" : kind });
  };
  const assertIntegrity = async (records, initial) => {
    const previews = {};
    for (const { value: photo } of records.photos) {
      if ((await hash(photo.sourceBlob)) !== photo.id)
        throw new Error("A public original SHA-256 does not match.");
      const preview =
        photo.previewBlob instanceof Blob && photo.previewBlob.size
          ? await hash(photo.previewBlob)
          : null;
      previews[photo.id] = preview;
      if (initial) {
        rememberSource(photo.id, photo.id, "original");
        if (preview) rememberSource(preview, photo.id, "saved-preview");
      }
    }
    if (
      !initial &&
      (nsSnapshot(records) !== beforeSnapshot ||
        JSON.stringify(previews) !== JSON.stringify(previewHashes))
    )
      throw new Error(
        "Public originals, previews or saved documents changed; preserve 097 for review.",
      );
    return previews;
  };
  async function drainHashes() {
    if (hashing) return;
    hashing = true;
    try {
      while (hashQueue.length) {
        const job = hashQueue.shift();
        try {
          if (!tracking || job.signal?.aborted)
            throw new DOMException("Obsolete request receipt", "AbortError");
          const prefix = await job.body.slice(0, 4).arrayBuffer(),
            length = new DataView(prefix).getUint32(0, false);
          if (length < 1 || length > 65536 || length + 4 >= job.body.size)
            throw new Error("Invalid native request framing.");
          const digest = await hash(job.body.slice(length + 4)); // One full-source ArrayBuffer at a time.
          if (!tracking || job.signal?.aborted)
            throw new DOMException("Obsolete request receipt", "AbortError");
          const owner = sourceOwners.get(digest);
          if (!owner) throw new Error("Successful native request used unknown source bytes.");
          job.receipt.sourceDigest = digest;
          job.receipt.photoId = owner.photoId;
          job.receipt.sourceKind = owner.kind;
          status.counts.identified++;
          job.resolve();
        } catch (error) {
          job.reject(error);
        }
      }
    } finally {
      hashing = false;
    }
  }
  function identify(body, signal, receipt) {
    if (!(body instanceof Blob) || body.size > 128 * 1024 * 1024 + 65540 || hashQueue.length >= 4)
      return Promise.reject(
        new Error("Bounded native receipt-hashing queue exceeded or request unrecognized."),
      );
    const pending = new Promise((resolve, reject) => {
      hashQueue.push({ body, signal, receipt, resolve, reject });
      status.counts.peakHashQueue = Math.max(
        status.counts.peakHashQueue,
        hashQueue.length + (hashing ? 1 : 0),
      );
      void drainHashes();
    });
    pendingHashTasks.add(pending);
    void pending.then(
      () => pendingHashTasks.delete(pending),
      () => pendingHashTasks.delete(pending),
    );
    return pending;
  }
  const readyReceipt = (id) => {
    const image = frame(),
      receipt = image ? liveUrls.get(image.currentSrc)?.receipt : null;
    return renderReady() && selectedId() === id && receipt?.ok && receipt.photoId === id
      ? receipt
      : null;
  };
  function observe() {
    if (!tracking) return;
    if (location.pathname === NS_PATH && renderReady()) {
      const receipt = liveUrls.get(frame().currentSrc)?.receipt;
      if (
        receipt?.photoId &&
        receipt.photoId !== selectedId() &&
        status.staleSourceErrors.length < 8
      )
        status.staleSourceErrors.push({
          selected: selectedId(),
          displayed: receipt.photoId,
          requestId: receipt.id,
        });
    }
    raf = requestAnimationFrame(observe);
  }
  async function settle(id, label) {
    const deadline = performance.now() + 65000;
    while (performance.now() < deadline) {
      nsGuard(surface());
      if (status.staleSourceErrors.length)
        throw new Error("An export-ready image belonged to a stale source.");
      if (status.receiptErrors.length)
        throw new Error(`Native source verification failed: ${status.receiptErrors[0]}`);
      const receipt = readyReceipt(id);
      if (receipt) {
        status.observations.push({
          label,
          photoId: id,
          requestId: receipt.id,
          sourceDigest: receipt.sourceDigest,
          sourceKind: receipt.sourceKind,
          width: frame().naturalWidth,
          height: frame().naturalHeight,
        });
        persist();
        return;
      }
      await delay(25);
    }
    throw new Error(
      `${label}: exact selected/native-owned decoded image never became export-ready.`,
    );
  }
  const countTransition = () => {
    if (++status.transitions > 59) throw new Error("Navigation stress transition cap exceeded.");
  };
  const clickPhoto = (id) => {
    nsGuard(surface());
    const target = cards().find((node) => node.getAttribute("data-photo-id") === id);
    if (!target || target.disabled)
      throw new Error("Expected public filmstrip button is unavailable.");
    countTransition();
    startedNavigation = true;
    target.focus({ preventScroll: true });
    target.click();
  };
  let index = 0;
  const arrow = async (key, settled, label) => {
    nsGuard(surface());
    const target = cards().find((node) => node.getAttribute("data-photo-id") === selectedId());
    if (!target) throw new Error("Active public filmstrip button is unavailable.");
    const nextIndex = index + (key === "ArrowRight" ? 1 : -1);
    if (nextIndex < 0 || nextIndex > 2)
      throw new Error("Stress recipe would navigate outside the three-photo library.");
    countTransition();
    target.focus({ preventScroll: true });
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    if (!event.defaultPrevented)
      throw new Error("The real Page arrow handler did not handle the key.");
    index = nextIndex;
    await delay(40);
    if (selectedId() !== order[index])
      throw new Error("The real Page arrow handler selected the wrong public photo.");
    if (settled) await settle(order[index], label);
  };
  try {
    stage("verify-exact-public-originals-and-documents");
    const before = await readRecords();
    beforeSnapshot = nsSnapshot(before);
    previewHashes = await assertIntegrity(before, true);
    check("all three public original digests and edit identities verified", true);
    window.fetch = async function (resource, init) {
      const href = typeof resource === "string" ? resource : (resource?.url ?? String(resource)),
        address = new URL(href, location.href);
      if (
        !tracking ||
        location.pathname !== NS_PATH ||
        address.origin !== location.origin ||
        address.pathname !== "/__develop/render"
      )
        return originalFetch.call(this, resource, init);
      const receipt = {
        id: ++status.counts.requests,
        ok: false,
        status: null,
        photoId: null,
        sourceDigest: null,
        sourceKind: null,
        error: null,
      };
      if (receipt.id > 1024)
        throw new Error("Unexpected native-request replay count in bounded navigation stress.");
      try {
        const response = await originalFetch.call(this, resource, init);
        receipt.ok = response.ok;
        receipt.status = response.status;
        if (response.ok) {
          status.counts.successful++;
          // Only successful native responses need full-source verification. Aborted
          // uploads are not hashed; queued successful jobs hold Blob handles, not buffers.
          void identify(init?.body, init?.signal, receipt).catch((error) => {
            receipt.error = String(error);
            if (error?.name !== "AbortError" && status.receiptErrors.length < 8)
              status.receiptErrors.push(String(error));
          });
          const originalBlob = response.blob;
          Object.defineProperty(response, "blob", {
            value: async function () {
              const blob = await originalBlob.call(this);
              nativeBlobs.set(blob, receipt);
              return blob;
            },
          });
        } else status.counts.failed++;
        return response;
      } catch (error) {
        if (error?.name === "AbortError" || init?.signal?.aborted) status.counts.aborted++;
        else status.counts.failed++;
        throw error;
      }
    };
    URL.createObjectURL = function (blob) {
      const url = originalCreate.call(this, blob);
      if (tracking) {
        liveUrls.set(url, { receipt: nativeBlobs.get(blob) ?? null });
        status.counts.peakTrackedUrls = Math.max(status.counts.peakTrackedUrls, liveUrls.size);
      }
      return url;
    };
    URL.revokeObjectURL = function (url) {
      liveUrls.delete(url);
      return originalRevoke.call(this, url);
    };
    raf = requestAnimationFrame(observe);
    stage("bootstrap-observed-native-receipt");
    if (originalSelection === order[0]) {
      clickPhoto(order[1]);
      await settle(order[1], "bootstrap-other");
    }
    clickPhoto(order[0]);
    await settle(order[0], "bootstrap-anchor");
    for (const cycle of nsCycles()) {
      stage(`cycle-${cycle.cycle}-rapid-arrows`);
      for (const key of cycle.burst) await arrow(key, false, "burst");
      await settle(order[0], `cycle-${cycle.cycle}-settled`);
      check(
        `cycle ${cycle.cycle} ended on its exact native-owned anchor image`,
        Boolean(readyReceipt(order[0])),
      );
      if (cycle.settled.length) {
        stage(`cycle-${cycle.cycle}-settled-arrows`);
        for (const [offset, key] of cycle.settled.entries())
          await arrow(key, true, `cycle-${cycle.cycle}-completed-${offset + 1}`);
      }
      status.cyclesCompleted = cycle.cycle;
      persist();
    }
    check(
      "settled native completions cover all three public photos",
      new Set(status.observations.map((entry) => entry.photoId)).size === 3,
    );
    check("no export-ready stale-source frame was observed", status.staleSourceErrors.length === 0);
  } catch (error) {
    status.failedStage = status.stage;
    status.error = error instanceof Error ? error.message : String(error);
  } finally {
    try {
      if (startedNavigation) {
        stage("restore-original-selection-via-real-card");
        clickPhoto(originalSelection);
        await settle(originalSelection, "restored-original-selection");
        status.restoredSelection = selectedId() === originalSelection;
      }
    } catch (error) {
      status.restoreError = error instanceof Error ? error.message : String(error);
    }
    try {
      if (beforeSnapshot !== null && previewHashes !== null) {
        stage("verify-all-originals-previews-and-documents-unchanged");
        await assertIntegrity(await readRecords(), false);
        check(
          "originals, previews, complete histories, metadata and revisions are unchanged",
          true,
        );
      }
    } catch (error) {
      status.integrityError = error instanceof Error ? error.message : String(error);
    }
    tracking = false;
    cancelAnimationFrame(raf);
    window.fetch = originalFetch;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    for (const job of hashQueue.splice(0))
      job.reject(new DOMException("Stress complete", "AbortError"));
    await Promise.allSettled([...pendingHashTasks]);
    status.trackedUrlsAtEnd = liveUrls.size;
    liveUrls.clear(); // Drop tracking metadata only. Never revoke URLs owned by the live app.
    db.close();
  }
  if (status.error || status.restoreError || status.integrityError)
    throw new Error(status.error || status.restoreError || status.integrityError);
  check(
    "bounded navigation finished and original selection restored",
    status.transitions <= 59 && status.cyclesCompleted === 12 && status.restoredSelection,
  );
  status.state = "passed";
  status.stage = "complete";
})().then(
  () => {
    status.finishedAt = new Date().toISOString();
    persist();
  },
  (error) => {
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
return { started: true, runId, status: "globalThis.fotoNavigationStress", statusKey };
