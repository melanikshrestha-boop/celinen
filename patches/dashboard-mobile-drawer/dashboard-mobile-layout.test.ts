import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const source = readFileSync(join(root, "src/components/dashboard/AppDashboard.tsx"), "utf8");
const css = readFileSync(join(root, "src/components/dashboard/dashboard.css"), "utf8");

describe("AppDashboard mobile presentation", () => {
  test("hides permanent rail on mobile (shown width 0)", () => {
    expect(source).not.toContain("mobile ? MINI_W");
    expect(source).toContain("mobile ? 0");
  });

  test("uses Sheet drawer + hamburger on mobile", () => {
    expect(source).toContain('from "@/components/ui/sheet"');
    expect(source).toContain("celinen-dash__drawer");
    expect(source).toContain("Open menu");
    expect(source).toContain("Menu");
  });

  test("closes mobile drawer on route change", () => {
    expect(source).toContain("setMobileNavOpen(false)");
    expect(source).toMatch(/\[pathname,\s*search\]/);
  });

  test("css zeroes rail on mobile and styles drawer", () => {
    expect(css).toContain("--rail: 0px");
    expect(css).toContain(".celinen-dash.is-mobile");
    expect(css).toContain(".celinen-dash__drawer");
    expect(css).toContain(".celinen-dash__menu");
    expect(css).not.toContain("grid-template-columns: 60px minmax(0, 1fr)");
  });
});
