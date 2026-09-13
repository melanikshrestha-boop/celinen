import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("embedded Studio keeps shoot actions above the positioned photo preview", () => {
  const css = readFileSync(
    new URL("../src/components/dashboard/dashboard.css", import.meta.url),
    "utf8",
  );
  const rule = css.match(/\.celinen-embedded-studio > header\s*\{([^}]+)\}/)?.[1];
  expect(rule).toContain("position: relative");
  expect(rule).not.toContain("position: static");
  const route = readFileSync(new URL("../src/routes/studio.tsx", import.meta.url), "utf8");
  expect(route).toContain('className="sticky top-0 z-30');
  expect(route).toContain('aria-label="Shoot actions"');
});

test("scene navigation wraps inside the narrow embedded toolbar", () => {
  const css = readFileSync(
    new URL("../src/components/workbench/workbench.css", import.meta.url),
    "utf8",
  );
  const rule = css.match(/\.workbench-photo-toolbar\s*\{([^}]+)\}/)?.[1];
  expect(rule).toContain("flex-wrap: wrap");
});
