// Browser-eval body. Import the public Sony A6000 fixture into ONLY this reserved
// shoot first. Set globalThis.fotoNeutralExpectedCalls=2 to reproduce pre-fix;
// default 1 asserts the fixed path. No customer namespaces are read or changed.
const shoot = "eeaf3000-1111-4222-8333-000000000103";
const path = `/shoots/${shoot}/develop`;
if (location.origin !== "http://127.0.0.1:8085" || location.pathname !== path)
  throw new Error("Reserved neutral-reuse QA shoot required");
const expectedCalls = globalThis.fotoNeutralExpectedCalls ?? 1;
delete globalThis.fotoNeutralExpectedCalls;
if (![1, 2].includes(expectedCalls)) throw new Error("Unexpected QA baseline");
const { createDevelopStore, currentRecipe, pushHistory } =
  await import("/src/lib/develop/store.ts");
const { defaultDevelopSettings } = await import("/src/lib/develop/contract.ts");
const store = createDevelopStore({ scope: "device-local", libraryId: `shoot:${shoot}` });
const root = () => document.querySelector(".foto-develop");
const hash = async (blob) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
const wait = async (test, label) => {
  const end = performance.now() + 20000;
  while (performance.now() < end) {
    if (await test()) return;
    await new Promise((resolve) => setTimeout(resolve, 35));
  }
  throw new Error(label);
};
const checks = [];
const check = (label, ok) => {
  if (!ok) throw new Error(label);
  checks.push(label);
};
const button = (label) =>
  [...(root()?.querySelectorAll("button") ?? [])].find(
    (b) => b.textContent.trim() === label || b.getAttribute("aria-label") === label,
  );
const ready = () =>
  root()?.querySelector(".develop-image-frame img")?.naturalWidth > 0 &&
  button("Remove Object")?.disabled === false;
await wait(ready, "Imported fixture did not become ready");
const library = await store.loadLibrary();
check(
  "only the exact public fixture is in the reserved library",
  library.photos.length === 1 &&
    library.photos[0].sourceDigest ===
      "sha256:ce8b4957281a817d52a07a691e2468567b6c78223bd0b514ffc1c65b002b8d89",
);
const photo = library.photos[0];
check(
  "public source hash is unchanged",
  (await hash(photo.sourceBlob)) ===
    "ce8b4957281a817d52a07a691e2468567b6c78223bd0b514ffc1c65b002b8d89",
);
const overview =
  document.querySelector(`a[href="/shoots/${shoot}"]`) ??
  [...document.querySelectorAll("a")].find((a) => a.textContent.trim() === "Overview");
