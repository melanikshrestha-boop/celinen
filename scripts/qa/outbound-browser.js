// Run with gstack browse eval in an ISOLATED browser on /outbound.
// Refuses a populated desk. Only example.test addresses; never opens a mail app or sends.
const model = await import("/src/lib/outbound/model.ts");
const storage = await import("/src/lib/outbound/storage.ts");
const scope = "device-local";
const initial = await storage.readOutbound(scope);
if (
  location.origin !== "http://127.0.0.1:8085" ||
  location.pathname !== "/outbound" ||
  initial.workspace.prospects.length ||
  initial.revision
)
  throw new Error("Use an empty, isolated local QA browser. Never run on a real desk.");
const results = [];
function assert(value, label) {
  if (!value) throw new Error(label);
  results.push(label);
}
const delay = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
async function wait(predicate, label) {
  const until = Date.now() + 7000;
  while (!predicate()) {
    if (Date.now() > until) throw new Error(`Timeout: ${label}`);
    await delay();
  }
}
function button(text, root = document) {
  const el = [...root.querySelectorAll("button")].find(
    (node) => node.textContent.trim() === text || node.getAttribute("aria-label") === text,
  );
  if (!el) throw new Error(`Missing button ${text}`);
  return el;
}
async function click(text, root = document) {
  const el = button(text, root);
  assert(!el.disabled, `Enabled: ${text}`);
  el.click();
  await delay();
}
function control(label, root = document) {
  const el = [...root.querySelectorAll("label")]
    .find(
      (node) =>
        [...node.childNodes]
          .filter((child) => child.nodeType === Node.TEXT_NODE)
          .map((child) => child.textContent)
          .join("")
          .replace(/\s+/g, " ")
          .trim() === label,
    )
    ?.querySelector("input,textarea,select");
  if (!el) throw new Error(`Missing control ${label}`);
  return el;
}
async function fill(label, value, root = document) {
  const el = control(label, root);
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  await delay();
}
async function saved() {
  await wait(() => !document.querySelector("[role=dialog]"), "dialog closes after successful save");
}
const read = () => storage.readOutbound(scope);
const before = await read();
assert(before.workspace.prospects.length === 0, "No invented leads");
if (!document.querySelector("[role=dialog]")) await click("Campaign settings");
await fill("Your name", "QA Founder");
await fill("Signature / contact details", "QA Founder — example.test");
await click("Save campaign");
await saved();
await click("Add prospect");
await fill("Name", "QA Product Photographer");
await fill("Studio / business", "QA Still Life Studio");
await fill("Business email", "photographer@example.test");
await fill("Website", "https://studio.example.test");
await fill(
  "What makes now relevant?",
  "Your public post describes a product-photo culling backlog.",
);
await fill("Source link", "https://studio.example.test/workflow");
await fill("Why FOTO could fit", "a local culling workflow could be worth testing together.");
await click("Save prospect");
await saved();
await wait(
  () => document.querySelector(".out-detail h2")?.textContent === "QA Product Photographer",
  "prospect opens",
);
let record = await read();
const id = record.workspace.prospects[0].id;
assert(record.workspace.prospects.length === 1, "Prospect persisted");
await click("Prepare draft");
await wait(() => document.querySelector(".out-detail textarea"), "draft renders");
assert(button("Open in email").disabled, "No composer before approval");
await click("Approve draft");
await wait(() => !button("Copy draft").disabled, "approved controls");
record = await read();
assert(!record.workspace.prospects[0].contactedAt, "Approval is not contact");
const originalClick = HTMLAnchorElement.prototype.click;
let mailto = "";
HTMLAnchorElement.prototype.click = function () {
  if (this.href.startsWith("mailto:")) {
    mailto = this.href;
    return;
  }
  return originalClick.call(this);
};
try {
  await click("Open in email");
  await wait(() => Boolean(mailto), "composer request intercepted");
} finally {
  HTMLAnchorElement.prototype.click = originalClick;
}
assert(mailto.includes("photographer%40example.test"), "Composer recipient encoded correctly");
assert(!(await read()).workspace.prospects[0].contactedAt, "Opening composer never counts as sent");
await fill("Message", "A shorter, reviewed message.", document.querySelector(".out-detail"));
assert(button("Open in email").disabled, "Unsaved text cannot be shared");
await click("Open QA Product Photographer");
assert(button("Campaign settings").disabled, "Clicking selected row preserves dirty guard");
await click("Save draft");
await wait(() => button("Save draft").disabled, "draft saved");
assert(button("Open in email").disabled, "Saved draft edit invalidates approval");
await click("Approve draft");
await wait(() => !button("Log contact").disabled, "reapproved");
await click("Log contact");
assert(button("Save activity").disabled, "Manual contact requires confirmation");
document.querySelector(".out-check input").click();
await delay();
await click("Save activity");
await saved();
assert(Boolean((await read()).workspace.prospects[0].contactedAt), "Manual contact is persisted");
assert(button("Open in email").disabled, "Seven-day contact cooldown enforced");
await fill("Follow-up date", new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10));
await click("Save follow-up");
await wait(() => button("Save follow-up").disabled, "follow-up save");
await click("Log reply");
await fill("Notes / evidence", "QA fixture: photographer replied asking for a trial.");
document.querySelector(".out-check input").click();
await delay();
await click("Save activity");
await saved();
await click("Log conversion");
await fill(
  "What changed? (for example, started a trial)",
  "QA fixture: began a trial. No payment recorded.",
);
document.querySelector(".out-check input").click();
await delay();
await click("Save activity");
await saved();
assert((await read()).workspace.prospects[0].stage === "converted", "Manual conversion persisted");
await click("Do not contact");
await fill("Notes / evidence", "QA fixture: opted out.");
document.querySelector(".out-check input").click();
await delay();
await click("Block outreach");
await saved();
record = await read();
assert(record.workspace.prospects[0].stage === "suppressed", "Suppression persisted");
assert(
  button("Copy draft").disabled && button("Open in email").disabled,
  "Suppression blocks draft sharing",
);
assert(
  document
    .querySelector('[aria-label="Recorded outreach totals"]')
    .textContent.includes("1Replies logged"),
  "Historical reply metric preserved after suppression",
);
await click("Suppressed");
assert(
  document.querySelector(".out-table").textContent.includes("QA Product Photographer"),
  "Suppressed view works",
);
// Real IndexedDB concurrent writes on a separate test-only identity.
const casScope = `qa-outbound-cas:${crypto.randomUUID()}`;
const command = {
  type: "campaign",
  campaign: { ...model.emptyOutbound().campaign, senderName: "A" },
};
const attempts = await Promise.allSettled([
  storage.updateOutbound(casScope, 0, (w) =>
    model.transition(w, command, new Date().toISOString()),
  ),
  storage.updateOutbound(casScope, 0, (w) =>
    model.transition(w, command, new Date().toISOString()),
  ),
]);
assert(
  attempts.filter((r) => r.status === "fulfilled").length === 1,
  "Real IndexedDB: exactly one concurrent CAS commit",
);
assert(
  attempts.filter((r) => r.status === "rejected").length === 1,
  "Real IndexedDB: stale writer rejected",
);
assert(
  (await storage.readOutbound(casScope)).revision === 1,
  "Real IndexedDB: no overwritten revision",
);
assert((await read()).revision === record.revision, "QA CAS identity cannot alter founder desk");
// A duplicate CSV import is atomic and cannot revive an opted-out contact.
const duplicate = model.parseProspectCsv(model.exportProspectCsv(record.workspace.prospects));
let rejected = false;
try {
  await storage.updateOutbound(scope, record.revision, (w) =>
    model.transition(
      w,
      { type: "import", entries: duplicate.map((input) => ({ id: crypto.randomUUID(), input })) },
      new Date().toISOString(),
    ),
  );
} catch {
  rejected = true;
}
assert(rejected, "Duplicate suppressed email cannot be reimported");
assert((await read()).revision === record.revision, "Rejected import makes no partial write");
globalThis.fotoOutboundQA = {
  checks: results.length,
  results,
  fixtureId: id,
  revision: record.revision,
  externalMessagesSent: 0,
};
