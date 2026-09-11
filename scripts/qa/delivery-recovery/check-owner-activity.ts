import { execFileSync } from "node:child_process";

const binary = process.argv[2];
if (!binary) throw new Error("Provide the existing browse binary.");
const run = (...args: string[]) => execFileSync(binary, args, { encoding: "utf8", stdio: "pipe" });
const js = (code: string) => run("js", code);
const check = (condition: string, label: string) => {
  js(`(() => { if (!(${condition})) throw new Error(${JSON.stringify(label)}); return true; })()`);
  console.log(`PASS ${label}`);
};

run("console", "--clear");
run("goto", "http://127.0.0.1:8086/?actor=owner");
js("sessionStorage.removeItem('lenslabs.synthetic-delivery-recovery.room.v1')");
run("reload");
run("viewport", "390x844");
run("click", ".delivery-tabs button:last-child");
check(
  "document.querySelectorAll('.delivery-activity-tools .delivery-filters button').length === 5",
  "owner Activity exposes five compact filters",
);
check(
  "!document.body.textContent.includes('Upload reserved:') && document.body.textContent.includes('2 selections submitted')",
  "shared Activity omits private upload reservations",
);
run("click", ".delivery-activity-tools .delivery-filters button:nth-child(2)");
check(
  "document.querySelectorAll('.delivery-activity li').length === 3 && [...document.querySelectorAll('.delivery-activity li')].every(row => row.textContent.includes('QA Client'))",
  "Client filter shows only client-authored events",
);

js(`(() => {
  window.__activityCsv = '';
  URL.createObjectURL = blob => { blob.text().then(text => { window.__activityCsv = text; }); return 'blob:qa'; };
  HTMLAnchorElement.prototype.click = function() {};
  return true;
})()`);
run("click", ".delivery-activity-tools .delivery-filters button:nth-child(3)");
run("click", ".delivery-activity-tools > button");
for (let attempt = 0; attempt < 100; attempt++) {
  if (js("Boolean(window.__activityCsv)").trim() === "true") break;
  await Bun.sleep(25);
}
check(
  "window.__activityCsv.includes('2 selections submitted') && !window.__activityCsv.includes('Upload reserved:') && !window.__activityCsv.includes('photo versions published')",
  "exported CSV matches the active Selections filter",
);
check(
  "document.documentElement.scrollWidth <= innerWidth && document.querySelector('.delivery-activity-tools').getBoundingClientRect().right <= innerWidth + 1",
  "owner Activity controls fit a 390px viewport",
);
run("screenshot", "/private/tmp/lenslabs-owner-activity-mobile.png");
run("goto", "http://127.0.0.1:8086/");
run("click", ".delivery-tabs button:last-child");
check(
  "!document.querySelector('.delivery-activity-tools') && document.querySelector('.delivery-activity')",
  "client Activity does not expose owner filter or CSV controls",
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
