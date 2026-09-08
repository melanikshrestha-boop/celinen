import { execFileSync } from "node:child_process";

const binary = process.argv[2];
if (!binary) throw new Error("Provide the existing browse binary.");
const run = (...args: string[]) => execFileSync(binary, args, { encoding: "utf8", stdio: "pipe" });
const js = (code: string) => run("js", code);
const check = (condition: string, label: string) => {
  js(`(() => { if (!(${condition})) throw new Error(${JSON.stringify(label)}); return true; })()`);
  console.log(`PASS ${label}`);
};
async function waitFor(condition: string, label: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (js(`Boolean(${condition})`).trim() === "true") return;
    await Bun.sleep(25);
  }
  throw new Error(`Timed out: ${label}`);
}

run("console", "--clear");
run("goto", "http://127.0.0.1:8086/?actor=owner");
js("sessionStorage.removeItem('lenslabs.synthetic-delivery-recovery.room.v1')");
run("reload");
await waitFor("typeof window.__deliveryQA === 'object'", "synthetic gallery reload");
js("window.__deliveryQA.seedSelectionNotes()");
run("viewport", "390x844");
run("click", ".delivery-tabs button:nth-child(2)");
check(
  "document.querySelector('.delivery-feedback-tools')?.textContent.includes('Latest submission · 2 photos') && document.querySelector('.delivery-feedback-tools button')?.textContent.includes('Export selection CSV')",
  "owner Feedback exposes one compact latest-submission export",
);

js(`(() => {
  window.__selectionCsv = '';
  URL.createObjectURL = blob => { blob.text().then(text => { window.__selectionCsv = text; }); return 'blob:qa'; };
  HTMLAnchorElement.prototype.click = function() {};
  return true;
})()`);
run("click", ".delivery-feedback-tools button");
await waitFor("window.__selectionCsv.length > 0", "selection CSV capture");
check(
  "window.__selectionCsv.includes('10000000-0000-4000-8000-000000000002') && window.__selectionCsv.includes('10000000-0000-4000-8000-000000000004') && window.__selectionCsv.includes('synthetic-one.jpg')",
  "CSV preserves exact first photo and version identity",
);
check(
  "window.__selectionCsv.includes('10000000-0000-4000-8000-000000000003') && window.__selectionCsv.includes('10000000-0000-4000-8000-000000000005') && window.__selectionCsv.includes('synthetic-two.jpg')",
  "CSV preserves exact second photo and version identity",
);
check(
  "window.__selectionCsv.includes('Crop tighter, keep the sign — 東京 📷') && window.__selectionCsv.includes('Client note, \"\"quoted\"\".') && window.__selectionCsv.includes('\"Open\"')",
  "CSV includes quoted Unicode exact-version client change request",
);
check(
  "document.documentElement.scrollWidth <= innerWidth && document.querySelector('.delivery-feedback-tools').getBoundingClientRect().right <= innerWidth + 1",
  "owner selection export fits a 390px viewport",
);
run("screenshot", "/private/tmp/lenslabs-owner-selection-export-mobile.png");

run("goto", "http://127.0.0.1:8086/");
run("click", ".delivery-tabs button:nth-child(2)");
check(
  "!document.querySelector('.delivery-feedback-tools') && document.querySelector('.delivery-feedback-list')",
  "client Feedback does not expose owner selection export",
);
const errors = run("console", "--errors");
const unexpected = errors
  .split("\n")
  .filter(
    (line) =>
      line.trim() &&
      !line.includes("BEGIN UNTRUSTED") &&
      !line.includes("END UNTRUSTED") &&
      !line.includes("(no console errors)") &&
      !line.includes("Failed to decode downloaded font") &&
      !line.includes("OTS parsing error"),
  );
if (unexpected.length) throw new Error(errors);
console.log("PASS no new non-font console errors");
console.log("Synthetic owner view only. No live gallery, download, or client data was used.");
