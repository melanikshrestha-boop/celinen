// Run via the browse skill's eval in an isolated browser. Never touches a real project.
const qaId = "eeaf3000-1111-4222-8333-000000000032";
if (
  location.origin !== "http://127.0.0.1:8085" ||
  location.pathname !== "/develop" ||
  new URLSearchParams(location.search).get("shoot") !== qaId
)
  throw new Error("Only run in the isolated grading QA library.");
const checks = [];
const check = (condition, name) => {
  if (!condition) throw new Error(name);
  checks.push(name);
};
const delay = (ms = 40) => new Promise((r) => setTimeout(r, ms));
async function wait(test, name, timeout = 25000) {
  const end = Date.now() + timeout;
  while (!test()) {
    if (Date.now() > end) throw new Error(`Timeout: ${name}`);
    await delay();
  }
}
const root = () => document.querySelector(".foto-develop");
const button = (text) =>
  [...root().querySelectorAll("button")].find((b) => b.textContent.trim() === text);
const image = () => root().querySelector('img[alt="Developed photo"]');
async function settled() {
  await delay(250);
  await wait(
    () =>
      image()?.complete &&
      image().naturalWidth &&
      !root().textContent.includes("Rendering…") &&
      !root().textContent.includes("Saving…"),
    "render and save",
  );
}
const sm = await import("/src/lib/develop/store.ts");
const store = sm.createDevelopStore({ scope: "device-local", libraryId: `shoot:${qaId}` });
const initial = await store.loadLibrary();
if (!initial.photos.length) {
  check(
    !root().querySelector(".develop-histogram, .develop-clipping-overlay, .develop-filmstrip"),
    "empty state has no photo controls or overlays",
  );
  const files = [];
  for (const [name, level] of [
    ["ramp", null],
    ["dark", 60],
    ["bright", 210],
  ]) {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext("2d"),
      pixels = ctx.createImageData(c.width, c.height);
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4,
          v = level ?? x;
        pixels.data.set([v, level === null && y > 90 ? Math.floor(v * 0.65) : v, v, 255], i);
      }
    ctx.putImageData(pixels, 0, 0);
    files.push(
      new File([await new Promise((r) => c.toBlob(r, "image/png"))], `qa-grade-${name}.png`, {
        type: "image/png",
        lastModified: 1,
      }),
    );
  }
  const transfer = new DataTransfer();
  files.forEach((f) => transfer.items.add(f));
  const input = root().querySelector('input[aria-label="Import photos"]');
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await wait(() => root().querySelector(".develop-filmstrip-items"), "imported fixtures");
  await settled();
} else
  check(
    initial.photos.every((p) => p.name.startsWith("qa-grade-")),
    "only grading QA fixtures present",
  );
async function select(name) {
  const el = [...root().querySelectorAll(".develop-filmstrip-items > button")].find((b) =>
    b.textContent.includes(name),
  );
  check(!!el, `fixture ${name} available`);
  el.click();
  await settled();
}
async function saved() {
  const lib = await store.loadLibrary();
  const name = root().querySelector(".develop-view-toolbar > span").textContent.trim();
  const p = lib.photos.find((p) => p.name === name);
  return lib.documents[p.id];
}
async function numeric(label, value) {
  const input = root().querySelector(`input[type="number"][aria-label="${label} value"]`);
  check(!!input, `${label} numeric input exists`);
  input.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
    input,
    String(value),
  );
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.blur();
  await settled();
}
const histogram = () => root().querySelector(".develop-histogram > svg").innerHTML;
await select("qa-grade-ramp.png");
button("Original").click();
await settled();
const originalHist = histogram();
const beforeDoc = await saved();
check(
  root().querySelectorAll(".develop-histogram-zones [role=slider]").length === 5,
  "five keyboard-accessible histogram zones",
);
await numeric("Exposure", 1);
check(histogram() !== originalHist, "exposure changes actual rendered RGB histogram");
const afterDoc = await saved();
check(
  afterDoc.cursor === beforeDoc.cursor + 1,
  "numeric exposure creates one persisted undo entry",
);
root().querySelector('[aria-label="Undo"]').click();
await settled();
check(histogram() === originalHist, "undo restores exact histogram");
for (const name of ["Show shadow clipping", "Show highlight clipping"])
  root().querySelector(`[aria-label="${name}"]`).click();
await delay();
const overlay = root().querySelector(".develop-clipping-overlay");
const overlayData = overlay.getContext("2d").getImageData(0, 0, overlay.width, overlay.height).data;
check(
  overlay.style.display === "block" && overlay.width === image().naturalWidth,
  "clipping overlay matches decoded image geometry",
);
check(
  overlayData.some((v, i) => i % 4 === 3 && v > 0),
  "real clipped pixels produce warning overlay",
);
for (const name of ["Show shadow clipping", "Show highlight clipping"])
  root().querySelector(`[aria-label="${name}"]`).click();
