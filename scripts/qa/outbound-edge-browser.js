// Follow-up to outbound-browser.js and a one-row example.test CSV import, isolated browser only.
const storage = await import("/src/lib/outbound/storage.ts");
const model = await import("/src/lib/outbound/model.ts");
let saved = await storage.readOutbound("device-local");
if (
  saved.workspace.campaign.senderName !== "QA Founder" ||
  saved.workspace.prospects.length !== 2 ||
  saved.workspace.prospects.some(
    (p) => !p.name.startsWith("QA ") || !p.email.endsWith("@example.test"),
  )
)
  throw new Error("Not the guarded QA desk.");
const results = [];
const assert = (condition, label) => {
  if (!condition) throw new Error(label);
  results.push(label);
};
const pause = () => new Promise((resolve) => setTimeout(resolve, 35));
async function wait(fn) {
  const end = Date.now() + 7000;
  while (!fn()) {
    if (Date.now() > end) throw new Error("Timed out");
    await pause();
  }
}
const button = (name) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === name || b.getAttribute("aria-label") === name,
  );
async function click(name) {
  const b = button(name);
  if (!b || b.disabled) throw new Error(`Unavailable ${name}`);
  b.click();
  await pause();
}
const field = () => document.querySelector(".out-detail textarea");
async function fill(value) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field(), value);
  field().dispatchEvent(new Event("input", { bubbles: true }));
  await pause();
}
const imported = saved.workspace.prospects.find((p) => p.name === "QA Import Photographer");
assert(
  imported.company === "QA Goods, Studio" && imported.notes === 'CSV quote test: "hello"',
  "CSV upload preserved quoted fields",
);
await click("All");
await click("Open QA Import Photographer");
await click("Prepare draft");
await wait(() => field());
await fill("An unsaved local draft.");
await click("Open QA Import Photographer");
assert(button("Campaign settings").disabled, "Same selected row cannot clear unsaved guard");
const originalConfirm = window.confirm;
let confirmations = 0;
window.confirm = () => {
  confirmations++;
  return false;
};
try {
  await click("Open QA Product Photographer");
  assert(
    field().value === "An unsaved local draft." && confirmations === 1,
    "Switching prospects respects cancelled discard",
  );
} finally {
  window.confirm = originalConfirm;
}
saved = await storage.readOutbound("device-local");
await storage.updateOutbound("device-local", saved.revision, (w) =>
  model.transition(
    w,
    { type: "edit-draft", id: imported.id, subject: "Newer tab subject", body: "Newer tab draft" },
    new Date().toISOString(),
  ),
);
await wait(() => button("Reload records"));
window.confirm = () => false;
try {
  await click("Reload records");
  assert(field().value === "An unsaved local draft.", "Cancel reload preserves dirty draft");
} finally {
  window.confirm = originalConfirm;
}
window.confirm = () => true;
try {
  await click("Reload records");
  await wait(() => !field());
  assert(!field(), "Confirmed reload clears stale detail instead of silently merging edits");
} finally {
  window.confirm = originalConfirm;
}
await click("Open QA Import Photographer");
assert(field().value === "Newer tab draft", "Reopened prospect uses persisted remote update");
await click("Approve draft");
await wait(() => !button("Copy draft").disabled);
let writes = 0;
const originalWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
navigator.clipboard.writeText = async () => {
  writes++;
};
try {
  await click("Copy draft");
  await wait(() => writes === 1);
  assert(writes === 1, "Approved current draft reaches clipboard API");
  saved = await storage.readOutbound("device-local");
  await storage.updateOutbound("device-local", saved.revision, (w) =>
    model.transition(
      w,
      { type: "suppress", id: imported.id, note: "QA remote opt-out" },
      new Date().toISOString(),
    ),
  );
  await click("Copy draft");
  await pause();
  assert(writes === 1, "Stale tab cannot copy newly suppressed contact");
  assert(
    document.querySelector(".out-status")?.textContent.includes("Another tab") ||
      document.body.textContent.includes("Reload records before copying"),
    "Stale copy gives actionable feedback",
  );
} finally {
  navigator.clipboard.writeText = originalWrite;
}
await click("Reload records");
await wait(() => !button("Reload records"));
await click("Suppressed");
await click("Open QA Import Photographer");
assert(button("Open in email").disabled, "Remote suppression disables composer after refresh");
assert(
  (await storage.readOutbound("device-local")).workspace.prospects.length === 2,
  "All failed operations preserved record count",
);
globalThis.fotoOutboundEdgeQA = { checks: results.length, results, externalMessagesSent: 0 };
