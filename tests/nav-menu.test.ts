import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("landing Features and Use Cases menus share exclusive open state", () => {
  const nav = readFileSync(new URL("../src/components/Nav.tsx", import.meta.url), "utf8");
  const features = readFileSync(
    new URL("../src/components/marketing/FeaturesMenu.tsx", import.meta.url),
    "utf8",
  );
  const useCases = readFileSync(
    new URL("../src/components/marketing/UseCasesMenu.tsx", import.meta.url),
    "utf8",
  );
  const hook = readFileSync(
    new URL("../src/components/marketing/nav-menu.tsx", import.meta.url),
    "utf8",
  );
  expect(nav).toContain("NavMenuProvider");
  expect(features).toContain('useNavMenuHover("features")');
  expect(features).toContain("hoverMenuTrigger");
  expect(useCases).toContain('useNavMenuHover("use-cases")');
  expect(useCases).toContain("hoverMenuTrigger");
  expect(hook).toContain("openNow");
  expect(hook).toContain("pointerType === \"mouse\"");
  expect(hook).toContain("!next && hovering.current");
  expect(hook).toContain("current === id ? null : current");
});