await delay();
check(overlay.style.display === "none", "clipping overlay can be hidden");
const grading = [...root().querySelectorAll("details.develop-panel")].find((d) =>
  d.querySelector("summary").textContent.includes("Color Grading"),
);
grading.open = true;
check(
  grading.querySelectorAll(".develop-grade-wheel").length === 3,
  "three-way real color wheels render",
);
grading.querySelector('[aria-label="Global color grading"]').click();
await delay();
await numeric("Global hue", 220);
await numeric("Global saturation", 40);
check(histogram() !== originalHist, "global grading changes rendered pixels and histogram");
check(
  sm.currentRecipe(await saved()).grading.global.saturation === 40,
  "global grade persists to IndexedDB",
);
grading.querySelector('[aria-label="Reset global color grading"]').click();
await settled();
check(histogram() === originalHist, "per-wheel reset restores original pixels");
await select("qa-grade-dark.png");
button("Original").click();
await settled();
button("Light").click();
await settled();
const dark = sm.currentRecipe(await saved());
check(
  dark.exposure > 0 || dark.shadows > 0,
  "dark source gets lift",
);
const cursor = (await saved()).cursor;
button("Light").click();
await settled();
check(
  sm.currentRecipe(await saved()).exposure === dark.exposure &&
    sm.currentRecipe(await saved()).shadows === dark.shadows &&
    (await saved()).cursor === cursor,
  "repeated Light is idempotent with no extra history",
);
button("Warm negative").click();
await settled();
const warm = sm.currentRecipe(await saved());
check(
  warm.grain === 18 && warm.grainLuminance === 100,
  "adaptive film look activates luminance-shaped grain",
);
const lookEv = warm.exposure;
button("Warm negative").click();
await settled();
check(
  sm.currentRecipe(await saved()).exposure === lookEv,
  "adaptive preset does not compound exposure",
);
await select("qa-grade-bright.png");
button("Original").click();
await settled();
button("Light").click();
await settled();
check(
  sm.currentRecipe(await saved()).highlights < 0,
  "bright source gets a highlight pull",
);
check(
  root().querySelector('[aria-label="Show highlight clipping"]').getAttribute("aria-pressed") ===
    "false",
  "photo change clears diagnostic clipping state",
);
const bright = sm.currentRecipe(await saved()).exposure;
const zone = root().querySelector('[aria-label="Histogram Exposure"]');
const prior = await saved();
zone.focus();
for (let n = 0; n < 5; n++) {
  zone.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  await delay();
}
zone.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
await settled();
check(
  (await saved()).cursor === prior.cursor + 1 &&
    sm.currentRecipe(await saved()).exposure === Math.round((bright + 0.5) * 100) / 100,
  "histogram keyboard repeat commits once",
);
zone.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
zone.dispatchEvent(new KeyboardEvent("keyup", { key: "Home", bubbles: true }));
await settled();
check(sm.currentRecipe(await saved()).exposure === -5, "histogram Home uses minimum");
zone.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
zone.dispatchEvent(new KeyboardEvent("keyup", { key: "End", bubbles: true }));
await settled();
check(sm.currentRecipe(await saved()).exposure === 5, "histogram End uses maximum");
zone.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
await delay();
zone.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
await settled();
check(Number(zone.getAttribute("aria-valuenow")) === 5, "Escape cancels histogram keyboard draft");
const clip = root().querySelector('[aria-label="Show highlight clipping"]');
clip.click();
button("Before").click();
await delay(150);
check(
  !clip.disabled && clip.getAttribute("aria-pressed") === "true",
  "clipping remains controllable in Before view",
);
clip.click();
await delay();
check(
  root().querySelector(".develop-clipping-overlay").style.display === "none",
  "Before clipping can be cleared",
);
button("Before").click();
await settled();
if (!(await store.loadLibrary()).photos.some((p) => p.name === "qa-grade-black.png")) {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 64, 64);
  const f = new File([await new Promise((r) => c.toBlob(r, "image/png"))], "qa-grade-black.png", {
    type: "image/png",
    lastModified: 1,
  });
  const dt = new DataTransfer();
  dt.items.add(f);
  const input = root().querySelector('input[aria-label="Import photos"]');
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await settled();
}
await select("qa-grade-black.png");
await numeric("Exposure", 2);
button("Light").click();
await settled();
check(
  sm.currentRecipe(await saved()).shadows > 0,
  "Light still acts on extreme underexposure",
);
globalThis.fotoGradingQaReport = {
  checks,
  passed: checks.length,
  darkExposure: dark,
  brightExposure: bright,
};
return globalThis.fotoGradingQaReport;
