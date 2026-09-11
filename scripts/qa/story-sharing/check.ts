import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const binary = process.argv[2];
if (!binary) throw new Error("Pass the isolated browse executable");
const root = "/private/tmp/lenslabs-story-sharing-qa";
mkdirSync(root, { recursive: true });
const run = (...args: string[]) => execFileSync(binary, args, { encoding: "utf8", timeout: 25000 });
const js = (s: string) => JSON.parse(run("js", `({value:(${s})})`)).value;
const checks: string[] = [];
function check(name: string, ok: unknown) {
  if (!ok) throw new Error(name);
  checks.push(name);
  writeFileSync(`${root}/checks.json`, JSON.stringify(checks, null, 2));
}
const id = "73713bbc-125a-44d8-ae7d-195345ee0987";
const owner = "174b50d4-6b85-42be-9d91-5cf129f10be2";
const url = `https://lenslab.dev/p/${id}`;
check("Uses an isolated launched browser", run("status").includes("Mode: launched"));
run("goto", "http://127.0.0.1:8091/");
run("console", "--clear");
run("wait", ".story-share-trigger");
run("viewport", "1440x900");
check(
  "Story and creator credit render without sign-in",
  js(
    "document.querySelector('h1').textContent==='A moment above it all'&&document.querySelector('.story-byline').textContent.includes('Céline & Co')",
  ),
);
check(
  "Booking path identifies exact creator",
  js(
    `document.querySelector('.story-inquiry').getAttribute('href')==='/photographers?creator=${owner}'`,
  ),
);
check(
  "Signup is secondary and opens publishing, without private IDs",
  js(
    "document.querySelector('.story-platform-credit a').getAttribute('href')==='/auth?next=%2Fpublish&mode=signup'",
  ),
);
run("screenshot", `${root}/story-desktop.png`, "--viewport");
const open = () => {
  run("click", ".story-share-trigger");
  run("wait", ".story-share-dialog");
};
const close = () => run("press", "Escape");
open();
check(
  "Share dialog shows canonical link only",
  js(`document.querySelector('#public-story-link').value===${JSON.stringify(url)}`),
);
check(
  "Email draft has no recipient, keeps creator credit and link",
  js(
    `(()=>{const u=new URL(document.querySelector('.story-share-actions a').href);return u.pathname===''&&u.searchParams.get('body').includes('Céline & Co')&&u.searchParams.get('body').endsWith(${JSON.stringify(url)})})()`,
  ),
);
js("Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined})");
run("click", '.story-share-actions button:has-text("Copy link")');
check(
  "Unavailable clipboard selects manual copy link",
  js(
    "document.activeElement.id==='public-story-link'&&document.activeElement.selectionEnd===document.activeElement.value.length&&document.querySelector('.story-share-status').textContent.includes('Copy action')",
  ),
);
js(
  "Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('Denied')}}})",
);
run("click", '.story-share-actions button:has-text("Copy link")');
check(
  "Denied clipboard never claims copied",
  js(
    "!document.querySelector('.story-share-status').textContent.includes('Link copied')&&!document.querySelector('.story-share-actions button').disabled",
  ),
);
js(
  "Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value)=>{window.__copied=value}}})",
);
run("click", '.story-share-actions button:has-text("Copy link")');
check(
  "Copy succeeds after actual writer resolution",
  js(
    `window.__copied===${JSON.stringify(url)}&&document.querySelector('.story-share-status').textContent.startsWith('Link copied')`,
  ),
);
js("Object.defineProperty(navigator,'share',{configurable:true,value:undefined})");
run("click", '.story-share-actions button:has-text("Share…")');
check(
  "Unsupported sharing retains manual copy fallback",
  js(
    "document.activeElement.id==='public-story-link'&&document.querySelector('.story-share-status').textContent.includes('Copy action')",
  ),
);
js(
  "Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw new DOMException('Cancelled','AbortError')}})",
);
run("click", '.story-share-actions button:has-text("Share…")');
check(
  "Share cancellation is not delivery success",
  js("document.querySelector('.story-share-status').textContent.includes('cancelled')"),
);
js(
  "Object.defineProperty(navigator,'share',{configurable:true,value:async(data)=>{window.__shared=data}})",
);
run("click", '.story-share-actions button:has-text("Share…")');
check(
  "Share hands only public title, text and URL to device",
  js(
    `window.__shared.url===${JSON.stringify(url)}&&Object.keys(window.__shared).sort().join(',')==='text,title,url'&&window.__shared.text.includes('Céline & Co')`,
  ),
);
js(
  "(window.__calls=0,Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>{window.__calls++;return new Promise(r=>window.__resolve=r)}}}))",
);
run("click", '.story-share-actions button:has-text("Copy link")');
check(
  "Pending copy prevents duplicate actions",
  js("window.__calls===1&&document.querySelector('.story-share-actions button').disabled"),
);
close();
open();
js("window.__resolve()");
check(
  "Closed dialog result cannot update reopened dialog",
  js(
    "document.querySelector('.story-share-status').textContent===''&&!document.querySelector('.story-share-actions button').disabled",
  ),
);
run("press", "Shift+Tab");
check("Focus stays in modal", js("!!document.activeElement.closest('[role=dialog]')"));
close();
check(
  "Escape restores share trigger focus",
  js("document.activeElement.classList.contains('story-share-trigger')"),
);
for (const size of ["1440x900", "768x1024", "390x844", "320x640"]) {
  run("viewport", size);
  check(
    `${size}: story has no horizontal overflow`,
    js("document.documentElement.scrollWidth<=innerWidth+1"),
  );
  open();
  run(
    "js",
    "Promise.all(document.querySelector('.story-share-dialog').getAnimations().map(a=>a.finished.catch(()=>{})))",
  );
  check(
    `${size}: dialog bounds and controls fit`,
    js(
      "(()=>{const d=document.querySelector('.story-share-dialog'),r=d.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1&&d.scrollWidth<=d.clientWidth+1&&[...d.querySelectorAll('.story-share-actions a,.story-share-actions button,input')].every(n=>n.getBoundingClientRect().height>=44)})()",
    ),
  );
  if (size === "390x844") run("screenshot", `${root}/share-phone.png`, "--viewport");
  close();
}
run("click", 'button:has-text("Long title")');
check(
  "Long Unicode story title does not overflow",
  js("document.documentElement.scrollWidth<=innerWidth+1"),
);
open();
check(
  "Long share title wraps within dialog",
  js(
    "document.querySelector('.story-share-dialog').scrollWidth<=document.querySelector('.story-share-dialog').clientWidth+1",
  ),
);
close();
run("click", 'button:has-text("Theme")');
open();
run(
  "js",
  "Promise.all(document.querySelector('.story-share-dialog').getAnimations().map(a=>a.finished.catch(()=>{})))",
);
run("screenshot", `${root}/share-light.png`, "--viewport");
check(
  "Light-mode share controls remain visible",
  js(
    "getComputedStyle(document.querySelector('.story-share-actions button')).color!==getComputedStyle(document.querySelector('.story-share-actions button')).backgroundColor",
  ),
);
close();
run("click", 'button:has-text("Recipient signed out")');
run("wait", ".network-person");
check(
  "Targeted directory shows only the requested public creator",
  js(
    "document.querySelectorAll('.network-person').length===1&&!document.querySelector('input[type=search]')&&document.querySelector('.network-person').textContent.includes('Céline & Co')",
  ),
);
check(
  "Targeted profile does not fabricate ratings",
  js("!document.querySelector('.network-rating')"),
);
check(
  "Sign-in return remains targeted to creator",
  js(
    `(()=>{const a=[...document.querySelectorAll('.network-actions a')].find(a=>a.textContent.includes('Sign in'));return new URL(a.href).searchParams.get('next')==='/photographers?creator=${owner}'})()`,
  ),
);
run("click", 'button:has-text("Recipient signed in")');
run("click", 'button:has-text("Ask about a shoot")');
run("wait", ".network-dialog");
check(
  "Inquiry identifies creator and describes actual behavior",
  js(
    "document.querySelector('.network-dialog').textContent.includes('Céline & Co')&&document.querySelector('.network-dialog').textContent.includes('No payment or booking is created')",
  ),
);
run("fill", ".network-dialog textarea", "Portrait session in Kathmandu, October 10, budget $500.");
run("click", 'button:has-text("Send request")');
check(
  "Inquiry sends exactly once to intended creator using fixture API",
  js(
    `window.__storyQA.sends.length===1&&window.__storyQA.sends[0].recipient==='${owner}'&&window.__storyQA.sends[0].kind==='booking'`,
  ),
);
check(
  "Inquiry success does not claim email or booking confirmation",
  js(
    "document.body.textContent.includes('This is an inquiry, not a confirmed booking. No email was sent.')",
  ),
);
check("No application errors", js("window.__storyQA.errors.length===0"));
check("Clean final browser console", run("console", "--errors").includes("(no console errors)"));
console.log(JSON.stringify({ passed: checks.length, root }));
