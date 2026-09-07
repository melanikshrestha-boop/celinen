/** UI regression pass using the existing isolated gstack browser, never real account data.
 * bun scripts/qa/settings-check.ts <browse-binary> <http://127.0.0.1:8085/settings?shoot=QA_UUID>
 */
import { execFileSync } from "node:child_process";
import { SETTINGS_SECTIONS } from "../../src/lib/settings-catalog";
const [binary, href] = process.argv.slice(2);
if (!binary || !href)
  throw new Error("Pass the existing browse executable and isolated QA settings URL.");
const url = new URL(href);
if (
  url.origin !== "http://127.0.0.1:8085" ||
  url.pathname !== "/settings" ||
  !/^[a-f0-9-]{36}$/i.test(url.searchParams.get("shoot") ?? "")
)
  throw new Error("Only an explicitly selected local QA shoot is allowed.");
const run = (...args: string[]) =>
  execFileSync(binary, args, { encoding: "utf8", timeout: 20_000 });
run("goto", href);
run("wait", ".settings-shell");
run("viewport", "1440x900");
const checks: object[] = [];
for (const section of SETTINGS_SECTIONS) {
  run("click", `.settings-nav-group button:has-text(${JSON.stringify(section.label)})`);
  const result = JSON.parse(
    run(
      "js",
      `({ heading:document.querySelector('.settings-content h1').textContent, hash:location.hash, shoot:new URL(location.href).searchParams.get('shoot'), overflow:document.querySelector('.settings-main').scrollWidth > document.querySelector('.settings-main').clientWidth })`,
    ),
  );
  if (
    result.heading !== section.label ||
    result.hash !== `#${section.id}` ||
    result.shoot !== url.searchParams.get("shoot") ||
    result.overflow
  )
    throw new Error(`Settings check failed: ${JSON.stringify(result)}`);
  checks.push({ section: section.id, ...result });
}
run("click", ".settings-nav-group button:has-text('General')");
run("viewport", "390x844");
const mobile = JSON.parse(
  run(
    "js",
    "({overflow:document.documentElement.scrollWidth>innerWidth,menu:!!document.querySelector('[aria-label=\"Open settings navigation\"]')})",
  ),
);
if (mobile.overflow || !mobile.menu) throw new Error("Mobile layout failed");
run("click", "button[aria-label='Open settings navigation']");
run("click", ".settings-nav-group button:has-text('Profile')");
run("wait", "#profile-display-name");
const mobileProfile = JSON.parse(
  run(
    "js",
    "({name:document.querySelector('#profile-display-name').value,overflow:document.querySelector('.settings-main').scrollWidth>innerWidth,menuOpen:document.querySelector('.settings-rail').classList.contains('is-open')})",
  ),
);
if (mobileProfile.overflow || mobileProfile.menuOpen)
  throw new Error("Mobile profile navigation failed");
run("viewport", "1440x900");
run("click", ".settings-nav-group button:has-text('General')");
console.log(JSON.stringify({ status: "passed", sections: checks, mobile, mobileProfile }, null, 2));
