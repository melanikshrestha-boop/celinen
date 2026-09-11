// Disposable QA:039 public JPEG,040 separately imported public Sony RAW.
if (
  location.origin !== "http://127.0.0.1:8085" ||
  ![
    "/shoots/eeaf3000-1111-4222-8333-000000000039/develop",
    "/shoots/eeaf3000-1111-4222-8333-000000000040/develop",
  ].includes(location.pathname)
)
  throw new Error("Dedicated QA shoot required");
const checks = [];
const check = (name, ok) => {
  if (!ok) throw new Error(name);
  checks.push(name);
};
const root = () => document.querySelector(".foto-develop");
const wait = async (predicate, message, ms = 25000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error(message);
};
const button = (label) =>
  [...root().querySelectorAll("button")].find(
    (b) => b.textContent.trim() === label || b.getAttribute("aria-label") === label,
  );
const click = async (label) => {
  const b = button(label);
  if (!b || b.disabled) throw new Error(`Unavailable ${label}`);
  b.click();
  await new Promise((r) => setTimeout(r, 60));
};
await wait(root, "Develop did not mount");
await wait(
  () => root().querySelector('input[type=file][aria-label="Import photos"]'),
  "Import input did not mount",
);
if (!root().querySelector(".develop-filmstrip-items button")) {
  if (location.pathname.includes("000000000040"))
    throw new Error("Import the public Sony RAW fixture first");
  const blob = await (await fetch("/tests/fixtures/photos/basketball-action-usaf-pd.jpg")).blob();
  const files = new DataTransfer();
  files.items.add(new File([blob], "parity-public-domain.jpg", { type: "image/jpeg" }));
  const input = root().querySelector('input[type=file][aria-label="Import photos"]');
  input.files = files.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
const ready = () =>
  !button("Remove Object")?.disabled &&
  root().querySelector(".develop-image-frame img")?.naturalWidth > 0;
await wait(ready, "Native image did not render");
check(
  "public fixture imported through real handler",
  !!root().querySelector(".develop-filmstrip-items button"),
);
const createURL = URL.createObjectURL,
  anchorClick = HTMLAnchorElement.prototype.click;
const blobs = new Map();
let exported, expectedHash;
try {
  URL.createObjectURL = function (blob) {
    const url = createURL.call(URL, blob);
    blobs.set(url, blob);
    return url;
  };
  HTMLAnchorElement.prototype.click = function () {
    if (this.download.endsWith(".jpg")) {
      exported = blobs.get(this.href);
      return;
    }
    return anchorClick.call(this);
  };
  await click("Reset");
  await wait(ready, "Reset did not render");
  await new Promise((r) => setTimeout(r, 300));
  await wait(ready, "Reset did not settle");
  const previousUrl = root().querySelector(".develop-image-frame img").src;
  const input = root().querySelector('input[aria-label="Exposure value"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "0.75");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  await wait(
    () => ready() && root().querySelector(".develop-image-frame img").src !== previousUrl,
    "Exposure did not render",
  );
  check("real edit reached UI", input.value === "0.75");
  const shown = await blobs.get(root().querySelector(".develop-image-frame img").src).arrayBuffer();
  const hash = async (bytes) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  expectedHash = await hash(shown);
  await click("Export");
  if (location.pathname.includes("000000000040")) {
    const source = [...root().querySelectorAll("[role=dialog] select")].find((s) =>
      [...s.options].some((o) => o.value === "raw"),
    );
    check("RAW editor and export use sensor processing by default", source?.value === "raw");
  }
  await click("Preview export");
  await wait(
    () => root().querySelector(".develop-export-proof img")?.naturalWidth > 0,
    "Export proof unavailable",
  );
  const proof = await blobs
    .get(root().querySelector(".develop-export-proof img").src)
    .arrayBuffer();
  check("editor and export preview are byte-identical", (await hash(proof)) === expectedHash);
  await click("Export JPEG");
  await wait(() => exported && !root().querySelector("[role=dialog]"), "Export did not finish");
  check(
    "download is byte-identical to edited image",
    (await hash(await exported.arrayBuffer())) === expectedHash,
  );
} finally {
  URL.createObjectURL = createURL;
  HTMLAnchorElement.prototype.click = anchorClick;
}
check(
  "source photo still present",
  root().querySelectorAll(".develop-filmstrip-items button").length === 1,
);
return { passed: checks.length, checks, exactEditedJpegSHA256: expectedHash };
