import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("RootShell does not hardcode html.dark so light mode can stay white", () => {
  const root = read("src/routes/__root.tsx");
  expect(root).toContain('<html lang="en">');
  expect(root).not.toContain('className="dark"');
  expect(root).toContain("celinen-status");
  expect(root).toContain("celinen-btn");
});

test("signed-in workbench defaults to landing white and neon pills", () => {
  const css = read("src/components/workbench/workbench.css");
  const light = css.match(/html:has\(\.photo-workbench, \.workbench-lock\)\s*\{([^}]+)\}/)?.[1];
  expect(light).toContain("--wb-bg: #fff");
  expect(light).toContain("--wb-text: #142a36");
  expect(light).toContain("--send-active-bg: #4d6fff");
  expect(css).toContain("border-radius: 999px");
  expect(css).toContain("background: #eef2ff");
  expect(css).toContain("color: #4d6fff");
});

test("earnings stays paper in light mode and only goes black under html.dark", () => {
  const css = read("src/components/earnings/finance-os.css");
  const base = css.match(
    /\.finance-os-host\.earnings-workspace,\s*\.finance-os\s*\{([^}]+)\}/,
  )?.[1];
  expect(base).toContain("--fos-bg: #f7f8fa");
  expect(base).toContain("color-scheme: light");
  expect(base).toContain("--fos-accent: #4d6fff");
  expect(css).toMatch(/:root\.dark[\s\S]*--fos-bg: #000000/);
});

test("workspace home and settings use neon pills instead of teal chrome", () => {
  const home = read("src/components/workbench/workspace-home.css");
  const settings = read("src/components/account/settings-workspace.css");
  expect(home).toContain("color: #4d6fff");
  expect(home).not.toContain("#006eaa");
  expect(settings).toContain("border-radius: 999px");
  expect(settings).toContain("background: var(--settings-accent, #4d6fff)");
});
