import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { appEditKey, isModKey, isTypingTarget } from "../src/lib/app-keys";

describe("standard edit keys", () => {
  test("maps the usual Mac and Windows chords", () => {
    expect(appEditKey({ key: "z", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false })).toBe(
      "undo",
    );
    expect(appEditKey({ key: "z", metaKey: true, ctrlKey: false, shiftKey: true, altKey: false })).toBe(
      "redo",
    );
    expect(appEditKey({ key: "y", metaKey: false, ctrlKey: true, shiftKey: false, altKey: false })).toBe(
      "redo",
    );
    expect(appEditKey({ key: "c", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false })).toBe(
      "copy",
    );
    expect(appEditKey({ key: "v", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false })).toBe(
      "paste",
    );
    expect(appEditKey({ key: "x", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false })).toBe(
      "cut",
    );
    expect(appEditKey({ key: "a", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false })).toBe(
      "selectAll",
    );
    expect(appEditKey({ key: "z", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false })).toBe(
      null,
    );
    expect(isModKey({ metaKey: true, ctrlKey: false })).toBe(true);
  });

  test("does not treat a plain input as a typing target without a node", () => {
    expect(isTypingTarget(null)).toBe(false);
  });

  test("the app mounts the key host and tags undo copy paste", () => {
    const root = readFileSync(new URL("../src/routes/__root.tsx", import.meta.url), "utf8");
    const develop = readFileSync(
      new URL("../src/components/develop/DevelopPage.tsx", import.meta.url),
      "utf8",
    );
    const home = readFileSync(
      new URL("../src/components/dashboard/AppDashboard.tsx", import.meta.url),
      "utf8",
    );
    expect(root).toContain("<AppKeys />");
    expect(develop).toContain('data-app-key="undo"');
    expect(develop).toContain('data-app-key="redo"');
    expect(develop).toContain('data-app-key="copy"');
    expect(develop).toContain('data-app-key="paste"');
    expect(home).toContain("registerAppKeys");
    expect(home).toContain('data-app-key="copy"');
  });
});
