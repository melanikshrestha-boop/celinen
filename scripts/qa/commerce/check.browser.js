if (location.origin !== "http://127.0.0.1:8084" || !window.__commerceQA)
  throw new Error("Isolated QA only");
const qa = window.__commerceQA,
  passed = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const visible = (e) => e && e.getClientRects().length > 0;
const assert = (v, label) => {
  if (!v) throw new Error(label);
  passed.push(label);
};
const wait = async (fn) => {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await sleep(20);
  }
  throw new Error("UI did not settle");
};
const button = (label) =>
  [...document.querySelectorAll("button")].find(
    (e) => visible(e) && e.textContent.trim() === label,
  );
const input = (label) =>
  [...document.querySelectorAll("label")]
    .find((e) => visible(e) && e.childNodes[0]?.textContent.trim() === label)
    ?.querySelector("input,textarea,select");
const fill = async (label, value) => {
  const e = input(label);
  if (!e) throw new Error(`Missing field ${label}`);
  const proto =
    e.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : e.tagName === "SELECT"
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(e, value);
  e.dispatchEvent(new Event(e.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  await sleep(30);
};
const tab = async (label) => {
  const e = [...document.querySelectorAll('[role="tab"]')].find(
    (e) => visible(e) && e.textContent.trim() === label,
  );
  e.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  e.click();
  await sleep(50);
};
await fill("Title", "Friday night lights");
await fill("Price", "85.50");
await fill("Size or edition", "16 × 20 in");
button("Add to draft").click();
await sleep(60);
assert(document.body.textContent.includes("Friday night lights"), "Create a private print draft");
document.querySelector('[aria-label="Edit Friday night lights"]').click();
await fill("Price", "95.25");
button("Update draft").click();
await sleep(40);
qa.failNext = true;
button("Save shop").click();
await wait(() => document.querySelector('[role="alert"]'));
assert(
  document.body.textContent.includes("Friday night lights"),
  "Failed save preserves print draft",
);
const saves = qa.saves;
qa.delay = 160;
button("Save shop").click();
button("Working…")?.click();
await wait(() => qa.shop.products.length === 1);
assert(qa.saves === saves + 1, "Double click sends one save");
assert(
  qa.shop.products[0].priceMinor === 9525,
  "Editing a print preserves its identity and exact price",
);
await wait(() => button("Save shop"));
await tab("Domains");
await fill("Domain", "mystudio.com");
button("Save a domain choice").click();
await sleep(60);
assert(
  document.body.textContent.includes("Not checked · not registered"),
  "Domain choice never claims availability or registration",
);
button("Save shop").click();
await wait(() => qa.shop.domains.length === 1);
await wait(() => button("Save shop"));
await tab("Shopify import");
const file = new File(
  ["Handle,Title,Option1 Value,Variant Price\nnight,Night match,16x20,35.00\nnight,,24x30,55.00"],
  "shopify-test.csv",
  { type: "text/csv" },
);
const upload = async () => {
  const d = new DataTransfer();
  d.items.add(file);
  const e = input("Shopify product export");
  e.files = d.files;
  e.dispatchEvent(new Event("change", { bubbles: true }));
  await wait(() => button("Add reviewed variants to draft"));
};
await upload();
assert(
  document.body.textContent.includes("2 variants"),
  "Shopify preview shows variants before importing",
);
button("Add reviewed variants to draft").click();
await sleep(70);
button("Save shop").click();
await wait(() => qa.shop.products.length === 3);
await wait(() => button("Save shop"));
await upload();
button("Add reviewed variants to draft").click();
await sleep(60);
assert(
  document.body.textContent.includes("2 existing variants left untouched"),
  "Re-import skips existing variants",
);
await tab("Prints");
const archive = [...document.querySelectorAll("button")].find(
  (e) => e.getAttribute("aria-label") === "Archive Friday night lights",
);
archive.click();
await sleep(50);
button("Save shop").click();
await wait(() => qa.shop.products[0].archived);
await wait(() => button("Save shop"));
assert(qa.shop.products.length === 3, "Archiving preserves product history");
button("Photographer network").click();
await wait(() => document.querySelector(".network-person"));
assert(
  document.body.textContent.includes("No verified reviews yet"),
  "Unreviewed photographers are not given fake stars",
);
await fill("Find a photographer", "weddings");
[...document.querySelectorAll("button")]
  .find((e) => e.textContent.includes("Search photographers"))
  .click();
await wait(() => document.body.textContent.includes("No matches."));
assert(![...document.querySelectorAll(".network-person")].length, "Search filters the directory");
await fill("Find a photographer", "Kathmandu");
[...document.querySelectorAll("button")]
  .find((e) => e.textContent.includes("Search photographers"))
  .click();
await wait(() => button("Propose a collaboration"));
button("Propose a collaboration").click();
await sleep(50);
await fill("Your request", "Can we photograph next weekend’s football tournament together?");
qa.failNext = true;
button("Send request").click();
await wait(() => button("Retry same request"));
assert(
  input("Your request").value.includes("football"),
  "Failed inquiry preserves its content and retry identity",
);
button("Retry same request").click();
await wait(() => !document.querySelector('[role="dialog"]'));
assert(qa.outgoing.length === 1, "Inquiry retry creates one request");
await tab("Inbox 1");
await wait(() => button("Accept interest"));
button("Accept interest").click();
await wait(() => qa.incoming[0].status === "accepted");
assert(
  qa.incoming[0].status === "accepted",
  "Recipient can accept interest without creating a booking",
);
await tab("My profile");
await fill("Photographer or studio name", "Vincent van Gogh");
await fill("Specialties, separated by commas", "Sports, Editorial");
await fill("City / region", "Kathmandu");
await fill("Country", "Nepal");
button("Save private profile").click();
await wait(() => qa.profile !== null);
assert(!qa.profile.visible, "Profile saves privately by default");
await wait(
  () => !button("Save private profile").disabled || !document.querySelector("fieldset[disabled]"),
);
const permission = [...document.querySelectorAll("label")]
  .find((el) => el.textContent.includes("Publish these profile fields"))
  ?.querySelector("input");
permission.click();
await sleep(40);
const originalConfirm = window.confirm;
window.confirm = () => true;
button("Save public profile").click();
await wait(() => qa.profile.visible);
await wait(() => !document.querySelector("fieldset[disabled]"));
assert(qa.profile.visible, "Public listing requires an explicit opt-in and save");
permission.click();
await sleep(40);
button("Save private profile").click();
await wait(() => !qa.profile.visible);
window.confirm = originalConfirm;
assert(!qa.profile.visible, "Photographer can withdraw public visibility");
await tab("Discover");
await tab("My profile");
assert(input("City / region").value === "Kathmandu", "Profile persists across workspace sections");
assert(qa.errors.length === 0, `No uncaught runtime errors: ${qa.errors.join(",")}`);
return { passed: passed.length, checks: passed };
