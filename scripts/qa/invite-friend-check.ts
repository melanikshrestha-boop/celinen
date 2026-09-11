/** Real UI, isolated Chromium, synthetic shoot. Never sends an invitation or imports user cookies. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const binary = process.argv[2];
if (!binary) throw new Error("Pass the isolated browse executable");
const root = "/private/tmp/lenslabs-invite-friend-qa";
mkdirSync(root, { recursive: true });
const run = (...args: string[]) =>
  execFileSync(binary, args, { encoding: "utf8", timeout: 25_000 });
const js = (expression: string) => JSON.parse(run("js", `({value:(${expression})})`)).value;
const checks: string[] = [];
const check = (name: string, ok: unknown) => {
  if (!ok) throw new Error(name);
  checks.push(name);
  writeFileSync(`${root}/checks.json`, JSON.stringify(checks, null, 2));
};
const address = "http://127.0.0.1:8085/settings/account?shoot=592c4eee-0c8e-4f6c-bd43-4fd583bd1b9a";
const signup = "https://lenslab.dev/auth?next=%2Fworkspace&mode=signup";
check("Browser is isolated, not a real account session", run("status").includes("Mode: launched"));
run("goto", address);
run("viewport", "1440x900");
run("wait", "#setting-invite-a-friend button");
const open = () => {
  run("click", "#setting-invite-a-friend button");
  run("wait", ".invite-friend-dialog");
};
const close = () => {
  run("press", "Escape");
};
open();
check(
  "Account settings invitation opens",
  js("document.querySelector('[role=dialog] h2').textContent==='Invite a friend'"),
);
check(
  "Only public signup link, no shoot or identity",
  js(`document.querySelector('#friend-signup-link').value===${JSON.stringify(signup)}`),
);
check(
  "Initial focus selects the complete invitation",
  js(
    "document.activeElement.id==='friend-signup-link'&&document.activeElement.selectionEnd===document.activeElement.value.length",
  ),
);
run("press", "Shift+Tab");
check(
  "Keyboard focus stays inside the dialog",
  js("!!document.activeElement.closest('[role=dialog]')"),
);
close();
check(
  "Escape restores Settings invite button focus",
  js("document.activeElement.closest('#setting-invite-a-friend')!==null"),
);
run("click", '.settings-rail-profile [aria-label="Account menu for Celine Nova"]');
run("click", '[role=menuitem]:has-text("Invite a friend")');
run("wait", ".invite-friend-dialog");
check(
  "Profile menu opens the same invitation",
  js(`document.querySelector('#friend-signup-link').value===${JSON.stringify(signup)}`),
);
close();
check(
  "Closing menu invitation restores profile menu focus",
  js("document.activeElement.classList.contains('account-trigger')"),
);
// No access to the machine clipboard. Successful and failed writers are deterministic test doubles.
js("Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined})");
open();
run("click", '.invite-friend-actions button:has-text("Copy link")');
check(
  "Missing clipboard selects link and gives manual-copy instructions",
  js(
    "document.querySelector('[role=status].invite-friend-feedback').textContent.includes('blocked')&&document.activeElement.selectionEnd===document.activeElement.value.length",
  ),
);
js(
  "Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new DOMException('Denied','NotAllowedError')}}})",
);
run("click", '.invite-friend-actions button:has-text("Copy link")');
check(
  "Denied clipboard is retryable and never claims copied",
  js(
    "document.querySelector('.invite-friend-feedback').textContent.includes('blocked')&&!document.querySelector('.invite-friend-actions button').disabled",
  ),
);
js(
  "Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value)=>{window.__inviteCopied=value}}})",
);
run("click", '.invite-friend-actions button:has-text("Copy link")');
check(
  "Retry writes exact link before copied confirmation",
  js(
    `window.__inviteCopied===${JSON.stringify(signup)}&&document.querySelector('.invite-friend-feedback').textContent.startsWith('Link copied')`,
  ),
);
const email = js("document.querySelector('.invite-friend-actions a').href");
check(
  "Email draft has no prefilled recipient and includes the correct link",
  new URL(email).pathname === "" && new URL(email).searchParams.get("body")!.endsWith(signup),
);
js(
  "document.querySelector('.invite-friend-actions a').addEventListener('click',event=>event.preventDefault(),{once:true})",
);
run("click", ".invite-friend-actions a");
check(
  "Email action describes a draft, never a sent email",
  js(
    "document.querySelector('.invite-friend-feedback').textContent.includes('Choose a recipient')",
  ),
);
close();
js(
  "Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw new DOMException('Cancelled','AbortError')}})",
);
open();
run("click", '.invite-friend-actions button:has-text("Share…")');
check(
  "Native share cancellation permits retry",
  js(
    "document.querySelector('.invite-friend-feedback').textContent.includes('cancelled')&&!document.querySelector('.invite-friend-actions button').disabled",
  ),
);
js(
  "Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw new DOMException('Denied','NotAllowedError')}})",
);
run("click", '.invite-friend-actions button:has-text("Share…")');
check(
  "Native share refusal retains copy alternative",
  js("document.querySelector('.invite-friend-feedback').textContent.includes('Copy the link')"),
);
js(
  "Object.defineProperty(navigator,'share',{configurable:true,value:async(data)=>{window.__inviteShared=data}})",
);
run("click", '.invite-friend-actions button:has-text("Share…")');
check(
  "Native share receives only public payload",
  js(
    `window.__inviteShared.url===${JSON.stringify(signup)}&&Object.keys(window.__inviteShared).sort().join(',')==='text,title,url'&&document.querySelector('.invite-friend-feedback').textContent==='Sharing finished.'`,
  ),
);
js(
  "(window.__inviteCalls=0,Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>{window.__inviteCalls++;return new Promise(resolve=>window.__inviteResolve=resolve)}}}))",
);
run("click", '.invite-friend-actions button:has-text("Copy link")');
check(
  "Pending copy prevents duplicate actions",
  js("document.querySelector('.invite-friend-actions button').disabled&&window.__inviteCalls===1"),
);
close();
open();
js("window.__inviteResolve()");
check(
  "Late copy result cannot update a reopened dialog",
  js(
    "document.querySelector('.invite-friend-feedback').textContent===''&&!document.querySelector('.invite-friend-actions button').disabled",
  ),
);
for (const size of ["1440x900", "768x1024", "390x844", "320x740"]) {
  run("viewport", size);
  run(
    "js",
    "Promise.all(document.querySelector('.invite-friend-dialog').getAnimations().map(animation=>animation.finished.catch(()=>{})))",
  );
  check(
    `${size}: dialog and actions fit without clipping`,
    js(
      "(()=>{const d=document.querySelector('.invite-friend-dialog'),r=d.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1&&d.scrollWidth<=d.clientWidth+1&&[...d.querySelectorAll('button,a,input')].every(n=>{const b=n.getBoundingClientRect();return b.left>=r.left-1&&b.right<=r.right+1})})()",
    ),
  );
  if (size === "1440x900" || size === "320x740")
    run("screenshot", `${root}/invite-${size}.png`, "--viewport");
}
close();
run("viewport", "1440x900");
run("reload");
run("wait", ".settings-shell");
check(
  "Reload keeps invitation reachable without test API replacements",
  js(
    "!!document.querySelector('#setting-invite-a-friend button')&&window.__inviteCalls===undefined",
  ),
);
run("fill", '[aria-label="Search settings"]', "invite a friend");
run("press", "Enter");
check(
  "Settings search finds and focuses invitation",
  js("document.activeElement.id==='setting-invite-a-friend'"),
);
check("No local console errors", run("console", "--errors").includes("(no console errors)"));
// Verify the actual public destination, with no auth submission or account creation.
run("goto", signup);
run("wait", 'button:has-text("Create account")');
check(
  "Friend's real public destination renders signup, not a 404",
  run("text").includes("Create your account"),
);
check(
  "Friend remains signed out and is asked for their own email",
  js(
    "!!document.querySelector('input[type=email]')&&document.querySelector('input[type=email]').value===''",
  ),
);
run("goto", address);
console.log(JSON.stringify({ passed: checks.length, root }));
