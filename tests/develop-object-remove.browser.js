// Disposable local lab only. Reviews native output and preserves original photo/document.
if (
  location.origin !== "http://127.0.0.1:8085" ||
  location.pathname !== "/shoots/eeaf3000-1111-4222-8333-000000000039/develop"
)
  throw new Error("Dedicated QA shoot required");
const checks = [];
const check = (name, ok) => {
  if (!ok) throw new Error(name);
  checks.push(name);
};
const root = () => document.querySelector(".foto-develop");
const button = (label) =>
  [...root().querySelectorAll("button")].find(
    (b) => b.textContent.trim() === label || b.getAttribute("aria-label") === label,
  );
const wait = async (fn, message) => {
  const end = Date.now() + 25000;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error(message);
};
const click = async (label) => {
  const b = button(label);
  if (!b || b.disabled) throw new Error(`Unavailable ${label}`);
  b.click();
  await new Promise((r) => setTimeout(r, 80));
};
await wait(root, "Develop unavailable");
if (root().querySelector("[role=dialog]")) await click("Cancel");
const { createDevelopStore } = await import("/src/lib/develop/store.ts");
const store = createDevelopStore({
  scope: "device-local",
  libraryId: "shoot:eeaf3000-1111-4222-8333-000000000039",
});
const before = await store.loadLibrary();
if (before.photos.length !== 1 || before.photos[0].isRaw)
  throw new Error("Exactly one disposable JPEG fixture required");
const id = before.photos[0].id,
  documentBefore = JSON.stringify(before.documents[id]);
const sha = async (b) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", await b.arrayBuffer()))].join(",");
const sourceBefore = await sha(before.photos[0].sourceBlob);
let mask;
const originalFetch = window.fetch;
try {
  window.fetch = async function (resource, init) {
    const response = await originalFetch.call(this, resource, init);
    if (
      String(resource) === "/__remove/process" &&
      response.headers.get("Content-Type") === "application/x-foto-instances"
    )
      mask = new Uint8Array(await response.clone().arrayBuffer());
    return response;
  };
  await click("Remove Object");
  await wait(
    () => mask && button("Object 1") && !button("Object 1").disabled,
    "Vision selection did not finish",
  );
  const { decodeObjectInstances, objectAtPoint } =
    await import("/src/lib/develop/object-remove.ts");
  const instances = decodeObjectInstances(mask);
  let point;
  for (let y = 10; y < instances.height - 10 && !point; y++)
    for (let x = 10; x < instances.width - 10; x++) {
      const index = y * instances.width + x,
        label = instances.labels[index];
      if (
        label &&
        [-3, 0, 3].every((dy) =>
          [-3, 0, 3].every((dx) => instances.labels[index + dy * instances.width + dx] === label),
        )
      ) {
        point = { x: (x + 0.5) / instances.width, y: (y + 0.5) / instances.height };
        break;
      }
    }
  check(
    "detected mask has a clickable object interior",
    point && objectAtPoint(instances, point.x, point.y) > 0,
  );
  const picker = root().querySelector(".foto-object-picker"),
    rect = picker.getBoundingClientRect();
  picker.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      clientX: rect.x + rect.width * point.x,
      clientY: rect.y + rect.height * point.y,
    }),
  );
  await wait(() => !button("Remove Selected").disabled, "Click selection did not enable removal");
  check(
    "clicking image selects object without a brush",
    root().querySelector(".foto-object-choices [aria-pressed=true]"),
  );
  check(
    "one action footer only",
    root().querySelectorAll("[role=dialog] .develop-dialog-actions").length === 1,
  );
  const imageRect = root().querySelector(".foto-object-image img").getBoundingClientRect();
  check(
    "click mask exactly overlays displayed image",
    Math.abs(rect.width - imageRect.width) < 0.1 && Math.abs(rect.height - imageRect.height) < 0.1,
  );
  await click("Remove Selected");
  await wait(
    () => button("Save Copy") && !button("Save Copy").disabled,
    "Native fill did not finish",
  );
  check(
    "review contains real before-after and explicit save",
    button("Before / After") && button("Save Copy"),
  );
  const preview = root().querySelector(".foto-object-image img");
  await wait(() => preview.complete && preview.naturalWidth > 0, "PNG did not decode");
  const dims = { width: preview.naturalWidth, height: preview.naturalHeight };
  await click("Before / After");
  await click("Before / After");
  await click("Save Copy");
  await wait(() => !root().querySelector("[role=dialog]"), "Copy did not save");
  const after = await store.loadLibrary(),
    original = after.photos.find((p) => p.id === id),
    copy = after.photos.find((p) => p.id !== id);
  check(
    "one separate PNG derivative saved",
    after.photos.length === 2 && copy.sourceBlob.type === "image/png",
  );
  check(
    "saved copy dimensions match preview",
    copy.width === dims.width && copy.height === dims.height,
  );
  check("original source byte-identical", (await sha(original.sourceBlob)) === sourceBefore);
  check(
    "original edits and history byte-identical",
    JSON.stringify(after.documents[id]) === documentBefore,
  );
  check(
    "new copy is a neutral document, not double graded",
    after.documents[copy.id].history.length === 1,
  );
  return {
    passed: checks.length,
    checks,
    dimensions: dims,
    quality: "Experimental texture fill; not a generative quality assertion",
  };
} finally {
  window.fetch = originalFetch;
  store.close?.();
}
