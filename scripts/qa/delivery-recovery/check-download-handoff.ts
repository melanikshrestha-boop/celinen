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
async function waitFor(condition: string, label: string) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (js(`Boolean(${condition})`).trim() === "true") return;
    await Bun.sleep(50);
  }
  throw new Error(`Timed out: ${label}`);
}

run("console", "--clear");
run("goto", "http://127.0.0.1:8086/");
js("sessionStorage.removeItem('lenslabs.synthetic-delivery-recovery.room.v1')");
run("reload");
await waitFor("typeof window.__deliveryQA === 'object'", "synthetic gallery reload");
js("window.__deliveryQA.releaseFinals()");
check(
  "window.__deliveryQA.state().released.length === 2 && document.body.textContent.includes('Download finals')",
  "synthetic released finals are available",
);
const baseline = run("console", "--errors");
if (!baseline.includes("(no console errors)"))
  console.log("BASELINE existing page-load warnings excluded from interaction-console check");
run("console", "--clear");

run("viewport", "390x844");
run("click", "button[aria-label^='Open synthetic-one.jpg']");
run("click", ".delivery-downloads button.delivery-download-option:nth-of-type(1)");
await waitFor(
  "window.__deliveryQA.state().events.some(e => e.text.includes('Browser handoff recorded: 1 phone copy'))",
  "individual handoff receipt",
);
check(
  "document.body.textContent.includes('final save location cannot be verified')",
  "individual handoff copy stays truthful",
);
run("press", "Escape");
run("click", ".delivery-tabs button:last-child");
check(
  "document.body.textContent.includes('Browser handoff recorded: 1 phone copy; final save location not verified')",
  "client Activity shows the authenticated individual handoff",
);
run("screenshot", "/private/tmp/lenslabs-download-handoff-activity-mobile.png");

run("click", "button.delivery-primary");
run("click", ".delivery-upload-row button");
await waitFor("document.body.textContent.includes('Save checked ZIP')", "checked ZIP preparation");
run("click", ".delivery-confirm button.delivery-primary");
await waitFor(
  "window.__deliveryQA.state().events.some(e => e.text.includes('2 phone files in a ZIP part'))",
  "ZIP handoff receipt",
);
check(
  "document.body.textContent.includes('ZIP handed to your browser and recorded in Activity') && document.body.textContent.includes('final save location cannot be verified')",
  "ZIP handoff copy stays truthful",
);
run("screenshot", "/private/tmp/lenslabs-download-handoff-zip-mobile.png");
check(
  "document.documentElement.scrollWidth <= innerWidth && document.querySelector('.delivery-confirm').getBoundingClientRect().right <= innerWidth + 1",
  "phone download dialog has no horizontal overflow",
);
const errors = run("console", "--errors");
const unexpected = errors
  .split("\n")
  .filter(
    (line) =>
      line.trim() &&
      !line.includes("BEGIN UNTRUSTED") &&
      !line.includes("END UNTRUSTED") &&
      !line.includes("Failed to decode downloaded font") &&
      !line.includes("OTS parsing error"),
  );
if (unexpected.length) throw new Error(errors);
if (!errors.includes("(no console errors)"))
  console.log("CONCERN existing invalid OpenAI Sans font assets still warn during dialog render");
console.log("PASS no new non-font browser console errors during handoff interactions");
console.log(
  "Synthetic transport only. Browser handoff is not proof that a file was saved or opened.",
);
