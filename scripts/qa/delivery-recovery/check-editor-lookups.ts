import { execFileSync } from "node:child_process";

const binary = process.argv[2];
if (!binary) throw new Error("Provide the existing browse binary.");
const run = (...args: string[]) => execFileSync(binary, args, { encoding: "utf8", stdio: "pipe" });
const js = (code: string) => run("js", code);
const check = (condition: string, label: string) => {
  js(`(() => { if (!(${condition})) throw new Error(${JSON.stringify(label)}); return true; })()`);
  console.log(`PASS ${label}`);
};
async function waitFor(condition: string, label: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (js(`Boolean(${condition})`).trim() === "true") return;
    await Bun.sleep(25);
  }
  throw new Error(`Timed out: ${label}`);
}

run("console", "--clear");
run("goto", "http://127.0.0.1:8086/?actor=owner");
js("sessionStorage.removeItem('lenslabs.synthetic-delivery-recovery.room.v1')");
run("reload");
await waitFor("typeof window.__deliveryQA === 'object'", "synthetic gallery reload");
run("viewport", "390x844");
run("click", ".delivery-tabs button:nth-child(2)");
js(`(() => {
  window.__editorClipboard = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async text => { window.__editorClipboard.push(text); } },
  });
  return true;
})()`);

run("click", "button[aria-label='Open editor lookup options']");
run("click", "text=Copy Lightroom list");
await waitFor("window.__editorClipboard.length === 1", "Lightroom clipboard write");
check(
  "window.__editorClipboard[0] === 'synthetic-one.jpg,synthetic-two.jpg'",
  "Lightroom lookup copies the exact submitted filenames with comma delimiters",
);
check(
  "document.querySelector('.delivery-selection-note')?.textContent.includes('Copied 2 Lightroom filenames')",
  "Lightroom lookup confirms the non-authoritative handoff",
);

run("click", "button[aria-label='Open editor lookup options']");
run("click", "text=Copy Capture One list");
await waitFor("window.__editorClipboard.length === 2", "Capture One clipboard write");
check(
  "window.__editorClipboard[1] === 'synthetic-one.jpg synthetic-two.jpg'",
  "Capture One lookup copies the exact submitted filenames with space delimiters",
);
check(
  "document.documentElement.scrollWidth <= innerWidth && document.querySelector('.delivery-feedback-tools')?.getBoundingClientRect().right <= innerWidth + 1",
  "editor lookup controls fit a 390px viewport",
);
run("screenshot", "/private/tmp/lenslabs-editor-lookups-mobile.png");

js("window.__deliveryQA.makeFilenameAmbiguous()");
run("click", "button[aria-label='Open editor lookup options']");
run("click", "text=Copy Lightroom list");
await waitFor(
  "document.querySelector('.delivery-error')?.textContent.includes('duplicate filenames')",
  "duplicate filename warning",
);
check(
  "window.__editorClipboard.length === 2",
  "ambiguous duplicate filenames are blocked before clipboard export",
);

run("goto", "http://127.0.0.1:8086/");
run("click", ".delivery-tabs button:nth-child(2)");
check(
  "!document.querySelector('[aria-label=\"Open editor lookup options\"]')",
  "client Feedback does not expose owner editor lookups",
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
console.log(
  "Synthetic owner view only. No live editor, gallery, clipboard, or client data was used.",
);
