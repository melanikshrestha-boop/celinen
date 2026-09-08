// Cross-panel pointer transaction regression; only synthetic QA7, no real project data.
const id = "eeaf3000-1111-4222-8333-000000000007";
if (
  location.origin !== "http://127.0.0.1:8085" ||
  location.pathname !== "/develop" ||
  new URLSearchParams(location.search).get("shoot") !== id
)
  throw new Error("QA7 only");
const sm = await import("/src/lib/develop/store.ts"),
  store = sm.createDevelopStore({ scope: "device-local", libraryId: `shoot:${id}` });
const initial = await store.loadLibrary();
if (initial.photos.length !== 1 || initial.photos[0].id !== "studio:qa-reconnect")
  throw new Error("Expected generated QA fixture");
const original = initial.documents["studio:qa-reconnect"],
  root = document.querySelector(".foto-develop");
const checks = [],
  check = (ok, name) => {
    if (!ok) throw new Error(name);
    checks.push(name);
  };
const tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const panel = [...root.querySelectorAll("details.develop-panel")].find((d) =>
  d.querySelector("summary").textContent.includes("Color Grading"),
);
panel.open = true;
root.querySelector('[aria-label="Three-way color grading"]').click();
await tick();
const wheel = root.querySelector('[aria-label="Shadows color wheel"]');
wheel.scrollIntoView({ block: "center" });
const rect = wheel.getBoundingClientRect(),
  descriptors = new Map();
let captured = false;
for (const [name, value] of Object.entries({
  setPointerCapture: () => {
    captured = true;
  },
  hasPointerCapture: () => captured,
  releasePointerCapture: () => {
    captured = false;
  },
})) {
  descriptors.set(name, Object.getOwnPropertyDescriptor(wheel, name));
  Object.defineProperty(wheel, name, { configurable: true, value });
}
const dispatch = (target, type, pointerId) =>
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: rect.left + rect.width * 0.2,
      clientY: rect.top + rect.height * 0.5,
    }),
  );
try {
  dispatch(wheel, "pointerdown", 701);
  await tick();
  check(
    Number(wheel.getAttribute("aria-valuenow")) > 0,
    "primary wheel creates a real preview draft",
  );
  const preset = [...root.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === "Warm negative",
  );
  check(!dispatch(preset, "pointerdown", 702), "secondary pointer down is blocked across panels");
  check(
    !dispatch(preset, "click", 702),
    "secondary preset click cannot commit the first wheel preview",
  );
  const exposure = root.querySelector('[aria-label="Exposure"]');
  const key = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
  exposure.dispatchEvent(key);
  check(key.defaultPrevented, "cross-panel keyboard attempt is blocked during pointer ownership");
  dispatch(preset, "pointerdown", 703);
  dispatch(wheel, "pointercancel", 701);
  await tick();
  dispatch(preset, "pointerup", 703);
  check(!dispatch(preset, "click", 703), "rejected tap stays rejected after first pointer cancels");
  await new Promise((r) => setTimeout(r, 400));
  const after = (await store.loadLibrary()).documents["studio:qa-reconnect"];
  check(
    JSON.stringify(after) === JSON.stringify(original),
    "cancel leaves exact persisted document and redo history unchanged",
  );
  check(
    Number(wheel.getAttribute("aria-valuenow")) ===
      sm.currentRecipe(original).grading.shadows.saturation,
    "cancel restores displayed wheel",
  );
  return { passed: checks.length, checks };
} finally {
  dispatch(wheel, "pointercancel", 701);
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(wheel, name, descriptor);
    else delete wheel[name];
  }
  store.close();
}
