// Browser-eval regression. Run only in an isolated QA browser at the exact URL below.
// First run seeds 337 synthetic missing records. Reload that URL and run again.
// Never writes Studio storage or the user's real library.
const qaId = "eeaf3000-1111-4222-8333-000000000011";
if (
  location.origin !== "http://127.0.0.1:8085" ||
  location.pathname !== "/develop" ||
  new URLSearchParams(location.search).get("shoot") !== qaId
)
  throw new Error("Refusing to modify a non-QA library.");
const storeModule = await import("/src/lib/develop/store.ts");
const store = storeModule.createDevelopStore({ scope: "device-local", libraryId: `shoot:${qaId}` });
const checks = [];
const check = (value, name) => {
  if (!value) throw new Error(name);
  checks.push(name);
};
const delay = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
async function wait(test, name, timeout = 25000) {
  const end = Date.now() + timeout;
  while (!test()) {
    if (Date.now() > end) throw new Error(`Timeout: ${name}`);
    await delay();
  }
}
async function jpeg(name, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 120;
  canvas.height = 90;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 120, 90);
  ctx.fillStyle = "#fff";
  ctx.fillRect(20, 20, 15, 30);
  return new File([await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg"))], name, {
    type: "image/jpeg",
    lastModified: 1,
  });
}
const root = () => document.querySelector(".foto-develop");
const submit = (files, selector = 'input[aria-label="Import photos"]') => {
  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  const input = root().querySelector(selector);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
};
const idle = async () => {
  await delay(100);
  await wait(() => !root().querySelector(".develop-workspace[inert]"), "import finishes");
};
const initial = await store.loadLibrary();
if (!initial.photos.length) {
  check(!root().querySelector(".develop-filmstrip"), "empty library has no filmstrip");
  check(
    !root().querySelector(".develop-left, .develop-right"),
    "empty library has no disabled editor rails",
  );
  const source = await storeModule.developPhotoFromFile(await jpeg("qa-missing-0.jpg", "#123456"));
  await store.addPhotos(
    Array.from({ length: 337 }, (_, index) => ({
      ...source,
      id: `studio:qa-missing-${index}`,
      name: `qa-missing-${index}.jpg`,
      sourceFileName: `qa-missing-${index}.jpg`,
      sourceBlob: null,
      previewBlob: null,
      sourceDigest: null,
    })),
  );
  globalThis.fotoImportQaReport = {
    phase: "seeded",
    checks,
    next: "Reload this exact QA URL, then run again.",
  };
} else {
  check(
    initial.photos.length === 337 &&
      initial.photos.every(
        (photo) =>
          photo.id.startsWith("studio:qa-missing-") && !photo.sourceBlob && !photo.previewBlob,
      ),
    "only synthetic missing records are present",
  );
  check(
    !root().querySelector(".develop-filmstrip"),
    "337 missing entries do not show a placeholder filmstrip",
  );
  check(
    !root().querySelector(".develop-left, .develop-right"),
    "missing entries do not show disabled editing rails",
  );
  check(
    root().querySelector(".develop-missing-files summary").textContent.includes("337"),
    "all missing entries remain discoverable",
  );
  const bad = new File(["invalid jpeg"], "qa-broken.jpg", { type: "image/jpeg" });
  const good = await jpeg("qa-valid-after-bad.jpg", "#823419");
  submit([bad, good]);
  await idle();
  let library = await store.loadLibrary();
  check(library.photos.length === 338, "valid photo after broken photo imports");
  check(
    root().querySelector(".develop-view-toolbar").textContent.includes(good.name),
    "new import becomes the active photo",
  );
  check(
    root().querySelectorAll(".develop-filmstrip-items > button").length === 1,
    "filmstrip contains only available media",
  );
  check(
    root().querySelector(".develop-import-report").textContent.includes(bad.name),
    "failed filename is reported",
  );
  check(
    initial.photos.every(
      (p) => JSON.stringify(library.documents[p.id]) === JSON.stringify(initial.documents[p.id]),
    ),
    "all 337 saved edit documents survive unchanged",
  );
  submit([good]);
  await idle();
  check((await store.loadLibrary()).photos.length === 338, "same bytes are not imported twice");
  const dropped = await jpeg("qa-drop.jpg", "#285a9d");
  const transfer = new DataTransfer();
  transfer.items.add(dropped);
  root().dispatchEvent(
    new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }),
  );
  await delay();
  check(Boolean(root().querySelector(".develop-drop-overlay")), "file drag has visible feedback");
  root().dispatchEvent(
    new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
  );
  await idle();
  check(!root().querySelector(".develop-drop-overlay"), "drop feedback clears");
  check((await store.loadLibrary()).photos.length === 339, "dropping a photo imports it");
  const folderFile = await jpeg("qa-folder.jpg", "#298656");
  Object.defineProperty(folderFile, "webkitRelativePath", {
    value: "QA shoot/nested/qa-folder.jpg",
  });
  submit([new File(["sidecar"], "qa.xmp"), folderFile], 'input[aria-label="Import photo folder"]');
  await idle();
  library = await store.loadLibrary();
  check(library.photos.length === 340, "folder import continues past a nonphoto sidecar");
  check(
    root().querySelector(".develop-view-toolbar").textContent.includes(folderFile.name),
    "folder photo becomes active",
  );
  check(
    root().querySelector(".develop-import-report").textContent.includes("qa.xmp"),
    "unsupported sidecar is reported, not silently swallowed",
  );
  const bytes = new Uint8Array(await folderFile.arrayBuffer());
  const saved = new Uint8Array(
    await library.photos.find((p) => p.name === folderFile.name).sourceBlob.arrayBuffer(),
  );
  check(
    bytes.length === saved.length && bytes.every((b, i) => b === saved[i]),
    "import preserves exact original bytes",
  );
  await wait(
    () => root().querySelector(".develop-stage img")?.complete,
    "native preview displayed",
  ).catch(async () => {
    check(
      root().querySelector(".develop-stage canvas")?.width > 0,
      "native preview canvas displayed",
    );
  });
  globalThis.fotoImportQaReport = {
    phase: "verified",
    passed: checks.length,
    checks,
    saved: library.photos.length,
  };
}
