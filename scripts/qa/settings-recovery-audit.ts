import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { preferenceKey } from "../../src/lib/account-preferences";
const binary = process.argv[2]!;
const root = "/private/tmp/lenslabs-settings-audit-20260907-1900";
const run = (...args: string[]) => execFileSync(binary, args, { encoding: "utf8", timeout: 25000 });
const js = (code: string) => JSON.parse(run("js", "({value:(" + code + ")})")).value;
const checks: string[] = [];
const check = (name: string, ok: unknown) => {
  if (!ok) throw new Error(name);
  checks.push(name);
  writeFileSync(root + "/recovery-checks.json", JSON.stringify(checks, null, 2));
};
const click = (name: string) => run("click", "button:has-text(" + JSON.stringify(name) + ")");
const go = (id: string) => {
  run("click", '[data-section="' + id + '"]');
  run("wait", '[data-section="' + id + '"][aria-current=page]');
};
if (!run("status").includes("Mode: launched")) throw new Error("Use isolated browser only.");
run("goto", "http://127.0.0.1:8085/settings/import?shoot=592c4eee-0c8e-4f6c-bd43-4fd583bd1b9a");
run("wait", ".settings-shell");
run("viewport", "1440x900");
const key = preferenceKey("device-local");
const selector = '[aria-label="Read Adobe XMP sidecars"]';
const before = js(
  "document.querySelector(" + JSON.stringify(selector) + ").getAttribute('aria-checked')",
);
const saved = js("localStorage.getItem(" + JSON.stringify(key) + ")");
js(
  "(()=>{const original=Storage.prototype.setItem;window.__qaRestore=()=>Storage.prototype.setItem=original;Storage.prototype.setItem=function(k,v){throw new Error('Synthetic write failure')};return true})()",
);
run("click", selector);
check(
  "Failed preference write leaves toggle and storage unchanged",
  js("document.querySelector(" + JSON.stringify(selector) + ").getAttribute('aria-checked')") ===
    before && js("localStorage.getItem(" + JSON.stringify(key) + ")") === saved,
);
check(
  "Failed preference write shows error",
  js("!!document.querySelector('.settings-shell [role=alert]')"),
);
js("(()=>{window.__qaRestore();delete window.__qaRestore;return true})()");
run("click", selector);
run("click", selector);
go("profile");
const name = js("document.querySelector('#profile-display-name').value");
js(
  "(()=>{const original=Storage.prototype.setItem;window.__qaRestore=()=>Storage.prototype.setItem=original;Storage.prototype.setItem=function(){throw new Error('Synthetic write failure')};return true})()",
);
run("fill", "#profile-display-name", "Synthetic unsaved retry");
run("click", ".settings-profile-form [type=submit]");
run("wait", ".settings-profile-form [role=alert]");
check(
  "Failed profile save preserves draft and retry",
  js(
    "document.querySelector('#profile-display-name').value==='Synthetic unsaved retry'&&!document.querySelector('.settings-profile-form [type=submit]').disabled&&!document.querySelector('.settings-form-actions [role=status]').textContent.includes('Saved')",
  ),
);
js("(()=>{window.__qaRestore();delete window.__qaRestore;return true})()");
run("click", '.settings-profile-form button:has-text("Cancel")');
check(
  "Cancel restores profile",
  js("document.querySelector('#profile-display-name').value") === name,
);
go("shortcuts");
run("fill", '[aria-label="Search keyboard shortcuts"]', "Open settings");
check(
  "Shortcut search narrows commands",
  js("document.querySelectorAll('[aria-label^=\"Edit \"]').length===1"),
);
run("click", '[aria-label="Edit Open settings"]');
click("Focus here and press a combination");
run("press", "Meta+K");
check(
  "Conflicting shortcut rejected",
  js("document.querySelector('[role=alertdialog]').textContent.includes('Already assigned')"),
);
click("Focus here and press a combination");
run("press", "Alt+Shift+S");
check(
  "Recording saves shortcut",
  js(
    "!document.querySelector('[role=alertdialog][data-state=open]')&&!document.querySelector('[aria-label=\"Reset Open settings\"]').disabled",
  ),
);
run("reload");
run("wait", '[aria-label="Reset Open settings"]');
check(
  "Shortcut survives reload",
  js("!document.querySelector('[aria-label=\"Reset Open settings\"]').disabled"),
);
run("click", '[aria-label="Reset Open settings"]');
check(
  "Individual shortcut reset",
  js("document.querySelector('[aria-label=\"Reset Open settings\"]').disabled"),
);
click("Reset all shortcuts");
run("wait", "[role=alertdialog]");
run("click", '[role=alertdialog] button:has-text("Cancel")');
check(
  "Cancel reset closes dialog",
  js("!document.querySelector('[role=alertdialog][data-state=open]')"),
);
console.log(JSON.stringify({ passed: checks.length, root }));
