// Isolated local browser only; requires a blank session-only editor, never publishes or fetches a site.
if (location.origin !== "http://127.0.0.1:8085" || location.pathname !== "/portfolio")
  throw new Error("Local importer required");
const check = (name, ok) => {
    if (!ok) throw new Error(name);
    checks.push(name);
  },
  checks = [];
const wait = async (fn, message) => {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(message);
};
await wait(() => document.querySelector('[aria-label="Website import"]'), "Importer did not mount");
const panel = () => document.querySelector('[aria-label="Website import"]');
const name = document.querySelector('input[placeholder="Your name"]');
if (!name || name.value) throw new Error("Blank disposable editor required");
const put = async (element, value) => {
  Object.getOwnPropertyDescriptor(
    element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    "value",
  ).set.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));
};
await put(name, "QA Preserved Name");
const picture = await (await fetch("/tests/fixtures/photos/volleyball-portrait-cc0.jpg")).blob();
const photoInput = [...document.querySelectorAll("input[type=file]")].find(
  (x) => !panel().contains(x) && x.accept === "image/*",
);
if (!photoInput) throw new Error("Photo input not found");
const photos = new DataTransfer();
photos.items.add(new File([picture], "qa-preserved-photo.jpg", { type: "image/jpeg" }));
photoInput.files = photos.files;
photoInput.dispatchEvent(new Event("change", { bubbles: true }));
await new Promise((r) => setTimeout(r, 100));
const originalPhotoUrls = [...document.querySelectorAll("img")]
  .filter((i) => i.src.startsWith("blob:"))
  .map((i) => i.src);
check("real photo added to preview", originalPhotoUrls.length > 0);
const input = panel().querySelector("input[type=file]");
check("permission required before choosing a file", input.disabled);
panel().querySelector("input[type=checkbox]").click();
await wait(() => !input.disabled, "Permission did not enable chooser");
const read = async (text, fileName, type) => {
  const dt = new DataTransfer();
  dt.items.add(new File([text], fileName, { type }));
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await wait(() => panel().querySelector('[aria-label="Import preview"]'), "File was not parsed");
};
let networkCalls = 0;
const realFetch = window.fetch;
window.fetch = function (...args) {
  networkCalls++;
  return realFetch.apply(this, args);
};
const createURL = URL.createObjectURL,
  click = HTMLAnchorElement.prototype.click,
  blobs = new Map();
let downloaded;
try {
  await read(
    '<!doctype html><title>QA Imported Name</title><meta name="description" content="Photographer biography"><h1>Same Night Heroes</h1><nav><a href="/work">Work</a></nav><script>window.__fotoImportExecuted=true</script>',
    "owned-site.html",
    "text/html",
  );
  const preview = panel().querySelector('[aria-label="Import preview"]');
  check(
    "review fields start unchecked",
    [...preview.querySelectorAll("input[type=checkbox]")].every((x) => !x.checked),
  );
  check("saved HTML cannot execute scripts", !window.__fotoImportExecuted);
  for (const label of preview.querySelectorAll("label"))
    if (/Site [Nn]ame|Headline/.test(label.textContent)) label.querySelector("input").click();
  await new Promise((r) => setTimeout(r, 50));
  const apply = [...panel().querySelectorAll("button")].find(
    (b) => b.textContent.trim().toLowerCase() === "fill blank fields",
  );
  check("explicit field choices enable apply", apply && !apply.disabled);
  apply.click();
  await new Promise((r) => setTimeout(r, 60));
  check("existing name preserved", name.value === "QA Preserved Name");
  check(
    "blank headline filled",
    document.querySelector('input[placeholder="Headline (from your old hero)"]').value ===
      "Same Night Heroes",
  );
  check(
    "existing photo URLs preserved",
    originalPhotoUrls.every((url) =>
      [...document.querySelectorAll("img")].some((i) => i.src === url),
    ),
  );
  const clear = [...panel().querySelectorAll("button")].find(
    (b) => b.textContent.trim().toLowerCase() === "clear preview",
  );
  clear.click();
  await new Promise((r) => setTimeout(r, 50));
  await read(
    "Collection Name,Collection URL,Password,Download PIN,Client Email\nQA Gallery,https://qa.pixieset.com/game?token=secret,do-not-import,9876,private@example.invalid",
    "collections.csv",
    "text/csv",
  );
  check(
    "CSV metadata preview excludes credentials",
    !panel().textContent.includes("do-not-import") &&
      !panel().textContent.includes("9876") &&
      !panel().textContent.includes("private@example.invalid"),
  );
  URL.createObjectURL = function (blob) {
    const url = createURL.call(URL, blob);
    blobs.set(url, blob);
    return url;
  };
  HTMLAnchorElement.prototype.click = function () {
    if (this.download === "foto-migration-plan.json") {
      downloaded = blobs.get(this.href);
      return;
    }
    return click.call(this);
  };
  [...panel().querySelectorAll("button")]
    .find((b) => /download.*plan/i.test(b.textContent))
    .click();
  await wait(() => downloaded, "Migration plan not downloadable");
  const payload = await downloaded.text();
  check(
    "download excludes sensitive CSV fields",
    !payload.includes("do-not-import") &&
      !payload.includes("9876") &&
      !payload.includes("private@example.invalid") &&
      !payload.includes("token=secret"),
  );
  check("file import made no network requests", networkCalls === 0);
  return { passed: checks.length, checks, published: false, transferredOwnership: false };
} finally {
  window.fetch = realFetch;
  URL.createObjectURL = createURL;
  HTMLAnchorElement.prototype.click = click;
}
