// Real IndexedDB transaction races; isolated synthetic namespace 102 ONLY.
const shoot = "eeaf3000-1111-4222-8333-000000000102";
if (location.origin !== "http://127.0.0.1:8085" || location.pathname !== `/shoots/${shoot}/develop`)
  throw new Error("Use only the reserved reconnect race QA route.");
const module = await import("/src/lib/develop/store.ts");
const { runDevelopReconnect } = await import("/src/lib/develop/reconnect.ts");
const { planDevelopReconnect } = await import("/src/lib/develop/reconnect-plan.ts");
const store = module.createDevelopStore({ scope: "device-local", libraryId: `shoot:${shoot}` });
const marker = `foto:qa:reconnect-races:${shoot}`;
const hash = async (blob) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
const checks = [];
const check = (name, value) => {
  if (!value) throw new Error(name);
  checks.push(name);
};
try {
  const initial = await store.loadLibrary();
  if (
    initial.photos.length ||
    Object.keys(initial.documents).length ||
    sessionStorage.getItem(marker)
  )
    throw new Error("QA race library must be empty.");
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 24;
  const context = canvas.getContext("2d");
  context.fillStyle = "#a08451";
  context.fillRect(0, 0, 32, 24);
  const a = await new Promise((resolve) => canvas.toBlob(resolve));
  context.fillStyle = "#37614c";
  context.fillRect(0, 0, 32, 24);
  const b = await new Promise((resolve) => canvas.toBlob(resolve));
  const ids = ["studio:qa-race-stale", "studio:qa-race-atomic", "studio:qa-race-cancel"];
  const names = ["qa-stale.png", "qa-atomic.png", "qa-cancel.png"];
  const inputs = ids.map((id, i) => ({
    id,
    name: names[i],
    sourceFileName: names[i],
    sourceLastModified: 0,
    sourceDigest: null,
    sourceBlob: null,
    previewBlob: null,
    width: 32,
    height: 24,
    isRaw: false,
  }));
  await store.addPhotos(inputs);
  sessionStorage.setItem(
    marker,
    JSON.stringify({ ids, names, hashes: [await hash(a), await hash(b)] }),
  );
  const before = await store.loadLibrary();
  const expected = (i) => ({ sourceFileName: names[i], sourceDigest: null });
  const file = (blob, i) => new File([blob], names[i], { type: "image/png" });
  const reconnect = async (i, blob) =>
    module.reconnectDevelopPhoto(
      before.photos.find((p) => p.id === ids[i]),
      file(blob, i),
      blob,
      { width: 32, height: 24 },
      "raster",
    );
  const stale = await reconnect(0, a);
  // A second writer restores different bytes without a digest before the stale operation commits.
  await store.addPhotos([{ ...inputs[0], sourceBlob: b }]);
  let rejected = false;
  try {
    await store.attachMissingOriginal(stale, expected(0));
  } catch {
    rejected = true;
  }
  const actual = await store.readPhoto(ids[0]);
  check("stale unknown reconnect rejects after another original appears", rejected);
  check(
    "stale preview never attaches to a different original",
    (await hash(actual.photo.sourceBlob)) === (await hash(b)) && actual.photo.previewBlob === null,
  );
  const first = await reconnect(1, a),
    second = await reconnect(1, b);
  const outcomes = await Promise.allSettled([
    store.attachMissingOriginal(first, expected(1)),
    store.attachMissingOriginal(second, expected(1)),
  ]);
  check(
    "exactly one concurrent original attachment commits",
    outcomes.filter((value) => value.status === "fulfilled").length === 1 &&
      outcomes.filter((value) => value.status === "rejected").length === 1,
  );
  const winner = await store.readPhoto(ids[1]);
  check(
    "concurrent winner source and preview are the same image",
    (await hash(winner.photo.sourceBlob)) === (await hash(winner.photo.previewBlob)),
  );
  const controller = new AbortController();
  const plan = await planDevelopReconnect(
    [before.photos.find((p) => p.id === ids[2])],
    [file(a, 2)],
    { namespace: store.namespace },
  );
  const receipts = [];
  const result = await runDevelopReconnect(plan, [ids[2]], {
    store: {
      namespace: store.namespace,
      readPhoto: store.readPhoto,
      attachMissingOriginal: async (...args) => {
        const receipt = await store.attachMissingOriginal(...args);
        controller.abort();
        return receipt;
      },
    },
    signal: controller.signal,
    decode: async () => ({ previewBlob: a, width: 32, height: 24, previewOrigin: "raster" }),
    onCommitted: (receipt) => receipts.push(receipt),
  });
  check(
    "abort after actual durable commit still returns and displays receipt",
    result.stopped &&
      result.attached.length === 1 &&
      result.receipt.photos.length === 1 &&
      receipts.length === 1 &&
      !result.fatalError,
  );
  const after = await store.loadLibrary();
  check(
    "all real IndexedDB documents remain unchanged across races",
    JSON.stringify(before.documents) === JSON.stringify(after.documents),
  );
  return { passed: checks.length, checks, namespace: store.namespace };
} finally {
  store.close();
}
