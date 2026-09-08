/** Browser lifecycle checks with synthetic media only. Never reads physical devices. */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const binary = process.argv[2]!;
const root = "/private/tmp/lenslabs-settings-audit-20260907-1900";
const run = (...args: string[]) => execFileSync(binary, args, { encoding: "utf8", timeout: 25000 });
const js = (code: string) => JSON.parse(run("js", "({value:(" + code + ")})")).value;
const checks: string[] = [];
const check = (name: string, ok: unknown) => {
  if (!ok) throw new Error(name);
  checks.push(name);
  writeFileSync(root + "/media-checks.json", JSON.stringify(checks, null, 2));
};
const click = (name: string) => run("click", "button:has-text(" + JSON.stringify(name) + ")");
const go = (id: string) => {
  run("click", '[data-section="' + id + '"]');
  run("wait", '[data-section="' + id + '"][aria-current=page]');
};
if (!run("status").includes("Mode: launched")) throw new Error("Use isolated browser only");
run("goto", "http://127.0.0.1:8085/settings/voice?shoot=592c4eee-0c8e-4f6c-bd43-4fd583bd1b9a");
run("wait", ".settings-shell");
run("viewport", "1440x900");
js(
  "(()=>{window.__qaRequests=0;navigator.mediaDevices.getUserMedia=async()=>{window.__qaRequests++;throw new DOMException('Synthetic denial','NotAllowedError')};return true})()",
);
go("general");
go("voice");
check("Microphone never requested on page load", js("window.__qaRequests===0"));
click("Test microphone");
run("wait", '[role=alert]:has-text("permission was denied")');
check(
  "Microphone denial remains retryable",
  js(
    "window.__qaRequests===1&&!![...document.querySelectorAll('button')].find(n=>n.textContent==='Test microphone')",
  ),
);
js(
  "(()=>{navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>window.__qaGrant=resolve);return true})()",
);
click("Test microphone");
click("Cancel request");
js(
  "(()=>{window.__qaAudio=new AudioContext();window.__qaLate=window.__qaAudio.createMediaStreamDestination().stream;window.__qaGrant(window.__qaLate);return true})()",
);
check(
  "Cancelled late grant stops every track",
  js(
    "window.__qaLate.getTracks().every(t=>t.readyState==='ended')&&!document.querySelector('[aria-label=\"Microphone input level\"]')",
  ),
);
js("(()=>{window.__qaAudio.close();return true})()");
js(
  "(()=>{navigator.mediaDevices.getUserMedia=async()=>{window.__qaAudio=new AudioContext();window.__qaActive=window.__qaAudio.createMediaStreamDestination().stream;return window.__qaActive};return true})()",
);
click("Test microphone");
run("wait", '[aria-label="Microphone input level"]');
check(
  "Synthetic microphone opens level meter",
  js("window.__qaActive.getTracks().some(t=>t.readyState==='live')"),
);
click("Stop microphone");
check(
  "Stop releases microphone tracks",
  js(
    "window.__qaActive.getTracks().every(t=>t.readyState==='ended')&&!document.querySelector('[aria-label=\"Microphone input level\"]')",
  ),
);
js("(()=>{window.__qaAudio.close();return true})()");
go("appshots");
js(
  "(()=>{window.__qaCaptureRequests=0;navigator.mediaDevices.getDisplayMedia=async()=>{window.__qaCaptureRequests++;const c=document.createElement('canvas');c.width=96;c.height=64;c.getContext('2d').fillRect(0,0,96,64);window.__qaCapture=c.captureStream(1);return window.__qaCapture};return true})()",
);
check("Screen capture requires explicit action", js("window.__qaCaptureRequests===0"));
click("Choose a view");
run("wait", '[aria-label="Capture preview"] img');
check(
  "Single frame releases all tracks and offers PNG",
  js(
    "window.__qaCapture.getTracks().every(t=>t.readyState==='ended')&&document.querySelector('[aria-label=\"Capture preview\"] img').naturalWidth===96&&!!document.querySelector('[download=\"lenslabs-capture.png\"]')",
  ),
);
run("screenshot", root + "/capture-synthetic.png", "--viewport");
click("Discard capture");
check(
  "Discard removes the preview",
  js("!document.querySelector('[aria-label=\"Capture preview\"]')"),
);
js(
  "(()=>{navigator.mediaDevices.getDisplayMedia=async()=>{throw new DOMException('Synthetic denial','NotAllowedError')};return true})()",
);
click("Choose a view");
run("wait", '[role=alert]:has-text("Nothing was saved")');
check(
  "Capture denial permits retry",
  js("![...document.querySelectorAll('button')].find(n=>n.textContent==='Choose a view').disabled"),
);
run("reload");
run("wait", ".settings-shell");
check("No console errors", run("console", "--errors").includes("(no console errors)"));
console.log(
  JSON.stringify({ passed: checks.length, root, hardware: "simulated; no physical device access" }),
);
