// Real native-decoder / React / IndexedDB QA. Reserved namespace ONLY; no customer records.
// Run seed, reload, then review; inspect dialog before run and verify. Cleanup is explicit.
const shoot = "eeaf3000-1111-4222-8333-000000000101";
if (location.origin !== "http://127.0.0.1:8085" || location.pathname !== `/shoots/${shoot}/develop`)
  throw new Error("Open only the reserved batch-reconnect QA route.");
const action = globalThis.fotoBatchReconnectAction || "seed";
const module = await import("/src/lib/develop/store.ts");
const { defaultDevelopSettings } = await import("/src/lib/develop/contract.ts");
const store = module.createDevelopStore({ scope: "device-local", libraryId: `shoot:${shoot}` });
const marker = `foto:qa:batch-reconnect:${shoot}`;
const hash = async (blob) =>
  `sha256:${[...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
const canvas = document.createElement("canvas");
canvas.width = 320;
canvas.height = 240;
const context = canvas.getContext("2d");
context.fillStyle = "#726957";
context.fillRect(0, 0, 320, 240);
context.fillStyle = "#b09368";
context.fillRect(50, 40, 100, 120);
const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
const jpeg = await (await fetch("/tests/fixtures/photos/volleyball-portrait-cc0.jpg")).blob();
if (
  (await hash(jpeg)) !== "sha256:5685e8468969ca05da9de250f5848df5318e6b47b1a14d4aebd5c19675224fce"
)
  throw new Error("Public JPEG changed.");
const files = [
  new File([jpeg], "volleyball-portrait-cc0.jpg", { type: "image/jpeg" }),
  new File(["not an image"], "qa-corrupt.png", { type: "image/png" }),
  new File([png], "qa-after-corrupt.png", { type: "image/png" }),
  new File([png], "qa-unknown.png", { type: "image/png" }),
  new File([png], "qa-mismatch.png", { type: "image/png" }),
  new File([png], "qa-duplicate.png", { type: "image/png" }),
  new File([jpeg], "qa-duplicate.png", { type: "image/png" }),
];
const checks = [];
const check = (name, value) => {
  if (!value) throw new Error(name);
  checks.push(name);
};
const root = () => document.querySelector(".foto-develop");
const dialog = () => root()?.querySelector('[role="dialog"]');
const button = (name, owner = root()) =>
  [...owner.querySelectorAll("button")].find(
    (node) => node.textContent.trim() === name || node.getAttribute("aria-label") === name,
  );
const wait = async (predicate, message) => {
  const end = Date.now() + 45000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
try {
  const saved = sessionStorage.getItem(marker);
  if (action === "seed") {
    const before = await store.loadLibrary();
    check(
      "QA library starts empty",
      before.photos.length === 0 && Object.keys(before.documents).length === 0 && !saved,
    );
    const inputs = [];
    const expected = {};
    for (let index = 0; index < 337; index++) {
      const id = `studio:qa-batch-reconnect-${index}`;
      const name =
        index < 6
          ? files[index].name
          : index === 6
            ? "sony-a7iv-small.ARW"
            : `qa-missing-${index}.ARW`;
      const digest =
        index < 3
          ? await hash(files[index])
          : index === 4
            ? `sha256:${"0".repeat(64)}`
            : index === 6
              ? "sha256:cbbd0930c7d8706dff84c68a2004454266e6fd0d8354f5f76a106b5d776e0223"
              : null;
      inputs.push({
        id,
        name,
        sourceFileName: name,
        sourceLastModified: 0,
        sourceBlob: null,
        previewBlob: null,
        sourceDigest: digest,
        isRaw: index >= 6,
        width: 0,
        height: 0,
        initialState: {
          settings: { ...defaultDevelopSettings(), exposure: 0.5, temperature: 12 },
          metadata: { rating: 4, flag: "pick", colorLabel: "green" },
        },
      });
      expected[id] = { name, digest };
    }
    await store.addPhotos(inputs);
    const library = await store.loadLibrary();
    sessionStorage.setItem(
      marker,
      JSON.stringify({ expected, photos: library.photos, documents: library.documents }),
    );
    return {
      seeded: library.photos.length,
      next: "Reload, then set fotoBatchReconnectAction='review' and rerun.",
    };
  }
  if (!saved) throw new Error("Seed the isolated fixture first.");
  const baseline = JSON.parse(saved);
  if (action === "review") {
    button("Reconnect").click();
    await wait(dialog, "Reconnect dialog missing");
    const input = dialog().querySelector('input[type="file"][multiple]:not([webkitdirectory])');
    check("multiple-file chooser available", Boolean(input));
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(
      () =>
        dialog()?.textContent.includes("Verified") &&
        dialog().querySelectorAll('input[type="checkbox"]:checked').length === 3,
      "Read-only review did not finish",
    );
    check(
      "three verified files selected by default",
      dialog().querySelectorAll('input[type="checkbox"]:checked').length === 3,
    );
    check(
      "review preserves every photo",
      JSON.stringify((await store.loadLibrary()).photos) === JSON.stringify(baseline.photos),
    );
    check(
      "review preserves all 337 documents",
      JSON.stringify((await store.loadLibrary()).documents) === JSON.stringify(baseline.documents),
    );
    check(
      "review rows are bounded",
      dialog().querySelectorAll('input[type="checkbox"]').length <= 41,
    );
    return { passed: checks.length, checks, text: dialog().textContent };
  }
  if (action === "verify") {
    const library = await store.loadLibrary();
    check("all 337 records retained", library.photos.length === 337);
    check(
      "all 337 treatments and revisions retained exactly",
      JSON.stringify(library.documents) === JSON.stringify(baseline.documents),
    );
    const attached = library.photos.filter((photo) => photo.sourceBlob?.size);
    check(
      "only two valid verified originals attached",
      attached.length === 2 &&
        attached.every((photo) =>
          ["studio:qa-batch-reconnect-0", "studio:qa-batch-reconnect-2"].includes(photo.id),
        ),
    );
    for (const photo of attached) {
      check(
        `${photo.name} source bytes match`,
        (await hash(photo.sourceBlob)) === baseline.expected[photo.id].digest,
      );
      check(
        `${photo.name} native preview decodes`,
        (await createImageBitmap(photo.previewBlob)).width > 0,
      );
    }
    check(
      "failed and unselected records stay unchanged",
      library.photos
        .filter((photo) => !photo.sourceBlob?.size)
        .every(
          (photo) =>
            JSON.stringify(photo) ===
            JSON.stringify(baseline.photos.find((old) => old.id === photo.id)),
        ),
    );
    return { passed: checks.length, checks, attached: attached.map((photo) => photo.name) };
  }
  if (action === "verify-raw") {
    const library = await store.loadLibrary();
    check(
      "all history preserved after actual RAW chooser",
      JSON.stringify(library.documents) === JSON.stringify(baseline.documents),
    );
    const raw = library.photos.find((photo) => photo.id === "studio:qa-batch-reconnect-6");
    check(
      "actual RAW source retains full SHA-256",
      (await hash(raw.sourceBlob)) === baseline.expected[raw.id].digest,
    );
    check("RAW has real decoded preview", (await createImageBitmap(raw.previewBlob)).width > 0);
    return { passed: checks.length, checks };
  }
  throw new Error(`Unknown action ${action}`);
} finally {
  store.close();
}
