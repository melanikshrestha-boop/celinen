import { execFileSync } from "node:child_process";

const binary = process.argv[2];
if (!binary) throw new Error("Provide the existing browse binary.");
const run = (...args: string[]) => execFileSync(binary, args, { encoding: "utf8", stdio: "pipe" });
const js = (code: string) => run("js", code);
const check = (condition: string, label: string) => {
  js(
    `(() => { if (!(${condition})) throw new Error(${JSON.stringify(label)}); return 'verified'; })()`,
  );
  console.log(`PASS ${label}`);
};
const button = (name: string) => {
  const row = run("snapshot", "-i")
    .split("\n")
    .find((line) => line.includes(`[button] ${JSON.stringify(name)}`));
  const ref = row?.match(/@e\d+/)?.[0];
  if (!ref || row?.includes("[disabled]")) throw new Error(`Button unavailable: ${name}`);
  run("click", ref);
};
const openFirst = () => run("click", "button[aria-label^='Open synthetic-one.jpg']");
const body = "Warmer, please — 東京 📷";
run("console", "--clear");
run("goto", "http://127.0.0.1:8086/");
check(
  "document.title.includes('synthetic data') && typeof window.__deliveryQA === 'object'",
  "isolated fixture, real gallery component",
);
// This origin is the QA-only server. Remove only this fixture's named records for repeatability.
js(
  "(() => { for (const key of Object.keys(sessionStorage)) if (key === 'lenslabs.synthetic-delivery-recovery.room.v1' || key.startsWith('lenslabs.delivery-comment-drafts.v1:10000000-0000-4000-8000-000000000001:')) sessionStorage.removeItem(key); })()",
);
run("reload");
run("viewport", "390x844");
openFirst();
run("fill", "#photo-comment", body);
run("click", ".delivery-check input");
run("click", "button[aria-label='Next photo']");
run("fill", "#photo-comment", "Keep the motion blur");
check(
  "!document.querySelector('.delivery-check input').checked",
  "second photo keeps separate intent",
);
run("click", "button[aria-label='Previous photo']");
check(
  `document.querySelector('#photo-comment').value === ${JSON.stringify(body)} && document.querySelector('.delivery-check input').checked`,
  "switching photos preserves change request",
);
run("dialog-accept");
run("reload");
openFirst();
check(
  `document.querySelector('#photo-comment').value === ${JSON.stringify(body)} && document.querySelector('.delivery-check input').checked`,
  "mobile reload restores full note and intent",
);
js("window.__deliveryQA.offline(true)");
button("Send comment");
check(
  "document.body.textContent.includes('Simulated offline') && document.querySelector('#photo-comment').value.length > 0 && window.__deliveryQA.state().comments.length === 0",
  "offline send keeps draft and does not invent success",
);
js("window.__deliveryQA.offline(false); window.__deliveryQA.loseNextResponse()");
button("Send comment");
check(
  "document.body.textContent.includes('Simulated lost response') && window.__deliveryQA.state().comments.length === 1 && document.querySelector('#photo-comment').value.length > 0",
  "lost response retains exact retry draft",
);
run("dialog-accept");
run("reload");
openFirst();
check(
  "document.querySelector('#photo-comment').value === '' && window.__deliveryQA.state().comments.length === 1 && window.__deliveryQA.state().comments[0].revision",
  "reload reconciles receipt without duplicate or lost revision intent",
);
run("fill", "#photo-comment", "Crop slightly tighter");
run("click", ".delivery-check input");
js("window.__deliveryQA.publishRevision()");
check(
  "document.querySelector('#photo-comment').value === '' && document.body.textContent.includes('Your unsent note for an earlier version is still here')",
  "new edit leaves previous-version draft separate",
);
button("Use this note for version 2");
check(
  "document.querySelector('#photo-comment').value === 'Crop slightly tighter' && document.querySelector('.delivery-check input').checked",
  "explicit carry-forward retains revision checkbox",
);
js("window.__deliveryQA.delayNextResponse()");
button("Send comment");
run("fill", "#photo-comment", "Actually, keep more space on the left");
run("click", ".delivery-check input");
js("window.__deliveryQA.finishResponse()");
check(
  "document.querySelector('#photo-comment').value === 'Actually, keep more space on the left' && !document.querySelector('.delivery-check input').checked",
  "late success preserves newer text and checkbox change",
);
check(
  "document.documentElement.scrollWidth <= innerWidth && document.querySelector('.delivery-viewer').getBoundingClientRect().right <= innerWidth + 1",
  "phone viewer has no horizontal overflow",
);
js(
  "document.querySelector('.delivery-composer button').scrollIntoView({ block: 'center', behavior: 'instant' })",
);
check(
  "(() => { const r = document.querySelector('.delivery-composer button').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()",
  "phone send action is reachable by scrolling",
);
run("screenshot", "/private/tmp/lenslabs-delivery-recovery-mobile.png");
run("viewport", "1440x1000");
check(
  "document.documentElement.scrollWidth <= innerWidth",
  "desktop viewer has no horizontal overflow",
);
run("screenshot", "/private/tmp/lenslabs-delivery-recovery-desktop.png");
run("press", "Escape");
js("window.__deliveryQA.rotate()");
openFirst();
check(
  "document.querySelector('#photo-comment').value === ''",
  "replacement invitation does not inherit another session's notes",
);
js(
  "window.__qaStorageSet = Storage.prototype.setItem; Storage.prototype.setItem = function(k,v) { if (k.startsWith('lenslabs.delivery-comment-drafts.')) throw new DOMException('QA quota', 'QuotaExceededError'); return window.__qaStorageSet.call(this,k,v); }",
);
run("fill", "#photo-comment", "Storage unavailable, keep this note");
check(
  "document.body.textContent.includes('cannot save recovery notes') && document.querySelector('#photo-comment').value.includes('keep this note')",
  "storage failure is visible and text remains usable",
);
js("Storage.prototype.setItem = window.__qaStorageSet; delete window.__qaStorageSet");
button("Send comment");
check(
  "document.querySelector('#photo-comment').value === ''",
  "recovery after storage failure can still send",
);
const errors = run("console", "--errors");
if (!errors.includes("(no console errors)")) throw new Error(errors);
console.log("PASS clean browser console for this run");
console.log(
  "Synthetic transport only. Real iOS, remote publishing and actual authentication remain separate checks.",
);
