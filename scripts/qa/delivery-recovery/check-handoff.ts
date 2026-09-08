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
run("goto", "http://127.0.0.1:8086/handoff.html");
run("console", "--clear");
run("viewport", "390x844");
check(
  "document.title.includes('synthetic data') && window.__handoffQA.calls.length === 0",
  "isolated fixture opens without actions",
);
check(
  "document.querySelector('details').textContent.includes('Client feedback · version 2') && document.querySelector('details').textContent.includes('1 open request')",
  "exact version and unresolved request count",
);
check(
  "!document.querySelector('[role=log]').textContent.includes('motion blur') && !document.querySelector('#studio-chat-input').value",
  "feedback is not a transcript or prefilled instruction",
);
check(
  "!window.__unsafeFeedbackExecuted && document.querySelector('details').textContent.includes('<script>') && !document.querySelector('details script')",
  "client markup stays escaped reference text",
);
check(
  "document.documentElement.scrollWidth <= innerWidth && document.querySelector('#studio-chat-input').getBoundingClientRect().bottom < innerHeight",
  "phone has no overflow and composer remains reachable",
);
run("screenshot", "/private/tmp/lenslabs-studio-handoff-mobile.png");
run("click", "details summary");
check("!document.querySelector('details').open", "reference collapses without losing the chat");
run("click", "details summary");
js("window.__handoffQA.mode('changed')");
check(
  "document.querySelector('details').textContent.includes('earlier or different adjustment version') && window.__handoffQA.calls.length === 0",
  "changed edit is labeled without reverting or applying changes",
);
js("window.__handoffQA.mode('other-photo')");
const line = run("snapshot", "-i")
  .split("\n")
  .find((value) => value.includes("Show the feedback’s source photo"));
const ref = line?.match(/@e\d+/)?.[0];
if (!ref) throw new Error("Source photo button unavailable");
run("click", ref);
check(
  "!document.querySelector('details button') && window.__handoffQA.calls.length === 0",
  "source-photo action focuses only, with no edit command",
);
js("window.__handoffQA.mode('wrong-account')");
check(
  "!document.querySelector('details') && document.body.textContent.includes('Reopen this photo from Delivery') && !document.body.textContent.includes('motion blur')",
  "account mismatch hides every client note",
);
js("window.__handoffQA.mode('current')");
run("fill", "#studio-chat-input", "show all");
run("press", "Enter");
check(
  "window.__handoffQA.calls.length === 1 && !document.querySelector('[role=log]').textContent.includes('motion blur')",
  "only the photographer's explicit command executes",
);
run("viewport", "1440x1000");
check(
  "document.documentElement.scrollWidth <= innerWidth && document.querySelector('details').getBoundingClientRect().width <= 390",
  "desktop reference stays within the existing Assistant width",
);
run("screenshot", "/private/tmp/lenslabs-studio-handoff-desktop.png");
js("document.documentElement.classList.remove('dark')");
check(
  "getComputedStyle(document.querySelector('.photo-workbench')).backgroundColor === 'rgb(255, 255, 255)'",
  "existing light theme is preserved",
);
run("screenshot", "/private/tmp/lenslabs-studio-handoff-light.png");
js(
  "document.documentElement.classList.add('dark'); document.querySelector('[aria-label=\"Version-linked notes\"]').scrollTop = 10000",
);
check(
  "document.querySelector('[aria-label=\"Version-linked notes\"]').scrollTop > 0 && document.documentElement.scrollWidth <= innerWidth",
  "long notes remain scrollable without widening the rail",
);
const errors = run("console", "--errors");
if (!errors.includes("(no console errors)")) throw new Error(errors);
console.log("PASS clean console");
