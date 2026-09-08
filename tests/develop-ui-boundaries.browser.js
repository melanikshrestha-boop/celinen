/* Async browser-eval body. Run only in the isolated Develop QA tab after import
 * and saves settle. Exercises view/selection/modal state; never changes a recipe,
 * imports files, confirms an export, or edits customer/storage records. */
if (!["localhost", "127.0.0.1"].includes(location.hostname))
  throw new Error("Develop UI checks require a local QA origin.");
const root = document.querySelector("[aria-label='FOTO Develop']");
if (!root || root.querySelector("[role=dialog]") || !root.textContent.includes("All edits saved"))
  throw new Error("Open a settled Develop QA library before running these checks.");
const checks = [];
function check(name, condition) { if (!condition) throw new Error(name); checks.push(name); }
const tick = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
async function until(predicate) {
  const limit = Date.now() + 15000;
  while (!predicate()) {
    if (Date.now() > limit) throw new Error("Develop UI check timed out.");
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}
function click(button, multi = false) {
  if (!button) throw new Error("Expected QA button was not found.");
  button.focus();
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: multi }));
}
const buttons = () => [...root.querySelectorAll(".develop-filmstrip-items button")];
const filter = root.querySelector("select[aria-label='Filter photos']");
const originalFilter = filter.value;
const originalSelected = buttons().filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.getAttribute("aria-label"));
const originalActive = buttons().find((b) => b.classList.contains("is-active"))?.getAttribute("aria-label");
const originalFetch = window.fetch;
function setFilter(value) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(filter, value);
  filter.dispatchEvent(new Event("change", { bubbles: true }));
}
try {
  click([...root.querySelectorAll(".develop-segment button")].find((b) => b.textContent.trim() === "Develop"));
  setFilter("all");
  await tick();
  const frames = buttons();
  if (!frames.length) throw new Error("The QA library needs at least one synthetic photograph.");
  click(frames[0]);
  for (const button of frames.slice(1)) click(button, true);
  await tick();
  setFilter("picks");
  await tick();
  const filtered = buttons(),
    selected = filtered.filter((b) => b.getAttribute("aria-pressed") === "true");
  const count = root.querySelector(".develop-filmstrip-bar").textContent.match(/(\d+) selected/);
  check("filter removes every invisible sync target", Number(count?.[1]) === selected.length);
  check("filtered active source is visible or cleared when no matches remain", filtered.length ? filtered.filter((b) => b.classList.contains("is-active")).length === 1 : !root.querySelector(".develop-stage img"));
  setFilter("all");
  await tick();
  click(buttons()[0]);
  await until(() => !root.textContent.includes("Rendering…") && root.querySelector(".develop-stage img"));

  const exportButton = [...root.querySelectorAll(".develop-topbar button")].find((b) => b.textContent.trim() === "Export");
  await until(() => !exportButton.disabled);
  click(exportButton);
  await tick();
  const dialog = root.querySelector("[role=dialog]");
  check("Export dialog receives keyboard focus", dialog?.contains(document.activeElement));
  check("toolbar behind the dialog is inert", root.querySelector(".develop-topbar").inert === true);
  const focusable = [...dialog.querySelectorAll("button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex='-1'])")].filter((e) => e.getClientRects().length);
  const first = focusable[0], last = focusable.at(-1);
  last.focus();
  last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
  check("Tab wraps within the modal", document.activeElement === first);
  first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
  check("Shift-Tab wraps within the modal", document.activeElement === last);
  last.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await tick();
  check("Escape closes Export without confirming it", !root.querySelector("[role=dialog]"));
  check("closing restores keyboard focus to Export", document.activeElement === exportButton);

  // Delay only delivery of real native render responses, not image contents.
  // The old final render must disappear from a source-space tool immediately.
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const address = typeof args[0] === "string" ? args[0] : args[0]?.url ?? String(args[0]);
    if (address.includes("/__develop/render")) await new Promise((resolve) => setTimeout(resolve, 1000));
    return response;
  };
  const cropButton = root.querySelector("button[aria-label='Crop tool']");
  if (cropButton.getAttribute("aria-pressed") === "true") { click(cropButton); await tick(); await until(() => !root.textContent.includes("Rendering…")); }
  click(cropButton);
  await tick();
  const sourcePreview = root.querySelector(".develop-navigator img")?.src;
  const displayed = root.querySelector(".develop-stage img");
  check("source-space tool uses neutral source while uncropped render is pending", Boolean(sourcePreview) && displayed?.src === sourcePreview);
  const overlay = root.querySelector(".develop-overlay");
  check("geometry is hidden until the displayed image is loaded", overlay?.dataset.geometryReady === "true" ? displayed.complete && displayed.naturalWidth > 0 : overlay?.style.pointerEvents === "none");
  await until(() => !root.textContent.includes("Rendering…") && root.querySelector(".develop-overlay")?.dataset.geometryReady === "true");
  check("geometry activates after its current source image loads", root.querySelector(".develop-overlay").style.pointerEvents === "auto");
  window.fetch = originalFetch;
  click(cropButton);
  await tick();
  await until(() => !root.textContent.includes("Rendering…"));
  check("returning to Develop keeps a usable final preview", Boolean(root.querySelector(".develop-stage img")?.naturalWidth));
  return { passed: checks.length, checks, note: "Real React handlers and native responses in QA; no recipe edits or export confirmation." };
} finally {
  window.fetch = originalFetch;
  const openDialog = root.querySelector("[role=dialog]");
  if (openDialog) openDialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  const crop = root.querySelector("button[aria-label='Crop tool']");
  if (crop?.getAttribute("aria-pressed") === "true") click(crop);
  setFilter(originalFilter);
  await tick();
  const restored = buttons();
  const original = restored.find((b) => b.getAttribute("aria-label") === originalActive);
  if (original) {
    click(original);
    for (const button of restored) if (originalSelected.includes(button.getAttribute("aria-label")) && button !== original) click(button, true);
    click(original, true);
  }
}