if (!overview) throw new Error("Overview navigation missing");
overview.click();
await wait(() => !root(), "Develop did not unmount");
const recipe = defaultDevelopSettings();
recipe.grading.model = "legacy";
recipe.grading.shadows.hue = 240;
recipe.grading.blending = 82;
recipe.grainSize = 2;
const documentBefore = await store.saveDocument({
  ...pushHistory(library.documents[photo.id], recipe, "QA legacy neutral"),
  metadata: { rating: 4, flag: "pick", colorLabel: "green" },
});
const expectedDocument = JSON.stringify(documentBefore);
const originalFetch = window.fetch;
const anchorClick = HTMLAnchorElement.prototype.click;
const createURL = URL.createObjectURL;
const blobs = new Map();
URL.createObjectURL = function (blob) {
  const url = createURL.call(URL, blob);
  blobs.set(url, blob);
  return url;
};
const calls = [];
let downloaded = null;
window.fetch = function (input, options) {
  const tracked = input === "/__develop/render" && options?.body instanceof Blob;
  const record = { startedAt: performance.now(), endedAt: null, status: null, packet: null };
  if (tracked) {
    calls.push(record);
    void options.body
      .slice(0, 4)
      .arrayBuffer()
      .then(async (first) => {
        const length = new DataView(first).getUint32(0, false);
        record.packet = JSON.parse(await options.body.slice(4, 4 + length).text());
      });
  }
  return originalFetch.apply(this, arguments).then((response) => {
    if (tracked) {
      record.status = response.status;
      record.endedAt = performance.now();
    }
    return response;
  });
};
try {
  const started = performance.now();
  document.querySelector(`a[href="${path}"]`).click();
  await wait(ready, "Native neutral image did not become ready");
  await new Promise((resolve) => setTimeout(resolve, 350));
  await wait(ready, "Neutral image did not settle");
  const elapsedMs = performance.now() - started;
  check(
    "legacy neutral uses the expected number of real native renders",
    calls.length === expectedCalls &&
      calls.every(
        (c) => c.status === 200 && c.packet?.sourceMode === "raw" && c.packet.edge === 4096,
      ),
  );
  check(
    "opening preserves exact stored history and metadata",
    JSON.stringify((await store.loadLibrary()).documents[photo.id]) === expectedDocument,
  );
  const shown = blobs.get(root().querySelector(".develop-image-frame img").src);
  const shownHash = await hash(shown);
  HTMLAnchorElement.prototype.click = function () {
    if (this.download.endsWith(".jpg")) {
      downloaded = blobs.get(this.href);
      return;
    }
    return anchorClick.call(this);
  };
  button("Export").click();
  await wait(() => button("Preview export"), "Export dialog missing");
  button("Preview export").click();
  await wait(
    () => root().querySelector(".develop-export-proof img")?.naturalWidth > 0,
    "Export proof missing",
  );
  const proof = blobs.get(root().querySelector(".develop-export-proof img").src);
  check("export proof reuses exactly the displayed JPEG", (await hash(proof)) === shownHash);
  button("Export JPEG").click();
  await wait(
    () => downloaded && !root().querySelector("[role=dialog]"),
    "JPEG export did not finish",
  );
  check("download is byte-identical to editor", (await hash(await downloaded)) === shownHash);
  check("export incurs no second native render", calls.length === expectedCalls);
  check(
    "actual legacy recipe is still preserved after export",
    JSON.stringify(currentRecipe((await store.loadLibrary()).documents[photo.id])) ===
      JSON.stringify(recipe),
  );
  const loadNativeCalls = calls.length;
  if (expectedCalls === 1) {
    const histogram = () =>
      [...root().querySelectorAll(".develop-histogram svg path")]
        .map((p) => p.getAttribute("d"))
        .join("|");
    await wait(() => histogram().length > 0, "Neutral histogram missing");
    const neutralHistogram = histogram();
    const neutralUrl = root().querySelector(".develop-image-frame img").src;
    const exposure = root().querySelector('input[aria-label="Exposure value"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(exposure, "0.75");
    exposure.dispatchEvent(new Event("input", { bubbles: true }));
    exposure.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await wait(
      () => ready() && root().querySelector(".develop-image-frame img").src !== neutralUrl,
      "Effective exposure did not render",
    );
    await wait(
      () => histogram() !== neutralHistogram,
      "Histogram did not follow the edited pixels",
    );
    check(
      "effective exposure still calls the native engine",
      calls.length === loadNativeCalls + 1 &&
        calls.at(-1).packet.settings.exposure === 0.75 &&
        calls.at(-1).status === 200,
    );
    check(
      "exposure changes the displayed JPEG",
      (await hash(blobs.get(root().querySelector(".develop-image-frame img").src))) !== shownHash,
    );
    button("Undo").click();
    await wait(
      () => ready() && exposure.value === "0" && histogram() === neutralHistogram,
      "Undo did not restore neutral pixels and histogram",
    );
    check(
      "Undo restores exact neutral JPEG without another decode",
      calls.length === loadNativeCalls + 1 &&
        (await hash(blobs.get(root().querySelector(".develop-image-frame img").src))) === shownHash,
    );
    await wait(
      async () => (await store.loadLibrary()).documents[photo.id].cursor === documentBefore.cursor,
      "Undo did not persist",
    );
    const afterUndo = (await store.loadLibrary()).documents[photo.id];
    check(
      "Undo retains legacy recipe, prior history, rating and pick",
      JSON.stringify(currentRecipe(afterUndo)) === JSON.stringify(recipe) &&
        JSON.stringify(afterUndo.metadata) === JSON.stringify(documentBefore.metadata) &&
        documentBefore.history
          .slice(0, documentBefore.cursor + 1)
          .every(
            (entry, index) => JSON.stringify(afterUndo.history[index]) === JSON.stringify(entry),
          ),
    );
  }
  return {
    passed: checks.length,
    checks,
    elapsedMs,
    loadNativeCalls,
    totalNativeCalls: calls.length,
    durationsMs: calls.map((c) => c.endedAt - c.startedAt),
    displayedJpegSHA256: shownHash,
  };
} finally {
  window.fetch = originalFetch;
  HTMLAnchorElement.prototype.click = anchorClick;
  URL.createObjectURL = createURL;
}
