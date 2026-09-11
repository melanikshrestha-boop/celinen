/** Isolated local browser, fresh synthetic shoot, repository image. Never real accounts. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const binary = process.argv[2];
if (!binary) throw new Error("Pass the existing browse binary");
const shoot = crypto.randomUUID();
const database = `lens-os-local-studio:shoot:${shoot}`;
const root = "/private/tmp/lenslabs-save-boundary-qa";
mkdirSync(root, { recursive: true });
const run = (...args: string[]) => execFileSync(binary, args, { encoding: "utf8", timeout: 30000 });
const js = (expression: string) => JSON.parse(run("js", `({value:(${expression})})`)).value;
const waitFor = (expression: string) => {
  for (let i = 0; i < 90; i++) {
    const value = js(expression);
    if (value) return value;
  }
  throw new Error(`Timed out: ${expression}`);
};
const checks: string[] = [];
const check = (name: string, condition: unknown) => {
  if (!condition) throw new Error(name);
  checks.push(name);
  writeFileSync(`${root}/checks.json`, JSON.stringify({ shoot, checks }, null, 2));
  console.log(`PASS ${name}`);
};
const field = `[...document.querySelectorAll('input[type=range]')].find(el=>el.closest('label')?.textContent.trim().startsWith('Exposure'))`;
const warn = `(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented})()`;
const change = (value: number) =>
  `(()=>{const input=${field};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'${value}');input.dispatchEvent(new Event('input',{bubbles:true}));return ${warn}})()`;
check("Isolated launched QA browser", run("status").includes("Mode: launched"));
run("viewport", "1440x900");
run("goto", `http://127.0.0.1:8085/studio?shoot=${shoot}`);
run("console", "--clear");
waitFor(
  "!!document.querySelector('[data-workbench-tool=studio] input[type=file]:not([webkitdirectory])')",
);
run(
  "upload",
  "[data-workbench-tool=studio] input[type=file]:not([webkitdirectory])",
  fileURLToPath(new URL("../../public/images/auth-lens.jpg", import.meta.url)),
);
waitFor(`!!(${field})`);
waitFor(`!(${warn})`);
check("Completed import does not keep the reload warning armed", !js(warn));
check("An edit is protected in the same event turn before the debounce", js(change(1)));
waitFor(`!(${warn})`);
check("Successful save clears the pending-edit warning", !js(warn));

// A trusted click activates the browser's actual beforeunload dialog policy.
run("click", 'label:has-text("Exposure") input[type=range]:visible');
waitFor(`!(${warn})`);
run("dialog", "--clear");
run("dialog-dismiss");
js(`(()=>{window.__qaBoot='same-document';${change(2)};location.reload();return true})()`);
check(
  "Immediate actual reload shows the browser confirmation",
  run("dialog").includes("beforeunload"),
);
check(
  "Cancel reload retains the live adjustment",
  js(`window.__qaBoot==='same-document'&&(${field}).value==='2'`),
);
waitFor(`!(${warn})`);
run("reload");
waitFor(`!!(${field})`);
check("A completed adjustment survives an actual document reload", js(`(${field}).value==='2'`));
waitFor(`!(${warn})`);

// Hold only the acknowledgement of this synthetic shoot's next transaction.
// IndexedDB still commits normally; no shared store, original photo or auth path is changed.
js(
  `(()=>{window.__qaTransaction=IDBDatabase.prototype.transaction;window.__qaHold=true;window.__qaHeldSave=null;IDBDatabase.prototype.transaction=function(stores,mode,...args){const tx=window.__qaTransaction.call(this,stores,mode,...args);if(this.name===${JSON.stringify(database)}&&window.__qaHold&&mode==='readwrite'&&Array.from(tx.objectStoreNames).includes('shots')){window.__qaHold=false;const descriptor=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');Object.defineProperty(tx,'oncomplete',{configurable:true,set(fn){descriptor.set.call(tx,event=>{window.__qaHeldSave=()=>fn.call(tx,event)})}})}return tx};return true})()`,
);
check("Edit remains pending while a save acknowledgement is delayed", js(change(3)));
waitFor("typeof window.__qaHeldSave==='function'");
check("Transaction dispatch alone never clears the warning", js(warn));
check(
  "A second edit remains protected after the older save resolves",
  js(
    `(()=>{${change(4)};IDBDatabase.prototype.transaction=window.__qaTransaction;window.__qaHeldSave();return ${warn}})()`,
  ),
);
waitFor(`!(${warn})`);
check("Latest save eventually clears the guard", !js(warn));
run("reload");
waitFor(`!!(${field})`);
check("Newest edit, not the earlier delayed one, is restored", js(`(${field}).value==='4'`));
waitFor(`!(${warn})`);

// A controlled write failure exercises the real SaveRecovery/pause path.
js(
  `(()=>{window.__qaTransaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...args){if(this.name===${JSON.stringify(database)}&&mode==='readwrite'&&Array.isArray(stores)&&stores.includes('shots'))throw new DOMException('QA write refused','QuotaExceededError');return window.__qaTransaction.call(this,stores,mode,...args)};return true})()`,
);
check("A failing edit is immediately protected", js(change(5)));
waitFor("document.body.textContent.includes('QA write refused')");
check("Write failure keeps reload protection armed", js(warn));
run("screenshot", `${root}/paused-save.png`, "--viewport");
js("(IDBDatabase.prototype.transaction=window.__qaTransaction,true)");
// Deliberately discard only this synthetic unsaved edit to verify the prior stored value.
run("dialog-accept");
run("reload");
waitFor(`!!(${field})`);
check("A refused write leaves the prior committed edit intact", js(`(${field}).value==='4'`));
waitFor(`!(${warn})`);
run("screenshot", `${root}/recovered.png`, "--viewport");
check(
  "No application runtime errors",
  !/\[(?:error|pageerror)\]/i.test(run("console", "--errors")),
);
console.log(`${checks.length} browser checks passed: ${root}`);
