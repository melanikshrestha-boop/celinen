// Browser-eval: synthetic QA library only. Does not publish or touch Studio sessions.
const qaId = "eeaf3000-1111-4222-8333-000000000011";
if (
  location.origin !== "http://127.0.0.1:8085" ||
  location.pathname !== "/develop" ||
  new URLSearchParams(location.search).get("shoot") !== qaId
)
  throw new Error("Use the isolated import regression library.");
const module = await import("/src/lib/develop/store.ts");
const store = module.createDevelopStore({ scope: "device-local", libraryId: `shoot:${qaId}` });
const checks = [];
const check = (value, label) => {
  if (!value) throw new Error(label);
  checks.push(label);
};
const root = () => document.querySelector(".foto-develop");
const delay = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
async function wait(fn, label) {
  const until = Date.now() + 15000;
  while (!fn()) {
    if (Date.now() > until) throw new Error(label);
    await delay();
  }
}
function click(label) {
  const button = [...root().querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label || b.textContent.trim() === label,
  );
  check(button && !button.disabled, `${label} is enabled`);
  button.click();
}
const idle = async () => {
  await delay(100);
  await wait(() => !root().querySelector(".develop-workspace[inert]"), "operation finishes");
};
async function jpeg(name, color) {
  const c = document.createElement("canvas");
  c.width = 140;
  c.height = 100;
  const ctx = c.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 140, 100);
  return new File([await new Promise((r) => c.toBlob(r, "image/jpeg"))], name, {
    type: "image/jpeg",
  });
}
function submit(files) {
  const dt = new DataTransfer();
  files.forEach((f) => dt.items.add(f));
  const i = root().querySelector('input[aria-label="Import photos"]');
  i.files = dt.files;
  i.dispatchEvent(new Event("change", { bubbles: true }));
}
const initial = await store.loadLibrary();
check(
  initial.photos.some((p) => p.name === "sony-a6000.ARW"),
  "real Sony RAW fixture persisted from picker upload",
);
check(
  initial.photos.some((p) => p.name === "sony-a7iv-small.ARW"),
  "second real RAW fixture persisted",
);
const missing = initial.photos.filter((p) => p.id.startsWith("studio:qa-missing-"));
check(
  missing.length === 337 && missing.every((p) => !p.sourceBlob && !p.previewBlob),
  "all legacy fixtures remain unchanged after reload",
);
const first = root().querySelector(".develop-filmstrip-items > button");
first.click();
await delay();
check(
  root().querySelector('[aria-label="Previous photograph"]').disabled,
  "navigation starts with first available image, not a missing placeholder",
);
root().dispatchEvent(
  new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }),
);
await delay();
check(
  Boolean(root().querySelector(".develop-right")),
  "left arrow never jumps into the missing legacy records",
);
const filter = root().querySelector('[aria-label="Filter photos"]');
Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(filter, "picks");
filter.dispatchEvent(new Event("change", { bubbles: true }));
await delay();
check(
  root().textContent.includes("No photos match this filter"),
  "empty filter is distinct from empty library",
);
check(!root().querySelector(".develop-right"), "empty filter hides editing controls");
click("Show all photos");
await delay();
check(Boolean(root().querySelector(".develop-right")), "reset filter selects available media");
await delay(600);
const originalFetch = window.fetch;
let intercepted = false;
const cancelled = await jpeg("qa-cancel.jpg", "#791ac2");
try {
  window.fetch = (url, options) => {
    if (String(url) === "/__develop/render") {
      intercepted = true;
      return new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException("Cancelled QA request", "AbortError"));
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener("abort", abort, { once: true });
      });
    }
    return originalFetch(url, options);
  };
  submit([cancelled]);
  await wait(() => intercepted, "import reaches abortable decoder");
  click("Stop import");
  await idle();
  check(
    (await store.loadLibrary()).photos.length === initial.photos.length,
    "cancelled uncommitted photo is not reported or saved",
  );
  check(
    root().querySelector(".develop-status").textContent.includes("Import stopped"),
    "stop is acknowledged",
  );
} finally {
  window.fetch = originalFetch;
}
submit([cancelled]);
await idle();
check(
  (await store.loadLibrary()).photos.some((p) => p.name === cancelled.name),
  "a fresh import succeeds after cancellation",
);
const nested = await jpeg("qa-nested-drop.jpg", "#22baba");
const dt = new DataTransfer();
dt.items.add(nested);
const entry = {
  isFile: true,
  isDirectory: false,
  name: nested.name,
  fullPath: "/QA nested/photos/qa-nested-drop.jpg",
  file: (success) => success(nested),
};
function directory(name, children) {
  return {
    isFile: false,
    isDirectory: true,
    name,
    fullPath: `/${name}`,
    createReader: () => {
      let read = false;
      return {
        readEntries: (success) => {
          success(read ? [] : children);
          read = true;
        },
      };
    },
  };
}
Object.defineProperty(dt.items[0], "webkitGetAsEntry", {
  value: () => directory("QA nested", [directory("photos", [entry])]),
});
root().dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
await idle();
const after = await store.loadLibrary();
check(
  after.photos.some((p) => p.name === nested.name),
  "nested folder drag traverses and imports the photo",
);
check(
  missing.every(
    (p) => JSON.stringify(initial.documents[p.id]) === JSON.stringify(after.documents[p.id]),
  ),
  "all missing-photo histories preserved through cancel and nested drop",
);
const input = root().querySelector('input[aria-label="Exposure value"]');
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "1.25");
input.dispatchEvent(new Event("input", { bubbles: true }));
input.dispatchEvent(new Event("change", { bubbles: true }));
input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
await delay(600);
const final = await store.loadLibrary();
const selected = final.photos.find((p) => p.name === nested.name);
check(
  module.currentRecipe(final.documents[selected.id]).exposure === 1.25,
  "newly imported photo accepts and persists exposure edits",
);
check(
  final.photos.length === initial.photos.length + 2,
  "only two completed new originals were added",
);
globalThis.fotoImportEdgeQaReport = {
  passed: checks.length,
  checks,
  editedId: selected.id,
  exposure: 1.25,
};
