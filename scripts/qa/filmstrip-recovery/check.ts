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
run("goto", "http://127.0.0.1:8087/");
run("viewport", "390x844");
run("wait", "[data-frame-availability='unreadable']");
check(
  "document.querySelector('[aria-label^=\"Filmstrip\"]')?.getAttribute('aria-label') === 'Filmstrip, 4 frames, 1 unreadable for manual review'",
  "filmstrip announces the unreadable manual-review count",
);
check(
  "document.querySelector('[data-frame-availability=\"unreadable\"]')?.textContent.includes('unreadable') && document.querySelector('[data-frame-availability=\"unreadable\"]')?.textContent.includes('review')",
  "decode failure is visibly marked for recovery instead of showing score zero",
);
check(
  "document.querySelector('[data-frame-availability=\"preview-pending\"]')?.textContent.includes('preview pending') && document.querySelector('[data-frame-availability=\"source-offline\"]')?.textContent.includes('source offline')",
  "pending and disconnected previews remain distinct from decode failure",
);
check(
  "document.querySelector('[data-frame-availability=\"ready\"] img') && document.querySelector('[data-frame-availability=\"ready\"]')?.textContent.includes('82')",
  "readable frame keeps its preview and measured score",
);
run("click", "[data-frame-availability='unreadable']");
check(
  "document.querySelector('[role=status]')?.textContent.includes('DSC6973.ARW') && document.querySelector('[data-frame-availability=\"unreadable\"]')?.getAttribute('aria-pressed') === 'true'",
  "unreadable frame remains selectable for existing Studio recovery guidance",
);
check(
  "document.documentElement.scrollWidth <= innerWidth",
  "recovery filmstrip fits a 390px viewport",
);
run("screenshot", "/private/tmp/lenslabs-filmstrip-recovery-mobile.png");

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
console.log("Synthetic frame states only. No user photos or native decoder were used.");
