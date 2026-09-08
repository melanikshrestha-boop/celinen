// Real public sports/RAW fixtures previously imported through file input in isolated QA33.
const id = "eeaf3000-1111-4222-8333-000000000033";
if (
  location.origin !== "http://127.0.0.1:8085" ||
  location.pathname !== "/develop" ||
  new URLSearchParams(location.search).get("shoot") !== id
)
  throw new Error("QA33 only");
const root = document.querySelector(".foto-develop"),
  checks = [];
const check = (v, name) => {
  if (!v) throw new Error(name);
  checks.push(name);
};
const delay = (ms = 50) => new Promise((r) => setTimeout(r, ms));
async function wait(fn, name) {
  const end = Date.now() + 60000;
  while (!fn()) {
    if (Date.now() > end) throw new Error(name);
    await delay();
  }
}
const button = (text) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
const { createDevelopStore, currentRecipe } = await import("/src/lib/develop/store.ts");
const store = createDevelopStore({ scope: "device-local", libraryId: `shoot:${id}` });
const library = await store.loadLibrary();
const sport = library.photos.find((p) => p.name === "001_basketball-action-usaf-pd.jpg"),
  raw = library.photos.find((p) => p.name === "sony-a6000.ARW");
check(
  library.photos.length === 2 && !!sport && !!raw,
  "only public real-photo QA fixtures present",
);
check(
  currentRecipe(library.documents[sport.id]).grading.global.saturation === 10,
  "real keyboard global grading survived reload",
);
check(document.documentElement.scrollWidth <= innerWidth + 1, "page has no horizontal overflow");
check(
  getComputedStyle(root.querySelector(".develop-histogram-wrap")).display !== "none",
  "histogram is available at the current viewport",
);
const bytes = new Uint8Array(await raw.sourceBlob.arrayBuffer());
const blobs = new Map(),
  originalUrl = URL.createObjectURL;
URL.createObjectURL = function (blob) {
  const url = originalUrl.call(this, blob);
  blobs.set(url, blob);
  return url;
};
try {
  root.querySelector('button[aria-label="2. sony-a6000.ARW"]').click();
  await delay(300);
  await wait(() => !button("Export").disabled, "RAW preview loads");
  button("Warm negative").click();
  await delay(300);
  await wait(() => !button("Export").disabled, "native film look renders");
  button("Export").click();
  await wait(() => button("Preview export"), "export dialog");
  button("Preview export").click();
  await wait(
    () =>
      root.querySelector(".develop-export-proof img")?.complete &&
      root.querySelector(".develop-export-proof img").naturalWidth,
    "sensor export proof",
  );
  const img = root.querySelector(".develop-export-proof img"),
    proof = blobs.get(img.src);
  check(
    img.naturalWidth === 4096 && img.naturalHeight === 2736,
    "graded RAW export proof is 4096 by 2736",
  );
  check(proof instanceof Blob, "actual proof JPEG bytes captured");
  const originalClick = HTMLAnchorElement.prototype.click;
  let download = null;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download.endsWith("-foto.jpg")) {
      download = { name: this.download, url: this.href };
      return;
    }
    return originalClick.call(this);
  };
  try {
    button("Export JPEG").click();
    await wait(() => download, "download triggers");
  } finally {
    HTMLAnchorElement.prototype.click = originalClick;
  }
  const exported = blobs.get(download.url),
    a = new Uint8Array(await proof.arrayBuffer()),
    b = new Uint8Array(await exported.arrayBuffer());
  check(
    a.length === b.length && a.every((v, i) => v === b[i]),
    "download bytes exactly match displayed graded RAW proof",
  );
  const final = await store.loadLibrary(),
    after = new Uint8Array(
      await final.photos.find((p) => p.id === raw.id).sourceBlob.arrayBuffer(),
    );
  check(
    bytes.length === after.length && bytes.every((v, i) => v === after[i]),
    "all original RAW bytes remain unchanged",
  );
  const recipe = currentRecipe(final.documents[raw.id]);
  check(
    recipe.grain === 18 && recipe.grainLuminance === 100,
    "adaptive grain settings persist after RAW export",
  );
  return {
    passed: checks.length,
    checks,
    exportBytes: exported.size,
    dimensions: [img.naturalWidth, img.naturalHeight],
  };
} finally {
  URL.createObjectURL = originalUrl;
  store.close();
}
