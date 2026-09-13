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
  expect(nav).not.toContain('to="/galleries"');
  expect(nav).not.toContain(">Galleries<");
  expect(features).toContain('useNavMenuHover("features")');
  expect(features).toContain("hoverMenuTrigger");
  expect(features).toContain('title: "Analytics"');
  expect(features).toContain('hash: "analytics"');
  const integrations = readFileSync(
    new URL("../src/components/marketing/IntegrationsMenu.tsx", import.meta.url),
    "utf8",
  );
  expect(integrations).toContain('useNavMenuHover("integrations")');
  expect(integrations).toContain("View all integrations");
  expect(integrations).toContain("menuIntegrations");
  expect(integrations).toContain("{item.title}");
  expect(integrations).not.toContain("{item.copy}");
  expect(useCases).toContain('useNavMenuHover("use-cases")');
  expect(useCases).toContain("hoverMenuTrigger");
  expect(hook).toContain("openNow");
  expect(hook).toContain("pointerType === \"mouse\"");
  expect(hook).toContain("!next && hovering.current");
  expect(hook).toContain("current === id ? null : current");
  expect(hook).toContain('"integrations"');
  const sky = readFileSync(
    new URL("../src/components/marketing/sky-entry.css", import.meta.url),
    "utf8",
  );
  expect(sky).toContain("gap: 2px 6px");
  expect(sky).toContain("min-height: 44px");
  expect(sky).toContain("grid-template-columns: 24px minmax(0, 1fr)");
  expect(sky).toContain(".marketing-nav-integrations .marketing-nav-feature");
  const details = readFileSync(
    new URL("../src/components/marketing/public-details.css", import.meta.url),
    "utf8",
  );
  expect(details).toContain(".marketing-nav__link:focus-visible");
  expect(details).toContain("outline: none");
  expect(details).toContain("white-space: nowrap");
  expect(details).toContain("min-width: max-content");
});
