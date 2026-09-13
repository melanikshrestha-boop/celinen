import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../src/routes/studio.tsx", import.meta.url), "utf8");
const start = route.indexOf("    const onKey = (e: KeyboardEvent) => {");
const end = route.indexOf('    window.addEventListener("keydown", onKey);', start);
if (start < 0 || end < start) throw new Error("Studio keyboard handler extraction failed");
const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(route.slice(start, end));

function keyboardFixture(inDialog: boolean) {
  const calls: string[] = [];
  const bindings = {
    workbench: null,
    selectedId: "photo-a",
    selected: { id: "photo-a" },
    matchesShortcut: () => false,
    preferences: { shortcuts: {} },
    undoLast: () => calls.push("undo"),
    step: () => calls.push("step"),
    setVerdict: () => calls.push("verdict"),
    latestShotsRef: { current: [{ id: "photo-a", verdict: "undecided" }] },
    setSyncNote: () => calls.push("note"),
    stageRecipe: () => calls.push("recipe"),
  };
  const onKey = new Function(...Object.keys(bindings), code + "\nreturn onKey;")(
    ...Object.values(bindings),
  );
  const target = {
    tagName: "BUTTON",
    isContentEditable: false,
    closest: (selector: string) => (inDialog && selector.includes("dialog") ? {} : null),
  };
  return { calls, press: (key: string) => onKey({ key, target, preventDefault() {} }) };
}

for (const key of ["k", "x", "r", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "]) {
  test(`dashboard chat Close/Apply button consumes ${JSON.stringify(key)} without changing underlying Cull`, () => {
    const fixture = keyboardFixture(true);
    fixture.press(key);
    expect(fixture.calls).toEqual([]);
  });
}
test("dashboard filmstrip retains K/X navigation outside chat", () => {
  const fixture = keyboardFixture(false);
  fixture.press("k");
  fixture.press("x");
  fixture.press("ArrowRight");
  expect(fixture.calls).toEqual(["verdict", "verdict", "step"]);
});
test("dashboard chat remains mounted while closed and has an accessible native close boundary", () => {
  const dialog = readFileSync(
    new URL("../src/components/studio/StudioChatDialog.tsx", import.meta.url),
    "utf8",
  );
  expect(dialog).toContain("<dialog");
  expect(dialog).toContain('aria-label="Ask celinen"');
  expect(dialog).toContain('aria-label="Close chat"');
  expect(dialog).toContain("element.showModal()");
  expect(dialog).toContain("element.close()");
  expect(dialog).toContain("{children}");
  expect(dialog).not.toContain("if (!open) return null");
  expect(route).toContain('["Ask celinen", openAssistant, false]');
  expect(route).toContain("<StudioChatDialog open={assistantOpen}");
});
