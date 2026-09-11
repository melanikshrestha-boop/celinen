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
const click = (name: string) => {
  const line = run("snapshot", "-i")
    .split("\n")
    .find((value) => value.includes(`[button] "${name}"`));
  const ref = line?.match(/@e\d+/)?.[0];
  if (!ref) throw new Error(`Missing button: ${name}`);
  run("click", ref);
};
const state = "window.__proposalQA.state()";
run("goto", "http://127.0.0.1:8086/proposal.html");
run("console", "--clear");
run("viewport", "390x844");
check(
  `${state}.applied === 0 && ${state}.shots[0].verdict === 'undecided' && document.querySelector('[aria-label="Review proposed changes"]').textContent.includes('1 photo affected')`,
  "preview is explicit and does not apply on open",
);
check(
  "document.documentElement.scrollWidth <= innerWidth && document.querySelector('#studio-chat-input').getBoundingClientRect().bottom <= innerHeight",
  "phone approval and composer fit without horizontal overflow",
);
js("window.__proposalQA.mutateUnchanged()");
click("Accept suggestions");
check(
  `${state}.applied === 0 && ${state}.pending && ${state}.shots[0].verdict === 'undecided' && ${state}.shots[1].verdict === 'reject' && document.querySelector('[role=log]').textContent.includes('shoot changed')`,
  "stale cull reports the error and preserves every current decision",
);
run("screenshot", "/private/tmp/lenslabs-cull-basis-mobile.png");
click("Discard");
check(
  `!${state}.pending && ${state}.applied === 0 && ${state}.shots[1].verdict === 'reject'`,
  "discarding a stale preview preserves the newer manual reject",
);
js("window.__proposalQA.preview('cull')");
click("Accept suggestions");
check(
  `${state}.applied === 1 && !${state}.pending && ${state}.shots[0].verdict === 'keep' && ${state}.shots[1].verdict === 'reject'`,
  "fresh cull accepts the candidate without undoing the protected reject",
);
js("window.__proposalQA.reset('edit')");
js("window.__proposalQA.replaceSource()");
click("Apply edit");
check(
  `${state}.applied === 0 && ${state}.pending && ${state}.shots[0].exposure === 0 && document.querySelector('[role=log]').textContent.includes('latest sources')`,
  "same-name replacement source refuses stale edit with recovery guidance",
);
click("Discard");
js("window.__proposalQA.preview('edit')");
click("Apply edit");
check(
  `${state}.applied === 1 && ${state}.shots[0].exposure === 8 && ${state}.shots[1].exposure === 0`,
  "new source can receive a fresh selected-photo edit only after approval",
);
js("window.__proposalQA.reset('cull')");
js("window.__proposalQA.refreshThumbnails()");
click("Accept suggestions");
check(
  `${state}.applied === 1 && ${state}.shots.every((shot) => shot.verdict === 'keep')`,
  "reordering and refreshing previews do not invalidate unchanged originals",
);
js("window.__proposalQA.reset('cull')");
run("viewport", "1440x1000");
check(
  `document.documentElement.scrollWidth <= innerWidth && document.querySelector('[aria-label="Review proposed changes"]').getBoundingClientRect().width <= 390`,
  "desktop approval retains the existing Assistant rail width",
);
run("screenshot", "/private/tmp/lenslabs-cull-basis-desktop.png");
js("document.documentElement.classList.remove('dark')");
check(
  "getComputedStyle(document.querySelector('.photo-workbench')).backgroundColor === 'rgb(255, 255, 255)'",
  "existing light theme remains intact",
);
run("screenshot", "/private/tmp/lenslabs-cull-basis-light.png");
const errors = run("console", "--errors");
if (!errors.includes("(no console errors)")) throw new Error(errors);
console.log("PASS clean console");
